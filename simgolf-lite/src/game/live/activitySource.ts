import { stableGolferHandedness } from "./capabilities";
import { isShotPacingCursor, type ShotPacingCursorV1, type ShotPacingFrame, type ShotPacingPlan } from "./shotPacing";
import type { Golfer, LiveState, Segment, SegmentKind } from "./types";
import type { ShotMotionIdentityV1 } from "../rules/shotMotion";

type Point = Readonly<{ x: number; y: number }>;
type MobilityMode = "walk" | "pushcart" | "riding_cart";
export interface LiveActivityScopeContext { readonly runSeed?: number; readonly week: number }
export interface LiveActivityScopeV1 {
  readonly runSeed: number | null; readonly week: number | null;
  readonly dayIndex: number; readonly liveSeed: number; readonly reconcileEpoch: number;
  readonly id: string | null; readonly revision: string; readonly active: boolean;
}
export interface LiveGolferActivitySourceV1 {
  readonly version: 1;
  readonly scope: LiveActivityScopeV1;
  readonly owner: { readonly scopeId: string | null; readonly actorId: string; readonly shot: Readonly<ShotMotionIdentityV1> | null };
  readonly authorityRevision: string;
  readonly active: boolean;
  /** LIVE stores tile XY only. Overview height is resolved later by existing grounding. */
  readonly root: { readonly horizontal: "tiles"; readonly vertical: "yards"; readonly x: number; readonly y: number; readonly heightYards: number | null };
  readonly facingWorld: Point | null;
  readonly targetWorld: Point | null;
  readonly handedness: "right" | "left" | null;
  readonly equipmentClass: "driver" | "iron" | "wedge" | "putter" | null;
  readonly segment: {
    readonly key: string; readonly index: number; readonly kind: SegmentKind;
    readonly elapsedGameMinutes: number; readonly durationGameMinutes: number;
    readonly holeId: string | null; readonly holeIndex: number;
  } | null;
  readonly movement: {
    readonly source: "current-itinerary-leg"; readonly segmentKey: string;
    readonly from: Point; readonly to: Point; readonly distanceTiles: number;
    readonly requestedMode: MobilityMode | null; readonly resolvedMode: MobilityMode | null;
    readonly onFoot: boolean | null;
  } | null;
  readonly playback: {
    readonly plan: ShotPacingPlan; readonly cursor: ShotPacingCursorV1; readonly frame: ShotPacingFrame;
    readonly retainedEvidence: { readonly key: string; readonly validated: true };
  } | null;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1000000;
const uint = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const point = (value: Point): boolean => finite(value.x) && finite(value.y);
const mobilityMode = (value: unknown): MobilityMode | null => value === "walk" || value === "pushcart" || value === "riding_cart" ? value : null;
function direction(from: Point, to: Point): Point | null {
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
  return Number.isFinite(length) && length > 1e-8 ? Object.freeze({ x: dx / length, y: dy / length }) : null;
}

/** Scalars only; unknown legacy caller scope remains unknown rather than another run's scope. */
export function liveActivityScope(state: Pick<LiveState, "dayIndex" | "seed" | "reconcileEpoch" | "dayOver">, context?: LiveActivityScopeContext): LiveActivityScopeV1 | null {
  if (![state.dayIndex, state.seed, state.reconcileEpoch].every(uint)) return null;
  if (context && (!uint(context.week) || !uint(context.runSeed ?? 0))) return null;
  const runSeed = context ? context.runSeed ?? 0 : null, week = context?.week ?? null;
  const tuple = ["live", runSeed, week, state.dayIndex, state.seed, state.reconcileEpoch];
  return Object.freeze({ runSeed, week, dayIndex: state.dayIndex, liveSeed: state.seed, reconcileEpoch: state.reconcileEpoch,
    id: context ? JSON.stringify(tuple) : null, revision: JSON.stringify(tuple), active: !state.dayOver });
}

/** No future itinerary/outcome lookup, clock, solver, callback, or authority mutation. */
export function createLiveActivitySource(scope: LiveActivityScopeV1 | null, golfer: Pick<Golfer, "id" | "pos" | "finished" | "segIndex" | "segElapsed" | "capabilities" | "mobilityMode">, segment: Segment | undefined, resolvedMobility?: MobilityMode): LiveGolferActivitySourceV1 | null {
  if (!scope || !uint(golfer.id) || !uint(golfer.segIndex) || !point(golfer.pos)) return null;
  const actorId = String(golfer.id), active = scope.active && !golfer.finished;
  const validSegment = segment && ["walk", "pause", "flight"].includes(segment.kind) && point(segment.from) && point(segment.to)
    && finite(segment.dur) && segment.dur > 0 && finite(golfer.segElapsed) && golfer.segElapsed >= 0 && golfer.segElapsed <= segment.dur
    && Number.isSafeInteger(segment.holeIndex) && segment.holeIndex >= -1;
  const holeId = typeof segment?.holeId === "string" && segment.holeId.length <= 256 ? segment.holeId : null;
  const key = validSegment ? JSON.stringify([scope.revision, actorId, golfer.segIndex, segment.kind, segment.from.x, segment.from.y, segment.to.x, segment.to.y, segment.dur, segment.holeIndex, holeId]) : null;
  const sourceSegment = validSegment ? Object.freeze({ key: key!, index: golfer.segIndex, kind: segment.kind, elapsedGameMinutes: golfer.segElapsed,
    durationGameMinutes: segment.dur, holeId, holeIndex: segment.holeIndex }) : null;
  let movement: LiveGolferActivitySourceV1["movement"] = null;
  let facingWorld: Point | null = null;
  if (active && sourceSegment?.kind === "walk" && segment) {
    const from = segment.from, to = segment.to, length = Math.hypot(to.x - from.x, to.y - from.y);
    const distance = Math.hypot(golfer.pos.x - from.x, golfer.pos.y - from.y);
    const remaining = Math.hypot(to.x - golfer.pos.x, to.y - golfer.pos.y);
    // A current straight itinerary leg is evidence; never connect unrelated positions.
    if (length > 1e-8 && Math.abs(distance + remaining - length) <= 1e-7) {
      const mode = mobilityMode(segment.mobility?.resolvedMode) ?? mobilityMode(resolvedMobility) ?? mobilityMode(golfer.mobilityMode);
      movement = Object.freeze({ source: "current-itinerary-leg", segmentKey: key!, from: Object.freeze({ x: from.x, y: from.y }), to: Object.freeze({ x: to.x, y: to.y }), distanceTiles: distance,
        requestedMode: mobilityMode(segment.mobility?.requestedMode) ?? mobilityMode(golfer.mobilityMode), resolvedMode: mode, onFoot: mode === null ? null : mode !== "riding_cart" });
      facingWorld = direction(from, to);
    }
  }
  const seed = golfer.capabilities?.seed;
  return Object.freeze({ version: 1, scope, owner: Object.freeze({ scopeId: scope.id, actorId, shot: null }), authorityRevision: scope.revision, active,
    root: Object.freeze({ horizontal: "tiles", vertical: "yards", x: golfer.pos.x, y: golfer.pos.y, heightYards: null }),
    facingWorld, targetWorld: null, handedness: uint(seed) && seed <= 0xffffffff ? stableGolferHandedness(seed) : null, equipmentClass: null,
    segment: sourceSegment, movement, playback: null });
}

export interface FocusedActivityPublication {
  readonly actorId: number; readonly segmentIndex: number; readonly segmentElapsed: number;
  readonly plan: ShotPacingPlan; readonly cursor: ShotPacingCursorV1; readonly frame: ShotPacingFrame;
  readonly identity: Readonly<ShotMotionIdentityV1>;
  readonly origin: { readonly point: Point; readonly heightYards: number };
  readonly target: Point | null;
}
/** Exact named clubs only; a generic swing does not prove a driver or wedge. */
function equipmentClass(club: string): LiveGolferActivitySourceV1["equipmentClass"] {
  if (club === "Putter") return "putter";
  if (club === "Driver") return "driver";
  if (club === "5 Iron" || club === "7 Iron") return "iron";
  if (club === "Pitching Wedge" || club === "Sand Wedge") return "wedge";
  return null;
}

/** Downgrades a reused buffer before any focused frame/pose can be rejected. */
export function clearFocusedLiveActivitySource(base: LiveGolferActivitySourceV1 | null | undefined): LiveGolferActivitySourceV1 | null {
  if (!base) return null;
  return base.playback === null ? base : Object.freeze({ ...base, owner: Object.freeze({ ...base.owner, shot: null }), root: Object.freeze({ ...base.root, heightYards: null }), targetWorld: null, equipmentClass: null, playback: null });
}

/** Copies the already acquired owner's actual plan/cursor/frame; never acquires or resizes. */
export function focusedLiveActivitySource(base: LiveGolferActivitySourceV1 | null | undefined, publication: FocusedActivityPublication, ownerCurrent: boolean): LiveGolferActivitySourceV1 | null {
  base = clearFocusedLiveActivitySource(base);
  if (!base) return null;
  const { plan, cursor, frame, identity, origin } = publication;
  const tuple = JSON.stringify([plan.scopeId, plan.actorId, identity.shotId, identity.holeId, identity.shotNumber, identity.seed, identity.club, identity.style, identity.modelVersion]);
  if (!ownerCurrent || !base.active || base.scope.id === null || base.scope.id !== plan.scopeId || base.owner.actorId !== String(publication.actorId)
    || plan.actorId !== base.owner.actorId || !base.segment || base.segment.kind !== "flight" || base.segment.index !== publication.segmentIndex || base.segment.elapsedGameMinutes !== publication.segmentElapsed
    || Object.entries(identity).some(([key, value]) => plan.identity[key as keyof ShotMotionIdentityV1] !== value) || plan.key !== tuple
    || !isShotPacingCursor(cursor, plan) || frame.key !== plan.key || frame.shotId !== identity.shotId
    || !point(origin.point) || !finite(origin.heightYards) || base.root.x !== origin.point.x || base.root.y !== origin.point.y) return base;
  const identityCopy = Object.freeze({ shotId: identity.shotId, holeId: identity.holeId, shotNumber: identity.shotNumber, seed: identity.seed, club: identity.club, style: identity.style, modelVersion: identity.modelVersion });
  const planCopy = Object.freeze({ version: plan.version, scopeId: plan.scopeId, actorId: plan.actorId, key: plan.key, identity: identityCopy, kind: plan.kind,
    durationMs: plan.durationMs, addressMs: plan.addressMs, contactMs: plan.contactMs, restMs: plan.restMs, firstContactT: plan.firstContactT });
  return Object.freeze({ ...base, owner: Object.freeze({ scopeId: plan.scopeId, actorId: plan.actorId, shot: identityCopy }),
    root: Object.freeze({ ...base.root, heightYards: origin.heightYards }), targetWorld: publication.target && point(publication.target) ? direction(origin.point, publication.target) : null,
    equipmentClass: equipmentClass(identity.club), movement: null,
    playback: Object.freeze({ plan: planCopy, cursor: Object.freeze({ version: cursor.version, key: cursor.key, elapsedMs: cursor.elapsedMs }),
      frame: Object.freeze({ key: frame.key, shotId: frame.shotId, progress: frame.progress, motionProgress: frame.motionProgress, phase: frame.phase, addressing: frame.addressing, complete: frame.complete }),
      retainedEvidence: Object.freeze({ key: plan.key, validated: true as const }) }) });
}
