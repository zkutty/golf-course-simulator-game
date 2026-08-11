import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// Pixi's strict-CSP adapter replaces runtime-generated shader/uniform
// functions with static implementations. Keep this before renderer startup so
// Workers deployments can retain a script-src policy without 'unsafe-eval'.
import "pixi.js/unsafe-eval";
import * as PIXI from "pixi.js";
import type { Course, DecorationKind, DecorationRotation, Hole, Obstacle, Point, SurfaceFeature, TeeSet, Terrain, TerrainAuthoringTool } from "../game/models/types";
import type { ShotPlanStep } from "../game/sim/shots/solveShotsToGreen";
import type { GolferRenderData } from "../game/live/types";
import { mobilityRenderUnits } from "../game/m51/mobilityRender";
import type { PlayerPlayableRound, PlayerProPoint } from "../game/models/playerProTypes";
import type { SeasonName } from "../game/seasons/types";
import type { SeasonalVisualState } from "../game/presentation/seasonalVisualState";
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
import {
  atlasActivationSnapshot,
  atlasFallbackDiagnostics,
  atlasResidencySnapshot,
  getGolferFrame,
  getLandscapeMaterialField,
  getPropFrame,
  getTerrainDetailFrame,
  getTerrainFrame,
  golfersAtlasReady,
  loadAtlases,
  supersedePendingAtlasLoad,
  type AtlasRenderContext,
} from "../render/atlas";
import type { TerrainStrokePreview } from "../game/models/terrainStroke";
import type {
  FineGreenBrush,
  FineGreenRadius,
  FineGreenSculptPreview,
} from "../game/greens/fineGreenSculpt";
import { buildGreenSurfaceOverlayCommands } from "../game/greens/greenSurfaceRender";
import {
  defaultSurfaceTangents,
  sampleCorridor,
  sampleRegion,
  withDefaultSurfaceTangents,
} from "../game/models/surfaceIntent";
import { formatCurrency } from "../i18n/format";
import type { MessageKey } from "../i18n/catalog";
import { useI18n } from "../i18n/useI18n";
import { ELEVATION_MAX, getElevation } from "../game/models/elevation";
import { entityDepth, frontCorner, placeObject } from "../game/render/objectPlacement";
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
import { FLYOVER_DURATION_MS, buildFlyoverKeys, sampleFlyover, type FlyoverKey } from "../game/render/flyover";
import { PerfWindow } from "../game/render/perfStats";
import { recordM35Metric } from "../game/render/m35Telemetry";
import {
  MAX_ACTIVE_IMPACTS,
  MAX_ACTIVE_RIPPLES,
  appendBoundedEffect,
} from "../game/render/worldEffects";
import { computeAutoPar, computeHoleDistanceTiles } from "../game/sim/holeMetrics";
import {
  decorationTiles,
  decorationVisual,
  normalizedDecoration,
} from "../game/models/decorations";
import { getBiomeDefinition } from "../game/models/biomes";
import {
  plantDefinition,
  resolvedDecorationPlantId,
} from "../game/models/plantRegistry";
import { getPinPosition, getTeeBox, PIN_ROTATIONS, TEE_SETS } from "../game/models/courseSetup";
import type { ArchitectureReferencePlan } from "../game/architecture/referencePlan";
import type { AtlasFrame } from "../render/atlas";
import { AUTOTILE_DIRECTIONS, autotileFeatures, rotateAutotileMask } from "../game/render/autotile";
import {
  TERRAIN_KINDS,
  getTerrainMaterial,
  mowingShadeAt,
  pickTerrainBaseFrame,
  terrainBoundaryFor,
  terrainTransitionFrame,
  waterShimmerPhase,
} from "../game/render/terrainMaterials";
import { deriveGroundCover, visibleGroundCoverTier } from "../game/render/groundCover";
import { deriveTerrainDetail } from "../game/render/terrainDetails";
import {
  seasonalTerrainTreatment,
  type SeasonalTerrainTreatment,
} from "../game/render/seasonalTerrainPresentation";
import { hillReliefStrength, terrainReliefStyle, terrainSurfaceInsetPx } from "../game/render/terrainRelief";
import {
  buildLandscapeComponents,
  buildVisualHeightfield,
  createLandscapeComponentCache,
  pointInLandscapeRing,
  ringSignedArea,
  sampleLandscapeSurfaceHeight,
  sampleVisualHeight,
  type LandscapeComponent,
} from "../game/render/landscapeGeometry";
import {
  buildLandscapeBoundaryRuns,
  buildShoreRockPlacements,
  landscapeEdgeStyle,
} from "../game/render/landscapeEdges";
import {
  buildBunkerVisualRings,
  classifyBunkerVisualType,
} from "../game/render/bunkerShapes";
import {
  pickNaturalProp,
} from "../game/render/naturalProps";
import {
  seasonalDecorationPlantForm,
  seasonalPlantClimate,
  seasonalPlantPresentation,
  seasonalPlantSceneSignature,
} from "../game/render/seasonalPlants";
import { isWaterHazard } from "../game/models/terrainRules";
import { T } from "../i18n/T";
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
  scenicNaturalTerrain,
  type CoastEdge,
  type ScenicPatchKind,
} from "../game/render/scenicSurround";
import type { PaceAdvisorFinding } from "../game/live/paceHistory";
import {
  courseWithEffectiveSurfaces,
  effectiveTerrainForPaintPreview,
  normalizeSurfaceCareState,
  surfaceCarePresentationSignature,
  surfaceCareTopology,
  surfaceCareVisualSignatures,
} from "../game/conditions/surfaceCare";
import {
  RenderRevisionTracker,
  type RenderSnapshot,
} from "../game/render/renderSnapshot";
import { SceneSystemHost } from "./renderer/SceneSystemHost";
import {
  createAtmosphereSceneSystem,
  type AtmosphereSceneSystem,
} from "./renderer/scenes/atmosphereScene";
import {
  createSurfaceCareSceneSystem,
  type SurfaceCareWorkerSprite,
} from "./renderer/scenes/surfaceCareScene";
import { createStructuresPropsSceneSystem } from "./renderer/scenes/structuresPropsScene";
import {
  createNaturalPropsSceneSystem,
  type NaturalPropsSceneSystem,
} from "./renderer/scenes/naturalPropsScene";
import { createPlayerShotOverlaySceneSystem } from "./renderer/scenes/playerShotOverlayScene";
import { createEstateSurveySceneSystem } from "./renderer/scenes/estateSurveyScene";

const TERRAIN_LABEL_KEYS: Record<Terrain, MessageKey> = {
  fairway: "designDock.terrain.fairway",
  rough: "designDock.terrain.rough",
  deep_rough: "designDock.terrain.deepRough",
  sand: "designDock.terrain.sand",
  waste_area: "designDock.terrain.wasteArea",
  water: "designDock.terrain.water",
  wetland: "designDock.terrain.wetland",
  green: "designDock.terrain.green",
  tee: "designDock.terrain.tee",
  path: "designDock.terrain.path",
};

const BIOME_LABEL_KEYS: Record<
  NonNullable<Course["theme"]>,
  MessageKey
> = {
  parkland: "designDock.biome.parkland",
  links: "designDock.biome.links",
  desert: "designDock.biome.desert",
};

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
type ArchitectureOverlayTestLayer = "all" | "traces" | "points" | "none";
interface ArchitectureOverlayTestState {
  layer: ArchitectureOverlayTestLayer;
  visibleRouteLayers: number;
  cellsVisible: boolean;
  tracesVisible: boolean;
  pointsVisible: boolean;
}

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

const colorCss = (color: number, alpha = 1) => {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
};

function terrainMaterialSeed(terrain: Terrain, color: number): number {
  let seed = color ^ 0x9e3779b9;
  for (let index = 0; index < terrain.length; index++) {
    seed = Math.imul(seed ^ terrain.charCodeAt(index), 0x45d9f3b);
  }
  return seed >>> 0;
}

/**
 * Deterministic, seamless world material used by the connected mesh. The
 * canvas is authored at the selected fidelity and repeated every eight world
 * tiles; UVs come from unrotated world coordinates, so camera rotation and
 * chunk rebuilds never move the grain.
 */
function createLandscapeMaterialTexture(
  terrain: Terrain,
  baseColor: number,
  quality: "high" | "medium",
  showPattern: boolean,
): PIXI.Texture {
  const size = quality === "high" ? 512 : 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return PIXI.Texture.WHITE;
  context.fillStyle = colorCss(baseColor);
  context.fillRect(0, 0, size, size);

  let state = terrainMaterialSeed(terrain, baseColor);
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
  const repeatShape = (x: number, y: number, draw: (dx: number, dy: number) => void) => {
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      draw(x + ox, y + oy);
    }
  };

  const organicCount = quality === "high" ? 92 : 52;
  for (let index = 0; index < organicCount; index++) {
    const x = random() * size;
    const y = random() * size;
    const radiusX = size * (0.035 + random() * 0.12);
    const radiusY = radiusX * (0.45 + random() * 0.9);
    const factor = 0.86 + random() * 0.28;
    context.fillStyle = colorCss(shade(baseColor, factor), 0.08 + random() * 0.12);
    repeatShape(x, y, (dx, dy) => {
      context.beginPath();
      context.ellipse(dx, dy, radiusX, radiusY, random() * Math.PI, 0, Math.PI * 2);
      context.fill();
    });
  }

  if (terrain === "fairway" || terrain === "green" || terrain === "tee") {
    const band = size / 8;
    for (let index = 0; index < 8; index++) {
      context.fillStyle = colorCss(index % 2 === 0 ? 0xffffff : 0x102010, index % 2 === 0 ? 0.035 : 0.025);
      context.fillRect(index * band, 0, band, size);
    }
  } else if (terrain === "water" || terrain === "wetland") {
    context.strokeStyle = colorCss(0xe3f2e8, terrain === "water" ? 0.22 : 0.12);
    context.lineWidth = quality === "high" ? 2 : 1.4;
    for (let index = 0; index < 18; index++) {
      const y = (index + 0.5) / 18 * size;
      context.beginPath();
      context.moveTo(-size * 0.1, y);
      context.bezierCurveTo(size * 0.2, y - 9, size * 0.32, y + 10, size * 0.58, y);
      context.bezierCurveTo(size * 0.76, y - 8, size * 0.9, y + 7, size * 1.1, y - 2);
      context.stroke();
    }
  } else {
    const flecks = quality === "high" ? 260 : 120;
    for (let index = 0; index < flecks; index++) {
      const x = random() * size;
      const y = random() * size;
      const light = random() > 0.52;
      context.fillStyle = colorCss(light ? 0xffffff : 0x17140f, light ? 0.09 : 0.08);
      context.beginPath();
      context.ellipse(x, y, 0.6 + random() * 1.8, 0.5 + random(), random() * Math.PI, 0, Math.PI * 2);
      context.fill();
    }
  }

  if (showPattern && terrainPattern(terrain) !== "none") {
    context.strokeStyle = colorCss(0xffffff, 0.2);
    context.fillStyle = colorCss(0xffffff, 0.22);
    context.lineWidth = quality === "high" ? 3 : 2;
    const step = size / 8;
    if (terrainPattern(terrain) === "stripe") {
      for (let offset = -size; offset < size * 2; offset += step) {
        context.beginPath();
        context.moveTo(offset, 0);
        context.lineTo(offset + size, size);
        context.stroke();
      }
    } else if (terrainPattern(terrain) === "crosshatch") {
      for (let offset = -size; offset < size * 2; offset += step) {
        context.beginPath();
        context.moveTo(offset, 0);
        context.lineTo(offset + size, size);
        context.moveTo(offset + size, 0);
        context.lineTo(offset, size);
        context.stroke();
      }
    } else {
      for (let y = step / 2; y < size; y += step) for (let x = step / 2; x < size; x += step) {
        context.beginPath();
        context.arc(x, y, quality === "high" ? 3 : 2.2, 0, Math.PI * 2);
        context.fill();
      }
    }
  }

  const texture = PIXI.Texture.from(canvas);
  texture.source.style.addressMode = "repeat";
  texture.source.style.scaleMode = "linear";
  return texture;
}

// Cliff face colors (exposed earth), lit by the fixed NW sun: the SW-facing
// (screen lower-left) face sits in shadow, the SE-facing face catches more.

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
  /** Current club-calendar season; omitted legacy callers remain base-only. */
  season?: SeasonName;
  /** Transient M53 presentation inputs; independent of camera/quality state. */
  seasonalVisualState?: SeasonalVisualState;
  /** Existing accessibility setting; seasonal dressing keeps its geometry still. */
  reducedMotion?: boolean;
  /** Feeds sustained frame telemetry to the Auto quality controller. */
  onFrameTime?: (frameMs: number) => void;
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
  fineGreenBrush?: FineGreenBrush;
  fineGreenRadius?: FineGreenRadius;
  wizardStep: "TEE" | "GREEN" | "CONFIRM" | "MOVE_TEE" | "MOVE_GREEN";
  draftTee: Point | null;
  draftGreen: Point | null;
  onClickTile: (x: number, y: number) => void;
  onPreviewTerrainStroke?: (points: Point[]) => TerrainStrokePreview;
  onCommitTerrainStroke?: (points: Point[]) => void;
  terrainTool?: TerrainAuthoringTool;
  onPreviewSurfaceFeatureEdit?: (feature: SurfaceFeature) => TerrainStrokePreview | null;
  onCommitSurfaceFeatureEdit?: (feature: SurfaceFeature) => void;
  onPreviewFineGreenStroke?: (points: Point[]) => FineGreenSculptPreview;
  onCommitFineGreenStroke?: (points: Point[]) => void;
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
  /** Deterministic M52 reference-camera contract exercised by browser fixtures. */
  referenceCamera?: {
    id: string;
    center: Point;
    zoom: number;
    rotation: 0 | 1 | 2 | 3;
  } | null;
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

function surfaceFeaturePoints(feature: SurfaceFeature): Point[] {
  return feature.geometry.kind === "corridor"
    ? feature.geometry.knots
    : feature.geometry.ring;
}

function sampledSurfacePath(feature: SurfaceFeature): Point[] {
  return feature.geometry.kind === "corridor"
    ? sampleCorridor(feature.geometry.knots, 0.2, feature.geometry.tangents)
    : sampleRegion(feature.geometry.ring, feature.geometry.tangents);
}

function moveSurfaceNode(feature: SurfaceFeature, nodeIndex: number, point: Point): SurfaceFeature {
  const previous = surfaceFeaturePoints(feature)[nodeIndex];
  if (!previous) return feature;
  const dx = point.x - previous.x;
  const dy = point.y - previous.y;
  if (feature.geometry.kind === "corridor") {
    const knots = feature.geometry.knots.map((node, index) => index === nodeIndex ? point : node);
    const tangents = feature.geometry.tangents?.map((handles, index) => index === nodeIndex
      ? {
        in: { x: handles.in.x + dx, y: handles.in.y + dy },
        out: { x: handles.out.x + dx, y: handles.out.y + dy },
      }
      : handles);
    return { ...feature, geometry: { ...feature.geometry, knots, tangents } };
  }
  const ring = feature.geometry.ring.map((node, index) => index === nodeIndex ? point : node);
  const tangents = feature.geometry.tangents?.map((handles, index) => index === nodeIndex
    ? {
      in: { x: handles.in.x + dx, y: handles.in.y + dy },
      out: { x: handles.out.x + dx, y: handles.out.y + dy },
    }
    : handles);
  return { ...feature, geometry: { ...feature.geometry, ring, tangents } };
}

function moveSurfaceHandle(
  feature: SurfaceFeature,
  nodeIndex: number,
  target: "in" | "out",
  point: Point,
  mirror: boolean,
): SurfaceFeature {
  const editable = withDefaultSurfaceTangents(feature);
  const node = surfaceFeaturePoints(editable)[nodeIndex];
  if (!node || !editable.geometry.tangents) return feature;
  const tangents = editable.geometry.tangents.map((handles, index) => {
    if (index !== nodeIndex) return handles;
    const opposite = {
      x: node.x * 2 - point.x,
      y: node.y * 2 - point.y,
    };
    return target === "in"
      ? { in: point, out: mirror ? opposite : handles.out }
      : { in: mirror ? opposite : handles.in, out: point };
  });
  return editable.geometry.kind === "corridor"
    ? { ...editable, geometry: { ...editable.geometry, tangents } }
    : { ...editable, geometry: { ...editable.geometry, tangents } };
}

function insertSurfaceNode(feature: SurfaceFeature, afterIndex: number, point: Point): SurfaceFeature {
  const insertIndex = afterIndex + 1;
  if (feature.geometry.kind === "corridor") {
    const knots = [
      ...feature.geometry.knots.slice(0, insertIndex),
      point,
      ...feature.geometry.knots.slice(insertIndex),
    ];
    const tangents = feature.geometry.tangents
      ? [
        ...feature.geometry.tangents.slice(0, insertIndex),
        defaultSurfaceTangents(knots)[insertIndex],
        ...feature.geometry.tangents.slice(insertIndex),
      ]
      : undefined;
    return { ...feature, geometry: { ...feature.geometry, knots, tangents } };
  }
  const ring = [
    ...feature.geometry.ring.slice(0, insertIndex),
    point,
    ...feature.geometry.ring.slice(insertIndex),
  ];
  const tangents = feature.geometry.tangents
    ? [
      ...feature.geometry.tangents.slice(0, insertIndex),
      defaultSurfaceTangents(ring, true)[insertIndex],
      ...feature.geometry.tangents.slice(insertIndex),
    ]
    : undefined;
  return { ...feature, geometry: { ...feature.geometry, ring, tangents } };
}

