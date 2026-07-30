import { describe, expect, it } from "vitest";
import {
  advanceSurfaceCareDay,
  observedSurfaceCareZones,
  resolveEffectiveSurfaceAtIndex,
  startSurfaceRepair,
  surfaceCarePresentationSignature,
  surfaceCareTopology,
  surfaceCareVisualSignatures,
} from "../conditions/surfaceCare";
import { DEFAULT_WORLD } from "../models/defaults";
import type {
  Course,
  CultivatedTerrain,
  SurfaceCareRecordV1,
  Terrain,
} from "../models/types";
import { biomeClimatePhenologyForDay } from "../seasons/seasons";
import type { DailyWeather } from "../seasons/types";
import { isoToWorld, worldToIso } from "./iso";
import {
  SURFACE_CARE_COMMAND_BUDGET,
  surfaceCarePresentationSummary,
  surfaceCareVisualCommands,
  type SurfaceCareVisualCue,
} from "./surfaceCarePresentation";

function feature(
  id: string,
  terrain: CultivatedTerrain,
  coverage: number[],
  order: number,
  width: number,
) {
  const xs = coverage.map((index) => index % width);
  const ys = coverage.map((index) => Math.floor(index / width));
  return {
    id,
    terrain,
    order,
    coverage,
    geometry: {
      kind: "region" as const,
      ring: [
        { x: Math.min(...xs), y: Math.min(...ys) },
        { x: Math.max(...xs) + 1, y: Math.min(...ys) },
        { x: Math.max(...xs) + 1, y: Math.max(...ys) + 1 },
        { x: Math.min(...xs), y: Math.max(...ys) + 1 },
      ],
    },
  };
}

function fixture(): Course {
  const width = 32;
  const height = 12;
  const tiles = new Array<Terrain>(width * height).fill("rough");
  const west = Array.from({ length: 11 }, (_, offset) => 5 * width + 2 + offset);
  const east = Array.from({ length: 11 }, (_, offset) => 5 * width + 19 + offset);
  for (const index of [...west, ...east]) tiles[index] = "fairway";
  return {
    width,
    height,
    tiles,
    elevations: new Array(width * height).fill(0),
    holes: [
      {
        id: "hole-west",
        tee: { x: 2, y: 5 },
        green: { x: 12, y: 5 },
        teeBoxes: { member: { x: 2, y: 5 } },
        pinPositions: { A: { x: 12, y: 5 } },
        parMode: "MANUAL",
        parManual: 4,
      },
      {
        id: "hole-east",
        tee: { x: 19, y: 5 },
        green: { x: 29, y: 5 },
        teeBoxes: { member: { x: 19, y: 5 } },
        pinPositions: { A: { x: 29, y: 5 } },
        parMode: "MANUAL",
        parManual: 4,
      },
    ],
    layouts: [{
      id: "course-primary",
      name: "Local Care",
      draftHoleIds: ["hole-west", "hole-east"],
      publishedHoleIds: ["hole-west", "hole-east"],
      roundLength: 9,
      state: "open",
      greenFee: 50,
    }],
    activeCourseId: "course-primary",
    activePinRotation: "A",
    obstacles: [],
    buildings: [],
    decorations: [],
    yardsPerTile: 10,
    name: "Local Care",
    baseGreenFee: 50,
    condition: 0.82,
    theme: "parkland",
    surfaceIntent: {
      version: 1,
      nextId: 3,
      features: [
        feature("surface-west", "fairway", west, 1, width),
        feature("surface-east", "fairway", east, 2, width),
      ],
    },
  };
}

function baselineRecord(
  key: string,
  surfaceId: string,
  cellX: number,
  cellY: number,
  area: number,
): SurfaceCareRecordV1 {
  return {
    key,
    surfaceId,
    cellX,
    cellY,
    intendedTerrain: "fairway",
    area,
    mowingQuality: 0.95,
    moisture: 0.58,
    turfHealth: 0.96,
    wear: 0.04,
    dormancy: 0,
    drainageStress: 0.03,
    failureDurationDays: 0,
    missedMowingDays: 0,
    insufficientWaterDays: 0,
    saturatedDays: 0,
    repairRequired: false,
    repairProgress: 0,
    lastDemand: 10,
    lastAllocated: 10,
    lastTraffic: 0,
    lastIrrigationDemand: 0,
    lastIrrigationApplied: 0,
    lastElevatedWaterDemand: 0,
    lastElevatedWaterApplied: 0,
    lastRepairProgressed: false,
    lastRepairServiceRatio: 0,
    lastObservedAbsoluteDay: 10,
  };
}

