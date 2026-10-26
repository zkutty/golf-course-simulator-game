import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { courseWithEffectiveSurfaces } from "../conditions/surfaceCare";
import { createLiveActivitySource, focusedLiveActivitySource, liveActivityScope } from "../live/activitySource";
import { createGolferCapabilities, stableGolferHandedness } from "../live/capabilities";
import { advanceShotPacingCursor, createShotPacingCursor, createShotPacingPlan, shotPacingFrame } from "../live/shotPacing";
import { createLiveState, stepLive } from "../live/simulation";
import type { Segment } from "../live/types";
import { normalizeCourseLayouts } from "../models/courseLayouts";
import { DEFAULT_WORLD } from "../models/defaults";
import { createRetainedShotMotion, sampleRetainedShotMotion } from "../rules/shotMotion";
import { createM47CertificationCourse } from "../testing/m47Certification";
import { createLiveGolferGroundAuthority } from "./golferGroundAuthority";
import { buildLandscapeComponents, buildVisualHeightfield, type LandscapeComponent } from "./landscapeGeometry";
import { parseNaturalGolferArt } from "./naturalGolferArt";
import { ISO_ROTATIONS, tileCenterIso } from "./iso";
import { createGolferStanceBinding, NATURAL_GOLFER_CONTACT_MODEL, sampleGolferStance } from "./golferStance";
import type { GolferStanceBinding, GolferStanceIdentity, GolferStancePoint } from "./golferStance";
import { GOLFER_LOCOMOTION_LIMITS, projectGolferLocomotion } from "./golferLocomotion";
import type { GolferFootSweepCertificate, GolferLocomotionGroundAuthority, GolferLocomotionProjection, GolferLocomotionRequest, GolferLocomotionState } from "./golferLocomotion";

const parsed = parseNaturalGolferArt(
  JSON.parse(readFileSync(new URL("../../../art/natural-golfer-v1/manifest.json", import.meta.url), "utf8")),
  JSON.parse(readFileSync(new URL("../../../art/natural-golfer-v1/cost.json", import.meta.url), "utf8")),
);
if (!parsed.ok) throw new Error(parsed.reason);
const artIndex = parsed.index;
type FixtureRequest = { -readonly [K in keyof GolferLocomotionRequest]: GolferLocomotionRequest[K] };
const scope = liveActivityScope({ dayIndex: 2, seed: 42, reconcileEpoch: 0, dayOver: false }, { runSeed: 17, week: 1 })!;
const p = (x: number, y = 0, heightYards = 0): GolferStancePoint => ({ x, y, heightYards });
function chord(a: GolferStancePoint, b: GolferStancePoint): number {
  return Math.max(...ISO_ROTATIONS.map(rotation => {
    const from = tileCenterIso(a.x, a.y, a.heightYards / 2.5, rotation), to = tileCenterIso(b.x, b.y, b.heightYards / 2.5, rotation);
    return Math.hypot(to.x - from.x, to.y - from.y);
  }));
}
function ground(height: (x: number, y: number) => number = () => 0): GolferLocomotionGroundAuthority {
  return { surfaceRevision: "surface:1",
    sampleFootprintAt: vi.fn((x, y) => ({ surfaceRevision: "surface:1", inBounds: true, supportedFootprint: true, heightYards: height(x - .5, y - .5) })),
    sweepFootprint: vi.fn((from: GolferStancePoint, to: GolferStancePoint, budget: number): GolferFootSweepCertificate => ({ surfaceRevision: "surface:1", from: { ...from }, to: { ...to }, inBounds: true, supportedThroughout: true, continuousHeight: true,
      footprintsTested: Math.min(budget, 8), maxProjectedDerivativePx: chord(from, to) })),
  };
}
function walk(x = 0, time = 0, patch: Partial<GolferLocomotionRequest> = {}, segmentPatch: Partial<Segment> = {}): FixtureRequest {
  const segment: Segment = { kind: "walk", from: { x: 0, y: 0 }, to: { x: 20, y: 0 }, dur: 20, holeIndex: 0,
    mobility: { requestedMode: "walk", resolvedMode: "walk", minutesSaved: 0, offPathTiles: 0 }, ...segmentPatch };
  const live = createLiveActivitySource(scope, { id: 7, pos: { x, y: 0 }, finished: false, segIndex: 0, segElapsed: x, capabilities: undefined }, segment)!;
  const owner = { ...live.owner, scopeId: live.owner.scopeId! }, root = p(x);
  return { owner, currentOwner: owner, authorityRevision: live.authorityRevision, currentAuthorityRevision: live.authorityRevision, surfaceRevision: "surface:1",
    root, actualFeet: root, live, stance: null, ground: ground(), presentationTimeMs: time, paused: false, hidden: false, culled: false,
    acquisition: "continuous", motionEnabled: true, rotation: 0, quality: "high", operatingTier: 1, ...patch };
}
function shot(role: "swing" | "putt" = "swing", degrees = 45, g = ground(), liveMode = false, visualGroundLaunch?: GolferStancePoint) {
  const at = (x: number) => ({ point: { x, y: 5 }, heightYards: 0 });
  const motion = createRetainedShotMotion({ identity: { shotId: "shot:1", holeId: "hole:1", shotNumber: 1, seed: 42,
    club: role === "putt" ? "Putter" : "7 Iron", style: "normal", modelVersion: "physical_shot_v1" },
    yardsPerTile: 10, from: at(5), landing: at(5), physicalRest: at(9), flight: null, rollPath: [at(5), at(9)], holed: false })!;
  const plan = createShotPacingPlan({ scopeId: liveMode ? scope.id! : "round:1", actorId: liveMode ? "7" : "player:7", motion, distanceYards: 40 })!;
  const owner = { scopeId: plan.scopeId, actorId: plan.actorId, shot: plan.identity }, root = p(5, 5);
  const identity: GolferStanceIdentity = { owner, authorityRevision: liveMode ? scope.revision : "round-rev:1", surfaceRevision: g.surfaceRevision,
    targetWorld: { x: Math.cos(degrees * Math.PI / 180), y: Math.sin(degrees * Math.PI / 180) }, handedness: "right", modelVersion: NATURAL_GOLFER_CONTACT_MODEL.modelVersion, role };
  const creation = createGolferStanceBinding({ identity, launch: root, visualGroundLaunch, ground: g, artIndex });
  if (creation.kind !== "candidate") throw new Error(creation.reason);
  const binding = creation.binding;
  const atCursor = (elapsedMs: number, patch: Partial<GolferLocomotionRequest> = {}): FixtureRequest => {
    const cursor = createShotPacingCursor(plan, { version: 1, key: plan.key, elapsedMs });
    return { owner, currentOwner: owner, authorityRevision: identity.authorityRevision, currentAuthorityRevision: identity.authorityRevision,
      surfaceRevision: g.surfaceRevision, root, visualGroundLaunch, actualFeet: visualGroundLaunch ?? root, live: null, stance: { binding, identity,
        playback: { plan, cursor, frame: shotPacingFrame(plan, cursor)!, retainedEvidence: { key: plan.key, validated: true } } },
      ground: g, presentationTimeMs: elapsedMs, paused: false, hidden: false, culled: false, acquisition: "continuous", motionEnabled: true,
      rotation: 0, quality: "high", operatingTier: 1, ...patch };
  };
  return { motion, plan, binding, identity, root, at: atCursor };
}
function state(result: GolferLocomotionProjection): GolferLocomotionState {
  if (!result.nextState) throw new Error(result.reason ?? "missing state");
  return result.nextState;
}
function frozen(value: unknown): void {
  if (value && typeof value === "object") { expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(frozen); }
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}
function finish(s: ReturnType<typeof shot>, interval = 1000 / 60, patch: Partial<GolferLocomotionRequest> = {}) {
  let cursor = createShotPacingCursor(s.plan), result = projectGolferLocomotion(s.at(0, patch));
  const seen = [result];
  for (let i = 0; i < 200 && !result.arrival; i++) {
    cursor = advanceShotPacingCursor(s.plan, cursor, interval)!;
    const req = s.at(cursor.elapsedMs, { ...patch, actualFeet: result.feet });
    result = projectGolferLocomotion(req, state(result)); seen.push(result);
  }
  expect(result.arrival?.kind).toBe("validated-adjustment");
  return { result, seen, cursor };
}

