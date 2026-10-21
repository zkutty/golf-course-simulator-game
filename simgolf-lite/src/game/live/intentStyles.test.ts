import { describe, expect, it } from "vitest";
import type { Course } from "../models/types";
import { DEFAULT_WORLD } from "../models/defaults";
import { capabilitiesToPlayerSkills, createGolferCapabilities } from "./capabilities";
import { liveCourseSnapshot, resolveLiveShot } from "./livePhysics";
import type { ShotIntent } from "./m47Types";
import { calculateShotStyleEffects, type ShotStyleId } from "../rules/shotStyles";
import { isValidSharedShotOutcome } from "../rules/contracts";
import { sampleRetainedShotMotion } from "../rules/shotMotion";
import { followUpIntent } from "./strategicOptions";
import { createLiveState, stepLive } from "./simulation";
import { restoreLiveSimulation, snapshotLiveSimulation } from "./persistence";

const personality = { skill: .7, consistency: .7, patience: .5, spendPropensity: .5,
  prefs: { difficulty: 0, scenery: 0, price: 0 } };
const capabilities = { ...createGolferCapabilities({ personality, seed: 776 }),
  power: 80, accuracy: 80, irons: 65, shortGame: 80, recovery: 80 };
const from = { x: 3, y: 10 };
const pin = { x: 40, y: 10 };
const course: Course = { name: "Shared live styles", width: 64, height: 20,
  tiles: new Array(1280).fill("fairway"), elevations: new Array(1280).fill(0),
  holes: [{ id: "styles", tee: from, green: pin, parMode: "MANUAL", parManual: 4 }],
  obstacles: [], buildings: [], yardsPerTile: 10, baseGreenFee: 60, condition: .8 };
function intent(overrides: Partial<ShotIntent> = {}): ShotIntent {
  return { id: "intent", kind: "approach", from, target: pin, club: "7 Iron", power: 1,
    technique: "normal", expectedStrokes: 2, variance: .3, hazardRisk: 0, nextShotQuality: .7,
    facts: [], ...overrides };
}
function shot(selection: ShotIntent, modern = true, lie = "fairway", golfer = capabilities) {
  return resolveLiveShot({ snapshot: liveCourseSnapshot({ course, teeSet: "member", pinRotation: "A",
    modernShotModel: modern, capabilities: golfer }), capabilities: golfer,
    holeId: "styles", shotNumber: 1, from, lie, intent: selection, seed: 39 });
}

