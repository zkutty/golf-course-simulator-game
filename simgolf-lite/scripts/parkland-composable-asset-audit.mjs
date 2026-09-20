import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT_PATH = "src/assets/terrain/contracts/parkland-composable-v1.json";
const SEMANTICS = ["fairway", "rough", "deep_rough", "green", "tee"];
const DIRECTIONS = ["n", "e", "s", "w"];
const CORNERS = ["ne", "se", "sw", "nw"];
const HAZARDS = ["water", "sand", "bunker", "shore"];
const QUALITIES = ["high", "medium", "low"];
const PAIRS = [];
for (let a = 0; a < SEMANTICS.length; a += 1) {
  for (let b = a + 1; b < SEMANTICS.length; b += 1) PAIRS.push(`${SEMANTICS[a]}--${SEMANTICS[b]}`);
}
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const luma = (pixel) => 0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2];
const offset = (image, x, y) => (y * image.width + x) * 4;
const pixel = (image, x, y) => image.data.subarray(offset(image, x, y), offset(image, x, y) + 4);
const alphaAt = (image, x, y) => image.data[offset(image, x, y) + 3];

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

function readJson(file, label, errors) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (error) {
    errors.push(`${label} is not readable JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function expectedPaths() {
  const result = [];
  for (const quality of QUALITIES) {
    result.push(`${quality}/undercoat.png`);
    for (const semantic of SEMANTICS) result.push(`${quality}/semantic-${semantic}.png`);
    for (const pair of PAIRS) {
      for (const direction of DIRECTIONS) result.push(`${quality}/edge-${pair}-${direction}.png`);
      for (const corner of CORNERS) result.push(`${quality}/corner-${pair}-${corner}.png`);
    }
    for (const hazard of HAZARDS) result.push(`${quality}/hazard-${hazard}.png`);
  }
  return result.sort();
}

function listPngs(root) {
  const result = [];
  for (const quality of readdirSync(root, { withFileTypes: true })) {
    if (!quality.isDirectory()) continue;
    for (const entry of readdirSync(path.join(root, quality.name), { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".png")) result.push(`${quality.name}/${entry.name}`);
    }
  }
  return result.sort();
}

function readPng(file, label, errors) {
  try { return PNG.sync.read(readFileSync(file)); }
  catch (error) {
    errors.push(`${label} is not a readable PNG: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function oppositeBorderDelta(image) {
  let maximum = 0;
  for (let y = 0; y < image.height; y += 1) for (let channel = 0; channel < 4; channel += 1) {
    maximum = Math.max(maximum, Math.abs(pixel(image, 0, y)[channel] - pixel(image, image.width - 1, y)[channel]));
  }
  for (let x = 0; x < image.width; x += 1) for (let channel = 0; channel < 4; channel += 1) {
    maximum = Math.max(maximum, Math.abs(pixel(image, x, 0)[channel] - pixel(image, x, image.height - 1)[channel]));
  }
  return maximum;
}

function checkerboardScore(image, composedUndercoat = null) {
  let signed = 0; let count = 0;
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    let value;
    const over = pixel(image, x, y);
    if (composedUndercoat) {
      const under = pixel(composedUndercoat, x, y);
      const alpha = over[3] / 255;
      value = luma([
        under[0] * (1 - alpha) + over[0] * alpha,
        under[1] * (1 - alpha) + over[1] * alpha,
        under[2] * (1 - alpha) + over[2] * alpha,
      ]);
    } else value = luma(over);
    signed += value * ((x + y) % 2 === 0 ? 1 : -1);
    count += 1;
  }
  return Math.abs(signed / count);
}

function composeMetrics(undercoat, semantic, periodTiles) {
  let lumaTotal = 0; const rgbTotal = [0, 0, 0]; let count = 0; let alphaCracks = 0;
  const compositeLuma = new Float64Array(undercoat.width * undercoat.height);
  for (let y = 0; y < undercoat.height; y += 1) for (let x = 0; x < undercoat.width; x += 1) {
    const under = pixel(undercoat, x, y); const over = pixel(semantic, x, y);
    const alpha = over[3] / 255;
    const rgb = [0, 1, 2].map((channel) => under[channel] * (1 - alpha) + over[channel] * alpha);
    if (under[3] !== 255) alphaCracks += 1;
    const value = luma(rgb);
    compositeLuma[y * undercoat.width + x] = value;
    lumaTotal += value;
    for (let channel = 0; channel < 3; channel += 1) rgbTotal[channel] += rgb[channel];
    count += 1;
  }
  const tileWidth = (undercoat.width - 1) / periodTiles;
  const tileHeight = (undercoat.height - 1) / periodTiles;
  let boundaryDelta = 0; let boundarySamples = 0;
  for (let boundary = 1; boundary < periodTiles; boundary += 1) {
    const x = Math.round(boundary * tileWidth);
    for (let y = 0; y < undercoat.height; y += 1) {
      boundaryDelta += Math.abs(compositeLuma[y * undercoat.width + x] - compositeLuma[y * undercoat.width + x - 1]);
      boundarySamples += 1;
    }
    const y = Math.round(boundary * tileHeight);
    for (let x2 = 0; x2 < undercoat.width; x2 += 1) {
      boundaryDelta += Math.abs(compositeLuma[y * undercoat.width + x2] - compositeLuma[(y - 1) * undercoat.width + x2]);
      boundarySamples += 1;
    }
  }
  return {
    meanLuma: lumaTotal / count,
    centroid: rgbTotal.map((value) => value / count),
    alphaCracks,
    meanCellBoundaryDelta: boundaryDelta / boundarySamples,
    checkerboardScore: checkerboardScore(semantic, undercoat),
  };
}

function alphaMetrics(image) {
  let visible = 0; let maximum = 0; let center = 0; let transparentRgbViolations = 0;
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    const value = pixel(image, x, y);
    maximum = Math.max(maximum, value[3]);
    if (value[3] > 0) visible += 1;
    else if (value[0] !== 0 || value[1] !== 0 || value[2] !== 0) transparentRgbViolations += 1;
  }
  const centerRadiusX = Math.max(1, Math.floor(image.width * 0.18));
  const centerRadiusY = Math.max(1, Math.floor(image.height * 0.18));
  for (let y = Math.floor(image.height / 2) - centerRadiusY; y <= Math.floor(image.height / 2) + centerRadiusY; y += 1) {
    for (let x = Math.floor(image.width / 2) - centerRadiusX; x <= Math.floor(image.width / 2) + centerRadiusX; x += 1) {
      if (alphaAt(image, x, y) > 0) center += 1;
    }
  }
  return { coverage: visible / (image.width * image.height), maximum, center, transparentRgbViolations };
}

