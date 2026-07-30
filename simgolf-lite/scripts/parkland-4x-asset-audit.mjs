import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TERRAIN_NAMES = [
  "fairway", "tee", "green", "rough", "deep_rough",
  "waste_area", "path", "wetland", "water", "sand",
];
const EDGE_DIRECTIONS = ["n", "e", "s", "w"];
const CORNER_DIRECTIONS = ["ne", "se", "sw", "nw"];
const QUALITIES = ["high", "medium", "low"];
const DETAIL_KINDS = [
  "short_grass", "tall_grass", "fescue", "flowers", "leaf_litter",
  "reeds", "shore_stones", "pebbles", "bunker_tuft", "scrub",
];
const EXPECTED_KINDS = [
  ...Array.from({ length: 6 }, (_, index) => ["base", String(index)]),
  ...EDGE_DIRECTIONS.map((direction) => ["edge", direction]),
  ...CORNER_DIRECTIONS.flatMap((direction) => [["outer", direction], ["inner", direction]]),
];
const expectedNames = () => TERRAIN_NAMES.flatMap((terrain) => EXPECTED_KINDS.map(([kind, suffix]) => (
  `parkland_${terrain}_${kind}_${suffix}.png`
)));
const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");
const bytesToMiB = (bytes) => Number((bytes / (1024 * 1024)).toFixed(3));

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

