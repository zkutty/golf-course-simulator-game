import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { courseWithEffectiveSurfaces } from "../conditions/surfaceCare";
import { liveActivityScope } from "../live/activitySource";
import { createLiveState, stepLive } from "../live/simulation";
import { normalizeCourseLayouts } from "../models/courseLayouts";
import { DEFAULT_WORLD } from "../models/defaults";
import { sampleRetainedShotMotion } from "../rules/shotMotion";
import { createM47CertificationCourse } from "../testing/m47Certification";
import { golferActivityOwnerKey } from "./golferActivity";
import { createLiveGolferGroundAuthority } from "./golferGroundAuthority";
import { ELEVATION_STEP_YARDS } from "../rules/obstacleCollision";
import { ISO_ROTATIONS, isoToWorld, tileCenterIso, worldToIso } from "./iso";
import { groundedGolferFrame } from "./golferGrounding";
import { buildLandscapeComponents, buildVisualHeightfield, type LandscapeComponent } from "./landscapeGeometry";
import { NATURAL_GOLFER_DIRECTIONS, parseNaturalGolferArt, resolveNaturalGolferArt } from "./naturalGolferArt";
import { createGolferStanceBinding, GOLFER_STANCE_LIMITS, NATURAL_GOLFER_CONTACT_MODEL, naturalGolferWorldView, sampleGolferStance } from "./golferStance";
import type { GolferStanceArrivalProof, GolferStanceBinding, GolferStanceFrameRequest, GolferStanceGroundAuthority, GolferStanceIdentity, GolferStancePlant, GolferStancePoint, GolferStanceRequest } from "./golferStance";

const manifest = JSON.parse(readFileSync(new URL("../../../art/natural-golfer-v1/manifest.json", import.meta.url), "utf8"));
const costs = JSON.parse(readFileSync(new URL("../../../art/natural-golfer-v1/cost.json", import.meta.url), "utf8"));
const parsed = parseNaturalGolferArt(manifest, costs);
if (!parsed.ok) throw new Error(parsed.reason);
const artIndex = parsed.index;
const k = 26 / 48;
const owner = { scopeId: "round:[one]", actorId: "golfer:1", shot: { shotId: "shot:4", holeId: "hole:1", shotNumber: 4, seed: 123, club: "iron", style: "normal", modelVersion: "retained-shot-v1" } };
const launch: GolferStancePoint = Object.freeze({ x: 10.25, y: 7.125, heightYards: 7.5 });
const direction = (degrees: number) => ({ x: Math.cos(degrees * Math.PI / 180), y: Math.sin(degrees * Math.PI / 180) });
const identity = (degrees = 45, patch: Partial<GolferStanceIdentity> = {}): GolferStanceIdentity => ({ owner, authorityRevision: "authority:1", surfaceRevision: "surface:1", targetWorld: direction(degrees), handedness: "right", modelVersion: NATURAL_GOLFER_CONTACT_MODEL.modelVersion, role: "swing", ...patch });
const ground = (heightAt: (x: number, y: number) => number = () => launch.heightYards, support: (x: number, y: number) => boolean = () => true, inBounds: (x: number, y: number) => boolean = () => true): GolferStanceGroundAuthority => ({ surfaceRevision: "surface:1", sampleFootprintAt: (x, y) => ({ surfaceRevision: "surface:1", heightYards: heightAt(x, y), supportedFootprint: support(x, y), inBounds: inBounds(x, y) }) });
const request = (degrees = 45, patch: Partial<GolferStanceRequest> = {}): GolferStanceRequest => ({ identity: identity(degrees), launch, artIndex, ground: ground(), ...patch });
function candidate(r = request()): GolferStanceBinding { const result = createGolferStanceBinding(r); if (result.kind !== "candidate") throw new Error(result.reason); return result.binding; }
function proof(binding: GolferStanceBinding, patch: Partial<GolferStanceArrivalProof> = {}): GolferStanceArrivalProof { return { kind: "compatible-arrival", validated: true, bindingKey: binding.key, ...patch } as GolferStanceArrivalProof; }
function frame(binding: GolferStanceBinding, patch: Partial<GolferStanceFrameRequest> = {}): GolferStanceFrameRequest {
  return { currentIdentity: identity(45, { targetWorld: binding.targetWorld, role: binding.role }), launch: binding.launch, ground: ground(), rotation: 0, phase: "address", actualFeet: binding.feet,
    arrival: proof(binding), previousPlant: null, walking: null, acquisition: "continuous", paused: false, hidden: false, ...patch };
}
function plant(binding: GolferStanceBinding, patch: Partial<GolferStanceFrameRequest> = {}) {
  const result = sampleGolferStance(binding, frame(binding, patch));
  if (result.kind !== "planted") throw new Error(result.kind === "neutral" ? result.reason : "unexpected release");
  return result;
}
function nearPoint(actual: { x: number; y: number }, expected: { x: number; y: number }, digits = 10) { expect(actual.x).toBeCloseTo(expected.x, digits); expect(actual.y).toBeCloseTo(expected.y, digits); }
function frozen(value: unknown): void { if (value && typeof value === "object") { expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(frozen); } }

