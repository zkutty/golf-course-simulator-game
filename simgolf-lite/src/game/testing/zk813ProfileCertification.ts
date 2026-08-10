import { createNewGame } from "../gen/newGame";
import { createM26MultiCourseReferenceCourse } from "./referenceCourse";
import { runLiveDaysHeadless } from "../live/headless";
import { createSeasonalState } from "../seasons/seasons";
import { createScenarioGame, getScenario } from "../scenarios/scenarios";
import { normalizeCourseLayouts } from "../models/courseLayouts";
import {
  CAMPAIGN_CHAPTER_IDS,
  CAMPAIGN_PHASE_EVIDENCE,
} from "../campaign/profileContract";
import { campaignScene, resolveCampaignChoice } from "../campaign/campaign";
import {
  ADVANCED_SYSTEM_IDS,
  applySystemControlCommand,
  resolveSystemControlPolicy,
} from "../experience/systemControl";
import type { EconomicPressure, ExperienceProfile, World } from "../models/types";
import {
  CURRENT_SAVE_SCHEMA_VERSION,
  normalizeLoadedSaveResult,
  payloadForPersistence,
} from "../../utils/save";
import { hashCanonicalValue, hashGameState } from "../../utils/stateHash";

export const ZK813_CERTIFICATION_ID = "zk813-profile-certification-v1" as const;

const PROFILES = ["relaxed", "classic", "simulation"] as const satisfies readonly ExperienceProfile[];
const PRESSURES = ["friendly", "balanced", "tight"] as const satisfies readonly EconomicPressure[];

export interface ZK813CertificationCheck {
  id: string;
  passed: boolean;
  detail: string;
}

/** One deterministic row per supported experience-profile/economic-pressure pair. */
export interface ZK813ProfileCertificationRow {
  profile: ExperienceProfile;
  pressure: EconomicPressure;
  freshHash: string;
  currentHash: string;
  browserHash: string;
  nativeHash: string;
  legacyAxesHash: string;
  currentPolicy: Array<readonly [string, string, string]>;
  legacyProfile: ExperienceProfile;
  legacyPressure: EconomicPressure;
  legacyPolicy: Array<readonly [string, string, string]>;
  visibleSystems: number;
  manualSystems: number;
  automatedSystems: number;
  takeoverRestored: boolean;
  graduationTransitions: Array<{ from: ExperienceProfile; to: ExperienceProfile; week: number }>;
  graduationHash: string;
}

export interface ZK813CampaignReceiptEvidence {
  chapterId: string;
  profile: ExperienceProfile;
  pressure: EconomicPressure;
  receiptCount: number;
  phaseId: string | null;
  sceneId: string | null;
  choiceId: string | null;
  baselineKind: string | null;
}

export interface ZK813ProfileCertificationReport {
  certificationId: typeof ZK813_CERTIFICATION_ID;
  checks: ZK813CertificationCheck[];
  rows: ZK813ProfileCertificationRow[];
  campaign: {
    chapterCount: number;
    phaseEvidenceCount: number;
    serializedReceipts: number;
    receipts: ZK813CampaignReceiptEvidence[];
    digest: string;
  };
  longSession: {
    days: number;
    courses: number;
    weatherKinds: number;
    uninterruptedHash: string;
    resumedHash: string;
  };
  /** Deliberate boundaries: these require real player/UI flows, not fabricated state. */
  headlessGaps: readonly string[];
  determinismHash: string;
  passed: boolean;
}

function check(id: string, passed: boolean, detail: string): ZK813CertificationCheck {
  return { id, passed, detail };
}

function legacyDifficulty(profile: ExperienceProfile): "easy" | "normal" | "hard" {
  return profile === "relaxed" ? "easy" : profile === "classic" ? "normal" : "hard";
}

