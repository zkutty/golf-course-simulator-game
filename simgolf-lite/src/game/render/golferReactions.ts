import type { Point } from "../models/types";
import { createShotPacingPlan, shotPacingFrame, type ShotPacingCursorV1, type ShotPacingFrame, type ShotPacingPlan } from "../live/shotPacing";
import { isValidRetainedShotMotionV1, type RetainedShotMotionV1, type ShotMotionPositionV1 } from "../rules/shotMotion";
import { golferActivityOwnerKey, type ActivityOwner, type ActivityQuality, type GolferActivityFacts } from "./golferActivity";

/** Presentation policy only: these thresholds never change a shot, score, mood or expectation. */
export const GOLFER_REACTION_POLICY = Object.freeze({
  version: 1 as const, staticWindowMs: 600, actorCooldownMs: 8000, maxRecords: 128, maxRetentionMs: 10000,
  goodAimErrorTiles: 1.5, goodAimErrorFraction: .15, exceptionalPinErrorTiles: .3, exceptionalMinimumAimLengthTiles: 3,
  qualityCaps: Object.freeze({ high: 2, medium: 1, low: 0 }),
  priority: Object.freeze({ "hole-out": 4, exceptional: 3, good: 2, bad: 1, neutral: 0 }),
});
export const GOLFER_REACTION_REASONS = Object.freeze({
  holeOut: "observed-physical-hole-out", exceptional: "on-target-approach-near-actual-pin", good: "on-target-intended-green-approach",
  bad: "physical-hazard-or-penalty", neutral: "ordinary-safe-result", unknown: "missing-physical-truth", aggregate: "aggregate-putts-not-a-shot",
  relief: "relief-is-not-physical-success", putt: "non-holed-putt", aim: "missing-frozen-green-goal", offTarget: "outside-relative-aim-threshold",
  owner: "stale-owner-or-revision", playback: "invalid-shared-playback", endpoint: "physical-endpoint-not-observed", malformed: "malformed-evidence",
} as const);
export type GolferReactionResult = keyof typeof GOLFER_REACTION_POLICY.priority;
export type GolferReactionReason = typeof GOLFER_REACTION_REASONS[keyof typeof GOLFER_REACTION_REASONS];
type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export interface ReactionPlayback {
  readonly plan: ShotPacingPlan; readonly cursor: ShotPacingCursorV1; readonly frame: ShotPacingFrame;
}
/** The publisher must detach this DTO from World at shot acquisition/result publication. */
export interface GolferReactionPhysicalResult {
  readonly ownerKey: string; readonly authorityRevision: string;
  readonly provenance: "per-shot" | "aggregate-putts" | "unknown";
  readonly physicalRest: { readonly position: DeepReadonly<ShotMotionPositionV1>; readonly greenId: string | null; readonly hazard: "none" | "bunker" | "water" | "out-of-bounds" | null };
  readonly penaltyStrokes: number | null; readonly reliefApplied: boolean | null;
  readonly frozenAim: {
    readonly ownerKey: string; readonly authorityRevision: string; readonly frozenAt: "shot-acquisition";
    readonly from: Readonly<Point>; readonly target: Readonly<Point>;
    readonly greenGoal: { readonly holeId: string; readonly greenId: string; readonly pin: Readonly<Point> } | null;
  } | null;
}
export interface ClassifyGolferReactionInput extends ReactionPlayback {
  readonly owner: ActivityOwner; readonly currentOwner: ActivityOwner;
  readonly authorityRevision: string; readonly currentAuthorityRevision: string;
  readonly motion: DeepReadonly<RetainedShotMotionV1>; readonly retainedDistanceYards: number;
  /** Exact retained final event sampled by the owning playback, never a predicted destination. */
  readonly observation: { readonly key: string; readonly authorityRevision: string; readonly evidenceId: string; readonly eventIndex: number; readonly motionProgress: 1; readonly position: DeepReadonly<ShotMotionPositionV1> } | null;
  readonly physicalResult: GolferReactionPhysicalResult | null;
}
export interface GolferReactionClassification {
  readonly version: 1; readonly owner: ActivityOwner; readonly ownerKey: string; readonly authorityRevision: string;
  readonly plan: ShotPacingPlan; readonly planSignature: string; readonly evidenceId: string; readonly observedAtElapsedMs: number;
  readonly finalEvent: "rest" | "hole_out"; readonly finalEventIndex: number;
  readonly result: GolferReactionResult; readonly reason: GolferReactionReason;
  readonly physicalResult: GolferReactionPhysicalResult | null;
  readonly metrics: { readonly intendedLengthTiles: number; readonly aimErrorTiles: number; readonly goodErrorLimitTiles: number; readonly pinErrorTiles: number } | null;
}
export interface GolferReactionClassificationResult {
  readonly classification: GolferReactionClassification | null; readonly reason: GolferReactionReason;
}
const classifications = new WeakSet<object>();
const states = new WeakSet<object>();
const finite = (v: unknown, min = -1000000, max = 1000000): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const label = (v: unknown, max = 256): v is string => typeof v === "string" && v.length > 0 && v.length <= max && Array.from(v).every((c) => c.charCodeAt(0) >= 32);
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
/** Do not invoke getters; bound validation work before calling the retained-motion guard. */
function plain(v: unknown, depth = 0, ancestors = new Set<object>(), budget = { remaining: 100000 }): boolean {
  if (--budget.remaining < 0) return false;
  if (v === null || typeof v === "boolean" || typeof v === "string") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (depth > 16 || !v || typeof v !== "object" || ancestors.has(v)) return false;
  if (!record(v) && !(Array.isArray(v) && Object.getPrototypeOf(v) === Array.prototype)) return false;
  const names = Reflect.ownKeys(v);
  if (names.length > 4097 || names.some((n) => typeof n !== "string")) return false;
  if (Array.isArray(v) && (names.length !== v.length + 1 || names.some((n) => n !== "length" && !/^(0|[1-9][0-9]*)$/u.test(n as string)))) return false;
  const seen = new Set(ancestors).add(v);
  return names.every((n) => {
    if (n === "length" && Array.isArray(v)) return true;
    const d = Object.getOwnPropertyDescriptor(v, n)!;
    return d.enumerable && Object.hasOwn(d, "value") && plain(d.value, depth + 1, seen, budget);
  });
}
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const aa = a as Record<string, unknown>, bb = b as Record<string, unknown>, names = Object.keys(a);
  return names.length === Object.keys(b).length && names.every((n) => Object.hasOwn(bb, n) && equal(aa[n], bb[n]));
}
function freezeCopy<T>(v: T): T {
  if (!v || typeof v !== "object" || classifications.has(v)) return v;
  const out: unknown = Array.isArray(v) ? v.map(freezeCopy) : Object.fromEntries(Object.entries(v).map(([k, value]) => [k, freezeCopy(value)]));
  return Object.freeze(out) as T;
}
const signature = (plan: ShotPacingPlan) => JSON.stringify([plan.key, plan.kind, plan.durationMs, plan.addressMs, plan.contactMs, plan.restMs, plan.firstContactT]);
const actorKey = (owner: ActivityOwner) => JSON.stringify([owner.scopeId, owner.actorId]);
const point = (v: unknown): v is Point => record(v) && Object.keys(v).length === 2 && finite(v.x) && finite(v.y);
const position = (v: unknown): v is ShotMotionPositionV1 => record(v) && Object.keys(v).length === 2 && point(v.point) && finite(v.heightYards);
function validPhysical(v: unknown): v is GolferReactionPhysicalResult {
  if (!record(v) || !label(v.ownerKey, 4096) || !label(v.authorityRevision) || !["per-shot", "aggregate-putts", "unknown"].includes(v.provenance as string)
    || !record(v.physicalRest) || !position(v.physicalRest.position) || !(v.physicalRest.greenId === null || label(v.physicalRest.greenId))
    || ![null, "none", "bunker", "water", "out-of-bounds"].includes(v.physicalRest.hazard as string | null)
    || !(v.penaltyStrokes === null || (finite(v.penaltyStrokes, 0, 100) && Number.isInteger(v.penaltyStrokes)))
    || !(v.reliefApplied === null || typeof v.reliefApplied === "boolean")) return false;
  const a = v.frozenAim;
  if (a === null) return true;
  if (!record(a) || !label(a.ownerKey, 4096) || !label(a.authorityRevision) || a.frozenAt !== "shot-acquisition" || !point(a.from) || !point(a.target)) return false;
  return a.greenGoal === null || (record(a.greenGoal) && label(a.greenGoal.holeId) && label(a.greenGoal.greenId) && point(a.greenGoal.pin));
}
function playbackValid(owner: ActivityOwner, p: ReactionPlayback): boolean {
  const key = golferActivityOwnerKey(owner), plan = p.plan;
  if (!key || !owner.shot || !record(plan) || Object.keys(plan).length !== 11 || plan.version !== 1 || plan.scopeId !== owner.scopeId || plan.actorId !== owner.actorId
    || plan.key !== key || !equal(plan.identity, owner.shot) || plan.kind !== (owner.shot.club === "Putter" ? "putt" : "swing")
    || !finite(plan.durationMs, plan.kind === "putt" ? 2400 : 6000, plan.kind === "putt" ? 4200 : 10000)
    || plan.addressMs !== (plan.kind === "putt" ? 500 : 1000) || plan.contactMs !== (plan.kind === "putt" ? 150 : 200)
    || plan.restMs !== (plan.kind === "putt" ? 650 : 900) || !finite(plan.firstContactT, 0, 1)) return false;
  const actual = shotPacingFrame(plan, p.cursor);
  return actual !== null && equal(actual, p.frame);
}

