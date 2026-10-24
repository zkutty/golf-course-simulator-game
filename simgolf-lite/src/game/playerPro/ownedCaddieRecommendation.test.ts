import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import type { Course } from "../models/types";
import { createGreenRoundSnapshot, normalizeGreenSurfaceV1 } from "../greens/greenSurface";
import * as green from "../greens/greenRollout";
import { caddieRecommendation, createDefaultPlayerPro, ownedCaddieRecommendation, startPlayableRound } from "./playerPro";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function fixture() {
  const width = 24;
  const height = 18;
  const holes = Array.from({ length: 9 }, (_, index) => ({
    id: `owned-${index}`, tee: { x: 2, y: 8 }, green: { x: 10, y: 8 },
    parMode: "MANUAL" as const, parManual: 4 as const,
  }));
  const course: Course = {
    name: "Owned planning", width, height, tiles: Array(width * height).fill("green"),
    elevations: Array.from({ length: width * height }, (_, index) => index % width * .02 + Math.floor(index / width) * .01),
    holes, obstacles: [{ type: "tree", x: 7, y: 8 }], buildings: [], yardsPerTile: 10, baseGreenFee: 60, condition: .9,
    layouts: [{ id: "owned", name: "Owned", draftHoleIds: holes.map(hole => hole.id), publishedHoleIds: holes.map(hole => hole.id),
      roundLength: 9, state: "open", greenFee: 0 }], activeCourseId: "owned",
  };
  const career = createDefaultPlayerPro({ seed: 360037 });
  const started = startPlayableRound({ course, world: { ...DEFAULT_WORLD, runSeed: 360037, playerPro: career }, layoutId: "owned" });
  if (!started.ok) throw new Error(started.reason);
  const round = clone(started.round);
  round.course.greenSnapshot = createGreenRoundSnapshot({
    ...course,
    greenSurface: normalizeGreenSurfaceV1({ tiles: [{ x: 9, y: 8, offsets: Array.from({ length: 16 }, (_, index) => index * 7) }] }, course),
  });
  round.ball = { x: 9.4, y: 8.2 };
  round.lie = "green";
  return { round, skills: career.skills };
}

afterEach(() => vi.restoreAllMocks());

describe("owned score-only caddie suggestions", () => {
  it("matches public selections across fine/coarse greens, recovery, weather, handedness and legacy inputs", () => {
    const { round, skills } = fixture();
    const coarse = clone(round);
    coarse.course.greenSnapshot!.surface.tiles = [];
    expect(round.course.greenSnapshot!.surface.tiles.length).toBeGreaterThan(0);
    expect(coarse.course.greenSnapshot!.surface.tiles).toHaveLength(0);
    const edge = clone(round);
    edge.ball = { x: .25, y: 1 };
    edge.lie = "rough";
    edge.course.obstacles = [{ type: "tree", x: .5, y: 1 }];
    const recovery = clone(round);
    recovery.ball = { x: 6.856643, y: 8.177167 };
    recovery.lie = "fairway";
    const wet = clone(round);
    Object.assign(wet.course.weather!, { rainInches: 1, windMph: 15, paceMultiplier: .9 });
    const legacy = clone(round);
    delete legacy.course.shotModel;
    delete legacy.course.distanceProfile;
    for (const view of [round, coarse, edge, recovery, wet, legacy, { ...round, lie: "unknown" }]) {
      for (const handedness of ["left", "right"] as const) {
        const input = { ...view, handedness };
        const before = JSON.stringify(input);
        const expected = caddieRecommendation(input, skills);
        expect(JSON.stringify(ownedCaddieRecommendation(input, skills))).toBe(JSON.stringify(expected));
        expect(ownedCaddieRecommendation({ ...input, rngSeed: 1, rngCursor: 97 }, skills)).toEqual(expected);
        expect(JSON.stringify(input)).toBe(before);
      }
    }
    // These fixtures exercise different geometry, rather than deleting an unused field.
    expect(caddieRecommendation(round, skills)).not.toEqual(caddieRecommendation(coarse, skills));
    const selected = ownedCaddieRecommendation(round, skills);
    selected.aim.x = -999;
    expect(ownedCaddieRecommendation(round, skills)).toEqual(caddieRecommendation(round, skills));
  });

  it("prepares owned height and rollout once while leaving public sampling and no-club laziness intact", () => {
    const { round, skills } = fixture();
    const full = vi.spyOn(green, "createGreenRolloutSurfaceSampler");
    const height = vi.spyOn(green, "createGreenRolloutHeightSampler");
    const context = vi.spyOn(green, "createGreenRolloutContext");
    const resolve = vi.spyOn(green, "resolveGreenRollout");
    ownedCaddieRecommendation(round, skills);
    expect(full).toHaveBeenCalledTimes(0);
    expect(height).toHaveBeenCalledTimes(1);
    expect(context).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledTimes(0);
    vi.clearAllMocks();
    caddieRecommendation(round, skills);
    expect(full).toHaveBeenCalledTimes(1);
    expect(height).toHaveBeenCalledTimes(0);
    expect(context).toHaveBeenCalledTimes(0);
    expect(resolve.mock.calls.length).toBeGreaterThan(1);
    vi.clearAllMocks();
    ownedCaddieRecommendation({ ...round, lie: "unknown" }, skills);
    for (const spy of [full, height, context, resolve]) expect(spy).toHaveBeenCalledTimes(0);
  });

  it("keeps raw public surface getters, reentry and thrown failures on the original route", () => {
    const { round, skills } = fixture();
    const input = clone(round);
    const events: string[] = [];
    Object.defineProperty(input.course, "greenSnapshot", {
      enumerable: true, configurable: true,
      get() { events.push("surface"); return round.course.greenSnapshot; },
    });
    const rawSkills = { ...skills };
    Object.defineProperty(rawSkills, "power", {
      enumerable: true,
      get() {
        events.push("power");
        input.course.elevations[0] = .25;
        const legacy = clone(round);
        delete legacy.course.shotModel;
        delete legacy.course.distanceProfile;
        caddieRecommendation(legacy, skills);
        events.push("reentry");
        return skills.power;
      },
    });
    expect(caddieRecommendation(input, rawSkills)).toEqual(caddieRecommendation(round, skills));
    expect(events[0]).toBe("surface");
    expect(events).toContain("reentry");
    const failure = new Error("raw-surface");
    Object.defineProperty(input.course, "greenSnapshot", { get() { throw failure; } });
    expect(() => caddieRecommendation(input, skills)).toThrow(failure);
  });
});
