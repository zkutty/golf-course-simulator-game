import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import type { Course, World } from "../models/types";
import type { DailyWeather } from "../seasons/types";
import { advanceSeasonalDay } from "../seasons/seasons";
import { tickWeek } from "../sim/tickWeek";
import {
  advanceGreenKeepingDay,
  greenKeepingOverview,
  requiredGreenKeepingBudget,
} from "./greenMaintenance";
import {
  createGreenProgram,
  createHealthyGreenLocalState,
  normalizeGreenProgram,
} from "./greenSurface";

function course(): Course {
  const value = structuredClone(DEFAULT_COURSE);
  value.width = 8;
  value.height = 4;
  value.tiles = Array(32).fill("rough");
  value.elevations = Array(32).fill(0);
  value.holes = value.holes.slice(0, 2).map((hole, index) => ({
    ...hole,
    id: `hole-${index + 1}`,
    tee: { x: index * 4, y: 3 },
    green: { x: index * 4 + 1, y: 1 },
  }));
  for (const point of [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 5, y: 1 }, { x: 6, y: 1 }]) {
    value.tiles[point.y * value.width + point.x] = "green";
  }
  value.greenProgram = createGreenProgram("balanced");
  value.greenLocalState = createHealthyGreenLocalState(value);
  return value;
}

function world(overrides: Partial<World> = {}): World {
  return { ...structuredClone(DEFAULT_WORLD), ...overrides };
}

function weather(overrides: Partial<DailyWeather> = {}): DailyWeather {
  return {
    absoluteDay: 7,
    kind: "clear",
    temperatureF: 72,
    windMph: 7,
    rainInches: 0,
    severity: 0.1,
    theme: "parkland",
    season: "spring",
    ...overrides,
  };
}

