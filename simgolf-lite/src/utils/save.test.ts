import { describe, expect, it } from "vitest";
import { normalizeLoadedSave } from "./save";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../game/models/defaults";

function savePayload(buildings: unknown) {
  return {
    schemaVersion: 1,
    savedAt: 0,
    course: { ...DEFAULT_COURSE, buildings },
    world: { ...DEFAULT_WORLD },
  };
}

describe("save building sanitization (M4/ZKU-117)", () => {
  it("keeps well-formed concessions with tier and pricing", () => {
    const loaded = normalizeLoadedSave(
      savePayload([
        { type: "snackbar", x: 3, y: 3, tier: 2, pricing: "premium" },
        { type: "proshop", x: 10, y: 10 },
      ])
    );
    expect(loaded!.course.buildings).toEqual([
      { type: "snackbar", x: 3, y: 3, tier: 2, pricing: "premium" },
      { type: "proshop", x: 10, y: 10 },
    ]);
  });

  it("drops unknown types and normalizes malformed tier/pricing", () => {
    const loaded = normalizeLoadedSave(
      savePayload([
        { type: "casino", x: 3, y: 3 },
        { type: "snackbar", x: 5, y: 5, tier: 9, pricing: "free" },
      ])
    );
    expect(loaded!.course.buildings).toEqual([{ type: "snackbar", x: 5, y: 5 }]);
  });

  it("pre-M4 saves without buildings load with an empty list", () => {
    const loaded = normalizeLoadedSave(savePayload(undefined));
    expect(loaded!.course.buildings).toEqual([]);
  });
});
