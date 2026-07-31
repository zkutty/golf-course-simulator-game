import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
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
} from "./zk571-certification-contract.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const hasArtifactOverride = Object.prototype.hasOwnProperty.call(
  process.env,
  "ZK571_ARTIFACT_DIRECTORY",
);
const rawArtifactDirectory = hasArtifactOverride
  ? process.env.ZK571_ARTIFACT_DIRECTORY
  : undefined;
const ARTIFACT_DIRECTORY = resolveZk571ArtifactDirectory(
  rawArtifactDirectory,
  { appRoot: ROOT },
);
const CERTIFICATION_ID = "m53-zk571-v1";

const gateDefinitions = [
  {
    id: "certification-runner-contract",
    title: "Certification runner hostile-environment and evidence-schema contract",
    command: ["node", ["--test", "scripts/zk571-certification-contract.test.mjs"]],
    timeoutMilliseconds: 120_000,
    covers: ["pinned performance environment", "performance evidence schema", "hostile inherited environment"],
  },
  {
    id: "deterministic-core-report",
    title: "Deterministic M53 report and risk register",
    command: ["npm", ["run", "test:cert:m53:core"]],
    timeoutMilliseconds: 120_000,
    covers: ["living seasons", "all weather kinds", "ZK-646 economics", "adaptive quality", "risk register"],
  },
  {
    id: "authoritative-focused-units",
    title: "Authoritative season/economy/care/save/direct-golf/live/performance units",
    command: ["npx", [
      "vitest", "run",
      "src/game/testing/m53Certification.test.ts",
      "src/game/testing/m53SeasonalTerrainFixtures.test.ts",
      "src/game/seasons/seasons.test.ts",
      "src/game/models/biomeEconomics.test.ts",
      "src/game/conditions/surfaceCare.test.ts",
      "src/utils/save.test.ts",
      "src/game/testing/renderPerfFixture.test.ts",
      "src/game/testing/m50Certification.test.ts",
      "src/game/testing/m51Certification.test.ts",
      "--maxWorkers=2",
    ]],
    timeoutMilliseconds: 600_000,
    covers: ["multi-year transitions", "ZK-647 persistence/performance", "historical/current saves", "direct golf", "live operations"],
  },
  {
    id: "broad-unit-suite",
    title: "Complete unit and integration suite",
    command: ["npm", ["test", "--", "--maxWorkers=2"]],
    timeoutMilliseconds: 900_000,
    covers: ["regression surface"],
  },
  {
    id: "deterministic-soak",
    title: "Repository deterministic soak",
    command: ["npm", ["run", "test:soak"]],
    timeoutMilliseconds: 900_000,
    covers: ["long-horizon simulation", "save/reload determinism"],
  },
  {
    id: "production-build-payload",
    title: "Production build and authoritative payload audits",
    command: ["npm", ["run", "build"]],
    timeoutMilliseconds: 600_000,
    covers: ["bundle", "payload", "audio assets", "service-worker assets", "biome assets"],
  },
  {
    id: "audio-asset-unit-audit",
    title: "Audio provenance, codec, manifest, and fallback audit",
    command: ["npm", ["run", "test:audio-audit"]],
    timeoutMilliseconds: 120_000,
    covers: ["audio assets", "fallback"],
  },
  {
    id: "browser-screenshot-matrix",
    title: "Browser/PWA-facing state, pixel, responsive, accessibility, dock, care, and audio matrix",
    command: ["npx", [
      "playwright", "test",
      "e2e/zk571-certification.e2e.ts",
      "e2e/zk567-seasonal-terrain.e2e.ts",
      "e2e/zk569-surface-care.e2e.ts",
      "e2e/zk570-audio.e2e.ts",
      "e2e/design-dock.e2e.ts",
    ]],
    timeoutMilliseconds: 1_200_000,
    env: zk571BrowserEnvironment(ARTIFACT_DIRECTORY),
    effectiveEnvironment: {
      isolatedCurrentSourceServer: true,
      ci: "1",
      reuseExistingServer: false,
      zk567BaseUrl: "",
      screenshotDirectory: "screenshots",
    },
    covers: ["ZK-648 dock", "screenshot matrix", "adaptive quality", "surface care", "audio", "responsive", "accessibility semantics"],
  },
  {
    id: "pwa-smoke",
    title: "Installable/offline PWA smoke",
    command: ["npm", ["run", "test:pwa"]],
    timeoutMilliseconds: 600_000,
    env: zk571PwaEnvironment().set,
    unsetEnv: zk571PwaEnvironment().unset,
    effectiveEnvironment: {
      externalUrlAllowed: false,
      base: "/",
      port: 4175,
    },
    covers: ["PWA", "offline shell"],
  },
  {
    id: "desktop-unit",
    title: "Desktop integration unit suite",
    command: ["npm", ["run", "test:desktop"]],
    timeoutMilliseconds: 120_000,
    covers: ["desktop bridge", "window/security behavior"],
  },
  ...["parkland", "links", "desert"].map((theme) => ({
    id: `performance-${theme}`,
    title: `${theme[0].toUpperCase()}${theme.slice(1)} authoritative performance smoke`,
    command: ["npm", ["run", "test:perf"]],
    timeoutMilliseconds: 180_000,
    env: zk571PerformanceEnvironment(ARTIFACT_DIRECTORY, theme),
    performanceTheme: theme,
    covers: ["renderer work", "cold startup", "adaptive quality", theme],
  })),
];

