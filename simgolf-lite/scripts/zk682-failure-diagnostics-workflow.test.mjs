import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const COMMIT = "a".repeat(40);
const workflow = readFileSync(new URL("../../.github/workflows/zk682-hosted-diagnostics.yml", import.meta.url), "utf8");

function step(name) {
  const value = workflow.split("\n      - name: ").find((part) => part.startsWith(name + "\n"));
  assert.ok(value, `missing step: ${name}`);
  return value;
}

test("diagnostics are manual-only with one bounded job and exact checkout", () => {
  const on = workflow.slice(workflow.indexOf("\non:\n"), workflow.indexOf("\npermissions:\n"));
  assert.deepEqual(on.match(/^  [a-z_]+:/gm), ["  workflow_dispatch:"]);
  assert.match(on, /^      candidate_sha:\n        description: .*\n        required: true\n        type: string$/m);
  assert.match(workflow, /\npermissions:\n  contents: read\n\ndefaults:/);
  assert.match(workflow, /\njobs:\n  linux-diagnostics:\n    runs-on: ubuntu-latest\n    timeout-minutes: 30\n/);
  assert.deepEqual(workflow.slice(workflow.indexOf("\njobs:")).match(/^  [a-z][a-z-]+:/gm), ["  linux-diagnostics:"]);
  assert.ok(workflow.indexOf("Validate candidate before checkout") < workflow.indexOf("Checkout exact candidate"));
  assert.ok(step("Validate candidate before checkout").includes('[[ "$ZK682_EXPECTED_COMMIT" =~ ^[0-9a-f]{40}$ ]]'));
  assert.ok(step("Checkout exact candidate").includes("ref: ${{ inputs.candidate_sha }}\n          fetch-depth: 1\n          persist-credentials: false"));
  assert.match(step("Verify exact candidate checkout"), /git rev-parse HEAD.*ZK682_EXPECTED_COMMIT[\s\S]*?git status --porcelain[\s\S]*?RUNNER_OS" = Linux[\s\S]*?RUNNER_ARCH" = X64/);
  assert.match(workflow, /node-version: 22\n[\s\S]*?run: npm ci\n[\s\S]*?run: npx playwright install --with-deps chromium webkit\n/);
  assert.doesNotMatch(workflow, /secrets\.|contents: write|deploy|release:build:zk682|test:stability/);
});

test("original commands use isolated receipts and M27 failure still permits the M47 case", () => {
  const m27 = step("M27 performance receipt");
  assert.match(m27, /PERF_FIXTURE_READY_TIMEOUT_MS: "300000"\n          PERF_FIXTURE: m27\n          PERF_THEME: parkland\n          PERF_M27_PHASE_DIAGNOSTICS: "1"\n          PERF_OUTPUT_PATH: artifacts\/zk682\/failure-diagnostics\/m27-perf\.json/);
  assert.match(m27, /--id headless-performance[\s\S]*?--candidate "\$ZK682_EXPECTED_COMMIT"\n          -- npm run test:perf$/);
  assert.doesNotMatch(m27, /PERF_(?:MEASURE|WORK_BUDGET|STARTUP_BUDGET|HEADED|ASSERT_FRAME)/);
  const m47 = step("M47 WebKit receipt");
  assert.ok(m47.includes("if: ${{ !cancelled() && steps.install-browsers.outcome == 'success' }}"));
  assert.match(m47, /LIBGL_ALWAYS_SOFTWARE: "1"\n          DEBUG: "pw:browser"\n          PLAYWRIGHT_JSON_OUTPUT_FILE: artifacts\/zk682\/failure-diagnostics\/m47-playwright\.json\n          ZK682_WEBKIT_LIFECYCLE_DIAGNOSTICS: "1"\n        run: >-\n/);
  assert.equal(workflow.match(/PLAYWRIGHT_JSON_OUTPUT_FILE: artifacts\/zk682\/failure-diagnostics\/m47-playwright\.json/g)?.length, 1);
  assert.equal(workflow.match(/ZK682_WEBKIT_LIFECYCLE_DIAGNOSTICS:/g)?.length, 2);
  assert.match(m47, /run: >-\n          python3 scripts\/zk682-m47-native-observer\.py --\n          env -u GITHUB_SHA node/);
  assert.equal(workflow.match(/python3 scripts\/zk682-m47-native-observer\.py/g)?.length, 1);
  assert.match(m47, /--id browser-supported[\s\S]*?--candidate "\$ZK682_EXPECTED_COMMIT"\n          -- npm run test:release:browsers --\n          e2e\/m47-certification\.e2e\.ts --grep-invert "ZK-813" --project=webkit-safari-proxy --workers=1 --retries=0 --reporter=list,json$/);
  for (const command of [m27, m47]) {
    assert.match(command, /env -u GITHUB_SHA node scripts\/zk682-run-command-receipt\.mjs/);
    assert.doesNotMatch(command, /continue-on-error/);
  }
});

