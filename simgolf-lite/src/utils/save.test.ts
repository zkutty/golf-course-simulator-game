import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../game/models/defaults";
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
    world: DEFAULT_WORLD,
    history: [],
    ...overrides,
  };
}

describe("save validation and migrations", () => {
  it("round-trips a current save without changing gameplay state", () => {
    const result = parseSaveText(JSON.stringify(file()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.course).toEqual(DEFAULT_COURSE);
    expect(result.payload.world).toEqual(DEFAULT_WORLD);
    expect(result.migratedFrom).toBeUndefined();
  });

  it("migrates a v1 save through the explicit chain", () => {
    const result = normalizeLoadedSaveResult(file({ schemaVersion: 1 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(1);
    expect(result.payload.world.cash).toBe(DEFAULT_WORLD.cash);
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
