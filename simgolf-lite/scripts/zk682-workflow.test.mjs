import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, realpathSync, symlinkSync, linkSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { verifyZk682WorkflowReport } from "./zk682-workflow-verdict.mjs";

const COMMIT = "a".repeat(40);
const workflowPath = fileURLToPath(new URL("../../.github/workflows/zk682-certification.yml", import.meta.url));
const rawWorkflow = readFileSync(workflowPath, "utf8");
// Preserve the original six assertions over their original workflow projection.
// This removes only this diagnostic input, its three guards and appended job.
const HEAP_MODE_INPUT = "      verification_mode:\n        description: Original app heap diagnostic or unchanged full certification\n        required: false\n        default: full\n        type: choice\n        options:\n          - full\n          - original-app-heap-5c236\n";
const HEAP_ORDINARY_GUARD = "    if: ${{ inputs.verification_mode != 'original-app-heap-5c236' }}\n";
function baselineProjection(text) {
  const boundary = text.indexOf("\n  original-app-heap:\n");
  assert.notEqual(boundary, -1);
  text = text.slice(0, boundary);
  assert.equal(text.split(HEAP_ORDINARY_GUARD).length - 1, 3);
  return text.split(HEAP_ORDINARY_GUARD).join("").replace("\n" + HEAP_MODE_INPUT + "\npermissions:", "\npermissions:");
}
const workflow = baselineProjection(rawWorkflow);
const jobsText = workflow.split("\njobs:\n")[1];

function jobBlock(jobId, nextJobId) {
  const start = jobsText.indexOf(`  ${jobId}:\n`);
  assert.notEqual(start, -1, `missing ${jobId} job`);
  const end = nextJobId ? jobsText.indexOf(`  ${nextJobId}:\n`, start + 1) : jobsText.length;
  assert.notEqual(end, -1, `missing ${nextJobId} job boundary`);
  return jobsText.slice(start, end);
}

test("workflow is manual-only and requires one full candidate input", () => {
  const triggers = workflow.slice(0, workflow.indexOf("\npermissions:"));
  assert.match(triggers, /workflow_dispatch:\n    inputs:\n      candidate_sha:/);
  assert.match(triggers, /candidate_sha:[\s\S]*?required: true[\s\S]*?type: string/);
  assert.doesNotMatch(triggers, /^  (?:push|pull_request|schedule):/m);
  assert.doesNotMatch(workflow, /github\.sha|GITHUB_SHA/);
});

test("every job checks out, verifies, and binds the requested full SHA", () => {
  const jobs = [["linux-evidence", "native-evidence"], ["native-evidence", "aggregate"], ["aggregate", null]];
  for (const [jobId, nextJobId] of jobs) {
    const block = jobBlock(jobId, nextJobId);
    assert.match(block, /ZK682_EXPECTED_COMMIT: \$\{\{ inputs\.candidate_sha \}\}/);
    assert.match(block, /uses: actions\/checkout@v4[\s\S]*?ref: \$\{\{ inputs\.candidate_sha \}\}/);
    assert.match(block, /Verify exact candidate checkout[\s\S]*?\^\[0-9a-f\]\{40\}\$[\s\S]*?git rev-parse HEAD/);
  }
});

test("Windows disables checkout newline conversion before the native checkout", () => {
  const native = jobBlock("native-evidence", "aggregate");
  const normalization = native.indexOf("- name: Disable Windows checkout newline conversion");
  const checkout = native.indexOf("- name: Checkout exact candidate");
  assert.notEqual(normalization, -1);
  assert.notEqual(checkout, -1);
  assert(normalization < checkout, "Windows newline normalization must run before checkout");
  assert.match(native.slice(normalization, checkout), /if: runner\.os == 'Windows'[\s\S]*?working-directory: \$\{\{ github\.workspace \}\}[\s\S]*?git config --global core\.autocrlf false/);
});

