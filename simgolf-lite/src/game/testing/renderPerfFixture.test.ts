import { describe, expect, it } from "vitest";
import { DEFAULT_STATE } from "../../game/gameState";
import { restoreLiveSimulation, snapshotLiveSimulation } from "../live/persistence";
import { createRenderPerfLiveState } from "../live/simulation";
import { buildLandformShoulders } from "../render/landformGeometry";
import { buildLandscapeComponents, buildVisualHeightfield } from "../render/landscapeGeometry";
import { hashCanonicalValue } from "../../utils/stateHash";
import { createM20TerrainReferenceCourse, createM21BiomeReferenceCourse, createM22VisualReferenceCourse, createM23CourseSetupReferenceCourse, createParklandVisualReferenceCourse, createRenderPerfCourse, PARKLAND_CAMERA_BOOKMARKS, PARKLAND_VISUAL_SEED } from "./referenceCourse";

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
    const reloaded = JSON.parse(JSON.stringify(first));
    expect(hashCanonicalValue(reloaded)).toBe(hashCanonicalValue(first));
    expect(PARKLAND_VISUAL_SEED).toBe(1900212);
    expect(Object.keys(PARKLAND_CAMERA_BOOKMARKS)).toEqual(["overview50", "hole100", "green200"]);
    expect(new Set(first.tiles)).toEqual(new Set(["rough", "deep_rough", "fairway", "tee", "green", "water", "sand", "path"]));
    expect(first.holes[0]).toMatchObject({ parManual: 4, name: "Founder's Bend" });
  });

  it("authors three tile-snapped level transitions and one four-connected cart route", () => {
    const course = createParklandVisualReferenceCourse();
    expect(new Set(course.elevations)).toEqual(new Set([0, 1, 2, 3]));
    const pathComponents = buildLandscapeComponents(course.tiles, course.width, course.height)
      .filter((component) => component.terrain === "path");
    expect(pathComponents).toHaveLength(1);
    expect(pathComponents[0].cells.length).toBeGreaterThan(42);
    const shoulders = buildLandformShoulders(
      buildVisualHeightfield(course),
      course.tiles,
      course.elevations,
      3,
    );
    expect(shoulders.length).toBeGreaterThanOrEqual(3);
    expect(shoulders.every((shoulder) => !shoulder.closed)).toBe(true);
    expect(shoulders.some((shoulder) => shoulder.worldLength > 10)).toBe(true);
  });

  it("keeps one playable route, broad wild margins, readable shelves, and the existing 63 real props", () => {
    const course = createParklandVisualReferenceCourse();
    const m23 = createM23CourseSetupReferenceCourse();
    const m20 = createM20TerrainReferenceCourse();
    expect(createM23CourseSetupReferenceCourse()).toEqual(m23);
    expect(JSON.parse(JSON.stringify(m23))).toEqual(m23);
    expect(m23.tiles).toEqual(course.tiles);
    expect(m23.elevations).toEqual(course.elevations);
    expect(m23.obstacles).toEqual(course.obstacles);
    expect(m20.elevations).toEqual(course.elevations);
    expect(m20.obstacles).toEqual(course.obstacles);

    const components = buildLandscapeComponents(course.tiles, course.width, course.height);
    const fairways = components.filter((component) => component.terrain === "fairway");
    const wild = components.filter((component) => component.terrain === "deep_rough");
    expect(fairways).toHaveLength(1);
    expect(fairways[0].cells).toHaveLength(182);
    expect(wild.map((component) => component.cells.length)).toEqual([38, 125, 112]);
    expect(wild.every((component) => component.cells.length > 1)).toBe(true);
    const at = (x: number, y: number) => course.tiles[y * course.width + x];
    const tee = course.holes[0].tee!;
    const green = course.holes[0].green!;
    expect(at(tee.x, tee.y)).toBe("tee");
    expect(at(green.x, green.y)).toBe("green");
    expect(fairways[0].cells.some((cell) => {
      const x = cell % course.width;
      const y = Math.floor(cell / course.width);
      return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
        .some(([nx, ny]) => nx >= 0 && ny >= 0 && nx < course.width && ny < course.height
          && at(nx, ny) === "tee");
    })).toBe(true);
    expect(fairways[0].cells.some((cell) => {
      const x = cell % course.width;
      const y = Math.floor(cell / course.width);
      return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
        .some(([nx, ny]) => nx >= 0 && ny >= 0 && nx < course.width && ny < course.height
          && at(nx, ny) === "green");
    })).toBe(true);
    expect(new Set(course.elevations)).toEqual(new Set([0, 1, 2, 3]));
    expect(course.elevations[green.y * course.width + green.x]).toBe(3);
    expect(components.filter((component) => component.terrain === "green")).toHaveLength(1);
    expect(components.filter((component) => component.terrain === "green")[0].cells
      .every((cell) => course.elevations[cell] === 3)).toBe(true);
    expect(new Set(fairways[0].cells.map((cell) => course.elevations[cell]))).toEqual(new Set([0, 1, 2, 3]));
    expect([0, 1, 2, 3].map((level) => course.elevations.filter((elevation) => elevation === level).length))
      .toEqual([536, 298, 318, 576]);
    for (let level = 0; level <= 3; level++) {
      const shelf = course.elevations.flatMap((elevation, cell) => elevation === level ? [cell] : []);
      expect(shelf.every((cell) => {
        const x = cell % course.width;
        const y = Math.floor(cell / course.width);
        return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
          .some(([nx, ny]) => nx >= 0 && ny >= 0 && nx < course.width && ny < course.height
            && course.elevations[ny * course.width + nx] === level);
      })).toBe(true);
    }
    expect(course.obstacles).toHaveLength(63);
    expect(course.obstacles.filter((obstacle) => obstacle.type === "tree")).toHaveLength(37);
    expect(course.obstacles.filter((obstacle) => obstacle.type === "bush")).toHaveLength(20);
    expect(course.obstacles.filter((obstacle) => obstacle.type === "rock")).toHaveLength(6);
    expect(new Set(course.obstacles.map((obstacle) => `${obstacle.x},${obstacle.y}`)).size).toBe(63);
    expect(course.obstacles.every((obstacle) => ["rough", "deep_rough"].includes(at(obstacle.x, obstacle.y)))).toBe(true);
    expect(course.obstacles.filter((obstacle) => Math.max(Math.abs(obstacle.x - green.x), Math.abs(obstacle.y - green.y)) <= 8))
      .toHaveLength(12);
    expect(course.holes[0].waypoints).toEqual([{ x: 20, y: 18 }, { x: 31, y: 19 }]);
    expect(course.holes[0].waypoints?.every((point) => at(point.x, point.y) === "fairway")).toBe(true);
    expect(hashCanonicalValue(course.tiles)).toBe("bc725185");
    expect(hashCanonicalValue(course.elevations)).toBe("40a774a5");
    expect(hashCanonicalValue(course.obstacles)).toBe("17415601");
    expect(hashCanonicalValue(course)).toBe("b49496cd");
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