function readJson(file, errors, label) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    errors.push(`${label} is not readable JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function validateContract(contract, root, errors) {
  assert(contract?.version === 2, "contract version must be 2", errors);
  assert(contract?.id === "parkland-terrain-4x", "contract id must be parkland-terrain-4x", errors);
  assert(contract?.theme === "parkland", "contract theme must be parkland", errors);
  assert(contract?.source?.externalProvider === "none", "4x fallback must not depend on an external provider", errors);
  assert(contract?.source?.referencePixelsCopied === false, "reference pixels must not be copied", errors);
  assert(contract?.source?.reviewStatus === "machine-contract-only", "4x source must remain machine-contract-only until human review", errors);
  assert(contract?.source?.authoredBy === "CourseCraft", "4x provenance must name CourseCraft as author", errors);
  assert(contract?.source?.generator === "scripts/gen-parkland-4x-fallback.mjs", "4x provenance must name its generator", errors);
  assert(contract?.source?.algorithm === "scripts/gen-terrain-materials.mjs", "4x provenance must name its deterministic algorithm", errors);
  assert(contract?.source?.root?.startsWith("art/"), "4x source must stay in review-only art/ space", errors);
  assert(contract?.determinism?.hashAlgorithm === "sha256", "4x source must use SHA-256 hashes", errors);
  assert(contract?.determinism?.runtimeAdoption === "prohibited", "4x source must not be adopted by runtime", errors);
  assert(contract?.frame?.width === 256 && contract?.frame?.height === 128, "4x frame dimensions must be 256x128", errors);
  assert(contract?.frame?.presentationScale === 4 && contract?.frame?.tileSpan === 4, "4x presentation contract must be four tiles at 4x", errors);
  assert(contract?.frame?.baseVariants === 6, "4x contract must provide six base variants", errors);
  assert(JSON.stringify(contract?.coverage?.materials) === JSON.stringify(TERRAIN_NAMES), "4x material coverage must list all ten terrain materials", errors);
  assert(JSON.stringify(contract?.coverage?.edgeDirections) === JSON.stringify(EDGE_DIRECTIONS), "4x edge directions are incomplete", errors);
  assert(JSON.stringify(contract?.coverage?.contourDirections) === JSON.stringify(CORNER_DIRECTIONS), "4x contour directions are incomplete", errors);
  assert(contract?.atlas?.gutterPx >= 2, "atlas gutter must be at least two pixels", errors);
  assert(contract?.fallback?.root === "src/assets/terrain/materials", "runtime fallback root must remain the shipped 2x material source", errors);
  assert(contract?.fallback?.runtimeAsset === true, "only the shipped 2x fallback may be a runtime asset", errors);
  assert(existsSync(path.join(root, contract?.fallback?.root ?? "")), "shipped 2x fallback source is missing", errors);
  for (const budget of ["sourceBytesMax", "atlasBytesMax", "selectedTransferBytesMax", "criticalTransferBytesMax"]) {
    assert(contract?.budgets?.[budget] > 0, `4x ${budget} is required`, errors);
  }
}

function validateSource(sourceRoot, contract, errors) {
  if (!existsSync(sourceRoot)) return { status: "not-generated", files: 0, bytes: 0, duplicateHashes: [], hash: null };
  const expected = new Set(expectedNames());
  const actual = new Set(readdirSync(sourceRoot).filter((name) => name.endsWith(".png")));
  const missing = [...expected].filter((name) => !actual.has(name));
  const extra = [...actual].filter((name) => !expected.has(name));
  assert(missing.length === 0, `4x source is missing ${missing.length} required frame(s)`, errors);
  assert(extra.length === 0, `4x source contains ${extra.length} unexpected frame(s)`, errors);

  const manifestPath = path.join(sourceRoot, contract.source.manifest);
  const manifest = existsSync(manifestPath) ? readJson(manifestPath, errors, "4x source manifest") : null;
  assert(Boolean(manifest), "4x source manifest is missing", errors);
  assert(manifest?.version === contract.determinism.manifestVersion, "4x source manifest version is invalid", errors);
  assert(manifest?.hashAlgorithm === contract.determinism.hashAlgorithm, "4x source manifest hash algorithm is invalid", errors);
  assert(manifest?.generatedImagePolicy === "review-only-not-runtime", "4x generated source manifest must remain review-only", errors);

  const hashes = new Map();
  const duplicateHashes = [];
  let bytes = 0;
  for (const name of [...expected].filter((item) => actual.has(item)).sort()) {
    const file = path.join(sourceRoot, name);
    const buffer = readFileSync(file);
    bytes += buffer.length;
    const digest = hash(buffer);
    assert(manifest?.files?.[name]?.sha256 === digest, `${name} SHA-256 does not match the generated manifest`, errors);
    assert(manifest?.files?.[name]?.bytes === buffer.length, `${name} byte count does not match the generated manifest`, errors);
    const previous = hashes.get(digest);
    if (previous) {
      duplicateHashes.push({ digest, files: [previous, name] });
      errors.push(`${name} duplicates ${previous} byte-for-byte`);
    }
    hashes.set(digest, name);
    let image;
    try {
      image = PNG.sync.read(buffer);
    } catch (error) {
      errors.push(`${name} is not a readable PNG: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    assert(image.width === contract.frame.width, `${name} width is ${image.width}, expected ${contract.frame.width}`, errors);
    assert(image.height === contract.frame.height, `${name} height is ${image.height}, expected ${contract.frame.height}`, errors);
    const alpha = image.data.filter((_, index) => index % 4 === 3);
    const [, terrain, kind] = name.match(/^parkland_(.+)_(base|edge|outer|inner)_/) ?? [];
    assert(alpha.some((value) => value > 0), `${name} has no visible pixels`, errors);
    assert(alpha.some((value) => value === 0), `${name} lacks transparent diamond/corner gutter pixels`, errors);
    if (kind === "outer" || kind === "inner") assert(alpha.some((value) => value === 0), `${name} contour frame has no transparent gutter`, errors);
    if ((terrain === "water" || terrain === "wetland") && kind === "edge") {
      assert(alpha.some((value) => value > 0 && value < 255), `${name} water/wetland frame lacks partial-alpha edge detail`, errors);
    }
  }
  assert(Object.keys(manifest?.files ?? {}).length === expected.size, "4x source manifest must hash exactly the required frames", errors);
  assert(bytes <= contract.budgets.sourceBytesMax, `4x source is ${bytesToMiB(bytes)} MiB; budget is ${bytesToMiB(contract.budgets.sourceBytesMax)} MiB`, errors);
  return { status: "generated", files: actual.size, bytes, duplicateHashes, hash: hash(Buffer.from(JSON.stringify(manifest?.files ?? {}))) };
}

function validateFrameGutters(sheet, label, gutter, errors) {
  const frames = Object.entries(sheet?.frames ?? {});
  for (const [name, frame] of frames) {
    const rect = frame.frame;
    assert(rect?.x >= gutter && rect?.y >= gutter, `${label} ${name} is missing the outer ${gutter}px gutter`, errors);
  }
  for (let a = 0; a < frames.length; a++) for (let b = a + 1; b < frames.length; b++) {
    const [aName, aFrame] = frames[a];
    const [bName, bFrame] = frames[b];
    const ar = aFrame.frame; const br = bFrame.frame;
    const xGap = Math.max(ar.x - (br.x + br.w), br.x - (ar.x + ar.w));
    const yGap = Math.max(ar.y - (br.y + br.h), br.y - (ar.y + ar.h));
    assert(xGap >= gutter || yGap >= gutter, `${label} frames ${aName} and ${bName} violate the ${gutter}px gutter`, errors);
  }
}