test("same-run aggregation names and retention are exact", () => {
  const linux = jobBlock("linux-evidence", "native-evidence");
  const native = jobBlock("native-evidence", "aggregate");
  const aggregate = jobBlock("aggregate", null);
  assert.match(linux, /name: zk682-linux-evidence-\$\{\{ inputs\.candidate_sha \}\}[\s\S]*?retention-days: 90/);
  assert.match(native, /name: zk682-native-evidence-\$\{\{ matrix\.platform \}\}-\$\{\{ matrix\.architecture \}\}-\$\{\{ inputs\.candidate_sha \}\}[\s\S]*?retention-days: 90/);
  assert.match(native, /name: coursecraft-\$\{\{ matrix\.platform \}\}-\$\{\{ matrix\.architecture \}\}-unsigned-\$\{\{ inputs\.candidate_sha \}\}[\s\S]*?retention-days: 30/);
  for (const name of [
    "zk682-linux-evidence-${{ inputs.candidate_sha }}",
    "zk682-native-evidence-darwin-arm64-${{ inputs.candidate_sha }}",
    "zk682-native-evidence-win32-x64-${{ inputs.candidate_sha }}",
  ]) assert.ok(aggregate.includes(`name: ${name}`));
  assert.match(aggregate, /npm run release:build:zk682/);
  assert.match(aggregate, /name: zk682-certification-packet-\$\{\{ inputs\.candidate_sha \}\}[\s\S]*?retention-days: 90/);
  assert.match(aggregate, /if: always\(\)[\s\S]*?Require passing machine gates and physical-only blockers/);
});

test("workflow verdict accepts GO or a physical-only HOLD", () => {
  const hold = verifyZk682WorkflowReport({ candidateCommit: COMMIT, machinePassed: true, decision: "HOLD", blockers: [
    { criterionId: "midrange-physical-p95" },
    { criterionId: "low-end-physical-p95" },
  ] }, COMMIT);
  assert.deepEqual(hold, { valid: true, errors: [] });
  assert.equal(verifyZk682WorkflowReport({ candidateCommit: COMMIT, machinePassed: true, decision: "GO", blockers: [] }, COMMIT).valid, true);
});

test("workflow verdict rejects candidate drift, machine failures, and non-physical blockers", () => {
  assert.equal(verifyZk682WorkflowReport({ candidateCommit: "b".repeat(40), machinePassed: true, decision: "GO", blockers: [] }, COMMIT).valid, false);
  assert.equal(verifyZk682WorkflowReport({ candidateCommit: COMMIT, machinePassed: false, decision: "HOLD", blockers: [{ criterionId: "core-build" }] }, COMMIT).valid, false);
  assert.equal(verifyZk682WorkflowReport({ candidateCommit: COMMIT, machinePassed: true, decision: "HOLD", blockers: [{ criterionId: "core-build" }] }, COMMIT).valid, false);
});

const TARGET = "5c236f38655ed9e74d24530f402e08601dbe9387";
const DRIVER = "a".repeat(40);
const targetPaths = [
  "simgolf-lite/package.json", "simgolf-lite/playwright.config.ts",
  "simgolf-lite/e2e/zk682-resource-growth.e2e.ts", "simgolf-lite/e2e/zk682-stability.e2e.ts",
  "simgolf-lite/scripts/zk682-run-resource-growth.mjs", "simgolf-lite/scripts/zk682-run-stability.mjs",
];
const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const diagnostic = rawWorkflow.slice(rawWorkflow.indexOf("\n  original-app-heap:\n"));
const pythonBodies = [...diagnostic.matchAll(/          python3 - <<'PY'\n([\s\S]*?)          PY\n/g)]
  .map((match) => match[1].split("\n").filter((line) => line.length).map((line) => line.slice(10)).join("\n") + "\n");
