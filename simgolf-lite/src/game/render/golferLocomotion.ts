import type { LiveGolferActivitySourceV1 } from "../live/activitySource";
import { isShotPacingCursor, shotPacingFrame } from "../live/shotPacing";
import { ELEVATION_STEP_YARDS } from "../rules/obstacleCollision";
import { golferActivityOwnerKey, type ActivityOwner, type ActivityQuality, type GolferActivityFacts } from "./golferActivity";
import { WALK_STRIDES_PER_TILE } from "./golferSprites";
import { sampleGolferStance, type GolferStanceArrivalProof, type GolferStanceBinding, type GolferStanceGroundAuthority, type GolferStanceIdentity, type GolferStancePoint } from "./golferStance";
import { ISO_ROTATIONS, tileCenterIso, type IsoRotation } from "./iso";

export const GOLFER_LOCOMOTION_LIMITS = Object.freeze({
  maxSpeedPxPerSecond: 32, maxAdjustmentMs: Object.freeze({ swing: 800, putt: 400 }),
  maxSweepFootprints: 32, maxPointQueries: 4, maxSweepQueries: 1,
  maxRecordsPerActor: 1, pendingEvents: 0, retainedCallbacks: 0, routes: 0, clocks: 0,
});
/**
 * A bounded query of the WHOLE swept footprint, using the same ground authority
 * as sampleFootprintAt. This is a straight local footprint test, never a route
 * solve. Entity XY (before the shared +.5 center offset) is used throughout.
 * maxProjectedDerivativePx bounds |d screenFeet / d fraction| for EVERY point
 * of the continuous height path and all four cardinal cameras. Sparse samples
 * or just a chord/arc length do not certify that bound. An adapter unable to
 * establish either continuous support or the height bound must return null.
 */
export interface GolferFootSweepCertificate {
  readonly surfaceRevision: string;
  readonly from: GolferStancePoint; readonly to: GolferStancePoint;
  readonly supportedThroughout: true; readonly inBounds: true; readonly continuousHeight: true;
  readonly footprintsTested: number; readonly maxProjectedDerivativePx: number;
}
export interface GolferLocomotionGroundAuthority extends GolferStanceGroundAuthority {
  readonly sweepFootprint: (from: GolferStancePoint, to: GolferStancePoint, footprintBudget: number) => GolferFootSweepCertificate | null;
}
export interface GolferLocomotionRequest {
  readonly owner: ActivityOwner; readonly currentOwner: ActivityOwner;
  readonly authorityRevision: string; readonly currentAuthorityRevision: string;
  readonly surfaceRevision: string;
  /** Current authority / unchanged physical ball B, never visual launch G. */
  readonly root: GolferStancePoint;
  /** Same XY as B, exact supported visual launch G. Omitted means B=G. */
  readonly visualGroundLaunch?: GolferStancePoint;
  /** Last actually presented feet; not a proposed future position. */
  readonly actualFeet: GolferStancePoint | null;
  /** Only LIVE supplies a current legal itinerary leg. Controlled travel is unsupported. */
  readonly live: LiveGolferActivitySourceV1 | null;
  readonly stance: {
    readonly binding: GolferStanceBinding; readonly identity: GolferStanceIdentity;
    readonly playback: NonNullable<GolferActivityFacts["playback"]>;
  } | null;
  readonly ground: GolferLocomotionGroundAuthority;
  /** Common caller active time may advance while this domain is held. No timer is advanced here. */
  readonly presentationTimeMs: number;
  readonly paused: boolean; readonly hidden: boolean; readonly culled: boolean;
  readonly acquisition: "continuous" | "reload" | "late-acquisition" | "skip";
  readonly motionEnabled: boolean; readonly rotation: IsoRotation;
  readonly quality: ActivityQuality; readonly operatingTier: 1 | 2 | 4;
}
export interface GolferLocomotionState {
  readonly version: 1; readonly ownerKey: string;
  readonly authorityRevision: string; readonly surfaceRevision: string;
  readonly observedAtMs: number; readonly root: GolferStancePoint; readonly feet: GolferStancePoint;
  readonly mode: "static" | "walk" | "adjust" | "awaiting-arrival" | "planted";
  readonly strideDistanceTiles: number; readonly legKey: string | null; readonly legDistanceTiles: number | null;
  readonly bindingKey: string | null; readonly planSignature: string | null;
  readonly cursorMs: number | null; readonly adjustmentStartMs: number | null;
  readonly adjustmentFrom: GolferStancePoint | null; readonly adjustmentDurationMs: number | null;
  readonly adjustmentDerivativePx: number | null; readonly arrivedCursorMs: number | null;
  readonly arrival: GolferStanceArrivalProof | null;
}
export interface GolferLocomotionProjection {
  readonly kind: "neutral" | "static" | "walk" | "adjust" | "arrived" | "planted";
  readonly reason: string | null;
  readonly root: GolferStancePoint | null; readonly feet: GolferStancePoint | null;
  readonly stridePhase: number; readonly strideFrame: number;
  /** Stable current-authority fallback; no debt, queued travel, or later catch-up. */
  readonly fastForward: boolean;
  readonly arrival: GolferStanceArrivalProof | null;
  readonly nextState: GolferLocomotionState | null;
}

