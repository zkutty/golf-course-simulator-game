import { describe, expect, it } from "vitest";
import type { Course, Terrain, World } from "../models/types";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import { tickWeek } from "./tickWeek";

// A 9-hole playable course: straight fairway holes side by side.
function playableCourse(): Course {
  const width = DEFAULT_COURSE.width;
  const height = DEFAULT_COURSE.height;
  const tiles: Terrain[] = Array.from({ length: width * height }, () => "fairway" as Terrain);
  const holes = [] as Course["holes"];
  for (let i = 0; i < 9; i++) {
    const y = 2 + i * 4;
    const tee = { x: 2, y };
    const green = { x: 40, y };
    tiles[y * width + tee.x] = "tee";
    tiles[y * width + green.x] = "green";
    holes.push({ tee, green, parMode: "AUTO" });
  }
  return {
    ...DEFAULT_COURSE,
    tiles,
    elevations: Array.from({ length: width * height }, () => 0),
    holes,
    obstacles: [],
    buildings: [],
    condition: 0.9,
  };
}

function world(): World {
  return { ...DEFAULT_WORLD, reputation: 60, cash: 50_000 };
}

describe("tickWeek itemized revenue (ZKU-120)", () => {
  it("without concessions the breakdown is green fees only", () => {
    const { result } = tickWeek(playableCourse(), world(), 42);
    expect(result.revenueBreakdown).toBeDefined();
    const rb = result.revenueBreakdown!;
    expect(rb.concessionsTotal).toBe(0);
    expect(rb.greenFees.revenue).toBe(result.revenue);
    expect(rb.total).toBe(result.revenue);
    expect(rb.greenFees.count).toBe(result.visitors);
  });

  it("concession buildings add itemized income and goods costs", () => {
    const course = playableCourse();
    course.buildings = [
      { type: "snackbar", x: 10, y: 20 },
      { type: "proshop", x: 20, y: 20 },
    ];
    const bare = tickWeek(playableCourse(), world(), 42).result;
    const { result } = tickWeek(course, world(), 42);
    const rb = result.revenueBreakdown!;
    expect(rb.concessionsTotal).toBeGreaterThan(0);
    expect(rb.concessions.snackbar!.count).toBeGreaterThan(0);
    expect(rb.concessions.proshop!.revenue).toBeGreaterThan(0);
    expect(rb.total).toBeCloseTo(rb.greenFees.revenue + rb.concessionsTotal, 6);
    expect(result.revenue).toBeGreaterThan(bare.revenue);
    expect(result.variableCosts!.concessionGoods!).toBeGreaterThan(0);
    // Concessions are profitable: added income exceeds added goods cost.
    expect(rb.concessionsTotal).toBeGreaterThan(result.variableCosts!.concessionGoods!);
  });

  it("two snack bars attach more buyers than one, with diminishing returns", () => {
    const one = playableCourse();
    one.buildings = [{ type: "snackbar", x: 10, y: 20 }];
    const two = playableCourse();
    two.buildings = [
      { type: "snackbar", x: 10, y: 20 },
      { type: "snackbar", x: 20, y: 20 },
    ];
    const rb1 = tickWeek(one, world(), 42).result.revenueBreakdown!;
    const rb2 = tickWeek(two, world(), 42).result.revenueBreakdown!;
    const c1 = rb1.concessions.snackbar!.count;
    const c2 = rb2.concessions.snackbar!.count;
    expect(c2).toBeGreaterThan(c1);
    expect(c2).toBeLessThan(c1 * 2);
  });
});
