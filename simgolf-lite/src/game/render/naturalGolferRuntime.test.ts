import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createLiveActivitySource, focusedLiveActivitySource, liveActivityScope } from "../live/activitySource";
import { createGolferCapabilities, stableGolferHandedness } from "../live/capabilities";
import { advanceShotPacingCursor, createShotPacingCursor, createShotPacingPlan, shotPacingFrame } from "../live/shotPacing";
import type { GolferRenderData, Segment } from "../live/types";
import type { SharedShotOutcome } from "../rules/contracts";
import { captureGolferReactionSource, observeGolferReactionSource } from "./golferReactionSource";
import type { ShotMotionIdentityV1 } from "../rules/shotMotion";
import type { Course } from "../models/types";
import { createRetainedShotMotion, sampleRetainedShotMotion } from "../rules/shotMotion";
import { resolveObstacleCollision } from "../rules/obstacleCollision";
import type { NaturalGolferAtlas, NaturalGolferTextureLookup } from "../../render/naturalGolferAtlas";
import type { NaturalGolferArtRequest } from "./naturalGolferArt";
import { createLiveGolferGroundAuthority } from "./golferGroundAuthority";
import { ISO_ROTATIONS, tileCenterIso } from "./iso";
import { NATURAL_GOLFER_DIRECTIONS, parseNaturalGolferArt, resolveNaturalGolferArt } from "./naturalGolferArt";
import { createNaturalGolferRuntime, naturalGolferCandidateEnabled, naturalGolferVerificationJSON } from "./naturalGolferRuntime";
import type { NaturalGolferRuntimeInput } from "./naturalGolferRuntime";
import { NATURAL_GOLFER_ACTIVITY_POLICY, golferActivityOwnerKey, projectGolferActivity } from "./golferActivity";

const parsed = parseNaturalGolferArt(JSON.parse(readFileSync(new URL("../../../art/natural-golfer-v1/manifest.json", import.meta.url), "utf8")), JSON.parse(readFileSync(new URL("../../../art/natural-golfer-v1/cost.json", import.meta.url), "utf8")));
if (!parsed.ok) throw new Error(parsed.reason);
const index = parsed.index;
const course: Course = { name: "Candidate flat course", width: 32, height: 32, tiles: new Array(1024).fill("fairway"), elevations: new Array(1024).fill(0), holes: [], obstacles: [], buildings: [], yardsPerTile: 10, baseGreenFee: 50, condition: 1 };
const ground = (surfaceRevision = "ground:1", elevation = 0) => createLiveGolferGroundAuthority({ course, effectiveTiles: course.tiles,
  field: { width: 32, height: 32, vertices: new Float32Array(1089).fill(elevation) }, componentsByCell: new Array(1024).fill(null), quality: "high", surfaceRevision });
const personality = { skill: .6, consistency: .6, patience: .5, spendPropensity: .5, prefs: { difficulty: 0, scenery: 0, price: 0 } };
const rightSeed = Array.from({ length: 20 }, (_, i) => i).find(n => stableGolferHandedness(n) === "right")!;
const leftSeed = Array.from({ length: 1000 }, (_, i) => i).find(n => stableGolferHandedness(n) === "left")!;
const scope = (epoch = 0) => liveActivityScope({ dayIndex: 2, seed: 42, reconcileEpoch: epoch, dayOver: false }, { runSeed: 17, week: 1 })!;
function atlasFixture() {
  const state = { ready: true, missing: false }, shadow = { id: "shadow", destroy: vi.fn() };
  type FakeTexture = { id: string; destroy: ReturnType<typeof vi.fn> };
  const atlas: NaturalGolferAtlas<FakeTexture> = {
    load: vi.fn(async () => ({ status: "ready" as const, generation: 0, reason: null })), reset: vi.fn(() => 1), dispose: vi.fn(),
    snapshot: () => ({ status: state.ready ? "ready" : "loading", generation: 0, reason: null, pairCount: state.ready ? 224 : 0,
      atlasTextureCount: state.ready ? 448 : 0, ownedSourceCount: state.ready ? 2 : 0, cleanupErrors: 0, totalRuntimeBytesIncludingCostReceipt: state.ready ? 443726 : null }),
    artIndex: () => state.ready ? index : null,
    lookup: vi.fn((request: NaturalGolferArtRequest): NaturalGolferTextureLookup<FakeTexture> => {
      if (!state.ready || state.missing) return { kind: "unavailable", generation: 0, neutral: "non-gripping", reason: "atlas-not-ready" };
      const r = resolveNaturalGolferArt(index, request); if (r.kind !== "frame") return r;
      return { kind: "pair", generation: 0, frame: r.frame, base: { id: `${r.frame.id}.base`, destroy: vi.fn() }, tint: { id: `${r.frame.id}.tint`, destroy: vi.fn() }, shadow,
        bodyUnitScale: 26 / 48, shadowPlacement: { unitScale: 1, worldOffset: [1.5, .8], alphaBaked: true }, coverage: r.coverage };
    }),
  };
  return { state, atlas };
}
function actor(id = 7, x = 12, epoch = 0, left = false): GolferRenderData {
  const segment: Segment = { kind: "walk", from: { x: 12, y: 12 }, to: { x: 20, y: 12 }, dur: 8, holeIndex: 0,
    mobility: { requestedMode: "walk", resolvedMode: "walk", minutesSaved: 0, offPathTiles: 0 } };
  const source = createLiveActivitySource(scope(epoch), { id, pos: { x, y: 12 }, segIndex: 0, segElapsed: x - 12, finished: false,
    capabilities: createGolferCapabilities({ personality, seed: left ? leftSeed : rightSeed }) }, segment)!;
  return { id, x, y: 12, ballX: null, ballY: null, ballToX: null, ballToY: null, color: "#ff0000", mood: .7, thought: null, archetype: "casual",
    segKind: "walk", segT: (x - 12) / 8, shot: null, dirX: 1, dirY: 0, scoredHoles: 0, lastHoleDelta: 0, activitySource: source };
}
function shot(kind: "swing" | "putt" = "swing", degrees = 0, epoch = 0, options: { actorId?: number; identity?: Partial<ShotMotionIdentityV1>; holed?: boolean } = {}) {
  const id = options.actorId ?? 7;
  const a = degrees * Math.PI / 180, from = { x: 12, y: 12 }, landing = { x: 12 + 2 * Math.cos(a), y: 12 + 2 * Math.sin(a) }, rest = { x: 12 + 3 * Math.cos(a), y: 12 + 3 * Math.sin(a) };
  const at = (point: { x: number; y: number }) => ({ point, heightYards: 0 });
  const flight = kind === "putt" ? null : resolveObstacleCollision({ from, to: landing, flight: { profile: "standard", apexHeightYards: 4 }, width: 32, height: 32, yardsPerTile: 10, elevations: course.elevations, obstacles: [], retainGeometry: true }).retained!;
  const motion = createRetainedShotMotion({ identity: { shotId: "shot:1", holeId: "hole:1", shotNumber: 1, seed: 42, club: kind === "putt" ? "Putter" : "7 Iron", style: "normal", modelVersion: "physical_shot_v1", ...options.identity },
    yardsPerTile: 10, from: at(from), landing: at(kind === "putt" ? from : landing), physicalRest: at(rest), flight, rollPath: [at(kind === "putt" ? from : landing), at(rest)], holed: options.holed ?? false })!;
  const plan = createShotPacingPlan({ scopeId: scope(epoch).id!, actorId: String(id), motion, distanceYards: 30 })!;
  const base = createLiveActivitySource(scope(epoch), { id, pos: from, segIndex: 1, segElapsed: .1, finished: false,
    capabilities: createGolferCapabilities({ personality, seed: rightSeed }) }, { kind: "flight", from, to: rest, dur: 2, holeIndex: 0 })!;
  const atCursor = (elapsedMs: number): GolferRenderData => {
    const cursor = createShotPacingCursor(plan, { version: 1, key: plan.key, elapsedMs }), frame = shotPacingFrame(plan, cursor)!;
    const source = focusedLiveActivitySource(base, { actorId: id, segmentIndex: 1, segmentElapsed: .1, plan, cursor, frame, identity: motion.identity,
      origin: motion.from, target: kind === "putt" ? rest : landing }, true)!;
    return { ...actor(id), segKind: "flight", shot: kind, segT: frame.motionProgress, activitySource: source };
  };
  return { plan, motion, at: atCursor };
}

