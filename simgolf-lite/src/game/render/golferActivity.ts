import type { ShotMotionIdentityV1 } from "../rules/shotMotion";
import { GOLFER_ANIM_COLS, WALK_STRIDES_PER_TILE, octantRow } from "./golferSprites";

/** Pinned by docs/natural-golfer-integration-policy.md. No runtime consumer yet. */
export const NATURAL_GOLFER_ACTIVITY_POLICY = Object.freeze({
  version: 1 as const,
  id: "natural-golfer-integration-v1" as const,
  maxRecords: 128 as const,
  maxRetentionMs: 10000 as const,
  maxForeground: 1 as const,
  maxPending: 0 as const,
  maxClips: 32 as const,
  qualityActors: Object.freeze({ high: 16, medium: 8, low: 4 }),
  qualityReactions: Object.freeze({ high: 2, medium: 1, low: 0 }),
});
export type GolferActivityPolicy = typeof NATURAL_GOLFER_ACTIVITY_POLICY;
export type ActivityQuality = "high" | "medium" | "low";
export type ActivityHand = "right" | "left";
export type ActivityEquipment = "none" | "driver" | "iron" | "wedge" | "putter";
export type GolferActivityPhase = "walk" | "settle" | "address" | "backswing" | "contact" | "follow-through" | "watch" | "reaction" | "walk-on";
export interface ActivityOwner {
  readonly scopeId: string;
  readonly actorId: string;
  readonly shot: Readonly<ShotMotionIdentityV1> | null;
}
/** Exact readonly structural seam of c08a5ff/a6bf460; no second clock implementation. */
export interface ActivityShotPacingPlan {
  readonly version: 1;
  readonly scopeId: string;
  readonly actorId: string;
  readonly key: string;
  readonly identity: Readonly<ShotMotionIdentityV1>;
  readonly kind: "swing" | "putt";
  readonly durationMs: number;
  readonly addressMs: number;
  readonly contactMs: number;
  readonly restMs: number;
  readonly firstContactT: number;
}
export interface ActivityShotPacingCursor { readonly version: 1; readonly key: string; readonly elapsedMs: number }
export interface ActivityShotPacingFrame {
  readonly key: string; readonly shotId: string; readonly progress: number; readonly motionProgress: number;
  readonly phase: "address" | "contact" | "flight" | "roll" | "rest" | "complete";
  readonly addressing: boolean; readonly complete: boolean;
}
export interface ActivityRoot {
  readonly horizontal: "tiles"; readonly vertical: "yards";
  readonly x: number; readonly y: number; readonly heightYards: number;
}
/** A real available clip pair, validated upstream; never an un-authored manifest promise. */
export interface ActivityClipPair {
  readonly id: string; readonly role: "swing" | "putt";
  readonly targetOctant: number; readonly handedness: ActivityHand; readonly equipmentClass: ActivityEquipment;
  readonly row: number; readonly frames: number; readonly contactFrame: number;
  readonly mirror: false; readonly validated: true;
}
export interface GolferActivityFacts {
  readonly version: 1;
  readonly owner: ActivityOwner;
  readonly currentOwner: ActivityOwner;
  /** Invalidation epoch, not a RAF counter. Must change on replacement/reconcile. */
  readonly authorityRevision: string;
  readonly currentAuthorityRevision: string;
  readonly root: ActivityRoot;
  readonly facingOctant: number | null;
  readonly targetOctant: number | null;
  readonly handedness: ActivityHand | null;
  readonly equipmentClass: ActivityEquipment | null;
  readonly movement: { readonly legal: true; readonly segmentId: string; readonly routeRevision: string; readonly currentRouteRevision: string; readonly distanceTiles: number; readonly walkingOn: boolean } | null;
  readonly playback: { readonly plan: ActivityShotPacingPlan; readonly cursor: ActivityShotPacingCursor; readonly frame: ActivityShotPacingFrame; readonly retainedEvidence: { readonly key: string; readonly validated: true } } | null;
  /** Classification and eligibility belong upstream (ZK-1419), never inferred here. */
  readonly outcome: { readonly key: string; readonly endpointObserved: true; readonly evidenceId: string; readonly result: "good" | "bad" | "hole-out" | "exceptional" | "neutral"; readonly eligible: boolean } | null;
  readonly clips: readonly ActivityClipPair[];
  readonly mode: "overview" | "follow" | "controlled";
  readonly followExplicit: boolean;
  readonly visibility: "visible" | "culled";
  readonly quality: ActivityQuality;
  readonly motionEnabled: boolean;
  readonly paused: boolean;
  readonly hidden: boolean;
  readonly discontinuity: "none" | "reload" | "skip" | "reveal";
  /** Nondecreasing active presentation time supplied by the caller, held during pause/hidden. */
  readonly presentationTimeMs: number;
}
export interface GolferActivityPose {
  readonly ownerKey: string;
  readonly authorityRevision: string;
  readonly phase: GolferActivityPhase;
  readonly clipId: string;
  readonly row: number; readonly col: number; readonly mirror: boolean;
  readonly root: ActivityRoot;
  readonly feetPx: readonly [24, 69];
  readonly directionOctant: number | null;
  readonly renderedHandedness: ActivityHand | null;
  readonly renderedEquipmentClass: ActivityEquipment | null;
  readonly reaction: "nod" | "sigh" | "brief-celebration" | null;
  readonly fallbackReason: string | null;
}
/** One transient current record: no events, queue, history, clock, completion, or saved carrier. */
export interface GolferActivityState {
  readonly version: 1;
  readonly actorKey: string;
  readonly ownerKey: string;
  readonly authorityRevision: string;
  readonly startedAtMs: number;
  readonly observedAtMs: number;
  readonly elapsedMs: number | null;
  readonly planSignature: string | null;
  readonly movementKey: string | null;
  readonly movementDistanceTiles: number | null;
  readonly foreground: boolean;
  readonly quality: ActivityQuality;
  readonly reactionEvidenceId: string | null;
  readonly pose: GolferActivityPose;
}
export interface GolferActivityProjection {
  readonly pose: GolferActivityPose | null;
  readonly nextState: GolferActivityState | null;
  readonly reason: string | null;
}

