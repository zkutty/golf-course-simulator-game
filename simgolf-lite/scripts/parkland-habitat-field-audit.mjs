import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ASSET_ROOT = path.join(ROOT, "src/assets/terrain/parkland-habitat-4x");
const CONTRACT_PATH = path.join(ROOT, "src/assets/terrain/contracts/parkland-habitat-field-v1.json");
const GENERATOR_PATH = path.join(ROOT, "scripts/gen-parkland-habitat-field.mjs");
const FAMILIES = ["woodland_floor", "understory_edge", "meadow_deep_rough_margin", "wet_shore", "rock_leaf_transition"];
const DENSE_MASK_FAMILIES = new Set(["woodland_floor", "understory_edge"]);
const CANONICAL_MASKS = [0, 1, 5, 7, 17, 21, 23, 31, 85, 87, 95, 119, 127, 255];
const D4_TRANSFORMS = [
  "identity", "rotate90", "rotate180", "rotate270",
  "reflectX", "reflectXRotate90", "reflectXRotate180", "reflectXRotate270",
];
const MASK_BITS = { n: 1, e: 4, s: 16, w: 64 };
const FRAME_COUNT = 89;
const MODES = ["standard", "deuteranopia", "protanopia", "tritanopia"];
const TIERS = {
  high: { width: 256, height: 128, gutter: 4, scale: 4 },
  medium: { width: 128, height: 64, gutter: 2, scale: 2 },
  low: { width: 64, height: 32, gutter: 1, scale: 1 },
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const at = (image, x, y) => (y * image.width + x) * 4;
const pixel = (image, x, y) => image.data.subarray(at(image, x, y), at(image, x, y) + 4);
const equalPixel = (a, b) => a.every((value, index) => value === b[index]);

function frameRegion(image, frame) {
  const bytes = Buffer.alloc(frame.width * frame.height * 4); let cursor = 0;
  for (let y = 0; y < frame.height; y += 1) for (let x = 0; x < frame.width; x += 1) {
    const source = at(image, frame.x + x, frame.y + y);
    for (let channel = 0; channel < 4; channel += 1) bytes[cursor++] = image.data[source + channel];
  }
  return bytes;
}

function edgeHasAlpha(image, frame, edge) {
  const band = Math.max(2, Math.floor(Math.min(frame.width, frame.height) * 0.12));
  for (let y = 0; y < frame.height; y += 1) for (let x = 0; x < frame.width; x += 1) {
    const relevant = edge === "n" ? y < band : edge === "s" ? y >= frame.height - band : edge === "w" ? x < band : x >= frame.width - band;
    if (relevant && image.data[at(image, frame.x + x, frame.y + y) + 3] > 0) return true;
  }
  return false;
}

function worldEdgeHasAlpha(image, frame, edge) {
  const radius = Math.max(2, Math.floor(Math.min(frame.width, frame.height) * 0.04));
  for (const tangent of [-0.18, 0, 0.18]) {
    const world = edge === "n" ? { x: tangent, y: -0.5 }
      : edge === "e" ? { x: 0.5, y: tangent }
        : edge === "s" ? { x: tangent, y: 0.5 }
          : { x: -0.5, y: tangent };
    const screenX = world.x - world.y;
    const screenY = world.x + world.y;
    const centerX = Math.round((0.5 + screenX / 2) * (frame.width - 1));
    const centerY = Math.round((0.5 + screenY / 2) * (frame.height - 1));
    let visible = false;
    for (let dy = -radius; dy <= radius && !visible; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
      const x = centerX + dx; const y = centerY + dy;
      if (x >= 0 && y >= 0 && x < frame.width && y < frame.height
        && image.data[at(image, frame.x + x, frame.y + y) + 3] > 0) { visible = true; break; }
    }
    if (!visible) return false;
  }
  return true;
}

function outsideDiamondAlphaCount(region, width, height) {
  let outside = 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const screenX = (((x + 0.5) / width) - 0.5) * 2;
    const screenY = (((y + 0.5) / height) - 0.5) * 2;
    const worldX = (screenX + screenY) / 2;
    const worldY = (screenY - screenX) / 2;
    if ((Math.abs(worldX) > 0.5 || Math.abs(worldY) > 0.5) && region[(y * width + x) * 4 + 3] > 0) outside += 1;
  }
  return outside;
}