// Independent model oracle, including the original source anchor. The stance
// helper must subtract that anchor rather than include padding/trim/feet pixels.
function authoredTip(degrees: number, anchor = { x: 24, y: 69 }, height = 1) {
  const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return { x: anchor.x + 7.6 * (c + s) + 12 * (c - s), y: anchor.y + 7.6 * (s - c) / 2 + 12 * (c + s) / 2 - height };
}

// Reproduce the existing retained LIVE fixture and exact stage ground; no new
// shot solver, substitute elevation field, or hard-coded synthetic motion.
let retainedM47: ReturnType<typeof m47Fixture> | undefined;
function m47Fixture() {
  const course = normalizeCourseLayouts(createM47CertificationCourse(18));
  const world = Object.assign(structuredClone(DEFAULT_WORLD), { week: 1, cash: 250000, reputation: 95, runSeed: 12160, isBankrupt: false, distressWeeks: 0, mode: "sandbox" as const });
  const live = createLiveState(course, world, 0);
  for (let i = 0; i < 540; i++) stepLive(live, course, .05, world);
  const golfer = live.golfers.find(g => g.id === 1)!;
  const effectiveTiles = courseWithEffectiveSurfaces(course).tiles, field = buildVisualHeightfield(course);
  const components = buildLandscapeComponents(effectiveTiles, course.width, course.height, { cornerRadius: .4, cornerSegments: 4 });
  const componentsByCell: (LandscapeComponent | null)[] = Array(effectiveTiles.length).fill(null);
  for (const component of components) for (const i of component.cells) componentsByCell[i] = component;
  const input = { course, effectiveTiles, field, componentsByCell, quality: "high" as const, surfaceRevision: "m47:high" };
  const ground = createLiveGolferGroundAuthority(input), scope = liveActivityScope(live, world)!;
  const shots = golfer.segments.filter(s => s.motion && s.motion.identity.holeId === "m47-hole-1").slice(0, 3).map(segment => {
    const motion = segment.motion!, target = motion.flight?.geometry.to ?? motion.groundPath[1].point;
    const B = { ...motion.from.point, heightYards: motion.from.heightYards };
    const G = { ...B, heightYards: ground.sampleFootprintAt(B.x + .5, B.y + .5).heightYards };
    const identity: GolferStanceIdentity = { owner: { scopeId: scope.id!, actorId: "1", shot: motion.identity }, authorityRevision: scope.revision,
      surfaceRevision: ground.surfaceRevision, targetWorld: { x: target.x - B.x, y: target.y - B.y }, handedness: "right", modelVersion: NATURAL_GOLFER_CONTACT_MODEL.modelVersion, role: "swing" };
    return { motion, B, G, identity };
  });
  return { live, world, input, ground, shots };
}
function actualM47() { return retainedM47 ??= m47Fixture(); }

