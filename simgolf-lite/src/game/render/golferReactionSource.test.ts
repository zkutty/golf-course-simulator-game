import { describe, expect, it, vi } from "vitest";
import { createShotPacingPlan, shotPacingFrame } from "../live/shotPacing";
import { createLiveState, liveRenderData } from "../live/simulation";
import { acquireFocusedShot, focusedShotMatches, projectFocusedShot, restoreFocusedShot, snapshotFocusedShot } from "../live/focusedShot";
import { createGolferCapabilities } from "../live/capabilities";
import * as reactionMapper from "./golferReactions";
import type { Golfer } from "../live/types";
import type { LiveShotOutcome } from "../live/m47Types";
import { DEFAULT_WORLD } from "../models/defaults";
import type { Course } from "../models/types";
import type { PlayerRoundCourseSnapshot, PlayerShotTrace } from "../models/playerProTypes";
import type { SharedShotOutcome } from "../rules/contracts";
import { createRetainedShotMotion, sampleRetainedShotMotion, type ShotMotionIdentityV1 } from "../rules/shotMotion";
import { resolveObstacleCollision } from "../rules/obstacleCollision";
import { createPlayerShotPlaybackDriver } from "../../ui/playerPro/usePlayerShotPlayback";
import { captureGolferReactionSource, clearGolferReactionSource, matchingLiveReactionOutcome, observeGolferReactionSource,
  type ReactionSourceCapture, type ReactionSourceObservation } from "./golferReactionSource";
