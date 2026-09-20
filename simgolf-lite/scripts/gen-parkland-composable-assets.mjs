// Deterministic, renderer-neutral Parkland material primitives for ZK-463.
//
// These assets are deliberately not wired into the current runtime. They are
// the versioned source contract consumed by the downstream half-edge and
// semantic-field renderer packets. All topology/gameplay ownership stays in
// those consumers; this generator owns only repeatable pixels and metadata.
import { createHash } from "node:crypto";
import {
  mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = path.join(ROOT, "src/assets/terrain/parkland-composable-v1");
const OUTPUT = path.resolve(process.env.COURSECRAFT_COMPOSABLE_OUTPUT_DIR || DEFAULT_OUTPUT);
const EVIDENCE = process.env.COURSECRAFT_COMPOSABLE_EVIDENCE_DIR
  ? path.resolve(process.env.COURSECRAFT_COMPOSABLE_EVIDENCE_DIR)
  : null;

const VERSION = 1;
const WORLD_PERIOD_TILES = 8;
const SEMANTICS = ["fairway", "rough", "deep_rough", "green", "tee"];
const DIRECTIONS = ["n", "e", "s", "w"];
const CORNERS = ["ne", "se", "sw", "nw"];
const HAZARDS = ["water", "sand", "bunker", "shore"];
const QUALITIES = {
  high: { field: 256, cellWidth: 256, cellHeight: 128, scale: 4, stampCount: 64, detailScale: 1 },
  medium: { field: 128, cellWidth: 128, cellHeight: 64, scale: 2, stampCount: 34, detailScale: 0.68 },
  low: { field: 64, cellWidth: 64, cellHeight: 32, scale: 1, stampCount: 16, detailScale: 0.36 },
};
const PALETTES = {
  standard: {
    undercoat: [73, 124, 64], fairway: [101, 158, 75], rough: [45, 112, 75],
    deep_rough: [30, 89, 42], green: [78, 166, 94], tee: [135, 157, 76],
  },
  deuteranopia: {
    undercoat: [82, 112, 105], fairway: [74, 153, 187], rough: [95, 119, 132],
    deep_rough: [58, 88, 119], green: [68, 178, 164], tee: [205, 164, 69],
  },
  protanopia: {
    undercoat: [80, 113, 101], fairway: [65, 151, 184], rough: [92, 121, 125],
    deep_rough: [55, 87, 111], green: [74, 174, 156], tee: [211, 167, 73],
  },
  tritanopia: {
    undercoat: [93, 115, 73], fairway: [78, 154, 94], rough: [105, 111, 57],
    deep_rough: [80, 86, 47], green: [67, 168, 118], tee: [199, 126, 137],
  },
};
const PATTERNS = {
  fairway: "tiered-broken-mowing-swaths",
  rough: "toroidal-irregular-blade-tufts",
  deep_rough: "toroidal-clustered-long-tufts",
  green: "toroidal-fine-care-specks",
  tee: "toroidal-short-care-stamps",
};
const PAIR_KEYS = [];
for (let a = 0; a < SEMANTICS.length; a += 1) {
  for (let b = a + 1; b < SEMANTICS.length; b += 1) {
    PAIR_KEYS.push(`${SEMANTICS[a]}--${SEMANTICS[b]}`);
  }
}

const hashBytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
const clamp = (value, min = 0, max = 255) => Math.max(min, Math.min(max, value));
const mix = (a, b, amount) => a.map((value, index) => Math.round(value * (1 - amount) + b[index] * amount));
const shade = (color, factor) => color.map((value) => Math.round(clamp(value * factor)));
const pixelOffset = (image, x, y) => (y * image.width + x) * 4;

function put(image, x, y, color, alpha = 255) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const offset = pixelOffset(image, x, y);
  image.data[offset] = color[0];
  image.data[offset + 1] = color[1];
  image.data[offset + 2] = color[2];
  image.data[offset + 3] = alpha;
}

function get(image, x, y) {
  const offset = pixelOffset(image, x, y);
  return image.data.subarray(offset, offset + 4);
}

