import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test, { after } from "node:test";
import { PNG } from "pngjs";
import { auditParklandHabitat } from "./parkland-habitat-field-audit.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SOURCE = path.join(ROOT, "src/assets/terrain/parkland-habitat-4x");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const scratchDirectories = [];

function scratch(prefix) {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratchDirectories.push(directory);
  return directory;
}

after(() => {
  for (const directory of scratchDirectories) rmSync(directory, { recursive: true, force: true });
});

function writeManifest(root, manifest) {
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(root, "manifest.json"), bytes);
  writeFileSync(path.join(root, "manifest.sha256"), `${sha256(bytes)}  manifest.json\n`);
}

function generatedHashes(root, prefix = "") {
  const result = {};
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(result, generatedHashes(root, relative));
    else result[relative] = sha256(readFileSync(path.join(root, relative)));
  }
  return result;
}

test("generator is byte-identical across independent roots", () => {
  const first = scratch("parkland-habitat-determinism-a-");
  const second = scratch("parkland-habitat-determinism-b-");
  for (const output of [first, second]) {
    const generated = spawnSync(process.execPath, [path.join(ROOT, "scripts/gen-parkland-habitat-field.mjs")], {
      cwd: ROOT,
      env: { ...process.env, COURSECRAFT_HABITAT_OUTPUT_DIR: output },
      encoding: "utf8",
    });
    assert.equal(generated.status, 0, generated.stderr || generated.stdout);
  }
  assert.deepEqual(generatedHashes(first), generatedHashes(second));
  assert.deepEqual(generatedHashes(first), generatedHashes(SOURCE));
});

test("generated habitat field passes dimensions, alpha, gutters, topology, palette, tiers, provenance and budgets", () => {
  const result = auditParklandHabitat();
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.deepEqual(Object.fromEntries(Object.entries(result.tiers).map(([tier, value]) => [tier, value.frames])), { high: 89, medium: 89, low: 89 });
  assert.equal(Object.values(result.tiers).every((tier) => tier.uniqueFrameHashes === 89), true);
  for (const mode of ["standard", "deuteranopia", "protanopia", "tritanopia"]) {
    assert.equal(result.paletteTransforms[mode].mappedSourceColors, 20);
    assert.equal(Object.values(result.paletteTransforms[mode].tiers).every((tier) => tier.coveredFrames === 89 && tier.missingSourceColors.length === 0), true);
  }
});

test("validator rejects a corrupt atlas/frame hash", () => {
  const temp = scratch("parkland-habitat-corrupt-");
  cpSync(SOURCE, temp, { recursive: true });
  const imagePath = path.join(temp, "low/habitat-atlas.png");
  const image = PNG.sync.read(readFileSync(imagePath));
  image.data[0] ^= 255;
  writeFileSync(imagePath, PNG.sync.write(image));
  const result = auditParklandHabitat({ assetRoot: temp });
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.includes("atlas file hash mismatch")), true);
});

test("validator rejects dense pixels outside the projected tile diamond even when hashes are valid", () => {
  const temp = scratch("parkland-habitat-containment-");
  cpSync(SOURCE, temp, { recursive: true });
  const manifest = JSON.parse(readFileSync(path.join(temp, "manifest.json"), "utf8"));
  const tier = manifest.tiers.low;
  const imagePath = path.join(temp, tier.image);
  const jsonPath = path.join(temp, tier.json);
  const atlas = PNG.sync.read(readFileSync(imagePath));
  const atlasJson = JSON.parse(readFileSync(jsonPath, "utf8"));
  const id = "woodland_floor--mask-00-0";
  const frame = atlasJson.frames[id].frame;
  const corner = (frame.y * atlas.width + frame.x) * 4;
  atlas.data[corner] = 83; atlas.data[corner + 1] = 77; atlas.data[corner + 2] = 41; atlas.data[corner + 3] = 255;
  const imageBytes = PNG.sync.write(atlas, { deflateLevel: 9, deflateStrategy: 0 });
  writeFileSync(imagePath, imageBytes);

  const region = Buffer.alloc(frame.width * frame.height * 4); let cursor = 0;
  for (let y = 0; y < frame.height; y += 1) for (let x = 0; x < frame.width; x += 1) {
    const source = ((frame.y + y) * atlas.width + frame.x + x) * 4;
    for (let channel = 0; channel < 4; channel += 1) region[cursor++] = atlas.data[source + channel];
  }
  const sourceSha256 = sha256(region);
  atlasJson.frames[id].sourceSha256 = sourceSha256;
  tier.frames[id].sourceSha256 = sourceSha256;
  const jsonBytes = Buffer.from(`${JSON.stringify(atlasJson, null, 2)}\n`);
  writeFileSync(jsonPath, jsonBytes);
  tier.imageBytes = imageBytes.length; tier.imageSha256 = sha256(imageBytes);
  tier.jsonBytes = jsonBytes.length; tier.jsonSha256 = sha256(jsonBytes);
  writeManifest(temp, manifest);

  const result = auditParklandHabitat({ assetRoot: temp });
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.includes("visible pixels outside its projected tile diamond")), true);
});