function mustLoad(input: unknown) {
  const result = normalizeLoadedSaveResult(input);
  if (result.ok) return result.payload;
  // The repository's broad TS configuration currently does not discriminate
  // several existing `{ ok: boolean }` unions; keep this local diagnostic
  // explicit without changing the authoritative save carrier.
  const failure = result as { ok: false; error: { code: string; message: string } };
  throw new Error(`ZK-813 save normalization failed: ${failure.error.code}:${failure.error.message}`);
}

function serializedSave(course: ReturnType<typeof createNewGame>["course"], world: World) {
  return {
    schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
    savedAt: 813,
    ...payloadForPersistence({ course: normalizeCourseLayouts(course), world }),
  };
}

function exerciseAuthority(world: World) {
  const first = ADVANCED_SYSTEM_IDS[0];
  const took = applySystemControlCommand(world, { type: "TAKE_SYSTEM_CONTROL", system: first });
  if (!took.ok) throw new Error(took.message);
  const returned = applySystemControlCommand(took.world, { type: "RETURN_SYSTEM_TO_PROFILE", system: first });
  if (!returned.ok) throw new Error(returned.message);
  let graduated = returned.world;
  if (graduated.experienceProfile === "relaxed") {
    const result = applySystemControlCommand(graduated, { type: "GRADUATE_EXPERIENCE_PROFILE", target: "classic" });
    if (!result.ok) throw new Error(result.message);
    graduated = result.world;
  }
  if (graduated.experienceProfile === "classic") {
    const result = applySystemControlCommand(graduated, { type: "GRADUATE_EXPERIENCE_PROFILE", target: "simulation" });
    if (!result.ok) throw new Error(result.message);
    graduated = result.world;
  }
  return {
    returned: returned.world,
    graduated,
    graduationTransitions: (graduated.systemControl?.graduations ?? []).map(({ from, to, week }) => ({ from, to, week })),
  };
}

function policyProjection(world: World): Array<readonly [string, string, string]> {
  return resolveSystemControlPolicy(world).systems.map(({ id, visibility, mode }) => [id, visibility, mode] as const);
}

function expectedGraduationTransitions(profile: ExperienceProfile) {
  return profile === "relaxed"
    ? [["relaxed", "classic"], ["classic", "simulation"]]
    : profile === "classic"
      ? [["classic", "simulation"]]
      : [];
}

function profileRow(profile: ExperienceProfile, pressure: EconomicPressure): ZK813ProfileCertificationRow {
  const fresh = createNewGame({
    mode: "sandbox",
    courseName: `ZK-813 ${profile} ${pressure}`,
    seed: 813_000 + PROFILES.indexOf(profile) * 10 + PRESSURES.indexOf(pressure),
    theme: "parkland",
    experienceProfile: profile,
    economicPressure: pressure,
  });
  const persisted = serializedSave(fresh.course, fresh.world);
  const current = mustLoad(persisted);
  const browser = mustLoad(JSON.parse(JSON.stringify(persisted)));
  const native = mustLoad({ ...persisted, savedAt: 814 });
  const legacyWorld: Record<string, unknown> = { ...persisted.world, difficulty: legacyDifficulty(profile) };
  delete legacyWorld.experienceProfile;
  delete legacyWorld.systemControl;
  const legacy = mustLoad({ ...persisted, schemaVersion: 1, world: legacyWorld });
  const authority = exerciseAuthority(current.world);
  const restoredPolicy = resolveSystemControlPolicy(authority.returned);
  const policy = resolveSystemControlPolicy(current.world);
  const currentPolicy = policyProjection(current.world);
  const legacyPolicy = policyProjection(legacy.world);
  const legacyProfile = legacy.world.experienceProfile;
  const legacyPressure = legacy.world.economicPressure;
  if (!legacyProfile || !legacyPressure) throw new Error(`ZK-813 legacy axes missing: ${profile}:${pressure}`);
  return {
    profile,
    pressure,
    freshHash: hashGameState(fresh),
    currentHash: hashGameState(current),
    browserHash: hashGameState(browser),
    nativeHash: hashGameState(native),
    legacyAxesHash: hashCanonicalValue({
      profile: legacy.world.experienceProfile,
      pressure: legacy.world.economicPressure,
      policy: resolveSystemControlPolicy(legacy.world).systems.map(({ id, visibility, mode }) => [id, visibility, mode]),
    }),
    currentPolicy,
    legacyProfile,
    legacyPressure,
    legacyPolicy,
    visibleSystems: policy.systems.filter((system) => system.visibility !== "hidden").length,
    manualSystems: policy.systems.filter((system) => system.mode === "manual").length,
    automatedSystems: policy.systems.filter((system) => system.mode === "automated").length,
    takeoverRestored: !restoredPolicy.systems.find((system) => system.id === ADVANCED_SYSTEM_IDS[0])?.overridden,
    graduationTransitions: authority.graduationTransitions,
    graduationHash: hashCanonicalValue({
      profile: authority.graduated.experienceProfile,
      highest: authority.graduated.systemControl?.highestProfile,
      graduations: authority.graduated.systemControl?.graduations,
      policy: resolveSystemControlPolicy(authority.graduated).systems.map(({ id, visibility, mode, source }) => [id, visibility, mode, source]),
    }),
  };
}