function save(relativePath, image, metadata, manifestFiles) {
  const target = path.join(OUTPUT, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  const bytes = PNG.sync.write(image, { deflateLevel: 9, deflateStrategy: 0 });
  writeFileSync(target, bytes);
  manifestFiles[relativePath] = {
    bytes: bytes.length,
    sha256: hashBytes(bytes),
    width: image.width,
    height: image.height,
    ...metadata,
  };
  return image;
}

function periodicCoordinate(index, size) {
  return size <= 1 ? 0 : index / (size - 1);
}

function unitHash(seed, index, lane) {
  let value = Math.imul(seed ^ Math.imul(index + 17, 0x9e3779b1), 0x85ebca6b) ^ Math.imul(lane + 31, 0xc2b2ae35);
  value = Math.imul(value ^ (value >>> 16), 0x27d4eb2d);
  return ((value ^ (value >>> 15)) >>> 0) / 0xffffffff;
}

function wrappedDelta(value, center) {
  const delta = value - center;
  return delta - Math.round(delta);
}

const MASTER_STAMPS = Array.from({ length: QUALITIES.high.stampCount }, (_, index) => ({
  u: unitHash(0x463a, index, 0),
  v: unitHash(0x463a, index, 1),
  angle: (unitHash(0x463a, index, 2) - 0.5) * Math.PI * 0.9,
  strength: 0.72 + unitHash(0x463a, index, 3) * 0.28,
}));
const COMMON_STAMPS = Object.fromEntries(Object.entries(QUALITIES).map(([quality, policy]) => [
  quality, MASTER_STAMPS.slice(0, policy.stampCount),
]));

function stampField(u, v, quality, semantic) {
  const policy = QUALITIES[quality];
  const counts = {
    fairway: Math.round(policy.stampCount * 0.46),
    rough: Math.round(policy.stampCount * 0.72),
    deep_rough: policy.stampCount,
    green: Math.round(policy.stampCount * 0.62),
    tee: Math.round(policy.stampCount * 0.52),
  };
  const radii = {
    fairway: [0.075, 0.018], rough: [0.054, 0.016], deep_rough: [0.068, 0.024],
    green: [0.028, 0.021], tee: [0.05, 0.014],
  };
  const [major, minor] = radii[semantic];
  const tierWidth = quality === "high" ? 0.72 : quality === "medium" ? 1 : 1.5;
  let response = 0;
  for (let index = 0; index < counts[semantic]; index += 1) {
    const stamp = COMMON_STAMPS[quality][index];
    const dx = wrappedDelta(u, stamp.u);
    const dy = wrappedDelta(v, stamp.v);
    const angle = stamp.angle + (semantic === "rough" ? -0.55 : semantic === "deep_rough" ? (index % 3 - 1) * 0.24 : 0);
    const cos = Math.cos(angle); const sin = Math.sin(angle);
    const along = dx * cos + dy * sin;
    const across = -dx * sin + dy * cos;
    const radius = Math.sqrt((along / (major * tierWidth)) ** 2 + (across / (minor * tierWidth)) ** 2);
    if (radius < 1) response = Math.max(response, (1 - radius) * stamp.strength);
  }
  return response;
}

function makeUndercoat(size) {
  const image = new PNG({ width: size, height: size });
  const base = PALETTES.standard.undercoat;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const u = periodicCoordinate(x, size);
    const v = periodicCoordinate(y, size);
    // Only world-periodic harmonics are used. Matching samples at u/v 0 and 1
    // make the repeat boundary byte-exact, without a tile-sized phase reset.
    const macro = Math.sin((u * 2 + v) * Math.PI * 2) * 0.018
      + Math.cos((u - v * 2) * Math.PI * 2) * 0.014
      + Math.sin((u * 5 + v * 3) * Math.PI * 2) * 0.006;
    put(image, x, y, shade(base, 1 + macro), 255);
  }
  return image;
}

function semanticSignal(semantic, u, v, quality) {
  const detail = QUALITIES[quality].detailScale;
  const stamps = stampField(u, v, quality, semantic);
  const tier = quality === "high" ? 0 : quality === "medium" ? 1 : 2;
  if (semantic === "fairway") {
    const frequency = quality === "high" ? 7 : quality === "medium" ? 5 : 3;
    const band = Math.sin((u * frequency + v * 2) * Math.PI * 2);
    const care = band * 0.65 + stamps * detail;
    return { alpha: care > 0.18 ? 76 : 42, shade: care > 0.18 ? 1.035 : 0.982 };
  }
  if (semantic === "rough") {
    const base = [108, 92, 76][tier]; const energy = [90, 72, 54][tier];
    return { alpha: base + Math.round(stamps * energy), shade: 0.88 + stamps * [0.34, 0.29, 0.24][tier] };
  }
  if (semantic === "deep_rough") {
    const broad = stampField(u + 0.017, v - 0.013, quality, semantic);
    const base = [68, 54, 40][tier]; const energy = [120, 90, 60][tier];
    return { alpha: base + Math.round(Math.max(stamps, broad * 0.86) * energy), shade: 0.925 + stamps * [0.2, 0.16, 0.12][tier] };
  }
  if (semantic === "green") {
    const base = [64, 48, 32][tier]; const energy = [68, 52, 36][tier];
    return { alpha: base + Math.round(stamps * energy), shade: 0.99 + stamps * [0.1, 0.075, 0.05][tier] };
  }
  const base = [90, 74, 58][tier]; const energy = [86, 64, 44][tier];
  return { alpha: base + Math.round(stamps * energy), shade: 0.96 + stamps * [0.14, 0.1, 0.07][tier] };
}