describe("ZK1399 explicit styles for ordinary live and AI golfers", () => {
  it.each([
    ["straight_run", "7 Iron", "fairway"], ["high_spin", "7 Iron", "fairway"],
    ["pitch", "Pitching Wedge", "fairway"], ["draw", "7 Iron", "fairway"],
    ["fade", "7 Iron", "fairway"], ["chip", "Chip", "fairway"],
    ["punch", "7 Iron", "fairway"], ["flop", "Sand Wedge", "fairway"], ["putt", "Putter", "green"],
  ] as const)("resolves %s through shared impact and retained motion", (style, club, lie) => {
    const value = shot(intent({ style, club }), true, lie);
    expect(value.shotStyle).toBe(style);
    expect(value.sharedOutcome?.impact?.style).toBe(style);
    expect(value.sharedOutcome?.motion?.identity.style).toBe(style);
    expect(isValidSharedShotOutcome(value.sharedOutcome)).toBe(true);
    expect(sampleRetainedShotMotion(value.sharedOutcome!.motion!, 1)?.point).toEqual(value.sharedOutcome!.physicalRest);
  });

  it("applies pitch's effort conversion once and keeps actor capability carry", () => {
    const pitch = shot(intent({ club: "Pitching Wedge", style: "pitch", power: 1 }));
    const partial = shot(intent({ club: "Pitching Wedge", style: "straight_run", power: .55 }));
    expect(pitch.sharedOutcome!.requestedCarryYards).toBeCloseTo(partial.sharedOutcome!.requestedCarryYards, 6);
    for (const power of [20, 90]) {
      const golfer = { ...capabilities, power };
      const snapshot = liveCourseSnapshot({ course, teeSet: "member", pinRotation: "A", modernShotModel: true, capabilities: golfer });
      const value = shot(intent({ club: "Driver", style: "straight_run" }), true, "fairway", golfer);
      expect(snapshot.distanceProfile?.skills).toEqual(capabilitiesToPlayerSkills(golfer));
      expect(value.sharedOutcome!.requestedCarryYards).toBeCloseTo(snapshot.distanceProfile!.clubCarryYards.driver, 6);
    }
    expect(() => shot(intent({ style: "laser" as ShotStyleId }))).toThrow("Invalid live shot style");
  });

  it("adopts an explicit pitch for AI partial wedge approaches without halving twice", () => {
    const forcedCarry: Course = { ...course, tiles: course.tiles.map((terrain, index) => {
      const x = index % course.width;
      return x >= 38 && x <= 39 ? "water" : x >= 40 && x <= 42 ? "green" : terrain;
    }) };
    const snapshot = liveCourseSnapshot({ course: forcedCarry, teeSet: "member", pinRotation: "A", modernShotModel: true, capabilities });
    const options = [35, 40, 45, 50, 55, 60].map((yards) => followUpIntent({ course: forcedCarry, hole: forcedCarry.holes[0],
      from: { x: pin.x - yards / 10, y: pin.y }, lie: "fairway", capabilities, personality, shotNumber: 2, snapshot }));
    expect(options.every((option) => option.style !== undefined)).toBe(true);
    const chosen = options.find((option) => option.style === "pitch");
    expect(chosen, JSON.stringify(options.map((option) => ({ club: option.club, kind: option.kind, technique: option.technique,
      style: option.style, power: option.power, target: option.target })))).toBeDefined();
    if (!chosen) throw new Error("No AI partial wedge selected Pitch.");
    const full = snapshot.distanceProfile!.clubCarryYards[chosen.club === "Sand Wedge" ? "sand_wedge" : "pitching_wedge"];
    const desired = Math.hypot(chosen.target.x - chosen.from.x, chosen.target.y - chosen.from.y) * course.yardsPerTile / full;
    const styled = calculateShotStyleEffects({ clubId: chosen.club === "Sand Wedge" ? "sand_wedge" : "pitching_wedge",
      lie: "fairway", style: "pitch", power: chosen.power, shortGameSkill: capabilities.shortGame, recoverySkill: capabilities.recovery });
    expect(styled.ok).toBe(true);
    if (styled.ok) expect(styled.value.effectiveSelection.power).toBeCloseTo(Math.min(.6325, Math.max(.25, desired)), 5);
    expect(chosen.facts.some((fact) => fact.detail.startsWith("intent-style:pitch; source:CourseCraft"))).toBe(true);
  });

  it("keeps near-green tee follow-ups on a legal explicit modern club", () => {
    const snapshot = liveCourseSnapshot({ course, teeSet: "member", pinRotation: "A", modernShotModel: true, capabilities });
    const chosen = followUpIntent({ course, hole: course.holes[0], from: { x: 39, y: 10 }, lie: "tee",
      capabilities, personality, shotNumber: 2, snapshot });
    expect(chosen.club).not.toBe("Chip");
    expect(chosen.style).toBeDefined();
    expect(chosen.facts.some((fact) => fact.detail.includes("legal-club:Chip->"))).toBe(true);
  });

  it("normalizes a modern recovery intent and refreshes coherent cached preview facts", () => {
    const snapshot = liveCourseSnapshot({ course, teeSet: "member", pinRotation: "A", modernShotModel: true, capabilities });
    const from = { x: 35, y: 10 };
    const chosen = followUpIntent({ course, hole: course.holes[0], from, lie: "rough",
      capabilities, personality, shotNumber: 2, snapshot });
    expect(chosen.style).toBeDefined();
    expect(chosen.previewSeed).toBeDefined();
    const replay = resolveLiveShot({ snapshot, capabilities, holeId: "styles", shotNumber: 2,
      from, lie: "rough", intent: chosen, seed: chosen.previewSeed! });
    expect(chosen.previewLanding).toEqual(replay.landing);
    expect(chosen.previewRest).toEqual(replay.rest);
    expect(replay.shotStyle).toBe(chosen.style);
  });

  it("keeps historical intent style absent and rejects malformed present styles on reload", () => {
    const legacy = followUpIntent({ course, hole: course.holes[0], from: { x: 36, y: 10 }, lie: "fairway",
      capabilities, personality, shotNumber: 2,
      snapshot: liveCourseSnapshot({ course, teeSet: "member", pinRotation: "A", modernShotModel: false, capabilities }) });
    expect(legacy).not.toHaveProperty("style");
    expect(shot(intent(), false)).not.toHaveProperty("shotStyle");
    const state = createLiveState(course, DEFAULT_WORLD, 2);
    for (let step = 0; state.golfers.length === 0 && step < 2000; step++) stepLive(state, course, 1);
    expect(state.golfers.length).toBeGreaterThan(0);
    state.golfers[0].holePlans = [{ version: 1, holeId: "styles", par: 4, expectedScore: 4,
      chosen: intent({ style: "pitch", club: "Pitching Wedge" }), rejected: [] }];
    const saved = snapshotLiveSimulation({ state, pendingCash: 0, speed: "paused", selectedGolferId: null });
    expect(restoreLiveSimulation(saved)?.state.golfers[0].holePlans?.[0].chosen.style).toBe("pitch");
    for (const style of [null, "laser", 1]) {
      const hostile = structuredClone(saved);
      Object.assign(hostile.state.golfers[0].holePlans![0].chosen, { style });
      expect(restoreLiveSimulation(hostile)).toBeNull();
    }
  });
});
