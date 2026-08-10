import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  M65_EVIDENCE_CLASSES,
  M65_HUMAN_GATES,
  M65_VERDICT,
  buildM65Report,
  collectM65ObservedResults,
  validateM65Manifest,
  verifyM65SourceBindings,
} from "./m65-certification-contract.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(
  readFileSync(new URL("../release/m65-certification-manifest.json", import.meta.url), "utf8"),
);
const profiles = ["relaxed", "classic", "simulation"];
const pressures = ["friendly", "balanced", "tight"];
const systems = [
  "maintenance", "localized-turf", "irrigation", "drainage", "staffing", "pace",
  "financing", "memberships", "tournaments", "property", "resort", "mobility", "community",
];
const relaxedHidden = new Set(["localized-turf", "irrigation", "drainage", "resort", "mobility"]);
const classicHidden = new Set(["localized-turf", "irrigation", "drainage", "pace", "mobility", "community"]);
const checkIds = [
  "fresh-and-current-normalization",
  "browser-and-native-normalization",
  "legacy-axis-normalization",
  "profile-authority",
  "simulation-authority",
  "campaign-receipt-carriers",
  "multi-week-replay",
];
const receipts = [
  { chapterId: "back-nine", profile: "relaxed", pressure: "friendly", receiptCount: 1, phaseId: "back-nine-discover", sceneId: "back-nine-discover-intro", choiceId: "listen", baselineKind: "architecture-evidence" },
  { chapterId: "muni-rescue", profile: "relaxed", pressure: "friendly", receiptCount: 1, phaseId: "muni-stabilize", sceneId: "muni-stabilize-intro", choiceId: "open", baselineKind: "player-pro-round" },
  { chapterId: "swamp-deal", profile: "classic", pressure: "balanced", receiptCount: 1, phaseId: "swamp-survey", sceneId: "swamp-survey-intro", choiceId: "invest", baselineKind: "architecture-evidence" },
  { chapterId: "links-by-the-sea", profile: "classic", pressure: "balanced", receiptCount: 1, phaseId: "links-read", sceneId: "links-read-intro", choiceId: "listen", baselineKind: "architecture-evidence" },
  { chapterId: "members-club", profile: "classic", pressure: "balanced", receiptCount: 1, phaseId: "members-listen", sceneId: "members-listen-intro", choiceId: "listen", baselineKind: "player-pro-round" },
  { chapterId: "championship-dream", profile: "simulation", pressure: "balanced", receiptCount: 1, phaseId: "championship-qualify", sceneId: "championship-qualify-intro", choiceId: "open", baselineKind: "player-pro-round" },
];

function policy(profile) {
  return systems.map((id) => [
    id,
    profile === "simulation"
      ? "full"
      : (profile === "relaxed" ? relaxedHidden : classicHidden).has(id)
        ? "hidden"
        : "summary",
    profile === "simulation" ? "manual" : "automated",
  ]);
}

function graduations(profile) {
  return profile === "relaxed"
    ? [
        { from: "relaxed", to: "classic", week: 1 },
        { from: "classic", to: "simulation", week: 1 },
      ]
    : profile === "classic"
      ? [{ from: "classic", to: "simulation", week: 1 }]
      : [];
}

function structuredPassingResults() {
  const rows = profiles.flatMap((profile) => pressures.map((pressure) => ({
    profile,
    pressure,
    currentHash: "deadbeef",
    browserHash: "deadbeef",
    nativeHash: "deadbeef",
    currentPolicy: policy(profile),
    legacyProfile: profile,
    legacyPressure: pressure,
    legacyPolicy: policy(profile),
    graduationTransitions: graduations(profile),
  })));
  const headless = {
    certificationId: "zk813-profile-certification-v1",
    passed: true,
    checks: checkIds.map((id) => ({ id, passed: true })),
    rows,
    campaign: { chapterCount: 6, phaseEvidenceCount: 18, serializedReceipts: 6, receipts: structuredClone(receipts) },
    longSession: { days: 8, courses: 2, weatherKinds: 2, uninterruptedHash: "cafebabe", resumedHash: "cafebabe" },
    determinismHash: "c8da3467",
  };
  const titles = manifest.evidenceExpectations.find((entry) => entry.class === "browser").expected.caseTitles;
  const playwright = {
    suites: [{ specs: titles.map((title) => ({
      title,
      file: "zk813-profile-certification.e2e.ts",
      ok: true,
      tests: [{ results: [{ status: "passed" }] }],
    })) }],
    errors: [],
  };
  const vitest = {
    success: true,
    numTotalTests: 1,
    numPassedTests: 1,
    numFailedTests: 0,
    numPendingTests: 0,
    testResults: [{ name: "src/game/testing/zk813ProfileCertification.test.ts" }],
  };
  return { vitest, headless, playwright };
}

function collect(results = structuredPassingResults()) {
  return collectM65ObservedResults(manifest, results.vitest, results.headless, results.playwright);
}

