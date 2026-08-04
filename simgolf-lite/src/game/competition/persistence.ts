import { courseHandicap } from "./handicap";
import { adjustedGrossScore, scoreDifferential } from "./scoring";

export const HANDICAP_INDEX_MIN = -8;
export const HANDICAP_INDEX_MAX = 36;

export interface ConfidenceState {
  version: 1;
  status: "provisional" | "established";
  eligibleRoundCount: number;
  lastPostedRoundId: string | null;
}

export interface HandicapRoundEligibility {
  eligible: boolean;
  reasons: readonly string[];
}

export interface RoundHandicapSnapshot {
  version: 1;
  id: string;
  roundId: string;
  handicapIndex: number;
  confidence: ConfidenceState;
  course: {
    id: string;
    name: string;
    geometryVersion: string | null;
    teeSet: "forward" | "member" | "championship";
    pinRotation: "A" | "B" | "C";
    courseRating: number | null;
    slopeRating: number | null;
    par: number;
    holes: readonly { id: string; par: number; strokeIndex: number | null }[];
  };
  eligibility: HandicapRoundEligibility;
  postingKey: string;
  postingState: "unposted";
  startedWeek: number;
  startedDay: number;
}

export interface HandicapDifferentialEvidence {
  grossScore: number;
  adjustedGrossScore: number | null;
  courseRating: number | null;
  slopeRating: number | null;
  differential: number | null;
  holeScores: readonly { holeId: string; gross: number; par: number }[];
}

export interface HandicapScoreRecord {
  version: 1;
  id: string;
  roundId: string;
  postingKey: string;
  postingState: "ineligible" | "unposted" | "posted";
  snapshot: RoundHandicapSnapshot;
  eligibility: HandicapRoundEligibility;
  evidence: HandicapDifferentialEvidence;
  completedWeek: number;
  completedDay: number;
  postedWeek?: number;
  postedDay?: number;
  handicapIndexAfter?: number;
}

export interface HandicapProfile {
  version: 1;
  handicapIndex: number;
  source: "skill-seed" | "scores";
  confidence: ConfidenceState;
  scoreRecords: readonly HandicapScoreRecord[];
  postingLedger: readonly string[];
}

export interface HandicapNormalizationError {
  code: "INVALID_HANDICAP_PROFILE";
  path: string;
  message: string;
}

export type HandicapNormalizationResult =
  | { ok: true; profile: HandicapProfile; seeded: boolean }
  | { ok: false; error: HandicapNormalizationError };

type SkillRatings = Record<"power" | "driving" | "irons" | "shortGame" | "putting" | "recovery", number>;
type RoundCourseSource = {
  id: string; name: string; geometryVersion?: string;
  teeSet: "forward" | "member" | "championship"; pinRotation: "A" | "B" | "C";
  rating?: { courseRating: number; slope: number };
  holes: readonly { id: string; par: number; strokeIndex?: number | null }[];
};
type RoundSnapshotSource = {
  roundId: string; handicapIndex: number; confidence: ConfidenceState;
  course: RoundCourseSource; startedWeek: number; startedDay: number;
};
type CompletedRoundSource = {
  roundId: string; completedWeek: number; completedDay: number; conceded?: boolean;
  scorecard: readonly { holeId: string; par: number; strokes: number; penalties: number; complete: boolean }[];
};

const record = (value: unknown): value is Record<string, unknown> => value != null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const integer = (value: unknown, minimum = 0): value is number => Number.isSafeInteger(value) && (value as number) >= minimum;
const boundedIndex = (value: unknown): value is number => finite(value) && value >= HANDICAP_INDEX_MIN && value <= HANDICAP_INDEX_MAX;
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const round1 = (value: number) => (value < 0 ? -Math.round(-value * 10) : Math.round(value * 10)) / 10;
const diagnosis = (path: string, detail: string): HandicapNormalizationError => ({
  code: "INVALID_HANDICAP_PROFILE",
  path,
  message: `The saved handicap profile is invalid at ${path}: ${detail}`,
});

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(freeze);
  }
  return value;
}

