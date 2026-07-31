import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  ZK571_PERFORMANCE_CONTRACT,
  applyEnvironmentContract,
  prepareZk571ArtifactDirectory,
  resolveZk571ArtifactDirectory,
  validateZk571PerformanceEvidence,
  zk571BrowserEnvironment,
  zk571PerformanceArtifactPath,
  zk571PerformanceEnvironment,
  zk571PwaEnvironment,
  zk571ScreenshotDirectory,
} from "./zk571-certification-contract.mjs";

function validEvidence(theme = "links") {
  return {
    version: 1,
    theme,
    fixture: "perfFixture",
    coldStartupMs: 1_200,
    fixtureLoadMs: 3_400,
    renderer: {
      workMs: 0.5,
      fps: 10,
      p95Ms: 100,
      sections: { ambient: 0.1, golfers: 0.2 },
    },
    effective: {
      theme,
      fixture: "perfFixture",
      measureSeconds: 20,
      warmupSeconds: 8,
      frameAssertion: false,
      budgets: {
        rendererWorkMilliseconds: 8,
        coldStartupMilliseconds: 5_000,
        frameMilliseconds: 33,
      },
    },
    gateValidation: {
      coldStartupWithinBudget: true,
      rendererWorkWithinBudget: true,
      frameWithinBudget: null,
      passed: true,
    },
  };
}

test("hostile inherited PERF values cannot weaken the ZK-571 contract", () => {
  const hostile = {
    PERF_THEME: "parkland",
    PERF_WORK_BUDGET_MS: "999999",
    PERF_STARTUP_BUDGET_MS: "999999",
    PERF_BUDGET_MS: "999999",
    PERF_MEASURE_S: "0.01",
    PERF_FIXTURE: "m27",
    PERF_ASSERT_FRAME: "1",
    PERF_OUTPUT_PATH: "/tmp/hostile.json",
  };
  const pinned = {
    ...hostile,
    ...zk571PerformanceEnvironment("/tmp/zk571-contract", "desert"),
  };
  assert.deepEqual(pinned, {
    PERF_THEME: "desert",
    PERF_WORK_BUDGET_MS: "8",
    PERF_STARTUP_BUDGET_MS: "5000",
    PERF_BUDGET_MS: "33",
    PERF_MEASURE_S: "20",
    PERF_FIXTURE: "perfFixture",
    PERF_ASSERT_FRAME: "0",
    PERF_OUTPUT_PATH: zk571PerformanceArtifactPath("/tmp/zk571-contract", "desert"),
  });
  assert.equal(ZK571_PERFORMANCE_CONTRACT.frameAssertion, false);
});

test("artifact preparation rejects broad, ancestor, malformed, and non-dedicated paths without deletion", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "zk571-path-contract-"));
  const repoRoot = join(sandbox, "repo");
  const appRoot = join(repoRoot, "simgolf-lite");
  const fakeHome = join(sandbox, "home");
  const temporaryRoot = join(sandbox, "tmp");
  mkdirSync(appRoot, { recursive: true });
  mkdirSync(fakeHome, { recursive: true });
  mkdirSync(temporaryRoot, { recursive: true });
  const appSentinel = join(appRoot, "app-sentinel");
  const repoSentinel = join(repoRoot, "repo-sentinel");
  writeFileSync(appSentinel, "app");
  writeFileSync(repoSentinel, "repo");
  const context = { appRoot, repoRoot, homeDirectory: fakeHome, temporaryRoot };

  for (const dangerous of [
    "",
    ".",
    "..",
    "/",
    appRoot,
    repoRoot,
    dirnameSafe(repoRoot),
    fakeHome,
    temporaryRoot,
    join(temporaryRoot, "not-dedicated"),
    "bad\0path",
  ]) {
    assert.throws(
      () => prepareZk571ArtifactDirectory(dangerous, context),
      /ZK571|artifact|path|Refusing|Override/,
    );
  }
  assert.equal(readFileSync(appSentinel, "utf8"), "app");
  assert.equal(readFileSync(repoSentinel, "utf8"), "repo");
});