const deferredGates = [
  {
    id: "linear-prerequisite-reconciliation",
    title: "Linear prerequisite and M53 milestone status reconciliation",
    execution: "deferred",
    outcome: "not-run",
    reason: "ZK-379 and supporting M53 issue/milestone statuses remain pending final human validation and Linear reconciliation; do not close ZK-571.",
  },
  {
    id: "human-visual-matrix",
    title: "Human visual review of generated screenshot matrix",
    execution: "deferred",
    outcome: "not-run",
    reason: "Review the retained 12 fixed-camera, High-quality desktop captures (3 biomes × 4 seasons) plus the single narrow responsive sample; separately review all four rotations and Low/Medium/High adaptive-quality transitions interactively.",
  },
  {
    id: "human-listening-matrix",
    title: "Human listening and mix-quality review",
    execution: "deferred",
    outcome: "not-run",
    reason: "No subjective listening is permitted in this machine-only pass.",
  },
  {
    id: "physical-gpu-frame-pacing",
    title: "Physical GPU frame-pacing certification",
    execution: "deferred",
    outcome: "not-run",
    reason: "Headless software rendering reports raw frame spacing but does not assert it.",
  },
  {
    id: "signed-distribution",
    title: "Signed provider-backed desktop/hosted distribution",
    execution: "not-applicable",
    outcome: "not-run",
    reason: "No signing, storefront, provider, or deployment target is in scope.",
  },
];

// A certification run is a transaction over a validated, dedicated leaf.
// Preparation atomically moves an old leaf aside before replacing it and
// never recursively deletes the raw environment value.
prepareZk571ArtifactDirectory(rawArtifactDirectory, { appRoot: ROOT });
const results = [];
const timings = [];

const onlyGate = process.env.ZK571_ONLY_GATE;
const selectedGateIds = new Set(
  onlyGate ? onlyGate.split(",").map((id) => id.trim()).filter(Boolean) : gateDefinitions.map((gate) => gate.id),
);
const unknownGateIds = [...selectedGateIds].filter((id) =>
  !gateDefinitions.some((gate) => gate.id === id));
if (unknownGateIds.length) {
  throw new Error(`Unknown ZK-571 gate(s): ${unknownGateIds.join(", ")}`);
}
const forceFailure = process.env.ZK571_FORCE_GATE_FAILURE;

