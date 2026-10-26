import { clearFocusedLiveActivitySource } from "../live/activitySource";
import { isShotPacingCursor, shotPacingFrame } from "../live/shotPacing";
import type { GolferRenderData } from "../live/types";
import type { PlayerPlayableRound } from "../models/playerProTypes";
import { playerShotActivityIsCurrent, playerShotActivitySample, type PlayerShotActivitySampleV1, type PlayerShotPlaybackFrame } from "../playerPro/shotPlayback";
import { isValidRetainedShotMotionV1 } from "../rules/shotMotion";
import { ELEVATION_STEP_YARDS } from "../rules/obstacleCollision";
import type { NaturalGolferAtlas, NaturalGolferTextureLookup } from "../../render/naturalGolferAtlas";
import { admitGolferActivity, golferActivityOwnerKey, NATURAL_GOLFER_ACTIVITY_POLICY, projectGolferActivity } from "./golferActivity";
import type { GolferActivityFacts, GolferActivityProjection, GolferActivityState } from "./golferActivity";
import { scheduleGolferReactions, type GolferReactionState } from "./golferReactions";
import { projectGolferLocomotion } from "./golferLocomotion";
import type { GolferLocomotionState } from "./golferLocomotion";
import { createGolferStanceBinding, NATURAL_GOLFER_CONTACT_MODEL, naturalGolferWorldView, sampleGolferStance } from "./golferStance";
import type { GolferStanceBinding, GolferStancePlant, GolferStancePoint } from "./golferStance";
import { naturalGolferActivityClips } from "./naturalGolferClips";
import { facingOctant, octantRow, type GolferPose } from "./golferSprites";
import { tileCenterIso, type IsoRotation } from "./iso";
import { entityDepth } from "./objectPlacement";
import type { LiveGolferGroundAuthority } from "./golferGroundAuthority";
import type { NaturalGolferArtIndex } from "./naturalGolferArt";

