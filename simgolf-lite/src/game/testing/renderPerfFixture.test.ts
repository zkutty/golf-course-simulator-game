import { describe, expect, it } from "vitest";
import { DEFAULT_STATE } from "../../game/gameState";
import { createRenderPerfLiveState } from "../live/simulation";
import { createRenderPerfCourse } from "./referenceCourse";

describe("M12 render performance fixture", () => {
  it("is a reproducible dressed 18 with 500+ props and 100 concurrent golfers", () => {
    const course = createRenderPerfCourse();
    const live = createRenderPerfLiveState(course, { ...DEFAULT_STATE.world, runSeed: 12160 });
    expect(course.holes).toHaveLength(18);
    expect(course.obstacles.length).toBeGreaterThanOrEqual(500);
    expect(live.golfers).toHaveLength(100);
    expect(live.golfers.every((golfer) => golfer.finished === false)).toBe(true);
  });
});
