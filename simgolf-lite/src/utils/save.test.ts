import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../game/models/defaults";
import { createDefaultPlayerPro, settlePlayerRound } from "../game/playerPro/playerPro";
import { createEstate, starterParcelOffset } from "../game/estate/estate";
import { generateWildLandWithObstacles } from "../game/gen/generateWildLand";
import { createNewGame } from "../game/gen/newGame";
import { corridorFeature, rasterizeSurfaceFeatureDetailed } from "../game/models/surfaceIntent";
import {
  COURSE_HEIGHT,
  COURSE_WIDTH,
  STARTER_PARCEL_HEIGHT,
  STARTER_PARCEL_WIDTH,
} from "../game/models/constants";
import {
  CURRENT_SAVE_SCHEMA_VERSION,
  normalizeLoadedSaveResult,
  parseSaveText,
  payloadForPersistence,
} from "./save";
import { biomeCompatibilityMetadataFor } from "../game/models/biomes";
import {
  advanceSurfaceCareDay,
  surfaceCareTopology,
} from "../game/conditions/surfaceCare";
import {
  biomeClimatePhenologyForDay,
  weatherForDay,
} from "../game/seasons/seasons";
import { emptyLivingClubState } from "../game/livingClub/livingClub";
import { startChallengeGroupRound, type ChallengeGroupRound } from "../game/competition/challengeGroupRound";

function file(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
    savedAt: 123,
    course: DEFAULT_COURSE,
    world: {
      ...DEFAULT_WORLD,
      playerPro: createDefaultPlayerPro({ seed: DEFAULT_WORLD.runSeed, name: DEFAULT_WORLD.founderName }),
    },
    history: [],
    ...overrides,
  };
}

function legacyHandicapRound(phase: "awaiting_shot" | "round_complete" = "awaiting_shot") {
  const holes = Array.from({ length: 9 }, (_, index) => ({
    id: `hole-${index + 1}`,
    name: `Handicap Hole ${index + 1}`,
    par: 4,
    strokeIndex: index + 1,
    tee: { x: 2, y: index + 2 },
    pin: { x: 12, y: index + 2 },
    waypoints: [],
  }));
  return {
    version: 1 as const,
    id: "legacy-handicap-round",
    kind: "casual" as const,
    handedness: "right" as const,
    phase,
    course: {
      courseId: DEFAULT_COURSE.activeCourseId!,
      courseName: DEFAULT_COURSE.name,
      geometryVersion: "geometry:v1",
      theme: DEFAULT_COURSE.theme!,
      biomeCompatibility: biomeCompatibilityMetadataFor(DEFAULT_COURSE.theme!),
      width: DEFAULT_COURSE.width,
      height: DEFAULT_COURSE.height,
      yardsPerTile: DEFAULT_COURSE.yardsPerTile,
      tiles: [...DEFAULT_COURSE.tiles],
      elevations: [...DEFAULT_COURSE.elevations],
      obstacles: [],
      holes,
      rating: { courseRating: 36, slope: 113 },
    },
    teeSet: "member" as const,
    pinRotation: "A" as const,
    currentHoleIndex: 0,
    ball: { ...holes[0].tee },
    lie: "tee",
    strokes: phase === "round_complete" ? 45 : 0,
    penalties: 0,
    scorecard: holes.map((hole) => ({
      holeId: hole.id,
      name: hole.name,
      par: hole.par,
      strokes: phase === "round_complete" ? 5 : 0,
      penalties: 0,
      complete: phase === "round_complete",
    })),
    shots: [],
    pendingShot: null,
    rngSeed: 19,
    rngCursor: 0,
    autoPlay: false,
    rewardsApplied: false,
    startedWeek: 4,
    startedDay: 2,
    completedWeek: phase === "round_complete" ? 4 : undefined,
  };
}

function challengeGroupRound(): ChallengeGroupRound {
  const career = createDefaultPlayerPro({ seed: DEFAULT_WORLD.runSeed, name: "Casey Fairway" });
  const snapshot = legacyHandicapRound().course;
  return startChallengeGroupRound({
    id: "save-group-726",
    course: snapshot,
    teeSet: "member",
    pinRotation: "A",
    participants: [
      {
        id: career.identity.id,
        name: career.identity.name,
        controller: "player",
        skills: career.skills,
        handicapIndex: career.handicapProfile.handicapIndex,
        equipment: { loadout: career.equipmentLoadout, items: career.inventory.items },
      },
      {
        id: "save-rival",
        name: "Save Rival",
        controller: "ai",
        skills: { ...career.skills, power: 48 },
        handicapIndex: 11.2,
      },
    ],
    sideBets: [{ id: "save-skin", kind: "skins", stake: 5, carry: 0, status: "active", settlements: [], evidence: [] }],
    rngSeed: 726_404,
    startedWeek: DEFAULT_WORLD.week,
    startedDay: 0,
  });
}