export const NATURAL_GOLFER_PILOT_SELECTION = Object.freeze({ family: "natural-golfer-v1", identity: "primary-teal-cream-01" });
export const NATURAL_GOLFER_PILOT_TINT = 0x397e82;
export const naturalGolferCandidateEnabled = (development: boolean, search: string): boolean => development && new URLSearchParams(search).get("naturalGolfers") === "1";
type Pair<T> = Extract<NaturalGolferTextureLookup<T>, { kind: "pair" }>;
export interface NaturalGolferRuntimeFrame<T> {
  readonly actorId: number; readonly ownerKey: string | null;
  readonly legacyPose: GolferPose;
  readonly natural: {
    readonly pair: Pair<T>; readonly localOffset: Readonly<{ x: number; y: number }>; readonly depth: number; readonly feet: GolferStancePoint;
    readonly footDomain: "arrival-eligible" | "visual-neutral";
    readonly physicalRootHeightYards: number | null; readonly visualRootHeightYards: number;
  } | null;
  readonly phase: string; readonly reason: string | null; readonly fastForward: boolean;
  readonly contact: boolean; readonly plantKey: string | null;
  readonly contactGeometry: { readonly actualTip: Readonly<{ x: number; y: number }>; readonly datum: Readonly<{ x: number; y: number }>; readonly residualPx: number } | null;
}
export interface NaturalGolferRuntimeInput {
  readonly golfers: readonly GolferRenderData[]; readonly visibleIds: ReadonlySet<number>;
  readonly ground: LiveGolferGroundAuthority; readonly rotation: IsoRotation;
  readonly presentationTimeMs: number; readonly paused: boolean; readonly hidden: boolean; readonly visibilityEpoch: number;
  readonly motionEnabled: boolean; readonly quality: "high" | "medium" | "low"; readonly operatingTier: 1 | 2 | 4;
  readonly followedId: number | null;
}
export interface ControlledGolferRuntimeInput {
  readonly sample: PlayerShotActivitySampleV1 | null;
  readonly round: PlayerPlayableRound | null;
  readonly expectedActorId: string | null;
  readonly playback: PlayerShotPlaybackFrame | null;
  readonly paused: boolean;
  readonly visible: boolean;
}
export interface ControlledGolferRuntimeFrame {
  readonly actorKey: string; readonly actorId: string; readonly ownerKey: string;
  readonly sourceFrame: PlayerShotActivitySampleV1["frame"];
  readonly legacyPose: GolferPose; readonly phase: string; readonly reason: string | null;
  readonly admitted: boolean;
  /** Legacy art has no certified hand/contact pair or independent facing. */
  readonly verifiedContact: false;
}
export interface NaturalGolferRuntimeBatch<T> {
  readonly live: ReadonlyMap<number, NaturalGolferRuntimeFrame<T>>;
  readonly controlled: ControlledGolferRuntimeFrame | null;
}
export interface NaturalGolferRuntimeDiagnostics {
  readonly pilotId: number | null; readonly scopeId: string | null; readonly records: number; readonly localRecords: number;
  readonly foreground: number; readonly pending: 0; readonly reactionRecords: number; readonly eligibleReactions: number; readonly surfaceRevision: string | null;
  readonly atlas: ReturnType<NaturalGolferAtlas<unknown>["snapshot"]> | null;
  readonly legacyAtlasAlsoResident: true;
}
interface Local {
  ownerKey: string; surfaceRevision: string; binding: GolferStanceBinding | null; plant: GolferStancePlant | null;
  locomotion: GolferLocomotionState | null; presentedFeet: GolferStancePoint | null; late: boolean;
  pending: object | null;
  presentedLegacy?: GolferPose;
  controlledContext?: string;
}
const feetCopy = (p: GolferStancePoint): GolferStancePoint => Object.freeze({ x: p.x, y: p.y, heightYards: p.heightYards });
const sameFeet = (a: GolferStancePoint | null, b: GolferStancePoint) => !!a && Math.hypot(a.x - b.x, a.y - b.y) < 1e-7 && Math.abs(a.heightYards - b.heightYards) < 1e-7;
const keyActor = (scope: string, id: string) => JSON.stringify([scope, id]);
/** Bounded verification-only DOM payload. No source, owner, texture, or callback is serialized. */
export function naturalGolferVerificationJSON(snapshot: unknown): string {
  const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" ? v as Record<string, unknown> : {};
  const number = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
  const label = (v: unknown, max = 180): string | null => typeof v === "string" && v.length <= max ? v : null;
  const point = (v: unknown) => { const p = record(v); return number(p.x) !== null && number(p.y) !== null ? { x: number(p.x), y: number(p.y) } : null; };
  const d = record(snapshot), body = record(d.body), atlas = record(d.atlas), feet = record(body.feet), geometry = record(body.geometry);
  return JSON.stringify({ version: 1, pilotId: number(d.pilotId), family: label(body.family, 32), frame: label(body.frame, 128), phase: label(body.phase, 32), reason: label(body.reason),
    footDomain: label(body.footDomain, 32), heights: { physicalRootYards: number(body.physicalRootHeightYards), visualRootYards: number(body.visualRootHeightYards) },
    feet: point(feet) ? { ...point(feet), heightYards: number(feet.heightYards) } : null, holder: point(body.holder), offset: point(body.localOffset),
    contact: { active: typeof body.contact === "boolean" ? body.contact : null, cursorMs: number(body.cursorMs), actualTip: point(geometry.actualTip), datum: point(geometry.datum), residualPx: number(geometry.residualPx) },
    atlas: { status: label(atlas.status, 16), reason: label(atlas.reason), generation: number(atlas.generation), pairs: number(atlas.pairCount), textures: number(atlas.atlasTextureCount), sources: number(atlas.ownedSourceCount) },
    groundRevision: label(d.surfaceRevision, 256) });
}
const currentSource = (g: GolferRenderData) => {
  const s = g.activitySource;
  return !!s && s.version === 1 && s.active && s.scope.active && !!s.scope.id && s.owner.scopeId === s.scope.id
    && s.owner.actorId === String(g.id) && s.authorityRevision === s.scope.revision && s.root.x === g.x && s.root.y === g.y;
};
function currentControlled(c: ControlledGolferRuntimeInput | null): PlayerShotActivitySampleV1 | null {
  try {
  const s = c?.sample, f = c?.playback, r = c?.round;
  if (!c || !s || !f || !r || !c.expectedActorId || typeof c.paused !== "boolean" || typeof c.visible !== "boolean"
    || !playerShotActivityIsCurrent(s, r, c.expectedActorId) || !isValidRetainedShotMotionV1(r.pendingShot?.sharedOutcome?.motion)
    || s.authorityRevision !== r.id || s.owner.scopeId !== r.id || s.owner.actorId !== c.expectedActorId || s.key !== golferActivityOwnerKey(s.owner)
    || !isShotPacingCursor(s.cursor, s.plan) || s.frame.complete || f.shotId !== s.frame.shotId || f.phase !== s.frame.phase || f.progress !== s.frame.progress
    || f.motionProgress !== s.frame.motionProgress || f.addressing !== s.frame.addressing || f.complete !== s.frame.complete) return null;
  const actual = shotPacingFrame(s.plan, s.cursor);
  if (!actual || Object.keys(actual).some(key => actual[key as keyof typeof actual] !== s.frame[key as keyof typeof actual])) return null;
  const expected = playerShotActivitySample(s.plan, s.cursor, actual, r.pendingShot!.sharedOutcome!.motion!, r.id, c.expectedActorId, r.handedness ?? null);
  if (!expected || s.origin.horizontal !== "tiles" || s.origin.vertical !== "yards" || s.equipmentClass !== expected.equipmentClass
    || s.retainedEvidence.validated !== true || s.retainedEvidence.key !== expected.key) return null;
  return s;
  } catch { return null; }
}
/** Immutable body permissions/context only: excludes camera, cursor, and object identity. */
function controlledContext(s: PlayerShotActivitySampleV1, r: PlayerPlayableRound): string {
  const p = s.plan;
  return JSON.stringify([s.key, s.authorityRevision, s.handedness, s.origin.horizontal, s.origin.vertical, s.origin.x, s.origin.y, s.origin.heightYards,
    s.targetWorld?.x ?? null, s.targetWorld?.y ?? null, s.equipmentClass, p.version, p.kind, p.durationMs, p.addressMs, p.contactMs, p.restMs, p.firstContactT,
    r.kind, r.course.courseId, r.course.geometryVersion ?? null, r.course.width, r.course.height, r.course.yardsPerTile, r.teeSet, r.pinRotation, r.currentHoleIndex]);
}
/** One accepted admission store shared by LIVE and a later controlled borrower.
 * Never loads/disposes its borrowed atlas, advances a cursor, or owns authority. */
