import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workflowPath = fileURLToPath(new URL("../../.github/workflows/desktop-smoke.yml", import.meta.url));
const sourceManifestPath = fileURLToPath(new URL("../src/assets/terrain/parkland-4x/manifest.json", import.meta.url));
const runtimeManifestPath = fileURLToPath(new URL("../public/atlases/biomes/manifest.json", import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const stepName = "      - name: Disable Windows checkout newline conversion";
const verificationName = "      - name: Verify checkout source bytes";

function hasPrecheckoutNormalization(workflow) {
  const start = workflow.indexOf(stepName);
  const checkout = workflow.indexOf("      - uses: actions/checkout@v4");
  if (start === -1 || checkout === -1 || start >= checkout) return false;
  const nextStep = workflow.indexOf("\n      - ", start + stepName.length);
  const step = workflow.slice(start, nextStep === -1 ? undefined : nextStep);
  return /\n        if: runner\.os == 'Windows'\n/.test(step)
    && /\n        shell: bash\n/.test(step)
    && /\n        working-directory: \$\{\{ github\.workspace \}\}\n/.test(step)
    && /\n        run: git config --global core\.autocrlf false(?:\n|$)/.test(step);
}

function sourceBytesMatchRuntimeContract(sourceBytes, runtimeManifest) {
  if (sourceBytes.includes(0x0d)) return false;
  const sourceHash = hash(sourceBytes);
  if (sourceHash !== runtimeManifest.assetContracts.parklandTerrain.sourceManifestSha256) return false;
  const windowsConverted = Buffer.from(sourceBytes.toString("utf8").replace(/\n/g, "\r\n"));
  return hash(windowsConverted) !== sourceHash;
}

function hasPostInstallSourceByteVerification(workflow) {
  const npmCi = workflow.indexOf("      - run: npm ci");
  const verification = workflow.indexOf(verificationName);
  const desktopTests = workflow.indexOf("      - run: npm run test:desktop");
  if (npmCi === -1 || verification === -1 || desktopTests === -1 || !(npmCi < verification && verification < desktopTests)) return false;
  const nextStep = workflow.indexOf("\n      - ", verification + verificationName.length);
  const step = workflow.slice(verification, nextStep === -1 ? undefined : nextStep);
  return /\n        run: node --test scripts\/desktop-smoke-workflow\.test\.mjs(?:\n|$)/.test(step);
}

test("Windows disables newline conversion before desktop smoke checkout", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  assert.equal(hasPrecheckoutNormalization(workflow), true);

  const start = workflow.indexOf(stepName);
  const nextStep = workflow.indexOf("\n      - ", start + stepName.length);
  const checkout = workflow.indexOf("      - uses: actions/checkout@v4");
  const step = workflow.slice(start, nextStep);
  const variants = [
    workflow.replace(`${step}\n`, ""),
    workflow.replace(`${step}\n`, "").replace("      - uses: actions/checkout@v4", `      - uses: actions/checkout@v4\n${step}`),
    workflow.replace("if: runner.os == 'Windows'", "if: runner.os == 'macOS'"),
    workflow.replace("        shell: bash\n", ""),
    workflow.replace("working-directory: ${{ github.workspace }}", "working-directory: simgolf-lite"),
    workflow.replace("git config --global core.autocrlf false", "git config --global core.autocrlf true"),
  ];
  assert.equal(checkout > start, true);
  for (const [index, variant] of variants.entries()) {
    assert.equal(hasPrecheckoutNormalization(variant), false, `workflow inverse ${index + 1} must fail the guard`);
  }
});

test("desktop smoke runs the source-byte gate after npm ci and before desktop tests", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  assert.equal(hasPostInstallSourceByteVerification(workflow), true);

  const start = workflow.indexOf(verificationName);
  const nextStep = workflow.indexOf("\n      - ", start + verificationName.length);
  const step = workflow.slice(start, nextStep);
  const variants = [
    workflow.replace(`${step}\n`, ""),
    workflow.replace("node --test scripts/desktop-smoke-workflow.test.mjs", "node --test scripts/other.test.mjs"),
    workflow.replace(`${step}\n`, "").replace("      - run: npm ci", `${step}\n      - run: npm ci`),
  ];
  for (const [index, variant] of variants.entries()) {
    assert.equal(hasPostInstallSourceByteVerification(variant), false, `consumer wiring inverse ${index + 1} must fail the guard`);
  }
});

test("the Parkland source-manifest hash is byte-sensitive to LF-to-CRLF conversion", () => {
  const sourceBytes = readFileSync(sourceManifestPath);
  const runtimeManifest = JSON.parse(readFileSync(runtimeManifestPath, "utf8"));
  assert.equal(sourceBytesMatchRuntimeContract(sourceBytes, runtimeManifest), true);

  const windowsConverted = Buffer.from(sourceBytes.toString("utf8").replace(/\n/g, "\r\n"));
  assert.equal(sourceBytesMatchRuntimeContract(windowsConverted, runtimeManifest), false);
});