type ReactionCase = "good" | "bad" | "exceptional" | "hole-out" | "unknown" | "relief" | "aggregate";
function evidencedShot(result: ReactionCase = "good", options: { kind?: "swing" | "putt"; actorId?: number; identity?: Partial<ShotMotionIdentityV1>; epoch?: number; degrees?: number } = {}) {
  const s = shot(options.kind, options.degrees, options.epoch, { ...options, holed: result === "hole-out" });
  const token = {}, sourceToken = {}, owner = { scopeId: s.plan.scopeId, actorId: s.plan.actorId, shot: s.plan.identity };
  const rest = s.motion.physicalRest.point, pin = { x: rest.x + (result === "exceptional" || result === "hole-out" ? 0 : 1), y: rest.y };
  const greenCourse = { ...course, tiles: course.tiles.map((v, i) => Math.abs(i % 32 - rest.x) <= 2 && Math.abs(Math.floor(i / 32) - rest.y) <= 2 ? "green" : v) };
  const shared: SharedShotOutcome = { rulesVersion: 1, lieEffect: { sourceLie: "fairway", effectiveLie: "fairway", carryMultiplier: 1, dispersionMultiplier: 1, rollMultiplier: 1 },
    requestedCarryYards: 20, effectiveCarryYards: 20, requestedDispersionTiles: 1, effectiveDispersionTiles: 1,
    flight: { profile: "standard", launchAngleDegrees: 1, apexHeightYards: 4, apexPosition: { x: 13, y: 12 }, carryEnd: s.motion.landing.point, clearance: [] },
    collision: { kind: "none" }, physicalRest: rest, ruling: { status: result === "hole-out" || result === "aggregate" ? "holed" : result === "bad" ? "penalty" : "in_play",
      penaltyKind: result === "bad" ? "out_of_bounds" : "none", penaltyStrokes: result === "bad" ? 1 : 0, penaltyComponentId: null, penaltyAreaClassification: null, referencePoint: null, crossingPoint: null },
    relief: { status: result === "relief" ? "resolved" : "not_required", type: result === "relief" ? "lateral" : "none", candidates: [], selectedCandidateId: null, finalPosition: rest }, finalPosition: rest, motion: s.motion };
  captureGolferReactionSource(token, { owner, authorityRevision: s.plan.scopeId, plan: s.plan, initialCursor: createShotPacingCursor(s.plan), motion: s.motion, distanceYards: 30,
    source: sourceToken, courseSource: greenCourse, handedness: "right", sharedOutcome: result === "unknown" ? null : shared,
    originalAim: { course: greenCourse, holeId: s.plan.identity.holeId, pin, from: s.motion.from.point, target: rest } });
  return { ...s, at(elapsedMs: number) {
    const g = s.at(elapsedMs), p = g.activitySource!.playback!;
    const c = observeGolferReactionSource(token, { owner, currentOwner: owner, authorityRevision: s.plan.scopeId, currentAuthorityRevision: s.plan.scopeId,
      ...p, motion: s.motion, position: sampleRetainedShotMotion(s.motion, p.frame.motionProgress)!, source: sourceToken, courseSource: greenCourse, handedness: "right", ownerCurrent: true });
    return { ...g, dirX: 1, dirY: 1, activitySource: Object.freeze({ ...g.activitySource!, ...(c ? { reactionClassification: c } : {}) }) };
  } };
}

