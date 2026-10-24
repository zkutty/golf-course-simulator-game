import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createStabilityProducer, sampleRetainedHeap, stabilityProducerKind,
  validateStabilityProducer, validateStabilityRuntime, ZK682_STABILITY_FIXTURE,
} from "./zk682-stability-producer.mjs";
import { parseStabilityArguments, quoteStabilityShellArgument, stabilityCommands, stabilityPreviewCommand, stabilitySourceProblems, validateStabilityOutputDirectory } from "./zk682-run-stability.mjs";

import { e2eCommands } from "./run-e2e.mjs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const commit = "a".repeat(40);
const buildId = "12345678-1234-1234-1234-123456789abc";
const runtime = () => ({ dev: false, prod: true, mode: "e2e", commit, buildId, privatePerfFixture: true, fixture: { ...ZK682_STABILITY_FIXTURE } });

test("the exact sampler settles before one GC and reads immediately after its completed reply", async () => {
  const calls = [];
  let finishGC;
  const gcReply = new Promise(resolve => { finishGC = resolve; });
  const page = { async waitForTimeout(ms) { calls.push(["settle", ms]); } };
  const heap = { usedSize: 12345, totalSize: 45678 };
  const cdp = { async send(command) { calls.push([command]); if (command === "HeapProfiler.collectGarbage") await gcReply; else return heap; } };
  const pending = sampleRetainedHeap(page, cdp);
  await Promise.resolve();
  assert.deepEqual(calls, [["settle", 120], ["HeapProfiler.collectGarbage"]]);
  finishGC();
  assert.equal(await pending, heap);
  assert.deepEqual(calls, [["settle", 120], ["HeapProfiler.collectGarbage"], ["Runtime.getHeapUsage"]]);
});

test("failed settle or GC never yields a heap sample and transport errors propagate", async () => {
  const sentinel = new Error("transport");
  for (const failed of ["settle", "HeapProfiler.collectGarbage", "Runtime.getHeapUsage"]) {
    const calls = [];
    const page = { async waitForTimeout() { calls.push("settle"); if (failed === "settle") throw sentinel; } };
    const cdp = { async send(command) { calls.push(command); if (command === failed) throw sentinel; } };
    await assert.rejects(sampleRetainedHeap(page, cdp), error => error === sentinel);
    assert.deepEqual(calls, ["settle", "HeapProfiler.collectGarbage", "Runtime.getHeapUsage"].slice(0, ["settle", "HeapProfiler.collectGarbage", "Runtime.getHeapUsage"].indexOf(failed) + 1));
  }
});

test("runtime attestation rejects dev, stale source/build, missing permission and a different fixture", () => {
  assert.deepEqual(validateStabilityRuntime(runtime(), commit, buildId), []);
  const invalid = [
    { ...runtime(), dev: true, prod: false }, { ...runtime(), mode: "production" },
    { ...runtime(), commit: "b".repeat(40) }, { ...runtime(), buildId: "87654321-1234-1234-1234-123456789abc" },
    { ...runtime(), privatePerfFixture: false }, { ...runtime(), fixture: null },
    { ...runtime(), fixture: { ...ZK682_STABILITY_FIXTURE, id: "another-fixture" } },
    { ...runtime(), fixture: { ...ZK682_STABILITY_FIXTURE, holes: 36 } },
  ];
  for (const value of invalid) {
    assert.ok(validateStabilityRuntime(value, commit, buildId).length > 0);
    assert.throws(() => createStabilityProducer(value, commit, buildId));
  }
});

test("producer identity cannot claim a different sampling method or runtime and legacy remains legacy", () => {
  const producer = createStabilityProducer(runtime(), commit, buildId);
  assert.deepEqual(validateStabilityProducer(producer, commit), []);
  for (const change of [{ producerVersion: "legacy" }, { heapMethod: "gc-delay-120ms-runtime" }, { buildMode: "vite-dev" }, { runtime: { ...runtime(), dev: true } }, { buildId: "87654321-1234-1234-1234-123456789abc" }]) {
    assert.ok(validateStabilityProducer({ ...producer, ...change }, commit).length > 0);
  }
  assert.equal(stabilityProducerKind({ schemaVersion: 2 }), "legacy-unattested-producer");
  assert.equal(Object.hasOwn({ schemaVersion: 2 }, "producer"), false);
});

test("runner uses the executing Node for the dedicated production build and zero-retry config", () => {
  assert.deepEqual(parseStabilityArguments(["--expected-commit", commit, "--output-dir", "/tmp/report"]), { "--expected-commit": commit, "--output-dir": "/tmp/report" });
  for (const args of [["--expected-commit"], ["--unknown", "x"], ["--output-dir", "x", "--output-dir", "y"]]) assert.throws(() => parseStabilityArguments(args));
  const commands = stabilityCommands("/a/node22", "/app", "/tmp/fresh-build");
  assert.deepEqual(commands.build, ["/a/node22", "/app/node_modules/vite/bin/vite.js", "build", "--mode", "e2e", "--outDir", "/tmp/fresh-build", "--emptyOutDir"]);
  assert.deepEqual(commands.test, ["/a/node22", "/app/node_modules/@playwright/test/cli.js", "test", "--config", "playwright.stability.config.ts", "--workers=1", "--retries=0"]);
});