function makeSemantic(size, semantic, quality) {
  const image = new PNG({ width: size, height: size });
  const color = PALETTES.standard[semantic];
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const u = periodicCoordinate(x, size);
    const v = periodicCoordinate(y, size);
    const signal = semanticSignal(semantic, u, v, quality);
    put(image, x, y, shade(color, signal.shade), signal.alpha);
  }
  return image;
}

function insideDiamond(x, y, width, height) {
  const nx = (x + 0.5 - width / 2) / (width / 2);
  const ny = (y + 0.5 - height / 2) / (height / 2);
  return Math.abs(nx) + Math.abs(ny) <= 1;
}

function edgeDistance(x, y, width, height) {
  const nx = (x + 0.5 - width / 2) / (width / 2);
  const ny = (y + 0.5 - height / 2) / (height / 2);
  return 1 - (nx - ny); // canonical north-east-facing side
}

function transform(image, mode) {
  const result = new PNG({ width: image.width, height: image.height });
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    let sourceX = mode === "flip-x" || mode === "rotate-180" ? image.width - 1 - x : x;
    let sourceY = mode === "flip-y" || mode === "rotate-180" ? image.height - 1 - y : y;
    if (mode === "iso-rotate-90" || mode === "iso-rotate-270") {
      const nx = (x + 0.5 - image.width / 2) / (image.width / 2);
      const ny = (y + 0.5 - image.height / 2) / (image.height / 2);
      const sourceNx = mode === "iso-rotate-90" ? ny : -ny;
      const sourceNy = mode === "iso-rotate-90" ? -nx : nx;
      sourceX = Math.max(0, Math.min(image.width - 1, Math.round((sourceNx + 1) * image.width / 2 - 0.5)));
      sourceY = Math.max(0, Math.min(image.height - 1, Math.round((sourceNy + 1) * image.height / 2 - 0.5)));
    }
    put(result, x, y, get(image, sourceX, sourceY), get(image, sourceX, sourceY)[3]);
  }
  return result;
}

function pairColors(pair) {
  const [from, to] = pair.split("--");
  return [PALETTES.standard[from], PALETTES.standard[to]];
}

function pairSeed(pair) {
  return pair.split("").reduce((value, character) => Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0, 2166136261);
}

function edgeBand(t, from, to, dash) {
  if (t < 0.18) return { color: shade(mix(from, to, 0.2), dash ? 1.055 : 0.97), alpha: 216 };
  if (t < 0.46) return { color: shade(mix(from, to, 0.38), dash ? 1.04 : 0.985), alpha: 196 };
  if (t < 0.74) return { color: shade(mix(from, to, 0.62), dash ? 1.025 : 0.99), alpha: 170 };
  return { color: shade(mix(from, to, 0.82), dash ? 1.015 : 0.995), alpha: 132 };
}

function makeCanonicalEdge(width, height, pair, quality) {
  const image = new PNG({ width, height });
  const [from, to] = pairColors(pair);
  const stripWidth = quality === "high" ? 0.13 : quality === "medium" ? 0.14 : 0.16;
  const seed = pairSeed(pair);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (!insideDiamond(x, y, width, height)) continue;
    const distance = edgeDistance(x, y, width, height);
    if (distance < 0 || distance > stripWidth) continue;
    const t = distance / stripWidth;
    const along = Math.floor((x / width + y / height) * (quality === "high" ? 28 : quality === "medium" ? 18 : 10));
    const dash = unitHash(seed, along, 5) > 0.48;
    const band = edgeBand(t, from, to, dash);
    put(image, x, y, band.color, band.alpha);
  }
  return image;
}

function makeCanonicalCorner(width, height, pair, quality) {
  const image = new PNG({ width, height });
  const [from, to] = pairColors(pair);
  const stripWidth = quality === "high" ? 0.13 : quality === "medium" ? 0.14 : 0.22;
  const seed = pairSeed(pair);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (!insideDiamond(x, y, width, height)) continue;
    const nx = (x + 0.5 - width / 2) / (width / 2);
    const ny = (y + 0.5 - height / 2) / (height / 2);
    const north = 1 - (nx - ny);
    const east = 1 - (nx + ny);
    if (north < 0 || east < 0 || north > stripWidth || east > stripWidth) continue;
    const t = Math.max(north, east) / stripWidth;
    const dash = unitHash(seed, Math.floor((north + east) * 100), 7) > 0.48;
    const band = edgeBand(t, from, to, dash);
    put(image, x, y, band.color, Math.max(118, band.alpha - 18));
  }
  return image;
}

