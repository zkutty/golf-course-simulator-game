/**
 * World-anchored material fields and pair-aware contour transitions — ZK-469.
 *
 * ZK-468 derives *where* a surface is; this module decides what it looks like
 * inside and how it meets its neighbours. Both halves are render-only:
 * `Course.tiles` still owns coverage, and nothing here is persisted.
 *
 * Two ideas carry the whole file.
 *
 * **Fields, not tiles.** Every interior cue — macro colour drift, grain,
 * wear, mowing, water phase — is sampled from continuous world coordinates.
 * Because the sample is a pure function of an unrotated world position, the
 * texture phase cannot reset at a cell or chunk boundary, cannot shift when
 * the camera rotates or pans, and reproduces exactly after a reload or a
 * dirty-chunk rebuild. That is what removes the diamond quilt.
 *
 * **One owner per seam.** A terrain adjacency resolves through
 * `TERRAIN_BOUNDARY_PRIORITY` to exactly one owner, and that owner supplies the
 * whole ordered band stack across the seam. The other side draws nothing there,
 * so a boundary can never double up or crack. The table is exhaustive over
 * every unordered pair of terrains.
 */

import type { LandTheme, Terrain } from "../models/types";
import type { ColorVisionMode } from "../onboarding/profile";
import { TERRAIN_PALETTES } from "../../accessibility/terrainPalettes";
import {
  TERRAIN_BOUNDARY_PRIORITY,
  TERRAIN_KINDS,
  mowingShadeAt,
  terrainBoundaryFor,
  type MowingAxis,
  type TerrainBoundaryRole,
} from "./terrainMaterials";
import { PRESENTATION_SCALE } from "./terrainSilhouettes";

export type DetailProfile = "high" | "medium" | "low";

export const DETAIL_PROFILES: readonly DetailProfile[] = ["high", "medium", "low"];

const PROFILE_RANK: Record<DetailProfile, number> = { low: 0, medium: 1, high: 2 };

/**
 * Source-art contract for the material fields.
 *
 * A patch spans `tileSpan` tiles in each world axis, so its phase repeats on a
 * 4-tile lattice that is independent of the cell grid. `target` is the 4×
 * presentation tier ZK-472 authors; `shipped` describes the 2× art currently in
 * the repository. The renderer resolves the best available tier rather than
 * assuming either, and both downsample by an integer factor — the pixel-art-safe
 * case, where no source texel is resampled across a fractional boundary.
 */
export const MATERIAL_SOURCE_TIERS = {
  target: { patchWidth: 256, patchHeight: 128, presentationScale: 4 },
  shipped: { patchWidth: 128, patchHeight: 64, presentationScale: 2 },
} as const;

export type MaterialSourceTier = keyof typeof MATERIAL_SOURCE_TIERS;

export const MATERIAL_PATCH_TILE_SPAN = 4;

/** Per-quality atlas ceilings; `low` is the M35 gate the shipped atlas must clear. */
export const ATLAS_BUDGET_BYTES: Record<DetailProfile, number> = {
  high: 1_600_000,
  medium: 1_100_000,
  low: 800_000,
};

/** Renderer work budget carried forward from M35. */
export const RENDERER_WORK_BUDGET_MS = 8;

/**
 * True when a source patch can be downsampled to the presentation grid without
 * resampling a texel across a fractional boundary.
 */
export function isPixelArtSafe(tier: MaterialSourceTier): boolean {
  const source = MATERIAL_SOURCE_TIERS[tier];
  // Each presentation sub-cell must cover a whole number of source texels.
  const cells = MATERIAL_PATCH_TILE_SPAN * source.presentationScale;
  return source.patchWidth % cells === 0 && source.patchHeight % cells === 0;
}

/** Picks the richest tier whose patches are actually present. */
export function resolveMaterialSourceTier(availablePatchWidth: number): MaterialSourceTier {
  return availablePatchWidth >= MATERIAL_SOURCE_TIERS.target.patchWidth ? "target" : "shipped";
}

// ---------------------------------------------------------------------------
// World-space sampling
// ---------------------------------------------------------------------------