describe("physical B / visual G / supported F on the retained M47 course", () => {
  it.each([0, 1, 2])("keeps shot %d's physical ball and exact ground domains separate in every view", index => {
    const f = actualM47(), s = f.shots[index], before = structuredClone({ live: f.live, world: f.world, motion: s.motion });
    expect(s.motion.identity.shotNumber).toBe(index + 1);
    const result = createGolferStanceBinding({ identity: s.identity, launch: s.B, visualGroundLaunch: s.G, ground: f.ground, artIndex });
    if (index === 0) expect(result).toMatchObject({ kind: "neutral", reason: "contact-residual" });
    else expect(result.kind).toBe("candidate");
    // The counterexample is intentional: replacing B with G would falsely
    // approve shot 1. Only the true B/G binding is eligible for publication.
    const visualOnly = candidate({ identity: s.identity, launch: s.G, ground: f.ground, artIndex });
    const b = result.kind === "candidate" ? result.binding : visualOnly;
    const expectedResidual = [2.3255283437048604, .29776797146712397, .4631428502804056][index];
    const expectedFillClearance = [1.3328049896284826, 1.039434638133753, .27852381638622337][index];
    expect(Math.hypot(b.feet.x - s.G.x, b.feet.y - s.G.y)).toBeCloseTo(.24043609558264703, 12);
    const cert = f.ground.sweepFootprint(s.G, b.feet, 32)!;
    expect(cert).toMatchObject({ supportedThroughout: true, continuousHeight: true, inBounds: true, footprintsTested: index === 0 ? 1 : 4 });
    expect(cert.maxProjectedDerivativePx / 32 * 1000).toBeCloseTo([338.04744902885784, 333.97592810969394, 343.0981962894866][index], 7);
    for (const rotation of ISO_ROTATIONS) {
      const sampled = sampleGolferStance(b, { currentIdentity: s.identity, launch: b.physicalBallLaunch, visualGroundLaunch: b.visualGroundLaunch, ground: f.ground,
        rotation, phase: "strike", actualFeet: b.feet, arrival: proof(b), previousPlant: null, walking: null, acquisition: "continuous", paused: false, hidden: false });
      if (sampled.kind !== "planted") throw new Error("supported geometry fixture");
      const g = sampled.geometry, B = tileCenterIso(s.B.x, s.B.y, s.B.heightYards / 2.5, rotation), G = tileCenterIso(s.G.x, s.G.y, s.G.heightYards / 2.5, rotation);
      const oracleTip = authoredTip(g.bodyAngleDegrees, { x: 0, y: 0 });
      nearPoint(g.holderScreen, G);
      nearPoint({ x: G.x + g.localOffset.x + k * oracleTip.x, y: G.y + g.localOffset.y + k * oracleTip.y }, g.actualTip);
      const residual = Math.hypot(g.actualTip.x - B.x, g.actualTip.y - (B.y - k));
      const distance = Math.hypot(g.actualTip.x - B.x, g.actualTip.y - (B.y - 2));
      expect(residual).toBeCloseTo(expectedResidual, 9);
      expect(2.2 - distance).toBeCloseTo(expectedFillClearance, 9);
      expect(distance).toBeLessThan(2.2); expect(distance).toBeLessThan(2.8);
      if (index > 0) {
        nearPoint(g.physicalBallScreen, B); expect(g.residualPx).toBeCloseTo(expectedResidual, 9);
        expect(g.residualPx).toBeLessThanOrEqual(.5); expect(g.insideLiveBallFill && g.insideControlledBallFill).toBe(true);
        expect(b.launch).toBe(b.physicalBallLaunch); expect(b.physicalBallLaunch).toEqual(s.B); expect(b.visualGroundLaunch).toEqual(s.G); frozen(b);
      }
    }
    expect({ live: f.live, world: f.world, motion: s.motion }).toEqual(before);
    for (const progress of [0, .25, .5, 1]) expect(sampleRetainedShotMotion(s.motion, progress)).toEqual(sampleRetainedShotMotion(before.motion, progress));
  });

  it("includes both B/G and grounded F in immutable binding identity and revalidates each domain before a hold", () => {
    const f = actualM47(), s = f.shots[2], b = candidate({ identity: s.identity, launch: s.B, visualGroundLaunch: s.G, ground: f.ground, artIndex });
    const at = (patch: Partial<GolferStanceFrameRequest> = {}): GolferStanceFrameRequest => ({ currentIdentity: s.identity, launch: s.B, visualGroundLaunch: s.G, ground: f.ground,
      rotation: 0, phase: "address", actualFeet: b.feet, arrival: proof(b), previousPlant: null, walking: null, acquisition: "continuous", paused: true, hidden: true, ...patch });
    const changedB = candidate({ identity: s.identity, launch: { ...s.B, heightYards: s.B.heightYards + .001 }, visualGroundLaunch: s.G, ground: f.ground, artIndex });
    expect(changedB.key).not.toBe(b.key);
    expect(sampleGolferStance(b, at({ launch: s.G }))).toMatchObject({ reason: "launch-invalidated" });
    expect(sampleGolferStance(b, at({ visualGroundLaunch: s.B }))).toMatchObject({ reason: "visual-launch-invalidated" });
    expect(sampleGolferStance(b, at({ visualGroundLaunch: undefined }))).toMatchObject({ reason: "visual-launch-invalidated" });
    expect(sampleGolferStance(b, at({ ground: { ...f.ground, surfaceRevision: "replaced" } }))).toMatchObject({ reason: "invalid-ground-authority" });
    const shifted = { ...f.ground, sampleFootprintAt: (x: number, y: number) => ({ ...f.ground.sampleFootprintAt(x, y), heightYards: f.ground.sampleFootprintAt(x, y).heightYards + .001 }) };
    expect(sampleGolferStance(b, at({ ground: shifted }))).toMatchObject({ reason: "ground-invalidated" });
    expect(sampleGolferStance(b, at({ actualFeet: s.G }))).toMatchObject({ reason: "feet-not-at-stance" });
    expect(sampleGolferStance(b, at({ arrival: null }))).toMatchObject({ reason: "arrival-proof-required" });
    for (const visualGroundLaunch of [{ ...s.G, x: s.G.x + .001 }, { ...s.G, heightYards: NaN }]) {
      expect(createGolferStanceBinding({ identity: s.identity, launch: s.B, visualGroundLaunch, ground: f.ground, artIndex })).toMatchObject({ reason: "invalid-visual-launch" });
    }
    for (const patch of [{ inBounds: false }, { supportedFootprint: false }, { heightYards: Infinity }, { surfaceRevision: "old" }]) {
      const g = { ...f.ground, sampleFootprintAt: (x: number, y: number) => ({ ...f.ground.sampleFootprintAt(x, y), ...patch }) };
      expect(createGolferStanceBinding({ identity: s.identity, launch: s.B, visualGroundLaunch: s.G, ground: g, artIndex }).kind).toBe("neutral");
    }
  });

  it.each(["high", "medium", "low"] as const)("uses the exact current %s ground height branch, with support checks unchanged", quality => {
    const f = actualM47(), s = f.shots[2], ground = createLiveGolferGroundAuthority({ ...f.input, quality, surfaceRevision: `m47:${quality}` });
    const G = { ...s.B, heightYards: ground.sampleFootprintAt(s.B.x + .5, s.B.y + .5).heightYards };
    const identity = { ...s.identity, surfaceRevision: ground.surfaceRevision };
    const result = createGolferStanceBinding({ identity, launch: s.B, visualGroundLaunch: G, ground, artIndex });
    expect(result.kind).toBe("candidate");
    if (result.kind !== "candidate") throw new Error(result.reason);
    expect(result.binding.visualGroundLaunch).toEqual(G);
    expect(ground.sweepFootprint(G, result.binding.feet, 32)).not.toBeNull();
  });
});

