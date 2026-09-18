import type { SurfacePoint, Terrain } from "../models/types";
import { buildBunkerVisualRings } from "./bunkerShapes";

/**
 * Small isolated ecological material patches are authoritative whole cells,
 * but rendering their exact tile union at normal M19 zoom makes them read as
 * dark diamonds.  This module is deliberately presentation-only: it creates
 * a deterministic inset mask over the same cells and never changes tiles,
 * saves, routing, or material ownership.
 */
const ORGANIC_TERRAINS = new Set<Terrain>(["deep_rough", "waste_area"]);
const MAX_ORGANIC_COMPONENT_CELLS = 4;

function mix32(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function hashString(value: string): number {
  let value32 = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    value32 ^= value.charCodeAt(index);
    value32 = Math.imul(value32, 0x01000193);
  }
  return value32 >>> 0;
}

function unit(value: number): number {
  return mix32(value) / 0xffffffff;
}

function pointIsInsideOwnedCell(point: SurfacePoint, cells: ReadonlySet<number>, width: number): boolean {
  // Mask points are intentionally inset. The epsilon makes a quantized point
  // exactly on an internal shared edge choose the cell on its lower/right side
  // without accidentally accepting a course-exterior point.
  const x = Math.floor(point.x + 1e-7);
  const y = Math.floor(point.y + 1e-7);
  return cells.has(y * width + x);
}

function perCellFallback(
  cells: readonly number[],
  width: number,
  topologyKey: string,
): SurfacePoint[][] {
  const seed = hashString(topologyKey);
  return cells.map((cell, cellIndex) => {
    const x = cell % width;
    const y = Math.floor(cell / width);
    const phase = unit(seed ^ Math.imul(cellIndex + 1, 0x9e3779b1)) * Math.PI * 2;
    const cx = x + 0.5 + (unit(seed ^ cell) - 0.5) * 0.045;
    const cy = y + 0.5 + (unit(seed ^ (cell * 31)) - 0.5) * 0.045;
    const rx = 0.375 + unit(seed ^ (cell * 17)) * 0.025;
    const ry = 0.325 + unit(seed ^ (cell * 47)) * 0.025;
    return Array.from({ length: 20 }, (_, index) => {
      const angle = index / 20 * Math.PI * 2;
      const lobe = 1 + Math.sin(angle * 3 + phase) * 0.045 + Math.sin(angle * 5 - phase) * 0.018;
      return {
        x: cx + Math.cos(angle) * rx * lobe,
        y: cy + Math.sin(angle) * ry * lobe,
      };
    });
  });
}

export function usesOrganicTerrainMask(terrain: Terrain, cellCount: number): boolean {
  return ORGANIC_TERRAINS.has(terrain) && cellCount > 0 && cellCount <= MAX_ORGANIC_COMPONENT_CELLS;
}

/**
 * Builds a masked, softly scalloped material patch. It first uses the proven
 * connected-bunker contour construction, then falls back to independently
 * inset cell petals whenever a pathological narrow topology would put a point
 * outside the authoritative union. The fallback is intentionally not joined,
 * preserving four-connected component ownership and never joining diagonal
 * gameplay cells.
 */
export function buildOrganicTerrainMaskRings(
  rings: readonly (readonly SurfacePoint[])[],
  cells: readonly number[],
  width: number,
  topologyKey: string,
): SurfacePoint[][] {
  if (cells.length === 0 || width <= 0) return [];
  const owned = new Set(cells);
  const candidate = buildBunkerVisualRings(
    rings,
    `organic:${topologyKey}`,
    cells.length,
    cells.length === 1 ? "pot" : "greenside",
  );
  if (
    candidate.length > 0 &&
    candidate.every((ring) => ring.length >= 3 && ring.every((point) => pointIsInsideOwnedCell(point, owned, width)))
  ) return candidate;
  return perCellFallback(cells, width, topologyKey);
}
