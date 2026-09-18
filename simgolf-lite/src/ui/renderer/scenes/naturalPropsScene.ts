import * as PIXI from "pixi.js";
import { BIOME_KEYS, getBiomeDefinition } from "../../../game/models/biomes";
import {
  plantDefinition,
  resolvedObstaclePlantId,
} from "../../../game/models/plantRegistry";
import type { Obstacle, Terrain } from "../../../game/models/types";
import {
  isCultivatedNaturalProp,
  pickNaturalProp,
  shouldFadeTallProp,
  type NaturalPropFrame,
  type NaturalPropVariant,
} from "../../../game/render/naturalProps";
import { TILE_H, TILE_W } from "../../../game/render/iso";
import { frontCorner, placeObject } from "../../../game/render/objectPlacement";
import {
  seasonalPlantClimate,
  seasonalPlantPresentation,
  type SeasonalPlantPresentation,
} from "../../../game/render/seasonalPlants";
import {
  deriveTreeHabitat,
  type TreeHabitatPatch,
} from "../../../game/render/treeHabitat";
import {
  deriveHabitatComposition,
  type HabitatCompositionPlacement,
} from "../../../game/render/habitatComposition";
import { isWaterHazard } from "../../../game/models/terrainRules";
import { worldToIso } from "../../../game/render/iso";
import { getPropFrame, getTerrainDetailFrame } from "../../../render/atlas";
import type { ResolvedGraphicsQuality } from "../../../game/render/graphicsQuality";
import type { TerrainDetailFrame, TerrainDetailKind } from "../../../game/render/terrainDetails";
import type { RenderSnapshot } from "../RenderSnapshot";
import type { RenderSceneSystem } from "../SceneSystemHost";

interface NaturalPropSceneEntry {
  readonly sprite: PIXI.Sprite;
  readonly shadow: PIXI.Graphics;
  readonly habitat: PIXI.Graphics | null;
  readonly swayPhase: number | null;
  readonly sway: NaturalPropVariant["sway"];
  readonly tall: boolean;
  readonly fadeAlpha: number;
  readonly baseAlpha: number;
}

export interface NaturalPropsTickInput {
  readonly nowMs: number;
  readonly animationsEnabled: boolean;
  readonly treeSway: boolean;
  readonly focus: { readonly x: number; readonly y: number } | null;
}

export interface NaturalPropsSceneSystem extends RenderSceneSystem {
  readonly id: "naturalProps";
  tick(input: NaturalPropsTickInput): void;
  contentCount(): number;
  habitatDetailCount(): number;
  fallbackTextureCount(): number;
  rebuildCount(): number;
}

export interface NaturalPropsSceneDependencies {
  readonly getAtlasTexture?: typeof getPropFrame;
  readonly getHabitatAtlasTexture?: typeof getTerrainDetailFrame;
  readonly createFallbackTexture?: (
    type: Obstacle["type"],
    frame: NaturalPropFrame,
  ) => { readonly texture: PIXI.Texture; readonly owned: boolean };
  readonly createSprite?: (texture: PIXI.Texture) => PIXI.Sprite;
  readonly createGraphics?: () => PIXI.Graphics;
}

const WET_SHORE_CAPS: Readonly<Record<ResolvedGraphicsQuality, number>> = {
  high: 42,
  medium: 22,
  low: 0,
};

type EcologyTier = "near" | "middle" | "far" | "shore";

interface WetShorePlacement {
  readonly id: string;
  readonly clusterId: string;
  readonly massId: string;
  readonly role: "wet_shore";
  readonly tier: "shore";
  readonly tileX: number;
  readonly tileY: number;
  readonly worldX: number;
  readonly worldY: number;
  readonly frame: TerrainDetailFrame;
  readonly kind: Extract<TerrainDetailKind, "reeds" | "shore_stones">;
  readonly scale: number;
  readonly rank: number;
}

type EcologyPlacement = HabitatCompositionPlacement | WetShorePlacement;

interface EcologyPresentation {
  readonly scale: number;
  readonly alpha: number;
  readonly verticalOffset: number;
}