test("the bounded raw artifact is uploaded before evaluating final command status", () => {
  const names = ["M27 performance receipt", "M47 WebKit receipt", "Upload exact-candidate failure diagnostics", "Require both diagnostic commands to pass"];
  const positions = names.map((name) => workflow.indexOf(`      - name: ${name}\n`));
  assert.ok(positions.every((position, index) => position > (positions[index - 1] ?? -1)));
  const artifact = step(names[2]);
  assert.ok(artifact.includes("if: always() && steps.verified-checkout.outcome == 'success'"));
  assert.ok(artifact.includes("name: zk682-failure-diagnostics-${{ inputs.candidate_sha }}-run-${{ github.run_id }}-attempt-${{ github.run_attempt }}"));
  assert.match(artifact, /uses: actions\/upload-artifact@v4[\s\S]*?if-no-files-found: error\n          retention-days: 7$/);
  assert.deepEqual(artifact.match(/^ {12}simgolf-lite\/\S+$/gm).map((path) => path.trim()), [
    ...["identity.json", "m27-perf.json", "headless-performance-command.json", "browser-supported.json", "m47-playwright.json", "m47-native-process.json", "m27-fixture-profile.json"]
      .map((file) => `simgolf-lite/artifacts/zk682/failure-diagnostics/${file}`),
    ...["trace.zip", "video*.webm", "error-context.md", "test-failed-*.png", "inspector-desktop.png",
      "inspector-mobile.png", "m47-pseudo-channel.png"].map((file) => `simgolf-lite/test-results/m47-certification.e2e.ts-*/${file}`),
  ]);
  assert.match(step(names[3]), /if: always\(\) && steps.install-browsers.outcome == 'success'[\s\S]*?git diff --exit-code HEAD --/);
});

test("secondary profile is opt-in, bounded, separate from both original commands and verdict", () => {
  assert.match(workflow, /profile_startup:\n        description: .*\n        required: false\n        default: false\n        type: boolean/);
  const profile = step("Secondary startup profile (not certification)");
  assert.ok(profile.includes("if: ${{ !cancelled() && inputs.profile_startup && steps.install-browsers.outcome == 'success' }}"));
  assert.match(profile, /PERF_M27_FIXTURE_PROFILE: "1"/);
  assert.match(profile, /PERF_M27_PHASE_DIAGNOSTICS: "1"/);
  assert.match(profile, /PERF_M27_FIXTURE_PROFILE_OUTPUT: artifacts\/zk682\/failure-diagnostics\/m27-fixture-profile\.json/);
  assert.match(profile, /set -o pipefail\n          timeout --signal=TERM --kill-after=5s 60s env -u GITHUB_SHA npm run test:perf 2>&1 \| head -c 16777216$/);
  assert.doesNotMatch(profile, /PERF_OUTPUT_PATH|zk682-run-command-receipt|PERF_(?:MEASURE|WORK_BUDGET|STARTUP_BUDGET|HEADED|ASSERT_FRAME)|continue-on-error/);
  for (const name of ["M27 performance receipt", "M47 WebKit receipt", "Require both diagnostic commands to pass"]) {
    assert.doesNotMatch(step(name), /PERF_M27_FIXTURE_PROFILE|m27-fixture-profile/);
  }
  assert.ok(workflow.indexOf("      - name: M47 WebKit receipt") < workflow.indexOf("      - name: Secondary startup profile"));
  assert.ok(workflow.indexOf("      - name: Secondary startup profile") < workflow.indexOf("      - name: Upload exact-candidate"));
  const identity = step("Record diagnostic run identity");
  assert.ok(identity.includes('"scripts/perf-m27-fixture-profile.mjs", "scripts/zk682-m47-native-observer.py"'));
});

