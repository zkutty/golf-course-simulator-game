import { getPinPosition } from "../models/courseSetup";
import { stableGolferHandedness } from "./capabilities";
import { captureGolferReactionSource, clearGolferReactionSource, matchingLiveReactionOutcome, observeGolferReactionSource } from "../render/golferReactionSource";
import type { Course, World } from "../models/types";
import type { LiveAudioEvent } from "../../audio/liveEvents";
import { PUTT_CONTACT_FRAME, SWING_CONTACT_FRAME } from "../render/golferSprites";
import { isValidRetainedShotMotionV1, sampleRetainedShotMotion, type RetainedShotMotionV1 } from "../rules/shotMotion";
import {
  createShotPacingCursor, createShotPacingPlan, isShotPacingCursor, shotPacingEventProgress, shotPacingFrame,
  type ShotPacingCursorV1, type ShotPacingPlan,
} from "./shotPacing";
import type { GolferRenderData, LiveState, Segment } from "./types";
import { clearFocusedLiveActivitySource, focusedLiveActivitySource } from "./activitySource";

export interface FocusedShotScope {
  runSeed: number;
  week: number;
  dayIndex: number;
  liveSeed: number;
  reconcileEpoch: number;
}

export interface FocusedShotSnapshotV1 {
  version: 1;
  scope: FocusedShotScope;
  golferId: number;
  segmentIndex: number;
  segmentElapsed: number;
  cursor: ShotPacingCursorV1;
}

export interface FocusedShotOwner {
  readonly live: LiveState;
  readonly scope: FocusedShotScope;
  readonly golferId: number;
  readonly segmentIndex: number;
  readonly segmentElapsed: number;
  readonly segment: Segment;
  readonly motion: RetainedShotMotionV1;
  readonly plan: ShotPacingPlan;
  /** Exact existing plan input, transient only; never reconstructed from progress. */
  readonly retainedDistanceYards: number;
  cursor: ShotPacingCursorV1;
}

function scopeOf(live: LiveState, world: Pick<World, "runSeed" | "week">): FocusedShotScope {
  return { runSeed: world.runSeed ?? 0, week: world.week, dayIndex: live.dayIndex, liveSeed: live.seed, reconcileEpoch: live.reconcileEpoch };
}

const scopeId = (scope: FocusedShotScope): string => JSON.stringify(["live", scope.runSeed, scope.week, scope.dayIndex, scope.liveSeed, scope.reconcileEpoch]);
const record = (value: unknown): value is Record<string, unknown> => value != null && typeof value === "object" && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length
  && Object.keys(value).every((key) => keys.includes(key));

/** Acquires only the exact current retained flight without stepping. Optional reaction evidence stays private until observed. */
export function acquireFocusedShot(live: LiveState, world: Pick<World, "runSeed" | "week">, golferId: number | null | undefined, reactionCourse?: Course): FocusedShotOwner | null {
  if (golferId == null || !Number.isSafeInteger(golferId) || live.dayOver) return null;
  const golfer = live.golfers.find((item) => item.id === golferId && !item.finished);
  const segment = golfer?.segments[golfer.segIndex];
  if (!golfer || !segment || segment.kind !== "flight" || !isValidRetainedShotMotionV1(segment.motion) || segment.shotId !== segment.motion.identity.shotId
    || !Number.isFinite(segment.dur) || segment.dur <= 0 || segment.dur > 10
    || !Number.isFinite(golfer.segElapsed) || golfer.segElapsed < 0 || golfer.segElapsed >= segment.dur) return null;
  const motion = segment.motion;
  // Retained horizontal distances only; current terrain and precomputed future outcomes are not consulted.
  let distanceYards = Math.hypot(motion.landing.point.x - motion.from.point.x, motion.landing.point.y - motion.from.point.y) * motion.units.yardsPerTile;
  for (let i = 1; i < motion.groundPath.length; i++) distanceYards += Math.hypot(
    motion.groundPath[i].point.x - motion.groundPath[i - 1].point.x,
    motion.groundPath[i].point.y - motion.groundPath[i - 1].point.y,
  ) * motion.units.yardsPerTile;
  const scope = scopeOf(live, world);
  const plan = createShotPacingPlan({ scopeId: scopeId(scope), actorId: String(golferId), motion, distanceYards });
  if (!plan) return null;
  const owner = { live, scope, golferId, segmentIndex: golfer.segIndex, segmentElapsed: golfer.segElapsed, segment, motion, plan, retainedDistanceYards: distanceYards, cursor: createShotPacingCursor(plan) };
  captureReaction(owner, distanceYards, reactionCourse);
  return owner;
}