function alphaBounds(image) {
  let minX = image.width; let minY = image.height; let maxX = -1; let maxY = -1;
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    if (get(image, x, y)[3] === 0) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function alphaMaximum(image) {
  let maximum = 0;
  for (let index = 3; index < image.data.length; index += 4) maximum = Math.max(maximum, image.data[index]);
  return maximum;
}

function alphaRange(image) {
  let minimum = 255; let maximum = 0;
  for (let index = 3; index < image.data.length; index += 4) {
    minimum = Math.min(minimum, image.data[index]); maximum = Math.max(maximum, image.data[index]);
  }
  return [minimum, maximum];
}

function organicRadius(angle, seed) {
  return 1
    + Math.sin(angle * 3 + seed * 0.71) * 0.105
    + Math.sin(angle * 5 - seed * 0.37) * 0.047
    + Math.cos(angle * 7 + seed * 0.19) * 0.028;
}

function makeHazard(width, height, kind) {
  const image = new PNG({ width, height });
  const seed = HAZARDS.indexOf(kind) + 1;
  const centerX = width * (0.5 + (seed % 2 ? -0.018 : 0.014));
  const centerY = height * (0.52 + (seed % 3 - 1) * 0.018);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const dx = (x + 0.5 - centerX) / (width * (kind === "shore" ? 0.36 : 0.34));
    const dy = (y + 0.5 - centerY) / (height * (kind === "bunker" ? 0.31 : 0.34));
    const angle = Math.atan2(dy, dx);
    const radius = Math.sqrt(dx * dx + dy * dy);
    const boundary = organicRadius(angle, seed);
    if (radius > boundary) continue;
    const normalized = radius / boundary;
    if (kind === "shore") {
      if (normalized < 0.72) continue;
      const color = normalized > 0.91 ? [75, 91, 61] : normalized > 0.81 ? [133, 126, 86] : [82, 118, 115];
      put(image, x, y, color, normalized > 0.96 ? 176 : 220);
      continue;
    }
    if (kind === "water") {
      const ripple = Math.sin((x / width * 13 + y / height * 2) * Math.PI * 2);
      const color = normalized > 0.86 ? [79, 111, 93] : normalized > 0.7 ? [66, 128, 140] : ripple > 0.72 ? [76, 148, 164] : [49, 112, 143];
      put(image, x, y, color, normalized > 0.95 ? 204 : 244);
      continue;
    }
    const isBunker = kind === "bunker";
    const lip = normalized > (isBunker ? 0.78 : 0.9);
    const shadowSide = Math.sin(angle + Math.PI * 0.25) < -0.18;
    const floor = isBunker ? [210, 188, 132] : [217, 196, 145];
    const color = lip ? (shadowSide ? [94, 76, 52] : [153, 126, 78]) : floor;
    put(image, x, y, color, normalized > 0.97 ? 210 : 255);
  }
  return image;
}

function composite(base, overlay) {
  const result = new PNG({ width: base.width, height: base.height });
  for (let y = 0; y < base.height; y += 1) for (let x = 0; x < base.width; x += 1) {
    const a = get(base, x, y); const b = get(overlay, x, y);
    const amount = b[3] / 255;
    put(result, x, y, mix(a, b, amount), 255);
  }
  return result;
}

function blit(target, source, targetX, targetY) {
  for (let y = 0; y < source.height; y += 1) for (let x = 0; x < source.width; x += 1) {
    const pixel = get(source, x, y);
    if (pixel[3] === 0) continue;
    const tx = targetX + x; const ty = targetY + y;
    if (tx < 0 || ty < 0 || tx >= target.width || ty >= target.height) continue;
    const under = get(target, tx, ty);
    const amount = pixel[3] / 255;
    put(target, tx, ty, mix(under, pixel, amount), Math.max(under[3], pixel[3]));
  }
}

function proofCrop(base, overlay = null, pixelsPerTile = 16) {
  const size = 30 * pixelsPerTile;
  const result = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const sourceX = Math.round(((x % (WORLD_PERIOD_TILES * pixelsPerTile)) / (WORLD_PERIOD_TILES * pixelsPerTile - 1)) * (base.width - 1));
    const sourceY = Math.round(((y % (WORLD_PERIOD_TILES * pixelsPerTile)) / (WORLD_PERIOD_TILES * pixelsPerTile - 1)) * (base.height - 1));
    const under = get(base, sourceX, sourceY);
    if (!overlay) put(result, x, y, under, 255);
    else {
      const over = get(overlay, sourceX, sourceY);
      put(result, x, y, mix(under, over, over[3] / 255), 255);
    }
  }
  return result;
}

