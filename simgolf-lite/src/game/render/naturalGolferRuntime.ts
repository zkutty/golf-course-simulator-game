import { clearFocusedLiveActivitySource } from "../live/activitySource";
import type { GolferRenderData } from "../live/types";
import { ELEVATION_STEP_YARDS } from "../rules/obstacleCollision";
import type { NaturalGolferAtlas, NaturalGolferTextureLookup } from "../../render/naturalGolferAtlas";
import { admitGolferActivity, golferActivityOwnerKey, NATURAL_GOLFER_ACTIVITY_POLICY, projectGolferActivity } from "./golferActivity";
import type { GolferActivityFacts, GolferActivityProjection, GolferActivityState } from "./golferActivity";
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
export interface NaturalGolferRuntimeDiagnostics {
  readonly pilotId: number | null; readonly scopeId: string | null; readonly records: number; readonly localRecords: number;
  readonly foreground: number; readonly pending: 0; readonly surfaceRevision: string | null;
  readonly atlas: ReturnType<NaturalGolferAtlas<unknown>["snapshot"]> | null;
  readonly legacyAtlasAlsoResident: true;
}
interface Local {
  ownerKey: string; surfaceRevision: string; binding: GolferStanceBinding | null; plant: GolferStancePlant | null;
  locomotion: GolferLocomotionState | null; presentedFeet: GolferStancePoint | null; late: boolean;
  pending: object | null;
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
/** One accepted admission store shared by LIVE and a later controlled borrower.
 * Never loads/disposes its borrowed atlas, advances a cursor, or owns authority. */
export function createNaturalGolferRuntime<T>(atlas: () => NaturalGolferAtlas<T> | null) {
  let records: readonly GolferActivityState[] = [], liveKeys = new Set<string>();
  let scopeId: string | null = null, pilotId: number | null = null, selectedPilot = false;
  let surfaceRevision: string | null = null, visibilityEpoch: number | null = null, lastTime = -1;
  let index: NaturalGolferArtIndex | null = null, clips = naturalGolferActivityClips(null, NATURAL_GOLFER_PILOT_SELECTION);
  const locals = new Map<number, Local>();
  const publications = new WeakMap<object, { local: Local; feet: GolferStancePoint | null; locomotion: GolferLocomotionState | null; plant: GolferStancePlant | null }>();
  const dropLive = () => { records = records.filter(r => !liveKeys.has(r.actorKey)); liveKeys.clear(); locals.clear(); };
  const admit = (projection: GolferActivityProjection, time: number) => {
    const result = admitGolferActivity(NATURAL_GOLFER_ACTIVITY_POLICY, records, projection, time); records = result.records; return result.projection;
  };
  return {
    /** Callers must use the SAME active timestamp and this store, never create a second cap domain. */
    admitExternalActivity: admit,
    tickLive(input: NaturalGolferRuntimeInput): ReadonlyMap<number, NaturalGolferRuntimeFrame<T>> {
      const borrowed = atlas(), nextIndex = borrowed?.artIndex() ?? null;
      const firstScope = input.golfers.find(currentSource)?.activitySource?.scope.id ?? null;
      if (firstScope !== null && firstScope !== scopeId) { dropLive(); scopeId = firstScope; pilotId = null; selectedPilot = false; }
      if (surfaceRevision !== input.ground.surfaceRevision || visibilityEpoch !== input.visibilityEpoch || input.presentationTimeMs < lastTime || nextIndex !== index) dropLive();
      surfaceRevision = input.ground.surfaceRevision; visibilityEpoch = input.visibilityEpoch; lastTime = input.presentationTimeMs;
      if (nextIndex !== index) { index = nextIndex; clips = naturalGolferActivityClips(index, NATURAL_GOLFER_PILOT_SELECTION); }
      if (!selectedPilot && scopeId) {
        const eligible = input.golfers.filter(g => currentSource(g) && g.activitySource!.scope.id === scopeId && g.activitySource!.handedness === "right").sort((a, b) => a.id - b.id);
        if (eligible[0]) { pilotId = eligible[0].id; selectedPilot = true; }
      }
      const previousRecords = new Map(records.map(r => [r.actorKey, r]));
      records = records.filter(r => !liveKeys.has(r.actorKey)); liveKeys = new Set();
      const output = new Map<number, NaturalGolferRuntimeFrame<T>>();
      const sorted = [...input.golfers].sort((a, b) => Number(b.id === input.followedId) - Number(a.id === input.followedId) || Number(b.id === pilotId) - Number(a.id === pilotId) || a.id - b.id);
      const prepared = sorted.map(golfer => {
        const raw = golfer.activitySource, followed = input.followedId === golfer.id;
        const source = !followed && raw?.playback ? clearFocusedLiveActivitySource(raw) : raw;
        if (!source || !currentSource(golfer) || !source.scope.id || source.scope.id !== scopeId) return { golfer, source: null, facts: null };
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
      // Retention expires HISTORY, not the selected visual family. Reacquire
      // current facts in the same tick with no old gait/plant/strike evidence.
      if (!input.paused) for (const row of prepared) {
        if (!row.facts) continue;
        const actor = keyActor(row.facts.owner.scopeId, row.facts.owner.actorId), previous = previousRecords.get(actor);
        if (previous && input.presentationTimeMs - previous.startedAtMs > NATURAL_GOLFER_ACTIVITY_POLICY.maxRetentionMs) {
          previousRecords.delete(actor); locals.delete(row.golfer.id);
        }
      }
      const previousActivity = (facts: GolferActivityFacts) => {
        const previous = previousRecords.get(keyActor(facts.owner.scopeId, facts.owner.actorId));
        const movementKey = facts.movement ? JSON.stringify([facts.movement.routeRevision, facts.movement.segmentId]) : null;
        // A newly observed legal leg invalidates old activity first. Fresh
        // projection is current-authority static/gait, never a queued route.
        return previous?.movementKey === movementKey ? previous : undefined;
      };
      // A valid paused owner keeps its slot. Rebuild from actual projections so
      // follow changes downgrade old foreground ownership before new admission.
      if (input.paused) for (const row of prepared) {
        if (!row.facts) continue;
        const prev = previousActivity(row.facts);
        if (prev) admit(projectGolferActivity(NATURAL_GOLFER_ACTIVITY_POLICY, row.facts, prev), input.presentationTimeMs);
      }
      const retainedIds = new Set<number>();
      for (const { golfer, source, facts } of prepared) {
        const facing = facts?.facingOctant ?? facingOctant(golfer.dirX, golfer.dirY, input.rotation);
        const legacy: GolferPose = { anim: "idle", ...octantRow(facing), col: 0 };
        let frame: NaturalGolferRuntimeFrame<T> = { actorId: golfer.id, ownerKey: facts ? golferActivityOwnerKey(facts.owner) : null, legacyPose: legacy, natural: null,
          phase: "watch", reason: "unsupported-current-source", fastForward: false, contact: false, plantKey: null, contactGeometry: null };
        if (!source || !facts) { output.set(golfer.id, Object.freeze(frame)); continue; }
        const projection = admit(projectGolferActivity(NATURAL_GOLFER_ACTIVITY_POLICY, facts, previousActivity(facts)), input.presentationTimeMs);
        frame = { ...frame, phase: projection.pose?.phase ?? "watch", reason: projection.reason };
        if (!projection.nextState || !projection.pose) { locals.delete(golfer.id); output.set(golfer.id, Object.freeze(frame)); continue; }
        retainedIds.add(golfer.id);
        const root = feetCopy({ x: facts.root.x, y: facts.root.y, heightYards: facts.root.heightYards }), ownerKey = projection.pose.ownerKey;
        let local = locals.get(golfer.id);
        if (!local || local.ownerKey !== ownerKey || local.surfaceRevision !== surfaceRevision) {
          const observed = local?.presentedFeet ?? null;
          local = { ownerKey, surfaceRevision: surfaceRevision!, binding: null, plant: null, locomotion: null, presentedFeet: sameFeet(observed, root) ? observed : null,
            late: !!facts.playback && facts.playback.cursor.elapsedMs > 100, pending: null };
          locals.set(golfer.id, local);
        }
        let binding = local.binding, stanceIdentity = null;
        const pilot = golfer.id === pilotId && source.handedness === "right" && index !== null;
        if (pilot && facts.playback && source.targetWorld) {
          stanceIdentity = { owner: facts.owner, authorityRevision: facts.authorityRevision, surfaceRevision: input.ground.surfaceRevision,
            targetWorld: source.targetWorld, handedness: source.handedness, modelVersion: NATURAL_GOLFER_CONTACT_MODEL.modelVersion, role: facts.playback.plan.kind };
          if (!binding) {
            const candidate = createGolferStanceBinding({ identity: stanceIdentity, launch: root, ground: input.ground, artIndex: index });
            if (candidate.kind === "candidate") { binding = candidate.binding; local.binding = binding; }
          }
        }
        let locomotion = null, nextPlant = local.plant, feet = root;
        let naturalClip: "walk" | "idle" | "swing" | "putt" = "idle", col = 0;
        let direction = naturalGolferWorldView(source.facingWorld ?? { x: golfer.dirX, y: golfer.dirY }, input.rotation)?.direction ?? "s";
        let geometry: NaturalGolferRuntimeFrame<T>["contactGeometry"] = null;
        if (pilot && binding && stanceIdentity && facts.playback && local.late && !sameFeet(local.presentedFeet, binding.feet)) {
          // New/revealed family starts with a neutral supported initial pose.
          // Only the scene's subsequent presentation acknowledgement proves F.
          feet = binding.feet; frame = { ...frame, reason: "settled-initial-awaiting-presentation" };
          direction = naturalGolferWorldView({ x: -source.targetWorld!.y, y: source.targetWorld!.x }, input.rotation)?.direction ?? direction;
        } else {
          locomotion = projectGolferLocomotion({ owner: facts.owner, currentOwner: facts.currentOwner, authorityRevision: facts.authorityRevision,
            currentAuthorityRevision: facts.currentAuthorityRevision, surfaceRevision: input.ground.surfaceRevision, root,
            actualFeet: binding ? local.presentedFeet ?? root : root, live: source, stance: pilot && binding && stanceIdentity && facts.playback ? { binding, identity: stanceIdentity, playback: facts.playback } : null,
            ground: input.ground, presentationTimeMs: input.presentationTimeMs, paused: input.paused, hidden: input.hidden, culled: false,
            acquisition: local.late && binding ? "late-acquisition" : "continuous", motionEnabled: input.motionEnabled, rotation: input.rotation,
            quality: input.quality, operatingTier: input.operatingTier }, local.locomotion);
          feet = locomotion.feet ?? root;
          frame = { ...frame, reason: locomotion.reason ?? frame.reason, fastForward: locomotion.fastForward };
          const heldGait = locomotion.reason === "held" && ["walk", "adjust"].includes(locomotion.nextState?.mode ?? "");
          if (locomotion.kind === "walk" || locomotion.kind === "adjust" || heldGait) { naturalClip = "walk"; col = locomotion.strideFrame; }
          if (locomotion.kind === "walk" || heldGait && locomotion.nextState?.mode === "walk") frame = { ...frame, legacyPose: { anim: "walk", ...octantRow(facing), col: locomotion.strideFrame } };
          if (pilot && binding && stanceIdentity && (locomotion.arrival || local.plant)) {
            const phase = ["contact", "backswing", "follow-through"].includes(frame.phase) ? "strike" : frame.phase === "watch" ? "watch" : "address";
            const plant = sampleGolferStance(binding, { currentIdentity: stanceIdentity, launch: root, ground: input.ground, rotation: input.rotation, phase,
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
        const support = pilot ? input.ground.sampleFootprintAt(root.x + .5, root.y + .5) : null;
        const validVisualRoot = support?.surfaceRevision === input.ground.surfaceRevision && support.supportedFootprint === true && support.inBounds === true && Number.isFinite(support.heightYards);
        const matchingRoot = validVisualRoot && Math.abs(support!.heightYards - root.heightYards) < 1e-7;
        const arrivalEligible = !pilot || matchingRoot;
        if (pilot && !matchingRoot) {
          // Visual neutral B is a separate domain. It cannot seed a later
          // arrival, preserve a plant, or repair the retained launch height.
          local.presentedFeet = null; local.locomotion = null; local.plant = null; local.binding = null; local.late = true;
          locomotion = null; nextPlant = null; geometry = null;
          naturalClip = "idle"; col = 0;
          frame = { ...frame, phase: "watch", contact: false, plantKey: null, contactGeometry: null,
            reason: validVisualRoot ? "native-neutral-height" : "unsupported-visual-ground" };
          if (validVisualRoot) feet = feetCopy({ x: root.x, y: root.y, heightYards: support!.heightYards });
        }
        if (pilot && borrowed && validVisualRoot) {
          const pair = borrowed.lookup({ selection: NATURAL_GOLFER_PILOT_SELECTION, clip: naturalClip, direction, col, handedness: source.handedness });
          if (pair.kind === "pair") {
            const base = tileCenterIso(root.x, root.y, support!.heightYards / ELEVATION_STEP_YARDS, input.rotation), foot = tileCenterIso(feet.x, feet.y, feet.heightYards / ELEVATION_STEP_YARDS, input.rotation);
            frame = { ...frame, natural: { pair, feet, footDomain: matchingRoot ? "arrival-eligible" : "visual-neutral",
              physicalRootHeightYards: source.root.heightYards, visualRootHeightYards: support!.heightYards,
              localOffset: Object.freeze({ x: foot.x - base.x, y: foot.y - base.y }), depth: Math.round(entityDepth(feet.x, feet.y, feet.heightYards / ELEVATION_STEP_YARDS, input.rotation) * 10) / 10 }, contactGeometry: geometry };
          } else frame = { ...frame, reason: pair.reason };
        }
        if (!frame.natural) frame = { ...frame, contact: false, plantKey: null, contactGeometry: null };
        else if (!frame.contact) frame = { ...frame, contactGeometry: null };
        const published = Object.freeze(frame); local.pending = published;
        publications.set(published, { local, feet: arrivalEligible ? feetCopy(frame.natural ? feet : root) : null,
          locomotion: arrivalEligible ? locomotion?.nextState ?? null : null, plant: arrivalEligible && frame.natural ? nextPlant : null });
        output.set(golfer.id, published);
      }
      for (const id of locals.keys()) if (!retainedIds.has(id)) locals.delete(id);
      return output;
    },
    /** Scene calls only AFTER the complete pair/legacy fallback was applied. */
    observePresented(frame: NaturalGolferRuntimeFrame<T>): void {
      const observed = publications.get(frame);
      if (!observed || observed.local.pending !== frame || locals.get(frame.actorId) !== observed.local) return;
      if (observed.feet === null) {
        observed.local.presentedFeet = null; observed.local.locomotion = null; observed.local.plant = null; observed.local.binding = null;
        observed.local.late = true; observed.local.pending = null; return;
      }
      observed.local.presentedFeet = observed.feet; observed.local.locomotion = observed.locomotion; observed.local.plant = observed.plant;
      observed.local.pending = null;
      if (observed.plant || !observed.local.binding) observed.local.late = false;
    },
    diagnostics(): NaturalGolferRuntimeDiagnostics { return Object.freeze({ pilotId, scopeId, records: records.length, localRecords: locals.size,
      foreground: records.filter(r => r.foreground).length, pending: 0, surfaceRevision, atlas: atlas()?.snapshot() ?? null, legacyAtlasAlsoResident: true }); },
    clear(): void { dropLive(); records = []; scopeId = null; pilotId = null; selectedPilot = false; surfaceRevision = null; visibilityEpoch = null; lastTime = -1; },
  };
}