function deleteSurfaceNode(feature: SurfaceFeature, nodeIndex: number): SurfaceFeature | null {
  const points = surfaceFeaturePoints(feature);
  const minimum = feature.geometry.kind === "corridor" ? 2 : 3;
  if (points.length <= minimum || !points[nodeIndex]) return null;
  if (feature.geometry.kind === "corridor") {
    return {
      ...feature,
      geometry: {
        ...feature.geometry,
        knots: feature.geometry.knots.filter((_, index) => index !== nodeIndex),
        tangents: feature.geometry.tangents?.filter((_, index) => index !== nodeIndex),
      },
    };
  }
  return {
    ...feature,
    geometry: {
      ...feature.geometry,
      ring: feature.geometry.ring.filter((_, index) => index !== nodeIndex),
      tangents: feature.geometry.tangents?.filter((_, index) => index !== nodeIndex),
    },
  };
}

function nearestSurfaceSegment(feature: SurfaceFeature, point: Point): { index: number; distance: number } {
  const points = surfaceFeaturePoints(feature);
  const segmentCount = feature.geometry.kind === "region" ? points.length : Math.max(0, points.length - 1);
  let best = { index: 0, distance: Number.POSITIVE_INFINITY };
  for (let index = 0; index < segmentCount; index++) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length2 = dx * dx + dy * dy;
    const t = length2 <= 1e-9
      ? 0
      : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length2));
    const distance = Math.hypot(
      point.x - (start.x + dx * t),
      point.y - (start.y + dy * t),
    );
    if (distance < best.distance) best = { index, distance };
  }
  return best;
}

interface Layers {
  world: PIXI.Container;
  surround: PIXI.Container;
  terrain: PIXI.Container;
  smoothSurfaces: PIXI.Container;
  seasonalTerrain: PIXI.Container;
  surfaceCare: PIXI.Container;
  estateSeam: PIXI.Container;
  terrainDecals: PIXI.Container;
  surfaceEditor: PIXI.Container;
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

interface MobilityUnitEntry { holder: PIXI.Container; graphic: PIXI.Graphics; state: string; }

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
  groundCoverSprites: Array<{ display: PIXI.Container; tier: 1 | 2 }>;
}

type AtlasStampedContainer = PIXI.Container & {
  __coursecraftAtlasGeneration?: number;
};

function stampAtlasGeneration(layer: PIXI.Container, generation: number): void {
  (layer as AtlasStampedContainer).__coursecraftAtlasGeneration = generation;
}

function stampedAtlasGeneration(layer: PIXI.Container): number | null {
  return (layer as AtlasStampedContainer).__coursecraftAtlasGeneration ?? null;
}

interface ActivatedRenderContext {
  readonly atlas: AtlasRenderContext;
  readonly seasonalVisualState: SeasonalVisualState | undefined;
  readonly resolutionScale: number;
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

export function PixiStage(requestedProps: PixiStageProps) {
  const { t } = useI18n();
  const initialRendererConfigRef = useRef({
    resolutionScale: requestedProps.resolutionScale,
    theme: getBiomeDefinition(requestedProps.course.theme).key,
    graphicsQuality: requestedProps.graphicsQuality,
    season: requestedProps.season,
    seasonalVisualState: requestedProps.seasonalVisualState,
  });
  const [renderContext, setRenderContext] = useState<ActivatedRenderContext>(() => ({
    atlas: {
      biome: initialRendererConfigRef.current.theme,
      quality: initialRendererConfigRef.current.graphicsQuality,
      season: initialRendererConfigRef.current.season ?? null,
      bundleKey: `${initialRendererConfigRef.current.theme}:${initialRendererConfigRef.current.graphicsQuality}`,
      overlayKey: null,
      generation: 0,
      requestId: 0,
      status: "activated",
    },
    seasonalVisualState: initialRendererConfigRef.current.seasonalVisualState,
    resolutionScale: initialRendererConfigRef.current.resolutionScale,
  }));
  const atlasContext = renderContext.atlas;
  const renderedCourse = useMemo<Course>(() => (
    requestedProps.course.theme === atlasContext.biome
      ? requestedProps.course
      : { ...requestedProps.course, theme: atlasContext.biome }
  ), [atlasContext.biome, requestedProps.course]);
  // All scene effects consume the last completely activated atlas context.
  // Requested adaptive-quality changes stay off-screen while their bundle is
  // loading, so Pixi never combines a new fallback terrain tier with objects
  // and dressing from the previous generation.
  const props: PixiStageProps = {
    ...requestedProps,
    course: renderedCourse,
    graphicsQuality: atlasContext.quality,
    season: atlasContext.season ?? undefined,
    seasonalVisualState: renderContext.seasonalVisualState,
    resolutionScale: renderContext.resolutionScale,
  };
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const layersRef = useRef<Layers | null>(null);
  const architectureOverlayTestLayerRef = useRef<ArchitectureOverlayTestLayer>("all");
  const sceneSystemHostRef = useRef<SceneSystemHost | null>(null);
  const atmosphereSceneRef = useRef<AtmosphereSceneSystem | null>(null);
  const naturalPropsSceneRef = useRef<NaturalPropsSceneSystem | null>(null);
  const renderRevisionTrackerRef = useRef(new RenderRevisionTracker());
  const [appReady, setAppReady] = useState(false);
  const atlasRevision = atlasContext.generation;
  const seasonalPlantsSignature = seasonalPlantSceneSignature(
    props.seasonalVisualState,
  );

  const diamondTextureRef = useRef<PIXI.Texture | null>(null);
  const chunksRef = useRef<TerrainChunk[]>([]);
  const prevTilesRef = useRef<Terrain[] | null>(null);
  const prevCareVisualSignaturesRef = useRef<string[] | null>(null);
  const prevElevationsRef = useRef<number[] | null>(null);
  const builtRotationRef = useRef<IsoRotation | null>(null);
  const builtSeasonalTerrainSignatureRef = useRef<string | null>(null);
  const builtAtlasGenerationRef = useRef<number | null>(null);
  const chunkRebuildsRef = useRef(0);
  const landscapeMaterialTexturesRef = useRef<Map<string, PIXI.Texture>>(new Map());
  const structureSpriteCountRef = useRef(0);
  const hoverLineRef = useRef<PIXI.Graphics | null>(null);
  const hoverHighlightRef = useRef<PIXI.Graphics | null>(null);
  const flagPoolRef = useRef<Map<number, PIXI.Graphics>>(new Map());
  const propertyGraphicsRef = useRef<PIXI.Graphics[]>([]);
  const decorationSpritesRef = useRef<Array<{ sprite: PIXI.Sprite; shadow: PIXI.Graphics }>>([]);
  const surfaceCareWorkersRef = useRef<SurfaceCareWorkerSprite[]>([]);
  const waterAnimRef = useRef({ last: 0, wasAnimating: false });
  const surfaceWaterSpritesRef = useRef<Array<{
    sprite: PIXI.Sprite | PIXI.Mesh;
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
  const mobilityUnitPoolRef = useRef<Map<string, MobilityUnitEntry>>(new Map());
  const hoverTileRef = useRef<{ x: number; y: number } | null>(null);
  const overlayDirtyRef = useRef(false);
  const terrainPreviewRenderRef = useRef<{
    revision: number;
    previewKind: TerrainStrokePreview["previewKind"];
    selectedTerrain: Terrain | null;
    materials: Terrain[];
    colors: Partial<Record<Terrain, number>>;
  } | null>(null);

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
  const [fineGreenStrokePreview, setFineGreenStrokePreview] = useState<FineGreenSculptPreview | null>(null);
  const fineGreenStrokeRef = useRef<{
    pointerId: number;
    points: Point[];
    last: Point;
  } | null>(null);
  const [clickSplineDraft, setClickSplineDraft] = useState<Point[]>([]);
  const clickSplineDraftRef = useRef<Point[]>([]);
  const [clickSplineHover, setClickSplineHover] = useState<Point | null>(null);
  const clickSplineHoverRef = useRef<Point | null>(null);
  const [selectedSurfaceFeatureId, setSelectedSurfaceFeatureId] = useState<string | null>(null);
  const selectedSurfaceFeatureIdRef = useRef<string | null>(null);
  const [selectedSurfaceNode, setSelectedSurfaceNode] = useState<number | null>(null);
  const selectedSurfaceNodeRef = useRef<number | null>(null);
  const [surfaceEditDraft, setSurfaceEditDraft] = useState<SurfaceFeature | null>(null);
  const surfaceEditDraftRef = useRef<SurfaceFeature | null>(null);
  const surfaceEditDragRef = useRef<{
    pointerId: number;
    feature: SurfaceFeature;
    nodeIndex: number;
    target: "node" | "in" | "out";
  } | null>(null);
  const surfaceEditorGraphicsRef = useRef<PIXI.Graphics | null>(null);
  const camRef = useRef({ cx: 0, cy: 0, zoom: 1, tcx: 0, tcy: 0, tzoom: 1, initialized: false });
  const rotTweenRef = useRef<{ start: number; toDeg: number; next: IsoRotation } | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const lastReportedCameraStateRef = useRef<CameraState | null>(null);
  const lastAmbientReportAtRef = useRef(0);
  const lastCameraStateRef = useRef<CameraState | null | undefined>(undefined);
  const lastAutoFitSignatureRef = useRef<string | null>(null);

  const {
    course,
    holes,
    obstacles,
    activeHoleIndex,
    activePath,
    onClickTile,
    onPreviewTerrainStroke,
    onCommitTerrainStroke,
    onPreviewSurfaceFeatureEdit,
    onCommitSurfaceFeatureEdit,
    onPreviewFineGreenStroke,
    onCommitFineGreenStroke,
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
  const effectiveRenderCourse = useMemo(
    () => courseWithEffectiveSurfaces(course),
    [course],
  );
  const effectiveTiles = effectiveRenderCourse.tiles;
  const careVisualSignatures = useMemo(
    () => surfaceCareVisualSignatures(course),
    [course],
  );
  const carePresentationSignature = useMemo(
    () => surfaceCarePresentationSignature(course),
    [course],
  );
  const terrainTool = props.terrainTool ?? "curve";
  const updateClickSplineDraft = useCallback((points: Point[]) => {
    clickSplineDraftRef.current = points;
    setClickSplineDraft(points);
  }, []);
  const updateClickSplineHover = useCallback((point: Point | null) => {
    clickSplineHoverRef.current = point;
    setClickSplineHover(point);
  }, []);
  const updateSelectedSurface = useCallback((featureId: string | null, nodeIndex: number | null = null) => {
    selectedSurfaceFeatureIdRef.current = featureId;
    selectedSurfaceNodeRef.current = nodeIndex;
    setSelectedSurfaceFeatureId(featureId);
    setSelectedSurfaceNode(nodeIndex);
  }, []);
  const updateSurfaceEditDraft = useCallback((feature: SurfaceFeature | null) => {
    surfaceEditDraftRef.current = feature;
    setSurfaceEditDraft(feature);
  }, []);
  const selectedSurfaceFeature = useMemo(() => (
    surfaceEditDraft
    ?? course.surfaceIntent?.features.find((feature) => feature.id === selectedSurfaceFeatureId)
    ?? null
  ), [course.surfaceIntent, selectedSurfaceFeatureId, surfaceEditDraft]);

  useEffect(() => {
    if (terrainTool === "spline") return;
    updateClickSplineDraft([]);
    updateClickSplineHover(null);
    terrainStrokePreviewRef.current = null;
    setTerrainStrokePreview(null);
  }, [terrainTool, updateClickSplineDraft, updateClickSplineHover]);

  useEffect(() => {
    if (terrainTool === "edit") return;
    updateSelectedSurface(null);
    updateSurfaceEditDraft(null);
    surfaceEditDragRef.current = null;
  }, [terrainTool, updateSelectedSurface, updateSurfaceEditDraft]);

  useEffect(() => {
    if (
      selectedSurfaceFeatureId &&
      !course.surfaceIntent?.features.some((feature) => feature.id === selectedSurfaceFeatureId)
    ) updateSelectedSurface(null);
  }, [course.surfaceIntent, selectedSurfaceFeatureId, updateSelectedSurface]);

  const visualHeightfield = useMemo(
    () => buildVisualHeightfield(course),
    [course],
  );
  const landscapeComponentCacheRef = useRef(createLandscapeComponentCache());
  const landscapeComponents = useMemo(() => {
    if (props.graphicsQuality === "low") return [];
    const startedAt = performance.now();
    const options = {
      cornerRadius: props.graphicsQuality === "high" ? 0.4 : 0.32,
      cornerSegments: props.graphicsQuality === "high" ? 4 : 2,
    };
    const snapshot = landscapeComponentCacheRef.current.update(
      effectiveTiles,
      course.width,
      course.height,
      options,
    );
    recordM35Metric("connectedRebuild", performance.now() - startedAt);
    return snapshot.components;
  }, [
    course.height,
    effectiveTiles,
    course.width,
    props.graphicsQuality,
  ]);
  const landscapeComponentByCell = useMemo(() => {
    const lookup: Array<LandscapeComponent | null> = new Array(effectiveTiles.length).fill(null);
    for (const component of landscapeComponents) {
      for (const index of component.cells) lookup[index] = component;
    }
    return lookup;
  }, [effectiveTiles.length, landscapeComponents]);
  const surfaceHeightAt = useCallback((x: number, y: number) => (
    props.graphicsQuality === "low"
      ? getElevation(
        course,
        Math.max(0, Math.min(course.width - 1, Math.floor(x))),
        Math.max(0, Math.min(course.height - 1, Math.floor(y))),
      )
      : sampleLandscapeSurfaceHeight(
        visualHeightfield,
        landscapeComponentByCell[
          Math.max(0, Math.min(course.height - 1, Math.floor(y))) * course.width +
          Math.max(0, Math.min(course.width - 1, Math.floor(x)))
        ],
        x,
        y,
      )
  ), [
    course,
    landscapeComponentByCell,
    props.graphicsQuality,
    visualHeightfield,
  ]);

  // ZK-679 first slice: scene systems consume one typed snapshot. Each
  // revision list mirrors only the inputs read by that system, so unrelated
  // React renders no longer imply that every extracted layer must rebuild.
  const renderRevisions = renderRevisionTrackerRef.current.update({
    atmosphere: [
      atlasRevision,
      course.elevations,
      course.height,
      course.tiles,
      effectiveTiles,
      landscapeComponentByCell,
      course.width,
      draftGreen,
      draftTee,
      holes,
      props.animationsEnabled,
      props.colorVision,
      props.graphicsQuality,
      props.reducedMotion,
      props.seasonalVisualState,
      props.worldSeed,
      rotation,
      visualHeightfield,
    ],
    surfaceCare: [
      atlasRevision,
      carePresentationSignature,
      course,
      props.animationsEnabled,
      props.colorVision,
      props.graphicsQuality,
      props.reducedMotion,
      props.worldSeed,
      rotation,
      surfaceHeightAt,
    ],
    structuresProps: [
      atlasRevision,
      course.buildings,
      course.theme,
      rotation,
      surfaceHeightAt,
    ],
    naturalProps: [
      atlasRevision,
      course.buildings,
      course.elevations,
      course.height,
      course.theme,
      course.width,
      effectiveTiles,
      obstacles,
      props.graphicsQuality,
      Boolean(props.showObstacles),
      props.worldSeed,
      rotation,
      seasonalPlantsSignature,
      surfaceHeightAt,
    ],
    overlaysDiagnostics: [
      props.playerRound,
      props.playerShotAim,
      rotation,
      surfaceHeightAt,
    ],
    estateSurvey: [
      course.elevations,
      course.estate,
      course.height,
      course.width,
      props.colorVision,
      props.selectedParcelId,
      props.surveyMode,
      rotation,
    ],
  });
  const renderSnapshot = useMemo<RenderSnapshot>(() => ({
    course,
    obstacles,
    effectiveTiles,
    holes,
    draftTee,
    draftGreen,
    rotation,
    seasonalVisualState: props.seasonalVisualState,
    graphicsQuality: props.graphicsQuality,
    colorVision: props.colorVision,
    reducedMotion: Boolean(props.reducedMotion),
    animationsEnabled: props.animationsEnabled,
    showObstacles: Boolean(props.showObstacles),
    atlasRevision,
    playerRound: props.playerRound,
    playerShotAim: props.playerShotAim,
    surveyMode: Boolean(props.surveyMode),
    selectedParcelId: props.selectedParcelId,
    worldSeed: props.worldSeed,
    surfaceHeightAt,
    revisions: renderRevisions,
  }), [
    course,
    draftGreen,
    draftTee,
    effectiveTiles,
    holes,
    obstacles,
    atlasRevision,
    props.animationsEnabled,
    props.colorVision,
    props.graphicsQuality,
    props.playerRound,
    props.playerShotAim,
    props.reducedMotion,
    props.selectedParcelId,
    props.seasonalVisualState,
    props.showObstacles,
    props.surveyMode,
    props.worldSeed,
    renderRevisions,
    rotation,
    surfaceHeightAt,
  ]);

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
      for (const cover of chunk.groundCoverSprites) cover.display.visible = v && cover.tier <= coverTier;
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
      props.onCameraCenter?.({ x: cam.tcx, y: cam.tcy });
    },
    [course.width, course.height, rotation, applyCamera, props.onCameraCenter]
  );

  /**
   * COZY opens at a playable SimGolf-like framing; Architect remains the
   * explicit estate overview. F always restores the overview on demand.
   */
  const fitDefaultView = useCallback(
    (snap: boolean) => {
      if (props.showGridOverlays) {
        fitWholeCourse(snap);
        return;
      }
      const app = appRef.current;
      if (!app) return;
      const completeHole = holes[activeHoleIndex]?.tee && holes[activeHoleIndex]?.green
        ? holes[activeHoleIndex]
        : holes.find((hole) => hole.tee && hole.green);
      const cam = camRef.current;
      if (completeHole?.tee && completeHole.green) {
        const padding = 4;
        const minX = Math.max(0, Math.min(completeHole.tee.x, completeHole.green.x) - padding);
        const minY = Math.max(0, Math.min(completeHole.tee.y, completeHole.green.y) - padding);
        const maxX = Math.min(course.width - 1, Math.max(completeHole.tee.x, completeHole.green.x) + padding);
        const maxY = Math.min(course.height - 1, Math.max(completeHole.tee.y, completeHole.green.y) + padding);
        cam.tcx = (minX + maxX + 1) / 2;
        cam.tcy = (minY + maxY + 1) / 2;
        cam.tzoom = Math.min(MAX_ZOOM, Math.max(
          minimumZoom(),
          fitZoomForTileBounds(
            minX,
            minY,
            maxX,
            maxY,
            app.screen.width,
            app.screen.height,
            rotation,
          ) * 1.08,
        ));
      } else {
        cam.tcx = course.width / 2;
        cam.tcy = course.height / 2;
        const overview = fitZoomForTileBounds(
          0,
          0,
          course.width - 1,
          course.height - 1,
          app.screen.width,
          app.screen.height,
          rotation,
        );
        cam.tzoom = Math.min(MAX_ZOOM, Math.max(minimumZoom(), overview * 1.42));
      }
      const centered = clampCenter(cam.tcx, cam.tcy, cam.tzoom);
      cam.tcx = centered.x;
      cam.tcy = centered.y;
      if (snap) {
        cam.cx = cam.tcx;
        cam.cy = cam.tcy;
        cam.zoom = cam.tzoom;
      }
      applyCamera();
      props.onCameraCenter?.({ x: cam.tcx, y: cam.tcy });
    },
    [
      activeHoleIndex,
      applyCamera,
      clampCenter,
      course.height,
      course.width,
      fitWholeCourse,
      holes,
      minimumZoom,
      props.onCameraCenter,
      props.showGridOverlays,
      rotation,
    ],
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
    let canceled = false;
    const begin = (referencePlan: ArchitectureReferencePlan | null) => {
      if (canceled) return;
      const app = appRef.current;
      // Wizard confirm advances the active hole before this effect runs, so
      // fall back to the previous (just-confirmed) hole when the active one
      // is still empty.
      let holeIndex = activeHoleIndex;
      let hole = holes[holeIndex];
      if ((!referencePlan?.tee || !referencePlan.pin) && (!hole?.tee || !hole.green) && holeIndex > 0) hole = holes[--holeIndex];
      const tee = referencePlan?.tee ?? hole?.tee;
      const green = referencePlan?.pin ?? hole?.green;
      if (!app || !hole || !tee || !green) return;
      const cam = camRef.current;
      const corridor = referencePlan?.segments.map((segment) => segment.to) ?? (props.activeShotPlan ?? []).map((segment) => segment.to);
      const referencePoints = [tee, ...corridor, green];
      const minX = Math.min(...referencePoints.map((point) => point.x)) - 5;
      const maxX = Math.max(...referencePoints.map((point) => point.x)) + 5;
      const minY = Math.min(...referencePoints.map((point) => point.y)) - 5;
      const maxY = Math.max(...referencePoints.map((point) => point.y)) + 5;
      const wide = fitZoomForTileBounds(minX, minY, maxX, maxY, app.screen.width, app.screen.height, rotation);
      const tight = Math.min(MAX_ZOOM * 0.6, Math.max(wide * 2.4, wide + 0.4));
      flyoverRef.current = {
        keys: buildFlyoverKeys(tee, green, corridor, wide, tight),
        t0: performance.now(),
        saved: flyoverRef.current?.saved ?? { cx: cam.tcx, cy: cam.tcy, zoom: cam.tzoom },
      };
      const distanceTiles = computeHoleDistanceTiles(tee, green);
      const autoPar = computeAutoPar(distanceTiles);
      setFlyoverCard({
        hole: holeIndex + 1,
        par: referencePlan?.selectedPar ?? (hole.parMode === "MANUAL" ? hole.parManual ?? autoPar : autoPar),
        yards: referencePlan?.effectiveYardage || Math.round(distanceTiles * (course.yardsPerTile ?? 10)),
      });
    };
    void import("../game/architecture/referencePlan").then((module) => begin(module.flyoverReferencePlan(course, activeHoleIndex, props.selectedTeeSet ?? "member"))).catch(() => begin(null));
    return () => { canceled = true; };
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

  useEffect(() => {
    const reference = props.referenceCamera;
    if (!appReady || !reference) return;
    const cam = camRef.current;
    const center = clampCenter(reference.center.x, reference.center.y);
    cam.initialized = true;
    setRotation((reference.rotation * 90) as IsoRotation);
    cam.cx = cam.tcx = center.x;
    cam.cy = cam.tcy = center.y;
    cam.zoom = cam.tzoom = Math.max(minimumZoom(), Math.min(MAX_ZOOM, reference.zoom));
    applyCamera();
    reportView();
  }, [
    appReady,
    applyCamera,
    clampCenter,
    minimumZoom,
    props.referenceCamera,
    reportView,
  ]);

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

  useEffect(() => {
    if (import.meta.env.MODE !== "e2e" || !appReady) return;
    const api = {
      fitWholeCourse: () => fitWholeCourse(true),
      viewport: (): { width: number; height: number } | null => {
        const app = appRef.current;
        return app ? { width: app.screen.width, height: app.screen.height } : null;
      },
      tileToScreen: (x: number, y: number): { x: number; y: number } | null => {
        if (x < 0 || y < 0 || x >= course.width || y >= course.height) return null;
        return worldPointToScreen(
          x + 0.5,
          y + 0.5,
          getElevation(course, Math.floor(x), Math.floor(y)),
        );
      },
      surfaceCareLayer: () => {
        const layers = layersRef.current;
        if (!layers) return null;
        return {
          children: layers.surfaceCare.children.length,
          workers: surfaceCareWorkersRef.current.length,
          index: layers.world.getChildIndex(layers.surfaceCare),
          seasonalIndex: layers.world.getChildIndex(layers.seasonalTerrain),
          markerIndex: layers.world.getChildIndex(layers.terrainDecals),
          objectsIndex: layers.world.getChildIndex(layers.objects),
        };
      },
      terrainPreview: () => terrainPreviewRenderRef.current
        ? {
          ...terrainPreviewRenderRef.current,
          materials: [...terrainPreviewRenderRef.current.materials],
          colors: { ...terrainPreviewRenderRef.current.colors },
        }
        : null,
      routeOverlay: () => ({
        points: activePath?.length ?? 0,
        visibleLayers: layersRef.current?.terrainDecals.children.filter((child) => child.label === ROUTE_LABEL && child.visible).length ?? 0,
      }),
      rendererAtlasState: () => {
        const layers = layersRef.current;
        const world = layers?.world;
        const requestedTheme = getBiomeDefinition(requestedProps.course.theme).key;
        const requestedQuality = requestedProps.graphicsQuality;
        const renderedTier = visibleGroundCoverTier(
          world?.scale.x ?? camRef.current.zoom,
          renderContext.resolutionScale,
        );
        const coverTier = atlasContext.quality === "high"
          ? renderedTier
          : atlasContext.quality === "medium"
            ? Math.min(1, renderedTier) as 0 | 1
            : 0;
        return {
          requested: {
            biome: requestedTheme,
            quality: requestedQuality,
            season: requestedProps.season ?? null,
            bundleKey: `${requestedTheme}:${requestedQuality}`,
            resolutionScale: requestedProps.resolutionScale,
            seasonalVisualSignature: seasonalPlantSceneSignature(requestedProps.seasonalVisualState),
          },
          rendered: {
            ...atlasContext,
            resolutionScale: renderContext.resolutionScale,
            seasonalVisualSignature: seasonalPlantsSignature,
          },
          activation: atlasActivationSnapshot(),
          residency: atlasResidencySnapshot(),
          fallbacks: atlasFallbackDiagnostics(),
          camera: {
            zoom: camRef.current.zoom,
            targetZoom: camRef.current.tzoom,
            groundCoverTier: coverTier,
          },
          layers: layers ? {
            surround: stampedAtlasGeneration(layers.surround),
            terrain: stampedAtlasGeneration(layers.terrain),
            smoothSurfaces: stampedAtlasGeneration(layers.smoothSurfaces),
            seasonalTerrain: stampedAtlasGeneration(layers.seasonalTerrain),
            surfaceCare: stampedAtlasGeneration(layers.surfaceCare),
            estateSeam: stampedAtlasGeneration(layers.estateSeam),
            objects: stampedAtlasGeneration(layers.objects),
          } : null,
          counts: layers ? {
            terrainChunks: layers.terrain.children.length,
            terrainRebuilds: chunkRebuildsRef.current,
            connectedSurfaces: layers.smoothSurfaces.children.length,
            structuresAndProps: structureSpriteCountRef.current
              + (naturalPropsSceneRef.current?.contentCount() ?? 0),
            naturalProps: {
              content: naturalPropsSceneRef.current?.contentCount() ?? 0,
              rebuilds: naturalPropsSceneRef.current?.rebuildCount() ?? 0,
              fallbackTextures: naturalPropsSceneRef.current?.fallbackTextureCount() ?? 0,
            },
            dressing: layers.seasonalTerrain.children.length + layers.surfaceCare.children.length,
          } : null,
        };
      },
      unrelatedObjectCountProbe: () => {
        const layers = layersRef.current;
        const before = structureSpriteCountRef.current
          + (naturalPropsSceneRef.current?.contentCount() ?? 0);
        if (!layers) return { before, after: before };
        const unrelated = new PIXI.Container();
        unrelated.label = "zk674-unrelated-object-probe";
        layers.objects.addChild(unrelated);
        const after = structureSpriteCountRef.current
          + (naturalPropsSceneRef.current?.contentCount() ?? 0);
        unrelated.destroy();
        return { before, after };
      },
      setZoomForTest: (zoom: number) => {
        const next = Math.max(minimumZoom(), Math.min(MAX_ZOOM, zoom));
        camRef.current.zoom = next;
        camRef.current.tzoom = next;
        applyCamera();
      },
      screenToTile,
    };
    window.__coursecraftPixiTest = api;
    return () => {
      if (window.__coursecraftPixiTest === api) delete window.__coursecraftPixiTest;
    };
  }, [
    activePath,
    appReady,
    applyCamera,
    atlasContext,
    course,
    fitWholeCourse,
    minimumZoom,
    requestedProps.course.theme,
    requestedProps.graphicsQuality,
    requestedProps.resolutionScale,
    requestedProps.season,
    requestedProps.seasonalVisualState,
    renderContext.resolutionScale,
    seasonalPlantsSignature,
    screenToTile,
    worldPointToScreen,
  ]);

  // ---------------------------------------------------------------------
  // App lifecycle
  // ---------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    // These ref objects are stable for the app's lifetime.
    const emoteSprites = emoteSpritesRef.current;
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
        resolution: (window.devicePixelRatio || 1) * initialRendererConfigRef.current.resolutionScale,
        autoDensity: true,
      });

