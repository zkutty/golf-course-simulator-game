import { describe, expect, it } from "vitest";
import { DEFAULT_STATE } from "../../game/gameState";
import { createRenderPerfLiveState } from "../live/simulation";
import { createParklandVisualReferenceCourse, createRenderPerfCourse, PARKLAND_CAMERA_BOOKMARKS, PARKLAND_VISUAL_SEED } from "./referenceCourse";

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

describe("M19 visual reference fixture", () => {
  it("is deterministic, complete, and exposes fixed capture bookmarks", () => {
    const first = createParklandVisualReferenceCourse();
    const second = createParklandVisualReferenceCourse();
    expect(first).toEqual(second);
    expect(PARKLAND_VISUAL_SEED).toBe(1900212);
    expect(Object.keys(PARKLAND_CAMERA_BOOKMARKS)).toEqual(["overview50", "hole100", "green200"]);
    expect(new Set(first.tiles)).toEqual(new Set(["rough", "deep_rough", "fairway", "tee", "green", "water", "sand", "path"]));
    expect(first.holes[0]).toMatchObject({ parManual: 4, name: "Founder's Bend" });
  });
});