const validConfidence = (value: unknown): value is ConfidenceState => record(value)
  && value.version === 1
  && (value.status === "provisional" || value.status === "established")
  && integer(value.eligibleRoundCount)
  && (value.lastPostedRoundId === null || typeof value.lastPostedRoundId === "string");
const validEligibility = (value: unknown): value is HandicapRoundEligibility => record(value)
  && typeof value.eligible === "boolean"
  && Array.isArray(value.reasons)
  && value.reasons.every((reason: unknown) => typeof reason === "string");

/** One deterministic provisional estimate; skill changes never reseed a profile. */
export function provisionalHandicapIndex(skills: SkillRatings): number {
  const skill = (value: number) => clamp(finite(value) ? value : 0, 0, 100);
  const weighted = skill(skills.power) * .08 + skill(skills.driving) * .2
    + skill(skills.irons) * .24 + skill(skills.shortGame) * .18
    + skill(skills.putting) * .22 + skill(skills.recovery) * .08;
  return clamp(round1(40 - .55 * weighted), HANDICAP_INDEX_MIN, HANDICAP_INDEX_MAX);
}

export function createHandicapProfile(skills: SkillRatings): HandicapProfile {
  return freeze({
    version: 1,
    handicapIndex: provisionalHandicapIndex(skills),
    source: "skill-seed",
    confidence: { version: 1, status: "provisional", eligibleRoundCount: 0, lastPostedRoundId: null },
    scoreRecords: [],
    postingLedger: [],
  });
}

export function decodeRoundHandicapSnapshot(raw: unknown, path = "round.handicapSnapshot"): RoundHandicapSnapshot | HandicapNormalizationError {
  if (!record(raw) || raw.version !== 1 || typeof raw.roundId !== "string" || raw.id !== `handicap-snapshot:${raw.roundId}`) return diagnosis(path, "snapshot identity is incomplete or inconsistent.");
  if (!boundedIndex(raw.handicapIndex)) return diagnosis(`${path}.handicapIndex`, "expected a value from -8.0 through 36.0.");
  if (!validConfidence(raw.confidence)) return diagnosis(`${path}.confidence`, "confidence evidence is incomplete.");
  const course = raw.course;
  if (!record(course) || typeof course.id !== "string" || typeof course.name !== "string" || !Array.isArray(course.holes)
    || !["forward", "member", "championship"].includes(course.teeSet as string) || !["A", "B", "C"].includes(course.pinRotation as string)
    || !integer(course.par) || (course.geometryVersion !== null && typeof course.geometryVersion !== "string")
    || (course.courseRating !== null && !finite(course.courseRating)) || (course.slopeRating !== null && (!finite(course.slopeRating) || course.slopeRating <= 0))
    || course.holes.some((hole: unknown) => !record(hole) || typeof hole.id !== "string" || !integer(hole.par) || (hole.strokeIndex !== null && !integer(hole.strokeIndex, 1)))) return diagnosis(`${path}.course`, "course setup evidence is incomplete.");
  if (!validEligibility(raw.eligibility)) return diagnosis(`${path}.eligibility`, "eligibility evidence is incomplete.");
  if (raw.postingKey !== `handicap-post:${raw.roundId}` || raw.postingState !== "unposted" || !integer(raw.startedWeek, 1) || !integer(raw.startedDay)) return diagnosis(path, "posting or start evidence is incomplete.");
  return freeze(structuredClone(raw) as unknown as RoundHandicapSnapshot);
}

