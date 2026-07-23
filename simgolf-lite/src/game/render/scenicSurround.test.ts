import { describe, expect, it } from "vitest";
import type { Course, Terrain } from "../models/types";
import { clampScenicCameraCenter, detectLinksCoast, generateScenicSurround, isScenicOceanPoint } from "./scenicSurround";

function course(theme: Course["theme"], width = 40, height = 24): Course {
  return {
    width,
    height,
    theme,
    tiles: Array.from({ length: width * height }, () => "rough" as Terrain),
    elevations: Array(width * height).fill(0),
    holes: [],
    obstacles: [],
    buildings: [],
    yardsPerTile: 10,
    name: "Surround fixture",
    baseGreenFee: 50,
    condition: 1,
  };
}

describe("regional scenic surround", () => {
  it("recognizes substantial Links coastlines without promoting small ponds", () => {
    const links = course("links");
    for (let x = 0; x < links.width; x++) links.tiles[x] = "water";
    expect(detectLinksCoast(links)).toBe("north");
    expect(isScenicOceanPoint("north", { x: 12, y: -4 }, links.width, links.height)).toBe(true);
    expect(isScenicOceanPoint("north", { x: 12, y: 4 }, links.width, links.height)).toBe(false);

    const pond = course("links");
    pond.tiles[0] = "water";
    pond.tiles[1] = "water";
    expect(detectLinksCoast(pond)).toBeNull();
    const scattered = course("links");
    for (let x = 0; x < scattered.width; x += 2) scattered.tiles[x] = "water";
    expect(detectLinksCoast(scattered)).toBeNull();
    expect(detectLinksCoast({ ...links, theme: "parkland" })).toBeNull();
  });

  it("generates deterministic biome scenery only outside the estate and ocean", () => {
    const links = course("links");
    for (let y = 0; y < links.height; y++) links.tiles[y * links.width + links.width - 1] = "water";
    const a = generateScenicSurround(links, 1234);
    const b = generateScenicSurround(links, 1234);
    expect(a).toEqual(b);
    expect(a.coast).toBe("east");
    expect(a.coastline.length).toBeGreaterThan(links.height / 4);
    expect(a.coastline[0].y).toBeLessThan(0);
    expect(a.coastline[a.coastline.length - 1].y).toBeGreaterThan(links.height);
    expect(isScenicOceanPoint(a.coast, { x: links.width + 4, y: -20 }, links.width, links.height, a.coastline)).toBe(true);
    expect(a.patches.length).toBeGreaterThan(30);
    expect(a.props.length).toBeGreaterThan(10);
    expect(a.patches.every((patch) => patch.x > links.width || patch.y > links.height || patch.x + patch.width < 0 || patch.y + patch.height < 0)).toBe(true);
    expect(a.props.every((prop) => prop.x < 0 || prop.y < 0 || prop.x > links.width || prop.y > links.height)).toBe(true);
    expect(a.props.some((prop) => prop.x > links.width)).toBe(false);
    expect(a.roads.every((road) => road.from.x <= links.width && road.to.x <= links.width)).toBe(true);
  });

  it("clamps camera targets to a viewport-derived scenic margin with a hard cap", () => {
    expect(clampScenicCameraCenter({ x: -100, y: 200 }, 40, 24, 9, 12)).toEqual({ x: -9, y: 36 });
    expect(clampScenicCameraCenter({ x: -100, y: 200 }, 40, 24, 100, 100)).toEqual({ x: -48, y: 72 });
  });
});
