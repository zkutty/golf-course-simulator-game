import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import { activeWeather } from "../seasons/seasons";
import { authoredPathFixture, continuousPathFixture } from "../testing/continuousPathFixtures";
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

function pathCourse(path: ReturnType<typeof continuousPathFixture>, tee: { x: number; y: number }, green: { x: number; y: number }) {
  return {
    ...DEFAULT_COURSE, ...path,
    elevations: new Array(path.width * path.height).fill(0),
    holes: [{ id: "one", tee, green, parMode: "AUTO" as const }],
    obstacles: [], decorations: [], buildings: [],
  };
}

function holeTraces(overlay: ReturnType<typeof buildArchitectureMobilityOverlay>, mode: string) {
  return overlay.render.traces
    .filter((trace) => trace.id.startsWith(`one:hole:${mode}:`))
    .sort((a, b) => Number(a.id.split(":").at(-1)) - Number(b.id.split(":").at(-1)));
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

  it.each(["walk", "pushcart", "riding_cart"] as const)("includes the omitted start on a straight %s leg", (mode) => {
    const course = pathCourse(continuousPathFixture("straight"), { x: 2, y: 4 }, { x: 10, y: 4 });
    const overlay = buildArchitectureMobilityOverlay({ course, world: DEFAULT_WORLD, courseId: "course-straight", modes: [mode] });
    const traces = holeTraces(overlay, mode);

    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({ id: `one:hole:${mode}:0`, from: { x: 2, y: 4 }, to: { x: 10, y: 4 } });
  });

  it.each(["walk", "pushcart", "riding_cart"] as const)("renders a continuous actual saved-S %s route", (mode) => {
    const savedS = authoredPathFixture();
    savedS.tiles = savedS.tiles.map((terrain) => terrain === "path" ? terrain : "water");
    const course = pathCourse(savedS, { x: 2, y: 3 }, { x: 13, y: 5 });
    const overlay = buildArchitectureMobilityOverlay({ course, world: DEFAULT_WORLD, courseId: "course-saved-s", modes: [mode] });
    const traces = holeTraces(overlay, mode);

    expect(traces.length).toBeGreaterThan(1);
    expect(traces[0].from).toEqual({ x: 2, y: 3 });
    expect(traces.at(-1)?.to).toEqual({ x: 13, y: 5 });
    for (let index = 1; index < traces.length; index++) expect(traces[index].from).toEqual(traces[index - 1].to);
    expect(traces[0].id).toBe(`one:hole:${mode}:0`);
    expect(traces.every((trace) => trace.from.x !== trace.to.x || trace.from.y !== trace.to.y)).toBe(true);
    expect(new Set(traces.map((trace) => `${trace.from.x},${trace.from.y}>${trace.to.x},${trace.to.y}`)).size).toBe(traces.length);
  });
});