let retainedM47: ReturnType<typeof m47Fixture> | undefined;
function m47Fixture() {
  const course = normalizeCourseLayouts(createM47CertificationCourse(18));
  const world = Object.assign(structuredClone(DEFAULT_WORLD), { week: 1, cash: 250000, reputation: 95, runSeed: 12160, isBankrupt: false, distressWeeks: 0, mode: "sandbox" as const });
  const live = createLiveState(course, world, 0);
  for (let i = 0; i < 540; i++) stepLive(live, course, .05, world);
  const golfer = live.golfers.find(g => g.id === 1)!, scope = liveActivityScope(live, world)!;
  const effectiveTiles = courseWithEffectiveSurfaces(course).tiles, field = buildVisualHeightfield(course);
  const componentsByCell: (LandscapeComponent | null)[] = Array(effectiveTiles.length).fill(null);
  for (const component of buildLandscapeComponents(effectiveTiles, course.width, course.height, { cornerRadius: .4, cornerSegments: 4 })) {
    for (const i of component.cells) componentsByCell[i] = component;
  }
  const ground = createLiveGolferGroundAuthority({ course, effectiveTiles, field, componentsByCell, quality: "high", surfaceRevision: "m47:high" });
  return { course, world, live, golfer, scope, ground };
}
function m47Shot(shotNumber: number) {
  const f = retainedM47 ??= m47Fixture(), index = f.golfer.segments.findIndex(s => s.motion?.identity.holeId === "m47-hole-1" && s.motion.identity.shotNumber === shotNumber);
  const segment = f.golfer.segments[index], motion = segment.motion!, B = { ...motion.from.point, heightYards: motion.from.heightYards };
  const G = { ...B, heightYards: f.ground.sampleFootprintAt(B.x + .5, B.y + .5).heightYards };
  const target = motion.flight?.geometry.to ?? motion.groundPath[1].point;
  let distanceYards = Math.hypot(motion.landing.point.x - B.x, motion.landing.point.y - B.y) * motion.units.yardsPerTile;
  for (let i = 1; i < motion.groundPath.length; i++) distanceYards += Math.hypot(motion.groundPath[i].point.x - motion.groundPath[i - 1].point.x, motion.groundPath[i].point.y - motion.groundPath[i - 1].point.y) * motion.units.yardsPerTile;
  const plan = createShotPacingPlan({ scopeId: f.scope.id!, actorId: "1", motion, distanceYards })!;
  const owner = { scopeId: plan.scopeId, actorId: plan.actorId, shot: plan.identity };
  const base = createLiveActivitySource(f.scope, { ...f.golfer, pos: motion.from.point, segIndex: index, segElapsed: 0 }, segment)!;
  const initial = createShotPacingCursor(plan), frame = shotPacingFrame(plan, initial)!;
  const source = focusedLiveActivitySource(base, { actorId: 1, segmentIndex: index, segmentElapsed: 0, plan, cursor: initial, frame, identity: motion.identity, origin: motion.from, target }, true)!;
  const identity: GolferStanceIdentity = { owner, authorityRevision: source.authorityRevision, surfaceRevision: f.ground.surfaceRevision,
    targetWorld: source.targetWorld!, handedness: source.handedness, modelVersion: NATURAL_GOLFER_CONTACT_MODEL.modelVersion, role: plan.kind };
  const creation = createGolferStanceBinding({ identity, launch: B, visualGroundLaunch: G, ground: f.ground, artIndex });
  const at = (elapsedMs: number, binding: GolferStanceBinding, patch: Partial<GolferLocomotionRequest> = {}): FixtureRequest => {
    const cursor = createShotPacingCursor(plan, { version: 1, key: plan.key, elapsedMs }), frame = shotPacingFrame(plan, cursor)!;
    const current = focusedLiveActivitySource(base, { actorId: 1, segmentIndex: index, segmentElapsed: 0, plan, cursor, frame, identity: motion.identity, origin: motion.from, target }, true)!;
    return { owner, currentOwner: owner, authorityRevision: source.authorityRevision, currentAuthorityRevision: source.authorityRevision,
      surfaceRevision: f.ground.surfaceRevision, root: B, visualGroundLaunch: G, actualFeet: G, live: current, stance: { binding, identity, playback: current.playback! },
      ground: f.ground, presentationTimeMs: elapsedMs, paused: false, hidden: false, culled: false, acquisition: "continuous", motionEnabled: true,
      rotation: 0, quality: "high", operatingTier: 1, ...patch };
  };
  return { ...f, motion, B, G, identity, creation, plan, source, at };
}