function readBundleSheet(root, bundle, label, errors) {
  if (!bundle?.json || !bundle?.image) {
    errors.push(`${label} is missing its atlas pair`);
    return null;
  }
  const jsonPath = path.join(root, "public/atlases/biomes", bundle.json);
  const imagePath = path.join(root, "public/atlases/biomes", bundle.image);
  if (!existsSync(jsonPath) || !existsSync(imagePath)) {
    errors.push(`${label} atlas pair is absent from public/atlases/biomes`);
    return null;
  }
  const json = readJson(jsonPath, errors, label);
  if (!json) return null;
  const image = readFileSync(imagePath);
  assert(bundle.json.includes(hash(readFileSync(jsonPath)).slice(0, 12)), `${label} JSON filename hash is stale`, errors);
  assert(bundle.image.includes(hash(image).slice(0, 12)), `${label} PNG filename hash is stale`, errors);
  assert(bundle.jsonBytes === statSync(jsonPath).size && bundle.imageBytes === image.length, `${label} manifest bytes are stale`, errors);
  return { json, bytes: statSync(jsonPath).size + image.length };
}

function validateRuntimeBundles(root, contract, errors) {
  const manifestPath = path.join(root, "public/atlases/biomes/manifest.json");
  if (!existsSync(manifestPath)) {
    errors.push("runtime biome manifest is missing");
    return null;
  }
  const manifest = readJson(manifestPath, errors, "runtime biome manifest");
  const parkland = manifest?.biomes?.parkland;
  assert(JSON.stringify(Object.keys(parkland ?? {}).sort()) === JSON.stringify([...QUALITIES].sort()), "Parkland must ship high, medium, and low quality bundles", errors);
  const expected = expectedNames().map((name) => name.slice(0, -4));
  const report = {};
  for (const quality of QUALITIES) {
    const tier = parkland?.[quality];
    const bundle = manifest?.version === 1 ? tier : tier?.base;
    const target = contract.variants.quality[quality];
    const terrain = readBundleSheet(root, bundle?.terrain, `parkland/${quality} terrain`, errors);
    const details = bundle?.details ? readBundleSheet(root, bundle.details, `parkland/${quality} details`, errors) : null;
    const terrainFrames = Object.keys(terrain?.json?.frames ?? {});
    const detailFrames = Object.keys(details?.json?.frames ?? {});
    assert(terrainFrames.length === target.terrainFrames, `parkland/${quality} terrain frame count is incomplete`, errors);
    for (const frame of expected) {
      const sourceFrame = terrain?.json?.frames?.[frame];
      assert(Boolean(sourceFrame), `parkland/${quality} lacks terrain frame ${frame}`, errors);
      assert(sourceFrame?.sourceSize?.w === contract.fallback.width && sourceFrame?.sourceSize?.h === contract.fallback.height, `parkland/${quality} ${frame} dimensions no longer match the runtime fallback`, errors);
    }
    assert(detailFrames.length === target.detailFrames, `parkland/${quality} detail frame count is incomplete`, errors);
    if (quality === "high") for (const kind of DETAIL_KINDS) for (const variant of [0, 1]) {
      assert(detailFrames.includes(`parkland_${kind}_${variant}`), `parkland/high lacks habitat/detail frame ${kind}_${variant}`, errors);
    }
    if (quality === "medium") for (const kind of DETAIL_KINDS) {
      assert(detailFrames.includes(`parkland_${kind}_0`), `parkland/medium lacks reduced detail frame ${kind}_0`, errors);
    }
    const fieldNames = Object.keys(bundle?.fields ?? {}).sort();
    assert(fieldNames.length === target.fields, `parkland/${quality} material-field coverage is incomplete`, errors);
    assert(JSON.stringify(fieldNames) === JSON.stringify(quality === "low" ? [] : [...TERRAIN_NAMES].sort()), `parkland/${quality} material fields must cover exactly the ten required materials`, errors);
    assert(quality === "low" ? bundle?.details === null && bundle?.props === null : Boolean(bundle?.details && bundle?.props), `parkland/${quality} optional-art policy is incorrect`, errors);
    if (quality === "low") {
      assert(Object.keys(tier?.seasonal ?? {}).length === 0, "parkland/low must not ship seasonal overlay detail", errors);
    }
    if (terrain) validateFrameGutters(terrain.json, `parkland/${quality} terrain`, contract.atlas.gutterPx, errors);
    if (details) validateFrameGutters(details.json, `parkland/${quality} details`, contract.atlas.gutterPx, errors);
    const selectedBytes = [bundle?.buildings, bundle?.terrain, bundle?.details, bundle?.props]
      .filter(Boolean).reduce((total, asset) => total + (asset.jsonBytes ?? 0) + (asset.imageBytes ?? 0), 0)
      + Object.values(bundle?.fields ?? {}).reduce((total, asset) => total + asset.bytes, 0);
    assert((terrain?.bytes ?? 0) <= contract.budgets.atlasBytesMax, `parkland/${quality} terrain atlas exceeds its budget`, errors);
    assert(selectedBytes <= contract.budgets.selectedTransferBytesMax, `parkland/${quality} selected bundle exceeds its budget`, errors);
    if (quality === "high") assert(selectedBytes <= contract.budgets.criticalTransferBytesMax, "Parkland default critical bundle exceeds its budget", errors);
    report[quality] = { terrainFrames: terrainFrames.length, detailFrames: detailFrames.length, selectedBytes };
  }
  return report;
}

