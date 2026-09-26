import type { Course, Point } from "../models/types";
import type { CourseSceneCompositionPlanV1 } from "./courseSceneComposition";
import type { NaturalPropFrame } from "./naturalProps";

export interface GroveAccent {
  readonly source: Point;
  readonly tile: Point;
  readonly frame: NaturalPropFrame;
  readonly scale: number;
}

/** Presentation only: real trees retain their one-to-one identity and anchor.
 * The smaller existing shrub vocabulary fills local gaps, never a grove pad.
 */
export function deriveGrovePresentation(course: Course, plan: CourseSceneCompositionPlanV1) {
  const key = (point: Point) => `${point.x},${point.y}`;
  const sourceTrees = new Set(course.obstacles.filter((item) => item.type === "tree").map(key));
  const occupied = new Set(course.obstacles.map(key));
  const trees = new Map<string, number>();
  const accents: GroveAccent[] = [];
  const used = new Set<string>();
  for (const zone of plan.habitatZones) {
    if (zone.evidence.kind !== "tree_grove") continue;
    for (const source of zone.evidence.sourcePoints) {
      if (!sourceTrees.has(key(source)) || trees.has(key(source))) continue;
      // Stable variation belongs to source identity, not camera or LOD.
      const variation = ((source.x * 17 + source.y * 29) % 7) / 6;
      trees.set(key(source), 1.75 + variation * 0.3);
      const candidates = zone.occupancy.filter((tile) => !occupied.has(key(tile))
        && !used.has(key(tile))
        && Math.max(Math.abs(tile.x - source.x), Math.abs(tile.y - source.y)) <= 1)
        .sort((a, b) => (a.x - source.x) ** 2 + (a.y - source.y) ** 2
          - (b.x - source.x) ** 2 - (b.y - source.y) ** 2
          || ((a.x * 31 + a.y * 17 + source.x * 7) % 11) - ((b.x * 31 + b.y * 17 + source.x * 7) % 11)
          || a.y - b.y || a.x - b.x);
      for (const [index, tile] of candidates.slice(0, variation > 0.5 ? 2 : 1).entries()) {
        used.add(key(tile));
        accents.push({ source, tile, frame: index === 0 ? "parkland_bush_wild_shrub" : "parkland_bush_wildflowers",
          scale: index === 0 ? 0.84 + variation * 0.12 : 0.48 + variation * 0.1 });
      }
    }
  }
  return { trees, accents };
}