describe("observed visual G→F adjustment with an unchanged physical ball B", () => {
  it.each([2, 3].flatMap(shotNumber => ISO_ROTATIONS.map(rotation => [shotNumber, rotation] as const)))("reaches retained M47 shot %d F at camera %d without rewriting source B", (shotNumber, rotation) => {
    const s = m47Shot(shotNumber), before = structuredClone({ live: s.live, world: s.world, motion: s.motion, source: s.source });
    if (s.creation.kind !== "candidate") throw new Error(s.creation.reason);
    const b = s.creation.binding;
    deepFreeze(s.motion); deepFreeze(s.source);
    let result = projectGolferLocomotion(s.at(0, b, { rotation }));
    expect(result).toMatchObject({ kind: "adjust", root: s.B, feet: s.G, arrival: null, strideFrame: 0 });
    expect(s.B.heightYards).not.toBe(s.G.heightYards);
    for (let elapsed = 50; !result.arrival && elapsed <= 800; elapsed += 50) {
      const previous = state(result), req = s.at(elapsed, b, { rotation, actualFeet: result.feet });
      const frozenFacts = deepFreeze({ owner: req.owner, root: req.root, live: req.live, stance: req.stance });
      const published = projectGolferLocomotion(req, previous);
      expect(published.root).toEqual(s.B);
      expect(req.root).toBe(frozenFacts.root); expect(req.live!.root.heightYards).toBe(s.B.heightYards);
      expect(chord(previous.feet, published.feet!)).toBeLessThanOrEqual(32 * (elapsed - previous.cursorMs!) / 1000 + 1e-7);
      if (published.reason === "awaiting-arrival-observation") expect(published.arrival).toBeNull();
      result = published;
    }
    expect(result).toMatchObject({ kind: "arrived", feet: b.feet, arrival: { kind: "validated-adjustment" } });
    expect(state(result).adjustmentFrom).toEqual(s.G); expect(state(result).adjustmentFrom).not.toEqual(s.B);
    expect(state(result).adjustmentDurationMs).toBeCloseTo(shotNumber === 2 ? 333.97592810969394 : 343.0981962894866, 7);
    const launch = s.plan.addressMs + s.plan.contactMs;
    for (const target of [launch - .001, launch, launch + .001]) {
      while (state(result).cursorMs! < target) {
        const elapsed = Math.min(target, state(result).cursorMs! + 100);
        const req = s.at(elapsed, b, { rotation, actualFeet: result.feet });
        const cursorBefore = { ...req.stance!.playback.cursor };
        result = projectGolferLocomotion(req, state(result));
        expect(result).toMatchObject({ kind: "planted", root: s.B, feet: b.feet });
        expect(req.stance!.playback.cursor).toEqual(cursorBefore);
        const pose = sampleRetainedShotMotion(s.motion, req.stance!.playback.frame.motionProgress);
        expect(pose).toEqual(sampleRetainedShotMotion(before.motion, req.stance!.playback.frame.motionProgress));
      }
      const held = projectGolferLocomotion(s.at(target, b, { rotation, actualFeet: result.feet, paused: true, hidden: true, motionEnabled: false, presentationTimeMs: 100000 + target }), state(result));
      expect(held).toMatchObject({ kind: "planted", reason: "held", root: s.B, feet: b.feet, stridePhase: result.stridePhase });
    }
    expect({ live: s.live, world: s.world, motion: s.motion, source: s.source }).toEqual(before);
    frozen(state(result));
  });

  it("rejects the real shot 1 and does not admit a G-as-B substitute candidate", () => {
    const s = m47Shot(1);
    expect(s.creation).toMatchObject({ kind: "neutral", reason: "contact-residual" });
    const forgedBall = createGolferStanceBinding({ identity: s.identity, launch: s.G, ground: s.ground, artIndex });
    if (forgedBall.kind !== "candidate") throw new Error("visual-only counterexample");
    expect(projectGolferLocomotion(s.at(0, forgedBall.binding))).toMatchObject({ kind: "neutral", reason: "stance-invalidated", nextState: null });
  });

  it.each(["root-is-G", "source-is-G", "G-is-B", "G-omitted", "target", "epoch", "surface"])("rejects distinct-domain %s before a paused hold", variant => {
    const s = m47Shot(3); if (s.creation.kind !== "candidate") throw new Error(s.creation.reason);
    const b = s.creation.binding, initial = state(projectGolferLocomotion(s.at(0, b))), req = s.at(0, b, { paused: true, hidden: true, presentationTimeMs: 1000 });
    if (variant === "root-is-G") req.root = s.G;
    if (variant === "source-is-G") req.live = { ...req.live!, root: { ...req.live!.root, heightYards: s.G.heightYards } };
    if (variant === "G-is-B") req.visualGroundLaunch = s.B;
    if (variant === "G-omitted") req.visualGroundLaunch = undefined;
    if (variant === "target") req.live = { ...req.live!, targetWorld: { x: 1, y: 0 } };
    if (variant === "epoch") req.currentAuthorityRevision += ":replaced";
    if (variant === "surface") req.ground = { ...req.ground, surfaceRevision: "replaced" };
    expect(projectGolferLocomotion(req, initial)).toMatchObject({ kind: "neutral", nextState: null, arrival: null });
  });

  it("never treats repeated neutral G observations as F proof or a late contact arrival", () => {
    const s = m47Shot(3); if (s.creation.kind !== "candidate") throw new Error(s.creation.reason);
    const b = s.creation.binding, first = projectGolferLocomotion(s.at(0, b));
    for (const presentationTimeMs of [0, 16, 1000, 100000]) {
      const still = projectGolferLocomotion(s.at(0, b, { actualFeet: s.G, presentationTimeMs }), state(first));
      expect(still).toMatchObject({ feet: s.G, arrival: null, strideFrame: 0 });
    }
    const moving = projectGolferLocomotion(s.at(100, b, { actualFeet: s.G }), state(first));
    expect(moving.kind).toBe("adjust"); expect(moving.arrival).toBeNull();
    expect(projectGolferLocomotion(s.at(200, b, { actualFeet: s.G }), state(moving))).toMatchObject({ reason: "adjustment-observation-mismatch", arrival: null });
    expect(projectGolferLocomotion(s.at(100, b, { actualFeet: b.feet }), state(first))).toMatchObject({ reason: "adjustment-observation-mismatch", arrival: null });
    for (const elapsed of [1200 - .001, 1200, 1200 + .001]) {
      expect(projectGolferLocomotion(s.at(elapsed, b, { actualFeet: s.G }))).toMatchObject({ kind: "neutral", arrival: null });
    }
    expect(projectGolferLocomotion(s.at(0, b, { actualFeet: s.B }))).toMatchObject({ reason: "continuous-arrival-required", arrival: null });
  });

  it.each(["swing", "putt"] as const)("fits explicit non-equal B/G in the existing %s window and only grants subsequent observed-F proof", role => {
    const G = p(5, 5, .05), s = shot(role, 45, ground(() => G.heightYards), false, G), before = structuredClone({ motion: s.motion, plan: s.plan });
    deepFreeze(s.motion); deepFreeze(s.plan);
    const { result, seen } = finish(s);
    expect(seen[0]).toMatchObject({ root: s.root, feet: G, arrival: null });
    expect(seen.at(-2)).toMatchObject({ feet: s.binding.feet, reason: "awaiting-arrival-observation", arrival: null });
    expect(result.arrival).toMatchObject({ kind: "validated-adjustment" });
    expect(state(result).adjustmentDurationMs).toBeLessThan(role === "swing" ? 800 : 400);
    expect(projectGolferLocomotion(s.at((role === "swing" ? 800 : 400) - state(result).adjustmentDurationMs! + .001))).toMatchObject({ reason: "adjustment-window-exceeded", arrival: null });
    let planted = result;
    const launch = role === "swing" ? 1200 : 650;
    for (const target of [launch - .001, launch, launch + .001]) {
      while (state(planted).cursorMs! < target) {
        const elapsed = Math.min(target, state(planted).cursorMs! + 100), req = s.at(elapsed, { actualFeet: planted.feet });
        const clock = structuredClone(req.stance!.playback);
        planted = projectGolferLocomotion(req, state(planted));
        expect(planted).toMatchObject({ kind: "planted", root: s.root, feet: s.binding.feet });
        expect(req.stance!.playback).toEqual(clock);
      }
      const frame = s.at(target).stance!.playback.frame;
      expect(frame.motionProgress === 0).toBe(target <= launch);
      expect(sampleRetainedShotMotion(s.motion, frame.motionProgress)).toEqual(sampleRetainedShotMotion(before.motion, frame.motionProgress));
    }
    expect({ motion: s.motion, plan: s.plan }).toEqual(before);
  });

  it.each(["blocked", "bounds", "nonfinite", "changed-height", "unsupported-sweep"])("keeps the existing %s ground rejection for distinct G/F", variant => {
    const s = m47Shot(3); if (s.creation.kind !== "candidate") throw new Error(s.creation.reason);
    const b = s.creation.binding, first = projectGolferLocomotion(s.at(0, b)), req = s.at(0, b, { actualFeet: s.G, paused: true });
    const original = req.ground.sampleFootprintAt;
    if (variant === "unsupported-sweep") req.ground = { ...req.ground, sweepFootprint: () => null };
    else req.ground = { ...req.ground, sampleFootprintAt: (x, y) => ({ ...original(x, y),
      ...(variant === "blocked" ? { supportedFootprint: false } : variant === "bounds" ? { inBounds: false } : { heightYards: variant === "nonfinite" ? NaN : original(x, y).heightYards + .001 }) }) };
    const result = projectGolferLocomotion(req, variant === "unsupported-sweep" ? null : state(first));
    expect(result).toMatchObject({ kind: "neutral", arrival: null, nextState: null });
  });
});