test("the optional snapshots-off probe preserves the original workload and isolates its evidence", () => {
  const name = "Secondary WebKit snapshots-off probe (not certification)";
  const uploadName = "Upload WebKit snapshots-off evidence";
  const root = "artifacts/zk682/webkit-snapshot-diagnostic";
  const config = "playwright.webkit-snapshot-diagnostic.config.ts";
  const probe = step(name);
  assert.match(workflow, /webkit_snapshot_diagnostic:\n        description: .*\n        required: false\n        default: false\n        type: boolean/);
  assert.ok(probe.includes("if: ${{ !cancelled() && inputs.webkit_snapshot_diagnostic && steps.install-browsers.outcome == 'success' }}"));
  assert.match(probe, /continue-on-error: true\n        env:\n          LIBGL_ALWAYS_SOFTWARE: "1"\n          DEBUG: "pw:browser"\n/);
  assert.ok(probe.includes(`          PLAYWRIGHT_JSON_OUTPUT_FILE: ${root}/playwright.json\n          ZK682_WEBKIT_LIFECYCLE_DIAGNOSTICS: "1"\n`));
  assert.ok(probe.includes(`config=${config}\n          git cat-file -e "HEAD:simgolf-lite/$config"\n          git diff --exit-code HEAD --\n`));
  assert.ok(probe.includes(`output=${root}\n          test ! -e "$output"`));
  assert.match(probe, /"certifying":false,"traceSnapshots":false,"traceHar":false/);
  assert.match(probe, /--id webkit-snapshot-diagnostic --output "\$output\/command\.json" --candidate "\$ZK682_EXPECTED_COMMIT" --/);
  assert.ok(probe.includes('timeout --signal=TERM --kill-after=5s 180s ./node_modules/.bin/playwright test --config "$config"'));
  const m47 = step("M47 WebKit receipt");
  const args = /e2e\/m47-certification\.e2e\.ts --grep-invert "ZK-813" --project=webkit-safari-proxy --workers=1 --retries=0 --reporter=list,json/;
  assert.match(probe, args);
  assert.equal(probe.match(args)[0], m47.match(args)?.[0]);
  assert.ok(probe.endsWith('            --output "$output/test-results"'));
  assert.doesNotMatch(probe, /--trace|--timeout|failure-diagnostics|browser-supported/);
  assert.equal(workflow.match(/PLAYWRIGHT_JSON_OUTPUT_FILE:/g)?.length, 2);

  const identity = step("Record diagnostic run identity");
  assert.ok(identity.includes(`const snapshotConfig = "${config}";\n          if (existsSync(snapshotConfig)) sourceFiles.push(snapshotConfig);`));
  const verdict = "Require both diagnostic commands to pass";
  assert.doesNotMatch(step(verdict), /webkit-snapshot|snapshot-diagnostic/);
  assert.ok(workflow.indexOf(`      - name: ${verdict}`) < workflow.indexOf(`      - name: ${name}`));
  assert.ok(workflow.indexOf(`      - name: ${name}`) < workflow.indexOf(`      - name: ${uploadName}`));
  const artifact = step(uploadName);
  assert.ok(artifact.includes("if: ${{ !cancelled() && (steps.webkit-snapshot-probe.outcome == 'success' || steps.webkit-snapshot-probe.outcome == 'failure') }}"));
  assert.match(artifact, /continue-on-error: true\n        uses: actions\/upload-artifact@v4/);
  assert.ok(artifact.includes("name: zk682-webkit-snapshot-diagnostic-${{ inputs.candidate_sha }}-run-${{ github.run_id }}-attempt-${{ github.run_attempt }}"));
  assert.deepEqual(artifact.match(/^ {12}simgolf-lite\/\S+$/gm).map((path) => path.trim()), [
    "simgolf-lite/artifacts/zk682/failure-diagnostics/identity.json",
    ...["probe.json", "command.json", "playwright.json"].map((file) => `simgolf-lite/${root}/${file}`),
    ...["trace.zip", "video*.webm", "error-context.md", "test-failed-*.png", "inspector-desktop.png",
      "inspector-mobile.png", "m47-pseudo-channel.png"].map((file) => `simgolf-lite/${root}/test-results/m47-certification.e2e.ts-*/${file}`),
  ]);
  assert.match(artifact.trimEnd(), /if-no-files-found: warn\n          retention-days: 7$/);
});

