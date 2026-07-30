import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { ambientMixFor } from "../../audio/environment";
import { buildM49CourseReport } from "../m49/report";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import type { Course, Terrain, WeekResult, World } from "../models/types";
import { activeWeather, createSeasonalState, weatherModifiers } from "../seasons/seasons";
import { seasonalVisualState } from "./seasonalVisualState";

function fixture(overrides: Partial<Course> = {}, worldOverrides: Partial<World> = {}) {
  const width = 12;
  const height = 8;
  const terrains: Terrain[] = ["rough", "fairway", "green", "tee", "sand", "wetland"];
  const course: Course = {
    ...DEFAULT_COURSE,
    width,
    height,
    tiles: Array.from({ length: width * height }, (_, index) => terrains[index % terrains.length]),
    elevations: Array.from({ length: width * height }, () => 0),
    holes: [],
    layouts: [],
    condition: .64,
    theme: "links",
    ...overrides,
  };
  const world: World = {
    ...DEFAULT_WORLD,
    week: 18,
    runSeed: 530_566,
    maintenanceBudget: 180,
    seasonal: createSeasonalState({ runSeed: 530_566, theme: "links", week: 18, day: 3 }),
    ...worldOverrides,
  };
  return { course, world };
}

function snapshot(state: ReturnType<typeof seasonalVisualState>) {
  return {
    climate: state.climate,
    weather: state.weather,
    modifiers: state.modifiers,
    condition: state.condition,
    maintenance: state.maintenance,
    activeLayers: state.activeLayers,
    renderer: state.renderer,
    audio: state.audio,
    nwGreen: state.surfaceAt(1, 1, "green"),
    seGreen: state.surfaceAt(10, 7, "green"),
  };
}

function weekResult(overrides: Partial<WeekResult> = {}): WeekResult {
  return {
    visitors: 120,
    revenue: 8_000,
    costs: 6_000,
    profit: 2_000,
    avgSatisfaction: 76,
    reputationDelta: 1,
    visitorNoise: 0,
    maintenance: { required: 1_240, budget: 910, shortfall: 330 },
    maintenancePressure: { totalWeight: 1_950, avgWeight: 1.15, wear: .37 },
    ...overrides,
  };
}