describe("current legal leg and distance gait", () => {
  it.each([30, 60, 120])("walks naturally at %d Hz using distance, never a free-running frame clock", hz => {
    const dt = 1000 / hz, dx = .5 / hz;
    let result = projectGolferLocomotion(walk());
    for (let i = 1; i <= hz; i++) {
      result = projectGolferLocomotion(walk(i * dx, i * dt), state(result));
      expect(result.kind).toBe("walk"); expect(result.root).toEqual(p(i * dx)); expect(result.feet).toEqual(result.root);
    }
    expect(result.stridePhase).toBeCloseTo(.5 * 1.35); expect(result.fastForward).toBe(false);
    const stopped = projectGolferLocomotion(walk(.5, 2000), state(result));
    expect(stopped.kind).toBe("static"); expect(stopped.stridePhase).toBe(result.stridePhase);
  });
  it.each([1, 2, 4] as const)("tier %d never lags authority or repays fast travel with frantic gait", operatingTier => {
    const first = state(projectGolferLocomotion(walk(0, 0, { operatingTier })));
    const next = projectGolferLocomotion(walk(.5 * operatingTier, 1000, { operatingTier }), first);
    expect(next.root).toEqual(p(.5 * operatingTier)); expect(next.feet).toEqual(next.root);
    expect(next.fastForward).toBe(operatingTier > 1); expect(next.kind).toBe(operatingTier > 1 ? "static" : "walk");
    const after = projectGolferLocomotion(walk(.5 * operatingTier + .05, 1100, { operatingTier }), state(next));
    expect(after.kind).toBe("walk"); expect(after.stridePhase).toBeCloseTo((operatingTier === 1 ? .55 : .05) * 1.35);
    expect(Object.keys(state(after))).not.toContain("debt");
  });
  it.each(ISO_ROTATIONS)("uses all cameras for the speed bound even when active rotation is %d", rotation => {
    const from = walk(0, 0, { rotation }), next = walk(1, 1000, { rotation });
    expect(projectGolferLocomotion(next, state(projectGolferLocomotion(from)))).toMatchObject({ kind: "static", fastForward: true, root: p(1) });
  });
  it("bounds work on large overview jumps by presenting current feet without sweeping or queuing the skipped leg", () => {
    const first = state(projectGolferLocomotion(walk())), req = walk(19, 16), sweepFootprint = vi.fn(() => null);
    expect(projectGolferLocomotion({ ...req, ground: { ...req.ground, sweepFootprint } }, first)).toMatchObject({ kind: "static", fastForward: true, root: p(19), feet: p(19), strideFrame: 0 });
    expect(sweepFootprint).not.toHaveBeenCalled();
  });
  it("supports slope heights and requires the full crossed footprint rather than just endpoints", () => {
    const g = ground(x => x * 2), first = walk(0, 0, { ground: g }), next = walk(.5, 1000, { ground: g, root: p(.5, 0, 1), actualFeet: p(.5, 0, 1) });
    expect(projectGolferLocomotion(next, state(projectGolferLocomotion(first))).kind).toBe("walk");
    const blocked = { ...g, sweepFootprint: vi.fn(() => null) };
    expect(projectGolferLocomotion({ ...next, ground: blocked }, state(projectGolferLocomotion(first)))).toMatchObject({ kind: "neutral", reason: "unsupported-current-travel", root: next.root, nextState: null });
  });
  it.each(["riding_cart", null] as const)("does not synthesize foot gait for %s mobility", mode => {
    const req = walk(.1, 100), live = req.live!;
    const changed = { ...req, live: { ...live, movement: { ...live.movement!, resolvedMode: mode, onFoot: mode === null ? null : false } } };
    expect(projectGolferLocomotion(changed)).toMatchObject(mode === null ? { kind: "neutral", reason: "unknown-mobility" } : { kind: "static", reason: "riding", strideFrame: 0 });
  });
  it("stops, resumes, and turns using only a coherent observed next leg", () => {
    const initial = state(projectGolferLocomotion(walk())), moving = projectGolferLocomotion(walk(.25, 500), initial);
    const stop = walk(.25, 1000); stop.live = { ...stop.live!, movement: null, segment: { ...stop.live!.segment!, kind: "pause" } };
    const stopped = projectGolferLocomotion(stop, state(moving)); expect(stopped.stridePhase).toBe(moving.stridePhase);
    const resumed = projectGolferLocomotion(walk(.3, 1100), state(stopped)); expect(resumed.kind).toBe("walk");
    const turn = walk(.3, 1200), live = turn.live!;
    const root = p(.3, .05), from = { x: .3, y: 0 }, to = { x: .3, y: 4 };
    const turned = projectGolferLocomotion({ ...turn, root, actualFeet: root, live: { ...live, root: { ...live.root, ...root }, segment: { ...live.segment!, key: "next-leg" },
      movement: { ...live.movement!, segmentKey: "next-leg", from, to, distanceTiles: .05 } } }, state(resumed));
    expect(turned.kind).toBe("walk"); expect(turned.stridePhase).toBeCloseTo(.35 * 1.35);
    const unrelated = projectGolferLocomotion(walk(4, 1300), state(turned)); expect(unrelated).toMatchObject({ kind: "static", fastForward: true, reason: "unobserved-leg-transition" });
  });
  it("keeps controlled travel neutral without retained route evidence", () => {
    expect(projectGolferLocomotion({ ...walk(), live: null })).toMatchObject({ kind: "neutral", reason: "unsupported-travel", nextState: null });
  });
  it("does not call a stopped segment evidence of travel to an unrelated root", () => {
    const first = state(projectGolferLocomotion(walk())), req = walk(1, 2000);
    req.live = { ...req.live!, movement: null };
    expect(projectGolferLocomotion(req, first)).toMatchObject({ kind: "neutral", reason: "unobserved-travel", root: p(1) });
  });
  it("passes only detached frozen primitive points into the bounded sweep query", () => {
    const first = state(projectGolferLocomotion(walk())), req = walk(.25, 500), sweep = req.ground.sweepFootprint;
    Object.assign(req.root, { privateExtra: { mutable: 1 } });
    const checked = vi.fn((from: GolferStancePoint, to: GolferStancePoint, budget: number) => {
      expect(from).not.toBe(first.root); expect(to).not.toBe(req.root);
      expect(Object.keys(to)).toEqual(["x", "y", "heightYards"]); expect(Object.isFrozen(to)).toBe(true);
      return sweep(from, to, budget);
    });
    expect(projectGolferLocomotion({ ...req, ground: { ...req.ground, sweepFootprint: checked } }, first).kind).toBe("walk");
    expect(checked).toHaveBeenCalledTimes(1);
  });
  it.each(["key", "position", "distance", "source", "reverse"])("rejects inconsistent current-leg %s evidence", field => {
    const first = state(projectGolferLocomotion(walk(.2, 400))), req = walk(.25, 500), live = req.live!, m = live.movement!;
    const patch = field === "key" ? { segmentKey: "old" } : field === "distance" ? { distanceTiles: 12 } : field === "source" ? { source: "invented" } : {};
    const root = field === "position" ? p(.25, .1) : field === "reverse" ? p(.1) : req.root;
    const changed = { ...req, root, actualFeet: root, live: { ...live, root: { ...live.root, ...root }, movement: { ...m, ...patch, ...(field === "reverse" ? { distanceTiles: .1 } : {}) } } } as GolferLocomotionRequest;
    expect(projectGolferLocomotion(changed, first).kind).toBe("neutral");
  });
});