function transformBytes(image, mode) {
  const data = Buffer.alloc(image.data.length);
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
    const source = offset(image, sourceX, sourceY); const target = offset(image, x, y);
    for (let channel = 0; channel < 4; channel += 1) data[target + channel] = image.data[source + channel];
  }
  return data;
}

function alphaOverlap(a, b) {
  let overlap = 0;
  for (let index = 3; index < a.data.length; index += 4) if (a.data[index] > 0 && b.data[index] > 0) overlap += 1;
  return overlap;
}

function connectedComponents(image) {
  const visited = new Uint8Array(image.width * image.height);
  let components = 0; let visible = 0; let largest = 0;
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    if (alphaAt(image, x, y) === 0) continue;
    visible += 1;
    const start = y * image.width + x;
    if (visited[start]) continue;
    components += 1; visited[start] = 1;
    const queue = [start]; let size = 0;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor]; size += 1;
      const px = index % image.width; const py = Math.floor(index / image.width);
      for (const [nx, ny] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]]) {
        if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) continue;
        const next = ny * image.width + nx;
        if (!visited[next] && alphaAt(image, nx, ny) > 0) { visited[next] = 1; queue.push(next); }
      }
    }
    largest = Math.max(largest, size);
  }
  return { components, visible, largest };
}

function radialBoundaryVariance(image) {
  const distances = [];
  const cx = (image.width - 1) / 2; const cy = (image.height - 1) / 2;
  for (let y = 1; y < image.height - 1; y += 1) for (let x = 1; x < image.width - 1; x += 1) {
    if (alphaAt(image, x, y) === 0) continue;
    if ([alphaAt(image, x - 1, y), alphaAt(image, x + 1, y), alphaAt(image, x, y - 1), alphaAt(image, x, y + 1)].every((alpha) => alpha > 0)) continue;
    const dx = (x - cx) / image.width; const dy = (y - cy) / image.height;
    distances.push(Math.sqrt(dx * dx + dy * dy));
  }
  const mean = distances.reduce((sum, value) => sum + value, 0) / distances.length;
  return distances.reduce((sum, value) => sum + (value - mean) ** 2, 0) / distances.length;
}

function rgbDistance(a, b) {
  return Math.sqrt(a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0));
}

function rgbCentroid(image) {
  const total = [0, 0, 0]; let count = 0;
  for (let index = 0; index < image.data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) total[channel] += image.data[index + channel];
    count += 1;
  }
  return total.map((value) => value / count);
}