type Dict = Record<string, unknown>;
const finite = (v: unknown, min = -1000000, max = 1000000): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const integer = (v: unknown, min: number, max: number): v is number => finite(v, min, max) && Number.isSafeInteger(v);
const label = (v: unknown, max = 256): v is string => typeof v === "string" && v.length > 0 && v.length <= max && Array.from(v).every((c) => c.charCodeAt(0) >= 32);
const record = (v: unknown): v is Dict => v !== null && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const keys = (v: Dict, names: string[]) => Object.keys(v).length === names.length && names.every((name) => Object.hasOwn(v, name));
const nullable = (v: unknown, predicate: (value: unknown) => boolean) => v === null || predicate(v);
const octant = (v: unknown) => integer(v, 0, 7);
const hand = (v: unknown) => v === "right" || v === "left";
const equipment = (v: unknown) => ["none", "driver", "iron", "wedge", "putter"].includes(v as string);
const quality = (v: unknown): v is ActivityQuality => v === "high" || v === "medium" || v === "low";

/** Reject non-JSON/accessors before reading fields; bound work even for hostile carriers. */
function plainJson(v: unknown, depth = 0, ancestors = new Set<object>()): boolean {
  if (v === null || typeof v === "boolean" || typeof v === "string") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (depth > 12 || !v || typeof v !== "object" || ancestors.has(v)) return false;
  if (!record(v) && !(Array.isArray(v) && Object.getPrototypeOf(v) === Array.prototype)) return false;
  const names = Reflect.ownKeys(v);
  if (names.length > 257 || names.some((name) => typeof name !== "string")) return false;
  if (Array.isArray(v) && (names.length !== v.length + 1 || names.some((name) => name !== "length" && !/^(0|[1-9][0-9]*)$/u.test(name as string)))) return false;
  const seen = new Set(ancestors).add(v);
  return names.every((name) => {
    if (name === "length" && Array.isArray(v)) return true;
    const d = Object.getOwnPropertyDescriptor(v, name)!;
    return d.enumerable && Object.hasOwn(d, "value") && plainJson(d.value, depth + 1, seen);
  });
}
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const aa = a as Dict, bb = b as Dict, names = Object.keys(a);
  return names.length === Object.keys(b).length && names.every((name) => Object.hasOwn(bb, name) && same(aa[name], bb[name]));
}
function identity(v: unknown): v is ShotMotionIdentityV1 {
  return record(v) && keys(v, ["shotId", "holeId", "shotNumber", "seed", "club", "style", "modelVersion"])
    && label(v.shotId) && label(v.holeId) && integer(v.shotNumber, 1, 4096) && integer(v.seed, 0, 0xffffffff)
    && label(v.club, 64) && label(v.style, 64) && label(v.modelVersion, 64);
}
function owner(v: unknown): v is ActivityOwner {
  return record(v) && keys(v, ["scopeId", "actorId", "shot"]) && label(v.scopeId) && label(v.actorId) && nullable(v.shot, identity);
}
export function golferActivityOwnerKey(value: unknown): string | null {
  if (!plainJson(value) || !owner(value)) return null;
  const s = value.shot;
  return JSON.stringify(s ? [value.scopeId, value.actorId, s.shotId, s.holeId, s.shotNumber, s.seed, s.club, s.style, s.modelVersion] : [value.scopeId, value.actorId, null]);
}
function root(v: unknown): v is ActivityRoot {
  return record(v) && keys(v, ["horizontal", "vertical", "x", "y", "heightYards"]) && v.horizontal === "tiles" && v.vertical === "yards" && finite(v.x) && finite(v.y) && finite(v.heightYards);
}
function clip(v: unknown): v is ActivityClipPair {
  return record(v) && keys(v, ["id", "role", "targetOctant", "handedness", "equipmentClass", "row", "frames", "contactFrame", "mirror", "validated"])
    && label(v.id, 128) && (v.role === "swing" || v.role === "putt") && octant(v.targetOctant) && hand(v.handedness) && equipment(v.equipmentClass)
    && v.equipmentClass !== "none" && (v.role === "putt" ? v.equipmentClass === "putter" : v.equipmentClass !== "putter")
    && integer(v.row, 0, 7) && v.frames === (v.role === "swing" ? 8 : 4) && v.contactFrame === (v.role === "swing" ? 5 : 2) && v.mirror === false && v.validated === true;
}
function playbackShape(v: unknown): boolean {
  if (!record(v) || !keys(v, ["plan", "cursor", "frame", "retainedEvidence"])) return false;
  const p = v.plan, c = v.cursor, f = v.frame, e = v.retainedEvidence;
  return record(p) && keys(p, ["version", "scopeId", "actorId", "key", "identity", "kind", "durationMs", "addressMs", "contactMs", "restMs", "firstContactT"])
    && p.version === 1 && label(p.scopeId) && label(p.actorId) && label(p.key, 4096) && identity(p.identity) && (p.kind === "swing" || p.kind === "putt")
    && finite(p.durationMs, p.kind === "swing" ? 6000 : 2400, p.kind === "swing" ? 10000 : 4200)
    && p.addressMs === (p.kind === "swing" ? 1000 : 500) && p.contactMs === (p.kind === "swing" ? 200 : 150) && p.restMs === (p.kind === "swing" ? 900 : 650) && finite(p.firstContactT, 0, 1)
    && record(c) && keys(c, ["version", "key", "elapsedMs"]) && c.version === 1 && label(c.key, 4096) && finite(c.elapsedMs, 0, p.durationMs)
    && record(f) && keys(f, ["key", "shotId", "progress", "motionProgress", "phase", "addressing", "complete"])
    && label(f.key, 4096) && label(f.shotId) && finite(f.progress, 0, 1) && finite(f.motionProgress, 0, 1)
    && ["address", "contact", "flight", "roll", "rest", "complete"].includes(f.phase as string) && typeof f.addressing === "boolean" && typeof f.complete === "boolean"
    && record(e) && keys(e, ["key", "validated"]) && label(e.key, 4096) && e.validated === true;
}
function factsShape(v: unknown): v is GolferActivityFacts {
  if (!plainJson(v) || !record(v) || !keys(v, ["version", "owner", "currentOwner", "authorityRevision", "currentAuthorityRevision", "root", "facingOctant", "targetOctant", "handedness", "equipmentClass", "movement", "playback", "outcome", "clips", "mode", "followExplicit", "visibility", "quality", "motionEnabled", "paused", "hidden", "discontinuity", "presentationTimeMs"])) return false;
  const m = v.movement, o = v.outcome;
  return v.version === 1 && owner(v.owner) && owner(v.currentOwner) && label(v.authorityRevision) && label(v.currentAuthorityRevision) && root(v.root)
    && nullable(v.facingOctant, octant) && nullable(v.targetOctant, octant) && nullable(v.handedness, hand) && nullable(v.equipmentClass, equipment)
    && (m === null || (record(m) && keys(m, ["legal", "segmentId", "routeRevision", "currentRouteRevision", "distanceTiles", "walkingOn"]) && m.legal === true && label(m.segmentId) && label(m.routeRevision) && label(m.currentRouteRevision) && finite(m.distanceTiles, 0) && typeof m.walkingOn === "boolean"))
    && nullable(v.playback, playbackShape)
    && (o === null || (record(o) && keys(o, ["key", "endpointObserved", "evidenceId", "result", "eligible"]) && label(o.key, 4096) && o.endpointObserved === true && label(o.evidenceId) && ["good", "bad", "hole-out", "exceptional", "neutral"].includes(o.result as string) && typeof o.eligible === "boolean"))
    && Array.isArray(v.clips) && v.clips.length <= NATURAL_GOLFER_ACTIVITY_POLICY.maxClips && v.clips.every(clip)
    && new Set(v.clips.map((c) => JSON.stringify([c.role, c.targetOctant, c.handedness, c.equipmentClass]))).size === v.clips.length
    && ["overview", "follow", "controlled"].includes(v.mode as string) && typeof v.followExplicit === "boolean" && ["visible", "culled"].includes(v.visibility as string) && quality(v.quality)
    && typeof v.motionEnabled === "boolean" && typeof v.paused === "boolean" && typeof v.hidden === "boolean"
    && ["none", "reload", "skip", "reveal"].includes(v.discontinuity as string) && finite(v.presentationTimeMs, 0, Number.MAX_SAFE_INTEGER);
}
function coherentPlayback(f: GolferActivityFacts, key: string): boolean {
  if (!f.playback) return f.owner.shot === null;
  const { plan: p, cursor: c, frame: s, retainedEvidence: e } = f.playback;
  const launch = p.addressMs + p.contactMs, endpoint = p.durationMs - p.restMs;
  return p.scopeId === f.owner.scopeId && p.actorId === f.owner.actorId && same(p.identity, f.owner.shot)
    && [p.key, c.key, s.key, e.key].every((k) => k === key) && s.shotId === p.identity.shotId
    && p.kind === (p.identity.club === "Putter" ? "putt" : "swing") && s.complete === (c.elapsedMs === p.durationMs)
    && Math.abs(s.progress - c.elapsedMs / p.durationMs) <= 1e-12 && s.addressing === (c.elapsedMs < launch)
    && (c.elapsedMs < p.addressMs ? s.phase === "address" : c.elapsedMs < launch ? s.phase === "contact" : c.elapsedMs === p.durationMs ? s.phase === "complete" : c.elapsedMs >= endpoint ? s.phase === "rest" : s.phase === (s.motionProgress < p.firstContactT ? "flight" : "roll"))
    && Math.abs(s.motionProgress - Math.max(0, Math.min(1, (c.elapsedMs - launch) / (endpoint - launch)))) <= 1e-12;
}
function neutral(f: GolferActivityFacts, key: string, reason: string | null): GolferActivityPose {
  const direction = f.facingOctant;
  const row = direction === null ? { row: 0, mirror: false } : octantRow(direction);
  return { ownerKey: key, authorityRevision: f.authorityRevision, phase: "watch", clipId: "idle", ...row, col: 0, root: { ...f.root }, feetPx: [24, 69], directionOctant: direction, renderedHandedness: null, renderedEquipmentClass: null, reaction: null, fallbackReason: reason };
}
function noRecord(f: GolferActivityFacts, key: string, reason: string): GolferActivityProjection {
  return { pose: neutral(f, key, reason), nextState: null, reason };
}
function poseShape(p: unknown): p is GolferActivityPose {
  if (!record(p)) return false;
  const legacy = p.clipId === "idle" ? [5, 2] : p.clipId === "walk" ? [5, 6] : p.clipId === "swing" ? [5, 8] : p.clipId === "putt" ? [5, 4] : [8, 8];
  return keys(p, ["ownerKey", "authorityRevision", "phase", "clipId", "row", "col", "mirror", "root", "feetPx", "directionOctant", "renderedHandedness", "renderedEquipmentClass", "reaction", "fallbackReason"])
    && label(p.ownerKey, 4096) && actorKeyFromOwnerKey(p.ownerKey) !== null && label(p.authorityRevision) && ["walk", "settle", "address", "backswing", "contact", "follow-through", "watch", "reaction", "walk-on"].includes(p.phase as string)
    && label(p.clipId, 128) && integer(p.row, 0, 7) && integer(p.col, 0, 7) && typeof p.mirror === "boolean" && root(p.root) && same(p.feetPx, [24, 69]) && nullable(p.directionOctant, octant)
    && (p.row as number) < legacy[0] && (p.col as number) < legacy[1]
    && nullable(p.renderedHandedness, hand) && nullable(p.renderedEquipmentClass, equipment) && [null, "nod", "sigh", "brief-celebration"].includes(p.reaction as string | null) && nullable(p.fallbackReason, label);
}
function stateShape(v: unknown): v is GolferActivityState {
  if (!plainJson(v) || !record(v) || !keys(v, ["version", "actorKey", "ownerKey", "authorityRevision", "startedAtMs", "observedAtMs", "elapsedMs", "planSignature", "movementKey", "movementDistanceTiles", "foreground", "quality", "reactionEvidenceId", "pose"])) return false;
  return v.version === 1 && label(v.actorKey, 1024) && label(v.ownerKey, 4096) && v.actorKey === actorKeyFromOwnerKey(v.ownerKey) && label(v.authorityRevision) && finite(v.startedAtMs, 0, Number.MAX_SAFE_INTEGER) && finite(v.observedAtMs, v.startedAtMs, Number.MAX_SAFE_INTEGER)
    && v.observedAtMs - v.startedAtMs <= 10000 && nullable(v.elapsedMs, (n) => finite(n, 0, 10000)) && nullable(v.planSignature, (s) => label(s, 4096)) && ((v.elapsedMs === null) === (v.planSignature === null))
    && nullable(v.movementKey, (s) => label(s, 1024)) && nullable(v.movementDistanceTiles, (n) => finite(n, 0)) && ((v.movementKey === null) === (v.movementDistanceTiles === null))
    && typeof v.foreground === "boolean" && quality(v.quality) && nullable(v.reactionEvidenceId, label)
    && poseShape(v.pose) && v.pose.ownerKey === v.ownerKey && v.pose.authorityRevision === v.authorityRevision;
}

