import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const sourceRoot = new URL("../src/assets/terrain/parkland-composable-v1/", import.meta.url);
const outputRoot = new URL("../src/assets/terrain/parkland-pair-atlas-v2/", import.meta.url);
const sourceManifest = JSON.parse(await readFile(new URL("manifest.json", sourceRoot), "utf8"));
const contract = "parkland-pair-derived-runtime-v2";
const pairs = [
  "fairway--rough", "fairway--deep_rough", "fairway--green", "fairway--tee",
  "rough--deep_rough", "rough--green", "rough--tee",
  "deep_rough--green", "deep_rough--tee", "green--tee",
];
const directions = ["n", "e", "s", "w"];
const corners = ["ne", "se", "sw", "nw"];
const cornerDirections = {
  ne: ["n", "e"], se: ["e", "s"], sw: ["s", "w"], nw: ["w", "n"],
};
const roles = pairs.flatMap((pair) => [
  ...directions.map((direction) => `edge:${pair}:${direction}`),
  ...corners.map((corner) => `corner:${pair}:${corner}`),
]);
const qualities = {
  high: { width: 256, height: 128, depth: 16, cornerReach: 12, overlap: 2, textureScale: 4, textureAlphaDrop: 20, alpha: [184, 126, 76] },
  medium: { width: 128, height: 64, depth: 8, cornerReach: 6, overlap: 1, textureScale: 2, textureAlphaDrop: 18, alpha: [180, 122, 72] },
  low: { width: 64, height: 32, depth: 4, cornerReach: 3, overlap: 1, textureScale: 1, textureAlphaDrop: 16, alpha: [172, 114, 68] },
};
const columns = 2;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)));

function pixelGeometry(x, y, width, height) {
  const u = (x + 0.5 - width / 2) / (width / 2);
  const v = (y + 0.5 - height / 2) / (height / 2);
  const metrics = { n: u - v, e: u + v, s: -u + v, w: -u - v };
  const inside = Math.abs(u) + Math.abs(v) <= 1;
  let closest = directions[0];
  for (const direction of directions.slice(1)) {
    if (metrics[direction] > metrics[closest]) closest = direction;
  }
  const depth = Object.fromEntries(directions.map((direction) => [
    direction,
    (1 - metrics[direction]) * height / 2,
  ]));
  return { u, v, inside, closest, depth };
}

function alongForDirection(direction, u, v) {
  switch (direction) {
    case "n": return (u + v + 1) / 2;
    case "e": return (-u + v + 1) / 2;
    case "s": return (-u - v + 1) / 2;
    case "w": return (u - v + 1) / 2;
    default: throw new Error(`Unknown direction: ${direction}`);
  }
}

function guidePalette(image, direction = null) {
  const bins = Array.from({ length: 64 }, () => ({ r: 0, g: 0, b: 0, weight: 0 }));
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const offset = (y * image.width + x) * 4;
    const alpha = image.data[offset + 3];
    if (alpha === 0) continue;
    const geometry = pixelGeometry(x, y, image.width, image.height);
    const along = direction === null ? 0.5 : alongForDirection(direction, geometry.u, geometry.v);
    const index = Math.max(0, Math.min(bins.length - 1, Math.floor(along * bins.length)));
    bins[index].r += image.data[offset] * alpha;
    bins[index].g += image.data[offset + 1] * alpha;
    bins[index].b += image.data[offset + 2] * alpha;
    bins[index].weight += alpha;
  }
  const populated = bins.map((bin, index) => bin.weight > 0 ? index : -1).filter((index) => index >= 0);
  if (populated.length === 0) throw new Error("Guide has no visible pixels");
  return bins.map((bin, index) => {
    const nearest = bin.weight > 0
      ? index
      : populated.reduce((best, candidate) => (
        Math.abs(candidate - index) < Math.abs(best - index) ? candidate : best
      ), populated[0]);
    const sample = bins[nearest];
    return [sample.r / sample.weight, sample.g / sample.weight, sample.b / sample.weight];
  });
}

function semanticSample(image, x, y, salt) {
  const sx = (x + salt * 17) % image.width;
  const sy = (y * 2 + salt * 29) % image.height;
  const offset = (sy * image.width + sx) * 4;
  return [image.data[offset], image.data[offset + 1], image.data[offset + 2], image.data[offset + 3]];
}

