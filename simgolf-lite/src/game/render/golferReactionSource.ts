import type { LiveShotOutcome } from "../live/m47Types";
import type { ShotPacingCursorV1, ShotPacingFrame, ShotPacingPlan } from "../live/shotPacing";
import { shotPacingFrame } from "../live/shotPacing";
import type { Point } from "../models/types";
import type { SharedShotOutcome } from "../rules/contracts";
import { isValidRetainedShotMotionV1, type RetainedShotMotionV1, type ShotMotionIdentityV1, type ShotMotionPositionV1 } from "../rules/shotMotion";
import type { ActivityOwner } from "./golferActivity";
import { golferActivityOwnerKey } from "./golferActivity";
import { classifyGolferReaction, type GolferReactionClassification, type GolferReactionPhysicalResult } from "./golferReactions";

export const GOLFER_REACTION_SOURCE_LIMITS = Object.freeze({ maxOutcomes: 240, maxGreenCells: 512, maxCourseCells: 1048576 });
type ReadonlyMotion = Parameters<typeof classifyGolferReaction>[0]["motion"];
export interface ReactionGreenCapture {
  readonly course: { readonly width: number; readonly height: number; readonly tiles: readonly string[] };
  readonly holeId: string; readonly pin: Readonly<Point>; readonly from: Readonly<Point>; readonly target: Readonly<Point>;
}
export interface ReactionSourceCapture {
  readonly owner: ActivityOwner; readonly authorityRevision: string;
  readonly plan: ShotPacingPlan; readonly initialCursor: ShotPacingCursorV1;
  readonly motion: RetainedShotMotionV1; readonly distanceYards: number;
  readonly source: object; readonly courseSource: object | null; readonly handedness: "right" | "left" | null;
  readonly sharedOutcome: SharedShotOutcome | null;
  /** Null on restore/late acquisition without an original receipt. Never infer an aim from a path. */
  readonly originalAim: ReactionGreenCapture | null;
}
export interface ReactionSourceObservation {
  readonly owner: ActivityOwner; readonly currentOwner: ActivityOwner;
  readonly authorityRevision: string; readonly currentAuthorityRevision: string;
  readonly plan: ShotPacingPlan; readonly cursor: ShotPacingCursorV1; readonly frame: ShotPacingFrame;
  readonly motion: RetainedShotMotionV1; readonly position: Readonly<ShotMotionPositionV1>;
  readonly source: object; readonly courseSource: object | null; readonly handedness: "right" | "left" | null;
  readonly ownerCurrent: boolean;
}
interface Receipt {
  readonly owner: ActivityOwner; readonly key: string; readonly revision: string; readonly plan: ShotPacingPlan;
  readonly motion: ReadonlyMotion; readonly distance: number; readonly physical: GolferReactionPhysicalResult | null;
  readonly source: WeakRef<object>; readonly courseSource: WeakRef<object> | null; readonly motionSource: WeakRef<RetainedShotMotionV1>;
  readonly handedness: "right" | "left" | null; readonly armed: boolean;
  lastElapsedMs: number; classification: GolferReactionClassification | null;
}
/** Weak ownership only. No saved receipt, World, round, callback, queue or strong actor registry. */
const receipts = new WeakMap<object, Receipt>();
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1000000;
const point = (p: Readonly<Point> | null | undefined): p is Readonly<Point> => !!p && finite(p.x) && finite(p.y);
const samePoint = (a: Readonly<Point>, b: Readonly<Point>) => a.x === b.x && a.y === b.y;
const samePosition = (a: Readonly<ShotMotionPositionV1>, b: Readonly<ShotMotionPositionV1>) => !!a?.point && !!b?.point && samePoint(a.point, b.point) && a.heightYards === b.heightYards;
const sameIdentity = (a: Readonly<ShotMotionIdentityV1> | undefined, b: Readonly<ShotMotionIdentityV1>) => !!a && ["shotId", "holeId", "shotNumber", "seed", "club", "style", "modelVersion"].every((k) => a[k as keyof ShotMotionIdentityV1] === b[k as keyof ShotMotionIdentityV1]);
const samePlan = (a: ShotPacingPlan, b: ShotPacingPlan) => a.version === b.version && a.scopeId === b.scopeId && a.actorId === b.actorId && a.key === b.key
  && sameIdentity(a.identity, b.identity) && a.kind === b.kind && a.durationMs === b.durationMs && a.addressMs === b.addressMs && a.contactMs === b.contactMs && a.restMs === b.restMs && a.firstContactT === b.firstContactT;
function frozenCopy<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  return Object.freeze(Array.isArray(value) ? value.map(frozenCopy) : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, frozenCopy(v)]))) as T;
}