const TIER_PRESENTATION: Readonly<Record<EcologyTier, EcologyPresentation>> = {
  // Medium/High habitat members are deliberately close in visual weight: a
  // three-to-five cell mass should read as one bed at normal M19 zoom.
  near: { scale: 1.28, alpha: 0.98, verticalOffset: 0.31 },
  middle: { scale: 1.14, alpha: 0.94, verticalOffset: 0.29 },
  far: { scale: 1.0, alpha: 0.88, verticalOffset: 0.26 },
  shore: { scale: 0.88, alpha: 0.86, verticalOffset: 0.34 },
};

const ROLE_SCALE: Readonly<Record<EcologyPlacement["role"], number>> = {
  woodland_floor: 0.9,
  understory: 1,
  rough_mass: 1.12,
  rock_plant_cluster: 0.84,
  wet_shore: 1,
};

function mix32(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function ecologyHash(seed: number, x: number, y: number, salt: number): number {
  return mix32(seed
    ^ Math.imul(x + 17, 0x45d9f3b)
    ^ Math.imul(y + 31, 0x119de1f3)
    ^ salt);
}

function wetShoreTileKey(x: number, y: number): string {
  return `${x},${y}`;
}

function wetShoreNeighbors(
  course: RenderSnapshot["course"],
  tiles: readonly Terrain[],
  x: number,
  y: number,
): readonly { readonly x: number; readonly y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= course.width || ny >= course.height) continue;
    if (isWaterHazard(tiles[ny * course.width + nx])) points.push({ x: nx, y: ny });
  }
  return points;
}

function isClearWetShoreTile(
  course: RenderSnapshot["course"],
  tiles: readonly Terrain[],
  x: number,
  y: number,
): boolean {
  const terrain = tiles[y * course.width + x];
  if (terrain !== "rough" && terrain !== "wetland") return false;
  if (wetShoreNeighbors(course, tiles, x, y).length === 0) return false;
  // The ecology scene may dress banks, never a maintained playing surface,
  // bunker, cart path, or the water/depth treatment itself.
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= course.width || ny >= course.height) continue;
    const neighbor = tiles[ny * course.width + nx];
    if (neighbor === "fairway" || neighbor === "green" || neighbor === "tee" || neighbor === "path" || neighbor === "sand" || neighbor === "waste_area") return false;
  }
  return true;
}

function wetShoreComponents(
  course: RenderSnapshot["course"],
  tiles: readonly Terrain[],
): readonly (readonly { readonly x: number; readonly y: number }[])[] {
  const candidates = new Map<string, { x: number; y: number }>();
  for (let y = 0; y < course.height; y++) for (let x = 0; x < course.width; x++) {
    if (isClearWetShoreTile(course, tiles, x, y)) candidates.set(wetShoreTileKey(x, y), { x, y });
  }
  const components: { x: number; y: number }[][] = [];
  while (candidates.size > 0) {
    const first = [...candidates.values()].sort((left, right) => left.y - right.y || left.x - right.x)[0];
    candidates.delete(wetShoreTileKey(first.x, first.y));
    const component = [first];
    for (let cursor = 0; cursor < component.length; cursor++) {
      const point = component[cursor];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const key = wetShoreTileKey(point.x + dx, point.y + dy);
        const neighbor = candidates.get(key);
        if (!neighbor) continue;
        candidates.delete(key);
        component.push(neighbor);
      }
    }
    if (component.length >= 2) components.push(component.sort((left, right) => left.y - right.y || left.x - right.x));
  }
  return components.sort((left, right) => left[0].y - right[0].y || left[0].x - right[0].x);
}

/**
 * Scene-owned wet-bank groups. They deliberately use reeds and shore stones
 * only: water bodies, shelves, banks, and contour relief remain depth-scene
 * responsibilities. The plan is world-space and never observes a camera.
 */