function paintPixel(output, x, y, guide, semantic, band, alpha, salt, parameters) {
  const sample = semanticSample(semantic, x, y, salt);
  const guideWeight = [0.72, 0.6, 0.48][band];
  const textured = (
    Math.floor(x / parameters.textureScale)
    + Math.floor(y / parameters.textureScale) * 2
    + salt
    + Math.floor(sample[3] / 8)
  ) % 7 === 0;
  const motif = textured ? -12 : 0;
  const bandTone = [8, 0, -8][band];
  const offset = (y * output.width + x) * 4;
  for (let channel = 0; channel < 3; channel++) {
    const blended = guide[channel] * guideWeight + sample[channel] * (1 - guideWeight) + motif + bandTone;
    output.data[offset + channel] = clampByte(Math.round(blended / 8) * 8);
  }
  output.data[offset + 3] = alpha - (textured ? parameters.textureAlphaDrop : 0);
  return textured;
}

function synthesizeEdge(source, semantic, direction, parameters, salt) {
  const output = new PNG({ width: parameters.width, height: parameters.height });
  const palette = guidePalette(source, direction);
  const bandPixels = [0, 0, 0];
  let modulatedPixels = 0;
  let oppositeSidePixels = 0;
  let outsideDiamondPixels = 0;
  for (let y = 0; y < output.height; y++) for (let x = 0; x < output.width; x++) {
    const geometry = pixelGeometry(x, y, output.width, output.height);
    if (!geometry.inside || geometry.closest !== direction) continue;
    const depth = geometry.depth[direction];
    if (depth < 0 || depth >= parameters.depth) continue;
    const band = Math.min(2, Math.floor(depth * 3 / parameters.depth));
    const along = alongForDirection(direction, geometry.u, geometry.v);
    const guide = palette[Math.max(0, Math.min(palette.length - 1, Math.floor(along * palette.length)))];
    if (paintPixel(output, x, y, guide, semantic, band, parameters.alpha[band], salt, parameters)) {
      modulatedPixels++;
    }
    bandPixels[band]++;
    if (!geometry.inside) outsideDiamondPixels++;
    if (geometry.closest !== direction) oppositeSidePixels++;
  }
  return { output, metrics: { bandPixels, modulatedPixels, outsideDiamondPixels, oppositeSidePixels } };
}

function synthesizeCorner(source, incidentSources, semantic, corner, parameters, salt) {
  const output = new PNG({ width: parameters.width, height: parameters.height });
  const sourcePalette = guidePalette(source);
  const [firstDirection, secondDirection] = cornerDirections[corner];
  const firstPalette = guidePalette(incidentSources[0], firstDirection);
  const secondPalette = guidePalette(incidentSources[1], secondDirection);
  const bandPixels = [0, 0, 0];
  let modulatedPixels = 0;
  let outsideDiamondPixels = 0;
  let incidentOverlapPixels = 0;
  let continuityPixels = 0;
  for (let y = 0; y < output.height; y++) for (let x = 0; x < output.width; x++) {
    const geometry = pixelGeometry(x, y, output.width, output.height);
    if (!geometry.inside) continue;
    const firstDepth = geometry.depth[firstDirection];
    const secondDepth = geometry.depth[secondDirection];
    const minimumDepth = Math.min(firstDepth, secondDepth);
    const radialDepth = (firstDepth + secondDepth) / 2;
    const start = parameters.depth - parameters.overlap;
    const finish = parameters.depth + parameters.cornerReach;
    if (minimumDepth < start || radialDepth < start || radialDepth >= finish) continue;
    const progress = (radialDepth - start) / (finish - start);
    const band = Math.min(2, Math.floor(progress * 3));
    const firstAlong = alongForDirection(firstDirection, geometry.u, geometry.v);
    const secondAlong = alongForDirection(secondDirection, geometry.u, geometry.v);
    const colors = [
      sourcePalette[Math.floor(sourcePalette.length / 2)],
      firstPalette[Math.max(0, Math.min(63, Math.floor(firstAlong * 64)))],
      secondPalette[Math.max(0, Math.min(63, Math.floor(secondAlong * 64)))],
    ];
    const guide = [0, 1, 2].map((channel) => (
      colors[0][channel] * 0.34 + colors[1][channel] * 0.33 + colors[2][channel] * 0.33
    ));
    if (paintPixel(output, x, y, guide, semantic, band, parameters.alpha[band], salt, parameters)) {
      modulatedPixels++;
    }
    bandPixels[band]++;
    if (!geometry.inside) outsideDiamondPixels++;
    if (minimumDepth < parameters.depth) incidentOverlapPixels++;
    if (minimumDepth < parameters.depth + 1) continuityPixels++;
  }
  return {
    output,
    metrics: { bandPixels, modulatedPixels, outsideDiamondPixels, incidentOverlapPixels, continuityPixels },
  };
}