/** Optional read-only receipt: the existing acquisition/plan is the sole authority. */
function captureReaction(owner: FocusedShotOwner, distanceYards: number, course?: Course, originalAimAvailable = true): void {
  const golfer = owner.live.golfers.find((g) => g.id === owner.golferId);
  const outcome = matchingLiveReactionOutcome(golfer?.shotOutcomes, owner.motion);
  const intent = golfer?.currentIntent;
  const holes = course?.holes.filter((h, i) => (h.id ?? `hole-${i + 1}`) === owner.motion.identity.holeId) ?? [];
  const hole = holes.length === 1 ? holes[0] : null;
  const rotation = golfer?.pinRotationsByHole?.[owner.motion.identity.holeId] ?? golfer?.pinRotation ?? course?.activePinRotation ?? "A";
  const pin = hole ? getPinPosition(hole, rotation) : null;
  const matchesIntent = outcome && intent && intent.id === outcome.intentId && intent.club === outcome.club
    && intent.from.x === owner.motion.from.point.x && intent.from.y === owner.motion.from.point.y && intent.target.x === outcome.aim.x && intent.target.y === outcome.aim.y;
  const handedness = golfer?.capabilities ? stableGolferHandedness(golfer.capabilities.seed) : null;
  captureGolferReactionSource(owner, { owner: { scopeId: owner.plan.scopeId, actorId: owner.plan.actorId, shot: owner.plan.identity }, authorityRevision: owner.plan.scopeId,
    plan: owner.plan, initialCursor: owner.cursor, motion: owner.motion, distanceYards, source: owner.segment, courseSource: course ?? null, handedness,
    sharedOutcome: outcome?.sharedOutcome ?? null, originalAim: originalAimAvailable && owner.segmentElapsed === 0 && course && pin && matchesIntent ? { course, holeId: owner.motion.identity.holeId, pin, from: intent.from, target: intent.target } : null });
}

/** A presentation hold is valid only while its authoritative cursor is still stopped. */
export function focusedShotMatches(owner: FocusedShotOwner, live: LiveState, world: Pick<World, "runSeed" | "week">, followGolferId: number | null | undefined, draining = false): boolean {
  const golfer = live.golfers.find((item) => item.id === owner.golferId);
  return owner.live === live && !live.dayOver && followGolferId === owner.golferId
    && scopeId(owner.scope) === scopeId(scopeOf(live, world)) && !!golfer && !golfer.finished
    && golfer.segIndex === owner.segmentIndex && (draining ? golfer.segElapsed >= owner.segmentElapsed : golfer.segElapsed === owner.segmentElapsed)
    && golfer.segments[golfer.segIndex] === owner.segment && owner.segment.motion === owner.motion
    && Object.entries(owner.plan.identity).every(([key, value]) => owner.motion.identity[key as keyof typeof owner.motion.identity] === value);
}

export function snapshotFocusedShot(owner: FocusedShotOwner): FocusedShotSnapshotV1 {
  const golfer = owner.live.golfers.find((item) => item.id === owner.golferId);
  return { version: 1, scope: { ...owner.scope }, golferId: owner.golferId, segmentIndex: owner.segmentIndex,
    segmentElapsed: golfer?.segIndex === owner.segmentIndex ? golfer.segElapsed : owner.segmentElapsed, cursor: { ...owner.cursor } };
}

/** An invalid optional carrier is discarded; legacy live authority remains valid. */
export function restoreFocusedShot(value: unknown, live: LiveState, world?: Pick<World, "runSeed" | "week">, reactionCourse?: Course): FocusedShotOwner | null {
  if (!record(value) || !exactKeys(value, ["version", "scope", "golferId", "segmentIndex", "segmentElapsed", "cursor"])
    || value.version !== 1 || !record(value.scope)
    || !exactKeys(value.scope, ["runSeed", "week", "dayIndex", "liveSeed", "reconcileEpoch"])
    || !Object.values(value.scope).every((part) => typeof part === "number" && Number.isSafeInteger(part) && part >= 0)
    || !Number.isSafeInteger(value.golferId) || !Number.isSafeInteger(value.segmentIndex)
    || typeof value.segmentElapsed !== "number" || !Number.isFinite(value.segmentElapsed)) return null;
  const scope = value.scope as unknown as FocusedShotScope;
  if (world && (scope.runSeed !== (world.runSeed ?? 0) || scope.week !== world.week)) return null;
  const owner = acquireFocusedShot(live, { runSeed: scope.runSeed, week: scope.week }, value.golferId as number);
  if (!owner || scopeId(owner.scope) !== scopeId(scope) || owner.segmentIndex !== value.segmentIndex
    || owner.segmentElapsed !== value.segmentElapsed || !isShotPacingCursor(value.cursor, owner.plan)) return null;
  owner.cursor = createShotPacingCursor(owner.plan, value.cursor);
  // Restore has no original acquisition aim receipt; an already reached endpoint is historical.
  clearGolferReactionSource(owner);
  captureReaction(owner, owner.retainedDistanceYards, reactionCourse, false);
  return owner;
}