export function deriveWetShoreComposition(input: {
  readonly course: RenderSnapshot["course"];
  readonly tiles: readonly Terrain[];
  readonly worldSeed: number;
  readonly quality: ResolvedGraphicsQuality;
}): readonly WetShorePlacement[] {
  const cap = WET_SHORE_CAPS[input.quality];
  if (cap === 0 || input.course.theme !== "parkland" || input.tiles.length !== input.course.width * input.course.height) return [];
  const output: WetShorePlacement[] = [];
  for (const component of wetShoreComponents(input.course, input.tiles)) {
    const available = new Map(component.map((point) => [wetShoreTileKey(point.x, point.y), point]));
    const clusterLimit = Math.min(3, Math.max(1, Math.floor(component.length / 3)));
    for (let clusterIndex = 0; clusterIndex < clusterLimit && available.size > 0; clusterIndex++) {
      const anchor = [...available.values()].sort((left, right) => {
        const leftHash = ecologyHash(input.worldSeed, left.x, left.y, 0x6b41 + clusterIndex);
        const rightHash = ecologyHash(input.worldSeed, right.x, right.y, 0x6b41 + clusterIndex);
        return leftHash - rightHash || left.y - right.y || left.x - right.x;
      })[0];
      const clusterId = `wet-shore:${component[0].x},${component[0].y}:${clusterIndex}`;
      const massId = `${clusterId}:bank`;
      const members = [...available.values()].sort((left, right) => {
        const leftDistance = (left.x - anchor.x) ** 2 + (left.y - anchor.y) ** 2;
        const rightDistance = (right.x - anchor.x) ** 2 + (right.y - anchor.y) ** 2;
        const leftHash = ecologyHash(input.worldSeed, left.x, left.y, 0x2c17 + clusterIndex);
        const rightHash = ecologyHash(input.worldSeed, right.x, right.y, 0x2c17 + clusterIndex);
        return leftDistance - rightDistance || leftHash - rightHash || left.y - right.y || left.x - right.x;
      }).slice(0, Math.min(4, available.size));
      for (const [member, point] of members.entries()) {
        available.delete(wetShoreTileKey(point.x, point.y));
        const h = ecologyHash(input.worldSeed, point.x, point.y, 0x4d21 + member);
        const terrain = input.tiles[point.y * input.course.width + point.x];
        const kind = terrain === "wetland" || member % 3 !== 2 ? "reeds" : "shore_stones";
        const variant = input.quality === "medium" ? 0 : (h >>> 30) & 1;
        output.push({
          id: `${massId}:${member}`,
          clusterId,
          massId,
          role: "wet_shore",
          tier: "shore",
          tileX: point.x,
          tileY: point.y,
          worldX: point.x + 0.5 + (((h >>> 8) & 0xff) / 0xff - 0.5) * 0.36,
          worldY: point.y + 0.5 + (((h >>> 16) & 0xff) / 0xff - 0.5) * 0.3,
          frame: `parkland_${kind}_${variant}` as TerrainDetailFrame,
          kind,
          scale: 0.86 + ((h >>> 24) & 0x3f) / 0x3f * 0.24,
          rank: output.length,
        });
      }
    }
  }
  return output.slice(0, cap);
}

function ecologyPresentation(detail: EcologyPlacement): EcologyPresentation {
  const tier = TIER_PRESENTATION[detail.tier];
  return {
    scale: tier.scale * ROLE_SCALE[detail.role],
    alpha: tier.alpha,
    verticalOffset: tier.verticalOffset,
  };
}

function darken(color: number, factor: number): number {
  const r = Math.round(((color >> 16) & 0xff) * factor);
  const g = Math.round(((color >> 8) & 0xff) * factor);
  const b = Math.round((color & 0xff) * factor);
  return (Math.min(255, r) << 16) | (Math.min(255, g) << 8) | Math.min(255, b);
}

function shade(color: number, factor: number): number {
  if (factor <= 1) return darken(color, factor);
  const mix = (channel: number) => Math.round(channel + (255 - channel) * (factor - 1));
  return (
    Math.min(255, mix((color >> 16) & 0xff)) << 16
    | Math.min(255, mix((color >> 8) & 0xff)) << 8
    | Math.min(255, mix(color & 0xff))
  );
}