/** Bounded exact full-retained-identity association; duplicate matches are ambiguous. No shot-id/nearest fallback. */
export function matchingLiveReactionOutcome(outcomes: readonly LiveShotOutcome[] | undefined, motion: RetainedShotMotionV1): LiveShotOutcome | null {
  if (!outcomes || !Array.isArray(outcomes) || outcomes.length > GOLFER_REACTION_SOURCE_LIMITS.maxOutcomes) return null;
  const matches = outcomes.filter((o) => o && sameIdentity(o.sharedOutcome?.motion?.identity, motion.identity)
    && o.id === motion.identity.shotId && o.holeId === motion.identity.holeId && o.shotNumber === motion.identity.shotNumber
    && o.club === motion.identity.club && Number.isSafeInteger(o.seed) && (o.seed >>> 0) === motion.identity.seed);
  return matches.length === 1 ? matches[0]! : null;
}

function greenMembership(aim: ReactionGreenCapture | null, motion: RetainedShotMotionV1): { goal: NonNullable<GolferReactionPhysicalResult["frozenAim"]>["greenGoal"]; restGreenId: string | null } | null {
  if (!aim || aim.holeId !== motion.identity.holeId || !point(aim.from) || !samePoint(aim.from, motion.from.point) || !point(aim.target) || !point(aim.pin)) return null;
  const { width, height, tiles } = aim.course;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > GOLFER_REACTION_SOURCE_LIMITS.maxCourseCells || !Array.isArray(tiles) || tiles.length !== width * height) return null;
  const cell = (p: Readonly<Point>): number | null => {
    if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) return null;
    const x = Math.round(p.x), y = Math.round(p.y);
    return x < width && y < height ? y * width + x : null;
  };
  const start = cell(aim.pin), target = cell(aim.target), rest = cell(motion.physicalRest.point);
  if (start === null || target === null || tiles[start] !== "green") return null;
  const visited = new Set<number>([start]), queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const index = queue[i]!, x = index % width, y = Math.floor(index / width);
    for (const neighbor of [x > 0 ? index - 1 : -1, x + 1 < width ? index + 1 : -1, y > 0 ? index - width : -1, y + 1 < height ? index + width : -1]) {
      if (neighbor < 0 || tiles[neighbor] !== "green" || visited.has(neighbor)) continue;
      visited.add(neighbor);
      if (visited.size > GOLFER_REACTION_SOURCE_LIMITS.maxGreenCells) return null;
      queue.push(neighbor);
    }
  }
  if (!visited.has(target)) return null;
  const greenId = JSON.stringify([aim.holeId, aim.pin.x, aim.pin.y]);
  return { goal: { holeId: aim.holeId, greenId, pin: { x: aim.pin.x, y: aim.pin.y } }, restGreenId: rest !== null && visited.has(rest) ? greenId : null };
}
function physicalReceipt(input: ReactionSourceCapture, key: string): GolferReactionPhysicalResult | null {
  const s = input.sharedOutcome, m = input.motion;
  if (!s || !sameIdentity(s.motion?.identity, m.identity) || !point(s.physicalRest) || !samePoint(s.physicalRest, m.physicalRest.point)
    || !s.ruling || !["in_play", "holed", "penalty"].includes(s.ruling.status) || !Number.isSafeInteger(s.ruling.penaltyStrokes) || s.ruling.penaltyStrokes < 0 || s.ruling.penaltyStrokes > 100
    || !["none", "out_of_bounds", "penalty_area"].includes(s.ruling.penaltyKind) || !s.relief || !["not_required", "resolved", "unavailable"].includes(s.relief.status)) return null;
  const final = m.events[m.events.length - 1]!;
  // Aggregate putting/contradictory legacy summaries cannot certify a physical cup event.
  if ((s.ruling.status === "holed") !== (final.kind === "hole_out")) return null;
  const green = greenMembership(input.originalAim, m);
  const collision = s.collision;
  let hazard: GolferReactionPhysicalResult["physicalRest"]["hazard"] = null;
  if (s.ruling.penaltyKind === "out_of_bounds") hazard = "out-of-bounds";
  else if (collision?.kind === "terrain" && point(collision.point) && samePoint(collision.point, m.physicalRest.point)) {
    if (collision.terrain === "sand") hazard = "bunker";
    else if (collision.terrain === "water" || collision.terrain === "wetland") hazard = "water";
  }
  if (hazard === null && green?.restGreenId && s.ruling.penaltyKind === "none" && s.ruling.penaltyStrokes === 0) hazard = "none";
  const reliefApplied = m.reliefPosition !== null || s.relief.status === "resolved" ? true : s.relief.status === "not_required" ? false : null;
  return frozenCopy({ ownerKey: key, authorityRevision: input.authorityRevision, provenance: "per-shot", physicalRest: { position: m.physicalRest, greenId: green?.restGreenId ?? null, hazard },
    penaltyStrokes: s.ruling.penaltyStrokes, reliefApplied, frozenAim: green && input.originalAim ? { ownerKey: key, authorityRevision: input.authorityRevision, frozenAt: "shot-acquisition", from: { x: input.originalAim.from.x, y: input.originalAim.from.y }, target: { x: input.originalAim.target.x, y: input.originalAim.target.y }, greenGoal: green.goal } : null });
}