describe("ZK-566 SeasonalVisualState query", () => {
  it("is honest when no settled weekly maintenance evidence is available", () => {
    const { course, world } = fixture();
    const state = seasonalVisualState({ course, world, day: 3 });
    const weather = activeWeather(world, course, 3);

    expect(state.weather).toEqual(weather);
    expect(state.modifiers).toEqual(weatherModifiers(weather, world.seasonal!.operations.drainageLevel));
    expect(state.climate.calendar.absoluteDay).toBe(weather.absoluteDay);
    expect(state.climate.biome).toBe(course.theme);
    expect(state.maintenance).toMatchObject({
      source: "unavailable",
      budget: world.maintenanceBudget,
      required: null,
      shortfall: null,
    });
    expect(state.condition.wear).toBeCloseTo(1 - course.condition);
    expect(state.maintenance.priorities).toHaveLength(4);
    expect(state.maintenance.priorities.every((priority) => priority.source === "projected-burden")).toBe(true);
    expect(state.activeLayers).not.toContain("maintenance");
    expect(state.surfaceAt(1, 1).zoneId).toBe("NW");
    expect(state.surfaceAt(10, 7).zoneId).toBe("SE");
    const projectedSurface = state.surfaceAt(1, 1);
    expect(projectedSurface.projectedTurfHealth).toBeGreaterThanOrEqual(0);
    expect(projectedSurface.projectedWear).toBeGreaterThanOrEqual(0);
    expect(Object.hasOwn(projectedSurface, "turfHealth")).toBe(false);
    expect(Object.hasOwn(projectedSurface, "wear")).toBe(false);
    expect(["baseline", "watch", "high"]).toContain(projectedSurface.maintenancePriority);
    expect(Object.hasOwn(course, "seasonalVisualState")).toBe(false);
    expect(Object.hasOwn(world, "seasonalVisualState")).toBe(false);
    expect(JSON.stringify({ course, world })).not.toContain("activeLayers");

    const report = buildM49CourseReport({ course, world });
    expect(report.condition.hotSpots.map((zone) => zone.zoneId).sort())
      .toEqual(state.maintenance.priorities.map((zone) => zone.zoneId).sort());
  });

  it("uses exact WeekResult maintenance and wear evidence", () => {
    const { course, world } = fixture();
    const result = weekResult();
    const state = seasonalVisualState({ course, world, day: 3, result });

    expect(state.maintenance).toMatchObject({
      source: "latest-week",
      budget: result.maintenance!.budget,
      required: result.maintenance!.required,
      shortfall: result.maintenance!.shortfall,
    });
    expect(state.condition.wear).toBe(result.maintenancePressure!.wear);
    expect(state.activeLayers).toContain("maintenance");
    expect(state.maintenance.priorities.every((priority) =>
      priority.source === "projected-burden"
      && ["baseline", "watch", "high"].includes(priority.priority)
    )).toBe(true);

    const report = buildM49CourseReport({ course, world, result });
    expect(report.condition).toMatchObject({
      maintenanceBudget: result.maintenance!.budget,
      requiredMaintenance: result.maintenance!.required,
      shortfall: result.maintenance!.shortfall,
      wearPressure: result.maintenancePressure!.wear,
    });
  });

  it("is deterministic across reload, camera rotation, and quality choices", () => {
    const { course, world } = fixture();
    const baseline = snapshot(seasonalVisualState({ course, world, day: 3 }));
    const reloadedCourse = structuredClone(course);
    const reloadedWorld = structuredClone(world);

    for (const rotation of [0, 90, 180, 270]) {
      for (const quality of ["low", "medium", "high"]) {
        void rotation;
        void quality;
        expect(snapshot(seasonalVisualState({
          course: reloadedCourse,
          world: reloadedWorld,
          day: 3,
        }))).toEqual(baseline);
      }
    }
  });

  it("reuses stable queries and invalidates climate, condition, budget, and geometry inputs", () => {
    const { course, world } = fixture();
    const result = weekResult();
    const baseline = seasonalVisualState({ course, world, day: 3, result });
    expect(seasonalVisualState({ course, world, day: 3, result })).toBe(baseline);
    expect(seasonalVisualState({ course, world, day: 4, result })).not.toBe(baseline);
    expect(seasonalVisualState({
      course: { ...course, condition: .3 },
      world,
      day: 3,
      result,
    }).condition.turfHealth).toBeLessThan(baseline.condition.turfHealth);
    expect(seasonalVisualState({
      course,
      world,
      day: 3,
      result: weekResult({ maintenance: { required: 1_240, budget: 1_500, shortfall: -260 } }),
    }).maintenance.shortfall).toBe(-260);
    expect(seasonalVisualState({
      course: { ...course, tiles: course.tiles.map((tile, index) => index < 24 ? "green" : tile) },
      world,
      day: 3,
      result,
    })).not.toBe(baseline);
    expect(seasonalVisualState({
      course: { ...course, width: 8, height: 12 },
      world,
      day: 3,
      result,
    }).surfaceAt(5, 3).zoneId).toBe("NE");
    expect(baseline.surfaceAt(5, 3).zoneId).toBe("NW");
    expect(seasonalVisualState({
      course: { ...course, theme: "desert" },
      world,
      day: 3,
      result,
    }).climate.biome).toBe("desert");
  });

  it("feeds renderer/audio semantics and keeps cached frame lookups bounded", () => {
    const { course, world } = fixture();
    const state = seasonalVisualState({ course, world, day: 3 });
    const mix = ambientMixFor({
      course,
      center: { x: 6, y: 4 },
      dayMinute: 400,
      visibleGolfers: 4,
      paused: false,
      weatherKind: "clear",
      season: "summer",
      seasonalVisualState: {
        audio: { ...state.audio, weatherKind: "storm", season: "winter" },
      },
    });
    expect(mix.bed).toBe("rain");
    expect(state.renderer.sceneTint).toBeGreaterThanOrEqual(0);
    expect(state.renderer.sceneTint).toBeLessThanOrEqual(0xffffff);

    const started = performance.now();
    for (let index = 0; index < 10_000; index++) {
      const x = index % course.width;
      const y = Math.floor(index / course.width) % course.height;
      state.surfaceAt(x, y);
    }
    expect(performance.now() - started).toBeLessThan(50);
  });
});
