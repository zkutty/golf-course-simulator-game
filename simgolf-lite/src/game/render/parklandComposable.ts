import * as PIXI from "pixi.js";
import type { Building, LandTheme, Point, Terrain } from "../models/types";
export {
  buildTerrainPresentationDiagnostics,
  buildTerrainPresentationMap,
} from "./terrainPresentationPolicy";
import type { AtlasQuality } from "../../render/atlasManifest";
import { isoDepth, worldToIso, type IsoRotation } from "./iso";
import { buildingTiles } from "../models/buildings";
import {
  buildParklandPairFringePlan,
  parklandPairFringeAssetRole,
  parklandPairFringeRotationMapping,
  type ParklandPairFringeAssetRole,
  type ParklandPairFringeCornerPatch,
  type ParklandPairFringeEdge,
} from "./parklandPairFringes";
import { PARKLAND_PAIR_FRINGE_SOURCE_HASHES } from "./parklandPairFringeHashes";
import {
  pointInLandscapeRing,
  ringSignedArea,
  sampleLandscapeSurfaceHeight,
  type LandscapeComponent,
  type VisualHeightfield,
} from "./landscapeGeometry";

export const PARKLAND_COMPOSABLE_ID = "parkland-composable-material-v1";
export const PARKLAND_COMPOSABLE_PHASE = "parkland-common-phase-v1";
export const PARKLAND_COMPOSABLE_WORLD_PERIOD_TILES = 8;

export const PARKLAND_COMPOSABLE_SEMANTICS = [
  "fairway",
  "rough",
  "deep_rough",
  "green",
  "tee",
] as const satisfies readonly Terrain[];

export type ParklandComposableSemantic = typeof PARKLAND_COMPOSABLE_SEMANTICS[number];
export type ParklandComposableRole = "undercoat" | ParklandComposableSemantic | ParklandPairFringeAssetRole;

export const PARKLAND_COMPOSABLE_PATTERNS: Readonly<Record<ParklandComposableSemantic, string>> = {
  fairway: "tiered-broken-mowing-swaths",
  rough: "toroidal-irregular-blade-tufts",
  deep_rough: "toroidal-clustered-long-tufts",
  green: "toroidal-fine-care-specks",
  tee: "toroidal-short-care-stamps",
};

const MOTIF_ALPHA_CAPS: Readonly<Record<AtlasQuality, Readonly<Record<ParklandComposableSemantic, number>>>> = {
  high: { fairway: 12, rough: 58, deep_rough: 70, green: 72, tee: 76 },
  medium: { fairway: 10, rough: 52, deep_rough: 64, green: 64, tee: 68 },
  low: { fairway: 8, rough: 36, deep_rough: 45, green: 46, tee: 48 },
};

export interface ParklandMotifMetrics {
  readonly semantic: ParklandComposableSemantic;
  readonly pattern: string;
  readonly sourceAlphaFloor: number;
  readonly outputAlphaFloor: 0;
  readonly maximumAlpha: number;
  readonly nonZeroAlphaFraction: number;
  readonly lowFrequencyPlateScore: number;
  readonly tileBoundaryEdgeEnergy: number;
  readonly motifExpansionPixels: 0 | 1;
}

export interface ParklandMotifTransform {
  readonly pixels: Uint8ClampedArray;
  readonly metrics: ParklandMotifMetrics;
}

function motifBoundaryEnergy(alpha: Uint8ClampedArray, width: number, height: number): number {
  let energy = 0;
  let samples = 0;
  for (let step = 1; step < PARKLAND_COMPOSABLE_WORLD_PERIOD_TILES; step++) {
    const x = Math.round(step * width / PARKLAND_COMPOSABLE_WORLD_PERIOD_TILES);
    const y = Math.round(step * height / PARKLAND_COMPOSABLE_WORLD_PERIOD_TILES);
    if (x > 0 && x < width) for (let row = 0; row < height; row++) {
      energy += Math.abs(alpha[row * width + x] - alpha[row * width + x - 1]);
      samples++;
    }
    if (y > 0 && y < height) for (let column = 0; column < width; column++) {
      energy += Math.abs(alpha[y * width + column] - alpha[(y - 1) * width + column]);
      samples++;
    }
  }
  return samples === 0 ? 0 : energy / samples / 255;
}