/** Validate the full retained shot once when its actual endpoint is observed. No terrain queries or resimulation. */
export function classifyGolferReaction(input: ClassifyGolferReactionInput): GolferReactionClassificationResult {
  const fail = (reason: GolferReactionReason) => Object.freeze({ classification: null, reason });
  if (!plain(input) || !record(input)) return fail(GOLFER_REACTION_REASONS.malformed);
  const key = golferActivityOwnerKey(input.owner);
  if (!key || !input.owner.shot || key !== golferActivityOwnerKey(input.currentOwner) || !label(input.authorityRevision) || input.authorityRevision !== input.currentAuthorityRevision) return fail(GOLFER_REACTION_REASONS.owner);
  if (!input.plan || !input.cursor || !input.frame || !playbackValid(input.owner, input) || !isValidRetainedShotMotionV1(input.motion)
    || !equal(input.motion.identity, input.owner.shot) || !finite(input.retainedDistanceYards, 0)
    || !equal(createShotPacingPlan({ scopeId: input.owner.scopeId, actorId: input.owner.actorId, motion: input.motion, distanceYards: input.retainedDistanceYards }), input.plan)) return fail(GOLFER_REACTION_REASONS.playback);
  const observation = input.observation, lastIndex = input.motion.events.length - 1, event = input.motion.events[lastIndex]!;
  if (!observation || observation.key !== key || observation.authorityRevision !== input.authorityRevision || !label(observation.evidenceId)
    || observation.eventIndex !== lastIndex || observation.motionProgress !== 1 || event.time !== 1 || !["rest", "hole_out"].includes(event.kind)
    || !equal(observation.position, input.motion.physicalRest) || input.cursor.elapsedMs < input.plan.durationMs - input.plan.restMs
    || input.frame.motionProgress !== 1 || !["rest", "complete"].includes(input.frame.phase)) return fail(GOLFER_REACTION_REASONS.endpoint);
  const physical = input.physicalResult;
  if (physical !== null && !validPhysical(physical)) return fail(GOLFER_REACTION_REASONS.malformed);
  if (physical && (physical.ownerKey !== key || physical.authorityRevision !== input.authorityRevision)) return fail(GOLFER_REACTION_REASONS.owner);
  let result: GolferReactionResult = "neutral", reason: GolferReactionReason = GOLFER_REACTION_REASONS.unknown;
  let metrics: GolferReactionClassification["metrics"] = null;
  if (physical?.provenance === "aggregate-putts") reason = GOLFER_REACTION_REASONS.aggregate;
  else if (physical?.provenance === "per-shot" && equal(physical.physicalRest.position, input.motion.physicalRest)) {
    const hazard = physical.physicalRest.hazard, relief = input.motion.reliefPosition !== null || physical.reliefApplied === true;
    if (event.kind === "hole_out") { result = "hole-out"; reason = GOLFER_REACTION_REASONS.holeOut; }
    else if ((hazard !== null && hazard !== "none") || (physical.penaltyStrokes !== null && physical.penaltyStrokes > 0)) { result = "bad"; reason = GOLFER_REACTION_REASONS.bad; }
    else if (relief) reason = GOLFER_REACTION_REASONS.relief;
    else if (input.plan.kind === "putt") reason = GOLFER_REACTION_REASONS.putt;
    else if (hazard === "none" && physical.penaltyStrokes === 0 && physical.reliefApplied === false) {
      const aim = physical.frozenAim, goal = aim?.greenGoal;
      if (!aim) reason = GOLFER_REACTION_REASONS.neutral;
      else if (aim.ownerKey !== key || aim.authorityRevision !== input.authorityRevision || !equal(aim.from, input.motion.from.point) || !goal
        || goal.holeId !== input.owner.shot.holeId || goal.greenId !== physical.physicalRest.greenId) reason = GOLFER_REACTION_REASONS.aim;
      else {
        const rest = input.motion.physicalRest.point;
        const intendedLengthTiles = Math.hypot(aim.target.x - aim.from.x, aim.target.y - aim.from.y);
        const aimErrorTiles = Math.hypot(rest.x - aim.target.x, rest.y - aim.target.y);
        const goodErrorLimitTiles = Math.min(GOLFER_REACTION_POLICY.goodAimErrorTiles, GOLFER_REACTION_POLICY.goodAimErrorFraction * intendedLengthTiles);
        const pinErrorTiles = Math.hypot(rest.x - goal.pin.x, rest.y - goal.pin.y);
        metrics = { intendedLengthTiles, aimErrorTiles, goodErrorLimitTiles, pinErrorTiles };
        if (intendedLengthTiles > 0 && aimErrorTiles <= goodErrorLimitTiles) {
          const exceptional = intendedLengthTiles >= GOLFER_REACTION_POLICY.exceptionalMinimumAimLengthTiles && pinErrorTiles <= GOLFER_REACTION_POLICY.exceptionalPinErrorTiles;
          result = exceptional ? "exceptional" : "good"; reason = exceptional ? GOLFER_REACTION_REASONS.exceptional : GOLFER_REACTION_REASONS.good;
        } else reason = GOLFER_REACTION_REASONS.offTarget;
      }
    }
  }
  const classification: GolferReactionClassification = freezeCopy({ version: 1, owner: input.owner, ownerKey: key, authorityRevision: input.authorityRevision,
    plan: input.plan, planSignature: signature(input.plan), evidenceId: observation.evidenceId, observedAtElapsedMs: input.cursor.elapsedMs,
    finalEvent: event.kind as "rest" | "hole_out", finalEventIndex: lastIndex, result, reason, physicalResult: physical, metrics });
  classifications.add(classification);
  return Object.freeze({ classification, reason });
}