const EPS = 1e-7;
// Only live tokens from this helper are accepted. Weak keys retain no history.
const states = new WeakMap<GolferLocomotionState, GolferStanceBinding | null>();
const finite = (n: unknown, min = -1e6, max = 1e6): n is number => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
const label = (s: unknown): s is string => typeof s === "string" && s.length > 0 && s.length <= 4096;
const point = (p: GolferStancePoint | null | undefined): p is GolferStancePoint => !!p && finite(p.x) && finite(p.y) && finite(p.heightYards);
const xy = (p: { x: number; y: number } | null | undefined): boolean => !!p && finite(p.x) && finite(p.y);
const copy = (p: GolferStancePoint): GolferStancePoint => Object.freeze({ x: p.x, y: p.y, heightYards: p.heightYards });
const equal = (a: GolferStancePoint, b: GolferStancePoint): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= EPS && Math.abs(a.heightYards - b.heightYards) <= EPS;
const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);
function projectedChord(a: GolferStancePoint, b: GolferStancePoint): number {
  return Math.max(...ISO_ROTATIONS.map(rotation => {
    const p = tileCenterIso(a.x, a.y, a.heightYards / ELEVATION_STEP_YARDS, rotation);
    const q = tileCenterIso(b.x, b.y, b.heightYards / ELEVATION_STEP_YARDS, rotation);
    return Math.hypot(p.x - q.x, p.y - q.y);
  }));
}
function neutral(r: GolferLocomotionRequest, reason: string): GolferLocomotionProjection {
  const root = point(r.root) ? copy(r.root) : null;
  return Object.freeze({ kind: "neutral", reason, root, feet: root, stridePhase: 0, strideFrame: 0, fastForward: false, arrival: null, nextState: null });
}
function supported(r: GolferLocomotionRequest, p: GolferStancePoint): boolean {
  const s = r.ground.sampleFootprintAt(p.x + .5, p.y + .5);
  return !!s && s.surfaceRevision === r.surfaceRevision && s.inBounds === true && s.supportedFootprint === true
    && finite(s.heightYards) && Math.abs(s.heightYards - p.heightYards) <= EPS;
}
function sweep(r: GolferLocomotionRequest, a: GolferStancePoint, b: GolferStancePoint): GolferFootSweepCertificate | null {
  const s = r.ground.sweepFootprint(copy(a), copy(b), GOLFER_LOCOMOTION_LIMITS.maxSweepFootprints);
  return s && s.surfaceRevision === r.surfaceRevision && point(s.from) && point(s.to) && equal(s.from, a) && equal(s.to, b)
    && s.supportedThroughout === true && s.inBounds === true && s.continuousHeight === true
    && Number.isSafeInteger(s.footprintsTested) && s.footprintsTested > 0 && s.footprintsTested <= GOLFER_LOCOMOTION_LIMITS.maxSweepFootprints
    && finite(s.maxProjectedDerivativePx, 0) && s.maxProjectedDerivativePx + EPS >= projectedChord(a, b) ? s : null;
}
function publish(r: GolferLocomotionRequest, ownerKey: string, previous: GolferLocomotionState | null,
  patch: Partial<GolferLocomotionState>, kind: GolferLocomotionProjection["kind"], reason: string | null = null, fastForward = false): GolferLocomotionProjection {
  const state: GolferLocomotionState = Object.freeze({
    feet: copy(r.root), mode: "static", strideDistanceTiles: previous?.strideDistanceTiles ?? 0,
    legKey: null, legDistanceTiles: null, bindingKey: null, planSignature: null, cursorMs: null,
    adjustmentStartMs: null, adjustmentFrom: null, adjustmentDurationMs: null, adjustmentDerivativePx: null, arrivedCursorMs: null, arrival: null,
    ...patch,
    version: 1, ownerKey, authorityRevision: r.authorityRevision, surfaceRevision: r.surfaceRevision,
    observedAtMs: r.presentationTimeMs, root: copy(r.root),
  });
  states.set(state, r.stance?.binding ?? null);
  const phase = ((state.strideDistanceTiles * WALK_STRIDES_PER_TILE) % 1 + 1) % 1;
  return Object.freeze({ kind, reason, root: state.root, feet: state.feet, stridePhase: phase, strideFrame: Math.floor(phase * 6), fastForward, arrival: state.arrival, nextState: state });
}
function playback(r: GolferLocomotionRequest, ownerKey: string): { elapsed: number; signature: string } | null {
  const s = r.stance!, { plan: p, cursor: c, frame: f, retainedEvidence: e } = s.playback;
  if (p.version !== 1 || p.key !== ownerKey || p.scopeId !== r.owner.scopeId || p.actorId !== r.owner.actorId || p.kind !== s.binding.role
    || (p.kind === "putt") !== (p.identity.club === "Putter") || golferActivityOwnerKey({ scopeId: p.scopeId, actorId: p.actorId, shot: p.identity }) !== ownerKey
    || !finite(p.durationMs, p.kind === "putt" ? 2400 : 6000, p.kind === "putt" ? 4200 : 10000)
    || p.addressMs !== (p.kind === "putt" ? 500 : 1000) || p.contactMs !== (p.kind === "putt" ? 150 : 200)
    || p.restMs !== (p.kind === "putt" ? 650 : 900) || !finite(p.firstContactT, 0, 1)
    || e.validated !== true || e.key !== p.key || !isShotPacingCursor(c, p)) return null;
  const actual = shotPacingFrame(p, c);
  if (!actual || Object.keys(actual).some(key => actual[key as keyof typeof actual] !== f[key as keyof typeof actual])) return null;
  return { elapsed: c.elapsedMs, signature: JSON.stringify([p.key, p.kind, p.durationMs, p.addressMs, p.contactMs, p.restMs, p.firstContactT]) };
}
function stanceProjection(r: GolferLocomotionRequest, ownerKey: string, previous: GolferLocomotionState | null): GolferLocomotionProjection {
  const s = r.stance!, b = s.binding, p = playback(r, ownerKey);
  if (!p) return neutral(r, "invalid-shared-playback");
  const livePlayback = r.live?.playback ? playback({ ...r, stance: { ...s, playback: r.live.playback } }, ownerKey) : null;
  if (r.live && (!livePlayback || livePlayback.signature !== p.signature || livePlayback.elapsed !== p.elapsed
    || r.live.targetWorld?.x !== b.targetWorld.x || r.live.targetWorld?.y !== b.targetWorld.y || r.live.handedness !== b.handedness
    || r.live.root.heightYards !== r.root.heightYards)) return neutral(r, "live-playback-mismatch");
  // The accepted stance helper owns the candidate brand and exact identity,
  // endpoint support, model, target and launch checks. No forged arrival is used.
  const check = sampleGolferStance(b, { currentIdentity: s.identity, launch: r.root, visualGroundLaunch: r.visualGroundLaunch === undefined ? r.root : r.visualGroundLaunch, ground: r.ground, rotation: r.rotation,
    phase: "address", actualFeet: null, arrival: null, previousPlant: null, walking: null,
    acquisition: "continuous", paused: false, hidden: false });
  if (check.kind !== "neutral" || check.reason !== "arrival-proof-required" || b.ownerKey !== ownerKey
    || b.authorityRevision !== r.authorityRevision || b.surfaceRevision !== r.surfaceRevision) return neutral(r, "stance-invalidated");
  const initialStride = previous?.strideDistanceTiles ?? 0;
  if (previous?.bindingKey === null) {
    // A stopped current observation can enter this local adjustment; it cannot
    // smuggle a different position across a walk/stance boundary.
    if (!equal(previous.root, r.root) || !point(r.actualFeet) || !equal(previous.feet, r.actualFeet)) return neutral(r, "continuous-arrival-required");
    previous = null;
  }
  if (previous && (previous.bindingKey !== b.key || states.get(previous) !== b || previous.planSignature !== p.signature)) return neutral(r, "stance-candidate-replaced");
  if (previous && (!equal(previous.root, r.root) || previous.cursorMs === null || p.elapsed < previous.cursorMs || p.elapsed - previous.cursorMs > 100 + EPS)) return neutral(r, "discontinuous-shared-cursor");
  if (previous && previous.mode !== "planted" && !supported(r, previous.feet)) return neutral(r, "ground-invalidated");
  const base = { bindingKey: b.key, planSignature: p.signature, cursorMs: p.elapsed };
  if (previous && (r.paused || r.hidden)) {
    if (p.elapsed !== previous.cursorMs
      || (r.actualFeet !== null && (!point(r.actualFeet) || !equal(r.actualFeet, previous.feet)))) return neutral(r, "held-observation-changed");
    return publish(r, ownerKey, previous, { ...previous, ...base }, previous.mode === "planted" ? "planted" : previous.mode === "adjust" ? "adjust" : "static", "held");
  }
  if (r.acquisition === "reload" || r.acquisition === "late-acquisition") {
    if (!point(r.actualFeet) || !equal(r.actualFeet, b.feet)) return neutral(r, "settled-feet-required");
    const arrival: GolferStanceArrivalProof = Object.freeze({ bindingKey: b.key, validated: true, kind: "settled-initial" });
    return publish(r, ownerKey, null, { ...base, feet: copy(b.feet), mode: "planted", arrival }, "arrived", "settled-initial");
  }
  if (previous?.mode === "planted") {
    if (!point(r.actualFeet) || !equal(r.actualFeet, b.feet)) return neutral(r, "planted-feet-changed");
    return publish(r, ownerKey, previous, { ...previous, ...base }, "planted");
  }
  if (!previous && point(r.actualFeet) && equal(r.actualFeet, b.feet)) {
    const arrival: GolferStanceArrivalProof = Object.freeze({ bindingKey: b.key, validated: true, kind: "compatible-arrival" });
    return publish(r, ownerKey, null, { ...base, feet: copy(b.feet), mode: "planted", arrival, strideDistanceTiles: initialStride }, "arrived");
  }
  if (!r.motionEnabled && previous?.mode !== "awaiting-arrival") return neutral(r, "adjustment-motion-disabled");
  const limit = GOLFER_LOCOMOTION_LIMITS.maxAdjustmentMs[b.role];
  if (!previous && (p.elapsed > limit || !point(r.actualFeet) || !equal(r.actualFeet, b.visualGroundLaunch))) return neutral(r, "continuous-arrival-required");
  if (previous && (!point(r.actualFeet) || !equal(r.actualFeet, previous.feet))) return neutral(r, "adjustment-observation-mismatch");
  const from = previous?.adjustmentFrom ?? copy(b.visualGroundLaunch), cert = sweep(r, from, b.feet);
  if (!cert) return neutral(r, "unsupported-adjustment-sweep");
  const duration = cert.maxProjectedDerivativePx / GOLFER_LOCOMOTION_LIMITS.maxSpeedPxPerSecond * 1000;
  const start = previous?.adjustmentStartMs ?? p.elapsed;
  if (!finite(duration, 0) || duration > limit + EPS || start + duration > limit + EPS
    || (previous && previous.adjustmentDerivativePx !== cert.maxProjectedDerivativePx)) return neutral(r, "adjustment-window-exceeded");
  if (previous?.mode === "awaiting-arrival") {
    const elapsedMs = previous.arrivedCursorMs! - start;
    const arrival: GolferStanceArrivalProof = Object.freeze({ bindingKey: b.key, validated: true, kind: "validated-adjustment", elapsedMs,
      maxSpeedPxPerSecond: GOLFER_LOCOMOTION_LIMITS.maxSpeedPxPerSecond, supportedThroughout: true, gaitExpressed: true, withinExistingPreBackswingWindow: true });
    return publish(r, ownerKey, previous, { ...previous, ...base, feet: copy(b.feet), mode: "planted", arrival }, "arrived");
  }
  if (p.elapsed > limit + EPS) return neutral(r, "adjustment-window-ended");
  // Fraction comes ONLY from the actual shared cursor. Never spend active time
  // or normalized progress as a second adjustment clock.
  const fraction = duration === 0 ? 1 : Math.min(1, Math.max(0, (p.elapsed - start) / duration));
  const x = from.x + (b.feet.x - from.x) * fraction, y = from.y + (b.feet.y - from.y) * fraction;
  const sample = r.ground.sampleFootprintAt(x + .5, y + .5);
  if (!sample || sample.surfaceRevision !== r.surfaceRevision || sample.inBounds !== true || sample.supportedFootprint !== true || !finite(sample.heightYards)) return neutral(r, "unsupported-adjustment-feet");
  const feet = copy({ x, y, heightYards: sample.heightYards });
  if (previous) {
    const dt = p.elapsed - previous.cursorMs!;
    if (projectedChord(previous.feet, feet) > GOLFER_LOCOMOTION_LIMITS.maxSpeedPxPerSecond * dt / 1000 + EPS) return neutral(r, "adjustment-speed-exceeded");
  }
  const finished = fraction === 1;
  return publish(r, ownerKey, previous, { ...base, feet, mode: finished ? "awaiting-arrival" : "adjust", adjustmentFrom: copy(from), adjustmentStartMs: start,
    adjustmentDurationMs: duration, adjustmentDerivativePx: cert.maxProjectedDerivativePx, arrivedCursorMs: finished ? p.elapsed : null,
    strideDistanceTiles: (previous?.strideDistanceTiles ?? initialStride) + distance(previous?.feet ?? from, feet) }, finished ? "static" : "adjust", finished ? "awaiting-arrival-observation" : null);
}
function liveCurrent(r: GolferLocomotionRequest, ownerKey: string): boolean {
  const s = r.live;
  return !!s && !(s.version !== 1 || !s.active || !s.scope.active || s.owner.scopeId === null || golferActivityOwnerKey(s.owner) !== ownerKey
    || s.authorityRevision !== r.authorityRevision || s.scope.revision !== r.authorityRevision || s.scope.id !== s.owner.scopeId
    || s.root.horizontal !== "tiles" || s.root.vertical !== "yards" || s.root.x !== r.root.x || s.root.y !== r.root.y
    || (s.root.heightYards !== null && (!finite(s.root.heightYards) || Math.abs(s.root.heightYards - r.root.heightYards) > EPS))
    || (s.movement !== null && s.playback !== null));
}
function liveProjection(r: GolferLocomotionRequest, ownerKey: string, previous: GolferLocomotionState | null): GolferLocomotionProjection {
  const s = r.live;
  if (!s) return neutral(r, "unsupported-travel");
  if (!point(r.actualFeet) || !equal(r.actualFeet, r.root) || !supported(r, r.root)) return neutral(r, "unsupported-current-feet");
  const m = s.movement, seg = s.segment;
  if (previous && (r.paused || r.hidden)) {
    if (!equal(previous.root, r.root) || previous.legKey !== (m?.segmentKey ?? null)
      || previous.legDistanceTiles !== (m?.distanceTiles ?? null)) return neutral(r, "held-observation-changed");
    return publish(r, ownerKey, previous, { ...previous }, "static", "held");
  }
  if (!m) return previous && !equal(previous.root, r.root) ? neutral(r, "unobserved-travel") : publish(r, ownerKey, previous, {}, "static", "stopped");
  if (!seg || seg.kind !== "walk" || m.source !== "current-itinerary-leg" || m.segmentKey !== seg.key || !label(seg.key) || !xy(m.from) || !xy(m.to)
    || !finite(m.distanceTiles, 0) || Math.abs(distance(m.from, r.root) - m.distanceTiles) > EPS
    || Math.abs(distance(m.from, r.root) + distance(r.root, m.to) - distance(m.from, m.to)) > EPS) return neutral(r, "invalid-current-leg");
  const leg = { legKey: m.segmentKey, legDistanceTiles: m.distanceTiles };
  if (m.resolvedMode === "riding_cart" && m.onFoot === false) return publish(r, ownerKey, previous, leg, "static", "riding");
  if (m.onFoot !== true || (m.resolvedMode !== "walk" && m.resolvedMode !== "pushcart")) return neutral(r, "unknown-mobility");
  if (!r.motionEnabled) return publish(r, ownerKey, previous, leg, "static", "motion-disabled");
  if (!previous) return publish(r, ownerKey, null, leg, "static", "first-observation");
  const sameLeg = previous.legKey === m.segmentKey;
  const previousDistance = distance(m.from, previous.root);
  if (!sameLeg && Math.abs(previousDistance + distance(previous.root, m.to) - distance(m.from, m.to)) > EPS) return publish(r, ownerKey, previous, leg, "static", "unobserved-leg-transition", true);
  const delta = m.distanceTiles - (sameLeg ? previous.legDistanceTiles! : previousDistance);
  if (delta < -EPS || Math.abs(delta - distance(previous.root, r.root)) > EPS) return neutral(r, "nonmonotonic-leg-distance");
  if (delta <= EPS) return publish(r, ownerKey, previous, leg, "static", "stopped");
  const dt = r.presentationTimeMs - previous.observedAtMs;
  // A chord already above the natural speed needs no corridor animation or
  // potentially large sweep. Only the currently supported feet are presented.
  if (dt <= 0 || projectedChord(previous.root, r.root) > GOLFER_LOCOMOTION_LIMITS.maxSpeedPxPerSecond * dt / 1000 + EPS) return publish(r, ownerKey, previous, leg, "static", "fast-authority-travel", true);
  const cert = sweep(r, previous.root, r.root);
  if (!cert) return neutral(r, "unsupported-current-travel");
  if (cert.maxProjectedDerivativePx > GOLFER_LOCOMOTION_LIMITS.maxSpeedPxPerSecond * dt / 1000 + EPS) return publish(r, ownerKey, previous, leg, "static", "fast-authority-travel", true);
  return publish(r, ownerKey, previous, { ...leg, mode: "walk", strideDistanceTiles: previous.strideDistanceTiles + delta }, "walk");
}

