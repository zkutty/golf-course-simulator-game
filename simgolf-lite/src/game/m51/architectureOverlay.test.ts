import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import { activeWeather } from "../seasons/seasons";
import { buildArchitectureMobilityOverlay } from "./architectureOverlay";

function fixture() {
  const width = 32; const height = 12;
  return {
    ...DEFAULT_COURSE, width, height, tiles: new Array(width * height).fill("fairway" as const), elevations: new Array(width * height).fill(0),
    holes: [
      { id: "one", tee: { x: 2, y: 5 }, green: { x: 13, y: 5 }, parMode: "AUTO" as const },
      { id: "two", tee: { x: 17, y: 5 }, green: { x: 28, y: 5 }, parMode: "AUTO" as const },
    ], obstacles: [], decorations: [], buildings: [],
  };
}

function rainyWorld(course: ReturnType<typeof fixture>) {
  for (let seed = 1; seed < 10_000; seed++) {
    const world = { ...DEFAULT_WORLD, runSeed: seed };
    if (activeWeather(world, course, 0).kind === "rain") return world;
  }
  throw new Error("deterministic rain fixture unavailable");
}

describe("M51 Architecture Review mobility overlay", () => {
  it("predicts distinct mode routes without mutating live or economy state", () => {
    const course = fixture();
    for (let x = 2; x < 29; x++) course.tiles[2 * course.width + x] = "path";
    const before = JSON.stringify(course);
    const overlay = buildArchitectureMobilityOverlay({ course, world: DEFAULT_WORLD, courseId: "course-primary", modes: ["walk", "pushcart", "riding_cart"] });
    expect(overlay.mobility).toMatchObject({ evidence: "predicted", modes: ["pushcart", "riding_cart", "walk"] });
    expect(overlay.render.traces.length).toBeGreaterThan(0);
    expect(JSON.stringify(course)).toBe(before);
  });

  it("explains weather-prohibited carts separately from unreachable links", () => {
    const course = fixture();
    const wet = buildArchitectureMobilityOverlay({ course, world: rainyWorld(course), courseId: "course-primary", modes: ["riding_cart"] });
    expect(wet.mobility.weather).toBe("wet");
    expect(wet.mobility.inaccessibleDestinations.some((row) => row.reason === "prohibited")).toBe(true);
    for (let y = 0; y < course.height; y++) course.tiles[y * course.width + 15] = "water";
    const unreachable = buildArchitectureMobilityOverlay({ course, world: DEFAULT_WORLD, courseId: "course-primary", modes: ["walk"] });
    expect(unreachable.mobility.inaccessibleDestinations.some((row) => row.reason === "unreachable")).toBe(true);
  });

  it("is bounded, deterministic, and invalidates cached predictions after geometry edits", () => {
    const course = fixture();
    const first = buildArchitectureMobilityOverlay({ course, world: DEFAULT_WORLD, courseId: "course-primary", modes: ["walk", "pushcart"] });
    const second = buildArchitectureMobilityOverlay({ course, world: DEFAULT_WORLD, courseId: "course-primary", modes: ["walk", "pushcart"] });
    expect(second).toEqual(first);
    expect(first.render.traces.length).toBeLessThanOrEqual(320);
    expect(first.render.cells.length).toBeLessThanOrEqual(180);
    course.tiles[5 * course.width + 8] = "water";
    const edited = buildArchitectureMobilityOverlay({ course, world: DEFAULT_WORLD, courseId: "course-primary", modes: ["walk", "pushcart"] });
    expect(edited).not.toEqual(first);
  });
});
