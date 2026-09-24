import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import { auditParklandHabitat } from "./parkland-habitat-field-audit.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SOURCE = path.join(ROOT, "src/assets/terrain/parkland-habitat-4x");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function writeManifest(root, manifest) {
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(root, "manifest.json"), bytes);
  writeFileSync(path.join(root, "manifest.sha256"), `${sha256(bytes)}  manifest.json\n`);
}

test("generated habitat field passes dimensions, alpha, gutters, topology, palette, tiers, provenance and budgets", () => {
  const result = auditParklandHabitat();
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.deepEqual(Object.fromEntries(Object.entries(result.tiers).map(([tier, value]) => [tier, value.frames])), { high: 95, medium: 95, low: 95 });
  assert.equal(Object.values(result.tiers).every((tier) => tier.uniqueFrameHashes === 95), true);
  for (const mode of ["standard", "deuteranopia", "protanopia", "tritanopia"]) {
    assert.equal(result.paletteTransforms[mode].mappedSourceColors, 20);
    assert.equal(Object.values(result.paletteTransforms[mode].tiers).every((tier) => tier.coveredFrames === 95 && tier.missingSourceColors.length === 0), true);
  }
});

test("validator rejects a corrupt atlas/frame hash", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "parkland-habitat-corrupt-"));
  cpSync(SOURCE, temp, { recursive: true });
  const imagePath = path.join(temp, "low/habitat-atlas.png");
  const image = PNG.sync.read(readFileSync(imagePath));
  image.data[0] ^= 255;
  writeFileSync(imagePath, PNG.sync.write(image));
  const result = auditParklandHabitat({ assetRoot: temp });
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.includes("atlas file hash mismatch")), true);
});

test("validator rejects manifest provenance drift", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "parkland-habitat-provenance-"));
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
  const temp = mkdtempSync(path.join(os.tmpdir(), "parkland-habitat-collapsed-"));
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
  const temp = mkdtempSync(path.join(os.tmpdir(), "parkland-habitat-incomplete-"));
  cpSync(SOURCE, temp, { recursive: true });
  const manifest = JSON.parse(readFileSync(path.join(temp, "manifest.json"), "utf8"));
  manifest.paletteTransforms.deuteranopia.woodland_floor.mappings.pop();
  writeManifest(temp, manifest);
  const result = auditParklandHabitat({ assetRoot: temp });
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.includes("must map exactly four source colors")), true);
  assert.equal(result.errors.some((error) => error.includes("transform is missing source colors")), true);
  assert.equal(["high", "medium", "low"].every((tier) => result.paletteTransforms.deuteranopia.tiers[tier].coveredFrames < 95), true);
});

test("validator rejects indistinguishable semantic families and missing modes", () => {
  const collapsed = mkdtempSync(path.join(os.tmpdir(), "parkland-habitat-family-collapse-"));
  cpSync(SOURCE, collapsed, { recursive: true });
  const manifest = JSON.parse(readFileSync(path.join(collapsed, "manifest.json"), "utf8"));
  const sharedTargets = manifest.paletteTransforms.tritanopia.woodland_floor.mappings.map((mapping) => mapping.to);
  for (const family of Object.values(manifest.paletteTransforms.tritanopia)) family.mappings.forEach((mapping, index) => { mapping.to = sharedTargets[index]; });
  writeManifest(collapsed, manifest);
  const collapsedResult = auditParklandHabitat({ assetRoot: collapsed });
  assert.equal(collapsedResult.ok, false);
  assert.equal(collapsedResult.errors.some((error) => error.includes("semantic families") && error.includes("indistinguishable")), true);

  const missing = mkdtempSync(path.join(os.tmpdir(), "parkland-habitat-missing-mode-"));
  cpSync(SOURCE, missing, { recursive: true });
  const missingManifest = JSON.parse(readFileSync(path.join(missing, "manifest.json"), "utf8"));
  delete missingManifest.paletteTransforms.protanopia;
  writeManifest(missing, missingManifest);
  const missingResult = auditParklandHabitat({ assetRoot: missing });
  assert.equal(missingResult.ok, false);
  assert.equal(missingResult.errors.some((error) => error.includes("palette transforms must contain exactly")), true);
  assert.equal(missingResult.errors.some((error) => error.includes("protanopia transform must cover every family")), true);
});