const p = (x: number) => ({ point: { x, y: 1 }, heightYards: 0 });
function fixture(putt = false, holed = false) {
  const identity: ShotMotionIdentityV1 = { shotId: "shot:1", holeId: "hole:1", shotNumber: 1, seed: 42, club: putt ? "Putter" : "7 Iron", style: "normal", modelVersion: "physical_shot_v1" };
  const motion = createRetainedShotMotion({ identity, yardsPerTile: 10, from: p(1), landing: p(putt ? 1 : 11), physicalRest: p(12),
    flight: putt ? null : resolveObstacleCollision({ from: { x: 1, y: 1 }, to: { x: 11, y: 1 }, flight: { profile: "standard", apexHeightYards: 4 }, width: 16, height: 16,
      yardsPerTile: 10, elevations: new Array(256).fill(0), obstacles: [], retainGeometry: true }).retained!, rollPath: [p(putt ? 1 : 11), p(12)], holed })!;
  const owner = { scopeId: "round:1", actorId: "player:1", shot: { ...identity } };
  const distanceYards = 110, plan = createShotPacingPlan({ scopeId: owner.scopeId, actorId: owner.actorId, motion, distanceYards })!;
  const shared: SharedShotOutcome = { rulesVersion: 1, lieEffect: { sourceLie: "fairway", effectiveLie: "fairway", carryMultiplier: 1, dispersionMultiplier: 1, rollMultiplier: 1 },
    requestedCarryYards: 100, effectiveCarryYards: 100, requestedDispersionTiles: 1, effectiveDispersionTiles: 1,
    flight: { profile: "standard", launchAngleDegrees: 1, apexHeightYards: 4, apexPosition: { x: 6, y: 1 }, carryEnd: { ...motion.landing.point }, clearance: [] },
    collision: { kind: "none" }, physicalRest: { ...motion.physicalRest.point }, ruling: { status: holed ? "holed" : "in_play", penaltyKind: "none", penaltyStrokes: 0,
      penaltyComponentId: null, penaltyAreaClassification: null, referencePoint: null, crossingPoint: null },
    relief: { status: "not_required", type: "none", candidates: [], selectedCandidateId: null, finalPosition: { x: 12, y: 1 } }, finalPosition: { x: 12, y: 1 }, motion };
  const tiles = new Array<Course["tiles"][number]>(256).fill("fairway");
  for (let y = 0; y < 3; y++) for (let x = 11; x < 14; x++) tiles[y * 16 + x] = "green";
  const pin = { x: holed ? 12 : 13, y: 1 };
  const course: Course = { name: "Receipt Links", width: 16, height: 16, tiles, elevations: new Array(256).fill(0), holes: [{ id: "hole:1", tee: { x: 1, y: 1 }, green: pin, parMode: "AUTO" }],
    obstacles: [], buildings: [], yardsPerTile: 10, baseGreenFee: 65, condition: .8 };
  const initialCursor = { version: 1 as const, key: plan.key, elapsedMs: 0 }, source = {}, token = {};
  const capture: ReactionSourceCapture = { owner, authorityRevision: owner.scopeId, plan, initialCursor, motion, distanceYards, source, courseSource: course, handedness: "right", sharedOutcome: shared,
    originalAim: { course, holeId: "hole:1", pin, from: motion.from.point, target: { x: 12, y: 1 } } };
  const observation = (elapsedMs = plan.durationMs - plan.restMs): ReactionSourceObservation => {
    const cursor = { ...initialCursor, elapsedMs }, frame = shotPacingFrame(plan, cursor)!;
    return { owner, currentOwner: owner, authorityRevision: owner.scopeId, currentAuthorityRevision: owner.scopeId, plan, cursor, frame, motion,
      position: sampleRetainedShotMotion(motion, frame.motionProgress)!, source, courseSource: course, handedness: "right", ownerCurrent: true };
  };
  const trace: PlayerShotTrace = { id: identity.shotId, holeId: identity.holeId, shotNumber: identity.shotNumber, club: identity.club, technique: "normal", power: 1,
    from: { ...motion.from.point }, aim: { x: 12, y: 1 }, landing: { ...motion.landing.point }, rest: { x: 12, y: 1 }, carryYards: 100, rollYards: 10,
    lieBefore: "fairway", lieAfter: "green", penaltyStrokes: 0, holed, seed: 42, evidence: [], sharedOutcome: shared };
  const outcome: LiveShotOutcome = { ...trace, version: 1, intentId: "intent:1", intent: "approach", facts: [] };
  const frozenCourse: PlayerRoundCourseSnapshot = { courseId: "course:1", courseName: course.name, theme: "parkland", width: 16, height: 16, yardsPerTile: 10, tiles,
    elevations: course.elevations, obstacles: [], holes: [{ id: "hole:1", name: "One", par: 4, tee: { x: 1, y: 1 }, pin, waypoints: [] }] };
  return { token, capture, observation, motion, shared, plan, course, frozenCourse, trace, outcome };
}
function liveFixture(putt = false, holed = false) {
  const f = fixture(putt, holed), world = structuredClone(DEFAULT_WORLD), live = createLiveState(f.course, world, 0);
  const personality = { skill: .6, consistency: .6, patience: .5, spendPropensity: .5, prefs: { difficulty: 0, scenery: 0, price: 0 } };
  const golfer: Golfer = { id: 7, name: "Receipt", archetype: "casual", personality, color: "#397e82", segments: [{ kind: "flight", from: f.motion.from.point, to: f.motion.physicalRest.point,
    dur: 1.5, holeIndex: 0, holeId: "hole:1", shot: putt ? "putt" : "swing", shotId: f.motion.identity.shotId, motion: f.motion }], segIndex: 0, segElapsed: .2, pos: { ...f.motion.from.point }, ball: { ...f.motion.from.point },
    holePar: [4], holeStrokes: [4], scoredHoles: 0, currentHole: 0, strokes: 0, scoreToPar: 0, mood: 60, thought: null, thoughtUntil: 0, finished: false, spent: 0, wallet: 50,
    purchasedSegmentIndexes: [], capabilities: createGolferCapabilities({ personality, seed: 42 }), shotOutcomes: [f.outcome],
    currentIntent: { id: "intent:1", kind: "approach", from: f.motion.from.point, target: { x: 12, y: 1 }, club: f.motion.identity.club, power: 1, technique: "normal",
      expectedStrokes: 2, variance: 0, hazardRisk: 0, nextShotQuality: 1, facts: [] } };
  live.golfers = [golfer];
  return { ...f, world, live, golfer };
}
function deepFrozen(value: unknown): boolean {
  return value === null || typeof value !== "object" || Object.isFrozen(value) && Object.values(value).every(deepFrozen);
}