test("artifact preparation replaces only a validated dedicated leaf and rejects a symlink leaf", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "zk571-safe-leaf-"));
  const repoRoot = join(sandbox, "repo");
  const appRoot = join(repoRoot, "simgolf-lite");
  const fakeHome = join(sandbox, "home");
  const temporaryRoot = join(sandbox, "tmp");
  mkdirSync(appRoot, { recursive: true });
  mkdirSync(fakeHome, { recursive: true });
  mkdirSync(temporaryRoot, { recursive: true });
  const context = { appRoot, repoRoot, homeDirectory: fakeHome, temporaryRoot };
  const target = join(temporaryRoot, "zk571-safe-proof");
  const neighbor = join(temporaryRoot, "neighbor-sentinel");
  mkdirSync(target);
  writeFileSync(join(target, "stale.json"), "stale");
  writeFileSync(neighbor, "neighbor");

  const resolvedTarget = resolveZk571ArtifactDirectory(target, context);
  assert.equal(prepareZk571ArtifactDirectory(target, context), resolvedTarget);
  assert.equal(existsSync(join(target, "stale.json")), false);
  assert.equal(readFileSync(neighbor, "utf8"), "neighbor");

  const symlink = join(temporaryRoot, "zk571-symlink-proof");
  symlinkSync(target, symlink, "dir");
  assert.throws(
    () => resolveZk571ArtifactDirectory(symlink, context),
    /symbolic-link/,
  );
  assert.equal(readFileSync(neighbor, "utf8"), "neighbor");
});

test("browser and PWA hostile environment values are pinned to isolated current-source serving", () => {
  const artifactDirectory = "/private/tmp/zk571-browser-proof";
  const browser = applyEnvironmentContract(
    {
      CI: "",
      ZK567_BASE_URL: "https://stale.invalid/",
      ZK571_ARTIFACT_DIRECTORY: "/tmp/wrong",
      UNRELATED: "kept",
    },
    zk571BrowserEnvironment(artifactDirectory),
  );
  assert.deepEqual(browser, {
    CI: "1",
    ZK567_BASE_URL: "",
    ZK571_ARTIFACT_DIRECTORY: artifactDirectory,
    UNRELATED: "kept",
  });
  assert.equal(
    zk571ScreenshotDirectory(browser.ZK571_ARTIFACT_DIRECTORY),
    join(artifactDirectory, "screenshots"),
  );

  const pwaContract = zk571PwaEnvironment();
  const pwa = applyEnvironmentContract(
    {
      COURSECRAFT_PWA_URL: "https://stale.invalid/",
      COURSECRAFT_PWA_BASE: "/hostile/",
      COURSECRAFT_PWA_PORT: "9999",
    },
    pwaContract.set,
    pwaContract.unset,
  );
  assert.deepEqual(pwa, {
    COURSECRAFT_PWA_BASE: "/",
    COURSECRAFT_PWA_PORT: "4175",
  });
});

test("override screenshot evidence writes under the override and leaves canonical artifacts unchanged", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "zk571-screenshot-proof-"));
  const canonical = join(sandbox, "canonical");
  const override = join(sandbox, "zk571-browser-output");
  mkdirSync(canonical);
  writeFileSync(join(canonical, "sentinel.json"), "canonical");
  const screenshots = zk571ScreenshotDirectory(override);
  mkdirSync(screenshots, { recursive: true });
  writeFileSync(join(screenshots, "matrix.json"), "{\"override\":true}\n");
  assert.equal(
    readFileSync(join(canonical, "sentinel.json"), "utf8"),
    "canonical",
  );
  assert.equal(
    readFileSync(join(screenshots, "matrix.json"), "utf8"),
    "{\"override\":true}\n",
  );
  assert.equal(screenshots.startsWith(canonical), false);
});

test("performance evidence validation requires pinned theme, workload, budgets, and numeric renderer data", () => {
  assert.deepEqual(validateZk571PerformanceEvidence(validEvidence(), "links"), {
    ok: true,
    errors: [],
  });
  const malformed = validEvidence();
  malformed.theme = "parkland";
  malformed.effective.measureSeconds = 1;
  malformed.renderer.sections.ambient = Number.NaN;
  malformed.gateValidation.passed = false;
  const result = validateZk571PerformanceEvidence(malformed, "links");
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("theme")));
  assert.ok(result.errors.some((error) => error.includes("workload/budgets")));
  assert.ok(result.errors.some((error) => error.includes("sections")));
  assert.ok(result.errors.some((error) => error.includes("gateValidation")));
});

test("performance evidence rejects measured budget failures", () => {
  const slow = validEvidence("desert");
  slow.coldStartupMs = 5_001;
  slow.renderer.workMs = 8.01;
  const result = validateZk571PerformanceEvidence(slow, "desert");
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("coldStartupMs exceeds the pinned startup budget"));
  assert.ok(result.errors.includes("renderer.workMs exceeds the pinned work budget"));
});

function dirnameSafe(path) {
  const parent = resolve(path, "..");
  return parent === path ? "/" : parent;
}