/** Removes broad role-colored films while retaining source-authored motif ink. */
export function transformParklandCuePixels(
  source: ArrayLike<number>,
  width: number,
  height: number,
  semantic: ParklandComposableSemantic,
  quality: AtlasQuality,
): ParklandMotifTransform {
  if (source.length !== width * height * 4) throw new Error("invalid Parkland cue dimensions");
  let alphaFloor = 255;
  for (let offset = 3; offset < source.length; offset += 4) alphaFloor = Math.min(alphaFloor, source[offset]);
  const output = new Uint8ClampedArray(source.length);
  const alpha = new Uint8ClampedArray(width * height);
  const cap = MOTIF_ALPHA_CAPS[quality][semantic];
  let nonZero = 0;
  let alphaTotal = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const pixel = y * width + x;
    const offset = pixel * 4;
    const sourceAlpha = source[offset + 3];
    let colorOffset = offset;
    let motifAlpha = sourceAlpha;
    if (semantic === "green") for (const [sampleX, sampleY] of [
      [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
    ] as const) {
      const sampleOffset = ((sampleY + height) % height * width + (sampleX + width) % width) * 4;
      if (source[sampleOffset + 3] <= motifAlpha) continue;
      motifAlpha = source[sampleOffset + 3];
      colorOffset = sampleOffset;
    }
    const residual = motifAlpha - alphaFloor;
    const signal = residual <= (quality === "low" ? 3 : 2)
      ? 0
      : Math.min(cap, residual);
    output[offset] = source[colorOffset];
    output[offset + 1] = source[colorOffset + 1];
    output[offset + 2] = source[colorOffset + 2];
    output[offset + 3] = signal;
    alpha[pixel] = signal;
    if (signal > 0) nonZero++;
    alphaTotal += signal;
  }
  return {
    pixels: output,
    metrics: {
      semantic,
      pattern: PARKLAND_COMPOSABLE_PATTERNS[semantic],
      sourceAlphaFloor: alphaFloor,
      outputAlphaFloor: 0,
      maximumAlpha: cap,
      nonZeroAlphaFraction: nonZero / Math.max(1, width * height),
      lowFrequencyPlateScore: alphaTotal / Math.max(1, width * height) / 255,
      tileBoundaryEdgeEnergy: motifBoundaryEnergy(alpha, width, height),
      motifExpansionPixels: semantic === "green" ? 1 : 0,
    },
  };
}

const motifMetricsByTexture = new WeakMap<PIXI.Texture, ParklandMotifMetrics>();