function expectedFrameIds() {
  const ids = [];
  for (const family of FAMILIES) {
    if (DENSE_MASK_FAMILIES.has(family)) {
      for (const mask of CANONICAL_MASKS) {
        const variants = mask === 255 ? [0, 1, 2] : [0];
        for (const variant of variants) ids.push(`${family}--mask-${mask.toString(16).padStart(2, "0")}-${variant}`);
      }
      continue;
    }
    for (let variant = 0; variant < 3; variant += 1) ids.push(`${family}--interior-${variant}`);
    for (const direction of ["n", "e", "s", "w"]) ids.push(`${family}--boundary-${direction}`);
    for (const corner of ["ne", "se", "sw", "nw"]) ids.push(`${family}--convex-${corner}`);
    for (const corner of ["ne", "se", "sw", "nw"]) ids.push(`${family}--concave-${corner}`);
    for (const direction of ["n", "e", "s", "w"]) ids.push(`${family}--termination-${direction}`);
  }
  return ids.sort();
}

function validateGutters(image, descriptor, gutter, errors, label) {
  const { x, y, width, height } = descriptor;
  for (let gy = -gutter; gy < height + gutter; gy += 1) for (let gx = -gutter; gx < width + gutter; gx += 1) {
    if (gx >= 0 && gx < width && gy >= 0 && gy < height) continue;
    const actual = pixel(image, x + gx, y + gy);
    const expected = pixel(image, x + Math.max(0, Math.min(width - 1, gx)), y + Math.max(0, Math.min(height - 1, gy)));
    if (!equalPixel(actual, expected)) { errors.push(`${label} has a non-extruded gutter at ${gx},${gy}`); return; }
  }
}

function paletteDistance(a, b) { return Math.sqrt(a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0)); }
function rgbKey(color) { return color.join(","); }
function validRgb(color) { return Array.isArray(color) && color.length === 3 && color.every((value) => Number.isInteger(value) && value >= 0 && value <= 255); }
function rgbLuma(color) { return 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]; }
function centroid(colors) { return [0, 1, 2].map((channel) => colors.reduce((sum, color) => sum + color[channel], 0) / colors.length); }