      if (cancelled) {
        app.destroy(true, { children: true, texture: true });
        return;
      }

      const activation = await loadAtlases(
        initialRendererConfigRef.current.theme,
        initialRendererConfigRef.current.graphicsQuality,
        initialRendererConfigRef.current.season,
      );
      if (cancelled) {
        app.destroy(true, { children: true, texture: true });
        return;
      }

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
      const seasonalTerrain = new PIXI.Container();
      const surfaceCare = new PIXI.Container();
      const estateSeam = new PIXI.Container();
      const terrainDecals = new PIXI.Container();
      const surfaceEditor = new PIXI.Container();
      const objects = new PIXI.Container();
      objects.sortableChildren = true;
      const fx = new PIXI.Container();
      const screenOverlay = new PIXI.Container();

      world.addChild(surround, terrain, smoothSurfaces, seasonalTerrain, surfaceCare, estateSeam, terrainDecals, surfaceEditor, objects, fx);

      app.stage.addChild(world, screenOverlay);

      app.stage.eventMode = "static";
      app.stage.hitArea = app.screen;

      appRef.current = app;
      layersRef.current = { world, surround, terrain, smoothSurfaces, seasonalTerrain, surfaceCare, estateSeam, terrainDecals, surfaceEditor, objects, fx, screenOverlay };
      if (activation.context) {
        setRenderContext({
          atlas: activation.context,
          seasonalVisualState: initialRendererConfigRef.current.seasonalVisualState,
          resolutionScale: initialRendererConfigRef.current.resolutionScale,
        });
      }
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
      supersedePendingAtlasLoad();
      setAppReady(false);
      // Scene-owned display objects and fallback textures must be released
      // before the application recursively tears down the shared layer tree.
      sceneSystemHostRef.current?.dispose();
      sceneSystemHostRef.current = null;
      atmosphereSceneRef.current = null;
      naturalPropsSceneRef.current = null;
      layersRef.current = null;
      chunksRef.current = [];
      prevTilesRef.current = null;
      prevElevationsRef.current = null;
      builtSeasonalTerrainSignatureRef.current = null;
      builtAtlasGenerationRef.current = null;
      structureSpriteCountRef.current = 0;
      hoverLineRef.current = null;
      hoverHighlightRef.current = null;
      surfaceEditorGraphicsRef.current = null;
      golferPoolRef.current.clear();
      mobilityUnitPoolRef.current.clear();
      flagPoolRef.current.clear();
      propertyGraphicsRef.current = [];
      surfaceCareWorkersRef.current = [];
      rippleGraphicsRef.current = null;
      ripplesRef.current = [];
      impactsRef.current = [];
      emoteSprites.clear();
      emoteSchedulerRef.current = createEmoteScheduler();
      perfState.text = null;
      perfState.win.reset();
      waterAnimRef.current = { last: 0, wasAnimating: false };
      diamondTextureRef.current = null;
      landscapeMaterialTexturesRef.current.clear();
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: true });
        appRef.current = null;
      }
    };
  }, []);

  // Resolution is an adaptive quality setting, not an app-lifecycle setting.
  // Resize the current renderer in place so a quality tier change cannot tear
  // down the canvas, blank the course, or interrupt an editor gesture.
  useEffect(() => {
    if (!appReady) return;
    const app = appRef.current;
    const container = containerRef.current;
    if (!app || !container) return;
    const width = Math.max(container.clientWidth || 100, 100);
    const height = Math.max(container.clientHeight || 100, 100);
    const resolution = (window.devicePixelRatio || 1) * props.resolutionScale;
    if (
      Math.abs(app.renderer.resolution - resolution) < 0.001
      && app.screen.width === width
      && app.screen.height === height
    ) return;
    app.renderer.resize(width, height, resolution);
    app.stage.hitArea = app.screen;
    applyCamera();
  }, [appReady, applyCamera, props.resolutionScale]);

  useEffect(() => {
    if (!appReady) return;
    const requestedTheme = getBiomeDefinition(requestedProps.course.theme).key;
    const requestedQuality = requestedProps.graphicsQuality;
    const requestedSeason = requestedProps.season ?? null;
    const requestedBundleKey = `${requestedTheme}:${requestedQuality}`;
    const requestedSeasonalVisualSignature = seasonalPlantSceneSignature(
      requestedProps.seasonalVisualState,
    );
    const identityMatchesRendered = (
      atlasContext.biome === requestedTheme
      && atlasContext.quality === requestedQuality
      && atlasContext.season === requestedSeason
    );
    const activationBefore = atlasActivationSnapshot();
    if (
      activationBefore.pending
      && (
        activationBefore.pending.bundleKey !== requestedBundleKey
        || activationBefore.pending.season !== requestedSeason
      )
    ) supersedePendingAtlasLoad();
    const activation = atlasActivationSnapshot();
    const activeMatchesRendered = (
      activation.requestId === atlasContext.requestId
      && activation.generation === atlasContext.generation
      && (
        atlasContext.status === "fallback"
          ? activation.bundleKey === null && activation.overlayKey === null
          : activation.bundleKey === atlasContext.bundleKey
            && activation.overlayKey === atlasContext.overlayKey
      )
    );
    if (identityMatchesRendered && activeMatchesRendered) {
      setRenderContext((current) => (
        seasonalPlantSceneSignature(current.seasonalVisualState) === requestedSeasonalVisualSignature
        && current.resolutionScale === requestedProps.resolutionScale
          ? current
          : {
            ...current,
            seasonalVisualState: requestedProps.seasonalVisualState,
            resolutionScale: requestedProps.resolutionScale,
          }
      ));
      return;
    }
    let cancelled = false;
    void loadAtlases(
      requestedTheme,
      requestedQuality,
      requestedSeason,
    ).then((activation) => {
      if (!cancelled && activation.context) {
        setRenderContext({
          atlas: activation.context,
          seasonalVisualState: requestedProps.seasonalVisualState,
          resolutionScale: requestedProps.resolutionScale,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    appReady,
    atlasContext.biome,
    atlasContext.bundleKey,
    atlasContext.generation,
    atlasContext.overlayKey,
    atlasContext.quality,
    atlasContext.requestId,
    atlasContext.season,
    atlasContext.status,
    requestedProps.course.theme,
    requestedProps.graphicsQuality,
    requestedProps.resolutionScale,
    requestedProps.season,
    requestedProps.seasonalVisualState,
  ]);

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

  // One-time camera init: snap to the selected normal/overview framing.
  useEffect(() => {
    if (!appReady) return;
    const cam = camRef.current;
    if (!cam.initialized) {
      cam.initialized = true;
      fitDefaultView(true);
    }
  }, [appReady, fitDefaultView]);

  // Loading another fixture/save can replace a 220×140 course with a much
  // smaller one after Pixi has initialized. Refit once per course/view
  // signature so the new estate cannot appear as a tiny object off-center.
  useEffect(() => {
    if (!appReady || cameraState || props.referenceCamera) return;
    const completeHole = holes[activeHoleIndex]?.tee && holes[activeHoleIndex]?.green
      ? holes[activeHoleIndex]
      : holes.find((hole) => hole.tee && hole.green);
    const signature = [
      course.name,
      course.width,
      course.height,
      props.showGridOverlays ? "overview" : "normal",
      completeHole?.tee?.x ?? "-",
      completeHole?.tee?.y ?? "-",
      completeHole?.green?.x ?? "-",
      completeHole?.green?.y ?? "-",
    ].join(":");
    if (lastAutoFitSignatureRef.current === signature) return;
    lastAutoFitSignatureRef.current = signature;
    fitDefaultView(true);
  }, [
    activeHoleIndex,
    appReady,
    cameraState,
    course.height,
    course.name,
    course.width,
    fitDefaultView,
    holes,
    props.showGridOverlays,
    props.referenceCamera,
  ]);

  useEffect(() => {
    if (!appReady) return;
    reportView();
  }, [appReady, reportView]);

  // CameraState prop → glide targets. Skips echoes of centers we reported
  // ourselves so user pan/zoom isn't fought by the round-trip through App.
  useEffect(() => {
    if (!appReady || props.referenceCamera) return;
    const app = appRef.current;
    const cam = camRef.current;
    if (!app || !cam.initialized) return;
    // Only react to an actual CameraState change; rotation changes re-run
    // this effect (dep for the bounds fit below) but must not re-target.
    if (lastCameraStateRef.current === cameraState) return;
    lastCameraStateRef.current = cameraState;

    if (!cameraState) {
      fitDefaultView(false);
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
  }, [appReady, cameraState, rotation, fitDefaultView, minimumZoom, props.referenceCamera]);

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
      if (!cameraState && !e.repeat && e.code === "KeyF") {
        fitWholeCourse(false);
        e.preventDefault();
      } else if (panAction) {
        keysRef.current.add(panAction);
        e.preventDefault();
      } else if (!e.repeat && !rotTweenRef.current && (binding === props.keybindings.rotateLeft || binding === props.keybindings.rotateRight)) {
        const right = binding === props.keybindings.rotateRight;
        const next = nextRotation(rotation, right ? 1 : -1);
        if (!props.animationsEnabled) setRotation(next);
        else {
          rotTweenRef.current = {
            start: performance.now(),
            toDeg: right ? -90 : 90,
            next,
          };
        }
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
  }, [appReady, rotation, cameraState, applyCamera, clampCenter, minimumZoom, props.animationsEnabled, props.edgeScroll, props.edgeScrollSpeed, props.cameraSmoothing, props.keybindings, reportView, fitWholeCourse]);

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
    const palette = SCENIC_COLORS[getBiomeDefinition(model.theme).content.materials.terrain];
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
      const material = getTerrainMaterial(model.theme, "water");
      for (let y = -band; y < course.height + band; y++) for (let x = -band; x < course.width + band; x++) {
        if (x >= 0 && y >= 0 && x < course.width && y < course.height) continue;
        if (!isScenicOceanPoint(model.coast, { x: x + 0.5, y: y + 0.5 }, course.width, course.height, model.coastline)) continue;
        const distance = Math.max(-x, x - course.width + 1, -y, y - course.height + 1, 0);
        if (distance > band) continue;
        const texture = getTerrainFrame(model.theme, props.graphicsQuality, pickTerrainBaseFrame(material, x, y));
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
    const scenicTerrain: Terrain = scenicNaturalTerrain(model.theme);
    const seasonalClimate = seasonalPlantClimate(props.seasonalVisualState);
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
      const seasonal = picked.variant.plantForm === "non-plant"
        ? null
        : seasonalPlantPresentation({
          identity: picked.variant.frame,
          profile: picked.variant.seasonalProfile,
          form: picked.variant.plantForm,
          x: prop.x,
          y: prop.y,
          cultivated: false,
          elevation: 0,
          nearWater: false,
          climate: seasonalClimate,
        });
      const texture = getPropFrame(model.theme, props.graphicsQuality, picked.variant.frame);
      const position = worldToIso(prop.x, prop.y, 0, rotation);
      if (texture) {
        const sprite = new PIXI.Sprite(texture);
        sprite.anchor.set(picked.variant.anchor[0], picked.variant.anchor[1]);
        sprite.position.set(position.x, position.y);
        const size = TILE_W * 0.58 * picked.scale;
        sprite.width = size * (seasonal?.scaleX ?? 1);
        sprite.height = size * texture.height / texture.width
          * (seasonal?.scaleY ?? 1);
        sprite.tint = seasonal?.tint ?? 0xffffff;
        sprite.alpha = seasonal?.alpha ?? 1;
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
    stampAtlasGeneration(layers.surround, atlasRevision);
    stampAtlasGeneration(layers.estateSeam, atlasRevision);
  }, [
    appReady,
    atlasRevision,
    course,
    props.graphicsQuality,
    props.worldSeed,
    rotation,
    props.seasonalVisualState,
    seasonalPlantsSignature,
  ]);

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
    // Whole-tile terrain is the visual source of truth. Surface intent is
    // retained for editor history and backwards-compatible saves, but it no
    // longer substitutes an underlay or clips a second terrain layer.
    const underlayTiles = effectiveTiles;
    const visualTerrainAt = (x: number, y: number): Terrain => {
      const index = y * w + x;
      return underlayTiles[index];
    };
    const careTopology = surfaceCareTopology(course);
    const careState = normalizeSurfaceCareState(course.surfaceCare, course);
    const mowingQualityAt = (index: number): number => {
      const key = careTopology.zoneByTile[index];
      return key ? careState?.records[key]?.mowingQuality ?? 1 : 1;
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
      ? { ...COLORS, ...getBiomeDefinition(course.theme).presentation.tileTints }
      : TERRAIN_PALETTES[props.colorVision];
    const seasonalByTerrain = Object.fromEntries(TERRAIN_KINDS.map((terrain) => [
      terrain,
      props.seasonalVisualState
        ? seasonalTerrainTreatment({
          state: props.seasonalVisualState,
          terrain,
          quality: props.graphicsQuality,
          colorVision: props.colorVision,
          baseColor: THEMED_COLORS[terrain],
          reducedMotion: props.reducedMotion,
        })
        : null,
    ])) as Record<Terrain, SeasonalTerrainTreatment | null>;
    const seasonalTerrainSignature = TERRAIN_KINDS.map((terrain) =>
      seasonalByTerrain[terrain]?.signature ?? `${terrain}:same-biome-base`,
    ).join("|");
    const cliffFaces = getBiomeDefinition(course.theme).presentation.cliffFaces;

    /** Rebuild one chunk's contents in place (cliffs first, tops in depth order). */
    const buildChunk = (chunk: TerrainChunk, cx: number, cy: number) => {
      const rebuildStartedAt = performance.now();
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
      const reliefBanks = new PIXI.Graphics();
      chunk.container.addChild(reliefBanks);
      const hillCaps = new PIXI.Graphics();
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
      const recessedFace = (x: number, y: number, d: Point) => {
        const terrain = visualTerrainAt(x, y);
        const style = terrainReliefStyle(course.theme, terrain);
        if (!style) return;
        const nx = x + d.x;
        const ny = y + d.y;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || elev(nx, ny) !== elev(x, y)) return;
        const neighborInset = terrainSurfaceInsetPx(visualTerrainAt(nx, ny));
        if (neighborInset >= style.surfaceInsetPx) return;
        const [c1, c2] = edgeCorners(x, y, d.x, d.y);
        const a = worldToIso(c1.x, c1.y, elev(x, y), rotation);
        const b = worldToIso(c2.x, c2.y, elev(x, y), rotation);
        reliefBanks.poly([
          a.x, a.y + neighborInset,
          b.x, b.y + neighborInset,
          b.x, b.y + style.surfaceInsetPx,
          a.x, a.y + style.surfaceInsetPx,
        ]);
        const isFront =
          (d.x === dSW.x && d.y === dSW.y) ||
          (d.x === dSE.x && d.y === dSE.y);
        reliefBanks.fill(isFront ? style.bankDark : style.bankLight);
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
        for (const direction of AUTOTILE_DIRECTIONS.filter((entry) => entry.dx === 0 || entry.dy === 0)) {
          recessedFace(x, y, { x: direction.dx, y: direction.dy });
        }
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
        const groundPosition = worldToIso(x + 0.5, y, e, rotation);
        const surfaceInset = terrainSurfaceInsetPx(terrain);
        const p = { x: groundPosition.x, y: groundPosition.y + surfaceInset };
        // NW-sun slope shade from central-difference normals (world-fixed sun).
        const dzdx = (elev(x + 1, y) - elev(x - 1, y)) / 2;
        const dzdy = (elev(x, y + 1) - elev(x, y - 1)) / 2;
        let slopeShade = Math.max(0.8, Math.min(1.12, 1 - 0.07 * (dzdx + dzdy)));
        if (
          (terrain === "fairway" || terrain === "green" || terrain === "tee")
          && mowingQualityAt(y * w + x) >= 0.83
        ) {
          slopeShade *= mowingShadeAt(x, y, holeAxes);
        }
        const seasonal = seasonalByTerrain[terrain];
        const legacyTint = shade(
          darken(seasonal?.color ?? THEMED_COLORS[terrain], EDGE_DARKEN),
          slopeShade,
        );

        // Authored parkland sources are @2× but remain 64×32 in world space.
        // Other themes intentionally use the safe legacy tint until M21.
        const authored = material.source === "atlas-2x"
          ? getTerrainFrame(course.theme, props.graphicsQuality, pickTerrainBaseFrame(material, x, y))
          : null;
        const sprite = new PIXI.Sprite(authored ?? diamond);
        sprite.anchor.set(0.5, 0);
        sprite.position.set(p.x, p.y);
        // A subpixel overlap hides linear-filter alpha hairlines between
        // neighboring @2× diamonds without changing projection or picking.
        sprite.width = authored ? TILE_W + 0.75 : TILE_W;
        sprite.height = authored ? TILE_H + 0.5 : TILE_H;
        sprite.tint = authored && props.colorVision === "standard"
          ? shade(seasonal?.textureTint ?? 0xffffff, slopeShade)
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

        const terrainDetail = deriveTerrainDetail(
          effectiveRenderCourse,
          props.worldSeed,
          x,
          y,
        );
        const terrainDetailTexture = terrainDetail
          ? getTerrainDetailFrame(course.theme, props.graphicsQuality, terrainDetail.frame)
          : null;
        if (terrainDetail && terrainDetailTexture) {
          const detail = new PIXI.Sprite(terrainDetailTexture);
          detail.eventMode = "none";
          detail.anchor.set(0.5, 1);
          detail.position.set(
            p.x + terrainDetail.offsetX,
            p.y + 12 + terrainDetail.offsetY,
          );
          detail.scale.set(terrainDetail.scale);
          chunk.container.addChild(detail);
          chunk.groundCoverSprites.push({ display: detail, tier: terrainDetail.detailTier });
        } else {
          const cover = deriveGroundCover(
            effectiveRenderCourse,
            props.worldSeed,
            x,
            y,
          );
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
            chunk.groundCoverSprites.push({ display: detail, tier: cover.detailTier });
          }
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
            ? getTerrainFrame(course.theme, props.graphicsQuality, terrainTransitionFrame(material, feature))
            : null;
          if (!transitionTexture) continue;
          const lip = new PIXI.Sprite(transitionTexture);
          lip.anchor.set(0.5, 0);
          // Recessed hazards keep their lip on the surrounding ground plane;
          // the base material sits below it and the bank face bridges the gap.
          lip.position.set(groundPosition.x, groundPosition.y);
          lip.width = TILE_W;
          lip.height = TILE_H;
          lip.tint = props.colorVision === "standard"
            ? shade(seasonal?.textureTint ?? 0xffffff, slopeShade)
            : legacyTint;
          chunk.container.addChild(lip);
          if ((terrain === "water" || terrain === "wetland") && feature.kind === "edge") {
            chunk.foamSprites.push({ sprite: lip, phase: ((x * 5 + y * 11) % 16) / 16 * Math.PI * 2 });
          }
        }

        // A restrained bevel on the higher tile softens elevation steps into
        // rounded hill caps. Links intentionally carries the strongest cue.
        const capStrength = hillReliefStrength(course.theme);
        for (const direction of AUTOTILE_DIRECTIONS.filter((entry) => entry.dx === 0 || entry.dy === 0)) {
          const nx = x + direction.dx;
          const ny = y + direction.dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || elev(nx, ny) >= e) continue;
          const [c1, c2] = edgeCorners(x, y, direction.dx, direction.dy);
          const a = worldToIso(c1.x, c1.y, e, rotation);
          const b = worldToIso(c2.x, c2.y, e, rotation);
          const isFront =
            (direction.dx === dSW.x && direction.dy === dSW.y) ||
            (direction.dx === dSE.x && direction.dy === dSE.y);
          hillCaps.moveTo(a.x, a.y + surfaceInset);
          hillCaps.lineTo(b.x, b.y + surfaceInset);
          hillCaps.stroke({
            width: isFront ? 2.4 : 1.5,
            color: isFront ? 0x263b2d : 0xe8e2af,
            alpha: (isFront ? 0.3 : 0.22) * capStrength,
            cap: "round",
          });
        }
      }
      chunk.container.addChild(hillCaps);

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
      recordM35Metric("chunkRebuild", performance.now() - rebuildStartedAt);
    };

    const chunkIndex = (cx: number, cy: number) => cy * cols + cx;
    const prevTiles = prevTilesRef.current;
    const prevCareVisualSignatures = prevCareVisualSignaturesRef.current;
    const prevElevations = prevElevationsRef.current;
    const fullRebuild =
      chunksRef.current.length !== cols * rows ||
      builtRotationRef.current !== rotation ||
      builtAtlasGenerationRef.current !== atlasRevision ||
      builtSeasonalTerrainSignatureRef.current !== seasonalTerrainSignature ||
      !prevTiles ||
      prevTiles.length !== effectiveTiles.length ||
      !prevCareVisualSignatures ||
      prevCareVisualSignatures.length !== careVisualSignatures.length;

    if (fullRebuild) {
      layers.terrain.removeChildren();
      chunksRef.current.forEach((c) => c.container.destroy({ children: true }));
      chunksRef.current = [];
      builtRotationRef.current = rotation;
      builtAtlasGenerationRef.current = atlasRevision;
      builtSeasonalTerrainSignatureRef.current = seasonalTerrainSignature;

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
      for (let i = 0; i < effectiveTiles.length; i++) {
        if (
          effectiveTiles[i] === prevTiles[i] &&
          careVisualSignatures[i] === prevCareVisualSignatures[i] &&
          (course.elevations?.[i] ?? 0) === (prevElevations?.[i] ?? 0)
        ) {
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

    prevTilesRef.current = effectiveTiles;
    prevCareVisualSignaturesRef.current = careVisualSignatures;
    prevElevationsRef.current = course.elevations;
    cullChunks();
    stampAtlasGeneration(layers.terrain, atlasRevision);
  }, [
    appReady,
    atlasRevision,
    course,
    careVisualSignatures,
    effectiveRenderCourse,
    effectiveTiles,
    rotation,
    cullChunks,
    props.colorVision,
    props.graphicsQuality,
    props.reducedMotion,
    props.seasonalVisualState,
    props.terrainPatterns,
    props.worldSeed,
  ]);

  // Connected landscape presentation. Gameplay remains whole-tile and the
  // original chunk renderer stays underneath as the Low/failure fallback.
  // Medium/High replace the visible top plane with rounded component masks,
  // a shared visual heightfield, and world-anchored repeating materials.
  useEffect(() => {
    if (!appReady) return;
    const rebuildStartedAt = performance.now();
    const layer = layersRef.current?.smoothSurfaces;
    if (!layer) return;
    layer.removeChildren().forEach((child) => child.destroy({ children: true }));
    surfaceWaterSpritesRef.current = [];
    if (props.graphicsQuality === "low") {
      stampAtlasGeneration(layer, atlasRevision);
      return;
    }

    const quality = props.graphicsQuality;
    const subdivisions = quality === "high" ? 4 : 2;
    const components = landscapeComponents;
    const heightfield = visualHeightfield;
    const project = (point: Point) => worldToIso(
      point.x,
      point.y,
      sampleVisualHeight(heightfield, point.x, point.y),
      rotation,
    );
    const themedColors: Record<Terrain, number> = props.colorVision === "standard"
      ? { ...COLORS, ...getBiomeDefinition(course.theme).presentation.tileTints }
      : TERRAIN_PALETTES[props.colorVision];
    const seasonalByTerrain = Object.fromEntries(TERRAIN_KINDS.map((terrain) => [
      terrain,
      props.seasonalVisualState
        ? seasonalTerrainTreatment({
          state: props.seasonalVisualState,
          terrain,
          quality,
          colorVision: props.colorVision,
          baseColor: themedColors[terrain],
          reducedMotion: props.reducedMotion,
        })
        : null,
    ])) as Record<Terrain, SeasonalTerrainTreatment | null>;

    const buildMask = (rings: readonly (readonly Point[])[]) => {
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
    };

    const textureFor = (terrain: Terrain) => {
      const baseColor = themedColors[terrain];
      const authored = props.colorVision === "standard" && !props.terrainPatterns
        ? getLandscapeMaterialField(course.theme, terrain, quality)
        : null;
      if (authored && !authored.destroyed) return authored;
      const key = [
        getBiomeDefinition(course.theme).key,
        terrain,
        quality,
        props.colorVision,
        props.terrainPatterns ? "pattern" : "plain",
        baseColor.toString(16),
      ].join(":");
      let texture = landscapeMaterialTexturesRef.current.get(key);
      if (!texture || texture.destroyed) {
        texture = createLandscapeMaterialTexture(
          terrain,
          baseColor,
          quality,
          props.terrainPatterns,
        );
        landscapeMaterialTexturesRef.current.set(key, texture);
      }
      return texture;
    };

    const componentDepth = (component: LandscapeComponent) => {
      let total = 0;
      const step = Math.max(1, Math.floor(component.cells.length / 64));
      let samples = 0;
      for (let cursor = 0; cursor < component.cells.length; cursor += step) {
        const index = component.cells[cursor];
        const x = index % course.width;
        const y = Math.floor(index / course.width);
        total += isoDepth(
          x + 0.5,
          y + 0.5,
          sampleLandscapeSurfaceHeight(heightfield, component, x + 0.5, y + 0.5),
          rotation,
        );
        samples++;
      }
      return total / Math.max(1, samples);
    };

    const bandLayer = new PIXI.Container();
    bandLayer.eventMode = "none";
    bandLayer.sortableChildren = true;
    let remainingShoreRocks = quality === "high" ? 280 : 180;
    let remainingWaterComponents = components.filter(
      (component) => component.terrain === "water",
    ).length;
    const sortedComponents = [...components].sort((a, b) => componentDepth(a) - componentDepth(b));
    for (const component of sortedComponents) {
      const positions: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];
      const vertexIndexes = new Map<number, number>();
      const subWidth = course.width * subdivisions + 1;
      const vertexAt = (sx: number, sy: number) => {
        const key = sy * subWidth + sx;
        const cached = vertexIndexes.get(key);
        if (cached != null) return cached;
        const x = sx / subdivisions;
        const y = sy / subdivisions;
        const point = worldToIso(
          x,
          y,
          sampleLandscapeSurfaceHeight(heightfield, component, x, y),
          rotation,
        );
        const index = positions.length / 2;
        positions.push(point.x, point.y);
        // Eight-tile period, anchored to unrotated world coordinates.
        uvs.push(x / 8, y / 8);
        vertexIndexes.set(key, index);
        return index;
      };
      for (const cell of component.cells) {
        const x = cell % course.width;
        const y = Math.floor(cell / course.width);
        for (let dy = 0; dy < subdivisions; dy++) for (let dx = 0; dx < subdivisions; dx++) {
          const sx = x * subdivisions + dx;
          const sy = y * subdivisions + dy;
          const topLeft = vertexAt(sx, sy);
          const topRight = vertexAt(sx + 1, sy);
          const bottomRight = vertexAt(sx + 1, sy + 1);
          const bottomLeft = vertexAt(sx, sy + 1);
          indices.push(topLeft, topRight, bottomRight, topLeft, bottomRight, bottomLeft);
        }
      }
      if (indices.length === 0) continue;
      const geometry = new PIXI.MeshGeometry({
        positions: new Float32Array(positions),
        uvs: new Float32Array(uvs),
        indices: new Uint32Array(indices),
      });
      const bunkerVisualType = component.terrain === "sand"
        ? classifyBunkerVisualType(
          component.cells,
          effectiveTiles,
          course.width,
          course.height,
        )
        : null;
      const visualRings = bunkerVisualType
        ? buildBunkerVisualRings(
          component.rings,
          component.topologyKey,
          component.cells.length,
          bunkerVisualType,
        )
        : component.rings;
      if (component.terrain === "sand") {
        // The authoritative sand cells stay whole for gameplay. Visually,
        // replace their square base with world-anchored rough, then reveal
        // sand through the organic bunker mask below.
        const roughUnderlay = new PIXI.Mesh({
          geometry,
          texture: textureFor("rough"),
        });
        roughUnderlay.tint = seasonalByTerrain.rough?.textureTint ?? 0xffffff;
        roughUnderlay.eventMode = "none";
        layer.addChild(roughUnderlay);
      }
      const mesh = new PIXI.Mesh({ geometry, texture: textureFor(component.terrain) });
      mesh.tint = seasonalByTerrain[component.terrain]?.textureTint ?? 0xffffff;
      mesh.eventMode = "none";
      const mask = buildMask(visualRings);
      mesh.mask = mask;
      layer.addChild(mesh, mask);
      if (component.terrain === "water" || component.terrain === "wetland") {
        const firstCell = component.cells[0];
        const gx = firstCell % course.width;
        const gy = Math.floor(firstCell / course.width);
        surfaceWaterSpritesRef.current.push({
          sprite: mesh,
          baseTint: mesh.tint,
          phase: waterShimmerPhase(gx, gy),
          gx,
          gy,
        });
      }

      const boundaryRuns = buildLandscapeBoundaryRuns(
        visualRings,
        component.terrain,
        effectiveTiles,
        course.width,
        course.height,
      );
      let hasOwnedRockyShore = false;
      for (const run of boundaryRuns) {
        const edgeStyle = landscapeEdgeStyle(
          component.terrain,
          run.outsideTerrain,
          bunkerVisualType ?? "greenside",
        );
        if (!edgeStyle) continue;
        hasOwnedRockyShore ||= Boolean(edgeStyle.shoreRocks);
        // Draw broad-to-narrow semantic bands only on the pair-owned run so
        // adjacent components cannot double-stroke the same boundary.
        for (let strokeIndex = 0; strokeIndex < edgeStyle.bands.length; strokeIndex++) {
          const stroke = edgeStyle.bands[strokeIndex];
          const color = "color" in stroke.color
            ? stroke.color.color
            : shade(themedColors[stroke.color.terrain], stroke.color.shade);
          const graphics = new PIXI.Graphics();
          graphics.eventMode = "none";
          graphics.zIndex = edgeStyle.priority + strokeIndex / 100;
          const points = run.points.map(project);
          if (points.length < 2) continue;
          graphics.moveTo(points[0].x, points[0].y);
          for (let index = 1; index < points.length; index++) {
            graphics.lineTo(points[index].x, points[index].y);
          }
          graphics.stroke({
            width: stroke.width,
            color,
            alpha: stroke.alpha,
            join: "round",
            cap: "round",
          });
          bandLayer.addChild(graphics);
        }
      }
      if (hasOwnedRockyShore && remainingShoreRocks > 0) {
        const componentBudget = Math.ceil(
          remainingShoreRocks / Math.max(1, remainingWaterComponents),
        );
        remainingWaterComponents--;
        const placements = buildShoreRockPlacements(
          component.rings,
          component.topologyKey,
          componentBudget,
        );
        remainingShoreRocks -= placements.length;
        if (placements.length > 0) {
          const rocks = new PIXI.Graphics();
          rocks.eventMode = "none";
          rocks.zIndex = 71;
          const rockTones = [0x70736a, 0x89877a, 0x9f9986] as const;
          for (const placement of placements) {
            const point = project(placement);
            rocks.ellipse(
              point.x,
              point.y + placement.ry * 0.12,
              placement.rx + 0.9,
              placement.ry + 0.55,
            );
            rocks.fill({ color: 0x3d443e, alpha: 0.78 });
            rocks.ellipse(point.x, point.y, placement.rx, placement.ry);
            rocks.fill({ color: rockTones[placement.tone], alpha: 0.94 });
            rocks.ellipse(
              point.x - placement.rx * 0.2,
              point.y - placement.ry * 0.28,
              placement.rx * 0.38,
              placement.ry * 0.3,
            );
            rocks.fill({ color: 0xc8c1a7, alpha: 0.44 });
          }
          bandLayer.addChild(rocks);
        }
      }
    }
    layer.addChild(bandLayer);
    stampAtlasGeneration(layer, atlasRevision);
    recordM35Metric("connectedRebuild", performance.now() - rebuildStartedAt);
  }, [
    appReady,
    atlasRevision,
    effectiveTiles,
    course.elevations,
    course.width,
    course.height,
    course.holes,
    course.surfaceIntent,
    course.theme,
    landscapeComponents,
    props.colorVision,
    props.graphicsQuality,
    props.reducedMotion,
    props.seasonalVisualState,
    props.terrainPatterns,
    rotation,
    visualHeightfield,
  ]);

  // Extracted scene systems are installed once for the Pixi application and
  // receive new snapshots through the host below. Layer order and ownership
  // remain unchanged; only rebuild policy has moved out of this component.
  useEffect(() => {
    if (!appReady) return;
    const app = appRef.current;
    const layers = layersRef.current;
    if (!app || !layers) return;
    const atmosphere = createAtmosphereSceneSystem({
      stage: app.stage,
      world: layers.world,
      seasonalTerrain: layers.seasonalTerrain,
      objects: layers.objects,
      fx: layers.fx,
      screenOverlay: layers.screenOverlay,
      screen: () => app.screen,
    });
    const naturalProps = createNaturalPropsSceneSystem(
      layers.objects,
      layers.terrainDecals,
    );
    const host = new SceneSystemHost([
      atmosphere,
      createSurfaceCareSceneSystem(
        layers.surfaceCare,
        (workers) => { surfaceCareWorkersRef.current = workers; },
      ),
      createStructuresPropsSceneSystem(
        layers.objects,
        (count) => { structureSpriteCountRef.current = count; },
      ),
      createPlayerShotOverlaySceneSystem(layers.fx),
      createEstateSurveySceneSystem(layers.terrainDecals),
      // Natural habitat/shadows historically rebuilt after every extracted
      // decal scene, so retain that exact child order during the migration.
      naturalProps,
    ]);
    atmosphereSceneRef.current = atmosphere;
    naturalPropsSceneRef.current = naturalProps;
    sceneSystemHostRef.current = host;
    return () => {
      if (sceneSystemHostRef.current === host) sceneSystemHostRef.current = null;
      if (atmosphereSceneRef.current === atmosphere) atmosphereSceneRef.current = null;
      if (naturalPropsSceneRef.current === naturalProps) naturalPropsSceneRef.current = null;
      host.dispose();
    };
  }, [appReady]);

  useEffect(() => {
    if (!appReady) return;
    const renderedScenes = sceneSystemHostRef.current?.sync(renderSnapshot) ?? [];
    const layers = layersRef.current;
    if (layers) {
      if (renderedScenes.includes("atmosphere")) {
        stampAtlasGeneration(layers.seasonalTerrain, atlasRevision);
      }
      if (renderedScenes.includes("surfaceCare")) {
        stampAtlasGeneration(layers.surfaceCare, atlasRevision);
      }
      if (renderedScenes.includes("structuresProps")) {
        stampAtlasGeneration(layers.objects, atlasRevision);
      }
      if (renderedScenes.includes("naturalProps")) {
        stampAtlasGeneration(layers.objects, atlasRevision);
      }
    }
  }, [appReady, atlasRevision, renderSnapshot]);

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
    const structureOwner = getBiomeDefinition(course.theme).content.structures.buildings;
    const colors = themeColors[structureOwner];
    const resortPalette = {
      parkland: { wall: 0xe5d7b5, roof: 0x5f2f28, accent: 0xf5cb63 },
      links: { wall: 0xdad8cd, roof: 0x475d67, accent: 0xe0b653 },
      desert: { wall: 0xd7a46f, roof: 0x8b4e36, accent: 0x52a19a },
    }[structureOwner];
    const lodgingAssets = (course.property?.assets ?? []).filter((asset) => asset.enabled && ["lodge", "hotel", "cottages"].includes(asset.kind));
    for (const asset of course.property?.assets ?? []) {
      const elevation = surfaceHeightAt(
        asset.x + asset.width / 2,
        asset.y + asset.height / 2,
      );
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
        }[structureOwner];
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
          const target = worldToIso(
            destination.x + destination.width / 2,
            destination.y + destination.height / 2,
            surfaceHeightAt(
              destination.x + destination.width / 2,
              destination.y + destination.height / 2,
            ),
            rotation,
          );
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
  }, [appReady, course, props.resortOperations, rotation, surfaceHeightAt]);

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

    const seasonalClimate = seasonalPlantClimate(props.seasonalVisualState);
    const terrainNearWater = (x: number, y: number) => {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= course.width || ty >= course.height) continue;
        if (isWaterHazard(effectiveTiles[ty * course.width + tx])) return true;
      }
      return false;
    };
    for (const decoration of course.decorations ?? []) {
      const visual = decorationVisual(decoration, getBiomeDefinition(course.theme).key);
      const plantId = resolvedDecorationPlantId(course.theme, decoration);
      const plant = plantId ? plantDefinition(plantId) : undefined;
      const seasonal = plant
        ? seasonalPlantPresentation({
          identity: plant.id,
          profile: plant.seasonalProfile,
          form: seasonalDecorationPlantForm(
            decoration.kind,
            plant.seasonalProfile,
          ),
          x: decoration.x,
          y: decoration.y,
          cultivated: decoration.origin === "player",
          elevation: course.elevations[
            decoration.y * course.width + decoration.x
          ] ?? 0,
          nearWater: terrainNearWater(decoration.x, decoration.y),
          ecologicalFit: plant.ecologicalFit[
            getBiomeDefinition(course.theme).key
          ],
          climate: seasonalClimate,
        })
        : null;
      const texture = getPropFrame(course.theme, props.graphicsQuality, visual.frame as AtlasFrame);
      if (!texture) continue;
      const tiles = decorationTiles(decoration);
      const xs = tiles.map((tile) => tile.x);
      const ys = tiles.map((tile) => tile.y);
      const minX = Math.min(...xs); const maxX = Math.max(...xs);
      const minY = Math.min(...ys); const maxY = Math.max(...ys);
      const footprint = { x: minX, y: minY, w: maxX - minX + 1, d: maxY - minY + 1 };
      const anchor = frontCorner(footprint, rotation);
      const elevation = surfaceHeightAt(anchor.x, anchor.y);
      const placement = placeObject(footprint, elevation, rotation);
      const sprite = new PIXI.Sprite(texture);
      sprite.anchor.set(visual.anchor[0], visual.anchor[1]);
      sprite.position.set(placement.position.x, placement.position.y);
      const structure = decoration.kind === "bridge" || decoration.kind === "boardwalk";
      const logicalWidth = structure ? Math.max(2, tiles.length * .72) * TILE_W : TILE_W * visual.scale;
      sprite.width = logicalWidth * (seasonal?.scaleX ?? 1);
      sprite.height = logicalWidth * texture.height / texture.width
        * (seasonal?.scaleY ?? 1);
      sprite.tint = seasonal?.tint ?? 0xffffff;
      sprite.alpha = seasonal?.alpha ?? 1;
      if ((decoration.rotation + rotation) % 2 === 1) sprite.scale.x *= -1;
      sprite.zIndex = placement.zIndex + .05;
      sprite.eventMode = "none";
      layers.objects.addChild(sprite);

      const shadow = new PIXI.Graphics();
      shadow.ellipse(
        0,
        0,
        (structure ? logicalWidth * .38 : visual.shadow.radiusX)
          * (seasonal?.shadowScale ?? 1),
        visual.shadow.radiusY * (seasonal?.shadowScale ?? 1),
      );
      shadow.fill({ color: 0x000000, alpha: visual.shadow.alpha });
      shadow.position.set(placement.position.x + 3, placement.position.y - TILE_H / 2 + 2);
      shadow.eventMode = "none";
      layers.terrainDecals.addChild(shadow);
      decorationSpritesRef.current.push({ sprite, shadow });
    }
  }, [
    appReady,
    course,
    effectiveTiles,
    props.graphicsQuality,
    rotation,
    props.seasonalVisualState,
    seasonalPlantsSignature,
    surfaceHeightAt,
  ]);

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
      const c = tileCenterIso(p.x, p.y, surfaceHeightAt(p.x + 0.5, p.y + 0.5), rotation);
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
      const e = surfaceHeightAt(tee.x + 0.5, tee.y + 0.5);
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
      const c = tileCenterIso(
        green.x,
        green.y,
        surfaceHeightAt(green.x + 0.5, green.y + 0.5),
        rotation,
      );
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
  }, [appReady, holes, draftTee, draftGreen, course, rotation, props.showMarkers, props.selectedTeeSet, surfaceHeightAt]);

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
    let referenceLayerGraphics: { cells: PIXI.Graphics; traces: PIXI.Graphics; points: PIXI.Graphics } | null = null;

    // Architect Report overlay: warnings remain advisory and use both shape
    // and color so crossings/transfers stay legible in color-vision modes.
    if (props.architectureWarnings?.length) {
      const g = new PIXI.Graphics();
      const warningPoint = (point: Point) => {
        return tileCenterIso(
          point.x,
          point.y,
          surfaceHeightAt(point.x + 0.5, point.y + 0.5),
          rotation,
        );
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
      const isolateReferenceLayers = import.meta.env.DEV && props.architectureOverlay.kind === "reference";
      const cellGraphics = new PIXI.Graphics();
      const traceGraphics = isolateReferenceLayers ? new PIXI.Graphics() : cellGraphics;
      const pointGraphics = isolateReferenceLayers ? new PIXI.Graphics() : cellGraphics;
      const patternMark = (g: PIXI.Graphics, x: number, y: number, pattern: "solid" | "dots" | "cross" | "diagonal" | undefined, radius: number, color = 0xffffff) => {
        if (pattern === "dots") {
          g.circle(x - radius * .32, y, Math.max(1.2, radius * .11));
          g.circle(x + radius * .32, y, Math.max(1.2, radius * .11));
          g.fill({ color, alpha: .95 });
        } else if (pattern === "cross") {
          g.moveTo(x - radius * .45, y); g.lineTo(x + radius * .45, y);
          g.moveTo(x, y - radius * .45); g.lineTo(x, y + radius * .45);
          g.stroke({ width: 2, color, alpha: .95 });
        } else if (pattern === "diagonal") {
          g.moveTo(x - radius * .5, y + radius * .3); g.lineTo(x + radius * .1, y - radius * .3);
          g.moveTo(x - radius * .1, y + radius * .3); g.lineTo(x + radius * .5, y - radius * .3);
          g.stroke({ width: 1.8, color, alpha: .95 });
        }
      };
      const project = (point: Point) => {
        return tileCenterIso(
          point.x,
          point.y,
          surfaceHeightAt(point.x + 0.5, point.y + 0.5),
          rotation,
        );
      };
      for (const cell of props.architectureOverlay.cells) {
        const top = worldToIso(
          cell.x + 0.5,
          cell.y,
          surfaceHeightAt(cell.x + 0.5, cell.y),
          rotation,
        );
        const intensity = Math.min(1, 0.22 + Math.log2(cell.value + 1) * 0.16);
        cellGraphics.poly([
          top.x, top.y,
          top.x + TILE_W / 2, top.y + TILE_H / 2,
          top.x, top.y + TILE_H,
          top.x - TILE_W / 2, top.y + TILE_H / 2,
        ]);
        const cellColor = cell.source === "predicted" ? 0xf0a51a : cell.current ? 0x28a69a : 0x7b6aa8;
        cellGraphics.fill({
          color: cellColor,
          alpha: cell.current ? intensity : Math.min(0.48, intensity),
        });
        if (!cell.current) cellGraphics.stroke({ width: 1, color: 0xf6e8ff, alpha: 0.75 });
        patternMark(cellGraphics, top.x, top.y + TILE_H / 2, cell.pattern, Math.max(7, TILE_H * .35));
      }
      for (const trace of props.architectureOverlay.traces) {
        const from = project(trace.from);
        const to = project(trace.to);
        traceGraphics.moveTo(from.x, from.y);
        traceGraphics.lineTo(to.x, to.y);
        const traceColor = trace.source === "reference" ? 0x4b78c2 : trace.source === "predicted" ? 0xf0a51a : trace.emphasized ? 0xfff08a : trace.current ? 0x29d7c0 : 0x9a7bc1;
        traceGraphics.stroke({
          width: trace.emphasized ? 5 : 2.5,
          color: traceColor,
          alpha: trace.current ? 0.9 : 0.6,
        });
        traceGraphics.circle(to.x, to.y, trace.emphasized ? 6 : 3);
        traceGraphics.fill({ color: traceColor, alpha: 0.9 });
        patternMark(traceGraphics, (from.x + to.x) / 2, (from.y + to.y) / 2, trace.pattern, trace.emphasized ? 8 : 6);
      }
      for (const point of props.architectureOverlay.points) {
        const projected = project(point);
        const radius = Math.min(13, Math.max(4, 4 + Math.abs(point.value) * 0.35));
        const pointColor = point.source === "reference" ? 0x6e96da : point.source === "predicted" ? 0xf0a51a : point.current ? 0x36cfc9 : 0x8d77b7;
        pointGraphics.circle(projected.x, projected.y, radius);
        pointGraphics.fill({ color: pointColor, alpha: 0.35 });
        pointGraphics.stroke({ width: 2, color: point.current ? 0xeafffb : 0xf1e9ff, alpha: 0.9 });
        patternMark(pointGraphics, projected.x, projected.y, point.pattern, radius);
      }
      const overlayGraphics = isolateReferenceLayers ? [cellGraphics, traceGraphics, pointGraphics] : [cellGraphics];
      for (const g of overlayGraphics) g.label = ROUTE_LABEL;
      layers.terrainDecals.addChild(...overlayGraphics);
      if (isolateReferenceLayers) referenceLayerGraphics = { cells: cellGraphics, traces: traceGraphics, points: pointGraphics };
      if (import.meta.env.DEV && props.architectureOverlay.kind === "reference" && typeof window !== "undefined") {
        const screenPoint = (point: Point) => {
          const local = project(point);
          const global = traceGraphics.toGlobal(local);
          return { x: global.x, y: global.y };
        };
        const testWindow = window as unknown as {
          __ccArchitectureOverlayProjection?: object;
        };
        testWindow.__ccArchitectureOverlayProjection = {
          traces: props.architectureOverlay.traces.map((trace) => ({
            id: trace.id,
            from: screenPoint(trace.from),
            to: screenPoint(trace.to),
          })),
          points: props.architectureOverlay.points.map((point) => ({
            id: point.id,
            center: screenPoint(point),
            radius: Math.min(13, Math.max(4, 4 + Math.abs(point.value) * 0.35)),
          })),
        };
      }
    }

    if (props.paceBottlenecks?.length) {
      const g = new PIXI.Graphics();
      for (const finding of props.paceBottlenecks) {
        const hole = holes.find((candidate) => candidate.id === finding.holeId);
        const point = hole ? getPinPosition(hole, course.activePinRotation ?? "A") ?? hole.green ?? hole.tee : null;
        if (!point) continue;
        const center = tileCenterIso(
          point.x,
          point.y,
          surfaceHeightAt(point.x + 0.5, point.y + 0.5),
          rotation,
        );
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
        const top = worldToIso(
          seg.x + 0.5,
          seg.y,
          surfaceHeightAt(seg.x + 0.5, seg.y),
          rotation,
        );
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
        tileCenterIso(pt.x, pt.y, surfaceHeightAt(pt.x + 0.5, pt.y + 0.5), rotation);
      const first = pathPoint(activePath[0]);
      g.moveTo(first.x, first.y);
      for (let i = 1; i < activePath.length; i++) {
        const p = pathPoint(activePath[i]);
        g.lineTo(p.x, p.y);
      }
      g.stroke({ width: 6, color: 0x173f31, alpha: 0.9 });
      g.moveTo(first.x, first.y);
      for (let i = 1; i < activePath.length; i++) {
        const p = pathPoint(activePath[i]);
        g.lineTo(p.x, p.y);
      }
      g.stroke({ width: 3, color: 0xf7cf62, alpha: 1 });
      for (const point of activePath) {
        const p = pathPoint(point);
        g.circle(p.x, p.y, 4);
        g.fill({ color: 0xfff4ba, alpha: 1 });
        g.stroke({ width: 2, color: 0x173f31, alpha: 1 });
      }
      g.label = ROUTE_LABEL;
      layers.terrainDecals.addChild(g);
    }

    if (import.meta.env.DEV && referenceLayerGraphics && typeof window !== "undefined") {
      const testWindow = window as unknown as {
        __ccArchitectureOverlayTestLayer?: ArchitectureOverlayTestLayer;
        __ccArchitectureOverlayTestState?: ArchitectureOverlayTestState;
        __ccSetArchitectureOverlayTestLayer?: (layer: ArchitectureOverlayTestLayer) => ArchitectureOverlayTestState;
      };
      const applyTestLayer = (layer: ArchitectureOverlayTestLayer): ArchitectureOverlayTestState => {
        architectureOverlayTestLayerRef.current = layer;
        testWindow.__ccArchitectureOverlayTestLayer = layer;
        for (const child of layers.terrainDecals.children) {
          if (child.label === ROUTE_LABEL) child.visible = layer === "all";
        }
        referenceLayerGraphics.cells.visible = layer === "all";
        referenceLayerGraphics.traces.visible = layer === "all" || layer === "traces";
        referenceLayerGraphics.points.visible = layer === "all" || layer === "points";
        const state = {
          layer,
          visibleRouteLayers: layers.terrainDecals.children.filter((child) => child.label === ROUTE_LABEL && child.visible).length,
          cellsVisible: referenceLayerGraphics.cells.visible,
          tracesVisible: referenceLayerGraphics.traces.visible,
          pointsVisible: referenceLayerGraphics.points.visible,
        };
        testWindow.__ccArchitectureOverlayTestState = state;
        appRef.current?.render();
        return state;
      };
      testWindow.__ccSetArchitectureOverlayTestLayer = applyTestLayer;
      applyTestLayer(architectureOverlayTestLayerRef.current);
    }
  }, [appReady, showFixOverlay, failingCorridorSegments, showShotPlan, activePath, course, holes, rotation, props.showMarkers, props.architectureWarnings, props.architectureOverlay, props.paceBottlenecks, surfaceHeightAt]);

  useEffect(() => {
    if (!appReady || surfaceEditorGraphicsRef.current) return;
    const layer = layersRef.current?.surfaceEditor;
    if (!layer) return;
    const graphics = new PIXI.Graphics();
    layer.addChild(graphics);
    surfaceEditorGraphicsRef.current = graphics;
    return () => {
      if (surfaceEditorGraphicsRef.current === graphics) surfaceEditorGraphicsRef.current = null;
      if (graphics.parent) graphics.parent.removeChild(graphics);
      graphics.destroy();
    };
  }, [appReady]);

  useEffect(() => {
    const graphics = surfaceEditorGraphicsRef.current;
    if (!graphics) return;
    graphics.clear();

    const project = (point: Point) => worldToIso(
      point.x,
      point.y,
      surfaceHeightAt(point.x, point.y),
      rotation,
    );

    if (editorMode === "SCULPT" || props.showGridOverlays) {
      const overlay = buildGreenSurfaceOverlayCommands({
        course,
        surface: fineGreenStrokePreview?.surface,
        colorVision: props.colorVision,
        quality: props.graphicsQuality,
      });
      for (const shade of overlay.shades) {
        const corners = [
          project({ x: shade.x + 0.5, y: shade.y }),
          project({ x: shade.x + 1, y: shade.y + 0.5 }),
          project({ x: shade.x + 0.5, y: shade.y + 1 }),
          project({ x: shade.x, y: shade.y + 0.5 }),
        ];
        graphics.poly(corners.flatMap((point) => [point.x, point.y]));
        graphics.fill({
          color: shade.uphill ? overlay.palette.uphill : overlay.palette.downhill,
          alpha: shade.intensity,
        });
      }
      for (const contour of overlay.contours) {
        const from = project(contour.from);
        const to = project(contour.to);
        graphics.moveTo(from.x, from.y);
        graphics.lineTo(to.x, to.y);
        graphics.stroke({ width: contour.major ? 2.5 : 1.7, color: overlay.palette.outline, alpha: 0.58, cap: "round" });
        graphics.moveTo(from.x, from.y);
        graphics.lineTo(to.x, to.y);
        graphics.stroke({ width: contour.major ? 1.2 : 0.75, color: overlay.palette.contour, alpha: 0.92, cap: "round" });
      }
      for (const line of overlay.fallLines) {
        const from = project(line.from);
        const to = project(line.to);
        graphics.moveTo(from.x, from.y);
        graphics.lineTo(to.x, to.y);
        graphics.stroke({ width: 2.6, color: overlay.palette.outline, alpha: 0.72, cap: "round" });
        // Alternating light dots make fall direction legible without hue.
        for (const fraction of [0.2, 0.5, 0.8]) {
          graphics.circle(from.x + (to.x - from.x) * fraction, from.y + (to.y - from.y) * fraction, 1.5);
          graphics.fill({ color: overlay.palette.contour, alpha: 0.95 });
        }
      }
      for (const arrow of overlay.arrows) {
        const at = project(arrow.at);
        const tip = project({
          x: arrow.at.x + arrow.downhill.x * 0.22,
          y: arrow.at.y + arrow.downhill.y * 0.22,
        });
        const tail = project({
          x: arrow.at.x - arrow.downhill.x * 0.12,
          y: arrow.at.y - arrow.downhill.y * 0.12,
        });
        graphics.moveTo(tail.x, tail.y);
        graphics.lineTo(tip.x, tip.y);
        graphics.stroke({ width: 2.2, color: overlay.palette.downhill, alpha: 0.96, cap: "round" });
        const angle = Math.atan2(tip.y - at.y, tip.x - at.x);
        for (const side of [-1, 1]) {
          graphics.moveTo(tip.x, tip.y);
          graphics.lineTo(tip.x - Math.cos(angle + side * 0.55) * 6, tip.y - Math.sin(angle + side * 0.55) * 6);
          graphics.stroke({ width: 2, color: overlay.palette.downhill, alpha: 0.96, cap: "round" });
        }
      }
    }

    if (editorMode !== "PAINT") return;
    const drawPath = (points: readonly Point[], closed: boolean, color: number, alpha: number) => {
      if (points.length < 2) return;
      const first = project(points[0]);
      graphics.moveTo(first.x, first.y);
      for (let index = 1; index < points.length; index++) {
        const current = project(points[index]);
        graphics.lineTo(current.x, current.y);
      }
      if (closed) graphics.lineTo(first.x, first.y);
      graphics.stroke({ width: 2.2, color, alpha, cap: "round", join: "round" });
    };

    if (terrainTool === "spline" && clickSplineDraft.length > 0) {
      const previewPoints = clickSplineHover
        ? [...clickSplineDraft, clickSplineHover]
        : clickSplineDraft;
      drawPath(sampleCorridor(previewPoints), false, 0xffe28a, 0.95);
      for (const point of clickSplineDraft) {
        const projected = project(point);
        graphics.circle(projected.x, projected.y, 4.5);
        graphics.fill({ color: 0xfff4bf, alpha: 0.98 });
        graphics.stroke({ width: 1.5, color: 0x493712, alpha: 0.95 });
      }
    }

    if (terrainTool === "edit" && selectedSurfaceFeature) {
      drawPath(
        sampledSurfacePath(selectedSurfaceFeature),
        selectedSurfaceFeature.geometry.kind === "region",
        0xffe28a,
        0.95,
      );
      const points = surfaceFeaturePoints(selectedSurfaceFeature);
      points.forEach((point, index) => {
        const projected = project(point);
        graphics.circle(projected.x, projected.y, index === selectedSurfaceNode ? 6 : 4.5);
        graphics.fill({
          color: index === selectedSurfaceNode ? 0xffc64c : 0xfff4bf,
          alpha: 0.98,
        });
        graphics.stroke({ width: 1.5, color: 0x493712, alpha: 0.95 });
      });
      if (selectedSurfaceNode != null && points[selectedSurfaceNode]) {
        const tangents = selectedSurfaceFeature.geometry.tangents
          ?? defaultSurfaceTangents(
            points,
            selectedSurfaceFeature.geometry.kind === "region",
          );
        const handles = tangents[selectedSurfaceNode];
        const node = project(points[selectedSurfaceNode]);
        for (const handle of [handles.in, handles.out]) {
          const projected = project(handle);
          graphics.moveTo(node.x, node.y);
          graphics.lineTo(projected.x, projected.y);
          graphics.stroke({ width: 1.2, color: 0xfff0b0, alpha: 0.85 });
          graphics.circle(projected.x, projected.y, 3.8);
          graphics.fill({ color: 0x5ea8ff, alpha: 0.98 });
          graphics.stroke({ width: 1.2, color: 0x17385d, alpha: 0.95 });
        }
      }
    }
  }, [
    appReady,
    clickSplineDraft,
    clickSplineHover,
    editorMode,
    course,
    fineGreenStrokePreview,
    props.colorVision,
    props.graphicsQuality,
    props.showGridOverlays,
    rotation,
    selectedSurfaceFeature,
    selectedSurfaceNode,
    surfaceHeightAt,
    terrainTool,
  ]);

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
      props.onFrameTime?.(dtMs);

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
        const previewRevision =
          (terrainPreviewRenderRef.current?.revision ?? 0) + 1;
        terrainPreviewRenderRef.current = null;

        const highlight = hoverHighlightRef.current;
        const hover = hoverTileRef.current;
        if (highlight) {
          highlight.clear();
          if (hover) {
            const tileDiamond = (tx: number, ty: number) => {
              const top = worldToIso(
                tx + 0.5,
                ty,
                surfaceHeightAt(tx + 0.5, ty),
                rotation,
              );
              return [
                top.x, top.y,
                top.x + TILE_W / 2, top.y + TILE_H / 2,
                top.x, top.y + TILE_H,
                top.x - TILE_W / 2, top.y + TILE_H / 2,
              ];
            };
            const outlineTile = (tx: number, ty: number, alpha: number) => {
              highlight.poly(tileDiamond(tx, ty));
              highlight.stroke({ width: 2, color: 0xffffff, alpha });
            };
            const markTileState = (
              tx: number,
              ty: number,
              state: "accepted" | "unaffordable" | "protected" | "excluded",
              color: number,
              pattern: ReturnType<typeof terrainPattern>,
            ) => {
              const diamond = tileDiamond(tx, ty);
              highlight.poly(diamond);
              highlight.fill({
                color,
                alpha: state === "accepted" ? 0.26 : 0.2,
              });
              highlight.stroke({
                width: state === "accepted" ? 2 : 2.8,
                color: state === "accepted" ? 0xffffff : 0xffe2b0,
                alpha: 0.96,
              });
              const centerX = diamond[0];
              const centerY = diamond[1] + TILE_H / 2;
              if (pattern === "stripe" || pattern === "crosshatch") {
                highlight.moveTo(centerX - 13, centerY + 2);
                highlight.lineTo(centerX + 5, centerY - 7);
                highlight.moveTo(centerX - 5, centerY + 7);
                highlight.lineTo(centerX + 13, centerY - 2);
                highlight.stroke({ width: 1.3, color: 0xffffff, alpha: 0.72 });
              }
              if (pattern === "crosshatch") {
                highlight.moveTo(centerX - 12, centerY - 3);
                highlight.lineTo(centerX + 6, centerY + 6);
                highlight.stroke({ width: 1.2, color: 0x223024, alpha: 0.7 });
              } else if (pattern === "dots") {
                for (const offset of [-8, 0, 8]) {
                  highlight.circle(centerX + offset, centerY, 1.5);
                  highlight.fill({ color: 0xffffff, alpha: 0.85 });
                }
              }
              if (state !== "accepted") {
                highlight.moveTo(centerX - 8, centerY - 5);
                highlight.lineTo(centerX + 8, centerY + 5);
                highlight.moveTo(centerX + 8, centerY - 5);
                highlight.lineTo(centerX - 8, centerY + 5);
                highlight.stroke({ width: 2.4, color: 0xffffff, alpha: 0.98 });
                if (state === "protected") {
                  highlight.circle(centerX, centerY, 8.5);
                  highlight.stroke({ width: 1.8, color: 0xffffff, alpha: 0.98 });
                }
              }
            };
            const strokePreview = terrainStrokePreviewRef.current;
            const strokeMaterial = strokePreview?.acceptedTiles[0]?.terrain
              ?? strokePreview?.excludedTiles[0]?.terrain;
            const currentStrokePreview = strokePreview?.previewKind === "surface-edit"
              || strokeMaterial == null
              || strokeMaterial === selectedTerrain;
            if (editorMode === "PAINT" && strokePreview && currentStrokePreview) {
              const themedColors: Record<Terrain, number> = props.colorVision === "standard"
                ? { ...COLORS, ...getBiomeDefinition(course.theme).presentation.tileTints }
                : TERRAIN_PALETTES[props.colorVision];
              const previewColor = (terrain: Terrain) =>
                props.seasonalVisualState
                  ? seasonalTerrainTreatment({
                    state: props.seasonalVisualState,
                    terrain,
                    quality: props.graphicsQuality,
                    colorVision: props.colorVision,
                    baseColor: themedColors[terrain],
                    reducedMotion: props.reducedMotion,
                  }).color
                  : themedColors[terrain];
              const previewTiles = strokePreview.previewKind === "surface-edit"
                ? strokePreview.tiles
                : strokePreview.acceptedTiles;
              const previewMaterials = [
                ...new Set(previewTiles.map((tile) => tile.terrain)),
              ];
              terrainPreviewRenderRef.current = {
                revision: previewRevision,
                previewKind: strokePreview.previewKind,
                selectedTerrain: selectedTerrain ?? null,
                materials: previewMaterials,
                colors: Object.fromEntries(
                  previewMaterials.map((terrain) => [
                    terrain,
                    previewColor(terrain),
                  ]),
                ),
              };
              for (const tile of previewTiles) {
                markTileState(
                  tile.x,
                  tile.y,
                  strokePreview.affordable ? "accepted" : "unaffordable",
                  strokePreview.affordable ? previewColor(tile.terrain) : 0x8f3528,
                  terrainPattern(tile.terrain),
                );
              }
              for (const tile of strokePreview.excludedTiles) {
                if (
                  tile.x < 0
                  || tile.y < 0
                  || tile.x >= course.width
                  || tile.y >= course.height
                ) continue;
                markTileState(
                  tile.x,
                  tile.y,
                  tile.reason === "protected" ? "protected" : "excluded",
                  tile.reason === "protected" ? 0x6d5a2e : 0x555b60,
                  "crosshatch",
                );
              }
              if (
                strokePreview.previewKind === "stroke" &&
                props.graphicsQuality !== "low" &&
                selectedTerrain &&
                strokePreview.acceptedTiles.length > 0
              ) {
                const accepted = new Set(
                  strokePreview.acceptedTiles.map((tile) => `${tile.x},${tile.y}`),
                );
                const minX = Math.max(
                  0,
                  Math.min(...strokePreview.acceptedTiles.map((tile) => tile.x)) - 2,
                );
                const minY = Math.max(
                  0,
                  Math.min(...strokePreview.acceptedTiles.map((tile) => tile.y)) - 2,
                );
                const maxX = Math.min(
                  course.width,
                  Math.max(...strokePreview.acceptedTiles.map((tile) => tile.x)) + 3,
                );
                const maxY = Math.min(
                  course.height,
                  Math.max(...strokePreview.acceptedTiles.map((tile) => tile.y)) + 3,
                );
                const localWidth = maxX - minX;
                const localHeight = maxY - minY;
                const localTiles: Terrain[] = [];
                for (let ty = minY; ty < maxY; ty++) {
                  for (let tx = minX; tx < maxX; tx++) {
                    localTiles.push(effectiveTiles[ty * course.width + tx]);
                  }
                }
                for (const tile of strokePreview.acceptedTiles) {
                  const index = tile.y * course.width + tile.x;
                  localTiles[(tile.y - minY) * localWidth + tile.x - minX] =
                    effectiveTerrainForPaintPreview(course, index, tile.terrain);
                }
                const previewComponents = buildLandscapeComponents(
                  localTiles,
                  localWidth,
                  localHeight,
                  {
                    cornerRadius: props.graphicsQuality === "high" ? 0.4 : 0.32,
                    cornerSegments: props.graphicsQuality === "high" ? 4 : 2,
                  },
                ).filter((component) => (
                  component.terrain === selectedTerrain &&
                  component.cells.some((index) => {
                    const x = index % localWidth + minX;
                    const y = Math.floor(index / localWidth) + minY;
                    return accepted.has(`${x},${y}`);
                  })
                ));
                for (const component of previewComponents) {
                  const bunkerType = selectedTerrain === "sand"
                    ? classifyBunkerVisualType(
                      component.cells,
                      localTiles,
                      localWidth,
                      localHeight,
                    )
                    : null;
                  const rings = bunkerType
                    ? buildBunkerVisualRings(
                      component.rings,
                      component.topologyKey,
                      component.cells.length,
                      bunkerType,
                    )
                    : component.rings;
                  for (const ring of rings) {
                    const points = ring.map((point) => {
                      const worldX = point.x + minX;
                      const worldY = point.y + minY;
                      return worldToIso(
                        worldX,
                        worldY,
                        surfaceHeightAt(worldX, worldY),
                        rotation,
                      );
                    });
                    if (points.length < 3) continue;
                    highlight.poly(points.flatMap((point) => [point.x, point.y]));
                    highlight.fill({
                      color: strokePreview.affordable
                        ? previewColor(selectedTerrain)
                        : 0x8f3528,
                      alpha: 0.16,
                    });
                    highlight.stroke({
                      width: 2.4,
                      color: strokePreview.affordable ? 0xffffff : 0xffd7c7,
                      alpha: 0.88,
                      join: "round",
                      cap: "round",
                    });
                  }
                }
              }
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
              const preview = decorationTiles(normalizedDecoration({
                kind: props.selectedDecorationKind,
                x: hover.x,
                y: hover.y,
                rotation: props.decorationRotation ?? 0,
                ...((props.selectedDecorationKind === "bridge" || props.selectedDecorationKind === "boardwalk") ? { span: props.decorationSpan ?? 3 } : {}),
              }));
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
                surfaceHeightAt(fromPoint.x + 0.5, fromPoint.y + 0.5)
              );
              const to = worldPointToScreen(
                hover.x + 0.5,
                hover.y + 0.5,
                surfaceHeightAt(hover.x + 0.5, hover.y + 0.5)
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
        const e = surfaceHeightAt(hole.green.x + 0.5, hole.green.y + 0.5);
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

      // Repair workers are shown only when the observed care record reports
      // an active task and sufficient allocated service. Motion is cosmetic,
      // bounded, and snaps to the stable anchor when animation is disabled.
      for (const worker of surfaceCareWorkersRef.current) {
        if (props.animationsEnabled && worker.animated) {
          const phase = nowMs / 520 + worker.phase;
          worker.graphics.position.set(
            worker.baseX + Math.sin(phase) * 1.1,
            worker.baseY + Math.abs(Math.sin(phase * 0.5)) * 0.5,
          );
          worker.graphics.rotation = Math.sin(phase * 0.7) * 0.025;
        } else {
          worker.graphics.position.set(worker.baseX, worker.baseY);
          worker.graphics.rotation = 0;
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
            surfaceHeightAt(selectedGolfer.x + 0.5, selectedGolfer.y + 0.5),
            rotation
          )
        : null;
      naturalPropsSceneRef.current?.tick({
        nowMs,
        animationsEnabled: props.animationsEnabled,
        treeSway: props.treeSway,
        focus: selectedIso,
      });

      perfMark("water+sway");

      atmosphereSceneRef.current?.tick({
        dtMs,
        nowMs,
        dayMinute: dayMinuteRef.current,
        ambienceFx: props.ambienceFx,
      });

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
          const rt = props.animationsEnabled ? (nowMs - r.t0) / 750 : 0.45;
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
          const ge = surfaceHeightAt(golfer.x + 0.5, golfer.y + 0.5);
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
              const pulse = props.animationsEnabled
                ? 1 + Math.sin(nowMs * 0.006) * 0.12
                : 1;
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
            const impact = golfer.ballLandingX != null && golfer.ballLandingY != null
              ? { x: golfer.ballLandingX, y: golfer.ballLandingY }
              : to;
            const restTx = Math.floor(impact.x + 0.5);
            const restTy = Math.floor(impact.y + 0.5);
            const restTerrain =
              restTx >= 0 && restTy >= 0 && restTx < course.width && restTy < course.height
                ? effectiveTiles[restTy * course.width + restTx]
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
              if (!golfer.ballUsesResolvedRollout) {
                gx = from.x + (to.x - from.x) * pose.groundFrac;
                gy = from.y + (to.y - from.y) * pose.groundFrac;
              }
              heightPx = pose.heightPx;
              shadowK = pose.shadow;
              hidden = pose.hidden;
              // Touchdown FX, once per flight, on the surface actually hit.
              const resolvedLanded = golfer.ballUsesResolvedRollout
                ? golfer.segT >= (golfer.ballRolloutStartT ?? (shot === "putt" ? 0 : 0.72))
                : pose.landed;
              if (resolvedLanded && !entry.ballLanded) {
                entry.ballLanded = true;
                if (behavior.fx === "splash") {
                  appendBoundedEffect(
                    ripplesRef.current,
                    { x: impact.x, y: impact.y, t0: nowMs },
                    MAX_ACTIVE_RIPPLES,
                  );
                } else if (behavior.fx) {
                  const e = surfaceHeightAt(gx + 0.5, gy + 0.5);
                  appendBoundedEffect(
                    impactsRef.current,
                    { kind: behavior.fx, x: gx, y: gy, e, t0: nowMs },
                    MAX_ACTIVE_IMPACTS,
                  );
                }
                // Hazard drama bubble (ZKU-155).
                showEmote(hazardEmote(behavior.fx));
                // Startle the shoreline heron through atmosphere ownership.
                atmosphereSceneRef.current?.startleAt(impact, nowMs);
              }
            }
            const be = surfaceHeightAt(gx + 0.5, gy + 0.5);
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
                  (effectiveTiles[ty * course.width + tx] === "water" || effectiveTiles[ty * course.width + tx] === "wetland")
                ) {
                  appendBoundedEffect(
                    ripplesRef.current,
                    { x: entry.lastBall.x, y: entry.lastBall.y, t0: performance.now() },
                    MAX_ACTIVE_RIPPLES,
                  );
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

      // M51 mobility equipment is a shared physical unit, never a second
      // sprite per golfer. Vector fallbacks keep the view safe when optional
      // cart art is absent and remain legible without color alone.
      const mobilityPool = mobilityUnitPoolRef.current;
      const mobilitySeen = new Set<string>();
      for (const unit of mobilityRenderUnits(course, list ?? [])) {
        mobilitySeen.add(unit.id);
        let entry = mobilityPool.get(unit.id);
        if (!entry) {
          const holder = new PIXI.Container();
          const graphic = new PIXI.Graphics();
          holder.addChild(graphic);
          layers.objects.addChild(holder);
          entry = { holder, graphic, state: "" };
          mobilityPool.set(unit.id, entry);
        }
        const elevation = surfaceHeightAt(unit.x + .5, unit.y + .5);
        const projected = tileCenterIso(unit.x, unit.y, elevation, rotation);
        entry.holder.position.set(projected.x, projected.y + 2);
        const offscreen = projected.x < cullL || projected.x > cullR || projected.y < cullT || projected.y > cullB;
        entry.holder.visible = !offscreen;
        const depth = Math.round((entityDepth(unit.x, unit.y, elevation, rotation) - .05) * 10) / 10;
        if (entry.holder.zIndex !== depth) entry.holder.zIndex = depth;
        const signature = `${unit.state}:${unit.mode}`;
        if (entry.state !== signature) {
          entry.state = signature;
          const graphic = entry.graphic;
          graphic.clear();
          if (unit.state === "walking_connection") {
            graphic.circle(0, -4, 7); graphic.stroke({ width: 1.5, color: 0xf4f1db, alpha: .85 });
            graphic.moveTo(-5, -4); graphic.lineTo(5, -4); graphic.stroke({ width: 1.5, color: 0x385d45, alpha: .9 });
          } else if (unit.mode === "riding_cart") {
            graphic.roundRect(-10, -9, 20, 10, 3); graphic.fill({ color: 0xe7dfba, alpha: unit.state === "parked" ? .62 : .95 }); graphic.stroke({ width: 1.5, color: 0x374438, alpha: .95 });
            graphic.circle(-6, 2, 2.5); graphic.circle(6, 2, 2.5); graphic.fill({ color: 0x263126, alpha: .95 });
          } else {
            graphic.circle(-3, 0, 3.5); graphic.circle(4, 0, 3.5); graphic.stroke({ width: 1.5, color: 0x263126, alpha: .95 });
            graphic.moveTo(0, -1); graphic.lineTo(0, -11); graphic.lineTo(5, -14); graphic.stroke({ width: 2, color: 0xead99b, alpha: unit.state === "parked" ? .62 : .95 });
          }
        }
      }
      for (const [id, entry] of mobilityPool) if (!mobilitySeen.has(id)) {
        layers.objects.removeChild(entry.holder); entry.holder.destroy({ children: true }); mobilityPool.delete(id);
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
          const ge2 = surfaceHeightAt(g.x + 0.5, g.y + 0.5);
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
          const pres = props.animationsEnabled
            ? emotePresentation(nowMs - e.t0)
            : { scale: 1, alpha: 1, rise: 0 };
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
            ripples: ripplesRef.current.length,
            impacts: impactsRef.current.length,
            ambientObjects: atmosphereSceneRef.current?.objectCount() ?? 0,
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

    // Every dependency below can change the material or non-color state of a
    // live ghost. Force the replacement closure to paint on its first tick.
    overlayDirtyRef.current = true;
    app.ticker.add(tick);
    return () => {
      app.ticker?.remove(tick);
    };
  }, [appReady, wizardStep, holes, activeHoleIndex, draftTee, worldPointToScreen, golfersRef, liveActive, course, effectiveTiles, rotation, editorMode, selectedTerrain, props.colorVision, props.graphicsQuality, props.reducedMotion, props.seasonalVisualState, props.sculptRadius, props.selectedDecorationKind, props.decorationRotation, props.decorationSpan, props.animationsEnabled, props.ambienceFx, props.waterAnimation, props.treeSway, props.flagColor, props.selectedGolferId, props.followSelected, props.showGolfers, props.onFrameTime, clampCenter, surfaceHeightAt]);

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
        const preview = onPreviewTerrainStroke?.([t]);
        if (preview && !preview.affordable) cursor = "not-allowed";
      }
      el.style.cursor = cursor;
    };

    const cancelTerrainStroke = () => {
      terrainStrokeRef.current = null;
      terrainStrokePreviewRef.current = null;
      setTerrainStrokePreview(null);
      overlayDirtyRef.current = true;
    };

    const showTerrainPreview = (preview: TerrainStrokePreview | null) => {
      terrainStrokePreviewRef.current = preview;
      setTerrainStrokePreview(preview);
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
      showTerrainPreview(preview);
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
      showTerrainPreview(preview);
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

    const cancelFineGreenStroke = () => {
      fineGreenStrokeRef.current = null;
      setFineGreenStrokePreview(null);
      overlayDirtyRef.current = true;
    };

    const beginFineGreenStroke = (point: Point, pointerId: number) => {
      if (!onPreviewFineGreenStroke) return;
      const points = [point];
      fineGreenStrokeRef.current = { pointerId, points, last: point };
      setFineGreenStrokePreview(onPreviewFineGreenStroke(points));
      overlayDirtyRef.current = true;
    };

    const extendFineGreenStroke = (point: Point, pointerId: number) => {
      const stroke = fineGreenStrokeRef.current;
      if (!stroke || stroke.pointerId !== pointerId || !onPreviewFineGreenStroke) return;
      const nextPoints = resampleWorldLine(stroke.last, point);
      if (nextPoints.length === 0) return;
      stroke.points.push(...nextPoints);
      if (stroke.points.length > 2_048) {
        stroke.points = stroke.points.filter((_, index) => index % 2 === 0 || index === stroke.points.length - 1);
      }
      stroke.last = point;
      setFineGreenStrokePreview(onPreviewFineGreenStroke(stroke.points));
      overlayDirtyRef.current = true;
    };

    const finishFineGreenStroke = (pointerId: number) => {
      const stroke = fineGreenStrokeRef.current;
      if (!stroke || stroke.pointerId !== pointerId) return;
      fineGreenStrokeRef.current = null;
      setFineGreenStrokePreview(null);
      overlayDirtyRef.current = true;
      onCommitFineGreenStroke?.(stroke.points);
    };

    const featureForId = (id: string | null): SurfaceFeature | null => {
      if (!id) return null;
      return surfaceEditDraftRef.current
        ?? course.surfaceIntent?.features.find((feature) => feature.id === id)
        ?? null;
    };

    const topFeatureAt = (point: Point): SurfaceFeature | null => {
      const x = Math.floor(point.x);
      const y = Math.floor(point.y);
      const index = y * course.width + x;
      return course.surfaceIntent?.features
        .slice()
        .sort((a, b) => b.order - a.order)
        .find((feature) => feature.coverage.includes(index))
        ?? null;
    };

    const nodeHitRadius = () => Math.max(0.18, 10 / Math.max(8, TILE_W * camRef.current.zoom));

    const startSurfaceEditDrag = (
      feature: SurfaceFeature,
      nodeIndex: number,
      target: "node" | "in" | "out",
      pointerId: number,
    ) => {
      updateSelectedSurface(feature.id, nodeIndex);
      surfaceEditDragRef.current = { pointerId, feature, nodeIndex, target };
      updateSurfaceEditDraft(feature);
    };

    const extendSurfaceEdit = (point: Point, event: PointerEvent) => {
      const drag = surfaceEditDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const edited = drag.target === "node"
        ? moveSurfaceNode(drag.feature, drag.nodeIndex, point)
        : moveSurfaceHandle(drag.feature, drag.nodeIndex, drag.target, point, !event.altKey);
      updateSurfaceEditDraft(edited);
      showTerrainPreview(onPreviewSurfaceFeatureEdit?.(edited) ?? null);
    };

    const finishSurfaceEdit = (pointerId: number) => {
      const drag = surfaceEditDragRef.current;
      if (!drag || drag.pointerId !== pointerId) return;
      const edited = surfaceEditDraftRef.current;
      surfaceEditDragRef.current = null;
      showTerrainPreview(null);
      if (edited) onCommitSurfaceFeatureEdit?.(edited);
      updateSurfaceEditDraft(null);
    };

    const cancelSurfaceEdit = () => {
      surfaceEditDragRef.current = null;
      updateSurfaceEditDraft(null);
      showTerrainPreview(null);
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
      if (event.button !== 0 || props.playableShotMode) return;
      if (flyoverRef.current) return;
      const point = canvasPoint(event);
      if (!point) return;

      if (editorMode === "SCULPT") {
        const x = Math.floor(point.x);
        const y = Math.floor(point.y);
        if (
          x >= 0 && y >= 0 && x < course.width && y < course.height
          && course.tiles[y * course.width + x] === "green"
          && onPreviewFineGreenStroke && onCommitFineGreenStroke
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          beginFineGreenStroke(point, event.pointerId);
          try { pointerSurface.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
        }
        return;
      }

      if (editorMode !== "PAINT" || !selectedTerrain) return;

      if (terrainTool === "spline" && onPreviewTerrainStroke && onCommitTerrainStroke) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const existing = clickSplineDraftRef.current;
        if (event.detail >= 2 && existing.length > 0) {
          const last = existing[existing.length - 1];
          const points = Math.hypot(last.x - point.x, last.y - point.y) < 0.2
            ? existing
            : [...existing, point];
          if (points.length >= 2) onCommitTerrainStroke(points);
          updateClickSplineDraft([]);
          updateClickSplineHover(null);
          showTerrainPreview(null);
          return;
        }
        const points = [...existing, point];
        updateClickSplineDraft(points);
        updateClickSplineHover(null);
        showTerrainPreview(onPreviewTerrainStroke(points));
        return;
      }

      if (terrainTool === "edit" && onPreviewSurfaceFeatureEdit && onCommitSurfaceFeatureEdit) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const selected = featureForId(selectedSurfaceFeatureIdRef.current);
        const candidate = selected ?? topFeatureAt(point);
        if (!candidate) {
          updateSelectedSurface(null);
          return;
        }
        const points = surfaceFeaturePoints(candidate);
        const radius = nodeHitRadius();

        if (selected?.id === candidate.id && selectedSurfaceNodeRef.current != null) {
          const nodeIndex = selectedSurfaceNodeRef.current;
          const tangents = candidate.geometry.tangents
            ?? defaultSurfaceTangents(points, candidate.geometry.kind === "region");
          const handles = tangents[nodeIndex];
          if (handles) {
            if (Math.hypot(handles.in.x - point.x, handles.in.y - point.y) <= radius) {
              startSurfaceEditDrag(candidate, nodeIndex, "in", event.pointerId);
              try { pointerSurface.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
              return;
            }
            if (Math.hypot(handles.out.x - point.x, handles.out.y - point.y) <= radius) {
              startSurfaceEditDrag(candidate, nodeIndex, "out", event.pointerId);
              try { pointerSurface.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
              return;
            }
          }
        }

        let nearestNode = 0;
        let nearestNodeDistance = Number.POSITIVE_INFINITY;
        points.forEach((node, index) => {
          const distance = Math.hypot(node.x - point.x, node.y - point.y);
          if (distance < nearestNodeDistance) {
            nearestNode = index;
            nearestNodeDistance = distance;
          }
        });

        if (event.detail >= 2) {
          const segment = nearestSurfaceSegment(candidate, point);
          if (segment.distance <= Math.max(1.25, radius * 4)) {
            const edited = insertSurfaceNode(candidate, segment.index, point);
            updateSelectedSurface(candidate.id, segment.index + 1);
            showTerrainPreview(onPreviewSurfaceFeatureEdit(edited));
            onCommitSurfaceFeatureEdit(edited);
            showTerrainPreview(null);
            return;
          }
        }

        updateSelectedSurface(candidate.id, nearestNode);
        if (nearestNodeDistance <= radius) {
          startSurfaceEditDrag(candidate, nearestNode, "node", event.pointerId);
          try { pointerSurface.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
        }
        return;
      }

      if (!onPreviewTerrainStroke || !onCommitTerrainStroke) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      beginTerrainStroke(point, event.pointerId);
      try { pointerSurface.setPointerCapture(event.pointerId); } catch { /* synthetic/legacy pointer */ }
    };

    const handleCanvasPointerMove = (event: PointerEvent) => {
      if (fineGreenStrokeRef.current?.pointerId === event.pointerId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const point = canvasPoint(event);
        if (point) extendFineGreenStroke(point, event.pointerId);
        return;
      }
      if (surfaceEditDragRef.current?.pointerId === event.pointerId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const point = canvasPoint(event);
        if (point) extendSurfaceEdit(point, event);
        return;
      }
      if (
        terrainTool === "spline" &&
        clickSplineDraftRef.current.length > 0 &&
        onPreviewTerrainStroke
      ) {
        const point = canvasPoint(event);
        if (point) {
          updateClickSplineHover(point);
          showTerrainPreview(onPreviewTerrainStroke([...clickSplineDraftRef.current, point]));
        }
        return;
      }
      if (!terrainStrokeRef.current || terrainStrokeRef.current.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const point = canvasPoint(event);
      if (point) extendTerrainStroke(point, event.pointerId);
    };

    const handleCanvasPointerUp = (event: PointerEvent) => {
      if (fineGreenStrokeRef.current?.pointerId === event.pointerId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const point = canvasPoint(event);
        if (point) extendFineGreenStroke(point, event.pointerId);
        finishFineGreenStroke(event.pointerId);
        try {
          if (pointerSurface.hasPointerCapture(event.pointerId)) pointerSurface.releasePointerCapture(event.pointerId);
        } catch { /* capture may already be released */ }
        return;
      }
      if (surfaceEditDragRef.current?.pointerId === event.pointerId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const point = canvasPoint(event);
        if (point) extendSurfaceEdit(point, event);
        finishSurfaceEdit(event.pointerId);
        try {
          if (pointerSurface.hasPointerCapture(event.pointerId)) pointerSurface.releasePointerCapture(event.pointerId);
        } catch { /* capture may already be released */ }
        return;
      }
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
      if (fineGreenStrokeRef.current?.pointerId === event.pointerId) {
        event.stopImmediatePropagation();
        cancelFineGreenStroke();
        return;
      }
      if (surfaceEditDragRef.current?.pointerId === event.pointerId) {
        event.stopImmediatePropagation();
        cancelSurfaceEdit();
        return;
      }
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
            const ge = surfaceHeightAt(g.x + 0.5, g.y + 0.5);
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
      if (
        editorMode === "SCULPT"
        && !props.playableShotMode
        && t.x >= 0 && t.y >= 0 && t.x < course.width && t.y < course.height
        && course.tiles[t.y * course.width + t.x] === "green"
      ) return; // fine-green strokes are handled by native pointer capture
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
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (event.key === "Escape") {
        if (terrainStrokeRef.current) cancelTerrainStroke();
        if (fineGreenStrokeRef.current) cancelFineGreenStroke();
        if (surfaceEditDragRef.current) cancelSurfaceEdit();
        if (clickSplineDraftRef.current.length > 0) {
          updateClickSplineDraft([]);
          updateClickSplineHover(null);
          showTerrainPreview(null);
        } else if (terrainTool === "edit" && selectedSurfaceFeatureIdRef.current) {
          updateSelectedSurface(null);
        }
        return;
      }
      if (
        terrainTool === "spline" &&
        event.key === "Enter" &&
        clickSplineDraftRef.current.length >= 2
      ) {
        event.preventDefault();
        onCommitTerrainStroke?.(clickSplineDraftRef.current);
        updateClickSplineDraft([]);
        updateClickSplineHover(null);
        showTerrainPreview(null);
        return;
      }
      if (
        terrainTool === "spline" &&
        event.key === "Backspace" &&
        clickSplineDraftRef.current.length > 0
      ) {
        event.preventDefault();
        const points = clickSplineDraftRef.current.slice(0, -1);
        updateClickSplineDraft(points);
        const hover = clickSplineHoverRef.current;
        showTerrainPreview(points.length > 0 && onPreviewTerrainStroke
          ? onPreviewTerrainStroke(hover ? [...points, hover] : points)
          : null);
        return;
      }
      if (
        terrainTool === "edit" &&
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedSurfaceFeatureIdRef.current &&
        selectedSurfaceNodeRef.current != null
      ) {
        const feature = featureForId(selectedSurfaceFeatureIdRef.current);
        if (!feature) return;
        const edited = deleteSurfaceNode(feature, selectedSurfaceNodeRef.current);
        if (!edited) return;
        event.preventDefault();
        const preview = onPreviewSurfaceFeatureEdit?.(edited) ?? null;
        showTerrainPreview(preview);
        if (preview?.affordable) {
          onCommitSurfaceFeatureEdit?.(edited);
          updateSelectedSurface(
            edited.id,
            Math.min(
              selectedSurfaceNodeRef.current,
              surfaceFeaturePoints(edited).length - 1,
            ),
          );
        }
        showTerrainPreview(null);
      }
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
  }, [appReady, screenToTile, screenToWorldPoint, screenToIsoPlane, onClickTile, onPreviewTerrainStroke, onCommitTerrainStroke, onPreviewSurfaceFeatureEdit, onCommitSurfaceFeatureEdit, onPreviewFineGreenStroke, onCommitFineGreenStroke, editorMode, terrainTool, selectedTerrain, worldCash, course, rotation, cameraState, onPickGolfer, liveActive, golfersRef, endFlyover, props.graphicsQuality, props.showGolfers, props.playableShotMode, surfaceHeightAt, updateClickSplineDraft, updateClickSplineHover, updateSelectedSurface, updateSurfaceEditDraft]);

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
      {terrainStrokePreview
        && selectedTerrain
        && (
          terrainStrokePreview.previewKind === "surface-edit"
          || (
            terrainStrokePreview.acceptedTiles[0]?.terrain
            ?? terrainStrokePreview.excludedTiles[0]?.terrain
          ) === selectedTerrain
        )
        && (
        <div
          data-testid="terrain-stroke-preview"
          role="status"
          aria-live="polite"
          data-affordable={terrainStrokePreview.affordable}
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
          <div style={{ opacity: 0.72, fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>
            {t("terrainStroke.precommit")}
          </div>
          <div style={{ fontWeight: 800, fontSize: 14, textTransform: "capitalize" }}>
            {terrainStrokePreview.affordable ? "✓" : "!"}{" "}
            {terrainStrokePreview.previewKind === "surface-edit"
              ? t("terrainStroke.surfaceEditTitle", {
                count: terrainStrokePreview.changedCount,
              })
              : t("terrainStroke.title", {
                terrain: t(TERRAIN_LABEL_KEYS[selectedTerrain]),
                count: terrainStrokePreview.changedCount,
              })}
          </div>
          <div>
            {t("terrainStroke.constructionDetail", {
              construction: formatCurrency(terrainStrokePreview.constructionCost),
              salvage: formatCurrency(terrainStrokePreview.terrainSalvage),
            })}
          </div>
          {(terrainStrokePreview.naturalClearingCost > 0 || terrainStrokePreview.naturalSalvage > 0) && (
            <div>
              {t("terrainStroke.naturalDetail", {
                clearing: formatCurrency(terrainStrokePreview.naturalClearingCost),
                salvage: formatCurrency(terrainStrokePreview.naturalSalvage),
              })}
            </div>
          )}
          {terrainStrokePreview.earthworkSteps > 0 && (
            <div>
              {t("terrainStroke.earthwork", {
                steps: terrainStrokePreview.earthworkSteps,
                cost: formatCurrency(terrainStrokePreview.earthworkCost),
              })}
            </div>
          )}
          {terrainStrokePreview.removedObstacles.length > 0 && (
            <div>
              {t("terrainStroke.clears", {
                count: terrainStrokePreview.removedObstacles.length,
              })}
            </div>
          )}
          <div>
            {t("terrainStroke.operationsDetail", {
              upkeep: `${terrainStrokePreview.weeklyUpkeepWeightDelta >= 0 ? "+" : ""}${terrainStrokePreview.weeklyUpkeepWeightDelta.toFixed(2)}`,
              demand: `${terrainStrokePreview.irrigationDemandDelta >= 0 ? "+" : ""}${terrainStrokePreview.irrigationDemandDelta.toFixed(2)}`,
            })}
          </div>
          <div>
            {t("terrainStroke.irrigationDetail", {
              cost: `${terrainStrokePreview.weeklyIrrigationCostDelta >= 0 ? "+" : "-"}${formatCurrency(Math.abs(terrainStrokePreview.weeklyIrrigationCostDelta))}`,
              season: terrainStrokePreview.irrigationMultipliers.seasonal.toFixed(2),
              weather: terrainStrokePreview.irrigationMultipliers.weather.toFixed(2),
              scarcity: terrainStrokePreview.irrigationMultipliers.scarcity.toFixed(2),
              policy: terrainStrokePreview.irrigationMultipliers.policy.toFixed(2),
            })}
          </div>
          <div>
            {t("terrainStroke.plantCareDetail", {
              cost: `${terrainStrokePreview.weeklyPlantCareCostDelta >= 0 ? "+" : "-"}${formatCurrency(Math.abs(terrainStrokePreview.weeklyPlantCareCostDelta))}`,
            })}
          </div>
          {terrainStrokePreview.climateWarnings.map((warning, index) => (
            <div key={`${warning.kind}-${index}`} style={{ marginTop: 2, fontWeight: 700 }}>
              {t("terrainStroke.climateWarning", {
                warning: warning.kind === "water-pressure"
                  ? t("terrainStroke.warning.waterPressure", {
                    biome: t(BIOME_LABEL_KEYS[warning.biome]),
                    season: warning.seasonal.toFixed(2),
                    weather: warning.weather.toFixed(2),
                    scarcity: warning.scarcity.toFixed(2),
                    policy: warning.policy.toFixed(2),
                  })
                  : warning.kind === "saturation-pressure"
                    ? t("terrainStroke.warning.saturation")
                    : t("terrainStroke.warning.heatDrought"),
              })}
            </div>
          ))}
          {terrainStrokePreview.excluded.protected > 0 && (
            <div>
              {t("terrainStroke.protected", {
                count: terrainStrokePreview.excluded.protected,
              })}
            </div>
          )}
          <div style={{ fontWeight: 700 }}>
            {t("terrainStroke.net", { net: terrainStrokePreview.net >= 0 ? formatCurrency(terrainStrokePreview.net) : t("terrainStroke.refund", { amount: formatCurrency(-terrainStrokePreview.net) }) })}
          </div>
          <div>{t("terrainStroke.cash", { cash: formatCurrency(terrainStrokePreview.cash), projected: formatCurrency(terrainStrokePreview.projectedCash) })}</div>
          {(terrainStrokePreview.excludedCount > 0 || terrainStrokePreview.unchangedCount > 0 || terrainStrokePreview.duplicateCount > 0) && (
            <div style={{ opacity: 0.88 }}>
              {t("terrainStroke.exclusionsDetailed", {
                count: terrainStrokePreview.excludedCount,
                protected: terrainStrokePreview.excluded.protected,
                unowned: terrainStrokePreview.excluded.unowned,
                locked: terrainStrokePreview.excluded.locked,
                outside: terrainStrokePreview.excluded.outOfBounds,
                unchanged: terrainStrokePreview.unchangedCount,
                duplicate: terrainStrokePreview.duplicateCount,
              })}
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
      {fineGreenStrokePreview && (
        <div
          data-testid="fine-green-stroke-preview"
          role="status"
          aria-live="polite"
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            minWidth: 220,
            padding: "11px 13px",
            borderRadius: 10,
            pointerEvents: "none",
            color: "#f7f1de",
            background: fineGreenStrokePreview.netCost <= (props.worldCash ?? 0)
              ? "rgba(22,30,22,0.94)"
              : "rgba(92,24,20,0.96)",
            border: "1px solid rgba(242,232,201,0.35)",
            boxShadow: "0 8px 28px rgba(0,0,0,0.42)",
            fontSize: 12,
            lineHeight: 1.45,
            zIndex: 20,
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 14 }}>
            {t("greenSculpt.previewTitle", { count: fineGreenStrokePreview.changedSamples })}
          </div>
          <div>{t("greenSculpt.previewCost", { cost: formatCurrency(fineGreenStrokePreview.netCost) })}</div>
          {fineGreenStrokePreview.clippedPoints > 0 && (
            <div>{t("greenSculpt.previewClipped", { count: fineGreenStrokePreview.clippedPoints })}</div>
          )}
          <div style={{ opacity: 0.72 }}>{t("greenSculpt.previewRelease")}</div>
        </div>
      )}
      {editorMode === "PAINT" && (terrainTool === "spline" || terrainTool === "edit") && (
        <div
          data-testid="surface-authoring-instructions"
          role="status"
          style={{
            position: "absolute",
            left: 14,
            bottom: 86,
            maxWidth: 430,
            padding: "8px 11px",
            borderRadius: 8,
            pointerEvents: "none",
            color: "#f7f1de",
            background: "rgba(22,30,22,0.88)",
            border: "1px solid rgba(242,232,201,0.28)",
            fontSize: 11,
            lineHeight: 1.4,
            zIndex: 18,
          }}
        >
          {terrainTool === "spline"
            ? "Click to place spline nodes. Double-click or press Enter to build; Backspace removes the last node; Escape cancels."
            : selectedSurfaceFeature
              ? "Drag gold nodes to reshape. Drag blue handles to tune tangents (hold Alt to break symmetry). Double-click an edge to add a node; Delete removes the selected node."
              : "Click a persisted curved surface to select and edit its nodes."}
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
