import { Assets, Spritesheet, Texture } from "pixi.js";

/**
 * Typed texture-atlas loader (ZKU-147).
 *
 * Atlases are packed by `npm run build:atlas` from `src/assets/sprites/`
 * into `public/atlases/` (see ART_GUIDE.md for the authoring spec and
 * workflow). Frame names are a TS union so a typo is a compile error.
 *
 * Loading is tolerant by design: if an atlas or frame is missing the
 * renderer falls back to its legacy procedural path and warns once — art
 * can land incrementally without code changes.
 */

export type PropFrame = "tree" | "tree2" | "bush" | "rock";
export type TerrainFrame =
  | "diamond0"
  | "diamond1"
  | "diamond2"
  | "edge_ur"
  | "edge_lr"
  | "edge_ll"
  | "edge_ul";
export type BuildingFrame = "clubhouse" | "pro_shop" | "snack_bar" | "cart_rental";
export type AtlasFrame = PropFrame | TerrainFrame | BuildingFrame;

/**
 * Golfer character frames (ZKU-153) live in their own atlas. Names follow
 * `golfer{variant}_{anim}[_t]_{row}_{col}` where `_t` marks the grayscale
 * clothing layer that gets the palette-swap tint at runtime. Row/column
 * semantics live in src/game/render/golferSprites.ts.
 */
export type GolferAnimName = "walk" | "idle" | "swing" | "putt" | "cheer" | "mad";
export type GolferFrame = `golfer${number}_${GolferAnimName}${"" | "_t"}_${number}_${number}`;

let propsSheet: Spritesheet | null = null;
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
  [propsSheet, golfersSheet] = await Promise.all([load("props"), load("golfers")]);
}

/**
 * A frame texture, or null when unavailable (caller uses its fallback).
 * Warns once per missing frame in dev.
 */
export function getPropFrame(name: AtlasFrame): Texture | null {
  const tex = propsSheet?.textures[name] ?? null;
  if (!tex && import.meta.env.DEV && !warned.has(name)) {
    warned.add(name);
    console.warn(`[atlas] missing frame "${name}" — falling back to procedural sprite`);
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
  propsSheet = null;
  golfersSheet = null;
  loadAttempted = false;
  warned.clear();
}
