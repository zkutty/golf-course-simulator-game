import { Assets, Spritesheet, Texture } from "pixi.js";
import type { TerrainAtlasFrame } from "../game/render/terrainMaterials";
import { missingNaturalPropFrames, type NaturalPropFrame } from "../game/render/naturalProps";

/**
 * Typed texture-atlas loader (ZKU-147).
 *
 * Atlases are packed by `npm run build:atlas` from the typed terrain and
 * sprite source folders into `public/atlases/` (see ART_GUIDE.md). Frame
 * names are TS unions/templates so a typo is a compile error.
 *
 * Loading is tolerant by design: if an atlas or frame is missing the
 * renderer falls back to its legacy procedural path and warns once — art
 * can land incrementally without code changes.
 */

export type PropFrame = NaturalPropFrame;
export type LegacyBuildingFrame = "clubhouse" | "pro_shop" | "snack_bar" | "cart_rental";
export type BuildingFrame = LegacyBuildingFrame | `${"parkland" | "links" | "desert"}_${LegacyBuildingFrame}_t${1 | 2 | 3}`;
export type DecorationFrame = `${"parkland" | "links" | "desert"}_${"fence" | "bench" | "tee_sign" | "lamp" | "bin" | "parked_cart" | "flower_bed" | "planter" | "ornamental_feature" | "bridge" | "boardwalk" | "bridge_approach"}`;
export type AtlasFrame = PropFrame | BuildingFrame | DecorationFrame;

/**
 * Golfer character frames (ZKU-153) live in their own atlas. Names follow
 * `golfer{variant}_{anim}[_t]_{row}_{col}` where `_t` marks the grayscale
 * clothing layer that gets the palette-swap tint at runtime. Row/column
 * semantics live in src/game/render/golferSprites.ts.
 */
export type GolferAnimName = "walk" | "idle" | "swing" | "putt" | "cheer" | "mad";
export type GolferFrame = `golfer${number}_${GolferAnimName}${"" | "_t"}_${number}_${number}`;

let terrainSheet: Spritesheet | null = null;
let naturalPropsSheet: Spritesheet | null = null;
let buildingsSheet: Spritesheet | null = null;
let golfersSheet: Spritesheet | null = null;
let loadAttempted = false;
const warned = new Set<string>();

/** Preload all atlases. Safe to call more than once; never throws. */
export async function loadAtlases(): Promise<void> {
  if (loadAttempted) return;
  loadAttempted = true;
  const load = async (name: string): Promise<Spritesheet | null> => {
    try {
      const url = `${import.meta.env.BASE_URL}atlases/${name}.json`;
      return (await Assets.load(url)) as Spritesheet;
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn(`[atlas] ${name} atlas unavailable, using procedural fallbacks:`, err);
      }
      return null;
    }
  };
  [terrainSheet, naturalPropsSheet, buildingsSheet, golfersSheet] = await Promise.all([
    load("terrain"),
    load("natural-props"),
    load("buildings-decor"),
    load("golfers"),
  ]);
  if (naturalPropsSheet && import.meta.env.DEV) {
    const missing = missingNaturalPropFrames((frame) => Boolean(naturalPropsSheet?.textures[frame]));
    if (missing.length > 0) console.warn(`[atlas] natural-props atlas is missing ${missing.length} registry frames`, missing);
  }
}

/**
 * A frame texture, or null when unavailable (caller uses its fallback).
 * Warns once per missing frame in dev.
 */
export function getPropFrame(name: AtlasFrame): Texture | null {
  const tex = naturalPropsSheet?.textures[name] ?? buildingsSheet?.textures[name] ?? null;
  if (!tex && import.meta.env.DEV && !warned.has(name)) {
    warned.add(name);
    console.warn(`[atlas] missing frame "${name}" — falling back to procedural sprite`);
  }
  return tex;
}

/** Authored @2× terrain texture, kept at 64×32 logical world size. */
export function getTerrainFrame(name: TerrainAtlasFrame): Texture | null {
  const tex = terrainSheet?.textures[name] ?? null;
  if (!tex && import.meta.env.DEV && !warned.has(name)) {
    warned.add(name);
    console.warn(`[atlas] missing terrain frame "${name}" — using safe material fallback`);
  }
  return tex;
}

/** True when the golfer character atlas loaded (else render the dot tier). */
export function golfersAtlasReady(): boolean {
  return golfersSheet !== null;
}

/** A golfer frame texture, or null when unavailable. Warns once in dev. */
export function getGolferFrame(name: GolferFrame): Texture | null {
  const tex = golfersSheet?.textures[name] ?? null;
  if (!tex && golfersSheet && import.meta.env.DEV && !warned.has(name)) {
    warned.add(name);
    console.warn(`[atlas] missing golfer frame "${name}"`);
  }
  return tex;
}

/** Test hook: reset module state (unit tests only). */
export function __resetAtlasForTests(): void {
  terrainSheet = null;
  naturalPropsSheet = null;
  buildingsSheet = null;
  golfersSheet = null;
  loadAttempted = false;
  warned.clear();
}