for (const gate of gateDefinitions) {
  if (!selectedGateIds.has(gate.id)) {
    results.push({
      id: gate.id,
      title: gate.title,
      execution: "not-applicable",
      outcome: "not-run",
      covers: gate.covers,
      reason: "Excluded by ZK571_ONLY_GATE diagnostic filtering.",
    });
    continue;
  }
  const [declaredExecutable, declaredArgs] = gate.command;
  const forced = forceFailure === gate.id;
  const executable = forced ? process.execPath : declaredExecutable;
  const args = forced
    ? ["-e", "process.exit(23)"]
    : declaredArgs;
  console.log(`\n[ZK-571] ${gate.id}: ${gate.title}`);
  const started = performance.now();
  const childEnvironment = applyEnvironmentContract(
    process.env,
    {
      ...gate.env,
      ZK571_ARTIFACT_DIRECTORY: ARTIFACT_DIRECTORY,
    },
    gate.unsetEnv,
  );
  const child = spawnSync(executable, args, {
    cwd: ROOT,
    env: childEnvironment,
    stdio: "inherit",
    timeout: gate.timeoutMilliseconds,
    killSignal: "SIGTERM",
  });
  const elapsedMilliseconds = Math.round(performance.now() - started);
  const childPassed = child.status === 0 && child.signal == null;
  const termination = child.error?.code === "ETIMEDOUT"
    ? "timeout"
    : child.error
      ? "spawn-error"
      : child.signal
        ? "signal"
        : "completed";
  let performanceValidation = null;
  let performanceEvidence = null;
  if (gate.performanceTheme) {
    const outputPath = zk571PerformanceArtifactPath(
      ARTIFACT_DIRECTORY,
      gate.performanceTheme,
    );
    try {
      performanceEvidence = JSON.parse(readFileSync(outputPath, "utf8"));
      performanceValidation = validateZk571PerformanceEvidence(
        performanceEvidence,
        gate.performanceTheme,
      );
    } catch (error) {
      performanceValidation = {
        ok: false,
        errors: [`missing or malformed performance evidence: ${error.message}`],
      };
    }
  }
  const passed = childPassed
    && (performanceValidation == null || performanceValidation.ok);
  results.push({
    id: gate.id,
    title: gate.title,
    execution: "executed",
    outcome: passed ? "pass" : "fail",
    termination,
    timeoutMilliseconds: gate.timeoutMilliseconds,
    covers: gate.covers,
    command: [executable, ...args].join(" "),
    ...(gate.effectiveEnvironment
      ? { effectiveEnvironment: gate.effectiveEnvironment }
      : {}),
    ...(gate.performanceTheme ? {
      evidenceFile: `performance-${gate.performanceTheme}.json`,
      evidenceValidation: performanceValidation,
    } : {}),
    ...(forced ? { diagnosticForcedFailure: true } : {}),
  });
  timings.push({
    id: gate.id,
    elapsedMilliseconds,
    exitCode: child.status,
    signal: child.signal,
    termination,
    timeoutMilliseconds: gate.timeoutMilliseconds,
    errorCode: child.error?.code ?? null,
  });
}

const corePath = resolve(ARTIFACT_DIRECTORY, "core-certification.json");
let core = null;
try {
  core = JSON.parse(readFileSync(corePath, "utf8"));
} catch {
  // A failed core gate remains a failed executed gate; never infer evidence
  // from the source file or fabricate a replacement report.
}

const gates = [...results, ...deferredGates];
const completeRun = selectedGateIds.size === gateDefinitions.length;
const automatedPassed = completeRun
  && results.every((gate) => gate.outcome === "pass")
  && core?.passed === true;