export function createNaturalGolferRuntime<T>(atlas: () => NaturalGolferAtlas<T> | null) {
  let reactionState: GolferReactionState | null = null;
  let records: readonly GolferActivityState[] = [], liveKeys = new Set<string>(), controlledKey: string | null = null;
  let scopeId: string | null = null, pilotId: number | null = null, selectedPilot = false;
  let surfaceRevision: string | null = null, visibilityEpoch: number | null = null, lastTime = -1;
  let index: NaturalGolferArtIndex | null = null, clips = naturalGolferActivityClips(null, NATURAL_GOLFER_PILOT_SELECTION);
  const locals = new Map<string, Local>();
  const publications = new WeakMap<object, { actorKey: string; local: Local; feet: GolferStancePoint | null; locomotion: GolferLocomotionState | null; plant: GolferStancePlant | null }>();
  const controlledPublications = new WeakMap<object, Local>();
  const dropLive = () => { records = records.filter(r => !liveKeys.has(r.actorKey)); for (const key of liveKeys) locals.delete(key); liveKeys.clear(); };
  const admit = (projection: GolferActivityProjection, time: number) => {
    const result = admitGolferActivity(NATURAL_GOLFER_ACTIVITY_POLICY, records, projection, time); records = result.records; return result.projection;
  };
  return {
    /** Callers must use the SAME active timestamp and this store, never create a second cap domain. */
    admitExternalActivity: admit,
    tickLive(input: NaturalGolferRuntimeInput): ReadonlyMap<number, NaturalGolferRuntimeFrame<T>> { return this.tickFrame(input, null).live; },
    tickFrame(input: NaturalGolferRuntimeInput, controlled: ControlledGolferRuntimeInput | null): NaturalGolferRuntimeBatch<T> {
      const borrowed = atlas(), nextIndex = borrowed?.artIndex() ?? null;
      const sample = currentControlled(controlled);
      const firstScope = input.golfers.find(currentSource)?.activitySource?.scope.id ?? null;
      const scopeChanged = firstScope !== null && firstScope !== scopeId;
      const invalidated = surfaceRevision !== input.ground.surfaceRevision || visibilityEpoch !== input.visibilityEpoch || nextIndex !== index;
      const sessionInvalidated = visibilityEpoch !== null && visibilityEpoch !== input.visibilityEpoch || input.presentationTimeMs < lastTime;
      if (scopeChanged) { dropLive(); scopeId = firstScope; pilotId = null; selectedPilot = false; }
      if (surfaceRevision !== input.ground.surfaceRevision || visibilityEpoch !== input.visibilityEpoch || input.presentationTimeMs < lastTime || nextIndex !== index) dropLive();
      surfaceRevision = input.ground.surfaceRevision; visibilityEpoch = input.visibilityEpoch; lastTime = input.presentationTimeMs;
      if (nextIndex !== index) { index = nextIndex; clips = naturalGolferActivityClips(index, NATURAL_GOLFER_PILOT_SELECTION); }
      if (!selectedPilot && scopeId) {
        const eligible = input.golfers.filter(g => currentSource(g) && g.activitySource!.scope.id === scopeId && g.activitySource!.handedness === "right").sort((a, b) => a.id - b.id);
        if (eligible[0]) { pilotId = eligible[0].id; selectedPilot = true; }
      }
      const previousRecords = new Map(records.map(r => [r.actorKey, r]));
      records = records.filter(r => !liveKeys.has(r.actorKey) && r.actorKey !== controlledKey); liveKeys = new Set();
      if (controlledKey && (!sample || controlledKey !== keyActor(sample.owner.scopeId, sample.actorId))) locals.delete(controlledKey);
      controlledKey = sample ? keyActor(sample.owner.scopeId, sample.actorId) : null;
      const context = sample ? controlledContext(sample, controlled!.round!) : null;
      if (controlledKey && locals.get(controlledKey)?.controlledContext !== context) {
        // A current replacement may keep the same owner key. Invalidate its
        // prior activity/acknowledged pose BEFORE a paused publication.
        previousRecords.delete(controlledKey); locals.delete(controlledKey);
      }
      let controlledFacts: GolferActivityFacts | null = sample ? { version: 1, owner: sample.owner, currentOwner: sample.owner,
        authorityRevision: sample.authorityRevision, currentAuthorityRevision: sample.authorityRevision, root: sample.origin,
        facingOctant: null, targetOctant: naturalGolferWorldView(sample.targetWorld, input.rotation)?.octant ?? null,
        handedness: sample.handedness, equipmentClass: sample.equipmentClass, movement: null,
        playback: { plan: sample.plan, cursor: sample.cursor, frame: sample.frame, retainedEvidence: sample.retainedEvidence }, outcome: null, clips: [],
        mode: "controlled", followExplicit: false, visibility: controlled!.visible ? "visible" : "culled", quality: input.quality,
        motionEnabled: input.motionEnabled, paused: controlled!.paused, hidden: input.hidden, discontinuity: sessionInvalidated ? "reveal" : "none", presentationTimeMs: input.presentationTimeMs } : null;
      const output = new Map<number, NaturalGolferRuntimeFrame<T>>();
      const sorted = [...input.golfers].sort((a, b) => Number(b.id === input.followedId) - Number(a.id === input.followedId) || Number(b.id === pilotId) - Number(a.id === pilotId) || a.id - b.id);
      const prepared = sorted.map(golfer => {
        const raw = golfer.activitySource, followed = !sample && input.followedId === golfer.id;
        const source = !followed && raw?.playback ? clearFocusedLiveActivitySource(raw) : raw;
        if (!source || !currentSource(golfer) || !source.scope.id || source.scope.id !== scopeId
          || sample && source.owner.scopeId === sample.owner.scopeId && source.owner.actorId === sample.actorId) return { golfer, source: null, facts: null };
        const owner = { ...source.owner, scopeId: source.scope.id }, actorKey = keyActor(owner.scopeId, owner.actorId);
        const height = source.root.heightYards ?? input.ground.heightAt(golfer.x + .5, golfer.y + .5) * ELEVATION_STEP_YARDS;
        const facing = source.facingWorld ? facingOctant(source.facingWorld.x, source.facingWorld.y, input.rotation) : null;
        const target = naturalGolferWorldView(source.targetWorld, input.rotation);
        const facts: GolferActivityFacts = { version: 1, owner, currentOwner: owner, authorityRevision: source.authorityRevision, currentAuthorityRevision: source.authorityRevision,
          root: { horizontal: "tiles", vertical: "yards", x: source.root.x, y: source.root.y, heightYards: height }, facingOctant: facing, targetOctant: target?.octant ?? null,
          handedness: source.handedness, equipmentClass: source.equipmentClass,
          movement: source.movement && source.movement.onFoot === true ? { legal: true, segmentId: source.movement.segmentKey, routeRevision: source.authorityRevision,
            currentRouteRevision: source.authorityRevision, distanceTiles: source.movement.distanceTiles, walkingOn: false } : null,
          playback: source.playback, outcome: null, clips: golfer.id === pilotId ? clips : [], mode: followed ? "follow" : "overview", followExplicit: followed,
          visibility: input.visibleIds.has(golfer.id) ? "visible" : "culled", quality: input.quality, motionEnabled: input.motionEnabled,
          paused: input.paused, hidden: input.hidden, discontinuity: "none", presentationTimeMs: input.presentationTimeMs };
        liveKeys.add(actorKey); return { golfer, source, facts };
      });
      // One frame-wide reaction batch and admission store for both domains.
      const reactionBatch = [
        ...(controlledFacts ? [{ facts: controlledFacts, classification: sample?.reactionClassification ?? null, discard: false }] : []),
        ...prepared.filter(row => row.facts?.playback && row.facts.owner.shot).map(row => ({ facts: row.facts!, classification: row.golfer.activitySource?.reactionClassification ?? null, discard: invalidated || scopeChanged })),
      ].slice(0, 128);
      const reactions = scheduleGolferReactions(reactionState, { scopeId: "natural-golfer-render-session", authorityRevision: "1",
        presentationTimeMs: input.presentationTimeMs, quality: input.quality, motionEnabled: input.motionEnabled, hidden: input.hidden,
        discontinuity: sessionInvalidated ? "reveal" : "none",
        actors: reactionBatch.map(({ facts, classification, discard }) => ({ owner: facts!.owner, currentOwner: facts!.currentOwner,
          authorityRevision: facts!.authorityRevision, currentAuthorityRevision: facts!.currentAuthorityRevision,
          ...facts!.playback!, classification, visibility: discard ? "culled" : facts!.visibility, paused: facts!.paused })) });
      reactionState = reactions.state;
      const outcomes = new Map(reactions.outputs.map(out => [out.actorKey, out.outcome]));
      if (controlledFacts) controlledFacts = { ...controlledFacts, outcome: outcomes.get(controlledKey!) ?? null };
      for (const row of prepared) if (row.facts) row.facts = { ...row.facts, outcome: outcomes.get(keyActor(row.facts.owner.scopeId, row.facts.owner.actorId)) ?? null };
      // Eligible static cues precede ordinary activity admission, without a queue.
      prepared.sort((a, b) => Number(b.facts?.outcome?.eligible === true) - Number(a.facts?.outcome?.eligible === true));
      // Retention expires HISTORY, not the selected visual family. Reacquire
      // current facts in the same tick with no old gait/plant/strike evidence.
      for (const facts of [...prepared.map(row => row.facts), controlledFacts]) {
        if (!facts || facts.paused) continue;
        const actor = keyActor(facts.owner.scopeId, facts.owner.actorId), previous = previousRecords.get(actor);
        if (previous && input.presentationTimeMs - previous.startedAtMs > NATURAL_GOLFER_ACTIVITY_POLICY.maxRetentionMs) {
          previousRecords.delete(actor); locals.delete(actor);
        }
      }
      const previousActivity = (facts: GolferActivityFacts) => {
        const previous = previousRecords.get(keyActor(facts.owner.scopeId, facts.owner.actorId));
        const movementKey = facts.movement ? JSON.stringify([facts.movement.routeRevision, facts.movement.segmentId]) : null;
        // A newly observed legal leg invalidates old activity first. Fresh
        // projection is current-authority static/gait, never a queued route.
        return previous?.movementKey === movementKey ? previous : undefined;
      };
      const retainedIds = new Set<string>();
      let controlledFrame: ControlledGolferRuntimeFrame | null = null;
      if (controlledFacts && sample) {
        const projection = admit(projectGolferActivity(NATURAL_GOLFER_ACTIVITY_POLICY, controlledFacts, previousActivity(controlledFacts)), input.presentationTimeMs);
        let local = locals.get(controlledKey!);
        if (!local || local.ownerKey !== sample.key) {
          local = { ownerKey: sample.key, surfaceRevision: "controlled-legacy", binding: null, plant: null, locomotion: null, presentedFeet: null, late: true, pending: null, controlledContext: context! };
        }
        let pose: GolferPose = { anim: "idle", ...octantRow(2), col: 0 };
        const p = projection.pose;
        // Target never supplies actual facing. Only explicitly degraded unknown-
        // hand legacy strikes use the target rows; known unsupported hands rest.
        if (projection.nextState && p?.fallbackReason === "legacy-unverified-strike" && (p.clipId === "swing" || p.clipId === "putt")) pose = { anim: p.clipId, row: p.row, mirror: p.mirror, col: p.col };
        if (controlledFacts.paused && local.presentedLegacy) {
          const held = local.presentedLegacy;
          // Hold phase/column, while deriving the current camera view from the
          // unchanged world target. Known hands never inherit a degraded strike.
          pose = sample.handedness === null && (held.anim === "swing" || held.anim === "putt") && controlledFacts.targetOctant !== null
            ? { ...held, ...octantRow(controlledFacts.targetOctant) } : { anim: "idle", ...octantRow(2), col: 0 };
        }
        controlledFrame = Object.freeze({ actorKey: controlledKey!, actorId: sample.actorId, ownerKey: sample.key,
          sourceFrame: Object.freeze({ key: sample.frame.key, shotId: sample.frame.shotId, progress: sample.frame.progress, motionProgress: sample.frame.motionProgress,
            phase: sample.frame.phase, addressing: sample.frame.addressing, complete: sample.frame.complete }), legacyPose: Object.freeze(pose),
          phase: p?.phase ?? "watch", reason: projection.reason ?? p?.fallbackReason ?? (p?.phase === "reaction" ? "unsupported-reaction-facing" : null),
          admitted: !!projection.nextState, verifiedContact: false });
        if (projection.nextState) { retainedIds.add(controlledKey!); locals.set(controlledKey!, local); local.pending = controlledFrame; controlledPublications.set(controlledFrame, local); }
        else locals.delete(controlledKey!);
      }
      // Reserve the current controlled foreground first. Paused overview actors
      // keep their proofs only within the unchanged remaining quality capacity.
      for (const row of prepared) {
        if (!row.facts?.paused) continue;
        const prev = previousActivity(row.facts);
        if (prev) admit(projectGolferActivity(NATURAL_GOLFER_ACTIVITY_POLICY, row.facts, prev), input.presentationTimeMs);
      }
      for (const { golfer, source, facts } of prepared) {
        const facing = facts?.facingOctant ?? facingOctant(golfer.dirX, golfer.dirY, input.rotation);
        const legacy: GolferPose = { anim: "idle", ...octantRow(facing), col: 0 };
        let frame: NaturalGolferRuntimeFrame<T> = { actorId: golfer.id, ownerKey: facts ? golferActivityOwnerKey(facts.owner) : null, legacyPose: legacy, natural: null,
          phase: "watch", reason: "unsupported-current-source", fastForward: false, contact: false, plantKey: null, contactGeometry: null };
        if (!source || !facts) { output.set(golfer.id, Object.freeze(frame)); continue; }
        const projection = admit(projectGolferActivity(NATURAL_GOLFER_ACTIVITY_POLICY, facts, previousActivity(facts)), input.presentationTimeMs);
        const reactionCue = projection.pose?.phase === "reaction" && facts.outcome?.eligible === true && input.quality !== "low" && input.motionEnabled;
        frame = { ...frame, phase: projection.pose?.phase ?? "watch", reason: projection.reason };
        const actorKey = keyActor(facts.owner.scopeId, facts.owner.actorId);
        if (!projection.nextState || !projection.pose) { locals.delete(actorKey); output.set(golfer.id, Object.freeze(frame)); continue; }
        retainedIds.add(actorKey);
        const root = feetCopy({ x: facts.root.x, y: facts.root.y, heightYards: facts.root.heightYards }), ownerKey = projection.pose.ownerKey;
        const pilot = golfer.id === pilotId && source.handedness === "right" && index !== null;
        const support = pilot || reactionCue ? input.ground.sampleFootprintAt(root.x + .5, root.y + .5) : null;
        const validVisualRoot = support?.surfaceRevision === input.ground.surfaceRevision && support.supportedFootprint === true && support.inBounds === true && Number.isFinite(support.heightYards);
        // Physical root B remains the retained source. The visual holder and
        // initial grounded feet use independently sampled, same-XY G.
        const visualLaunch = validVisualRoot ? feetCopy({ x: root.x, y: root.y, heightYards: support!.heightYards }) : null;
        let local = locals.get(actorKey);
        if (!local || local.ownerKey !== ownerKey || local.surfaceRevision !== surfaceRevision) {
          local = { ownerKey, surfaceRevision: surfaceRevision!, binding: null, plant: null, locomotion: null, presentedFeet: null,
            late: !!source.playback && source.playback.cursor.elapsedMs > 100, pending: null };
          locals.set(actorKey, local);
        }
        let binding = local.binding, stanceIdentity = null, stanceFailure: string | null = null;
        if (pilot && source.playback && source.targetWorld && visualLaunch) {
          stanceIdentity = { owner: facts.owner, authorityRevision: facts.authorityRevision, surfaceRevision: input.ground.surfaceRevision,
            targetWorld: source.targetWorld, handedness: source.handedness, modelVersion: NATURAL_GOLFER_CONTACT_MODEL.modelVersion, role: source.playback.plan.kind };
          if (!binding && !reactionCue) {
            const candidate = createGolferStanceBinding({ identity: stanceIdentity, launch: root, visualGroundLaunch: visualLaunch, ground: input.ground, artIndex: index });
            if (candidate.kind === "candidate") {
              binding = candidate.binding; local.binding = binding;
              if (!local.presentedFeet) local.late = source.playback.cursor.elapsedMs > 100;
            } else stanceFailure = candidate.reason;
          } else if (binding) {
            const current = sampleGolferStance(binding, { currentIdentity: stanceIdentity, launch: root, visualGroundLaunch: visualLaunch, ground: input.ground,
              rotation: input.rotation, phase: "address", actualFeet: null, arrival: null, previousPlant: null, walking: null, acquisition: "continuous", paused: false, hidden: false });
            if (current.kind !== "neutral" || current.reason !== "arrival-proof-required") {
              stanceFailure = current.kind === "neutral" ? current.reason : "invalid-binding"; binding = null;
            }
          }
        }
        let locomotion = null, nextPlant = local.plant, feet = pilot ? visualLaunch ?? root : root;
        let naturalClip: "walk" | "idle" | "swing" | "putt" | "positive" | "negative" = "idle", col = 0;
        let direction = naturalGolferWorldView(source.facingWorld ?? { x: golfer.dirX, y: golfer.dirY }, input.rotation)?.direction ?? "s";
        let geometry: NaturalGolferRuntimeFrame<T>["contactGeometry"] = null;
        if (reactionCue) {
          // A reaction can hold an already verified F plant; it cannot acquire
          // a stance/arrival or turn visual-neutral acknowledgement into proof.
          feet = local.presentedFeet ?? visualLaunch ?? root; nextPlant = null;
          if (pilot && binding && stanceIdentity && local.plant) {
            const held = sampleGolferStance(binding, { currentIdentity: stanceIdentity, launch: root, visualGroundLaunch: visualLaunch!, ground: input.ground, rotation: input.rotation, phase: "watch",
              actualFeet: local.presentedFeet, arrival: null, previousPlant: local.plant, walking: null,
              acquisition: local.late ? "late-acquisition" : "continuous", paused: input.paused, hidden: input.hidden });
            if (held.kind === "planted") {
              nextPlant = held.nextPlant; feet = binding.feet; frame = { ...frame, plantKey: binding.key };
              // Only a verified held stance proves the target+90 body facing.
              // Unplanted/visual-neutral bodies retain their current source facing.
              direction = naturalGolferWorldView({ x: -binding.targetWorld.y, y: binding.targetWorld.x }, input.rotation)?.direction ?? direction;
            }
          }
        } else if (pilot && binding && stanceIdentity && source.playback && local.late && !sameFeet(local.presentedFeet, binding.feet)) {
          // New/revealed family starts with a neutral supported initial pose.
          // Only the scene's subsequent presentation acknowledgement proves F.
          feet = binding.feet; frame = { ...frame, reason: "settled-initial-awaiting-presentation" };
          direction = naturalGolferWorldView({ x: -source.targetWorld!.y, y: source.targetWorld!.x }, input.rotation)?.direction ?? direction;
        } else if (pilot && binding && !local.presentedFeet) {
          // A computed G is not an observation. The complete admitted native
          // frame must actually be applied before starting the bounded sweep.
          feet = visualLaunch!; frame = { ...frame, reason: "ground-launch-awaiting-presentation" };
        } else {
          locomotion = projectGolferLocomotion({ owner: facts.owner, currentOwner: facts.currentOwner, authorityRevision: facts.authorityRevision,
            currentAuthorityRevision: facts.currentAuthorityRevision, surfaceRevision: input.ground.surfaceRevision, root, visualGroundLaunch: binding ? visualLaunch! : undefined,
            actualFeet: binding ? local.presentedFeet ?? root : root, live: source, stance: pilot && binding && stanceIdentity && source.playback ? { binding, identity: stanceIdentity, playback: source.playback } : null,
            ground: input.ground, presentationTimeMs: input.presentationTimeMs, paused: input.paused, hidden: input.hidden, culled: false,
            acquisition: local.late && binding ? "late-acquisition" : "continuous", motionEnabled: input.motionEnabled, rotation: input.rotation,
            quality: input.quality, operatingTier: input.operatingTier }, local.locomotion);
          feet = locomotion.kind === "neutral" && pilot ? visualLaunch ?? root : locomotion.feet ?? root;
          frame = { ...frame, reason: locomotion.reason ?? frame.reason, fastForward: locomotion.fastForward };
          const heldGait = locomotion.reason === "held" && ["walk", "adjust"].includes(locomotion.nextState?.mode ?? "");
          if (locomotion.kind === "walk" || locomotion.kind === "adjust" || heldGait) { naturalClip = "walk"; col = locomotion.strideFrame; }
          if (locomotion.kind === "walk" || heldGait && locomotion.nextState?.mode === "walk") frame = { ...frame, legacyPose: { anim: "walk", ...octantRow(facing), col: locomotion.strideFrame } };
          if (pilot && binding && stanceIdentity && (locomotion.arrival || local.plant)) {
            const phase = ["contact", "backswing", "follow-through"].includes(frame.phase) ? "strike" : frame.phase === "watch" ? "watch" : "address";
            const plant = sampleGolferStance(binding, { currentIdentity: stanceIdentity, launch: root, visualGroundLaunch: visualLaunch!, ground: input.ground, rotation: input.rotation, phase,
              actualFeet: feet, arrival: locomotion.arrival, previousPlant: local.plant, walking: null,
              acquisition: local.late ? "late-acquisition" : "continuous", paused: input.paused, hidden: input.hidden });
            if (plant.kind === "planted") {
              nextPlant = plant.nextPlant; feet = binding.feet;
              const canGrip = projection.pose.fallbackReason === null && facts.equipmentClass !== null;
              if (canGrip) {
                direction = plant.geometry.targetDirection; naturalClip = binding.role;
                col = frame.phase === "watch" ? binding.role === "putt" ? 3 : 7 : projection.pose.clipId.startsWith("natural-golfer-v1/") ? projection.pose.col : 0;
                geometry = { actualTip: plant.geometry.actualTip, datum: plant.geometry.contactDatum, residualPx: plant.geometry.residualPx };
                frame = { ...frame, plantKey: binding.key, contact: col === (binding.role === "putt" ? 2 : 5) };
              } else {
                naturalClip = "idle"; col = 0;
                if (facts.equipmentClass === null) frame = { ...frame, reason: "unknown-equipment" };
                direction = naturalGolferWorldView({ x: -source.targetWorld!.y, y: source.targetWorld!.x }, input.rotation)?.direction ?? direction;
              }
            } else { nextPlant = null; naturalClip = "idle"; col = 0; frame = { ...frame, reason: plant.kind === "neutral" ? plant.reason : "released" }; }
          }
        }
        const arrivalEligible = !pilot || validVisualRoot && (!source.playback || !!binding);
        if (pilot && !arrivalEligible) {
          // Unsupported physical contact retains a native neutral G identity.
          // This domain cannot seed arrival or repair retained physical B.
          local.presentedFeet = null; local.locomotion = null; local.plant = null; local.binding = null; local.late = true;
          locomotion = null; nextPlant = null; geometry = null;
          naturalClip = "idle"; col = 0;
          frame = { ...frame, phase: "watch", contact: false, plantKey: null, contactGeometry: null,
            reason: validVisualRoot ? `native-neutral-${stanceFailure ?? "unplanted"}` : "unsupported-visual-ground" };
          if (visualLaunch) feet = visualLaunch;
        }
        if (reactionCue && validVisualRoot) {
          naturalClip = facts.outcome!.result === "bad" ? "negative" : "positive"; col = 1;
          frame = { ...frame, phase: "reaction", contact: false, contactGeometry: null };
          // Legacy reaction art has only an authored front view. Other current
          // views remain neutral rather than rotate or mirror a new reaction.
          if (facing === 2) frame = { ...frame, legacyPose: { anim: facts.outcome!.result === "bad" ? "mad" : "cheer", row: 0, col: facts.outcome!.result === "bad" ? 3 : 0, mirror: false } };
        } else if (frame.phase === "reaction") frame = { ...frame, phase: "watch", contact: false, plantKey: null, contactGeometry: null };
        if (pilot && borrowed && validVisualRoot) {
          const pair = borrowed.lookup({ selection: NATURAL_GOLFER_PILOT_SELECTION, clip: naturalClip, direction, col, handedness: source.handedness });
          if (pair.kind === "pair" && (!reactionCue || (pair.frame.clip === naturalClip && pair.frame.col === 1 && pair.frame.direction === direction
            && pair.frame.directionRole === "facing" && !pair.frame.contact && !pair.frame.mirror))) {
            const base = tileCenterIso(root.x, root.y, support!.heightYards / ELEVATION_STEP_YARDS, input.rotation), foot = tileCenterIso(feet.x, feet.y, feet.heightYards / ELEVATION_STEP_YARDS, input.rotation);
            frame = { ...frame, natural: { pair, feet, footDomain: arrivalEligible ? "arrival-eligible" : "visual-neutral",
              physicalRootHeightYards: source.root.heightYards, visualRootHeightYards: support!.heightYards,
              localOffset: Object.freeze({ x: foot.x - base.x, y: foot.y - base.y }), depth: Math.round(entityDepth(feet.x, feet.y, feet.heightYards / ELEVATION_STEP_YARDS, input.rotation) * 10) / 10 }, contactGeometry: geometry };
          } else frame = { ...frame, reason: pair.kind === "pair" ? "unverified-static-reaction-frame" : pair.reason };
        }
        if (!frame.natural) frame = { ...frame, contact: false, plantKey: null, contactGeometry: null };
        else if (!frame.contact) frame = { ...frame, contactGeometry: null };
        const published = Object.freeze(frame); local.pending = published;
        const observedEligible = arrivalEligible && (!pilot || !!frame.natural);
        publications.set(published, { actorKey, local, feet: observedEligible ? feetCopy(frame.natural ? feet : root) : null,
          locomotion: observedEligible ? locomotion?.nextState ?? null : null, plant: observedEligible && frame.natural ? nextPlant : null });
        output.set(golfer.id, published);
      }
      for (const id of locals.keys()) if (!retainedIds.has(id)) locals.delete(id);
      return Object.freeze({ live: output, controlled: controlledFrame });
    },
    /** Scene calls only AFTER the complete pair/legacy fallback was applied. */
    observePresented(frame: NaturalGolferRuntimeFrame<T>): void {
      const observed = publications.get(frame);
      if (!observed || observed.local.pending !== frame || locals.get(observed.actorKey) !== observed.local) return;
      if (observed.feet === null) {
        observed.local.presentedFeet = null; observed.local.locomotion = null; observed.local.plant = null; observed.local.binding = null;
        observed.local.late = true; observed.local.pending = null; return;
      }
      observed.local.presentedFeet = observed.feet; observed.local.locomotion = observed.locomotion; observed.local.plant = observed.plant;
      observed.local.pending = null;
      if (observed.plant || !observed.local.binding) observed.local.late = false;
    },
    observeControlledPresented(frame: ControlledGolferRuntimeFrame): void {
      const local = controlledPublications.get(frame);
      if (!local || local.pending !== frame || locals.get(frame.actorKey) !== local) return;
      local.presentedLegacy = frame.legacyPose; local.pending = null;
    },
    diagnostics(): NaturalGolferRuntimeDiagnostics { return Object.freeze({ pilotId, scopeId, records: records.length, localRecords: locals.size,
      foreground: records.filter(r => r.foreground).length, pending: 0, reactionRecords: reactionState?.records.length ?? 0, eligibleReactions: reactionState?.records.filter(r => r.active).length ?? 0, surfaceRevision, atlas: atlas()?.snapshot() ?? null, legacyAtlasAlsoResident: true }); },
    clearLive(): void { dropLive(); },
    clear(): void { dropLive(); locals.clear(); controlledKey = null; records = []; reactionState = null; scopeId = null; pilotId = null; selectedPilot = false; surfaceRevision = null; visibilityEpoch = null; lastTime = -1; },
  };
}