/**
 * Pure projection only. Facts must come from validated current authority/shared pacing.
 * Invalid ownership returns current-root neutral with no record. No completion/event output.
 * Use admitGolferActivity for global admission before publishing choreography.
 */
export function projectGolferActivity(policy: GolferActivityPolicy, canonicalFacts: GolferActivityFacts, previousPresentationState: GolferActivityState | null = null): GolferActivityProjection {
  if (!plainJson(policy) || !same(policy, NATURAL_GOLFER_ACTIVITY_POLICY) || !factsShape(canonicalFacts)) return { pose: null, nextState: null, reason: "invalid-carrier" };
  const f = canonicalFacts, key = golferActivityOwnerKey(f.owner)!, actorKey = JSON.stringify([f.owner.scopeId, f.owner.actorId]);
  if (key !== golferActivityOwnerKey(f.currentOwner) || f.authorityRevision !== f.currentAuthorityRevision) return noRecord(f, key, "owner-invalidated");
  if (!coherentPlayback(f, key)) return noRecord(f, key, "invalid-shared-playback");
  if (f.playback && f.equipmentClass !== null && (f.equipmentClass === "none" || (f.playback.plan.kind === "putt" ? f.equipmentClass !== "putter" : f.equipmentClass === "putter"))) return noRecord(f, key, "equipment-kind-mismatch");
  if (f.outcome && f.outcome.key !== key) return noRecord(f, key, "outcome-owner-mismatch");
  if (f.hidden || f.visibility === "culled" || f.discontinuity !== "none") return noRecord(f, key, f.hidden ? "hidden" : f.visibility === "culled" ? "culled" : f.discontinuity);
  if (f.mode === "follow" && !f.followExplicit) return noRecord(f, key, "follow-not-explicit");
  const previous = stateShape(previousPresentationState) && previousPresentationState.actorKey === actorKey && previousPresentationState.ownerKey === key && previousPresentationState.authorityRevision === f.authorityRevision ? previousPresentationState : null;
  const elapsed = f.playback?.cursor.elapsedMs ?? null;
  const p = f.playback?.plan;
  const planSignature = p ? JSON.stringify([p.version, p.key, p.kind, p.durationMs, p.addressMs, p.contactMs, p.restMs, p.firstContactT]) : null;
  const movementKey = f.movement ? JSON.stringify([f.movement.routeRevision, f.movement.segmentId]) : null;
  if (previous && previous.planSignature !== planSignature) return noRecord(f, key, "shared-plan-changed");
  if (previous && (f.presentationTimeMs < previous.observedAtMs || (elapsed !== null && previous.elapsedMs !== null && elapsed < previous.elapsedMs))) return noRecord(f, key, "nonmonotonic-presentation");
  if (previous && f.presentationTimeMs - previous.startedAtMs > policy.maxRetentionMs) return noRecord(f, key, "retention-expired");
  const foreground = f.playback !== null && (f.mode === "controlled" || (f.mode === "follow" && f.followExplicit));
  if (f.movement && f.movement.routeRevision !== f.movement.currentRouteRevision) return noRecord(f, key, "stale-route");
  if (previous && previous.movementKey !== movementKey) return noRecord(f, key, "movement-invalidated");
  if (previous && f.paused) {
    if (!same(previous.pose.root, f.root) || previous.elapsedMs !== elapsed || previous.observedAtMs !== f.presentationTimeMs || previous.movementDistanceTiles !== (f.movement?.distanceTiles ?? null)) return noRecord(f, key, "held-authority-changed");
    return { pose: { ...previous.pose, root: { ...f.root }, feetPx: [24, 69] }, nextState: { ...previous, foreground, pose: { ...previous.pose, root: { ...f.root }, feetPx: [24, 69] } }, reason: "held" };
  }
  if (previous && f.movement && previous.movementKey === movementKey && previous.movementDistanceTiles !== null) {
    const distance = f.movement.distanceTiles - previous.movementDistanceTiles;
    const displacement = Math.hypot(f.root.x - previous.pose.root.x, f.root.y - previous.pose.root.y);
    if (distance < -1e-9 || distance + 1e-9 < displacement || (displacement === 0 && distance !== 0)) return noRecord(f, key, "movement-evidence-changed");
  }
  let pose = neutral(f, key, null), reactionEvidenceId: string | null = null;
  if (f.paused || !f.motionEnabled) pose = neutral(f, key, f.paused ? "paused-without-current-record" : "motion-off");
  else if (f.playback) {
    const { plan: p, cursor: c } = f.playback;
    const putt = p.kind === "putt", launch = p.addressMs + p.contactMs, endpoint = p.durationMs - p.restMs, reactionStart = p.durationMs - 600;
    const t = c.elapsedMs, settle = putt ? 300 : 600, backswing = putt ? 100 : 200, follow = putt ? 150 : 300;
    const phase: GolferActivityPhase = t < settle ? "settle" : t < p.addressMs - backswing ? "address" : t < p.addressMs ? "backswing" : t <= launch ? "contact" : t < launch + follow ? "follow-through" : "watch";
    pose = { ...pose, phase };
    if (["address", "backswing", "contact", "follow-through"].includes(phase)) {
      const pair = f.clips.find((candidate) => candidate.role === p.kind && candidate.targetOctant === f.targetOctant && candidate.handedness === f.handedness && candidate.equipmentClass === f.equipmentClass);
      const legacyAllowed = f.handedness === null && f.targetOctant !== null;
      if (!pair && !legacyAllowed) pose = neutral(f, key, f.targetOctant === null ? "unknown-target" : "unsupported-hand-equipment-pair");
      else {
        const contact = putt ? 2 : 5;
        const col = t === launch ? contact : t < p.addressMs - backswing ? 0 : t < p.addressMs ? Math.min(contact - 1, Math.floor((t - (p.addressMs - backswing)) / backswing * contact)) : t < launch ? contact - 1 : putt ? 3 : t < launch + follow / 2 ? 6 : 7;
        const direction = pair ? { row: pair.row, mirror: false } : octantRow(f.targetOctant!);
        pose = { ...pose, clipId: pair?.id ?? p.kind, ...direction, col, directionOctant: f.targetOctant, renderedHandedness: pair?.handedness ?? null, renderedEquipmentClass: pair?.equipmentClass ?? null, fallbackReason: pair ? null : "legacy-unverified-strike" };
      }
    }
    const observed = f.outcome;
    const expectedReaction = observed?.result === "bad" ? "sigh" : observed?.result === "good" ? "nod" : "brief-celebration";
    const alreadyShowing = previous?.reactionEvidenceId === observed?.evidenceId && previous?.pose.reaction === expectedReaction;
    const newlyCrossed = previous?.elapsedMs !== null && previous?.elapsedMs !== undefined && previous.elapsedMs < reactionStart && t >= reactionStart;
    if (t >= reactionStart && t < p.durationMs && t >= endpoint && observed?.eligible && observed.result !== "neutral" && (newlyCrossed || alreadyShowing) && f.quality !== "low") {
      const reaction = observed.result === "bad" ? "sigh" : observed.result === "good" ? "nod" : "brief-celebration";
      pose = { ...neutral(f, key, null), phase: "reaction", reaction };
      reactionEvidenceId = observed.evidenceId;
    }
  } else if (f.movement) {
    if (f.movement.routeRevision !== f.movement.currentRouteRevision || f.facingOctant === null) pose = neutral(f, key, "unavailable-current-movement");
    else pose = { ...pose, phase: f.movement.walkingOn ? "walk-on" : "walk", clipId: "walk", col: Math.floor(f.movement.distanceTiles * WALK_STRIDES_PER_TILE * GOLFER_ANIM_COLS.walk) % GOLFER_ANIM_COLS.walk };
  }
  const state: GolferActivityState = { version: 1, actorKey, ownerKey: key, authorityRevision: f.authorityRevision, startedAtMs: previous?.startedAtMs ?? f.presentationTimeMs, observedAtMs: f.presentationTimeMs, elapsedMs: elapsed, planSignature, movementKey, movementDistanceTiles: f.movement?.distanceTiles ?? null, foreground, quality: f.quality, reactionEvidenceId, pose };
  return { pose, nextState: state, reason: pose.fallbackReason };
}