describe("private retained reaction receipt", () => {
  it.each([false, true])("publishes only the actual retained endpoint and caches across rest (%s putt)", (putt) => {
    const f = fixture(putt, true), endpoint = f.plan.durationMs - f.plan.restMs;
    expect(captureGolferReactionSource(f.token, f.capture)).toBe(true);
    expect(observeGolferReactionSource(f.token, f.observation(endpoint - 1e-7))).toBeNull();
    const c = observeGolferReactionSource(f.token, f.observation(endpoint))!;
    expect(c.result).toBe("hole-out"); expect(c.finalEventIndex).toBe(f.motion.events.length - 1);
    expect(observeGolferReactionSource(f.token, f.observation(f.plan.durationMs - 600))).toBe(c);
    expect(observeGolferReactionSource(f.token, f.observation(f.plan.durationMs - 1))).toBe(c);
    expect(c).not.toHaveProperty("motion"); expect(c).not.toHaveProperty("course"); expect(deepFrozen(c)).toBe(true);
  });
  it("classifies once per owner and reuses the branded object without per-frame mapping", () => {
    const f = fixture(false, true), spy = vi.spyOn(reactionMapper, "classifyGolferReaction");
    try {
      captureGolferReactionSource(f.token, f.capture);
      expect(spy).not.toHaveBeenCalled();
      const observation = f.observation(), first = observeGolferReactionSource(f.token, observation);
      for (let i = 0; i < 100; i++) expect(observeGolferReactionSource(f.token, observation)).toBe(first);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
  });
  it("requires exact sampled position and destroys invalid endpoint/cache proof", () => {
    const f = fixture(false, true); captureGolferReactionSource(f.token, f.capture);
    const valid = f.observation(), bad = { ...valid, position: p(12.0000001) };
    expect(observeGolferReactionSource(f.token, bad)).toBeNull();
    expect(observeGolferReactionSource(f.token, valid)).toBeNull();
  });
  it.each(["ownerCurrent", "owner", "currentOwner", "authorityRevision", "currentAuthorityRevision", "source", "courseSource", "motion", "handedness", "frame", "plan"])("clears on changed %s before reusing a cached classification", (field) => {
    const f = fixture(false, true); captureGolferReactionSource(f.token, f.capture);
    expect(observeGolferReactionSource(f.token, f.observation())).not.toBeNull();
    const o = f.observation();
    const changes: Record<string, unknown> = { ownerCurrent: false, owner: { ...o.owner, actorId: "other" }, currentOwner: { ...o.owner, scopeId: "other-day" }, authorityRevision: "other", currentAuthorityRevision: "other",
      source: {}, courseSource: { ...f.course }, motion: structuredClone(f.motion), handedness: "left", frame: { ...o.frame, motionProgress: .999 }, plan: { ...o.plan, durationMs: o.plan.durationMs + 1 } };
    expect(observeGolferReactionSource(f.token, { ...o, [field]: changes[field] } as ReactionSourceObservation)).toBeNull();
    expect(observeGolferReactionSource(f.token, o)).toBeNull();
  });
  it("does not replay restored/late endpoints or invent an original aim", () => {
    const f = fixture(false, true), endpoint = f.plan.durationMs - f.plan.restMs;
    captureGolferReactionSource(f.token, { ...f.capture, initialCursor: { ...f.capture.initialCursor, elapsedMs: endpoint }, originalAim: null });
    expect(observeGolferReactionSource(f.token, f.observation())).toBeNull();
    captureGolferReactionSource(f.token, { ...f.capture, initialCursor: { ...f.capture.initialCursor, elapsedMs: endpoint - 1 }, originalAim: null });
    expect(observeGolferReactionSource(f.token, f.observation())!.physicalResult!.frozenAim).toBeNull();
  });
  it("certifies only a bounded pin-connected intended green and detached original aim", () => {
    const f = fixture(); captureGolferReactionSource(f.token, f.capture);
    const c = observeGolferReactionSource(f.token, f.observation())!;
    expect(c.result).toBe("good"); expect(c.physicalResult!.frozenAim!.greenGoal!.greenId).toBe(c.physicalResult!.physicalRest.greenId);
    expect(c.physicalResult!.frozenAim!.target).not.toBe(f.capture.originalAim!.target);
    f.shared.physicalRest.x = 99; f.shared.ruling.penaltyStrokes = 9;
    expect(observeGolferReactionSource(f.token, f.observation())).toBe(c);
    expect(c.physicalResult!.penaltyStrokes).toBe(0);
  });
  it.each(["missing", "oversize", "disconnected", "wrong-hole", "off-green-rest"])("keeps %s goal/rest membership unknown", (kind) => {
    const f = fixture();
    let aim = f.capture.originalAim;
    if (kind === "missing") aim = null;
    if (kind === "oversize") aim = { ...aim!, course: { width: 24, height: 24, tiles: new Array(576).fill("green") } };
    if (kind === "disconnected") { const tiles = [...f.course.tiles]; tiles[1 * 16 + 12] = "fairway"; aim = { ...aim!, course: { ...f.course, tiles } }; }
    if (kind === "wrong-hole") aim = { ...aim!, holeId: "other" };
    if (kind === "off-green-rest") aim = { ...aim!, target: { x: 13, y: 1 }, course: { ...f.course, tiles: f.course.tiles.map((v, i) => i === 28 ? "fairway" : v) } };
    captureGolferReactionSource(f.token, { ...f.capture, originalAim: aim });
    const c = observeGolferReactionSource(f.token, f.observation())!;
    expect(c.result).toBe("neutral");
    if (kind !== "off-green-rest") expect(c.physicalResult!.frozenAim).toBeNull();
    else expect(c.physicalResult!.physicalRest.greenId).toBeNull();
  });
  it("maps authoritative penalties/collisions, never post-relief lie or destination", () => {
    const f = fixture(); f.shared.ruling = { ...f.shared.ruling, status: "penalty", penaltyKind: "out_of_bounds", penaltyStrokes: 1 };
    f.shared.relief = { ...f.shared.relief, status: "resolved", type: "lateral", finalPosition: { x: 13, y: 1 } }; f.shared.finalPosition = { x: 13, y: 1 };
    captureGolferReactionSource(f.token, f.capture); const c = observeGolferReactionSource(f.token, f.observation())!;
    expect(c.result).toBe("bad"); expect(c.physicalResult!.physicalRest.position.point).toEqual({ x: 12, y: 1 }); expect(c.physicalResult!.reliefApplied).toBe(true);
    const sand = fixture(); sand.shared.collision = { kind: "terrain", point: { x: 12, y: 1 }, terrain: "sand", distanceFromStartYards: 110 };
    captureGolferReactionSource(sand.token, sand.capture); expect(observeGolferReactionSource(sand.token, sand.observation())!.result).toBe("bad");
  });
  it("keeps missing/contradictory aggregate physical truth neutral", () => {
    const f = fixture(); f.shared.ruling.status = "holed"; // The retained physical event remains rest.
    captureGolferReactionSource(f.token, f.capture); expect(observeGolferReactionSource(f.token, f.observation())!.result).toBe("neutral");
    const missing = fixture(); captureGolferReactionSource(missing.token, { ...missing.capture, sharedOutcome: null });
    expect(observeGolferReactionSource(missing.token, missing.observation())!.result).toBe("neutral");
  });
  it("matches full retained identities within240 outcomes; duplicates and oversized carriers are unknown", () => {
    const f = fixture();
    expect(matchingLiveReactionOutcome([f.outcome], f.motion)).toBe(f.outcome);
    for (const field of Object.keys(f.motion.identity) as (keyof ShotMotionIdentityV1)[]) {
      const wrong = structuredClone(f.outcome), i = wrong.sharedOutcome!.motion!.identity as unknown as Record<string, string | number>;
      i[field] = typeof i[field] === "number" ? (i[field] as number) + 1 : `${i[field]}-wrong`;
      expect(matchingLiveReactionOutcome([wrong], f.motion)).toBeNull();
    }
    expect(matchingLiveReactionOutcome([f.outcome, f.outcome], f.motion)).toBeNull();
    expect(matchingLiveReactionOutcome(new Array(241).fill(f.outcome), f.motion)).toBeNull();
    expect(matchingLiveReactionOutcome([{ ...f.outcome, id: "wrong" }], f.motion)).toBeNull();
  });
  it("capture/observation never mutates inputs, invokes RNG, or exposes pending truth", () => {
    const f = fixture(), before = structuredClone({ capture: f.capture, motion: f.motion });
    const rng = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("no RNG"); });
    try { captureGolferReactionSource(f.token, f.capture); expect(observeGolferReactionSource(f.token, f.observation(0))).toBeNull(); }
    finally { rng.mockRestore(); }
    expect({ capture: f.capture, motion: f.motion }).toEqual(before);
    clearGolferReactionSource(f.token); expect(observeGolferReactionSource(f.token, f.observation())).toBeNull();
  });
});

