import { describe, expect, it } from "vitest";
import { BIOME_KEYS, getBiomeDefinition } from "../game/models/biomes";
import { translate } from "../i18n/core";
import { courseVibeLabel, courseVibeTone } from "./courseVibe";

describe("registry-derived HUD course identity", () => {
  it("keeps the existing difficulty/aesthetics tone thresholds", () => {
    expect(courseVibeTone({ slope: 113, averageDifficulty: 50, averageAesthetics: 50 })).toBe("everyday");
    expect(courseVibeTone({ slope: 145, averageDifficulty: 50, averageAesthetics: 50 })).toBe("punishing");
    expect(courseVibeTone({ slope: 132, averageDifficulty: 50, averageAesthetics: 50 })).toBe("championship");
    expect(courseVibeTone({ slope: 120, averageDifficulty: 50, averageAesthetics: 75 })).toBe("resort");
    expect(courseVibeTone({ slope: 110, averageDifficulty: 42, averageAesthetics: 50 })).toBe("beginner");
  });

  it.each(BIOME_KEYS)("identifies beginner %s courses without borrowing another biome name", (theme) => {
    const biome = getBiomeDefinition(theme);
    const label = courseVibeLabel(
      theme,
      { slope: 55, averageDifficulty: 0, averageAesthetics: 0 },
      (key, params) => translate("en", key, params),
    );
    expect(label).toBe(`Beginner-friendly ${biome.label}`);
    for (const other of BIOME_KEYS.filter((key) => key !== theme)) {
      expect(label).not.toContain(getBiomeDefinition(other).label);
    }
  });

  it("uses the normal pseudo-locale path", () => {
    const label = courseVibeLabel(
      "links",
      { slope: 55, averageDifficulty: 0, averageAesthetics: 0 },
      (key, params) => translate("pseudo", key, params),
    );
    expect(label).toMatch(/^⟦/);
    expect(label).toContain("Lïñks");
  });
});
