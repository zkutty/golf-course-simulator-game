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
export type AtlasFrame = PropFrame | TerrainFrame;

let propsSheet: Spritesheet | null = null;
let loadAttempted = false;
const warned = new Set<string>();

/** Preload all atlases. Safe to call more than once; never throws. */
export async function loadAtlases(): Promise<void> {
  if (loadAttempted) return;
  loadAttempted = true;
  try {
    const url = `${import.meta.env.BASE_URL}atlases/props.json`;
    propsSheet = (await Assets.load(url)) as Spritesheet;
  } catch (err) {
    propsSheet = null;
    if (import.meta.env.DEV) {
      console.warn("[atlas] props atlas unavailable, using procedural fallbacks:", err);
    }
  }
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

/** Test hook: reset module state (unit tests only). */
export function __resetAtlasForTests(): void {
  propsSheet = null;
  loadAttempted = false;
  warned.clear();
}