test("actual App fixture gate excludes normal production and permits only the private perfFixture URL", () => {
  const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const begin = source.indexOf('    if ((!import.meta.env.DEV && !(import.meta.env.MODE === "e2e"');
  const end = source.indexOf('    const isM19Fixture', begin);
  assert.ok(begin > 0 && end > begin);
  const gate = source.slice(begin, end);
  const permitted = (dev, mode, privateFlag, query) => {
    const code = gate.replaceAll("import.meta.env.DEV", JSON.stringify(dev)).replaceAll("import.meta.env.MODE", JSON.stringify(mode)).replaceAll("import.meta.env.VITE_ZK682_STABILITY_FIXTURE", JSON.stringify(privateFlag));
    return new Function("window", "perfFixtureLoadedRef", `${code}\nreturn true;`)({ location: { search: query } }, { current: false }) === true;
  };
  assert.equal(permitted(false, "production", "1", "?perfFixture=1"), false);
  assert.equal(permitted(false, "e2e", "", "?perfFixture=1"), false);
  assert.equal(permitted(false, "e2e", "1", "?m19Fixture=1"), false);
  assert.equal(permitted(false, "e2e", "1", "?perfFixture=1&m19Fixture=1"), false);
  assert.equal(permitted(false, "e2e", "1", "?perfFixture=1"), true);
  assert.equal(permitted(true, "e2e", "", "?m19Fixture=1"), true);
});


test("candidate provenance exempts only declared reports, never tracked or untracked source", () => {
  const prefix = "simgolf-lite/";
  assert.deepEqual(stabilitySourceProblems([prefix + "artifacts/m35/asset-audit.json", prefix + "artifacts/m28/performance-parkland.json"], [prefix + "artifacts/zk682/raw/report.json", prefix + "artifacts/zk682/raw/playwright/trace.zip"], prefix), []);
  for (const file of ["src/App.tsx", "scripts/zk682-run-stability.mjs", "public/atlas.png", "package.json", "vite.config.ts", "artifacts/zk682/raw/tracked.json"]) {
    assert.equal(stabilitySourceProblems([prefix + file], [], prefix).length, 1);
  }
  for (const file of ["src/extra.ts", "scripts/extra.mjs", "vite.stale.config.ts", "artifacts/zk682/raw/inject.js", "artifacts/elsewhere/report.json"]) {
    assert.equal(stabilitySourceProblems([], [prefix + file], prefix).length, 1);
  }
  const app = realpathSync(new URL("../", import.meta.url));
  const repo = resolve(app, "..");
  assert.equal(validateStabilityOutputDirectory(app, repo, resolve(app, "artifacts/zk682/raw/run")), resolve(app, "artifacts/zk682/raw/run"));
  assert.equal(validateStabilityOutputDirectory(app, repo, resolve(realpathSync(tmpdir()), "stability-report")), resolve(realpathSync(tmpdir()), "stability-report"));
  for (const path of ["src", "scripts", "public", "configuration", "artifacts/other"]) assert.throws(() => validateStabilityOutputDirectory(app, repo, resolve(app, path)));
});

test("preview executable and arguments preserve paths with spaces on POSIX and Windows", () => {
  assert.equal(quoteStabilityShellArgument("/a path/it's node", "linux"), "'/a path/it'\\''s node'");
  const windows = stabilityPreviewCommand("C:\\Program Files\\nodejs\\node.exe", "C:\\my project\\vite.js", "C:\\Temp\\fresh build", 4176, "win32");
  assert.ok(windows.startsWith('"C:\\Program Files\\nodejs\\node.exe" "C:\\my project\\vite.js" "preview"'));
  assert.ok(windows.includes('"--outDir" "C:\\Temp\\fresh build"'));
  for (const value of ['bad%PATH%', 'bad!PATH!', 'bad"path', "bad\npath"]) assert.throws(() => quoteStabilityShellArgument(value, "win32"));
});

test("broad E2E runs include production stability once and focused selection retains its scope", () => {
  const broad = e2eCommands("/node22", "/app", []);
  assert.equal(broad.length, 2);
  assert.equal(e2eCommands("/node22", "/app", ["--workers", "1", "--retries", "0"]).length, 2);
  assert.equal(e2eCommands("/node22", "/app", ["--headed", "--timeout", "60000"]).length, 2);
  assert.throws(() => e2eCommands("/node22", "/app", ["--unsupported-broad-mode"]));
  assert.throws(() => e2eCommands("/node22", "/app", ["--unsupported-broad-mode", "value"]));
  assert.equal(e2eCommands("/node22", "/app", ["--reporter", "dot"]).length, 2);
  assert.equal(e2eCommands("/node22", "/app", ["--reporter=dot"]).length, 2);
  assert.equal(e2eCommands("/node22", "/app", ["--output", "/tmp/e2e-reports"]).length, 2);
  assert.equal(broad[0][1], "/app/scripts/zk682-run-stability.mjs");
  assert.equal(broad[1][1], "/app/node_modules/@playwright/test/cli.js");
  const grep = e2eCommands("/node22", "/app", ["-g", "opening"]);
  assert.equal(grep.length, 1);
  assert.deepEqual(grep[0].slice(2), ["test", "-g", "opening"]);
  const focused = e2eCommands("/node22", "/app", ["e2e/golden-path.e2e.ts", "--workers=1"]);
  assert.equal(focused.length, 1);
  assert.deepEqual(focused[0].slice(2), ["test", "e2e/golden-path.e2e.ts", "--workers=1"]);
  assert.deepEqual(e2eCommands("/node22", "/app", ["e2e/zk682-stability.e2e.ts", "--workers=1", "--retries=0"]), [broad[0]]);
  assert.deepEqual(e2eCommands("/node22", "/app", ["e2e/zk682-stability.e2e.ts", "--workers", "1", "--retries", "0"]), [broad[0]]);
  assert.throws(() => e2eCommands("/node22", "/app", ["e2e/zk682-stability.e2e.ts", "e2e/another.e2e.ts"]));
  const config = readFileSync(new URL("../playwright.config.ts", import.meta.url), "utf8");
  assert.ok(config.includes('testIgnore: "**/zk682-stability.e2e.ts"'));
});