test("Playwright resolves the snapshots-off configuration with only the trace override", async () => {
  const { configLoader } = createRequire(import.meta.url)("playwright/lib/common");
  const { loadConfigFromFile } = configLoader;
  const config = (name) => fileURLToPath(new URL(`../${name}`, import.meta.url));
  const overrides = { workers: 1, retries: 0 };
  const release = await loadConfigFromFile(config("playwright.release.config.ts"), overrides);
  const diagnosticPath = config("playwright.webkit-snapshot-diagnostic.config.ts");
  const diagnostic = await loadConfigFromFile(diagnosticPath, overrides);
  const publicConfig = (loaded) => Object.fromEntries(Object.entries(loaded.config));
  const expected = publicConfig(release);
  const originalProjects = expected.projects;
  assert.ok(originalProjects.some(({ name }) => name === "webkit-safari-proxy"));
  for (const project of originalProjects) assert.equal(project.use.trace, "retain-on-failure");
  assert.deepEqual(publicConfig(diagnostic), {
    ...expected,
    configFile: diagnosticPath,
    projects: originalProjects.map((project) => ({
      ...project,
      use: { ...project.use, trace: { mode: "retain-on-failure", snapshots: false, screenshots: true } },
    })),
  });
  assert.deepEqual(diagnostic.webServers, release.webServers);

  const outputDir = config("artifacts/zk682/webkit-snapshot-diagnostic/test-results");
  const isolated = await loadConfigFromFile(diagnosticPath, { ...overrides, outputDir });
  for (const project of isolated.config.projects) assert.equal(project.outputDir, outputDir);
  for (const project of originalProjects) assert.equal(project.outputDir, config("test-results"));
});

test("the actual diagnostic verdict rejects either original failure or incomplete receipts", (t) => {
  const verdict = step("Require both diagnostic commands to pass")
    .match(/node --input-type=module <<'NODE'\n([\s\S]+?)\n {10}NODE/);
  assert.ok(verdict);
  const cwd = mkdtempSync(join(tmpdir(), "zk682-diagnostics-workflow-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const artifacts = join(cwd, "artifacts/zk682/failure-diagnostics");
  mkdirSync(artifacts, { recursive: true });
  mkdirSync(join(cwd, "scripts"));
  copyFileSync(new URL("./zk682-command-receipt.mjs", import.meta.url), join(cwd, "scripts/zk682-command-receipt.mjs"));
  const perf = join(artifacts, "m27-perf.json");
  const playwright = join(artifacts, "m47-playwright.json");
  writeFileSync(perf, "{}");
  writeFileSync(playwright, "{}");
  const run = () => spawnSync(process.execPath, ["--input-type=module"], {
    cwd, input: verdict[1], encoding: "utf8", env: { ...process.env, ZK682_EXPECTED_COMMIT: COMMIT },
    timeout: 3_000,
  });
  function receipt(file, receiptId, exitCode, candidateCommit = COMMIT) {
    writeFileSync(join(artifacts, file), JSON.stringify({
      schemaVersion: 1, kind: "command-receipt", receiptId, candidateCommit, capturedAt: "2026-11-17T00:00:00Z",
      command: ["npm", "run", "test"], exitCode, durationMs: 1, passed: exitCode === 0,
    }));
  }
  const m27 = "headless-performance-command.json";
  const m47 = "browser-supported.json";
  const diagnostic = join(cwd, "artifacts/zk682/webkit-snapshot-diagnostic");
  mkdirSync(diagnostic);
  writeFileSync(join(diagnostic, "command.json"), '{"passed":false,"exitCode":124}');
  receipt(m27, "headless-performance", 0);
  receipt(m47, "browser-supported", 0);
  assert.equal(run().status, 0);
  writeFileSync(join(diagnostic, "command.json"), '{"passed":true,"exitCode":0}');
  receipt(m27, "headless-performance", 1);
  const m27Red = run();
  assert.equal(m27Red.status, 1);
  assert.match(m27Red.stderr, /headless-performance: exit 1/);
  receipt(m27, "headless-performance", 0);
  receipt(m47, "browser-supported", 1);
  assert.match(run().stderr, /browser-supported: exit 1/);
  receipt(m47, "browser-supported", 0, "b".repeat(40));
  assert.match(run().stderr, /candidate commit mismatch/);
  receipt(m47, "browser-supported", 0);
  rmSync(playwright);
  const missingPlaywright = run();
  assert.equal(missingPlaywright.status, 1);
  assert.match(missingPlaywright.stderr, /M47 Playwright report missing/);
  writeFileSync(playwright, "{}");
  rmSync(perf);
  assert.match(run().stderr, /M27 raw performance report missing/);
  rmSync(join(artifacts, m47));
  assert.match(run().stderr, /browser-supported: ENOENT/);
});
