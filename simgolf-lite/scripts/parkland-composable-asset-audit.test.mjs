import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { auditParklandComposable } from "./parkland-composable-asset-audit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GENERATOR = path.join(ROOT, "scripts/gen-parkland-composable-assets.mjs");
const SOURCE = path.join(ROOT, "src/assets/terrain/parkland-composable-v1");
const EVIDENCE = process.env.COURSECRAFT_COMPOSABLE_EVIDENCE_DIR
  || "/private/tmp/zk463-composable-assets-attempt2-evidence";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function generate(root, evidence = "") {
  const result = spawnSync(process.execPath, [GENERATOR], {
    cwd: ROOT,
    env: { ...process.env, COURSECRAFT_COMPOSABLE_OUTPUT_DIR: root, COURSECRAFT_COMPOSABLE_EVIDENCE_DIR: evidence },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function filesRecursively(root, prefix = "") {
  return readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(prefix, entry.name);
    return entry.isDirectory() ? filesRecursively(root, relative) : [relative];
  }).sort();
}

function refreshManifestEntry(root, relative, bytes, extra = {}) {
  const manifestFile = path.join(root, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  Object.assign(manifest.files[relative], { bytes: bytes.length, sha256: sha256(bytes), ...extra });
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
}

test("Parkland composable source passes the complete attempt-2 machine contract", () => {
  const result = auditParklandComposable({ evidenceRoot: EVIDENCE });
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.source.files, 270);
  assert.ok(result.source.bytes < 4 * 1024 * 1024);
  assert.deepEqual(Object.keys(result.surfaces), ["high", "medium", "low"]);
  for (const quality of ["high", "medium", "low"]) {
    const surfaces = result.surfaces[quality];
    assert.ok(surfaces.minimumCentroidDistance >= 5);
    assert.ok(surfaces.minimumPatternDistance >= 0.04);
    assert.ok(surfaces.roughUndercoatRgbDistance >= 10);
    assert.ok(surfaces.roughFairwayRgbDistance >= 15);
    assert.ok(surfaces.deep_rough.maximumDiagonalAutocorrelation <= 0.36);
    assert.equal(result.pairs[quality].edges, 40);
    assert.equal(result.pairs[quality].corners, 40);
    assert.ok(result.pairs[quality].minimumCornerOverlap > 0);
    assert.ok(result.pairs[quality].maximumInteriorDepth <= 0.24);
    for (const hazard of ["water", "sand", "bunker", "shore"]) {
      assert.equal(result.hazards[quality][hazard].components, 1);
      assert.ok(result.hazards[quality][hazard].radialVariance >= 0.001);
    }
  }
  for (const semantic of ["fairway", "rough", "deep_rough", "green", "tee"]) {
    assert.ok(result.tiers[semantic].highMedium >= 1);
    assert.ok(result.tiers[semantic].mediumLow >= 1);
    assert.ok(result.tiers[semantic].highLow >= 2);
  }
  assert.equal(result.evidence.files, 16);
  assert.equal(result.evidence.rawAssets, 80);
  assert.equal(result.evidence.pairAssemblies, 10);
});

test("generator is byte-identical in two independent roots", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "parkland-composable-repeat-"));
  try {
    const first = path.join(temp, "first"); const second = path.join(temp, "second");
    generate(first); generate(second);
    const firstFiles = filesRecursively(first); const secondFiles = filesRecursively(second);
    assert.deepEqual(firstFiles, secondFiles);
    assert.equal(firstFiles.length, 271);
    for (const relative of firstFiles) {
      assert.deepEqual(readFileSync(path.join(first, relative)), readFileSync(path.join(second, relative)), relative);
    }
    const firstAudit = auditParklandComposable({ sourceRoot: first });
    const secondAudit = auditParklandComposable({ sourceRoot: second });
    assert.equal(firstAudit.ok, true, firstAudit.errors.join("\n"));
    assert.equal(secondAudit.ok, true, secondAudit.errors.join("\n"));
    assert.equal(firstAudit.source.manifestSha256, secondAudit.source.manifestSha256);
    assert.equal(firstAudit.source.manifestSha256, sha256(readFileSync(path.join(first, "manifest.json"))));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("audit rejects a manifest-valid half-edge that leaks into the cell interior", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "parkland-composable-negative-"));
  try {
    generate(temp);
    const relative = "low/edge-fairway--rough-n.png";
    const file = path.join(temp, relative);
    const image = PNG.sync.read(readFileSync(file));
    const x = Math.floor(image.width / 2); const y = Math.floor(image.height / 2);
    const offset = (y * image.width + x) * 4;
    image.data[offset] = 255; image.data[offset + 1] = 0; image.data[offset + 2] = 255; image.data[offset + 3] = 255;
    const bytes = PNG.sync.write(image, { deflateLevel: 9, deflateStrategy: 0 });
    writeFileSync(file, bytes); refreshManifestEntry(temp, relative, bytes);
    assert.equal(statSync(file).size, bytes.length);
    const result = auditParklandComposable({ sourceRoot: temp });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /leaks alpha into the cell interior/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("audit rejects a manifest-valid crossed-harmonic lozenge field", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "parkland-composable-lozenge-"));
  try {
    generate(temp);
    const relative = "high/semantic-deep_rough.png"; const file = path.join(temp, relative);
    const image = PNG.sync.read(readFileSync(file));
    for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
      const u = x / (image.width - 1); const v = y / (image.height - 1);
      const crossed = Math.max(Math.sin((u * 7 + v * 5) * Math.PI * 2), Math.sin((u * 5 - v * 7) * Math.PI * 2));
      image.data[(y * image.width + x) * 4 + 3] = crossed > 0.25 ? 160 : 48;
    }
    const bytes = PNG.sync.write(image, { deflateLevel: 9, deflateStrategy: 0 });
    writeFileSync(file, bytes); refreshManifestEntry(temp, relative, bytes, { intendedOpacityRange: [48, 160] });
    const result = auditParklandComposable({ sourceRoot: temp });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /repeated diagonal\/lozenge lattice/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("proof-support audit rejects opaque diamond backing claims", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "parkland-composable-proof-negative-"));
  try {
    const source = path.join(temp, "source"); const evidence = path.join(temp, "evidence");
    generate(source, evidence);
    const supportFile = path.join(evidence, "proof-support.json");
    const support = JSON.parse(readFileSync(supportFile, "utf8"));
    support.rawAlphaProof.opaqueDiamondBacking = true;
    const supportBytes = Buffer.from(`${JSON.stringify(support, null, 2)}\n`);
    writeFileSync(supportFile, supportBytes);
    const evidenceManifestFile = path.join(evidence, "evidence-manifest.json");
    const evidenceManifest = JSON.parse(readFileSync(evidenceManifestFile, "utf8"));
    evidenceManifest.files["proof-support.json"].bytes = supportBytes.length;
    evidenceManifest.files["proof-support.json"].sha256 = sha256(supportBytes);
    writeFileSync(evidenceManifestFile, `${JSON.stringify(evidenceManifest, null, 2)}\n`);
    const result = auditParklandComposable({ sourceRoot: source, evidenceRoot: evidence });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /opaque diamond backing/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("tracked source manifest covers only the Parkland sidecar", () => {
  const manifest = JSON.parse(readFileSync(path.join(SOURCE, "manifest.json"), "utf8"));
  assert.equal(manifest.id, "parkland-composable-material-source-v1");
  assert.equal(manifest.provenance.author, "CourseCraft");
  assert.equal(manifest.provenance.externalProvider, "none");
  assert.equal(manifest.provenance.referencePixelsCopied, false);
  assert.equal(Object.keys(manifest.files).length, 270);
  assert.ok(Object.keys(manifest.files).every((file) => /^(high|medium|low)\//.test(file)));
});
