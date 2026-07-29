import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditParkland4x } from "./parkland-4x-asset-audit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generator = path.join(ROOT, "scripts/gen-parkland-4x-fallback.mjs");

function generate(root, name) {
  const output = path.join(root, name);
  const result = spawnSync(process.execPath, [generator], {
    cwd: ROOT,
    env: { ...process.env, COURSECRAFT_TERRAIN_OUTPUT_DIR: output },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return output;
}

test("Parkland 4x contract keeps generated source review-only and validates the shipped fallback", () => {
  const result = auditParkland4x();
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.source.status, "not-generated");
  assert.equal(result.source.files, 0);
  assert.deepEqual(Object.keys(result.runtime), ["high", "medium", "low"]);
  assert.equal(result.runtime.high.terrainFrames, 180);
  assert.equal(result.runtime.medium.detailFrames, 10);
  assert.equal(result.runtime.low.detailFrames, 0);
});

test("Parkland 4x generator produces repeatable SHA-256 manifests for every required frame", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "parkland-4x-audit-"));
  try {
    const first = generate(temp, "first");
    const second = generate(temp, "second");
    const firstAudit = auditParkland4x({ sourceRoot: first });
    const secondAudit = auditParkland4x({ sourceRoot: second });
    assert.equal(firstAudit.ok, true, firstAudit.errors.join("\n"));
    assert.equal(secondAudit.ok, true, secondAudit.errors.join("\n"));
    assert.equal(firstAudit.source.files, 180);
    assert.equal(firstAudit.source.hash, secondAudit.source.hash);
    assert.equal(
      readFileSync(path.join(first, "manifest.json"), "utf8"),
      readFileSync(path.join(second, "manifest.json"), "utf8"),
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("Parkland 4x audit rejects duplicate frames even when their manifest is present", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "parkland-4x-audit-"));
  try {
    const source = generate(temp, "source");
    const from = path.join(source, "parkland_fairway_base_0.png");
    const to = path.join(source, "parkland_fairway_base_1.png");
    cpSync(from, to);
    const result = auditParkland4x({ sourceRoot: source });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /SHA-256 does not match|duplicates/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
