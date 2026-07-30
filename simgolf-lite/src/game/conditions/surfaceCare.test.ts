import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import type {
  Course,
  CultivatedTerrain,
  SurfaceCareRecordV1,
  Terrain,
  World,
} from "../models/types";
import {
  biomeClimatePhenologyForDay,
  weatherForDay,
} from "../seasons/seasons";
import type { DailyWeather } from "../seasons/types";
import { TERRAIN_BUILD_COST, themeBuildMult } from "../models/terrainEconomics";
import {
  advanceSurfaceCareDay,
  courseWithEffectiveSurfaces,
  effectiveTerrainForPaintPreview,
  effectiveSurfaceTiles,
  normalizeSurfaceCareState,
  observedSurfaceCareEvidence,
  quoteSurfaceRepair,
  reconcileSurfaceCareAfterEdit,
  resolveEffectiveSurface,
  startSurfaceRepair,
  surfaceCareConditionSummary,
  surfaceCarePresentationSignature,
  surfaceCareQualityForHole,
  surfaceCareTopology,
  surfaceCareVisualSignatures,
  surfaceCareWaterCostMultiplier,
  SURFACE_CARE_BIOME_PRESSURES,
} from "./surfaceCare";
import { liveCourseSnapshot, terrainAt as liveTerrainAt } from "../live/livePhysics";
import { commitDay } from "../live/commitDay";
import { scoreCourseHoles } from "../sim/holes";
import { buildM49CourseReport } from "../m49/report";
import { evaluateTournamentCourseQualification } from "../tournaments/eligibility";
import {
  evaluateStrategicArchitecture,
  strategicGeometryVersion,
} from "../architecture/strategic";

function feature(
  id: string,
  terrain: CultivatedTerrain,
  coverage: number[],
  order: number,
  width = 24,
) {
  const xs = coverage.map((index) => index % width);
  const ys = coverage.map((index) => Math.floor(index / width));
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs) + 1;
  const maxY = Math.max(...ys) + 1;
  return {
    id,
    terrain,
    order,
    coverage,
    geometry: {
      kind: "region" as const,
      ring: [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
      ],
    },
  };
}

function fixture(theme: Course["theme"] = "parkland"): Course {
  const width = 24;
  const height = 16;
  const tiles = new Array<Terrain>(width * height).fill("rough");
  const westGreen: number[] = [];
  const eastGreen: number[] = [];
  const fairway: number[] = [];
  for (let y = 2; y <= 5; y++) {
    for (let x = 2; x <= 5; x++) {
      const index = y * width + x;
      tiles[index] = "green";
      westGreen.push(index);
    }
    for (let x = 18; x <= 21; x++) {
      const index = y * width + x;
      tiles[index] = "green";
      eastGreen.push(index);
    }
  }
  for (let x = 6; x < 18; x++) {
    const index = 8 * width + x;
    tiles[index] = "fairway";
    fairway.push(index);
  }
  tiles[8 * width + 5] = "tee";
  return {
    width,
    height,
    tiles,
    elevations: new Array(width * height).fill(0),
    holes: [{
      id: "hole-1",
      tee: { x: 5, y: 8 },
      green: { x: 3, y: 3 },
      teeBoxes: { member: { x: 5, y: 8 } },
      pinPositions: { A: { x: 3, y: 3 } },
      parMode: "MANUAL",
      parManual: 4,
    }],
    layouts: [{
      id: "course-primary",
      name: "Care Course",
      draftHoleIds: ["hole-1"],
      publishedHoleIds: ["hole-1"],
      roundLength: 9,
      state: "open",
      greenFee: 65,
    }],
    activeCourseId: "course-primary",
    activePinRotation: "A",
    obstacles: [],
    buildings: [],
    decorations: [],
    yardsPerTile: 10,
    name: "Care Course",
    baseGreenFee: 65,
    condition: 1,
    theme,
    surfaceIntent: {
      version: 1,
      nextId: 4,
      features: [
        feature("surface-west-green", "green", westGreen, 1),
        feature("surface-east-green", "green", eastGreen, 2),
        feature("surface-fairway", "fairway", fairway, 3),
      ],
    },
  };
}

