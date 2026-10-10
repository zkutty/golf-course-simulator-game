import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const producerPath = fileURLToPath(new URL("../e2e/zk682-resource-growth.e2e.ts", import.meta.url));
const canonicalProducerSha256 = "226e30683cd03aaf2b1441af6366f137c1e9241f33a6b9a41810101d3eb145da";
const inverseLines = [
  '  trace: "off",\n',
  '  video: "off",\n',
  '  screenshot: "off",\n',
];

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function extractRegistration(source) {
  const matches = [...source.matchAll(/test\.use\(\s*(\{[\s\S]*?\})\s*\);/g)];
  assert.equal(matches.length, 1, "producer must retain exactly one test.use registration");
  return matches[0][1];
}

function evaluateRegistration(registration) {
  return vm.runInNewContext(`(${registration})`);
}

function assertPolicy(source) {
  const registration = extractRegistration(source);
  for (const key of ["trace", "video", "screenshot"]) {
    const declarations = [...registration.matchAll(new RegExp(`^\\s*${key}\\s*:`, "gm"))];
    assert.equal(declarations.length, 1, `${key} must be declared exactly once`);
  }
  const config = evaluateRegistration(registration);
  for (const key of ["trace", "video", "screenshot"]) {
    assert.equal(config[key], "off", `${key} must be off`);
  }
  assert.equal(JSON.stringify(config.launchOptions), JSON.stringify({ args: ["--enable-precise-memory-info"] }),
    "precise-memory launch argument must remain unchanged");
}

function inverseRecordingOptions(source) {
  let restored = source;
  for (const line of inverseLines) {
    assert.equal(restored.split(line).length - 1, 1, `inverse must remove exactly one ${line.trim()} line`);
    restored = restored.replace(line, "");
  }
  return restored;
}

const candidate = await readFile(producerPath, "utf8");

test("actual canonical baseline is RED for the selected recording policy", () => {
  const actualBaseline = inverseRecordingOptions(candidate);
  assert.equal(sha256(actualBaseline), canonicalProducerSha256,
    "baseline must be the byte-exact canonical ab8 producer");
  assert.throws(() => assertPolicy(actualBaseline), /trace must be declared exactly once/);
});

test("actual producer registration disables automatic recordings and preserves launch args", () => {
  assertPolicy(candidate);
});

test("removing exactly the three options restores canonical ab8 producer bytes", () => {
  assert.equal(sha256(inverseRecordingOptions(candidate)), canonicalProducerSha256);
});

test("missing and duplicate recording options are rejected", () => {
  const missing = candidate.replace('  screenshot: "off",\n', "");
  assert.throws(() => assertPolicy(missing), /screenshot must be declared exactly once/);
  const duplicate = candidate.replace('  trace: "off",\n', '  trace: "off",\n  trace: "off",\n');
  assert.throws(() => assertPolicy(duplicate), /trace must be declared exactly once/);
});

test("altered precise-memory launch argument is rejected", () => {
  const altered = candidate.replace("--enable-precise-memory-info", "--disable-precise-memory-info");
  assert.throws(() => assertPolicy(altered), /precise-memory launch argument must remain unchanged/);
});

test("a producer-body edit fails the immutable inverse control", () => {
  const altered = candidate.replace("  test.slow();", "  test.setTimeout(90_000);");
  assert.notEqual(altered, candidate);
  assert.notEqual(sha256(inverseRecordingOptions(altered)), canonicalProducerSha256);
});