describe("existing LIVE/controlled readonly publication", () => {
  it.each([false, true])("LIVE exact endpoint-epsilon/endpoint/rest publication (%s putt), with original distance", (putt) => {
    const f = liveFixture(putt, true), owner = acquireFocusedShot(f.live, f.world, f.golfer.id, f.course)!;
    const before = structuredClone(f.live), end = owner.plan.durationMs - owner.plan.restMs;
    const render = liveRenderData(f.live, [], f.world);
    for (const elapsedMs of [0, end - 1e-7]) { owner.cursor = { ...owner.cursor, elapsedMs }; projectFocusedShot(owner, render, true, f.course); expect(render[0]!.activitySource!.reactionClassification).toBeUndefined(); }
    owner.cursor = { ...owner.cursor, elapsedMs: end }; projectFocusedShot(owner, render, true, f.course);
    const c = render[0]!.activitySource!.reactionClassification!; expect(c.result).toBe("hole-out");
    owner.cursor = { ...owner.cursor, elapsedMs: owner.plan.durationMs - 600 }; projectFocusedShot(owner, render, true, f.course);
    expect(render[0]!.activitySource!.reactionClassification).toBe(c); expect(c.authorityRevision).toBe(render[0]!.activitySource!.authorityRevision);
    expect(owner.retainedDistanceYards).toBe(110); expect(f.live).toEqual(before);
  });
  it("LIVE fresh0 matching intent certifies green, restore keeps goal null and late restore never replays", () => {
    const f = liveFixture(); f.golfer.segElapsed = 0;
    const owner = acquireFocusedShot(f.live, f.world, f.golfer.id, f.course)!, render = liveRenderData(f.live, [], f.world);
    owner.cursor = { ...owner.cursor, elapsedMs: owner.plan.durationMs - owner.plan.restMs }; projectFocusedShot(owner, render, true, f.course);
    expect(render[0]!.activitySource!.reactionClassification!.result).toBe("good");
    const early = acquireFocusedShot(f.live, f.world, f.golfer.id, f.course)!;
    const restored = restoreFocusedShot(snapshotFocusedShot(early), f.live, f.world)!;
    restored.cursor = { ...restored.cursor, elapsedMs: restored.plan.durationMs - restored.plan.restMs };
    const after = liveRenderData(f.live, [], f.world); projectFocusedShot(restored, after, true);
    expect(after[0]!.activitySource!.reactionClassification!.physicalResult!.frozenAim).toBeNull();
    const late = restoreFocusedShot(snapshotFocusedShot(restored), f.live, f.world)!; projectFocusedShot(late, after, true);
    expect(after[0]!.activitySource!.reactionClassification).toBeUndefined();
  });
  it("LIVE late .2 acquisition cannot label current aim/pin/green as original history", () => {
    const f = liveFixture(); expect(f.golfer.segElapsed).toBe(.2);
    const owner = acquireFocusedShot(f.live, f.world, f.golfer.id, f.course)!, render = liveRenderData(f.live, [], f.world);
    owner.cursor = { ...owner.cursor, elapsedMs: owner.plan.durationMs - owner.plan.restMs };
    projectFocusedShot(owner, render, true, f.course);
    const c = render[0]!.activitySource!.reactionClassification!;
    expect(c.result).toBe("neutral"); expect(c.physicalResult!.frozenAim).toBeNull();
    expect(c.physicalResult!.physicalRest.greenId).toBeNull();
  });
  it.each(["penalty", "hole-out"] as const)("LIVE late .2 acquisition still publishes truthful observed %s", (kind) => {
    const f = liveFixture(false, kind === "hole-out");
    if (kind === "penalty") f.shared.ruling = { ...f.shared.ruling, status: "penalty", penaltyKind: "out_of_bounds", penaltyStrokes: 1 };
    const owner = acquireFocusedShot(f.live, f.world, f.golfer.id, f.course)!, render = liveRenderData(f.live, [], f.world);
    const endpoint = owner.plan.durationMs - owner.plan.restMs;
    owner.cursor = { ...owner.cursor, elapsedMs: endpoint - 1e-7 }; projectFocusedShot(owner, render, true, f.course);
    expect(render[0]!.activitySource!.reactionClassification).toBeUndefined();
    owner.cursor = { ...owner.cursor, elapsedMs: endpoint }; projectFocusedShot(owner, render, true, f.course);
    const c = render[0]!.activitySource!.reactionClassification!;
    expect(c.result).toBe(kind === "penalty" ? "bad" : "hole-out"); expect(c.physicalResult!.frozenAim).toBeNull();
    expect(c.physicalResult!.penaltyStrokes).toBe(kind === "penalty" ? 1 : 0);
  });
  it.each(["day", "round", "actor", "hand", "course", "source"])("LIVE clears %s replacement before cached publication", (kind) => {
    const f = liveFixture(false, true), owner = acquireFocusedShot(f.live, f.world, f.golfer.id, f.course)!;
    owner.cursor = { ...owner.cursor, elapsedMs: owner.plan.durationMs - owner.plan.restMs };
    let render = liveRenderData(f.live, [], f.world); projectFocusedShot(owner, render, true, f.course); expect(render[0]!.activitySource!.reactionClassification).toBeTruthy();
    if (kind === "day") f.live.dayIndex++;
    if (kind === "round") f.live.reconcileEpoch++;
    if (kind === "actor") f.golfer.id++;
    if (kind === "hand") f.golfer.capabilities = { ...f.golfer.capabilities!, seed: 1 };
    if (kind === "source") f.golfer.segments[0] = { ...f.golfer.segments[0], motion: structuredClone(f.motion) };
    render = liveRenderData(f.live, [], f.world);
    projectFocusedShot(owner, render, focusedShotMatches(owner, f.live, f.world, f.golfer.id), kind === "course" ? { ...f.course } : f.course);
    expect(render[0]!.activitySource?.reactionClassification).toBeUndefined();
  });
  it.each([false, true])("controlled driver publishes only after endpoint, unchanged events/completion (%s putt)", (putt) => {
    const f = fixture(putt, true), source = structuredClone(f.trace), before = structuredClone(source);
    const driver = createPlayerShotPlaybackDriver(source, undefined, "round:1", "actor:1", "right", f.frozenCourse);
    const baseline = createPlayerShotPlaybackDriver(f.trace, undefined, "round:1", "actor:1", "right");
    const endpoint = driver.plan.durationMs - driver.plan.restMs;
    let elapsed = 0, checkpoints = 0, completions = 0;
    while (elapsed < endpoint) {
      const delta = Math.min(100, endpoint - elapsed), result = driver.advance(delta), expected = baseline.advance(delta);
      expect(result).toEqual(expected); elapsed += delta; checkpoints++;
      const sample = driver.sample()!;
      if (elapsed < endpoint) expect(sample.reactionClassification).toBeUndefined();
      else expect(sample.reactionClassification!.result).toBe("hole-out");
    }
    const c = driver.sample()!.reactionClassification;
    while (!driver.frame().complete) { const result = driver.advance(100); expect(result).toEqual(baseline.advance(100)); checkpoints++; completions += Number(result.complete); }
    expect(completions).toBe(1); expect(checkpoints).toBe(Math.ceil(endpoint / 100) + Math.ceil(driver.plan.restMs / 100));
    expect(driver.sample()!.reactionClassification).toBe(c); expect(source).toEqual(before);
  });
  it.each(["round", "actor", "pending", "motion", "course", "hand"])("controlled same-scope %s replacement invalidates before cached publication", (kind) => {
    const f = fixture(false, true), driver = createPlayerShotPlaybackDriver(f.trace, undefined, "round:1", "actor:1", "right", f.frozenCourse);
    while (driver.frame().motionProgress < 1) driver.advance(100);
    expect(driver.sample()!.reactionClassification!.result).toBe("hole-out");
    const publication = { roundId: "round:1", actorId: "actor:1", shot: f.trace, course: f.frozenCourse, handedness: "right" as "right" | "left" };
    if (kind === "round") publication.roundId = "round:2";
    if (kind === "actor") publication.actorId = "actor:2";
    if (kind === "pending") publication.shot = { ...f.trace };
    if (kind === "motion") f.trace.sharedOutcome = { ...f.trace.sharedOutcome!, motion: structuredClone(f.motion) };
    if (kind === "course") publication.course = { ...f.frozenCourse };
    if (kind === "hand") publication.handedness = "left";
    expect(driver.sample(publication)).toBeNull();
    expect(driver.sample()?.reactionClassification).toBeUndefined();
  });
  it("controlled classifications are identical at all operating tiers and cannot change driver effects", () => {
    const f = fixture(false, true);
    const results = ["1x", "2x", "4x"].map(() => {
      const driver = createPlayerShotPlaybackDriver(f.trace, undefined, "round:1", "actor:1", "right", f.frozenCourse);
      const events: string[] = []; let complete = 0;
      while (!driver.frame().complete) { const result = driver.advance(20); events.push(...result.events.map((event) => event.kind)); complete += Number(result.complete); driver.sample(); }
      return { classification: driver.sample()!.reactionClassification, cursor: driver.cursor(), events, complete };
    });
    expect(results[0]).toEqual(results[1]); expect(results[1]).toEqual(results[2]); expect(results[0]!.complete).toBe(1);
  });
  it("controlled frozen course supplies fresh goal; supplied saved cursor stays unknown; skip clears result", () => {
    const f = fixture();
    const fresh = createPlayerShotPlaybackDriver(f.trace, undefined, "round:1", "actor:1", "right", f.frozenCourse);
    const restored = createPlayerShotPlaybackDriver(f.trace, { version: 1, shotId: f.trace.id, progress: 0 }, "round:1", "actor:1", "right", f.frozenCourse);
    while (fresh.frame().motionProgress < 1) { fresh.advance(100); restored.advance(100); }
    expect(fresh.sample()!.reactionClassification!.result).toBe("good");
    expect(restored.sample()!.reactionClassification!.physicalResult!.frozenAim).toBeNull();
    fresh.advance(0, false, true); expect(fresh.sample()!.reactionClassification).toBeUndefined();
    const late = createPlayerShotPlaybackDriver(f.trace, restored.cursor(), "round:1", "actor:1", "right", f.frozenCourse);
    expect(late.sample()!.reactionClassification).toBeUndefined();
  });
});