function checkerboard(width, height, size = 8) {
  const result = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const light = (Math.floor(x / size) + Math.floor(y / size)) % 2 === 0;
    put(result, x, y, light ? [92, 96, 88] : [45, 49, 43], 255);
  }
  return result;
}

function fillWithUndercoat(target, undercoat) {
  for (let y = 0; y < target.height; y += 1) for (let x = 0; x < target.width; x += 1) {
    put(target, x, y, get(undercoat, x % undercoat.width, y % undercoat.height), 255);
  }
}

function buildPairAssembly(assets, pair, quality, columns = 5, rows = 5) {
  const config = QUALITIES[quality];
  const width = Math.ceil((columns + rows) * config.cellWidth / 2 + config.cellWidth);
  const height = Math.ceil((columns + rows) * config.cellHeight / 2 + config.cellHeight);
  const image = new PNG({ width, height });
  fillWithUndercoat(image, assets[quality].undercoat);
  const [from, to] = pair.split("--");
  const used = new Set();
  const tileSemantic = (tileX, tileY) => {
    const step = tileY >= Math.floor(rows / 2) ? 1 : 0;
    return tileX < Math.floor(columns / 2) + step ? from : to;
  };
  const originX = rows * config.cellWidth / 2 + config.cellWidth / 2;
  const originY = config.cellHeight / 2;
  const topLeft = (tileX, tileY) => ({
    x: Math.round(originX + (tileX - tileY) * config.cellWidth / 2 - config.cellWidth / 2),
    y: Math.round(originY + (tileX + tileY) * config.cellHeight / 2 - config.cellHeight / 2),
  });
  for (let diagonal = 0; diagonal <= columns + rows - 2; diagonal += 1) {
    for (let tileY = 0; tileY < rows; tileY += 1) {
      const tileX = diagonal - tileY;
      if (tileX < 0 || tileX >= columns) continue;
      const semantic = tileSemantic(tileX, tileY);
      const position = topLeft(tileX, tileY);
      const overlay = assets[quality].semantics[semantic];
      for (let y = 0; y < config.cellHeight; y += 1) for (let x = 0; x < config.cellWidth; x += 1) {
        if (!insideDiamond(x, y, config.cellWidth, config.cellHeight)) continue;
        const tx = position.x + x; const ty = position.y + y;
        if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
        const fieldX = ((position.x + x) % config.field + config.field) % config.field;
        const fieldY = ((position.y + y) % config.field + config.field) % config.field;
        const under = get(assets[quality].undercoat, fieldX, fieldY);
        const over = get(overlay, fieldX, fieldY);
        put(image, tx, ty, mix(under, over, over[3] / 255), 255);
      }
    }
  }
  const neighbor = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
  for (let tileY = 0; tileY < rows; tileY += 1) for (let tileX = 0; tileX < columns; tileX += 1) {
    if (tileSemantic(tileX, tileY) !== from) continue;
    const position = topLeft(tileX, tileY);
    const crossing = new Set();
    for (const direction of DIRECTIONS) {
      const [dx, dy] = neighbor[direction];
      const nx = tileX + dx; const ny = tileY + dy;
      if (nx < 0 || ny < 0 || nx >= columns || ny >= rows || tileSemantic(nx, ny) === from) continue;
      crossing.add(direction);
      blit(image, assets[quality].edges[pair][direction], position.x, position.y);
      used.add(`${quality}/edge-${pair}-${direction}.png`);
    }
    for (const corner of CORNERS) {
      const pairDirections = corner === "ne" ? ["n", "e"] : corner === "se" ? ["e", "s"] : corner === "sw" ? ["s", "w"] : ["w", "n"];
      if (!pairDirections.every((direction) => crossing.has(direction))) continue;
      blit(image, assets[quality].corners[pair][corner], position.x, position.y);
      used.add(`${quality}/corner-${pair}-${corner}.png`);
    }
  }
  return { image, used: [...used].sort(), boundary: "tile-snapped-straight-with-one-step" };
}