function decodeScoreRecord(raw: unknown, path: string): HandicapScoreRecord | HandicapNormalizationError {
  if (!record(raw) || raw.version !== 1 || typeof raw.roundId !== "string" || raw.id !== `handicap-score:${raw.roundId}` || raw.postingKey !== `handicap-post:${raw.roundId}`
    || !["ineligible", "unposted", "posted"].includes(raw.postingState as string)) return diagnosis(path, "score-record identity or posting state is invalid.");
  const snapshot = decodeRoundHandicapSnapshot(raw.snapshot, `${path}.snapshot`);
  if ("code" in snapshot) return snapshot;
  if (snapshot.roundId !== raw.roundId || !validEligibility(raw.eligibility) || raw.eligibility.eligible !== (raw.postingState !== "ineligible")) return diagnosis(path, "score record and snapshot identities or eligibility disagree.");
  const evidence = raw.evidence;
  if (!record(evidence) || !integer(evidence.grossScore) || !Array.isArray(evidence.holeScores)
    || evidence.holeScores.some((hole: unknown) => !record(hole) || typeof hole.holeId !== "string" || !integer(hole.gross, 1) || !integer(hole.par))
    || (raw.eligibility.eligible ? !integer(evidence.adjustedGrossScore) || !finite(evidence.differential) : evidence.adjustedGrossScore !== null || evidence.differential !== null)) return diagnosis(`${path}.evidence`, "differential evidence is incomplete.");
  if (!integer(raw.completedWeek, 1) || !integer(raw.completedDay)
    || (raw.postingState === "posted" && (!integer(raw.postedWeek, 1) || !integer(raw.postedDay) || !boundedIndex(raw.handicapIndexAfter)))) return diagnosis(path, "completion or posting time is incomplete.");
  return freeze({ ...structuredClone(raw), snapshot } as HandicapScoreRecord);
}

/** Missing means a legacy career and seeds once; malformed present state is never replaced. */
export function normalizeHandicapProfile(raw: unknown, skills: SkillRatings): HandicapNormalizationResult {
  const path = "world.playerPro.handicapProfile";
  if (raw == null) return { ok: true, profile: createHandicapProfile(skills), seeded: true };
  if (!record(raw)) return { ok: false, error: diagnosis(path, "expected an object or a missing legacy field.") };
  if (!boundedIndex(raw.handicapIndex)) return { ok: false, error: diagnosis(`${path}.handicapIndex`, "expected a value from -8.0 through 36.0.") };
  if (raw.version !== 1 || !["skill-seed", "scores"].includes(raw.source as string) || !validConfidence(raw.confidence)
    || !Array.isArray(raw.scoreRecords) || !Array.isArray(raw.postingLedger) || raw.postingLedger.some((key: unknown) => typeof key !== "string")) return { ok: false, error: diagnosis(path, "profile structure is incomplete.") };
  const records: HandicapScoreRecord[] = [];
  for (let index = 0; index < raw.scoreRecords.length; index += 1) {
    const decoded = decodeScoreRecord(raw.scoreRecords[index], `${path}.scoreRecords[${index}]`);
    if ("code" in decoded) return { ok: false, error: decoded };
    records.push(decoded);
  }
  const uniqueRounds = new Set(records.map((entry) => entry.roundId));
  const uniqueKeys = new Set(records.map((entry) => entry.postingKey));
  const ledger = raw.postingLedger as string[];
  const posted = records.filter((entry) => entry.postingState === "posted");
  if (uniqueRounds.size !== records.length || uniqueKeys.size !== records.length || new Set(ledger).size !== ledger.length) return { ok: false, error: diagnosis(`${path}.scoreRecords`, "duplicate round IDs or posting keys are not allowed.") };
  if (posted.some((entry) => !ledger.includes(entry.postingKey)) || ledger.some((key) => !posted.some((entry) => entry.postingKey === key))) return { ok: false, error: diagnosis(`${path}.postingLedger`, "ledger entries must exactly match posted records.") };
  if (raw.confidence.eligibleRoundCount !== records.filter((entry) => entry.eligibility.eligible).length) return { ok: false, error: diagnosis(`${path}.confidence.eligibleRoundCount`, "it does not match eligible-round evidence.") };
  const lastPosted = posted.at(-1);
  const established = lastPosted && raw.handicapIndex === lastPosted.handicapIndexAfter && raw.source === "scores" && raw.confidence.status === "established" && raw.confidence.lastPostedRoundId === lastPosted.roundId;
  const provisional = !lastPosted && raw.source === "skill-seed" && raw.confidence.status === "provisional" && raw.confidence.lastPostedRoundId === null;
  if (!established && !provisional) return { ok: false, error: diagnosis(path, "index, confidence, and last posted score disagree.") };
  return { ok: true, seeded: false, profile: freeze({ ...structuredClone(raw), scoreRecords: records } as unknown as HandicapProfile) };
}

