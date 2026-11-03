import { describe, expect, it } from "vitest";
import type { Course, Terrain } from "../models/types";
import {
  DAY_MINUTES,
  heronSpot,
  timeOfDayTint,
} from "./ambient";

function rgb(tint: number): [number, number, number] {
  return [(tint >> 16) & 0xff, (tint >> 8) & 0xff, tint & 0xff];
}

describe("timeOfDayTint", () => {
  it("is cool at dawn, neutral midday, warm at dusk", () => {
    const [mr, , mb] = rgb(timeOfDayTint(0));
    expect(mb).toBeGreaterThan(mr); // blue-leaning morning
    expect(timeOfDayTint(420)).toBe(0xffffff); // neutral plateau
    const [er, , eb] = rgb(timeOfDayTint(DAY_MINUTES));
    expect(er).toBeGreaterThan(eb); // warm evening
  });

  it("never pops: adjacent minutes differ by at most 2 per channel", () => {
    for (let m = 0; m < DAY_MINUTES; m++) {
      const a = rgb(timeOfDayTint(m));
      const b = rgb(timeOfDayTint(m + 1));
      for (let c = 0; c < 3; c++) expect(Math.abs(a[c] - b[c])).toBeLessThanOrEqual(2);
    }
  });

  it("stays subtle (within ~10% of neutral) and clamps out-of-range input", () => {
    for (let m = 0; m <= DAY_MINUTES; m += 10) {
      for (const c of rgb(timeOfDayTint(m))) {
        expect(c).toBeGreaterThanOrEqual(205);
        expect(c).toBeLessThanOrEqual(255);
      }
    }
    expect(timeOfDayTint(-50)).toBe(timeOfDayTint(0));
    expect(timeOfDayTint(99999)).toBe(timeOfDayTint(DAY_MINUTES));
  });
});

describe("heronSpot", () => {
  function course(w: number, h: number, water: Array<[number, number]>): Course {
    const tiles: Terrain[] = new Array(w * h).fill("rough");
    for (const [x, y] of water) tiles[y * w + x] = "water";
    return { width: w, height: h, tiles } as unknown as Course;
  }

  it("picks the shoreline tile nearest the course center", () => {
    const c = course(20, 20, [[10, 10], [10, 11], [2, 2]]);
    const spot = heronSpot(c);
    expect(spot).not.toBeNull();
    // Adjacent to the central pond, not the far corner puddle.
    const d = Math.hypot(spot!.x - 10, spot!.y - 10.5);
    expect(d).toBeLessThan(3);
    // And the spot itself is land.
    expect(c.tiles[spot!.y * 20 + spot!.x]).not.toBe("water");
  });

  it("returns null on a dry course", () => {
    expect(heronSpot(course(10, 10, []))).toBeNull();
  });
});