function input(golfers: readonly GolferRenderData[], time = 0, patch: Partial<NaturalGolferRuntimeInput> = {}): NaturalGolferRuntimeInput {
  return { golfers, ground: ground(), visibleIds: new Set(golfers.map(g => g.id)), rotation: 0, presentationTimeMs: time, paused: false, hidden: false, visibilityEpoch: 0,
    motionEnabled: true, quality: "high", operatingTier: 1, followedId: 7, ...patch };
}
function setup() { const f = atlasFixture(); return { ...f, runtime: createNaturalGolferRuntime(() => f.atlas) }; }
function present(f: ReturnType<typeof setup>, req: NaturalGolferRuntimeInput) {
  const frames = f.runtime.tickLive(req); for (const frame of frames.values()) f.runtime.observePresented(frame); return frames;
}
function reach(f: ReturnType<typeof setup>, s: ReturnType<typeof shot>, target: number, patch: Partial<NaturalGolferRuntimeInput> = {}) {
  let cursor = createShotPacingCursor(s.plan), result = present(f, input([s.at(0)], 0, patch)).get(7)!;
  while (cursor.elapsedMs < target) { cursor = advanceShotPacingCursor(s.plan, cursor, Math.min(1000 / 60, target - cursor.elapsedMs))!;
    result = present(f, input([s.at(cursor.elapsedMs)], cursor.elapsedMs, patch)).get(7)!; }
  return result;
}

describe("one opt-in LIVE pilot and accepted shared presentation store", () => {
  it("requires explicit DEV opt-in and never loads or disposes a borrowed atlas", () => {
    expect(naturalGolferCandidateEnabled(false, "?naturalGolfers=1")).toBe(false); expect(naturalGolferCandidateEnabled(true, "")).toBe(false);
    expect(naturalGolferCandidateEnabled(true, "?naturalGolfers=1")).toBe(true);
    const f = setup(); present(f, input([actor()])); f.runtime.clear();
    expect(f.atlas.load).not.toHaveBeenCalled(); expect(f.atlas.dispose).not.toHaveBeenCalled();
  });
  it("keeps one stable known-right pilot through sorting, retirement and empty periods in the same day scope", () => {
    const f = setup(); const frames = present(f, input([actor(9), actor(1, 12, 0, true), actor(7)]));
    expect(f.runtime.diagnostics().pilotId).toBe(7); expect(frames.get(7)?.natural).not.toBeNull(); expect(frames.get(9)?.natural).toBeNull(); expect(frames.get(1)?.natural).toBeNull();
    present(f, input([], 10)); present(f, input([actor(3)], 20)); expect(f.runtime.diagnostics().pilotId).toBe(7);
    present(f, input([actor(3, 12, 1)], 30)); expect(f.runtime.diagnostics().pilotId).toBe(3);
  });
  it.each(["high", "medium", "low"] as const)("admits actual %s counts for 100 actors, one foreground, no pending queue", quality => {
    const f = setup(), golfers = Array.from({ length: 100 }, (_, i) => actor(i + 1));
    const first = present(f, input(golfers, 0, { quality, followedId: 100 }));
    expect(first.size).toBe(100); expect([...first.values()].filter(v => v.natural)).toHaveLength(1);
    expect(f.runtime.diagnostics()).toMatchObject({ records: quality === "high" ? 16 : quality === "medium" ? 8 : 4, pending: 0, foreground: 0 });
    expect(f.runtime.diagnostics().localRecords).toBe(f.runtime.diagnostics().records);
    expect(first.get(100)?.reason).not.toBe("activity-cap");
  });
  it("uses distance gait, no riding or paused gait, and stable current-authority fast-forward at 4x", () => {
    const f = setup(); present(f, input([actor()]));
    const walk = present(f, input([actor(7, 12.25)], 500)).get(7)!; expect(walk.legacyPose.anim).toBe("walk"); expect(walk.natural?.pair.frame.clip).toBe("walk");
    const held = present(f, input([actor(7, 12.25)], 100000, { paused: true })).get(7)!; expect(held.natural?.feet).toEqual(walk.natural?.feet); expect(held.natural?.pair.frame.id).toBe(walk.natural?.pair.frame.id);
    const fast = present(f, input([actor(7, 14)], 100100, { operatingTier: 4 })).get(7)!; expect(fast.fastForward).toBe(true); expect(fast.natural?.feet.x).toBe(14); expect(fast.natural?.pair.frame.clip).toBe("idle");
    const riding = actor(7, 14); riding.activitySource = { ...riding.activitySource!, movement: { ...riding.activitySource!.movement!, onFoot: false, resolvedMode: "riding_cart" } };
    expect(present(f, input([riding], 100200)).get(7)?.natural?.pair.frame.clip).toBe("idle");
  });
  it("keeps unsupported/aggregate/no-cursor shots neutral and suppresses legacy hole reactions", () => {
    const f = setup(), g = { ...actor(), segKind: "pause" as const, shot: "putt" as const, scoredHoles: 1, lastHoleDelta: -2 };
    g.activitySource = { ...g.activitySource!, movement: null, segment: { ...g.activitySource!.segment!, kind: "pause" } };
    const result = present(f, input([g])).get(7)!; expect(result.natural?.pair.frame.clip).toBe("idle"); expect(result.contact).toBe(false); expect(result.legacyPose.anim).toBe("idle");
    expect(result.plantKey).toBeNull();
  });
  it("rejects another actor's or invalidated scope metadata before pilot selection and admission", () => {
    for (const variant of ["actor", "revision", "root", "inactive"] as const) {
      const f = setup(), g = actor();
      g.activitySource = { ...g.activitySource!, ...(variant === "actor" ? { owner: { ...g.activitySource!.owner, actorId: "other" } } : {}),
        ...(variant === "revision" ? { authorityRevision: "stale" } : {}), ...(variant === "root" ? { root: { ...g.activitySource!.root, x: 1 } } : {}),
        ...(variant === "inactive" ? { scope: { ...g.activitySource!.scope, active: false } } : {}) };
      expect(present(f, input([g])).get(7)).toMatchObject({ natural: null, contact: false, reason: "unsupported-current-source" });
      expect(f.runtime.diagnostics()).toMatchObject({ pilotId: null, records: 0, localRecords: 0 });
    }
  });
  it("expires history at 10 seconds while reacquiring the same native current pose without a legacy flash", () => {
    const f = setup(), g = actor(), before = structuredClone(g); present(f, input([g], 0));
    for (const time of [10000, 10001, 10002, 20002]) {
      const frame = present(f, input([g], time)).get(7)!;
      expect(frame.natural?.pair.frame.clip).toBe("idle"); expect(frame.natural?.feet).toEqual({ x: 12, y: 12, heightYards: 0 });
      expect(frame.contact).toBe(false); expect(frame.plantKey).toBeNull(); expect(frame.reason).not.toBe("retention-expired");
      if (time === 10001 || time === 20002) expect(frame.reason).toBe("first-observation");
      expect(f.runtime.diagnostics()).toMatchObject({ records: 1, localRecords: 1, pending: 0 });
    }
    expect(g).toEqual(before);
  });
  it("serializes only bounded detached verification values for the DEV DOM output", () => {
    const source = { pilotId: 7, surfaceRevision: "ground:1", privateSource: { secret: "excluded", callback: () => 1 },
      atlas: { status: "ready", reason: null, generation: 1, pairCount: 224, atlasTextureCount: 448, ownedSourceCount: 2, source: { private: "excluded" } },
      body: { family: "natural-golfer-v1", frame: "primary.swing.se.5", phase: "contact", feet: { x: 1, y: 2, heightYards: 5 }, holder: { x: -32, y: 32 }, localOffset: { x: 1, y: 2 },
        contact: true, cursorMs: 1200, geometry: { actualTip: { x: -32, y: 31.45 }, datum: { x: -32, y: 31.45 }, residualPx: 0 }, ownerKey: "excluded", texture: { private: "excluded" } } };
    const before = structuredClone({ ...source, privateSource: null }), text = naturalGolferVerificationJSON(source), snapshot = JSON.parse(text);
    expect(snapshot).toMatchObject({ pilotId: 7, family: "natural-golfer-v1", frame: "primary.swing.se.5", contact: { active: true, cursorMs: 1200, residualPx: 0 }, atlas: { status: "ready", pairs: 224, sources: 2 }, groundRevision: "ground:1" });
    expect(text).not.toContain("excluded"); expect(text).not.toContain("ownerKey"); expect(text.length).toBeLessThan(2000);
    expect({ ...source, privateSource: null }).toEqual(before);
    expect(JSON.parse(naturalGolferVerificationJSON(null))).toMatchObject({ pilotId: null, family: null, feet: null, contact: { active: null, actualTip: null }, atlas: { status: null } });
  });
});

