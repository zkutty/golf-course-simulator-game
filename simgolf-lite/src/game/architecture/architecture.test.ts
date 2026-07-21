import { describe, expect, it } from "vitest";
import type { Course, Hole, Terrain } from "../models/types";
import { createEstate } from "../estate/estate";
import { analyzeArchitecture, architectureDemandMultiplier } from "./architecture";
import { BALANCE } from "../balance/balanceConfig";

function fixture(kind: "compact" | "sprawling" | "crossed" | "repetitive"): Course {
  const width = 44;
  const height = 34;
  const tiles = new Array<Terrain>(width * height).fill("rough");
  const elevations = new Array<number>(width * height).fill(0);
  const holes: Hole[] = [];
  for (let index = 0; index < 9; index++) {
    const row = 5 + index * 3;
    let start = { x: index % 2 ? 32 : 10, y: row };
    let end = { x: index % 2 ? 10 : 32, y: row + 1 };
    if (kind === "sprawling") { start = { x: index % 2 ? 41 : 2, y: row }; end = { x: index % 2 ? 2 : 41, y: row + 1 }; }
    if (kind === "crossed") { start = { x: index % 2 ? 38 : 5, y: 4 + index * 3 }; end = { x: index % 2 ? 5 : 38, y: 30 - index * 3 }; }
    if (kind === "repetitive") { start = { x: 6, y: row }; end = { x: 35, y: row }; }
    holes.push({ id: `hole-${index + 1}`, tee: start, green: end, parMode: "MANUAL", parManual: index % 3 === 0 ? 3 : index % 3 === 1 ? 4 : 5, name: `Hole ${index + 1}` });
    const steps = Math.ceil(Math.hypot(end.x - start.x, end.y - start.y));
    for (let step = 0; step <= steps; step++) {
      const x = Math.round(start.x + (end.x - start.x) * step / steps);
      const y = Math.round(start.y + (end.y - start.y) * step / steps);
      tiles[y * width + x] = step === 0 ? "tee" : step === steps ? "green" : "fairway";
    }
  }
  const base: Course = { width, height, tiles, elevations, holes, layouts: [{ id: "course-primary", name: "Architecture Test", draftHoleIds: holes.map((hole) => hole.id!), publishedHoleIds: holes.map((hole) => hole.id!), roundLength: 9, state: "open", greenFee: 75 }], activeCourseId: "course-primary", obstacles: [], buildings: [{ type: "clubhouse", x: 7, y: 3 }], decorations: [], yardsPerTile: 10, name: "Architecture Test", baseGreenFee: 75, condition: .9, theme: "parkland" };
  return { ...base, estate: createEstate(base, 270027) };
}

describe("M27 architecture intelligence", () => {
  it("returns deterministic weighted components with raw explainability", () => {
    const course = fixture("compact");
    const first = analyzeArchitecture(course);
    const second = analyzeArchitecture(course);
    expect(second).toBe(first);
    expect(first.total).toBeGreaterThanOrEqual(0);
    expect(first.total).toBeLessThanOrEqual(100);
    expect(Object.values(first.components).reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(1);
    for (const item of Object.values(first.components)) {
      expect(item.explanation.length).toBeGreaterThan(15);
      expect(Object.keys(item.raw).length).toBeGreaterThan(1);
    }
  });

  it("identifies crossed, sprawling, and repetitive adversarial routings", () => {
    const crossed = analyzeArchitecture(fixture("crossed"));
    const sprawling = analyzeArchitecture(fixture("sprawling"));
    const repetitive = analyzeArchitecture(fixture("repetitive"));
    expect(crossed.warnings.some((warning) => warning.kind === "crossing")).toBe(true);
    expect(sprawling.components.walkability.raw.totalWalkingTiles).toBeGreaterThan(analyzeArchitecture(fixture("compact")).components.walkability.raw.totalWalkingTiles);
    expect(repetitive.warnings.some((warning) => warning.kind === "repetition")).toBe(true);
    expect(crossed.components.safety.score).toBeLessThan(100);
  });

  it("measures baseline retention and bounds the demand influence", () => {
    const course = fixture("compact");
    const changed = { ...course, tiles: course.tiles.map((tile, index) => index % 3 === 0 ? "sand" as const : tile), elevations: course.elevations.map((value, index) => index % 8 === 0 ? value + 3 : value) };
    const report = analyzeArchitecture(changed);
    expect(report.components.naturalFit.raw.retainedTerrainPercent).toBeLessThan(75);
    expect(report.warnings.some((warning) => warning.kind === "earthwork")).toBe(true);
    expect(architectureDemandMultiplier(changed)).toBeGreaterThanOrEqual(1 - BALANCE.architecture.demandEffectMax);
    expect(architectureDemandMultiplier(changed)).toBeLessThanOrEqual(1 + BALANCE.architecture.demandEffectMax);
  });
});