export interface GolferActivityAdmission { readonly projection: GolferActivityProjection; readonly records: readonly GolferActivityState[] }
/**
 * Actual bounded admission, not caller ranks. Earlier admitted actors have priority;
 * callers choose deterministic order. Never evicts a valid paused/current owner.
 * Expiry time is the same caller-owned active presentation time, not another timer.
 */
export function admitGolferActivity(policy: GolferActivityPolicy, records: readonly GolferActivityState[], projection: GolferActivityProjection, presentationTimeMs: number): GolferActivityAdmission {
  if (!plainJson(policy) || !same(policy, NATURAL_GOLFER_ACTIVITY_POLICY) || !plainJson(records) || !Array.isArray(records) || records.length > policy.maxRecords || !records.every(stateShape)
    || !finite(presentationTimeMs, 0, Number.MAX_SAFE_INTEGER)) return { projection: { pose: null, nextState: null, reason: "invalid-admission-carrier" }, records: [] };
  if (!plainJson(projection) || !record(projection) || !keys(projection, ["pose", "nextState", "reason"]) || !nullable(projection.pose, poseShape) || !nullable(projection.reason, label)) return { projection: { pose: null, nextState: null, reason: "invalid-admission-carrier" }, records };
  if (records.some((state) => presentationTimeMs < state.observedAtMs)) return { projection: { pose: null, nextState: null, reason: "nonmonotonic-admission" }, records };
  const valid = records.filter((state) => presentationTimeMs - state.startedAtMs <= policy.maxRetentionMs);
  if (new Set(valid.map((state) => state.actorKey)).size !== valid.length || new Set(valid.map((state) => state.ownerKey)).size !== valid.length || valid.filter((state) => state.foreground).length > policy.maxForeground) return { projection: { pose: null, nextState: null, reason: "invalid-admission-records" }, records: [] };
  if (valid.length > Math.min(128, ...valid.map((state) => policy.qualityActors[state.quality])) || valid.filter((state) => state.pose.reaction !== null).length > Math.min(2, ...valid.map((state) => policy.qualityReactions[state.quality]))) return { projection: { pose: null, nextState: null, reason: "invalid-admission-records" }, records: [] };
  const candidate = projection.nextState;
  if (candidate === null) {
    const actorKey = projection.pose ? actorKeyFromOwnerKey(projection.pose.ownerKey) : null;
    return { projection, records: valid.filter((state) => state.actorKey !== actorKey) };
  }
  if (!stateShape(candidate) || !same(projection.pose, candidate.pose) || candidate.observedAtMs !== presentationTimeMs) return { projection: { pose: null, nextState: null, reason: "invalid-admission-candidate" }, records: valid };
  const others = valid.filter((state) => state.actorKey !== candidate.actorKey);
  const replacing = valid.find((state) => state.actorKey === candidate.actorKey);
  // A rejected new activity cannot keep an obsolete owner/epoch alive for this actor.
  // Capacity failure alone does not invalidate a still-current held record.
  const retainedOnFailure = replacing && (replacing.ownerKey !== candidate.ownerKey || replacing.authorityRevision !== candidate.authorityRevision) ? others : valid;
  const fail = (reason: string): GolferActivityAdmission => ({ projection: { pose: neutralFromPose(candidate.pose, reason), nextState: null, reason }, records: retainedOnFailure });
  if (replacing && replacing.ownerKey === candidate.ownerKey && candidate.observedAtMs < replacing.observedAtMs) return fail("nonmonotonic-admission");
  const actorCap = Math.min(policy.qualityActors[candidate.quality], ...others.map((state) => policy.qualityActors[state.quality]));
  const reactionCap = Math.min(policy.qualityReactions[candidate.quality], ...others.map((state) => policy.qualityReactions[state.quality]));
  if (others.length >= policy.maxRecords || others.length >= actorCap) return fail("activity-cap");
  if (candidate.foreground && others.some((state) => state.foreground)) return fail("foreground-cap");
  if (candidate.pose.reaction && others.filter((state) => state.pose.reaction !== null).length >= reactionCap) return fail("reaction-cap");
  return { projection, records: [...others, candidate] };
}
function actorKeyFromOwnerKey(key: string): string | null {
  try {
    const t: unknown = JSON.parse(key);
    if (!Array.isArray(t) || !label(t[0]) || !label(t[1]) || !((t.length === 3 && t[2] === null) || (t.length === 9 && identity({ shotId: t[2], holeId: t[3], shotNumber: t[4], seed: t[5], club: t[6], style: t[7], modelVersion: t[8] })))) return null;
    return JSON.stringify(t.slice(0, 2));
  } catch { return null; }
}
function neutralFromPose(pose: GolferActivityPose, reason: string): GolferActivityPose {
  return { ...pose, phase: "watch", clipId: "idle", row: 0, col: 0, mirror: false, directionOctant: null, renderedHandedness: null, renderedEquipmentClass: null, reaction: null, fallbackReason: reason };
}
