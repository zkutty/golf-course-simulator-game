import { describe, expect, it } from "vitest";
import { applyAction } from "../../core/reducer";
import { DEFAULT_STATE } from "../gameState";
import { normalizeLoadedSaveResult } from "../../utils/save";
import { findWalkPath } from "../live/walkPath";
import { findBestPlayablePath } from "../sim/pathfind";
import { canPlaceDecoration, decorationCost, decorationTiles } from "./decorations";
import type { Course, Decoration } from "./types";

function crossingCourse(): Course {
  const width = 7; const height = 3;
  const tiles: Course["tiles"] = Array(width * height).fill("rough");
  for (let y = 0; y < height; y++) for (let x = 2; x <= 4; x++) tiles[y * width + x] = "water";
  return { ...DEFAULT_STATE.course, width, height, tiles, elevations: Array(width * height).fill(0), holes: [{ tee: null, green: null, parMode: "AUTO" }], obstacles: [], buildings: [], decorations: [] };
}

describe("M22 decoration and crossing contracts", () => {
  it("validates a complete bridge span and rejects unsupported or mismatched spans", () => {
    const course = crossingCourse();
    const bridge: Decoration = { kind: "bridge", x: 1, y: 1, rotation: 0, span: 3 };
    expect(decorationTiles(bridge)).toEqual([{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 }]);
    expect(canPlaceDecoration(course, bridge)).toEqual({ ok: true });
    expect(canPlaceDecoration(course, { ...bridge, span: 2 }).ok).toBe(false);
    expect(canPlaceDecoration(course, { ...bridge, kind: "boardwalk" }).ok).toBe(false);
    const steep = { ...course, elevations: course.elevations.map((value, index) => index === 1 * course.width + 5 ? 3 : value) };
    expect(canPlaceDecoration(steep, bridge)).toEqual({ ok: false, reason: "approach elevations do not meet" });
  });

  it("charges, rotates, and salvages decorations without charging invalid placement", () => {
    const course = crossingCourse();
    const bridge: Decoration = { kind: "bridge", x: 1, y: 1, rotation: 0, span: 3 };
    const state = { ...DEFAULT_STATE, course, world: { ...DEFAULT_STATE.world, cash: 20_000 } };
    const placed = applyAction(state, { type: "PLACE_DECORATION", decoration: bridge });
    expect(placed.course.decorations).toEqual([bridge]);
    expect(placed.world.cash).toBe(20_000 - decorationCost(bridge));
    // A bridge cannot rotate in place because its new span is unsupported.
    expect(applyAction(placed, { type: "ROTATE_DECORATION", x: 3, y: 1 })).toStrictEqual(placed);
    const removed = applyAction(placed, { type: "REMOVE_DECORATION", x: 4, y: 1 });
    expect(removed.course.decorations).toEqual([]);
    expect(removed.world.cash).toBeGreaterThan(placed.world.cash);
    const invalid = applyAction(state, { type: "PLACE_DECORATION", decoration: { ...bridge, x: 0 } });
    expect(invalid.world.cash).toBe(20_000);
  });

  it("opens the hazard crossing to both live and evaluation pathfinders", () => {
    const course = crossingCourse();
    const start = { x: 0, y: 1 }; const end = { x: 6, y: 1 };
    expect(findWalkPath(course, start, end)).toBeNull();
    expect(findBestPlayablePath(course, start, end)).toBeNull();
    const bridged = { ...course, decorations: [{ kind: "bridge" as const, x: 1, y: 1, rotation: 0 as const, span: 3 }] };
    expect(findWalkPath(bridged, start, end)).not.toBeNull();
    expect(findBestPlayablePath(bridged, start, end)?.path).toContainEqual({ x: 3, y: 1 });
  });

  it("migrates schema-v5 courses to an empty decoration list and sanitizes v6 input", () => {
    const course = crossingCourse();
    delete course.decorations;
    const migrated = normalizeLoadedSaveResult({ schemaVersion: 5, savedAt: 1, course, world: DEFAULT_STATE.world });
    expect(migrated.ok).toBe(true);
    if (migrated.ok) {
      expect(migrated.migratedFrom).toBe(5);
      expect(migrated.payload.course.decorations).toEqual([]);
    }
    const sanitized = normalizeLoadedSaveResult({
      schemaVersion: 6, savedAt: 1,
      course: { ...crossingCourse(), decorations: [{ kind: "bench", x: 1, y: 1, rotation: 8 }, { kind: "lamp", x: 1, y: 2, rotation: 2 }] },
      world: DEFAULT_STATE.world,
    });
    expect(sanitized.ok).toBe(true);
    if (sanitized.ok) expect(sanitized.payload.course.decorations).toEqual([{ kind: "lamp", x: 1, y: 2, rotation: 2 }]);
  });
});