function alphaPatternDistance(a, b) {
  let total = 0; let count = 0;
  for (let index = 3; index < a.data.length; index += 4) {
    total += Math.abs(a.data[index] - b.data[index]) / 255;
    count += 1;
  }
  return total / count;
}

function compositePixel(undercoat, semantic, x, y) {
  const under = pixel(undercoat, x, y); const over = pixel(semantic, x, y);
  const alpha = over[3] / 255;
  return [0, 1, 2].map((channel) => under[channel] * (1 - alpha) + over[channel] * alpha);
}

function normalizedTierDistance(underA, cueA, underB, cueB, samples = 64) {
  let total = 0; let count = 0;
  for (let y = 0; y < samples; y += 1) for (let x = 0; x < samples; x += 1) {
    const ax = Math.round(x / (samples - 1) * (underA.width - 1));
    const ay = Math.round(y / (samples - 1) * (underA.height - 1));
    const bx = Math.round(x / (samples - 1) * (underB.width - 1));
    const by = Math.round(y / (samples - 1) * (underB.height - 1));
    const a = compositePixel(underA, cueA, ax, ay); const b = compositePixel(underB, cueB, bx, by);
    for (let channel = 0; channel < 3; channel += 1) { total += Math.abs(a[channel] - b[channel]); count += 1; }
  }
  return total / count;
}

function alphaBands(image) {
  const bands = new Set();
  for (let index = 3; index < image.data.length; index += 4) if (image.data[index] > 0) bands.add(image.data[index]);
  return [...bands].sort((a, b) => b - a);
}

function maximumNormalizedInteriorDepth(image) {
  let maximum = 0;
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    if (alphaAt(image, x, y) === 0) continue;
    const nx = Math.abs((x + 0.5 - image.width / 2) / (image.width / 2));
    const ny = Math.abs((y + 0.5 - image.height / 2) / (image.height / 2));
    maximum = Math.max(maximum, 1 - (nx + ny));
  }
  return maximum;
}

function maximumDiagonalAutocorrelation(image) {
  const values = []; let mean = 0;
  for (let index = 3; index < image.data.length; index += 4) { values.push(image.data[index]); mean += image.data[index]; }
  mean /= values.length;
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
  if (variance === 0) return 0;
  let maximum = -1;
  const firstShift = Math.max(4, Math.round(image.width / 32));
  const lastShift = Math.round(image.width / 4);
  for (let shift = firstShift; shift <= lastShift; shift += 1) for (const sign of [1, -1]) {
    let covariance = 0; let count = 0;
    for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
      const otherX = (x + sign * shift + image.width) % image.width;
      const otherY = (y + shift) % image.height;
      covariance += (values[y * image.width + x] - mean) * (values[otherY * image.width + otherX] - mean);
      count += 1;
    }
    maximum = Math.max(maximum, covariance / (variance * count));
  }
  return maximum;
}

