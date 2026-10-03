import { ownSceneMeshGeometry } from "./renderer/ownedSceneMeshGeometry";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
// Pixi's strict-CSP adapter replaces runtime-generated shader/uniform
// functions with static implementations. Keep this before renderer startup so
// Workers deployments can retain a script-src policy without 'unsafe-eval'.
import "pixi.js/unsafe-eval";
import { destroySceneSubtree } from "./renderer/destroySceneSubtree";
import * as PIXI from "pixi.js";
import { completeNativeSceneDisposers, guardNativeRendererCleanup, NativeRendererSession, type NativeRendererLease } from "./renderer/nativeRendererSession";
import { NativeRendererOwner } from "./renderer/nativeRendererOwner";
import type { Course, DecorationKind, DecorationRotation, Hole, Obstacle, Point, SurfaceFeature, TeeSet, Terrain, TerrainAuthoringTool } from "../game/models/types";
import type { ShotRoutePresentation } from "../game/presentation/shotRoutePresentation";
import type { GolferRenderData } from "../game/live/types";
import type { PlayerPlayableRound, PlayerProPoint } from "../game/models/playerProTypes";
import type { PlayerProWorldDisplayPresentation } from "../game/playerPro/socialPresentation";
import type { SeasonName } from "../game/seasons/types";
import type { SeasonalVisualState } from "../game/presentation/seasonalVisualState";
import type { CameraState, IsoCameraSnapshot } from "../game/render/camera";
import {
  ELEVATION_STEP_PX,
  TILE_H,
  TILE_W,
  isoDepth,
  tileCenterIso,
  unrotateWorld,
  worldToIso,
  type IsoRotation,
} from "../game/render/iso";
import {
  atlasActivationSnapshot,
  atlasFallbackDiagnostics,
  atlasResidencySnapshot,
  getLandscapeMaterialField,
  getParklandComposableField,
  getParklandComposableRuntime,
  getPathMaterialField,
  getPropFrame,
  getTerrainDetailFrame,
  getTerrainFrame,
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
import { formatCurrency } from "../i18n/format";
import type { MessageKey } from "../i18n/catalog";
import { useI18n } from "../i18n/useI18n";
import { ELEVATION_MAX, getElevation } from "../game/models/elevation";
import { retainedPreviewShotPose } from "../game/render/ballFlight";
import { TERRAIN_PALETTES, terrainPattern } from "../accessibility/terrainPalettes";
import type { ColorVisionMode } from "../game/onboarding/profile";
import type { ResortOperations } from "../game/property/types";
import type { Keybindings } from "../accessibility/keybindings";
import { buildFlyoverKeys } from "../game/render/flyover";
import { recordM35Metric } from "../game/render/m35Telemetry";
import type { CourseSceneCompositionPlanV1 } from "../game/render/courseSceneComposition";
import { computeAutoPar, computeHoleDistanceTiles } from "../game/sim/holeMetrics";
import { getBiomeDefinition } from "../game/models/biomes";
import type { ArchitectureReferencePlan } from "../game/architecture/referencePlan";
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
import type { ParklandComposableDiagnostics } from "../game/render/parklandComposable";
import { deriveTerrainDetail } from "../game/render/terrainDetails";
import {
  seasonalTerrainTreatment,
  type SeasonalTerrainTreatment,
} from "../game/render/seasonalTerrainPresentation";
import {
  hillReliefStrength,
  terrainReliefStyle,
  terrainSurfaceInsetPx,
} from "../game/render/terrainRelief";
import {
  buildVisualHeightfield,
  createLandscapeComponentCache,
  maintainedChunkUnderlay,
  sampleLandscapeSurfaceHeight,
  sampleVisualHeight,
  shouldRenderLegacyElevationFace,
  type LandscapeComponent,
} from "../game/render/landscapeGeometry";
import { buildHazardBankFacePlan, hazardChunkUnderlay, hazardDepthProfile, isInteriorBankFacingViewer } from "../game/render/hazardDepth";
import { buildLandscapeBoundaryRuns } from "../game/render/landscapeEdges";
import { buildSignedContourRibbons, shouldProjectContourRibbon } from "../game/render/contourRibbons";
import {
  buildHazardVisualRings,
  classifyBunkerVisualType,
} from "../game/render/bunkerShapes";
import { authoredBunkerRings, cachedBunkerPresentation, capturedBunkerBoundary } from "../game/render/bunkerPresentation";
import { buildMacroLandformRaster } from "../game/render/macroLandform";
import { buildLandformPresentationPlan } from "../game/render/landformGeometry";
import { isMaintained } from "../game/render/materialFields";
import type { TerrainPresentationDiagnostics } from "../game/render/terrainPresentationPolicy";
import {
  buildPathMaterialScenePlan,
  pathMaterialStripMesh,
} from "./renderer/scenes/pathMaterialScene";
import {
  pickNaturalProp,
} from "../game/render/naturalProps";
import {
  seasonalPlantClimate,
  seasonalPlantPresentation,
  seasonalPlantSceneSignature,
} from "../game/render/seasonalPlants";
import { T } from "../i18n/T";
import type { ArchitectureWarning } from "../game/architecture/architecture";
import type { ArchitectureOverlayRender } from "../game/architecture/reviewTypes";
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
  normalizeSurfaceCareState,
  surfaceCarePresentationSignature,
  surfaceCareTopology,
  surfaceCareVisualSignatures,
} from "../game/conditions/surfaceCare";
import {
  RenderRevisionTracker,
  architectureOverlayRevisionDependencies,
  habitatFieldRevisionDependencies,
  holeMarkersRevisionDependencies,
  mobilityEntitiesRevisionDependencies,
  playerProCollectionRevisionDependencies,
  propertyAssetsRevisionDependencies,
  structuresPropsRevisionDependencies,
  surfaceEditorRevisionDependencies,
  terrainWaterRevisionDependencies,
  type RenderSnapshot,
} from "../game/render/renderSnapshot";
import { SceneSystemHost } from "./renderer/SceneSystemHost";
import { createOpeningPreviewSceneSystem } from "./renderer/scenes/openingPreviewScene";
import {
  createAtmosphereSceneSystem,
  type AtmosphereSceneSystem,
} from "./renderer/scenes/atmosphereScene";
import {
  createSurfaceCareSceneSystem,
  type SurfaceCareWorkerSprite,
} from "./renderer/scenes/surfaceCareScene";
import type { StableSceneDecalLayers } from "./renderer/scenes/structuresPropsScene";
import type { NaturalPropsSceneSystem } from "./renderer/scenes/naturalPropsScene";
import type { HabitatFieldSceneSystem } from "./renderer/scenes/habitatFieldScene";
import type { PlayerProCollectionSceneSystem } from "./renderer/scenes/playerProCollectionScene";
import type { HoleMarkersSceneSystem } from "./renderer/scenes/holeMarkersScene";
import {
  createOverlaysDiagnosticsSceneSystem,
  type OverlaysDiagnosticsSceneSystem,
} from "./renderer/scenes/overlaysDiagnosticsScene";
import { createEstateSurveySceneSystem } from "./renderer/scenes/estateSurveyScene";
import { createArchitectureOverlaySceneSystem, routeDestinationHierarchy } from "./renderer/scenes/architectureOverlayScene";
import { createPropertyAssetsSceneSystem } from "./renderer/scenes/propertyAssetsScene";
import { createSurfaceEditorSceneSystem } from "./renderer/scenes/surfaceEditorScene";
import {
  createMobilityEntitiesSceneSystem,
  type MobilityEntitiesSceneSystem,
} from "./renderer/scenes/mobilityEntitiesScene";
import {
  createLiveEntitiesSceneSystem,
  type LiveEntitiesSceneSystem,
} from "./renderer/scenes/liveEntitiesScene";
import type {
  TerrainWaterChunk,
  TerrainWaterSceneSystem,
} from "./renderer/scenes/terrainWaterScene";
import type {
  ViewportInputController,
  ViewportInputConfig,
} from "./renderer/viewportInputController";

type DeferredWorldScenes = typeof import("./renderer/scenes/deferredWorldScenes");
type ViewportInputControllerModule = typeof import("./renderer/viewportInputController");
type DeriveCourseSceneComposition = typeof import("../game/render/courseSceneComposition")["deriveCourseSceneComposition"];
type DeriveCourseSceneCamera = typeof import("../game/render/courseSceneCamera")["deriveCourseSceneCamera"];

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

const ROUTE_LABEL = "route-overlay";
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 8;

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