assert.equal(pythonBodies.length, 4);
assert.equal(pythonBodies[0], pythonBodies[1], "before and after run the same source predicate");
const sourceGuard = pythonBodies[0], inventoryGuard = pythonBodies[2];
function fixture(fn) {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "zk1262-heap-driver-")));
  try {
    const driver = join(temp, "driver"), target = join(temp, "target"), bin = join(temp, "bin");
    for (const p of [driver, target, bin]) mkdirSync(p);
    for (const name of targetPaths) {
      const p = join(target, name); mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, readFileSync(join(repoRoot, name)));
    }
    const shim = `#!/usr/bin/env python3\nimport os,sys\na=sys.argv[1:]\nassert a[0]=='-C'\nif a[2:]==['rev-parse','HEAD']:\n print(os.environ.get('FAKE_DRIVER_HEAD','${DRIVER}') if a[1]==os.environ['HEAP_DRIVER_ROOT'] else os.environ.get('FAKE_TARGET_HEAD','${TARGET}'))\nelif a[2] == 'diff':\n if '--name-status' in a:\n  import json\n  rows=json.loads(os.environ.get('FAKE_STAGED_ROWS' if '--cached' in a else 'FAKE_UNSTAGED_ROWS','[]'))\n  sys.stdout.buffer.write(b''.join(status.encode('ascii')+b'\\0'+name.encode('utf-8')+b'\\0' for status,name in rows))\n  sys.exit(int(os.environ.get('FAKE_STATUS_EXIT','0')))\n sys.exit(int(os.environ.get('FAKE_CACHED_EXIT' if '--cached' in a else 'FAKE_DIFF_EXIT','0')))\nelse:\n raise RuntimeError('unexpected git argv')\n`;
    writeFileSync(join(bin, "git"), shim, { mode: 0o700 });
    const env = { ...process.env, PATH: bin + ":" + process.env.PATH,
      HEAP_DRIVER_ROOT: driver, HEAP_TARGET_ROOT: target, HEAP_DRIVER_SHA: DRIVER,
      ZK682_EXPECTED_COMMIT: TARGET, GITHUB_SHA: TARGET, VITE_COMMIT_SHA: TARGET,
      GITHUB_RUN_ID: "12345", GITHUB_RUN_ATTEMPT: "1", HEAP_PIN_PHASE: "before" };
    const run = (code, overrides = {}) => spawnSync("python3", ["-c", code], { env: { ...env, ...overrides }, encoding: "utf8", timeout: 5000, maxBuffer: 65536 });
    fn({ temp, driver, target, env, run, raw: join(target, "simgolf-lite/artifacts/zk682/raw") });
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
function requirePass(result) { assert.equal(result.status, 0, result.stderr); assert.equal(result.error, undefined); }
function requireFail(result, message) { assert.notEqual(result.status, 0); assert.equal(result.error, undefined); if (message) assert.match(result.stderr, message); }
function validateRoutes(text) {
  const before = text.slice(0, text.indexOf("\n  original-app-heap:\n"));
  for (const id of ["linux-evidence", "native-evidence", "aggregate"])
    assert.ok(before.includes(`  ${id}:\n${HEAP_ORDINARY_GUARD}`));
  assert.equal(before.split(HEAP_ORDINARY_GUARD).length - 1, 3);
  assert.ok(text.includes("  original-app-heap:\n    if: ${{ inputs.verification_mode == 'original-app-heap-5c236' }}\n"));
  assert.ok(text.includes(HEAP_MODE_INPUT));
}
function validateOriginalCommands(text) {
  for (const script of ["test:resource-growth", "test:stability"]) {
    const command = `          timeout --signal=TERM --kill-after=60s 1920s npm run ${script} -- --expected-commit "$ZK682_EXPECTED_COMMIT"\n`;
    assert.equal(text.split(command).length - 1, 1, "whole unchanged producer command and envelope");
  }
  assert.equal((text.match(/        timeout-minutes: 33\n/g) ?? []).length, 2);
  assert.ok(text.includes("    timeout-minutes: 240\n"));
  assert.equal((text.match(/        timeout-minutes: 10\n/g) ?? []).length, 4);
  assert.doesNotMatch(text, /--grep|--project|--headed|--trace|--video|--screenshot|globalTimeout|--foreground/);
  assert.equal((text.match(/export GITHUB_SHA="\$ZK682_EXPECTED_COMMIT"/g) ?? []).length, 8);
}

test("heap driver exclusive routing preserves full mode and rejects routing mutants", () => {
  validateRoutes(rawWorkflow);
  for (const mode of [undefined, "", "full", "other"]) {
    assert.equal(mode !== "original-app-heap-5c236", true);
    assert.equal(mode === "original-app-heap-5c236", false);
  }
  assert.equal("original-app-heap-5c236" !== "original-app-heap-5c236", false);
  for (const mutant of [rawWorkflow.replace(HEAP_ORDINARY_GUARD, ""),
    rawWorkflow.replace("verification_mode == 'original-app-heap-5c236'", "verification_mode != 'original-app-heap-5c236'")])
    assert.throws(() => validateRoutes(mutant));
});

test("heap driver actual source guard accepts exact roles and rejects SHA env run tracked and source drift", () => {
  fixture(({ run, raw }) => {
    requirePass(run(sourceGuard));
    const context = JSON.parse(readFileSync(join(raw, "heap-source-before.json")));
    assert.equal(context.sourceSha, DRIVER); assert.equal(context.candidateSha, TARGET);
    assert.equal(context.linuxEffectiveTestMs, 1800000); assert.equal(context.linuxGlobalTimeout, null);
    assert.equal(context.hardEnvelopeSeconds, 1980); assert.equal(context.captureMsUnchanged, 10000);
    assert.match(context.processClosure, /^UNKNOWN/);
  });
  for (const overrides of [{ ZK682_EXPECTED_COMMIT: DRIVER }, { HEAP_DRIVER_SHA: TARGET },
    { FAKE_TARGET_HEAD: DRIVER }, { FAKE_DRIVER_HEAD: TARGET }, { VITE_COMMIT_SHA: DRIVER },
    { GITHUB_SHA: DRIVER }, { GITHUB_RUN_ATTEMPT: "2" }, { FAKE_DIFF_EXIT: "1" }])
    fixture(({ run }) => requireFail(run(sourceGuard, overrides)));
  fixture(({ run, target }) => { writeFileSync(join(target, targetPaths[0]), "{}"); requireFail(run(sourceGuard), /source pin drift/); });
});