const legacySkills = (raw: unknown): SkillRatings => {
  const value = record(raw) ? raw : {};
  const get = (key: keyof SkillRatings) => finite(value[key]) ? value[key] : 0;
  return { power: get("power"), driving: get("driving"), irons: get("irons"), shortGame: get("shortGame"), putting: get("putting"), recovery: get("recovery") };
};

/** Save-v28 migration. Established profiles are normalized, never reseeded. */
export function migrateLegacyPlayerProHandicap(raw: unknown): unknown {
  if (!record(raw)) return raw;
  const normalized = normalizeHandicapProfile(raw.handicapProfile, legacySkills(raw.skills));
  return normalized.ok ? { ...raw, handicapProfile: normalized.profile } : raw;
}

export function roundHandicapEligibility(course: RoundCourseSource): HandicapRoundEligibility {
  const reasons: string[] = [];
  if (course.holes.length !== 9 && course.holes.length !== 18) reasons.push("Handicap posting requires a complete 9- or 18-hole routing.");
  if (!course.rating || !finite(course.rating.courseRating) || !finite(course.rating.slope) || course.rating.slope <= 0) reasons.push("The round has no valid frozen course rating and slope.");
  const indexes = course.holes.map((hole) => hole.strokeIndex);
  if (indexes.some((index) => !integer(index, 1) || index > course.holes.length) || new Set(indexes).size !== course.holes.length) reasons.push("Every routed hole needs one unique frozen stroke index.");
  return freeze({ eligible: reasons.length === 0, reasons });
}

export function captureRoundHandicapSnapshot(source: RoundSnapshotSource): RoundHandicapSnapshot {
  if (!boundedIndex(source.handicapIndex)) throw new Error("Round-start Handicap Index must be from -8.0 through 36.0.");
  const holes = source.course.holes.map((hole) => ({ id: hole.id, par: hole.par, strokeIndex: integer(hole.strokeIndex, 1) ? hole.strokeIndex : null }));
  return freeze({
    version: 1, id: `handicap-snapshot:${source.roundId}`, roundId: source.roundId,
    handicapIndex: source.handicapIndex, confidence: structuredClone(source.confidence),
    course: { id: source.course.id, name: source.course.name, geometryVersion: source.course.geometryVersion ?? null, teeSet: source.course.teeSet, pinRotation: source.course.pinRotation, courseRating: source.course.rating?.courseRating ?? null, slopeRating: source.course.rating?.slope ?? null, par: holes.reduce((sum, hole) => sum + hole.par, 0), holes },
    eligibility: roundHandicapEligibility(source.course), postingKey: `handicap-post:${source.roundId}`,
    postingState: "unposted", startedWeek: source.startedWeek, startedDay: source.startedDay,
  });
}

