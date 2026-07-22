import type { LandTheme, Terrain } from "./types";

// Land themes (ZKU-166). Pure data: wild-land generation parameters, flat
// tile-tint palette adjustments (interim until the M10 atlas/tint layer
// grows per-theme variants), and display copy. The renderer READS this —
// theme knowledge never lives renderer-side.

export interface ThemeGenConfig {
  deepRough: { clustersMin: number; clustersMax: number; sizeMin: number; sizeMax: number };
  water: {
    bodiesMin: number;
    bodiesMax: number;
    fracMin: number;
    fracMax: number;
    /** Links: convert a noisy band along one map edge to coastal water. */
    coastalEdge: boolean;
  };
  sand: { pocketsMin: number; pocketsMax: number; sizeMin: number; sizeMax: number };
  environmental: { wetlandEdgeChance: number; wasteAreaEdgeChance: number };
  obstacles: {
    density: number;
    treeRatio: number;
    bushRatio: number;
    rockRatio: number;
    clustersMin: number;
    clustersMax: number;
    lineBias: number;
    shoreBushChance: number;
    shoreTreeChance: number;
  };
  /** elevation = clamp(0, maxStep, round(noise * amplitude + offset)) */
  elevation: { amplitude: number; offset: number; maxStep: number };
}

export interface LandThemeDefinition {
  key: LandTheme;
  label: string;
  blurb: string;
  generation: ThemeGenConfig;
  /** Flat-color overrides of the renderer COLORS table (Pixi hex numbers). */
  tileTints: Partial<Record<Terrain, number>>;
  /** Theme-authored exposed soil/rock faces for the two visible iso sides. */
  cliffFaces: { sw: number; se: number };
}

export const LAND_THEMES: Record<LandTheme, LandThemeDefinition> = {
  // Parkland is the IDENTITY theme: these values are exactly the constants
  // generateWildLand shipped with, so parkland land is bit-identical to
  // pre-theme generation for the same seed (regression tested).
  parkland: {
    key: "parkland",
    label: "Parkland",
    blurb: "Classic tree-lined golf: gentle hills, ponds, and generous turf.",
    generation: {
      deepRough: { clustersMin: 4, clustersMax: 10, sizeMin: 8, sizeMax: 20 },
      water: { bodiesMin: 1, bodiesMax: 2, fracMin: 0.03, fracMax: 0.08, coastalEdge: false },
      sand: { pocketsMin: 3, pocketsMax: 8, sizeMin: 2, sizeMax: 6 },
      environmental: { wetlandEdgeChance: 0.2, wasteAreaEdgeChance: 0.12 },
      obstacles: { density: 0.03, treeRatio: 0.55, bushRatio: 0.35, rockRatio: 0.1, clustersMin: 10, clustersMax: 18, lineBias: 0.28, shoreBushChance: 0.34, shoreTreeChance: 0.08 },
      elevation: { amplitude: 4.6, offset: -0.3, maxStep: 4 },
    },
    tileTints: {},
    cliffFaces: { sw: 0x6b4f33, se: 0x8a6844 },
  },
  links: {
    key: "links",
    label: "Links",
    blurb: "Windswept coastal dunes, deep rough, and barely a tree in sight.",
    generation: {
      deepRough: { clustersMin: 8, clustersMax: 14, sizeMin: 12, sizeMax: 28 },
      // The open sea is the links water identity; do not compete with it via
      // a larger enclosed pond from the generic inland-water pass.
      water: { bodiesMin: 0, bodiesMax: 0, fracMin: 0, fracMax: 0, coastalEdge: true },
      sand: { pocketsMin: 7, pocketsMax: 12, sizeMin: 3, sizeMax: 8 },
      environmental: { wetlandEdgeChance: 0.12, wasteAreaEdgeChance: 0.18 },
      obstacles: { density: 0.022, treeRatio: 0.12, bushRatio: 0.53, rockRatio: 0.35, clustersMin: 4, clustersMax: 8, lineBias: 0.42, shoreBushChance: 0.16, shoreTreeChance: 0.01 },
      elevation: { amplitude: 3.4, offset: -0.4, maxStep: 3 }, // low rolling dunes
    },
    tileTints: {
      fairway: 0x6aa84f,
      rough: 0x5d8a3c,
      deep_rough: 0x6e7a30, // straw fescue
      sand: 0xe3d6a4, // pale dune sand
      waste_area: 0xa58d5e,
      water: 0x2b6f9e, // cold North Sea
      wetland: 0x4e7a69,
      green: 0x66bb6a,
    },
    cliffFaces: { sw: 0x59605a, se: 0x7a786a },
  },
  desert: {
    key: "desert",
    label: "Desert",
    blurb: "Sand washes and rocky mesas — water is scarce and precious.",
    generation: {
      deepRough: { clustersMin: 2, clustersMax: 4, sizeMin: 4, sizeMax: 9 }, // scrub patches
      water: { bodiesMin: 1, bodiesMax: 1, fracMin: 0.004, fracMax: 0.015, coastalEdge: false },
      sand: { pocketsMin: 10, pocketsMax: 16, sizeMin: 6, sizeMax: 16 }, // washes
      environmental: { wetlandEdgeChance: 0.05, wasteAreaEdgeChance: 0.35 },
      obstacles: { density: 0.035, treeRatio: 0.08, bushRatio: 0.32, rockRatio: 0.6, clustersMin: 6, clustersMax: 11, lineBias: 0.12, shoreBushChance: 0.18, shoreTreeChance: 0.22 },
      elevation: { amplitude: 6.0, offset: -0.9, maxStep: 4 }, // mesa contrast
    },
    tileTints: {
      fairway: 0x55a24c, // irrigated turf pops against the desert
      rough: 0x8a8a4c, // dry scrub
      deep_rough: 0x70703a,
      sand: 0xdcb97c, // warm desert sand
      waste_area: 0xb18a55,
      water: 0x3a9ec2, // oasis blue
      wetland: 0x5b8b68,
      path: 0xa89778,
      tee: 0x9a7a58,
    },
    cliffFaces: { sw: 0x7a4934, se: 0xa2603f },
  },
};

export function getLandTheme(theme: LandTheme | undefined): LandThemeDefinition {
  return LAND_THEMES[theme ?? "parkland"];
}