function campaignEvidence() {
  const rows = CAMPAIGN_CHAPTER_IDS.map((id) => {
    const started = createScenarioGame(getScenario(id)!);
    const scene = campaignScene(started.world.campaign);
    if (!scene) throw new Error(`ZK-813 campaign scene missing: ${id}`);
    const resolved = resolveCampaignChoice(started.course, started.world, scene.id, scene.choices[0]!.id);
    if (!resolved.ok) throw new Error(`ZK-813 campaign choice unavailable: ${id}:${resolved.reason}`);
    let loaded;
    try {
      loaded = mustLoad(serializedSave(resolved.course, resolved.world));
    } catch (error) {
      throw new Error(`ZK-813 campaign persistence failed for ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const receipts = loaded.world.campaign?.participation.receipts ?? [];
    const receipt = receipts[0];
    const profile = loaded.world.experienceProfile;
    const pressure = loaded.world.economicPressure;
    if (!profile || !pressure) throw new Error(`ZK-813 campaign axes missing after persistence: ${id}`);
    return {
      chapterId: id,
      profile,
      pressure,
      receiptCount: receipts.length,
      phaseId: receipt?.phaseId ?? null,
      sceneId: receipt?.sceneId ?? null,
      choiceId: receipt?.choiceId ?? null,
      baselineKind: receipt?.baseline.kind ?? null,
    };
  });
  return {
    chapterCount: rows.length,
    phaseEvidenceCount: Object.keys(CAMPAIGN_PHASE_EVIDENCE).length,
    serializedReceipts: rows.filter((row) => row.receiptCount === 1).length,
    receipts: rows,
    digest: hashCanonicalValue(rows.map((row) => ({
      id: row.chapterId,
      profile: row.profile,
      pressure: row.pressure,
      receipt: row.phaseId == null
        ? null
        : [row.phaseId, row.sceneId, row.choiceId, row.baselineKind],
    }))),
  };
}

const EXPECTED_CAMPAIGN_RECEIPTS: readonly ZK813CampaignReceiptEvidence[] = [
  { chapterId: "back-nine", profile: "relaxed", pressure: "friendly", receiptCount: 1, phaseId: "back-nine-discover", sceneId: "back-nine-discover-intro", choiceId: "listen", baselineKind: "architecture-evidence" },
  { chapterId: "muni-rescue", profile: "relaxed", pressure: "friendly", receiptCount: 1, phaseId: "muni-stabilize", sceneId: "muni-stabilize-intro", choiceId: "open", baselineKind: "player-pro-round" },
  { chapterId: "swamp-deal", profile: "classic", pressure: "balanced", receiptCount: 1, phaseId: "swamp-survey", sceneId: "swamp-survey-intro", choiceId: "invest", baselineKind: "architecture-evidence" },
  { chapterId: "links-by-the-sea", profile: "classic", pressure: "balanced", receiptCount: 1, phaseId: "links-read", sceneId: "links-read-intro", choiceId: "listen", baselineKind: "architecture-evidence" },
  { chapterId: "members-club", profile: "classic", pressure: "balanced", receiptCount: 1, phaseId: "members-listen", sceneId: "members-listen-intro", choiceId: "listen", baselineKind: "player-pro-round" },
  { chapterId: "championship-dream", profile: "simulation", pressure: "balanced", receiptCount: 1, phaseId: "championship-qualify", sceneId: "championship-qualify-intro", choiceId: "open", baselineKind: "player-pro-round" },
] as const;

function legacyAggregateDriftProjection(
  rows: ZK813ProfileCertificationRow[],
  campaign: ZK813ProfileCertificationReport["campaign"],
  longSession: ZK813ProfileCertificationReport["longSession"],
  headlessGaps: readonly string[],
) {
  const legacyRows = rows.map((row) => ({
    profile: row.profile,
    pressure: row.pressure,
    freshHash: row.freshHash,
    currentHash: row.currentHash,
    browserHash: row.browserHash,
    nativeHash: row.nativeHash,
    legacyAxesHash: row.legacyAxesHash,
    visibleSystems: row.visibleSystems,
    manualSystems: row.manualSystems,
    automatedSystems: row.automatedSystems,
    takeoverRestored: row.takeoverRestored,
    graduationHash: row.graduationHash,
  }));
  const legacyCampaign = {
    chapterCount: campaign.chapterCount,
    phaseEvidenceCount: campaign.phaseEvidenceCount,
    serializedReceipts: campaign.serializedReceipts,
    digest: campaign.digest,
  };
  const legacyChecks = [
    check("fresh-and-current-normalization", rows.every((row) => row.freshHash === row.currentHash), "all nine fresh starts preserve their canonical state through schema-31 normalization"),
    check("browser-and-native-normalization", rows.every((row) => row.browserHash === row.nativeHash && row.currentHash === row.browserHash), "JSON/browser and in-memory/native carriers normalize byte-identically"),
    check("legacy-axis-normalization", rows.every((row) => row.legacyAxesHash.length === 8), "legacy difficulty carriers retain the requested profile and explicit economic pressure"),
    check("profile-authority", rows.every((row) => row.takeoverRestored && row.graduationHash.length === 8), "all axes support sparse takeover return and monotonic graduation"),
    check("simulation-authority", rows.filter((row) => row.profile === "simulation").every((row) => row.visibleSystems === ADVANCED_SYSTEM_IDS.length && row.manualSystems === ADVANCED_SYSTEM_IDS.length && row.automatedSystems === 0), "Simulation exposes all thirteen systems as manual at every pressure"),
    check("campaign-receipt-carriers", campaign.chapterCount === 6 && campaign.phaseEvidenceCount === 18 && campaign.serializedReceipts === 6, "every authored start creates one serialized direct-evidence receipt"),
    check("multi-week-replay", longSession.courses >= 2 && longSession.weatherKinds > 1 && longSession.uninterruptedHash === longSession.resumedHash, "eight-day multi-course/weather save-resume run is deterministic"),
  ];
  return { checks: legacyChecks, rows: legacyRows, campaign: legacyCampaign, longSession, headlessGaps };
}

function longSessionEvidence() {
  const fresh = createNewGame({
    mode: "sandbox",
    courseName: "ZK-813 multi-course replay",
    seed: 813_813,
    theme: "parkland",
    experienceProfile: "simulation",
    economicPressure: "balanced",
  });
  const course = structuredClone(createM26MultiCourseReferenceCourse());
  const world = {
    ...fresh.world,
    seasonal: createSeasonalState({ runSeed: fresh.world.runSeed, theme: course.theme, week: 1, day: 0 }),
  };
  // Eight days crosses a weekly boundary. Resume exactly at that boundary,
  // which is the headless runner's authoritative day-index handoff.
  const uninterrupted = runLiveDaysHeadless({ course, world, days: 8, stepMinutes: 10 });
  const firstLeg = runLiveDaysHeadless({ course, world, days: 7, stepMinutes: 10 });
  const loaded = mustLoad(serializedSave(firstLeg.course, firstLeg.world));
  const resumed = runLiveDaysHeadless({ course: loaded.course, world: loaded.world, days: 1, stepMinutes: 10 });
  return {
    days: 8,
    courses: course.layouts?.length ?? 0,
    weatherKinds: new Set(uninterrupted.days.map((day) => day.weather?.kind).filter(Boolean)).size,
    uninterruptedHash: hashGameState({ course: uninterrupted.course, world: uninterrupted.world }),
    resumedHash: hashGameState({ course: resumed.course, world: resumed.world }),
  };
}

export function runZK813ProfileCertification(): ZK813ProfileCertificationReport {
  const rows = PROFILES.flatMap((profile) => PRESSURES.map((pressure) => profileRow(profile, pressure)));
  const campaign = campaignEvidence();
  const longSession = longSessionEvidence();
  const checks = [
    check("fresh-and-current-normalization", rows.every((row) => row.freshHash === row.currentHash), "all nine fresh starts preserve their canonical state through schema-31 normalization"),
    check("browser-and-native-normalization", rows.every((row) => row.browserHash === row.nativeHash && row.currentHash === row.browserHash), "browser JSON and native-shaped in-memory save carriers have exact canonical-hash equality with current-schema normalization"),
    check("legacy-axis-normalization", rows.every((row) => row.legacyProfile === row.profile && row.legacyPressure === row.pressure && hashCanonicalValue(row.legacyPolicy) === hashCanonicalValue(row.currentPolicy)), "every legacy carrier resolves the explicit expected profile, pressure, and full effective policy"),
    check("profile-authority", rows.every((row) => row.takeoverRestored && hashCanonicalValue(row.graduationTransitions.map(({ from, to }) => [from, to])) === hashCanonicalValue(expectedGraduationTransitions(row.profile))), "all axes restore sparse takeover and follow the exact relaxed-to-classic-to-simulation monotonic transition contract"),
    check("simulation-authority", rows.filter((row) => row.profile === "simulation").every((row) => row.visibleSystems === ADVANCED_SYSTEM_IDS.length && row.manualSystems === ADVANCED_SYSTEM_IDS.length && row.automatedSystems === 0), "Simulation exposes all thirteen systems as manual at every pressure"),
    check("campaign-receipt-carriers", campaign.chapterCount === 6 && campaign.phaseEvidenceCount === 18 && campaign.serializedReceipts === 6 && hashCanonicalValue(campaign.receipts) === hashCanonicalValue(EXPECTED_CAMPAIGN_RECEIPTS), "every authored start creates exactly one expected phase/scene/choice/baseline receipt with its authored axes"),
    check("multi-week-replay", longSession.courses >= 2 && longSession.weatherKinds > 1 && longSession.uninterruptedHash === longSession.resumedHash, "eight-day multi-course/weather save-resume run is deterministic"),
  ];
  const headlessGaps = [
    "Campaign phase 1/2 direct mastery and finale completion require real Player Pro round/architecture settlement; this headless certification only proves authored receipt creation and save continuity.",
    "Browser/native UI focus, accessibility, visual presentation, audio, and human golf-authenticity remain separate validation gates.",
  ] as const;
  const passed = checks.every((entry) => entry.passed);
  return {
    certificationId: ZK813_CERTIFICATION_ID,
    checks,
    rows,
    campaign,
    longSession,
    headlessGaps,
    determinismHash: hashCanonicalValue(legacyAggregateDriftProjection(rows, campaign, longSession, headlessGaps)),
    passed,
  };
}