function alphaMetrics(image) {
  let visiblePixels = 0;
  let transparentRgbPixels = 0;
  const alphaLevels = new Set();
  const colors = new Set();
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const alpha = image.data[offset + 3];
    if (alpha > 0) {
      visiblePixels++;
      alphaLevels.add(alpha);
      colors.add(`${image.data[offset]},${image.data[offset + 1]},${image.data[offset + 2]}`);
    } else if (image.data[offset] !== 0 || image.data[offset + 1] !== 0 || image.data[offset + 2] !== 0) {
      transparentRgbPixels++;
    }
  }
  return {
    visiblePixels,
    coverage: visiblePixels / (image.width * image.height),
    alphaLevels: [...alphaLevels].sort((a, b) => b - a),
    distinctVisibleColors: colors.size,
    transparentRgbPixels,
  };
}

async function readVerified(relative) {
  const bytes = await readFile(new URL(relative, sourceRoot));
  const hash = sha256(bytes);
  if (hash !== sourceManifest.files[relative]?.sha256) throw new Error(`Source hash mismatch: ${relative}`);
  return { bytes, hash, image: PNG.sync.read(bytes) };
}

async function smallestPng(image) {
  const candidates = [];
  for (const deflateStrategy of [0, 1, 2, 3]) for (const filterType of [-1, 0, 1, 2, 3, 4]) {
    candidates.push(PNG.sync.write(image, { deflateLevel: 9, deflateStrategy, filterType }));
  }
  candidates.sort((a, b) => a.length - b.length || Buffer.compare(a, b));
  return candidates[0];
}

await mkdir(outputRoot, { recursive: true });
const derivedManifest = {
  contract,
  sourceContract: sourceManifest.contract ?? "parkland-composable-v1",
  sourceManifestSha256: sha256(await readFile(new URL("manifest.json", sourceRoot))),
  columns,
  roles,
  qualities: {},
};

for (const [quality, parameters] of Object.entries(qualities)) {
  const atlas = new PNG({
    width: parameters.width * columns,
    height: parameters.height * roles.length / columns,
  });
  const frames = {};
  const semanticCache = new Map();
  const guideCache = new Map();
  const semanticFor = async (semantic) => {
    if (!semanticCache.has(semantic)) {
      semanticCache.set(semantic, await readVerified(`${quality}/semantic-${semantic}.png`));
    }
    return semanticCache.get(semantic);
  };
  const guideFor = async (kind, pair, position) => {
    const relative = `${quality}/${kind}-${pair}-${position}.png`;
    if (!guideCache.has(relative)) guideCache.set(relative, await readVerified(relative));
    return { relative, ...guideCache.get(relative) };
  };

  for (const [index, role] of roles.entries()) {
    const [kind, pair, position] = role.split(":");
    const ownerSemantic = pair.split("--")[0];
    const guide = await guideFor(kind, pair, position);
    const semantic = await semanticFor(ownerSemantic);
    if (guide.image.width !== parameters.width || guide.image.height !== parameters.height) {
      throw new Error(`Source size mismatch: ${guide.relative}`);
    }
    const salt = index + quality.length * 97;
    const synthesize = async () => kind === "edge"
      ? synthesizeEdge(guide.image, semantic.image, position, parameters, salt)
      : synthesizeCorner(
        guide.image,
        await Promise.all(cornerDirections[position].map(async (direction) => (
          (await guideFor("edge", pair, direction)).image
        ))),
        semantic.image,
        position,
        parameters,
        salt,
      );
    const result = await synthesize();
    const repeat = await synthesize();
    if (!result.output.data.equals(repeat.output.data)) throw new Error(`Nondeterministic synthesis: ${quality}:${role}`);
    PNG.bitblt(
      result.output,
      atlas,
      0,
      0,
      parameters.width,
      parameters.height,
      index % columns * parameters.width,
      Math.floor(index / columns) * parameters.height,
    );
    frames[role] = {
      guidePath: guide.relative,
      guideSha256: guide.hash,
      semanticPath: `${quality}/semantic-${ownerSemantic}.png`,
      semanticSha256: semantic.hash,
      rgbaSha256: sha256(result.output.data),
      metrics: { ...alphaMetrics(result.output), ...result.metrics },
    };
  }
  const atlasBytes = await smallestPng(atlas);
  const output = new URL(`${quality}-pair-atlas.png`, outputRoot);
  await writeFile(output, atlasBytes);
  derivedManifest.qualities[quality] = {
    parameters,
    frameSize: [parameters.width, parameters.height],
    atlasSha256: sha256(atlasBytes),
    atlasBytes: atlasBytes.length,
    determinismVerified: true,
    frames,
  };
  console.log(`${fileURLToPath(output)} ${atlasBytes.length} B`);
}

await writeFile(
  new URL("manifest.json", outputRoot),
  `${JSON.stringify(derivedManifest, null, 2)}\n`,
);