test("heap driver actual source guard refuses aliases and preserves exclusive intent sentinel", () => {
  fixture(({ run, target, temp }) => {
    const alias = join(temp, "target-alias"); symlinkSync(target, alias);
    requireFail(run(sourceGuard, { HEAP_TARGET_ROOT: alias }), /alias refused/);
  });
  fixture(({ run, target }) => {
    const p = join(target, targetPaths[0]), moved = p + ".actual";
    writeFileSync(moved, readFileSync(p)); rmSync(p); symlinkSync(moved, p);
    requireFail(run(sourceGuard), /source alias refused/);
  });
  fixture(({ run, raw }) => {
    requirePass(run(sourceGuard)); const intent = readFileSync(join(raw, "heap-hosted-intent.json"));
    requireFail(run(sourceGuard), /FileExistsError/);
    assert.deepEqual(readFileSync(join(raw, "heap-hosted-intent.json")), intent);
    requirePass(run(sourceGuard, { HEAP_PIN_PHASE: "after" }));
  });
});

test("heap driver actual raw inventory pins bytes and keeps outcome and closure neutral", () => {
  fixture(({ run, raw }) => {
    requirePass(run(sourceGuard)); writeFileSync(join(raw, "report.json"), '{"passed":false}\n');
    writeFileSync(join(raw, "canvas.png"), Buffer.from([137, 80, 78, 71]));
    requirePass(run(inventoryGuard, { HEAP_RESOURCE_OUTCOME: "failure", HEAP_STABILITY_OUTCOME: "success", HEAP_POST_SOURCE_OUTCOME: "success" }));
    const result = JSON.parse(readFileSync(join(raw, "heap-raw-inventory.json")));
    assert.equal(result.resourceOutcome, "failure"); assert.equal(result.stabilityOutcome, "success");
    assert.equal(result.certificationEligible, false); assert.match(result.processClosure, /^UNKNOWN/);
    assert.equal(result.fileCountIncludingInventory, result.entries.length + 1);
    for (const entry of result.entries) {
      const b = readFileSync(join(raw, entry.path)); assert.equal(entry.bytes, b.length);
      assert.equal(entry.sha256, createHash("sha256").update(b).digest("hex"));
    }
  });
});

test("heap driver actual raw inventory rejects count JSON aggregate caps and symlinks before upload", () => {
  fixture(({ run, raw }) => { requirePass(run(sourceGuard)); writeFileSync(join(raw, "big.json"), Buffer.alloc(1048577)); requireFail(run(inventoryGuard), /JSON cap/); });
  fixture(({ run, raw }) => { requirePass(run(sourceGuard)); for (let n = 0; n < 128; n++) writeFileSync(join(raw, `${n}.bin`), ""); requireFail(run(inventoryGuard), /file count/); });
  // Exercise the exact aggregate guard with a reduced test-only limit; avoid a GiB allocation.
  assert.ok(inventoryGuard.includes("1073676288")); assert.ok(inventoryGuard.includes('"rawCapBytes": 1073741824'));
  fixture(({ run, raw }) => { requirePass(run(sourceGuard)); requireFail(run(inventoryGuard.replace("1073676288", "1024")), /aggregate cap/); });
  fixture(({ run, raw, temp }) => { requirePass(run(sourceGuard)); const foreign = join(temp, "foreign"); writeFileSync(foreign, "x"); symlinkSync(foreign, join(raw, "link")); requireFail(run(inventoryGuard), /symlink refused/); });
});

test("heap driver actual inventory preserves wx sentinel and rejects raw parent alias", () => {
  fixture(({ run, raw }) => { requirePass(run(sourceGuard)); writeFileSync(join(raw, "heap-raw-inventory.json"), "sentinel"); requireFail(run(inventoryGuard), /already exists/); assert.equal(readFileSync(join(raw, "heap-raw-inventory.json"), "utf8"), "sentinel"); });
  fixture(({ run, target, temp }) => { requirePass(run(sourceGuard)); const alias = join(temp, "alias"); symlinkSync(target, alias); requireFail(run(inventoryGuard, { HEAP_TARGET_ROOT: alias }), /alias refused/); });
});