/** Keeps procedural fallback ownership aligned with the registered biome catalog. */
export function naturalPropFallbackBiome(frame: string) {
  return BIOME_KEYS.find((key) => frame.startsWith(`${key}_`)) ?? null;
}

/** Synchronous, scene-owned fallback. Shared PIXI.Texture.WHITE is never owned. */
function createFallbackObstacleTexture(
  type: Obstacle["type"],
  frame: NaturalPropFrame,
): { texture: PIXI.Texture; owned: boolean } {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) return { texture: PIXI.Texture.WHITE, owned: false };
  const biomeKey = naturalPropFallbackBiome(frame);
  if (!biomeKey) throw new Error(`[renderer] fallback frame has no registered biome owner: ${frame}`);
  const propTints = getBiomeDefinition(biomeKey).presentation.preview.propTints;
  const base = propTints[type];
  const css = (color: number) => `#${color.toString(16).padStart(6, "0")}`;
  const dark = css(darken(base, 0.72));
  const mid = css(base);
  const light = css(shade(base, 1.28));
  const trunk = css(darken(propTints.rock, 0.78));

  if (type === "tree") {
    context.fillStyle = trunk;
    context.fillRect(29, 35, 6, 22);
    const conifer = /pine|fir/.test(frame);
    if (conifer) {
      context.fillStyle = dark;
      context.beginPath();
      context.moveTo(32, 5);
      context.lineTo(16, 42);
      context.lineTo(48, 42);
      context.closePath();
      context.fill();
      context.fillStyle = mid;
      context.beginPath();
      context.moveTo(32, 11);
      context.lineTo(21, 35);
      context.lineTo(43, 35);
      context.closePath();
      context.fill();
      context.fillStyle = light;
      context.beginPath();
      context.moveTo(29, 13);
      context.lineTo(25, 29);
      context.lineTo(33, 27);
      context.closePath();
      context.fill();
    } else {
      for (const [x, y, radius, color] of [
        [23, 29, 12, dark],
        [40, 29, 12, dark],
        [31, 19, 15, mid],
        [26, 17, 8, light],
      ] as const) {
        context.fillStyle = color;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
      }
    }
  } else if (type === "bush") {
    for (const [x, y, radius, color] of [
      [19, 43, 10, dark],
      [32, 39, 13, mid],
      [45, 43, 10, dark],
      [27, 34, 9, light],
      [39, 35, 8, light],
    ] as const) {
      context.fillStyle = color;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
  } else {
    context.fillStyle = css(darken(propTints.rock, 0.82));
    context.beginPath();
    context.moveTo(13, 53);
    context.lineTo(18, 31);
    context.lineTo(31, 20);
    context.lineTo(47, 27);
    context.lineTo(53, 50);
    context.closePath();
    context.fill();
    context.fillStyle = css(shade(propTints.rock, 1.24));
    context.beginPath();
    context.moveTo(21, 42);
    context.lineTo(29, 27);
    context.lineTo(42, 31);
    context.lineTo(47, 43);
    context.closePath();
    context.fill();
  }

  return { texture: PIXI.Texture.from(canvas), owned: true };
}