function writeEvidence(assets) {
  if (!EVIDENCE) return null;
  mkdirSync(EVIDENCE, { recursive: true });
  const generated = {};
  const writeProof = (name, image) => {
    const bytes = PNG.sync.write(image, { deflateLevel: 9, deflateStrategy: 0 });
    writeFileSync(path.join(EVIDENCE, name), bytes);
    generated[name] = { bytes: bytes.length, sha256: hashBytes(bytes), width: image.width, height: image.height };
  };
  writeProof("undercoat-30x30.png", proofCrop(assets.high.undercoat));
  for (const semantic of SEMANTICS) {
    writeProof(`semantic-${semantic}-30x30.png`, proofCrop(assets.high.undercoat, assets.high.semantics[semantic]));
  }

  const comparison = new PNG({ width: 3 * 192, height: SEMANTICS.length * 112 });
  comparison.data.fill(24);
  for (let column = 0; column < 3; column += 1) {
    const quality = ["high", "medium", "low"][column];
    for (let row = 0; row < SEMANTICS.length; row += 1) {
      const semantic = SEMANTICS[row];
      const composed = composite(assets[quality].undercoat, assets[quality].semantics[semantic]);
      for (let y = 0; y < 96; y += 1) for (let x = 0; x < 176; x += 1) {
        const sx = Math.round(x / 175 * (composed.width - 1));
        const sy = Math.round(y / 95 * (composed.height - 1));
        put(comparison, column * 192 + 8 + x, row * 112 + 8 + y, get(composed, sx, sy), 255);
      }
    }
  }
  writeProof("quality-high-medium-low.png", comparison);

  const proofSupport = {
    version: 2,
    rawAlphaProof: {
      sheet: "all-half-edges-and-corners.png",
      backing: "8px-neutral-checkerboard",
      opaqueDiamondBacking: false,
      displayed: [],
    },
    pairProof: {
      sheet: "semantic-pair-examples.png",
      boundary: "tile-snapped-straight-with-one-step",
      syntheticBoundary: false,
      assemblies: [],
    },
    canonicalAssembly: {
      sheet: "canonical-multicell-assembly.png",
      pair: "fairway--rough",
      quality: "medium",
      syntheticBoundary: false,
      assets: [],
    },
  };
  const edgeSheet = new PNG({ width: 4 * 272, height: PAIR_KEYS.length * 2 * 144 });
  edgeSheet.data.fill(28);
  for (let pairIndex = 0; pairIndex < PAIR_KEYS.length; pairIndex += 1) {
    const pair = PAIR_KEYS[pairIndex];
    for (let index = 0; index < DIRECTIONS.length; index += 1) {
      const direction = DIRECTIONS[index];
      const cell = checkerboard(256, 128);
      blit(cell, assets.high.edges[pair][direction], 0, 0);
      blit(edgeSheet, cell, index * 272 + 8, pairIndex * 288 + 8);
      const edgePath = `high/edge-${pair}-${direction}.png`;
      proofSupport.rawAlphaProof.displayed.push({ sourceAsset: edgePath, sha256: files[edgePath].sha256, row: pairIndex * 2, column: index });
      const corner = CORNERS[index];
      const cornerCell = checkerboard(256, 128);
      blit(cornerCell, assets.high.corners[pair][corner], 0, 0);
      blit(edgeSheet, cornerCell, index * 272 + 8, pairIndex * 288 + 152);
      const cornerPath = `high/corner-${pair}-${corner}.png`;
      proofSupport.rawAlphaProof.displayed.push({ sourceAsset: cornerPath, sha256: files[cornerPath].sha256, row: pairIndex * 2 + 1, column: index });
    }
  }
  writeProof("all-half-edges-and-corners.png", edgeSheet);

  const pairSheet = new PNG({ width: 5 * 400, height: 2 * 208 });
  pairSheet.data.fill(28);
  for (let index = 0; index < PAIR_KEYS.length; index += 1) {
    const pair = PAIR_KEYS[index];
    const assembly = buildPairAssembly(assets, pair, "low");
    blit(pairSheet, assembly.image, (index % 5) * 400 + 8, Math.floor(index / 5) * 208 + 8);
    proofSupport.pairProof.assemblies.push({
      pair,
      quality: "low",
      boundary: assembly.boundary,
      sourceAssets: assembly.used.map((sourceAsset) => ({ sourceAsset, sha256: files[sourceAsset].sha256 })),
    });
  }
  writeProof("semantic-pair-examples.png", pairSheet);

  const canonical = buildPairAssembly(assets, "fairway--rough", "medium", 5, 5);
  proofSupport.canonicalAssembly.assets = canonical.used.map((sourceAsset) => ({ sourceAsset, sha256: files[sourceAsset].sha256 }));
  writeProof("canonical-multicell-assembly.png", canonical.image);

  const hazardSheet = new PNG({ width: 4 * 272, height: 144 });
  hazardSheet.data.fill(28);
  for (let index = 0; index < HAZARDS.length; index += 1) {
    blit(hazardSheet, assets.high.hazards[HAZARDS[index]], index * 272 + 8, 8);
  }
  writeProof("hazard-primitives.png", hazardSheet);

  const paletteProof = (modes) => {
    const image = new PNG({ width: SEMANTICS.length * 128, height: modes.length * 96 });
    image.data.fill(24);
    for (let row = 0; row < modes.length; row += 1) for (let column = 0; column < SEMANTICS.length; column += 1) {
      const semantic = SEMANTICS[column];
      const color = PALETTES[modes[row]][semantic];
      for (let y = 8; y < 88; y += 1) for (let x = 8; x < 120; x += 1) {
        const u = x / 112; const v = y / 80;
        const signal = semanticSignal(semantic, u, v, "high");
        put(image, column * 128 + x, row * 96 + y, shade(color, signal.shade), 255);
      }
    }
    return image;
  };
  writeProof("palette-standard.png", paletteProof(["standard"]));
  writeProof("palette-accessibility.png", paletteProof(["deuteranopia", "protanopia", "tritanopia"]));

  const proofSupportText = `${JSON.stringify(proofSupport, null, 2)}\n`;
  writeFileSync(path.join(EVIDENCE, "proof-support.json"), proofSupportText);
  generated["proof-support.json"] = {
    bytes: Buffer.byteLength(proofSupportText), sha256: hashBytes(Buffer.from(proofSupportText)), kind: "proof-support-audit",
  };

  const command = [
    "# ZK-463 deterministic proof generation",
    `cd ${ROOT}`,
    `COURSECRAFT_COMPOSABLE_OUTPUT_DIR=${OUTPUT} COURSECRAFT_COMPOSABLE_EVIDENCE_DIR=${EVIDENCE} node scripts/gen-parkland-composable-assets.mjs`,
    `COURSECRAFT_COMPOSABLE_EVIDENCE_DIR=${EVIDENCE} node --test scripts/parkland-composable-asset-audit.test.mjs`,
    `COURSECRAFT_COMPOSABLE_EVIDENCE_DIR=${EVIDENCE} node scripts/parkland-composable-asset-audit.mjs`,
    `COURSECRAFT_COMPOSABLE_OUTPUT_DIR=${EVIDENCE}/repeatability/root-a node scripts/gen-parkland-composable-assets.mjs`,
    `COURSECRAFT_COMPOSABLE_OUTPUT_DIR=${EVIDENCE}/repeatability/root-b node scripts/gen-parkland-composable-assets.mjs`,
    `diff -rq ${EVIDENCE}/repeatability/root-a ${EVIDENCE}/repeatability/root-b`,
    `shasum -a 256 ${EVIDENCE}/repeatability/root-a/manifest.json ${EVIDENCE}/repeatability/root-b/manifest.json`,
    "npm run audit:terrain:parkland-4x",
    "npm run test:terrain:parkland-4x",
    "npm run audit:m35-assets",
    "npm run test:surface-residency",
    "node --test scripts/zk680-delivery-evidence.test.mjs",
    "npm run lint",
    "npm run build",
    "npm run test:ci",
    "",
  ].join("\n");
  writeFileSync(path.join(EVIDENCE, "commands.txt"), command);
  generated["commands.txt"] = {
    bytes: Buffer.byteLength(command), sha256: hashBytes(Buffer.from(command)), kind: "command-log",
  };
  const evidenceManifest = {
    version: 1,
    id: "zk463-composable-parkland-static-proof",
    generatedBy: "scripts/gen-parkland-composable-assets.mjs",
    sourceManifestSha256: hashBytes(readFileSync(path.join(OUTPUT, "manifest.json"))),
    files: generated,
  };
  writeFileSync(path.join(EVIDENCE, "evidence-manifest.json"), `${JSON.stringify(evidenceManifest, null, 2)}\n`);
  return evidenceManifest;
}

