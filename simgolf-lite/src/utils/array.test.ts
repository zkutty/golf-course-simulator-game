import { describe, expect, it } from "vitest";
import { lastItem } from "./array";

describe("lastItem", () => {
  it("returns the final item and preserves empty collection behavior", () => {
    expect(lastItem(["easy", "hard"])).toBe("hard");
    expect(lastItem([])).toBeUndefined();
    expect(lastItem(undefined)).toBeUndefined();
  });
});
