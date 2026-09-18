import type { Course, Obstacle, Terrain } from "../models/types";
import { createParklandVisualReferenceCourse } from "./referenceCourse";

export const ZK1202_HABITAT_SEED = 1_202_035;

type HabitatPoint = readonly [number, number];

const AUTHORED_GROVES: readonly (readonly HabitatPoint[])[] = [
  [[13, 4], [16, 4], [12, 7], [15, 7], [18, 6]],
  [[25, 3], [28, 4], [31, 3], [26, 7], [30, 7]],
  [[38, 3], [42, 4], [37, 7], [40, 7], [44, 6]],
  [[5, 27], [8, 26], [11, 28], [6, 31], [10, 32]],
  [[34, 29], [37, 29], [40, 29], [35, 32], [39, 32], [43, 31]],
] as const;

function isHabitatTerrain(terrain: Terrain): boolean {
  return terrain === "rough" || terrain === "deep_rough";
}

/** Isolated visual fixture with authored, gameplay-real tree groves. */
export function createZk1202HabitatReferenceCourse(): Course {
  const base = createParklandVisualReferenceCourse();
  const authored: Obstacle[] = AUTHORED_GROVES.flatMap((grove) => grove.map(([x, y]) => ({
    x,
    y,
    type: "tree" as const,
  }))).filter((obstacle) => isHabitatTerrain(base.tiles[obstacle.y * base.width + obstacle.x]));
  const occupied = new Set(authored.map((obstacle) => `${obstacle.x},${obstacle.y}`));
  const retained = base.obstacles.filter((obstacle) => !occupied.has(`${obstacle.x},${obstacle.y}`));
  return {
    ...base,
    name: "ZK-1202 Parkland Habitat Club",
    obstacles: [...retained, ...authored],
  };
}
