import { useCallback, useEffect, useRef, useState } from "react";
// Pixi's strict-CSP adapter replaces runtime-generated shader/uniform
// functions with static implementations. Keep this before renderer startup so
// Workers deployments can retain a script-src policy without 'unsafe-eval'.
import "pixi.js/unsafe-eval";
import * as PIXI from "pixi.js";
import type { Course, DecorationKind, DecorationRotation, Hole, Obstacle, Point, TeeSet, Terrain } from "../game/models/types";
import type { ShotPlanStep } from "../game/sim/shots/solveShotsToGreen";
import type { GolferRenderData } from "../game/live/types";
import type { PlayerPlayableRound, PlayerProPoint } from "../game/models/playerProTypes";
import type { CameraState, IsoCameraSnapshot } from "../game/render/camera";
import {
  ELEVATION_STEP_PX,
  TILE_H,
  TILE_W,
  isoDepth,
  isoToTile,
  isoToWorld,
  nextRotation,
  tileCenterIso,
  unrotateWorld,
  worldToIso,
  type IsoRotation,
} from "../game/render/iso";
import { getObstacleSprite } from "../render/iconSprites";
import {
  getGolferFrame,
  getPropFrame,
  getTerrainFrame,
  golfersAtlasReady,
  loadAtlases,
} from "../render/atlas";
import { computeTerrainChangeCost } from "../game/models/terrainEconomics";
import type { TerrainStrokePreview } from "../game/models/terrainStroke";
import { formatCurrency } from "../i18n/format";
import { useI18n } from "../i18n/useI18n";
import { ELEVATION_MAX, getElevation } from "../game/models/elevation";
import { entityDepth, placeObject } from "../game/render/objectPlacement";
import {
  GOLFER_DISPLAY_W,
  GOLFER_FEET_Y,
  GOLFER_FRAME_H,
  GOLFER_FRAME_W,
  REACTION_SEC,
  WALK_STRIDES_PER_TILE,
  facingOctant,
  golferFrameName,
  golferPose,
  golferTint,
  golferVariant,
  reactionFor,
  type GolferReaction,
} from "../game/render/golferSprites";
import { ballFlightPose, landingBehavior } from "../game/render/ballFlight";
import {
  EMOTE_STALL_MS,
  createEmoteScheduler,
  emotePresentation,
  feeEmote,
  hazardEmote,
  holeOutEmote,
  moodEmote,
  pruneEmotes,
  resolveOverlaps,
  tryShowEmote,
  type EmoteKind,
} from "../game/render/emotes";
import { forgetGolfer, recordEmote } from "../game/render/emoteFeed";
import { TERRAIN_PALETTES, terrainPattern } from "../accessibility/terrainPalettes";
import type { ColorVisionMode } from "../game/onboarding/profile";
import type { ResortOperations } from "../game/property/types";
import { bindingFromEvent, type BindingAction, type Keybindings } from "../accessibility/keybindings";
import {
  CLOUD_COUNT,
  HERON_STARTLE_TILES,
  birdCrossing,
  cloudPos,
  heronSpot,
  timeOfDayTint,
} from "../game/render/ambient";
import { FLYOVER_DURATION_MS, buildFlyoverKeys, sampleFlyover, type FlyoverKey } from "../game/render/flyover";
import { PerfWindow } from "../game/render/perfStats";
import { computeAutoPar, computeHoleDistanceTiles } from "../game/sim/holeMetrics";
import { buildingSpec, buildingVisualFrame } from "../game/models/buildings";
import { decorationTiles, decorationVisual } from "../game/models/decorations";
import { getLandTheme } from "../game/models/themes";
import { getPinPosition, getTeeBox, PIN_ROTATIONS, TEE_SETS } from "../game/models/courseSetup";
import type { AtlasFrame } from "../render/atlas";
import { AUTOTILE_DIRECTIONS, autotileFeatures, rotateAutotileMask } from "../game/render/autotile";
import {
  getTerrainMaterial,
  mowingShadeAt,
  pickTerrainBaseFrame,
  terrainBoundaryFor,
  terrainTransitionFrame,
  waterShimmerPhase,
} from "../game/render/terrainMaterials";
import { deriveGroundCover, visibleGroundCoverTier } from "../game/render/groundCover";
import { pickNaturalProp, shouldFadeTallProp, type NaturalPropVariant } from "../game/render/naturalProps";
import { isWaterHazard } from "../game/models/terrainRules";
import { T } from "../i18n/T";
import { decodeParcelMap } from "../game/estate/estate";
import type { ArchitectureWarning } from "../game/architecture/architecture";
import type { ArchitectureOverlayRender } from "../game/architecture/reviewTypes";
import {
  gestureScaleToWheelDelta,
  nextWheelZoomTarget,
  normalizeWheelDelta,
} from "../game/render/wheelZoom";
import {
  SCENIC_CAMERA_MARGIN_TILES,
  SCENIC_GENERATION_BLEED_TILES,
  SCENIC_PLANE_TILES,
  clampScenicCameraCenter,
  generateScenicSurround,
  isScenicOceanPoint,
  type CoastEdge,
  type ScenicPatchKind,
} from "../game/render/scenicSurround";
import { buildIntentUnderlayTiles, buildTerrainContours } from "../game/render/surfaceContours";
import type { PaceAdvisorFinding } from "../game/live/paceHistory";

/**
 * PixiStage — the isometric WebGL renderer for the course (ZKU-138/139).
 *
 * Layer architecture (draw order back → front):
 *
 *   stage
 *   ├─ world                ← camera transform (pan/zoom) is applied HERE and
 *   │  │                      nowhere else; all world-space content lives below
 *   │  ├─ surround          ← deterministic, non-interactive regional scenery
 *   │  ├─ terrain           ← one diamond sprite per tile (chunked in ZKU-142)
 *   │  ├─ estateSeam        ← natural full-property boundary treatment
 *   │  ├─ terrainDecals     ← tee/green markers, route/corridor overlays,
 *   │  │                      hover highlight
 *   │  ├─ objects           ← obstacles, buildings, props (depth-sorted via
 *   │  │                      zIndex = isoDepth of the ground anchor)
 *   │  └─ fx                ← live golfers/balls (dot pass — sprites in M11),
 *   │                         transient effects
 *   └─ screenOverlay        ← screen-space UI (wizard distance line);
 *                             does NOT move with the camera
 *
 * Projection: 2:1 dimetric via src/game/render/iso.ts. World-space pixel
 * coordinates inside `world` are iso projections at natural 64×32 scale; the
 * camera fits/zooms that plane to the screen. Pointer input is mapped
 * screen → iso plane → tile via the inverse camera transform + isoToTile, so
 * picking is exact at any pan/zoom.
 *
 * Camera note: with no CameraState (global editing view) the whole course is
 * auto-fitted. With a hole-edit CameraState we honor `center` and fit
 * `bounds`; the flat-renderer `zoom` scalar has different units here, so it
 * is intentionally not reused (free camera control lands in ZKU-141).
 *
 * Camera (ZKU-141): free camera owned by this component — drag-to-pan
 * (middle/right button), wheel zoom-to-cursor, WASD/arrow pan, Q/E cardinal
 * rotation with a short rigid screen-space tween that snaps to the true
 * re-projection on completion. A hole-edit CameraState prop sets the glide
 * target (center + bounds-fit zoom); user input afterwards adjusts freely
 * and reports the new center via onCameraUpdate.
 *
 * Elevation (ZKU-144): tile tops are offset by elevation, tinted by a
 * NW-sun slope shade, and exposed south/east cliff faces are drawn as dirt
 * quads. Picking iterates elevation levels front-to-back so clicking a
 * raised tile selects it, not the tile geometrically behind it.
 */

const COLORS: Record<Terrain, number> = {
  fairway: 0x4fa64f,
  rough: 0x2f7a36,
  deep_rough: 0x1f5f2c,
  sand: 0xd7c48a,
  waste_area: 0x9f8153,
  water: 0x2b7bbb,
  wetland: 0x477b68,
  green: 0x5dbb6a,
  tee: 0x8b6b4f,
  path: 0x8f8f8f,
};

// Legacy/error fallback shading; normal parkland rendering uses authored art.
const EDGE_DARKEN = 0.88;

const MARKER_LABEL = "hole-marker";
const ROUTE_LABEL = "route-overlay";
const ESTATE_LABEL = "estate-overlay";

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 8;
const ROTATE_TWEEN_MS = 250;
const KEY_PAN_SPEED = 900; // screen px/sec at zoom 1

const SCENIC_COLORS: Record<NonNullable<Course["theme"]>, {
  base: number;
  ocean: number;
  road: number;
  seam: number;
  hedge: number;
  patches: Record<ScenicPatchKind, number>;
}> = {
  parkland: {
    base: 0x356a3b, ocean: 0x2d769d, road: 0xa39982, seam: 0x496f3f, hedge: 0x244f2c,
    patches: { meadow: 0x427b45, field: 0x71864c, wood: 0x285833, scrub: 0x3b7040, dune: 0xbaa977, wash: 0x6d7550 },
  },
  links: {
    base: 0x65733e, ocean: 0x225782, road: 0x938c78, seam: 0x7d7a44, hedge: 0x46572d,
    patches: { meadow: 0x738047, field: 0x8b8852, wood: 0x44552f, scrub: 0x77763e, dune: 0xcbbd8c, wash: 0x837b55 },
  },
  desert: {
    base: 0xa77e4f, ocean: 0x3a9ec2, road: 0x8c704f, seam: 0x9a7045, hedge: 0x695638,
    patches: { meadow: 0x8c844a, field: 0xa58b58, wood: 0x6d663b, scrub: 0x8d7445, dune: 0xc49a61, wash: 0x8b6243 },
  },
};

// Dev-only logging, quiet by default (ZKU-85 convention).
const DEV_LOG = false;
function devLog(...args: unknown[]) {
  if (import.meta.env.DEV && DEV_LOG) console.log("[PixiStage]", ...args);
}

