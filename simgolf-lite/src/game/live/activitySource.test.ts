import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import type { Course } from "../models/types";
import { createRetainedShotMotion } from "../rules/shotMotion";
import { createGolferCapabilities, stableGolferHandedness } from "./capabilities";
import { acquireFocusedShot, focusedShotMatches, projectFocusedShot, type FocusedShotOwner } from "./focusedShot";
import { createLiveState, liveRenderData } from "./simulation";
import { shotPacingFrame } from "./shotPacing";
import { createLiveActivitySource, focusedLiveActivitySource, liveActivityScope, type FocusedActivityPublication } from "./activitySource";
import type { Golfer, Segment } from "./types";

function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function fixture(kind?: "swing" | "putt") {
  const course: Course = { name: "Carrier Links", width: 12, height: 12, tiles: new Array(144).fill("fairway"), elevations: new Array(144).fill(0),
    holes: [{ tee: { x: 2, y: 2 }, green: { x: 8, y: 2 }, parMode: "AUTO" }], obstacles: [], buildings: [], yardsPerTile: 10, baseGreenFee: 65, condition: .8 };
  const world = structuredClone(DEFAULT_WORLD), live = createLiveState(course, world, 0);
  const personality = { skill: .6, consistency: .6, patience: .5, spendPropensity: .5, prefs: { difficulty: 0, scenery: 0, price: 0 } };
  const capabilities = createGolferCapabilities({ personality, seed: 42 });
  const walk: Segment = { kind: "walk", from: { x: 1, y: 2 }, to: { x: 5, y: 2 }, dur: 2, holeIndex: 0, holeId: "hole:1",
    mobility: { requestedMode: "walk", resolvedMode: "walk", minutesSaved: 0, offPathTiles: 0 } };
  const golfer: Golfer = { id: 7, name: "Test", archetype: "casual", personality, color: "#397e82", segments: [walk], segIndex: 0, segElapsed: 1,
    pos: { x: 3, y: 2 }, ball: null, holePar: [4], holeStrokes: [4], scoredHoles: 0, currentHole: 0, strokes: 0, scoreToPar: 0,
    mood: 60, thought: null, thoughtUntil: 0, finished: false, spent: 0, wallet: 50, purchasedSegmentIndexes: [], capabilities };
  live.golfers = [golfer];
  if (kind) {
    const at = (x: number) => ({ point: { x, y: 2 }, heightYards: 7.5 });
    const motion = createRetainedShotMotion({ identity: { shotId: "shot:1", holeId: "hole:1", shotNumber: 1, seed: 42, club: kind === "putt" ? "Putter" : "Driver", style: kind === "putt" ? "putt" : "straight_run", modelVersion: "club_styles_v1" },
      yardsPerTile: 10, from: at(2), landing: at(2), physicalRest: at(6), flight: null, rollPath: [at(2), at(6)], reliefPosition: null, holed: false })!;
    expect(motion).not.toBeNull();
    golfer.segments = [{ kind: "flight", from: motion.from.point, to: motion.physicalRest.point, dur: 1.5, holeIndex: 0, holeId: "hole:1", shot: kind, shotId: motion.identity.shotId, motion }];
    golfer.pos = { ...motion.from.point }; golfer.ball = { ...motion.from.point }; golfer.segElapsed = .2;
  }
  return { course, world, live, golfer };
}
function publication(owner: FocusedShotOwner): FocusedActivityPublication {
  return { actorId: owner.golferId, segmentIndex: owner.segmentIndex, segmentElapsed: owner.segmentElapsed, plan: owner.plan, cursor: owner.cursor,
    frame: shotPacingFrame(owner.plan, owner.cursor)!, identity: owner.motion.identity, origin: owner.motion.from,
    target: owner.motion.flight?.geometry.to ?? owner.motion.groundPath[1]?.point ?? null };
}

