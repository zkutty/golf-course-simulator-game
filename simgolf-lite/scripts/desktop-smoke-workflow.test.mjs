import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workflowPath = fileURLToPath(new URL("../../.github/workflows/desktop-smoke.yml", import.meta.url));
const sourceManifestPath = fileURLToPath(new URL("../src/assets/terrain/parkland-4x/manifest.json", import.meta.url));
const runtimeManifestPath = fileURLToPath(new URL("../public/atlases/biomes/manifest.json", import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("Windows disables newline conversion before desktop smoke checkout", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const normalization = workflow.indexOf("- name: Disable Windows checkout newline conversion");
  const checkout = workflow.indexOf("- uses: actions/checkout@v4");
  assert.notEqual(normalization, -1);
  assert.notEqual(checkout, -1);
  assert(normalization < checkout, "Windows newline normalization must run before checkout");
  assert.match(workflow.slice(normalization, checkout), /if: runner\.os == 'Windows'[\s\S]*?working-directory: \$\{\{ github\.workspace \}\}[\s\S]*?git config --global core\.autocrlf false/);
});

test("the Parkland source-manifest hash is byte-sensitive to LF-to-CRLF conversion", () => {
  const sourceBytes = readFileSync(sourceManifestPath);
  const runtimeManifest = JSON.parse(readFileSync(runtimeManifestPath, "utf8"));
  assert.equal(sourceBytes.includes(0x0d), false, "committed source manifest must be LF-only");
  assert.equal(
    hash(sourceBytes),
    runtimeManifest.assetContracts.parklandTerrain.sourceManifestSha256,
    "runtime contract must bind the committed source bytes",
  );
  const windowsConverted = Buffer.from(sourceBytes.toString("utf8").replace(/\n/g, "\r\n"));
  assert.notEqual(hash(windowsConverted), hash(sourceBytes));
});