function observedFixture(
  overrides: Record<string, Partial<SurfaceCareRecordV1>>,
): Course {
  const course = fixture();
  const records = Object.fromEntries(surfaceCareTopology(course).zones.map((zone) => [
    zone.key,
    {
      ...baselineRecord(
        zone.key,
        zone.surfaceId,
        zone.cellX,
        zone.cellY,
        zone.cells.length,
      ),
      ...(overrides[zone.surfaceId] ?? {}),
    },
  ]));
  return {
    ...course,
    surfaceCare: {
      version: 1,
      cellSize: 8,
      lastAdvancedAbsoluteDay: 10,
      records,
    },
  };
}

function cues(course: Course): Set<SurfaceCareVisualCue> {
  return new Set(surfaceCareVisualCommands({
    course,
    quality: "high",
    seed: 912,
  }).map((command) => command.cue));
}

describe("surface care presentation", () => {
  it("renders only observed authoritative records and never invents global-condition cues", () => {
    expect(surfaceCareVisualCommands({
      course: fixture(),
      quality: "high",
      seed: 1,
    })).toEqual([]);

    const healthy = observedFixture({});
    expect(surfaceCareVisualCommands({
      course: healthy,
      quality: "high",
      seed: 1,
    })).toEqual([]);

    const unobserved = structuredClone(healthy);
    for (const record of Object.values(unobserved.surfaceCare!.records)) {
      record.lastObservedAbsoluteDay = -1;
      record.wear = 1;
      record.repairRequired = true;
      record.turfHealth = 0.05;
    }
    expect(observedSurfaceCareZones(unobserved)).toEqual([]);
    expect(surfaceCareVisualCommands({
      course: unobserved,
      quality: "high",
      seed: 1,
    })).toEqual([]);
  });

  it("projects every requested problem family from exact local telemetry", () => {
    const wearCues = cues(observedFixture({
      "surface-west": {
        wear: 0.82,
        lastTraffic: 90,
        turfHealth: 0.58,
      },
    }));
    for (const cue of ["worn-line", "divot", "compaction", "thinning"] as const) {
      expect(wearCues.has(cue)).toBe(true);
    }

    const wetCues = cues(observedFixture({
      "surface-west": {
        moisture: 0.93,
        drainageStress: 0.72,
        saturatedDays: 8,
        turfHealth: 0.58,
      },
    }));
    expect(wetCues.has("mud-softness")).toBe(true);
    expect(wetCues.has("wet-disease-risk")).toBe(true);

    const dryCues = cues(observedFixture({
      "surface-west": {
        moisture: 0.2,
        insufficientWaterDays: 9,
        turfHealth: 0.54,
      },
    }));
    expect(dryCues.has("dry-stress")).toBe(true);
    expect(dryCues.has("thinning")).toBe(true);

    const missedCues = cues(observedFixture({
      "surface-west": {
        mowingQuality: 0.08,
        missedMowingDays: 20,
        turfHealth: 0.46,
      },
    }));
    expect(missedCues.has("overgrowth")).toBe(true);
    expect(missedCues.has("weed-pressure")).toBe(true);

    expect(cues(observedFixture({
      "surface-west": {
        turfHealth: 0.1,
        failureDurationDays: 8,
        repairRequired: true,
      },
    })).has("bare-failure")).toBe(true);
  });

  it("keeps two holes locally distinct at one global condition", () => {
    const course = observedFixture({
      "surface-west": {
        wear: 0.8,
        lastTraffic: 100,
        turfHealth: 0.62,
      },
    });
    const summary = surfaceCarePresentationSummary({
      course,
      quality: "high",
      seed: 22,
    });
    expect(course.condition).toBe(0.82);
    expect(summary.holeCounts["hole-west"]).toBeGreaterThan(0);
    expect(summary.holeCounts["hole-east"] ?? 0).toBe(0);
    const commands = surfaceCareVisualCommands({
      course,
      quality: "high",
      seed: 22,
    });
    expect(commands.every((command) => command.holeId === "hole-west")).toBe(true);
    expect(Math.abs(commands.find((command) =>
      command.cue === "worn-line")!.rotation)).toBeLessThan(0.1);
  });

  it("turns observed cart traffic, drought, and understaffing into local evidence", () => {
    const noStaff = {
      ...DEFAULT_WORLD,
      maintenanceBudget: 0,
      staffLevel: 0,
      staffRoster: [],
    };
    const simulate = (mobilityOffPathTiles: number) => {
      let course = fixture();
      for (let absoluteDay = 0; absoluteDay < 8; absoluteDay++) {
        const weather: DailyWeather = {
          absoluteDay,
          kind: "drought",
          temperatureF: 104,
          windMph: 22,
          rainInches: 0,
          severity: 0.86,
          theme: "parkland",
          season: "summer",
        };
        course = advanceSurfaceCareDay({
          course,
          world: noStaff,
          absoluteDay,
          weather,
          climate: biomeClimatePhenologyForDay("parkland", absoluteDay),
          turfPriority: "playability",
          waterPolicy: "conserve",
          drainageLevel: 0,
          rounds: 10,
          mobilityOffPathTiles,
        }).course;
      }
      return course;
    };
    const walking = simulate(0);
    const cart = simulate(5_000);
    const walkingWear = observedSurfaceCareZones(walking)
      .reduce((sum, item) => sum + item.record.wear, 0);
    const cartWear = observedSurfaceCareZones(cart)
      .reduce((sum, item) => sum + item.record.wear, 0);
    expect(cartWear).toBeGreaterThan(walkingWear);
    const cartCues = cues(cart);
    expect(cartCues.has("worn-line")).toBe(true);
    expect(cartCues.has("compaction")).toBe(true);
    expect(cartCues.has("dry-stress")).toBe(true);
    expect(cartCues.has("overgrowth")).toBe(true);
    expect(cartCues.has("groundskeeper-work")).toBe(false);
  });

  it("shows active repair/work/recovery only while the authority says they exist", () => {
    const active = observedFixture({
      "surface-west": {
        repairRequired: true,
        repairProgress: 0.4,
        turfHealth: 0.48,
        lastDemand: 20,
        lastAllocated: 16,
        lastRepairProgressed: true,
        lastRepairServiceRatio: 0.8,
        repair: {
          kind: "reseed",
          cost: 600,
          requiredDays: 20,
          progressDays: 8,
          startedAbsoluteDay: 2,
          elevatedWaterDaysRemaining: 0,
        },
      },
    });
    const activeCommands = surfaceCareVisualCommands({
      course: active,
      quality: "high",
      seed: 11,
    });
    expect(activeCommands.some((command) => command.cue === "repair-reseed")).toBe(true);
    expect(activeCommands.some((command) => command.cue === "recovery-dressing")).toBe(true);
    expect(activeCommands.some((command) =>
      command.cue === "groundskeeper-work" && command.animated)).toBe(true);

    const reduced = surfaceCareVisualCommands({
      course: active,
      quality: "high",
      seed: 11,
      reducedMotion: true,
    });
    expect(reduced.find((command) => command.cue === "groundskeeper-work")?.animated)
      .toBe(false);
    expect(reduced.map(({ animated: _animated, ...command }) => command))
      .toEqual(activeCommands.map(({ animated: _animated, ...command }) => command));

    const waiting = observedFixture({
      "surface-west": {
        repairRequired: true,
        repairProgress: 0.2,
        turfHealth: 0.35,
        lastDemand: 20,
        lastAllocated: 5,
        lastRepairProgressed: false,
        lastRepairServiceRatio: 0.25,
        repair: {
          kind: "resod",
          cost: 900,
          requiredDays: 8,
          progressDays: 2,
          startedAbsoluteDay: 3,
          elevatedWaterDaysRemaining: 5,
        },
      },
    });
    expect(cues(waiting).has("repair-resod")).toBe(true);
    expect(cues(waiting).has("groundskeeper-work")).toBe(false);

    const completed = observedFixture({
      "surface-west": {
        repairRequired: false,
        repairProgress: 1,
        turfHealth: 0.95,
        mowingQuality: 0.95,
        wear: 0.04,
      },
    });
    const completedCues = cues(completed);
    expect([...completedCues].filter((cue) =>
      cue.startsWith("repair-")
      || cue === "recovery-dressing"
      || cue === "groundskeeper-work")).toEqual([]);
  });

  it("never animates stale pre-purchase allocation and uses latest repair-day service only", () => {
    const funded = {
      ...DEFAULT_WORLD,
      cash: 100_000,
      maintenanceBudget: 100_000,
      staffLevel: 5,
    };
    const dailyWeather = (
      absoluteDay: number,
      kind: DailyWeather["kind"],
    ): DailyWeather => ({
      absoluteDay,
      kind,
      temperatureF: kind === "frost" ? 28 : 72,
      windMph: 8,
      rainInches: 0,
      severity: kind === "frost" ? 0.6 : 0.08,
      theme: "parkland",
      season: "spring",
    });
    const advanceRepairDay = (course: Course, absoluteDay: number, kind: DailyWeather["kind"]) =>
      advanceSurfaceCareDay({
        course,
        world: funded,
        absoluteDay,
        weather: dailyWeather(absoluteDay, kind),
        climate: biomeClimatePhenologyForDay("parkland", absoluteDay),
        turfPriority: "recovery",
        waterPolicy: "irrigate",
        drainageLevel: 1,
        rounds: 0,
      }).course;

    let course = advanceRepairDay(fixture(), 0, "clear");
    const zone = surfaceCareTopology(course).zones.find((candidate) =>
      candidate.surfaceId === "surface-west")!;
    course = {
      ...course,
      surfaceCare: {
        ...course.surfaceCare!,
        records: {
          ...course.surfaceCare!.records,
          [zone.key]: {
            ...course.surfaceCare!.records[zone.key],
            turfHealth: 0.1,
            failureDurationDays: 8,
            repairRequired: true,
          },
        },
      },
    };
    expect(course.surfaceCare!.records[zone.key].lastAllocated)
      .toBe(course.surfaceCare!.records[zone.key].lastDemand);

    const started = startSurfaceRepair(course, funded, zone.key, "resod", 1);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    course = started.course;
    expect(course.surfaceCare!.records[zone.key]).toMatchObject({
      lastRepairProgressed: false,
      lastRepairServiceRatio: 0,
    });
    expect(cues(course).has("groundskeeper-work")).toBe(false);

    course = advanceRepairDay(course, 1, "clear");
    expect(course.surfaceCare!.records[zone.key].repair?.progressDays)
      .toBeGreaterThan(0);
    expect(course.surfaceCare!.records[zone.key]).toMatchObject({
      lastObservedAbsoluteDay: 1,
      lastRepairProgressed: true,
    });
    expect(course.surfaceCare!.records[zone.key].lastRepairServiceRatio)
      .toBeGreaterThanOrEqual(0.55);
    expect(cues(course).has("groundskeeper-work")).toBe(true);

    course = advanceRepairDay(course, 2, "frost");
    expect(course.surfaceCare!.records[zone.key]).toMatchObject({
      lastRepairProgressed: false,
    });
    expect(cues(course).has("groundskeeper-work")).toBe(false);

    course = advanceRepairDay(course, 3, "clear");
    expect(course.surfaceCare!.records[zone.key].repair?.progressDays)
      .toBeGreaterThan(0);
    expect(course.surfaceCare!.records[zone.key]).toMatchObject({
      lastRepairProgressed: true,
    });
    expect(course.surfaceCare!.records[zone.key].lastRepairServiceRatio)
      .toBeGreaterThanOrEqual(0.55);
    expect(cues(course).has("groundskeeper-work")).toBe(true);

    course = advanceRepairDay(course, 4, "frost");
    expect(course.surfaceCare!.records[zone.key]).toMatchObject({
      lastRepairProgressed: false,
    });
    expect(cues(course).has("groundskeeper-work")).toBe(false);

    for (let absoluteDay = 5; absoluteDay <= 20; absoluteDay++) {
      if (!course.surfaceCare!.records[zone.key].repair) break;
      course = advanceRepairDay(course, absoluteDay, "clear");
    }
    expect(course.surfaceCare!.records[zone.key].repair).toBeUndefined();
    expect(cues(course).has("groundskeeper-work")).toBe(false);
    expect(cues(course).has("recovery-dressing")).toBe(false);
  });

  it("keeps anchors stable across save/reload, care updates, and every rotation", () => {
    const course = observedFixture({
      "surface-west": { wear: 0.62, lastTraffic: 80, turfHealth: 0.58 },
    });
    const input = { course, quality: "high" as const, seed: 77 };
    const baseline = surfaceCareVisualCommands(input);
    const reloaded = surfaceCareVisualCommands({
      ...input,
      course: JSON.parse(JSON.stringify(course)) as Course,
    });
    expect(reloaded).toEqual(baseline);

    const nextDay = structuredClone(course);
    for (const record of Object.values(nextDay.surfaceCare!.records)) {
      record.lastObservedAbsoluteDay++;
      record.wear = Math.min(1, record.wear + 0.06);
    }
    const updated = surfaceCareVisualCommands({ ...input, course: nextDay });
    const anchors = new Map(updated.map((command) => [
      command.id,
      { x: command.x, y: command.y, rotation: command.rotation },
    ]));
    for (const command of baseline) {
      if (!anchors.has(command.id)) continue;
      expect(anchors.get(command.id)).toEqual({
        x: command.x,
        y: command.y,
        rotation: command.rotation,
      });
    }
    expect(surfaceCareVisualSignatures(nextDay))
      .toEqual(surfaceCareVisualSignatures(course));
    expect(surfaceCarePresentationSignature(nextDay))
      .not.toBe(surfaceCarePresentationSignature(course));

    for (const rotation of [0, 90, 180, 270] as const) {
      for (const command of baseline) {
        const projected = worldToIso(command.x, command.y, 0, rotation);
        const restored = isoToWorld(projected.x, projected.y, rotation);
        expect(restored.x).toBeCloseTo(command.x, 8);
        expect(restored.y).toBeCloseTo(command.y, 8);
      }
    }
  });

  it("caps dense 128×128 wear at each adaptive-quality budget", () => {
    const width = 128;
    const height = 128;
    const base = fixture();
    const denseBase: Course = {
      ...base,
      width,
      height,
      tiles: new Array<Terrain>(width * height).fill("fairway"),
      elevations: new Array(width * height).fill(0),
      surfaceIntent: undefined,
    };
    const topology = surfaceCareTopology(denseBase);
    const dense: Course = {
      ...denseBase,
      surfaceCare: {
        version: 1,
        cellSize: 8,
        lastAdvancedAbsoluteDay: 31,
        records: Object.fromEntries(topology.zones.map((zone) => [
          zone.key,
          {
            ...baselineRecord(
              zone.key,
              zone.surfaceId,
              zone.cellX,
              zone.cellY,
              zone.cells.length,
            ),
            wear: 0.88,
            turfHealth: 0.52,
            lastTraffic: zone.cells.length * 6,
            lastObservedAbsoluteDay: 31,
          },
        ])),
      },
    };
    expect(topology.zones.length).toBe(256);
    const started = performance.now();
    for (const quality of ["low", "medium", "high"] as const) {
      const commands = surfaceCareVisualCommands({
        course: dense,
        quality,
        seed: 55,
      });
      expect(commands).toHaveLength(SURFACE_CARE_COMMAND_BUDGET[quality]);
      expect(new Set(commands.map((command) => command.id)).size)
        .toBe(commands.length);
    }
    expect(performance.now() - started).toBeLessThan(350);
  });

  it("preserves effective-physics parity and stays bounded over a club year", () => {
    let course = fixture();
    const world = {
      ...DEFAULT_WORLD,
      maintenanceBudget: 220,
      staffLevel: 1,
    };
    const started = performance.now();
    for (let absoluteDay = 0; absoluteDay < 224; absoluteDay++) {
      const weather: DailyWeather = {
        absoluteDay,
        kind: absoluteDay % 19 < 7 ? "heavy_rain" : absoluteDay % 29 < 8 ? "drought" : "clear",
        temperatureF: absoluteDay % 29 < 8 ? 98 : 68,
        windMph: 10,
        rainInches: absoluteDay % 19 < 7 ? 0.85 : 0,
        severity: 0.55,
        theme: "parkland",
        season: "summer",
      };
      course = advanceSurfaceCareDay({
        course,
        world,
        absoluteDay,
        weather,
        climate: biomeClimatePhenologyForDay("parkland", absoluteDay),
        turfPriority: absoluteDay % 2 ? "recovery" : "playability",
        waterPolicy: absoluteDay % 5 ? "balanced" : "conserve",
        drainageLevel: 0,
        rounds: 8 + absoluteDay % 10,
        mobilityOffPathTiles: absoluteDay % 7 === 0 ? 800 : 0,
      }).course;
      for (const quality of ["low", "medium", "high"] as const) {
        expect(surfaceCareVisualCommands({
          course,
          quality,
          seed: 44,
        }).length).toBeLessThanOrEqual(SURFACE_CARE_COMMAND_BUDGET[quality]);
      }
    }
    expect(performance.now() - started).toBeLessThan(2_500);
    expect(Object.keys(course.surfaceCare?.records ?? {}))
      .toHaveLength(surfaceCareTopology(course).zones.length);

    const zones = new Map(observedSurfaceCareZones(course).map((item) => [
      item.zone.key,
      item,
    ]));
    for (const command of surfaceCareVisualCommands({
      course,
      quality: "high",
      seed: 44,
    })) {
      const observed = zones.get(command.zoneKey)!;
      const effective = resolveEffectiveSurfaceAtIndex(course, observed.zone.cells[0]);
      expect(command.effectiveTerrain).toBe(effective.effectiveTerrain);
      expect(command.treatment).toBe(effective.treatment);
      expect(command.intendedTerrain).toBe(effective.intendedTerrain);
      expect(command.sourceAbsoluteDay).toBe(observed.record.lastObservedAbsoluteDay);
    }
  });
});