function mixColor(color: number, target: number, amount: number): number {
  const t = Math.max(0, Math.min(1, amount));
  const mix = (shift: number) => Math.round(
    ((color >> shift) & 0xff) * (1 - t) + ((target >> shift) & 0xff) * t,
  );
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
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
  quality: "high" | "medium" | "low",
  showPattern: boolean,
): PIXI.Texture {
  const size = quality === "high" ? 512 : quality === "medium" ? 256 : 128;
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

  const organicCount = quality === "high" ? 92 : quality === "medium" ? 52 : 24;
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
    const flecks = quality === "high" ? 260 : quality === "medium" ? 120 : 48;
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

/**
 * Fine, repeat-safe mineral grain for the path core. This intentionally skips
 * the broad organic ellipses used by landscape fields: compacted aggregate
 * should read as dense dust and irregular small stones, never as panels.
 */
function createCompactedPathCoreTexture(
  baseColor: number,
  quality: "high" | "medium" | "low",
): PIXI.Texture {
  const size = quality === "high" ? 512 : quality === "medium" ? 256 : 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return PIXI.Texture.WHITE;

  const compactedBase = mixColor(baseColor, 0x9f957f, 0.1);
  let state = (terrainMaterialSeed("path", compactedBase) ^ 0xc0a5e71d) >>> 0;
  const nextRandom = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const random = () => nextRandom() / 0x1_0000_0000;

  // A bounded per-pixel mineral noise floor prevents broad flat plateaus.
  // Linear texture sampling blends it into dust rather than square pixels.
  const pixels = context.createImageData(size, size);
  const baseRed = (compactedBase >> 16) & 0xff;
  const baseGreen = (compactedBase >> 8) & 0xff;
  const baseBlue = compactedBase & 0xff;
  const clampChannel = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const sample = nextRandom();
    const grain = ((sample & 0xff) / 255 - 0.5) * 14;
    const warmth = (((sample >>> 8) & 0xff) / 255 - 0.5) * 3;
    pixels.data[offset] = clampChannel(baseRed + grain + warmth);
    pixels.data[offset + 1] = clampChannel(baseGreen + grain + warmth * 0.35);
    pixels.data[offset + 2] = clampChannel(baseBlue + grain - warmth);
    pixels.data[offset + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const repeatShape = (
    x: number,
    y: number,
    margin: number,
    draw: (dx: number, dy: number) => void,
  ) => {
    const offsetsX = [0, ...(x < margin ? [size] : []), ...(x > size - margin ? [-size] : [])];
    const offsetsY = [0, ...(y < margin ? [size] : []), ...(y > size - margin ? [-size] : [])];
    for (const ox of offsetsX) for (const oy of offsetsY) {
      draw(x + ox, y + oy);
    }
  };

  // Low-contrast dust clumps give the core body without creating large blobs.
  const dustCount = quality === "high" ? 950 : 520;
  for (let index = 0; index < dustCount; index++) {
    const x = random() * size;
    const y = random() * size;
    const radius = (quality === "high" ? 1.2 : 0.8) + random() * (quality === "high" ? 3.8 : 2.7);
    const warm = random() > 0.42;
    const color = mixColor(compactedBase, warm ? 0xc8b98f : 0x5f625f, 0.2 + random() * 0.16);
    const alpha = 0.12 + random() * 0.11;
    const stretch = 0.55 + random() * 0.75;
    const angle = random() * Math.PI;
    context.fillStyle = colorCss(color, alpha);
    repeatShape(x, y, radius * 1.35, (dx, dy) => {
      context.beginPath();
      context.ellipse(dx, dy, radius, radius * stretch, angle, 0, Math.PI * 2);
      context.fill();
    });
  }

  // Dense sub-tile grains stay legible at 1x and 2.25x while their irregular
  // silhouettes avoid square chips, aligned seams, and per-cell repetition.
  const aggregateCount = quality === "high" ? 1800 : 1100;
  for (let index = 0; index < aggregateCount; index++) {
    const x = random() * size;
    const y = random() * size;
    const radius = (quality === "high" ? 0.65 : 0.5) + random() * (quality === "high" ? 1.7 : 1.3);
    const colorRoll = random();
    const color = mixColor(
      compactedBase,
      colorRoll < 0.4 ? 0xd8ceb4 : colorRoll < 0.77 ? 0x6b6961 : 0xa98e62,
      0.38 + random() * 0.32,
    );
    const alpha = 0.36 + random() * 0.3;
    const vertices = 3 + Math.floor(random() * 3);
    const rotation = random() * Math.PI * 2;
    const radii = Array.from({ length: vertices }, () => radius * (0.65 + random() * 0.55));
    context.fillStyle = colorCss(color, alpha);
    repeatShape(x, y, radius * 1.25, (dx, dy) => {
      context.beginPath();
      for (let vertex = 0; vertex < vertices; vertex++) {
        const angle = rotation + vertex / vertices * Math.PI * 2;
        const px = dx + Math.cos(angle) * radii[vertex];
        const py = dy + Math.sin(angle) * radii[vertex];
        if (vertex === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.closePath();
      context.fill();
    });
  }

  const texture = PIXI.Texture.from(canvas);
  texture.source.style.addressMode = "repeat";
  texture.source.style.scaleMode = "linear";
  return texture;
}

// Cliff face colors (exposed earth), lit by the fixed NW sun: the SW-facing
// (screen lower-left) face sits in shadow, the SE-facing face catches more.

export interface PixiStageProps {
  nativeSession?: PixiRendererSession;
  course: Course;
  holes: Hole[];
  obstacles: Obstacle[];
  activeHoleIndex: number;
  /** Route geometry and destination markers have distinct simulation authority. */
  activeShotRoute?: ShotRoutePresentation | null;
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
  openingMarker?: RenderSnapshot["openingMarker"];
  openingTargets?: RenderSnapshot["openingTargets"];
  openingFollow?: boolean;
  onOpeningFollowCanceled?: () => void;
  playableShotMode?: boolean;
  /** Already-filtered, player-visible inventory dressing near the clubhouse. */
  playerProWorldDisplay?: PlayerProWorldDisplayPresentation | null;
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
  sceneDecals: StableSceneDecalLayers;
  surfaceEditor: PIXI.Container;
  objects: PIXI.Container;
  fx: PIXI.Container;
  screenOverlay: PIXI.Container;
}

interface PathMaterialRenderDiagnostics {
  active: boolean;
  mode: "legacy" | "cross-section";
  quality: "high" | "medium" | "low";
  componentCount: number;
  stripCount: number;
  roles: readonly ("shoulder" | "edge" | "core")[];
  textureIds: readonly string[];
  widths: { shoulder: number; edge: number };
  ownership: readonly string[];
}

interface LandformDepthDiagnostics {
  active: boolean;
  quality: "high" | "medium" | "low";
  macro: {
    active: boolean;
    maximumGrade: number;
    maximumShadowAlpha: number;
    maximumHighlightAlpha: number;
  };
  shoulderLevels: readonly number[];
  shoulderFaces: number;
  topSurfaceCrests: number;
  topSurfaceCrestLevels: readonly number[];
  surfaceForm: { mode: "material-field"; samples: number; levels: readonly number[] };
  hazards: readonly {
    terrain: "sand" | "water" | "wetland";
    topologyKey: string;
    rings: number;
    nearFaces: number;
    farFaces: number;
    minimumDropPx: number;
    maximumDropPx: number;
    floorBoundaryOwner: "shared";
    interiorFaceAreaPx: number;
  }[];
}

const emptyLandformDepthDiagnostics = (
  quality: "high" | "medium" | "low",
): LandformDepthDiagnostics => ({
  active: false,
  quality,
  macro: {
    active: false,
    maximumGrade: 0,
    maximumShadowAlpha: 0,
    maximumHighlightAlpha: 0,
  },
  shoulderLevels: [],
  shoulderFaces: 0,
  topSurfaceCrests: 0,
  topSurfaceCrestLevels: [],
  surfaceForm: { mode: "material-field", samples: 0, levels: [] },
  hazards: [],
});

type SharedContourRenderDiagnostics = TerrainPresentationDiagnostics;

const EMPTY_SHARED_CONTOUR_DIAGNOSTICS = {
  authoritativeSingletonDeepRough: 0,
  distinctSingletonDeepRoughFields: 0,
  distinctSingletonDeepRoughBands: 0,
  coalescedSingletonDeepRough: 0,
} as SharedContourRenderDiagnostics;

function landscapeOptionsForQuality(quality: "high" | "medium" | "low") {
  const high = quality === "high";
  return { cornerRadius: high ? 0.4 : 0.32, cornerSegments: high ? 4 : 2 };
}

function effectiveSurfaceTilesForRenderer(
  tiles: Course["tiles"],
  width: number,
  height: number,
  surfaceCare: Course["surfaceCare"],
  surfaceIntent: Course["surfaceIntent"],
  estate: Course["estate"],
): Course["tiles"] {
  return courseWithEffectiveSurfaces({
    tiles,
    width,
    height,
    surfaceCare,
    surfaceIntent,
    estate,
  } as Course).tiles;
}

function visualHeightfieldForRenderer(
  tiles: Course["tiles"],
  elevations: Course["elevations"],
  width: number,
  height: number,
  buildings: Course["buildings"],
  propertyAssets: NonNullable<Course["property"]>["assets"] | undefined,
  theme: Course["theme"],
) {
  return buildVisualHeightfield({
    tiles,
    elevations,
    width,
    height,
    buildings,
    property: propertyAssets ? { assets: propertyAssets } : undefined,
    theme,
  } as Course, undefined, "topology-only");
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
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (width <= 0 || height <= 0 || screenW <= 0 || screenH <= 0) return 1;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min((screenW * 0.95) / width, (screenH * 0.95) / height)));
}

export interface NativeRendererConfiguration {
  readonly width: number;
  readonly height: number;
  readonly resolution: number;
  readonly antialias: boolean;
}
type PixiRendererSession = NativeRendererSession<PIXI.Application, PIXI.Texture, NativeRendererConfiguration>;
type PixiRendererLease = NativeRendererLease<PIXI.Application, PIXI.Texture, NativeRendererConfiguration>;

// These ports retain native resources only; no React props, refs or course callbacks.
function createNativeRendererOwner(): NativeRendererOwner<PIXI.Application, PIXI.Texture, NativeRendererConfiguration> {
  return new NativeRendererOwner({
    create: () => new PIXI.Application(),
    initialize: async (app, config) => {
      await app.init({
        width: config.width,
        height: config.height,
        backgroundColor: 0xdfe8d8,
        antialias: config.antialias,
        resolution: config.resolution,
        autoDensity: true,
        eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
      });
    },
    compatible: (created, requested) => created.resolution === requested.resolution
      && created.antialias === requested.antialias,
    resume: (app, config) => {
      app.renderer.resize(config.width, config.height, config.resolution);
      app.start();
    },
    stop: (app) => { if (typeof app.stop === "function" && app.ticker) app.stop(); },
    detachCanvas: (app) => { if (app.renderer) app.canvas.remove(); },
    destroy: (app) => {
      // Rejected renderer initialization has a public stage but no renderer/ticker yet.
      if (app.renderer) app.destroy({ removeView: true, releaseGlobalResources: false }, { children: true, texture: false, textureSource: false });
      else app.stage?.destroy({ children: true, texture: false, textureSource: false });
    },
    createDiamond: (app) => {
      const g = new PIXI.Graphics();
      try {
        g.poly([TILE_W / 2, 0, TILE_W, TILE_H / 2, TILE_W / 2, TILE_H, 0, TILE_H / 2]);
        g.fill(0xffffff);
        g.stroke({ width: 1, color: 0xffffff, alpha: 0.35 });
        return app.renderer.generateTexture(g);
      } finally { g.destroy(); }
    },
    destroyDiamond: (texture) => { texture.destroy(true); },
  });
}

export function PixiStage(props: PixiStageProps) {
  const { t } = useI18n();
  const [session] = useState(() => props.nativeSession ?? new NativeRendererSession(createNativeRendererOwner));
  session.configure(createNativeRendererOwner);
  const [failed, setFailed] = useState(false);
  const onRendererFailure = useCallback(() => setFailed(true), []);
  useEffect(() => () => {
    if (!props.nativeSession) void session.close().catch((error: unknown) => {
      console.error("[PixiStage] Renderer cleanup failed", error);
    });
  }, [props.nativeSession, session]);
  if (!failed) return <PixiScene {...props} nativeSession={session} onRendererFailure={onRendererFailure} />;
  return (
    <div className={`cc-pixi-stage cc-tool-${props.playableShotMode ? "player-shot" : props.editorMode.toLowerCase()}`}
      style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden" }}>
      <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden", cursor: "crosshair", touchAction: "none" }} />
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
    </div>
  );
}


function PixiScene(requestedProps: PixiStageProps & { nativeSession: PixiRendererSession; onRendererFailure(): void }) {
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
  const initialCameraCompositionInputRef = useRef<readonly [Course, number]>([
    renderedCourse,
    requestedProps.worldSeed,
  ]);
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
  const sceneSystemHostRef = useRef<SceneSystemHost | null>(null);
  const atmosphereSceneRef = useRef<AtmosphereSceneSystem | null>(null);
  const naturalPropsSceneRef = useRef<NaturalPropsSceneSystem | null>(null);
  const habitatFieldSceneRef = useRef<HabitatFieldSceneSystem | null>(null);
  const playerProCollectionSceneRef = useRef<PlayerProCollectionSceneSystem | null>(null);
  const holeMarkersSceneRef = useRef<HoleMarkersSceneSystem | null>(null);
  const mobilityEntitiesSceneRef = useRef<MobilityEntitiesSceneSystem | null>(null);
  const liveEntitiesSceneRef = useRef<LiveEntitiesSceneSystem | null>(null);
  const overlaysDiagnosticsSceneRef = useRef<OverlaysDiagnosticsSceneSystem | null>(null);
  const terrainWaterSceneRef = useRef<TerrainWaterSceneSystem | null>(null);
  const deferredWorldScenesRef = useRef<DeferredWorldScenes | null>(null);
  const viewportInputControllerModuleRef = useRef<ViewportInputControllerModule | null>(null);
  const sceneCameraDeriversRef = useRef<readonly [DeriveCourseSceneComposition, DeriveCourseSceneCamera] | null>(null);
  const [courseSceneCompositionEntry, setCourseSceneCompositionEntry] = useState<readonly [
    Course,
    number,
    CourseSceneCompositionPlanV1,
  ] | null>(null);
  const renderRevisionTrackerRef = useRef(new RenderRevisionTracker());
  const [appReady, setAppReady] = useState(false);
  const atlasRevision = atlasContext.generation;
  const seasonalPlantsSignature = seasonalPlantSceneSignature(
    props.seasonalVisualState,
  );
  const hasResortServicePressure =
    (props.resortOperations?.dirtyRooms ?? 0)
    + (props.resortOperations?.outOfOrderRooms ?? 0) > 0;

  const pathMaterialDiagnosticsRef = useRef<PathMaterialRenderDiagnostics>({
    active: false,
    mode: "legacy",
    quality: initialRendererConfigRef.current.graphicsQuality,
    componentCount: 0,
    stripCount: 0,
    roles: ["core"],
    textureIds: ["legacy:path"],
    widths: { shoulder: 0, edge: 0 },
    ownership: [],
  });
  const bunkerContoursRef = useRef<Array<{ rotation: IsoRotation; cells: number[]; boundary: Array<Array<{ x: number; y: number }>>; floor: Array<Array<{ x: number; y: number }>> }>>([]);
  const sharedContourDiagnosticsRef = useRef<SharedContourRenderDiagnostics>(
    EMPTY_SHARED_CONTOUR_DIAGNOSTICS,
  );
  const parklandComposableDiagnosticsRef = useRef<ParklandComposableDiagnostics>(
    null as unknown as ParklandComposableDiagnostics,
  );
  const landformDepthDiagnosticsRef = useRef<LandformDepthDiagnostics>(
    emptyLandformDepthDiagnostics(initialRendererConfigRef.current.graphicsQuality),
  );
  const structureSpriteCountRef = useRef(0);
  const surfaceCareWorkersRef = useRef<SurfaceCareWorkerSprite[]>([]);
  const dayMinuteRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    dayMinuteRef.current = props.dayMinute;
  });

  // Free camera (ZKU-141): current values lerp toward targets each frame.
  // Center is in world tile coordinates so it survives rotation changes.
  const [rotation, setRotation] = useState<IsoRotation>(0);
  const viewportInputControllerRef = useRef<ViewportInputController | null>(null);
  const [flyoverCard, setFlyoverCard] = useState<{ hole: number; par: number; yards: number } | null>(null);
  const [rendererError, setRendererError] = useState(false);
  const nativeSession = requestedProps.nativeSession;
  const onRendererFailure = requestedProps.onRendererFailure;
  const nativeMountRef = useRef<{ lease: PixiRendererLease; application: PIXI.Application | null } | null>(null);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const lease = nativeSession.claim({
      width: Math.max(container.clientWidth || 800, 100),
      height: Math.max(container.clientHeight || 600, 100),
      resolution: (window.devicePixelRatio || 1) * initialRendererConfigRef.current.resolutionScale,
      antialias: true,
    });
    const mount = { lease, application: null as PIXI.Application | null };
    nativeMountRef.current = mount;
    return () => {
      nativeSession.invalidate(lease);
      if (nativeMountRef.current === mount) nativeMountRef.current = null;
    };
  }, [nativeSession]);
  useEffect(() => {
    if (!rendererError) return;
    const mount = nativeMountRef.current;
    if (mount) void nativeSession.fail(mount.lease).catch((error: unknown) => {
      console.error("[PixiStage] Renderer cleanup failed", error);
    });
    // Unmount the failed scene so every effect cleanup runs before native finalization.
    onRendererFailure();
  }, [nativeSession, onRendererFailure, rendererError]);
  const [terrainStrokePreview, setTerrainStrokePreview] = useState<TerrainStrokePreview | null>(null);
  const [fineGreenStrokePreview, setFineGreenStrokePreview] = useState<FineGreenSculptPreview | null>(null);
  const [clickSplineDraft, setClickSplineDraft] = useState<Point[]>([]);
  const [clickSplineHover, setClickSplineHover] = useState<Point | null>(null);
  const [selectedSurfaceFeatureId, setSelectedSurfaceFeatureId] = useState<string | null>(null);
  const [selectedSurfaceNode, setSelectedSurfaceNode] = useState<number | null>(null);
  const [surfaceEditDraft, setSurfaceEditDraft] = useState<SurfaceFeature | null>(null);

  const {
    course,
    holes,
    obstacles,
    activeHoleIndex,
    activeShotRoute,
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
    onCameraCenter,
    selectedTeeSet,
    showGridOverlays,
    worldSeed,
  } = props;
  const courseSceneComposition = courseSceneCompositionEntry?.[0] === course
    && courseSceneCompositionEntry[1] === worldSeed
    ? courseSceneCompositionEntry[2]
    : null;
  useEffect(() => {
    if (!appReady || courseSceneComposition) return;
    const derivePlan = sceneCameraDeriversRef.current?.[0];
    if (!derivePlan) return;
    setCourseSceneCompositionEntry([course, worldSeed, derivePlan({ course, seed: worldSeed })]);
  }, [appReady, course, courseSceneComposition, worldSeed]);
  const effectiveTiles = useMemo(() => effectiveSurfaceTilesForRenderer(
    course.tiles,
    course.width,
    course.height,
    course.surfaceCare,
    course.surfaceIntent,
    course.estate,
  ), [
    course.estate,
    course.height,
    course.surfaceCare,
    course.surfaceIntent,
    course.tiles,
    course.width,
  ]);
  const presentationRuntime = getParklandComposableRuntime();
  const terrainPresentation = presentationRuntime?.buildTerrainPresentationMap(
    effectiveTiles,
    course.width,
    course.height,
    course.theme,
  );
  const presentationTiles = terrainPresentation?.presentationTiles ?? effectiveTiles;
  const careVisualSignatures = useMemo(
    () => surfaceCareVisualSignatures(course),
    [course],
  );
  const carePresentationSignature = useMemo(
    () => surfaceCarePresentationSignature(course),
    [course],
  );
  const terrainTool = props.terrainTool ?? "curve";
  const selectedSurfaceFeature = useMemo(() => (
    surfaceEditDraft
    ?? course.surfaceIntent?.features.find((feature) => feature.id === selectedSurfaceFeatureId)
    ?? null
  ), [course.surfaceIntent, selectedSurfaceFeatureId, surfaceEditDraft]);

  const visualHeightfield = useMemo(() => visualHeightfieldForRenderer(
    course.tiles,
    course.elevations,
    course.width,
    course.height,
    course.buildings,
    course.property?.assets,
    course.theme,
  ), [
    course.buildings,
    course.elevations,
    course.height,
    course.property?.assets,
    course.theme,
    course.tiles,
    course.width,
  ]);
  const landscapeComponentCacheRef = useRef(createLandscapeComponentCache());
  const landscapeComponents = useMemo(() => {
    const options = landscapeOptionsForQuality(props.graphicsQuality);
    const snapshot = landscapeComponentCacheRef.current.update(
      effectiveTiles,
      course.width,
      course.height,
      options,
    );
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
  const surfaceHeightAt = useCallback((x: number, y: number) => {
    const index = Math.max(0, Math.min(course.height - 1, Math.floor(y))) * course.width
      + Math.max(0, Math.min(course.width - 1, Math.floor(x)));
    if (props.graphicsQuality === "low" && !isMaintained(effectiveTiles[index])
      && (effectiveTiles[index] !== "sand" || !presentationRuntime)) {
      return course.elevations[index] ?? 0;
    }
    return sampleLandscapeSurfaceHeight(
      visualHeightfield,
      landscapeComponentByCell[index],
      x,
      y,
      true,
    );
  }, [
    course.elevations,
    course.height,
    course.width,
    effectiveTiles,
    landscapeComponentByCell,
    presentationRuntime,
    props.graphicsQuality,
    visualHeightfield,
  ]);

  // ZK-679 first slice: scene systems consume one typed snapshot. Each
  // revision list mirrors only the inputs read by that system, so unrelated
  // React renders no longer imply that every extracted layer must rebuild.
  const surfaceEditorSnapshot = useMemo(() => ({
    width: course.width,
    height: course.height,
    tiles: course.tiles,
    elevations: course.elevations,
    greenSurface: course.greenSurface,
    previewSurface: fineGreenStrokePreview?.surface,
    editorMode,
    showGridOverlays: props.showGridOverlays,
    graphicsQuality: props.graphicsQuality,
    colorVision: props.colorVision,
    terrainTool,
    splineDraft: clickSplineDraft,
    splineHover: clickSplineHover,
    selectedFeature: selectedSurfaceFeature,
    selectedNode: selectedSurfaceNode,
    rotation,
    surfaceHeightAt,
  }), [
    clickSplineDraft,
    clickSplineHover,
    course.elevations,
    course.greenSurface,
    course.height,
    course.tiles,
    course.width,
    editorMode,
    fineGreenStrokePreview?.surface,
    props.colorVision,
    props.graphicsQuality,
    props.showGridOverlays,
    rotation,
    selectedSurfaceFeature,
    selectedSurfaceNode,
    surfaceHeightAt,
    terrainTool,
  ]);
  const activeRouteDestinations = useMemo(() => {
    const hole = holes[activeHoleIndex];
    return routeDestinationHierarchy(hole, course.activePinRotation ?? "A", activeShotRoute?.destinations);
  }, [activeHoleIndex, activeShotRoute?.destinations, course.activePinRotation, holes]);
  const renderRevisions = renderRevisionTrackerRef.current.update({
    terrainWater: terrainWaterRevisionDependencies({
      atlasRevision,
      course,
      effectiveTiles,
      graphicsQuality: props.graphicsQuality,
      colorVision: props.colorVision,
      reducedMotion: Boolean(props.reducedMotion),
      seasonalVisualState: props.seasonalVisualState,
      terrainPatterns: props.terrainPatterns,
      worldSeed: props.worldSeed,
      rotation,
    }),
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
    structuresProps: structuresPropsRevisionDependencies({
      atlasRevision,
      course,
      effectiveTiles,
      graphicsQuality: props.graphicsQuality,
      rotation,
      seasonalPlantsSignature,
    }),
    playerProCollection: playerProCollectionRevisionDependencies({
      atlasRevision,
      course,
      graphicsQuality: props.graphicsQuality,
      rotation,
      surfaceHeightAt,
      worldDisplay: props.playerProWorldDisplay,
    }),
    mobilityEntities: mobilityEntitiesRevisionDependencies({
      course,
      rotation,
      surfaceHeightAt,
    }),
    liveEntities: [course, effectiveTiles, rotation, surfaceHeightAt],
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
    habitatField: habitatFieldRevisionDependencies({
      atlasRevision,
      course,
      effectiveTiles,
      obstacles,
      holes,
      worldSeed: props.worldSeed,
      graphicsQuality: props.graphicsQuality,
      colorVision: props.colorVision,
      rotation,
      surfaceHeightAt,
    }),
    propertyAssets: propertyAssetsRevisionDependencies({
      course,
      hasResortServicePressure,
      rotation,
      surfaceHeightAt,
    }),
    holeMarkers: holeMarkersRevisionDependencies({
      holes,
      activePinRotation: course.activePinRotation,
      draftTee,
      draftGreen,
      selectedTeeSet: props.selectedTeeSet,
      showMarkers: props.showMarkers,
      rotation,
      surfaceHeightAt,
      flagColor: props.flagColor,
      animationsEnabled: props.animationsEnabled,
      reducedMotion: Boolean(props.reducedMotion),
    }),
    surfaceEditor: surfaceEditorRevisionDependencies(surfaceEditorSnapshot),
    architectureOverlay: architectureOverlayRevisionDependencies({
      activePath: activeShotRoute?.geometry,
      activeShotDestinations: activeRouteDestinations,
      activePinRotation: course.activePinRotation,
      failingCorridorSegments,
      holes,
      architectureOverlay: props.architectureOverlay,
      architectureWarnings: props.architectureWarnings,
      paceBottlenecks: props.paceBottlenecks,
      showMarkers: props.showMarkers,
      showFixOverlay,
      showShotPlan,
      rotation,
      surfaceHeightAt,
    }),
    overlaysDiagnostics: [
      props.playerRound,
      props.playerShotAim,
      rotation,
      surfaceHeightAt,
    ],
    openingPreview: [props.openingMarker, props.openingTargets, rotation, surfaceHeightAt],
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
    showMarkers: props.showMarkers !== false,
    selectedTeeSet: props.selectedTeeSet,
    flagColor: props.flagColor,
    activePath: activeShotRoute?.geometry,
    activeShotDestinations: activeRouteDestinations,
    architectureWarnings: props.architectureWarnings,
    architectureOverlay: props.architectureOverlay,
    paceBottlenecks: props.paceBottlenecks,
    showFixOverlay,
    failingCorridorSegments,
    showShotPlan,
    hasResortServicePressure,
    atlasRevision,
    playerRound: props.playerRound,
    playerShotAim: props.playerShotAim,
    openingMarker: props.openingMarker,
    openingTargets: props.openingTargets,
    playerProWorldDisplay: props.playerProWorldDisplay,
    surveyMode: Boolean(props.surveyMode),
    selectedParcelId: props.selectedParcelId,
    worldSeed: props.worldSeed,
    surfaceHeightAt,
    surfaceEditor: surfaceEditorSnapshot,
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
    props.openingMarker,
    props.openingTargets,
    props.playerProWorldDisplay,
    props.reducedMotion,
    props.selectedParcelId,
    props.seasonalVisualState,
    props.showObstacles,
    props.showMarkers,
    props.selectedTeeSet,
    props.flagColor,
    activeShotRoute,
    activeRouteDestinations,
    props.architectureWarnings,
    props.architectureOverlay,
    props.paceBottlenecks,
    showFixOverlay,
    failingCorridorSegments,
    showShotPlan,
    hasResortServicePressure,
    props.surveyMode,
    props.worldSeed,
    renderRevisions,
    rotation,
    surfaceHeightAt,
    surfaceEditorSnapshot,
  ]);
  // ---------------------------------------------------------------------
  // Camera: world container transform + screen↔world mapping
  // ---------------------------------------------------------------------

  const viewportCamera = useCallback(() => viewportInputControllerRef.current?.cameraSnapshot() ?? {
    cx: 0, cy: 0, zoom: 1, tcx: 0, tcy: 0, tzoom: 1, initialized: false,
  }, []);
  const clampCenter = useCallback((x: number, y: number): Point => {
    const controller = viewportInputControllerRef.current;
    if (!controller) return clampScenicCameraCenter(
      { x, y }, course.width, course.height,
      SCENIC_CAMERA_MARGIN_TILES, SCENIC_CAMERA_MARGIN_TILES,
    );
    return controller.clampTarget({ x, y });
  }, [course.height, course.width]);
  const cullChunks = useCallback(() => viewportInputControllerRef.current?.reconcileCulling(), []);
  const applyCamera = useCallback(() => viewportInputControllerRef.current?.applyCameraNow(), []);
  const minimumZoom = useCallback(() => {
    const app = appRef.current;
    if (!app) return 0.15;
    return Math.max(0.15, Math.min(MAX_ZOOM, fitZoomForTileBounds(
      0, 0, course.width - 1, course.height - 1,
      app.screen.width, app.screen.height, rotation,
    ) * 0.62));
  }, [course.height, course.width, rotation]);
  const fitWholeCourse = useCallback((snap: boolean) => viewportInputControllerRef.current?.fitWholeCourse(snap), []);
  const fitDefaultView = useCallback((snap: boolean) => viewportInputControllerRef.current?.fitDefaultView(snap), []);

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
      const corridor = referencePlan?.segments.map((segment) => segment.to) ?? (activeShotRoute?.destinations ?? []);
      const referencePoints = [tee, ...corridor, green];
      const minX = Math.min(...referencePoints.map((point) => point.x)) - 5;
      const maxX = Math.max(...referencePoints.map((point) => point.x)) + 5;
      const minY = Math.min(...referencePoints.map((point) => point.y)) - 5;
      const maxY = Math.max(...referencePoints.map((point) => point.y)) + 5;
      const wide = fitZoomForTileBounds(minX, minY, maxX, maxY, app.screen.width, app.screen.height, rotation);
      const tight = Math.min(MAX_ZOOM * 0.6, Math.max(wide * 2.4, wide + 0.4));
      viewportInputControllerRef.current?.startFlyover(
        buildFlyoverKeys(tee, green, corridor, wide, tight),
      );
      const distanceTiles = computeHoleDistanceTiles(tee, green);
      const autoPar = computeAutoPar(distanceTiles);
      setFlyoverCard({
        hole: holeIndex + 1,
        par: referencePlan?.selectedPar ?? (hole.parMode === "MANUAL" ? hole.parManual ?? autoPar : autoPar),
        yards: referencePlan?.effectiveYardage || Math.round(distanceTiles * (course.yardsPerTile ?? 10)),
      });
    };
    void import("../game/architecture/referencePlan").then((module) => begin(module.flyoverReferencePlan(course, activeHoleIndex, props.selectedTeeSet ?? "member"))).catch(() => begin(null));
    return guardNativeRendererCleanup(nativeMountRef.current?.lease, () => { canceled = true; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.flyoverNonce, appReady]);

  const screenToTile = useCallback((x: number, y: number) =>
    viewportInputControllerRef.current?.screenToTile(x, y) ?? null, []);
  const screenToWorldPoint = useCallback((x: number, y: number) =>
    viewportInputControllerRef.current?.screenToWorldPoint(x, y) ?? null, []);
  const worldPointToScreen = useCallback((x: number, y: number, elevation = 0) =>
    viewportInputControllerRef.current?.worldPointToScreen(x, y, elevation) ?? { x: 0, y: 0 }, []);

  const viewportInputConfig = useMemo<ViewportInputConfig>(() => ({
    course,
    rotation,
    animationsEnabled: props.animationsEnabled,
    cameraSmoothing: props.cameraSmoothing,
    edgeScroll: props.edgeScroll,
    edgeScrollSpeed: props.edgeScrollSpeed,
    keybindings: props.keybindings,
    graphicsQuality: props.graphicsQuality,
    resolutionScale: props.resolutionScale,
    showGridOverlays,
    cameraState,
    openingFollow: props.openingFollow,
    openingFocus: props.openingMarker
      ? retainedPreviewShotPose(props.openingMarker.shot, props.openingMarker.progress).ball ?? props.openingMarker.golfer
      : null,
    onOpeningFollowCanceled: props.onOpeningFollowCanceled,
    onRotationCommit: setRotation,
    onCameraUpdate: props.onCameraUpdate,
    onCameraCenter,
    onViewChange,
    onFlyoverEnd: () => setFlyoverCard(null),
    onPrimaryPointer: (event, controller) => {
      if (props.showGolfers !== false && onPickGolfer && !cameraState && liveActive && golfersRef?.current?.length) {
        const iso = controller.screenToIsoPlane(event.global.x, event.global.y);
        if (iso) {
          let bestId: number | null = null;
          let bestDistance = TILE_W * 0.45;
          for (const golfer of golfersRef.current) {
            const elevation = surfaceHeightAt(golfer.x + 0.5, golfer.y + 0.5);
            const center = tileCenterIso(golfer.x, golfer.y, elevation, rotation);
            const distance = Math.hypot(iso.x - center.x, (iso.y - center.y) * 2);
            if (distance < bestDistance) { bestDistance = distance; bestId = golfer.id; }
          }
          if (bestId != null) { onPickGolfer(bestId); return; }
        }
      }
      const tile = controller.screenToTile(event.global.x, event.global.y);
      if (!tile) return;
      if (editorMode === "PAINT" && !props.playableShotMode) return;
      if (editorMode === "SCULPT" && !props.playableShotMode
        && course.tiles[tile.y * course.width + tile.x] === "green") return;
      onClickTile(tile.x, tile.y);
    },
    updateCursor: (tile) => {
      const element = containerRef.current;
      if (!element) return;
      let cursor = "crosshair";
      if (tile && editorMode === "PAINT" && selectedTerrain && worldCash !== undefined) {
        const preview = onPreviewTerrainStroke?.([tile]);
        if (preview && !preview.affordable) cursor = "not-allowed";
      }
      element.style.cursor = cursor;
    },
    editor: {
      mode: editorMode,
      terrainTool,
      playableShotMode: Boolean(props.playableShotMode),
      selectedTerrain,
      worldCash,
      onClickTile,
      onPreviewTerrainStroke,
      onCommitTerrainStroke,
      onPreviewSurfaceFeatureEdit,
      onCommitSurfaceFeatureEdit,
      onPreviewFineGreenStroke,
      onCommitFineGreenStroke,
      onPresentationChange: (presentation) => {
        setTerrainStrokePreview(presentation.terrainPreview);
        setFineGreenStrokePreview(presentation.fineGreenPreview);
        setClickSplineDraft(presentation.splineDraft);
        setClickSplineHover(presentation.splineHover);
        setSelectedSurfaceFeatureId(presentation.selectedFeatureId);
        setSelectedSurfaceNode(presentation.selectedNode);
        setSurfaceEditDraft(presentation.surfaceDraft);
      },
    },
    deriveFrame: (mode, viewport, nextRotation) => {
      const deriveCamera = sceneCameraDeriversRef.current?.[1];
      if (!courseSceneComposition || !deriveCamera) return null;
      return deriveCamera({ course, composition: courseSceneComposition, activeHoleIndex,
        teeSet: selectedTeeSet, viewport, rotation: nextRotation, mode });
    },
  }), [activeHoleIndex, cameraState, course, courseSceneComposition, editorMode,
    onCameraCenter, onClickTile, onCommitFineGreenStroke, onCommitSurfaceFeatureEdit,
    onCommitTerrainStroke, onPreviewFineGreenStroke, onPreviewSurfaceFeatureEdit,
    onPreviewTerrainStroke, onViewChange, onPickGolfer, props.animationsEnabled, props.cameraSmoothing, props.edgeScroll,
    props.edgeScrollSpeed, props.graphicsQuality, props.keybindings, props.onCameraUpdate,
    props.onOpeningFollowCanceled, props.openingFollow, props.openingMarker,
    props.playableShotMode, props.resolutionScale, props.showGolfers, rotation,
    selectedTeeSet, selectedTerrain, showGridOverlays, surfaceHeightAt, terrainTool,
    liveActive, golfersRef, worldCash]);
  const viewportInputConfigRef = useRef(viewportInputConfig);
  viewportInputConfigRef.current = viewportInputConfig;

  useEffect(() => {
    if (!appReady) return;
    const app = appRef.current;
    const world = layersRef.current?.world;
    const element = containerRef.current;
    const Controller = viewportInputControllerModuleRef.current?.ViewportInputController;
    if (!app || !world || !element || !Controller) return;
    const controller = new Controller(viewportInputConfigRef.current, {
      app, world, element,
      overlay: () => overlaysDiagnosticsSceneRef.current,
      terrain: () => terrainWaterSceneRef.current,
    });
    viewportInputControllerRef.current = controller;
    return guardNativeRendererCleanup(nativeMountRef.current?.lease, () => {
      if (viewportInputControllerRef.current !== controller) return;
      controller.destroy();
      viewportInputControllerRef.current = null;
    });
  }, [appReady]);

  useEffect(() => {
    viewportInputControllerRef.current?.update(viewportInputConfig);
  }, [viewportInputConfig]);

  useEffect(() => {
    if (import.meta.env.MODE !== "e2e" || !appReady) return;
    const api = {
      viewportInputState: () => viewportInputControllerRef.current?.snapshot() ?? null,
      fitWholeCourse: () => fitWholeCourse(true),
      fitDefaultView: () => fitDefaultView(true),
      sceneComposition: () => courseSceneComposition ?? null,
      normalFrame: () => {
        const app = appRef.current;
        const deriveCamera = sceneCameraDeriversRef.current?.[1];
        if (!app || !courseSceneComposition || !deriveCamera) return null;
        return deriveCamera({
          course,
          composition: courseSceneComposition,
          activeHoleIndex,
          teeSet: selectedTeeSet,
          viewport: { width: app.screen.width, height: app.screen.height },
          rotation,
          mode: "normal",
        });
      },
      /** Raw applied world transform for E2E evidence; read-only. */
      cameraTransform: () => {
        const world = layersRef.current?.world;
        if (!world) return null;
        const camera = viewportCamera();
        return {
          world: {
            position: { x: world.position.x, y: world.position.y },
            pivot: { x: world.pivot.x, y: world.pivot.y },
            scale: { x: world.scale.x, y: world.scale.y },
          },
          camera: {
            center: { x: camera.cx, y: camera.cy },
            targetCenter: { x: camera.tcx, y: camera.tcy },
            zoom: camera.zoom,
            targetZoom: camera.tzoom,
          },
        };
      },
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
      activeFlagGeometry: () => {
        const flag = layersRef.current?.objects.children.find((child) => child.label === "hole-pin-flag");
        if (!flag) return null;
        const bounds = flag.getBounds();
        const anchor = flag.getGlobalPosition();
        return {
          anchor: { x: anchor.x, y: anchor.y },
          bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        };
      },
      activeShotDestinationGeometry: () => layersRef.current?.terrainDecals.children.flatMap((child) => {
        const marker = child as PIXI.Container & {
          __coursecraftShotDestination?: {
            index: number;
            point: { x: number; y: number };
            role: "landing" | "approach" | "pin";
          };
        };
        if (!marker.__coursecraftShotDestination) return [];
        const bounds = marker.getBounds();
        return [{
          ...marker.__coursecraftShotDestination,
          bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        }];
      }) ?? [],
      openingPreview: (): { targetIds: number[]; outlineCount: number } | null => {
        const graphic = layersRef.current?.fx.children.find((child) => child.label === "opening-preview-markers") as (PIXI.Graphics & {
          __coursecraftOpeningPreview?: { targetIds: number[]; outlineCount: number };
        }) | undefined;
        return graphic?.__coursecraftOpeningPreview ?? null;
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
      bunkerContours: () => structuredClone(bunkerContoursRef.current),
      terrainPreview: () => overlaysDiagnosticsSceneRef.current?.terrainPreview() ?? null,
      routeOverlay: () => ({
        geometrySamples: activeShotRoute?.geometry.length ?? 0,
        semanticTargets: activeShotRoute?.destinations.length ?? 0,
        fullShotSegments: activeShotRoute?.fullShots ?? 0,
        expectedPutts: activeShotRoute?.expectedPutts ?? 0,
        visibleLayers: layersRef.current?.terrainDecals.children.filter((child) => child.label === ROUTE_LABEL && child.visible).length ?? 0,
      }),
      playerProCollectionDisplay: () => ({
        rebuilds: playerProCollectionSceneRef.current?.rebuildCount() ?? 0,
        items: layersRef.current?.objects.children
          .filter((child) => child.label.startsWith("player-pro-display:"))
          .map((child) => ({
            label: child.label,
            x: child.position.x,
            y: child.position.y,
            zIndex: child.zIndex,
          })) ?? [],
      }),
      // Read-only, E2E-only renderer ownership evidence. Count the live Pixi
      // tree plus the renderer's actual GPU-managed texture sources; do not
      // infer resource health from simulation objects or synthetic heap data.
      resourceSnapshot: () => {
        const app = appRef.current;
        if (!app) return null;
        const textures = new Set<PIXI.Texture>();
        const textureSources = new Set<PIXI.TextureSource>();
        const counts = {
          displayObjects: 0,
          containers: 0,
          sprites: 0,
          graphics: 0,
          meshes: 0,
          text: 0,
        };
        const visit = (displayObject: PIXI.Container) => {
          counts.displayObjects++;
          if (displayObject instanceof PIXI.Container) counts.containers++;
          if (displayObject instanceof PIXI.Sprite) counts.sprites++;
          if (displayObject instanceof PIXI.Graphics) counts.graphics++;
          if (displayObject instanceof PIXI.Mesh) counts.meshes++;
          if (displayObject instanceof PIXI.Text) counts.text++;
          const texture = (displayObject as PIXI.Container & { texture?: PIXI.Texture }).texture;
          if (texture) {
            textures.add(texture);
            textureSources.add(texture.source);
          }
          for (const child of displayObject.children) visit(child);
        };
        visit(app.stage);
        const textureSystem = app.renderer.texture as unknown as {
          managedTextures?: readonly PIXI.TextureSource[];
        };
        return {
          ...counts,
          attachedTextures: textures.size,
          attachedTextureSources: textureSources.size,
          managedTextureSources: textureSystem.managedTextures?.length ?? -1,
          canvasConnected: app.canvas.isConnected,
        };
      },
      rendererAtlasState: () => {
        const layers = layersRef.current;
        const world = layers?.world;
        const requestedTheme = getBiomeDefinition(requestedProps.course.theme).key;
        const requestedQuality = requestedProps.graphicsQuality;
        const renderedTier = visibleGroundCoverTier(
          world?.scale.x ?? viewportCamera().zoom,
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
            zoom: viewportCamera().zoom,
            targetZoom: viewportCamera().tzoom,
            groundCoverTier: coverTier,
          },
          pathMaterialCrossSection: {
            ...pathMaterialDiagnosticsRef.current,
            commit: __COMMIT_SHA__,
            camera: {
              rotation,
              zoom: viewportCamera().zoom,
              targetZoom: viewportCamera().tzoom,
            },
          },
          parklandComposable: {
            ...parklandComposableDiagnosticsRef.current,
            camera: {
              rotation,
              zoom: viewportCamera().zoom,
              targetZoom: viewportCamera().tzoom,
            },
          },
          landformDepth: {
            ...landformDepthDiagnosticsRef.current,
            waterSurfaceOwners: {
              chunkSprites: terrainWaterSceneRef.current?.diagnostics().chunkWaterSprites ?? 0,
              chunkFoam: terrainWaterSceneRef.current?.diagnostics().chunkFoamSprites ?? 0,
              joinedMeshes: terrainWaterSceneRef.current?.diagnostics().joinedWaterSprites ?? 0,
            },
            camera: {
              rotation,
              zoom: viewportCamera().zoom,
              targetZoom: viewportCamera().tzoom,
            },
          },
          habitatField: {
            ...(habitatFieldSceneRef.current?.diagnostics() ?? null),
            legacyParklandHabitatCount: course.theme === "parkland"
              ? naturalPropsSceneRef.current?.legacyHabitatCount() ?? 0
              : 0,
          },
          sharedContours: { ...sharedContourDiagnosticsRef.current },
          terrainWater: terrainWaterSceneRef.current?.diagnostics() ?? null,
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
            terrainChunks: terrainWaterSceneRef.current?.diagnostics().chunksTotal ?? 0,
            terrainRebuilds: terrainWaterSceneRef.current?.diagnostics().chunkRebuilds ?? 0,
            connectedSurfaces: layers.smoothSurfaces.children.length,
            structuresAndProps: structureSpriteCountRef.current
              + (naturalPropsSceneRef.current?.contentCount() ?? 0),
            naturalProps: {
              content: naturalPropsSceneRef.current?.contentCount() ?? 0,
              rebuilds: naturalPropsSceneRef.current?.rebuildCount() ?? 0,
              fallbackTextures: naturalPropsSceneRef.current?.fallbackTextureCount() ?? 0,
              habitatMasses: naturalPropsSceneRef.current?.habitatMassDiagnostics().length ?? 0,
              habitatBedLayers: naturalPropsSceneRef.current?.habitatMassDiagnostics()
                .reduce((total, mass) => total + mass.bedLayerCount, 0) ?? 0,
              legacyHabitat: naturalPropsSceneRef.current?.legacyHabitatCount() ?? 0,
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
      setPathMaterialVisibilityForTest: (visible: boolean) => {
        const layer = layersRef.current?.smoothSurfaces.children.find(
          (child) => child.label === "path-material-cross-section",
        );
        if (!layer) return false;
        layer.visible = visible;
        appRef.current?.render();
        return true;
      },
      setZoomForTest: (zoom: number) => {
        viewportInputControllerRef.current?.setZoomForTest(zoom);
      },
      focusTileForTest: (x: number, y: number, zoom: number) => {
        viewportInputControllerRef.current?.focusTileForTest(x, y, zoom);
      },
      golferGrounding: (id: number) => liveEntitiesSceneRef.current?.golferGrounding(
        id,
        golfersRef?.current ?? [],
      ) ?? null,
      surfaceHeightAt: (x: number, y: number) => surfaceHeightAt(x, y),
      screenToTile,
      screenToWorld: screenToWorldPoint,
      terrainStrokePointerDownCell: () => (
        viewportInputControllerRef.current?.terrainStrokePointerCell() ?? null
      ),
      resetTerrainStrokePointerDownCell: () => {
        viewportInputControllerRef.current?.resetTerrainStrokePointerCell();
      },
    };
    window.__coursecraftPixiTest = api;
    return guardNativeRendererCleanup(nativeMountRef.current?.lease, () => {
      if (window.__coursecraftPixiTest === api) delete window.__coursecraftPixiTest;
    });
  }, [
    activeShotRoute,
    appReady,
    applyCamera,
    atlasContext,
    course,
    courseSceneComposition,
    activeHoleIndex,
    selectedTeeSet,
    fitDefaultView,
    fitWholeCourse,
    minimumZoom,
    requestedProps.course.theme,
    requestedProps.graphicsQuality,
    requestedProps.resolutionScale,
    requestedProps.season,
    requestedProps.seasonalVisualState,
    renderContext.resolutionScale,
    rotation,
    seasonalPlantsSignature,
    screenToTile,
    screenToWorldPoint,
    surfaceHeightAt,
    worldPointToScreen,
    golfersRef,
    viewportCamera,
  ]);

  // ---------------------------------------------------------------------
  // App lifecycle
  // ---------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    const mount = nativeMountRef.current;
    if (!mount) return;
    const { owner, generation } = mount.lease;
    setRendererError(false);

    const init = async () => {
      // StrictMode can retire its first setup before any native entry is acquired.
      await Promise.resolve();
      if (cancelled || nativeMountRef.current !== mount) return;
      const width = Math.max(container.clientWidth || 800, 100);
      const height = Math.max(container.clientHeight || 600, 100);

      const app = await owner.acquire(generation);
      if (!app) return;
      mount.application = app;
      if (cancelled || !owner.isCurrent(generation)) return;
      const [deferredWorldScenes, terrainWaterScenes, compositionModule, cameraModule, viewportInputControllerModule] = await Promise.all([
        import("./renderer/scenes/deferredWorldScenes"),
        import("./renderer/scenes/terrainWaterScene"),
        import("../game/render/courseSceneComposition"),
        import("../game/render/courseSceneCamera"),
        import("./renderer/viewportInputController"),
      ]);
      if (cancelled || !owner.isCurrent(generation)) return;

      const activation = await loadAtlases(
        initialRendererConfigRef.current.theme,
        initialRendererConfigRef.current.graphicsQuality,
        initialRendererConfigRef.current.season,
      );
      if (cancelled || !owner.isCurrent(generation)) return;
      deferredWorldScenesRef.current = deferredWorldScenes;
      viewportInputControllerModuleRef.current = viewportInputControllerModule;
      sceneCameraDeriversRef.current = [
        compositionModule.deriveCourseSceneComposition,
        cameraModule.deriveCourseSceneCamera,
      ];
      const initialCompositionInput = initialCameraCompositionInputRef.current;
      setCourseSceneCompositionEntry([
        initialCompositionInput[0],
        initialCompositionInput[1],
        compositionModule.deriveCourseSceneComposition({
          course: initialCompositionInput[0],
          seed: initialCompositionInput[1],
        }),
      ]);

      app.canvas.style.display = "block";
      app.canvas.style.position = "absolute";
      app.canvas.style.top = "0";
      app.canvas.style.left = "0";
      container.appendChild(app.canvas);

      // Native-owned white diamond; fresh terrain scenes borrow its residency.
      const diamondTexture = owner.diamond(generation);

      // Build the layer tree (see header comment for architecture).
      const world = new PIXI.Container();
      const surround = new PIXI.Container();
      const terrain = new PIXI.Container();
      const smoothSurfaces = new PIXI.Container();
      const seasonalTerrain = new PIXI.Container();
      const surfaceCare = new PIXI.Container();
      const estateSeam = new PIXI.Container();
      const terrainDecals = new PIXI.Container();
      const sceneDecals = deferredWorldScenes.createStableSceneDecalLayers(terrainDecals);
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
      layersRef.current = { world, surround, terrain, smoothSurfaces, seasonalTerrain, surfaceCare, estateSeam, terrainDecals, sceneDecals, surfaceEditor, objects, fx, screenOverlay };
      const terrainWaterScene = terrainWaterScenes.createTerrainWaterSceneSystem({
        surround,
        terrain,
        smoothSurfaces,
        estateSeam,
      });
      terrainWaterScene.diamondTexture = terrainWaterScene.borrowTexture(diamondTexture);
      terrainWaterSceneRef.current = terrainWaterScene;
      if (activation.context) {
        setRenderContext({
          atlas: activation.context,
          seasonalVisualState: initialRendererConfigRef.current.seasonalVisualState,
          resolutionScale: initialRendererConfigRef.current.resolutionScale,
        });
      }
      owner.markReady(generation);
      setAppReady(true);
      devLog(`initialized ${width}x${height}`);
    };

    void init().catch((error: unknown) => {
      if (cancelled || nativeMountRef.current !== mount) return;
      owner.fail(generation);
      console.error("[PixiStage] Course renderer initialization failed", error);
      setRendererError(true);
    });

    return guardNativeRendererCleanup(nativeMountRef.current?.lease, () => {
      cancelled = true;
      supersedePendingAtlasLoad();
      setAppReady(false);
      // Attempt every independent disposer before severing all captured scene refs.
      try {
        completeNativeSceneDisposers([
          () => viewportInputControllerRef.current?.destroy(),
          () => sceneSystemHostRef.current?.dispose(),
          () => terrainWaterSceneRef.current?.destroy(),
        ]);
      } finally {
        viewportInputControllerRef.current = null;
        sceneSystemHostRef.current = null;
        atmosphereSceneRef.current = null;
        naturalPropsSceneRef.current = null;
        habitatFieldSceneRef.current = null;
        playerProCollectionSceneRef.current = null;
        holeMarkersSceneRef.current = null;
        mobilityEntitiesSceneRef.current = null;
        liveEntitiesSceneRef.current = null;
        overlaysDiagnosticsSceneRef.current = null;
        terrainWaterSceneRef.current = null;
        deferredWorldScenesRef.current = null;
        viewportInputControllerModuleRef.current = null;
        layersRef.current = null;
        structureSpriteCountRef.current = 0;
        surfaceCareWorkersRef.current = [];
        if (appRef.current === mount.application) appRef.current = null;
      }
    });
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
    return guardNativeRendererCleanup(nativeMountRef.current?.lease, () => {
      cancelled = true;
    });
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

  // Controller owns resize, initialization, external camera and reporting.
  useEffect(() => {
    if (!appReady || !courseSceneComposition) return;
    const controller = viewportInputControllerRef.current;
    if (!controller) return;
    controller.initializeDefault();
    const signature = [
      course.name, course.width, course.height, activeHoleIndex,
      course.activePinRotation ?? "A", selectedTeeSet ?? "member",
      courseSceneComposition.courseHash, courseSceneComposition.obstacleHash,
      courseSceneComposition.semanticSeed, showGridOverlays ? "overview" : "normal",
    ].join(":");
    if (!cameraState && !props.referenceCamera) controller.autoFit(signature);
    controller.applyReferenceCamera(props.referenceCamera ?? null);
  }, [
    activeHoleIndex, appReady, cameraState, course.activePinRotation,
    course.height, course.name, course.width, courseSceneComposition,
    props.referenceCamera, selectedTeeSet, showGridOverlays,
  ]);

  useEffect(() => {
    if (appReady && props.cameraJump) viewportInputControllerRef.current?.jump(props.cameraJump.center);
  }, [appReady, props.cameraJump]);

  // Wheel, gesture, pan, key, edge-scroll, smoothing and rotation input
  // are attached exactly once by ViewportInputController.

  // ---------------------------------------------------------------------
  // Regional surround — deterministic scenery beyond the playable estate
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!appReady) return;
    const layers = layersRef.current;
    const terrainScene = terrainWaterSceneRef.current;
    if (!layers || !terrainScene) return;
    terrainScene.setRenderer("surround", () => {
    layers.surround.removeChildren().forEach(destroySceneSubtree);
    layers.estateSeam.removeChildren().forEach(destroySceneSubtree);

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
        terrainScene.borrowTexture(texture);
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
    });
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
    const terrainScene = terrainWaterSceneRef.current;
    const diamond = terrainScene?.diamondTexture;
    if (!layers || !terrainScene || !diamond) return;
    terrainScene.setRenderer("terrain", () => {
    const presentationRenderCourse = { ...course, tiles: presentationTiles };

    const w = course.width;
    const h = course.height;
    const cols = Math.ceil(w / CHUNK_TILES);
    const rows = Math.ceil(h / CHUNK_TILES);
    const elev = (x: number, y: number) => getElevation(course, x, y);
    // Whole-tile terrain is the visual source of truth. Surface intent is
    // retained for editor history and backwards-compatible saves, but it no
    // longer substitutes an underlay or clips a second terrain layer.
    const composableRuntime = presentationRuntime;
    // Composable assets are installed as one atomic bundle, so one field's
    // presence is also the failure-safe readiness signal for its turf cues.
    const composableTurfOwnsTransitions = Boolean(
      getParklandComposableField(course.theme, props.graphicsQuality, "tee"),
    );
    const lowJoinedSandCells = new Set(props.graphicsQuality === "low" && composableRuntime
      ? cachedBunkerPresentation(presentationTiles, course.width, course.height, course.surfaceIntent?.features)
        .filter((component) => component.rings.length > 0 && component.rings.every((ring) => ring.length >= 3))
        .flatMap((component) => component.cells)
      : []);
    const lowJoinedMaintainedTopReady = props.graphicsQuality === "low"
      && Boolean(composableRuntime)
      && !composableTurfOwnsTransitions;
    const visualTerrainAt = (x: number, y: number): Terrain => {
      const index = y * w + x;
      return presentationTiles[index];
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
    const buildChunk = (chunk: TerrainWaterChunk, cx: number, cy: number) => {
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
        // The connected Parkland scene owns one broad grade surface. Keeping
        // the legacy per-level cliff quads underneath it exposes parallel dark
        // rails through the tessellated top plane.
        if (composableTurfOwnsTransitions) return;
        const e = elev(x, y);
        const nx = x + d.x;
        const ny = y + d.y;
        // The regional surround continues beyond the course. Treat exterior
        // neighbors as level with the perimeter rather than exposing the old
        // brown "cut slab" face around the whole map.
        const ne = nx < 0 || ny < 0 || nx >= w || ny >= h ? e : elev(nx, ny);
        if (ne >= e || e <= 0) return;
        // Joined maintained turf owns its complete top plane. A legacy dirt
        // face between two cells of that same component would cut a green,
        // tee, or fairway into disconnected slabs beneath the shared mesh.
        if (!shouldRenderLegacyElevationFace(
          visualTerrainAt(x, y),
          visualTerrainAt(nx, ny),
          Boolean(presentationRuntime),
        )) return;
        const [c1, c2] = edgeCorners(x, y, d.x, d.y);
        const a = worldToIso(c1.x, c1.y, e, rotation);
        const b = worldToIso(c2.x, c2.y, e, rotation);
        const drop = (e - ne) * ELEVATION_STEP_PX;
        cliffs.poly([a.x, a.y, b.x, b.y, b.x, b.y + drop, a.x, a.y + drop]);
        cliffs.fill(color);
      };
      const recessedFace = (x: number, y: number, d: Point) => {
        const terrain = visualTerrainAt(x, y);
        if ((composableTurfOwnsTransitions || lowJoinedSandCells.has(y * w + x)) && terrain === "sand") return;
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
        const joinedMaintainedTop = lowJoinedMaintainedTopReady && isMaintained(terrain);
        // Joined hazard masks, not whole-cell atlas diamonds/lips, own all
        // visible water. Low already used this exact rough underlay.
        const underlayTerrain = hazardChunkUnderlay(
          maintainedChunkUnderlay(lowJoinedSandCells.has(y * w + x) && terrain === "sand" ? "rough" : terrain, lowJoinedMaintainedTopReady),
          composableTurfOwnsTransitions,
        );
        const material = getTerrainMaterial(course.theme, underlayTerrain);
        const e = elev(x, y);
        const groundPosition = worldToIso(x + 0.5, y, e, rotation);
        const surfaceInset = terrainSurfaceInsetPx(terrain);
        const p = { x: groundPosition.x, y: groundPosition.y + surfaceInset };
        // NW-sun slope shade from central-difference normals (world-fixed sun).
        const dzdx = (elev(x + 1, y) - elev(x - 1, y)) / 2;
        const dzdy = (elev(x, y + 1) - elev(x, y - 1)) / 2;
        let slopeShade = Math.max(0.8, Math.min(1.12, 1 - 0.07 * (dzdx + dzdy)));
        if (
          isMaintained(underlayTerrain)
          && mowingQualityAt(y * w + x) >= 0.83
        ) {
          slopeShade *= mowingShadeAt(x, y, holeAxes);
        }
        const seasonal = seasonalByTerrain[underlayTerrain];
        const legacyTint = shade(
          darken(seasonal?.color ?? THEMED_COLORS[underlayTerrain], EDGE_DARKEN),
          slopeShade,
        );

        // Authored parkland sources are @2× but remain 64×32 in world space.
        // Other themes intentionally use the safe legacy tint until M21.
        const authored = material.source === "atlas-2x"
          ? getTerrainFrame(course.theme, props.graphicsQuality, pickTerrainBaseFrame(material, x, y))
          : null;
        if (authored) terrainScene.borrowTexture(authored);
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
        if (!joinedMaintainedTop && props.terrainPatterns && terrainPattern(terrain) !== "none") {
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
          presentationRenderCourse,
          props.worldSeed,
          x,
          y,
        );
        const terrainDetailTexture = terrainDetail
          ? getTerrainDetailFrame(course.theme, props.graphicsQuality, terrainDetail.frame)
          : null;
        if (terrainDetailTexture) terrainScene.borrowTexture(terrainDetailTexture);
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
            presentationRenderCourse,
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
        if (underlayTerrain === terrain && (terrain === "water" || terrain === "wetland")) {
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
          if (lowJoinedSandCells.has(y * w + x) || lowJoinedSandCells.has(ny * w + nx)) continue;
          if (
            composableTurfOwnsTransitions
            && composableRuntime!.isParklandComposableTransition(terrain, nTerrain)
          ) continue;
          const boundary = terrainBoundaryFor(terrain, nTerrain);
          if (!boundary || boundary.owner !== terrain) continue;
          if (elev(nx, ny) !== e) continue;
          boundaryMask |= 1 << index;
        }
        const features = autotileFeatures(rotateAutotileMask(boundaryMask, rotation));
        for (const feature of underlayTerrain === terrain ? features : []) {
          const transitionTexture = material.source === "atlas-2x"
            ? getTerrainFrame(course.theme, props.graphicsQuality, terrainTransitionFrame(material, feature))
            : null;
          if (!transitionTexture) continue;
          terrainScene.borrowTexture(transitionTexture);
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
          if (composableTurfOwnsTransitions) continue;
          const nx = x + direction.dx;
          const ny = y + direction.dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || elev(nx, ny) >= e) continue;
          if (!shouldRenderLegacyElevationFace(
            terrain,
            visualTerrainAt(nx, ny),
            Boolean(presentationRuntime),
          )) continue;
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
      terrainScene.markChunkRebuild();
      recordM35Metric("chunkRebuild", performance.now() - rebuildStartedAt);
    };

    const chunkIndex = (cx: number, cy: number) => cy * cols + cx;
    const prevTiles = terrainScene.previousTiles;
    const prevCareVisualSignatures = terrainScene.previousCareVisualSignatures;
    const prevElevations = terrainScene.previousElevations;
    const fullRebuild =
      terrainScene.chunks.length !== cols * rows ||
      terrainScene.builtRotation !== rotation ||
      terrainScene.builtAtlasGeneration !== atlasRevision ||
      terrainScene.builtSeasonalTerrainSignature !== seasonalTerrainSignature ||
      !prevTiles ||
      prevTiles.length !== presentationTiles.length ||
      !prevCareVisualSignatures ||
      prevCareVisualSignatures.length !== careVisualSignatures.length;

    if (fullRebuild) {
      layers.terrain.removeChildren();
      terrainScene.chunks.forEach((c) => destroySceneSubtree(c.container));
      terrainScene.chunks = [];
      terrainScene.builtRotation = rotation;
      terrainScene.builtAtlasGeneration = atlasRevision;
      terrainScene.builtSeasonalTerrainSignature = seasonalTerrainSignature;

      // Create chunk containers and add them back-to-front for this rotation.
      const chunkOrder: Array<{ cx: number; cy: number }> = [];
      for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) chunkOrder.push({ cx, cy });
      chunkOrder.sort((a, b) => {
        const da = isoDepth((a.cx + 0.5) * CHUNK_TILES, (a.cy + 0.5) * CHUNK_TILES, 0, rotation);
        const db = isoDepth((b.cx + 0.5) * CHUNK_TILES, (b.cy + 0.5) * CHUNK_TILES, 0, rotation);
        return da - db;
      });
      const chunks: TerrainWaterChunk[] = new Array(cols * rows);
      for (const { cx, cy } of chunkOrder) {
        const chunk: TerrainWaterChunk = {
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
      terrainScene.chunks = chunks;
      devLog(`full terrain rebuild: ${cols}x${rows} chunks (rot ${rotation})`);
    } else {
      // Incremental: diff tiles+elevations, mark touched chunks (expanded by
      // one tile — shading and cliff faces read neighboring tiles).
      const dirty = new Set<number>();
      for (let i = 0; i < presentationTiles.length; i++) {
        if (
          presentationTiles[i] === prevTiles[i] &&
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
        buildChunk(terrainScene.chunks[ci], ci % cols, Math.floor(ci / cols));
      });
      if (dirty.size > 0) devLog(`rebuilt ${dirty.size} dirty chunk(s), total rebuilds ${terrainScene.diagnostics().chunkRebuilds}`);
    }

    terrainScene.previousTiles = presentationTiles;
    terrainScene.previousCareVisualSignatures = careVisualSignatures;
    terrainScene.previousElevations = course.elevations;
    cullChunks();
    stampAtlasGeneration(layers.terrain, atlasRevision);
    });
  }, [
    appReady,
    atlasRevision,
    course,
    careVisualSignatures,
    presentationTiles,
    rotation,
    cullChunks,
    props.colorVision,
    props.graphicsQuality,
    props.reducedMotion,
    props.seasonalVisualState,
    props.terrainPatterns,
    props.worldSeed,
    presentationRuntime,
  ]);

  // Connected landscape presentation. Gameplay remains whole-tile. The
  // original chunk renderer remains the failure fallback, while Low receives
  // the same common turf field without creating connected-surface owners.
  // Medium/High replace the visible top plane with rounded component masks,
  // a shared visual heightfield, and world-anchored repeating materials.
  useEffect(() => {
    if (!appReady) return;
    const rebuildStartedAt = performance.now();
    const rendererLayers = layersRef.current;
    const terrainScene = terrainWaterSceneRef.current;
    const layer = rendererLayers?.smoothSurfaces;
    if (!layer || !rendererLayers || !terrainScene) return;
    terrainScene.setRenderer("connected", () => {
    layer.removeChildren().forEach(destroySceneSubtree);
    terrainScene.surfaceWaterSprites = [];
    const quality = props.graphicsQuality;
    landformDepthDiagnosticsRef.current = emptyLandformDepthDiagnostics(quality);
    if (import.meta.env.MODE === "e2e") bunkerContoursRef.current = [];
    const composableRuntime = presentationRuntime;
    terrainScene.lowPresentationLayer = composableRuntime
      ? composableRuntime.destroyParklandPresentationLayer(terrainScene.lowPresentationLayer)
      : null;
    const composableSources = composableRuntime?.resolveParklandComposableSources(
      course.theme,
      quality,
      (role) => getParklandComposableField(course.theme, quality, role),
    ) ?? null;
    const composableActive = Boolean(composableSources);
    if (composableRuntime) {
      parklandComposableDiagnosticsRef.current = composableRuntime.inactiveParklandComposableDiagnostics(quality);
    }
    const subdivisions = quality === "high" ? 4 : quality === "medium" ? 2 : 1;
    const components = landscapeComponentCacheRef.current.update(
      presentationTiles,
      course.width,
      course.height,
      landscapeOptionsForQuality(quality),
    ).components;
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

    const textureFor = (terrain: Terrain, finePathCore = false) => {
      const baseColor = themedColors[terrain];
      const authored = quality !== "low" && !finePathCore && props.colorVision === "standard" && !props.terrainPatterns
        ? getLandscapeMaterialField(course.theme, terrain, quality)
        : null;
      if (authored && !authored.destroyed) return terrainScene.borrowTexture(authored);
      const key = [
        getBiomeDefinition(course.theme).key,
        terrain,
        quality,
        props.colorVision,
        props.terrainPatterns ? "pattern" : "plain",
        finePathCore ? "fine-compacted-core" : "standard",
        baseColor.toString(16),
      ].join(":");
      let texture = terrainScene.landscapeMaterialTextures.get(key);
      if (!texture || texture.destroyed) {
        texture = finePathCore
          ? createCompactedPathCoreTexture(baseColor, quality)
          : createLandscapeMaterialTexture(terrain, baseColor, quality, props.terrainPatterns);
        terrainScene.ownGeneratedTexture(texture);
        terrainScene.landscapeMaterialTextures.set(key, texture);
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

    // Low's sand uses the same cached world boundary and exact inner floor as
    // displayed ball endpoints. Mesh subdivision stays at one; bank/lip
    // graphics are rebuilt only with the terrain scene, never each frame.
    const appendLowSand = (target: PIXI.Container) => {
      if (!composableRuntime) return;
      const captured = cachedBunkerPresentation(presentationTiles, course.width, course.height, course.surfaceIntent?.features);
      const byCell = new Map(captured.map((component) => [component.cells[0], component]));
      const diagnostics: LandformDepthDiagnostics["hazards"][number][] = [];
      for (const component of components.filter((entry) => entry.terrain === "sand").sort((a, b) => componentDepth(a) - componentDepth(b))) {
        const authority = byCell.get(component.cells[0]);
        if (!authority) continue;
        const boundary = capturedBunkerBoundary(authority);
        const plans = boundary.map((ring) => buildHazardBankFacePlan("sand", component.cells.length, ring));
        const floorProject = (point: Point) => worldToIso(point.x, point.y,
          sampleLandscapeSurfaceHeight(heightfield, component, point.x, point.y, true), rotation);
        const mesh = composableRuntime!.createParklandComposableMesh(textureFor("sand"), component.presentationCells,
          course.width, 1, (cell) => cell, (_cell, x, y) => floorProject({ x, y }), true);
        if (!mesh) continue;
        const mask = composableRuntime!.createLandscapeRingMask(authority.rings, floorProject);
        mesh.eventMode = "none";
        mesh.label = `low-shared-sand:${component.topologyKey}`;
        mesh.mask = mask;
        mesh.tint = seasonalByTerrain.sand?.textureTint ?? 0xffffff;
        target.addChild(mesh, mask);
        const banks = new PIXI.Graphics();
        const lip = new PIXI.Graphics();
        const contact = new PIXI.Graphics();
        banks.eventMode = lip.eventMode = contact.eventMode = "none";
        banks.label = "low-sand-bank";
        lip.label = "low-sand-lip";
        let nearFaces = 0;
        let farFaces = 0;
        let area = 0;
        const drops: number[] = [];
        for (const plan of plans) {
          if (!plan) continue;
          const grade = plan.outerRing.map(project);
          const inset = plan.innerRing.map((point) => worldToIso(point.x, point.y,
            sampleVisualHeight(heightfield, point.x, point.y), rotation));
          const floor = plan.innerRing.map(floorProject);
          for (let index = 0; index < grade.length; index++) {
            const next = (index + 1) % grade.length;
            const near = isInteriorBankFacingViewer([grade[index], grade[next]], [inset[index], inset[next]]);
            if (near) nearFaces++; else farFaces++;
            const polygon = [grade[index], grade[next], floor[next], floor[index]];
            banks.poly(polygon.flatMap((point) => [point.x, point.y])).fill({ color: shade(themedColors.rough, near ? .72 : .98), alpha: near ? 1 : .9 });
            if (near) area += Math.abs(polygon.reduce((sum, point, vertex) => {
              const after = polygon[(vertex + 1) % polygon.length];
              return sum + point.x * after.y - after.x * point.y;
            }, 0)) / 2;
            const outer = plan.outerRing[index];
            const inner = plan.innerRing[index];
            drops.push((sampleVisualHeight(heightfield, outer.x, outer.y)
              - sampleLandscapeSurfaceHeight(heightfield, component, inner.x, inner.y, true)) * ELEVATION_STEP_PX);
            lip.moveTo(grade[index].x, grade[index].y).lineTo(grade[next].x, grade[next].y);
            contact.moveTo(floor[index].x, floor[index].y).lineTo(floor[next].x, floor[next].y);
          }
        }
        lip.stroke({ width: 1.05, color: shade(themedColors.rough, 1.15), alpha: .85, join: "round", cap: "round" });
        contact.stroke({ width: 1, color: shade(themedColors.rough, .55), alpha: .7, join: "round", cap: "round" });
        target.addChild(banks, lip, contact);
        if (drops.length) diagnostics.push({ terrain: "sand", topologyKey: component.topologyKey, rings: boundary.length,
          nearFaces, farFaces, minimumDropPx: Math.min(...drops), maximumDropPx: Math.max(...drops),
          floorBoundaryOwner: "shared", interiorFaceAreaPx: area });
        if (import.meta.env.MODE === "e2e") bunkerContoursRef.current.push({ rotation, cells: [...component.cells],
          boundary: boundary.map((ring) => ring.map((point) => ({ ...point }))),
          floor: authority.rings.map((ring) => ring.map((point) => ({ ...point }))) });
      }
      landformDepthDiagnosticsRef.current = { ...emptyLandformDepthDiagnostics("low"), active: diagnostics.length > 0, hazards: diagnostics };
    };

    // Links and Desert Low retain the economical chunk renderer for ordinary
    // terrain. Maintained components receive one joined, one-subdivision top
    // plane so their authored elevation can remain visible without exposing
    // the suppressed dirt faces between cells. Keeping this container on the
    // terrain layer preserves Low's existing connected-surface diagnostics.
    if (quality === "low" && !composableActive) {
      const maintainedLayer = new PIXI.Container();
      maintainedLayer.eventMode = "none";
      maintainedLayer.label = "low-maintained-tier-surfaces";
      rendererLayers.terrain.addChild(maintainedLayer);
      terrainScene.lowPresentationLayer = maintainedLayer;
      const maintained = components
        .filter((component) => isMaintained(component.terrain))
        .sort((a, b) => componentDepth(a) - componentDepth(b));
      for (const component of maintained) {
        const mesh = composableRuntime!.createParklandComposableMesh(
          textureFor(component.terrain),
          component.presentationCells,
          course.width,
          1,
          (cell) => cell,
          (_cell, x, y) => worldToIso(
            x,
            y,
            sampleLandscapeSurfaceHeight(heightfield, component, x, y),
            rotation,
          ),
          true,
        );
        if (!mesh) continue;
        const mask = composableRuntime!.createLandscapeRingMask(component.rings, project);
        mesh.eventMode = "none";
        mesh.label = `low-maintained-tier:${component.terrain}:${component.topologyKey}`;
        mesh.mask = mask;
        maintainedLayer.addChild(mesh, mask);
      }
      appendLowSand(maintainedLayer);
      pathMaterialDiagnosticsRef.current = {
        active: false,
        mode: "legacy",
        quality: "low",
        componentCount: 0,
        stripCount: 0,
        roles: ["core"],
        textureIds: ["legacy:path"],
        widths: { shoulder: 0, edge: 0 },
        ownership: [],
      };
      sharedContourDiagnosticsRef.current = EMPTY_SHARED_CONTOUR_DIAGNOSTICS;
      stampAtlasGeneration(maintainedLayer, atlasRevision);
      stampAtlasGeneration(rendererLayers.terrain, atlasRevision);
      stampAtlasGeneration(layer, atlasRevision);
      recordM35Metric("connectedRebuild", performance.now() - rebuildStartedAt);
      return;
    }

    const bandLayer = new PIXI.Container();
    bandLayer.eventMode = "none";
    bandLayer.sortableChildren = true;
    const pathMaterialLayer = new PIXI.Container();
    pathMaterialLayer.eventMode = "none";
    pathMaterialLayer.label = "path-material-cross-section";
    const recessedLayer = new PIXI.Container();
    recessedLayer.eventMode = "none";
    const landformLayer = new PIXI.Container();
    landformLayer.eventMode = "none";
    landformLayer.label = "landform-depth";
    const hazardDepthDiagnostics: LandformDepthDiagnostics["hazards"][number][] = [];
    // Boundary motifs are globally bounded. Habitat composition owns only
    // interior clearings, so shoreline reeds/stones have one renderer owner.
    let remainingContourDetails = quality === "high" ? 440 : quality === "medium" ? 220 : 0;
    const pathShoulderTexture = props.colorVision === "standard" && !props.terrainPatterns
      ? getPathMaterialField(course.theme, "shoulder", quality)
      : null;
    const pathEdgeTexture = props.colorVision === "standard" && !props.terrainPatterns
      ? getPathMaterialField(course.theme, "edge", quality)
      : null;
    if (pathShoulderTexture) terrainScene.borrowTexture(pathShoulderTexture);
    if (pathEdgeTexture) terrainScene.borrowTexture(pathEdgeTexture);
    const hasPathMaterialTextures = Boolean(
      pathShoulderTexture && !pathShoulderTexture.destroyed && pathEdgeTexture && !pathEdgeTexture.destroyed,
    );
    let pathComponentCount = 0;
    let pathStripCount = 0;
    let pathShoulderWidth = 0;
    let pathEdgeWidth = 0;
    const pathOwnership = new Set<string>();
    const sharedContourDiagnostics = composableRuntime!.buildTerrainPresentationDiagnostics(
      terrainPresentation!,
      landscapeComponents,
      components,
    );
    const sortedComponents = [...components].sort((a, b) => componentDepth(a) - componentDepth(b));
    const composableSemanticFields = composableSources && quality !== "low"
      ? composableRuntime!.resolveParklandSemanticFieldSources(
        quality,
        props.colorVision === "standard",
        props.terrainPatterns,
        (semantic) => getLandscapeMaterialField(course.theme, semantic, quality),
      )
      : null;
    const composableTrace = composableRuntime!.createParklandComposableTrace(
      course.theme,
      quality,
      composableSources?.cues,
    );

    // One opaque undercoat spans the exact presentation turf-cell union. The
    // source phase is canonical world x/8,y/8 and therefore never restarts at
    // a cell, component, chunk, camera rotation, or reload boundary.
    const presentationLayer = composableSources
      ? composableRuntime!.appendParklandComposablePresentation(
        quality === "low" ? rendererLayers.terrain : layer,
        composableSources,
        composableSemanticFields,
        sortedComponents,
        course,
        presentationTiles,
        effectiveTiles,
        subdivisions,
        heightfield,
        rotation,
        props.colorVision === "standard",
        themedColors,
        composableTrace,
      )
      : layer;
    if (presentationLayer !== layer) terrainScene.lowPresentationLayer = presentationLayer;
    // Low owns only the composable turf overlay. Existing chunk rendering
    // continues to own hazards, paths, and elevation; do not route those
    // categories through the connected Medium/High presentation.
    if (quality === "low" && composableActive) {
      // Low retains the economical chunk path for hazards/elevation, but its
      // cart route needs one joined top plane above the composable turf.
      // Reusing the canonical path component here removes rotation-dependent
      // isolated diamonds without opting Low into the connected-surface scene.
      for (const pathComponent of sortedComponents.filter((component) => component.terrain === "path")) {
        const pathMesh = composableRuntime!.createParklandComposableMesh(
          textureFor("path", true),
          pathComponent.cells,
          course.width,
          1,
          (cell) => cell,
          (_cell, x, y) => worldToIso(
            x,
            y,
            sampleLandscapeSurfaceHeight(heightfield, pathComponent, x, y),
            rotation,
          ),
          true,
        );
        if (!pathMesh) continue;
        pathMesh.eventMode = "none";
        pathMesh.label = `parkland-low-joined-route:${pathComponent.topologyKey}`;
        presentationLayer.addChild(pathMesh);
      }
      // Low uses the same deterministic organic ring authority as the
      // accepted Medium/High hazard floor. The chunk layer beneath has already
      // been neutralized to rough for these cells, so no stepped diamond can
      // remain outside the ring mask.
      for (const hazardComponent of sortedComponents.filter((component) => (
        component.terrain === "water" || component.terrain === "wetland"
      ))) {
        const isSand = hazardComponent.terrain === "sand";
        const visualType = isSand
          ? classifyBunkerVisualType(
            hazardComponent.cells,
            presentationTiles,
            course.width,
            course.height,
          )
          : undefined;
        const authoredRings = buildHazardVisualRings(
          hazardComponent.terrain,
          hazardComponent.rings,
          hazardComponent.topologyKey,
          hazardComponent.cells.length,
          visualType,
        );
        const visualRings = authoredRings.map((ring) => {
          // At overview resolution the canonical ring's small scallops alias
          // back into its source cell staircase. Three bounded Chaikin passes
          // retain the accepted ring inside its authored envelope while
          // presenting one continuous lake/bunker silhouette.
          let smoothed = ring.map((point) => ({ ...point }));
          if (!isSand) for (let pass = 0; pass < 3 && smoothed.length >= 9; pass++) {
            const source = smoothed;
            smoothed = source.map((_point, index) => {
              let x = 0;
              let y = 0;
              for (let offset = -4; offset <= 4; offset++) {
                const sample = source[(index + offset + source.length) % source.length];
                x += sample.x;
                y += sample.y;
              }
              return { x: x / 9, y: y / 9 };
            });
          }
          for (let pass = 0; pass < 2 && smoothed.length >= 3; pass++) {
            smoothed = smoothed.flatMap((point, index) => {
              const next = smoothed[(index + 1) % smoothed.length];
              return [
                { x: point.x * 0.75 + next.x * 0.25, y: point.y * 0.75 + next.y * 0.25 },
                { x: point.x * 0.25 + next.x * 0.75, y: point.y * 0.25 + next.y * 0.75 },
              ];
            });
          }
          return smoothed;
        });
        const plans = visualRings.map((ring) => buildHazardBankFacePlan(
          hazardComponent.terrain,
          hazardComponent.cells.length,
          ring,
          true,
        ));
        const hazardMesh = composableRuntime!.createParklandComposableMesh(
          textureFor(hazardComponent.terrain),
          hazardComponent.presentationCells,
          course.width,
          1,
          (cell) => cell,
          (_cell, x, y) => worldToIso(
            x,
            y,
            sampleLandscapeSurfaceHeight(heightfield, hazardComponent, x, y),
            rotation,
          ),
          true,
        );
        if (!hazardMesh) continue;
        const mask = composableRuntime!.createLandscapeRingMask(
          visualRings.map((ring, index) => plans[index]?.innerRing ?? ring),
          project,
        );
        hazardMesh.eventMode = "none";
        hazardMesh.label = `parkland-low-organic-hazard:${hazardComponent.terrain}:${hazardComponent.topologyKey}`;
        hazardMesh.mask = mask;
        presentationLayer.addChild(hazardMesh, mask);
        const edge = new PIXI.Graphics();
        edge.eventMode = "none";
        for (const ring of visualRings) {
          const points = ring.map(project);
          if (points.length < 3) continue;
          edge.moveTo(points[0].x, points[0].y);
          for (let index = 1; index < points.length; index++) edge.lineTo(points[index].x, points[index].y);
          edge.lineTo(points[0].x, points[0].y);
        }
        edge.stroke({
          width: isSand ? 1 : 1.35,
          color: isSand ? shade(themedColors.rough, 1.08) : 0x719da1,
          alpha: isSand ? 0.62 : 0.7,
          join: "round",
          cap: "round",
        });
        presentationLayer.addChild(edge);
      }
      appendLowSand(presentationLayer);
      const diagnostics = composableRuntime!.lowParklandPresentationDiagnostics(composableTrace, components);
      pathMaterialDiagnosticsRef.current = diagnostics.pathMaterial;
      parklandComposableDiagnosticsRef.current = diagnostics.composable;
      sharedContourDiagnosticsRef.current = sharedContourDiagnostics;
      stampAtlasGeneration(presentationLayer, atlasRevision);
      stampAtlasGeneration(rendererLayers.terrain, atlasRevision);
      stampAtlasGeneration(layer, atlasRevision);
      recordM35Metric("connectedRebuild", performance.now() - rebuildStartedAt);
      return;
    }
    if (import.meta.env.MODE === "e2e") bunkerContoursRef.current = [];
    for (const component of sortedComponents) {
      const presentationTerrain = component.terrain;
      // Canonical seams may displace slightly beyond authoritative ownership.
      // The render-only halo guarantees that the accepted mask always has
      // source geometry beneath it; paths intentionally expose no halo.
      const exactComposableCue = composableActive
        && composableRuntime!.isParklandComposableSemantic(component.terrain);
      const pathMaterialPlan = buildPathMaterialScenePlan(
        component,
        presentationTiles,
        course.width,
        course.height,
        quality,
      );
      const pathCompositorActive = pathMaterialPlan.mode === "cross-section" && hasPathMaterialTextures;
      const mesh = exactComposableCue ? null : composableRuntime!.createParklandComposableMesh(
        textureFor(presentationTerrain, pathCompositorActive),
        component.presentationCells,
        course.width,
        subdivisions,
        (cell) => cell,
        (_cell, x, y) => worldToIso(
          x,
          y,
          sampleLandscapeSurfaceHeight(heightfield, component, x, y, true),
          rotation,
        ),
        true,
      );
      if (!exactComposableCue && !mesh) continue;
      const isSand = component.terrain === "sand";
      const bunkerVisualType = isSand
        ? classifyBunkerVisualType(
          component.cells,
          presentationTiles,
          course.width,
          course.height,
        )
        : null;
      // One deterministic organic contour is shared by the hazard floor,
      // bank, lip, and boundary dressing. Gameplay/picking remain whole-cell.
      const visualRings = (isSand ? authoredBunkerRings(component.cells, course.surfaceIntent?.features, course.width, course.height) : null) ?? (bunkerVisualType != null
        || component.terrain === "water"
        || component.terrain === "wetland"
        ? buildHazardVisualRings(
          component.terrain,
          component.rings,
          component.topologyKey,
          component.cells.length,
          bunkerVisualType ?? undefined,
        )
        : component.rings);
      const hazardPlans = visualRings.map((ring) => (
        buildHazardBankFacePlan(component.terrain, component.cells.length, ring)
      ));
      if (isSand && import.meta.env.MODE === "e2e") bunkerContoursRef.current.push({
        rotation,
        cells: [...component.cells],
        boundary: visualRings.map((ring) => ring.map((point) => ({ ...point }))),
        floor: visualRings.map((ring, index) => (hazardPlans[index]?.innerRing ?? ring).map((point) => ({ ...point }))),
      });
      // The generic field's large square chips made the route read as a gray
      // speckled ribbon. The compositor's core uses the existing deterministic
      // fine-grain generator instead; it remains world-anchored and the whole
      // connected mesh remains the gameplay/picking authority.
      if (mesh) {
        mesh.tint = seasonalByTerrain[presentationTerrain]?.textureTint ?? 0xffffff;
        mesh.eventMode = "none";
        const maskRings = hazardPlans.some(Boolean)
          ? visualRings.map((ring, index) => hazardPlans[index]?.innerRing ?? ring)
          : visualRings;
        const mask = composableRuntime!.createLandscapeRingMask(maskRings, (point) => worldToIso(
          point.x, point.y,
          sampleLandscapeSurfaceHeight(heightfield, component, point.x, point.y, true),
          rotation,
        ));
        mesh.mask = mask;
        layer.addChild(mesh, mask);
      }
      if (pathCompositorActive) {
        pathComponentCount++;
        pathShoulderWidth = pathMaterialPlan.shoulderWidth;
        pathEdgeWidth = pathMaterialPlan.edgeWidth;
        for (const strip of pathMaterialPlan.strips) {
          const data = pathMaterialStripMesh(strip, (point) => worldToIso(
            point.x,
            point.y,
            sampleVisualHeight(heightfield, point.x, point.y),
            rotation,
          ));
          if (data.indices.length === 0) continue;
          const stripMesh = ownSceneMeshGeometry(new PIXI.Mesh({
            geometry: new PIXI.MeshGeometry({
              positions: data.positions,
              uvs: data.uvs,
              indices: data.indices,
            }),
            texture: data.role === "shoulder" ? pathShoulderTexture! : pathEdgeTexture!,
          }));
          stripMesh.eventMode = "none";
          stripMesh.label = `path-material:${data.role}:${component.topologyKey}`;
          pathMaterialLayer.addChild(stripMesh);
          pathStripCount++;
          pathOwnership.add(`path>${strip.outsideTerrain}`);
        }
      }
      if (component.terrain === "water" || component.terrain === "wetland") {
        const firstCell = component.cells[0];
        const gx = firstCell % course.width;
        const gy = Math.floor(firstCell / course.width);
        terrainScene.surfaceWaterSprites.push({
          sprite: mesh!,
          baseTint: mesh!.tint,
          phase: waterShimmerPhase(gx, gy),
          gx,
          gy,
        });
      }

      const reliefStyle = terrainReliefStyle(course.theme, component.terrain);
      if (reliefStyle) {
        const { bankLight, bankDark } = reliefStyle;
        const projectDepthPoint = (point: { x: number; y: number; height: number }) => worldToIso(
          point.x,
          point.y,
          point.height,
          rotation,
        );
        const depthProfile = hazardDepthProfile(component.terrain, component.cells.length);
        let nearFaces = 0;
        let farFaces = 0;
        const depthDrops: number[] = [];
        let interiorFaceAreaPx = 0;
        // The canonical joined skirt remains the sole geometry owner. Two
        // restrained material passes make its screen-facing half read as a
        // bank at normal scale without turning the far half into a dark ring.
        for (let ringIndex = 0; ringIndex < visualRings.length; ringIndex++) {
          const plan = hazardPlans[ringIndex];
          if (!plan) continue;
          const positions: number[] = [];
          const uvs: number[] = [];
          const gradePoints: Point[] = [];
          const gradePlaneInsetPoints: Point[] = [];
          const floorPoints: Point[] = [];
          const nearIndices: number[] = [];
          const farIndices: number[] = [];
          for (let index = 0; index < plan.outerRing.length; index++) {
            const outer = plan.outerRing[index];
            const inner = plan.innerRing[index];
            const gradeHeight = sampleVisualHeight(heightfield, outer.x, outer.y);
            // No private bank-only forced drop: the floor mesh and its mask
            // use this exact sampler at this exact joined inner-ring vertex.
            const floorHeight = sampleLandscapeSurfaceHeight(heightfield, component, inner.x, inner.y, true);
            const grade = projectDepthPoint({ ...outer, height: gradeHeight });
            const gradePlaneInset = projectDepthPoint({ ...inner, height: gradeHeight });
            const floor = projectDepthPoint({ ...inner, height: floorHeight });
            positions.push(grade.x, grade.y, floor.x, floor.y);
            uvs.push(0, 0, 1, 1);
            gradePoints.push(grade);
            gradePlaneInsetPoints.push(gradePlaneInset);
            floorPoints.push(floor);
            depthDrops.push((gradeHeight - floorHeight) * ELEVATION_STEP_PX);
          }
          const lip = new PIXI.Graphics();
          const floorSeam = new PIXI.Graphics();
          for (let index = 0; index < plan.outerRing.length; index++) {
            const next = (index + 1) % plan.outerRing.length;
            // Classify the boundary in the grade plane. Using the lowered
            // floor point here lets a deeper recess flip every edge toward
            // the viewer, erasing the far-side material pass.
            const projectedTowardViewer = isInteriorBankFacingViewer(
              [gradePoints[index], gradePoints[next]],
              [gradePlaneInsetPoints[index], gradePlaneInsetPoints[next]],
            );
            const target = projectedTowardViewer ? nearIndices : farIndices;
            target.push(...plan.stripIndices.slice(index * 6, index * 6 + 6));
            if (projectedTowardViewer) {
              nearFaces++;
              const polygon = [gradePoints[index], gradePoints[next], floorPoints[next], floorPoints[index]];
              interiorFaceAreaPx += Math.abs(polygon.reduce((area, point, vertex) => {
                const after = polygon[(vertex + 1) % polygon.length];
                return area + point.x * after.y - after.x * point.y;
              }, 0)) / 2;
              lip.moveTo(gradePoints[index].x, gradePoints[index].y);
              lip.lineTo(gradePoints[next].x, gradePoints[next].y);
              floorSeam.moveTo(floorPoints[index].x, floorPoints[index].y);
              floorSeam.lineTo(floorPoints[next].x, floorPoints[next].y);
            } else {
              farFaces++;
            }
          }

          const addBankFace = (
            indices: readonly number[],
            tint: number,
            alpha: number,
            label: string,
          ) => {
            if (indices.length === 0) return;
            const bank = ownSceneMeshGeometry(new PIXI.Mesh({
              geometry: new PIXI.MeshGeometry({
                positions: new Float32Array(positions),
                uvs: new Float32Array(uvs),
                indices: new Uint32Array(indices),
              }),
              texture: PIXI.Texture.WHITE,
            }));
            bank.eventMode = "none";
            bank.label = label;
            bank.tint = tint;
            bank.alpha = alpha;
            recessedLayer.addChild(bank);
          };
          addBankFace(
            farIndices,
            isSand ? shade(themedColors.rough, 0.98) : shade(themedColors.rough, 0.9),
            0.9,
            `hazard-bank-far:${component.terrain}`,
          );
          addBankFace(
            nearIndices,
            isSand ? shade(bankLight, 0.72) : shade(bankLight, 0.8),
            1,
            `hazard-bank-near:${component.terrain}`,
          );

          lip.stroke({
            width: isSand ? 1.6 : 1.4,
            color: shade(themedColors.rough, 1.15),
            alpha: 0.85,
            cap: "round",
            join: "round",
          });
          recessedLayer.addChild(lip);
          {
            floorSeam.stroke({
              width: isSand ? 1.8 : 2,
              color: isSand ? shade(bankDark, 0.55) : shade(bankDark, 0.75),
              alpha: 0.7,
              cap: "round",
              join: "round",
            });
            recessedLayer.addChild(floorSeam);
          }
        }
        if (depthProfile && depthDrops.length > 0) {
          hazardDepthDiagnostics.push({
            terrain: depthProfile.terrain,
            topologyKey: component.topologyKey,
            rings: visualRings.length,
            nearFaces,
            farFaces,
            minimumDropPx: Math.min(...depthDrops),
            maximumDropPx: Math.max(...depthDrops),
            floorBoundaryOwner: "shared",
            interiorFaceAreaPx,
          });
        }
      }

      const boundaryRuns = buildLandscapeBoundaryRuns(
        visualRings,
        component.terrain,
        presentationTiles,
        course.width,
        course.height,
      );
      if (pathCompositorActive) continue;
      for (const run of boundaryRuns) {
        // ZK-459 will own authored pair edges. Until then, two composable turf
        // cues meet directly on their shared tile-snapped boundary; retaining
        // the legacy ribbons here creates dark rounded plates and a second
        // same-presentation seam owner. Hazard/path transitions are unchanged.
        if (composableActive && composableTrace.suppressLegacyContour(component.terrain, run.outsideTerrain)) continue;
        const ribbons = buildSignedContourRibbons(
          component.terrain,
          run.outsideTerrain,
          run.points,
          {
            theme: getBiomeDefinition(course.theme).key,
            colorVision: props.colorVision,
            profile: quality,
          },
        );
        // `buildSignedContourRibbons` returns no result unless the profile's
        // semantic owner is this component. That is the single seam authority:
        // the adjacent component never gets a second chance to paint it.
        for (const ribbon of ribbons) {
          // Classified bunker rings are the one continuous presentation owner
          // for sand floor/lip/bank. Suppress the redundant signed quads and
          // their motifs here: they create acute turn fins on organic bunker
          // silhouettes without adding a material read.
          if (!shouldProjectContourRibbon(ribbon, bunkerVisualType != null)) continue;
          const graphics = new PIXI.Graphics();
          graphics.eventMode = "none";
          const projectRibbon = (point: Point) => worldToIso(
            point.x,
            point.y,
            // The current shared heightfield (and its macro geometry) owns
            // every ribbon vertex. Band depth is a restrained visual recess,
            // not an elevation edit or a second terrain mesh.
            sampleVisualHeight(heightfield, point.x, point.y) - ribbon.band.depth * 0.045,
            rotation,
          );
          for (let index = 0; index + 1 < ribbon.outer.length; index++) {
            const outerA = projectRibbon(ribbon.outer[index]);
            const outerB = projectRibbon(ribbon.outer[index + 1]);
            const innerB = projectRibbon(ribbon.inner[index + 1]);
            const innerA = projectRibbon(ribbon.inner[index]);
            graphics.poly([
              outerA.x, outerA.y,
              outerB.x, outerB.y,
              innerB.x, innerB.y,
              innerA.x, innerA.y,
            ]);
            graphics.fill({ color: ribbon.band.color, alpha: ribbon.band.alpha });
          }
          bandLayer.addChild(graphics);

          if (ribbon.details.length > 0 && remainingContourDetails > 0) {
            const motifs = new PIXI.Graphics();
            motifs.eventMode = "none";
            const selected = ribbon.details.slice(0, remainingContourDetails);
            remainingContourDetails -= selected.length;
            for (const detail of selected) {
              const point = projectRibbon({
                x: detail.x + detail.nx * (ribbon.band.offset + ribbon.band.width * 0.5),
                y: detail.y + detail.ny * (ribbon.band.offset + ribbon.band.width * 0.5),
              });
              const scale = detail.scale;
              if (ribbon.band.detail === "reeds" || ribbon.band.detail === "tufts" || ribbon.band.detail === "blades") {
                const strokes = ribbon.band.detail === "reeds" ? 2 : 3;
                for (let stroke = 0; stroke < strokes; stroke++) {
                  const spread = (stroke - (strokes - 1) / 2) * 1.7;
                  motifs.moveTo(point.x + spread, point.y + 1.2);
                  motifs.lineTo(point.x + spread + detail.lean * 5, point.y - (ribbon.band.detail === "reeds" ? 5.5 : 3.5) * scale);
                  motifs.stroke({
                    width: ribbon.band.detail === "reeds" ? 1.2 : 0.9,
                    color: ribbon.band.detail === "reeds" ? 0x65753d : ribbon.band.color,
                    alpha: 0.72,
                    cap: "round",
                  });
                }
              } else {
                const radius = ribbon.band.detail === "stones" ? 2.4 : 1.55;
                motifs.ellipse(point.x, point.y, radius * scale, radius * 0.62 * scale);
                motifs.fill({
                  color: ribbon.band.detail === "stones" ? 0x777064 : ribbon.band.color,
                  alpha: 0.78,
                });
              }
            }
            bandLayer.addChild(motifs);
          }
        }
      }
    }

    // One world-anchored filtered light field makes subpixel heightfield roll
    // legible at normal scale. Purpose-built hazard and path planes are
    // transparent in the source raster, so this layer owns only broad grade.
    const macroRaster = buildMacroLandformRaster(
      heightfield,
      effectiveTiles,
      course.theme,
      quality === "high" ? 6 : 4,
    );
    const textureFromRgba = (rgba: Uint8ClampedArray) => {
      const canvas = document.createElement("canvas");
      canvas.width = macroRaster.width;
      canvas.height = macroRaster.height;
      const context = canvas.getContext("2d");
      if (!context) return null;
      const image = context.createImageData(macroRaster.width, macroRaster.height);
      image.data.set(rgba);
      context.putImageData(image, 0, 0);
      const texture = PIXI.Texture.from(canvas);
      texture.source.style.scaleMode = "linear";
      return texture;
    };
    const macroPositions: number[] = [];
    const macroUvs: number[] = [];
    const macroIndices: number[] = [];
    const macroSubdivisions = 2;
    const macroColumns = course.width * macroSubdivisions + 1;
    for (let sy = 0; sy <= course.height * macroSubdivisions; sy++) {
      for (let sx = 0; sx <= course.width * macroSubdivisions; sx++) {
        const x = sx / macroSubdivisions;
        const y = sy / macroSubdivisions;
        const point = project({ x, y });
        macroPositions.push(point.x, point.y);
        macroUvs.push(x / course.width, y / course.height);
      }
    }
    for (let sy = 0; sy < course.height * macroSubdivisions; sy++) {
      for (let sx = 0; sx < course.width * macroSubdivisions; sx++) {
        const topLeft = sy * macroColumns + sx;
        const topRight = topLeft + 1;
        const bottomLeft = topLeft + macroColumns;
        const bottomRight = bottomLeft + 1;
        macroIndices.push(
          topLeft, topRight, bottomRight,
          topLeft, bottomRight, bottomLeft,
        );
      }
    }
    const macroGeometry = () => new PIXI.MeshGeometry({
      positions: new Float32Array(macroPositions),
      uvs: new Float32Array(macroUvs),
      indices: new Uint32Array(macroIndices),
    });
    const generatedMacroTextures: PIXI.Texture[] = [];
    const shadowTexture = textureFromRgba(macroRaster.shadow);
    if (shadowTexture) {
      generatedMacroTextures.push(terrainScene.ownGeneratedTexture(shadowTexture));
      const shadow = ownSceneMeshGeometry(new PIXI.Mesh({ geometry: macroGeometry(), texture: shadowTexture }));
      shadow.eventMode = "none";
      shadow.label = "macro-landform-shadow";
      shadow.blendMode = "multiply";
      landformLayer.addChild(shadow);
    }
    const highlightTexture = textureFromRgba(macroRaster.highlight);
    if (highlightTexture) {
      generatedMacroTextures.push(terrainScene.ownGeneratedTexture(highlightTexture));
      const highlight = ownSceneMeshGeometry(new PIXI.Mesh({ geometry: macroGeometry(), texture: highlightTexture }));
      highlight.eventMode = "none";
      highlight.label = "macro-landform-highlight";
      highlight.blendMode = "screen";
      landformLayer.addChild(highlight);
    }

    // Boundaries are provenance only; the broad material field above owns
    // visible relief. Never emit lines, closed rings or shoulder backfaces.
    const landformPlan = buildLandformPresentationPlan(
      heightfield,
      effectiveTiles,
      course.elevations,
      course.theme,
      1,
    );
    layer.addChild(landformLayer);
    layer.addChild(recessedLayer);
    layer.addChild(pathMaterialLayer);
    layer.addChild(bandLayer);
    const pathActive = pathComponentCount > 0 && pathStripCount > 0;
    pathMaterialDiagnosticsRef.current = {
      active: pathActive,
      mode: pathActive ? "cross-section" : "legacy",
      quality,
      componentCount: pathComponentCount,
      stripCount: pathStripCount,
      roles: pathActive ? ["shoulder", "edge", "core"] : ["core"],
      textureIds: pathActive
        ? [
          `${getBiomeDefinition(course.theme).key}:${quality}:path-shoulder`,
          `${getBiomeDefinition(course.theme).key}:${quality}:path-edge`,
          `${getBiomeDefinition(course.theme).key}:${quality}:path-core:fine-compacted`,
        ]
        : ["legacy:path"],
      widths: { shoulder: pathShoulderWidth, edge: pathEdgeWidth },
      ownership: [...pathOwnership].sort(),
    };
    if (composableActive) {
      parklandComposableDiagnosticsRef.current = composableTrace.diagnostics(0);
    }
    const alphaMaximum = (raster: Uint8ClampedArray) => {
      let maximum = 0;
      for (let offset = 3; offset < raster.length; offset += 4) maximum = Math.max(maximum, raster[offset]);
      return maximum;
    };
    landformDepthDiagnosticsRef.current = {
      active: generatedMacroTextures.length === 2 || hazardDepthDiagnostics.length > 0,
      quality,
      macro: {
        active: generatedMacroTextures.length === 2,
        maximumGrade: macroRaster.maximumGrade,
        maximumShadowAlpha: alphaMaximum(macroRaster.shadow),
        maximumHighlightAlpha: alphaMaximum(macroRaster.highlight),
      },
      shoulderLevels: [],
      shoulderFaces: 0,
      topSurfaceCrests: 0,
      topSurfaceCrestLevels: [],
      surfaceForm: {
        mode: "material-field",
        samples: macroRaster.shadedSamples,
        levels: [...new Set(landformPlan.shoulders.map((shoulder) => shoulder.level))].sort((a, b) => a - b),
      },
      hazards: hazardDepthDiagnostics,
    };
    sharedContourDiagnosticsRef.current = sharedContourDiagnostics;
    stampAtlasGeneration(layer, atlasRevision);
    recordM35Metric("connectedRebuild", performance.now() - rebuildStartedAt);
    return () => {
      for (const texture of generatedMacroTextures) terrainScene.releaseGeneratedTexture(texture);
    };
    });
  }, [
    appReady,
    atlasRevision,
    effectiveTiles,
    course,
    course.buildings,
    course.elevations,
    course.width,
    course.height,
    course.holes,
    course.surfaceIntent,
    course.theme,
    landscapeComponents,
    presentationTiles,
    props.colorVision,
    props.graphicsQuality,
    props.reducedMotion,
    props.seasonalVisualState,
    props.terrainPatterns,
    presentationRuntime,
    rotation,
    terrainPresentation,
    visualHeightfield,
  ]);

  // Extracted scene systems are installed once for the Pixi application and
  // receive new snapshots through the host below. Layer order and ownership
  // remain unchanged; only rebuild policy has moved out of this component.
  useEffect(() => {
    if (!appReady) return;
    const app = appRef.current;
    const layers = layersRef.current;
    const deferredWorldScenes = deferredWorldScenesRef.current;
    if (!app || !layers || !deferredWorldScenes) {
      console.error("[PixiStage] Renderer became ready without its complete scene host");
      setRendererError(true);
      return;
    }
    const atmosphere = createAtmosphereSceneSystem({
      stage: app.stage,
      world: layers.world,
      seasonalTerrain: layers.seasonalTerrain,
      objects: layers.objects,
      fx: layers.fx,
      screenOverlay: layers.screenOverlay,
      screen: () => app.screen,
    });
    const naturalProps = deferredWorldScenes.createNaturalPropsSceneSystem(
      layers.objects,
      layers.sceneDecals.naturalProps,
    );
    const habitatField = deferredWorldScenes.createHabitatFieldSceneSystem(
      layers.sceneDecals.naturalProps,
    );
    const playerProCollection = deferredWorldScenes.createPlayerProCollectionSceneSystem(layers.objects);
    const holeMarkers = deferredWorldScenes.createHoleMarkersSceneSystem(
      layers.terrainDecals,
      layers.objects,
    );
    const mobilityEntities = createMobilityEntitiesSceneSystem(layers.objects);
    const liveEntities = createLiveEntitiesSceneSystem({
      objects: layers.objects,
      terrainDecals: layers.terrainDecals,
      fx: layers.fx,
      screenOverlay: layers.screenOverlay,
    });
    const overlaysDiagnostics = createOverlaysDiagnosticsSceneSystem({
      terrainDecals: layers.terrainDecals,
      fx: layers.fx,
      screenOverlay: layers.screenOverlay,
    });
    const terrainWater = terrainWaterSceneRef.current;
    if (!terrainWater) {
      console.error("[PixiStage] Renderer became ready without its terrain/water scene");
      setRendererError(true);
      return;
    }
    const host = new SceneSystemHost([
      terrainWater,
      atmosphere,
      createSurfaceCareSceneSystem(
        layers.surfaceCare,
        (workers) => { surfaceCareWorkersRef.current = workers; },
      ),
      createSurfaceEditorSceneSystem(layers.surfaceEditor),
      deferredWorldScenes.createStructuresPropsSceneSystem(
        layers.objects,
        layers.sceneDecals.structuresProps,
        (count) => { structureSpriteCountRef.current = count; },
      ),
      playerProCollection,
      holeMarkers,
      mobilityEntities,
      liveEntities,
      createArchitectureOverlaySceneSystem(layers.terrainDecals, () => app.render()),
      overlaysDiagnostics,
      createOpeningPreviewSceneSystem(layers.fx),
      createEstateSurveySceneSystem(layers.sceneDecals.estateSurvey),
      // Keep host lifecycle order; fixed decal sublayers separately preserve
      // the legacy estate -> natural -> authored-decoration compositing order.
      naturalProps,
      habitatField,
      createPropertyAssetsSceneSystem(layers.objects),
    ]);
    atmosphereSceneRef.current = atmosphere;
    naturalPropsSceneRef.current = naturalProps;
    habitatFieldSceneRef.current = habitatField;
    playerProCollectionSceneRef.current = playerProCollection;
    holeMarkersSceneRef.current = holeMarkers;
    mobilityEntitiesSceneRef.current = mobilityEntities;
    liveEntitiesSceneRef.current = liveEntities;
    overlaysDiagnosticsSceneRef.current = overlaysDiagnostics;
    sceneSystemHostRef.current = host;
    return guardNativeRendererCleanup(nativeMountRef.current?.lease, () => {
      if (sceneSystemHostRef.current === host) sceneSystemHostRef.current = null;
      if (atmosphereSceneRef.current === atmosphere) atmosphereSceneRef.current = null;
      if (naturalPropsSceneRef.current === naturalProps) naturalPropsSceneRef.current = null;
      if (habitatFieldSceneRef.current === habitatField) habitatFieldSceneRef.current = null;
      if (playerProCollectionSceneRef.current === playerProCollection) playerProCollectionSceneRef.current = null;
      if (holeMarkersSceneRef.current === holeMarkers) holeMarkersSceneRef.current = null;
      if (mobilityEntitiesSceneRef.current === mobilityEntities) mobilityEntitiesSceneRef.current = null;
      if (liveEntitiesSceneRef.current === liveEntities) liveEntitiesSceneRef.current = null;
      if (overlaysDiagnosticsSceneRef.current === overlaysDiagnostics) overlaysDiagnosticsSceneRef.current = null;
      host.dispose();
    });
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
      if (renderedScenes.includes("playerProCollection")) {
        stampAtlasGeneration(layers.objects, atlasRevision);
      }
      if (renderedScenes.includes("naturalProps")) {
        stampAtlasGeneration(layers.objects, atlasRevision);
      }
      if (renderedScenes.includes("habitatField")) {
        stampAtlasGeneration(layers.sceneDecals.naturalProps, atlasRevision);
      }
    }
  }, [appReady, atlasRevision, renderSnapshot]);

  // Tee/cup/draft markers and live pin flags are owned by holeMarkersScene.

  // ---------------------------------------------------------------------
  // Ticker pass — ordered scene ticks and remaining animated world systems
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!appReady) return;
    const app = appRef.current;
    const layers = layersRef.current;
    if (!app || !layers) return;

    const tick = (ticker: PIXI.Ticker) => {
      const dtMs = ticker.deltaMS;
      const nowMs = performance.now();
      props.onFrameTime?.(dtMs);

      const overlaysDiagnostics = overlaysDiagnosticsSceneRef.current;
      overlaysDiagnostics?.beginFrame(nowMs);
      overlaysDiagnostics?.tick({
        wizardStep,
        holes,
        activeHoleIndex,
        draftTee,
        worldPointToScreen,
        course,
        effectiveTiles,
        rotation,
        surfaceHeightAt,
        editorMode,
        selectedTerrain,
        terrainStrokePreview,
        colorVision: props.colorVision,
        graphicsQuality: props.graphicsQuality,
        seasonalVisualState: props.seasonalVisualState,
        reducedMotion: props.reducedMotion,
        sculptRadius: props.sculptRadius,
        selectedDecorationKind: props.selectedDecorationKind,
        decorationRotation: props.decorationRotation,
        decorationSpan: props.decorationSpan,
      });
      const perfMark = (name: string) => overlaysDiagnostics?.markPerf(name);

      holeMarkersSceneRef.current?.tick(nowMs);

      perfMark("hover+flags");
      terrainWaterSceneRef.current?.tickWater(
        nowMs,
        props.animationsEnabled && props.waterAnimation,
      );

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

      const liveEntities = liveEntitiesSceneRef.current;
      liveEntities?.tickEffects(nowMs, props.animationsEnabled);

      perfMark("fx");

      const list = liveActive && props.showGolfers !== false ? golfersRef?.current ?? [] : [];
      const terrainPreview = terrainStrokePreview;
      habitatFieldSceneRef.current?.tick({
        golfers: list,
        editorPreviewPoints: [
          draftTee,
          draftGreen,
          ...clickSplineDraft,
          clickSplineHover,
          ...(terrainPreview?.previewKind === "surface-edit"
            ? terrainPreview.tiles
            : terrainPreview?.acceptedTiles ?? []),
        ].filter((point): point is Point => point != null),
      });

      // Preserve the legacy entity culling and tick ordering while the scene
      // owns every golfer, ball, emote, and transient display object.
      let cullL = -Infinity;
      let cullR = Infinity;
      let cullT = -Infinity;
      let cullB = Infinity;
      const worldCull = layers.world;
      if (worldCull.rotation === 0) {
        const margin = 96;
        const halfW = app.screen.width / 2 / worldCull.scale.x;
        const halfH = app.screen.height / 2 / worldCull.scale.y;
        cullL = worldCull.pivot.x - halfW - margin;
        cullR = worldCull.pivot.x + halfW + margin;
        cullT = worldCull.pivot.y - halfH - margin;
        cullB = worldCull.pivot.y + halfH + margin;
      }
      liveEntities?.tickEntities({
        nowMs,
        animationsEnabled: props.animationsEnabled,
        golfers: list,
        selectedGolferId: props.selectedGolferId,
        followSelected: props.followSelected,
        cullBounds: { left: cullL, right: cullR, top: cullT, bottom: cullB },
        worldPointToScreen,
        followCamera: (x, y) => {
          const next = clampCenter(x, y);
          viewportInputControllerRef.current?.followTarget(next);
        },
        startleAtmosphere: (point, atMs) => atmosphereSceneRef.current?.startleAt(point, atMs),
        tickMobilityEntities: () => mobilityEntitiesSceneRef.current?.tick({
          golfers: list,
          cullBounds: { left: cullL, right: cullR, top: cullT, bottom: cullB },
        }),
      });

      overlaysDiagnostics?.finishFrame(nowMs, dtMs, () => {
        const terrainDiagnostics = terrainWaterSceneRef.current?.diagnostics();
        return {
          ...(liveEntitiesSceneRef.current?.diagnostics() ?? {
            golfers: 0,
            bubbles: 0,
            ripples: 0,
            impacts: 0,
          }),
          ambientObjects: atmosphereSceneRef.current?.objectCount() ?? 0,
          chunksVisible: terrainDiagnostics?.chunksVisible ?? 0,
          chunksTotal: terrainDiagnostics?.chunksTotal ?? 0,
          objects: layers.objects.children.length,
        };
      });
    };

    // Every dependency below can change the material or non-color state of a
    // live ghost. Force the replacement closure to paint on its first tick.
    overlaysDiagnosticsSceneRef.current?.invalidate();
    app.ticker.add(tick);
    return guardNativeRendererCleanup(nativeMountRef.current?.lease, () => {
      app.ticker?.remove(tick);
    });
  }, [appReady, wizardStep, holes, activeHoleIndex, draftTee, draftGreen, worldPointToScreen, golfersRef, liveActive, course, effectiveTiles, rotation, editorMode, selectedTerrain, terrainStrokePreview, clickSplineDraft, clickSplineHover, props.colorVision, props.graphicsQuality, props.reducedMotion, props.seasonalVisualState, props.sculptRadius, props.selectedDecorationKind, props.decorationRotation, props.decorationSpan, props.animationsEnabled, props.ambienceFx, props.waterAnimation, props.treeSway, props.flagColor, props.selectedGolferId, props.followSelected, props.showGolfers, props.onFrameTime, clampCenter, surfaceHeightAt]);

  // This is deliberately the final effect: finalize after all preceding passive cleanups.
  useEffect(() => {
    const mount = nativeMountRef.current;
    if (!mount) return;
    return () => {
      queueMicrotask(() => {
        const app = mount.application;
        try {
          if (app) {
            completeNativeSceneDisposers(app.stage.removeChildren().map((child) => () => destroySceneSubtree(child)));
          }
        } catch (error) {
          mount.lease.owner.fail(mount.lease.generation);
          console.error("[PixiStage] Scene cleanup failed", error);
        } finally {
          mount.application = null;
          void nativeSession.completeCleanup(mount.lease).catch((error: unknown) => {
            console.error("[PixiStage] Renderer cleanup failed", error);
          });
        }
      });
    };
  }, [nativeSession]);

  // Camera and editor input listeners are owned by ViewportInputController.

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
