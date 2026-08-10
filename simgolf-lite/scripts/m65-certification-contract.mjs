import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const M65_SCHEMA_VERSION = 2;
export const M65_CERTIFICATION_ID = "m65-zk813-profile-certification-v2";
export const M65_VERDICT = "machine-pass/HOLD_FOR_HUMAN_VALIDATION";
export const M65_RELEASED_BASE = "946838ef070b4cb300bf55328a3b81fd68a5080e";
export const M65_EVIDENCE_CLASSES = ["structural", "headless", "browser", "native-save"];
export const M65_HUMAN_GATES = ["ZK-255", "ZK-374", "ZK-403", "ZK-404"];
export const M65_SOURCE_ALLOWLIST = [
  "e2e/zk813-profile-certification.e2e.ts",
  "src/game/testing/zk813ProfileCertification.test.ts",
  "src/game/testing/zk813ProfileCertification.ts",
];

const EXPECTED_BROWSER_CASE_TITLES = [
  "ZK-813 structural start matrix keeps all nine selected profile and pressure pairs visible through run creation",
  "ZK-813 campaign fixtures expose Relaxed and Classic authored assignments without treating fixture state as gameplay proof",
  "ZK-813 campaign fixtures expose late Classic and Simulation authored assignments without treating fixture state as gameplay proof",
  "ZK-813 Classic control takeover remains authoritative and save-safe",
  "ZK-813 keyboard launch and pointer first-hole workflow stay localized and contained",
];
const EXPECTED_NATIVE_CARRIERS = [
  "current-schema-canonical-hash",
  "browser-json-canonical-hash",
  "native-shaped-in-memory-canonical-hash",
  "legacy-schema-policy",
];
const EXPECTED_LIMITATIONS = [
  "No moderated player study, subjective golf-authenticity judgment, accessibility review by a human, physical-device test, physical-GPU test, or release-owner sign-off is represented as machine evidence.",
  "Campaign fixture assignments and receipt persistence are structural evidence; they are not fabricated proof of real phase mastery, finale completion, or a 12–18 hour player journey.",
  "Browser automation and native-shaped in-memory canonical-hash equality do not replace packaged-desktop or real filesystem validation.",
];

const EXPECTATION_CONTRACTS = {
  "structural-profile-pressure-matrix": {
    class: "structural",
    sources: ["e2e/zk813-profile-certification.e2e.ts"],
    expected: {
      axes: 9,
      caseTitle: EXPECTED_BROWSER_CASE_TITLES[0],
    },
    scope: "All nine experience-profile/economic-pressure pairs are launched through keyboard-operated setup controls and preserved in created-run text state.",
  },
  "headless-deterministic-certification": {
    class: "headless",
    sources: [
      "src/game/testing/zk813ProfileCertification.ts",
      "src/game/testing/zk813ProfileCertification.test.ts",
    ],
    expected: { tests: 1, checks: 7, rows: 9, determinismHash: "c8da3467" },
    scope: "Observed semantic assertions cover exact legacy axes and policies, exact monotonic graduation edges, exact campaign receipts, canonical save-carrier hashes, and multi-week replay.",
  },
  "browser-interaction-certification": {
    class: "browser",
    sources: ["e2e/zk813-profile-certification.e2e.ts"],
    expected: { cases: 5, attemptsPerCase: 1, caseTitles: EXPECTED_BROWSER_CASE_TITLES },
    scope: "Observed Chromium cases cover the nine-axis matrix, six campaign assignments, Classic takeover save/reload, keyboard tutorial launch, pointer first-hole authoring, pseudo-localized content, and 390×640 overlay containment.",
  },
  "native-save-carrier-normalization": {
    class: "native-save",
    sources: [
      "src/game/testing/zk813ProfileCertification.ts",
      "src/game/testing/zk813ProfileCertification.test.ts",
    ],
    expected: { carriers: EXPECTED_NATIVE_CARRIERS },
    scope: "Observed canonical-hash equality for current-schema, browser JSON, and native-shaped in-memory carriers plus explicit legacy policy normalization; no physical native filesystem is exercised.",
  },
};