describe("world contact stance candidate", () => {
  it.each(Array.from({ length: 8 }, (_, i) => i * 45))("shares authored world basis %d with all four camera views", degrees => {
    const binding = candidate(request(degrees));
    for (const rotation of ISO_ROTATIONS) {
      const result = naturalGolferWorldView(direction(degrees + 7), rotation)!;
      expect(result.basisDegrees).toBe(degrees);
      expect(result.direction).toBe(plant(binding, { rotation }).geometry.targetDirection);
      expect(NATURAL_GOLFER_DIRECTIONS[(result.octant + 6) % 8]).toBe(result.direction);
    }
    expect(naturalGolferWorldView(null, 0)).toBeNull(); expect(naturalGolferWorldView({ x: 0, y: 0 }, 0)).toBeNull();
  });
  it.each(["swing", "putt"] as const)("pins actual %s manifest contact rigs and resolves the validated metadata only", role => {
    const b = candidate(request(45, { identity: identity(45, { role }) }));
    for (const dir of NATURAL_GOLFER_DIRECTIONS) {
      const col = role === "swing" ? 5 : 2;
      const actual = manifest.frames.find((f: { clip: string; direction: string; col: number }) => f.clip === role && f.direction === dir && f.col === col);
      expect(actual.contact).toBe(true); expect(actual.rig.hand).toBe("right"); actual.rig.tip.forEach((n: number, i: number) => expect(n).toBeCloseTo([7.6, 12, 1][i], 12));
      const art = resolveNaturalGolferArt(artIndex, { selection: { family: "natural-golfer-v1", identity: "primary-teal-cream-01" }, clip: role, direction: dir, col, handedness: "right" });
      expect(art.kind).toBe("frame");
    }
    expect(b.modelVersion).toBe(manifest.modelVersion); expect(b.requiresArrivalProof).toBe(true);
  });
  it.each((["swing", "putt"] as const).flatMap(role => Array.from({ length: 8 }, (_, i) => [role, i * 45] as const)))("keeps exact world F for %s target %d degrees across all four rotations", (role, degrees) => {
    const b = candidate(request(degrees, { identity: identity(degrees, { role }) }));
    const body = (degrees + 90) % 360, authored = authoredTip(body, { x: 0, y: 0 }, 0);
    const delta = isoToWorld(authored.x * k, authored.y * k);
    nearPoint(b.feet, { x: launch.x - delta.x, y: launch.y - delta.y });
    expect(Math.hypot(b.feet.x - launch.x, b.feet.y - launch.y)).toBeLessThanOrEqual(.35);
    const before = JSON.stringify(b);
    for (const rotation of ISO_ROTATIONS) {
      const result = plant(b, { rotation }), g = result.geometry;
      nearPoint(g.holderScreen, tileCenterIso(launch.x, launch.y, launch.heightYards / 2.5, rotation));
      nearPoint(g.feetScreen, tileCenterIso(b.feet.x, b.feet.y, b.feet.heightYards / 2.5, rotation));
      const expectedBody = (degrees - rotation + 450) % 360, tip = authoredTip(expectedBody, { x: 0, y: 0 });
      nearPoint(g.actualTip, { x: g.feetScreen.x + tip.x * k, y: g.feetScreen.y + tip.y * k });
      nearPoint(g.contactDatum, { x: g.holderScreen.x, y: g.holderScreen.y - k });
      nearPoint(g.actualTip, g.contactDatum); expect(g.residualPx).toBeLessThan(1e-10);
      expect(g.insideLiveBallFill).toBe(true); expect(g.insideControlledBallFill).toBe(true);
      const glyphCenter = { x: g.holderScreen.x, y: g.holderScreen.y - 2 };
      expect(Math.hypot(g.actualTip.x - glyphCenter.x, g.actualTip.y - glyphCenter.y)).toBeCloseTo(2 - k, 10);
      expect(g.targetDirection).toBe(NATURAL_GOLFER_DIRECTIONS[(((degrees - rotation + 360) % 360) / 45 + 7) % 8]);
      const grounded = groundedGolferFrame(b.feet.x, b.feet.y, rotation, () => launch.heightYards / ELEVATION_STEP_YARDS);
      expect(g.feetScreen).toEqual(grounded.screen); expect(g.depth).toBe(grounded.depth);
      nearPoint(g.localOffset, { x: g.feetScreen.x - g.holderScreen.x, y: g.feetScreen.y - g.holderScreen.y });
      // Invert the ground projection independently to prove camera covariance.
      const centerGround = worldToIso(b.feet.x + .5, b.feet.y + .5, 0, rotation);
      nearPoint(isoToWorld(centerGround.x, centerGround.y, rotation), { x: b.feet.x + .5, y: b.feet.y + .5 });
    }
    expect(JSON.stringify(b)).toBe(before);
  });
  it.each([20, 25, 67, 113, 199, 251, 339])( "quantizes off-octant %d once in world space", degrees => {
    const b = candidate(request(degrees)), expected = Math.round(degrees / 45) % 8 * 45;
    expect(b.targetBasisDegrees).toBe(expected);
    const exact = candidate(request(expected)); expect(b.feet).toEqual(exact.feet);
    for (const rotation of ISO_ROTATIONS) expect(plant(b, { rotation }).nextPlant.feet).toBe(b.feet);
  });
  it.each(Array.from({ length: 8 }, (_, i) => 22.5 + i * 45))("uses positive bearing tie at %d with stable either-side targets", boundary => {
    expect(candidate(request(boundary)).targetBasisDegrees).toBe((Math.floor(boundary / 45) + 1) % 8 * 45);
    expect(candidate(request(boundary - .00001)).targetBasisDegrees).toBe(Math.floor(boundary / 45) * 45);
    expect(candidate(request(boundary + .00001)).targetBasisDegrees).toBe((Math.floor(boundary / 45) + 1) % 8 * 45);
  });
  it("is independent of native trim/padding and keeps B and the retained path byte-identical", () => {
    const path = Object.freeze([launch, Object.freeze({ x: 12, y: 9, heightYards: 8 }), Object.freeze({ x: 14, y: 11, heightYards: 7 })]);
    const snapshot = JSON.stringify(path), b = candidate(request(20, { launch: path[0] }));
    const original = authoredTip(90), padded = authoredTip(90, { x: 36, y: 83 });
    nearPoint({ x: original.x - 24, y: original.y - 69 }, { x: padded.x - 36, y: padded.y - 83 });
    for (const rotation of ISO_ROTATIONS) {
      const g = plant(b, { rotation }).geometry;
      expect(g.holderScreen).toEqual(tileCenterIso(path[0].x, path[0].y, path[0].heightYards / 2.5, rotation));
    }
    expect(JSON.stringify(path)).toBe(snapshot); expect(b.launch).toEqual(launch); expect(b.launch).not.toBe(launch);
    const source = readFileSync(new URL("./golferStance.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/referenceFeet|feetRaster|\.trim|\.source|\[24,\s*69\]|\[36,\s*83\]/u);
  });
  it("pins unchanged LIVE and controlled glyph fills used by the overlap proof", () => {
    const live = readFileSync(new URL("../../ui/renderer/scenes/liveEntitiesScene.ts", import.meta.url), "utf8");
    const controlled = readFileSync(new URL("../../ui/renderer/scenes/overlaysDiagnosticsScene.ts", import.meta.url), "utf8");
    expect(live).toMatch(/ball\.circle\(0, -2, 2\.2\)/u);
    expect(controlled).toMatch(/movingBall\.circle\(0, -2, 2\.8\)/u);
  });
  it("copies and deeply freezes geometry without retaining mutable authority or callbacks", () => {
    const mutable = { ...launch }, id = identity(), r = request(45, { launch: mutable, identity: id }), result = createGolferStanceBinding(r);
    expect(result.kind).toBe("candidate"); if (result.kind !== "candidate") throw new Error("fixture");
    frozen(result); const before = JSON.stringify(result);
    mutable.x = 999; (id.targetWorld as { x: number }).x = 99;
    expect(JSON.stringify(result)).toBe(before); expect(JSON.stringify(result)).not.toContain("sampleFootprintAt");
    frozen(plant(result.binding));
    expect(sampleGolferStance({ ...result.binding }, frame(result.binding))).toMatchObject({ kind: "neutral", reason: "invalid-binding" });
  });
});

describe("same-authority ground and contact limits", () => {
  it("samples both tile centers from the same callback, at most twice per call", () => {
    const calls: [number, number][] = [], g = ground((x, y) => { calls.push([x, y]); return launch.heightYards; });
    const b = candidate(request(45, { ground: g }));
    expect(calls).toEqual([[launch.x + .5, launch.y + .5], [b.feet.x + .5, b.feet.y + .5]]);
    calls.length = 0; plant(b, { ground: g }); expect(calls).toHaveLength(2); expect(GOLFER_STANCE_LIMITS.surfaceSamplesPerCall).toBe(2);
  });
  it("accepts a gentle real slope and rejects steep support without moving feet or B vertically", () => {
    const height = (slope: number) => ground(x => launch.heightYards + (x - launch.x - .5) * slope);
    const r = request(45, { ground: height(.2) }), b = candidate(r), g = plant(b, { ground: r.ground }).geometry;
    expect(b.feet.heightYards).toBeCloseTo(launch.heightYards + (b.feet.x - launch.x) * .2, 10);
    expect(g.residualPx).toBeGreaterThan(0); expect(g.residualPx).toBeLessThanOrEqual(.5);
    expect(g.insideLiveBallFill).toBe(true); expect(g.insideControlledBallFill).toBe(true); expect(b.launch).toEqual(launch);
    expect(createGolferStanceBinding(request(45, { ground: height(50) }))).toMatchObject({ kind: "neutral", neutral: "non-gripping", reason: "contact-residual" });
  });
  it.each([-.5, .5])("allows residual boundary %dpx and rejects beyond it", residual => {
    const g = ground(x => x === launch.x + .5 ? launch.heightYards : launch.heightYards + residual / 3.2);
    const b = candidate(request(45, { ground: g })); expect(plant(b, { ground: g }).geometry.residualPx).toBeCloseTo(.5, 10);
    const bad = ground(x => x === launch.x + .5 ? launch.heightYards : launch.heightYards + residual / 3.2 * 1.01);
    expect(createGolferStanceBinding(request(45, { ground: bad }))).toMatchObject({ kind: "neutral", reason: "contact-residual" });
  });
  it.each(["water", "building", "decoration", "unsupported"])("respects existing %s footprint rejection", () => {
    const g = ground(undefined, x => x === launch.x + .5);
    expect(createGolferStanceBinding(request(45, { ground: g }))).toMatchObject({ kind: "neutral", reason: "unsupported-footprint" });
  });
  it("rejects bounds, nonfinite samples, ground mismatch, changed revision, and thrown predicates", () => {
    expect(createGolferStanceBinding(request(45, { ground: ground(undefined, undefined, x => x === launch.x + .5) }))).toMatchObject({ reason: "out-of-bounds" });
    expect(createGolferStanceBinding(request(45, { ground: ground(() => Infinity) }))).toMatchObject({ reason: "invalid-surface-sample" });
    expect(createGolferStanceBinding(request(45, { ground: ground(() => 999) }))).toMatchObject({ reason: "launch-ground-mismatch" });
    expect(createGolferStanceBinding(request(45, { ground: { ...ground(), surfaceRevision: "other" } }))).toMatchObject({ reason: "invalid-ground-authority" });
    expect(createGolferStanceBinding(request(45, { ground: { ...ground(), sampleFootprintAt: () => ({ surfaceRevision: "other", heightYards: 7.5, inBounds: true, supportedFootprint: true }) } }))).toMatchObject({ reason: "surface-revision-mismatch" });
    expect(createGolferStanceBinding(request(45, { ground: { ...ground(), sampleFootprintAt() { throw new Error("authority failed"); } } }))).toMatchObject({ reason: "invalid-surface-sample" });
    const b = candidate(); expect(sampleGolferStance(b, frame(b, { ground: ground(x => x === launch.x + .5 ? 7.5 : 7.51) }))).toMatchObject({ reason: "ground-invalidated" });
  });
  it("rejects missing or copied metadata, unknown hand/model/role/target and invalid B", () => {
    expect(createGolferStanceBinding(request(45, { artIndex: null }))).toMatchObject({ reason: "art-unavailable" });
    expect(createGolferStanceBinding(request(45, { artIndex: { ...artIndex } }))).toMatchObject({ reason: "art-unavailable" });
    for (const handedness of [null, "left"] as const) expect(createGolferStanceBinding(request(45, { identity: identity(45, { handedness }) }))).toMatchObject({ reason: "unsupported-handedness" });
    expect(createGolferStanceBinding(request(45, { identity: identity(45, { modelVersion: "other" }) }))).toMatchObject({ reason: "unsupported-model" });
    expect(createGolferStanceBinding(request(45, { identity: identity(45, { role: "chip" as "swing" }) }))).toMatchObject({ reason: "unsupported-role" });
    for (const targetWorld of [{ x: 0, y: 0 }, { x: NaN, y: 1 }]) expect(createGolferStanceBinding(request(45, { identity: identity(45, { targetWorld }) }))).toMatchObject({ reason: "invalid-identity" });
    expect(createGolferStanceBinding(request(45, { launch: { ...launch, heightYards: NaN } }))).toMatchObject({ reason: "invalid-launch" });
    expect(createGolferStanceBinding(request(45, { identity: identity(45, { owner: { ...owner, shot: null } }) }))).toMatchObject({ reason: "invalid-identity" });
  });
});

describe("arrival, plant/watch hold, and observed walking release", () => {
  it("cannot turn the initial walking destination B into a planted F or claim unobserved continuity", () => {
    const b = candidate();
    expect(sampleGolferStance(b, frame(b, { arrival: null, actualFeet: launch }))).toMatchObject({ kind: "neutral", reason: "arrival-proof-required", nextPlant: null });
    expect(sampleGolferStance(b, frame(b, { actualFeet: launch }))).toMatchObject({ kind: "neutral", reason: "feet-not-at-stance" });
    expect(sampleGolferStance(b, frame(b, { arrival: null }))).toMatchObject({ reason: "arrival-proof-required" });
    expect(sampleGolferStance(b, frame(b, { arrival: proof(b, { bindingKey: "other" }) }))).toMatchObject({ reason: "arrival-proof-incompatible" });
    expect(sampleGolferStance(b, frame(b, { arrival: proof(b, { validated: false as true }) }))).toMatchObject({ reason: "arrival-proof-incompatible" });
  });
  it.each(["swing", "putt"] as const)("accepts only completed, supported %s adjustment evidence within the existing window/speed", role => {
    const b = candidate(request(45, { identity: identity(45, { role }) }));
    const good: GolferStanceArrivalProof = { bindingKey: b.key, validated: true, kind: "validated-adjustment", elapsedMs: role === "swing" ? 800 : 400, maxSpeedPxPerSecond: 32, supportedThroughout: true, gaitExpressed: true, withinExistingPreBackswingWindow: true };
    expect(plant(b, { arrival: good }).nextPlant.arrivalKind).toBe("validated-adjustment");
    for (const patch of [{ elapsedMs: good.elapsedMs + 1 }, { maxSpeedPxPerSecond: 32.001 }, { supportedThroughout: false }, { gaitExpressed: false }, { withinExistingPreBackswingWindow: false }]) {
      expect(sampleGolferStance(b, frame(b, { arrival: { ...good, ...patch } as GolferStanceArrivalProof }))).toMatchObject({ reason: "arrival-proof-incompatible" });
    }
  });
  it("requires settled-initial evidence on reload/late acquisition without replaying adjustment", () => {
    const b = candidate(), settled = proof(b, { kind: "settled-initial" });
    for (const acquisition of ["reload", "late-acquisition"] as const) {
      expect(sampleGolferStance(b, frame(b, { acquisition }))).toMatchObject({ reason: "arrival-proof-incompatible" });
      expect(plant(b, { acquisition, arrival: settled }).nextPlant.arrivalKind).toBe("settled-initial");
      expect(sampleGolferStance(b, frame(b, { acquisition, arrival: settled, actualFeet: launch }))).toMatchObject({ reason: "feet-not-at-stance" });
    }
    expect(sampleGolferStance(b, frame(b, { arrival: settled }))).toMatchObject({ reason: "arrival-proof-incompatible" });
  });
  it("requires fresh settled proof on reload and never borrows a plant from another candidate", () => {
    const b = candidate(), previousPlant = plant(b).nextPlant;
    expect(sampleGolferStance(b, frame(b, { previousPlant, acquisition: "reload", arrival: null }))).toMatchObject({ reason: "arrival-proof-required" });
    expect(sampleGolferStance(b, frame(b, { previousPlant, acquisition: "reload", arrival: proof(b, { kind: "settled-initial" }) })).kind).toBe("planted");
    const replacement = candidate(); expect(replacement.key).toBe(b.key);
    expect(sampleGolferStance(replacement, frame(replacement, { previousPlant, arrival: null, paused: true, actualFeet: null }))).toMatchObject({ reason: "arrival-proof-required" });
  });
  it("holds one planted F through strike/watch, camera changes, pause/hidden; a paused release stays held", () => {
    const b = candidate(), first = plant(b); let previousPlant = first.nextPlant;
    for (const phase of ["strike", "watch"] as const) for (const rotation of ISO_ROTATIONS) {
      const next = plant(b, { phase, rotation, previousPlant, arrival: null });
      expect(next.nextPlant.feet).toBe(b.feet); expect(next.geometry.feetScreen).toEqual(tileCenterIso(b.feet.x, b.feet.y, 3, rotation)); previousPlant = next.nextPlant;
    }
    for (const held of [{ paused: true }, { hidden: true }]) {
      const next = plant(b, { ...held, previousPlant, arrival: null, actualFeet: null, phase: "release" });
      expect(next.phase).toBe("watch"); expect(next.nextPlant).toBe(previousPlant); expect(next.geometry).toEqual(plant(b, { phase: "watch" }).geometry);
    }
    expect(sampleGolferStance(b, frame(b, { previousPlant, arrival: null, actualFeet: null }))).toMatchObject({ reason: "feet-not-at-stance" });
    expect(sampleGolferStance(b, frame(b, { previousPlant: { ...previousPlant } as GolferStancePlant, arrival: null }))).toMatchObject({ reason: "arrival-proof-required" });
  });
  it("releases only to the current observed legal walking feet, never generates a route", () => {
    const b = candidate(), previousPlant = plant(b, { phase: "watch" }).nextPlant, observed: GolferStancePoint = { x: b.feet.x + .1, y: b.feet.y + .1, heightYards: 7.5 };
    const walking = { ownerKey: b.ownerKey, authorityRevision: b.authorityRevision, surfaceRevision: b.surfaceRevision, segmentId: "walk:2", routeRevision: "r:2", currentRouteRevision: "r:2", legal: true as const, feet: observed };
    expect(sampleGolferStance(b, frame(b, { phase: "release", previousPlant, actualFeet: observed }))).toMatchObject({ reason: "walking-authority-required" });
    expect(sampleGolferStance(b, frame(b, { phase: "release", previousPlant, actualFeet: observed, walking }))).toEqual({ kind: "released", neutral: "non-gripping", observedFeet: observed, nextPlant: null });
    for (const patch of [{ ownerKey: "wrong" }, { authorityRevision: "wrong" }, { surfaceRevision: "wrong" }, { currentRouteRevision: "wrong" }, { legal: false }]) {
      expect(sampleGolferStance(b, frame(b, { phase: "release", previousPlant, actualFeet: observed, walking: { ...walking, ...patch } as typeof walking }))).toMatchObject({ reason: "walking-authority-required" });
    }
    expect(sampleGolferStance(b, frame(b, { phase: "release", previousPlant, walking, actualFeet: b.feet }))).toMatchObject({ reason: "walking-authority-required" });
  });
  it("invalidates every full-owner field, revision, target, hand/model and role before hidden/paused publication", () => {
    const b = candidate(), previousPlant = plant(b).nextPlant;
    expect(b.ownerKey).toBe(golferActivityOwnerKey(owner));
    const changes: Partial<GolferStanceIdentity>[] = [
      { owner: { ...owner, scopeId: "other" } }, { owner: { ...owner, actorId: "other" } },
      ...Object.keys(owner.shot).map(key => ({ owner: { ...owner, shot: { ...owner.shot, [key]: typeof owner.shot[key as keyof typeof owner.shot] === "number" ? 999 : "other" } } })),
      { authorityRevision: "other" }, { surfaceRevision: "other" }, { targetWorld: direction(44.99) }, { handedness: "left" }, { modelVersion: "other" }, { role: "putt" },
    ];
    for (const patch of changes) expect(sampleGolferStance(b, frame(b, { currentIdentity: identity(45, patch), previousPlant, arrival: null, paused: true, hidden: true, actualFeet: null }))).toMatchObject({ kind: "neutral", reason: "identity-invalidated", nextPlant: null });
    expect(sampleGolferStance(b, frame(b, { launch: { ...launch, x: launch.x + .0001 }, previousPlant }))).toMatchObject({ reason: "launch-invalidated" });
    expect(sampleGolferStance(b, frame(b, { ground: ground(undefined, () => false), previousPlant, paused: true }))).toMatchObject({ reason: "unsupported-footprint" });
  });
  it("has no scene/gameplay clocks, mutation, path/RNG/audio/completion effects or atlas loading", () => {
    expect(GOLFER_STANCE_LIMITS).toMatchObject({ clocks: 0, routes: 0, retainedCallbacks: 0, maxRadiusTiles: .35, maxContactResidualPx: .5 });
    const source = readFileSync(new URL("./golferStance.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/Date\.|performance\.|requestAnimationFrame|setTimeout|Math\.random|fetch\(|PIXI|\.emit\(|\.dispatch\(|\.push\(|\.splice\(/u);
  });
});