function irrigationFixture(area: number, partitions = 1): Course {
  const width = 8;
  const height = 8;
  const safeArea = Math.max(1, Math.min(width * height, Math.floor(area)));
  const safePartitions = Math.max(
    1,
    Math.min(safeArea, Math.floor(partitions)),
  );
  const coverage = Array.from({ length: safeArea }, (_, index) => index);
  const tiles = new Array<Terrain>(width * height).fill("waste_area");
  for (const index of coverage) tiles[index] = "green";
  const features = Array.from({ length: safePartitions }, (_, partition) => {
    const start = Math.floor(partition * coverage.length / safePartitions);
    const end = Math.floor((partition + 1) * coverage.length / safePartitions);
    return feature(
      `irrigation-${partition}`,
      "green",
      coverage.slice(start, end),
      partition + 1,
      width,
    );
  });
  return {
    ...fixture(),
    width,
    height,
    tiles,
    elevations: new Array(width * height).fill(0),
    holes: [],
    layouts: [{
      id: "irrigation-course",
      name: "Irrigation Course",
      draftHoleIds: [],
      publishedHoleIds: [],
      roundLength: 9,
      state: "closed",
      greenFee: 0,
    }],
    activeCourseId: "irrigation-course",
    surfaceIntent: {
      version: 1,
      nextId: safePartitions + 1,
      features,
    },
    estate: undefined,
    property: undefined,
  };
}

function highServiceWorld(): World {
  return {
    ...DEFAULT_WORLD,
    cash: 100_000,
    maintenanceBudget: 100_000,
    staffLevel: 5,
    staffRoster: [{
      ...DEFAULT_WORLD.staffRoster![0],
      proficiency: 1,
    }],
    seasonal: {
      ...DEFAULT_WORLD.seasonal!,
      operations: {
        ...DEFAULT_WORLD.seasonal!.operations,
        turfPriority: "recovery",
        waterPolicy: "irrigate",
      },
    },
  };
}

function clearWeather(
  course: Course,
  absoluteDay: number,
  overrides: Partial<DailyWeather> = {},
): DailyWeather {
  return {
    absoluteDay,
    kind: "clear",
    temperatureF: 72,
    windMph: 8,
    rainInches: 0,
    severity: 0.08,
    theme: course.theme ?? "parkland",
    season: "summer",
    ...overrides,
  };
}

function advance(
  course: Course,
  world: World,
  absoluteDay: number,
  overrides: Partial<Parameters<typeof advanceSurfaceCareDay>[0]> = {},
) {
  return advanceSurfaceCareDay({
    course,
    world,
    absoluteDay,
    weather: clearWeather(course, absoluteDay),
    climate: biomeClimatePhenologyForDay(course.theme ?? "parkland", absoluteDay),
    turfPriority: "playability",
    waterPolicy: "irrigate",
    drainageLevel: 1,
    rounds: 0,
    ...overrides,
  });
}

function recordFor(course: Course, surfaceId: string): SurfaceCareRecordV1 {
  const state = normalizeSurfaceCareState(course.surfaceCare, course);
  const record = Object.values(state?.records ?? {}).find((item) => item.surfaceId === surfaceId);
  if (!record) throw new Error(`Missing ${surfaceId}`);
  return record;
}

function withActiveResod(course: Course, world: World): Course {
  const initialized = advance(course, world, 0).course;
  const state = normalizeSurfaceCareState(initialized.surfaceCare, initialized)!;
  return {
    ...initialized,
    surfaceCare: {
      ...state,
      records: Object.fromEntries(
        Object.entries(state.records).map(([key, record]) => [
          key,
          {
            ...record,
            turfHealth: 0.12,
            failureDurationDays: 7,
            repairRequired: true,
            repairProgress: 0,
            repair: {
              kind: "resod" as const,
              cost: 1_000,
              requiredDays: 8,
              progressDays: 0,
              startedAbsoluteDay: 1,
              elevatedWaterDaysRemaining: 8,
            },
          },
        ]),
      ),
    },
  };
}

