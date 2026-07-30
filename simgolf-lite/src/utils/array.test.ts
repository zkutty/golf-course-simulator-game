import { describe, expect, it } from "vitest";
import { lastItem, shuffleInPlace } from "./array";

describe("lastItem", () => {
  it("returns the final item and preserves empty collection behavior", () => {
    expect(lastItem(["easy", "hard"])).toBe("hard");
    expect(lastItem([])).toBeUndefined();
    expect(lastItem(undefined)).toBeUndefined();
  });
});

describe("shuffleInPlace", () => {
  it("uses a fixed Fisher-Yates draw schedule for seeded callers", () => {
    const draws = [0.1, 0.8, 0.4];
    let drawIndex = 0;
    const items = ["a", "b", "c", "d"];

    shuffleInPlace(items, {
      next: () => draws[drawIndex++],
    });

    expect(items).toEqual(["b", "d", "c", "a"]);
    expect(drawIndex).toBe(items.length - 1);
  });
});