function legacyLinksOverlay(seed = 25) {
  const current = createNewGame({
    mode: "sandbox",
    courseName: "Golden Point",
    seed,
    theme: "links",
    difficulty: "normal",
  });
  const starter = generateWildLandWithObstacles(
    STARTER_PARCEL_WIDTH,
    STARTER_PARCEL_HEIGHT,
    seed,
    [],
    "links",
  );
  const tiles = [...current.course.tiles];
  const elevations = [...current.course.elevations];
  const offset = starterParcelOffset();
  for (let y = 0; y < STARTER_PARCEL_HEIGHT; y++) {
    for (let x = 0; x < STARTER_PARCEL_WIDTH; x++) {
      const source = y * STARTER_PARCEL_WIDTH + x;
      const target = (y + offset.y) * COURSE_WIDTH + x + offset.x;
      tiles[target] = starter.tiles[source];
      elevations[target] = starter.elevations[source];
    }
  }
  const course = { ...current.course, tiles, elevations };
  course.estate = {
    ...createEstate(course, seed),
    generationVersion: 1,
  };
  return { current, legacy: { course, world: current.world } };
}

describe("save validation and migrations", () => {
  it("migrates a v27 Player Pro career once and preserves unrelated and historical data", () => {
    const legacyCareer = createDefaultPlayerPro({ seed: DEFAULT_WORLD.runSeed });
    const { handicapProfile: _legacyMissing, ...withoutHandicap } = legacyCareer;
    const historical = {
      id: "historical-round",
      kind: "casual" as const,
      courseId: "old-course",
      courseName: "Old Course",
      week: 2,
      strokes: 40,
      penalties: 0,
      par: 36,
      scoreToPar: 4,
      result: "complete" as const,
      earnings: 0,
      scorecard: [],
      shots: [],
      evidence: [],
      skillGains: {},
    };
    const result = normalizeLoadedSaveResult(file({
      schemaVersion: 27,
      world: {
        ...file().world,
        cash: 12_345,
        playerPro: { ...withoutHandicap, rounds: [historical] },
      },
      history: [{ week: 1, revenue: 2, costs: 1, profit: 1, rounds: 3 }],
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(27);
    expect(result.payload.world.cash).toBe(12_345);
    expect(result.payload.world.playerPro?.rounds[0]).toMatchObject(historical);
    expect(result.payload.world.playerPro?.handicapProfile).toMatchObject({
      version: 1,
      handicapIndex: 17.3,
      source: "skill-seed",
      scoreRecords: [],
    });
  });

  it("migrates active and completed-unposted rounds with a stable snapshot and posting key", () => {
    for (const phase of ["awaiting_shot", "round_complete"] as const) {
      const legacyCareer = createDefaultPlayerPro({ seed: DEFAULT_WORLD.runSeed });
      const { handicapProfile: _legacyMissing, ...withoutHandicap } = legacyCareer;
      const first = normalizeLoadedSaveResult(file({
        schemaVersion: 27,
        world: { ...file().world, playerPro: { ...withoutHandicap, activeRound: legacyHandicapRound(phase) } },
      }));
      expect(first.ok).toBe(true);
      if (!first.ok) continue;
      const snapshot = first.payload.world.playerPro?.activeRound?.handicapSnapshot;
      expect(snapshot).toMatchObject({
        roundId: "legacy-handicap-round",
        postingKey: "handicap-post:legacy-handicap-round",
        postingState: "unposted",
        eligibility: { eligible: true },
      });
      const second = normalizeLoadedSaveResult({
        schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
        savedAt: 999,
        ...first.payload,
      });
      expect(second.ok).toBe(true);
      if (!second.ok) continue;
      expect(second.payload.world.playerPro?.activeRound?.handicapSnapshot).toEqual(snapshot);
      if (phase === "round_complete") {
        const career = second.payload.world.playerPro!;
        const activeRound = career.activeRound!;
        const settled = settlePlayerRound(career, activeRound);
        expect(settled.career.handicapProfile.scoreRecords).toHaveLength(1);
        expect(settled.career.handicapProfile.scoreRecords[0]).toMatchObject({
          roundId: activeRound.id,
          postingState: "posted",
          evidence: { differential: expect.any(Number) },
        });
        const duplicate = settlePlayerRound(settled.career, activeRound);
        expect(duplicate.round).toBeNull();
        expect(duplicate.career.handicapProfile.scoreRecords).toHaveLength(1);
      }
    }
  });

  it("rejects corrupt current handicap state atomically with an actionable path", () => {
    const playerPro = createDefaultPlayerPro({ seed: DEFAULT_WORLD.runSeed });
    const result = normalizeLoadedSaveResult(file({
      world: {
        ...file().world,
        playerPro: {
          ...playerPro,
          handicapProfile: { ...playerPro.handicapProfile, handicapIndex: 99 },
        },
      },
    }));
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_WORLD",
        message: expect.stringContaining("world.playerPro.handicapProfile.handicapIndex"),
      },
    });
  });

  it("migrates historical indexes as legacy evidence without certifying an incomplete scorecard", () => {
    const course = {
      ...DEFAULT_COURSE,
      holes: DEFAULT_COURSE.holes.map((hole, index) => index === 0 ? { ...hole, holeIndex: 1 } : hole),
    };
    const result = normalizeLoadedSaveResult(file({ schemaVersion: 26, course }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(26);
    expect(result.payload.course.holes[0].holeIndexSource).toBe("legacy");
  });

  it("round-trips a current save without changing gameplay state", () => {
    const result = parseSaveText(JSON.stringify(file()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.course).toEqual(DEFAULT_COURSE);
    expect(result.payload.world).toEqual(file().world);
    expect(result.migratedFrom).toBeUndefined();
  });

  it("round-trips an active ChallengeGroupRound exactly and rejects corrupt save authority", () => {
    const group = challengeGroupRound();
    const career = {
      ...createDefaultPlayerPro({ seed: DEFAULT_WORLD.runSeed, name: DEFAULT_WORLD.founderName }),
      activeChallengeGroupRound: group,
    };
    const input = file({ world: { ...DEFAULT_WORLD, playerPro: career } });
    const persisted = payloadForPersistence(input as Parameters<typeof payloadForPersistence>[0]);
    expect(persisted.world.playerPro?.activeChallengeGroupRound).toEqual(group);

    const loaded = normalizeLoadedSaveResult(input);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.payload.world.playerPro?.activeChallengeGroupRound).toEqual(group);
    expect(loaded.payload.world.playerPro?.activeRound).toBeNull();

    const corrupt = JSON.parse(JSON.stringify(group)) as ChallengeGroupRound;
    (corrupt as { activeGolferId: string }).activeGolferId = "unknown-golfer";
    expect(() => payloadForPersistence({
      ...persisted,
      world: { ...persisted.world, playerPro: { ...career, activeChallengeGroupRound: corrupt } },
    })).toThrow("Cannot save active ChallengeGroupRound");
    const rejectedLoad = normalizeLoadedSaveResult(file({
      world: { ...DEFAULT_WORLD, playerPro: { ...career, activeChallengeGroupRound: corrupt } },
    }));
    expect(rejectedLoad.ok).toBe(true);
    if (rejectedLoad.ok) expect(rejectedLoad.payload.world.playerPro?.activeChallengeGroupRound).toBeNull();
  });

  it("round-trips inventory, equipment, appraisal identity, and rival custody without duplication", () => {
    const playerPro = createDefaultPlayerPro({ seed: DEFAULT_WORLD.runSeed });
    const item = {
      id: "stable-watch-1",
      definitionId: "authored-watch-1",
      name: "Field Chronometer",
      category: "watch" as const,
      ownerId: playerPro.identity.id,
      custodianId: playerPro.identity.id,
      authoredValue: 4200,
      remainingValue: 4200,
      prestige: 78,
      unique: true,
      confirmationRequired: true,
      transferable: true as const,
      transferHistory: [],
    };
    const custodyItem = { ...item, id: "lost-watch-2", ownerId: "rival-1", custodianId: "rival-1", transferHistory: [{ id: "settle-1", week: 3, day: 2, fromOwnerId: playerPro.identity.id, toOwnerId: "rival-1", custodianId: "rival-1", reason: "stake" as const }] };
    const world = {
      ...file().world,
      playerPro: {
        ...playerPro,
        inventory: { ...playerPro.inventory, items: [item] },
        equipmentLoadout: { clubItemIds: [], watchItemId: item.id },
        rivalCustody: [{ id: "challenge-1:watch", rivalId: "rival-1", rivalName: "Rival", challengeId: "challenge-1", itemId: custodyItem.id, itemSnapshot: custodyItem, acquiredWeek: 3, acquiredDay: 2, status: "held" as const }],
      },
    };
    const first = parseSaveText(JSON.stringify(file({ world })));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.payload.world.playerPro).toMatchObject({
      inventory: { items: [{ id: item.id, definitionId: item.definitionId }] },
      equipmentLoadout: { watchItemId: item.id },
      rivalCustody: [{ id: "challenge-1:watch", itemId: custodyItem.id, status: "held" }],
    });
    const second = parseSaveText(JSON.stringify({ schemaVersion: CURRENT_SAVE_SCHEMA_VERSION, savedAt: 999, ...first.payload }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.payload.world.playerPro?.inventory.items).toHaveLength(1);
    expect(second.payload.world.playerPro?.rivalCustody).toHaveLength(1);
  });

  it("migrates deterministic regular profiles without replacing names or relationships", () => {
    const world = {
      ...file().world,
      livingClub: {
        ...emptyLivingClubState(),
        regulars: [{
          id: "named-regular-1",
          kind: "regular",
          name: "Existing Name",
          rounds: 4,
          relationship: { score: 31, tier: "friend", interactionIds: ["talk-1", "round-2"] },
        }],
      },
    };
    const result = normalizeLoadedSaveResult(file({ world }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.world.livingClub?.regulars[0]).toMatchObject({
      id: "named-regular-1",
      name: "Existing Name",
      relationship: { score: 31, interactionIds: ["talk-1", "round-2"] },
      backstory: { version: 1, source: "curated-package" },
      rivalProfile: { version: 1 },
    });
    const again = normalizeLoadedSaveResult({ schemaVersion: CURRENT_SAVE_SCHEMA_VERSION, savedAt: 999, ...result.payload });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.payload.world.livingClub?.regulars[0]).toEqual(result.payload.world.livingClub?.regulars[0]);
  });

  it("round-trips a newly generated Parkland starter landscape without rewriting it", () => {
    const run = createNewGame({
      mode: "sandbox",
      courseName: "Starter Pond",
      seed: 7,
      theme: "parkland",
      difficulty: "normal",
    });
    const result = parseSaveText(JSON.stringify(file({
      course: run.course,
      world: run.world,
    })));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.course.tiles).toEqual(run.course.tiles);
    expect(result.payload.course.elevations).toEqual(run.course.elevations);
    expect(result.payload.course.obstacles).toEqual(run.course.obstacles);
    expect(result.payload.course.estate).toEqual(run.course.estate);
    expect(result.payload.world.runSeed).toBe(run.world.runSeed);
  });

  it("round-trips sparse local surface care without changing authored terrain", () => {
    const tiles = DEFAULT_COURSE.tiles.slice();
    for (let y = 2; y < 7; y++) for (let x = 2; x < 11; x++) {
      tiles[y * DEFAULT_COURSE.width + x] = "green";
    }
    const authored = { ...DEFAULT_COURSE, tiles, condition: .78 };
    const absoluteDay = 7;
    const savedWorld = { ...file().world, week: 2 };
    const weather = weatherForDay(
      savedWorld.runSeed,
      authored.theme ?? "parkland",
      absoluteDay,
    );
    const cared = advanceSurfaceCareDay({
      course: authored,
      world: savedWorld,
      absoluteDay,
      weather,
      climate: biomeClimatePhenologyForDay(
        authored.theme ?? "parkland",
        absoluteDay,
      ),
      turfPriority: "playability",
      waterPolicy: "balanced",
      drainageLevel: 0,
      rounds: 18,
    }).course;
    const result = parseSaveText(JSON.stringify(file({
      course: cared,
      world: savedWorld,
    })));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.course.tiles).toEqual(authored.tiles);
    expect(result.payload.course.surfaceCare).toEqual(cared.surfaceCare);
    expect(Object.keys(result.payload.course.surfaceCare?.records ?? {}).length)
      .toBeLessThan(result.payload.course.tiles.length);
  });

  it("migrates v24 without inventing local neglect history", () => {
    const legacyCourse = { ...DEFAULT_COURSE };
    delete legacyCourse.surfaceCare;
    const result = normalizeLoadedSaveResult(file({
      schemaVersion: 24,
      course: legacyCourse,
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(24);
    expect(result.payload.course.surfaceCare).toBeUndefined();
    expect(result.payload.course.tiles).toEqual(DEFAULT_COURSE.tiles);
    expect(result.payload.course.condition).toBe(DEFAULT_COURSE.condition);
  });

  it("migrates v25 to flat healthy greens without changing M53 care or A/B/C setups", () => {
    const tiles = DEFAULT_COURSE.tiles.slice();
    for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) tiles[y * DEFAULT_COURSE.width + x] = "green";
    const pins = {
      A: { x: 3, y: 3 },
      B: { x: 4, y: 3 },
      C: { x: 3, y: 4 },
    };
    const authored = {
      ...DEFAULT_COURSE,
      tiles,
      holes: DEFAULT_COURSE.holes.map((hole, index) => index === 0 ? {
        ...hole,
        green: pins.A,
        pinPositions: pins,
      } : hole),
    };
    const weather = weatherForDay(DEFAULT_WORLD.runSeed, authored.theme ?? "parkland", 7);
    const cared = advanceSurfaceCareDay({
      course: authored,
      world: { ...DEFAULT_WORLD, week: 2 },
      absoluteDay: 7,
      weather,
      climate: biomeClimatePhenologyForDay(authored.theme ?? "parkland", 7),
      turfPriority: "playability",
      waterPolicy: "balanced",
      drainageLevel: 0,
      rounds: 12,
    }).course;
    const legacy = structuredClone(cared) as typeof cared & {
      greenSurface?: unknown;
      greenProgram?: unknown;
      greenLocalState?: unknown;
    };
    delete legacy.greenSurface;
    delete legacy.greenProgram;
    delete legacy.greenLocalState;

    const result = normalizeLoadedSaveResult(file({
      schemaVersion: 25,
      course: legacy,
      world: { ...file().world, week: 2 },
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(25);
    expect(result.payload.course.greenSurface).toMatchObject({ version: 1, tiles: [] });
    expect(result.payload.course.greenProgram?.preset).toBe("balanced");
    expect(result.payload.course.greenLocalState?.holes).toHaveLength(DEFAULT_COURSE.holes.length);
    expect(result.payload.course.greenLocalState?.holes.every((hole) =>
      hole.health === 1 && hole.moisture === 0.58 && hole.compaction === 0 && hole.wear === 0
    )).toBe(true);
    expect(result.payload.course.holes[0].pinPositions).toEqual(pins);
    expect(result.payload.course.surfaceCare).toEqual(cared.surfaceCare);
  });

  it("normalizes hostile surface-care records to current topology and bounds", () => {
    const tiles = DEFAULT_COURSE.tiles.slice();
    for (let y = 1; y < 5; y++) for (let x = 1; x < 5; x++) {
      tiles[y * DEFAULT_COURSE.width + x] = "green";
    }
    const course = { ...DEFAULT_COURSE, tiles };
    const zone = surfaceCareTopology(course).zones.find(
      (candidate) => candidate.intendedTerrain === "green",
    )!;
    const hostile = {
      ...course,
      surfaceCare: {
        version: 1 as const,
        cellSize: 8 as const,
        lastAdvancedAbsoluteDay: 1e308,
        records: {
          [zone.key]: {
            key: "spoofed",
            surfaceId: "spoofed",
            cellX: 999,
            cellY: -999,
            intendedTerrain: "tee",
            area: 999_999,
            mowingQuality: -4,
            moisture: 9,
            turfHealth: 4,
            wear: -2,
            dormancy: 3,
            drainageStress: 7,
            failureDurationDays: 999_999,
            missedMowingDays: -10,
            insufficientWaterDays: 999_999,
            saturatedDays: 999_999,
            repairRequired: true,
            repairProgress: 1e308,
            repair: {
              kind: "resod",
              cost: 1e308,
              requiredDays: 1e308,
              progressDays: 1e308,
              startedAbsoluteDay: 1e308,
              elevatedWaterDaysRemaining: 1e308,
            },
            lastDemand: 1e308,
            lastAllocated: 1e308,
            lastTraffic: 1e308,
            lastIrrigationDemand: 1e308,
            lastIrrigationApplied: 1e308,
            lastElevatedWaterDemand: 1e308,
            lastElevatedWaterApplied: 1e308,
            lastObservedAbsoluteDay: 1e308,
          },
          "unknown-surface:999:999": {
            key: "unknown-surface:999:999",
            intendedTerrain: "green",
          },
        },
      },
    };
    const result = normalizeLoadedSaveResult(file({
      course: hostile,
      world: { ...file().world, week: 3 },
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const state = result.payload.course.surfaceCare!;
    expect(Object.keys(state.records)).toEqual([zone.key]);
    const telemetryMaximum = zone.cells.length * 10_000;
    expect(state.lastAdvancedAbsoluteDay).toBe(14);
    expect(state.records[zone.key]).toMatchObject({
      key: zone.key,
      surfaceId: zone.surfaceId,
      cellX: zone.cellX,
      cellY: zone.cellY,
      intendedTerrain: "green",
      area: zone.cells.length,
      mowingQuality: 0,
      moisture: 1,
      turfHealth: 1,
      wear: 0,
      dormancy: 1,
      drainageStress: 1,
      failureDurationDays: 3650,
      missedMowingDays: 0,
      insufficientWaterDays: 3650,
      saturatedDays: 3650,
      repairRequired: true,
      repairProgress: 1,
      lastDemand: telemetryMaximum,
      lastAllocated: telemetryMaximum,
      lastTraffic: telemetryMaximum,
      lastIrrigationDemand: telemetryMaximum,
      lastIrrigationApplied: telemetryMaximum,
      lastElevatedWaterDemand: telemetryMaximum,
      lastElevatedWaterApplied: telemetryMaximum,
      lastObservedAbsoluteDay: 14,
      repair: {
        kind: "resod",
        cost: zone.cells.length * 100_000,
        requiredDays: 10,
        progressDays: 10,
        startedAbsoluteDay: 14,
        elevatedWaterDaysRemaining: 10,
      },
    });

    const nextDay = 15;
    const advanced = advanceSurfaceCareDay({
      course: result.payload.course,
      world: {
        ...result.payload.world,
        maintenanceBudget: 1_000_000,
        staffLevel: 5,
      },
      absoluteDay: nextDay,
      weather: weatherForDay(
        result.payload.world.runSeed,
        result.payload.course.theme ?? "parkland",
        nextDay,
      ),
      climate: biomeClimatePhenologyForDay(
        result.payload.course.theme ?? "parkland",
        nextDay,
      ),
      turfPriority: "recovery",
      waterPolicy: "irrigate",
      drainageLevel: 1,
      rounds: 0,
    });
    expect(advanced.course.surfaceCare?.lastAdvancedAbsoluteDay).toBe(nextDay);
    expect(advanced.course.surfaceCare?.records[zone.key].lastObservedAbsoluteDay)
      .toBe(nextDay);
    expect(advanced.course.surfaceCare?.records[zone.key].repair).toBeUndefined();
  });

  it("migrates a v1 save through the explicit chain", () => {
    const result = normalizeLoadedSaveResult(file({ schemaVersion: 1 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(1);
    expect(result.payload.world.cash).toBe(DEFAULT_WORLD.cash);
  });

  it("migrates historical biome labels losslessly and persists canonical compatibility evidence", () => {
    for (const [legacy, canonical] of [["Parkland", "parkland"], ["Links", "links"], ["Desert", "desert"]] as const) {
      const source = file({
        schemaVersion: 22,
        course: { ...DEFAULT_COURSE, theme: legacy, biomeCompatibility: undefined },
      });
      const result = normalizeLoadedSaveResult(source);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.payload.course.theme).toBe(canonical);
      expect(result.payload.course.biomeCompatibility).toEqual(
        biomeCompatibilityMetadataFor(canonical),
      );
      expect(result.payload.course.tiles).toEqual(DEFAULT_COURSE.tiles);
      expect(result.payload.world.runSeed).toBe(DEFAULT_WORLD.runSeed);
    }

    const persisted = payloadForPersistence({
      course: { ...DEFAULT_COURSE, theme: "desert", biomeCompatibility: undefined },
      world: DEFAULT_WORLD,
    });
    expect(persisted.course.biomeCompatibility).toEqual(
      biomeCompatibilityMetadataFor("desert"),
    );
  });

  it("migrates semantic planting provenance idempotently with bounded save growth", () => {
    const course = {
      ...DEFAULT_COURSE,
      theme: "desert" as const,
      biomeCompatibility: biomeCompatibilityMetadataFor("desert"),
      obstacles: [
        { x: 1, y: 1, type: "tree" as const },
        { x: 2, y: 1, type: "rock" as const },
      ],
      decorations: [
        { kind: "flower_bed" as const, x: 3, y: 1, rotation: 0 as const },
        { kind: "bench" as const, x: 4, y: 1, rotation: 0 as const },
      ],
    };
    const legacy = file({ schemaVersion: 23, course });
    const legacyDecorationBytes = JSON.stringify(course.decorations).length;
    const first = normalizeLoadedSaveResult(legacy);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.migratedFrom).toBe(23);
    // Legacy/generated obstacles remain natural/free by omission.
    expect(first.payload.course.obstacles).toEqual(course.obstacles);
    // Generated and player-authored legacy plantings are indistinguishable,
    // so missing provenance fails conservatively to natural/free.
    expect(first.payload.course.decorations).toEqual([
      {
        kind: "flower_bed",
        x: 3,
        y: 1,
        rotation: 0,
        origin: "natural",
      },
      { kind: "bench", x: 4, y: 1, rotation: 0 },
    ]);
    expect(
      JSON.stringify(first.payload.course.decorations).length
      - legacyDecorationBytes,
    ).toBeLessThan(256);
    expect(JSON.stringify(first.payload).length).toBeLessThan(5_000_000);

    const second = normalizeLoadedSaveResult({
      schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
      savedAt: 123,
      ...first.payload,
    });
    expect(second.ok, second.ok ? undefined : second.error.message).toBe(true);
    if (!second.ok) return;
    expect(second.migratedFrom).toBeUndefined();
    expect(second.payload).toEqual(first.payload);
  });

  it("rejects unsupported or contradictory save and active-round biome evidence atomically", () => {
    expect(normalizeLoadedSaveResult(file({
      course: { ...DEFAULT_COURSE, theme: "moonbase" as never },
    }))).toMatchObject({
      ok: false,
      error: { code: "INVALID_COURSE", message: expect.stringContaining("moonbase") },
    });

    const activeRound = {
      version: 1,
      id: "hostile-round",
      course: {
        theme: "moonbase",
        holes: [{}],
        tiles: [],
        elevations: [],
        width: 0,
        height: 0,
      },
    };
    expect(normalizeLoadedSaveResult(file({
      world: {
        ...DEFAULT_WORLD,
        playerPro: {
          ...createDefaultPlayerPro({ seed: DEFAULT_WORLD.runSeed }),
          activeRound,
        },
      },
    }))).toMatchObject({
      ok: false,
      error: { code: "INVALID_WORLD", message: expect.stringContaining("moonbase") },
    });

    expect(() => payloadForPersistence({
      course: { ...DEFAULT_COURSE, theme: "moonbase" as never },
      world: DEFAULT_WORLD,
    })).toThrow("Cannot save unsupported biome");
    expect(() => payloadForPersistence({
      course: {
        ...DEFAULT_COURSE,
        theme: "links",
        biomeCompatibility: biomeCompatibilityMetadataFor("desert"),
      },
      world: DEFAULT_WORLD,
    })).toThrow("does not match course biome");
  });

  it("advances a v19 save to v20 deterministically without changing completed Player Pro shots", () => {
    const base = file({ schemaVersion: 19 });
    const activeRound = {
      version: 1 as const,
      id: "active-v19",
      kind: "casual" as const,
      phase: "awaiting_shot" as const,
      course: {
        courseId: DEFAULT_COURSE.activeCourseId!,
        courseName: DEFAULT_COURSE.name,
        theme: DEFAULT_COURSE.theme!,
        width: DEFAULT_COURSE.width,
        height: DEFAULT_COURSE.height,
        yardsPerTile: DEFAULT_COURSE.yardsPerTile,
        tiles: [...DEFAULT_COURSE.tiles],
        elevations: [...DEFAULT_COURSE.elevations],
        obstacles: [],
        holes: DEFAULT_COURSE.holes.map((hole, index) => ({
          id: hole.id!,
          name: hole.name!,
          par: 4,
          tee: { x: 1, y: index + 1 },
          pin: { x: 10, y: index + 1 },
          waypoints: [],
        })),
      },
      teeSet: "member" as const,
      pinRotation: "A" as const,
      currentHoleIndex: 0,
      ball: { x: 1, y: 1 },
      lie: "tee",
      strokes: 0,
      penalties: 0,
      scorecard: [],
      shots: [],
      pendingShot: null,
      rngSeed: 1,
      rngCursor: 0,
      autoPlay: false,
      rewardsApplied: false,
      startedWeek: 1,
      startedDay: 0,
    };
    const rounds = [{
      id: "historical-round",
      kind: "casual" as const,
      courseId: DEFAULT_COURSE.activeCourseId ?? "course-primary",
      courseName: DEFAULT_COURSE.name,
      week: 1,
      strokes: 4,
      penalties: 0,
      par: 4,
      scoreToPar: 0,
      result: "complete" as const,
      earnings: 0,
      scorecard: [],
      shots: [{ id: "historical-shot", seed: 41 }],
      evidence: [],
      skillGains: {},
    }];
    const first = normalizeLoadedSaveResult({
      ...base,
      world: {
        ...(base.world as typeof DEFAULT_WORLD),
        playerPro: {
          ...createDefaultPlayerPro({ seed: DEFAULT_WORLD.runSeed }),
          activeRound,
          rounds,
        },
      },
    });
    const second = normalizeLoadedSaveResult(JSON.parse(JSON.stringify({
      ...base,
      world: {
        ...(base.world as typeof DEFAULT_WORLD),
        playerPro: {
          ...createDefaultPlayerPro({ seed: DEFAULT_WORLD.runSeed }),
          activeRound,
          rounds,
        },
      },
    })));
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.migratedFrom).toBe(19);
    expect(first.payload.world.playerPro?.rounds).toEqual(second.payload.world.playerPro?.rounds);
    expect(first.payload.world.playerPro?.rounds[0]?.shots).toEqual(rounds[0].shots);
    expect(first.payload.world.playerPro?.activeRound?.rulesSnapshot?.version).toBe(2);
    expect(first.payload.world.playerPro?.activeRound?.course.greenSnapshot).toMatchObject({
      version: 1,
      surface: { version: 1, tiles: [] },
      program: { preset: "balanced" },
    });
    expect(first.payload.world.playerPro?.activeRound?.rulesSnapshot)
      .toEqual(second.payload.world.playerPro?.activeRound?.rulesSnapshot);
  });

  it("migrates legacy Cart Rental price and fleet deterministically into course-owned M51 state", () => {
    const course = {
      ...DEFAULT_COURSE,
      buildings: [{ id: "cart-house", type: "cart_rental" as const, x: 4, y: 4, tier: 3 as const, price: 27 }],
    };
    const result = normalizeLoadedSaveResult(file({
      schemaVersion: 21,
      course,
      world: {
        ...DEFAULT_WORLD,
        m51: { version: 1, products: { old: { id: "old", courseId: "course-primary", mode: "riding_cart", name: "Old", price: 27, enabled: true } }, fleet: { unit: { id: "unit", courseId: "course-primary", productId: "old", mode: "riding_cart", seats: 2, state: "available" } }, history: { settledTransactions: [], observedEvidence: [] } },
      },
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(21);
    expect(result.payload.course.m51?.cartRentals["cart-house"]?.tier).toBe(3);
    expect(result.payload.course.m51?.cartRentals["cart-house"]?.products.riding_cart.price).toBe(27);
    expect(result.payload.course.m51?.cartRentals["cart-house"]?.products.pushcart.price).toBe(9);
    expect(result.payload.course.m51?.fleet.unit?.productId).toBe("cart-house:riding_cart");
    expect(result.payload.world.m51).toEqual({ version: 3, history: { settledTransactions: [], observedEvidence: [], dailyLedgers: [], weeklyReports: [] }, aggregates: {} });
  });

  it("repairs an untouched v18 Links starter overlay from the estate seed", () => {
    const { current, legacy } = legacyLinksOverlay();
    expect(legacy.course.tiles).not.toEqual(current.course.tiles);

    const result = normalizeLoadedSaveResult({
      schemaVersion: 18,
      savedAt: 123,
      course: legacy.course,
      world: legacy.world,
      history: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(18);
    expect(result.payload.course.tiles).toEqual(current.course.tiles);
    expect(result.payload.course.elevations).toEqual(current.course.elevations);
    expect(result.payload.course.estate?.generationVersion).toBe(2);
  });

  it("does not overwrite authored terrain when migrating a v18 Links save", () => {
    const { legacy } = legacyLinksOverlay();
    const authoredIndex = 70 * COURSE_WIDTH + 110;
    legacy.course.tiles[authoredIndex] = "fairway";

    const result = normalizeLoadedSaveResult({
      schemaVersion: 18,
      savedAt: 123,
      course: legacy.course,
      world: legacy.world,
      history: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.course.tiles[authoredIndex]).toBe("fairway");
    expect(result.payload.course.estate?.generationVersion).toBe(1);
    expect(result.payload.course.width).toBe(COURSE_WIDTH);
    expect(result.payload.course.height).toBe(COURSE_HEIGHT);
  });

  it("translates M35 surface intent with a legacy grid migration", () => {
    const width = STARTER_PARCEL_WIDTH;
    const height = STARTER_PARCEL_HEIGHT;
    const tiles = new Array(width * height).fill("rough" as const);
    const elevations = new Array(width * height).fill(0);
    const draft = corridorFeature(
      { width, surfaceIntent: { version: 1, nextId: 2, features: [] } },
      "fairway",
      [{ x: 10.5, y: 20.5 }, { x: 30.5, y: 20.5 }],
      2.5,
    );
    const raster = rasterizeSurfaceFeatureDetailed(draft, width, height);
    for (const point of raster.tiles) tiles[point.y * width + point.x] = "fairway";
    const feature = {
      ...draft,
      coverage: raster.tiles.map((point) => point.y * width + point.x),
      renderRings: raster.rings,
    };
    const offset = starterParcelOffset();

    const result = normalizeLoadedSaveResult({
      schemaVersion: 12,
      savedAt: 123,
      course: {
        ...DEFAULT_COURSE,
        width,
        height,
        tiles,
        elevations,
        layouts: undefined,
        activeCourseId: undefined,
        property: undefined,
        surfaceIntent: { version: 1, nextId: 2, features: [feature] },
      },
      world: DEFAULT_WORLD,
      history: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const migrated = result.payload.course.surfaceIntent?.features[0];
    expect(migrated?.geometry.kind).toBe("corridor");
    if (!migrated || migrated.geometry.kind !== "corridor") return;
    expect(migrated.geometry.knots[0]).toEqual({ x: 10.5 + offset.x, y: 20.5 + offset.y });
    expect(migrated.coverage).toEqual(
      feature.coverage.map((index) => {
        const x = index % width;
        const y = Math.floor(index / width);
        return (y + offset.y) * COURSE_WIDTH + x + offset.x;
      }).sort((a, b) => a - b),
    );
    expect(migrated.renderRings?.[0]?.[0]).toEqual({
      x: (feature.renderRings?.[0]?.[0].x ?? 0) + offset.x,
      y: (feature.renderRings?.[0]?.[0].y ?? 0) + offset.y,
    });
  });

  it("rejects malformed JSON and future schema versions with useful errors", () => {
    expect(parseSaveText("{broken")).toEqual({
      ok: false,
      error: { code: "INVALID_JSON", message: "The save file is not valid JSON." },
    });
    const future = normalizeLoadedSaveResult(file({ schemaVersion: 999 }));
    expect(future).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_VERSION" } });
  });

  it("rejects hostile dimensions and mismatched terrain arrays before allocation", () => {
    const huge = normalizeLoadedSaveResult(file({
      course: { ...DEFAULT_COURSE, width: Number.MAX_SAFE_INTEGER },
    }));
    expect(huge).toMatchObject({ ok: false, error: { code: "INVALID_COURSE" } });

    const shortGrid = normalizeLoadedSaveResult(file({
      course: { ...DEFAULT_COURSE, tiles: DEFAULT_COURSE.tiles.slice(1) },
    }));
    expect(shortGrid).toMatchObject({
      ok: false,
      error: { code: "INVALID_COURSE", message: "The saved terrain grid is malformed." },
    });
  });

  it("rejects invalid terrain and out-of-bounds hole coordinates", () => {
    const badTerrain = [...DEFAULT_COURSE.tiles];
    badTerrain[0] = "lava" as never;
    expect(normalizeLoadedSaveResult(file({
      course: { ...DEFAULT_COURSE, tiles: badTerrain },
    }))).toMatchObject({ ok: false, error: { code: "INVALID_COURSE" } });

    const holes = DEFAULT_COURSE.holes.map((hole, index) =>
      index === 0 ? { ...hole, tee: { x: -1, y: 0 } } : hole
    );
    expect(normalizeLoadedSaveResult(file({
      course: { ...DEFAULT_COURSE, holes },
    }))).toMatchObject({ ok: false, error: { code: "INVALID_COURSE" } });
  });

  it("rejects non-finite core economy fields", () => {
    const result = normalizeLoadedSaveResult(file({
      world: { ...DEFAULT_WORLD, cash: Number.NaN },
    }));
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_WORLD" },
    });
  });
});