function assertSafeOutput(target) {
  const relative = path.relative(path.parse(target).root, target);
  if (!relative || relative.split(path.sep).length < 3) throw new Error(`refusing unsafe output path: ${target}`);
}

assertSafeOutput(OUTPUT);
rmSync(OUTPUT, { recursive: true, force: true });
mkdirSync(OUTPUT, { recursive: true });

const files = {};
const assets = {};
for (const [quality, config] of Object.entries(QUALITIES)) {
  const undercoat = makeUndercoat(config.field);
  save(`${quality}/undercoat.png`, undercoat, {
    role: "common-undercoat", quality, worldPeriodTiles: WORLD_PERIOD_TILES,
    logicalAnchor: { x: 0, y: 0 }, intendedOpacity: 255,
  }, files);
  const semantics = {};
  for (const semantic of SEMANTICS) {
    semantics[semantic] = makeSemantic(config.field, semantic, quality);
    save(`${quality}/semantic-${semantic}.png`, semantics[semantic], {
      role: "semantic-cue", semantic, quality, worldPeriodTiles: WORLD_PERIOD_TILES,
      phase: "parkland-common-phase-v1", pattern: PATTERNS[semantic], intendedOpacityRange: alphaRange(semantics[semantic]),
    }, files);
  }
  const edges = {}; const corners = {};
  for (const pair of PAIR_KEYS) {
    edges[pair] = {}; corners[pair] = {};
    const canonicalEdge = makeCanonicalEdge(config.cellWidth, config.cellHeight, pair, quality);
    const edgeTransforms = { n: "identity", e: "flip-y", s: "rotate-180", w: "flip-x" };
    for (const direction of DIRECTIONS) {
      const image = direction === "n" ? canonicalEdge : transform(canonicalEdge, edgeTransforms[direction]);
      edges[pair][direction] = image;
      save(`${quality}/edge-${pair}-${direction}.png`, image, {
        role: "pair-half-edge", pair, direction, quality, transformFromNorth: edgeTransforms[direction],
        logicalAnchor: { x: config.cellWidth / 2, y: config.cellHeight / 2 },
        clipBounds: alphaBounds(image), intendedOpacity: { maximum: alphaMaximum(image), bands: [216, 196, 170, 132] },
      }, files);
    }
    const canonicalCorner = makeCanonicalCorner(config.cellWidth, config.cellHeight, pair, quality);
    const cornerTransforms = { ne: "identity", se: "iso-rotate-90", sw: "rotate-180", nw: "iso-rotate-270" };
    for (const corner of CORNERS) {
      const image = corner === "ne" ? canonicalCorner : transform(canonicalCorner, cornerTransforms[corner]);
      corners[pair][corner] = image;
      save(`${quality}/corner-${pair}-${corner}.png`, image, {
        role: "pair-corner", pair, corner, quality, transformFromNorthEast: cornerTransforms[corner],
        compatibleEdges: corner === "ne" ? ["n", "e"] : corner === "se" ? ["e", "s"] : corner === "sw" ? ["s", "w"] : ["w", "n"],
        logicalAnchor: { x: config.cellWidth / 2, y: config.cellHeight / 2 },
        clipBounds: alphaBounds(image), intendedOpacity: { maximum: alphaMaximum(image), bands: [198, 178, 152, 118] },
      }, files);
    }
  }
  const hazards = {};
  for (const hazard of HAZARDS) {
    hazards[hazard] = makeHazard(config.cellWidth, config.cellHeight, hazard);
    save(`${quality}/hazard-${hazard}.png`, hazards[hazard], {
      role: "hazard-style-proof", hazard, quality,
      topologyAuthority: "proof-only-not-a-gameplay-mask",
      logicalAnchor: { x: config.cellWidth / 2, y: config.cellHeight / 2 },
      clipBounds: alphaBounds(hazards[hazard]),
    }, files);
  }
  assets[quality] = { undercoat, semantics, edges, corners, hazards };
}