/** Only a render buffer changes. The golfer, score and saved itinerary stay stopped. */
export function projectFocusedShot(owner: FocusedShotOwner, render: GolferRenderData[], activityOwnerCurrent = false, reactionCourse?: Course): void {
  const golfer = render.find((item) => item.id === owner.golferId);
  if (golfer) golfer.activitySource = clearFocusedLiveActivitySource(golfer.activitySource);
  const frame = shotPacingFrame(owner.plan, owner.cursor);
  const pose = frame && sampleRetainedShotMotion(owner.motion, frame.motionProgress);
  if (!frame || !pose || !golfer) { clearGolferReactionSource(owner); return; }
  golfer.activitySource = focusedLiveActivitySource(golfer.activitySource, {
    actorId: owner.golferId, segmentIndex: owner.segmentIndex, segmentElapsed: owner.segmentElapsed,
    plan: owner.plan, cursor: owner.cursor, frame, identity: owner.motion.identity, origin: owner.motion.from,
    target: owner.motion.flight?.geometry.to ?? owner.motion.groundPath[1]?.point ?? null,
  }, activityOwnerCurrent);
  const activity = golfer.activitySource;
  const currentOwner = { scopeId: activity?.owner.scopeId ?? owner.plan.scopeId, actorId: activity?.owner.actorId ?? owner.plan.actorId, shot: activity?.owner.shot ?? null };
  const reactionClassification = observeGolferReactionSource(owner, { owner: { scopeId: owner.plan.scopeId, actorId: owner.plan.actorId, shot: owner.plan.identity }, currentOwner,
    authorityRevision: owner.plan.scopeId, currentAuthorityRevision: activity?.authorityRevision ?? "unknown", plan: owner.plan, cursor: owner.cursor, frame, motion: owner.motion, position: pose,
    source: owner.segment, courseSource: reactionCourse ?? null, handedness: activity?.handedness ?? null, ownerCurrent: activityOwnerCurrent && !!activity?.playback });
  if (activity && reactionClassification) golfer.activitySource = Object.freeze({ ...activity, reactionClassification });
  const contactFrame = owner.plan.kind === "putt" ? PUTT_CONTACT_FRAME : SWING_CONTACT_FRAME;
  const addressProgress = Math.min(1, owner.cursor.elapsedMs / owner.plan.addressMs);
  const beforeContact = owner.cursor.elapsedMs < owner.plan.addressMs;
  Object.assign(golfer, {
    x: owner.motion.from.point.x, y: owner.motion.from.point.y,
    ballX: pose.point.x, ballY: pose.point.y,
    ballToX: owner.motion.physicalRest.point.x, ballToY: owner.motion.physicalRest.point.y,
    ballLandingX: owner.motion.landing.point.x, ballLandingY: owner.motion.landing.point.y,
    ballMotion: { identity: owner.motion.identity, pose, events: owner.motion.events,
      contactTerrain: owner.segment.motionContactTerrain ?? "unknown",
      collisionTerrain: owner.motion.flight?.collision.kind === "terrain" ? owner.motion.flight.collision.terrain : null, active: true },
    ballUsesResolvedRollout: true, ballRolloutStartT: owner.plan.firstContactT,
    segKind: frame.addressing ? "pause" : "flight",
    segT: frame.addressing ? beforeContact ? addressProgress * contactFrame / (contactFrame + 1) * .999999 : 1 : frame.motionProgress,
    shot: owner.plan.kind,
  });
}

/** Only newly crossed events; restoring or explicitly skipping never replays audio. */
export function focusedShotAudioEvents(owner: FocusedShotOwner, previous: ShotPacingCursorV1, course: Course, skipped = false): LiveAudioEvent[] {
  if (skipped) return [];
  const before = shotPacingFrame(owner.plan, previous);
  const after = shotPacingFrame(owner.plan, owner.cursor);
  if (!before || !after) return [];
  const events: LiveAudioEvent[] = [];
  for (const event of owner.motion.events) {
    const at = shotPacingEventProgress(owner.plan, event.time)!;
    if (at <= before.progress || at > after.progress) continue;
    if (event.kind === "launch") events.push({ kind: "shot", golferId: owner.golferId, shot: owner.plan.kind,
      from: { ...owner.motion.from.point }, to: { ...owner.motion.physicalRest.point } });
    if (event.kind === "first_contact") {
      const x = Math.max(0, Math.min(course.width - 1, Math.round(event.point.x)));
      const y = Math.max(0, Math.min(course.height - 1, Math.round(event.point.y)));
      events.push({ kind: "landing", golferId: owner.golferId, surface: course.tiles[y * course.width + x] ?? "rough", at: { ...event.point } });
    }
    if (event.kind === "hole_out") {
      const golfer = owner.live.golfers.find((item) => item.id === owner.golferId);
      const hole = owner.segment.holeIndex;
      events.push({ kind: "hole-out", golferId: owner.golferId, scoreDelta: (golfer?.holeStrokes[hole] ?? 0) - (golfer?.holePar[hole] ?? 0), at: { ...event.point } });
    }
  }
  return events;
}