describe("invalidation precedes holds and bounded publication", () => {
  it.each(["paused", "hidden"] as const)("holds %s stride only for unchanged observations", held => {
    const moving = projectGolferLocomotion(walk(.1, 200), state(projectGolferLocomotion(walk()))), previous = state(moving);
    const request = walk(.1, 200, { [held]: true });
    expect(projectGolferLocomotion(request, previous)).toMatchObject({ kind: "static", reason: "held", strideFrame: moving.strideFrame });
    expect(projectGolferLocomotion(walk(.11, 200, { [held]: true }), previous)).toMatchObject({ kind: "neutral", reason: "held-observation-changed" });
    expect(projectGolferLocomotion(walk(.1, 201, { [held]: true }), previous)).toMatchObject({ kind: "static", strideFrame: moving.strideFrame, nextState: { observedAtMs: 201 } });
  });
  it("allows another domain's long timestamp advance during hold without speed catch-up on resume", () => {
    const moving = projectGolferLocomotion(walk(.1, 200), state(projectGolferLocomotion(walk())));
    const held = projectGolferLocomotion(walk(.1, 1000200, { paused: true }), state(moving));
    expect(held).toMatchObject({ stridePhase: moving.stridePhase, feet: moving.feet, nextState: { observedAtMs: 1000200 } });
    const resume = projectGolferLocomotion(walk(.15, 1000300), state(held));
    expect(resume).toMatchObject({ kind: "walk", fastForward: false }); expect(resume.stridePhase).toBeCloseTo(.15 * 1.35);
    const fast = projectGolferLocomotion(walk(1, 1000300), state(held));
    expect(fast).toMatchObject({ kind: "static", fastForward: true, stridePhase: moving.stridePhase });
  });
  it.each(["owner", "revision", "surface", "cull", "time", "copied-state", "day", "epoch"])("invalidates %s before paused publication", variant => {
    const req = walk(0, 100, { paused: true }); let previous = state(projectGolferLocomotion(walk(0, 100)));
    if (variant === "owner") req.currentOwner = { ...req.owner, actorId: "other" };
    if (variant === "revision") req.currentAuthorityRevision = "replacement";
    if (variant === "surface") req.surfaceRevision = "surface:2";
    if (variant === "cull") req.culled = true;
    if (variant === "time") req.presentationTimeMs = 99;
    if (variant === "copied-state") previous = { ...previous };
    if (variant === "day" || variant === "epoch") req.live = { ...req.live!, scope: { ...req.live!.scope, revision: variant } };
    expect(projectGolferLocomotion(req, previous)).toMatchObject({ kind: "neutral", nextState: null, root: req.root });
  });
  it("reload discards old gait and skipped/cull samples discard without event queues", () => {
    const previous = state(projectGolferLocomotion(walk(.5, 1000)));
    const reset = projectGolferLocomotion(walk(10, 0, { acquisition: "reload" }), previous);
    expect(reset).toMatchObject({ kind: "static", strideFrame: 0, root: p(10), reason: "first-observation" });
    for (const patch of [{ acquisition: "skip" }, { culled: true }] as const) expect(projectGolferLocomotion(walk(.5, 1000, patch), previous).nextState).toBeNull();
    expect(GOLFER_LOCOMOTION_LIMITS).toMatchObject({ maxRecordsPerActor: 1, pendingEvents: 0, retainedCallbacks: 0, routes: 0, clocks: 0 });
  });
  it("detaches plain bounded state and never mutates frozen authority or retains callbacks", () => {
    const input = walk(.1, 200), extra = { mutable: 1 }; Object.assign(input.root, { extra, callback: () => input });
    const before = JSON.stringify(input), result = projectGolferLocomotion(deepFreeze(input));
    expect(JSON.stringify(input)).toBe(before); frozen(result);
    expect(result.root).not.toBe(input.root); expect(Object.keys(result.root!)).toEqual(["x", "y", "heightYards"]);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result); expect(JSON.stringify(result).length).toBeLessThan(2000);
    expect(state(result)).not.toHaveProperty("live"); expect(state(result)).not.toHaveProperty("ground"); expect(state(result)).not.toHaveProperty("queue");
  });
});

