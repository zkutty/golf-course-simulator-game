import type { Obstacle } from "../models/types";
import type { NaturalPropFrame } from "./naturalProps";

export type TreeHabitatKind = "pine_straw" | "leaf_litter" | "dry_soil";

export interface TreeHabitatLobe {
  offsetX: number;
  offsetY: number;
  radiusX: number;
  radiusY: number;
  tone: 0 | 1 | 2;
}

export interface TreeHabitatDetail {
  x: number;
  y: number;
  size: number;
  angle: number;
  tone: 0 | 1 | 2;
}

export interface TreeHabitatRoot {
  angle: number;
  length: number;
  width: number;
}

export interface TreeHabitatPatch {
  kind: TreeHabitatKind;
  lobes: TreeHabitatLobe[];
  details: TreeHabitatDetail[];
  roots: TreeHabitatRoot[];
  /** Stable density rank used to enforce a global graphics-quality cap. */
  rank: number;
}

function mix32(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function random01(seed: number, index: number): number {
  return mix32(seed ^ Math.imul(index + 1, 0x9e3779b1)) / 0xffffffff;
}

export function treeHabitatKind(
  frame: NaturalPropFrame,
): TreeHabitatKind | null {
  if (!frame.includes("_tree_")) return null;
  if (
    frame.startsWith("desert_")
    || frame.endsWith("_saguaro")
    || frame.endsWith("_palo_verde")
    || frame.endsWith("_mesquite")
    || frame.endsWith("_palm")
  ) return "dry_soil";
  if (
    frame.endsWith("_pine")
    || frame.endsWith("_fir")
    || frame.endsWith("_wind_pine")
  ) return "pine_straw";
  return "leaf_litter";
}

/**
 * Builds a bounded, original procedural ground treatment for a natural prop.
 * It has no gameplay state: the frame, world seed, and obstacle coordinate
 * reproduce the same organic patch after save/load and camera rotation.
 */
export function deriveTreeHabitat(
  frame: NaturalPropFrame,
  obstacle: Obstacle,
  worldSeed: number,
  scale: number,
): TreeHabitatPatch | null {
  if (obstacle.type !== "tree") return null;
  const kind = treeHabitatKind(frame);
  if (!kind) return null;
  const seed = hashString(`${worldSeed}:${frame}:${obstacle.x},${obstacle.y}`);
  const lobeCount = 4 + Math.floor(random01(seed, 0) * 2);
  const detailCount = kind === "dry_soil" ? 7 : 10;
  const rootCount = kind === "pine_straw" ? 3 : 4;
  const kindScale = kind === "dry_soil" ? 0.88 : kind === "pine_straw" ? 0.94 : 0.96;
  const lobes: TreeHabitatLobe[] = [];

  for (let index = 0; index < lobeCount; index++) {
    const central = index === 0;
    const angle = random01(seed, index * 5 + 1) * Math.PI * 2;
    const distance = central ? 0 : 3 + random01(seed, index * 5 + 2) * 8;
    lobes.push({
      offsetX: Math.cos(angle) * distance * scale,
      offsetY: Math.sin(angle) * distance * 0.38 * scale,
      radiusX: (
        (central ? 15 : 8) + random01(seed, index * 5 + 3) * (central ? 4 : 6)
      ) * scale * kindScale,
      radiusY: (
        (central ? 5.4 : 3.1) + random01(seed, index * 5 + 4) * (central ? 2 : 2.3)
      ) * scale * kindScale,
      tone: Math.floor(random01(seed, index * 5 + 5) * 3) as 0 | 1 | 2,
    });
  }

  const details: TreeHabitatDetail[] = Array.from(
    { length: detailCount },
    (_, index) => {
      const angle = random01(seed, 40 + index * 4) * Math.PI * 2;
      const radius = 4 + random01(seed, 41 + index * 4) * 12;
      return {
        x: Math.cos(angle) * radius * scale,
        y: Math.sin(angle) * radius * 0.38 * scale,
        size: (0.65 + random01(seed, 42 + index * 4) * 1.1) * scale,
        angle: random01(seed, 43 + index * 4) * Math.PI * 2,
        tone: Math.floor(random01(seed, 44 + index * 4) * 3) as 0 | 1 | 2,
      };
    },
  );
  const roots: TreeHabitatRoot[] = Array.from(
    { length: rootCount },
    (_, index) => ({
      angle: index / rootCount * Math.PI * 2 + (random01(seed, 90 + index) - 0.5) * 0.55,
      length: (7 + random01(seed, 100 + index) * 6) * scale,
      width: (0.7 + random01(seed, 110 + index) * 0.65) * scale,
    }),
  );

  return {
    kind,
    lobes,
    details,
    roots,
    rank: random01(seed, 130),
  };
}