test("heap driver unchanged serial commands envelopes recording and source role bindings reject mutants", () => {
  validateOriginalCommands(diagnostic);
  for (const mutant of [diagnostic.replace("1920s", "600s"), diagnostic.replace("--kill-after=60s", "--kill-after=1s"),
    diagnostic.replace("npm run test:stability --", "npm run test:stability -- --grep SAVE"),
    diagnostic.replace("timeout-minutes: 33", "timeout-minutes: 32")]) assert.throws(() => validateOriginalCommands(mutant));
  assert.ok(diagnostic.indexOf("id: resource") < diagnostic.indexOf("id: stability"));
  assert.ok(diagnostic.includes('ref: ${{ github.sha }}')); assert.ok(diagnostic.includes('ref: ${{ inputs.candidate_sha }}'));
  assert.ok(diagnostic.includes('HEAP_DRIVER_SHA: ${{ github.sha }}'));
  assert.ok(diagnostic.includes('VITE_COMMIT_SHA: ${{ inputs.candidate_sha }}'));
});

test("heap driver uploads bounded raw only after inventory without certification aggregation", () => {
  assert.ok(diagnostic.includes("if: ${{ always() && steps.raw_inventory.outcome == 'success' }}"));
  assert.ok(diagnostic.includes("path: heap-target/simgolf-lite/artifacts/zk682/raw\n"));
  assert.ok(diagnostic.includes("name: zk1262-original-app-heap-${{ inputs.candidate_sha }}-${{ github.run_id }}-${{ github.run_attempt }}"));
  assert.doesNotMatch(diagnostic, /test-results|playwright-report|release:build|workflow-verdict|desktop:|fullcandidate|closureVerified.*True/);
  assert.ok(diagnostic.includes('"processClosure": "UNKNOWN; no universal native/descendant closure proved"'));
});

function statusResult(raw, phase = "before") {
  return JSON.parse(readFileSync(join(raw, `heap-source-status-${phase}.json`), "utf8"));
}
function rejectStatus(status, outcome) {
  assert.equal(status.sourceQualified, false);
  assert.equal(status.outcome, outcome);
  assert.notEqual(status.firstFailure, null);
}

test("heap driver neutral status publishes complete clean evidence before and after", () => {
  fixture(({ run, raw }) => {
    requirePass(run(sourceGuard));
    const before = statusResult(raw);
    assert.equal(before.outcome, "PASS"); assert.equal(before.sourceQualified, true);
    assert.equal(before.historyComplete, true); assert.equal(before.metadataOverflow, false);
    assert.equal(before.rolesAndHeadsPassed, true); assert.equal(before.pinsPassed, true);
    assert.equal(before.targetHead, TARGET); assert.equal(before.driverHead, DRIVER);
    assert.equal(before.sourceSha, DRIVER); assert.equal(before.candidateSha, TARGET);
    assert.deepEqual(before.changedPaths, []); assert.equal(before.firstFailure, null);
    requirePass(run(sourceGuard, { HEAP_PIN_PHASE: "after" }));
    assert.equal(statusResult(raw, "after").outcome, "PASS");
  });
});

