import { describe, expect, it } from "vitest";
import { musicContextFor } from "../../audio/environment";
import { generateWildLandWithObstacles } from "../gen/generateWildLand";
import { BIOME_KEYS, getBiomeDefinition } from "../models/biomes";
import { buildingVisualFrame } from "../models/buildings";
import { decorationVisual } from "../models/decorations";
import { DEFAULT_COURSE } from "../models/defaults";
import type { Course, ObstacleType } from "../models/types";
import { deriveGroundCover } from "./groundCover";
import { buildVisualHeightfield } from "./landscapeGeometry";
import { deriveTerrainDetail } from "./terrainDetails";
import { getTerrainMaterial, TERRAIN_KINDS } from "./terrainMaterials";
import { hillReliefStrength, terrainReliefStyle } from "./terrainRelief";
import { generateScenicSurround, scenicNaturalTerrain } from "./scenicSurround";
import { pickNaturalProp } from "./naturalProps";

function representativeCourse(theme: (typeof BIOME_KEYS)[number]): Course {
  const width = 40;
  const height = 28;
  const generated = generateWildLandWithObstacles(width, height, 560_101, [], theme);
  return {
    ...DEFAULT_COURSE,
    name: `${getBiomeDefinition(theme).label} registry smoke`,
    theme,
    width,
    height,
    tiles: generated.tiles,
    elevations: generated.elevations,
    obstacles: generated.obstacles,
    decorations: [],
    buildings: [{ type: "clubhouse", x: 18, y: 12 }],
    holes: [{
      id: `smoke-${theme}`,
      name: "Registry Route",
      tee: { x: 16, y: 14 },
      green: { x: 23, y: 14 },
      parMode: "MANUAL",
      parManual: 3,
    }],
  };
}

describe("ZK-560 registry-driven production consumers", () => {
  it.each(BIOME_KEYS)("generates and resolves representative render contracts for %s", (theme) => {
    const definition = getBiomeDefinition(theme);
    const course = representativeCourse(theme);
    expect(course.tiles).toHaveLength(course.width * course.height);
    expect(course.elevations).toHaveLength(course.tiles.length);
    expect(course.obstacles.length).toBeGreaterThan(0);

    for (const terrain of TERRAIN_KINDS) {
      const material = getTerrainMaterial(theme, terrain);
      expect(material.theme).toBe(definition.content.materials.terrain);
      expect(material.baseFrames.every((entry) =>
        entry.frame.startsWith(`${definition.content.materials.terrain}_`)
      )).toBe(true);
    }

    const heightfield = buildVisualHeightfield(course, theme);
    expect(heightfield.vertices).toHaveLength((course.width + 1) * (course.height + 1));
    expect([...heightfield.vertices].every(Number.isFinite)).toBe(true);
    expect(hillReliefStrength(theme)).toBeGreaterThan(0);
    expect(terrainReliefStyle(theme, "water")).toMatchObject({ surfaceInsetPx: 5 });

    const scenic = generateScenicSurround(course, 560_101);
    expect(scenic.theme).toBe(theme);
    expect(["rough", "deep_rough", "waste_area"]).toContain(scenicNaturalTerrain(theme));

    for (const obstacleType of ["tree", "bush", "rock"] as const satisfies readonly ObstacleType[]) {
      const picked = pickNaturalProp({
        theme,
        runSeed: 560_101,
        obstacle: { x: 7, y: 9, type: obstacleType },
        terrain: scenicNaturalTerrain(theme),
        elevation: 0,
        nearWater: false,
        cultivated: false,
      });
      expect(picked.variant.frame.startsWith(`${definition.content.props.natural}_`)).toBe(true);
    }

    expect(buildingVisualFrame({ type: "clubhouse", x: 0, y: 0 }, theme))
      .toMatch(new RegExp(`^${definition.content.structures.buildings}_`));
    expect(decorationVisual({ kind: "bench", x: 0, y: 0, rotation: 0 }, theme).frame)
      .toMatch(new RegExp(`^${definition.content.structures.decorations}_`));
    expect(musicContextFor({
      screen: "game",
      viewMode: "ARCHITECT",
      cash: 10_000,
      liveRunning: false,
      won: false,
      theme,
    })).toBe(definition.content.audio.designMusic);

    const coordinates = course.tiles
      .map((terrain, index) => ({ terrain, x: index % course.width, y: Math.floor(index / course.width) }))
      .filter(({ terrain }) => ["rough", "deep_rough", "sand", "waste_area", "wetland"].includes(terrain));
    const hasDetail = coordinates.some(({ x, y }) => deriveTerrainDetail(course, 560_101, x, y));
    const hasGroundCover = coordinates.some(({ x, y }) => deriveGroundCover(course, 560_101, x, y));
    expect(hasDetail).toBe(true);
    expect(hasGroundCover).toBe(true);
  });

  it("keeps every registered owner explicit instead of cross-falling back", () => {
    for (const theme of BIOME_KEYS) {
      const definition = getBiomeDefinition(theme);
      expect(definition.content.materials.terrain).toBe(theme);
      expect(definition.content.materials.details).toBe(theme);
      expect(definition.content.materials.fields).toBe(theme);
      expect(definition.content.props.natural).toBe(theme);
      expect(definition.content.structures.buildings).toBe(theme);
      expect(definition.content.structures.decorations).toBe(theme);
      expect(definition.content.audio.ambience).toBe(theme);
    }
  });
});