const report = {
  version: 1,
  certificationId: CERTIFICATION_ID,
  automatedPassed,
  completeRun,
  releaseDisposition: automatedPassed
    ? "automated-evidence-passed-final-gates-deferred"
    : "automated-evidence-failed",
  coreDeterminismHash: core?.determinismHash ?? null,
  gates,
  unresolvedRiskIds: core?.unresolvedRisks?.map((risk) => risk.id) ?? [],
};
const performanceReport = {
  version: 1,
  certificationId: CERTIFICATION_ID,
  contract: ZK571_PERFORMANCE_CONTRACT,
  passed: ["parkland", "links", "desert"].every((theme) => {
    const gate = results.find((candidate) =>
      candidate.id === `performance-${theme}`);
    return gate?.outcome === "pass"
      && gate.evidenceValidation?.ok === true;
  }),
  themes: Object.fromEntries(["parkland", "links", "desert"].map((theme) => {
    const gate = results.find((candidate) =>
      candidate.id === `performance-${theme}`);
    const path = zk571PerformanceArtifactPath(ARTIFACT_DIRECTORY, theme);
    let evidence = null;
    try {
      evidence = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      // Missing evidence is already an explicit gate validation failure.
    }
    return [theme, {
      gate: {
        execution: gate?.execution ?? "not-applicable",
        outcome: gate?.outcome ?? "not-run",
        validation: gate?.evidenceValidation ?? null,
      },
      evidence,
    }];
  })),
};
writeFileSync(
  resolve(ARTIFACT_DIRECTORY, "gate-results.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
writeFileSync(
  resolve(ARTIFACT_DIRECTORY, "performance-report.json"),
  `${JSON.stringify(performanceReport, null, 2)}\n`,
);
writeFileSync(
  resolve(ARTIFACT_DIRECTORY, "local-measurements.json"),
  `${JSON.stringify({
    version: 1,
    certificationId: CERTIFICATION_ID,
    note: "Host-specific elapsed timings are measurements only and are excluded from deterministic pass/fail evidence.",
    timings,
  }, null, 2)}\n`,
);

const markdown = [
  "# M53 / ZK-571 certification",
  "",
  `Certification contract: \`${CERTIFICATION_ID}\``,
  "",
  `Automated disposition: **${report.releaseDisposition}**`,
  "",
  "## Machine gate manifest",
  "",
  "| Gate | Execution | Outcome | Coverage |",
  "| --- | --- | --- | --- |",
  ...gates.map((gate) =>
    `| ${gate.id} | ${gate.execution} | ${gate.outcome} | ${
      "covers" in gate ? gate.covers.join(", ") : gate.reason
    } |`),
  "",
  "## Deterministic core",
  "",
  core
    ? `Core checks: ${core.checks.filter((check) => check.passed).length}/${core.checks.length} passed. Determinism hash: \`${core.determinismHash}\`.`
    : "Core report was not produced; its executed gate failed.",
  "",
  "The report reuses the existing authoritative save, surface-care, seasonal, renderer, startup, and bundle/payload budgets. Local elapsed timings are recorded separately and do not change pass/fail.",
  "",
  "## Unresolved-risk register",
  "",
  ...(core?.unresolvedRisks ?? []).map((risk) =>
    `- **${risk.id} (${risk.status}, ${risk.severity})** — ${risk.evidence} Mitigation: ${risk.mitigation}`),
  "",
  "## Human verification matrix (deferred)",
  "",
  ...(core?.humanVerificationMatrix ?? []).map((item) => `- ${item}`),
  "",
  "No subjective screenshot inspection or listening was performed by this certification command.",
  "",
  "Retained screenshot evidence consists of 12 fixed-camera, High-quality desktop captures (3 biomes × 4 seasons), one narrow responsive sample, and their machine manifest. Rotation and Low/Medium/High adaptive-quality behavior require a separate interactive review; Playwright traces, videos, retries, and attachment copies are ephemeral.",
  "",
].join("\n");
writeFileSync(resolve(ARTIFACT_DIRECTORY, "certification.md"), markdown);

console.log(`\n[ZK-571] ${report.releaseDisposition}`);
if (!automatedPassed) process.exitCode = 1;