test("validator rejects manifest provenance drift", () => {
  const temp = scratch("parkland-habitat-provenance-");
  cpSync(SOURCE, temp, { recursive: true });
  const manifestPath = path.join(temp, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.source.referencePixelsCopied = true;
  writeManifest(temp, manifest);
  const result = auditParklandHabitat({ assetRoot: temp });
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.includes("copied reference pixels")), true);
});

test("validator rejects collapsed color-vision mappings even with a valid manifest hash", () => {
  const temp = scratch("parkland-habitat-collapsed-");
  cpSync(SOURCE, temp, { recursive: true });
  const manifest = JSON.parse(readFileSync(path.join(temp, "manifest.json"), "utf8"));
  for (const mode of ["deuteranopia", "protanopia", "tritanopia"]) {
    for (const family of Object.values(manifest.paletteTransforms[mode])) {
      for (const mapping of family.mappings) mapping.to = [0, 0, 0];
    }
  }
  writeManifest(temp, manifest);
  const result = auditParklandHabitat({ assetRoot: temp });
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.includes("collapsed [0,0,0]")), true);
  assert.equal(result.errors.some((error) => error.includes("mapped colors must remain distinct")), true);
});

test("validator rejects an incomplete per-source-color transform across every tier", () => {
  const temp = scratch("parkland-habitat-incomplete-");
  cpSync(SOURCE, temp, { recursive: true });
  const manifest = JSON.parse(readFileSync(path.join(temp, "manifest.json"), "utf8"));
  manifest.paletteTransforms.deuteranopia.woodland_floor.mappings.pop();
  writeManifest(temp, manifest);
  const result = auditParklandHabitat({ assetRoot: temp });
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.includes("must map exactly four source colors")), true);
  assert.equal(result.errors.some((error) => error.includes("transform is missing source colors")), true);
  assert.equal(["high", "medium", "low"].every((tier) => result.paletteTransforms.deuteranopia.tiers[tier].coveredFrames < 89), true);
});

test("validator rejects indistinguishable semantic families and missing modes", () => {
  const collapsed = scratch("parkland-habitat-family-collapse-");
  cpSync(SOURCE, collapsed, { recursive: true });
  const manifest = JSON.parse(readFileSync(path.join(collapsed, "manifest.json"), "utf8"));
  const sharedTargets = manifest.paletteTransforms.tritanopia.woodland_floor.mappings.map((mapping) => mapping.to);
  for (const family of Object.values(manifest.paletteTransforms.tritanopia)) family.mappings.forEach((mapping, index) => { mapping.to = sharedTargets[index]; });
  writeManifest(collapsed, manifest);
  const collapsedResult = auditParklandHabitat({ assetRoot: collapsed });
  assert.equal(collapsedResult.ok, false);
  assert.equal(collapsedResult.errors.some((error) => error.includes("semantic families") && error.includes("indistinguishable")), true);

  const missing = scratch("parkland-habitat-missing-mode-");
  cpSync(SOURCE, missing, { recursive: true });
  const missingManifest = JSON.parse(readFileSync(path.join(missing, "manifest.json"), "utf8"));
  delete missingManifest.paletteTransforms.protanopia;
  writeManifest(missing, missingManifest);
  const missingResult = auditParklandHabitat({ assetRoot: missing });
  assert.equal(missingResult.ok, false);
  assert.equal(missingResult.errors.some((error) => error.includes("palette transforms must contain exactly")), true);
  assert.equal(missingResult.errors.some((error) => error.includes("protanopia transform must cover every family")), true);
});
