import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../game/models/defaults";
import { createDefaultPlayerPro } from "../game/playerPro/playerPro";
import { createEstate, starterParcelOffset } from "../game/estate/estate";
import { generateWildLandWithObstacles } from "../game/gen/generateWildLand";
import { createNewGame } from "../game/gen/newGame";
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
} from "./save";

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