export function createParklandMotifTexture(
  source: PIXI.Texture,
  semantic: ParklandComposableSemantic,
  quality: AtlasQuality,
): PIXI.Texture {
  const resource = source.source.resource as CanvasImageSource | undefined;
  if (typeof document === "undefined" || !resource) return source;
  const width = source.source.pixelWidth;
  const height = source.source.pixelHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return source;
  context.drawImage(resource, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  const transformed = transformParklandCuePixels(image.data, width, height, semantic, quality);
  image.data.set(transformed.pixels);
  context.putImageData(image, 0, 0);
  const texture = PIXI.Texture.from(canvas);
  texture.source.style.addressMode = "repeat";
  texture.source.style.scaleMode = "nearest";
  motifMetricsByTexture.set(texture, transformed.metrics);
  return texture;
}

export function parklandMotifMetrics(texture: PIXI.Texture): ParklandMotifMetrics | null {
  return motifMetricsByTexture.get(texture) ?? null;
}

/** Content addresses frozen by the approved ZK-463 material manifest. */
export const PARKLAND_COMPOSABLE_SOURCE_HASHES: Readonly<Record<AtlasQuality, readonly string[]>> = {
  high: [
    "d1b90d65e64a1090f6f50b06a632886f733ddd2fb6b7b39684fb3d86b7bc0a02",
    "e7a101412e88aed1120ba7b1b18dd1845c62f24010f95d2eaf01375b636195d8",
    "f0110ba54505b7a0d6b3f4a2aa73475d0f17d9a4fe13292e3ab206c5bcf72be2",
    "34c7b0e227ff04873172813592a0aa3ec66684dcc94ff55a49d4c30008b40800",
    "5b4bdf8849fced4282014831a1cba4a3bca882ef14e3c4a1e2886ae43c88a587",
    "c69a7576b23e10358cc3a3084739dcb9945f09768e57cf5869035298bbf585ee",
  ],
  medium: [
    "cdaceb837b36eb5b643342b2c4bdb315bbb269a1869b6d20ad8d77a935c6f0c7",
    "f9987db5806476a3adeb2792991bece0bbb243322a173f68d1dfab68b217ff1f",
    "1010aa1226f3dd9b5a85425cc8a5bbeece99db8deab9928467bcea561ed93eb5",
    "57984617a03d21805d83cce12c04936b57d19457e3e842d4f823696082388bb2",
    "9c4b9a27ab03b1cbaf92f00e341a149e6da97a129c5a4982f64456e03a0051c0",
    "6a5bc92300eed04562ed4613187d6c442b13ab6d26e6c84604541c6926e28bb5",
  ],
  low: [
    "7c98fa66c3a38814a65d4a5d8c3a0daaf0feddc6db339baa74034748dbb4a418",
    "22244bcba9590a62b9982c585a3a0fe5bd010f85db37456f073cdadedbf3f311",
    "83143fba45fe68d09a76cfeeed27b57c23bf65499cb8d1c0e49d797a2ffd28ff",
    "0b9f972a3de0a8e8fcecf328332858099580848f083b3a76ea71076d13b0b013",
    "1da66ca8754614928af44fa2dda01b6199edb5fea513f9bef78ed0f85fd9d8e9",
    "006382bdc922cb5bb94fca5ae01a1236e9a154c8869105fc2fc101e00efcdce2",
  ],
};

export const PARKLAND_COMPOSABLE_LOW_CONTRACT = {
  subdivisions: 1,
  cornerRadius: 0,
  cornerSegments: 1,
  fullCellOutlines: false,
  legacyDiamondTopPlane: false,
  checkerboard: false,
  hazardPathElevationMode: "existing-render-paths",
} as const;

export function isParklandComposableSemantic(terrain: Terrain): terrain is ParklandComposableSemantic {
  return PARKLAND_COMPOSABLE_SEMANTICS.some((semantic) => semantic === terrain);
}

export function isParklandComposableTransition(owner: Terrain, outside: Terrain): boolean {
  return isParklandComposableSemantic(owner) && isParklandComposableSemantic(outside);
}

export function destroyParklandPresentationLayer(layer: PIXI.Container | null): null {
  layer?.removeFromParent();
  layer?.destroy({ children: true });
  return null;
}

export function usesParklandComposableMaterial(
  theme: LandTheme | undefined,
  quality: AtlasQuality,
): boolean {
  return (theme ?? "parkland") === "parkland"
    && (quality === "high" || quality === "medium" || quality === "low");
}

export function suppressesLegacyComposableTurfContour(
  theme: LandTheme | undefined,
  quality: AtlasQuality,
  owner: Terrain,
  outside: Terrain | null,
): boolean {
  return usesParklandComposableMaterial(theme, quality)
    && isParklandComposableSemantic(owner)
    && outside !== null
    && isParklandComposableSemantic(outside);
}

const HAZARD_PATH_TERRAINS: ReadonlySet<Terrain> = new Set([
  "water", "wetland", "sand", "waste_area", "path",
]);

export function parklandComposableContourDisposition(
  theme: LandTheme | undefined,
  quality: AtlasQuality,
  owner: Terrain,
  outside: Terrain | null,
): "suppress-turf" | "preserve-hazard-path" | "preserve-other" {
  if (suppressesLegacyComposableTurfContour(theme, quality, owner, outside)) return "suppress-turf";
  return HAZARD_PATH_TERRAINS.has(owner)
    || (outside !== null && HAZARD_PATH_TERRAINS.has(outside))
    ? "preserve-hazard-path"
    : "preserve-other";
}

export function resolveParklandComposableSources<T extends { readonly destroyed?: boolean }>(
  theme: LandTheme | undefined,
  quality: AtlasQuality,
  lookup: (role: ParklandComposableRole) => T | null,
): {
  readonly undercoat: T;
  readonly cues: Readonly<Record<ParklandComposableSemantic, T>>;
  readonly quality: AtlasQuality;
  readonly pair: (role: ParklandPairFringeAssetRole) => T | null;
} | null {
  if (!usesParklandComposableMaterial(theme, quality)) return null;
  const undercoat = lookup("undercoat");
  const cues = Object.fromEntries(PARKLAND_COMPOSABLE_SEMANTICS.map((semantic) => [
    semantic,
    lookup(semantic),
  ])) as Record<ParklandComposableSemantic, T | null>;
  if (!undercoat || undercoat.destroyed || PARKLAND_COMPOSABLE_SEMANTICS.some((semantic) => (
    !cues[semantic] || cues[semantic]?.destroyed
  ))) return null;
  return { undercoat, cues: cues as Record<ParklandComposableSemantic, T>, quality, pair: lookup };
}

/**
 * The source field is sampled only in canonical, unrotated world space.
 * Rotation changes projection positions, never material phase.
 */
export function parklandComposableUv(x: number, y: number): readonly [number, number] {
  return [
    x / PARKLAND_COMPOSABLE_WORLD_PERIOD_TILES,
    y / PARKLAND_COMPOSABLE_WORLD_PERIOD_TILES,
  ];
}

export interface ParklandComposableMeshGeometry {
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
}

/** Shared exact-cell tessellator; callers supply only the world-height projection. */
export function buildParklandComposableMeshGeometry<T>(
  entries: readonly T[],
  courseWidth: number,
  subdivisions: number,
  cellIndex: (entry: T) => number,
  project: (entry: T, x: number, y: number) => Readonly<{ x: number; y: number }>,
  reuseVertices: boolean,
): ParklandComposableMeshGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const vertexIndexes = reuseVertices ? new Map<number, number>() : null;
  const subWidth = courseWidth * subdivisions + 1;
  const vertexAt = (entry: T, sx: number, sy: number) => {
    const key = sy * subWidth + sx;
    const cached = vertexIndexes?.get(key);
    if (cached != null) return cached;
    const x = sx / subdivisions;
    const y = sy / subdivisions;
    const point = project(entry, x, y);
    const index = positions.length / 2;
    positions.push(point.x, point.y);
    uvs.push(...parklandComposableUv(x, y));
    vertexIndexes?.set(key, index);
    return index;
  };
  for (const entry of entries) {
    const cell = cellIndex(entry);
    const x = cell % courseWidth;
    const y = Math.floor(cell / courseWidth);
    for (let dy = 0; dy < subdivisions; dy++) for (let dx = 0; dx < subdivisions; dx++) {
      const sx = x * subdivisions + dx;
      const sy = y * subdivisions + dy;
      const topLeft = vertexAt(entry, sx, sy);
      const topRight = vertexAt(entry, sx + 1, sy);
      const bottomRight = vertexAt(entry, sx + 1, sy + 1);
      const bottomLeft = vertexAt(entry, sx, sy + 1);
      indices.push(topLeft, topRight, bottomRight, topLeft, bottomRight, bottomLeft);
    }
  }
  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  };
}

