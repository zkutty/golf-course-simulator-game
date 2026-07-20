import type { IsoRotation } from "./iso";

/** Clockwise world-grid neighbors. Cardinal bits are even; diagonals are odd. */
export const AUTOTILE_DIRECTIONS = [
  { dx: 0, dy: -1, name: "n" },
  { dx: 1, dy: -1, name: "ne" },
  { dx: 1, dy: 0, name: "e" },
  { dx: 1, dy: 1, name: "se" },
  { dx: 0, dy: 1, name: "s" },
  { dx: -1, dy: 1, name: "sw" },
  { dx: -1, dy: 0, name: "w" },
  { dx: -1, dy: -1, name: "nw" },
] as const;

export type AutotileDirection = (typeof AUTOTILE_DIRECTIONS)[number]["name"];
export type CardinalDirection = "n" | "e" | "s" | "w";
export type CornerDirection = "ne" | "se" | "sw" | "nw";
export type AutotileFeature =
  | { kind: "edge"; direction: CardinalDirection }
  | { kind: "outer"; direction: CornerDirection }
  | { kind: "inner"; direction: CornerDirection };

const INDEX_BY_VECTOR = new Map(
  AUTOTILE_DIRECTIONS.map((direction, index) => [`${direction.dx},${direction.dy}`, index])
);

/** Rotate a neighbor mask into the current camera's screen-oriented grid. */
export function rotateAutotileMask(mask: number, rotation: IsoRotation): number {
  let result = 0;
  for (let index = 0; index < AUTOTILE_DIRECTIONS.length; index++) {
    if ((mask & (1 << index)) === 0) continue;
    let dx: number = AUTOTILE_DIRECTIONS[index].dx;
    let dy: number = AUTOTILE_DIRECTIONS[index].dy;
    for (let turn = 0; turn < rotation / 90; turn++) [dx, dy] = [-dy, dx];
    const rotatedIndex = INDEX_BY_VECTOR.get(`${dx},${dy}`);
    if (rotatedIndex !== undefined) result |= 1 << rotatedIndex;
  }
  return result;
}

const BIT = {
  n: 1 << 0,
  ne: 1 << 1,
  e: 1 << 2,
  se: 1 << 3,
  s: 1 << 4,
  sw: 1 << 5,
  w: 1 << 6,
  nw: 1 << 7,
} as const;

const CORNERS: ReadonlyArray<{
  direction: CornerDirection;
  diagonal: number;
  before: number;
  after: number;
}> = [
  { direction: "ne", diagonal: BIT.ne, before: BIT.n, after: BIT.e },
  { direction: "se", diagonal: BIT.se, before: BIT.e, after: BIT.s },
  { direction: "sw", diagonal: BIT.sw, before: BIT.s, after: BIT.w },
  { direction: "nw", diagonal: BIT.nw, before: BIT.w, after: BIT.n },
];

/**
 * Normalize any of the 256 masks to a small typed frame set. Bits describe
 * where the current material owns a boundary against a lower-priority tile.
 */
export function autotileFeatures(mask: number): AutotileFeature[] {
  const normalized = mask & 0xff;
  const features: AutotileFeature[] = [];
  const cardinals: ReadonlyArray<[CardinalDirection, number]> = [
    ["n", BIT.n], ["e", BIT.e], ["s", BIT.s], ["w", BIT.w],
  ];
  for (const [direction, bit] of cardinals) {
    if (normalized & bit) features.push({ kind: "edge", direction });
  }
  for (const corner of CORNERS) {
    const diagonal = (normalized & corner.diagonal) !== 0;
    const before = (normalized & corner.before) !== 0;
    const after = (normalized & corner.after) !== 0;
    if (diagonal && !before && !after) features.push({ kind: "outer", direction: corner.direction });
    if (!diagonal && before && after) features.push({ kind: "inner", direction: corner.direction });
  }
  return features;
}

export function autotileFrameSuffix(feature: AutotileFeature): string {
  return `${feature.kind}_${feature.direction}`;
}
