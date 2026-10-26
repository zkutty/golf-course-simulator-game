import { walkPathAuthority } from "../live/walkPath";
import { isWalkableTerrain } from "../models/terrainRules";
import type { Course, Terrain } from "../models/types";
import { ELEVATION_STEP_YARDS } from "../rules/obstacleCollision";
import { hazardDepthProfile } from "./hazardDepth";
import type { GolferStanceGroundAuthority, GolferStancePoint } from "./golferStance";
import { ISO_ROTATIONS, worldToIso } from "./iso";
import { sampleLandscapeSurfaceHeight, type LandscapeComponent, type VisualHeightfield } from "./landscapeGeometry";

export interface LiveGolferGroundInput {
  readonly course: Course;
  readonly effectiveTiles: readonly Terrain[];
  readonly field: VisualHeightfield;
  readonly componentsByCell: readonly (LandscapeComponent | null)[];
  readonly quality: "high" | "medium" | "low";
  readonly surfaceRevision: string;
}
export interface GolferGroundSweep {
  readonly surfaceRevision: string; readonly from: GolferStancePoint; readonly to: GolferStancePoint;
  readonly supportedThroughout: true; readonly inBounds: true; readonly continuousHeight: true;
  readonly footprintsTested: number; readonly maxProjectedDerivativePx: number;
}
export interface LiveGolferGroundAuthority extends GolferStanceGroundAuthority {
  readonly heightAt: (centerX: number, centerY: number) => number;
  readonly sweepFootprint: (from: GolferStancePoint, to: GolferStancePoint, footprintBudget: number) => GolferGroundSweep | null;
}
/** Covers the approved full walking shoe sweep, including native outline. */
export const GOLFER_GROUND_FOOT_RADIUS_TILES = .18;
const FOOT_RADIUS = GOLFER_GROUND_FOOT_RADIUS_TILES;
const finitePoint = (p: GolferStancePoint) => p && [p.x, p.y, p.heightYards].every(Number.isFinite);
const maintained = (terrain: Terrain) => terrain === "tee" || terrain === "fairway" || terrain === "green";

/** Conservative local support only; never solves a route or alters a surface.
 * Grid-center conventions and height branches match PixiStage surfaceHeightAt.
 * A bounding rectangle includes the whole swept square foot footprint, so a
 * rejected corner is an honest conservative fallback, never an illegal shortcut. */
