import type { Course, Point } from "../models/types";
import type { ColorVisionMode } from "../onboarding/profile";
import {
  GREEN_SURFACE_FIXED_POINT_SCALE,
  GREEN_SURFACE_SAMPLES_PER_AXIS,
  normalizeGreenSurfaceV1,
  type GreenSurfaceV1,
} from "./greenSurface";

const DIVISIONS = GREEN_SURFACE_SAMPLES_PER_AXIS - 1;
export const GREEN_OVERLAY_COMMAND_BUDGET = 8_192;

export interface GreenContourCommand {
  from: Point;
  to: Point;
  major: boolean;
}

export interface GreenSlopeArrowCommand {
  at: Point;
  downhill: Point;
  magnitude: number;
}

export interface GreenFallLineCommand {
  from: Point;
  to: Point;
}

export interface GreenShadeCommand {
  x: number;
  y: number;
  intensity: number;
  uphill: boolean;
}

export interface GreenSurfaceOverlayCommands {
  contours: GreenContourCommand[];
  arrows: GreenSlopeArrowCommand[];
  fallLines: GreenFallLineCommand[];
  shades: GreenShadeCommand[];
  clipped: boolean;
  palette: { contour: number; downhill: number; uphill: number; outline: number };
}

const PALETTES: Record<ColorVisionMode, GreenSurfaceOverlayCommands["palette"]> = {
  standard: { contour: 0xf8f4d8, downhill: 0x245d88, uphill: 0x8a4c2d, outline: 0x17281c },
  deuteranopia: { contour: 0xfff4bd, downhill: 0x255f99, uphill: 0x7c3f96, outline: 0x172033 },
  protanopia: { contour: 0xfff4bd, downhill: 0x1d6996, uphill: 0x6f4c9b, outline: 0x172033 },
  tritanopia: { contour: 0xf7f1d0, downhill: 0x1f6f5f, uphill: 0xa44436, outline: 0x17281c },
};

function absoluteSamples(course: Course, surface: GreenSurfaceV1, x: number, y: number): number[] {
  const base = (course.elevations?.[y * course.width + x] ?? 0) * GREEN_SURFACE_FIXED_POINT_SCALE;
  const record = surface.tiles.find((tile) => tile.x === x && tile.y === y);
  return new Array(16).fill(0).map((_, index) => base + (record?.offsets[index] ?? 0));
}

function interpolateEdge(
  x: number,
  y: number,
  edge: 0 | 1 | 2 | 3,
  values: readonly number[],
  level: number,
): Point | null {
  // Corners: top-left, top-right, bottom-right, bottom-left.
  const cornerSamples = [values[0], values[1], values[2], values[3]];
  const pairs = [[0, 1], [1, 2], [2, 3], [3, 0]] as const;
  const [a, b] = pairs[edge];
  const va = cornerSamples[a];
  const vb = cornerSamples[b];
  if ((va < level && vb < level) || (va > level && vb > level) || va === vb) return null;
  const t = Math.max(0, Math.min(1, (level - va) / (vb - va)));
  if (edge === 0) return { x: x + t, y };
  if (edge === 1) return { x: x + 1, y: y + t };
  if (edge === 2) return { x: x + 1 - t, y: y + 1 };
  return { x, y: y + 1 - t };
}

function pushContours(
  commands: GreenContourCommand[],
  tileX: number,
  tileY: number,
  samples: readonly number[],
): boolean {
  for (let sampleY = 0; sampleY < DIVISIONS; sampleY++) {
    for (let sampleX = 0; sampleX < DIVISIONS; sampleX++) {
      const indices = [
        sampleY * 4 + sampleX,
        sampleY * 4 + sampleX + 1,
        (sampleY + 1) * 4 + sampleX + 1,
        (sampleY + 1) * 4 + sampleX,
      ];
      const values = indices.map((index) => samples[index]);
      const minimum = Math.min(...values);
      const maximum = Math.max(...values);
      const firstLevel = Math.ceil(minimum / 256) * 256;
      for (let level = firstLevel; level <= maximum; level += 256) {
        const x = tileX + sampleX / DIVISIONS;
        const y = tileY + sampleY / DIVISIONS;
        const size = 1 / DIVISIONS;
        const hits = ([0, 1, 2, 3] as const)
          .map((edge) => interpolateEdge(x, y, edge, values, level))
          .filter((point): point is Point => point != null)
          .map((point) => ({ x: x + (point.x - x) * size, y: y + (point.y - y) * size }));
        // Stable pairing for the ambiguous four-edge saddle case.
        for (let index = 0; index + 1 < hits.length; index += 2) {
          commands.push({ from: hits[index], to: hits[index + 1], major: level % 512 === 0 });
          if (commands.length >= GREEN_OVERLAY_COMMAND_BUDGET) return true;
        }
      }
    }
  }
  return false;
}

function gradient(samples: readonly number[]): { x: number; y: number; magnitude: number } {
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;
  for (let index = 0; index < 4; index++) {
    left += samples[index * 4];
    right += samples[index * 4 + 3];
    top += samples[index];
    bottom += samples[12 + index];
  }
  const dx = (right - left) / (4 * GREEN_SURFACE_FIXED_POINT_SCALE);
  const dy = (bottom - top) / (4 * GREEN_SURFACE_FIXED_POINT_SCALE);
  const magnitude = Math.hypot(dx, dy);
  if (magnitude < 1e-6) return { x: 0, y: 0, magnitude: 0 };
  return { x: -dx / magnitude, y: -dy / magnitude, magnitude };
}

export function buildGreenSurfaceOverlayCommands(args: {
  course: Course;
  surface?: GreenSurfaceV1;
  colorVision?: ColorVisionMode;
  quality?: "high" | "medium" | "low";
}): GreenSurfaceOverlayCommands {
  const surface = normalizeGreenSurfaceV1(args.surface ?? args.course.greenSurface, args.course);
  const contours: GreenContourCommand[] = [];
  const arrows: GreenSlopeArrowCommand[] = [];
  const fallLines: GreenFallLineCommand[] = [];
  const shades: GreenShadeCommand[] = [];
  const stride = args.quality === "low" ? 2 : 1;
  let clipped = false;

  for (let tileIndex = 0; tileIndex < surface.tiles.length; tileIndex += stride) {
    const tile = surface.tiles[tileIndex];
    const samples = absoluteSamples(args.course, surface, tile.x, tile.y);
    if (pushContours(contours, tile.x, tile.y, samples)) {
      clipped = true;
      break;
    }
    const slope = gradient(samples);
    if (slope.magnitude < 0.005) continue;
    const length = Math.min(0.34, 0.14 + slope.magnitude * 0.18);
    const center = { x: tile.x + 0.5, y: tile.y + 0.5 };
    arrows.push({ at: center, downhill: { x: slope.x, y: slope.y }, magnitude: slope.magnitude });
    fallLines.push({
      from: { x: center.x - slope.x * length, y: center.y - slope.y * length },
      to: { x: center.x + slope.x * length, y: center.y + slope.y * length },
    });
    shades.push({ x: tile.x, y: tile.y, intensity: Math.min(0.18, slope.magnitude * 0.12), uphill: slope.x + slope.y < 0 });
    if (contours.length + arrows.length + fallLines.length + shades.length >= GREEN_OVERLAY_COMMAND_BUDGET) {
      clipped = true;
      break;
    }
  }

  return {
    contours,
    arrows,
    fallLines,
    shades,
    clipped,
    palette: PALETTES[args.colorVision ?? "standard"],
  };
}