describe("actual shared cursor, supported arrival and camera-locked contact", () => {
  it.each((["swing", "putt"] as const).flatMap(kind => [-.001, 0, .001].map(offset => [kind, offset] as const)))("keeps %s height-mismatched launch %+f native-neutral through repeated acknowledgements", (kind, offset) => {
    const f = setup(), s = shot(kind), target = s.plan.addressMs + s.plan.contactMs + offset, g = s.at(target), before = structuredClone(g), raised = ground("raised:1", 1);
    for (let i = 0; i < 4; i++) {
      const frame = present(f, input([g], target + i, { ground: raised, rotation: ISO_ROTATIONS[i] })).get(7)!;
      expect(frame.natural).toMatchObject({ footDomain: "visual-neutral", feet: { x: 12, y: 12, heightYards: 2.5 }, localOffset: { x: 0, y: 0 }, physicalRootHeightYards: 0, visualRootHeightYards: 2.5 });
      expect(frame.natural?.pair.frame).toMatchObject({ clip: "idle", col: 0 });
      expect(frame).toMatchObject({ phase: "watch", reason: "native-neutral-height", contact: false, plantKey: null, contactGeometry: null });
      expect(f.runtime.diagnostics()).toMatchObject({ records: 1, localRecords: 1, pending: 0 });
    }
    expect(g).toEqual(before); expect(g.activitySource!.root.heightYards).toBe(0);
  });
  it("never promotes visual-neutral acknowledgement into arrival when ground becomes matching", () => {
    const f = setup(), s = shot(), launch = s.plan.addressMs + s.plan.contactMs, g = s.at(launch + .001);
    const raised = ground("same-query-domain", 1), matching = ground("same-query-domain", 0);
    let fallback = present(f, input([g], 2000, { ground: raised })).get(7)!;
    for (let i = 1; i < 4; i++) fallback = present(f, input([g], 2000 + i, { ground: raised })).get(7)!;
    expect(fallback.natural?.footDomain).toBe("visual-neutral");
    const fresh = f.runtime.tickLive(input([g], 2004, { ground: matching })).get(7)!;
    expect(fresh.natural?.footDomain).toBe("arrival-eligible"); expect(fresh.natural?.pair.frame.clip).toBe("idle"); expect(fresh.plantKey).toBeNull();
    f.runtime.observePresented(fallback);
    const stillUnobserved = f.runtime.tickLive(input([g], 2005, { ground: matching })).get(7)!;
    expect(stillUnobserved.natural?.pair.frame.clip).toBe("idle"); expect(stillUnobserved.plantKey).toBeNull();
    f.runtime.observePresented(fresh); // Superseded presentation cannot prove arrival either.
    const current = f.runtime.tickLive(input([g], 2006, { ground: matching })).get(7)!;
    expect(current.plantKey).toBeNull(); f.runtime.observePresented(current);
    const arrived = f.runtime.tickLive(input([g], 2007, { ground: matching })).get(7)!;
    expect(arrived.natural?.pair.frame).toMatchObject({ clip: "swing", col: 6 }); expect(arrived.plantKey).not.toBeNull(); expect(arrived.contact).toBe(false);
  });
  it("retains neutral-domain separation through pause/reveal/owner/surface changes and rejects all invalid visual support", () => {
    const f = setup(), s = shot(), g = s.at(1200), raised = ground("raised:1", 1);
    const first = present(f, input([g], 1200, { ground: raised })).get(7)!;
    expect(present(f, input([g], 100000, { ground: raised, paused: true })).get(7)?.natural?.footDomain).toBe("visual-neutral");
    expect(present(f, input([g], 100001, { ground: raised, hidden: true })).get(7)?.natural).toBeNull();
    expect(present(f, input([g], 100002, { ground: raised, visibleIds: new Set() })).get(7)?.natural).toBeNull();
    const changed = shot("swing", 0, 1).at(1200);
    const replaced = present(f, input([changed], 100003, { ground: ground("raised:2", 2), visibilityEpoch: 2 })).get(7)!;
    expect(replaced.natural).toMatchObject({ footDomain: "visual-neutral", feet: { heightYards: 5 } }); expect(replaced.plantKey).toBeNull();
    f.runtime.observePresented(first); expect(f.runtime.diagnostics().records).toBe(1);
    for (const variant of ["unsupported", "bounds", "height", "revision"] as const) {
      const h = setup(), valid = raised.sampleFootprintAt;
      const invalid = { ...raised, sampleFootprintAt: (x: number, y: number) => ({ ...valid(x, y), ...(variant === "unsupported" ? { supportedFootprint: false } : {}),
        ...(variant === "bounds" ? { inBounds: false } : {}), ...(variant === "height" ? { heightYards: NaN } : {}), ...(variant === "revision" ? { surfaceRevision: "stale" } : {}) }) };
      expect(present(h, input([g], 1200, { ground: invalid })).get(7)?.natural).toBeNull();
    }
    const wrong = { ...g, activitySource: { ...g.activitySource!, owner: { ...g.activitySource!.owner, actorId: "wrong" } } };
    expect(present(f, input([wrong], 100004, { ground: raised })).get(7)?.natural).toBeNull();
  });
  it("cannot bypass shared admission caps with the visual-neutral fallback", () => {
    const f = setup();
    for (let i = 0; i < 4; i++) {
      const owner = { scopeId: "external-scope", actorId: String(i), shot: null };
      const projection = projectGolferActivity(NATURAL_GOLFER_ACTIVITY_POLICY, { version: 1, owner, currentOwner: owner, authorityRevision: "external:1", currentAuthorityRevision: "external:1",
        root: { horizontal: "tiles", vertical: "yards", x: 1, y: 1, heightYards: 0 }, facingOctant: 0, targetOctant: null, handedness: null, equipmentClass: null, movement: null, playback: null,
        outcome: null, clips: [], mode: "overview", followExplicit: false, visibility: "visible", quality: "low", motionEnabled: true, paused: false, hidden: false, discontinuity: "none", presentationTimeMs: 1200 });
      expect(f.runtime.admitExternalActivity(projection, 1200).nextState).not.toBeNull();
    }
    const frame = present(f, input([shot().at(1200)], 1200, { ground: ground("raised:1", 1), quality: "low" })).get(7)!;
    expect(frame).toMatchObject({ natural: null, reason: "activity-cap", contact: false, plantKey: null });
    expect(f.runtime.diagnostics()).toMatchObject({ records: 4, localRecords: 0 });
  });
  it.each((["swing", "putt"] as const).flatMap(kind => [-.001, 0, .001].map(offset => [kind, offset] as const)))("samples actual %s launch %+f without moving or changing retained facts", (kind, offset) => {
    const f = setup(), s = shot(kind), target = s.plan.addressMs + s.plan.contactMs + offset, before = JSON.stringify(s.motion);
    const frame = reach(f, s, target); expect(frame.natural?.pair.frame.clip).toBe(kind); expect(frame.contact).toBe(offset === 0);
    expect(frame.natural?.pair.frame.col).toBe(offset < 0 ? kind === "putt" ? 1 : 4 : offset === 0 ? kind === "putt" ? 2 : 5 : kind === "putt" ? 3 : 6);
    expect(frame.plantKey).not.toBeNull(); if (offset === 0) expect(frame.contactGeometry!.residualPx).toBeLessThan(.5); else expect(frame.contactGeometry).toBeNull(); expect(JSON.stringify(s.motion)).toBe(before);
  });
  it.each(Array.from({ length: 8 }, (_, i) => i * 45))("locks world feet for target %d across four rotations and preserves contact overlap", degrees => {
    const f = setup(), s = shot("swing", degrees), launch = s.plan.addressMs + s.plan.contactMs;
    const first = reach(f, s, launch), feet = first.natural!.feet;
    for (const rotation of ISO_ROTATIONS) {
      const next = present(f, input([s.at(launch)], launch, { rotation })).get(7)!;
      expect(next.natural?.feet).toEqual(feet); expect(next.natural?.pair.frame.direction).toBe(NATURAL_GOLFER_DIRECTIONS[((degrees - rotation + 360) / 45 + 7) % 8]);
      const tip = next.contactGeometry!.actualTip, root = tileCenterIso(12, 12, 0, rotation);
      expect(Math.hypot(tip.x - root.x, tip.y - (root.y - 2))).toBeLessThan(2.2); expect(next.contactGeometry?.residualPx).toBeLessThan(.5);
    }
  });
  it("does not certify projected-but-unpresented feet and holds the authored finish through watch", () => {
    const f = setup(), s = shot(); let frame = f.runtime.tickLive(input([s.at(0)])).get(7)!;
    for (let t = 100; t <= 1200; t += 100) frame = f.runtime.tickLive(input([s.at(t)], t)).get(7)!;
    expect(frame.contact).toBe(false); expect(frame.plantKey).toBeNull(); expect(frame.natural?.pair.frame.clip).toBe("idle");
    const good = setup(), watched = reach(good, s, 2000); expect(watched.natural?.pair.frame.clip).toBe("swing"); expect(watched.natural?.pair.frame.col).toBe(7);
    const held = present(good, input([s.at(2000)], 200000, { paused: true })).get(7)!;
    expect(held.natural?.pair.frame.id).toBe(watched.natural?.pair.frame.id); expect(held.natural?.feet).toEqual(watched.natural?.feet);
  });
  it("waits for actual acknowledgement after late atlas/reveal initialization; no historical action replay", () => {
    const f = setup(), s = shot(); f.state.ready = false; present(f, input([s.at(2000)], 2000));
    f.state.ready = true;
    const initial = present(f, input([s.at(2000)], 2001)).get(7)!; expect(initial.natural?.pair.frame.clip).toBe("idle"); expect(initial.plantKey).toBeNull();
    const settled = present(f, input([s.at(2000)], 2002)).get(7)!; expect(settled.natural?.pair.frame.clip).toBe("swing"); expect(settled.natural?.pair.frame.col).toBe(7);
    present(f, input([s.at(2000)], 2003, { visibleIds: new Set() }));
    const revealed = present(f, input([s.at(2000)], 2004)).get(7)!; expect(revealed.contact).toBe(false); expect(revealed.plantKey).toBeNull();
    const epoch = present(f, input([s.at(2000)], 2005, { visibilityEpoch: 2 })).get(7)!; expect(epoch.plantKey).toBeNull();
  });
  it("discards owner, surface, retirement, follow and reload state before a hold; releases to observed current walking only", () => {
    const f = setup(), s = shot(); reach(f, s, 2000);
    const surface = present(f, input([s.at(2000)], 2001, { ground: ground("ground:2"), paused: true })).get(7)!; expect(surface.plantKey).toBeNull();
    const noFollow = present(f, input([s.at(2000)], 2002, { followedId: null })).get(7)!; expect(noFollow.plantKey).toBeNull(); expect(noFollow.contact).toBe(false);
    const walking = present(f, input([actor(7, 12.05)], 2100)).get(7)!; expect(walking.natural?.feet.x).toBe(12.05); expect(walking.plantKey).toBeNull();
    present(f, input([], 2200)); expect(f.runtime.diagnostics()).toMatchObject({ records: 0, localRecords: 0 });
  });
  it("cannot publish a gripping frame when the complete texture lookup becomes unavailable", () => {
    const f = setup(), s = shot(); reach(f, s, 1100); f.state.missing = true;
    const frame = present(f, input([s.at(1200)], 1200)).get(7)!;
    expect(frame.natural).toBeNull(); expect(frame.contact).toBe(false); expect(frame.legacyPose.anim).toBe("idle"); expect(frame.plantKey).toBeNull();
  });
  it("never displays a future finish on paused late acquisition or grips with unknown equipment", () => {
    const f = setup(), s = shot();
    present(f, input([s.at(700)], 700, { paused: true }));
    const held = present(f, input([s.at(700)], 701, { paused: true })).get(7)!;
    expect(held.natural?.pair.frame.clip).toBe("idle"); expect(held.contact).toBe(false); expect(held.plantKey).toBeNull();
    const resumed = present(f, input([s.at(700)], 702)).get(7)!; expect(resumed.natural?.pair.frame.clip).toBe("swing"); expect(resumed.natural?.pair.frame.col).toBe(0);
    const unknown = s.at(2000); unknown.activitySource = { ...unknown.activitySource!, equipmentClass: null };
    const g = setup(); present(g, input([unknown], 2000));
    expect(present(g, input([unknown], 2001)).get(7)?.natural?.pair.frame.clip).toBe("idle");
  });
});