/**
 * One caller-owned transient record per actor, no queues or independent timer.
 * Owner/surface/cull/reload invalidation always precedes any paused/hidden hold.
 * All outputs stay at the current authority root; only supported local stance
 * feet may differ. Caller must discard the previous record after a null result.
 */
export function projectGolferLocomotion(r: GolferLocomotionRequest, previous: GolferLocomotionState | null = null): GolferLocomotionProjection {
  try {
    const key = golferActivityOwnerKey(r.owner);
    if (!key || key !== golferActivityOwnerKey(r.currentOwner) || !label(r.authorityRevision) || r.authorityRevision !== r.currentAuthorityRevision) return neutral(r, "owner-invalidated");
    if (!point(r.root) || !label(r.surfaceRevision) || r.ground.surfaceRevision !== r.surfaceRevision || typeof r.ground.sampleFootprintAt !== "function" || typeof r.ground.sweepFootprint !== "function") return neutral(r, "invalid-ground-authority");
    if (!finite(r.presentationTimeMs, 0, Number.MAX_SAFE_INTEGER) || ![true, false].includes(r.paused) || ![true, false].includes(r.hidden) || ![true, false].includes(r.culled)
      || ![true, false].includes(r.motionEnabled) || ![0, 90, 180, 270].includes(r.rotation) || ![1, 2, 4].includes(r.operatingTier)
      || !["high", "medium", "low"].includes(r.quality) || !["continuous", "reload", "late-acquisition", "skip"].includes(r.acquisition)) return neutral(r, "invalid-observation");
    if (r.culled || r.acquisition === "skip") return neutral(r, r.culled ? "culled" : "skip");
    if (r.acquisition !== "continuous") previous = null;
    if (previous && (!states.has(previous) || previous.ownerKey !== key || previous.authorityRevision !== r.authorityRevision || previous.surfaceRevision !== r.surfaceRevision)) return neutral(r, "state-invalidated");
    if (previous && r.presentationTimeMs < previous.observedAtMs) return neutral(r, "nonmonotonic-presentation-time");
    if (r.live && !liveCurrent(r, key)) return neutral(r, "live-authority-invalidated");
    // Current observed walking authority releases a plant; it never creates a
    // path from the old visual feet to an unrelated new gameplay position.
    if (r.stance && (!r.live?.movement || (previous?.mode === "planted" && (r.paused || r.hidden)))) return stanceProjection(r, key, previous);
    if (previous?.bindingKey !== null && previous?.bindingKey !== undefined && !r.live?.movement) return neutral(r, "stance-source-lost");
    return liveProjection(r, key, previous);
  } catch { return neutral(r, "invalid-authority-observation"); }
}