export function createParklandComposableMesh<T>(
  texture: PIXI.Texture,
  entries: readonly T[],
  courseWidth: number,
  subdivisions: number,
  cellIndex: (entry: T) => number,
  project: (entry: T, x: number, y: number) => Readonly<{ x: number; y: number }>,
  reuseVertices: boolean,
): PIXI.Mesh | null {
  const data = buildParklandComposableMeshGeometry(
    entries, courseWidth, subdivisions, cellIndex, project, reuseVertices,
  );
  return data.indices.length === 0 ? null : new PIXI.Mesh({
    geometry: new PIXI.MeshGeometry(data),
    texture,
  });
}

export function createLandscapeRingMask(
  rings: readonly (readonly Point[])[],
  project: (point: Point) => Point,
): PIXI.Graphics {
  const mask = new PIXI.Graphics();
  mask.eventMode = "none";
  const nodes = rings
    .filter((ring) => ring.length >= 3)
    .map((ring) => ({ ring, area: Math.abs(ringSignedArea(ring)), parent: -1, depth: 0 }))
    .sort((a, b) => b.area - a.area);
  for (let index = 0; index < nodes.length; index++) {
    const point = nodes[index].ring[0];
    for (let parent = index - 1; parent >= 0; parent--) {
      if (!pointInLandscapeRing(nodes[parent].ring, point)) continue;
      nodes[index].parent = parent;
      nodes[index].depth = nodes[parent].depth + 1;
      break;
    }
  }
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (node.depth % 2 !== 0) continue;
    const outer = node.ring.map(project);
    mask.poly(outer.flatMap((point) => [point.x, point.y]));
    mask.fill(0xffffff);
    for (let holeIndex = 0; holeIndex < nodes.length; holeIndex++) {
      const hole = nodes[holeIndex];
      if (hole.parent !== index || hole.depth % 2 !== 1) continue;
      const points = hole.ring.map(project);
      mask.poly(points.flatMap((point) => [point.x, point.y]));
      mask.cut();
    }
  }
  return mask;
}

export function appendParklandComposableUndercoat(
  layer: PIXI.Container,
  texture: PIXI.Texture,
  components: readonly LandscapeComponent[],
  courseWidth: number,
  subdivisions: number,
  heightfield: VisualHeightfield,
  rotation: IsoRotation,
  tint: number,
): boolean {
  const turfCells = components
    .filter((component) => isParklandComposableSemantic(component.terrain))
    .flatMap((component) => component.cells.map((cell) => ({ cell, component })))
    .sort((a, b) => {
      const ax = a.cell % courseWidth;
      const ay = Math.floor(a.cell / courseWidth);
      const bx = b.cell % courseWidth;
      const by = Math.floor(b.cell / courseWidth);
      return isoDepth(ax + 0.5, ay + 0.5, sampleLandscapeSurfaceHeight(heightfield, a.component, ax + 0.5, ay + 0.5), rotation)
        - isoDepth(bx + 0.5, by + 0.5, sampleLandscapeSurfaceHeight(heightfield, b.component, bx + 0.5, by + 0.5), rotation);
    });
  const mesh = createParklandComposableMesh(
    texture,
    turfCells,
    courseWidth,
    subdivisions,
    (entry) => entry.cell,
    (entry, x, y) => worldToIso(
      x, y, sampleLandscapeSurfaceHeight(heightfield, entry.component, x, y), rotation,
    ),
    false,
  );
  if (!mesh) return false;
  mesh.eventMode = "none";
  mesh.label = "parkland-common-phase:undercoat";
  mesh.tint = tint;
  layer.addChild(mesh);
  return true;
}

export function appendParklandComposableCues(
  layer: PIXI.Container,
  cues: Readonly<Record<ParklandComposableSemantic, PIXI.Texture>>,
  components: readonly LandscapeComponent[],
  courseWidth: number,
  subdivisions: number,
  heightfield: VisualHeightfield,
  rotation: IsoRotation,
  tintFor: (semantic: ParklandComposableSemantic) => number,
): readonly ParklandComposableSemantic[] {
  const drawn: ParklandComposableSemantic[] = [];
  for (const semantic of PARKLAND_COMPOSABLE_SEMANTICS) {
    const entries = components
      .filter((component) => component.terrain === semantic)
      .flatMap((component) => component.cells.map((cell) => ({ cell, component })));
    const mesh = createParklandComposableMesh(
      cues[semantic],
      entries,
      courseWidth,
      subdivisions,
      (entry) => entry.cell,
      (entry, x, y) => worldToIso(
        x, y, sampleLandscapeSurfaceHeight(heightfield, entry.component, x, y), rotation,
      ),
      false,
    );
    if (!mesh) continue;
    mesh.eventMode = "none";
    mesh.label = `parkland-common-phase:semantic:${semantic}`;
    mesh.tint = tintFor(semantic);
    layer.addChild(mesh);
    drawn.push(semantic);
  }
  return drawn;
}