/** Called only at an existing acquisition. Receipt is private and never appears in render/save DTOs. */
export function captureGolferReactionSource(token: object, input: ReactionSourceCapture): boolean {
  receipts.delete(token);
  const key = golferActivityOwnerKey(input.owner);
  if (!key || !input.owner.shot || key !== input.plan.key || !sameIdentity(input.owner.shot, input.motion.identity) || !isValidRetainedShotMotionV1(input.motion)
    || !finite(input.distanceYards) || input.distanceYards < 0 || !input.authorityRevision || !["right", "left", null].includes(input.handedness)
    || !shotPacingFrame(input.plan, input.initialCursor)) return false;
  receipts.set(token, { owner: frozenCopy(input.owner), key, revision: input.authorityRevision, plan: frozenCopy(input.plan), motion: frozenCopy(input.motion), distance: input.distanceYards,
    physical: physicalReceipt(input, key), source: new WeakRef(input.source), courseSource: input.courseSource ? new WeakRef(input.courseSource) : null, motionSource: new WeakRef(input.motion), handedness: input.handedness,
    armed: input.initialCursor.elapsedMs < input.plan.durationMs - input.plan.restMs, lastElapsedMs: input.initialCursor.elapsedMs, classification: null });
  return true;
}
export function clearGolferReactionSource(token: object): void { receipts.delete(token); }

/** Actual shared frame/sample only; no predicted result and no full path revalidation per frame. */
export function observeGolferReactionSource(token: object, observed: ReactionSourceObservation): GolferReactionClassification | null {
  const r = receipts.get(token);
  if (!r) return null;
  const expectedFrame = shotPacingFrame(r.plan, observed.cursor);
  const frameMatches = expectedFrame && Object.entries(expectedFrame).every(([k, v]) => observed.frame[k as keyof ShotPacingFrame] === v);
  if (!observed.ownerCurrent || observed.source !== r.source.deref() || (r.courseSource === null ? observed.courseSource !== null : observed.courseSource !== r.courseSource.deref()) || observed.motion !== r.motionSource.deref() || observed.handedness !== r.handedness
    || golferActivityOwnerKey(observed.owner) !== r.key || golferActivityOwnerKey(observed.currentOwner) !== r.key || observed.authorityRevision !== r.revision || observed.currentAuthorityRevision !== r.revision
    || !sameIdentity(observed.motion.identity, r.motion.identity) || !samePlan(observed.plan, r.plan) || !frameMatches || observed.cursor.elapsedMs < r.lastElapsedMs
    || !samePosition(observed.motion.from, r.motion.from) || !samePosition(observed.motion.physicalRest, r.motion.physicalRest)) {
    receipts.delete(token); return null;
  }
  r.lastElapsedMs = observed.cursor.elapsedMs;
  const endpoint = r.plan.durationMs - r.plan.restMs;
  if (!r.armed || observed.cursor.elapsedMs < endpoint) return null;
  if (observed.frame.motionProgress !== 1 || !samePosition(observed.position, r.motion.physicalRest)) { receipts.delete(token); return null; }
  if (r.classification) return r.classification;
  const finalIndex = r.motion.events.length - 1, final = r.motion.events[finalIndex]!;
  if (final.time !== 1 || !["rest", "hole_out"].includes(final.kind) || !samePosition(final, observed.position)) { receipts.delete(token); return null; }
  r.classification = classifyGolferReaction({ owner: r.owner, currentOwner: observed.currentOwner, authorityRevision: r.revision, currentAuthorityRevision: observed.currentAuthorityRevision,
    plan: r.plan, cursor: observed.cursor, frame: observed.frame, motion: r.motion, retainedDistanceYards: r.distance,
    observation: { key: r.key, authorityRevision: r.revision, evidenceId: `retained-endpoint:${finalIndex}:${final.kind}`, eventIndex: finalIndex, motionProgress: 1, position: { point: { x: observed.position.point.x, y: observed.position.point.y }, heightYards: observed.position.heightYards } }, physicalResult: r.physical }).classification;
  if (!r.classification) receipts.delete(token);
  return r.classification;
}
