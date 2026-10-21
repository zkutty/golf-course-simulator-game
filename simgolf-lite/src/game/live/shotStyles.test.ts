import { describe, expect, it } from "vitest";
import type { Course } from "../models/types";
import { createGolferCapabilities } from "./capabilities";
import { liveCourseSnapshot, resolveLiveShot } from "./livePhysics";
import type { ShotIntent } from "./m47Types";

const personality = { skill: .75, consistency: .75, patience: .5, spendPropensity: .5, prefs: { difficulty: 0, scenery: 0, price: 0 } };
const capabilities = createGolferCapabilities({ personality, seed: 776 });
const tee = { x: 2, y: 10 };
const pin = { x: 30, y: 10 };
const course: Course = { name: "Live style compatibility", width: 40, height: 20, tiles: Array(800).fill("fairway"), elevations: Array(800).fill(0),
  holes: [{ id: "one", tee, green: pin, parMode: "MANUAL", parManual: 4 }], obstacles: [], buildings: [], yardsPerTile: 10,
  baseGreenFee: 60, condition: .8 };

function shot(modern = true, overrides: Partial<ShotIntent> = {}, lie = "fairway") {
  const snapshot = liveCourseSnapshot({ course, teeSet: "member", pinRotation: "A", modernShotModel: modern, capabilities });
  const intent: ShotIntent = { id: "candidate", kind: "safe", from: tee, target: { x: 25, y: 10 },
    club: "Driver", technique: "backspin", flightProfile: "high", power: .8,
    expectedStrokes: 3, variance: 1, hazardRisk: .1, nextShotQuality: .7, facts: [], ...overrides };
  return resolveLiveShot({ snapshot, capabilities, holeId: "one", shotNumber: 1, from: tee, lie, intent, seed: 337 });
}

describe("new live style compatibility boundary", () => {
  it("makes Driver/backspin/high explicit as normal/standard and retains the requested choice", () => {
    const fallback = shot();
    const ordinary = shot(true, { technique: "normal", flightProfile: "standard" });
    expect(fallback).toMatchObject({ club: "Driver", technique: "normal", flightProfile: "standard", shotStyle: "straight_run" });
    expect(fallback.facts).toContainEqual({ code: "context", detail: "style-compatibility:requested=Driver/backspin/high;effective=Driver/normal/standard" });
    expect(fallback.landing).toEqual(ordinary.landing);
    expect(fallback.rest).toEqual(ordinary.rest);
    expect(fallback.sharedOutcome).toEqual(ordinary.sharedOutcome);
  });

  it("retains a compatible club's High Spin and required high flight", () => {
    const value = shot(true, { club: "7 Iron", technique: "backspin", flightProfile: "standard" });
    expect(value).toMatchObject({ technique: "backspin", flightProfile: "high", shotStyle: "high_spin" });
    expect(value.facts.some((fact) => fact.detail.startsWith("style-compatibility:"))).toBe(false);
    expect(value.sharedOutcome?.motion?.identity.style).toBe("high_spin");
  });

  it("keeps the unsupported-technique legacy projection and omits modern fallback facts", () => {
    const first = shot(false);
    expect(first).toEqual(shot(false));
    expect(first.technique).toBe("backspin");
    expect(first).not.toHaveProperty("shotStyle");
    expect(first.sharedOutcome).not.toHaveProperty("motion");
    expect(first.facts.some((fact) => fact.detail.startsWith("style-compatibility:"))).toBe(false);
  });

  it("does not mask invalid clubs, unknown techniques, or unplayable club/lie combinations", () => {
    expect(() => shot(true, { club: "Imaginary club" })).toThrow("Invalid live shot selection");
    expect(() => shot(true, { technique: "laser" as ShotIntent["technique"] })).toThrow("Invalid live shot selection");
    expect(() => shot(true, { technique: "normal" }, "rough")).toThrow("club_lie_mismatch");
    expect(() => shot(true, { technique: "normal" }, "water")).toThrow("unplayable_lie");
  });

  it("keeps fallback evidence within the existing facts cap", () => {
    const value = shot(true, { facts: Array.from({ length: 12 }, (_, index) => ({ code: "context", detail: `candidate:${index}` })) });
    expect(value.facts).toHaveLength(12);
    expect(value.facts[11].detail).toContain("requested=Driver/backspin/high");
  });
});