function mixRgb(color: number, target: number, amount: number): number {
  const channel = (shift: number) => Math.round(
    ((color >> shift) & 0xff) * (1 - amount) + ((target >> shift) & 0xff) * amount,
  );
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

export function appendParklandComposablePresentation(
  layer: PIXI.Container,
  sources: ReturnType<typeof resolveParklandComposableSources<PIXI.Texture>> & {},
  components: readonly LandscapeComponent[],
  course: {
    readonly width: number;
    readonly height: number;
    readonly elevations: readonly number[];
    readonly buildings: readonly Building[];
  },
  presentationTiles: readonly Terrain[],
  authoritativeTiles: readonly Terrain[],
  subdivisions: number,
  heightfield: VisualHeightfield,
  rotation: IsoRotation,
  standardColorVision: boolean,
  colors: Readonly<Record<ParklandComposableSemantic, number>>,
  trace: Pick<ReturnType<typeof createParklandComposableTrace>, "recordSemantic" | "recordPairFringes">,
): PIXI.Container {
  const presentationLayer = sources.quality === "low" ? new PIXI.Container() : layer;
  if (presentationLayer !== layer) {
    presentationLayer.eventMode = "none";
    presentationLayer.label = "parkland-common-phase:low";
    layer.addChild(presentationLayer);
  }
  appendParklandComposableUndercoat(
    presentationLayer,
    sources.undercoat,
    components,
    course.width,
    subdivisions,
    heightfield,
    rotation,
    standardColorVision ? 0xffffff : mixRgb(0xffffff, colors.rough, 0.35),
  );
  for (const semantic of appendParklandComposableCues(
    presentationLayer,
    sources.cues,
    components,
    course.width,
    subdivisions,
    heightfield,
    rotation,
    (role) => standardColorVision ? 0xffffff : mixRgb(0xffffff, colors[role], 0.28),
  )) trace.recordSemantic(semantic);
  trace.recordPairFringes(appendParklandPairFringes(
    presentationLayer,
    sources.quality,
    sources.pair,
    { ...course, tiles: presentationTiles, authoritativeTiles },
    heightfield,
    rotation,
  ));
  return presentationLayer;
}

function fnv1aAuthority(values: readonly (string | number)[]): string {
  let hash = 0x811c9dc5;
  for (const value of values) {
    const text = String(value);
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 124;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function parklandPairAssetSource(
  quality: AtlasQuality,
  item: ParklandPairFringeEdge | ParklandPairFringeCornerPatch,
) {
  const role = parklandPairFringeAssetRole(item);
  const id = "direction" in item
    ? `${quality}/edge-${item.pair}-${item.direction}.png`
    : `${quality}/corner-${item.pair}-${item.corner}.png`;
  return { id, hash: PARKLAND_PAIR_FRINGE_SOURCE_HASHES[quality][role] };
}

function parklandPairTileMesh(
  texture: PIXI.Texture,
  item: ParklandPairFringeEdge | ParklandPairFringeCornerPatch,
  heightfield: VisualHeightfield,
  rotation: IsoRotation,
): PIXI.Mesh {
  const { x, y } = item;
  const world = [
    [x + 0.5, y + 0.5],
    [x, y],
    [x + 1, y],
    [x + 1, y + 1],
    [x, y + 1],
  ] as const;
  const positions = world.flatMap(([worldX, worldY]) => {
    const projected = worldToIso(
      worldX,
      worldY,
      sampleLandscapeSurfaceHeight(heightfield, null, worldX, worldY),
      rotation,
    );
    return [projected.x, projected.y];
  });
  return new PIXI.Mesh({
    geometry: new PIXI.MeshGeometry({
      positions: new Float32Array(positions),
      uvs: new Float32Array([
        0.5, 0.5,
        0.5, 0,
        1, 0.5,
        0.5, 1,
        0, 0.5,
      ]),
      indices: new Uint32Array([
        0, 1, 2,
        0, 2, 3,
        0, 3, 4,
        0, 4, 1,
      ]),
    }),
    texture,
  });
}

export interface ParklandPairFringeRenderDiagnostics {
  readonly active: true;
  readonly quality: AtlasQuality;
  readonly rotation: IsoRotation;
  readonly authoritativeDifferingTurfAdjacencies: number;
  readonly sameElevationDifferingTurfAdjacencies: number;
  readonly presentationDifferingTurfAdjacencies: number;
  readonly presentationSameElevationDifferingTurfAdjacencies: number;
  readonly presentationOmittedDifferentElevation: number;
  readonly omittedDifferentElevation: number;
  readonly omittedSamePresentation: number;
  readonly omittedBlocked: number;
  readonly plannedStrips: number;
  readonly emittedStrips: number;
  readonly cornerCandidates: number;
  readonly plannedCorners: number;
  readonly emittedCorners: number;
  readonly pairCounts: Readonly<Record<string, number>>;
  readonly directionCounts: Readonly<Record<string, number>>;
  readonly exactlyOnceOwnerKeys: boolean;
  readonly missingOwners: number;
  readonly mixedPairMasks: 0;
  readonly samePresentationEmitters: 0;
  readonly fullCellSprites: 0;
  readonly ownershipOverlaps: 0;
  readonly doubleOwners: 0;
  readonly missingAssetSourceIds: readonly string[];
  readonly assetSourceIds: readonly string[];
  readonly assetSourceHashes: readonly string[];
  readonly opacity: number;
  readonly rotationMapping: ReturnType<typeof parklandPairFringeRotationMapping>;
  readonly authorityHashes: {
    readonly tilesBefore: string;
    readonly tilesAfter: string;
    readonly presentationTilesBefore: string;
    readonly presentationTilesAfter: string;
    readonly elevationsBefore: string;
    readonly elevationsAfter: string;
  };
}

export function appendParklandPairFringes(
  layer: PIXI.Container,
  quality: AtlasQuality,
  lookup: (role: ParklandPairFringeAssetRole) => PIXI.Texture | null,
  course: {
    readonly tiles: readonly Terrain[];
    readonly authoritativeTiles?: readonly Terrain[];
    readonly elevations: readonly number[];
    readonly width: number;
    readonly height: number;
    readonly buildings: readonly Building[];
  },
  heightfield: VisualHeightfield,
  rotation: IsoRotation,
): ParklandPairFringeRenderDiagnostics {
  const authoritativeTiles = course.authoritativeTiles ?? course.tiles;
  const tileHashBefore = fnv1aAuthority(authoritativeTiles);
  const presentationTileHashBefore = fnv1aAuthority(course.tiles);
  const elevationHashBefore = fnv1aAuthority(course.elevations);
  const blockedCells = new Set<number>();
  for (const building of course.buildings) for (const tile of buildingTiles(building)) {
    if (tile.x >= 0 && tile.y >= 0 && tile.x < course.width && tile.y < course.height) {
      blockedCells.add(tile.y * course.width + tile.x);
    }
  }
  const plan = buildParklandPairFringePlan({
    tiles: course.tiles,
    pairIdentityTiles: authoritativeTiles,
    elevations: course.elevations,
    width: course.width,
    height: course.height,
    blockedCells,
  });
  const authoritativePlan = buildParklandPairFringePlan({
    tiles: authoritativeTiles,
    elevations: course.elevations,
    width: course.width,
    height: course.height,
    blockedCells,
  });
  const opacity = quality === "high" ? 0.5 : quality === "medium" ? 0.48 : 0.44;
  const emittedOwnerKeys = new Set<string>();
  const source = new Map<string, string>();
  const missingAssetSourceIds = new Set<string>();
  let emittedStrips = 0;
  let emittedCorners = 0;
  const append = (item: ParklandPairFringeEdge | ParklandPairFringeCornerPatch) => {
    const role = parklandPairFringeAssetRole(item);
    const asset = parklandPairAssetSource(quality, item);
    const texture = lookup(role);
    if (!texture || texture.destroyed || !asset.hash) {
      missingAssetSourceIds.add(asset.id);
      return;
    }
    const mesh = parklandPairTileMesh(texture, item, heightfield, rotation);
    mesh.eventMode = "none";
    mesh.alpha = opacity;
    mesh.label = `parkland-pair-fringe:${role}:${item.ownerKey}`;
    layer.addChild(mesh);
    emittedOwnerKeys.add(`${"direction" in item ? "edge" : "corner"}:${item.ownerKey}`);
    source.set(asset.id, asset.hash);
    if ("direction" in item) emittedStrips++;
    else emittedCorners++;
  };
  for (const edge of plan.edges) append(edge);
  for (const corner of plan.corners) append(corner);
  const entries = [...source.entries()].sort(([a], [b]) => a.localeCompare(b));
  return {
    active: true,
    quality,
    rotation,
    ...plan.diagnostics,
    authoritativeDifferingTurfAdjacencies:
      authoritativePlan.diagnostics.authoritativeDifferingTurfAdjacencies,
    sameElevationDifferingTurfAdjacencies:
      authoritativePlan.diagnostics.sameElevationDifferingTurfAdjacencies,
    omittedDifferentElevation: authoritativePlan.diagnostics.omittedDifferentElevation,
    omittedSamePresentation: authoritativePlan.diagnostics.omittedSamePresentation,
    presentationDifferingTurfAdjacencies: plan.diagnostics.authoritativeDifferingTurfAdjacencies,
    presentationSameElevationDifferingTurfAdjacencies:
      plan.diagnostics.sameElevationDifferingTurfAdjacencies,
    presentationOmittedDifferentElevation: plan.diagnostics.omittedDifferentElevation,
    emittedStrips,
    emittedCorners,
    exactlyOnceOwnerKeys: emittedOwnerKeys.size === emittedStrips + emittedCorners
      && emittedStrips === plan.diagnostics.plannedStrips
      && emittedCorners === plan.diagnostics.plannedCorners,
    missingOwners: plan.diagnostics.plannedStrips + plan.diagnostics.plannedCorners
      - emittedStrips - emittedCorners,
    samePresentationEmitters: 0,
    missingAssetSourceIds: [...missingAssetSourceIds].sort(),
    assetSourceIds: entries.map(([id]) => id),
    assetSourceHashes: entries.map(([, hash]) => hash),
    opacity,
    rotationMapping: parklandPairFringeRotationMapping(rotation),
    authorityHashes: {
      tilesBefore: tileHashBefore,
      tilesAfter: fnv1aAuthority(authoritativeTiles),
      presentationTilesBefore: presentationTileHashBefore,
      presentationTilesAfter: fnv1aAuthority(course.tiles),
      elevationsBefore: elevationHashBefore,
      elevationsAfter: fnv1aAuthority(course.elevations),
    },
  };
}

export interface ParklandComposableDiagnostics {
  readonly active: boolean;
  readonly contract: typeof PARKLAND_COMPOSABLE_ID;
  readonly phase: typeof PARKLAND_COMPOSABLE_PHASE;
  readonly source: "approved-zk463-assets" | "legacy";
  readonly quality: AtlasQuality;
  readonly worldPeriodTiles: typeof PARKLAND_COMPOSABLE_WORLD_PERIOD_TILES;
  readonly undercoatDraws: number;
  readonly semanticCueDraws: number;
  readonly semantics: readonly ParklandComposableSemantic[];
  readonly sourceIds: readonly string[];
  readonly sourceHashes: readonly string[];
  readonly semanticComposition: "legacy" | "motif-ink-over-common-undercoat";
  readonly motifOnly: boolean;
  readonly motifMetrics: readonly ParklandMotifMetrics[];
  readonly patterns: Readonly<Record<ParklandComposableSemantic, string>>;
  readonly independentPerCellPhase: false;
  readonly samePresentationEmitters: 0;
  readonly suppressedLegacyTurfContourRuns: number;
  readonly emittedLegacyTurfContourRuns: number;
  readonly preservedNonTurfContourRuns: number;
  readonly preservedHazardPathContourRuns: number;
  readonly preservedLandformShoulders: number;
  readonly elevationShoulderOwner: "landform-presentation-plan";
  readonly fullCellOutlines: false;
  readonly legacyDiamondTopPlane: boolean;
  readonly lowContract: typeof PARKLAND_COMPOSABLE_LOW_CONTRACT | null;
  readonly pairFringes: ParklandPairFringeRenderDiagnostics | null;
}

export function inactiveParklandComposableDiagnostics(quality: AtlasQuality): ParklandComposableDiagnostics {
  return {
    active: false,
    contract: PARKLAND_COMPOSABLE_ID,
    phase: PARKLAND_COMPOSABLE_PHASE,
    source: "legacy",
    quality,
    worldPeriodTiles: PARKLAND_COMPOSABLE_WORLD_PERIOD_TILES,
    undercoatDraws: 0,
    semanticCueDraws: 0,
    semantics: [],
    sourceIds: [],
    sourceHashes: [],
    semanticComposition: "legacy",
    motifOnly: false,
    motifMetrics: [],
    patterns: PARKLAND_COMPOSABLE_PATTERNS,
    independentPerCellPhase: false,
    samePresentationEmitters: 0,
    suppressedLegacyTurfContourRuns: 0,
    emittedLegacyTurfContourRuns: 0,
    preservedNonTurfContourRuns: 0,
    preservedHazardPathContourRuns: 0,
    preservedLandformShoulders: 0,
    elevationShoulderOwner: "landform-presentation-plan",
    fullCellOutlines: false,
    legacyDiamondTopPlane: true,
    lowContract: quality === "low" ? PARKLAND_COMPOSABLE_LOW_CONTRACT : null,
    pairFringes: null,
  };
}

export function activeParklandComposableDiagnostics(
  quality: AtlasQuality,
  semantics: readonly ParklandComposableSemantic[],
  semanticCueDraws = new Set(semantics).size,
  motifMetrics: readonly ParklandMotifMetrics[] = [],
  contourRuns: {
    suppressedLegacyTurf: number;
    emittedLegacyTurf: number;
    preservedNonTurf: number;
    preservedHazardPath: number;
    preservedLandformShoulders: number;
  } = {
    suppressedLegacyTurf: 0,
    emittedLegacyTurf: 0,
    preservedNonTurf: 0,
    preservedHazardPath: 0,
    preservedLandformShoulders: 0,
  },
  pairFringes: ParklandPairFringeRenderDiagnostics | null = null,
): ParklandComposableDiagnostics {
  const ordered = PARKLAND_COMPOSABLE_SEMANTICS.filter((semantic) => semantics.includes(semantic));
  return {
    active: true,
    contract: PARKLAND_COMPOSABLE_ID,
    phase: PARKLAND_COMPOSABLE_PHASE,
    source: "approved-zk463-assets",
    quality,
    worldPeriodTiles: PARKLAND_COMPOSABLE_WORLD_PERIOD_TILES,
    undercoatDraws: 1,
    semanticCueDraws,
    semantics: ordered,
    sourceIds: [
      `${quality}/undercoat.png`,
      ...ordered.map((semantic) => `${quality}/semantic-${semantic}.png`),
    ],
    sourceHashes: [
      PARKLAND_COMPOSABLE_SOURCE_HASHES[quality][0],
      ...ordered.map((semantic) => (
        PARKLAND_COMPOSABLE_SOURCE_HASHES[quality][PARKLAND_COMPOSABLE_SEMANTICS.indexOf(semantic) + 1]
      )),
    ],
    semanticComposition: "motif-ink-over-common-undercoat",
    motifOnly: motifMetrics.length === ordered.length,
    motifMetrics: ordered.flatMap((semantic) => (
      motifMetrics.find((metrics) => metrics.semantic === semantic) ?? []
    )),
    patterns: PARKLAND_COMPOSABLE_PATTERNS,
    independentPerCellPhase: false,
    samePresentationEmitters: 0,
    suppressedLegacyTurfContourRuns: contourRuns.suppressedLegacyTurf,
    emittedLegacyTurfContourRuns: contourRuns.emittedLegacyTurf,
    preservedNonTurfContourRuns: contourRuns.preservedNonTurf,
    preservedHazardPathContourRuns: contourRuns.preservedHazardPath,
    preservedLandformShoulders: contourRuns.preservedLandformShoulders,
    elevationShoulderOwner: "landform-presentation-plan",
    fullCellOutlines: false,
    legacyDiamondTopPlane: false,
    lowContract: quality === "low" ? PARKLAND_COMPOSABLE_LOW_CONTRACT : null,
    pairFringes,
  };
}

export function createParklandComposableTrace(
  theme: LandTheme | undefined,
  quality: AtlasQuality,
  cues?: Readonly<Record<ParklandComposableSemantic, PIXI.Texture>>,
) {
  const semantics = new Set<ParklandComposableSemantic>();
  let semanticCueDraws = 0;
  let suppressedLegacyTurf = 0;
  let preservedNonTurf = 0;
  let preservedHazardPath = 0;
  let pairFringes: ParklandPairFringeRenderDiagnostics | null = null;
  return {
    recordSemantic(terrain: Terrain) {
      if (!isParklandComposableSemantic(terrain)) return;
      semantics.add(terrain);
      semanticCueDraws++;
    },
    suppressLegacyContour(owner: Terrain, outside: Terrain | null) {
      const disposition = parklandComposableContourDisposition(theme, quality, owner, outside);
      if (disposition === "suppress-turf") {
        suppressedLegacyTurf++;
        return true;
      }
      preservedNonTurf++;
      if (disposition === "preserve-hazard-path") preservedHazardPath++;
      return false;
    },
    recordPairFringes(diagnostics: ParklandPairFringeRenderDiagnostics) {
      pairFringes = diagnostics;
    },
    diagnostics(preservedLandformShoulders: number) {
      return activeParklandComposableDiagnostics(
        quality,
        [...semantics],
        semanticCueDraws,
        cues ? PARKLAND_COMPOSABLE_SEMANTICS.flatMap((semantic) => (
          parklandMotifMetrics(cues[semantic]) ?? []
        )) : [],
        {
        suppressedLegacyTurf,
        emittedLegacyTurf: 0,
        preservedNonTurf,
          preservedHazardPath,
          preservedLandformShoulders,
        },
        pairFringes,
      );
    },
  };
}

export function lowParklandPresentationDiagnostics(
  trace: Pick<ReturnType<typeof createParklandComposableTrace>, "diagnostics">,
  components: readonly LandscapeComponent[],
) {
  return {
    composable: trace.diagnostics(0),
    sharedContours: {
      authoritativeSingletonDeepRough: components.filter((component) => (
        component.terrain === "deep_rough" && component.cells.length === 1
      )).length,
      distinctSingletonDeepRoughFields: 0,
      distinctSingletonDeepRoughBands: 0,
      coalescedSingletonDeepRough: 0,
    },
    pathMaterial: {
      active: false,
      mode: "legacy",
      quality: "low",
      componentCount: 0,
      stripCount: 0,
      roles: ["core"],
      textureIds: ["legacy:path"],
      widths: { shoulder: 0, edge: 0 },
      ownership: [],
    },
  } as const;
}
