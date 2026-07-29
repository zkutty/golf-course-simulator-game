import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT_PATH = path.join(ROOT, "src/assets/terrain/contracts/parkland-4x.json");
const TERRAIN_NAMES = [
  // Fescue is a deep_rough detail vocabulary in the current runtime contract,
  // not a separate gameplay terrain or atlas base frame.
  "fairway", "tee", "green", "rough", "deep_rough",
  "waste_area", "path", "wetland", "water", "sand",
];
const EDGE_DIRECTIONS = ["n", "e", "s", "w"];
const CORNER_DIRECTIONS = ["ne", "se", "sw", "nw"];
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

function validateContract(contract, errors) {
  assert(contract?.version === 1, "contract version must be 1", errors);
  assert(contract?.id === "parkland-terrain-4x", "contract id must be parkland-terrain-4x", errors);
  assert(contract?.theme === "parkland", "contract theme must be parkland", errors);
  assert(contract?.source?.externalProvider === "none", "4x fallback must not depend on an external provider", errors);
  assert(contract?.source?.referencePixelsCopied === false, "reference pixels must not be copied", errors);
  assert(contract?.source?.reviewStatus === "machine-contract-only", "4x source must remain machine-contract-only until human review", errors);
  assert(contract?.frame?.width === 256, "4x frame width must be 256", errors);
  assert(contract?.frame?.height === 128, "4x frame height must be 128", errors);
  assert(contract?.frame?.presentationScale === 4, "4x presentation scale must be 4", errors);
  assert(contract?.frame?.tileSpan === 4, "4x tile span must be 4", errors);
  assert(contract?.frame?.baseVariants === 6, "4x contract must provide six base variants", errors);
  assert(JSON.stringify(contract?.frame?.edgeDirections) === JSON.stringify(EDGE_DIRECTIONS), "4x edge directions are incomplete", errors);
  assert(JSON.stringify(contract?.frame?.cornerDirections) === JSON.stringify(CORNER_DIRECTIONS), "4x corner directions are incomplete", errors);
  assert(contract?.atlas?.gutterPx >= 1, "atlas gutter must be at least one pixel", errors);
  assert(contract?.fallback?.root === "src/assets/terrain/materials", "runtime fallback root must remain the shipped 2x material source", errors);
  assert(contract?.budgets?.sourceBytesMax > 0, "source byte budget is required", errors);
  assert(contract?.budgets?.atlasBytesMax > 0, "atlas byte budget is required", errors);
  assert(contract?.budgets?.selectedTransferBytesMax > 0, "selected transfer budget is required", errors);
  assert(existsSync(path.join(ROOT, contract?.fallback?.root ?? "")), "shipped 2x fallback source is missing", errors);
}

function validateSource(sourceRoot, contract, errors) {
  if (!existsSync(sourceRoot)) {
    return { status: "not-generated", files: 0, bytes: 0, duplicateHashes: [] };
  }
  const expected = new Set(expectedNames());
  const actual = new Set(readdirSync(sourceRoot).filter((name) => name.endsWith(".png")));
  const missing = [...expected].filter((name) => !actual.has(name));
  const extra = [...actual].filter((name) => !expected.has(name));
  assert(missing.length === 0, `4x source is missing ${missing.length} required frame(s)`, errors);
  assert(extra.length === 0, `4x source contains ${extra.length} unexpected frame(s)`, errors);

  const hashes = new Map();
  const duplicateHashes = [];
  let bytes = 0;
  for (const name of [...expected].filter((item) => actual.has(item)).sort()) {
    const file = path.join(sourceRoot, name);
    const buffer = readFileSync(file);
    bytes += buffer.length;
    let image;
    try {
      image = PNG.sync.read(buffer);
    } catch (error) {
      errors.push(`${name} is not a readable PNG: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    assert(image.width === contract.frame.width, `${name} width is ${image.width}, expected ${contract.frame.width}`, errors);
    assert(image.height === contract.frame.height, `${name} height is ${image.height}, expected ${contract.frame.height}`, errors);
    const digest = hash(buffer);
    const previous = hashes.get(digest);
    if (previous) {
      duplicateHashes.push({ digest, files: [previous, name] });
      errors.push(`${name} duplicates ${previous} byte-for-byte`);
    }
    hashes.set(digest, name);
    const alphaValues = [];
    for (let offset = 3; offset < image.data.length; offset += 4) alphaValues.push(image.data[offset]);
    const [, terrain, kind] = name.match(/^parkland_(.+)_(base|edge|outer|inner)_/) ?? [];
    assert(alphaValues.some((value) => value > 0), `${name} has no visible pixels`, errors);
    if (kind === "outer" || kind === "inner") {
      assert(alphaValues.some((value) => value === 0), `${name} corner frame has no transparent gutter`, errors);
    }
    if ((terrain === "water" || terrain === "wetland") && kind === "edge") {
      assert(alphaValues.some((value) => value > 0 && value < 255), `${name} water/wetland frame lacks partial-alpha edge detail`, errors);
    }
  }
  assert(bytes <= contract.budgets.sourceBytesMax, `4x source is ${bytesToMiB(bytes)} MiB; budget is ${bytesToMiB(contract.budgets.sourceBytesMax)} MiB`, errors);
  return {
    status: "generated",
    files: actual.size,
    bytes,
    duplicateHashes,
  };
}

export function auditParkland4x({ root = ROOT, sourceRoot } = {}) {
  const contractPath = path.join(root, "src/assets/terrain/contracts/parkland-4x.json");
  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  const errors = [];
  validateContract(contract, errors);
  const resolvedSourceRoot = sourceRoot
    ?? process.env.COURSECRAFT_PARKLAND_4X_ROOT
    ?? path.join(root, contract.source.root);
  const source = validateSource(resolvedSourceRoot, contract, errors);
  const result = {
    ok: errors.length === 0,
    contract: path.relative(root, contractPath).split(path.sep).join("/"),
    source: { ...source, root: path.relative(root, resolvedSourceRoot).split(path.sep).join("/") },
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
