import { describe, expect, it, vi } from "vitest";
import type { PlayerPlayableRound, PlayerProSkills } from "../../game/models/playerProTypes";
import type { caddieShotGuidance } from "../../game/playerPro/playerPro";
import { createCaddieGuidanceSelector } from "./caddieGuidanceSelector";

const skills: PlayerProSkills = { power: 70, driving: 70, irons: 70, shortGame: 70, putting: 70, recovery: 70 };
const round = { id: "r1", phase: "awaiting_shot", currentHoleIndex: 0, ball: { x: 3, y: 4 }, lie: "fairway", course: { shotModel: { version: 1 } }, scorecard: [{ strokes: 0 }] } as unknown as PlayerPlayableRound;

describe("caddie recommendation presentation caching", () => {
  it("reuses the recommendation throughout cursor, phase and committed-seed updates", () => {
    const resolve = vi.fn(() => ({ selection: { club: "Driver" }, preview: {}, shotSlope: null }) as unknown as ReturnType<typeof caddieShotGuidance>);
    const read = createCaddieGuidanceSelector(resolve);
    const first = read(round, skills);
    for (let index = 0; index < 10; index += 1) {
      const checkpoint = { ...round, course: { ...round.course }, phase: "flight", rngCursor: index + 1,
        shotPresentation: { version: 1, shotId: "s1", progress: index / 10 } } as PlayerPlayableRound;
      expect(read(checkpoint, { ...skills })).toBe(first);
    }
    expect(resolve).toHaveBeenCalledOnce();
  });
  it("recomputes for ball, lie, hole, round, skills, loadout and confidence authority changes", () => {
    const resolve = vi.fn(() => ({ selection: {}, preview: {}, shotSlope: null }) as ReturnType<typeof caddieShotGuidance>);
    const read = createCaddieGuidanceSelector(resolve);
    read(round, skills);
    for (const patch of [{ ball: { x: 4, y: 4 } }, { lie: "rough" }, { currentHoleIndex: 1 }, { id: "r2" }, { handedness: "left" }]) {
      read({ ...round, ...patch } as PlayerPlayableRound, skills);
    }
    read(round, { ...skills, power: 71 });
    read({ ...round, performanceLoadout: { testAuthority: 1 } } as unknown as PlayerPlayableRound, skills);
    read({ ...round, confidenceSnapshot: { testAuthority: 1 } } as unknown as PlayerPlayableRound, skills);
    expect(resolve).toHaveBeenCalledTimes(9);
  });
  it("preserves the historical next-shot preview seed boundary for old rounds", () => {
    const resolve = vi.fn(() => ({ selection: {}, preview: {}, shotSlope: null }) as ReturnType<typeof caddieShotGuidance>);
    const read = createCaddieGuidanceSelector(resolve);
    const legacy = { ...round, course: { ...round.course, shotModel: undefined }, rngSeed: 17, rngCursor: 0 };
    read(legacy, skills);
    read({ ...legacy, rngCursor: 1 }, skills);
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});