export function createLiveGolferGroundAuthority(input: LiveGolferGroundInput): LiveGolferGroundAuthority {
  const { course, effectiveTiles, field, componentsByCell, quality, surfaceRevision } = input;
  const walk = walkPathAuthority(course), stride = field.width + 1;
  const valid = Number.isSafeInteger(course.width) && Number.isSafeInteger(course.height) && course.width > 0 && course.height > 0
    && field.width === course.width && field.height === course.height && field.vertices.length === (course.width + 1) * (course.height + 1)
    && effectiveTiles.length === course.width * course.height && componentsByCell.length === effectiveTiles.length;
  const cellIndex = (x: number, y: number) => Math.max(0, Math.min(course.height - 1, Math.floor(y))) * course.width + Math.max(0, Math.min(course.width - 1, Math.floor(x)));
  const heightAt = (x: number, y: number) => {
    if (!valid || !Number.isFinite(x) || !Number.isFinite(y)) return NaN;
    const index = cellIndex(x, y);
    return quality === "low" && !maintained(effectiveTiles[index]) ? course.elevations[index] ?? 0
      : sampleLandscapeSurfaceHeight(field, componentsByCell[index], x, y, true);
  };
  const corridor = (ax: number, ay: number, bx: number, by: number, budget: number): number[] | null => {
    if (!valid || ![ax, ay, bx, by].every(Number.isFinite) || !Number.isSafeInteger(budget) || budget < 1 || budget > 32) return null;
    const left = Math.floor(Math.min(ax, bx) - FOOT_RADIUS), right = Math.floor(Math.max(ax, bx) + FOOT_RADIUS);
    const top = Math.floor(Math.min(ay, by) - FOOT_RADIUS), bottom = Math.floor(Math.max(ay, by) + FOOT_RADIUS);
    if (left < 0 || top < 0 || right >= course.width || bottom >= course.height || (right - left + 1) * (bottom - top + 1) > budget) return null;
    const cells: number[] = [];
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const i = y * course.width + x;
      if (!walk.isWalkable(x, y) || (!isWalkableTerrain(effectiveTiles[i]) && !walk.bridges.has(i))) return null;
      cells.push(i);
    }
    return cells;
  };
  return Object.freeze({ surfaceRevision, heightAt,
    sampleFootprintAt(x: number, y: number) {
      const inBounds = valid && Number.isFinite(x) && Number.isFinite(y) && x - FOOT_RADIUS >= 0 && y - FOOT_RADIUS >= 0 && x + FOOT_RADIUS < course.width && y + FOOT_RADIUS < course.height;
      const heightYards = heightAt(x, y) * ELEVATION_STEP_YARDS;
      return Object.freeze({ surfaceRevision, heightYards, inBounds, supportedFootprint: Number.isFinite(heightYards) && corridor(x, y, x, y, 4) !== null });
    },
    sweepFootprint(from: GolferStancePoint, to: GolferStancePoint, budget: number): GolferGroundSweep | null {
      if (!finitePoint(from) || !finitePoint(to)) return null;
      const cells = corridor(from.x + .5, from.y + .5, to.x + .5, to.y + .5, budget);
      const fromHeight = heightAt(from.x + .5, from.y + .5) * ELEVATION_STEP_YARDS, toHeight = heightAt(to.x + .5, to.y + .5) * ELEVATION_STEP_YARDS;
      if (!cells || !Number.isFinite(fromHeight) || !Number.isFinite(toHeight) || Math.abs(fromHeight - from.heightYards) > 1e-7 || Math.abs(toHeight - to.heightYards) > 1e-7) return null;
      let branch: string | null = null, gradientX = 0, gradientY = 0;
      for (const i of cells) {
        const component = componentsByCell[i], low = quality === "low" && !maintained(effectiveTiles[i]);
        const profile = component ? hazardDepthProfile(component.terrain, component.cells.length) : null;
        const offset = profile ? component!.terrain === "sand" ? profile.floorDrop : profile.minimumBankDrop : 0;
        if (low && !Number.isFinite(course.elevations[i] ?? 0)) return null;
        const key = low ? `constant:${course.elevations[i] ?? 0}` : `bilinear:${offset}`;
        if (branch !== null && branch !== key) return null; branch = key;
        if (low) continue;
        const x = i % course.width, y = Math.floor(i / course.width), a = field.vertices[y * stride + x], b = field.vertices[y * stride + x + 1];
        const c = field.vertices[(y + 1) * stride + x], d = field.vertices[(y + 1) * stride + x + 1];
        if (![a, b, c, d].every(Number.isFinite)) return null;
        gradientX = Math.max(gradientX, Math.abs(b - a), Math.abs(d - c));
        gradientY = Math.max(gradientY, Math.abs(c - a), Math.abs(d - b));
      }
      const dx = to.x - from.x, dy = to.y - from.y, heightDerivativePx = 8 * (gradientX * Math.abs(dx) + gradientY * Math.abs(dy));
      const bound = Math.max(...ISO_ROTATIONS.map(rotation => { const p = worldToIso(dx, dy, 0, rotation); return Math.hypot(p.x, Math.abs(p.y) + heightDerivativePx); }));
      return Object.freeze({ surfaceRevision, from: Object.freeze({ x: from.x, y: from.y, heightYards: from.heightYards }), to: Object.freeze({ x: to.x, y: to.y, heightYards: to.heightYards }), supportedThroughout: true, inBounds: true, continuousHeight: true, footprintsTested: cells.length, maxProjectedDerivativePx: bound });
    },
  });
}