function verifyEvidence(evidenceRoot, sourceManifest, errors) {
  if (!evidenceRoot) return null;
  const required = [
    "undercoat-30x30.png", ...SEMANTICS.map((name) => `semantic-${name}-30x30.png`),
    "quality-high-medium-low.png", "all-half-edges-and-corners.png", "semantic-pair-examples.png",
    "canonical-multicell-assembly.png", "hazard-primitives.png", "palette-standard.png", "palette-accessibility.png",
    "proof-support.json", "commands.txt",
  ];
  const manifestPath = path.join(evidenceRoot, "evidence-manifest.json");
  const manifest = existsSync(manifestPath) ? readJson(manifestPath, "evidence manifest", errors) : null;
  assert(Boolean(manifest), "evidence manifest is missing", errors);
  assert(manifest?.sourceManifestSha256 === sha256(readFileSync(sourceManifest)), "evidence source-manifest hash is stale", errors);
  for (const name of required) {
    const file = path.join(evidenceRoot, name);
    assert(existsSync(file), `evidence is missing ${name}`, errors);
    if (!existsSync(file)) continue;
    const bytes = readFileSync(file);
    assert(manifest?.files?.[name]?.sha256 === sha256(bytes), `${name} evidence hash is stale`, errors);
    assert(manifest?.files?.[name]?.bytes === bytes.length, `${name} evidence byte count is stale`, errors);
  }
  const proofSupportPath = path.join(evidenceRoot, "proof-support.json");
  const proofSupport = existsSync(proofSupportPath) ? readJson(proofSupportPath, "proof support", errors) : null;
  assert(proofSupport?.version === 2, "proof support version is stale", errors);
  assert(proofSupport?.rawAlphaProof?.backing === "8px-neutral-checkerboard", "raw alpha proof lacks checkerboard backing", errors);
  assert(proofSupport?.rawAlphaProof?.opaqueDiamondBacking === false, "raw alpha proof uses an opaque diamond backing", errors);
  assert(proofSupport?.pairProof?.syntheticBoundary === false, "pair proof uses a synthetic boundary", errors);
  assert(proofSupport?.pairProof?.boundary === "tile-snapped-straight-with-one-step", "pair proof is not tile snapped", errors);
  assert(proofSupport?.canonicalAssembly?.syntheticBoundary === false, "canonical assembly uses a synthetic boundary", errors);
  const source = readJson(sourceManifest, "source manifest for proof support", errors);
  const displayed = proofSupport?.rawAlphaProof?.displayed ?? [];
  const expectedRaw = [];
  for (const pair of PAIRS) {
    for (const direction of DIRECTIONS) expectedRaw.push(`high/edge-${pair}-${direction}.png`);
    for (const corner of CORNERS) expectedRaw.push(`high/corner-${pair}-${corner}.png`);
  }
  assert(JSON.stringify(displayed.map((entry) => entry.sourceAsset).sort()) === JSON.stringify(expectedRaw.sort()), "raw alpha proof does not display every High edge/corner exactly once", errors);
  const supportedAssets = [
    ...displayed,
    ...(proofSupport?.pairProof?.assemblies ?? []).flatMap((assembly) => assembly.sourceAssets ?? []),
    ...(proofSupport?.canonicalAssembly?.assets ?? []),
  ];
  for (const entry of supportedAssets) {
    assert(source?.files?.[entry.sourceAsset]?.sha256 === entry.sha256, `proof source hash is stale for ${entry.sourceAsset}`, errors);
  }
  assert((proofSupport?.pairProof?.assemblies ?? []).length === PAIRS.length, "pair proof does not cover every semantic pair", errors);
  for (const assembly of proofSupport?.pairProof?.assemblies ?? []) {
    assert(PAIRS.includes(assembly.pair) && assembly.quality === "low", `pair proof assembly identity is invalid for ${assembly.pair}`, errors);
    assert(assembly.boundary === "tile-snapped-straight-with-one-step", `pair proof boundary is stale for ${assembly.pair}`, errors);
    assert((assembly.sourceAssets ?? []).some((entry) => entry.sourceAsset.includes(`/edge-${assembly.pair}-`)), `pair proof does not use generated edges for ${assembly.pair}`, errors);
  }
  return {
    files: required.length + 1,
    manifestSha256: existsSync(manifestPath) ? sha256(readFileSync(manifestPath)) : null,
    rawAssets: displayed.length,
    pairAssemblies: proofSupport?.pairProof?.assemblies?.length ?? 0,
  };
}