function darken(color: number, factor: number): number {
  const r = Math.round(((color >> 16) & 0xff) * factor);
  const g = Math.round(((color >> 8) & 0xff) * factor);
  const b = Math.round((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

/** Shade a color: factor < 1 darkens, factor > 1 lerps toward white. */
function shade(color: number, factor: number): number {
  if (factor <= 1) return darken(color, factor);
  const t = Math.min(1, factor - 1);
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const lerp = (c: number) => Math.round(c + (255 - c) * t);
  return (lerp(r) << 16) | (lerp(g) << 8) | lerp(b);
}

// Cliff face colors (exposed earth), lit by the fixed NW sun: the SW-facing
// (screen lower-left) face sits in shadow, the SE-facing face catches more.

/** Draw the heron (ZKU-156): a stilt-legged shoreline bird, ~24px tall. */
function drawHeron(g: PIXI.Graphics, flying: boolean): void {
  g.clear();
  const body = 0x8a99a8;
  const dark = 0x5a6672;
  if (!flying) {
    // Legs
    g.moveTo(-1.5, 0);
    g.lineTo(-1.5, -7);
    g.moveTo(1.5, 0);
    g.lineTo(1.8, -7);
    g.stroke({ width: 1, color: dark });
  }
  // Body
  g.ellipse(0, -10, 4.4, 2.8);
  g.fill(body);
  g.stroke({ width: 1, color: dark });
  if (flying) {
    // Spread wings
    g.moveTo(-2, -11);
    g.quadraticCurveTo(-9, -16, -12, -13);
    g.moveTo(2, -11);
    g.quadraticCurveTo(9, -17, 12, -14);
    g.stroke({ width: 1.6, color: dark });
  }
  // Neck + head + beak
  g.moveTo(2.5, -11.5);
  g.quadraticCurveTo(4.5, -14, 4, -17);
  g.stroke({ width: 1.4, color: body });
  g.circle(4, -17.5, 1.7);
  g.fill(body);
  g.stroke({ width: 0.8, color: dark });
  g.moveTo(5.5, -17.5);
  g.lineTo(8.5, -16.8);
  g.stroke({ width: 1, color: 0xe8c15a });
}

/**
 * Build a thought-bubble display object (ZKU-155): rounded white bubble +
 * tail dots + a comic icon. Lives in the screen overlay at fixed screen
 * size, so it reads at every zoom and rotation. Origin (0,0) is the anchor
 * point just above the golfer's head; the bubble body floats above it.
 */
function buildEmoteBubble(kind: EmoteKind): PIXI.Container {
  const c = new PIXI.Container();
  const g = new PIXI.Graphics();
  // Tail dots walking up toward the bubble body.
  g.circle(-5, -2, 1.6);
  g.fill({ color: 0xffffff, alpha: 0.95 });
  g.stroke({ width: 1, color: 0x4a4a40, alpha: 0.9 });
  g.circle(-8, -7, 2.4);
  g.fill({ color: 0xffffff, alpha: 0.95 });
  g.stroke({ width: 1, color: 0x4a4a40, alpha: 0.9 });
  // Body.
  g.roundRect(-16, -38, 32, 26, 9);
  g.fill({ color: 0xffffff, alpha: 0.96 });
  g.stroke({ width: 1.5, color: 0x4a4a40, alpha: 0.95 });
  c.addChild(g);

  const icon = new PIXI.Graphics();
  const cy = -25; // icon center inside the body
  switch (kind) {
    case "star":
      icon.star(0, cy, 5, 9, 4.2);
      icon.fill(0xe8c15a);
      icon.stroke({ width: 1, color: 0x8a6d2a });
      break;
    case "happy":
    case "angry": {
      const face = kind === "happy" ? 0xffd75e : 0xef8354;
      icon.circle(0, cy, 8);
      icon.fill(face);
      icon.stroke({ width: 1, color: 0x8a6d2a });
      icon.circle(-2.8, cy - 2, 1.2);
      icon.circle(2.8, cy - 2, 1.2);
      icon.fill(0x4a3b1e);
      // moveTo first: arc() would otherwise connect from the last path
      // point (the eye), drawing a stray line through the face.
      if (kind === "happy") {
        const a0 = Math.PI * 0.15;
        icon.moveTo(4.2 * Math.cos(a0), cy + 0.5 + 4.2 * Math.sin(a0));
        icon.arc(0, cy + 0.5, 4.2, a0, Math.PI * 0.85);
      } else {
        const a0 = Math.PI * 1.2;
        icon.moveTo(4.2 * Math.cos(a0), cy + 6 + 4.2 * Math.sin(a0));
        icon.arc(0, cy + 6, 4.2, a0, Math.PI * 1.8);
      }
      icon.stroke({ width: 1.4, color: 0x4a3b1e });
      break;
    }
    case "storm":
      icon.circle(-4, cy - 1, 4.4);
      icon.circle(1.5, cy - 3, 5);
      icon.circle(5.5, cy, 3.6);
      icon.fill(0x6b7280);
      icon.stroke({ width: 1, color: 0x3f4650 });
      icon.poly([1.5, cy + 2, -1.5, cy + 7, 0.5, cy + 7, -1.5, cy + 12, 3.5, cy + 6, 1.5, cy + 6, 3.5, cy + 2]);
      icon.fill(0xffd75e);
      break;
    default: {
      // Text glyphs: Zz / $ / !
      const style: Partial<PIXI.TextStyle> = {
        fontFamily: "Arial, sans-serif",
        fontWeight: "900",
        fontSize: kind === "zzz" ? 13 : 16,
        fill:
          kind === "cashGood" ? 0x2f8a4a : kind === "cashBad" ? 0xc0392b : kind === "alert" ? 0xc0392b : 0x4a5568,
      };
      const text = new PIXI.Text({
        text: kind === "zzz" ? "Zz" : kind === "alert" ? "!" : "$",
        style: style as PIXI.TextStyle,
      });
      text.anchor.set(0.5);
      text.position.set(0, cy);
      c.addChild(text);
      break;
    }
  }
  c.addChild(icon);
  return c;
}

export interface PixiStageProps {
  course: Course;
  holes: Hole[];
  obstacles: Obstacle[];
  activeHoleIndex: number;
  activePath?: Point[];
  activeShotPlan?: ShotPlanStep[];
  selectedTeeSet?: TeeSet;
  tileSize: number;
  showGridOverlays: boolean;
  surveyMode?: boolean;
  selectedParcelId?: string | null;
  architectureWarnings?: ArchitectureWarning[];
  architectureOverlay?: ArchitectureOverlayRender | null;
  paceBottlenecks?: PaceAdvisorFinding[];
  animationsEnabled: boolean;
  graphicsQuality: "high" | "medium" | "low";
  ambienceFx: boolean;
  waterAnimation: boolean;
  treeSway: boolean;
  resolutionScale: number;
  worldSeed: number;
  cameraSmoothing: boolean;
  edgeScroll: boolean;
  edgeScrollSpeed: number;
  colorVision: ColorVisionMode;
  terrainPatterns: boolean;
  keybindings: Keybindings;
  flyoverNonce: number;
  showShotPlan: boolean;
  editorMode: "PAINT" | "HOLE_WIZARD" | "OBSTACLE" | "SCULPT" | "BUILDING" | "DECOR";
  selectedDecorationKind?: DecorationKind;
  decorationRotation?: DecorationRotation;
  decorationSpan?: number;
  sculptRadius?: number;
  wizardStep: "TEE" | "GREEN" | "CONFIRM" | "MOVE_TEE" | "MOVE_GREEN";
  draftTee: Point | null;
  draftGreen: Point | null;
  onClickTile: (x: number, y: number) => void;
  onPreviewTerrainStroke?: (points: Point[]) => TerrainStrokePreview;
  onCommitTerrainStroke?: (points: Point[]) => void;
  selectedTerrain?: Terrain;
  worldCash?: number;
  flagColor?: string;
  cameraState?: CameraState | null;
  showFixOverlay?: boolean;
  failingCorridorSegments?: Point[];
  onCameraUpdate?: (camera: CameraState) => void;
  /** Debounced world-space center used by camera-aware systems such as audio. */
  onCameraCenter?: (center: Point) => void;
  /** Throttled pan/zoom/rotation telemetry for the north-up minimap. */
  onViewChange?: (view: IsoCameraSnapshot) => void;
  /** Imperative camera destination from minimap click-to-jump. */
  cameraJump?: { center: Point; nonce: number } | null;
  showObstacles?: boolean;
  showGolfers?: boolean;
  showMarkers?: boolean;
  golfersRef?: React.RefObject<GolferRenderData[]>;
  liveActive?: boolean;
  onPickGolfer?: (id: number | null) => void;
  selectedGolferId?: number | null;
  followSelected?: boolean;
  /** Live game-clock minute (0..840) driving ambient time-of-day effects. */
  dayMinute?: number;
  resortOperations?: ResortOperations;
  /** M36 direct-play overlay and input seam. */
  playerRound?: PlayerPlayableRound | null;
  playerShotAim?: PlayerProPoint | null;
  playableShotMode?: boolean;
}

function resampleWorldLine(from: Point, to: Point, step = 0.25): Point[] {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  if (distance < 0.04) return [];
  const divisions = Math.max(1, Math.ceil(distance / step));
  return Array.from({ length: divisions }, (_, index) => {
    const t = (index + 1) / divisions;
    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    };
  });
}

interface Layers {
  world: PIXI.Container;
  surround: PIXI.Container;
  terrain: PIXI.Container;
  smoothSurfaces: PIXI.Container;
  estateSeam: PIXI.Container;
  terrainDecals: PIXI.Container;
  objects: PIXI.Container;
  fx: PIXI.Container;
  screenOverlay: PIXI.Container;
}

/**
 * Pooled per-golfer render objects (ZKU-153). Two tiers, chosen once at
 * creation: animated character sprites when the golfers atlas is loaded
 * (shadow + base sprite + tinted clothing twin + selection ring), or the
 * legacy colored dot when it isn't.
 */
interface GolferEntry {
  holder: PIXI.Container;
  ball: PIXI.Graphics;
  /** Ground shadow that tracks the ball's ground path (ZKU-154). */
  ballShadow: PIXI.Graphics;
  lastBall: { x: number; y: number } | null;
  /** Previous airborne ball screen position, for the motion trail. */
  prevBallIso: { x: number; y: number } | null;
  /** Touchdown FX already fired for the current flight. */
  ballLanded: boolean;
  /** Edge-trigger state for emote bubbles (ZKU-155). */
  emote: {
    lastScored: number;
    prevMood: number;
    feeChecked: boolean;
    lastPos: { x: number; y: number };
    stillSinceMs: number;
  };
  sprite: {
    shadow: PIXI.Graphics;
    ring: PIXI.Graphics;
    base: PIXI.Sprite;
    tintLayer: PIXI.Sprite;
    variant: number;
    tint: number;
    /** Last applied atlas frame, to skip redundant texture swaps. */
    lastFrame: string;
    /** Accumulated stride cycles (advanced by ground distance walked). */
    walkPhase: number;
    lastPos: { x: number; y: number } | null;
    /** Last non-zero facing, world space (survives pauses/rotation). */
    dirX: number;
    dirY: number;
    reaction: GolferReaction | null;
    reactionUntil: number;
    lastScored: number;
  } | null;
  dot: {
    body: PIXI.Graphics;
    lastColor: string;
    lastMoodBucket: number;
  } | null;
}

/**
 * Chunked terrain (ZKU-142): the map is partitioned into CHUNK_TILES²-tile
 * chunks, each a static container rebuilt only when one of its tiles (or a
 * bordering tile — shading/cliffs read neighbors) changes, and culled when
 * outside the viewport. Chunk containers are added to the terrain layer in
 * back-to-front order for the current rotation.
 *
 * Note: the issue offered RenderTexture baking (cacheAsTexture) as an
 * option; deferred for now — a cached texture goes blurry past its bake
 * resolution at high zoom, and flat-tinted sprites batch into one draw
 * call anyway. Revisit with real numbers in ZKU-160 once the M10 art pass
 * multiplies per-tile sprite count.
 */
const CHUNK_TILES = 16;
const CHUNK_DEBUG = false; // dev flag: chunk borders + rebuild logging

interface TerrainChunk {
  container: PIXI.Container;
  /** Iso-plane pixel bounds (elevation headroom included) for culling. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Animated water tiles in this chunk (ZKU-150): shimmer via throttled
   * tint oscillation, so static chunk contents stay untouched. */
  waterSprites: Array<{ sprite: PIXI.Sprite; baseTint: number; phase: number; gx: number; gy: number }>;
  /** Shore-foam lips on water tiles along land edges, alpha-oscillated. */
  foamSprites: Array<{ sprite: PIXI.Sprite; phase: number }>;
  groundCoverSprites: Array<{ graphic: PIXI.Graphics; tier: 1 | 2 }>;
}

/** Fit zoom for a world-tile bbox projected to the iso plane. */
function fitZoomForTileBounds(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  screenW: number,
  screenH: number,
  rotation: IsoRotation
): number {
  const corners = [
    worldToIso(minX, minY, 0, rotation),
    worldToIso(maxX + 1, minY, 0, rotation),
    worldToIso(maxX + 1, maxY + 1, 0, rotation),
    worldToIso(minX, maxY + 1, 0, rotation),
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  if (w <= 0 || h <= 0 || screenW <= 0 || screenH <= 0) return 1;
  const zoom = Math.min((screenW * 0.95) / w, (screenH * 0.95) / h);
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

export function PixiStage(props: PixiStageProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const layersRef = useRef<Layers | null>(null);
  const [appReady, setAppReady] = useState(false);

  const diamondTextureRef = useRef<PIXI.Texture | null>(null);
  const chunksRef = useRef<TerrainChunk[]>([]);
  const prevTilesRef = useRef<Terrain[] | null>(null);
  const prevElevationsRef = useRef<number[] | null>(null);
  const builtRotationRef = useRef<IsoRotation | null>(null);
  const chunkRebuildsRef = useRef(0);
  const obstacleSpritesRef = useRef<
    Map<string, {
      sprite: PIXI.Sprite;
      shadow: PIXI.Graphics;
      swayPhase: number | null;
      sway: NaturalPropVariant["sway"];
      tall: boolean;
      fadeAlpha: number;
    }>
  >(new Map());
  const hoverLineRef = useRef<PIXI.Graphics | null>(null);
  const hoverHighlightRef = useRef<PIXI.Graphics | null>(null);
  const flagPoolRef = useRef<Map<number, PIXI.Graphics>>(new Map());
  const buildingSpritesRef = useRef<PIXI.Sprite[]>([]);
  const propertyGraphicsRef = useRef<PIXI.Graphics[]>([]);
  const playerShotOverlayRef = useRef<PIXI.Container | null>(null);
  const decorationSpritesRef = useRef<Array<{ sprite: PIXI.Sprite; shadow: PIXI.Graphics }>>([]);
  const waterAnimRef = useRef({ last: 0, wasAnimating: false });
  const surfaceWaterSpritesRef = useRef<Array<{
    sprite: PIXI.Sprite;
    baseTint: number;
    phase: number;
    gx: number;
    gy: number;
  }>>([]);
  const ripplesRef = useRef<Array<{ x: number; y: number; t0: number }>>([]);
  const rippleGraphicsRef = useRef<PIXI.Graphics | null>(null);
  // Touchdown particle bursts (ZKU-154): sand puffs, grass flecks, green
  // check ticks. Tile coords + elevation so rotation re-projects them.
  const impactsRef = useRef<Array<{ kind: "sand" | "grass" | "check"; x: number; y: number; e: number; t0: number }>>([]);
  // Emote bubbles (ZKU-155): scheduler decides what shows, the map holds
  // the screen-overlay display objects per golfer.
  const emoteSchedulerRef = useRef(createEmoteScheduler());
  const emoteSpritesRef = useRef<Map<number, PIXI.Container>>(new Map());
  const simMovingAtRef = useRef(0);
  // Ambient world life (ZKU-156): clouds/shimmer in the world fx layer, a
  // multiply tint quad + bird layer between world and UI overlay. The
  // "coursecraft_ambience" localStorage flag is polled ~1/s.
  const ambientRef = useRef<{
    clouds: PIXI.Sprite[];
    tintQuad: PIXI.Sprite | null;
    birdG: PIXI.Graphics | null;
    shimmer: PIXI.Sprite | null;
    heron: {
      g: PIXI.Graphics | null;
      spot: Point | null;
      forCourse: Course | null;
      state: "standing" | "flying" | "gone";
      flyT0: number;
      respawnAt: number;
    };
    tintCur: { r: number; g: number; b: number };
    clockMin: number;
    prevDayMinute: number | null;
    enabled: boolean;
    lastPollMs: number;
  }>({
    clouds: [],
    tintQuad: null,
    birdG: null,
    shimmer: null,
    heron: { g: null, spot: null, forCourse: null, state: "standing", flyT0: 0, respawnAt: 0 },
    tintCur: { r: 255, g: 255, b: 255 },
    clockMin: 0,
    prevDayMinute: null,
    enabled: true,
    lastPollMs: 0,
  });
  const dayMinuteRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    dayMinuteRef.current = props.dayMinute;
  });
  // Perf HUD (ZKU-160): rolling frame stats + per-section timings, enabled
  // via localStorage "coursecraft_perfhud" = "on" (see README dev section).
  const perfRef = useRef<{
    win: PerfWindow;
    enabled: boolean;
    lastPollMs: number;
    lastHudMs: number;
    text: PIXI.Text | null;
    sections: Record<string, number>;
  }>({ win: new PerfWindow(180), enabled: false, lastPollMs: 0, lastHudMs: 0, text: null, sections: {} });
  const golferPoolRef = useRef<Map<number, GolferEntry>>(new Map());
  const hoverTileRef = useRef<{ x: number; y: number } | null>(null);
  const overlayDirtyRef = useRef(false);

  // Free camera (ZKU-141): current values lerp toward targets each frame.
  // Center is in world tile coordinates so it survives rotation changes.
  const [rotation, setRotation] = useState<IsoRotation>(0);
  // Cinematic hole flyover (ZKU-157): keyframes + the camera state to
  // restore on finish/skip; the card is the only chrome shown meanwhile.
  const flyoverRef = useRef<{
    keys: FlyoverKey[];
    t0: number;
    saved: { cx: number; cy: number; zoom: number };
  } | null>(null);
  const [flyoverCard, setFlyoverCard] = useState<{ hole: number; par: number; yards: number } | null>(null);
  const [rendererError, setRendererError] = useState(false);
  const [terrainStrokePreview, setTerrainStrokePreview] = useState<TerrainStrokePreview | null>(null);
  const terrainStrokePreviewRef = useRef<TerrainStrokePreview | null>(null);
  const terrainStrokeRef = useRef<{
    pointerId: number;
    points: Point[];
    last: Point;
  } | null>(null);
  const camRef = useRef({ cx: 0, cy: 0, zoom: 1, tcx: 0, tcy: 0, tzoom: 1, initialized: false });
  const rotTweenRef = useRef<{ start: number; toDeg: number; next: IsoRotation } | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const lastReportedCameraStateRef = useRef<CameraState | null>(null);
  const lastAmbientReportAtRef = useRef(0);
  const lastCameraStateRef = useRef<CameraState | null | undefined>(undefined);

  const {
    course,
    holes,
    obstacles,
    activeHoleIndex,
    activePath,
    tileSize,
    onClickTile,
    onPreviewTerrainStroke,
    onCommitTerrainStroke,
    selectedTerrain,
    worldCash,
    editorMode,
    wizardStep,
    draftTee,
    draftGreen,
    cameraState,
    showShotPlan,
    showFixOverlay,
    failingCorridorSegments,
    golfersRef,
    liveActive,
    onPickGolfer,
    onViewChange,
  } = props;

  // ---------------------------------------------------------------------
  // Camera: world container transform + screen↔world mapping
  // ---------------------------------------------------------------------

  const clampCenter = useCallback(
    (x: number, y: number, zoom = camRef.current.tzoom): Point => {
      const app = appRef.current;
      if (!app || zoom <= 0) {
        return clampScenicCameraCenter(
          { x, y }, course.width, course.height,
          SCENIC_CAMERA_MARGIN_TILES, SCENIC_CAMERA_MARGIN_TILES,
        );
      }
      const centerIso = worldToIso(0, 0, 0, rotation);
      const halfW = app.screen.width / (2 * zoom);
      const halfH = app.screen.height / (2 * zoom);
      const corners = [
        isoToWorld(centerIso.x - halfW, centerIso.y - halfH, rotation),
        isoToWorld(centerIso.x + halfW, centerIso.y - halfH, rotation),
        isoToWorld(centerIso.x + halfW, centerIso.y + halfH, rotation),
        isoToWorld(centerIso.x - halfW, centerIso.y + halfH, rotation),
      ];
      const visibleX = Math.max(...corners.map((point) => Math.abs(point.x)));
      const visibleY = Math.max(...corners.map((point) => Math.abs(point.y)));
      // At close zoom the estate edge remains in frame; overview zoom earns
      // the full regional margin without allowing the course to become lost.
      return clampScenicCameraCenter(
        { x, y }, course.width, course.height,
        visibleX * 0.72, visibleY * 0.72,
      );
    },
    [course.width, course.height, rotation]
  );

  /** Frustum culling: hide chunks whose iso-plane bounds miss the viewport. */
  const cullChunks = useCallback(() => {
    const app = appRef.current;
    const layers = layersRef.current;
    if (!app || !layers) return;
    const { world } = layers;
    // During the rotation tween the transform is a screen-space rotation the
    // bounds don't model — show everything until it snaps.
    if (world.rotation !== 0) {
      for (const chunk of chunksRef.current) chunk.container.visible = true;
      return;
    }
    const halfW = app.screen.width / 2 / world.scale.x;
    const halfH = app.screen.height / 2 / world.scale.y;
    const left = world.pivot.x - halfW;
    const right = world.pivot.x + halfW;
    const top = world.pivot.y - halfH;
    const bottom = world.pivot.y + halfH;
    let visible = 0;
    for (const chunk of chunksRef.current) {
      const v = chunk.maxX >= left && chunk.minX <= right && chunk.maxY >= top && chunk.minY <= bottom;
      chunk.container.visible = v;
      const requestedTier = visibleGroundCoverTier(world.scale.x, props.resolutionScale);
      const coverTier = props.graphicsQuality === "high"
        ? requestedTier
        : props.graphicsQuality === "medium"
          ? Math.min(1, requestedTier) as 0 | 1
          : 0;
      for (const cover of chunk.groundCoverSprites) cover.graphic.visible = v && cover.tier <= coverTier;
      if (v) visible++;
    }
    if (CHUNK_DEBUG) devLog(`chunks visible: ${visible}/${chunksRef.current.length}`);
  }, [props.graphicsQuality, props.resolutionScale]);

  /** Push the camera's CURRENT values into the world container transform. */
  const applyCamera = useCallback(() => {
    const app = appRef.current;
    const layers = layersRef.current;
    if (!app || !layers) return;
    const { world } = layers;
    const cam = camRef.current;
    const centerIso = worldToIso(cam.cx, cam.cy, 0, rotation);
    // Pivot at the camera center so the rotation tween spins around the view
    // center; position pins the pivot to the screen center.
    world.pivot.set(centerIso.x, centerIso.y);
    world.position.set(app.screen.width / 2, app.screen.height / 2);
    world.scale.set(cam.zoom);
    cullChunks();
  }, [rotation, cullChunks]);

  /** Keep the estate legible on very large/ultrawide displays while still
   * allowing a generous overview ring around it. */
  const minimumZoom = useCallback((): number => {
    const app = appRef.current;
    if (!app) return MIN_ZOOM;
    const estateFit = fitZoomForTileBounds(
      0, 0, course.width - 1, course.height - 1,
      app.screen.width, app.screen.height, rotation,
    );
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, estateFit * 0.62));
  }, [course.width, course.height, rotation]);

  /** Default whole-course fit (used at init and when no CameraState). */
  const fitWholeCourse = useCallback(
    (snap: boolean) => {
      const app = appRef.current;
      if (!app) return;
      const cam = camRef.current;
      cam.tcx = course.width / 2;
      cam.tcy = course.height / 2;
      cam.tzoom = fitZoomForTileBounds(
        0, 0, course.width - 1, course.height - 1,
        app.screen.width, app.screen.height, rotation
      );
      if (snap) {
        cam.cx = cam.tcx;
        cam.cy = cam.tcy;
        cam.zoom = cam.tzoom;
      }
      applyCamera();
    },
    [course.width, course.height, rotation, applyCamera]
  );

  /** End (or skip) the flyover: restore the exact pre-flyover camera. */
  const endFlyover = useCallback(() => {
    const f = flyoverRef.current;
    if (!f) return;
    const cam = camRef.current;
    cam.tcx = f.saved.cx;
    cam.tcy = f.saved.cy;
    cam.tzoom = f.saved.zoom;
    flyoverRef.current = null;
    setFlyoverCard(null);
  }, []);

  // Flyover trigger: the shared flyoverNonce contract (HUD button, wizard
  // confirm, hole inspector). Needs a complete active hole.
  useEffect(() => {
    if (!appReady || props.flyoverNonce === 0) return;
    const app = appRef.current;
    // Wizard confirm advances the active hole before this effect runs, so
    // fall back to the previous (just-confirmed) hole when the active one
    // is still empty.
    let holeIndex = activeHoleIndex;
    let hole = holes[holeIndex];
    if ((!hole?.tee || !hole?.green) && holeIndex > 0) {
      holeIndex = activeHoleIndex - 1;
      hole = holes[holeIndex];
    }
    if (!app || !hole?.tee || !hole?.green) return;
    const tee = hole.tee;
    const green = hole.green;
    const cam = camRef.current;
    // Frame the whole hole for the wide shots; tighten for the green.
    const minX = Math.min(tee.x, green.x) - 5;
    const maxX = Math.max(tee.x, green.x) + 5;
    const minY = Math.min(tee.y, green.y) - 5;
    const maxY = Math.max(tee.y, green.y) + 5;
    const wide = fitZoomForTileBounds(minX, minY, maxX, maxY, app.screen.width, app.screen.height, rotation);
    const tight = Math.min(MAX_ZOOM * 0.6, Math.max(wide * 2.4, wide + 0.4));
    const corridor = (props.activeShotPlan ?? []).map((s) => s.to);
    flyoverRef.current = {
      keys: buildFlyoverKeys(tee, green, corridor, wide, tight),
      t0: performance.now(),
      // A re-trigger mid-flyover keeps the original pre-flyover camera.
      saved: flyoverRef.current?.saved ?? { cx: cam.tcx, cy: cam.tcy, zoom: cam.tzoom },
    };
    const distTiles = computeHoleDistanceTiles(tee, green);
    const autoPar = computeAutoPar(distTiles);
    setFlyoverCard({
      hole: holeIndex + 1,
      par: hole.parMode === "MANUAL" ? hole.parManual ?? autoPar : autoPar,
      yards: Math.round(distTiles * (course.yardsPerTile ?? 10)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.flyoverNonce, appReady]);

  /**
   * Inverse camera transform: global pointer coords → integer tile, or null.
   * Elevation-aware: tests elevation levels front-to-back so a raised tile's
   * visible top wins over the tile geometrically behind it at base level.
   */
  const screenToIsoPlane = useCallback((globalX: number, globalY: number): Point | null => {
    const world = layersRef.current?.world;
    if (!world) return null;
    return {
      x: (globalX - world.position.x) / world.scale.x + world.pivot.x,
      y: (globalY - world.position.y) / world.scale.y + world.pivot.y,
    };
  }, []);

  const reportView = useCallback(() => {
    const app = appRef.current;
    const cam = camRef.current;
    if (!app || !onViewChange || cam.zoom <= 0) return;
    const centerIso = worldToIso(cam.cx, cam.cy, 0, rotation);
    const halfW = app.screen.width / (2 * cam.zoom);
    const halfH = app.screen.height / (2 * cam.zoom);
    const corners = [
      isoToWorld(centerIso.x - halfW, centerIso.y - halfH, rotation),
      isoToWorld(centerIso.x + halfW, centerIso.y - halfH, rotation),
      isoToWorld(centerIso.x + halfW, centerIso.y + halfH, rotation),
      isoToWorld(centerIso.x - halfW, centerIso.y + halfH, rotation),
    ];
    onViewChange({
      center: { x: cam.cx, y: cam.cy },
      zoom: cam.zoom,
      rotation,
      bounds: {
        minX: Math.max(0, Math.min(...corners.map((p) => p.x))),
        minY: Math.max(0, Math.min(...corners.map((p) => p.y))),
        maxX: Math.min(course.width - 1, Math.max(...corners.map((p) => p.x))),
        maxY: Math.min(course.height - 1, Math.max(...corners.map((p) => p.y))),
      },
    });
  }, [course.height, course.width, onViewChange, rotation]);

  useEffect(() => {
    if (!appReady || !props.cameraJump) return;
    const cam = camRef.current;
    const next = clampCenter(props.cameraJump.center.x, props.cameraJump.center.y);
    cam.tcx = next.x;
    cam.tcy = next.y;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appReady, props.cameraJump?.nonce]);

  const screenToTile = useCallback(
    (globalX: number, globalY: number): { x: number; y: number } | null => {
      const iso = screenToIsoPlane(globalX, globalY);
      if (!iso) return null;
      for (let e = ELEVATION_MAX; e >= 0; e--) {
        const t = isoToTile(iso.x, iso.y + e * ELEVATION_STEP_PX, rotation);
        if (t.x < 0 || t.y < 0 || t.x >= course.width || t.y >= course.height) continue;
        if (getElevation(course, t.x, t.y) === e) return t;
      }
      return null;
    },
    [course, rotation, screenToIsoPlane]
  );

  /**
   * Elevation-aware continuous world position for terrain gestures. Tile
   * picking remains integer-based elsewhere, but authoring must retain
   * sub-tile motion and revisit order so loops can close and fill correctly.
   */
  const screenToWorldPoint = useCallback(
    (globalX: number, globalY: number): Point | null => {
      const iso = screenToIsoPlane(globalX, globalY);
      const tile = screenToTile(globalX, globalY);
      if (!iso || !tile) return null;
      const elevation = getElevation(course, tile.x, tile.y);
      const point = isoToWorld(iso.x, iso.y + elevation * ELEVATION_STEP_PX, rotation);
      return {
        x: Math.max(0, Math.min(course.width - 1e-6, point.x)),
        y: Math.max(0, Math.min(course.height - 1e-6, point.y)),
      };
    },
    [course, rotation, screenToIsoPlane, screenToTile],
  );

  /** Continuous world tile coords → global screen coords (for screen overlays). */
  const worldPointToScreen = useCallback(
    (wx: number, wy: number, elevation = 0): { x: number; y: number } => {
      const world = layersRef.current?.world;
      if (!world) return { x: 0, y: 0 };
      const p = worldToIso(wx, wy, elevation, rotation);
      return {
        x: world.position.x + (p.x - world.pivot.x) * world.scale.x,
        y: world.position.y + (p.y - world.pivot.y) * world.scale.y,
      };
    },
    [rotation]
  );

  // ---------------------------------------------------------------------
  // App lifecycle
  // ---------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    // These ref objects are stable for the app's lifetime.
    const emoteSprites = emoteSpritesRef.current;
    const ambient = ambientRef.current;
    const perfState = perfRef.current;

    const app = new PIXI.Application();
    setRendererError(false);

    const init = async () => {
      const width = Math.max(container.clientWidth || 800, 100);
      const height = Math.max(container.clientHeight || 600, 100);

      await app.init({
        width,
        height,
        backgroundColor: 0xdfe8d8, // soft parchment-green backdrop
        antialias: true,
        resolution: (window.devicePixelRatio || 1) * props.resolutionScale,
        autoDensity: true,
      });

      if (cancelled) {
        app.destroy(true, { children: true, texture: true });
        return;
      }

      await loadAtlases(); // tolerant: missing atlas → procedural fallbacks

      app.canvas.style.display = "block";
      app.canvas.style.position = "absolute";
      app.canvas.style.top = "0";
      app.canvas.style.left = "0";
      container.appendChild(app.canvas);

      // Shared white diamond texture, tinted per terrain.
      const g = new PIXI.Graphics();
      g.poly([TILE_W / 2, 0, TILE_W, TILE_H / 2, TILE_W / 2, TILE_H, 0, TILE_H / 2]);
      g.fill(0xffffff);
      g.stroke({ width: 1, color: 0xffffff, alpha: 0.35 });
      diamondTextureRef.current = app.renderer.generateTexture(g);
      g.destroy();

      // Build the layer tree (see header comment for architecture).
      const world = new PIXI.Container();
      const surround = new PIXI.Container();
      const terrain = new PIXI.Container();
      const smoothSurfaces = new PIXI.Container();
      const estateSeam = new PIXI.Container();
      const terrainDecals = new PIXI.Container();
      const objects = new PIXI.Container();
      objects.sortableChildren = true;
      const fx = new PIXI.Container();
      const screenOverlay = new PIXI.Container();

      world.addChild(surround, terrain, smoothSurfaces, estateSeam, terrainDecals, objects, fx);

      // Ambient stack (ZKU-156): a full-screen multiply quad for the
      // time-of-day grade and a screen-space bird layer, both between the
      // world and the UI overlay.
      const tintQuad = new PIXI.Sprite(PIXI.Texture.WHITE);
      tintQuad.blendMode = "multiply";
      tintQuad.visible = false;
      const birdG = new PIXI.Graphics();
      app.stage.addChild(world, tintQuad, birdG, screenOverlay);
      ambientRef.current.tintQuad = tintQuad;
      ambientRef.current.birdG = birdG;

      // Soft radial blob texture for cloud shadows / the shimmer band.
      const cvs = document.createElement("canvas");
      cvs.width = 256;
      cvs.height = 256;
      const ctx = cvs.getContext("2d");
      if (ctx) {
        const grad = ctx.createRadialGradient(128, 128, 20, 128, 128, 126);
        grad.addColorStop(0, "rgba(255,255,255,1)");
        grad.addColorStop(0.65, "rgba(255,255,255,0.55)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 256, 256);
        const blobTex = PIXI.Texture.from(cvs);
        for (let i = 0; i < CLOUD_COUNT; i++) {
          const cloud = new PIXI.Sprite(blobTex);
          cloud.anchor.set(0.5);
          cloud.tint = 0x0a1408; // near-black, green-leaning shade
          cloud.alpha = 0.07;
          cloud.scale.set(3.6 + i * 0.9, 1.9 + i * 0.5); // squashed for iso
          cloud.visible = false;
          fx.addChild(cloud);
          ambientRef.current.clouds.push(cloud);
        }
        const shimmer = new PIXI.Sprite(blobTex);
        shimmer.anchor.set(0.5);
        shimmer.blendMode = "add";
        shimmer.tint = 0xfffbe8;
        shimmer.alpha = 0.05;
        shimmer.scale.set(7, 2.2);
        shimmer.visible = false;
        fx.addChild(shimmer);
        ambientRef.current.shimmer = shimmer;
      }
      // Heron perch graphic lives with depth-sorted objects.
      const heronG = new PIXI.Graphics();
      heronG.visible = false;
      objects.addChild(heronG);
      ambientRef.current.heron.g = heronG;

      app.stage.eventMode = "static";
      app.stage.hitArea = app.screen;

      appRef.current = app;
      layersRef.current = { world, surround, terrain, smoothSurfaces, estateSeam, terrainDecals, objects, fx, screenOverlay };
      setAppReady(true);
      devLog(`initialized ${width}x${height}`);
    };

    void init().catch((error: unknown) => {
      if (cancelled) return;
      console.error("[PixiStage] Course renderer initialization failed", error);
      setRendererError(true);
      try { app.destroy(true, { children: true, texture: true }); } catch { /* partially initialized */ }
    });

    return () => {
      cancelled = true;
      setAppReady(false);
      layersRef.current = null;
      chunksRef.current = [];
      prevTilesRef.current = null;
      prevElevationsRef.current = null;
      obstacleSpritesRef.current.clear();
      hoverLineRef.current = null;
      hoverHighlightRef.current = null;
      golferPoolRef.current.clear();
      flagPoolRef.current.clear();
      buildingSpritesRef.current = [];
      propertyGraphicsRef.current = [];
      playerShotOverlayRef.current = null;
      rippleGraphicsRef.current = null;
      ripplesRef.current = [];
      impactsRef.current = [];
      emoteSprites.clear();
      emoteSchedulerRef.current = createEmoteScheduler();
      ambient.clouds = [];
      ambient.tintQuad = null;
      ambient.birdG = null;
      ambient.shimmer = null;
      ambient.heron = { g: null, spot: null, forCourse: null, state: "standing", flyT0: 0, respawnAt: 0 };
      perfState.text = null;
      perfState.win.reset();
      waterAnimRef.current = { last: 0, wasAnimating: false };
      diamondTextureRef.current = null;
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: true });
        appRef.current = null;
      }
    };
  }, [props.resolutionScale]);

  // Resize with ResizeObserver
  useEffect(() => {
    if (!appReady) return;
    const container = containerRef.current;
    if (!container) return;

    const resize = () => {
      if (!appRef.current || !containerRef.current) return;
      const width = Math.max(containerRef.current.clientWidth || 100, 100);
      const height = Math.max(containerRef.current.clientHeight || 100, 100);
      appRef.current.renderer.resize(width, height);
      appRef.current.stage.hitArea = appRef.current.screen;
      const cam = camRef.current;
      const minZoom = minimumZoom();
      cam.tzoom = Math.max(minZoom, cam.tzoom);
      cam.zoom = Math.max(minZoom, cam.zoom);
      const center = clampCenter(cam.tcx, cam.tcy, cam.tzoom);
      cam.tcx = center.x;
      cam.tcy = center.y;
      applyCamera();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();
    return () => ro.disconnect();
  }, [appReady, applyCamera, clampCenter, minimumZoom]);

  // One-time camera init: snap to a whole-course fit.
  useEffect(() => {
    if (!appReady) return;
    const cam = camRef.current;
    if (!cam.initialized) {
      cam.initialized = true;
      fitWholeCourse(true);
    }
  }, [appReady, fitWholeCourse]);

  useEffect(() => {
    if (!appReady) return;
    reportView();
  }, [appReady, reportView]);

  // CameraState prop → glide targets. Skips echoes of centers we reported
  // ourselves so user pan/zoom isn't fought by the round-trip through App.
  useEffect(() => {
    if (!appReady) return;
    const app = appRef.current;
    const cam = camRef.current;
    if (!app || !cam.initialized) return;
    // Only react to an actual CameraState change; rotation changes re-run
    // this effect (dep for the bounds fit below) but must not re-target.
    if (lastCameraStateRef.current === cameraState) return;
    lastCameraStateRef.current = cameraState;

    if (!cameraState) {
      fitWholeCourse(false);
      return;
    }
    // App stores the exact object we report after manual input. Ignore that
    // identity echo, but never mistake a later explicit Fit command for one
    // merely because it happens to share the same center.
    if (lastReportedCameraStateRef.current === cameraState) return;

    cam.tcx = cameraState.center.x;
    cam.tcy = cameraState.center.y;
    const b = cameraState.bounds;
    if (b) {
      cam.tzoom = fitZoomForTileBounds(
        b.minX, b.minY, b.maxX, b.maxY,
        app.screen.width, app.screen.height, rotation
      );
    } else if (Number.isFinite(cameraState.zoom)) {
      cam.tzoom = Math.max(minimumZoom(), Math.min(MAX_ZOOM, cameraState.zoom));
    }
  }, [appReady, cameraState, rotation, fitWholeCourse, minimumZoom]);

  // Camera controls: wheel zoom-to-cursor, drag pan, WASD/QE, smoothing.
  useEffect(() => {
    if (!appReady) return;
    const app = appRef.current;
    const el = containerRef.current;
    if (!app || !el) return;

    const reportCamera = () => {
      const cam = camRef.current;
      const center = { x: cam.tcx, y: cam.tcy };
      props.onCameraCenter?.(center);
      if (!cameraState || !props.onCameraUpdate) return;
      const reported = {
        ...cameraState,
        center,
        zoom: cam.tzoom,
        // Manual camera ownership must not carry an auto-fit box that a later
        // state round-trip could reapply over the user's chosen zoom.
        bounds: undefined,
      };
      lastReportedCameraStateRef.current = reported;
      props.onCameraUpdate(reported);
    };

    const applyZoomInput = (deltaPixels: number, clientX: number, clientY: number) => {
      const cam = camRef.current;
      const rect = el.getBoundingClientRect();
      const gx = clientX - rect.left;
      const gy = clientY - rect.top;
      const target = nextWheelZoomTarget({
        camera: { cx: cam.tcx, cy: cam.tcy, zoom: cam.tzoom },
        cursor: { x: gx, y: gy },
        viewport: { width: app.screen.width, height: app.screen.height },
        deltaPixels,
        rotation,
        minZoom: minimumZoom(),
        maxZoom: MAX_ZOOM,
      });
      const clamped = clampCenter(target.cx, target.cy, target.zoom);
      cam.tcx = clamped.x;
      cam.tcy = clamped.y;
      cam.tzoom = target.zoom;
      overlayDirtyRef.current = true;
      reportCamera();
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (flyoverRef.current) {
        endFlyover(); // any input skips the flyover
        return;
      }
      applyZoomInput(
        normalizeWheelDelta(e.deltaY, e.deltaMode, app.screen.height),
        e.clientX,
        e.clientY,
      );
    };

    type SafariGestureEvent = Event & {
      scale?: number;
      clientX?: number;
      clientY?: number;
    };
    let gestureScale = 1;
    const handleGestureStart = (event: Event) => {
      event.preventDefault();
      const gesture = event as SafariGestureEvent;
      gestureScale = Number.isFinite(gesture.scale) && gesture.scale! > 0 ? gesture.scale! : 1;
      if (flyoverRef.current) endFlyover();
    };
    const handleGestureChange = (event: Event) => {
      event.preventDefault();
      if (flyoverRef.current) {
        endFlyover();
        return;
      }
      const gesture = event as SafariGestureEvent;
      const nextScale = Number.isFinite(gesture.scale) && gesture.scale! > 0 ? gesture.scale! : gestureScale;
      const rect = el.getBoundingClientRect();
      applyZoomInput(
        gestureScaleToWheelDelta(nextScale / gestureScale),
        gesture.clientX ?? rect.left + rect.width / 2,
        gesture.clientY ?? rect.top + rect.height / 2,
      );
      gestureScale = nextScale;
    };
    const handleGestureEnd = (event: Event) => {
      event.preventDefault();
      gestureScale = 1;
    };

    // Drag-to-pan with middle or right button (left stays editing).
    let panState: { gx: number; gy: number; cx: number; cy: number } | null = null;
    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 1 && e.button !== 2) return;
      e.preventDefault();
      if (flyoverRef.current) {
        endFlyover();
        return;
      }
      const cam = camRef.current;
      panState = { gx: e.clientX, gy: e.clientY, cx: cam.cx, cy: cam.cy };
      el.setPointerCapture(e.pointerId);
      el.style.cursor = "grabbing";
    };
    const handlePointerMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      pointerRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (!panState) return;
      const cam = camRef.current;
      const startIso = worldToIso(panState.cx, panState.cy, 0, rotation);
      const isoX = startIso.x - (e.clientX - panState.gx) / cam.zoom;
      const isoY = startIso.y - (e.clientY - panState.gy) / cam.zoom;
      const tile = isoToWorld(isoX, isoY, rotation);
      const clamped = clampCenter(tile.x, tile.y, cam.zoom);
      cam.cx = cam.tcx = clamped.x;
      cam.cy = cam.tcy = clamped.y;
      applyCamera();
      overlayDirtyRef.current = true;
    };
    const handlePointerUp = (e: PointerEvent) => {
      if (!panState) return;
      panState = null;
      el.releasePointerCapture?.(e.pointerId);
      el.style.cursor = "crosshair";
      reportCamera();
    };
    const handleContextMenu = (e: MouseEvent) => e.preventDefault();

    // Keyboard: WASD/arrows pan (held), Q/E rotate.
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement ||
      (t instanceof HTMLElement && t.isContentEditable);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const binding = bindingFromEvent(e);
      const panActions: BindingAction[] = ["panUp", "panDown", "panLeft", "panRight"];
      const panAction = panActions.find((action) => props.keybindings[action] === binding);
      if (flyoverRef.current) {
        if (e.code === "Escape" || panAction || binding === props.keybindings.rotateLeft || binding === props.keybindings.rotateRight) {
          endFlyover();
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        return;
      }
      if (panAction) {
        keysRef.current.add(panAction);
        e.preventDefault();
      } else if (!e.repeat && !rotTweenRef.current && (binding === props.keybindings.rotateLeft || binding === props.keybindings.rotateRight)) {
        const right = binding === props.keybindings.rotateRight;
        rotTweenRef.current = {
          start: performance.now(),
          toDeg: right ? -90 : 90,
          next: nextRotation(rotation, right ? 1 : -1),
        };
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const released = (["panUp", "panDown", "panLeft", "panRight"] as BindingAction[]).filter((action) => props.keybindings[action].endsWith(e.code));
      for (const action of released) keysRef.current.delete(action);
    };
    const handleBlur = () => keysRef.current.clear();
    const handlePointerLeave = () => { pointerRef.current = null; };

    // Per-frame: keyboard pan, target smoothing, rotation tween.
    const tickCamera = (ticker: PIXI.Ticker) => {
      const cam = camRef.current;
      const world = layersRef.current?.world;
      const dtMs = ticker.deltaMS;
      let moved = false;

      // Flyover (ZKU-157): drive the camera targets along the keyframes;
      // the smoothing below adds the final organic ease.
      const flyover = flyoverRef.current;
      if (flyover) {
        const t = (performance.now() - flyover.t0) / FLYOVER_DURATION_MS;
        if (t >= 1.08) {
          endFlyover();
        } else {
          const s = sampleFlyover(flyover.keys, t);
          const clamped = clampCenter(s.x, s.y, s.zoom);
          cam.tcx = clamped.x;
          cam.tcy = clamped.y;
          cam.tzoom = Math.max(minimumZoom(), Math.min(MAX_ZOOM, s.zoom));
          moved = true;
        }
      }

      // Keyboard pan in screen space → iso plane → tile space.
      const keys = keysRef.current;
      if (!flyover && keys.size > 0 && !rotTweenRef.current) {
        let dx = 0;
        let dy = 0;
        if (keys.has("panLeft")) dx -= 1;
        if (keys.has("panRight")) dx += 1;
        if (keys.has("panUp")) dy -= 1;
        if (keys.has("panDown")) dy += 1;
        if (dx !== 0 || dy !== 0) {
          const step = (KEY_PAN_SPEED * dtMs) / 1000 / cam.zoom;
          const centerIso = worldToIso(cam.tcx, cam.tcy, 0, rotation);
          const tile = isoToWorld(centerIso.x + dx * step, centerIso.y + dy * step, rotation);
          const clamped = clampCenter(tile.x, tile.y);
          cam.tcx = clamped.x;
          cam.tcy = clamped.y;
          moved = true;
        }
      }

      // Optional screen-edge pan uses the same camera targets as keyboard
      // input, so changing the option takes effect without reloading Pixi.
      const pointer = pointerRef.current;
      if (!flyover && props.edgeScroll && pointer && !rotTweenRef.current) {
        const margin = 28;
        const dx = pointer.x < margin ? -1 : pointer.x > el.clientWidth - margin ? 1 : 0;
        const dy = pointer.y < margin ? -1 : pointer.y > el.clientHeight - margin ? 1 : 0;
        if (dx || dy) {
          const step = (KEY_PAN_SPEED * props.edgeScrollSpeed * dtMs) / 1000 / cam.zoom;
          const centerIso = worldToIso(cam.tcx, cam.tcy, 0, rotation);
          const tile = isoToWorld(centerIso.x + dx * step, centerIso.y + dy * step, rotation);
          const clamped = clampCenter(tile.x, tile.y);
          cam.tcx = clamped.x;
          cam.tcy = clamped.y;
          moved = true;
        }
      }

      // Smooth toward targets.
      const k = props.cameraSmoothing ? 1 - Math.exp(-dtMs / 90) : 1;
      const snap = (a: number, b: number) => (Math.abs(a - b) < 1e-4 ? b : a + (b - a) * k);
      const ncx = snap(cam.cx, cam.tcx);
      const ncy = snap(cam.cy, cam.tcy);
      const nz = snap(cam.zoom, cam.tzoom);
      if (ncx !== cam.cx || ncy !== cam.cy || nz !== cam.zoom) {
        cam.cx = ncx;
        cam.cy = ncy;
        cam.zoom = nz;
        moved = true;
      }

      // Rotation tween: rigid spin around the pivot, then snap to the true
      // re-projection (effects rebuild via the rotation state change).
      const tween = rotTweenRef.current;
      if (tween && world) {
        const t = Math.min(1, (performance.now() - tween.start) / ROTATE_TWEEN_MS);
        const ease = t * t * (3 - 2 * t);
        world.rotation = (tween.toDeg * ease * Math.PI) / 180;
        if (t >= 1) {
          rotTweenRef.current = null;
          world.rotation = 0;
          setRotation(tween.next);
        }
        moved = true;
      }

      if (moved) {
        applyCamera();
        overlayDirtyRef.current = true;
        const now = performance.now();
        if (now - lastAmbientReportAtRef.current >= 250) {
          lastAmbientReportAtRef.current = now;
          props.onCameraCenter?.({ x: cam.tcx, y: cam.tcy });
          reportView();
        }
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    el.addEventListener("gesturestart", handleGestureStart, { passive: false });
    el.addEventListener("gesturechange", handleGestureChange, { passive: false });
    el.addEventListener("gestureend", handleGestureEnd, { passive: false });
    el.addEventListener("pointerdown", handlePointerDown);
    el.addEventListener("pointermove", handlePointerMove);
    el.addEventListener("pointerup", handlePointerUp);
    el.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    el.addEventListener("pointerleave", handlePointerLeave);
    app.ticker.add(tickCamera);

    return () => {
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("gesturestart", handleGestureStart);
      el.removeEventListener("gesturechange", handleGestureChange);
      el.removeEventListener("gestureend", handleGestureEnd);
      el.removeEventListener("pointerdown", handlePointerDown);
      el.removeEventListener("pointermove", handlePointerMove);
      el.removeEventListener("pointerup", handlePointerUp);
      el.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      el.removeEventListener("pointerleave", handlePointerLeave);
      app.ticker?.remove(tickCamera);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appReady, rotation, cameraState, applyCamera, clampCenter, minimumZoom, props.edgeScroll, props.edgeScrollSpeed, props.cameraSmoothing, props.keybindings, reportView]);

  // ---------------------------------------------------------------------
  // Regional surround — deterministic scenery beyond the playable estate
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!appReady) return;
    const layers = layersRef.current;
    if (!layers) return;
    layers.surround.removeChildren().forEach((child) => child.destroy({ children: true }));
    layers.estateSeam.removeChildren().forEach((child) => child.destroy({ children: true }));

    const model = generateScenicSurround(course, props.worldSeed);
    const palette = SCENIC_COLORS[model.theme];
    const ground = new PIXI.Graphics();
    ground.eventMode = "none";
    const quad = (graphics: PIXI.Graphics, x: number, y: number, width: number, height: number) => {
      const corners = [
        worldToIso(x, y, 0, rotation),
        worldToIso(x + width, y, 0, rotation),
        worldToIso(x + width, y + height, 0, rotation),
        worldToIso(x, y + height, 0, rotation),
      ];
      graphics.poly(corners.flatMap((point) => [point.x, point.y]));
    };

    // The base plane is deliberately far larger than any legal camera view.
    // It is one four-vertex primitive, so the visual guarantee is effectively
    // free and there is no finite scenic tile grid whose edge can be exposed.
    quad(
      ground,
      -SCENIC_PLANE_TILES,
      -SCENIC_PLANE_TILES,
      course.width + SCENIC_PLANE_TILES * 2,
      course.height + SCENIC_PLANE_TILES * 2,
    );
    ground.fill(palette.base);

    for (const patch of model.patches) {
      quad(ground, patch.x, patch.y, patch.width, patch.height);
      ground.fill({ color: shade(palette.patches[patch.kind], 0.94 + patch.shade * 0.12), alpha: 0.82 });
      quad(ground, patch.x, patch.y, patch.width, patch.height);
      ground.stroke({ width: 1.1, color: darken(palette.patches[patch.kind], 0.72), alpha: 0.38 });
    }

    const drawOcean = (edge: CoastEdge) => {
      const far = SCENIC_PLANE_TILES;
      const first = model.coastline[0];
      const last = model.coastline[model.coastline.length - 1];
      if (!first || !last) return;
      let worldPolygon: Point[];
      if (edge === "north" || edge === "south") {
        const farY = edge === "north" ? -far : course.height + far;
        worldPolygon = [
          { x: -far, y: farY },
          { x: course.width + far, y: farY },
          { x: course.width + far, y: last.y },
          ...model.coastline.slice().reverse(),
          { x: -far, y: first.y },
        ];
      } else {
        const farX = edge === "west" ? -far : course.width + far;
        worldPolygon = [
          { x: farX, y: -far },
          { x: farX, y: course.height + far },
          { x: last.x, y: course.height + far },
          ...model.coastline.slice().reverse(),
          { x: first.x, y: -far },
        ];
      }
      const projected = worldPolygon.map((point) => worldToIso(point.x, point.y, 0, rotation));
      ground.poly(projected.flatMap((point) => [point.x, point.y]));
      ground.fill(palette.ocean);
    };
    if (model.coast) drawOcean(model.coast);

    for (const road of model.roads) {
      const from = worldToIso(road.from.x, road.from.y, 0, rotation);
      const to = worldToIso(road.to.x, road.to.y, 0, rotation);
      ground.moveTo(from.x, from.y); ground.lineTo(to.x, to.y);
      ground.stroke({ width: 8, color: darken(palette.road, 0.72), alpha: 0.45 });
      ground.moveTo(from.x, from.y); ground.lineTo(to.x, to.y);
      ground.stroke({ width: 5.5, color: palette.road, alpha: 0.88 });
    }

    layers.surround.addChild(ground);

    // Continue the exact authored Links water material across the playable
    // boundary, fading it into the regional ocean rather than exposing the
    // estate as a darker, tile-textured triangle offshore.
    if (model.coast) {
      const oceanDetail = new PIXI.Container();
      oceanDetail.eventMode = "none";
      const band = 24;
      const material = getTerrainMaterial("links", "water");
      for (let y = -band; y < course.height + band; y++) for (let x = -band; x < course.width + band; x++) {
        if (x >= 0 && y >= 0 && x < course.width && y < course.height) continue;
        if (!isScenicOceanPoint(model.coast, { x: x + 0.5, y: y + 0.5 }, course.width, course.height, model.coastline)) continue;
        const distance = Math.max(-x, x - course.width + 1, -y, y - course.height + 1, 0);
        if (distance > band) continue;
        const texture = getTerrainFrame(pickTerrainBaseFrame(material, x, y));
        if (!texture) continue;
        const position = worldToIso(x + 0.5, y, 0, rotation);
        const tile = new PIXI.Sprite(texture);
        tile.anchor.set(0.5, 0);
        tile.position.set(position.x, position.y);
        tile.width = TILE_W + 0.75;
        tile.height = TILE_H + 0.5;
        tile.alpha = Math.max(0.08, 1 - distance / (band + 1));
        oceanDetail.addChild(tile);
      }
      layers.surround.addChild(oceanDetail);
    }

    // Sparse wavelets continue the authored Links water language offshore.
    // Their positions are deterministic and stay far from the scenery cap.
    if (model.coast) {
      const waves = new PIXI.Graphics();
      for (let i = 0; i < 180; i++) {
        const a = ((i * 73 + props.worldSeed * 11) >>> 0) % 997 / 997;
        const b = ((i * 151 + props.worldSeed * 7 + 31) >>> 0) % 991 / 991;
        const length = 4 + (i % 7);
        let from: Point;
        let to: Point;
        if (model.coast === "north" || model.coast === "south") {
          const x = -SCENIC_GENERATION_BLEED_TILES + a * (course.width + SCENIC_GENERATION_BLEED_TILES * 2);
          const y = model.coast === "north"
            ? -4 - b * SCENIC_GENERATION_BLEED_TILES
            : course.height + 4 + b * SCENIC_GENERATION_BLEED_TILES;
          from = { x, y }; to = { x: x + length, y };
        } else {
          const x = model.coast === "west"
            ? -4 - b * SCENIC_GENERATION_BLEED_TILES
            : course.width + 4 + b * SCENIC_GENERATION_BLEED_TILES;
          const y = -SCENIC_GENERATION_BLEED_TILES + a * (course.height + SCENIC_GENERATION_BLEED_TILES * 2);
          from = { x, y }; to = { x, y: y + length };
        }
        const p1 = worldToIso(from.x, from.y, 0, rotation);
        const p2 = worldToIso(to.x, to.y, 0, rotation);
        waves.moveTo(p1.x, p1.y); waves.lineTo(p2.x, p2.y);
      }
      waves.stroke({ width: 1.25, color: 0xc9e6ee, alpha: 0.26 });
      waves.eventMode = "none";
      layers.surround.addChild(waves);
    }

    const scenicProps = new PIXI.Container();
    scenicProps.sortableChildren = true;
    scenicProps.eventMode = "none";
    const scenicTerrain: Terrain = model.theme === "desert" ? "waste_area" : model.theme === "links" ? "deep_rough" : "rough";
    for (const prop of model.props) {
      const obstacle: Obstacle = { x: Math.round(prop.x), y: Math.round(prop.y), type: prop.type };
      const picked = pickNaturalProp({
        theme: model.theme,
        runSeed: props.worldSeed,
        obstacle,
        terrain: scenicTerrain,
        elevation: 0,
        nearWater: false,
        cultivated: false,
      });
      const fallback = pickNaturalProp({
        theme: "parkland",
        runSeed: props.worldSeed,
        obstacle,
        terrain: "rough",
        elevation: 0,
        nearWater: false,
        cultivated: false,
      });
      const texture = getPropFrame(picked.variant.frame) ?? getPropFrame(fallback.variant.frame);
      const position = worldToIso(prop.x, prop.y, 0, rotation);
      if (texture) {
        const sprite = new PIXI.Sprite(texture);
        sprite.anchor.set(picked.variant.anchor[0], picked.variant.anchor[1]);
        sprite.position.set(position.x, position.y);
        const size = TILE_W * 0.58 * picked.scale;
        sprite.width = size;
        sprite.height = size * texture.height / texture.width;
        sprite.zIndex = isoDepth(prop.x, prop.y, 0, rotation);
        scenicProps.addChild(sprite);
      } else {
        const marker = new PIXI.Graphics();
        marker.position.set(position.x, position.y);
        marker.zIndex = isoDepth(prop.x, prop.y, 0, rotation);
        if (prop.type === "tree") {
          marker.poly([-5, 0, 0, -14, 5, 0]); marker.fill(darken(palette.base, 0.62));
        } else if (prop.type === "rock") {
          marker.ellipse(0, -2, 5, 3); marker.fill(darken(palette.base, 0.7));
        } else {
          marker.circle(0, -3, 4); marker.fill(darken(palette.base, 0.68));
        }
        scenicProps.addChild(marker);
      }
    }
    scenicProps.sortChildren();
    layers.surround.addChild(scenicProps);

    // A broken landscape seam makes the property limit readable without a
    // glowing rectangular outline. The ocean-facing side deliberately has
    // no seam: the Links sea must remain visually continuous offshore.
    const seam = new PIXI.Graphics();
    const hedge = new PIXI.Graphics();
    const drawEdge = (edge: CoastEdge, length: number) => {
      if (edge === model.coast) return;
      for (let i = 0; i < length; i++) {
        const x = edge === "north" || edge === "south" ? i : edge === "west" ? 0 : course.width - 1;
        const y = edge === "west" || edge === "east" ? i : edge === "north" ? 0 : course.height - 1;
        const elevation = course.elevations[y * course.width + x] ?? 0;
        const a = edge === "north" ? worldToIso(i, 0, elevation, rotation)
          : edge === "south" ? worldToIso(i, course.height, elevation, rotation)
          : edge === "west" ? worldToIso(0, i, elevation, rotation)
          : worldToIso(course.width, i, elevation, rotation);
        const b = edge === "north" ? worldToIso(i + 1, 0, elevation, rotation)
          : edge === "south" ? worldToIso(i + 1, course.height, elevation, rotation)
          : edge === "west" ? worldToIso(0, i + 1, elevation, rotation)
          : worldToIso(course.width, i + 1, elevation, rotation);
        seam.moveTo(a.x, a.y); seam.lineTo(b.x, b.y);
        if (((i * 17 + props.worldSeed + edge.charCodeAt(0)) % 11 + 11) % 11 < 6) {
          hedge.moveTo(a.x, a.y - 1); hedge.lineTo(b.x, b.y - 1);
        }
      }
    };
    drawEdge("north", course.width);
    drawEdge("south", course.width);
    drawEdge("west", course.height);
    drawEdge("east", course.height);
    seam.stroke({ width: 2.2, color: palette.seam, alpha: 0.72 });
    hedge.stroke({ width: 3.4, color: palette.hedge, alpha: 0.78 });
    seam.eventMode = "none"; hedge.eventMode = "none";
    layers.estateSeam.addChild(seam, hedge);
  }, [appReady, course, props.worldSeed, rotation]);

  // ---------------------------------------------------------------------
  // Terrain layer — tinted diamond sprites, back-to-front
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!appReady) return;
    const layers = layersRef.current;
    const diamond = diamondTextureRef.current;
    if (!layers || !diamond) return;

    const w = course.width;
    const h = course.height;
    const cols = Math.ceil(w / CHUNK_TILES);
    const rows = Math.ceil(h / CHUNK_TILES);
    const elev = (x: number, y: number) => getElevation(course, x, y);
    // Standard rendering reconstructs the material below newly authored
    // sub-tile contours. The next layer clips the *same authored tile
    // textures* to those accepted contours, eliminating diamond protrusions
    // without returning to a flat polygon wash. Accessibility modes keep the
    // direct tile/pattern path so non-color differentiation remains exact.
    const materialFeatures = props.colorVision === "standard" && !props.terrainPatterns
      ? (course.surfaceIntent?.features ?? []).filter((feature) => feature.renderRings?.length)
      : [];
    const underlayTiles = materialFeatures.length > 0
      ? buildIntentUnderlayTiles(course.tiles, w, h, materialFeatures)
      : course.tiles;
    const visualTerrainAt = (x: number, y: number): Terrain => {
      const index = y * w + x;
      return underlayTiles[index];
    };

    const dSE = unrotateWorld(1, 0, rotation); // world offset of screen-lower-right neighbor
    const dSW = unrotateWorld(0, 1, rotation); // world offset of screen-lower-left neighbor
    const edgeCorners = (x: number, y: number, dx: number, dy: number): [Point, Point] => {
      if (dx === 1) return [{ x: x + 1, y }, { x: x + 1, y: y + 1 }];
      if (dx === -1) return [{ x, y }, { x, y: y + 1 }];
      if (dy === 1) return [{ x, y: y + 1 }, { x: x + 1, y: y + 1 }];
      return [{ x, y }, { x: x + 1, y }];
    };

    // Accessibility and legacy-biome tint fallback. Theme/material selection
    // itself is data-driven through the exhaustive terrain material registry.
    const THEMED_COLORS: Record<Terrain, number> = props.colorVision === "standard"
      ? { ...COLORS, ...getLandTheme(course.theme).tileTints }
      : TERRAIN_PALETTES[props.colorVision];
    const cliffFaces = getLandTheme(course.theme).cliffFaces;

    /** Rebuild one chunk's contents in place (cliffs first, tops in depth order). */
    const buildChunk = (chunk: TerrainChunk, cx: number, cy: number) => {
      const x0 = cx * CHUNK_TILES;
      const y0 = cy * CHUNK_TILES;
      const x1 = Math.min(w, x0 + CHUNK_TILES);
      const y1 = Math.min(h, y0 + CHUNK_TILES);

      chunk.container.removeChildren().forEach((c) => c.destroy());
      chunk.waterSprites = [];
      chunk.foamSprites = [];
      chunk.groundCoverSprites = [];

      // Cliff faces render behind this chunk's tile tops.
      const cliffs = new PIXI.Graphics();
      chunk.container.addChild(cliffs);
      const face = (x: number, y: number, d: Point, color: number) => {
        const e = elev(x, y);
        const nx = x + d.x;
        const ny = y + d.y;
        // The regional surround continues beyond the course. Treat exterior
        // neighbors as level with the perimeter rather than exposing the old
        // brown "cut slab" face around the whole map.
        const ne = nx < 0 || ny < 0 || nx >= w || ny >= h ? e : elev(nx, ny);
        if (ne >= e || e <= 0) return;
        const [c1, c2] = edgeCorners(x, y, d.x, d.y);
        const a = worldToIso(c1.x, c1.y, e, rotation);
        const b = worldToIso(c2.x, c2.y, e, rotation);
        const drop = (e - ne) * ELEVATION_STEP_PX;
        cliffs.poly([a.x, a.y, b.x, b.y, b.x, b.y + drop, a.x, a.y + drop]);
        cliffs.fill(color);
      };

      // Depth-ordered tile list within the chunk.
      const order: Array<{ x: number; y: number }> = [];
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) order.push({ x, y });
      order.sort(
        (a, b) => isoDepth(a.x + 0.5, a.y + 0.5, 0, rotation) - isoDepth(b.x + 0.5, b.y + 0.5, 0, rotation)
      );

      for (const { x, y } of order) {
        face(x, y, dSW, cliffFaces.sw);
        face(x, y, dSE, cliffFaces.se);
      }
      // Mow stripes (ZKU-149): fairway/green tiles get alternating light/dark
      // bands oriented along the nearest hole's tee→green axis; fairway far
      // from any hole falls back to a global diagonal. Pure tint math — no
      // extra sprites, cached with the chunk.
      const holeAxes = course.holes
        .filter((hole) => hole.tee && hole.green)
        .map((hole) => {
          const ax = hole.tee!.x;
          const ay = hole.tee!.y;
          const dx = hole.green!.x - ax;
          const dy = hole.green!.y - ay;
          const len2 = Math.max(1e-6, dx * dx + dy * dy);
          return { ax, ay, dx, dy, len2 };
        });
      for (const { x, y } of order) {
        const terrain = visualTerrainAt(x, y);
        const material = getTerrainMaterial(course.theme, terrain);
        const e = elev(x, y);
        const p = worldToIso(x + 0.5, y, e, rotation);
        // NW-sun slope shade from central-difference normals (world-fixed sun).
        const dzdx = (elev(x + 1, y) - elev(x - 1, y)) / 2;
        const dzdy = (elev(x, y + 1) - elev(x, y - 1)) / 2;
        let slopeShade = Math.max(0.8, Math.min(1.12, 1 - 0.07 * (dzdx + dzdy)));
        if (terrain === "fairway" || terrain === "green" || terrain === "tee") {
          slopeShade *= mowingShadeAt(x, y, holeAxes);
        }
        const legacyTint = shade(darken(THEMED_COLORS[terrain], EDGE_DARKEN), slopeShade);

        // Authored parkland sources are @2× but remain 64×32 in world space.
        // Other themes intentionally use the safe legacy tint until M21.
        const authored = material.source === "atlas-2x"
          ? getTerrainFrame(pickTerrainBaseFrame(material, x, y))
          : null;
        const sprite = new PIXI.Sprite(authored ?? diamond);
        sprite.anchor.set(0.5, 0);
        sprite.position.set(p.x, p.y);
        // A subpixel overlap hides linear-filter alpha hairlines between
        // neighboring @2× diamonds without changing projection or picking.
        sprite.width = authored ? TILE_W + 0.75 : TILE_W;
        sprite.height = authored ? TILE_H + 0.5 : TILE_H;
        sprite.tint = authored && props.colorVision === "standard"
          ? shade(0xffffff, slopeShade)
          : legacyTint;
        chunk.container.addChild(sprite);
        if (props.terrainPatterns && terrainPattern(terrain) !== "none") {
          const pattern = new PIXI.Graphics();
          pattern.position.set(p.x, p.y);
          pattern.alpha = 0.38;
          if (terrainPattern(terrain) === "stripe") {
            pattern.moveTo(-22, 12); pattern.lineTo(0, 1);
            pattern.moveTo(-8, 16); pattern.lineTo(15, 5);
            pattern.stroke({ width: 1.5, color: 0xffffff });
          } else if (terrainPattern(terrain) === "crosshatch") {
            pattern.moveTo(-18, 7); pattern.lineTo(0, 16);
            pattern.moveTo(0, 0); pattern.lineTo(18, 9);
            pattern.moveTo(-18, 9); pattern.lineTo(0, 0);
            pattern.moveTo(0, 16); pattern.lineTo(18, 7);
            pattern.stroke({ width: 1.2, color: 0xffffff });
          } else {
            pattern.circle(-12, 8, 1.4); pattern.circle(0, 4, 1.4); pattern.circle(12, 10, 1.4); pattern.circle(0, 14, 1.4);
            pattern.fill(0xffffff);
          }
          chunk.container.addChild(pattern);
        }

        const cover = deriveGroundCover(course, props.worldSeed, x, y);
        if (cover) {
          const detail = new PIXI.Graphics();
          detail.eventMode = "none";
          detail.position.set(p.x + cover.offsetX, p.y + cover.offsetY);
          detail.alpha = .78;
          if (cover.kind === "native_grass") {
            detail.moveTo(-3, 2); detail.lineTo(-1, -4); detail.moveTo(0, 2); detail.lineTo(1, -5); detail.moveTo(3, 2); detail.lineTo(5, -3);
            detail.stroke({ width: 1.2, color: 0x315f2f });
          } else if (cover.kind === "flowers") {
            detail.circle(-2, 0, 1.3); detail.circle(2, -1, 1.1); detail.fill(0xf4d86b);
          } else if (cover.kind === "reeds") {
            detail.moveTo(-4, 3); detail.lineTo(-4, -7); detail.moveTo(0, 3); detail.lineTo(1, -9); detail.moveTo(4, 3); detail.lineTo(5, -5);
            detail.stroke({ width: 1.35, color: 0x6e7433 });
          } else if (cover.kind === "leaf_litter") {
            detail.ellipse(-3, 0, 2.2, 1); detail.ellipse(2, 2, 1.8, .9); detail.fill(0x795735);
          } else if (cover.kind === "pebbles") {
            detail.circle(-3, 1, 1.4); detail.circle(2, -1, 1.7); detail.fill(0x756b5d);
          } else {
            detail.ellipse(0, 1, 5, 2.2); detail.fill({ color: 0x76563a, alpha: .5 });
          }
          chunk.container.addChild(detail);
          chunk.groundCoverSprites.push({ graphic: detail, tier: cover.detailTier });
        }

        // Animated water registration (ZKU-150): shimmer phase from position
        // so neighboring tiles never pulse in sync; plus a foam lip along
        // every land edge (drawn on the water side).
        if (terrain === "water" || terrain === "wetland") {
          chunk.waterSprites.push({
            sprite,
            baseTint: sprite.tint,
            phase: waterShimmerPhase(x, y),
            gx: x,
            gy: y,
          });
        }

        // True 8-neighbor material boundary. The higher-priority surface owns
        // the seam, so banks/lips never double-render. Elevation joins remain
        // exclusively the cliff layer. Rotation maps all 256 masks into the
        // fixed screen-oriented atlas frame set.
        let boundaryMask = 0;
        for (let index = 0; index < AUTOTILE_DIRECTIONS.length; index++) {
          const { dx, dy } = AUTOTILE_DIRECTIONS[index];
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nTerrain = visualTerrainAt(nx, ny);
          const boundary = terrainBoundaryFor(terrain, nTerrain);
          if (!boundary || boundary.owner !== terrain) continue;
          if (elev(nx, ny) !== e) continue;
          boundaryMask |= 1 << index;
        }
        const features = autotileFeatures(rotateAutotileMask(boundaryMask, rotation));
        for (const feature of features) {
          const transitionTexture = material.source === "atlas-2x"
            ? getTerrainFrame(terrainTransitionFrame(material, feature))
            : null;
          if (!transitionTexture) continue;
          const lip = new PIXI.Sprite(transitionTexture);
          lip.anchor.set(0.5, 0);
          lip.position.set(p.x, p.y);
          lip.width = TILE_W;
          lip.height = TILE_H;
          lip.tint = props.colorVision === "standard" ? shade(0xffffff, slopeShade) : legacyTint;
          chunk.container.addChild(lip);
          if ((terrain === "water" || terrain === "wetland") && feature.kind === "edge") {
            chunk.foamSprites.push({ sprite: lip, phase: ((x * 5 + y * 11) % 16) / 16 * Math.PI * 2 });
          }
        }
      }

      // Culling bounds: projected rect corners + elevation headroom.
      const corners = [
        worldToIso(x0, y0, 0, rotation),
        worldToIso(x1, y0, 0, rotation),
        worldToIso(x1, y1, 0, rotation),
        worldToIso(x0, y1, 0, rotation),
      ];
      chunk.minX = Math.min(...corners.map((c) => c.x)) - TILE_W / 2;
      chunk.maxX = Math.max(...corners.map((c) => c.x)) + TILE_W / 2;
      chunk.minY = Math.min(...corners.map((c) => c.y)) - ELEVATION_MAX * ELEVATION_STEP_PX - TILE_H;
      chunk.maxY = Math.max(...corners.map((c) => c.y)) + TILE_H;

      if (CHUNK_DEBUG) {
        const border = new PIXI.Graphics();
        border.rect(chunk.minX, chunk.minY, chunk.maxX - chunk.minX, chunk.maxY - chunk.minY);
        border.stroke({ width: 1, color: 0xff00ff, alpha: 0.6 });
        chunk.container.addChild(border);
      }
      chunkRebuildsRef.current++;
    };

    const chunkIndex = (cx: number, cy: number) => cy * cols + cx;
    const prevTiles = prevTilesRef.current;
    const prevElevations = prevElevationsRef.current;
    const fullRebuild =
      chunksRef.current.length !== cols * rows ||
      builtRotationRef.current !== rotation ||
      !prevTiles ||
      prevTiles.length !== course.tiles.length;

    if (fullRebuild) {
      layers.terrain.removeChildren();
      chunksRef.current.forEach((c) => c.container.destroy({ children: true }));
      chunksRef.current = [];
      builtRotationRef.current = rotation;

      // Create chunk containers and add them back-to-front for this rotation.
      const chunkOrder: Array<{ cx: number; cy: number }> = [];
      for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) chunkOrder.push({ cx, cy });
      chunkOrder.sort((a, b) => {
        const da = isoDepth((a.cx + 0.5) * CHUNK_TILES, (a.cy + 0.5) * CHUNK_TILES, 0, rotation);
        const db = isoDepth((b.cx + 0.5) * CHUNK_TILES, (b.cy + 0.5) * CHUNK_TILES, 0, rotation);
        return da - db;
      });
      const chunks: TerrainChunk[] = new Array(cols * rows);
      for (const { cx, cy } of chunkOrder) {
        const chunk: TerrainChunk = {
          container: new PIXI.Container(),
          minX: 0, minY: 0, maxX: 0, maxY: 0,
          waterSprites: [],
          foamSprites: [],
          groundCoverSprites: [],
        };
        layers.terrain.addChild(chunk.container);
        buildChunk(chunk, cx, cy);
        chunks[chunkIndex(cx, cy)] = chunk;
      }
      chunksRef.current = chunks;
      devLog(`full terrain rebuild: ${cols}x${rows} chunks (rot ${rotation})`);
    } else {
      // Incremental: diff tiles+elevations, mark touched chunks (expanded by
      // one tile — shading and cliff faces read neighboring tiles).
      const dirty = new Set<number>();
      for (let i = 0; i < course.tiles.length; i++) {
        if (course.tiles[i] === prevTiles[i] && (course.elevations?.[i] ?? 0) === (prevElevations?.[i] ?? 0)) {
          continue;
        }
        const x = i % w;
        const y = Math.floor(i / w);
        const cx0 = Math.max(0, Math.floor((x - 1) / CHUNK_TILES));
        const cx1 = Math.min(cols - 1, Math.floor((x + 1) / CHUNK_TILES));
        const cy0 = Math.max(0, Math.floor((y - 1) / CHUNK_TILES));
        const cy1 = Math.min(rows - 1, Math.floor((y + 1) / CHUNK_TILES));
        for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) dirty.add(chunkIndex(cx, cy));
      }
      dirty.forEach((ci) => {
        buildChunk(chunksRef.current[ci], ci % cols, Math.floor(ci / cols));
      });
      if (dirty.size > 0) devLog(`rebuilt ${dirty.size} dirty chunk(s), total rebuilds ${chunkRebuildsRef.current}`);
    }

    prevTilesRef.current = course.tiles;
    prevElevationsRef.current = course.elevations;
    cullChunks();
  }, [appReady, course, rotation, cullChunks, props.colorVision, props.terrainPatterns, props.worldSeed]);

  // Material-clipped surface intent. New Curve/Area contours use their 4×
  // accepted mask for the silhouette, but their interior remains the same
  // deterministic atlas-tile field used by legacy terrain.
  useEffect(() => {
    if (!appReady) return;
    const layer = layersRef.current?.smoothSurfaces;
    if (!layer) return;
    layer.removeChildren().forEach((child) => child.destroy());
    surfaceWaterSpritesRef.current = [];
    const styles: Partial<Record<Terrain, { color: number; width: number; alpha: number }>> = {
      fairway: { color: 0x2f7139, width: 2.2, alpha: 0.52 },
      green: { color: 0x337a42, width: 2.5, alpha: 0.62 },
      tee: { color: 0x3b7440, width: 2.1, alpha: 0.54 },
      sand: { color: 0x8b7342, width: 2.8, alpha: 0.66 },
      waste_area: { color: 0x765735, width: 2.2, alpha: 0.48 },
      water: { color: 0x235c82, width: 3.1, alpha: 0.72 },
      wetland: { color: 0x315e50, width: 2.8, alpha: 0.64 },
      path: { color: 0x625b50, width: 2.3, alpha: 0.6 },
    };
    const features = props.colorVision === "standard" && !props.terrainPatterns
      ? (course.surfaceIntent?.features ?? []).filter((feature) => feature.renderRings?.length)
      : [];
    const authoredTerrains = new Set(features.map((feature) => feature.terrain));
    const elevationAt = (point: Point) => getElevation(
      course,
      Math.max(0, Math.min(course.width - 1, Math.floor(point.x))),
      Math.max(0, Math.min(course.height - 1, Math.floor(point.y))),
    );
    const project = (point: Point) => worldToIso(point.x, point.y, elevationAt(point), rotation);
    const holeAxes = course.holes
      .filter((hole) => hole.tee && hole.green)
      .map((hole) => {
        const ax = hole.tee!.x;
        const ay = hole.tee!.y;
        const dx = hole.green!.x - ax;
        const dy = hole.green!.y - ay;
        return { ax, ay, dx, dy, len2: Math.max(1e-6, dx * dx + dy * dy) };
      });
    const ringArea = (ring: readonly Point[]) => {
      let area = 0;
      for (let index = 0; index < ring.length; index++) {
        const point = ring[index];
        const next = ring[(index + 1) % ring.length];
        area += point.x * next.y - next.x * point.y;
      }
      return area / 2;
    };
    const ringContains = (ring: readonly Point[], point: Point) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i];
        const b = ring[j];
        if (
          (a.y > point.y) !== (b.y > point.y) &&
          point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x
        ) inside = !inside;
      }
      return inside;
    };
    const buildMask = (rings: readonly (readonly Point[])[]) => {
      const mask = new PIXI.Graphics();
      mask.eventMode = "none";
      const nodes = rings
        .filter((ring) => ring.length >= 3)
        .map((ring) => ({ ring, area: Math.abs(ringArea(ring)), parent: -1, depth: 0 }))
        .sort((a, b) => b.area - a.area);
      for (let index = 0; index < nodes.length; index++) {
        const point = nodes[index].ring[0];
        for (let parent = index - 1; parent >= 0; parent--) {
          if (!ringContains(nodes[parent].ring, point)) continue;
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
    };

    const diamond = diamondTextureRef.current;
    for (const feature of [...features].sort((a, b) => a.order - b.order)) {
      const validCoverage = feature.coverage.filter((index) => course.tiles[index] === feature.terrain);
      if (validCoverage.length === 0 || !feature.renderRings?.length) continue;
      const material = getTerrainMaterial(course.theme, feature.terrain);
      const materialLayer = new PIXI.Container();
      materialLayer.eventMode = "none";
      for (const index of validCoverage) {
        const x = index % course.width;
        const y = Math.floor(index / course.width);
        const elevation = getElevation(course, x, y);
        const position = worldToIso(x + 0.5, y, elevation, rotation);
        const authored = material.source === "atlas-2x"
          ? getTerrainFrame(pickTerrainBaseFrame(material, x, y))
          : null;
        if (!authored && !diamond) continue;
        const sprite = new PIXI.Sprite(authored ?? diamond!);
        sprite.anchor.set(0.5, 0);
        sprite.position.set(position.x, position.y);
        sprite.width = authored ? TILE_W + 0.75 : TILE_W;
        sprite.height = authored ? TILE_H + 0.5 : TILE_H;
        const dzdx = (getElevation(course, x + 1, y) - getElevation(course, x - 1, y)) / 2;
        const dzdy = (getElevation(course, x, y + 1) - getElevation(course, x, y - 1)) / 2;
        let slopeShade = Math.max(0.8, Math.min(1.12, 1 - 0.07 * (dzdx + dzdy)));
        if (feature.terrain === "fairway" || feature.terrain === "green" || feature.terrain === "tee") {
          slopeShade *= mowingShadeAt(x, y, holeAxes);
        }
        sprite.tint = shade(0xffffff, slopeShade);
        materialLayer.addChild(sprite);
        if (feature.terrain === "water" || feature.terrain === "wetland") {
          surfaceWaterSpritesRef.current.push({
            sprite,
            baseTint: sprite.tint,
            phase: waterShimmerPhase(x, y),
            gx: x,
            gy: y,
          });
        }
      }
      const mask = buildMask(feature.renderRings);
      materialLayer.mask = mask;
      layer.addChild(materialLayer, mask);
      const style = styles[feature.terrain];
      if (style) {
        const outline = new PIXI.Graphics();
        outline.eventMode = "none";
        const sampleTerrain = (point: Point): Terrain | null => {
          const x = Math.floor(point.x);
          const y = Math.floor(point.y);
          if (x < 0 || y < 0 || x >= course.width || y >= course.height) return null;
          return course.tiles[y * course.width + x];
        };
        for (const ring of feature.renderRings) {
          let drawing = false;
          for (let index = 0; index < ring.length; index++) {
            const start = ring[index];
            const end = ring[(index + 1) % ring.length];
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const length = Math.hypot(dx, dy);
            if (length <= 1e-6) continue;
            const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
            const normal = { x: -dy / length * 0.9, y: dx / length * 0.9 };
            const sideA = sampleTerrain({ x: midpoint.x + normal.x, y: midpoint.y + normal.y });
            const sideB = sampleTerrain({ x: midpoint.x - normal.x, y: midpoint.y - normal.y });
            const ownsBoundary =
              (sideA === feature.terrain && sideB !== feature.terrain) ||
              (sideB === feature.terrain && sideA !== feature.terrain);
            if (!ownsBoundary) {
              drawing = false;
              continue;
            }
            const projectedStart = project(start);
            const projectedEnd = project(end);
            if (!drawing) outline.moveTo(projectedStart.x, projectedStart.y);
            outline.lineTo(projectedEnd.x, projectedEnd.y);
            drawing = true;
          }
        }
        outline.stroke({
          width: style.width,
          color: style.color,
          alpha: style.alpha,
          join: "round",
          cap: "round",
        });
        layer.addChild(outline);
      }
    }

    // Legacy tile-only components retain a restrained single outline. New
    // authored terrain gets its smooth edge directly from the mask above,
    // avoiding both a jagged second outline and same-terrain stroke seams.
    for (const contour of buildTerrainContours(course.tiles, course.width, course.height)) {
      const style = styles[contour.terrain];
      if (!style || authoredTerrains.has(contour.terrain) || contour.points.length < 3) continue;
      const projected = contour.points.map(project);
      const outline = new PIXI.Graphics();
      outline.eventMode = "none";
      outline.poly(projected.flatMap((point) => [point.x, point.y]));
      outline.stroke({
        width: style.width,
        color: style.color,
        alpha: style.alpha,
        join: "round",
        cap: "round",
      });
      layer.addChild(outline);
    }
    // Operations metadata shares the Course root but cannot alter this layer;
    // depend only on the visual fields below to avoid costly rebuilds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    appReady,
    course.tiles,
    course.elevations,
    course.width,
    course.height,
    course.holes,
    course.surfaceIntent,
    course.theme,
    props.colorVision,
    props.terrainPatterns,
    rotation,
  ]);

  // ---------------------------------------------------------------------
  // Objects layer — obstacles, ground-anchored and depth-sorted
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!appReady) return;
    const layers = layersRef.current;
    if (!layers) return;

    obstacleSpritesRef.current.forEach((entry) => {
      layers.objects.removeChild(entry.sprite);
      entry.sprite.destroy();
      entry.shadow.parent?.removeChild(entry.shadow);
      entry.shadow.destroy();
    });
    obstacleSpritesRef.current.clear();

    if (!props.showObstacles) return;

    const terrainNearWater = (x: number, y: number) => {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= course.width || ty >= course.height) continue;
        if (isWaterHazard(course.tiles[ty * course.width + tx])) return true;
      }
      return false;
    };
    const isCultivated = (x: number, y: number) => (course.buildings ?? []).some((building) =>
      Math.hypot(building.x - x, building.y - y) <= 8
    );

    const addSprite = (obs: Obstacle, texture: PIXI.Texture, variant: NaturalPropVariant, scale: number) => {
      const layersNow = layersRef.current;
      if (!layersNow) return;
      const key = `${obs.x},${obs.y}`;
      if (obstacleSpritesRef.current.has(key)) return;
      const sprite = new PIXI.Sprite(texture);
      // Ground-anchored via the shared placement helper (ZKU-140).
      const e = getElevation(course, obs.x, obs.y);
      const placement = placeObject({ x: obs.x, y: obs.y, w: 1, d: 1 }, e, rotation);
      sprite.anchor.set(variant.anchor[0], variant.anchor[1]);
      sprite.position.set(placement.position.x, placement.position.y);
      const size = TILE_W * 0.72 * scale;
      sprite.width = size;
      sprite.height = (size * texture.height) / texture.width;
      sprite.zIndex = placement.zIndex;
      layersNow.objects.addChild(sprite);

      // Drop shadow (ZKU-151): soft ellipse at the base, offset SE to match
      // the fixed NW sun; lives in the decal layer under all objects.
      const shadow = new PIXI.Graphics();
      shadow.ellipse(
        variant.shadow.offsetX,
        variant.shadow.offsetY,
        variant.shadow.radiusX * scale,
        variant.shadow.radiusY * scale
      );
      shadow.fill({ color: 0x000000, alpha: variant.shadow.alpha });
      shadow.position.set(placement.position.x, placement.position.y - TILE_H / 2 + 1);
      layersNow.terrainDecals.addChild(shadow);

      obstacleSpritesRef.current.set(key, {
        sprite,
        shadow,
        swayPhase: variant.sway ? ((obs.x * 17 + obs.y * 29) % 32) / 32 * Math.PI * 2 : null,
        sway: variant.sway,
        tall: variant.occlusion.tall,
        fadeAlpha: variant.occlusion.fadeAlpha,
      });
    };

    obstacles.forEach((obs) => {
      const index = obs.y * course.width + obs.x;
      const context = {
        theme: course.theme,
        runSeed: props.worldSeed,
        obstacle: obs,
        terrain: course.tiles[index] ?? "rough" as Terrain,
        elevation: course.elevations[index] ?? 0,
        nearWater: terrainNearWater(obs.x, obs.y),
        cultivated: isCultivated(obs.x, obs.y),
      };
      const selected = pickNaturalProp(context);
      const fallback = pickNaturalProp({ ...context, theme: "parkland" });
      const atlasTex = getPropFrame(selected.variant.frame) ?? getPropFrame(fallback.variant.frame);
      if (atlasTex) {
        addSprite(obs, atlasTex, selected.variant, selected.scale);
        return;
      }
      // Legacy fallback: runtime-rasterized SVG icons.
      const spriteOrPromise = getObstacleSprite(obs.type, tileSize);
      if (spriteOrPromise instanceof HTMLImageElement) {
        addSprite(obs, PIXI.Texture.from(spriteOrPromise), fallback.variant, fallback.scale);
      } else if (spriteOrPromise instanceof Promise) {
        void spriteOrPromise.then((img: HTMLImageElement) => {
          if (appRef.current) addSprite(obs, PIXI.Texture.from(img), fallback.variant, fallback.scale);
        });
      }
    });
  }, [appReady, obstacles, tileSize, props.showObstacles, props.worldSeed, course, rotation]);

  // ---------------------------------------------------------------------
  // Objects layer — buildings (multi-tile footprints, ZKU-152)
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!appReady) return;
    const layers = layersRef.current;
    if (!layers) return;

    buildingSpritesRef.current.forEach((sprite) => {
      layers.objects.removeChild(sprite);
      sprite.destroy();
    });
    buildingSpritesRef.current = [];

    for (const b of course.buildings ?? []) {
      const spec = buildingSpec(b);
      const tex = getPropFrame(buildingVisualFrame(b, course.theme ?? "parkland"))
        ?? getPropFrame(buildingVisualFrame({ ...b, tier: 1 }, "parkland"))
        ?? getPropFrame(spec.frame as AtlasFrame)
        ?? getPropFrame("clubhouse");
      if (!tex) continue;
      const e = getElevation(course, b.x, b.y);
      const placement = placeObject({ x: b.x, y: b.y, w: spec.w, d: spec.d }, e, rotation);
      const sprite = new PIXI.Sprite(tex);
      sprite.anchor.set(0.5, 1);
      sprite.position.set(placement.position.x, placement.position.y);
      sprite.width = spec.w * TILE_W;
      sprite.height = (sprite.width * tex.height) / tex.width;
      sprite.zIndex = placement.zIndex;
      layers.objects.addChild(sprite);
      buildingSpritesRef.current.push(sprite);
    }
  }, [appReady, course, rotation]);

  // M31-M33 property assets use lightweight deterministic vector footprints.
  // They rotate/zoom/depth-sort with the world and never create one entity per
  // guest or parked car, keeping a full destination estate inexpensive.
  useEffect(() => {
    if (!appReady) return;
    const layers = layersRef.current;
    if (!layers) return;
    for (const graphic of propertyGraphicsRef.current) {
      layers.objects.removeChild(graphic);
      graphic.destroy();
    }
    propertyGraphicsRef.current = [];
    const themeColors = {
      parkland: { access: 0x6f7775, practice: 0x78a95f, clubhouse: 0xb88c53, resort: 0x668da8, community: 0xc18c72, safety: 0x477a4d },
      links: { access: 0x777b79, practice: 0x91a65e, clubhouse: 0xa88d64, resort: 0x648ca1, community: 0xb79072, safety: 0x5d7848 },
      desert: { access: 0x81756a, practice: 0x6f9c66, clubhouse: 0xb47a4f, resort: 0x66899a, community: 0xc38162, safety: 0x61784f },
    } as const;
    const surfaceColors = { grass: 0x779567, dirt: 0x8c7156, gravel: 0x8b8b83, asphalt: 0x555b5d, paver: 0x9a8068 } as const;
    const colors = themeColors[course.theme ?? "parkland"];
    const resortPalette = {
      parkland: { wall: 0xe5d7b5, roof: 0x5f2f28, accent: 0xf5cb63 },
      links: { wall: 0xdad8cd, roof: 0x475d67, accent: 0xe0b653 },
      desert: { wall: 0xd7a46f, roof: 0x8b4e36, accent: 0x52a19a },
    }[course.theme ?? "parkland"];
    const lodgingAssets = (course.property?.assets ?? []).filter((asset) => asset.enabled && ["lodge", "hotel", "cottages"].includes(asset.kind));
    for (const asset of course.property?.assets ?? []) {
      const elevation = getElevation(course, asset.x, asset.y);
      const corners = [
        worldToIso(asset.x, asset.y, elevation, rotation),
        worldToIso(asset.x + asset.width, asset.y, elevation, rotation),
        worldToIso(asset.x + asset.width, asset.y + asset.height, elevation, rotation),
        worldToIso(asset.x, asset.y + asset.height, elevation, rotation),
      ];
      const graphic = new PIXI.Graphics();
      graphic.poly(corners.flatMap((point) => [point.x, point.y]));
      graphic.fill({ color: asset.surface ? surfaceColors[asset.surface] : colors[asset.category], alpha: asset.enabled ? 0.88 : 0.38 });
      graphic.stroke({ width: asset.enabled ? 2 : 1, color: asset.enabled ? 0xfff6d7 : 0x5d625e, alpha: 0.9 });
      if (asset.category === "community" && (asset.kind === "houses" || asset.kind === "condos")) {
        const unitState = (course.property?.units ?? []).filter((unit) => unit.assetId === asset.id);
        const occupiedRatio = unitState.length ? unitState.filter((unit) => !!unit.householdId).length / unitState.length : asset.tenure === "sold" ? 0.72 : 0;
        const structures = asset.kind === "houses" ? Math.min(8, 3 + asset.tier) : Math.min(4, 1 + asset.tier);
        const communityPalette = {
          parkland: { wall: 0xe5cfad, roof: 0x77483c, trim: 0xf2e7cf },
          links: { wall: 0xd8d4c5, roof: 0x55666d, trim: 0xf1eee1 },
          desert: { wall: 0xd59c69, roof: 0x8b553c, trim: 0xf1d3a5 },
        }[course.theme ?? "parkland"];
        for (let index = 0; index < structures; index++) {
          const columns = asset.kind === "houses" ? Math.min(4, structures) : 2;
          const rows = Math.ceil(structures / columns);
          const wx = asset.x + asset.width * ((index % columns) + 0.5) / columns;
          const wy = asset.y + asset.height * (Math.floor(index / columns) + 0.55) / rows;
          const center = worldToIso(wx, wy, elevation, rotation);
          const width = asset.kind === "houses" ? 12 + asset.tier : 19 + asset.tier * 2;
          const height = asset.kind === "houses" ? 10 + asset.tier * 1.5 : 18 + asset.tier * 4;
          graphic.roundRect(center.x - width / 2, center.y - height, width, height, asset.kind === "houses" ? 1.5 : 1);
          graphic.fill({ color: communityPalette.wall, alpha: asset.enabled ? 0.98 : 0.42 });
          graphic.stroke({ width: 1, color: 0x503f35, alpha: 0.82 });
          graphic.poly([center.x - width / 2 - 1, center.y - height, center.x, center.y - height - width * 0.28, center.x + width / 2 + 1, center.y - height]);
          graphic.fill({ color: communityPalette.roof, alpha: asset.enabled ? 0.98 : 0.42 });
          if (index / structures < occupiedRatio) {
            graphic.rect(center.x - 2, center.y - height * 0.48, 4, 4);
            graphic.fill({ color: 0xf4d77b, alpha: 0.95 });
          } else {
            graphic.rect(center.x - 2, center.y - height * 0.48, 4, 4);
            graphic.fill({ color: 0x6f817d, alpha: 0.72 });
            graphic.moveTo(center.x - 2, center.y - height * 0.48);
            graphic.lineTo(center.x + 2, center.y - height * 0.48 + 4);
            graphic.stroke({ width: 0.8, color: communityPalette.trim, alpha: 0.85 });
          }
        }
        if (asset.tenure === "sold" || asset.tenure === "partnered" || asset.tenure === "retained") {
          for (let stripe = 0; stripe < 6; stripe++) {
            const a = corners[stripe % 4];
            const b = corners[(stripe + 1) % 4];
            const t = (stripe + 1) / 7;
            graphic.circle(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 1.5);
          }
          graphic.fill({ color: asset.tenure === "sold" ? 0xefe2c7 : asset.tenure === "partnered" ? 0xd5c5ea : 0xb9d8e0, alpha: 0.95 });
        }
        if (asset.tenure === "reacquired") {
          const center = worldToIso(asset.x + asset.width / 2, asset.y + asset.height / 2, elevation, rotation);
          graphic.circle(center.x, center.y - 9, 8);
          graphic.stroke({ width: 2.5, color: 0x3f7750, alpha: 0.95 });
          graphic.moveTo(center.x - 8, center.y - 9);
          graphic.lineTo(center.x - 3, center.y - 14);
          graphic.lineTo(center.x - 2, center.y - 7);
          graphic.stroke({ width: 2.5, color: 0x3f7750, alpha: 0.95 });
        }
      }
      if (asset.category === "resort" && ["lodge", "hotel", "cottages", "spa"].includes(asset.kind)) {
        const structures = asset.kind === "cottages" ? Math.min(6, 2 + asset.tier) : 1;
        for (let index = 0; index < structures; index++) {
          const columns = structures > 3 ? 3 : structures;
          const wx = asset.x + asset.width * ((index % columns) + 0.5) / columns;
          const wy = asset.y + asset.height * (Math.floor(index / columns) + 0.55) / Math.ceil(structures / columns);
          const center = worldToIso(wx, wy, elevation, rotation);
          const structureWidth = asset.kind === "hotel" ? 34 + asset.tier * 5 : asset.kind === "lodge" ? 30 + asset.tier * 4 : asset.kind === "spa" ? 26 : 15;
          const structureHeight = asset.kind === "hotel" ? 24 + asset.tier * 7 : asset.kind === "lodge" ? 20 + asset.tier * 4 : 13 + asset.tier * 2;
          graphic.poly([
            center.x - structureWidth / 2, center.y - structureHeight,
            center.x, center.y - structureHeight - structureWidth * 0.22,
            center.x + structureWidth / 2, center.y - structureHeight,
            center.x + structureWidth / 2, center.y,
            center.x, center.y + structureWidth * 0.22,
            center.x - structureWidth / 2, center.y,
          ]);
          graphic.fill({ color: resortPalette.wall, alpha: asset.enabled ? 0.97 : 0.42 });
          graphic.stroke({ width: 1.4, color: 0x493c32, alpha: 0.8 });
          graphic.poly([
            center.x - structureWidth / 2 - 2, center.y - structureHeight,
            center.x, center.y - structureHeight - structureWidth * 0.25 - 3,
            center.x + structureWidth / 2 + 2, center.y - structureHeight,
            center.x, center.y - structureHeight + structureWidth * 0.22,
          ]);
          graphic.fill({ color: resortPalette.roof, alpha: asset.enabled ? 0.98 : 0.42 });
          graphic.stroke({ width: 1.2, color: resortPalette.accent, alpha: 0.85 });
          const windows = asset.kind === "hotel" ? Math.min(5, 2 + asset.tier) : 2;
          for (let windowIndex = 0; windowIndex < windows; windowIndex++) {
            const windowX = center.x - structureWidth * 0.32 + windowIndex * structureWidth * 0.64 / Math.max(1, windows - 1);
            graphic.roundRect(windowX - 1.8, center.y - structureHeight * 0.48, 3.6, 4.5, 0.7);
            graphic.fill({ color: 0x8fc5d6, alpha: asset.enabled ? 0.92 : 0.3 });
          }
        }
        const servicePressure = (props.resortOperations?.dirtyRooms ?? 0) + (props.resortOperations?.outOfOrderRooms ?? 0);
        if (servicePressure > 0) {
          for (let stripe = 0; stripe < 3; stripe++) {
            graphic.moveTo(corners[0].x + stripe * 8, corners[0].y - 5);
            graphic.lineTo(corners[0].x + stripe * 8 + 10, corners[0].y + 5);
          }
          graphic.stroke({ width: 2, color: 0xfff2c4, alpha: 0.95 });
        }
      }
      if (asset.kind === "shuttle") {
        const center = worldToIso(asset.x + asset.width / 2, asset.y + asset.height / 2, elevation, rotation);
        const destination = lodgingAssets[0];
        if (destination) {
          const target = worldToIso(destination.x + destination.width / 2, destination.y + destination.height / 2, getElevation(course, destination.x, destination.y), rotation);
          graphic.moveTo(center.x, center.y - 5);
          graphic.lineTo(target.x, target.y - 5);
          graphic.stroke({ width: 2, color: resortPalette.accent, alpha: 0.78 });
        }
        graphic.roundRect(center.x - 15, center.y - 15, 30, 13, 3);
        graphic.fill({ color: 0xf3e5bd, alpha: asset.enabled ? 0.98 : 0.38 });
        graphic.stroke({ width: 2, color: 0x314d58, alpha: 0.9 });
        for (let windowIndex = 0; windowIndex < 3; windowIndex++) {
          graphic.roundRect(center.x - 10 + windowIndex * 8, center.y - 12, 6, 5, 1);
          graphic.fill({ color: 0x79a9bb, alpha: 0.9 });
        }
        graphic.circle(center.x - 9, center.y - 1, 3);
        graphic.circle(center.x + 9, center.y - 1, 3);
        graphic.fill({ color: 0x2b2d2e, alpha: 0.95 });
      }
      if (!asset.enabled) {
        const center = worldToIso(asset.x + asset.width / 2, asset.y + asset.height / 2, elevation, rotation);
        graphic.moveTo(center.x - 10, center.y - 10);
        graphic.lineTo(center.x + 10, center.y + 10);
        graphic.moveTo(center.x + 10, center.y - 10);
        graphic.lineTo(center.x - 10, center.y + 10);
        graphic.stroke({ width: 3, color: 0xf3eee2, alpha: 0.95 });
      }
      if (asset.category === "practice" && asset.route?.points.length) {
        asset.route.points.forEach((point, index) => {
          const iso = worldToIso(point.x + 0.5, point.y + 0.5, elevation, rotation);
          if (index === 0) graphic.moveTo(iso.x, iso.y);
          else graphic.lineTo(iso.x, iso.y);
        });
        graphic.stroke({ width: 2 + asset.tier * 0.4, color: 0xf7e9a8, alpha: asset.enabled ? 0.9 : 0.35 });
        for (const station of asset.stations ?? []) {
          const iso = worldToIso(station.x + 0.5, station.y + 0.5, elevation, rotation);
          graphic.circle(iso.x, iso.y, station.kind === "target" ? 4 : 3);
          graphic.fill({ color: station.kind === "target" ? 0xe9b84b : 0xfff6d7, alpha: asset.enabled ? 0.95 : 0.35 });
        }
      }
      if (asset.kind === "parking" || asset.kind === "overflow_parking") {
        const cars = Math.min(7, asset.tier + 2);
        for (let index = 0; index < cars; index++) {
          const wx = asset.x + 0.8 + (index % 4) * Math.max(0.8, (asset.width - 1.6) / 4);
          const wy = asset.y + 0.8 + Math.floor(index / 4) * 1.2;
          const car = worldToIso(wx, wy, elevation, rotation);
          graphic.roundRect(car.x - 4, car.y - 2, 8, 4, 1);
          graphic.fill({ color: [0xe8d7a8, 0x7e9faf, 0xa46357][index % 3], alpha: asset.enabled ? 0.95 : 0.35 });
        }
      }
      if (asset.kind === "netting") {
        const from = worldToIso(asset.x, asset.y, elevation, rotation);
        const to = worldToIso(asset.x + asset.width, asset.y + asset.height, elevation, rotation);
        graphic.moveTo(from.x, from.y - 18 - asset.tier * 2);
        graphic.lineTo(to.x, to.y - 18 - asset.tier * 2);
        graphic.stroke({ width: 2, color: 0x355c3d, alpha: asset.condition });
      }
      if (asset.kind === "screening" || asset.kind === "safety_buffer") {
        const count = Math.min(12, 4 + asset.tier * 2);
        for (let index = 0; index < count; index++) {
          const wx = asset.x + asset.width * (index + 0.5) / count;
          const wy = asset.y + asset.height * (0.35 + (index % 2) * 0.3);
          const center = worldToIso(wx, wy, elevation, rotation);
          graphic.circle(center.x, center.y - 5 - (asset.coverageHeight ?? 4), 3.5 + asset.tier * 0.35);
          graphic.fill({ color: asset.kind === "screening" ? 0x2f663d : 0x4d7d48, alpha: asset.condition });
        }
      }
      if (asset.kind === "safety_fence" || asset.kind === "berm") {
        const from = worldToIso(asset.x, asset.y + asset.height / 2, elevation, rotation);
        const to = worldToIso(asset.x + asset.width, asset.y + asset.height / 2, elevation, rotation);
        graphic.moveTo(from.x, from.y - (asset.kind === "berm" ? 7 : 4));
        graphic.lineTo(to.x, to.y - (asset.kind === "berm" ? 7 : 4));
        graphic.stroke({ width: asset.kind === "berm" ? 7 : 2, color: asset.kind === "berm" ? 0x806a42 : 0x5c5d57, alpha: asset.condition });
      }
      if (asset.kind === "warning_signage") {
        const center = worldToIso(asset.x + asset.width / 2, asset.y + asset.height / 2, elevation, rotation);
        graphic.poly([center.x, center.y - 13, center.x - 6, center.y - 2, center.x + 6, center.y - 2]);
        graphic.fill({ color: 0xe6b942, alpha: asset.condition });
        graphic.stroke({ width: 1.5, color: 0x55472f, alpha: 0.9 });
      }
      if ((asset.constructionDaysRemaining ?? 0) > 0) {
        const first = worldToIso(asset.x, asset.y + asset.height, elevation, rotation);
        const second = worldToIso(asset.x + asset.width, asset.y, elevation, rotation);
        graphic.moveTo(first.x, first.y - 4);
        graphic.lineTo(second.x, second.y - 4);
        graphic.stroke({ width: 4, color: 0xe0a32f, alpha: 0.9 });
      }
      graphic.zIndex = (asset.x + asset.width + asset.y + asset.height) * 10 + 5;
      layers.objects.addChild(graphic);
      propertyGraphicsRef.current.push(graphic);
    }
  }, [appReady, course, props.resortOperations, rotation]);

  // Player Pro shot decision overlay. It is one retained container rebuilt
  // only when the decision changes, never per frame. Preview and animation
  // facts come from the same pure resolver used by the authoritative round.
  useEffect(() => {
    if (!appReady) return;
    const layers = layersRef.current;
    if (!layers) return;
    if (playerShotOverlayRef.current) {
      layers.fx.removeChild(playerShotOverlayRef.current);
      playerShotOverlayRef.current.destroy({ children: true });
      playerShotOverlayRef.current = null;
    }
    const round = props.playerRound;
    if (!round) return;
    const overlay = new PIXI.Container();
    overlay.label = "player-pro-shot-overlay";
    const graphics = new PIXI.Graphics();
    const ballElevation = getElevation(course, Math.round(round.ball.x), Math.round(round.ball.y));
    const ball = worldToIso(round.ball.x + 0.5, round.ball.y + 0.5, ballElevation, rotation);
    graphics.circle(ball.x, ball.y - 7, 7);
    graphics.fill({ color: 0xffd25b, alpha: 0.95 });
    graphics.stroke({ width: 2.5, color: 0x253c2b, alpha: 1 });
    graphics.circle(ball.x, ball.y - 7, 11);
    graphics.stroke({ width: 2, color: 0xfff0a0, alpha: 0.75 });

    if (props.playerShotAim && round.phase === "awaiting_shot") {
      const aimElevation = getElevation(course, Math.round(props.playerShotAim.x), Math.round(props.playerShotAim.y));
      const aim = worldToIso(props.playerShotAim.x + 0.5, props.playerShotAim.y + 0.5, aimElevation, rotation);
      graphics.moveTo(ball.x, ball.y - 7);
      graphics.lineTo(aim.x, aim.y - 5);
      graphics.stroke({ width: 2.2, color: 0xffe27a, alpha: 0.9 });
      graphics.ellipse(aim.x, aim.y - 5, TILE_W * 1.4, TILE_H * 1.1);
      graphics.fill({ color: 0xffd25b, alpha: 0.13 });
      graphics.stroke({ width: 2, color: 0x6f4e16, alpha: 0.9 });
      graphics.circle(aim.x, aim.y - 5, 3.5);
      graphics.fill({ color: 0xffffff, alpha: 0.95 });
    }

    const trace = round.pendingShot ?? round.shots[round.shots.length - 1];
    if (trace) {
      const from = worldToIso(trace.from.x + 0.5, trace.from.y + 0.5, getElevation(course, Math.round(trace.from.x), Math.round(trace.from.y)), rotation);
      const rest = worldToIso(trace.rest.x + 0.5, trace.rest.y + 0.5, getElevation(course, Math.round(trace.rest.x), Math.round(trace.rest.y)), rotation);
      graphics.moveTo(from.x, from.y - 5);
      graphics.lineTo(rest.x, rest.y - 5);
      graphics.stroke({ width: 2.5, color: trace.penaltyStrokes > 0 ? 0xc84a37 : 0xf7f0c2, alpha: 0.78 });
      graphics.circle(rest.x, rest.y - 5, 5);
      graphics.fill({ color: trace.penaltyStrokes > 0 ? 0xd34b39 : 0xffffff, alpha: 0.95 });
    }
    overlay.addChild(graphics);
    layers.fx.addChild(overlay);
    playerShotOverlayRef.current = overlay;
    return () => {
      if (playerShotOverlayRef.current === overlay) playerShotOverlayRef.current = null;
      overlay.parent?.removeChild(overlay);
      overlay.destroy({ children: true });
    };
  }, [appReady, course, props.playerRound, props.playerShotAim, rotation]);

  // Estate ownership veil and survey boundaries (M25). A single batched
  // Graphics object keeps the expanded 220x140 map inexpensive to inspect.
  useEffect(() => {
    if (!appReady) return;
    const layers = layersRef.current;
    if (!layers) return;
    const stale = layers.terrainDecals.children.filter((child) => child.label === ESTATE_LABEL);
    stale.forEach((child) => { layers.terrainDecals.removeChild(child); child.destroy(); });
    const estate = course.estate;
    if (!estate) return;
    const map = decodeParcelMap(estate, course.width * course.height);
    if (!map) return;
    const selectedIndex = estate.parcels.findIndex((parcel) => parcel.id === props.selectedParcelId);
    const owned = new Set(estate.ownedParcelIds);
    const fill = new PIXI.Graphics();
    const boundary = new PIXI.Graphics();
    const boundaryColor = props.colorVision === "tritanopia" ? 0xff4f8b : props.colorVision === "protanopia" ? 0x3f9cff : 0xffd45a;
    const diamond = (graphics: PIXI.Graphics, x: number, y: number) => {
      const top = worldToIso(x + 0.5, y, course.elevations[y * course.width + x] ?? 0, rotation);
      graphics.poly([top.x, top.y, top.x + TILE_W / 2, top.y + TILE_H / 2, top.x, top.y + TILE_H, top.x - TILE_W / 2, top.y + TILE_H / 2]);
    };
    for (let y = 0; y < course.height; y++) for (let x = 0; x < course.width; x++) {
      const index = y * course.width + x;
      const parcelIndex = map[index];
      const parcel = estate.parcels[parcelIndex];
      const selected = parcelIndex === selectedIndex && props.surveyMode;
      if (!owned.has(parcel.id) || selected) {
        diamond(fill, x, y);
        fill.fill({ color: selected ? boundaryColor : 0x111820, alpha: selected ? .2 : props.surveyMode ? .08 : .22 });
      }
      if (props.surveyMode) {
        const differs = x === 0 || y === 0 || x === course.width - 1 || y === course.height - 1 || map[index - 1] !== parcelIndex || map[index + 1] !== parcelIndex || map[index - course.width] !== parcelIndex || map[index + course.width] !== parcelIndex;
        if (differs) { diamond(boundary, x, y); boundary.stroke({ width: selected ? 2.4 : 1.2, color: selected ? boundaryColor : owned.has(parcel.id) ? 0x75dc87 : 0xf4eee0, alpha: selected ? .95 : .58 }); }
      }
    }
    fill.label = ESTATE_LABEL; boundary.label = ESTATE_LABEL;
    fill.eventMode = "none"; boundary.eventMode = "none";
    layers.terrainDecals.addChild(fill, boundary);
  }, [appReady, course.elevations, course.estate, course.height, course.width, props.colorVision, props.selectedParcelId, props.surveyMode, rotation]);

  // ---------------------------------------------------------------------
  // Objects layer — player-authored furniture, bridges, and boardwalks
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!appReady) return;
    const layers = layersRef.current;
    if (!layers) return;
    for (const entry of decorationSpritesRef.current) {
      entry.sprite.parent?.removeChild(entry.sprite);
      entry.shadow.parent?.removeChild(entry.shadow);
      entry.sprite.destroy();
      entry.shadow.destroy();
    }
    decorationSpritesRef.current = [];

    for (const decoration of course.decorations ?? []) {
      const visual = decorationVisual(decoration, course.theme ?? "parkland");
      const fallback = decorationVisual(decoration, "parkland");
      const texture = getPropFrame(visual.frame as AtlasFrame) ?? getPropFrame(fallback.frame as AtlasFrame);
      if (!texture) continue;
      const tiles = decorationTiles(decoration);
      const xs = tiles.map((tile) => tile.x);
      const ys = tiles.map((tile) => tile.y);
      const minX = Math.min(...xs); const maxX = Math.max(...xs);
      const minY = Math.min(...ys); const maxY = Math.max(...ys);
      const elevation = getElevation(course, decoration.x, decoration.y);
      const placement = placeObject({ x: minX, y: minY, w: maxX - minX + 1, d: maxY - minY + 1 }, elevation, rotation);
      const sprite = new PIXI.Sprite(texture);
      sprite.anchor.set(visual.anchor[0], visual.anchor[1]);
      sprite.position.set(placement.position.x, placement.position.y);
      const structure = decoration.kind === "bridge" || decoration.kind === "boardwalk";
      const logicalWidth = structure ? Math.max(2, tiles.length * .72) * TILE_W : TILE_W * visual.scale;
      sprite.width = logicalWidth;
      sprite.height = logicalWidth * texture.height / texture.width;
      if ((decoration.rotation + rotation) % 2 === 1) sprite.scale.x *= -1;
      sprite.zIndex = placement.zIndex + .05;
      sprite.eventMode = "none";
      layers.objects.addChild(sprite);

      const shadow = new PIXI.Graphics();
      shadow.ellipse(0, 0, structure ? logicalWidth * .38 : visual.shadow.radiusX, visual.shadow.radiusY);
      shadow.fill({ color: 0x000000, alpha: visual.shadow.alpha });
      shadow.position.set(placement.position.x + 3, placement.position.y - TILE_H / 2 + 2);
      shadow.eventMode = "none";
      layers.terrainDecals.addChild(shadow);
      decorationSpritesRef.current.push({ sprite, shadow });
    }
  }, [appReady, course, rotation]);

  // ---------------------------------------------------------------------
  // Decals layer — tee/green markers (incl. wizard drafts) + route overlays
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!appReady) return;
    const layers = layersRef.current;
    if (!layers) return;

    const stale = layers.terrainDecals.children.filter((c) => c.label === MARKER_LABEL);
    stale.forEach((c) => {
      layers.terrainDecals.removeChild(c);
      c.destroy();
    });
    if (props.showMarkers === false) return;

    const drawMarker = (p: Point, fill: number, alpha = 1) => {
      const g = new PIXI.Graphics();
      const c = tileCenterIso(p.x, p.y, getElevation(course, p.x, p.y), rotation);
      g.ellipse(c.x, c.y, TILE_W * 0.18, TILE_H * 0.36);
      g.fill({ color: fill, alpha });
      g.stroke({ width: 2, color: 0xffffff, alpha });
      g.label = MARKER_LABEL;
      layers.terrainDecals.addChild(g);
    };

    // Tee box (ZKU-149): pad diamond + two tee markers set perpendicular to
    // the shot direction (toward the green).
    const drawTee = (tee: Point, green: Point | null, alpha = 1) => {
      const g = new PIXI.Graphics();
      const e = getElevation(course, tee.x, tee.y);
      const c = tileCenterIso(tee.x, tee.y, e, rotation);
      g.ellipse(c.x, c.y, TILE_W * 0.3, TILE_H * 0.3);
      g.fill({ color: 0x9a7a58, alpha: 0.9 * alpha });
      // Perpendicular offset in world space, projected.
      let px = 0.7;
      let py = -0.7;
      if (green) {
        const dx = green.x - tee.x;
        const dy = green.y - tee.y;
        const len = Math.max(1e-6, Math.hypot(dx, dy));
        px = -dy / len;
        py = dx / len;
      }
      for (const side of [-0.28, 0.28]) {
        const m = worldToIso(tee.x + 0.5 + px * side, tee.y + 0.5 + py * side, e, rotation);
        g.circle(m.x, m.y - 2, 2.2);
        g.fill({ color: 0xe8c15a, alpha });
        g.stroke({ width: 1, color: 0x6b5426, alpha });
      }
      g.label = MARKER_LABEL;
      layers.terrainDecals.addChild(g);
    };

    // Cup (ZKU-149): small dark hole with a light rim on the green tile.
    const drawCup = (green: Point, alpha = 1) => {
      const g = new PIXI.Graphics();
      const c = tileCenterIso(green.x, green.y, getElevation(course, green.x, green.y), rotation);
      g.ellipse(c.x, c.y, 4.5, 2.2);
      g.fill({ color: 0x1c2b1c, alpha });
      g.stroke({ width: 1, color: 0xe9efe4, alpha: 0.85 * alpha });
      g.label = MARKER_LABEL;
      layers.terrainDecals.addChild(g);
    };

    holes.forEach((hole) => {
      const activeRotation = course.activePinRotation ?? "A";
      const activePin = getPinPosition(hole, activeRotation) ?? getPinPosition(hole, "A");
      TEE_SETS.forEach((set) => {
        const tee = getTeeBox(hole, set);
        if (tee) drawTee(tee, activePin, set === (props.selectedTeeSet ?? "member") ? 1 : 0.34);
      });
      PIN_ROTATIONS.forEach((pinRotation) => {
        const pin = getPinPosition(hole, pinRotation);
        if (pin) drawCup(pin, pinRotation === activeRotation || (!getPinPosition(hole, activeRotation) && pinRotation === "A") ? 1 : 0.28);
      });
    });
    if (draftTee) drawTee(draftTee, draftGreen, 0.55);
    if (draftGreen) drawMarker(draftGreen, 0x1b5e20, 0.55);
  }, [appReady, holes, draftTee, draftGreen, course, rotation, props.showMarkers, props.selectedTeeSet]);

  useEffect(() => {
    if (!appReady) return;
    const layers = layersRef.current;
    if (!layers) return;

    const stale = layers.terrainDecals.children.filter((c) => c.label === ROUTE_LABEL);
    stale.forEach((c) => {
      layers.terrainDecals.removeChild(c);
      c.destroy();
    });
    if (props.showMarkers === false) return;

    // Architect Report overlay: warnings remain advisory and use both shape
    // and color so crossings/transfers stay legible in color-vision modes.
    if (props.architectureWarnings?.length) {
      const g = new PIXI.Graphics();
      const warningPoint = (point: Point) => {
        const x = Math.max(0, Math.min(course.width - 1, Math.round(point.x)));
        const y = Math.max(0, Math.min(course.height - 1, Math.round(point.y)));
        return tileCenterIso(point.x, point.y, getElevation(course, x, y), rotation);
      };
      for (const warning of props.architectureWarnings) {
        const points = warning.geometry?.length ? warning.geometry : warning.location ? [warning.location] : [];
        if (points.length > 1) {
          const first = warningPoint(points[0]);
          g.moveTo(first.x, first.y);
          for (let index = 1; index < points.length; index++) {
            const point = points[index];
            const projected = warningPoint(point);
            g.lineTo(projected.x, projected.y);
          }
          g.stroke({ width: warning.severity === "warning" ? 4 : 2, color: 0xf3a712, alpha: .86 });
        }
        if (warning.location) {
          const projected = warningPoint(warning.location);
          g.circle(projected.x, projected.y, warning.severity === "warning" ? 8 : 5);
          g.stroke({ width: 3, color: 0x3f2200, alpha: .95 });
          g.circle(projected.x, projected.y, warning.severity === "warning" ? 5 : 3);
          g.fill({ color: 0xffc857, alpha: .95 });
        }
      }
      g.label = ROUTE_LABEL;
      layers.terrainDecals.addChild(g);
    }

    if (props.architectureOverlay) {
      const g = new PIXI.Graphics();
      const project = (point: Point) => {
        const x = Math.max(0, Math.min(course.width - 1, Math.round(point.x)));
        const y = Math.max(0, Math.min(course.height - 1, Math.round(point.y)));
        return tileCenterIso(point.x, point.y, getElevation(course, x, y), rotation);
      };
      for (const cell of props.architectureOverlay.cells) {
        const top = worldToIso(cell.x + 0.5, cell.y, getElevation(course, Math.round(cell.x), Math.round(cell.y)), rotation);
        const intensity = Math.min(1, 0.22 + Math.log2(cell.value + 1) * 0.16);
        g.poly([
          top.x, top.y,
          top.x + TILE_W / 2, top.y + TILE_H / 2,
          top.x, top.y + TILE_H,
          top.x - TILE_W / 2, top.y + TILE_H / 2,
        ]);
        g.fill({
          color: cell.current ? 0xf0a51a : 0x7b6aa8,
          alpha: cell.current ? intensity : Math.min(0.48, intensity),
        });
        if (!cell.current) g.stroke({ width: 1, color: 0xf6e8ff, alpha: 0.75 });
      }
      for (const trace of props.architectureOverlay.traces) {
        const from = project(trace.from);
        const to = project(trace.to);
        g.moveTo(from.x, from.y);
        g.lineTo(to.x, to.y);
        g.stroke({
          width: trace.emphasized ? 5 : 2.5,
          color: trace.emphasized ? 0xfff08a : trace.current ? 0x29d7c0 : 0x9a7bc1,
          alpha: trace.current ? 0.9 : 0.6,
        });
        g.circle(to.x, to.y, trace.emphasized ? 6 : 3);
        g.fill({ color: trace.current ? 0x29d7c0 : 0x9a7bc1, alpha: 0.9 });
      }
      for (const point of props.architectureOverlay.points) {
        const projected = project(point);
        const radius = Math.min(13, Math.max(4, 4 + Math.abs(point.value) * 0.35));
        g.circle(projected.x, projected.y, radius);
        g.fill({ color: point.current ? 0x36cfc9 : 0x8d77b7, alpha: 0.35 });
        g.stroke({ width: 2, color: point.current ? 0xeafffb : 0xf1e9ff, alpha: 0.9 });
      }
      g.label = ROUTE_LABEL;
      layers.terrainDecals.addChild(g);
    }

    if (props.paceBottlenecks?.length) {
      const g = new PIXI.Graphics();
      for (const finding of props.paceBottlenecks) {
        const hole = holes.find((candidate) => candidate.id === finding.holeId);
        const point = hole ? getPinPosition(hole, course.activePinRotation ?? "A") ?? hole.green ?? hole.tee : null;
        if (!point) continue;
        const center = tileCenterIso(point.x, point.y, getElevation(course, point.x, point.y), rotation);
        const radius = Math.min(18, 8 + finding.intensity * 0.6);
        const color = finding.severity === "severe" ? 0xd8563a : finding.severity === "high" ? 0xe7a83e : 0xf2d36f;
        g.circle(center.x, center.y, radius);
        g.fill({ color, alpha: 0.18 });
        g.stroke({ width: finding.severity === "severe" ? 4 : 2.5, color, alpha: 0.95 });
        // Radial ticks keep severity/intensity legible when hue differences
        // disappear under a color-vision palette.
        const ticks = finding.severity === "severe" ? 6 : finding.severity === "high" ? 4 : 2;
        for (let index = 0; index < ticks; index++) {
          const angle = (Math.PI * 2 * index) / ticks;
          g.moveTo(center.x + Math.cos(angle) * (radius + 2), center.y + Math.sin(angle) * (radius + 2));
          g.lineTo(center.x + Math.cos(angle) * (radius + 7), center.y + Math.sin(angle) * (radius + 7));
        }
        g.stroke({ width: 2, color: 0xffffff, alpha: 0.92 });
      }
      g.label = ROUTE_LABEL;
      layers.terrainDecals.addChild(g);
    }

    // Failing-corridor overlay: red translucent diamonds.
    if (showFixOverlay && failingCorridorSegments && failingCorridorSegments.length > 0) {
      const g = new PIXI.Graphics();
      for (const seg of failingCorridorSegments) {
        const top = worldToIso(seg.x + 0.5, seg.y, getElevation(course, seg.x, seg.y), rotation);
        g.poly([
          top.x, top.y,
          top.x + TILE_W / 2, top.y + TILE_H / 2,
          top.x, top.y + TILE_H,
          top.x - TILE_W / 2, top.y + TILE_H / 2,
        ]);
        g.fill({ color: 0xd23b2f, alpha: 0.35 });
      }
      g.label = ROUTE_LABEL;
      layers.terrainDecals.addChild(g);
    }

    // Active-hole route polyline.
    if (showShotPlan && activePath && activePath.length > 1) {
      const g = new PIXI.Graphics();
      const pathPoint = (pt: Point) =>
        tileCenterIso(pt.x, pt.y, getElevation(course, pt.x, pt.y), rotation);
      const first = pathPoint(activePath[0]);
      g.moveTo(first.x, first.y);
      for (let i = 1; i < activePath.length; i++) {
        const p = pathPoint(activePath[i]);
        g.lineTo(p.x, p.y);
      }
      g.stroke({ width: 2, color: 0xffffff, alpha: 0.75 });
      g.label = ROUTE_LABEL;
      layers.terrainDecals.addChild(g);
    }
  }, [appReady, showFixOverlay, failingCorridorSegments, showShotPlan, activePath, course, holes, rotation, props.showMarkers, props.architectureWarnings, props.architectureOverlay, props.paceBottlenecks]);

  // ---------------------------------------------------------------------
  // Ticker pass — hover highlight/line + live golfer dots
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!appReady) return;
    const app = appRef.current;
    const layers = layersRef.current;
    if (!app || !layers) return;

    if (!hoverHighlightRef.current) {
      const g = new PIXI.Graphics();
      layers.terrainDecals.addChild(g);
      hoverHighlightRef.current = g;
    }
    if (!hoverLineRef.current) {
      const line = new PIXI.Graphics();
      layers.screenOverlay.addChild(line);
      hoverLineRef.current = line;
    }


    const tick = (ticker: PIXI.Ticker) => {
      const dtMs = ticker.deltaMS;
      const nowMs = performance.now();

      // Perf HUD (ZKU-160): poll the flag ~1/s; section marks are zero-cost
      // when disabled.
      const perf = perfRef.current;
      if (nowMs - perf.lastPollMs > 1000) {
        perf.lastPollMs = nowMs;
        perf.enabled = localStorage.getItem("coursecraft_perfhud") === "on";
        if (perf.enabled && !perf.text) {
          const t = new PIXI.Text({
            text: "",
            style: {
              fontFamily: "monospace",
              fontSize: 11,
              fill: 0xffffff,
              stroke: { color: 0x000000, width: 3 },
              lineHeight: 15,
            },
          });
          t.position.set(8, 8);
          layers.screenOverlay.addChild(t);
          perf.text = t;
        } else if (!perf.enabled && perf.text) {
          layers.screenOverlay.removeChild(perf.text);
          perf.text.destroy();
          perf.text = null;
          perf.win.reset();
        }
      }
      if (perf.enabled) perf.sections = {};
      let perfLast = perf.enabled ? performance.now() : 0;
      const perfMark = (name: string) => {
        if (!perf.enabled) return;
        const t = performance.now();
        perf.sections[name] = (perf.sections[name] ?? 0) + (t - perfLast);
        perfLast = t;
      };
      // Hover visuals only redraw when dirty.
      if (overlayDirtyRef.current) {
        overlayDirtyRef.current = false;

        const highlight = hoverHighlightRef.current;
        const hover = hoverTileRef.current;
        if (highlight) {
          highlight.clear();
          if (hover) {
            const outlineTile = (tx: number, ty: number, alpha: number) => {
              const top = worldToIso(tx + 0.5, ty, getElevation(course, tx, ty), rotation);
              highlight.poly([
                top.x, top.y,
                top.x + TILE_W / 2, top.y + TILE_H / 2,
                top.x, top.y + TILE_H,
                top.x - TILE_W / 2, top.y + TILE_H / 2,
              ]);
              highlight.stroke({ width: 2, color: 0xffffff, alpha });
            };
            const strokePreview = terrainStrokePreviewRef.current;
            if (editorMode === "PAINT" && strokePreview) {
              for (const tile of strokePreview.tiles) outlineTile(tile.x, tile.y, 0.82);
            } else if (editorMode === "SCULPT" && props.sculptRadius && props.sculptRadius > 1) {
              // Brush footprint preview (matches brushFootprint in sculpt.ts).
              const r = props.sculptRadius - 0.5;
              for (let ty = hover.y - props.sculptRadius; ty <= hover.y + props.sculptRadius; ty++) {
                for (let tx = hover.x - props.sculptRadius; tx <= hover.x + props.sculptRadius; tx++) {
                  if (tx < 0 || ty < 0 || tx >= course.width || ty >= course.height) continue;
                  const d2 = (tx - hover.x) ** 2 + (ty - hover.y) ** 2;
                  if (d2 <= r * r + 1e-9) outlineTile(tx, ty, tx === hover.x && ty === hover.y ? 0.9 : 0.45);
                }
              }
            } else if (editorMode === "DECOR" && props.selectedDecorationKind) {
              const preview = decorationTiles({
                kind: props.selectedDecorationKind,
                x: hover.x,
                y: hover.y,
                rotation: props.decorationRotation ?? 0,
                ...((props.selectedDecorationKind === "bridge" || props.selectedDecorationKind === "boardwalk") ? { span: props.decorationSpan ?? 3 } : {}),
              });
              for (const tile of preview) if (tile.x >= 0 && tile.y >= 0 && tile.x < course.width && tile.y < course.height) outlineTile(tile.x, tile.y, .75);
            } else {
              outlineTile(hover.x, hover.y, 0.9);
            }
          }
        }

        const line = hoverLineRef.current;
        if (line) {
          line.clear();
          const isGreenPlacement = wizardStep === "GREEN" || wizardStep === "MOVE_GREEN";
          if (isGreenPlacement && hover) {
            const hole = holes[activeHoleIndex];
            const fromPoint = hole?.tee || draftTee;
            if (fromPoint) {
              const from = worldPointToScreen(
                fromPoint.x + 0.5,
                fromPoint.y + 0.5,
                getElevation(course, fromPoint.x, fromPoint.y)
              );
              const to = worldPointToScreen(
                hover.x + 0.5,
                hover.y + 0.5,
                getElevation(course, hover.x, hover.y)
              );
              line.moveTo(from.x, from.y);
              line.lineTo(to.x, to.y);
              line.stroke({ width: 2, color: 0x6496ff, alpha: 0.6 });
            }
          }
        }
      }

      // Pin flags (ZKU-149): one pole+flag per placed green, depth-sorted
      // with the world; the cloth flutters on a time-based wave (static
      // first frame when animations are off).
      const flags = flagPoolRef.current;
      const liveHoles = new Set<number>();
      const flagColor = props.flagColor ?? "#d9534f";
      holes.forEach((hole, hi) => {
        if (!hole.green) return;
        liveHoles.add(hi);
        let g = flags.get(hi);
        if (!g) {
          g = new PIXI.Graphics();
          layers.objects.addChild(g);
          flags.set(hi, g);
        }
        const e = getElevation(course, hole.green.x, hole.green.y);
        const c = tileCenterIso(hole.green.x, hole.green.y, e, rotation);
        g.position.set(c.x, c.y);
        const z = entityDepth(hole.green.x + 0.5, hole.green.y + 0.5, e, rotation) + 0.05;
        if (g.zIndex !== z) g.zIndex = z;
        const phase = props.animationsEnabled ? performance.now() / 160 + hi * 1.3 : 0;
        g.clear();
        // pole
        g.moveTo(0, 0);
        g.lineTo(0, -34);
        g.stroke({ width: 1.5, color: 0xe9efe4 });
        // cloth: triangle with a fluttering tip
        const w1 = Math.sin(phase) * 2.2;
        const w2 = Math.sin(phase + 0.9) * 3.2;
        g.poly([0, -34, 13, -30.5 + w1, 0, -26]);
        g.fill(flagColor);
        g.poly([9, -31.5 + w1 * 0.8, 13, -30.5 + w1, 15.5, -29.5 + w2, 9, -29]);
        g.fill({ color: flagColor, alpha: 0.85 });
      });
      for (const [hi, g] of flags) {
        if (!liveHoles.has(hi)) {
          layers.objects.removeChild(g);
          g.destroy();
          flags.delete(hi);
        }
      }

      // Water shimmer + shore foam (ZKU-150): throttled tint/alpha
      // oscillation over the chunk-registered water sprites; visible chunks
      // only; rare bright glints from a positional hash. Snaps back to the
      // static base when animations are turned off.
      perfMark("hover+flags");
      const waterAnim = waterAnimRef.current;
      if (props.animationsEnabled && props.waterAnimation) {
        if (nowMs - waterAnim.last > 140) {
          waterAnim.last = nowMs;
          waterAnim.wasAnimating = true;
          const t = nowMs / 1000;
          const bucket = Math.floor(nowMs / 700);
          for (const chunk of chunksRef.current) {
            if (!chunk.container.visible) continue;
            for (const ws of chunk.waterSprites) {
              let f = 1 + 0.05 * Math.sin(t * 1.6 + ws.phase);
              if ((ws.gx * 31 + ws.gy * 57 + bucket) % 89 === 0) f = 1.22; // glint
              ws.sprite.tint = shade(ws.baseTint, f);
            }
            for (const fs of chunk.foamSprites) {
              fs.sprite.alpha = 0.16 + 0.14 * (0.5 + 0.5 * Math.sin(t * 2.1 + fs.phase));
            }
          }
          for (const ws of surfaceWaterSpritesRef.current) {
            let f = 1 + 0.05 * Math.sin(t * 1.6 + ws.phase);
            if ((ws.gx * 31 + ws.gy * 57 + bucket) % 89 === 0) f = 1.22;
            ws.sprite.tint = shade(ws.baseTint, f);
          }
        }
      } else if (waterAnim.wasAnimating) {
        waterAnim.wasAnimating = false;
        for (const chunk of chunksRef.current) {
          for (const ws of chunk.waterSprites) ws.sprite.tint = ws.baseTint;
          for (const fs of chunk.foamSprites) fs.sprite.alpha = 0.26;
        }
        for (const ws of surfaceWaterSpritesRef.current) ws.sprite.tint = ws.baseTint;
      }

      // Wind sway (ZKU-151): subtle skew oscillation on tree canopies.
      if (props.animationsEnabled && props.treeSway) {
        const t = nowMs / 1000;
        for (const entry of obstacleSpritesRef.current.values()) {
          if (entry.swayPhase === null || !entry.sway) continue;
          entry.sprite.skew.x = Math.sin(t * entry.sway.speed + entry.swayPhase) * entry.sway.amplitude;
        }
      } else {
        for (const entry of obstacleSpritesRef.current.values()) {
          if (entry.swayPhase !== null && entry.sprite.skew.x !== 0) entry.sprite.skew.x = 0;
        }
      }

      // Tall-prop selection/follow occlusion: any canopy whose screen-space
      // silhouette sits directly in front of the selected golfer fades,
      // preserving both the person and selection ring at every rotation.
      const selectedGolfer = props.selectedGolferId == null
        ? null
        : golfersRef?.current?.find((golfer) => golfer.id === props.selectedGolferId) ?? null;
      const selectedIso = selectedGolfer
        ? tileCenterIso(
            selectedGolfer.x,
            selectedGolfer.y,
            getElevation(course, Math.floor(selectedGolfer.x + 0.5), Math.floor(selectedGolfer.y + 0.5)),
            rotation
          )
        : null;
      for (const entry of obstacleSpritesRef.current.values()) {
        const blocksSelection = selectedIso ? shouldFadeTallProp({
          tall: entry.tall,
          propX: entry.sprite.position.x,
          propY: entry.sprite.position.y,
          propWidth: entry.sprite.width,
          propHeight: entry.sprite.height,
          focusX: selectedIso.x,
          focusY: selectedIso.y,
        }) : false;
        entry.sprite.alpha = blocksSelection ? entry.fadeAlpha : 1;
      }

      perfMark("water+sway");

      // ---------------------------------------------------------------
      // Ambient world life (ZKU-156). Time-of-day-shaped effects run off
      // the game clock (scales with sim speed); micro-motion is real-time.
      // ---------------------------------------------------------------
      const amb = ambientRef.current;
      const ambientOn = props.ambienceFx && props.animationsEnabled;
      const dayMin = dayMinuteRef.current;
      // Continuous ambient clock: accumulates game minutes across days (no
      // rewind at day rollover); drifts at 1x-equivalent in the editor.
      if (dayMin !== undefined && amb.prevDayMinute !== null) {
        const d = dayMin - amb.prevDayMinute;
        amb.clockMin += d > 0 ? d : dayMin >= 0 ? Math.max(0, dayMin) : 0;
      } else if (dayMin === undefined) {
        amb.clockMin += (dtMs / 1000) * 3;
      }
      if (dayMin !== undefined) amb.prevDayMinute = dayMin;

      // Time-of-day tint: lerp toward the target so nothing ever pops.
      const quad = amb.tintQuad;
      if (quad) {
        const target = ambientOn ? timeOfDayTint(dayMin ?? 420) : 0xffffff;
        const k = 1 - Math.exp(-dtMs / 600);
        const cur = amb.tintCur;
        cur.r += (((target >> 16) & 0xff) - cur.r) * k;
        cur.g += (((target >> 8) & 0xff) - cur.g) * k;
        cur.b += ((target & 0xff) - cur.b) * k;
        const tint =
          (Math.round(cur.r) << 16) | (Math.round(cur.g) << 8) | Math.round(cur.b);
        quad.tint = tint;
        quad.visible = tint !== 0xffffff;
        if (quad.visible && app) {
          quad.width = app.screen.width;
          quad.height = app.screen.height;
        }
      }

      // Cloud shadows drift on a constant wind, wrapping the course.
      for (let i = 0; i < amb.clouds.length; i++) {
        const cloud = amb.clouds[i];
        cloud.visible = ambientOn;
        if (!ambientOn) continue;
        const p = cloudPos(amb.clockMin, i, course.width, course.height);
        const iso = worldToIso(p.x, p.y, 0, rotation);
        cloud.position.set(iso.x, iso.y);
      }

      // Grass shimmer: a soft light band sweeping with the sway wind phase.
      const shimmer = amb.shimmer;
      if (shimmer) {
        const span = (course.width + course.height) * 1.6; // sparse passes
        const sweep = ((nowMs / 1000) * 1.1 * 2.2) % span; // sway time base
        const sx = sweep - 20;
        const inCourse = sx > -12 && sx < course.width + 12;
        shimmer.visible = ambientOn && inCourse;
        if (shimmer.visible) {
          const iso = worldToIso(sx, course.height / 2, 0, rotation);
          shimmer.position.set(iso.x, iso.y);
        }
      }

      // Birds: a flock crosses the sky every few in-game hours.
      const birdG = amb.birdG;
      if (birdG && app) {
        const bc = birdCrossing(dayMin ?? -1);
        birdG.clear();
        if (ambientOn && bc.active) {
          const sw = app.screen.width;
          const sh = app.screen.height;
          const leftToRight = bc.index % 2 === 0;
          const yBase = sh * (0.18 + ((bc.index * 37) % 40) / 100);
          const x0 = leftToRight ? -50 : sw + 50;
          const x1 = leftToRight ? sw + 50 : -50;
          const flap = Math.floor(nowMs / 150) % 2 === 0 ? -2.4 : 2.2;
          for (let b = 0; b < 4; b++) {
            const lag = b * 0.035;
            const t = Math.max(0, Math.min(1, bc.t - lag));
            const bx = x0 + (x1 - x0) * t + (b % 2) * 14 - 7;
            const by =
              yBase + b * 9 + Math.sin(nowMs / 700 + b * 1.7) * 3 + (x1 - x0 > 0 ? t : -t) * 40;
            birdG.moveTo(bx - 4.5, by + flap);
            birdG.lineTo(bx, by);
            birdG.lineTo(bx + 4.5, by + flap);
            birdG.stroke({ width: 1.5, color: 0x2f2f2a, alpha: 0.7 });
          }
        }
      }

      // Heron: perches on the nearest shoreline; startled by ZKU-154
      // landings (see the touchdown block), flies off, later returns.
      const heron = amb.heron;
      if (heron.g) {
        if (heron.forCourse !== course) {
          heron.forCourse = course;
          heron.spot = heronSpot(course);
          heron.state = "standing";
          drawHeron(heron.g, false);
        }
        const hg = heron.g;
        if (!ambientOn || !heron.spot) {
          hg.visible = false;
        } else if (heron.state === "standing") {
          const e = getElevation(course, heron.spot.x, heron.spot.y);
          const c = tileCenterIso(heron.spot.x, heron.spot.y, e, rotation);
          hg.position.set(c.x, c.y + Math.sin(nowMs / 1100) * 0.4);
          hg.zIndex = entityDepth(heron.spot.x, heron.spot.y, e, rotation);
          hg.alpha = 1;
          hg.visible = true;
        } else if (heron.state === "flying") {
          const t = (nowMs - heron.flyT0) / 1400;
          if (t >= 1) {
            heron.state = "gone";
            heron.respawnAt = nowMs + 45_000;
            hg.visible = false;
          } else {
            const e = getElevation(course, heron.spot.x, heron.spot.y);
            const c = tileCenterIso(heron.spot.x, heron.spot.y, e, rotation);
            hg.position.set(c.x + t * 90, c.y - t * 70);
            hg.alpha = 1 - t * t;
            hg.visible = true;
          }
        } else if (heron.state === "gone" && nowMs > heron.respawnAt) {
          heron.state = "standing";
          drawHeron(heron.g, false);
        }
      }

      perfMark("ambient");

      // Splash ripples: expanding rings where a ball landed in water. Kept
      // on even with animations off — it communicates a penalty event.
      if (!rippleGraphicsRef.current) {
        const rg = new PIXI.Graphics();
        layers.fx.addChild(rg);
        rippleGraphicsRef.current = rg;
      }
      const rg = rippleGraphicsRef.current;
      rg.clear();
      if (ripplesRef.current.length > 0) {
        ripplesRef.current = ripplesRef.current.filter((r) => nowMs - r.t0 < 750);
        for (const r of ripplesRef.current) {
          const rt = (nowMs - r.t0) / 750;
          const c = tileCenterIso(r.x, r.y, 0, rotation); // water is base level
          const radius = 4 + rt * 12;
          rg.ellipse(c.x, c.y, radius, radius / 2);
          rg.stroke({ width: 1.5 * (1 - rt) + 0.5, color: 0xe9f4ff, alpha: 0.8 * (1 - rt) });
          if (rt < 0.3) {
            rg.circle(c.x, c.y - 2, 2.5 * (1 - rt / 0.3));
            rg.fill({ color: 0xffffff, alpha: 0.7 });
          }
        }
      }

      // Touchdown particles (ZKU-154): short bursts keyed to the surface the
      // ball hit. Deterministic per-particle offsets from the impact index.
      if (impactsRef.current.length > 0) {
        impactsRef.current = impactsRef.current.filter((p) => nowMs - p.t0 < 600);
        for (const p of impactsRef.current) {
          const pt = (nowMs - p.t0) / 600;
          const c = tileCenterIso(p.x, p.y, p.e, rotation);
          const fade = 1 - pt;
          if (p.kind === "sand") {
            for (let i = 0; i < 6; i++) {
              const a = (i / 6) * Math.PI * 2 + 0.5;
              const r = 2 + pt * 9;
              rg.circle(c.x + Math.cos(a) * r, c.y - 2 - pt * 7 + Math.sin(a) * r * 0.4, 1.6 * fade + 0.4);
              rg.fill({ color: 0xd7c48a, alpha: 0.85 * fade });
            }
          } else if (p.kind === "grass") {
            for (let i = 0; i < 4; i++) {
              const a = (i / 4) * Math.PI * 2 + 1.1;
              const r = 1.5 + pt * 6;
              rg.circle(c.x + Math.cos(a) * r, c.y - 1 - pt * 5 + Math.sin(a) * r * 0.4, 1.1 * fade + 0.3);
              rg.fill({ color: 0x3e8a44, alpha: 0.8 * fade });
            }
          } else {
            // Green check-up: a small white skid tick that fades quickly.
            rg.ellipse(c.x, c.y - 1, 3.5 * fade + 1, 1.4 * fade + 0.4);
            rg.stroke({ width: 1, color: 0xffffff, alpha: 0.8 * fade });
          }
        }
      }

      perfMark("fx");

      // Live golfers/balls: pooled per-golfer objects in the depth-sorted
      // objects layer so props occlude them correctly (ZKU-140). Character
      // sprites (ZKU-153) when the golfers atlas is loaded; legacy dots
      // otherwise.
      const pool = golferPoolRef.current;
      const list = liveActive && props.showGolfers !== false ? golfersRef?.current : null;
      const seen = new Set<number>();
      const golferById = new Map<number, GolferRenderData>();
      // Entity culling bounds (ZKU-160): golfers outside the viewport skip
      // all animation/texture work, mirroring the chunk culler. Disabled
      // during the rotation tween (bounds don't model the spin).
      let cullL = -Infinity;
      let cullR = Infinity;
      let cullT = -Infinity;
      let cullB = Infinity;
      const worldCull = layers.world;
      if (worldCull.rotation === 0 && app) {
        const m = 96;
        const halfW = app.screen.width / 2 / worldCull.scale.x;
        const halfH = app.screen.height / 2 / worldCull.scale.y;
        cullL = worldCull.pivot.x - halfW - m;
        cullR = worldCull.pivot.x + halfW + m;
        cullT = worldCull.pivot.y - halfH - m;
        cullB = worldCull.pivot.y + halfH + m;
      }
      if (list) {
        for (const golfer of list) {
          seen.add(golfer.id);
          let entry = pool.get(golfer.id);
          if (!entry) {
            const holder = new PIXI.Container();
            const ball = new PIXI.Graphics();
            ball.circle(0, -2, 2.2);
            ball.fill(0xffffff);
            ball.stroke({ width: 0.8, color: 0x555555 });
            ball.visible = false;
            // Ball ground shadow (ZKU-154): in the decals layer so it hugs
            // the terrain under every object.
            const ballShadow = new PIXI.Graphics();
            ballShadow.ellipse(0, 0, 3.2, 1.5);
            ballShadow.fill({ color: 0x000000, alpha: 0.4 });
            ballShadow.visible = false;
            layers.terrainDecals.addChild(ballShadow);
            layers.objects.addChild(holder, ball);
            entry = {
              holder,
              ball,
              ballShadow,
              lastBall: null,
              prevBallIso: null,
              ballLanded: false,
              emote: {
                lastScored: golfer.scoredHoles,
                prevMood: golfer.mood,
                feeChecked: false,
                lastPos: { x: golfer.x, y: golfer.y },
                stillSinceMs: nowMs,
              },
              sprite: null,
              dot: null,
            };
            if (golfersAtlasReady()) {
              // Drop shadow at the feet, then selection ring, then the two
              // sprite layers (base colors + tinted grayscale clothing).
              const shadow = new PIXI.Graphics();
              shadow.ellipse(1.5, 0.8, 8, 3.4);
              shadow.fill({ color: 0x000000, alpha: 0.18 });
              const ring = new PIXI.Graphics();
              ring.visible = false;
              const scale = GOLFER_DISPLAY_W / GOLFER_FRAME_W;
              const base = new PIXI.Sprite();
              base.anchor.set(0.5, GOLFER_FEET_Y / GOLFER_FRAME_H);
              base.scale.set(scale);
              const tintLayer = new PIXI.Sprite();
              tintLayer.anchor.set(0.5, GOLFER_FEET_Y / GOLFER_FRAME_H);
              tintLayer.scale.set(scale);
              tintLayer.tint = golferTint(golfer.color, golfer.id);
              holder.addChild(shadow, ring, base, tintLayer);
              entry.sprite = {
                shadow,
                ring,
                base,
                tintLayer,
                variant: golferVariant(golfer.archetype, golfer.id),
                tint: tintLayer.tint,
                lastFrame: "",
                walkPhase: 0,
                lastPos: null,
                dirX: golfer.dirX,
                dirY: golfer.dirY,
                reaction: null,
                reactionUntil: 0,
                lastScored: golfer.scoredHoles,
              };
            } else {
              const body = new PIXI.Graphics();
              holder.addChild(body);
              entry.dot = { body, lastColor: "", lastMoodBucket: -1 };
            }
            pool.set(golfer.id, entry);
          }
          golferById.set(golfer.id, golfer);

          // --- Emote bubble triggers (ZKU-155): edges from observable
          // render facts; the scheduler enforces cap + cooldowns.
          const em = entry.emote;
          const isSel = props.selectedGolferId === golfer.id;
          const showEmote = (kind: EmoteKind | null) => {
            if (kind && tryShowEmote(emoteSchedulerRef.current, golfer.id, kind, nowMs, isSel)) {
              recordEmote(golfer.id, kind, nowMs);
            }
          };
          if (Math.hypot(golfer.x - em.lastPos.x, golfer.y - em.lastPos.y) > 1e-4) {
            em.lastPos = { x: golfer.x, y: golfer.y };
            em.stillSinceMs = nowMs;
            simMovingAtRef.current = nowMs;
          }
          if (golfer.scoredHoles > em.lastScored) {
            em.lastScored = golfer.scoredHoles;
            showEmote(holeOutEmote(golfer.lastHoleDelta));
          }
          showEmote(moodEmote(em.prevMood, golfer.mood));
          em.prevMood = golfer.mood;
          if (!em.feeChecked) {
            em.feeChecked = true;
            // Walk-in fee opinion — only for golfers actually starting out.
            if (golfer.scoredHoles === 0) showEmote(feeEmote(course.baseGreenFee, golfer.id));
          }
          // Zzz: standing dead-still while the rest of the sim moves.
          if (
            golfer.segKind !== "flight" &&
            !golfer.shot &&
            nowMs - em.stillSinceMs > EMOTE_STALL_MS &&
            nowMs - simMovingAtRef.current < 400
          ) {
            em.stillSinceMs = nowMs; // re-arm; the cooldown gates repeats
            showEmote("zzz");
          }

          // Position + entity culling first: an offscreen golfer keeps its
          // trigger bookkeeping (above) but skips all visual work.
          const ge = getElevation(course, Math.floor(golfer.x + 0.5), Math.floor(golfer.y + 0.5));
          const c = tileCenterIso(golfer.x, golfer.y, ge, rotation);
          entry.holder.position.set(c.x, c.y);
          const offscreen = c.x < cullL || c.x > cullR || c.y < cullT || c.y > cullB;
          entry.holder.visible = !offscreen;
          if (!offscreen) {
            // Quantize the depth key so the container only re-sorts when the
            // golfer crosses a meaningful slice of a tile row, not per frame.
            const z = Math.round(entityDepth(golfer.x, golfer.y, ge, rotation) * 10) / 10;
            if (entry.holder.zIndex !== z) entry.holder.zIndex = z;
          }

          if (!offscreen && entry.sprite) {
            const sp = entry.sprite;
            // Hole-out reactions: a scored-holes tick means "just holed out".
            if (golfer.scoredHoles > sp.lastScored) {
              sp.lastScored = golfer.scoredHoles;
              const r = reactionFor(golfer.lastHoleDelta);
              if (r) {
                sp.reaction = r;
                sp.reactionUntil = nowMs + REACTION_SEC * 1000;
              }
            }
            if (sp.reaction && nowMs >= sp.reactionUntil) sp.reaction = null;
            // Stride phase advances with actual ground covered, so the walk
            // cycle tracks every sim speed for free.
            if (golfer.segKind === "walk" && sp.lastPos) {
              sp.walkPhase +=
                Math.hypot(golfer.x - sp.lastPos.x, golfer.y - sp.lastPos.y) *
                WALK_STRIDES_PER_TILE;
            }
            sp.lastPos = { x: golfer.x, y: golfer.y };
            // Keep the last real facing through pauses; stored in world space
            // so camera rotation re-resolves it naturally.
            if (golfer.dirX !== 0 || golfer.dirY !== 0) {
              sp.dirX = golfer.dirX;
              sp.dirY = golfer.dirY;
            }
            const pose = golferPose({
              segKind: golfer.segKind,
              segT: golfer.segT,
              shot: golfer.shot,
              facingOct: facingOctant(sp.dirX, sp.dirY, rotation),
              walkPhase: props.animationsEnabled ? sp.walkPhase : 0,
              timeSec: props.animationsEnabled ? nowMs / 1000 : 0,
              reaction: sp.reaction,
            });
            const frame = golferFrameName(sp.variant, pose, false);
            if (frame !== sp.lastFrame) {
              sp.lastFrame = frame;
              const baseTex = getGolferFrame(frame);
              const tintTex = getGolferFrame(golferFrameName(sp.variant, pose, true));
              if (baseTex) sp.base.texture = baseTex;
              if (tintTex) sp.tintLayer.texture = tintTex;
            }
            // Mirror can flip while the frame name stays put (sw→se keeps
            // the same row), so apply it outside the frame-change guard.
            const flip = pose.mirror ? -1 : 1;
            if (Math.sign(sp.base.scale.x) !== flip) {
              sp.base.scale.x = Math.abs(sp.base.scale.x) * flip;
              sp.tintLayer.scale.x = Math.abs(sp.tintLayer.scale.x) * flip;
            }
            // Selection ring (ZKU-134): pulsing ellipse under the feet.
            const isSelected = props.selectedGolferId === golfer.id;
            if (isSelected) {
              const pulse = 1 + Math.sin(nowMs * 0.006) * 0.12;
              sp.ring.clear();
              sp.ring.ellipse(0, 0, 11 * pulse, 5.5 * pulse);
              sp.ring.stroke({ width: 1.8, color: 0xffffff, alpha: 0.95 });
              sp.ring.visible = true;
            } else if (sp.ring.visible) {
              sp.ring.visible = false;
            }
          } else if (!offscreen && entry.dot) {
            // Legacy dot tier: redraw only when color or mood bucket changes.
            const dot = entry.dot;
            const moodBucket = Math.round(Math.max(0, Math.min(1, golfer.mood)) * 10);
            if (dot.lastColor !== golfer.color || dot.lastMoodBucket !== moodBucket) {
              dot.lastColor = golfer.color;
              dot.lastMoodBucket = moodBucket;
              const body = dot.body;
              body.clear();
              body.ellipse(0, 0, 7, 3.2); // ground shadow at the feet
              body.fill({ color: 0x000000, alpha: 0.2 });
              body.circle(0, -7, 5.5);
              body.fill(golfer.color);
              body.stroke({ width: 1.5, color: `hsl(${moodBucket * 12}, 80%, 45%)` });
            }
          }

          if (golfer.ballX != null && golfer.ballY != null) {
            // Ball flight 2.0 (ZKU-154): the render layer replaces the sim's
            // straight ground track with an arc + shadow + bounce/roll
            // profile, all driven by segment progress so game speed scales
            // it and it converges on the sim's rest point exactly.
            const from = { x: golfer.x, y: golfer.y };
            const to =
              golfer.ballToX != null && golfer.ballToY != null
                ? { x: golfer.ballToX, y: golfer.ballToY }
                : { x: golfer.ballX, y: golfer.ballY };
            const distTiles = Math.hypot(to.x - from.x, to.y - from.y);
            const restTx = Math.floor(to.x + 0.5);
            const restTy = Math.floor(to.y + 0.5);
            const restTerrain =
              restTx >= 0 && restTy >= 0 && restTx < course.width && restTy < course.height
                ? course.tiles[restTy * course.width + restTx]
                : null;
            const behavior = landingBehavior(restTerrain);
            const shot = golfer.shot ?? "swing";
            let gx = golfer.ballX;
            let gy = golfer.ballY;
            let heightPx = 0;
            let shadowK = 1;
            let hidden = false;
            if (props.animationsEnabled && golfer.segKind === "flight") {
              const pose = ballFlightPose(golfer.segT, distTiles, shot, behavior);
              gx = from.x + (to.x - from.x) * pose.groundFrac;
              gy = from.y + (to.y - from.y) * pose.groundFrac;
              heightPx = pose.heightPx;
              shadowK = pose.shadow;
              hidden = pose.hidden;
              // Touchdown FX, once per flight, on the surface actually hit.
              if (pose.landed && !entry.ballLanded) {
                entry.ballLanded = true;
                if (behavior.fx === "splash") {
                  ripplesRef.current.push({ x: to.x, y: to.y, t0: nowMs });
                } else if (behavior.fx) {
                  const e = getElevation(course, restTx, restTy);
                  impactsRef.current.push({ kind: behavior.fx, x: gx, y: gy, e, t0: nowMs });
                }
                // Hazard drama bubble (ZKU-155).
                showEmote(hazardEmote(behavior.fx));
                // Startle the shoreline heron (ZKU-156).
                const heron2 = ambientRef.current.heron;
                if (
                  heron2.state === "standing" &&
                  heron2.spot &&
                  heron2.g &&
                  Math.hypot(to.x - heron2.spot.x, to.y - heron2.spot.y) < HERON_STARTLE_TILES
                ) {
                  heron2.state = "flying";
                  heron2.flyT0 = nowMs;
                  drawHeron(heron2.g, true);
                }
              }
            }
            const be = getElevation(course, Math.floor(gx + 0.5), Math.floor(gy + 0.5));
            const ground = tileCenterIso(gx, gy, be, rotation);
            entry.ball.position.set(ground.x, ground.y - heightPx);
            const bz = Math.round(entityDepth(gx, gy, be, rotation) * 10) / 10;
            if (entry.ball.zIndex !== bz) entry.ball.zIndex = bz;
            entry.ball.visible = !hidden;
            // Shadow hugs the terrain under the ball and fades as it climbs.
            entry.ballShadow.position.set(ground.x, ground.y);
            entry.ballShadow.scale.set(0.55 + 0.45 * shadowK);
            entry.ballShadow.alpha = 0.45 + 0.55 * shadowK;
            entry.ballShadow.visible = !hidden && heightPx >= 0 && shadowK > 0;
            // Comet trail while airborne (drawn into the shared fx pass).
            if (props.animationsEnabled && heightPx > 2 && entry.prevBallIso && rippleGraphicsRef.current) {
              const rgTrail = rippleGraphicsRef.current;
              rgTrail.moveTo(entry.prevBallIso.x, entry.prevBallIso.y);
              rgTrail.lineTo(ground.x, ground.y - heightPx);
              rgTrail.stroke({ width: 1.2, color: 0xffffff, alpha: 0.3 });
            }
            entry.prevBallIso = heightPx > 2 ? { x: ground.x, y: ground.y - heightPx } : null;
            entry.lastBall = { x: golfer.ballX, y: golfer.ballY };
          } else {
            // Flight over. With animations on, touchdown FX already fired at
            // the landing moment; the legacy end-of-flight water ripple
            // (ZKU-150) still covers the animations-off path.
            if (entry.lastBall) {
              if (!props.animationsEnabled) {
                const tx = Math.floor(entry.lastBall.x + 0.5);
                const ty = Math.floor(entry.lastBall.y + 0.5);
                if (
                  tx >= 0 && ty >= 0 && tx < course.width && ty < course.height &&
                  (course.tiles[ty * course.width + tx] === "water" || course.tiles[ty * course.width + tx] === "wetland")
                ) {
                  ripplesRef.current.push({ x: entry.lastBall.x, y: entry.lastBall.y, t0: performance.now() });
                }
              }
              entry.lastBall = null;
            }
            entry.ballLanded = false;
            entry.prevBallIso = null;
            entry.ball.visible = false;
            entry.ballShadow.visible = false;
          }
          // M7 live-view follow: hold the selected golfer through the whole
          // round, switching to the ball while it is airborne.
          if (props.followSelected && props.selectedGolferId === golfer.id) {
            const cam = camRef.current;
            const targetX = golfer.segKind === "flight" && golfer.ballX != null ? golfer.ballX : golfer.x;
            const targetY = golfer.segKind === "flight" && golfer.ballY != null ? golfer.ballY : golfer.y;
            const clamped = clampCenter(targetX, targetY);
            cam.tcx = clamped.x;
            cam.tcy = clamped.y;
          }
        }
      }
      // Retire golfers who finished/left.
      for (const [id, entry] of pool) {
        if (!seen.has(id)) {
          layers.objects.removeChild(entry.holder, entry.ball);
          layers.terrainDecals.removeChild(entry.ballShadow);
          entry.holder.destroy({ children: true });
          entry.ball.destroy();
          entry.ballShadow.destroy();
          pool.delete(id);
          forgetGolfer(id);
        }
      }

      // --- Emote bubble pass (ZKU-155): screen overlay, fixed screen size
      // (clamped anchor height), fanned out horizontally on collisions.
      const sched = emoteSchedulerRef.current;
      pruneEmotes(sched, nowMs, seen);
      const bubbles = emoteSpritesRef.current;
      for (const [id, cont] of bubbles) {
        if (!sched.active.some((e) => e.golferId === id)) {
          layers.screenOverlay.removeChild(cont);
          cont.destroy({ children: true });
          bubbles.delete(id);
        }
      }
      if (sched.active.length > 0) {
        const zoomScale = layers.world.scale.x;
        const headPx = Math.max(16, Math.min(64, 42 * zoomScale));
        const anchors = sched.active.map((e) => {
          const g = golferById.get(e.golferId);
          if (!g) return { x: -9999, y: -9999 };
          const ge2 = getElevation(course, Math.floor(g.x + 0.5), Math.floor(g.y + 0.5));
          const p = worldPointToScreen(g.x + 0.5, g.y + 0.5, ge2);
          return { x: p.x, y: p.y - headPx };
        });
        const offsets = resolveOverlaps(anchors);
        for (let i = 0; i < sched.active.length; i++) {
          const e = sched.active[i];
          let cont = bubbles.get(e.golferId);
          if (!cont) {
            cont = buildEmoteBubble(e.kind);
            layers.screenOverlay.addChild(cont);
            bubbles.set(e.golferId, cont);
          }
          const pres = emotePresentation(nowMs - e.t0);
          cont.position.set(anchors[i].x + offsets[i], anchors[i].y - pres.rise);
          cont.scale.set(pres.scale);
          cont.alpha = pres.alpha;
          cont.visible = anchors[i].x > -9000;
        }
      }

      // Perf HUD: fold this frame in and refresh the readout ~4x/s.
      if (perf.enabled) {
        perfMark("golfers+emotes");
        perf.win.push({ totalMs: dtMs, sections: perf.sections });
        if (nowMs - perf.lastHudMs > 250) {
          perf.lastHudMs = nowMs;
          const s = perf.win.summary();
          let visibleChunks = 0;
          for (const ch of chunksRef.current) if (ch.container.visible) visibleChunks++;
          let work = 0;
          for (const v of Object.values(s.sections)) work += v;
          const info = {
            fps: s.fps,
            meanMs: s.meanMs,
            p95Ms: s.p95Ms,
            maxMs: s.maxMs,
            workMs: work,
            sections: s.sections,
            golfers: golferPoolRef.current.size,
            bubbles: emoteSpritesRef.current.size,
            chunksVisible: visibleChunks,
            chunksTotal: chunksRef.current.length,
            objects: layers.objects.children.length,
          };
          (window as unknown as { __ccPerf?: object }).__ccPerf = info;
          if (perf.text) {
            const secStr = Object.entries(s.sections)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => `${k} ${v.toFixed(2)}`)
              .join("  ");
            perf.text.text =
              `${s.fps.toFixed(0)} fps  mean ${s.meanMs.toFixed(2)}ms  p95 ${s.p95Ms.toFixed(2)}ms  max ${s.maxMs.toFixed(1)}ms\n` +
              `tick work ${work.toFixed(2)}ms  chunks ${visibleChunks}/${chunksRef.current.length}  golfers ${golferPoolRef.current.size}  bubbles ${emoteSpritesRef.current.size}  objects ${layers.objects.children.length}\n` +
              secStr;
          }
        }
      }
    };

    app.ticker.add(tick);
    return () => {
      app.ticker?.remove(tick);
    };
  }, [appReady, wizardStep, holes, activeHoleIndex, draftTee, worldPointToScreen, golfersRef, liveActive, course, rotation, editorMode, props.sculptRadius, props.selectedDecorationKind, props.decorationRotation, props.decorationSpan, props.animationsEnabled, props.ambienceFx, props.waterAnimation, props.treeSway, props.flagColor, props.selectedGolferId, props.followSelected, props.showGolfers, clampCenter]);

  // ---------------------------------------------------------------------
  // Input — pointer events through the inverse camera transform
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!appReady) return;
    const app = appRef.current;
    if (!app) return;
    const pointerSurface = containerRef.current;
    if (!pointerSurface) return;

    const updateCursor = (t: { x: number; y: number } | null) => {
      const el = containerRef.current;
      if (!el) return;
      let cursor = "crosshair";
      if (t && editorMode === "PAINT" && selectedTerrain && worldCash !== undefined) {
        const prevTerrain = course.tiles[t.y * course.width + t.x];
        const cost = computeTerrainChangeCost(prevTerrain, selectedTerrain);
        if (cost.net > 0 && worldCash < cost.net) cursor = "not-allowed";
      }
      el.style.cursor = cursor;
    };

    const cancelTerrainStroke = () => {
      terrainStrokeRef.current = null;
      terrainStrokePreviewRef.current = null;
      setTerrainStrokePreview(null);
      overlayDirtyRef.current = true;
    };

    const beginTerrainStroke = (point: Point, pointerId: number) => {
      if (!onPreviewTerrainStroke) return;
      const points = [point];
      terrainStrokeRef.current = {
        pointerId,
        points,
        last: point,
      };
      const preview = onPreviewTerrainStroke(points);
      terrainStrokePreviewRef.current = preview;
      setTerrainStrokePreview(preview);
      overlayDirtyRef.current = true;
    };

    const extendTerrainStroke = (point: Point, pointerId: number) => {
      const stroke = terrainStrokeRef.current;
      if (!stroke || stroke.pointerId !== pointerId || !onPreviewTerrainStroke) return;
      const nextPoints = resampleWorldLine(stroke.last, point);
      if (nextPoints.length === 0) return;
      stroke.points.push(...nextPoints);
      if (stroke.points.length > 2048) {
        stroke.points = stroke.points.filter((_, index) => index % 2 === 0 || index === stroke.points.length - 1);
      }
      stroke.last = point;
      const preview = onPreviewTerrainStroke(stroke.points);
      terrainStrokePreviewRef.current = preview;
      setTerrainStrokePreview(preview);
      overlayDirtyRef.current = true;
    };

    const finishTerrainStroke = (pointerId: number) => {
      const stroke = terrainStrokeRef.current;
      if (!stroke || stroke.pointerId !== pointerId) return;
      terrainStrokeRef.current = null;
      terrainStrokePreviewRef.current = null;
      setTerrainStrokePreview(null);
      overlayDirtyRef.current = true;
      onCommitTerrainStroke?.(stroke.points);
    };

    const canvasPoint = (event: PointerEvent): Point | null => {
      const rect = app.canvas.getBoundingClientRect();
      return screenToWorldPoint(
        (event.clientX - rect.left) * app.screen.width / rect.width,
        (event.clientY - rect.top) * app.screen.height / rect.height
      );
    };

    // Paint gestures use native pointer capture. Capturing before Pixi's
    // federated event layer also guarantees release/cancel delivery when the
    // pointer leaves the canvas or crosses an overlay.
    const handleCanvasPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || props.playableShotMode || editorMode !== "PAINT" || !selectedTerrain || !onPreviewTerrainStroke || !onCommitTerrainStroke) return;
      if (flyoverRef.current) return;
      const point = canvasPoint(event);
      if (!point) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      beginTerrainStroke(point, event.pointerId);
      try { pointerSurface.setPointerCapture(event.pointerId); } catch { /* synthetic/legacy pointer */ }
    };

    const handleCanvasPointerMove = (event: PointerEvent) => {
      if (!terrainStrokeRef.current || terrainStrokeRef.current.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const point = canvasPoint(event);
      if (point) extendTerrainStroke(point, event.pointerId);
    };

    const handleCanvasPointerUp = (event: PointerEvent) => {
      if (!terrainStrokeRef.current || terrainStrokeRef.current.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const point = canvasPoint(event);
      if (point) extendTerrainStroke(point, event.pointerId);
      finishTerrainStroke(event.pointerId);
      try {
        if (pointerSurface.hasPointerCapture(event.pointerId)) pointerSurface.releasePointerCapture(event.pointerId);
      } catch { /* capture may already be released */ }
    };

    const handleCanvasPointerCancel = (event: PointerEvent) => {
      if (terrainStrokeRef.current?.pointerId !== event.pointerId) return;
      event.stopImmediatePropagation();
      cancelTerrainStroke();
    };

    const handlePointerDown = (e: PIXI.FederatedPointerEvent) => {
      if (e.button !== 0) return; // middle/right are camera pan, not editing
      // During a flyover, editor input is suspended — a click skips it.
      if (flyoverRef.current) {
        endFlyover();
        return;
      }
      // In the global view, clicking a golfer selects them instead of
      // painting (ZKU-134 parity). Iso-plane distance against each golfer's
      // projected position keeps the hit test elevation-correct.
      if (props.showGolfers !== false && onPickGolfer && !cameraState && liveActive && golfersRef?.current?.length) {
        const iso = screenToIsoPlane(e.global.x, e.global.y);
        if (iso) {
          let bestId: number | null = null;
          let bestD = TILE_W * 0.45; // ~0.9 tiles, matches the canvas picker
          for (const g of golfersRef.current) {
            const ge = getElevation(course, Math.floor(g.x + 0.5), Math.floor(g.y + 0.5));
            const c = tileCenterIso(g.x, g.y, ge, rotation);
            // Compensate the 2:1 vertical squash so the radius is circular
            // in tile space.
            const d = Math.hypot(iso.x - c.x, (iso.y - c.y) * 2);
            if (d < bestD) {
              bestD = d;
              bestId = g.id;
            }
          }
          if (bestId != null) {
            onPickGolfer(bestId);
            return;
          }
        }
      }
      const t = screenToTile(e.global.x, e.global.y);
      if (!t) return;
      if (editorMode === "PAINT" && !props.playableShotMode) return; // handled by native captured pointer events above
      onClickTile(t.x, t.y);
    };

    const handleMove = (e: PIXI.FederatedPointerEvent) => {
      const t = screenToTile(e.global.x, e.global.y);
      const prev = hoverTileRef.current;
      hoverTileRef.current = t;
      if (prev?.x !== t?.x || prev?.y !== t?.y) {
        overlayDirtyRef.current = true;
        updateCursor(t);
      }
    };

    const handlePointerUp = (e: PIXI.FederatedPointerEvent) => {
      if (editorMode !== "PAINT") return;
      finishTerrainStroke(e.pointerId);
    };

    const handlePointerCancel = (e: PIXI.FederatedPointerEvent) => {
      const stroke = terrainStrokeRef.current;
      if (stroke && stroke.pointerId === e.pointerId) cancelTerrainStroke();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && terrainStrokeRef.current) cancelTerrainStroke();
    };

    const stage = app.stage;
    stage.on("pointerdown", handlePointerDown);
    stage.on("pointermove", handleMove);
    stage.on("pointerup", handlePointerUp);
    stage.on("pointerupoutside", handlePointerUp);
    stage.on("pointercancel", handlePointerCancel);
    pointerSurface.addEventListener("pointerdown", handleCanvasPointerDown, true);
    pointerSurface.addEventListener("pointermove", handleCanvasPointerMove, true);
    pointerSurface.addEventListener("pointerup", handleCanvasPointerUp, true);
    pointerSurface.addEventListener("pointercancel", handleCanvasPointerCancel, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      stage.off("pointerdown", handlePointerDown);
      stage.off("pointermove", handleMove);
      stage.off("pointerup", handlePointerUp);
      stage.off("pointerupoutside", handlePointerUp);
      stage.off("pointercancel", handlePointerCancel);
      pointerSurface.removeEventListener("pointerdown", handleCanvasPointerDown, true);
      pointerSurface.removeEventListener("pointermove", handleCanvasPointerMove, true);
      pointerSurface.removeEventListener("pointerup", handleCanvasPointerUp, true);
      pointerSurface.removeEventListener("pointercancel", handleCanvasPointerCancel, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [appReady, screenToTile, screenToWorldPoint, screenToIsoPlane, onClickTile, onPreviewTerrainStroke, onCommitTerrainStroke, editorMode, selectedTerrain, worldCash, course, rotation, cameraState, onPickGolfer, liveActive, golfersRef, endFlyover, props.showGolfers, props.playableShotMode]);

  return (
    <div
      className={`cc-pixi-stage cc-tool-${props.playableShotMode ? "player-shot" : editorMode.toLowerCase()}`}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          overflow: "hidden",
          cursor: "crosshair",
          touchAction: "none",
        }}
      />
      {rendererError && (
        <div
          data-testid="course-renderer-error"
          role="alert"
          style={{
            position: "absolute",
            inset: 24,
            display: "grid",
            placeContent: "center",
            padding: 24,
            borderRadius: 14,
            background: "rgba(35, 47, 38, 0.94)",
            color: "#f7f1de",
            textAlign: "center",
            zIndex: 30,
          }}
        >
          <strong style={{ fontSize: 18 }}>{t("renderer.error.title")}</strong>
          <span style={{ marginTop: 8 }}>{t("renderer.error.body")}</span>
        </div>
      )}
      {terrainStrokePreview && selectedTerrain && (
        <div
          data-testid="terrain-stroke-preview"
          role="status"
          aria-live="polite"
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            minWidth: 250,
            padding: "12px 14px",
            borderRadius: 10,
            pointerEvents: "none",
            color: "#f7f1de",
            background: terrainStrokePreview.affordable ? "rgba(22,30,22,0.94)" : "rgba(92,24,20,0.96)",
            border: `1px solid ${terrainStrokePreview.affordable ? "rgba(242,232,201,0.35)" : "#ff9b86"}`,
            boxShadow: "0 8px 28px rgba(0,0,0,0.42)",
            fontSize: 12,
            lineHeight: 1.45,
            zIndex: 20,
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 14, textTransform: "capitalize" }}>
            {t("terrainStroke.title", { terrain: selectedTerrain.replaceAll("_", " "), count: terrainStrokePreview.changedCount })}
          </div>
          <div>{t("terrainStroke.costs", { gross: formatCurrency(terrainStrokePreview.gross), salvage: formatCurrency(terrainStrokePreview.salvage) })}</div>
          <div style={{ fontWeight: 700 }}>
            {t("terrainStroke.net", { net: terrainStrokePreview.net >= 0 ? formatCurrency(terrainStrokePreview.net) : t("terrainStroke.refund", { amount: formatCurrency(-terrainStrokePreview.net) }) })}
          </div>
          <div>{t("terrainStroke.cash", { cash: formatCurrency(terrainStrokePreview.cash), projected: formatCurrency(terrainStrokePreview.projectedCash) })}</div>
          {(terrainStrokePreview.excludedCount > 0 || terrainStrokePreview.unchangedCount > 0 || terrainStrokePreview.duplicateCount > 0) && (
            <div style={{ opacity: 0.82 }}>
              {t("terrainStroke.exclusions", { excluded: terrainStrokePreview.excludedCount, unchanged: terrainStrokePreview.unchangedCount, duplicates: terrainStrokePreview.duplicateCount })}
            </div>
          )}
          {!terrainStrokePreview.affordable && (
            <div style={{ marginTop: 4, fontWeight: 800 }}>
              {t("terrainStroke.insufficient", { shortfall: formatCurrency(terrainStrokePreview.shortfall) })}
            </div>
          )}
          <div style={{ opacity: 0.65, marginTop: 3 }}>{t("terrainStroke.instructions")}</div>
        </div>
      )}
      {flyoverCard && (
        <div
          style={{
            position: "absolute",
            bottom: 118, // clear of the live-controls bar
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(22,30,22,0.86)",
            color: "#f2e8c9",
            padding: "10px 26px",
            borderRadius: 12,
            border: "1px solid rgba(242,232,201,0.25)",
            textAlign: "center",
            pointerEvents: "none",
            letterSpacing: "0.08em",
            fontFamily: "var(--font-heading, Georgia, serif)",
            boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
          }}
        >
          <div style={{ fontSize: 21, fontWeight: 700 }}><T id="auto.ui.pixistage.hole" />{flyoverCard.hole}</div>
          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
            <T id="auto.ui.pixistage.par" />{flyoverCard.par} · {flyoverCard.yards} <T id="auto.ui.pixistage.yds" /></div>
          <div style={{ fontSize: 10, opacity: 0.55, marginTop: 4 }}><T id="auto.ui.pixistage.click.or.esc.to.skip" /></div>
        </div>
      )}
    </div>
  );
}