function drawHabitat(graphics: PIXI.Graphics, patch: TreeHabitatPatch): void {
  const palettes = {
    pine_straw: [0x68472b, 0x875b31, 0xaa783f],
    leaf_litter: [0x6c4e32, 0x896039, 0xac804c],
    dry_soil: [0x876343, 0xa77a4f, 0xc29661],
  } as const;
  const tones = palettes[patch.kind];
  for (const lobe of patch.lobes) {
    graphics.ellipse(lobe.offsetX, lobe.offsetY, lobe.radiusX + 1.8, lobe.radiusY + 0.8);
    graphics.fill({ color: patch.kind === "dry_soil" ? 0x665039 : 0x3d542f, alpha: 0.16 });
    graphics.ellipse(lobe.offsetX, lobe.offsetY, lobe.radiusX, lobe.radiusY);
    graphics.fill({ color: tones[lobe.tone], alpha: 0.54 });
  }
  for (const root of patch.roots) {
    graphics.moveTo(0, 0);
    graphics.lineTo(Math.cos(root.angle) * root.length, Math.sin(root.angle) * root.length * 0.4);
    graphics.stroke({
      width: root.width,
      color: patch.kind === "dry_soil" ? 0x60462f : 0x4d3929,
      alpha: 0.4,
      cap: "round",
    });
  }
  for (const detail of patch.details) {
    if (patch.kind === "pine_straw") {
      const length = detail.size * 2.7;
      graphics.moveTo(
        detail.x - Math.cos(detail.angle) * length / 2,
        detail.y - Math.sin(detail.angle) * length * 0.22,
      );
      graphics.lineTo(
        detail.x + Math.cos(detail.angle) * length / 2,
        detail.y + Math.sin(detail.angle) * length * 0.22,
      );
      graphics.stroke({
        width: Math.max(0.65, detail.size * 0.55),
        color: tones[detail.tone],
        alpha: 0.72,
        cap: "round",
      });
    } else if (patch.kind === "leaf_litter") {
      graphics.ellipse(detail.x, detail.y, detail.size * 1.35, detail.size * 0.62);
      graphics.fill({ color: tones[detail.tone], alpha: 0.74 });
    } else {
      graphics.circle(detail.x, detail.y, detail.size * 0.72);
      graphics.fill({ color: tones[detail.tone], alpha: 0.7 });
    }
  }
}