const manifest = {
  version: VERSION,
  id: "parkland-composable-material-source-v1",
  contract: "../contracts/parkland-composable-v1.json",
  generatedBy: "scripts/gen-parkland-composable-assets.mjs",
  algorithm: "coursecraft-toroidal-stamps-and-crisp-multiband-half-edge-v2",
  hashAlgorithm: "sha256",
  provenance: {
    author: "CourseCraft", externalProvider: "none", referencePixelsCopied: false,
    sourceKind: "deterministic-procedural-original",
  },
  phase: {
    id: "parkland-common-phase-v1", worldPeriodTiles: WORLD_PERIOD_TILES,
    origin: { tileX: 0, tileY: 0 }, wrap: "byte-identical-opposite-borders",
  },
  vocabulary: { semantics: SEMANTICS, pairs: PAIR_KEYS, directions: DIRECTIONS, corners: CORNERS, hazards: HAZARDS },
  palettes: PALETTES,
  patterns: PATTERNS,
  qualities: QUALITIES,
  atlas: { gutterPx: 2, lossless: true, scaleByQuality: Object.fromEntries(Object.entries(QUALITIES).map(([name, value]) => [name, value.scale])) },
  files,
};
writeFileSync(path.join(OUTPUT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
const totalBytes = Object.keys(files).reduce((total, relativePath) => total + statSync(path.join(OUTPUT, relativePath)).size, 0)
  + statSync(path.join(OUTPUT, "manifest.json")).size;
writeEvidence(assets);
console.log(`wrote ${Object.keys(files).length} deterministic Parkland composable assets (${totalBytes} bytes) to ${OUTPUT}`);