export function createHandicapScoreRecord(snapshot: RoundHandicapSnapshot, completed: CompletedRoundSource): HandicapScoreRecord {
  if (snapshot.roundId !== completed.roundId) throw new Error("The handicap snapshot and completed round IDs do not match.");
  if (!integer(completed.completedWeek, 1) || !integer(completed.completedDay)) throw new Error("Completed handicap rounds require a valid week and day.");
  const complete = completed.scorecard.length === snapshot.course.holes.length && completed.scorecard.every((hole, index) => hole.complete && hole.holeId === snapshot.course.holes[index]?.id && integer(hole.strokes) && integer(hole.penalties));
  const eligibility = snapshot.eligibility.eligible && complete && !completed.conceded ? freeze({ eligible: true, reasons: [] }) : freeze({ eligible: false, reasons: [...snapshot.eligibility.reasons, ...(!complete ? ["The completed scorecard is missing one or more authoritative hole scores."] : []), ...(completed.conceded ? ["A conceded round is not eligible for handicap posting."] : [])] });
  const holeScores = complete ? completed.scorecard.map((hole) => ({ holeId: hole.holeId, gross: hole.strokes + hole.penalties, par: hole.par })) : [];
  const grossScore = holeScores.reduce((sum, hole) => sum + hole.gross, 0);
  let adjustedGrossScore: number | null = null;
  let differential: number | null = null;
  if (eligibility.eligible && snapshot.course.courseRating != null && snapshot.course.slopeRating != null) {
    const playingHandicap = courseHandicap(snapshot.handicapIndex, { courseRating: snapshot.course.courseRating, slopeRating: snapshot.course.slopeRating, par: snapshot.course.par }).rounded;
    adjustedGrossScore = adjustedGrossScoreFn(playingHandicap, snapshot, holeScores);
    differential = scoreDifferential(adjustedGrossScore, snapshot.course.courseRating, snapshot.course.slopeRating);
  }
  return freeze({ version: 1, id: `handicap-score:${completed.roundId}`, roundId: completed.roundId, postingKey: snapshot.postingKey, postingState: eligibility.eligible ? "unposted" : "ineligible", snapshot, eligibility, evidence: { grossScore, adjustedGrossScore, courseRating: snapshot.course.courseRating, slopeRating: snapshot.course.slopeRating, differential, holeScores }, completedWeek: completed.completedWeek, completedDay: completed.completedDay });
}

function adjustedGrossScoreFn(playingHandicap: number, snapshot: RoundHandicapSnapshot, scores: readonly { gross: number }[]): number {
  return adjustedGrossScore({ id: "player-pro", playingHandicap, holeScores: scores.map((hole) => ({ playerId: "player-pro", gross: hole.gross, status: "played" })) }, snapshot.course.holes.map((hole) => ({ id: hole.id, par: hole.par, strokeIndex: hole.strokeIndex! })));
}

/** Completion can be replayed safely after reload; stable round/post keys win. */
export function recordCompletedHandicapRound(profile: HandicapProfile, score: HandicapScoreRecord): HandicapProfile {
  const existing = profile.scoreRecords.find((entry) => entry.roundId === score.roundId || entry.postingKey === score.postingKey);
  if (existing) {
    if (existing.roundId !== score.roundId || existing.postingKey !== score.postingKey) throw new Error("Handicap posting-key collision detected; the round was not recorded.");
    return profile;
  }
  return freeze({ ...profile, confidence: { ...profile.confidence, eligibleRoundCount: profile.confidence.eligibleRoundCount + (score.eligibility.eligible ? 1 : 0) }, scoreRecords: [...profile.scoreRecords, score] });
}

/** ZK-718 can call this after calculating an index; repeated calls are no-ops. */
export function markHandicapScoreRecordPosted(profile: HandicapProfile, args: { postingKey: string; handicapIndex: number; postedWeek: number; postedDay: number }): HandicapProfile {
  if (profile.postingLedger.includes(args.postingKey)) return profile;
  const index = profile.scoreRecords.findIndex((entry) => entry.postingKey === args.postingKey);
  if (index < 0) throw new Error(`No handicap score record exists for posting key ${args.postingKey}.`);
  const current = profile.scoreRecords[index];
  if (!current.eligibility.eligible || current.postingState === "ineligible") throw new Error(`Handicap score record ${current.roundId} is ineligible for posting.`);
  if (!boundedIndex(args.handicapIndex)) throw new Error("Posted Handicap Index must be from -8.0 through 36.0.");
  if (!integer(args.postedWeek, 1) || !integer(args.postedDay)) throw new Error("Posted handicap records require a valid week and day.");
  const records = [...profile.scoreRecords];
  records[index] = freeze({ ...current, postingState: "posted", postedWeek: args.postedWeek, postedDay: args.postedDay, handicapIndexAfter: args.handicapIndex });
  return freeze({ ...profile, handicapIndex: args.handicapIndex, source: "scores", confidence: { ...profile.confidence, status: "established", lastPostedRoundId: current.roundId }, scoreRecords: records, postingLedger: [...profile.postingLedger, args.postingKey] });
}