describe("local supported stance adjustment on the existing shared clock", () => {
  it.each(["matching", "owner", "cursor", "target", "hand"])("cross-checks the actual focused LIVE source: %s", variant => {
    const s = shot("swing", 0, ground(), true), req = s.at(0);
    const seed = [0, 1, 2, 3, 4, 5, 6, 7].find(value => stableGolferHandedness(value) === "right")!;
    const capabilities = createGolferCapabilities({ seed, personality: { skill: .6, consistency: .6, patience: .5, spendPropensity: .5, prefs: { difficulty: 0, scenery: 0, price: 0 } } });
    const base = createLiveActivitySource(scope, { id: 7, pos: s.root, finished: false, segIndex: 0, segElapsed: .1, capabilities },
      { kind: "flight", from: { x: 5, y: 5 }, to: { x: 9, y: 5 }, dur: 2, holeIndex: 0 })!;
    req.live = focusedLiveActivitySource(base, { actorId: 7, segmentIndex: 0, segmentElapsed: .1, plan: s.plan,
      cursor: req.stance!.playback.cursor, frame: req.stance!.playback.frame, identity: s.plan.identity,
      origin: { point: s.root, heightYards: 0 }, target: { x: 9, y: 5 } }, true);
    expect(req.live?.playback).not.toBeNull();
    if (variant === "owner") req.live = { ...req.live!, owner: { ...req.live!.owner, actorId: "other" } };
    if (variant === "cursor") req.live = { ...req.live!, playback: { ...req.live!.playback!, cursor: { ...req.live!.playback!.cursor, elapsedMs: 1 } } };
    if (variant === "target") req.live = { ...req.live!, targetWorld: { x: 0, y: 1 } };
    if (variant === "hand") req.live = { ...req.live!, handedness: "left" };
    expect(projectGolferLocomotion(req).kind).toBe(variant === "matching" ? "adjust" : "neutral");
  });
  it.each((["swing", "putt"] as const).flatMap(role => Array.from({ length: 8 }, (_, i) => [role, i * 45] as const)))("fits the actual %s contact footprint for world basis %d", (role, degrees) => {
    const s = shot(role, degrees), { result } = finish(s);
    expect(result.feet).toEqual(s.binding.feet); expect(result.arrival?.kind).toBe("validated-adjustment");
  });
  it.each((["swing", "putt"] as const).flatMap(role => [30, 60, 120].map(hz => [role, hz] as const)))("reaches %s F coherently at %d Hz before granting proof", (role, hz) => {
    const s = shot(role), { result, seen, cursor } = finish(s, 1000 / hz), limit = role === "swing" ? 800 : 400;
    expect(seen[0].feet).toEqual(s.root); expect(seen[0].arrival).toBeNull();
    expect(seen.some(frame => frame.kind === "adjust" && frame.feet!.x !== s.root.x && frame.arrival === null)).toBe(true);
    expect(seen.at(-2)).toMatchObject({ reason: "awaiting-arrival-observation", arrival: null });
    expect(result.feet).toEqual(s.binding.feet); expect(result.arrival).toMatchObject({ kind: "validated-adjustment", supportedThroughout: true, gaitExpressed: true, withinExistingPreBackswingWindow: true });
    expect(result.arrival && "elapsedMs" in result.arrival && result.arrival.elapsedMs).toBeLessThanOrEqual(limit);
    for (let i = 1; i < seen.length; i++) {
      const a = state(seen[i - 1]), b = state(seen[i]);
      expect(chord(a.feet, b.feet)).toBeLessThanOrEqual(32 * (b.cursorMs! - a.cursorMs!) / 1000 + 1e-7);
      expect(b.root).toEqual(s.root);
    }
    const planted = sampleGolferStance(s.binding, { currentIdentity: s.identity, launch: s.root, ground: s.at(0).ground, rotation: 0, phase: "address",
      actualFeet: result.feet, arrival: result.arrival, previousPlant: null, walking: null, acquisition: "continuous", paused: false, hidden: false });
    expect(planted.kind).toBe("planted"); expect(cursor.elapsedMs).toBeLessThan(500);
  });
  it.each(ISO_ROTATIONS.flatMap(rotation => ([1, 2, 4] as const).map(operatingTier => [rotation, operatingTier] as const)))("keeps the same world feet/speed at camera %d tier %d", (rotation, operatingTier) => {
    const s = shot("putt"), result = finish(s, 1000 / 60, { rotation, operatingTier }).result;
    expect(result.feet).toEqual(s.binding.feet); expect(result.fastForward).toBe(false);
  });
  it("does not use presentation time or fabricated normalized progress to move adjustment feet", () => {
    const s = shot(), first = state(projectGolferLocomotion(s.at(0)));
    const stationary = projectGolferLocomotion(s.at(0, { presentationTimeMs: 1000 }), first);
    expect(stationary.feet).toEqual(s.root); expect(stationary.stridePhase).toBe(0);
    const req = s.at(100); req.stance = { ...req.stance!, playback: { ...req.stance!.playback, frame: { ...req.stance!.playback.frame, progress: .9 } } };
    expect(projectGolferLocomotion(req, first)).toMatchObject({ kind: "neutral", reason: "invalid-shared-playback" });
  });
  it("starts from an observed B after owner invalidation only if the remaining shared window fits", () => {
    const s = shot(), old = state(projectGolferLocomotion(walk()));
    expect(projectGolferLocomotion(s.at(16), old)).toMatchObject({ kind: "neutral", reason: "state-invalidated", nextState: null });
    const fresh = projectGolferLocomotion(s.at(32));
    expect(fresh).toMatchObject({ kind: "adjust", feet: s.root, arrival: null });
    expect(state(fresh).adjustmentStartMs).toBe(32);
    expect(projectGolferLocomotion(s.at(790))).toMatchObject({ kind: "neutral", reason: "adjustment-window-exceeded" });
  });
  it.each(["swing", "putt"] as const)("uses exactly the existing %s window boundary without adding a dwell", role => {
    const s = shot(role), req = s.at(0), original = req.ground.sweepFootprint, limit = role === "swing" ? 800 : 400;
    const g = { ...req.ground, sweepFootprint: (from: GolferStancePoint, to: GolferStancePoint, budget: number) => ({ ...original(from, to, budget)!, maxProjectedDerivativePx: 32 * limit / 1000 }) };
    let result = projectGolferLocomotion({ ...req, ground: g });
    for (let t = 100; t <= limit; t += 100) result = projectGolferLocomotion(s.at(t, { ground: g, actualFeet: result.feet }), state(result));
    expect(result).toMatchObject({ arrival: null, feet: s.binding.feet, reason: "awaiting-arrival-observation" });
    const arrival = projectGolferLocomotion(s.at(limit, { ground: g, actualFeet: result.feet }), state(result));
    expect(arrival.arrival).toMatchObject({ kind: "validated-adjustment", elapsedMs: limit });
    expect(state(arrival).cursorMs).toBe(limit); expect(state(arrival).adjustmentDurationMs).toBe(limit);
  });
  it.each(["paused", "hidden"] as const)("holds a valid %s adjustment, including accessibility changes", held => {
    const s = shot(), initial = state(projectGolferLocomotion(s.at(0))), moving = projectGolferLocomotion(s.at(100, { actualFeet: initial.feet }), initial);
    const req = s.at(100, { actualFeet: moving.feet, [held]: true, motionEnabled: false });
    expect(projectGolferLocomotion(req, state(moving))).toMatchObject({ kind: "adjust", reason: "held", feet: moving.feet, arrival: null });
    expect(projectGolferLocomotion({ ...req, actualFeet: s.binding.feet }, state(moving))).toMatchObject({ reason: "held-observation-changed", nextState: null });
    expect(projectGolferLocomotion(s.at(101, { ...req, stance: s.at(101).stance }), state(moving)).kind).toBe("neutral");
  });
  it("bookkeeps a long held timestamp without moving adjustment cursor, feet, stride, or proof", () => {
    const s = shot(), first = state(projectGolferLocomotion(s.at(0))), moving = projectGolferLocomotion(s.at(100, { actualFeet: first.feet }), first);
    const held = projectGolferLocomotion(s.at(100, { actualFeet: moving.feet, paused: true, presentationTimeMs: 1000000 }), state(moving));
    expect(held).toMatchObject({ feet: moving.feet, stridePhase: moving.stridePhase, arrival: null, nextState: { cursorMs: 100, observedAtMs: 1000000 } });
    const resume = projectGolferLocomotion(s.at(200, { actualFeet: held.feet, presentationTimeMs: 1000100 }), state(held));
    expect(resume.kind).toBe("adjust"); expect(chord(held.feet!, resume.feet!)).toBeLessThanOrEqual(3.2 + 1e-7);
  });
  it("checks the currently held intermediate footprint before a paused publication", () => {
    const s = shot(), first = state(projectGolferLocomotion(s.at(0))), moving = projectGolferLocomotion(s.at(100, { actualFeet: first.feet }), first);
    const req = s.at(100, { actualFeet: moving.feet, paused: true }), original = req.ground.sampleFootprintAt;
    const g = { ...req.ground, sampleFootprintAt: (x: number, y: number) => ({ ...original(x, y), supportedFootprint: Math.abs(x - (moving.feet!.x + .5)) > 1e-8 }) };
    expect(projectGolferLocomotion({ ...req, ground: g }, state(moving))).toMatchObject({ kind: "neutral", reason: "ground-invalidated", nextState: null });
  });
  it("requires observed F before proof, rejects a teleport, and keeps F planted through watch", () => {
    const s = shot(), initial = state(projectGolferLocomotion(s.at(0)));
    expect(projectGolferLocomotion(s.at(100, { actualFeet: s.binding.feet }), initial)).toMatchObject({ kind: "neutral", reason: "adjustment-observation-mismatch" });
    const { result } = finish(s), previous = state(result); let held = result;
    for (let elapsed = previous.cursorMs! + 100; elapsed < s.plan.durationMs; elapsed += 100) {
      held = projectGolferLocomotion(s.at(Math.min(elapsed, s.plan.durationMs), { actualFeet: s.binding.feet }), state(held));
      expect(held.kind).toBe("planted"); expect(held.feet).toEqual(s.binding.feet); expect(held.arrival).toBe(result.arrival);
    }
    expect(projectGolferLocomotion(s.at(state(held).cursorMs!, { actualFeet: s.root }), state(held))).toMatchObject({ kind: "neutral", reason: "planted-feet-changed" });
  });
  it.each(["reload", "late-acquisition"] as const)("publishes only an explicitly observed settled initial on %s", acquisition => {
    const s = shot(), prior = state(projectGolferLocomotion(s.at(0)));
    expect(projectGolferLocomotion(s.at(3000, { acquisition, actualFeet: s.root }), prior)).toMatchObject({ kind: "neutral", reason: "settled-feet-required" });
    const settled = projectGolferLocomotion(s.at(3000, { acquisition, actualFeet: s.binding.feet }), prior);
    expect(settled).toMatchObject({ kind: "arrived", feet: s.binding.feet, arrival: { kind: "settled-initial" }, strideFrame: 0 });
    expect(projectGolferLocomotion(s.at(3000))).toMatchObject({ kind: "neutral", reason: "continuous-arrival-required" });
  });
  it("accepts a compatible actual arrival at F without inventing a B→F traversal", () => {
    const s = shot(), result = projectGolferLocomotion(s.at(0, { actualFeet: s.binding.feet }));
    expect(result).toMatchObject({ kind: "arrived", arrival: { kind: "compatible-arrival" }, feet: s.binding.feet, strideFrame: 0 });
    expect(projectGolferLocomotion(s.at(0, { motionEnabled: false }))).toMatchObject({ kind: "neutral", reason: "adjustment-motion-disabled" });
  });
  it("can confirm an already completed adjustment when motion is disabled without moving feet", () => {
    const s = shot(), complete = finish(s).seen.at(-2)!, previous = state(complete);
    const result = projectGolferLocomotion(s.at(previous.cursorMs!, { actualFeet: s.binding.feet, motionEnabled: false }), previous);
    expect(result).toMatchObject({ kind: "arrived", feet: s.binding.feet, arrival: { kind: "validated-adjustment" }, stridePhase: complete.stridePhase });
  });
  it.each(["owner", "surface", "candidate", "cursor", "skip", "cull", "key", "role"])("rejects stale/unsupported adjustment %s before a paused hold", variant => {
    const s = shot(), req = s.at(0, { paused: true }), previous = state(projectGolferLocomotion(s.at(0)));
    if (variant === "owner") req.currentOwner = { ...req.owner, shot: { ...req.owner.shot!, seed: 99 } };
    if (variant === "surface") req.surfaceRevision = "surface:2";
    if (variant === "candidate") req.stance = { ...req.stance!, binding: { ...s.binding } as GolferStanceBinding };
    if (variant === "cursor") req.stance = s.at(101).stance;
    if (variant === "skip") req.acquisition = "skip";
    if (variant === "cull") req.culled = true;
    if (variant === "key") req.stance = { ...req.stance!, playback: { ...req.stance!.playback, retainedEvidence: { key: "wrong", validated: true } } };
    if (variant === "role") req.stance = { ...req.stance!, playback: { ...req.stance!.playback, plan: { ...s.plan, kind: "putt" } } };
    expect(projectGolferLocomotion(req, previous)).toMatchObject({ kind: "neutral", nextState: null });
  });
  it.each(["missing", "blocked", "revision", "budget", "sparse-height", "speed-bound", "endpoint"])("requires bounded continuous sweep evidence: %s", variant => {
    const s = shot(), req = s.at(0), original = req.ground.sweepFootprint;
    const sweepFootprint = vi.fn((from: GolferStancePoint, to: GolferStancePoint, budget: number): GolferFootSweepCertificate | null => {
      const good = original(from, to, budget)!;
      if (variant === "missing" || variant === "blocked") return null;
      return { ...good, ...(variant === "revision" ? { surfaceRevision: "surface:2" } : {}), ...(variant === "budget" ? { footprintsTested: 33 } : {}),
        ...(variant === "sparse-height" ? { continuousHeight: false } : {}), ...(variant === "speed-bound" ? { maxProjectedDerivativePx: 0 } : {}),
        ...(variant === "endpoint" ? { from: p(0) } : {}) } as GolferFootSweepCertificate;
    });
    expect(projectGolferLocomotion({ ...req, ground: { ...req.ground, sweepFootprint } })).toMatchObject({ kind: "neutral", reason: "unsupported-adjustment-sweep" });
    expect(sweepFootprint).toHaveBeenCalledTimes(1);
  });
  it("rejects a path that cannot fit 400ms rather than adding dwell or exceeding 32px/s", () => {
    const s = shot("putt"), req = s.at(0), original = req.ground.sweepFootprint;
    const g = { ...req.ground, sweepFootprint: (from: GolferStancePoint, to: GolferStancePoint, budget: number) => ({ ...original(from, to, budget)!, maxProjectedDerivativePx: 13 }) };
    expect(projectGolferLocomotion({ ...req, ground: g })).toMatchObject({ kind: "neutral", reason: "adjustment-window-exceeded" });
    const first = state(projectGolferLocomotion(req));
    expect(projectGolferLocomotion(s.at(200, { actualFeet: first.feet }), first)).toMatchObject({ kind: "neutral", reason: "discontinuous-shared-cursor" });
  });
  it("bounds support queries and detaches adjustment state without retaining its authority", () => {
    const s = shot(), req = s.at(0), before = JSON.stringify(req), g = req.ground;
    vi.mocked(g.sampleFootprintAt).mockClear(); vi.mocked(g.sweepFootprint).mockClear();
    const result = projectGolferLocomotion(deepFreeze(req)); expect(result.kind).toBe("adjust");
    expect(g.sampleFootprintAt).toHaveBeenCalledTimes(3); expect(g.sweepFootprint).toHaveBeenCalledTimes(1);
    expect(vi.mocked(g.sweepFootprint).mock.calls[0][2]).toBe(32); expect(JSON.stringify(req)).toBe(before);
    frozen(result); expect(JSON.parse(JSON.stringify(result))).toEqual(result); expect(JSON.stringify(result).length).toBeLessThan(2800);
    expect(state(result)).not.toHaveProperty("binding"); expect(state(result)).not.toHaveProperty("plan"); expect(state(result)).not.toHaveProperty("ground");
  });
  it("rejects a current ground failure and dishonest continuous height speed bound", () => {
    const s = shot(), first = state(projectGolferLocomotion(s.at(0))), req = s.at(100, { actualFeet: first.feet });
    const original = req.ground.sampleFootprintAt;
    const pointQueries = vi.fn((x: number, y: number) => {
      const result = original(x, y);
      // Candidate endpoints stay unchanged; the path between them has a tall
      // unsupported-by-the-certificate spike. Incremental speed also rejects it.
      const endpoint = Math.abs(x - (s.root.x + .5)) < 1e-8 || Math.abs(x - (s.binding.feet.x + .5)) < 1e-8;
      return { ...result, heightYards: endpoint ? 0 : 20 };
    });
    expect(projectGolferLocomotion({ ...req, ground: { ...req.ground, sampleFootprintAt: pointQueries } }, first)).toMatchObject({ kind: "neutral", reason: "adjustment-speed-exceeded" });
    const failed = { ...req.ground, sampleFootprintAt: () => { throw new Error("ground unavailable"); } };
    expect(projectGolferLocomotion({ ...req, ground: failed }, first)).toMatchObject({ kind: "neutral", nextState: null });
  });
});