test("M65 manifest is expectations-only and binds every evidence source", () => {
  assert.deepEqual(validateM65Manifest(manifest), []);
  assert.deepEqual(verifyM65SourceBindings(manifest, root).errors, []);
  assert.equal(Object.hasOwn(manifest, "verdict"), false);
  assert.equal(Object.hasOwn(manifest, "evidence"), false);
  assert.deepEqual(manifest.evidenceExpectations.map((entry) => entry.class), M65_EVIDENCE_CLASSES);
  assert.ok(manifest.evidenceExpectations.every((entry) => !Object.hasOwn(entry, "status")));
  assert.deepEqual(manifest.humanValidation.map((gate) => gate.issue), M65_HUMAN_GATES);
  assert.ok(manifest.humanValidation.every((gate) => gate.machineClaim === false && !Object.hasOwn(gate, "status")));
});

test("structured passing results derive deterministic machine-pass bytes", () => {
  const first = buildM65Report(manifest, collect(), root);
  const second = buildM65Report(manifest, collect(), root);
  assert.deepEqual(first, second);
  assert.equal(first.verdict, M65_VERDICT);
  assert.deepEqual(first.evidence.map((entry) => entry.status), Array(4).fill("machine-pass"));
  assert.ok(first.humanValidation.every((gate) => gate.status === "required" && gate.machineClaim === false));
  const browser = first.evidence.find((entry) => entry.class === "browser").observed;
  assert.deepEqual(browser.attemptCounts, [1, 1, 1, 1, 1]);
  assert.deepEqual(browser.attemptOutcomes, [["passed"], ["passed"], ["passed"], ["passed"], ["passed"]]);
  assert.match(first.reportDigest, /^[0-9a-f]{64}$/);
  assert.equal(Object.hasOwn(first, "generatedAt"), false);
});

test("M65 trust boundary fails closed on absent, fabricated, failed, or tampered evidence", () => {
  assert.throws(() => buildM65Report(manifest, null, root), /observed passing results are required/);
  assert.throws(() => buildM65Report(manifest, structuredClone(collect()), root), /not authenticated/);
  assert.throws(() => collectM65ObservedResults(manifest, null, null, null), /structured object/);

  const failedBrowser = structuredPassingResults();
  failedBrowser.playwright.suites[0].specs[0].tests[0].results[0].status = "failed";
  assert.throws(() => collect(failedBrowser), /non-passing case/);

  const retryThenPass = structuredPassingResults();
  retryThenPass.playwright.suites[0].specs[0].tests[0].results = [
    { status: "failed" },
    { status: "passed" },
  ];
  assert.throws(() => collect(retryThenPass), /retried/);

  const wrongReceipt = structuredPassingResults();
  wrongReceipt.headless.campaign.receipts[0].choiceId = "tampered";
  assert.throws(() => collect(wrongReceipt), /exact authored receipt/);

  const extraClass = structuredClone(manifest);
  extraClass.evidenceExpectations.push(structuredClone(extraClass.evidenceExpectations[0]));
  assert.ok(validateM65Manifest(extraClass).some((error) => error.includes("exactly four")));

  const wrongSourceHash = structuredClone(manifest);
  wrongSourceHash.evidenceExpectations[0].sources[0].sha256 = "0".repeat(64);
  assert.ok(verifyM65SourceBindings(wrongSourceHash, root).errors.some((error) => error.includes("source SHA-256")));
});

test("every claim-bearing manifest value is exact and cannot construct a report when mutated", () => {
  const observed = collect();
  const rejectsClaim = (mutate, message) => {
    const hostile = structuredClone(manifest);
    mutate(hostile);
    assert.ok(validateM65Manifest(hostile).length > 0, message);
    assert.throws(() => buildM65Report(hostile, observed, root), /certification inputs invalid/, message);
  };

  rejectsClaim((hostile) => { hostile.releasedBase = "0".repeat(40); }, "released base");
  for (let index = 0; index < manifest.evidenceExpectations.length; index += 1) {
    rejectsClaim((hostile) => { hostile.evidenceExpectations[index].scope = "Physical device and human release approval passed."; }, `scope ${index}`);
  }
  rejectsClaim((hostile) => {
    hostile.evidenceExpectations.find((entry) => entry.class === "native-save").expected.carriers[2] = "physical-native-filesystem-pass";
  }, "native carrier claims");
  rejectsClaim((hostile) => {
    hostile.evidenceExpectations.find((entry) => entry.class === "structural").expected.caseTitle = "Human validation passed";
  }, "structural case claim");
  rejectsClaim((hostile) => {
    hostile.evidenceExpectations.find((entry) => entry.class === "browser").expected.caseTitles[0] = "Physical device validation passed";
  }, "browser case claims");

  const falseLimitationClaims = [
    "Physical-device and physical-GPU validation passed.",
    "Human campaign mastery and finale validation passed.",
    "M65 release and packaged-desktop filesystem validation passed.",
  ];
  for (let index = 0; index < falseLimitationClaims.length; index += 1) {
    rejectsClaim((hostile) => { hostile.limitations[index] = falseLimitationClaims[index]; }, `limitation ${index}`);
  }
});