/** Owns every natural-obstacle display object and only renderer-created textures. */
export function createNaturalPropsSceneSystem(
  objects: PIXI.Container,
  terrainDecals: PIXI.Container,
  onContentCount: (count: number) => void = () => {},
  dependencies: NaturalPropsSceneDependencies = {},
): NaturalPropsSceneSystem {
  const getAtlasTexture = dependencies.getAtlasTexture ?? getPropFrame;
  const getHabitatAtlasTexture = dependencies.getHabitatAtlasTexture ?? getTerrainDetailFrame;
  const createFallbackTexture = dependencies.createFallbackTexture ?? createFallbackObstacleTexture;
  const createSprite = dependencies.createSprite ?? ((texture) => new PIXI.Sprite(texture));
  const createGraphics = dependencies.createGraphics ?? (() => new PIXI.Graphics());
  const entries = new Map<string, NaturalPropSceneEntry>();
  const habitatDetails: PIXI.Sprite[] = [];
  const fallbackTextures = new Map<string, { texture: PIXI.Texture; owned: boolean }>();
  let rebuilds = 0;

  const clear = () => {
    for (const entry of entries.values()) {
      entry.sprite.parent?.removeChild(entry.sprite);
      entry.sprite.destroy();
      entry.shadow.parent?.removeChild(entry.shadow);
      entry.shadow.destroy();
      entry.habitat?.parent?.removeChild(entry.habitat);
      entry.habitat?.destroy();
    }
    entries.clear();
    for (const sprite of habitatDetails) {
      sprite.parent?.removeChild(sprite);
      sprite.destroy();
    }
    habitatDetails.length = 0;
    for (const fallback of fallbackTextures.values()) {
      if (fallback.owned) fallback.texture.destroy(true);
    }
    fallbackTextures.clear();
    onContentCount(0);
  };

  const render = (snapshot: RenderSnapshot) => {
    rebuilds++;
    clear();
    if (!snapshot.showObstacles) return;
    const course = snapshot.course;
    const terrainNearWater = (x: number, y: number) => {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= course.width || ty >= course.height) continue;
        if (isWaterHazard(snapshot.effectiveTiles[ty * course.width + tx])) return true;
      }
      return false;
    };
    const seasonalClimate = seasonalPlantClimate(snapshot.seasonalVisualState);
    const prepared = snapshot.obstacles.map((obstacle) => {
      const index = obstacle.y * course.width + obstacle.x;
      const context = {
        theme: course.theme,
        runSeed: snapshot.worldSeed,
        obstacle,
        terrain: snapshot.effectiveTiles[index] ?? "rough" as Terrain,
        elevation: course.elevations[index] ?? 0,
        nearWater: terrainNearWater(obstacle.x, obstacle.y),
        cultivated: isCultivatedNaturalProp(obstacle, course.buildings ?? []),
      };
      const selected = pickNaturalProp(context);
      const semanticPlantId = obstacle.origin === "player"
        ? resolvedObstaclePlantId(course.theme, obstacle)
        : undefined;
      const semanticPlant = semanticPlantId ? plantDefinition(semanticPlantId) : undefined;
      const seasonal: SeasonalPlantPresentation | null = selected.variant.plantForm === "non-plant"
        ? null
        : seasonalPlantPresentation({
          identity: semanticPlantId ?? selected.variant.frame,
          profile: semanticPlant?.seasonalProfile ?? selected.variant.seasonalProfile,
          form: semanticPlant
            ? (obstacle.type === "tree" ? "canopy" : "shrub")
            : selected.variant.plantForm,
          x: obstacle.x,
          y: obstacle.y,
          cultivated: context.cultivated,
          elevation: context.elevation,
          nearWater: context.nearWater,
          ecologicalFit: semanticPlant?.ecologicalFit[getBiomeDefinition(course.theme).key] ?? "native",
          climate: seasonalClimate,
        });
      return {
        obstacle,
        selected,
        seasonal,
        habitat: deriveTreeHabitat(
          selected.variant.frame,
          obstacle,
          snapshot.worldSeed,
          selected.scale,
        ),
      };
    });
    const habitatBudget = snapshot.graphicsQuality === "high"
      ? 110
      : snapshot.graphicsQuality === "medium" ? 70 : 30;
    const habitatKeys = new Set(prepared
      .filter((entry) => entry.habitat)
      .sort((a, b) => a.habitat!.rank - b.habitat!.rank)
      .slice(0, habitatBudget)
      .map((entry) => `${entry.obstacle.x},${entry.obstacle.y}`));

    const composition = deriveHabitatComposition({
      course,
      tiles: snapshot.effectiveTiles,
      obstacles: snapshot.obstacles,
      worldSeed: snapshot.worldSeed,
      quality: snapshot.graphicsQuality,
    });
    const wetShore = deriveWetShoreComposition({
      course,
      tiles: snapshot.effectiveTiles,
      worldSeed: snapshot.worldSeed,
      quality: snapshot.graphicsQuality,
    });
    // Composition order is a semantic world-space contract. Do not sort by
    // camera depth: rebuilding at another rotation must retain member order.
    const ecology = [...composition, ...wetShore.map((detail) => ({
      ...detail,
      rank: composition.length + detail.rank,
    }))];
    for (const detail of ecology) {
      const texture = getHabitatAtlasTexture(course.theme, snapshot.graphicsQuality, detail.frame);
      if (!texture) continue;
      const presentation = ecologyPresentation(detail);
      const sprite = createSprite(texture);
      const position = worldToIso(
        detail.worldX,
        detail.worldY,
        snapshot.surfaceHeightAt(detail.worldX, detail.worldY),
        snapshot.rotation,
      );
      sprite.label = `habitat-composition:${detail.id}`;
      sprite.eventMode = "none";
      sprite.anchor.set(0.5, 1);
      sprite.position.set(position.x, position.y + TILE_H * presentation.verticalOffset);
      sprite.scale.set(detail.scale * presentation.scale);
      sprite.alpha = presentation.alpha;
      sprite.zIndex = detail.rank;
      terrainDecals.addChild(sprite);
      habitatDetails.push(sprite);
    }

    for (const { obstacle, selected, seasonal, habitat } of prepared) {
      const key = `${obstacle.x},${obstacle.y}`;
      if (entries.has(key)) continue;
      const selectedHabitat = habitatKeys.has(key) ? habitat : null;
      const fallbackKey = `${obstacle.type}:${selected.variant.frame}`;
      const atlasTexture = getAtlasTexture(
        course.theme,
        snapshot.graphicsQuality,
        selected.variant.frame,
      );
      let texture = atlasTexture;
      if (!texture) {
        let fallback = fallbackTextures.get(fallbackKey);
        if (!fallback) {
          fallback = createFallbackTexture(obstacle.type, selected.variant.frame);
          fallbackTextures.set(fallbackKey, fallback);
        }
        texture = fallback.texture;
      }
      const footprint = { x: obstacle.x, y: obstacle.y, w: 1, d: 1 };
      const anchor = frontCorner(footprint, snapshot.rotation);
      const placement = placeObject(
        footprint,
        snapshot.surfaceHeightAt(anchor.x, anchor.y),
        snapshot.rotation,
      );
      const sprite = createSprite(texture);
      sprite.label = `structure-prop:natural:${key}`;
      sprite.anchor.set(selected.variant.anchor[0], selected.variant.anchor[1]);
      sprite.position.set(placement.position.x, placement.position.y);
      const size = TILE_W * 0.72 * selected.scale;
      sprite.width = size * (seasonal?.scaleX ?? 1);
      sprite.height = (size * texture.height) / texture.width * (seasonal?.scaleY ?? 1);
      sprite.tint = seasonal?.tint ?? 0xffffff;
      sprite.alpha = seasonal?.alpha ?? 1;
      sprite.zIndex = placement.zIndex;
      objects.addChild(sprite);

      const habitatGraphic = selectedHabitat ? createGraphics() : null;
      if (habitatGraphic && selectedHabitat) {
        drawHabitat(habitatGraphic, selectedHabitat);
        habitatGraphic.position.set(placement.position.x, placement.position.y - TILE_H / 2 + 1);
        terrainDecals.addChild(habitatGraphic);
      }
      const shadow = createGraphics();
      const habitatShadowScale = selectedHabitat ? 0.68 : 1;
      shadow.ellipse(
        selected.variant.shadow.offsetX,
        selected.variant.shadow.offsetY,
        selected.variant.shadow.radiusX * selected.scale * habitatShadowScale
          * (seasonal?.shadowScale ?? 1),
        selected.variant.shadow.radiusY * selected.scale * habitatShadowScale
          * (seasonal?.shadowScale ?? 1),
      );
      shadow.fill({
        color: 0x000000,
        alpha: selected.variant.shadow.alpha * (selectedHabitat ? 0.46 : 1),
      });
      shadow.position.set(placement.position.x, placement.position.y - TILE_H / 2 + 1);
      terrainDecals.addChild(shadow);

      entries.set(key, {
        sprite,
        shadow,
        habitat: habitatGraphic,
        swayPhase: selected.variant.sway
          ? ((obstacle.x * 17 + obstacle.y * 29) % 32) / 32 * Math.PI * 2
          : null,
        sway: selected.variant.sway
          ? {
            amplitude: selected.variant.sway.amplitude * (seasonal?.swayScale ?? 1),
            speed: selected.variant.sway.speed,
          }
          : null,
        tall: selected.variant.occlusion.tall,
        fadeAlpha: selected.variant.occlusion.fadeAlpha,
        baseAlpha: seasonal?.alpha ?? 1,
      });
    }
    onContentCount(entries.size);
  };

  return {
    id: "naturalProps",
    create: render,
    update: render,
    destroy: clear,
    tick(input) {
      const t = input.nowMs / 1000;
      for (const entry of entries.values()) {
        if (entry.swayPhase !== null && entry.sway) {
          entry.sprite.skew.x = input.animationsEnabled && input.treeSway
            ? Math.sin(t * entry.sway.speed + entry.swayPhase) * entry.sway.amplitude
            : 0;
        }
        const blocksSelection = input.focus ? shouldFadeTallProp({
          tall: entry.tall,
          propX: entry.sprite.position.x,
          propY: entry.sprite.position.y,
          propWidth: entry.sprite.width,
          propHeight: entry.sprite.height,
          focusX: input.focus.x,
          focusY: input.focus.y,
        }) : false;
        entry.sprite.alpha = blocksSelection
          ? Math.min(entry.baseAlpha, entry.fadeAlpha)
          : entry.baseAlpha;
      }
    },
    contentCount: () => entries.size,
    habitatDetailCount: () => habitatDetails.length,
    fallbackTextureCount: () => fallbackTextures.size,
    rebuildCount: () => rebuilds,
  };
}