function hashLattice(ix: number, iy: number, salt: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(salt, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/**
 * Smooth value noise over a continuous world position. The lattice period is
 * deliberately not a whole number of tiles, so no feature of the noise can line
 * up with the cell grid and reintroduce quilting.
 */
export function worldNoise(x: number, y: number, period: number, salt: number): number {
  const sx = x / period;
  const sy = y / period;
  const ix = Math.floor(sx);
  const iy = Math.floor(sy);
  const fx = smoothstep(sx - ix);
  const fy = smoothstep(sy - iy);
  const n00 = hashLattice(ix, iy, salt);
  const n10 = hashLattice(ix + 1, iy, salt);
  const n01 = hashLattice(ix, iy + 1, salt);
  const n11 = hashLattice(ix + 1, iy + 1, salt);
  const top = n00 + (n10 - n00) * fx;
  const bottom = n01 + (n11 - n01) * fx;
  return top + (bottom - top) * fy;
}

export const MAINTAINED_TERRAINS: readonly Terrain[] = ["fairway", "green", "tee"];

export function isMaintained(terrain: Terrain): boolean {
  return MAINTAINED_TERRAINS.includes(terrain);
}

export interface MaterialFieldOptions {
  axes?: readonly MowingAxis[];
  profile?: DetailProfile;
}

export interface MaterialSample {
  /** Broad colour drift across several tiles. */
  macro: number;
  /** Fine blade/sand-ripple grain. */
  grain: number;
  /** Traffic and weathering darkening. */
  wear: number;
  /** Mowing band shade; exactly 1 on unmaintained terrain. */
  mowing: number;
  /** Product of the above, ready to multiply into a tint. */
  shade: number;
  /** Stable phase into the source patch, both in [0, 1). */
  u: number;
  v: number;
}

/** Per-terrain field strengths. Sand ripples and tall grass carry more grain. */
const FIELD_STRENGTH: Record<Terrain, { macro: number; grain: number; wear: number }> = {
  fairway: { macro: 0.05, grain: 0.022, wear: 0.03 },
  green: { macro: 0.032, grain: 0.014, wear: 0.02 },
  tee: { macro: 0.04, grain: 0.02, wear: 0.055 },
  rough: { macro: 0.07, grain: 0.038, wear: 0.02 },
  deep_rough: { macro: 0.085, grain: 0.058, wear: 0.015 },
  waste_area: { macro: 0.08, grain: 0.05, wear: 0.04 },
  sand: { macro: 0.045, grain: 0.042, wear: 0.025 },
  water: { macro: 0.06, grain: 0.026, wear: 0 },
  wetland: { macro: 0.075, grain: 0.04, wear: 0.01 },
  path: { macro: 0.035, grain: 0.03, wear: 0.06 },
};

const MACRO_PERIOD = 5.31;
const GRAIN_PERIOD = 1.37;
const WEAR_PERIOD = 2.83;

/**
 * Samples the material field at a world position. `x`/`y` are continuous,
 * unrotated world coordinates — pass a tile centre for per-cell work or an
 * arbitrary point for sub-tile detail; the field is the same either way.
 */
export function sampleMaterialField(
  terrain: Terrain,
  x: number,
  y: number,
  options: MaterialFieldOptions = {},
): MaterialSample {
  const strength = FIELD_STRENGTH[terrain];
  const profile = options.profile ?? "high";
  // Lower tiers thin out the highest-frequency cue only; the broad field that
  // makes a surface read as continuous is never dropped.
  const grainScale = profile === "high" ? 1 : profile === "medium" ? 0.6 : 0;

  const macro = 1 + (worldNoise(x, y, MACRO_PERIOD, 0x51) - 0.5) * 2 * strength.macro;
  const grain = 1 + (worldNoise(x, y, GRAIN_PERIOD, 0xa7) - 0.5) * 2 * strength.grain * grainScale;
  const wear = 1 - worldNoise(x, y, WEAR_PERIOD, 0x3d) * strength.wear;
  const mowing = isMaintained(terrain) && options.axes
    ? mowingShadeAt(x - 0.5, y - 0.5, options.axes)
    : 1;

  const span = MATERIAL_PATCH_TILE_SPAN;
  const u = ((x / span) % 1 + 1) % 1;
  const v = ((y / span) % 1 + 1) % 1;
  return { macro, grain, wear, mowing, shade: macro * grain * wear * mowing, u, v };
}

/**
 * Water ripple phase as a continuous field. Neighbouring samples move together
 * so a lake reads as one animated surface rather than per-tile pulsing.
 */
export function waterFieldPhase(x: number, y: number, timeSeconds: number): number {
  const tau = Math.PI * 2;
  const drift = worldNoise(x, y, 3.9, 0x6b) * tau;
  return ((x * 0.37 + y * 0.23 + drift + timeSeconds * 0.9) % tau + tau) % tau;
}

// ---------------------------------------------------------------------------
// Interior and silhouette cues that separate the wild surfaces
// ---------------------------------------------------------------------------

export interface WildnessProfile {
  /** Silhouette displacement amplitude in tiles — how ragged the edge reads. */
  amplitude: number;
  /** Silhouette displacement frequency in cycles per tile. */
  frequency: number;
  /** Interior motif density, motifs per square tile. */
  density: number;
  motif: ContourDetailMotif;
}

/**
 * Rough, deep rough and waste must be separable without relying on hue alone —
 * each carries a distinct edge amplitude, frequency and interior motif.
 */
const WILDNESS: Record<Terrain, WildnessProfile> = {
  fairway: { amplitude: 0.02, frequency: 0.8, density: 0, motif: "none" },
  green: { amplitude: 0.012, frequency: 0.8, density: 0, motif: "none" },
  tee: { amplitude: 0.012, frequency: 0.8, density: 0, motif: "none" },
  path: { amplitude: 0.016, frequency: 1.1, density: 0.05, motif: "pebbles" },
  sand: { amplitude: 0.05, frequency: 1.4, density: 0.08, motif: "pebbles" },
  water: { amplitude: 0.06, frequency: 1.2, density: 0, motif: "none" },
  wetland: { amplitude: 0.09, frequency: 1.7, density: 0.5, motif: "reeds" },
  rough: { amplitude: 0.05, frequency: 1.5, density: 0.35, motif: "blades" },
  deep_rough: { amplitude: 0.13, frequency: 2.4, density: 0.9, motif: "tufts" },
  waste_area: { amplitude: 0.09, frequency: 3.1, density: 0.6, motif: "stones" },
};

export function wildnessProfile(terrain: Terrain): WildnessProfile {
  return WILDNESS[terrain];
}

/**
 * Silhouette displacement along a contour, as a function of arc length. Applied
 * by the renderer as a normal offset; it never moves a cell in or out of a
 * component because the amplitude stays well inside the rounding budget.
 */
export function silhouetteOffsetAt(
  terrain: Terrain,
  arcLength: number,
  worldX: number,
  worldY: number,
): number {
  const { amplitude, frequency } = WILDNESS[terrain];
  const wobble = worldNoise(worldX, worldY, 1 / Math.max(frequency, 0.1), 0xc4) - 0.5;
  const ripple = Math.sin(arcLength * frequency * Math.PI * 2) * 0.5;
  return (wobble + ripple) * amplitude;
}

// ---------------------------------------------------------------------------
// Pair-aware contour bands
// ---------------------------------------------------------------------------

export type ContourBandRole =
  | "collar"
  | "fringe"
  | "turf-shelf"
  | "soil-bank"
  | "reed-fringe"
  | "water-shallow"
  | "water-deep"
  | "grass-overhang"
  | "soil-face"
  | "sand-lip"
  | "sand-floor"
  | "natural-shoulder"
  | "gravel-edge"
  | "path-core"
  | "wild-apron"
  | "wild-fringe"
  | "tuft-fringe";

export type ContourDetailMotif = "none" | "reeds" | "pebbles" | "tufts" | "stones" | "blades";

export interface ContourBand {
  role: ContourBandRole;
  /** Signed distance from the shared contour, in tiles. Negative = outside the owner. */
  offset: number;
  width: number;
  /** Relative depth step; 0 is the surrounding ground plane. */
  depth: number;
  color: number;
  alpha: number;
  detail: ContourDetailMotif;
  /** Lowest quality tier that still draws this band. */
  minProfile: DetailProfile;
}

export interface ContourProfile {
  owner: Terrain;
  other: Terrain;
  role: TerrainBoundaryRole;
  /** Ordered outermost → innermost relative to the owner. */
  bands: ContourBand[];
  /** Count of visually distinct depth levels across the seam. */
  depthBands: number;
}

/** Neutral shading colours that carry depth rather than terrain identity. */
const NEUTRALS: Record<LandTheme, { soil: number; stone: number; gravel: number; reed: number }> = {
  parkland: { soil: 0x6b4f31, stone: 0x6f6a60, gravel: 0xa39c8c, reed: 0x6e7433 },
  links: { soil: 0x7a6244, stone: 0x807a6d, gravel: 0xb0a893, reed: 0x7d8447 },
  desert: { soil: 0x8a6136, stone: 0x8b8171, gravel: 0xbfae8d, reed: 0x87813f },
};

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function scaleColor(color: number, factor: number): number {
  const r = clampChannel(((color >> 16) & 0xff) * factor);
  const g = clampChannel(((color >> 8) & 0xff) * factor);
  const b = clampChannel((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

interface BandRecipe {
  role: ContourBandRole;
  offset: number;
  width: number;
  depth: number;
  /** Where the band's colour comes from before the factor is applied. */
  tone: "owner" | "other" | "soil" | "stone" | "gravel" | "reed";
  factor: number;
  alpha: number;
  detail: ContourDetailMotif;
  minProfile: DetailProfile;
}

/**
 * Band stacks keyed by the seam role that `terrainBoundaryFor` resolves. Every
 * supported adjacency lands in exactly one of these, which is what makes the
 * table exhaustive without enumerating 45 pairs by hand.
 */
const BAND_RECIPES: Record<TerrainBoundaryRole, BandRecipe[]> = {
  // Water and wetland: turf shelf → dark soil/stone bank → reeds → lowered water.
  shore: [
    { role: "turf-shelf", offset: -0.34, width: 0.34, depth: 0, tone: "other", factor: 0.9, alpha: 1, detail: "none", minProfile: "low" },
    { role: "soil-bank", offset: 0, width: 0.24, depth: 1, tone: "soil", factor: 0.82, alpha: 1, detail: "stones", minProfile: "medium" },
    { role: "reed-fringe", offset: 0.14, width: 0.26, depth: 1, tone: "reed", factor: 1, alpha: 0.9, detail: "reeds", minProfile: "high" },
    { role: "water-shallow", offset: 0.22, width: 0.44, depth: 2, tone: "owner", factor: 1.22, alpha: 1, detail: "none", minProfile: "low" },
    { role: "water-deep", offset: 0.6, width: 0.6, depth: 3, tone: "owner", factor: 0.78, alpha: 1, detail: "none", minProfile: "low" },
  ],
  // Bunkers: grass overhang → exposed soil face → recessed sand.
  "bunker-lip": [
    { role: "grass-overhang", offset: -0.3, width: 0.3, depth: 0, tone: "other", factor: 0.86, alpha: 1, detail: "blades", minProfile: "medium" },
    { role: "soil-face", offset: 0, width: 0.2, depth: 1, tone: "soil", factor: 0.9, alpha: 1, detail: "none", minProfile: "low" },
    { role: "sand-lip", offset: 0.16, width: 0.3, depth: 2, tone: "owner", factor: 1.16, alpha: 1, detail: "pebbles", minProfile: "medium" },
    { role: "sand-floor", offset: 0.42, width: 0.5, depth: 3, tone: "owner", factor: 0.94, alpha: 1, detail: "none", minProfile: "low" },
  ],
  // Paths: natural shoulder → gravel edge → compact core.
  "path-shoulder": [
    { role: "natural-shoulder", offset: -0.24, width: 0.24, depth: 0, tone: "other", factor: 0.92, alpha: 1, detail: "tufts", minProfile: "high" },
    { role: "gravel-edge", offset: 0, width: 0.18, depth: 0, tone: "gravel", factor: 1, alpha: 1, detail: "pebbles", minProfile: "medium" },
    { role: "path-core", offset: 0.14, width: 0.4, depth: 0, tone: "owner", factor: 1.06, alpha: 1, detail: "none", minProfile: "low" },
  ],
  // Maintained turf: the neighbour's own apron → dark fringe → mown collar.
  // The apron is what keeps rough, deep rough and waste distinguishable across
  // a mown edge; without it the owner would draw the same strip against all
  // three, which is the thin single-strip failure this issue is about.
  fringe: [
    { role: "wild-apron", offset: -0.3, width: 0.26, depth: 0, tone: "other", factor: 0.9, alpha: 1, detail: "none", minProfile: "low" },
    { role: "fringe", offset: -0.16, width: 0.22, depth: 0, tone: "owner", factor: 0.72, alpha: 1, detail: "none", minProfile: "low" },
    { role: "collar", offset: 0.04, width: 0.2, depth: 0, tone: "owner", factor: 0.88, alpha: 1, detail: "none", minProfile: "medium" },
  ],
  // Wild surfaces: progressively taller, noisier silhouettes.
  "natural-feather": [
    { role: "wild-apron", offset: -0.28, width: 0.24, depth: 0, tone: "other", factor: 0.92, alpha: 1, detail: "none", minProfile: "low" },
    { role: "wild-fringe", offset: -0.12, width: 0.28, depth: 0, tone: "owner", factor: 0.84, alpha: 0.95, detail: "none", minProfile: "low" },
    { role: "tuft-fringe", offset: 0.1, width: 0.3, depth: 0, tone: "owner", factor: 1.08, alpha: 0.85, detail: "tufts", minProfile: "high" },
  ],
};

export interface ContourOptions {
  theme?: LandTheme;
  colorVision?: ColorVisionMode;
  profile?: DetailProfile;
}

/**
 * The single ordered band stack for a terrain adjacency, or null when the two
 * terrains are the same — a component never bands against itself, which is what
 * stops an internal seam appearing where a painted curve joins an existing
 * hazard of the same material.
 */
export function contourProfileFor(
  a: Terrain,
  b: Terrain,
  options: ContourOptions = {},
): ContourProfile | null {
  const boundary = terrainBoundaryFor(a, b);
  if (!boundary) return null;
  const theme = options.theme ?? "parkland";
  const colorVision = options.colorVision ?? "standard";
  const profile = options.profile ?? "high";
  const other = boundary.owner === a ? b : a;
  const palette = TERRAIN_PALETTES[colorVision];
  const neutrals = NEUTRALS[theme];
  // Colour-vision modes lean on luminance, so neutral depth cues are pushed
  // further apart. Geometry is untouched.
  const neutralBias = colorVision === "standard" ? 1 : 0.86;

  const bands = BAND_RECIPES[boundary.role]
    .filter((recipe) => PROFILE_RANK[profile] >= PROFILE_RANK[recipe.minProfile])
    .map((recipe) => {
      const base =
        recipe.tone === "owner" ? palette[boundary.owner]
        : recipe.tone === "other" ? palette[other]
        : recipe.tone === "soil" ? scaleColor(neutrals.soil, neutralBias)
        : recipe.tone === "stone" ? scaleColor(neutrals.stone, neutralBias)
        : recipe.tone === "gravel" ? scaleColor(neutrals.gravel, neutralBias)
        : neutrals.reed;
      return {
        role: recipe.role,
        offset: recipe.offset,
        width: recipe.width,
        depth: recipe.depth,
        color: scaleColor(base, recipe.factor),
        alpha: recipe.alpha,
        detail: recipe.detail,
        minProfile: recipe.minProfile,
      } satisfies ContourBand;
    });

  return {
    owner: boundary.owner,
    other,
    role: boundary.role,
    bands,
    depthBands: new Set(bands.map((band) => band.depth)).size,
  };
}

/** Every unordered terrain adjacency the renderer must handle. */
export function allTerrainAdjacencies(): Array<[Terrain, Terrain]> {
  const pairs: Array<[Terrain, Terrain]> = [];
  for (let i = 0; i < TERRAIN_KINDS.length; i++) {
    for (let j = i + 1; j < TERRAIN_KINDS.length; j++) {
      pairs.push([TERRAIN_KINDS[i], TERRAIN_KINDS[j]]);
    }
  }
  return pairs;
}

/**
 * True when `terrain` supplies the bands for this seam. Callers draw a boundary
 * only from its owner, which is what guarantees no doubled edges.
 */
export function ownsBoundary(terrain: Terrain, other: Terrain): boolean {
  const boundary = terrainBoundaryFor(terrain, other);
  return boundary?.owner === terrain;
}

// ---------------------------------------------------------------------------
// Arc-length detail placement
// ---------------------------------------------------------------------------

export interface ContourDetail {
  x: number;
  y: number;
  /**
   * Unit normal along the band offset axis, so `x + nx * band.offset` lands in
   * the same place the band does. Points into the owner, matching the sign
   * convention on {@link ContourBand.offset}.
   */
  nx: number;
  ny: number;
  /** Distance along the contour from its start, in tiles. */
  arcLength: number;
  variant: number;
  scale: number;
  lean: number;
}

const MOTIF_SPACING: Record<ContourDetailMotif, number> = {
  none: 0,
  reeds: 0.55,
  pebbles: 0.7,
  tufts: 0.65,
  stones: 0.9,
  blades: 0.5,
};

export interface ContourDetailOptions {
  motif: ContourDetailMotif;
  profile?: DetailProfile;
  /** Multiplier on the motif's nominal spacing. */
  spacingScale?: number;
}

/**
 * Scatters motifs along a contour by arc length, so density follows the length
 * of the shoreline rather than the number of tiles it crosses. Placement jitter
 * is hashed from the world position, which keeps a stretch of bank identical
 * when an unrelated part of the same ring is repainted.
 */
export function detailsAlongContour(
  points: readonly { x: number; y: number }[],
  options: ContourDetailOptions,
): ContourDetail[] {
  const profile = options.profile ?? "high";
  const nominal = MOTIF_SPACING[options.motif];
  if (nominal <= 0 || points.length < 2) return [];
  // Lower tiers thin the scatter out; they never move or reshape it.
  const thinning = profile === "high" ? 1 : profile === "medium" ? 1.6 : 3;
  const spacing = nominal * thinning * (options.spacingScale ?? 1);

  const details: ContourDetail[] = [];
  let travelled = 0;
  let nextAt = spacing / 2;
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index];
    const end = points[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length <= 1e-9) continue;
    const ux = dx / length;
    const uy = dy / length;
    while (nextAt <= travelled + length) {
      const t = (nextAt - travelled) / length;
      const x = start.x + dx * t;
      const y = start.y + dy * t;
      const jitter = worldNoise(x, y, 0.9, 0x11);
      const size = worldNoise(x, y, 1.6, 0x22);
      const lean = worldNoise(x, y, 2.4, 0x33);
      details.push({
        x,
        y,
        // Inward normal for a clockwise ring in y-down world space.
        nx: -uy,
        ny: ux,
        arcLength: nextAt,
        variant: Math.floor(jitter * 4) % 4,
        scale: 0.75 + size * 0.5,
        lean: (lean - 0.5) * 0.6,
      });
      nextAt += spacing;
    }
    travelled += length;
  }
  return details;
}

/** Total length of a contour run, in tiles. */
export function contourLength(points: readonly { x: number; y: number }[]): number {
  let total = 0;
  for (let index = 0; index < points.length - 1; index++) {
    total += Math.hypot(points[index + 1].x - points[index].x, points[index + 1].y - points[index].y);
  }
  return total;
}

/** Terrain priority order re-exported so renderers resolve owners from one place. */
export { TERRAIN_BOUNDARY_PRIORITY, PRESENTATION_SCALE };