export interface GolferReactionActor extends ReactionPlayback {
  readonly owner: ActivityOwner; readonly currentOwner: ActivityOwner;
  readonly authorityRevision: string; readonly currentAuthorityRevision: string;
  readonly classification: GolferReactionClassification | null;
  readonly visibility: "visible" | "culled"; readonly paused: boolean;
}
export interface GolferReactionBatch {
  /** Stable renderer-session lifecycle, independent of each LIVE/controlled shot domain.
   * Submit all current domains together once per existing ticker for a global cap. */
  readonly scopeId: string; readonly authorityRevision: string; readonly presentationTimeMs: number;
  readonly quality: ActivityQuality; readonly motionEnabled: boolean; readonly hidden: boolean;
  readonly discontinuity: "none" | "reload" | "skip" | "reveal";
  readonly actors: readonly GolferReactionActor[];
}
export interface GolferReactionRecord {
  readonly actorKey: string; readonly ownerKey: string | null; readonly authorityRevision: string;
  /** Shot ordering applies only within this current hole; it is not a round-wide ordinal. */
  readonly holeId: string | null; readonly planSignature: string | null; readonly shotNumber: number; readonly elapsedMs: number | null;
  readonly startedAtMs: number; readonly lastSeenMs: number; readonly paused: boolean;
  readonly lastCueAtMs: number | null; readonly consumed: boolean;
  readonly active: GolferReactionClassification | null;
}
export interface GolferReactionState {
  readonly version: 1; readonly scopeId: string; readonly authorityRevision: string; readonly presentationTimeMs: number;
  readonly records: readonly GolferReactionRecord[];
}
export interface GolferReactionOutput {
  readonly actorKey: string; readonly classification: GolferReactionClassification | null;
  readonly outcome: GolferActivityFacts["outcome"]; readonly reason: string;
}
export interface GolferReactionSchedule {
  readonly state: GolferReactionState | null; readonly outputs: readonly GolferReactionOutput[]; readonly reason: string | null;
}
const tombstone = (r: GolferReactionRecord, now: number): GolferReactionRecord => ({ ...r, ownerKey: null, planSignature: null, elapsedMs: null, startedAtMs: now, lastSeenMs: now, paused: false, consumed: true, active: null });
/** Pure caller-driven admission: never advances a cursor, adds dwell, schedules a timer or retains pending cues. */
export function scheduleGolferReactions(previous: GolferReactionState | null, batch: GolferReactionBatch): GolferReactionSchedule {
  const fail = (reason: string): GolferReactionSchedule => {
    // Invalid input discards choreography but cannot erase an owned cooldown and
    // turn recovery on the next valid frame into a fresh admission opportunity.
    const state: GolferReactionState | null = previous && states.has(previous)
      ? freezeCopy({ ...previous, records: previous.records.map((r) => tombstone(r, previous.presentationTimeMs)) }) : null;
    if (state) states.add(state);
    return Object.freeze({ state, outputs: Object.freeze([]), reason });
  };
  if (!plain(batch) || !record(batch) || !label(batch.scopeId) || !label(batch.authorityRevision) || !finite(batch.presentationTimeMs, 0, Number.MAX_SAFE_INTEGER)
    || !["high", "medium", "low"].includes(batch.quality) || typeof batch.motionEnabled !== "boolean" || typeof batch.hidden !== "boolean"
    || !["none", "reload", "skip", "reveal"].includes(batch.discontinuity) || !Array.isArray(batch.actors) || batch.actors.length > GOLFER_REACTION_POLICY.maxRecords) return fail("invalid-batch");
  const now = batch.presentationTimeMs;
  const prior = previous && states.has(previous) && previous.scopeId === batch.scopeId && previous.authorityRevision === batch.authorityRevision ? previous : null;
  if (prior && now < prior.presentationTimeMs) return fail("regressed-presentation-time");
  const delta = prior ? now - prior.presentationTimeMs : 0;
  const old = new Map(prior?.records.map((r) => [r.actorKey, r]) ?? []);
  if (batch.actors.some((actor) => !record(actor))) return fail("invalid-or-duplicate-actor");
  // Protect unexpired actor cooldowns before admitting new actors. Overflow cannot evict
  // a cooldown and then re-admit that actor early; it receives immediate empty fallback.
  const protectedKeys = new Set((prior?.records ?? []).filter((r) => {
    const current = batch.actors.find((a) => golferActivityOwnerKey(a.owner) !== null && actorKey(a.owner) === r.actorKey);
    const held = current && (r.paused || current.paused) ? delta : 0;
    return r.lastCueAtMs !== null && now - r.lastCueAtMs - held < GOLFER_REACTION_POLICY.actorCooldownMs;
  }).map((r) => r.actorKey));
  const seen = new Set<string>(), records: GolferReactionRecord[] = [], outputs: GolferReactionOutput[] = [];
  const suppressed = batch.hidden || batch.discontinuity !== "none";
  for (const actor of batch.actors) {
    const key = golferActivityOwnerKey(actor.owner), current = golferActivityOwnerKey(actor.currentOwner);
    if (!key || !actor.owner.shot || seen.has(actorKey(actor.owner))) return fail("invalid-or-duplicate-actor");
    const ak = actorKey(actor.owner); seen.add(ak);
    protectedKeys.delete(ak);
    if (records.length + protectedKeys.size >= GOLFER_REACTION_POLICY.maxRecords) {
      outputs.push({ actorKey: ak, classification: null, outcome: null, reason: "record-cap" }); continue;
    }
    let priorRecord = old.get(ak);
    if (priorRecord && (priorRecord.paused || actor.paused)) {
      priorRecord = { ...priorRecord, startedAtMs: priorRecord.startedAtMs + delta, lastCueAtMs: priorRecord.lastCueAtMs === null ? null : priorRecord.lastCueAtMs + delta };
    }
    const valid = key === current && label(actor.authorityRevision) && actor.currentAuthorityRevision === actor.authorityRevision
      && typeof actor.paused === "boolean" && ["visible", "culled"].includes(actor.visibility) && actor.plan && actor.cursor && actor.frame && playbackValid(actor.owner, actor);
    const base: GolferReactionRecord = priorRecord ?? { actorKey: ak, ownerKey: null, authorityRevision: actor.authorityRevision, holeId: null, planSignature: null,
      shotNumber: 0, elapsedMs: null, startedAtMs: now, lastSeenMs: now, paused: false, lastCueAtMs: null, consumed: false, active: null };
    let reason = "not-in-reaction-window";
    if (!valid || suppressed || actor.visibility === "culled") {
      records.push(tombstone(base, now)); outputs.push({ actorKey: ak, classification: null, outcome: null, reason: !valid ? "stale-or-invalid-owner-playback" : "discarded-choreography" }); continue;
    }
    const ps = signature(actor.plan), elapsed = actor.cursor.elapsedMs, start = actor.plan.durationMs - GOLFER_REACTION_POLICY.staticWindowMs;
    const sameOwner = base.ownerKey === key && base.planSignature === ps && base.authorityRevision === actor.authorityRevision;
    const backwards = sameOwner && base.elapsedMs !== null && elapsed < base.elapsedMs;
    const pausedMoved = sameOwner && actor.paused && base.elapsedMs !== elapsed;
    const expired = sameOwner && now - base.startedAtMs > GOLFER_REACTION_POLICY.maxRetentionMs;
    const sameHole = base.holeId === actor.owner.shot.holeId;
    const olderShot = !sameOwner && sameHole && base.shotNumber >= actor.owner.shot.shotNumber;
    let r: GolferReactionRecord = { ...base, ownerKey: key, authorityRevision: actor.authorityRevision, planSignature: ps,
      holeId: actor.owner.shot.holeId, shotNumber: sameHole ? Math.max(base.shotNumber, actor.owner.shot.shotNumber) : actor.owner.shot.shotNumber, elapsedMs: elapsed, lastSeenMs: now, paused: actor.paused,
      startedAtMs: sameOwner ? base.startedAtMs : now, consumed: sameOwner ? base.consumed : elapsed >= start || olderShot, active: sameOwner ? base.active : null };
    if (backwards || pausedMoved || expired || olderShot) {
      r = { ...tombstone(r, now), shotNumber: r.shotNumber }; reason = expired ? "retention-limit" : "discontinuous-playback";
    } else {
      const c = actor.classification;
      const proof = c && classifications.has(c) && c.ownerKey === key && c.authorityRevision === actor.authorityRevision && c.planSignature === ps
        && c.observedAtElapsedMs <= elapsed && c.observedAtElapsedMs >= actor.plan.durationMs - actor.plan.restMs ? c : null;
      const inWindow = elapsed >= start && elapsed < actor.plan.durationMs && actor.frame.phase === "rest" && actor.frame.motionProgress === 1;
      const crossed = sameOwner && base.elapsedMs !== null && base.elapsedMs < start && elapsed >= start;
      if (!inWindow || !proof || proof.result === "neutral" || !batch.motionEnabled) r = { ...r, active: null };
      if (inWindow && crossed && !actor.paused && !r.consumed) {
        r = { ...r, consumed: true };
        if (proof && proof.result !== "neutral" && batch.motionEnabled && (r.lastCueAtMs === null || now - r.lastCueAtMs >= GOLFER_REACTION_POLICY.actorCooldownMs)) {
          r = { ...r, active: proof }; reason = "candidate";
        } else reason = proof ? "cooldown-or-motion-policy" : "missing-current-endpoint-proof";
      }
      if (r.active && (!proof || r.active.evidenceId !== proof.evidenceId || !inWindow || (r.lastCueAtMs !== null && now - r.lastCueAtMs >= GOLFER_REACTION_POLICY.staticWindowMs && reason !== "candidate"))) r = { ...r, active: null };
    }
    records.push(r); outputs.push({ actorKey: ak, classification: r.active, outcome: null, reason });
  }
  // Priority coalescing is deterministic and bounded. Suppressed candidates are consumed, never queued.
  const candidates = records.filter((r) => r.active !== null).sort((a, b) => GOLFER_REACTION_POLICY.priority[b.active!.result] - GOLFER_REACTION_POLICY.priority[a.active!.result] || a.actorKey.localeCompare(b.actorKey));
  const admitted = new Set(candidates.slice(0, GOLFER_REACTION_POLICY.qualityCaps[batch.quality]).map((r) => r.actorKey));
  for (let i = 0; i < records.length; i++) {
    let r = records[i]!; const outputIndex = outputs.findIndex((out) => out.actorKey === r.actorKey); const out = outputs[outputIndex]!;
    if (r.active && admitted.has(r.actorKey)) {
      if (out.reason === "candidate") r = { ...r, lastCueAtMs: now };
      const c = r.active!;
      outputs[outputIndex] = { actorKey: r.actorKey, classification: c, outcome: { key: c.ownerKey, endpointObserved: true, evidenceId: c.evidenceId, result: c.result, eligible: true }, reason: "eligible-static-cue" };
    } else {
      if (r.active) outputs[outputIndex] = { ...out, classification: null, reason: "quality-cap" };
      r = { ...r, active: null };
    }
    records[i] = r;
  }
  // Absent actors retain only their cooldown scalar, not choreography or queued outcomes.
  for (const r of old.values()) if (!seen.has(r.actorKey) && r.lastCueAtMs !== null && now - r.lastCueAtMs < GOLFER_REACTION_POLICY.actorCooldownMs && records.length < GOLFER_REACTION_POLICY.maxRecords) records.push(tombstone(r, now));
  const state: GolferReactionState = freezeCopy({ version: 1, scopeId: batch.scopeId, authorityRevision: batch.authorityRevision, presentationTimeMs: now, records });
  states.add(state);
  return Object.freeze({ state, outputs: freezeCopy(outputs), reason: null });
}