const EXPECTED_HEADLESS_CHECK_IDS = [
  "fresh-and-current-normalization",
  "browser-and-native-normalization",
  "legacy-axis-normalization",
  "profile-authority",
  "simulation-authority",
  "campaign-receipt-carriers",
  "multi-week-replay",
];

const PROFILE_PRESSURE_PAIRS = [
  "relaxed:friendly", "relaxed:balanced", "relaxed:tight",
  "classic:friendly", "classic:balanced", "classic:tight",
  "simulation:friendly", "simulation:balanced", "simulation:tight",
];

const ADVANCED_SYSTEM_IDS = [
  "maintenance", "localized-turf", "irrigation", "drainage", "staffing", "pace",
  "financing", "memberships", "tournaments", "property", "resort", "mobility", "community",
];
const RELAXED_HIDDEN = new Set(["localized-turf", "irrigation", "drainage", "resort", "mobility"]);
const CLASSIC_HIDDEN = new Set(["localized-turf", "irrigation", "drainage", "pace", "mobility", "community"]);
const EXPECTED_CAMPAIGN_RECEIPTS = [
  { chapterId: "back-nine", profile: "relaxed", pressure: "friendly", receiptCount: 1, phaseId: "back-nine-discover", sceneId: "back-nine-discover-intro", choiceId: "listen", baselineKind: "architecture-evidence" },
  { chapterId: "muni-rescue", profile: "relaxed", pressure: "friendly", receiptCount: 1, phaseId: "muni-stabilize", sceneId: "muni-stabilize-intro", choiceId: "open", baselineKind: "player-pro-round" },
  { chapterId: "swamp-deal", profile: "classic", pressure: "balanced", receiptCount: 1, phaseId: "swamp-survey", sceneId: "swamp-survey-intro", choiceId: "invest", baselineKind: "architecture-evidence" },
  { chapterId: "links-by-the-sea", profile: "classic", pressure: "balanced", receiptCount: 1, phaseId: "links-read", sceneId: "links-read-intro", choiceId: "listen", baselineKind: "architecture-evidence" },
  { chapterId: "members-club", profile: "classic", pressure: "balanced", receiptCount: 1, phaseId: "members-listen", sceneId: "members-listen-intro", choiceId: "listen", baselineKind: "player-pro-round" },
  { chapterId: "championship-dream", profile: "simulation", pressure: "balanced", receiptCount: 1, phaseId: "championship-qualify", sceneId: "championship-qualify-intro", choiceId: "open", baselineKind: "player-pro-round" },
];
const OBSERVED_PROOF = Symbol("m65-observed-proof");

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, label, errors) {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (stableJson(actual) !== stableJson(expected)) {
    errors.push(`${label} keys must be exactly ${expected.join(", ")}`);
    return false;
  }
  return true;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

export function m65ReportDigest(reportWithoutDigest) {
  return sha256(stableJson(reportWithoutDigest));
}

export function validateM65Manifest(manifest) {
  const errors = [];
  if (!exactKeys(manifest, [
    "schemaVersion", "certificationId", "milestone", "issue", "releasedBase",
    "evidenceExpectations", "humanValidation", "limitations", "documentation",
  ], "manifest", errors)) return errors;
  if (manifest.schemaVersion !== M65_SCHEMA_VERSION) errors.push(`schemaVersion must be ${M65_SCHEMA_VERSION}`);
  if (manifest.certificationId !== M65_CERTIFICATION_ID) errors.push(`certificationId must be ${M65_CERTIFICATION_ID}`);
  if (manifest.milestone !== "M65") errors.push("milestone must be M65");
  if (manifest.issue !== "ZK-813") errors.push("issue must be ZK-813");
  if (manifest.releasedBase !== M65_RELEASED_BASE) errors.push(`releasedBase must be ${M65_RELEASED_BASE}`);

  const expectations = Array.isArray(manifest.evidenceExpectations) ? manifest.evidenceExpectations : [];
  if (!Array.isArray(manifest.evidenceExpectations)) errors.push("evidenceExpectations must be an array");
  if (expectations.length !== M65_EVIDENCE_CLASSES.length) errors.push("evidenceExpectations must contain exactly four entries");
  const ids = expectations.map((entry) => entry?.id);
  const classes = expectations.map((entry) => entry?.class);
  if (new Set(ids).size !== expectations.length) errors.push("evidence expectation ids must be unique");
  if (new Set(classes).size !== expectations.length) errors.push("evidence expectation classes must be unique");
  if (stableJson([...classes].sort()) !== stableJson([...M65_EVIDENCE_CLASSES].sort())) {
    errors.push(`evidence expectations must contain exactly ${M65_EVIDENCE_CLASSES.join(", ")}`);
  }
  if (stableJson([...ids].sort()) !== stableJson(Object.keys(EXPECTATION_CONTRACTS).sort())) {
    errors.push("evidence expectation ids do not match the M65 allowlist");
  }

  for (const [index, entry] of expectations.entries()) {
    const label = `evidenceExpectations[${index}]`;
    if (!exactKeys(entry, ["id", "class", "sources", "expected", "scope"], label, errors)) continue;
    const contract = EXPECTATION_CONTRACTS[entry.id];
    if (!contract) continue;
    if (entry.class !== contract.class) errors.push(`${entry.id}: class must be ${contract.class}`);
    if (entry.scope !== contract.scope) errors.push(`${entry.id}: scope does not match the code-owned certification claim`);
    if (!Array.isArray(entry.sources)) {
      errors.push(`${entry.id}: sources must be an array`);
    } else {
      const paths = entry.sources.map((source) => source?.path);
      if (stableJson(paths) !== stableJson(contract.sources)) errors.push(`${entry.id}: source paths/count do not match the allowlist`);
      for (const [sourceIndex, source] of entry.sources.entries()) {
        if (!exactKeys(source, ["path", "sha256"], `${entry.id}.sources[${sourceIndex}]`, errors)) continue;
        if (!M65_SOURCE_ALLOWLIST.includes(source.path)) errors.push(`${entry.id}: source path is not allowlisted: ${source.path}`);
        if (typeof source.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(source.sha256)) errors.push(`${entry.id}: source SHA-256 is invalid`);
      }
    }
    if (!exactKeys(entry.expected, Object.keys(contract.expected), `${entry.id}.expected`, errors)) continue;
    if (stableJson(entry.expected) !== stableJson(contract.expected)) {
      errors.push(`${entry.id}: expected claims do not match the code-owned certification contract`);
    }
  }

  const humanValidation = Array.isArray(manifest.humanValidation) ? manifest.humanValidation : [];
  if (!Array.isArray(manifest.humanValidation)) errors.push("humanValidation must be an array");
  if (stableJson(humanValidation.map((gate) => gate?.issue)) !== stableJson(M65_HUMAN_GATES)) {
    errors.push(`humanValidation must link exactly ${M65_HUMAN_GATES.join(", ")}`);
  }
  for (const [index, gate] of humanValidation.entries()) {
    if (!exactKeys(gate, ["issue", "url", "machineClaim"], `humanValidation[${index}]`, errors)) continue;
    if (gate.machineClaim !== false) errors.push(`${gate.issue}: machineClaim must remain false`);
    if (gate.url !== `https://linear.app/zkutty/issue/${gate.issue}`) errors.push(`${gate.issue}: canonical Linear URL is required`);
  }
  if (stableJson(manifest.limitations) !== stableJson(EXPECTED_LIMITATIONS)) {
    errors.push("limitations must match the exact code-owned machine-evidence boundaries");
  }
  if (exactKeys(manifest.documentation, ["path"], "documentation", errors)
    && manifest.documentation.path !== "docs/M65_CERTIFICATION.md") {
    errors.push("documentation.path must be docs/M65_CERTIFICATION.md");
  }
  return errors;
}

export function verifyM65SourceBindings(manifest, rootDirectory) {
  const errors = validateM65Manifest(manifest);
  const bindings = {};
  if (errors.length > 0) return { errors, bindings };
  const uniqueSources = new Map();
  for (const expectation of manifest.evidenceExpectations) {
    for (const source of expectation.sources) {
      const previous = uniqueSources.get(source.path);
      if (previous !== undefined && previous !== source.sha256) {
        errors.push(`conflicting source SHA-256 bindings: ${source.path}`);
      }
      uniqueSources.set(source.path, source.sha256);
    }
  }
  if (uniqueSources.size !== M65_SOURCE_ALLOWLIST.length) errors.push("source bindings must cover the complete M65 source allowlist");
  for (const path of M65_SOURCE_ALLOWLIST) {
    const expected = uniqueSources.get(path);
    const absolute = resolve(rootDirectory, path);
    if (!existsSync(absolute)) {
      errors.push(`missing bound source: ${path}`);
      continue;
    }
    const actual = sha256(readFileSync(absolute));
    if (actual !== expected) errors.push(`source SHA-256 mismatch: ${path}`);
    bindings[path] = actual;
  }
  return { errors, bindings };
}

function flattenPlaywrightSpecs(suites, specs = []) {
  if (!Array.isArray(suites)) return specs;
  for (const suite of suites) {
    if (Array.isArray(suite?.specs)) specs.push(...suite.specs);
    flattenPlaywrightSpecs(suite?.suites, specs);
  }
  return specs;
}

function graduationPairs(profile) {
  return profile === "relaxed"
    ? [["relaxed", "classic"], ["classic", "simulation"]]
    : profile === "classic"
      ? [["classic", "simulation"]]
      : [];
}

function expectedPolicy(profile) {
  return ADVANCED_SYSTEM_IDS.map((id) => [
    id,
    profile === "simulation"
      ? "full"
      : (profile === "relaxed" ? RELAXED_HIDDEN : CLASSIC_HIDDEN).has(id)
        ? "hidden"
        : "summary",
    profile === "simulation" ? "manual" : "automated",
  ]);
}

function expectedGraduations(profile) {
  return graduationPairs(profile).map(([from, to]) => ({ from, to, week: 1 }));
}

export function collectM65ObservedResults(manifest, vitestJson, headlessReport, playwrightJson) {
  const errors = validateM65Manifest(manifest);
  const headlessExpectation = manifest?.evidenceExpectations?.find((entry) => entry.class === "headless")?.expected;
  const browserExpectation = manifest?.evidenceExpectations?.find((entry) => entry.class === "browser")?.expected;
  if (!isRecord(vitestJson)) {
    errors.push("Vitest result must be a structured object");
  } else {
    if (vitestJson.success !== true) errors.push("Vitest structured result did not pass");
    if (vitestJson.numTotalTests !== headlessExpectation?.tests || vitestJson.numPassedTests !== headlessExpectation?.tests
      || vitestJson.numFailedTests !== 0 || vitestJson.numPendingTests !== 0) {
      errors.push("Vitest structured counts do not match the headless expectation");
    }
    if (!Array.isArray(vitestJson.testResults) || vitestJson.testResults.length !== 1
      || !String(vitestJson.testResults[0]?.name ?? "").endsWith("src/game/testing/zk813ProfileCertification.test.ts")) {
      errors.push("Vitest structured result does not identify the bound headless source");
    }
  }

  if (!isRecord(headlessReport)) {
    errors.push("headless certification result must be a structured object");
  } else {
    if (headlessReport.certificationId !== "zk813-profile-certification-v1" || headlessReport.passed !== true) {
      errors.push("headless certification did not pass its authoritative contract");
    }
    if (!Array.isArray(headlessReport.checks) || headlessReport.checks.length !== headlessExpectation?.checks
      || stableJson(headlessReport.checks.map((entry) => entry?.id)) !== stableJson(EXPECTED_HEADLESS_CHECK_IDS)
      || headlessReport.checks.some((entry) => entry?.passed !== true)) {
      errors.push("headless semantic checks do not match the expected passing set");
    }
    if (!Array.isArray(headlessReport.rows) || headlessReport.rows.length !== headlessExpectation?.rows) {
      errors.push("headless row count does not match the expectation");
    } else {
      const pairs = headlessReport.rows.map((row) => `${row?.profile}:${row?.pressure}`);
      if (stableJson(pairs) !== stableJson(PROFILE_PRESSURE_PAIRS)) errors.push("headless profile/pressure rows are incomplete or reordered");
      for (const row of headlessReport.rows) {
        if (typeof row?.currentHash !== "string" || !/^[0-9a-f]{8}$/.test(row.currentHash)
          || row.currentHash !== row.browserHash || row.currentHash !== row.nativeHash) {
          errors.push(`canonical carrier hash mismatch for ${row?.profile}:${row?.pressure}`);
        }
        if (row?.legacyProfile !== row?.profile || row?.legacyPressure !== row?.pressure
          || stableJson(row?.legacyPolicy) !== stableJson(expectedPolicy(row?.profile))
          || stableJson(row?.currentPolicy) !== stableJson(expectedPolicy(row?.profile))) {
          errors.push(`legacy semantic mismatch for ${row?.profile}:${row?.pressure}`);
        }
        if (stableJson(row?.graduationTransitions) !== stableJson(expectedGraduations(row?.profile))) {
          errors.push(`graduation transition mismatch for ${row?.profile}:${row?.pressure}`);
        }
      }
    }
    if (headlessReport.determinismHash !== headlessExpectation?.determinismHash) errors.push("aggregate drift hash mismatch");
    if (headlessReport.campaign?.chapterCount !== 6 || headlessReport.campaign?.phaseEvidenceCount !== 18
      || headlessReport.campaign?.serializedReceipts !== 6
      || stableJson(headlessReport.campaign?.receipts) !== stableJson(EXPECTED_CAMPAIGN_RECEIPTS)) {
      errors.push("campaign receipt observation does not contain each exact authored receipt and axis");
    }
    if (headlessReport.longSession?.days !== 8 || !Number.isInteger(headlessReport.longSession?.courses)
      || headlessReport.longSession.courses < 2 || !Number.isInteger(headlessReport.longSession?.weatherKinds)
      || headlessReport.longSession.weatherKinds <= 1
      || typeof headlessReport.longSession?.uninterruptedHash !== "string"
      || !/^[0-9a-f]{8}$/.test(headlessReport.longSession.uninterruptedHash)
      || headlessReport.longSession.uninterruptedHash !== headlessReport.longSession?.resumedHash) {
      errors.push("headless multi-week replay hashes differ");
    }
  }

  if (!isRecord(playwrightJson)) {
    errors.push("Playwright result must be a structured object");
  }
  const specs = isRecord(playwrightJson) ? flattenPlaywrightSpecs(playwrightJson.suites) : [];
  const observedCases = specs.map((spec) => {
    const tests = Array.isArray(spec?.tests) ? spec.tests : [];
    const attemptOutcomes = tests.flatMap((entry) => Array.isArray(entry?.results)
      ? entry.results.map((result) => result?.status)
      : []);
    return {
      title: spec?.title,
      file: spec?.file,
      ok: spec?.ok,
      testCount: tests.length,
      attemptCount: attemptOutcomes.length,
      attemptOutcomes,
    };
  });
  if (observedCases.length !== browserExpectation?.cases
    || stableJson(observedCases.map((entry) => entry.title)) !== stableJson(browserExpectation?.caseTitles)) {
    errors.push("Playwright case titles/count do not match the browser expectation");
  }
  if (observedCases.some((entry) => entry.file !== "zk813-profile-certification.e2e.ts"
    || entry.ok !== true || entry.testCount !== 1 || entry.attemptCount !== 1
    || stableJson(entry.attemptOutcomes) !== stableJson(["passed"]))) {
    errors.push("Playwright structured result contains an unbound, retried, or non-passing case");
  }
  if (Array.isArray(playwrightJson?.errors) && playwrightJson.errors.length > 0) errors.push("Playwright structured result contains top-level errors");

  if (errors.length > 0) throw new Error(`M65 observed results invalid:\n${errors.join("\n")}`);
  const rows = headlessReport.rows;
  const observed = {
    headless: {
      runner: "vitest-json-v1",
      tests: vitestJson.numPassedTests,
      checks: headlessReport.checks.length,
      checkIds: headlessReport.checks.map((entry) => entry.id),
      rows: rows.length,
      profilePressurePairs: rows.map((row) => `${row.profile}:${row.pressure}`),
      canonicalHashEqualRows: rows.filter((row) => row.currentHash === row.browserHash && row.currentHash === row.nativeHash).length,
      explicitLegacyPolicyRows: rows.filter((row) => row.legacyProfile === row.profile && row.legacyPressure === row.pressure && stableJson(row.legacyPolicy) === stableJson(row.currentPolicy)).length,
      exactGraduationRows: rows.filter((row) => stableJson(row.graduationTransitions) === stableJson(expectedGraduations(row.profile))).length,
      campaignReceipts: headlessReport.campaign.serializedReceipts,
      deterministicReplay: headlessReport.longSession.uninterruptedHash === headlessReport.longSession.resumedHash,
      determinismHash: headlessReport.determinismHash,
      observationDigest: sha256(stableJson(headlessReport)),
    },
    browser: {
      runner: "playwright-json-v1",
      file: "e2e/zk813-profile-certification.e2e.ts",
      cases: observedCases.length,
      caseTitles: observedCases.map((entry) => entry.title),
      attemptCounts: observedCases.map((entry) => entry.attemptCount),
      attemptOutcomes: observedCases.map((entry) => entry.attemptOutcomes),
      observationDigest: sha256(stableJson(observedCases)),
    },
  };
  Object.defineProperty(observed, OBSERVED_PROOF, { value: true });
  return observed;
}

export function validateM65ObservedResults(manifest, observed) {
  const errors = [];
  if (observed?.[OBSERVED_PROOF] !== true) errors.push("observed results were not authenticated by structured gate collection");
  if (!exactKeys(observed, ["headless", "browser"], "observed", errors)) return errors;
  const headless = observed.headless;
  const browser = observed.browser;
  const headlessExpected = manifest.evidenceExpectations.find((entry) => entry.class === "headless").expected;
  const browserExpected = manifest.evidenceExpectations.find((entry) => entry.class === "browser").expected;
  if (!exactKeys(headless, [
    "runner", "tests", "checks", "checkIds", "rows", "profilePressurePairs",
    "canonicalHashEqualRows", "explicitLegacyPolicyRows", "exactGraduationRows",
    "campaignReceipts", "deterministicReplay", "determinismHash", "observationDigest",
  ], "observed.headless", errors)) return errors;
  if (headless.runner !== "vitest-json-v1" || headless.tests !== headlessExpected.tests
    || headless.checks !== headlessExpected.checks || headless.rows !== headlessExpected.rows
    || headless.canonicalHashEqualRows !== headlessExpected.rows
    || headless.explicitLegacyPolicyRows !== headlessExpected.rows
    || headless.exactGraduationRows !== headlessExpected.rows
    || headless.campaignReceipts !== 6 || headless.deterministicReplay !== true
    || headless.determinismHash !== headlessExpected.determinismHash
    || stableJson(headless.checkIds) !== stableJson(EXPECTED_HEADLESS_CHECK_IDS)
    || stableJson(headless.profilePressurePairs) !== stableJson(PROFILE_PRESSURE_PAIRS)
    || typeof headless.observationDigest !== "string" || !/^[0-9a-f]{64}$/.test(headless.observationDigest)) {
    errors.push("observed.headless does not prove the complete passing semantic contract");
  }
  if (!exactKeys(browser, [
    "runner", "file", "cases", "caseTitles", "attemptCounts", "attemptOutcomes", "observationDigest",
  ], "observed.browser", errors)) return errors;
  if (browser.runner !== "playwright-json-v1" || browser.file !== "e2e/zk813-profile-certification.e2e.ts"
    || browser.cases !== browserExpected.cases || stableJson(browser.caseTitles) !== stableJson(browserExpected.caseTitles)
    || stableJson(browser.attemptCounts) !== stableJson(Array(browserExpected.cases).fill(browserExpected.attemptsPerCase))
    || stableJson(browser.attemptOutcomes) !== stableJson(Array.from({ length: browserExpected.cases }, () => ["passed"]))
    || typeof browser.observationDigest !== "string" || !/^[0-9a-f]{64}$/.test(browser.observationDigest)) {
    errors.push("observed.browser does not prove the complete passing case contract");
  }
  return errors;
}

export function buildM65Report(manifest, observed, rootDirectory) {
  const source = verifyM65SourceBindings(manifest, rootDirectory);
  const observedErrors = observed == null ? ["observed passing results are required"] : validateM65ObservedResults(manifest, observed);
  const errors = [...source.errors, ...observedErrors];
  if (errors.length > 0) throw new Error(`M65 certification inputs invalid:\n${errors.join("\n")}`);

  const expectations = Object.fromEntries(manifest.evidenceExpectations.map((entry) => [entry.class, entry]));
  const evidence = [
    {
      id: expectations.structural.id,
      class: "structural",
      status: "machine-pass",
      sources: expectations.structural.sources,
      observed: {
        axes: expectations.structural.expected.axes,
        passingCase: expectations.structural.expected.caseTitle,
      },
      scope: expectations.structural.scope,
    },
    {
      id: expectations.headless.id,
      class: "headless",
      status: "machine-pass",
      sources: expectations.headless.sources,
      observed: observed.headless,
      scope: expectations.headless.scope,
    },
    {
      id: expectations.browser.id,
      class: "browser",
      status: "machine-pass",
      sources: expectations.browser.sources,
      observed: observed.browser,
      scope: expectations.browser.scope,
    },
    {
      id: expectations["native-save"].id,
      class: "native-save",
      status: "machine-pass",
      sources: expectations["native-save"].sources,
      observed: {
        carriers: expectations["native-save"].expected.carriers,
        canonicalHashEqualRows: observed.headless.canonicalHashEqualRows,
        explicitLegacyPolicyRows: observed.headless.explicitLegacyPolicyRows,
      },
      scope: expectations["native-save"].scope,
    },
  ];
  const humanValidation = manifest.humanValidation.map((gate) => ({ ...gate, status: "required" }));
  const verdict = evidence.every((entry) => entry.status === "machine-pass")
    && humanValidation.every((gate) => gate.machineClaim === false && gate.status === "required")
    ? M65_VERDICT
    : "machine-fail/HOLD_FOR_HUMAN_VALIDATION";
  if (verdict !== M65_VERDICT) throw new Error(`M65 derived verdict is ${verdict}`);
  const core = {
    schemaVersion: manifest.schemaVersion,
    certificationId: manifest.certificationId,
    milestone: manifest.milestone,
    issue: manifest.issue,
    releasedBase: manifest.releasedBase,
    verdict,
    sourceBindings: source.bindings,
    evidence,
    humanValidation,
    limitations: manifest.limitations,
  };
  return { ...core, reportDigest: m65ReportDigest(core) };
}

export function m65ReportBytes(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}