test("heap driver neutral status preserves first tracked failure with worktree and staged hashes", () => {
  for (const staged of [false, true]) fixture(({ run, raw, target }) => {
    const name = targetPaths[0], bytes = Buffer.from("{}\n");
    writeFileSync(join(target, name), bytes);
    const overrides = staged
      ? { FAKE_CACHED_EXIT: "1", FAKE_STAGED_ROWS: JSON.stringify([["M", name]]) }
      : { FAKE_DIFF_EXIT: "1", FAKE_UNSTAGED_ROWS: JSON.stringify([["M", name]]) };
    requireFail(run(sourceGuard, overrides), /CalledProcessError/);
    const status = statusResult(raw);
    rejectStatus(status, "FAIL"); assert.equal(status.historyComplete, true);
    assert.equal(status.firstFailure.type, "CalledProcessError");
    assert.equal(status.rolesAndHeadsPassed, true);
    assert.equal(status.changedPaths.length, 1);
    const row = status.changedPaths[0];
    assert.equal(row.path, name); assert.equal(row.hashOutcome, "COMPLETE");
    assert.deepEqual(row.file, { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    assert.deepEqual(row.changes, [{ view: staged ? "indexVsHead" : "worktreeVsIndex", status: "M" }]);
    assert.throws(() => readFileSync(join(raw, "heap-source-before.json")), /ENOENT/);
  });
  fixture(({ run, raw, target }) => {
    requirePass(run(sourceGuard));
    const before = readFileSync(join(raw, "heap-source-before.json"));
    const name = targetPaths[0]; writeFileSync(join(target, name), "{}");
    requireFail(run(sourceGuard, { HEAP_PIN_PHASE: "after", FAKE_DIFF_EXIT: "1",
      FAKE_UNSTAGED_ROWS: JSON.stringify([["M", name]]) }), /CalledProcessError/);
    rejectStatus(statusResult(raw, "after"), "FAIL");
    assert.throws(() => readFileSync(join(raw, "heap-source-after.json")), /ENOENT/);
    assert.deepEqual(readFileSync(join(raw, "heap-source-before.json")), before);
  });
  fixture(({ run, raw, target }) => {
    const name = "foreign-tracked.txt"; writeFileSync(join(target, name), "foreign");
    requireFail(run(sourceGuard, { FAKE_DIFF_EXIT: "1", FAKE_UNSTAGED_ROWS: JSON.stringify([["M", name]]),
      FAKE_STAGED_ROWS: JSON.stringify([["M", name]]) }), /CalledProcessError/);
    const status = statusResult(raw);
    rejectStatus(status, "FAIL"); assert.equal(status.changedPaths.length, 1);
    assert.equal(status.changedPaths[0].changes.length, 2);
    assert.equal(status.changedPaths[0].file.sha256, createHash("sha256").update("foreign").digest("hex"));
  });
});

test("heap driver neutral status retains role head and pin rejection evidence", () => {
  for (const [overrides, message] of [[{ HEAP_DRIVER_SHA: TARGET }, /roles invalid/],
    [{ FAKE_TARGET_HEAD: DRIVER }, /target checkout drift/], [{ VITE_COMMIT_SHA: DRIVER }, /child target binding invalid/]])
    fixture(({ run, raw }) => {
      requireFail(run(sourceGuard, overrides), message);
      const status = statusResult(raw); rejectStatus(status, "FAIL");
      assert.equal(status.rolesAndHeadsPassed, false); assert.equal(status.pinsPassed, false);
      assert.equal(status.historyComplete, true);
    });
  fixture(({ run, raw, target }) => {
    writeFileSync(join(target, targetPaths[0]), "{}");
    requireFail(run(sourceGuard), /target source pin drift/);
    const status = statusResult(raw); rejectStatus(status, "FAIL");
    assert.equal(status.rolesAndHeadsPassed, true); assert.equal(status.pinsPassed, false);
  });
});

test("heap driver neutral status refuses unsafe aliases links missing and oversized changed files", () => {
  for (const mode of ["escape", "symlink", "hardlink", "missing", "oversized"]) fixture(({ run, raw, target, temp }) => {
    let name = "unsafe.txt"; const foreign = join(temp, "foreign");
    writeFileSync(foreign, "x");
    if (mode === "escape") name = "../foreign";
    if (mode === "symlink") symlinkSync(foreign, join(target, name));
    if (mode === "hardlink") linkSync(foreign, join(target, name));
    if (mode === "oversized") writeFileSync(join(target, name), Buffer.alloc(65537));
    requireFail(run(sourceGuard, { FAKE_DIFF_EXIT: "1", FAKE_UNSTAGED_ROWS: JSON.stringify([["M", name]]) }), /CalledProcessError/);
    const status = statusResult(raw);
    rejectStatus(status, "HOLD"); assert.equal(status.historyComplete, false);
    assert.notEqual(status.statusFailure, null); assert.equal(status.firstFailure.type, "CalledProcessError");
    assert.ok(status.changedPaths.every(row => row.hashOutcome !== "COMPLETE"));
  });
});

test("heap driver neutral status refuses path count output and serialized metadata overflow", () => {
  fixture(({ run, raw }) => {
    const rows = Array.from({ length: 129 }, (_, n) => ["M", `p${n}`]);
    requireFail(run(sourceGuard, { FAKE_DIFF_EXIT: "1", FAKE_UNSTAGED_ROWS: JSON.stringify(rows) }), /CalledProcessError/);
    const status = statusResult(raw); rejectStatus(status, "HOLD");
    assert.equal(status.historyComplete, false); assert.equal(status.collectedChangedPaths, 128);
    assert.match(status.statusFailure.message, /changed path cap/);
  });
  fixture(({ run, raw }) => {
    const rows = Array.from({ length: 40 }, (_, n) => ["M", String(n).padStart(4, "0") + "x".repeat(1000)]);
    requireFail(run(sourceGuard, { FAKE_DIFF_EXIT: "1", FAKE_UNSTAGED_ROWS: JSON.stringify(rows) }), /CalledProcessError/);
    const status = statusResult(raw); rejectStatus(status, "HOLD");
    assert.equal(status.historyComplete, false); assert.match(status.statusFailure.message, /status output cap/);
  });
  fixture(({ run, raw, target }) => {
    const rows = [];
    for (let n = 0; n < 128; n++) {
      const name = String(n).padStart(4, "0") + "x".repeat(120);
      writeFileSync(join(target, name), "x"); rows.push(["M", name]);
    }
    requireFail(run(sourceGuard, { FAKE_DIFF_EXIT: "1", FAKE_UNSTAGED_ROWS: JSON.stringify(rows) }), /CalledProcessError/);
    const status = statusResult(raw); rejectStatus(status, "HOLD");
    assert.equal(status.historyComplete, false); assert.equal(status.metadataOverflow, true);
    assert.equal(status.omittedChangedPaths, 128); assert.deepEqual(status.changedPaths, []);
    assert.ok(readFileSync(join(raw, "heap-source-status-before.json")).length <= 32768);
    assert.equal(status.firstFailure.type, "CalledProcessError");
  });
});

test("heap driver neutral status fails closed on status query error and publication collision", () => {
  fixture(({ run, raw }) => {
    requireFail(run(sourceGuard, { FAKE_STATUS_EXIT: "2" }), /status git failure/);
    const status = statusResult(raw); rejectStatus(status, "HOLD");
    assert.equal(status.historyComplete, false);
  });
  fixture(({ run, raw }) => {
    mkdirSync(raw, { recursive: true });
    const path = join(raw, "heap-source-status-before.json"); writeFileSync(path, "sentinel");
    requireFail(run(sourceGuard, { FAKE_DIFF_EXIT: "1" }), /CalledProcessError/);
    assert.equal(readFileSync(path, "utf8"), "sentinel");
    assert.throws(() => readFileSync(join(raw, "heap-source-before.json")), /ENOENT/);
  });
});

const beforeFailureInventory = pythonBodies[3];
function failureFixture(fn) {
  fixture((context) => {
    const rejected = context.run(sourceGuard, { FAKE_DIFF_EXIT: "1", FAKE_UNSTAGED_ROWS: JSON.stringify([["M", targetPaths[0]]]) });
    requireFail(rejected, /CalledProcessError/);
    const roleEnv = { HEAP_BEFORE_SOURCE_OUTCOME: "failure", HEAP_RESOURCE_OUTCOME: "skipped",
      HEAP_STABILITY_OUTCOME: "skipped", HEAP_POST_SOURCE_OUTCOME: "skipped",
      HEAP_REPOSITORY: "zkutty/golf-course-simulator-game", HEAP_SOURCE_REF: "refs/heads/driver",
      HEAP_WORKFLOW_REF: "zkutty/golf-course-simulator-game/.github/workflows/zk682-certification.yml@refs/heads/driver" };
    fn({ ...context, rejected, roleEnv, statusPath: join(context.raw, "heap-source-status-before.json"),
      publish: (overrides = {}, code = beforeFailureInventory) => context.run(code, { ...roleEnv, ...overrides }) });
  });
}
function validateFailureDelivery(text) {
  const branch = text.slice(text.indexOf("      - name: Bound before-source failure diagnostic only"));
  assert.match(branch, /id: before_failure_inventory/);
  assert.ok(branch.includes("if: ${{ always() && steps.source_before.outcome == 'failure' }}"));
  assert.ok(branch.includes("if: ${{ always() && steps.before_failure_inventory.outcome == 'success' }}"));
  assert.ok(branch.includes("path: heap-target/simgolf-lite/artifacts/zk682/raw"));
  assert.ok(text.includes("if: ${{ always() && steps.source_before.outcome == 'success' }}"));
  assert.ok(text.includes("if: ${{ always() && steps.raw_inventory.outcome == 'success' }}"));
}

test("heap driver before-failure publication validates actual inventory and durable routing", () => {
  validateFailureDelivery(diagnostic);
  const originalSource2 = diagnostic.slice(0, diagnostic.indexOf("      - name: Bound before-source failure diagnostic only"));
  assert.throws(() => validateFailureDelivery(originalSource2));
  failureFixture(({ publish, raw, statusPath, rejected }) => {
    const bytes = readFileSync(statusPath); requirePass(publish());
    const inventory = JSON.parse(readFileSync(join(raw, "heap-before-source-failure-inventory.json")));
    assert.equal(rejected.status !== 0, true); assert.deepEqual(readFileSync(statusPath), bytes);
    assert.equal(inventory.outcome, "BEFORE_SOURCE_FAILURE_DIAGNOSTIC_ONLY");
    for (const key of ["sourceQualified", "numericalQualified", "certificationEligible"]) assert.equal(inventory[key], false);
    assert.equal(inventory.sourceSha, DRIVER); assert.equal(inventory.candidateSha, TARGET);
    assert.equal(inventory.runId, 12345); assert.equal(inventory.runAttempt, 1);
    assert.equal(inventory.browserInvocation, "NOT_STARTED_BY_WORKFLOW_ORDER");
    assert.match(inventory.processClosure, /^UNKNOWN/); assert.equal(inventory.fileCountIncludingInventory, 2);
    assert.deepEqual(inventory.entries, [{ path: "heap-source-status-before.json", bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex") }]);
    assert.throws(() => readFileSync(join(raw, "heap-source-before.json")), /ENOENT/);
  });
  failureFixture(({ publish, statusPath }) => {
    const status = JSON.parse(readFileSync(statusPath));
    status.outcome = "HOLD"; status.historyComplete = false;
    status.statusFailure = { type: "RuntimeError", message: "status deadline", messageTruncated: false };
    writeFileSync(statusPath, JSON.stringify(status)); requirePass(publish());
  });
});

test("heap driver before-failure publication rejects malformed status roles flags and hashes", () => {
  for (const change of [
    { schemaVersion: 2 }, { phase: "after" }, { sourceSha: TARGET }, { candidateSha: DRIVER },
    { runId: 12346 }, { runAttempt: 2 }, { sourceQualified: true }, { outcome: "PASS" },
    { rolesAndHeadsPassed: false }, { targetHead: DRIVER }, { firstFailure: null },
    { historyComplete: "true" }, { extra: true }, { collectedChangedPaths: 2 }
  ]) failureFixture(({ publish, raw, statusPath }) => {
    const status = JSON.parse(readFileSync(statusPath)); Object.assign(status, change);
    writeFileSync(statusPath, JSON.stringify(status)); requireFail(publish());
    assert.throws(() => readFileSync(join(raw, "heap-before-source-failure-inventory.json")), /ENOENT/);
  });
  failureFixture(({ publish, statusPath }) => {
    const status = JSON.parse(readFileSync(statusPath)); status.changedPaths[0].file.sha256 = "bad";
    writeFileSync(statusPath, JSON.stringify(status)); requireFail(publish(), /hash invalid/);
  });
  for (const overrides of [{ FAKE_TARGET_HEAD: DRIVER }, { FAKE_DRIVER_HEAD: TARGET }, { HEAP_DRIVER_SHA: TARGET },
    { GITHUB_RUN_ATTEMPT: "2" }, { HEAP_BEFORE_SOURCE_OUTCOME: "success" }, { HEAP_RESOURCE_OUTCOME: "success" },
    { HEAP_SOURCE_REF: "refs/tags/driver" }, { HEAP_WORKFLOW_REF: "other/workflow@refs/heads/driver" }])
    failureFixture(({ publish }) => requireFail(publish(overrides)));
});

test("heap driver before-failure publication rejects absent unsafe extra and racing files", () => {
  for (const mode of ["missing", "malformed", "duplicate", "oversized", "extra", "intent", "success", "symlink", "hardlink", "parentAlias"])
    failureFixture(({ publish, raw, statusPath, temp }) => {
      if (mode === "missing") rmSync(statusPath);
      if (mode === "malformed") writeFileSync(statusPath, "{");
      if (mode === "duplicate") writeFileSync(statusPath, readFileSync(statusPath, "utf8").replace('"phase":"before"', '"phase":"before","phase":"before"'));
      if (mode === "oversized") writeFileSync(statusPath, Buffer.alloc(32769));
      if (mode === "extra") writeFileSync(join(raw, "extra.bin"), "");
      if (mode === "intent") writeFileSync(join(raw, "heap-hosted-intent.json"), "{}");
      if (mode === "success") writeFileSync(join(raw, "report.json"), '{"passed":true}');
      if (mode === "symlink") { const moved = join(temp, "status"); renameSync(statusPath, moved); symlinkSync(moved, statusPath); }
      if (mode === "hardlink") linkSync(statusPath, join(temp, "status"));
      if (mode === "parentAlias") { const moved = join(temp, "raw"); renameSync(raw, moved); symlinkSync(moved, raw); }
      requireFail(publish());
      assert.throws(() => readFileSync(join(raw, "heap-before-source-failure-inventory.json")), /ENOENT/);
    });
  failureFixture(({ publish, raw }) => {
    assert.equal(beforeFailureInventory.split("    after = os.fstat(fd)").length - 1, 1);
    const raced = beforeFailureInventory.replace("    after = os.fstat(fd)",
      "    after = os.fstat(fd)\n    os.utime(p, ns=(before.st_atime_ns, before.st_mtime_ns + 1))");
    requireFail(publish({}, raced), /changed while hashing/);
    assert.throws(() => readFileSync(join(raw, "heap-before-source-failure-inventory.json")), /ENOENT/);
  });
});
