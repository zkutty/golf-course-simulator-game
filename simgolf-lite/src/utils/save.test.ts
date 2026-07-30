import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../game/models/defaults";
import { createDefaultPlayerPro } from "../game/playerPro/playerPro";
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
  it("round-trips a current save without changing gameplay state", () => {
    const result = parseSaveText(JSON.stringify(file()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.course).toEqual(DEFAULT_COURSE);
    expect(result.payload.world).toEqual(file().world);
    expect(result.migratedFrom).toBeUndefined();
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