describe("transient LIVE activity source", () => {
  it("publishes every ordinary actor's current root and actual leg without a shot, cursor, or outcome", () => {
    const f = fixture();
    f.live.golfers = Array.from({ length: 100 }, (_, i) => ({ ...f.golfer, id: i + 1 }));
    const before = structuredClone(f.live), render = liveRenderData(freeze(f.live), [], freeze(f.world));
    expect(render).toHaveLength(100);
    for (const row of render) {
      const source = row.activitySource!;
      expect(source).toMatchObject({ version: 1, owner: { actorId: String(row.id), shot: null }, root: { horizontal: "tiles", x: 3, y: 2, heightYards: null },
        movement: { source: "current-itinerary-leg", from: { x: 1, y: 2 }, to: { x: 5, y: 2 }, distanceTiles: 2, resolvedMode: "walk", onFoot: true }, facingWorld: { x: 1, y: 0 }, targetWorld: null, playback: null, equipmentClass: null });
      expect(JSON.stringify(source).length).toBeLessThan(1600);
      expect(Object.isFrozen(source.root)).toBe(true);
      expect(source.movement?.from).not.toBe(f.golfer.segments[0].from);
      expect(source.handedness).toBe(stableGolferHandedness(f.golfer.capabilities!.seed));
    }
    expect(f.live).toEqual(before);
  });

  it("keeps facing independent of future targets and clears walking on stop, retirement, or riding", () => {
    const f = fixture();
    const buffer = liveRenderData(f.live, [], f.world), first = buffer[0].activitySource!;
    f.golfer.segments.push({ kind: "flight", from: { x: 5, y: 2 }, to: { x: 5, y: 8 }, dur: 1, holeIndex: 0, shot: "swing" });
    expect(liveRenderData(f.live, buffer, f.world)[0].activitySource?.targetWorld).toBeNull();
    f.golfer.segments[0] = { ...f.golfer.segments[0], kind: "pause" };
    const stopped = liveRenderData(f.live, buffer, f.world)[0].activitySource!;
    expect(stopped.movement).toBeNull(); expect(stopped.facingWorld).toBeNull(); expect(stopped.owner.shot).toBeNull();
    expect(first.movement?.distanceTiles).toBe(2);
    f.golfer.segments[0] = { ...f.golfer.segments[0], kind: "walk", mobility: { requestedMode: "riding_cart", resolvedMode: "riding_cart", minutesSaved: 1, offPathTiles: 0 } };
    expect(liveRenderData(f.live, buffer, f.world)[0].activitySource?.movement).toMatchObject({ resolvedMode: "riding_cart", onFoot: false });
    f.golfer.segments[0].mobility!.resolvedMode = "walk";
    expect(liveRenderData(f.live, buffer, f.world)[0].activitySource?.movement).toMatchObject({ requestedMode: "riding_cart", resolvedMode: "walk", onFoot: true });
    f.golfer.finished = true;
    expect(liveRenderData(f.live, buffer, f.world)[0].activitySource).toMatchObject({ active: false, movement: null, playback: null });
  });

  it("preserves legacy unknowns and refuses malformed or off-leg movement instead of inventing evidence", () => {
    const f = fixture(); f.golfer.capabilities = undefined; f.golfer.segments[0].mobility = undefined;
    const source = liveRenderData(f.live)[0].activitySource!;
    expect(source.scope.id).toBeNull(); expect(source.scope.week).toBeNull(); expect(source.handedness).toBeNull();
    expect(source.movement).toMatchObject({ resolvedMode: null, requestedMode: null, onFoot: null });
    f.golfer.pos = { x: 3, y: 3 };
    expect(liveRenderData(f.live)[0].activitySource?.movement).toBeNull();
    f.golfer.pos.x = NaN;
    expect(liveRenderData(f.live)[0].activitySource).toBeNull();
  });

  it.each(["swing", "putt"] as const)("%s carries the actual shared cursor at launch±epsilon without changing legacy contact behavior", (kind) => {
    const f = fixture(kind), owner = acquireFocusedShot(f.live, f.world, f.golfer.id)!;
    const launch = owner.plan.addressMs + owner.plan.contactMs;
    const before = structuredClone(f.live);
    freeze(f.live); freeze(f.world);
    for (const t of [launch - .001, launch, launch + .001]) {
      owner.cursor = { version: 1, key: owner.plan.key, elapsedMs: t };
      const render = liveRenderData(f.live, [], f.world), overview = render[0].activitySource!;
      expect(overview.playback).toBeNull(); expect(overview.owner.shot).toBeNull();
      projectFocusedShot(owner, render, focusedShotMatches(owner, f.live, f.world, f.golfer.id));
      const source = render[0].activitySource!;
      expect(source.playback?.cursor).toEqual(owner.cursor);
      expect(source.playback?.frame).toEqual(shotPacingFrame(owner.plan, owner.cursor));
      expect(source.playback?.plan).toEqual(owner.plan);
      expect(source.root).toMatchObject({ x: owner.motion.from.point.x, y: owner.motion.from.point.y, heightYards: 7.5 });
      expect(source.targetWorld).toEqual({ x: 1, y: 0 }); expect(source.facingWorld).toBeNull();
      expect(source.playback!.plan).not.toBe(owner.plan); expect(source.owner.shot).not.toBe(owner.motion.identity);
      expect(source.playback!.cursor).not.toBe(owner.cursor); expect(source.playback!.retainedEvidence.key).toBe(owner.plan.key);
      expect(render[0].segKind).toBe(t < launch ? "pause" : "flight");
      if (t < launch) { expect(render[0].segT).toBe(1); expect(source.playback!.frame.motionProgress).toBe(0); }
      if (t === launch) expect(source.playback!.frame.motionProgress).toBe(0);
      if (t > launch) expect(source.playback!.frame.motionProgress).toBeGreaterThan(0);
    }
    expect(f.live).toEqual(before);
  });

  it("refreshes and clears focused carriers in reused render buffers without retaining the owner graph", () => {
    const f = fixture("swing"), owner = acquireFocusedShot(f.live, f.world, f.golfer.id)!;
    const render = liveRenderData(f.live, [], f.world);
    projectFocusedShot(owner, render, focusedShotMatches(owner, f.live, f.world, f.golfer.id));
    const first = render[0].activitySource!;
    owner.cursor = { ...owner.cursor, elapsedMs: owner.plan.addressMs + owner.plan.contactMs };
    projectFocusedShot(owner, render, focusedShotMatches(owner, f.live, f.world, f.golfer.id));
    expect(render[0].activitySource?.playback?.cursor.elapsedMs).toBe(owner.cursor.elapsedMs);
    expect(first.playback?.cursor.elapsedMs).toBe(0);
    projectFocusedShot(owner, render, false);
    expect(render[0].activitySource).toMatchObject({ owner: { shot: null }, playback: null, targetWorld: null, equipmentClass: null });
    expect(JSON.stringify(first)).not.toContain("golfers");
    expect(JSON.stringify(first)).not.toContain("segments");
    expect(Object.keys(first.playback!)).toEqual(["plan", "cursor", "frame", "retainedEvidence"]);
    expect(first.playback!.plan).not.toHaveProperty("live"); expect(first.playback!.plan).not.toHaveProperty("motion");
    liveRenderData(f.live, render, f.world);
    expect(render[0].activitySource?.playback).toBeNull();
    projectFocusedShot(owner, render);
    expect(render[0].activitySource?.playback).toBeNull(); // No implicit ownership proof for legacy callers.
  });

  it.each(["invalid-cursor-false", "invalid-cursor-default", "invalid-cursor-current", "invalid-pose-false", "invalid-pose-default", "invalid-pose-current"] as const)("clears prior focused metadata before rejecting%s in a reused buffer", (failure) => {
    const f = fixture("swing"), owner = acquireFocusedShot(f.live, f.world, f.golfer.id)!;
    const render = liveRenderData(f.live, [], f.world), base = render[0].activitySource!;
    projectFocusedShot(owner, render, true);
    expect(render[0].activitySource).toMatchObject({ equipmentClass: "driver", root: { heightYards: 7.5 } });
    expect(render[0].activitySource!.playback).not.toBeNull();
    const { activitySource: _source, ...legacyBefore } = structuredClone(render[0]);
    if (failure.startsWith("invalid-cursor")) owner.cursor = { ...owner.cursor, key: "invalid-owner" };
    else owner.motion.groundPath = [];
    if (failure.endsWith("default")) projectFocusedShot(owner, render);
    else projectFocusedShot(owner, render, failure.endsWith("current"));
    expect(render[0].activitySource).toEqual(base);
    expect(render[0].activitySource).toMatchObject({ playback: null, owner: { shot: null }, targetWorld: null, equipmentClass: null, root: { heightYards: null } });
    const { activitySource: _after, ...legacyAfter } = render[0];
    expect(legacyAfter).toEqual(legacyBefore);
  });

  it("copies only primitive point coordinates without retaining nested objects or closures", () => {
    const f = fixture(), nested = { mutable: 1 }, callback = () => f.live;
    const from = { ...f.golfer.segments[0].from, nested, callback };
    const to = { ...f.golfer.segments[0].to, nested, callback };
    f.golfer.segments[0] = { ...f.golfer.segments[0], from, to };
    const before = { ...nested }, source = liveRenderData(f.live, [], f.world)[0].activitySource!;
    expect(Object.keys(source.movement!.from)).toEqual(["x", "y"]);
    expect(Object.keys(source.movement!.to)).toEqual(["x", "y"]);
    expect(source.movement!.from).not.toBe(from); expect(source.movement!.to).not.toBe(to);
    expect(source.movement!.from).not.toHaveProperty("nested"); expect(source.movement!.to).not.toHaveProperty("callback");
    expect(nested).toEqual(before); expect(Object.isFrozen(nested)).toBe(false);
    nested.mutable = 2; from.x = 100; to.y = 100;
    expect(source.movement!.from).toEqual({ x: 1, y: 2 }); expect(source.movement!.to).toEqual({ x: 5, y: 2 });
  });

  it("rejects every changed retained identity field and scope/segment/root replacement at publication", () => {
    const f = fixture("swing"), owner = acquireFocusedShot(f.live, f.world, f.golfer.id)!;
    const base = liveRenderData(f.live, [], f.world)[0].activitySource!, p = publication(owner);
    for (const field of Object.keys(p.identity) as (keyof typeof p.identity)[]) {
      const changed = { ...p.identity } as Record<string, string | number>;
      changed[field] = typeof changed[field] === "number" ? (changed[field] as number) + 1 : `${changed[field]}:new`;
      expect(focusedLiveActivitySource(base, { ...p, identity: changed as unknown as typeof p.identity }, true)?.playback).toBeNull();
    }
    for (const state of [{ ...f.live, dayIndex: f.live.dayIndex + 1 }, { ...f.live, reconcileEpoch: f.live.reconcileEpoch + 1 }, { ...f.live, seed: f.live.seed + 1 }, { ...f.live, dayOver: true }]) {
      expect(focusedLiveActivitySource(liveRenderData(state, [], f.world)[0].activitySource, p, true)?.playback).toBeNull();
    }
    for (const world of [{ ...f.world, week: f.world.week + 1 }, { ...f.world, runSeed: (f.world.runSeed ?? 0) + 1 }]) {
      expect(focusedLiveActivitySource(liveRenderData(f.live, [], world)[0].activitySource, p, true)?.playback).toBeNull();
    }
    expect(focusedLiveActivitySource(base, { ...p, segmentIndex: p.segmentIndex + 1 }, true)?.playback).toBeNull();
    expect(focusedLiveActivitySource(base, { ...p, origin: { ...p.origin, point: { x: 3, y: 2 } } }, true)?.playback).toBeNull();
    expect(focusedLiveActivitySource(base, p, false)?.playback).toBeNull();
  });

  it("uses the same physics capability seed and exact current leg while keeping unknown equipment null", () => {
    const f = fixture();
    for (const seed of [0, 1, 42, 0xffffffff]) {
      f.golfer.capabilities = { ...f.golfer.capabilities!, seed };
      expect(liveRenderData(f.live, [], f.world)[0].activitySource?.handedness).toBe(stableGolferHandedness(seed));
    }
    const scope = liveActivityScope(f.live, f.world)!;
    const source = createLiveActivitySource(scope, f.golfer, f.golfer.segments[0], "riding_cart")!;
    expect(source.movement?.resolvedMode).toBe("walk");
    expect(source.equipmentClass).toBeNull();
    expect(liveActivityScope(f.live, { week: NaN })).toBeNull();
  });

  it.each([["3 Wood", null], ["Chip", null], ["7 Iron", "iron"], ["Sand Wedge", "wedge"]] as const)("maps only the exact retained club%s to equipment%s", (club, expected) => {
    const f = fixture("swing"); f.golfer.segments[0].motion!.identity.club = club;
    const owner = acquireFocusedShot(f.live, f.world, f.golfer.id)!;
    const render = liveRenderData(f.live, [], f.world);
    projectFocusedShot(owner, render, focusedShotMatches(owner, f.live, f.world, f.golfer.id));
    expect(render[0].activitySource?.playback).not.toBeNull();
    expect(render[0].activitySource?.equipmentClass).toBe(expected);
  });
});