function validateRendererAndAccessibility(root, contract, errors) {
  for (const entry of Object.values(contract.coverage.rendererOwned)) {
    const source = path.join(root, entry.file);
    assert(existsSync(source), `${entry.file} is missing`, errors);
    const text = existsSync(source) ? readFileSync(source, "utf8") : "";
    for (const exported of entry.exports) assert(new RegExp(`export\\s+(?:function|const|class)\\s+${exported}\\b`).test(text), `${entry.file} no longer exports ${exported}`, errors);
    for (const kind of entry.kinds ?? []) assert(text.includes(`"${kind}"`), `${entry.file} lacks habitat kind ${kind}`, errors);
  }
  const accessibility = contract.variants.accessibility;
  const palettePath = path.join(root, accessibility.file);
  const palette = existsSync(palettePath) ? readFileSync(palettePath, "utf8") : "";
  for (const mode of accessibility.modes) {
    const match = palette.match(new RegExp(`${mode}:\\s*\\{([^}]*)\\}`));
    assert(Boolean(match), `accessibility palette lacks ${mode}`, errors);
    for (const terrain of TERRAIN_NAMES) assert(match?.[1].includes(`${terrain}:`), `${mode} palette lacks ${terrain}`, errors);
  }
  assert(accessibility.nonColorPatterns === true && palette.includes("terrainPattern"), "accessibility contract requires non-color terrain patterns", errors);
  const atlasBuilder = path.join(root, "scripts/build-atlas.mjs");
  const atlasSource = existsSync(atlasBuilder) ? readFileSync(atlasBuilder, "utf8") : "";
  assert(!atlasSource.includes(contract.source.root), "review-only 4x source must not be included by the runtime atlas builder", errors);
  for (const [name, requirement] of Object.entries(contract.offline)) {
    const source = path.join(root, requirement.file);
    assert(existsSync(source), `${name} offline source is missing`, errors);
    const text = existsSync(source) ? readFileSync(source, "utf8") : "";
    for (const token of requirement.requiredTokens) {
      assert(text.includes(token), `${name} no longer satisfies offline-safe loading token ${token}`, errors);
    }
  }
}

export function auditParkland4x({ root = ROOT, sourceRoot } = {}) {
  const contractPath = path.join(root, "src/assets/terrain/contracts/parkland-4x.json");
  const errors = [];
  const contract = readJson(contractPath, errors, "Parkland 4x contract");
  validateContract(contract, root, errors);
  const resolvedSourceRoot = sourceRoot ?? process.env.COURSECRAFT_PARKLAND_4X_ROOT ?? path.join(root, contract?.source?.root ?? "");
  const source = validateSource(resolvedSourceRoot, contract, errors);
  const runtime = validateRuntimeBundles(root, contract, errors);
  validateRendererAndAccessibility(root, contract, errors);
  const result = {
    ok: errors.length === 0,
    contract: path.relative(root, contractPath).split(path.sep).join("/"),
    source: { ...source, root: path.relative(root, resolvedSourceRoot).split(path.sep).join("/") },
    runtime,
    errors,
  };
  if (process.env.COURSECRAFT_PARKLAND_4X_REQUIRE_SOURCE === "1" && source.status !== "generated") {
    result.ok = false;
    result.errors.push("4x source is not generated; run npm run gen:terrain:parkland-4x before the required-source audit");
  }
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = auditParkland4x();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