export function auditParklandComposable(options = {}) {
  const root = options.root ?? ROOT;
  const errors = [];
  const contractFile = path.join(root, CONTRACT_PATH);
  const contract = existsSync(contractFile) ? readJson(contractFile, "composable contract", errors) : null;
  assert(Boolean(contract), "versioned composable Parkland contract is missing", errors);
  if (!contract) return { ok: false, errors };
  assert(contract.version === 1 && contract.id === "parkland-composable-material-v1", "composable contract id/version is invalid", errors);
  assert(contract.theme === "parkland" && contract.status === "source-contract-only", "contract must remain a Parkland-only sidecar", errors);
  assert(contract.budgets.runtimeBytesAddedByThisPacket === 0, "asset packet must not claim runtime adoption", errors);
  assert(contract.phase.independentPerCellPhase === false && contract.phase.worldPeriodTiles === 8, "common world phase is incomplete", errors);
  assert(JSON.stringify(contract.layers.semanticCues.semantics) === JSON.stringify(SEMANTICS), "semantic vocabulary is incomplete", errors);
  assert(JSON.stringify(contract.layers.pairHalfEdges.pairs) === JSON.stringify(PAIRS), "pair vocabulary is incomplete", errors);
  assert(JSON.stringify(contract.layers.pairHalfEdges.directions) === JSON.stringify(DIRECTIONS), "edge direction vocabulary is incomplete", errors);
  assert(JSON.stringify(contract.layers.pairCorners.corners) === JSON.stringify(CORNERS), "corner vocabulary is incomplete", errors);
  assert(JSON.stringify(contract.layers.hazardProofs.hazards) === JSON.stringify(HAZARDS), "hazard proof vocabulary is incomplete", errors);
  assert(contract.consumerInterface.topologyAuthority.includes("never define simulation"), "gameplay/topology authority boundary is missing", errors);
  assert(contract.atlas.gutterPx >= 2, "future atlas gutter must be at least 2px", errors);

  const sourceRoot = path.resolve(options.sourceRoot ?? path.join(root, contract.source.root));
  const sourceManifestPath = path.join(sourceRoot, contract.source.manifest);
  const manifest = existsSync(sourceManifestPath) ? readJson(sourceManifestPath, "composable source manifest", errors) : null;
  assert(Boolean(manifest), "composable source manifest is missing", errors);
  if (!manifest) return { ok: false, errors, contract };
  assert(manifest.version === contract.determinism.manifestVersion, "source manifest version is invalid", errors);
  assert(manifest.id === "parkland-composable-material-source-v1", "source manifest id is invalid", errors);
  assert(manifest.generatedBy === contract.source.generator, "source generator provenance is stale", errors);
  assert(manifest.hashAlgorithm === contract.determinism.hashAlgorithm, "source hash algorithm is stale", errors);
  assert(manifest.provenance.author === "CourseCraft" && manifest.provenance.externalProvider === "none" && manifest.provenance.referencePixelsCopied === false, "source provenance is incomplete", errors);
  assert(JSON.stringify(manifest.vocabulary.pairs) === JSON.stringify(PAIRS), "source pair vocabulary is stale", errors);
  assert(JSON.stringify(manifest.vocabulary.semantics) === JSON.stringify(SEMANTICS), "source semantic vocabulary is stale", errors);
  assert(JSON.stringify(manifest.patterns) === JSON.stringify(contract.layers.semanticCues.patterns), "semantic pattern provenance is stale", errors);

  const expected = expectedPaths();
  const actual = listPngs(sourceRoot);
  assert(JSON.stringify(actual) === JSON.stringify(expected), `source coverage differs: expected ${expected.length}, found ${actual.length}`, errors);
  assert(JSON.stringify(Object.keys(manifest.files).sort()) === JSON.stringify(expected), "manifest coverage must exactly match generated PNGs", errors);
  assert(expected.length === 270, "contracted file count must remain 270", errors);
  let sourceBytes = statSync(sourceManifestPath).size;
  const images = {};
  for (const relativePath of expected) {
    const file = path.join(sourceRoot, relativePath);
    if (!existsSync(file)) continue;
    const bytes = readFileSync(file); sourceBytes += bytes.length;
    const metadata = manifest.files[relativePath];
    assert(metadata?.sha256 === sha256(bytes), `${relativePath} SHA-256 is stale`, errors);
    assert(metadata?.bytes === bytes.length, `${relativePath} byte count is stale`, errors);
    const image = readPng(file, relativePath, errors);
    if (!image) continue;
    images[relativePath] = image;
    assert(metadata.width === image.width && metadata.height === image.height, `${relativePath} dimensions are stale`, errors);
  }
  assert(sourceBytes <= contract.budgets.sourceBytesMax, `source is ${sourceBytes} bytes; budget is ${contract.budgets.sourceBytesMax}`, errors);
  assert(expected.length + 1 <= contract.budgets.filesMax, "source file count exceeds budget", errors);

  const surfaceReport = {};
  for (const quality of QUALITIES) {
    const target = contract.qualities[quality];
    const undercoat = images[`${quality}/undercoat.png`];
    assert(undercoat?.width === target.fieldSourceSize.width && undercoat?.height === target.fieldSourceSize.height, `${quality} undercoat size is invalid`, errors);
    assert(oppositeBorderDelta(undercoat) <= contract.metrics.maximumWrapChannelDelta, `${quality} undercoat wrap seam is nonzero`, errors);
    const underAlpha = alphaMetrics(undercoat);
    assert(underAlpha.coverage === 1 && underAlpha.maximum === 255, `${quality} undercoat is not fully opaque`, errors);
    assert(checkerboardScore(undercoat) <= contract.metrics.maximumCheckerboardScore, `${quality} undercoat checkerboard score is too high`, errors);
    surfaceReport[quality] = {};
    for (const semantic of SEMANTICS) {
      const cue = images[`${quality}/semantic-${semantic}.png`];
      const cueMetadata = manifest.files[`${quality}/semantic-${semantic}.png`];
      assert(oppositeBorderDelta(cue) <= contract.metrics.maximumWrapChannelDelta, `${quality}/${semantic} wrap seam is nonzero`, errors);
      assert(cueMetadata?.phase === contract.phase.id, `${quality}/${semantic} phase is stale`, errors);
      assert(cueMetadata?.worldPeriodTiles === contract.phase.worldPeriodTiles, `${quality}/${semantic} period is stale`, errors);
      const cueBands = alphaBands(cue);
      assert(JSON.stringify(cueMetadata?.intendedOpacityRange) === JSON.stringify([Math.min(...cueBands), Math.max(...cueBands)]), `${quality}/${semantic} opacity range is stale`, errors);
      const metrics = composeMetrics(undercoat, cue, contract.phase.worldPeriodTiles);
      if (semantic === "deep_rough") metrics.maximumDiagonalAutocorrelation = maximumDiagonalAutocorrelation(cue);
      assert(metrics.alphaCracks === 0, `${quality}/${semantic} composite has alpha cracks`, errors);
      assert(metrics.meanCellBoundaryDelta <= contract.metrics.maximumCellBoundaryLumaDelta, `${quality}/${semantic} has a cell-boundary discontinuity (${metrics.meanCellBoundaryDelta.toFixed(3)})`, errors);
      assert(metrics.checkerboardScore <= contract.metrics.maximumCheckerboardScore, `${quality}/${semantic} checkerboard score is too high (${metrics.checkerboardScore.toFixed(3)})`, errors);
      if (semantic === "deep_rough") assert(metrics.maximumDiagonalAutocorrelation <= contract.metrics.maximumDeepRoughDiagonalAutocorrelation, `${quality}/${semantic} has a repeated diagonal/lozenge lattice (${metrics.maximumDiagonalAutocorrelation.toFixed(3)})`, errors);
      surfaceReport[quality][semantic] = metrics;
    }
    const metrics = Object.values(surfaceReport[quality]);
    const lumas = metrics.map((entry) => entry.meanLuma);
    assert(Math.max(...lumas) - Math.min(...lumas) <= contract.layers.semanticCues.maximumCompositeMeanLumaDelta, `${quality} semantic luma delta exceeds the declared bound`, errors);
    assert(Math.min(...lumas) >= contract.layers.semanticCues.compositeLumaRange[0] && Math.max(...lumas) <= contract.layers.semanticCues.compositeLumaRange[1], `${quality} semantic luma leaves the declared range`, errors);
    let minimumCentroidDistance = Infinity; let minimumPatternDistance = Infinity;
    for (let a = 0; a < metrics.length; a += 1) for (let b = a + 1; b < metrics.length; b += 1) {
      minimumCentroidDistance = Math.min(minimumCentroidDistance, rgbDistance(metrics[a].centroid, metrics[b].centroid));
      minimumPatternDistance = Math.min(
        minimumPatternDistance,
        alphaPatternDistance(
          images[`${quality}/semantic-${SEMANTICS[a]}.png`],
          images[`${quality}/semantic-${SEMANTICS[b]}.png`],
        ),
      );
    }
    surfaceReport[quality].minimumCentroidDistance = minimumCentroidDistance;
    surfaceReport[quality].minimumPatternDistance = minimumPatternDistance;
    surfaceReport[quality].roughUndercoatRgbDistance = rgbDistance(surfaceReport[quality].rough.centroid, rgbCentroid(undercoat));
    surfaceReport[quality].roughFairwayRgbDistance = rgbDistance(surfaceReport[quality].rough.centroid, surfaceReport[quality].fairway.centroid);
    assert(minimumCentroidDistance >= contract.layers.semanticCues.minimumRgbCentroidDistance, `${quality} semantic RGB centroid distance ${minimumCentroidDistance.toFixed(3)} is below the declared minimum`, errors);
    assert(minimumPatternDistance >= contract.layers.semanticCues.minimumPatternDistance, `${quality} semantic pattern distance ${minimumPatternDistance.toFixed(4)} is below the declared minimum`, errors);
    assert(surfaceReport[quality].roughUndercoatRgbDistance >= contract.layers.semanticCues.minimumRoughUndercoatRgbDistance, `${quality} rough is not distinct enough from undercoat`, errors);
    assert(surfaceReport[quality].roughFairwayRgbDistance >= contract.layers.semanticCues.minimumRoughFairwayRgbDistance, `${quality} rough is not distinct enough from fairway`, errors);
  }

  const tierReport = {};
  for (const semantic of SEMANTICS) {
    tierReport[semantic] = {
      highMedium: normalizedTierDistance(images["high/undercoat.png"], images[`high/semantic-${semantic}.png`], images["medium/undercoat.png"], images[`medium/semantic-${semantic}.png`]),
      mediumLow: normalizedTierDistance(images["medium/undercoat.png"], images[`medium/semantic-${semantic}.png`], images["low/undercoat.png"], images[`low/semantic-${semantic}.png`]),
      highLow: normalizedTierDistance(images["high/undercoat.png"], images[`high/semantic-${semantic}.png`], images["low/undercoat.png"], images[`low/semantic-${semantic}.png`]),
    };
    assert(tierReport[semantic].highMedium >= contract.layers.semanticCues.minimumTierCompositeDistance.highMedium, `${semantic} High/Medium tier distance is too subtle`, errors);
    assert(tierReport[semantic].mediumLow >= contract.layers.semanticCues.minimumTierCompositeDistance.mediumLow, `${semantic} Medium/Low tier distance is too subtle`, errors);
    assert(tierReport[semantic].highLow >= contract.layers.semanticCues.minimumTierCompositeDistance.highLow, `${semantic} High/Low tier distance is too subtle`, errors);
  }

  const pairReport = {};
  for (const quality of QUALITIES) {
    pairReport[quality] = { edges: 0, corners: 0, minimumCornerOverlap: Infinity, maximumInteriorDepth: 0 };
    for (const pair of PAIRS) {
      const north = images[`${quality}/edge-${pair}-n.png`];
      for (const direction of DIRECTIONS) {
        const relativePath = `${quality}/edge-${pair}-${direction}.png`;
        const image = images[relativePath]; const metadata = manifest.files[relativePath];
        const metrics = alphaMetrics(image);
        const bands = alphaBands(image); const depth = maximumNormalizedInteriorDepth(image);
        assert(metadata.role === "pair-half-edge" && metadata.pair === pair && metadata.direction === direction, `${relativePath} identity metadata is invalid`, errors);
        assert(Boolean(metadata.logicalAnchor && metadata.clipBounds && metadata.intendedOpacity), `${relativePath} consumer metadata is incomplete`, errors);
        assert(metrics.coverage > 0 && metrics.coverage <= contract.metrics.maximumHalfEdgeAlphaCoverage, `${relativePath} alpha coverage can form a full-cell silhouette`, errors);
        assert(metrics.center === 0, `${relativePath} leaks alpha into the cell interior`, errors);
        assert(metrics.transparentRgbViolations === 0, `${relativePath} has nonzero transparent RGB`, errors);
        assert(metrics.maximum === metadata.intendedOpacity.maximum, `${relativePath} intended opacity is stale`, errors);
        assert(bands.length === 4 && bands.every((band) => metadata.intendedOpacity.bands.includes(band)), `${relativePath} is not a crisp four-band strip`, errors);
        assert(depth <= contract.metrics.maximumTransitionInteriorDepth, `${relativePath} strip is too broad (${depth.toFixed(4)})`, errors);
        if (direction !== "n") assert(Buffer.compare(Buffer.from(image.data), transformBytes(north, metadata.transformFromNorth)) === 0, `${relativePath} transform is not exact`, errors);
        pairReport[quality].maximumInteriorDepth = Math.max(pairReport[quality].maximumInteriorDepth, depth);
        pairReport[quality].edges += 1;
      }
      const northEast = images[`${quality}/corner-${pair}-ne.png`];
      for (const corner of CORNERS) {
        const relativePath = `${quality}/corner-${pair}-${corner}.png`;
        const image = images[relativePath]; const metadata = manifest.files[relativePath];
        const metrics = alphaMetrics(image);
        const bands = alphaBands(image); const depth = maximumNormalizedInteriorDepth(image);
        assert(metadata.role === "pair-corner" && metadata.pair === pair && metadata.corner === corner, `${relativePath} identity metadata is invalid`, errors);
        assert(metrics.coverage > 0 && metrics.coverage <= contract.metrics.maximumCornerAlphaCoverage, `${relativePath} alpha coverage can form a full-cell silhouette`, errors);
        assert(metrics.center === 0, `${relativePath} leaks alpha into the cell interior`, errors);
        assert(metrics.transparentRgbViolations === 0, `${relativePath} has nonzero transparent RGB`, errors);
        assert(metrics.maximum === metadata.intendedOpacity.maximum, `${relativePath} intended opacity is stale`, errors);
        assert(bands.length >= 2 && bands.length <= 4 && bands.every((band) => metadata.intendedOpacity.bands.includes(band)), `${relativePath} is not a crisp compatible corner patch`, errors);
        assert(depth <= contract.metrics.maximumTransitionInteriorDepth, `${relativePath} corner is too broad (${depth.toFixed(4)})`, errors);
        if (corner !== "ne") assert(Buffer.compare(Buffer.from(image.data), transformBytes(northEast, metadata.transformFromNorthEast)) === 0, `${relativePath} transform is not exact`, errors);
        pairReport[quality].maximumInteriorDepth = Math.max(pairReport[quality].maximumInteriorDepth, depth);
        for (const direction of metadata.compatibleEdges) {
          const overlap = alphaOverlap(image, images[`${quality}/edge-${pair}-${direction}.png`]);
          pairReport[quality].minimumCornerOverlap = Math.min(pairReport[quality].minimumCornerOverlap, overlap);
          assert(overlap > 0, `${relativePath} does not meet compatible ${direction} edge`, errors);
        }
        pairReport[quality].corners += 1;
      }
    }
  }

  const hazardReport = {};
  for (const quality of QUALITIES) {
    hazardReport[quality] = {};
    for (const hazard of HAZARDS) {
      const relativePath = `${quality}/hazard-${hazard}.png`;
      const image = images[relativePath]; const metadata = manifest.files[relativePath];
      const alpha = alphaMetrics(image); const connected = connectedComponents(image);
      const variance = radialBoundaryVariance(image);
      assert(metadata.topologyAuthority === "proof-only-not-a-gameplay-mask", `${relativePath} crosses the gameplay-shape boundary`, errors);
      assert(alpha.coverage >= contract.metrics.minimumHazardAlphaCoverage && alpha.coverage <= contract.metrics.maximumHazardAlphaCoverage, `${relativePath} alpha coverage is not an organic inset`, errors);
      assert(connected.components === 1 && connected.largest === connected.visible, `${relativePath} silhouette is disconnected`, errors);
      assert(variance >= contract.metrics.minimumHazardBoundaryRadialVariance, `${relativePath} boundary is too regular (${variance.toFixed(5)})`, errors);
      assert(alpha.transparentRgbViolations === 0, `${relativePath} has nonzero transparent exterior RGB`, errors);
      const colors = new Set();
      for (let index = 0; index < image.data.length; index += 4) if (image.data[index + 3] > 0) colors.add(`${image.data[index]},${image.data[index + 1]},${image.data[index + 2]}`);
      assert(colors.size >= 3, `${relativePath} lacks recessed depth/lip palette bands`, errors);
      hazardReport[quality][hazard] = { coverage: alpha.coverage, components: connected.components, radialVariance: variance, colors: colors.size };
    }
  }

  const paletteReport = {};
  for (const mode of contract.palette.modes) {
    const palette = manifest.palettes[mode];
    let minimumDistance = Infinity;
    for (let a = 0; a < SEMANTICS.length; a += 1) for (let b = a + 1; b < SEMANTICS.length; b += 1) {
      minimumDistance = Math.min(minimumDistance, rgbDistance(palette[SEMANTICS[a]], palette[SEMANTICS[b]]));
    }
    assert(minimumDistance >= contract.palette.minimumPairRgbDistance, `${mode} palette distance ${minimumDistance.toFixed(3)} is below the declared minimum`, errors);
    assert(new Set(SEMANTICS.map((semantic) => manifest.patterns[semantic])).size === SEMANTICS.length, `${mode} lacks distinct non-color pattern identities`, errors);
    paletteReport[mode] = { minimumPairRgbDistance: minimumDistance, patterns: SEMANTICS.length };
  }

  const evidence = verifyEvidence(options.evidenceRoot, sourceManifestPath, errors);
  return {
    ok: errors.length === 0,
    errors,
    contract: { version: contract.version, id: contract.id, sha256: sha256(readFileSync(contractFile)) },
    source: { files: expected.length, bytes: sourceBytes, manifestSha256: sha256(readFileSync(sourceManifestPath)) },
    surfaces: surfaceReport,
    tiers: tierReport,
    pairs: pairReport,
    hazards: hazardReport,
    palettes: paletteReport,
    evidence,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const evidenceRoot = process.env.COURSECRAFT_COMPOSABLE_EVIDENCE_DIR;
  const result = auditParklandComposable({ evidenceRoot });
  if (!result.ok) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
  } else {
    const report = `${JSON.stringify(result, null, 2)}\n`;
    if (evidenceRoot) {
      writeFileSync(path.join(evidenceRoot, "machine-audit.json"), report);
      writeFileSync(path.join(evidenceRoot, "machine-audit.sha256"), `${sha256(Buffer.from(report))}  machine-audit.json\n`);
    }
    console.log(report.trimEnd());
  }
}