describe("M62 deterministic greenkeeping programs", () => {
  it("publishes distinct presets and keeps explicit advanced targets authoritative", () => {
    const base = course();
    const receptive = { ...base, greenProgram: createGreenProgram("receptive") };
    const championship = { ...base, greenProgram: createGreenProgram("championship") };
    expect(requiredGreenKeepingBudget(championship)).toBeGreaterThan(requiredGreenKeepingBudget(receptive));

    const custom = normalizeGreenProgram({
      ...createGreenProgram("balanced"),
      preset: "custom",
      targetSpeedFeet: 12.2,
      targetFirmness: 0.81,
      mowingHeightMillimeters: 2.6,
      rollingPasses: 2,
      irrigationTarget: 0.41,
    });
    const customCourse = { ...base, greenProgram: custom };
    const seasonal = advanceSeasonalDay(customCourse, world(), 0);
    expect(seasonal.course.greenProgram).toEqual(custom);
    const committed = advanceGreenKeepingDay({
      course: seasonal.course,
      world: seasonal.world,
      absoluteDay: seasonal.weather.absoluteDay,
      weather: seasonal.weather,
      drainageLevel: 0,
      waterPolicy: "balanced",
      rounds: 12,
    });
    expect(committed.course.greenProgram).toEqual(custom);
    expect(committed.report.preset).toBe("custom");
  });

  it("turns landing and pin traffic into separate bounded local wear and recovers rested greens", () => {
    const base = course();
    const traces = Array.from({ length: 72 }, (_, golferId) => ({
      golferId,
      holeId: "hole-1",
      shotType: "approach" as const,
      from: { x: 1, y: 3 },
      to: { x: 1.25, y: 1.25 },
    }));
    const neglected = world({ maintenanceBudget: 80, staffLevel: 0, staffRoster: [] });
    const first = advanceGreenKeepingDay({
      course: base,
      world: neglected,
      absoluteDay: 7,
      weather: weather(),
      drainageLevel: 0,
      waterPolicy: "conserve",
      rounds: 72,
      shotTraces: traces,
    });
    const hole = first.course.greenLocalState!.holes.find((item) => item.holeId === "hole-1")!;
    const landing = hole.zones!.find((zone) => zone.zone === "landing")!;
    const pin = hole.zones!.find((zone) => zone.zone === "pin")!;
    expect(pin.traffic).toBeGreaterThan(landing.traffic);
    expect(pin.wear).toBeGreaterThan(landing.wear);
    expect(first.report.holes.find((item) => item.holeId === "hole-1")).toMatchObject({
      landingTraffic: 72,
      pinTraffic: 119,
    });

    let rested = first.course;
    for (let day = 8; day <= 14; day++) {
      rested = advanceGreenKeepingDay({
        course: rested,
        world: world({ maintenanceBudget: 3_000, staffLevel: 1 }),
        absoluteDay: day,
        weather: weather({ absoluteDay: day, kind: "rain", rainInches: 0.08 }),
        drainageLevel: 2,
        waterPolicy: "balanced",
        rounds: 0,
        closedHoleIds: ["hole-1"],
      }).course;
    }
    const recovered = rested.greenLocalState!.holes.find((item) => item.holeId === "hole-1")!;
    expect(recovered.health).toBeGreaterThan(hole.health);
    expect(recovered.wear).toBeLessThan(hole.wear);
    expect(recovered.compaction).toBeLessThan(hole.compaction);
  });

  it("responds to budget, staffing, weather, drainage, irrigation, and is idempotent per day", () => {
    const base = { ...course(), greenProgram: createGreenProgram("championship") };
    const dry = advanceGreenKeepingDay({
      course: base,
      world: world({ maintenanceBudget: 0, staffLevel: 0, staffRoster: [] }),
      absoluteDay: 11,
      weather: weather({ absoluteDay: 11, kind: "drought", temperatureF: 99 }),
      drainageLevel: 0,
      waterPolicy: "conserve",
      rounds: 80,
    });
    const supported = advanceGreenKeepingDay({
      course: base,
      world: world({ maintenanceBudget: 4_000, staffLevel: 1 }),
      absoluteDay: 11,
      weather: weather({ absoluteDay: 11, kind: "rain", rainInches: 0.22 }),
      drainageLevel: 3,
      waterPolicy: "irrigate",
      rounds: 10,
    });
    expect(supported.report.averageHealth).toBeGreaterThan(dry.report.averageHealth);
    expect(supported.report.averageMoisture).toBeGreaterThan(dry.report.averageMoisture);
    expect(supported.report.staffCoverage).toBeGreaterThan(dry.report.staffCoverage);
    expect(dry.report.realizedSpeedFeet).not.toBe(dry.course.greenProgram!.targetSpeedFeet);

    const repeated = advanceGreenKeepingDay({
      course: supported.course,
      world: world({ maintenanceBudget: 4_000, staffLevel: 1 }),
      absoluteDay: 11,
      weather: weather({ absoluteDay: 11, kind: "rain", rainInches: 0.22 }),
      drainageLevel: 3,
      waterPolicy: "irrigate",
      rounds: 10,
    });
    expect(repeated.course).toBe(supported.course);
    expect(repeated.course.greenLocalState).toEqual(supported.course.greenLocalState);
  });

  it("reports economy, pace, satisfaction, and realized conditions through weekly simulation", () => {
    const championship = { ...course(), greenProgram: createGreenProgram("championship") };
    const balanced = { ...course(), greenProgram: createGreenProgram("balanced") };
    const championshipResult = tickWeek(championship, world({ maintenanceBudget: 300 }), 412);
    const balancedResult = tickWeek(balanced, world({ maintenanceBudget: 300 }), 412);
    expect(championshipResult.result.greenKeeping).toMatchObject({ days: 7, preset: "championship" });
    expect(championshipResult.result.greenKeeping!.holes).toHaveLength(2);
    expect(championshipResult.result.maintenance!.required).toBeGreaterThan(balancedResult.result.maintenance!.required);
    expect(Number.isFinite(championshipResult.result.greenKeeping!.averagePaceMinutesDelta)).toBe(true);
    expect(Number.isFinite(championshipResult.result.greenKeeping!.averageSatisfactionDelta)).toBe(true);

    const overview = greenKeepingOverview(championshipResult.course, championshipResult.world);
    expect(overview.requiredWeeklyBudget).toBeGreaterThan(0);
    expect(overview.realizedSpeedFeet).toBeGreaterThan(5);
    expect(overview.holes).toHaveLength(2);
  });
});