describe("ZK-647 local cultivated-surface care authority", () => {
  it("uses M35 identities plus deterministic legacy component/cell fallbacks", () => {
    const course = fixture();
    const first = surfaceCareTopology(course);
    const second = surfaceCareTopology(structuredClone(course));
    expect(first.zones.map((zone) => [zone.key, zone.cells])).toEqual(
      second.zones.map((zone) => [zone.key, zone.cells]),
    );
    expect(first.zones.some((zone) => zone.surfaceId === "surface-west-green")).toBe(true);
    expect(first.zones.some((zone) => zone.surfaceId.startsWith("legacy-tee-"))).toBe(true);
    expect(first.zones.every((zone) => zone.cells.length <= 64)).toBe(true);
    expect(first.zoneByTile).toHaveLength(course.width * course.height);
  });

  it("loses stripes near day two, becomes effectively overgrown in 7–10 days, and severe in 2–3 weeks", () => {
    let course = fixture();
    const world = { ...DEFAULT_WORLD, maintenanceBudget: 0, staffLevel: 0, staffRoster: [] };
    for (let day = 0; day < 2; day++) course = advance(course, world, day).course;
    expect(recordFor(course, "surface-west-green").mowingQuality).toBeLessThan(0.86);
    expect(resolveEffectiveSurface(course, 3, 3).effectiveTerrain).toBe("green");

    for (let day = 2; day < 8; day++) course = advance(course, world, day).course;
    expect(recordFor(course, "surface-west-green").missedMowingDays).toBe(8);
    expect(resolveEffectiveSurface(course, 3, 3)).toMatchObject({
      intendedTerrain: "green",
      effectiveTerrain: "fairway",
      treatment: "overgrown",
    });

    for (let day = 8; day < 18; day++) course = advance(course, world, day).course;
    expect(resolveEffectiveSurface(course, 3, 3).effectiveTerrain).toBe("rough");
    const neglectedHealth = recordFor(course, "surface-west-green").turfHealth;

    const funded = {
      ...DEFAULT_WORLD,
      maintenanceBudget: 20_000,
      staffLevel: 5,
      staffRoster: [{
        ...DEFAULT_WORLD.staffRoster![0],
        proficiency: 1,
      }],
    };
    course = advance(course, funded, 18).course;
    expect(recordFor(course, "surface-west-green").missedMowingDays).toBeLessThan(18);
    course = advance(course, funded, 19).course;
    expect(recordFor(course, "surface-west-green").missedMowingDays).toBeLessThan(8);
    expect(resolveEffectiveSurface(course, 3, 3).effectiveTerrain).toBe("green");
    expect(recordFor(course, "surface-west-green").turfHealth)
      .toBeLessThanOrEqual(neglectedHealth + 0.01);
    course = advance(course, funded, 20).course;
    expect(recordFor(course, "surface-west-green").mowingQuality).toBeGreaterThan(0.95);
  });

  it("creates local divergence from observed traffic inside one biome", () => {
    const course = fixture();
    const world = { ...DEFAULT_WORLD, maintenanceBudget: 240, staffLevel: 1 };
    const result = advance(course, world, 4, {
      rounds: 12,
      shotTraces: Array.from({ length: 12 }, (_, golferId) => ({
        golferId,
        holeId: "hole-1",
        shotType: "approach" as const,
        from: { x: 9, y: 8 },
        to: { x: 3, y: 3 },
      })),
    });
    const west = recordFor(result.course, "surface-west-green");
    const east = recordFor(result.course, "surface-east-green");
    expect(west.lastTraffic).toBeGreaterThan(east.lastTraffic);
    expect(west.wear).toBeGreaterThan(east.wear);
    expect(observedSurfaceCareEvidence(result.course).some(
      (item) => item.surfaceId === "surface-west-green" && item.traffic > east.lastTraffic,
    )).toBe(true);
  });

  it("models drought failure over weeks but never turns authoritative dormancy into death", () => {
    let desert = fixture("desert");
    const noCare = { ...DEFAULT_WORLD, maintenanceBudget: 0, staffLevel: 0, staffRoster: [] };
    for (let day = 0; day < 36; day++) {
      desert = advance(desert, noCare, day, {
        weather: clearWeather(desert, day, {
          kind: "drought",
          temperatureF: 105,
          windMph: 20,
          severity: 0.8,
        }),
        waterPolicy: "conserve",
      }).course;
    }
    const failed = recordFor(desert, "surface-west-green");
    expect(failed.insufficientWaterDays).toBeGreaterThanOrEqual(28);
    expect(failed.turfHealth).toBeLessThan(0.2);
    expect(failed.repairRequired).toBe(true);
    expect(resolveEffectiveSurface(desert, 3, 3).treatment).toBe("bare");
    expect(desert.tiles[3 * desert.width + 3]).toBe("green");

    let alpineLike = fixture();
    const funded = { ...DEFAULT_WORLD, maintenanceBudget: 20_000, staffLevel: 5 };
    for (let day = 0; day < 42; day++) {
      const climate = biomeClimatePhenologyForDay("parkland", day);
      alpineLike = advance(alpineLike, funded, day, {
        climate: {
          ...climate,
          vegetation: {
            ...climate.vegetation,
            dormancy: 0.95,
          },
        },
        weather: clearWeather(alpineLike, day, {
          kind: "frost",
          temperatureF: 28,
          severity: 0.6,
        }),
        waterPolicy: "balanced",
      }).course;
    }
    const dormant = recordFor(alpineLike, "surface-west-green");
    expect(dormant.dormancy).toBe(0.95);
    expect(dormant.turfHealth).toBeGreaterThan(0.85);
    expect(dormant.repairRequired).toBe(false);
  });

  it("quotes exact repair economics/timing and restores failed turf only through a task", () => {
    let course = advance(fixture(), DEFAULT_WORLD, 0).course;
    const zone = surfaceCareTopology(course).zones.find(
      (candidate) => candidate.surfaceId === "surface-west-green",
    )!;
    const state = normalizeSurfaceCareState(course.surfaceCare, course)!;
    course = {
      ...course,
      surfaceCare: {
        ...state,
        records: {
          ...state.records,
          [zone.key]: {
            ...state.records[zone.key],
            turfHealth: 0.12,
            failureDurationDays: 7,
            repairRequired: true,
          },
        },
      },
    };
    const reseed = quoteSurfaceRepair(course, DEFAULT_WORLD, zone.key, "reseed")!;
    const resod = quoteSurfaceRepair(course, DEFAULT_WORLD, zone.key, "resod")!;
    const construction = TERRAIN_BUILD_COST.green
      * themeBuildMult(course.theme, "green")
      * zone.cells.length;
    expect(reseed.cost).toBe(Math.round(construction * 0.35));
    expect(resod.cost).toBe(Math.round(construction * 0.6));
    expect(reseed.requiredDays).toBeGreaterThanOrEqual(14);
    expect(reseed.requiredDays).toBeLessThanOrEqual(28);
    expect(resod.requiredDays).toBeGreaterThanOrEqual(5);
    expect(resod.requiredDays).toBeLessThanOrEqual(10);

    const started = startSurfaceRepair(
      course,
      { ...DEFAULT_WORLD, cash: 100_000, maintenanceBudget: 20_000, staffLevel: 5 },
      zone.key,
      "resod",
      1,
    );
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.world.cash).toBe(100_000 - resod.cost);
    expect(started.course.surfaceCare!.records[zone.key].repair?.elevatedWaterDaysRemaining)
      .toBeGreaterThan(0);
    expect(observedSurfaceCareEvidence(started.course).find(
      (item) => item.key === zone.key,
    )?.action).toBe("Continue resod establishment");
    const baselineCourse: Course = {
      ...started.course,
      surfaceCare: {
        ...started.course.surfaceCare!,
        records: {
          ...started.course.surfaceCare!.records,
          [zone.key]: {
            ...started.course.surfaceCare!.records[zone.key],
            repair: undefined,
            repairProgress: 0,
          },
        },
      },
    };
    const reactions = {
      rounds: 0,
      avgSatisfaction: 0,
      promoters: 0,
      detractors: 0,
      willReturnRate: 0.5,
    };
    const activeEconomy = commitDay({
      course: started.course,
      world: started.world,
      revenue: 0,
      reactions,
      dayIndex: 1,
    });
    const baselineEconomy = commitDay({
      course: baselineCourse,
      world: started.world,
      revenue: 0,
      reactions,
      dayIndex: 1,
    });
    expect(activeEconomy.result.surfaceCare!.elevatedWaterDemand).toBeGreaterThan(0);
    expect(activeEconomy.result.surfaceCare!.elevatedWaterApplied).toBeGreaterThan(0);
    expect(activeEconomy.result.biomeEconomy!.waterCost)
      .toBeGreaterThan(baselineEconomy.result.biomeEconomy!.waterCost);
    expect(activeEconomy.world.cash).toBeLessThan(baselineEconomy.world.cash);

    course = started.course;
    const elevatedDays = course.surfaceCare!.records[zone.key]
      .repair!.elevatedWaterDaysRemaining;
    let stalledReport: ReturnType<typeof advance>["report"] | undefined;
    const stalledWorld = {
      ...started.world,
      maintenanceBudget: 0,
      staffLevel: 0,
      staffRoster: [],
    };
    for (let day = 1; day <= 3; day++) {
      const stalled = advance(course, stalledWorld, day, {
        weather: clearWeather(course, day, {
          kind: "frost",
          temperatureF: 28,
          severity: 0.5,
        }),
        turfPriority: "recovery",
      });
      course = stalled.course;
      stalledReport = stalled.report;
      expect(course.surfaceCare!.records[zone.key].repair?.progressDays).toBe(0);
      expect(course.surfaceCare!.records[zone.key].repair?.elevatedWaterDaysRemaining)
        .toBe(elevatedDays);
    }
    expect(stalledReport!.elevatedWaterDemand).toBeGreaterThan(0);
    expect(stalledReport!.elevatedWaterApplied).toBeGreaterThan(0);
    expect(surfaceCareWaterCostMultiplier(stalledReport!)).toBeGreaterThan(1);

    let actualEstablishmentDays = 0;
    let day = 4;
    while (course.surfaceCare!.records[zone.key].repair && day < 40) {
      const before = course.surfaceCare!.records[zone.key].repair!.progressDays;
      const resumed = advance(course, started.world, day, {
        turfPriority: "recovery",
      });
      course = resumed.course;
      const after = course.surfaceCare!.records[zone.key].repair?.progressDays
        ?? resod.requiredDays;
      actualEstablishmentDays += after - before;
      if (actualEstablishmentDays < resod.requiredDays) {
        expect(course.surfaceCare!.records[zone.key].repair).toBeDefined();
      }
      day++;
    }
    expect(actualEstablishmentDays).toBe(resod.requiredDays);
    const restored = recordFor(course, "surface-west-green");
    expect(restored.repair).toBeUndefined();
    expect(restored.repairRequired).toBe(false);
    expect(restored.turfHealth).toBeGreaterThanOrEqual(0.95);
  });

  it("reports resod irrigation as area volume while moisture remains depth-based", () => {
    const world = highServiceWorld();
    const oneTile = advance(
      withActiveResod(irrigationFixture(1), world),
      world,
      1,
    );
    const sixtyFourTiles = advance(
      withActiveResod(irrigationFixture(64), world),
      world,
      1,
    );
    expect(
      sixtyFourTiles.report.elevatedWaterDemand
      / oneTile.report.elevatedWaterDemand,
    ).toBeCloseTo(64, 1);
    expect(
      sixtyFourTiles.report.elevatedWaterApplied
      / oneTile.report.elevatedWaterApplied,
    ).toBeCloseTo(64, 1);
    expect(recordFor(sixtyFourTiles.course, "irrigation-0").moisture)
      .toBe(recordFor(oneTile.course, "irrigation-0").moisture);
  });

  it("keeps equal-acreage resod water multipliers and live cash invariant across zone splits", () => {
    const world = highServiceWorld();
    const mergedCourse = withActiveResod(irrigationFixture(64, 1), world);
    const splitCourse = withActiveResod(irrigationFixture(64, 4), world);
    const merged = advance(mergedCourse, world, 1);
    const split = advance(splitCourse, world, 1);
    expect(split.report.totalIrrigationDemand)
      .toBeCloseTo(merged.report.totalIrrigationDemand, 4);
    expect(split.report.totalIrrigationApplied)
      .toBeCloseTo(merged.report.totalIrrigationApplied, 4);
    expect(split.report.elevatedWaterApplied)
      .toBeCloseTo(merged.report.elevatedWaterApplied, 4);
    expect(surfaceCareWaterCostMultiplier(split.report))
      .toBe(surfaceCareWaterCostMultiplier(merged.report));

    const reactions = {
      rounds: 0,
      avgSatisfaction: 0,
      promoters: 0,
      detractors: 0,
      willReturnRate: 0.5,
    };
    const mergedLive = commitDay({
      course: mergedCourse,
      world,
      revenue: 0,
      reactions,
      dayIndex: 1,
    });
    const splitLive = commitDay({
      course: splitCourse,
      world,
      revenue: 0,
      reactions,
      dayIndex: 1,
    });
    expect(splitLive.result.biomeEconomy!.waterCost)
      .toBeCloseTo(mergedLive.result.biomeEconomy!.waterCost, 8);
    expect(splitLive.world.cash).toBeCloseTo(mergedLive.world.cash, 8);
  });

  it("does not let a tiny healthy zone materially dilute a large resod surcharge", () => {
    const world = highServiceWorld();
    const resod = advance(
      withActiveResod(irrigationFixture(64), world),
      world,
      1,
    ).report;
    const healthyDayZero = advance(irrigationFixture(1), world, 0).course;
    const healthy = advance(healthyDayZero, world, 1).report;
    const resodMultiplier = surfaceCareWaterCostMultiplier(resod);
    const withTinyHealthyZone = surfaceCareWaterCostMultiplier({
      totalIrrigationApplied:
        resod.totalIrrigationApplied + healthy.totalIrrigationApplied,
      elevatedWaterApplied: resod.elevatedWaterApplied,
    });
    expect(withTinyHealthyZone).toBeGreaterThan(1.3);
    expect(resodMultiplier - withTinyHealthyZone).toBeLessThan(0.01);
  });

  it("reconciles exact repaint, expansion, split, merge, terrain replacement, and undo/redo snapshots", () => {
    let course = advance(fixture(), DEFAULT_WORLD, 0).course;
    const state = normalizeSurfaceCareState(course.surfaceCare, course)!;
    const westZone = surfaceCareTopology(course).zones.find(
      (zone) => zone.surfaceId === "surface-west-green",
    )!;
    const originalCoverage = course.surfaceIntent!.features.find(
      (item) => item.id === "surface-west-green",
    )!.coverage;
    course = {
      ...course,
      surfaceCare: {
        ...state,
        records: {
          ...state.records,
          [westZone.key]: {
            ...state.records[westZone.key],
            turfHealth: 0.2,
            mowingQuality: 0.2,
            missedMowingDays: 11,
            repairRequired: true,
            repairProgress: 0.25,
            repair: {
              kind: "resod",
              cost: 1_200,
              requiredDays: 8,
              progressDays: 2,
              startedAbsoluteDay: 0,
              elevatedWaterDaysRemaining: 6,
            },
          },
        },
      },
    };

    // An identity-only repaint with identical terrain and coverage retains the
    // full paid task, even though its deterministic sparse key changes.
    const repainted = structuredClone(course);
    repainted.surfaceIntent!.features = repainted.surfaceIntent!.features.map((surface) =>
      surface.id === "surface-west-green"
        ? { ...surface, id: "surface-west-repainted" }
        : surface
    );
    const reconciled = reconcileSurfaceCareAfterEdit(course, repainted);
    const carried = recordFor(reconciled, "surface-west-repainted");
    expect(carried).toMatchObject({
      turfHealth: 0.2,
      mowingQuality: 0.2,
      missedMowingDays: 11,
      repairRequired: true,
      repair: {
        kind: "resod",
        cost: 1_200,
        progressDays: 2,
      },
    });

    // Expanded coverage keeps exact overlap and seeds only the added cells
    // from the course's current condition. It cannot enlarge a paid task.
    const addedCoverage = Array.from({ length: 8 }, (_, offset) => {
      const x = 6 + offset % 2;
      const y = 2 + Math.floor(offset / 2);
      return y * course.width + x;
    });
    const expanded = structuredClone(course);
    for (const index of addedCoverage) expanded.tiles[index] = "green";
    expanded.surfaceIntent!.features = expanded.surfaceIntent!.features.map((surface) =>
      surface.id === "surface-west-green"
        ? feature(
          surface.id,
          "green",
          [...originalCoverage, ...addedCoverage].sort((a, b) => a - b),
          surface.order,
        )
        : surface
    );
    const expandedReconciled = reconcileSurfaceCareAfterEdit(course, expanded);
    const expandedRecord = recordFor(expandedReconciled, "surface-west-green");
    expect(expandedRecord.area).toBe(24);
    expect(expandedRecord.turfHealth).toBeCloseTo(
      (originalCoverage.length * 0.2 + addedCoverage.length * course.condition) / 24,
      4,
    );
    expect(expandedRecord.repairRequired).toBe(true);
    expect(expandedRecord.repair).toBeUndefined();

    // A split carries the overlapping neglect into both children without
    // duplicating the paid task.
    const splitTarget = structuredClone(course);
    const firstHalf = originalCoverage.slice(0, originalCoverage.length / 2);
    const secondHalf = originalCoverage.slice(originalCoverage.length / 2);
    splitTarget.surfaceIntent!.features = splitTarget.surfaceIntent!.features.flatMap((surface) =>
      surface.id === "surface-west-green"
        ? [
          feature("surface-west-a", "green", firstHalf, surface.order),
          feature("surface-west-b", "green", secondHalf, surface.order + 1),
        ]
        : [surface]
    );
    const split = reconcileSurfaceCareAfterEdit(course, splitTarget);
    for (const id of ["surface-west-a", "surface-west-b"]) {
      expect(recordFor(split, id)).toMatchObject({
        turfHealth: 0.2,
        mowingQuality: 0.2,
        repairRequired: true,
      });
      expect(recordFor(split, id).repair).toBeUndefined();
    }

    // A merge is overlap-weighted across both source zones.
    const splitState = normalizeSurfaceCareState(split.surfaceCare, split)!;
    const splitZones = surfaceCareTopology(split).zones.filter(
      (zone) => zone.surfaceId === "surface-west-a" || zone.surfaceId === "surface-west-b",
    );
    const weightedSplit = {
      ...split,
      surfaceCare: {
        ...splitState,
        records: {
          ...splitState.records,
          [splitZones[0].key]: {
            ...splitState.records[splitZones[0].key],
            turfHealth: 0.2,
          },
          [splitZones[1].key]: {
            ...splitState.records[splitZones[1].key],
            turfHealth: 0.8,
          },
        },
      },
    };
    const merged = reconcileSurfaceCareAfterEdit(weightedSplit, structuredClone(course));
    expect(recordFor(merged, "surface-west-green").turfHealth).toBeCloseTo(0.5, 4);
    expect(recordFor(merged, "surface-west-green").repair).toBeUndefined();

    // Replacing terrain is not a repaint: prior green neglect must not infect
    // a newly authored fairway occupying the same cells.
    const replaced = structuredClone(course);
    for (const index of originalCoverage) replaced.tiles[index] = "fairway";
    replaced.surfaceIntent!.features = replaced.surfaceIntent!.features.map((surface) =>
      surface.id === "surface-west-green"
        ? feature("surface-west-fairway", "fairway", originalCoverage, surface.order)
        : surface
    );
    const replacedReconciled = reconcileSurfaceCareAfterEdit(course, replaced);
    expect(recordFor(replacedReconciled, "surface-west-fairway")).toMatchObject({
      turfHealth: 1,
      mowingQuality: 1,
      repairRequired: false,
    });

    // App undo/redo stores full course snapshots. Care state therefore returns
    // exactly with each snapshot instead of being reprojected a second time.
    const undoSnapshot = structuredClone(course);
    const redoSnapshot = structuredClone(expandedReconciled);
    expect(recordFor(undoSnapshot, "surface-west-green").repair?.progressDays).toBe(2);
    expect(recordFor(redoSnapshot, "surface-west-green").turfHealth)
      .toBe(expandedRecord.turfHealth);
    expect(recordFor(redoSnapshot, "surface-west-green").repair).toBeUndefined();

    const normalized = normalizeSurfaceCareState(
      structuredClone(merged.surfaceCare),
      structuredClone(merged),
    );
    expect(normalized).toEqual(merged.surfaceCare);
  });

  it("keeps authored targets legal while every consumer can share the effective tile view", () => {
    let course = advance(fixture(), DEFAULT_WORLD, 0).course;
    const zone = surfaceCareTopology(course).zones.find(
      (candidate) => candidate.surfaceId === "surface-west-green",
    )!;
    const state = normalizeSurfaceCareState(course.surfaceCare, course)!;
    course = {
      ...course,
      surfaceCare: {
        ...state,
        records: {
          ...state.records,
          [zone.key]: {
            ...state.records[zone.key],
            turfHealth: 0.08,
            failureDurationDays: 8,
            repairRequired: true,
          },
        },
      },
    };
    const greenIndex = 3 * course.width + 3;
    expect(course.tiles[greenIndex]).toBe("green");
    expect(effectiveSurfaceTiles(course)[greenIndex]).toBe("waste_area");
    expect(courseWithEffectiveSurfaces(course).tiles[greenIndex]).toBe("waste_area");
    expect(course.holes[0].green).toEqual({ x: 3, y: 3 });
    expect(surfaceCareConditionSummary(course).tournamentReadiness).toBeLessThan(0.95);
    expect(effectiveTerrainForPaintPreview(course, greenIndex, "green"))
      .toBe("waste_area");
    expect(effectiveTerrainForPaintPreview(course, greenIndex, "fairway"))
      .toBe("fairway");
  });

  it("invalidates surface visuals for treatment or mowing changes without changing terrain", () => {
    const base = advance(fixture(), DEFAULT_WORLD, 0).course;
    const zone = surfaceCareTopology(base).zones.find(
      (candidate) => candidate.surfaceId === "surface-west-green",
    )!;
    const state = normalizeSurfaceCareState(base.surfaceCare, base)!;
    const index = 3 * base.width + 3;
    const mowingChanged: Course = {
      ...base,
      surfaceCare: {
        ...state,
        records: {
          ...state.records,
          [zone.key]: {
            ...state.records[zone.key],
            mowingQuality: 0.91,
          },
        },
      },
    };
    const treatmentChanged: Course = {
      ...base,
      surfaceCare: {
        ...state,
        records: {
          ...state.records,
          [zone.key]: {
            ...state.records[zone.key],
            moisture: 0.1,
          },
        },
      },
    };
    const cueOnlyChanged: Course = {
      ...base,
      surfaceCare: {
        ...state,
        records: {
          ...state.records,
          [zone.key]: {
            ...state.records[zone.key],
            wear: 0.32,
            lastTraffic: 80,
            lastObservedAbsoluteDay:
              state.records[zone.key].lastObservedAbsoluteDay + 1,
          },
        },
      },
    };
    expect(effectiveSurfaceTiles(mowingChanged)[index]).toBe(
      effectiveSurfaceTiles(base)[index],
    );
    expect(effectiveSurfaceTiles(treatmentChanged)[index]).toBe(
      effectiveSurfaceTiles(base)[index],
    );
    expect(surfaceCareVisualSignatures(mowingChanged)[index])
      .not.toBe(surfaceCareVisualSignatures(base)[index]);
    expect(surfaceCareVisualSignatures(treatmentChanged)[index])
      .not.toBe(surfaceCareVisualSignatures(base)[index]);
    expect(resolveEffectiveSurface(cueOnlyChanged, zone).treatment)
      .toBe(resolveEffectiveSurface(base, zone).treatment);
    expect(surfaceCareVisualSignatures(cueOnlyChanged)[index])
      .toBe(surfaceCareVisualSignatures(base)[index]);
    expect(surfaceCarePresentationSignature(cueOnlyChanged))
      .not.toBe(surfaceCarePresentationSignature(base));
  });

  it("uses the authored course condition before local care history exists", () => {
    const course = { ...fixture(), condition: 0.63, surfaceCare: undefined };
    expect(surfaceCareConditionSummary(course)).toMatchObject({
      overallCondition: 0.63,
      tournamentReadiness: 0.63,
      repairRequiredZones: 0,
    });
  });

  it("makes physics, AI, reports, architecture, and tournaments agree on one degraded surface", () => {
    let course = advance(fixture(), DEFAULT_WORLD, 0).course;
    const zone = surfaceCareTopology(course).zones.find(
      (candidate) => candidate.surfaceId === "surface-west-green",
    )!;
    const state = normalizeSurfaceCareState(course.surfaceCare, course)!;
    course = {
      ...course,
      condition: .72,
      surfaceCare: {
        ...state,
        records: {
          ...state.records,
          [zone.key]: {
            ...state.records[zone.key],
            mowingQuality: .05,
            turfHealth: .08,
            wear: .8,
            failureDurationDays: 8,
            repairRequired: true,
          },
        },
      },
    };
    const index = 3 * course.width + 3;
    const effectiveCourse = courseWithEffectiveSurfaces(course);
    expect(course.tiles[index]).toBe("green");
    expect(effectiveCourse.tiles[index]).toBe("waste_area");
    expect(liveTerrainAt(course, { x: 3, y: 3 })).toBe("waste_area");
    expect(liveCourseSnapshot({
      course,
      teeSet: "member",
      pinRotation: "A",
    }).tiles[index]).toBe("waste_area");

    const holes = scoreCourseHoles(course);
    expect(holes.holes[0].corridor.waste_area).toBeGreaterThan(0);
    expect(surfaceCareQualityForHole(course, course.holes[0])).toBeLessThan(course.condition);

    const strategic = evaluateStrategicArchitecture(course, {
      samplesPerOption: 2,
      seed: 647,
    });
    expect(strategic.geometryVersion).toBe(strategicGeometryVersion(effectiveCourse));

    const report = buildM49CourseReport({ course, world: DEFAULT_WORLD });
    expect(report.condition.hotSpots[0]).toMatchObject({
      zoneId: zone.key,
      terrain: "green",
      action: "Schedule reseeding or resodding",
    });
    expect(report.condition.overall).toBe(
      surfaceCareConditionSummary(course).overallCondition,
    );

    const tournament = evaluateTournamentCourseQualification(course, "championship");
    expect(tournament.requirements.find(
      (requirement) => requirement.id === "surface-care",
    )).toMatchObject({ passed: false });
  });

  it("publishes all eight biome pressure contracts and stays within sparse 36-hole save budgets", () => {
    expect(Object.keys(SURFACE_CARE_BIOME_PRESSURES).sort()).toEqual([
      "alpine",
      "australian-sandbelt",
      "desert",
      "heathland",
      "links",
      "parkland",
      "temperate-japan",
      "tropical",
    ]);
    const width = 220;
    const height = 140;
    const tiles = new Array<Terrain>(width * height).fill("fairway");
    const large: Course = {
      ...fixture(),
      width,
      height,
      tiles,
      elevations: new Array(width * height).fill(0),
      surfaceIntent: undefined,
    };
    const started = performance.now();
    const result = advance(large, DEFAULT_WORLD, 1);
    const elapsed = performance.now() - started;
    const records = Object.keys(result.course.surfaceCare?.records ?? {});
    expect(records.length).toBeLessThanOrEqual(Math.ceil(width / 8) * Math.ceil(height / 8));
    expect(JSON.stringify(result.course.surfaceCare).length).toBeLessThan(600_000);
    expect(elapsed).toBeLessThan(500);
  });

  it("stays deterministic and bounded across a full 32-week club year", () => {
    const simulate = (theme: NonNullable<Course["theme"]>) => {
      let course = fixture(theme);
      const world = {
        ...DEFAULT_WORLD,
        maintenanceBudget: 550,
        staffLevel: 1,
      };
      for (let absoluteDay = 0; absoluteDay < 224; absoluteDay++) {
        const weather = weatherForDay(world.runSeed, theme, absoluteDay);
        course = advanceSurfaceCareDay({
          course,
          world,
          absoluteDay,
          weather,
          climate: biomeClimatePhenologyForDay(theme, absoluteDay),
          turfPriority: absoluteDay % 21 < 7 ? "recovery" : "playability",
          waterPolicy: absoluteDay % 17 < 5 ? "conserve" : "balanced",
          drainageLevel: 1,
          rounds: 4 + absoluteDay % 9,
        }).course;
      }
      return course;
    };
    const parkland = simulate("parkland");
    expect(simulate("parkland").surfaceCare).toEqual(parkland.surfaceCare);
    const states = [
      parkland.surfaceCare!,
      simulate("links").surfaceCare!,
      simulate("desert").surfaceCare!,
    ];
    expect(new Set(states.map((state) => JSON.stringify(state))).size).toBe(3);
    for (const state of states) {
      expect(state.lastAdvancedAbsoluteDay).toBe(223);
      expect(Object.keys(state.records).length).toBeLessThan(32);
      for (const record of Object.values(state.records)) {
        for (const value of [
          record.mowingQuality,
          record.moisture,
          record.turfHealth,
          record.wear,
          record.dormancy,
          record.drainageStress,
          record.repairProgress,
        ]) {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