describe("LIVE observed static reaction consumer", () => {
  it.each((["good", "bad", "exceptional", "hole-out"] as const).flatMap(result => ["swing", "putt"].map(kind => [result, kind] as const)))("consumes evidenced%s %s only in shared last600ms", (result, kind) => {
    const f = setup(), s = evidencedShot(result, { kind: kind as "swing" | "putt" }), endpoint = s.plan.durationMs - s.plan.restMs, start = s.plan.durationMs - 600;
    reach(f, s, endpoint - .001);
    expect(present(f, input([s.at(endpoint)], endpoint)).get(7)!.natural!.pair.frame.clip).not.toMatch(/positive|negative/u);
    expect(present(f, input([s.at(start - .001)], start - .001)).get(7)!.phase).not.toBe("reaction");
    const cue = present(f, input([s.at(start)], start)).get(7)!;
    const eligible = kind !== "putt" || result === "bad" || result === "hole-out";
    expect(cue.natural!.pair.frame.clip).toBe(eligible ? result === "bad" ? "negative" : "positive" : "putt");
    if (eligible) {
      expect(cue).toMatchObject({ phase: "reaction", contact: false, contactGeometry: null });
      expect(cue.natural!.pair.frame).toMatchObject({ col: 1, directionRole: "facing", mirror: false, contact: false });
      const held = present(f, input([s.at(start + 300)], start + 300)).get(7)!;
      expect(held.natural!.pair.frame.id).toBe(cue.natural!.pair.frame.id); expect(held.natural!.feet).toEqual(cue.natural!.feet); expect(held.plantKey).toBe(cue.plantKey);
    }
    expect(present(f, input([s.at(s.plan.durationMs)], s.plan.durationMs)).get(7)!.phase).not.toBe("reaction");
  });
  it.each(["unknown", "relief", "aggregate"] as const)("never grants a%s cue or a legacy lastHoleDelta override", result => {
    const f = setup(), s = evidencedShot(result), start = s.plan.durationMs - 600;
    present(f, input([s.at(0)], 0)); present(f, input([s.at(start - 1)], start - 1));
    const g = { ...s.at(start), scoredHoles: 2, lastHoleDelta: -3 }, before = structuredClone(g);
    const frame = present(f, input([g], start)).get(7)!;
    expect(frame.phase).not.toBe("reaction"); expect(frame.legacyPose.anim).toBe("idle"); expect(g).toEqual(before);
    expect(f.runtime.diagnostics().eligibleReactions).toBe(0);
  });
  it("holds verified F feet and maps target rows to the same actual facing in all rotations", () => {
    const f = setup(), s = evidencedShot("good"), start = s.plan.durationMs - 600;
    const watch = reach(f, s, start - 1), plant = watch.plantKey; expect(plant).not.toBeNull();
    for (const rotation of ISO_ROTATIONS) {
      const frame = present(f, input([s.at(start)], start, { rotation })).get(7)!;
      expect(frame.natural!.feet).toEqual(watch.natural!.feet); expect(frame.plantKey).toBe(plant); expect(frame.contact).toBe(false);
      // Swing target E means body faces N (+90 world degrees), authored facing SW at camera0.
      expect(frame.natural!.pair.frame.direction).toBe(NATURAL_GOLFER_DIRECTIONS[((90 - rotation + 360) / 45 + 7) % 8]);
    }
    const end = present(f, input([s.at(s.plan.durationMs)], s.plan.durationMs)).get(7)!;
    expect(end.natural!.pair.frame.clip).toBe("swing"); expect(end.natural!.pair.frame.direction).toBe("se");
    expect(end.natural!.feet).toEqual(watch.natural!.feet); expect(end.plantKey).toBe(plant); expect(end.contact).toBe(false);
  });
  it.each(ISO_ROTATIONS.flatMap(rotation => (["good", "bad"] as const).map(result => [rotation, result] as const)))("preserves visual-neutral source facing before/during/after%s %s reaction", (rotation, result) => {
    const f = setup(), s = evidencedShot(result), start = s.plan.durationMs - 600, raised = ground("neutral-facing", 1);
    const patch = { ground: raised, rotation };
    present(f, input([s.at(0)], 0, patch));
    const before = present(f, input([s.at(start - 1)], start - 1, patch)).get(7)!;
    const sourceFacing = NATURAL_GOLFER_DIRECTIONS[((45 - rotation + 360) / 45 + 7) % 8];
    expect(before.natural!.pair.frame.direction).toBe(sourceFacing);
    expect(before.natural!.pair.frame.clip).toBe("idle");
    for (const t of [start, start + 1, s.plan.durationMs]) {
      const g = s.at(t), sourceBefore = structuredClone(g), frame = present(f, input([g], t, patch)).get(7)!;
      expect(frame.natural!.pair.frame.direction).toBe(sourceFacing);
      expect(frame.natural!.pair.frame.clip).toBe(t < s.plan.durationMs ? result === "bad" ? "negative" : "positive" : "idle");
      expect(frame.natural!.feet).toEqual(before.natural!.feet); expect(frame.natural!.localOffset).toEqual({ x: 0, y: 0 });
      expect(frame.natural!.footDomain).toBe("visual-neutral"); expect(frame.plantKey).toBeNull(); expect(frame.contact).toBe(false); expect(g).toEqual(sourceBefore);
    }
  });
  it("allows visual-neutral G to react without acquiring stance, arrival or contact proof", () => {
    const f = setup(), s = evidencedShot("good"), start = s.plan.durationMs - 600, raised = ground("shared-query", 1);
    present(f, input([s.at(0)], 0, { ground: raised })); present(f, input([s.at(start - 1)], start - 1, { ground: raised }));
    for (let i = 0; i < 3; i++) {
      const frame = present(f, input([s.at(start + i)], start + i, { ground: raised })).get(7)!;
      expect(frame).toMatchObject({ phase: "reaction", plantKey: null, contact: false, contactGeometry: null });
      expect(frame.natural).toMatchObject({ footDomain: "visual-neutral", feet: { heightYards: 2.5 } });
      expect(frame.natural!.pair.frame.clip).toBe("positive");
    }
    const nowMatching = present(f, input([s.at(start + 3)], start + 3, { ground: ground("shared-query", 0) })).get(7)!;
    expect(nowMatching.plantKey).toBeNull(); expect(nowMatching.contact).toBe(false);
  });
  it("holds a paused valid cue and never renders one at Low or motion-off", () => {
    const f = setup(), s = evidencedShot("good"), start = s.plan.durationMs - 600;
    reach(f, s, start - 1); const cue = present(f, input([s.at(start)], start)).get(7)!;
    const paused = present(f, input([s.at(start)], 100000, { paused: true })).get(7)!;
    expect(paused.natural!.pair.frame.id).toBe(cue.natural!.pair.frame.id); expect(paused.natural!.feet).toEqual(cue.natural!.feet);
    expect(paused.plantKey).toBe(cue.plantKey);
    const disabled = present(f, input([s.at(start)], 100001, { paused: true, motionEnabled: false })).get(7)!;
    expect(disabled.natural!.pair.frame.clip).not.toMatch(/positive|negative/u);
    const low = present(f, input([s.at(start)], 100002, { quality: "low" })).get(7)!;
    expect(low.natural!.pair.frame.clip).not.toMatch(/positive|negative/u);
  });
  it.each(["late", "reveal", "hidden", "cull", "atlas", "surface", "retention", "skip"] as const)("discards%s without delayed replay", kind => {
    const f = setup(), s = evidencedShot("good"), start = s.plan.durationMs - 600;
    if (kind === "late") {
      expect(present(f, input([s.at(start)], start)).get(7)!.phase).not.toBe("reaction"); return;
    }
    reach(f, s, start - 1); expect(present(f, input([s.at(start)], start)).get(7)!.phase).toBe("reaction");
    if (kind === "atlas") f.state.ready = false;
    const patch: Partial<NaturalGolferRuntimeInput> = kind === "reveal" ? { visibilityEpoch: 1 } : kind === "hidden" ? { hidden: true } : kind === "cull" ? { visibleIds: new Set() } : kind === "surface" ? { ground: ground("new-ground") } : {};
    const time = kind === "retention" ? 20000 : start + 1;
    const elapsed = kind === "skip" ? s.plan.durationMs : start + 1;
    expect(present(f, input([s.at(elapsed)], time, patch)).get(7)!.phase).not.toBe("reaction");
    f.state.ready = true;
    const next = present(f, input([s.at(kind === "skip" ? s.plan.durationMs : start + 2)], time + 1, { ...patch, hidden: false, visibleIds: new Set([7]) })).get(7)!;
    expect(next.phase).not.toBe("reaction"); expect(next.contact).toBe(false);
  });
  it("keeps cooldown tombstones across follow changes/atlas reload and admits a new hole after expiry", () => {
    const f = setup(), a = evidencedShot("good"), start = a.plan.durationMs - 600;
    present(f, input([a.at(0)], 0)); present(f, input([a.at(start - 1)], 1000)); expect(present(f, input([a.at(start)], 1001)).get(7)!.phase).toBe("reaction");
    f.state.ready = false; present(f, input([], 1002)); f.state.ready = true; present(f, input([], 1003));
    const b = evidencedShot("good", { identity: { shotId: "two", shotNumber: 2 } });
    present(f, input([b.at(start - 1)], 2000)); expect(present(f, input([b.at(start)], 2001)).get(7)!.phase).not.toBe("reaction");
    expect(f.runtime.diagnostics().reactionRecords).toBe(1);
    const newHole = evidencedShot("good", { identity: { shotId: "new-hole", holeId: "hole:2", shotNumber: 1 } });
    present(f, input([newHole.at(start - 1)], 9000)); expect(present(f, input([newHole.at(start)], 9001)).get(7)!.phase).toBe("reaction");
  });
  it("drops former-follow raw metadata before overview ownership and preserves that actor cooldown", () => {
    const f = setup(), a = evidencedShot("good"), b = evidencedShot("good", { actorId: 9 }), start = a.plan.durationMs - 600;
    present(f, input([a.at(0)], 0)); present(f, input([a.at(start - 1)], 1000)); present(f, input([a.at(start)], 1001));
    const aRaw = a.at(start + 1), bBefore = b.at(start - 1);
    const switched = present(f, input([aRaw, bBefore], 1002, { followedId: 9 }));
    expect(switched.get(7)!.phase).not.toBe("reaction"); expect(switched.get(7)!.reason).not.toBe("outcome-owner-mismatch");
    expect(switched.get(7)!.ownerKey).toBe(golferActivityOwnerKey({ scopeId: scope().id!, actorId: "7", shot: null }));
    expect(present(f, input([aRaw, b.at(start)], 1003, { followedId: 9 })).get(9)!.phase).toBe("reaction");
    expect(present(f, input([a.at(start + 2), b.at(start + 1)], 1004)).get(7)!.phase).not.toBe("reaction");
    expect(f.runtime.diagnostics().reactionRecords).toBe(2);
  });
  it.each(["high", "medium", "low"] as const)("uses one current LIVE owner among100 rows with%s cap and no extra foreground", quality => {
    const f = setup(), sources = Array.from({ length: 100 }, (_, i) => evidencedShot("good", { actorId: i + 1 })), start = sources[0]!.plan.durationMs - 600;
    //99 old raw playbacks are deliberate reused-buffer fixtures, not authority to acquire them.
    present(f, input(sources.map(s => s.at(0)), 0, { followedId: 100, quality }));
    present(f, input(sources.map(s => s.at(start - 1)), 1000, { followedId: 100, quality }));
    const frames = present(f, input(sources.map(s => s.at(start)), 1001, { followedId: 100, quality }));
    expect([...frames.values()].filter(frame => frame.phase === "reaction")).toHaveLength(quality === "low" ? 0 : 1);
    expect(f.runtime.diagnostics()).toMatchObject({ reactionRecords: 1, eligibleReactions: quality === "low" ? 0 : 1, foreground: 1, pending: 0 });
    expect([...frames.values()].filter(frame => ["cheer", "mad"].includes(frame.legacyPose.anim))).toHaveLength(quality === "low" ? 0 : 1);
  });
  it("rejects stale revision/owner and fabricated classifications and never changes source/ball/gameplay facts", () => {
    for (const invalid of ["revision", "owner", "fabricated"] as const) {
      const f = setup(), s = evidencedShot("good"), start = s.plan.durationMs - 600;
      present(f, input([s.at(0)], 0)); present(f, input([s.at(start - 1)], 1000));
      const g = s.at(start), source = g.activitySource!;
      g.activitySource = invalid === "revision" ? { ...source, authorityRevision: "stale" } : invalid === "owner" ? { ...source, owner: { ...source.owner, actorId: "other" } } : { ...source, reactionClassification: structuredClone(source.reactionClassification!) };
      const before = structuredClone(g), rng = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("no RNG"); });
      try { expect(present(f, input([g], 1001)).get(7)!.phase).not.toBe("reaction"); expect(g).toEqual(before); } finally { rng.mockRestore(); }
    }
  });
});
