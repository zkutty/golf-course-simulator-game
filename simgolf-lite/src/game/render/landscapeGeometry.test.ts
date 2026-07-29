import { describe, expect, it } from "vitest";
import type { Course, Terrain } from "../models/types";
import {
  buildLandscapeComponents,
  buildVisualHeightfield,
  ringSignedArea,
  roundLandscapeRing,
  sampleLandscapeSurfaceHeight,
  sampleVisualHeight,
} from "./landscapeGeometry";

function courseWith(
  width: number,
  height: number,
  tiles: Terrain[],
  elevations = new Array(width * height).fill(0),
): Course {
  return {
    width,
    height,
    tiles,
    elevations,
    holes: [],
    obstacles: [],
    buildings: [],
    yardsPerTile: 10,
    name: "Landscape fixture",
    baseGreenFee: 30,
    condition: 1,
    theme: "parkland",
  };
}

describe("connected landscape geometry", () => {
  it("flood-fills components and preserves an enclosed hole", () => {
    const tiles: Terrain[] = [
      "water", "water", "water",
      "water", "rough", "water",
      "water", "water", "water",
    ];
    const water = buildLandscapeComponents(tiles, 3, 3)
      .find((component) => component.terrain === "water");
    expect(water?.cells).toHaveLength(8);
    expect(water?.rings).toHaveLength(2);
    expect(water!.rings.map(ringSignedArea).some((area) => area > 0)).toBe(true);
    expect(water!.rings.map(ringSignedArea).some((area) => area < 0)).toBe(true);
  });

  it("does not join diagonal islands at a kissing corner", () => {
    const components = buildLandscapeComponents([
      "water", "rough",
      "rough", "water",
    ], 2, 2).filter((component) => component.terrain === "water");
    expect(components).toHaveLength(2);
    expect(components.every((component) => component.rings.length === 1)).toBe(true);
  });

  it("rounds within the original edge envelope and retains narrow corridors", () => {
    const exact = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 1 },
      { x: 0, y: 1 },
    ];
    const rounded = roundLandscapeRing(exact, 0.9, 4);
    expect(rounded.length).toBeGreaterThan(exact.length);
    expect(Math.min(...rounded.map((point) => point.x))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...rounded.map((point) => point.x))).toBeLessThanOrEqual(3);
    expect(Math.min(...rounded.map((point) => point.y))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...rounded.map((point) => point.y))).toBeLessThanOrEqual(1);
    expect(Math.abs(ringSignedArea(rounded))).toBeGreaterThan(2);
  });

  it("uses a stable topology key independent of elevation and camera state", () => {
    const tiles = ["rough", "water", "water", "rough"] as Terrain[];
    const first = buildLandscapeComponents(tiles, 2, 2);
    const second = buildLandscapeComponents([...tiles], 2, 2);
    expect(second.map((component) => component.topologyKey))
      .toEqual(first.map((component) => component.topologyKey));
  });
});

describe("shared visual heightfield", () => {
  it("shares one vertex array and levels a connected water surface", () => {
    const course = courseWith(3, 2, [
      "rough", "water", "water",
      "rough", "water", "water",
    ], [
      2, 2, 3,
      2, 3, 3,
    ]);
    const field = buildVisualHeightfield(course);
    expect(field.vertices).toHaveLength((course.width + 1) * (course.height + 1));
    const waterSamples = [
      sampleVisualHeight(field, 1.25, 0.25),
      sampleVisualHeight(field, 2.75, 0.25),
      sampleVisualHeight(field, 1.25, 1.75),
      sampleVisualHeight(field, 2.75, 1.75),
    ];
    expect(Math.max(...waterSamples) - Math.min(...waterSamples)).toBeLessThan(1e-6);
    expect(waterSamples[0]).toBeLessThan(2.5);
  });

  it("levels building footprints without changing authoritative elevations", () => {
    const course = courseWith(
      4,
      4,
      new Array(16).fill("rough"),
      [
        0, 0, 0, 0,
        0, 2, 3, 0,
        0, 3, 2, 0,
        0, 0, 0, 0,
      ],
    );
    course.buildings = [{ id: "shop", type: "pro_shop", x: 1, y: 1, tier: 1 }];
    const original = [...course.elevations];
    const field = buildVisualHeightfield(course);
    const samples = [
      sampleVisualHeight(field, 1, 1),
      sampleVisualHeight(field, 3, 1),
      sampleVisualHeight(field, 1, 3),
      sampleVisualHeight(field, 3, 3),
      sampleVisualHeight(field, 2, 2),
    ];
    expect(Math.max(...samples) - Math.min(...samples)).toBeLessThan(1e-6);
    expect(course.elevations).toEqual(original);
  });

  it("keeps a readable discontinuity across a steep authored cliff", () => {
    const course = courseWith(2, 1, ["rough", "rough"], [0, 6]);
    const field = buildVisualHeightfield(course);
    expect(sampleVisualHeight(field, 0, 0.5)).toBeLessThan(sampleVisualHeight(field, 2, 0.5));
    expect(sampleVisualHeight(field, 1, 0.5)).toBeGreaterThan(1);
    expect(sampleVisualHeight(field, 1, 0.5)).toBeLessThan(5);
  });

  it("adds broad Links undulation while keeping Parkland and Desert quieter", () => {
    const course = courseWith(12, 12, new Array(144).fill("rough"));
    const range = (theme: "parkland" | "links" | "desert") => {
      const field = buildVisualHeightfield(course, theme);
      return Math.max(...field.vertices) - Math.min(...field.vertices);
    };
    expect(range("links")).toBeGreaterThan(range("parkland") * 1.7);
    expect(range("parkland")).toBeGreaterThan(range("desert"));
    expect(course.elevations).toEqual(new Array(144).fill(0));
  });

  it("eases a bunker floor below its shared grass boundary", () => {
    const course = courseWith(3, 3, [
      "rough", "rough", "rough",
      "rough", "sand", "rough",
      "rough", "rough", "rough",
    ]);
    const field = buildVisualHeightfield(course);
    const bunker = buildLandscapeComponents(course.tiles, 3, 3)
      .find((component) => component.terrain === "sand");
    const centerBase = sampleVisualHeight(field, 1.5, 1.5);
    const center = sampleLandscapeSurfaceHeight(field, bunker, 1.5, 1.5);
    const edge = sampleLandscapeSurfaceHeight(field, bunker, 1.05, 1.5);
    expect(center).toBeLessThan(centerBase - 0.2);
    expect(center).toBeLessThan(edge - 0.1);
  });
});
