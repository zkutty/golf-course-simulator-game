import { describe, expect, it } from "vitest";
import { DEFAULT_STATE } from "../../game/gameState";
import { restoreLiveSimulation, snapshotLiveSimulation } from "../live/persistence";
import { createRenderPerfLiveState } from "../live/simulation";
import { createM21BiomeReferenceCourse, createM22VisualReferenceCourse, createParklandVisualReferenceCourse, createRenderPerfCourse, PARKLAND_CAMERA_BOOKMARKS, PARKLAND_VISUAL_SEED } from "./referenceCourse";

describe("M12 render performance fixture", () => {
  it("is a reproducible dressed 18 with 500+ props and 100 concurrent golfers", () => {
    const course = createRenderPerfCourse();
    const live = createRenderPerfLiveState(course, { ...DEFAULT_STATE.world, runSeed: 12160 });
    expect(course.holes).toHaveLength(18);
    expect(course.obstacles.length).toBeGreaterThanOrEqual(500);
    expect(course.obstacles.filter((obstacle) => obstacle.type === "tree").length).toBeGreaterThanOrEqual(500);
    expect(live.golfers).toHaveLength(100);
    expect(live.golfers.every((golfer) => golfer.finished === false)).toBe(true);
  }, 60_000);

  it("snapshots and restores the 100-golfer renderer fixture within a bounded payload", () => {
    const course = createRenderPerfCourse();
    const live = createRenderPerfLiveState(course, { ...DEFAULT_STATE.world, runSeed: 12160 });
    const snapshot = snapshotLiveSimulation({ state: live, pendingCash: 0, speed: "paused", selectedGolferId: null });
    const serialized = JSON.stringify(snapshot);
    const restored = restoreLiveSimulation(JSON.parse(serialized));

    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThan(1_000_000);
    expect(restored?.state.golfers).toHaveLength(100);
    expect(restored?.state.golfers.every((golfer) => golfer.segments.length < 100)).toBe(true);
  });
});

describe("M22 visual release fixtures", () => {
  it("include every decoration, all buildings, valid crossings, and 1,000+ scene objects", () => {
    for (const theme of ["parkland", "links", "desert"] as const) {
      const course = createM22VisualReferenceCourse(theme);
      expect(createM22VisualReferenceCourse(theme)).toEqual(course);
      expect(new Set(course.decorations?.map((decoration) => decoration.kind))).toEqual(new Set(["fence", "bench", "tee_sign", "lamp", "bin", "parked_cart", "flower_bed", "planter", "ornamental_feature", "bridge", "boardwalk"]));
      expect(new Set(course.buildings.map((building) => building.type))).toEqual(new Set(["clubhouse", "pro_shop", "snack_bar", "cart_rental"]));
    }
    const perf = createRenderPerfCourse();
    expect(perf.tiles.length + perf.obstacles.length + (perf.decorations?.length ?? 0) + perf.buildings.length).toBeGreaterThan(1_000);
    expect(perf.decorations?.length).toBeGreaterThanOrEqual(250);
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

describe("M21 biome acceptance fixtures", () => {
  it("are deterministic, theme-distinct, playable, and keep props clear of golf surfaces", () => {
    const fixtures = (["parkland", "links", "desert"] as const).map(createM21BiomeReferenceCourse);
    for (const course of fixtures) {
      expect(createM21BiomeReferenceCourse(course.theme)).toEqual(course);
      expect(course.holes[0].tee).not.toBeNull();
      expect(course.holes[0].green).not.toBeNull();
      expect(course.obstacles.length).toBeGreaterThan(20);
      for (const obstacle of course.obstacles) expect(["rough", "deep_rough", "waste_area"]).toContain(course.tiles[obstacle.y * course.width + obstacle.x]);
    }
    expect(fixtures[0].tiles).not.toEqual(fixtures[1].tiles);
    expect(fixtures[1].tiles).not.toEqual(fixtures[2].tiles);
  });
});