export function auditParklandHabitat({ assetRoot = DEFAULT_ASSET_ROOT } = {}) {
  const errors = []; const report = { ok: false, assetRoot, tiers: {}, paletteTransforms: {}, errors };
  const require = (condition, message) => { if (!condition) errors.push(message); };
  let contract; let manifest;
  try { contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8")); } catch (error) { errors.push(`contract unreadable: ${error.message}`); return report; }
  try { manifest = JSON.parse(readFileSync(path.join(assetRoot, "manifest.json"), "utf8")); } catch (error) { errors.push(`manifest unreadable: ${error.message}`); return report; }
  require(contract.schema === "ParklandHabitatFieldManifestV1", "contract schema must be ParklandHabitatFieldManifestV1");
  require(manifest.schema === "ParklandHabitatFieldManifestV1" && manifest.version === 1, "manifest schema/version mismatch");
  require(manifest.source?.author === "CourseCraft" && manifest.source?.externalProvider === "none", "provenance must name CourseCraft and no external provider");
  require(manifest.source?.referencePixelsCopied === false && manifest.source?.license === "project-original", "provenance must prohibit copied reference pixels");
  require(manifest.authority?.visualOnly === true && Object.entries(manifest.authority).filter(([key]) => key !== "visualOnly" && key !== "treeSpritesRemainAuthoritative").every(([, value]) => value === false), "habitat must remain visual-only without gameplay authority");
  require(manifest.authority?.treeSpritesRemainAuthoritative === true, "real tree sprites must remain authoritative");
  const sourceHash = sha256(Buffer.concat([readFileSync(CONTRACT_PATH), readFileSync(GENERATOR_PATH)]));
  require(manifest.source?.sha256 === sourceHash, "source hash does not match contract plus generator");
  const manifestBytes = readFileSync(path.join(assetRoot, "manifest.json"));
  const sidecar = readFileSync(path.join(assetRoot, "manifest.sha256"), "utf8").trim();
  require(sidecar === `${sha256(manifestBytes)}  manifest.json`, "manifest SHA-256 sidecar mismatch");
  require(JSON.stringify([...manifest.vocabulary.families].sort()) === JSON.stringify([...FAMILIES].sort()), "semantic family vocabulary mismatch");
  require(manifest.vocabulary.revision === 2, "topology vocabulary revision must be 2");
  require(JSON.stringify([...manifest.vocabulary.topologyRoles].sort()) === JSON.stringify(["boundary", "concave", "convex", "interior", "mask", "termination"]), "topology role vocabulary mismatch");
  require(JSON.stringify(manifest.vocabulary.denseMaskFamilies) === JSON.stringify([...DENSE_MASK_FAMILIES]), "dense-mask family vocabulary mismatch");
  require(JSON.stringify(manifest.vocabulary.canonicalMasks) === JSON.stringify(CANONICAL_MASKS), "canonical-mask vocabulary mismatch");
  require(contract.topology?.revision === manifest.vocabulary.revision, "contract and manifest topology revisions must agree");
  require(JSON.stringify([...(contract.topology?.roles ?? [])].sort()) === JSON.stringify([...manifest.vocabulary.topologyRoles].sort()), "contract and manifest topology roles must agree");
  require(JSON.stringify(contract.topology?.denseMaskFamilies) === JSON.stringify(manifest.vocabulary.denseMaskFamilies), "contract and manifest dense-mask families must agree");
  require(contract.topology?.normalizedMaskCount === 47 && manifest.vocabulary.normalizedMaskCount === 47, "contract and manifest must declare 47 normalized masks");
  require(JSON.stringify(contract.topology?.canonicalMasks) === JSON.stringify(manifest.vocabulary.canonicalMasks), "contract and manifest canonical-mask classes must agree");
  require(JSON.stringify(contract.topology?.d4Transforms) === JSON.stringify(manifest.vocabulary.d4Transforms)
    && JSON.stringify(manifest.vocabulary.d4Transforms) === JSON.stringify(D4_TRANSFORMS), "contract and manifest D4 transforms must agree");
  require(Object.keys(manifest.vocabulary.patterns).length === FAMILIES.length && new Set(Object.values(manifest.vocabulary.patterns)).size === FAMILIES.length, "each family requires a unique non-color pattern identity");
  const paletteMaps = {}; const coverage = {};
  require(JSON.stringify(Object.keys(manifest.paletteTransforms ?? {}).sort()) === JSON.stringify([...MODES].sort()), "palette transforms must contain exactly standard, deuteranopia, protanopia, and tritanopia");
  for (const mode of MODES) {
    paletteMaps[mode] = {}; coverage[mode] = {};
    const modeFamilies = manifest.paletteTransforms?.[mode] ?? {};
    require(JSON.stringify(Object.keys(modeFamilies).sort()) === JSON.stringify([...FAMILIES].sort()), `${mode} transform must cover every family`);
    const centroids = {}; let mappedSourceColors = 0; let minimumMappedColorDistance = Number.POSITIVE_INFINITY;
    for (const family of FAMILIES) {
      const transform = modeFamilies[family]; const mappings = transform?.mappings;
      require(transform?.patternId === manifest.vocabulary.patterns[family], `${mode}/${family} must preserve its non-color pattern identity`);
      require(Array.isArray(mappings) && mappings.length === 4, `${mode}/${family} must map exactly four source colors`);
      const map = new Map(); const targets = [];
      for (const mapping of Array.isArray(mappings) ? mappings : []) {
        require(validRgb(mapping?.from) && validRgb(mapping?.to), `${mode}/${family} contains an invalid RGB mapping`);
        if (!validRgb(mapping?.from) || !validRgb(mapping?.to)) continue;
        const key = rgbKey(mapping.from);
        require(!map.has(key), `${mode}/${family} repeats source color ${key}`);
        map.set(key, mapping.to); targets.push(mapping.to); mappedSourceColors += 1;
        require(rgbLuma(mapping.to) >= contract.palette.minimumMappedLuma, `${mode}/${family} maps ${key} to collapsed [${mapping.to.join(",")}]`);
        if (mode === "standard") require(key === rgbKey(mapping.to), `standard/${family} must map each source color to itself`);
      }
      require(new Set(targets.map(rgbKey)).size === 4, `${mode}/${family} mapped colors must remain distinct`);
      for (let a = 0; a < targets.length; a += 1) for (let b = a + 1; b < targets.length; b += 1) {
        const distance = paletteDistance(targets[a], targets[b]); minimumMappedColorDistance = Math.min(minimumMappedColorDistance, distance);
        require(distance >= contract.palette.minimumMappedColorDistance, `${mode}/${family} mapped colors are indistinguishable (${distance.toFixed(2)})`);
      }
      if (targets.length) centroids[family] = centroid(targets);
      paletteMaps[mode][family] = map;
    }
    let minimumFamilyCentroidDistance = Number.POSITIVE_INFINITY;
    for (let a = 0; a < FAMILIES.length; a += 1) for (let b = a + 1; b < FAMILIES.length; b += 1) {
      if (!centroids[FAMILIES[a]] || !centroids[FAMILIES[b]]) continue;
      const distance = paletteDistance(centroids[FAMILIES[a]], centroids[FAMILIES[b]]);
      minimumFamilyCentroidDistance = Math.min(minimumFamilyCentroidDistance, distance);
      require(distance >= contract.palette.minimumModeFamilyCentroidDistance, `${mode} semantic families ${FAMILIES[a]} and ${FAMILIES[b]} are indistinguishable (${distance.toFixed(2)})`);
    }
    report.paletteTransforms[mode] = { families: Object.keys(modeFamilies).length, mappedSourceColors, minimumMappedColorDistance, minimumFamilyCentroidDistance, tiers: coverage[mode] };
  }
  let totalAtlasBytes = 0; const expectedIds = expectedFrameIds();
  for (const [tier, expected] of Object.entries(TIERS)) {
    for (const mode of MODES) coverage[mode][tier] = { coveredFrames: 0, totalFrames: FRAME_COUNT, missingSourceColors: [] };
    const descriptor = manifest.tiers?.[tier];
    require(Boolean(descriptor), `${tier} tier missing`); if (!descriptor) continue;
    let atlas; let atlasJson;
    try { atlas = PNG.sync.read(readFileSync(path.join(assetRoot, descriptor.image))); } catch (error) { errors.push(`${tier} atlas unreadable: ${error.message}`); continue; }
    try { atlasJson = JSON.parse(readFileSync(path.join(assetRoot, descriptor.json), "utf8")); } catch (error) { errors.push(`${tier} atlas JSON unreadable: ${error.message}`); continue; }
    const imageBytes = readFileSync(path.join(assetRoot, descriptor.image)); const jsonBytes = readFileSync(path.join(assetRoot, descriptor.json));
    totalAtlasBytes += imageBytes.length;
    require(descriptor.imageSha256 === sha256(imageBytes) && descriptor.jsonSha256 === sha256(jsonBytes), `${tier} atlas file hash mismatch`);
    require(descriptor.imageBytes === imageBytes.length && descriptor.jsonBytes === jsonBytes.length, `${tier} atlas byte metadata mismatch`);
    require(atlas.width === descriptor.width && atlas.height === descriptor.height && atlas.width <= 4096 && atlas.height <= 4096, `${tier} atlas dimensions invalid`);
    require(descriptor.frameWidth === expected.width && descriptor.frameHeight === expected.height && descriptor.gutterPx === expected.gutter && descriptor.scale === expected.scale, `${tier} frame/gutter/scale contract mismatch`);
    require(imageBytes.length <= contract.budgets.atlasBytesMaxPerTier, `${tier} atlas exceeds byte budget`);
    require(atlas.width * atlas.height * 4 <= contract.budgets.selectedTierDecodedBytesMax, `${tier} atlas exceeds decoded residency budget`);
    const ids = Object.keys(atlasJson.frames ?? {}).sort();
    require(JSON.stringify(ids) === JSON.stringify(expectedIds), `${tier} frame IDs do not match the ${FRAME_COUNT}-frame vocabulary`);
    require(atlasJson.frameCount === FRAME_COUNT && descriptor.frameCount === FRAME_COUNT, `${tier} must expose ${FRAME_COUNT} frames`);
    const seen = new Map(); let minCoverage = 1; let maxCoverage = 0; let maxOutsideDiamondAlphaPixels = 0;
    for (const id of ids) {
      const frame = atlasJson.frames[id]; const manifestFrame = descriptor.frames[id];
      require(JSON.stringify(frame) === JSON.stringify(manifestFrame), `${tier}/${id} differs between atlas and manifest`);
      const region = frameRegion(atlas, frame.frame); const hash = sha256(region);
      require(hash === frame.sourceSha256, `${tier}/${id} frame hash mismatch`);
      if (seen.has(hash)) errors.push(`${tier}/${id} duplicates visible frame ${seen.get(hash)}`); else seen.set(hash, id);
      let visible = 0; let transparentRgb = 0;
      const visibleColors = new Set();
      for (let index = 0; index < region.length; index += 4) {
        if (region[index + 3] > 0) { visible += 1; visibleColors.add(`${region[index]},${region[index + 1]},${region[index + 2]}`); }
        else if (region[index] || region[index + 1] || region[index + 2]) transparentRgb += 1;
      }
      for (const mode of MODES) {
        const map = paletteMaps[mode]?.[frame.family] ?? new Map();
        const missing = [...visibleColors].filter((color) => !map.has(color));
        if (missing.length === 0) coverage[mode][tier].coveredFrames += 1;
        else {
          for (const color of missing) if (!coverage[mode][tier].missingSourceColors.includes(`${frame.family}:${color}`)) coverage[mode][tier].missingSourceColors.push(`${frame.family}:${color}`);
          require(false, `${mode}/${tier}/${frame.family} transform is missing source colors: ${missing.join(" ")}`);
        }
      }
      const alphaCoverage = visible / (frame.frame.width * frame.frame.height);
      minCoverage = Math.min(minCoverage, alphaCoverage); maxCoverage = Math.max(maxCoverage, alphaCoverage);
      require(alphaCoverage >= 0.004 && alphaCoverage <= 0.72, `${tier}/${id} alpha coverage ${alphaCoverage.toFixed(4)} is outside sparse-field bounds`);
      require(transparentRgb === 0, `${tier}/${id} has RGB data in transparent pixels`);
      require(frame.anchor?.x === expected.width / 2 && frame.anchor?.y === expected.height / 2, `${tier}/${id} logical anchor mismatch`);
      require(Array.isArray(frame.edgeAnchors), `${tier}/${id} requires an edge-anchor array`);
      if (DENSE_MASK_FAMILIES.has(frame.family)) {
        const outsideAlphaPixels = outsideDiamondAlphaCount(region, frame.frame.width, frame.frame.height);
        maxOutsideDiamondAlphaPixels = Math.max(maxOutsideDiamondAlphaPixels, outsideAlphaPixels);
        require(outsideAlphaPixels === 0, `${tier}/${id} has ${outsideAlphaPixels} visible pixels outside its projected tile diamond`);
        require(CANONICAL_MASKS.includes(frame.canonicalMask), `${tier}/${id} has invalid canonical-mask metadata`);
        const expectedEdges = Object.entries(MASK_BITS).filter(([, bit]) => (frame.canonicalMask & bit) !== 0).map(([edge]) => edge).sort();
        require(JSON.stringify([...frame.edgeAnchors].sort()) === JSON.stringify(expectedEdges), `${tier}/${id} edge anchors do not match canonical mask`);
        for (const edge of frame.edgeAnchors) require(worldEdgeHasAlpha(atlas, frame.frame, edge), `${tier}/${id} lacks pixels at declared world ${edge} anchor`);
      } else {
        require(frame.canonicalMask === null, `${tier}/${id} reduced frame must not declare a canonical mask`);
        require(frame.edgeAnchors.length > 0, `${tier}/${id} requires topology anchors`);
        for (const edge of frame.edgeAnchors) require(edgeHasAlpha(atlas, frame.frame, edge), `${tier}/${id} lacks pixels at declared ${edge} anchor`);
      }
      validateGutters(atlas, frame.frame, expected.gutter, errors, `${tier}/${id}`);
    }
    report.tiers[tier] = { frames: ids.length, imageBytes: imageBytes.length, jsonBytes: jsonBytes.length, decodedBytes: atlas.width * atlas.height * 4, minCoverage, maxCoverage, maxOutsideDiamondAlphaPixels, uniqueFrameHashes: seen.size };
  }
  for (const mode of MODES) for (const tier of Object.keys(TIERS)) require(coverage[mode][tier].coveredFrames === FRAME_COUNT, `${mode}/${tier} palette coverage is ${coverage[mode][tier].coveredFrames}/${FRAME_COUNT} frames`);
  require(totalAtlasBytes <= contract.budgets.totalAtlasBytesMax, "combined atlas bytes exceed budget");
  const proof = manifest.proof; let proofImage;
  try { proofImage = PNG.sync.read(readFileSync(path.join(assetRoot, proof.file))); } catch (error) { errors.push(`proof board unreadable: ${error.message}`); }
  if (proofImage) {
    const proofBytes = readFileSync(path.join(assetRoot, proof.file));
    require(proof.label === contract.proof.label, "proof board must carry the non-ZK-473 label");
    require(proofImage.width === 1440 && proofImage.height === 900, "proof board must be normal-size 1440x900");
    require(proof.sha256 === sha256(proofBytes) && proof.bytes === proofBytes.length, "proof board hash/bytes mismatch");
  }
  const files = [];
  function walk(directory, prefix = "") { for (const entry of readdirSync(directory, { withFileTypes: true })) { const relative = path.join(prefix, entry.name); if (entry.isDirectory()) walk(path.join(directory, entry.name), relative); else files.push(relative); } }
  walk(assetRoot);
  const sourceBytes = files.reduce((total, relative) => total + statSync(path.join(assetRoot, relative)).size, 0);
  require(files.length <= contract.budgets.fileCountMax, `source file count ${files.length} exceeds ${contract.budgets.fileCountMax}`);
  require(sourceBytes <= contract.budgets.sourceBytesMax, `source bytes ${sourceBytes} exceed ${contract.budgets.sourceBytesMax}`);
  require(manifest.budgets.runtimeBytesAdded === 0 && manifest.rollback.legacy2xUnchanged === true && manifest.rollback.runtimeImportsAdded === 0, "runtime/legacy rollback contract changed");
  report.files = files.length; report.sourceBytes = sourceBytes; report.totalAtlasBytes = totalAtlasBytes; report.ok = errors.length === 0;
  return report;
}

function run() {
  const assetRoot = process.env.COURSECRAFT_HABITAT_OUTPUT_DIR ? path.resolve(process.env.COURSECRAFT_HABITAT_OUTPUT_DIR) : DEFAULT_ASSET_ROOT;
  const result = auditParklandHabitat({ assetRoot });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run();
