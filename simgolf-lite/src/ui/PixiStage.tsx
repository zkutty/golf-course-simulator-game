import { useCallback, useEffect, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import type { Course, Hole, Obstacle, Point, Terrain } from "../game/models/types";
import type { ShotPlanStep } from "../game/sim/shots/solveShotsToGreen";
import type { GolferRenderData } from "../game/live/types";
import type { CameraState } from "../game/render/camera";
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
import { computeTerrainChangeCost } from "../game/models/terrainEconomics";
import { ELEVATION_MAX, getElevation } from "../game/models/elevation";
import { entityDepth, placeObject } from "../game/render/objectPlacement";

/**
 * PixiStage — the isometric WebGL renderer for the course (ZKU-138/139).
 *
 * Layer architecture (draw order back → front):
 *
 *   stage
 *   ├─ world                ← camera transform (pan/zoom) is applied HERE and
 *   │  │                      nowhere else; all world-space content lives below
 *   │  ├─ terrain           ← one diamond sprite per tile (chunked in ZKU-142)
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
  water: 0x2b7bbb,
  green: 0x5dbb6a,
  tee: 0x8b6b4f,
  path: 0x8f8f8f,
};

// Slightly darker edge tint per tile to keep the grid readable until the
// M10 art pass replaces flat colors with textures.
const EDGE_DARKEN = 0.88;

const MARKER_LABEL = "hole-marker";
const ROUTE_LABEL = "route-overlay";

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 8;
const CAMERA_MARGIN_TILES = 6;
const ROTATE_TWEEN_MS = 250;
const KEY_PAN_SPEED = 900; // screen px/sec at zoom 1

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
const CLIFF_SW = 0x6b4f33;
const CLIFF_SE = 0x8a6844;

export interface PixiStageProps {
  course: Course;
  holes: Hole[];
  obstacles: Obstacle[];
  activeHoleIndex: number;
  activePath?: Point[];
  activeShotPlan?: ShotPlanStep[];
  tileSize: number;
  showGridOverlays: boolean;
  animationsEnabled: boolean;
  flyoverNonce: number;
  showShotPlan: boolean;
  editorMode: "PAINT" | "HOLE_WIZARD" | "OBSTACLE" | "SCULPT";
  sculptRadius?: number;
  wizardStep: "TEE" | "GREEN" | "CONFIRM" | "MOVE_TEE" | "MOVE_GREEN";
  draftTee: Point | null;
  draftGreen: Point | null;
  onClickTile: (x: number, y: number) => void;
  selectedTerrain?: Terrain;
  worldCash?: number;
  flagColor?: string;
  cameraState?: CameraState | null;
  showFixOverlay?: boolean;
  failingCorridorSegments?: Point[];
  onCameraUpdate?: (camera: CameraState) => void;
  showObstacles?: boolean;
  golfersRef?: React.RefObject<GolferRenderData[]>;
  liveActive?: boolean;
}

interface Layers {
  world: PIXI.Container;
  terrain: PIXI.Container;
  terrainDecals: PIXI.Container;
  objects: PIXI.Container;
  fx: PIXI.Container;
  screenOverlay: PIXI.Container;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const layersRef = useRef<Layers | null>(null);
  const [appReady, setAppReady] = useState(false);

  const diamondTextureRef = useRef<PIXI.Texture | null>(null);
  const tileSpritesRef = useRef<PIXI.Sprite[]>([]);
  const cliffGraphicsRef = useRef<PIXI.Graphics | null>(null);
  const builtRotationRef = useRef<IsoRotation | null>(null);
  const obstacleSpritesRef = useRef<Map<string, PIXI.Sprite>>(new Map());
  const hoverLineRef = useRef<PIXI.Graphics | null>(null);
  const hoverHighlightRef = useRef<PIXI.Graphics | null>(null);
  const golferPoolRef = useRef<
    Map<number, { holder: PIXI.Container; body: PIXI.Graphics; ball: PIXI.Graphics; lastColor: string; lastMoodBucket: number }>
  >(new Map());
  const hoverTileRef = useRef<{ x: number; y: number } | null>(null);
  const overlayDirtyRef = useRef(false);

  // Free camera (ZKU-141): current values lerp toward targets each frame.
  // Center is in world tile coordinates so it survives rotation changes.
  const [rotation, setRotation] = useState<IsoRotation>(0);
  const camRef = useRef({ cx: 0, cy: 0, zoom: 1, tcx: 0, tcy: 0, tzoom: 1, initialized: false });
  const rotTweenRef = useRef<{ start: number; toDeg: number; next: IsoRotation } | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const lastReportedCenterRef = useRef<Point | null>(null);
  const lastCameraStateRef = useRef<CameraState | null | undefined>(undefined);

  const {
    course,
    holes,
    obstacles,
    activeHoleIndex,
    activePath,
    tileSize,
    onClickTile,
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
  } = props;

  // ---------------------------------------------------------------------
  // Camera: world container transform + screen↔world mapping
  // ---------------------------------------------------------------------

  const clampCenter = useCallback(
    (x: number, y: number): Point => ({
      x: Math.max(-CAMERA_MARGIN_TILES, Math.min(course.width + CAMERA_MARGIN_TILES, x)),
      y: Math.max(-CAMERA_MARGIN_TILES, Math.min(course.height + CAMERA_MARGIN_TILES, y)),
    }),
    [course.width, course.height]
  );

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
  }, [rotation]);

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

    const app = new PIXI.Application();

    const init = async () => {
      const width = Math.max(container.clientWidth || 800, 100);
      const height = Math.max(container.clientHeight || 600, 100);

      await app.init({
        width,
        height,
        backgroundColor: 0xdfe8d8, // soft parchment-green backdrop
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });

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
      const terrain = new PIXI.Container();
      const terrainDecals = new PIXI.Container();
      const objects = new PIXI.Container();
      objects.sortableChildren = true;
      const fx = new PIXI.Container();
      const screenOverlay = new PIXI.Container();

      world.addChild(terrain, terrainDecals, objects, fx);
      app.stage.addChild(world, screenOverlay);

      app.stage.eventMode = "static";
      app.stage.hitArea = app.screen;

      appRef.current = app;
      layersRef.current = { world, terrain, terrainDecals, objects, fx, screenOverlay };
      setAppReady(true);
      devLog(`initialized ${width}x${height}`);
    };

    void init();

    return () => {
      cancelled = true;
      setAppReady(false);
      layersRef.current = null;
      tileSpritesRef.current = [];
      obstacleSpritesRef.current.clear();
      hoverLineRef.current = null;
      hoverHighlightRef.current = null;
      golferPoolRef.current.clear();
      diamondTextureRef.current = null;
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: true });
        appRef.current = null;
      }
    };
  }, []);

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
      applyCamera();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();
    return () => ro.disconnect();
  }, [appReady, applyCamera]);

  // One-time camera init: snap to a whole-course fit.
  useEffect(() => {
    if (!appReady) return;
    const cam = camRef.current;
    if (!cam.initialized) {
      cam.initialized = true;
      fitWholeCourse(true);
    }
  }, [appReady, fitWholeCourse]);

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
    const reported = lastReportedCenterRef.current;
    const isEcho =
      reported &&
      Math.abs(reported.x - cameraState.center.x) < 1e-6 &&
      Math.abs(reported.y - cameraState.center.y) < 1e-6;
    if (isEcho) return;

    cam.tcx = cameraState.center.x;
    cam.tcy = cameraState.center.y;
    const b = cameraState.bounds;
    if (b) {
      cam.tzoom = fitZoomForTileBounds(
        b.minX, b.minY, b.maxX, b.maxY,
        app.screen.width, app.screen.height, rotation
      );
    }
  }, [appReady, cameraState, rotation, fitWholeCourse]);

  // Camera controls: wheel zoom-to-cursor, drag pan, WASD/QE, smoothing.
  useEffect(() => {
    if (!appReady) return;
    const app = appRef.current;
    const el = containerRef.current;
    if (!app || !el) return;

    const reportCenter = () => {
      if (!cameraState || !props.onCameraUpdate) return;
      const cam = camRef.current;
      const center = { x: cam.tcx, y: cam.tcy };
      lastReportedCenterRef.current = center;
      props.onCameraUpdate({ ...cameraState, center });
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = camRef.current;
      const rect = el.getBoundingClientRect();
      const gx = e.clientX - rect.left;
      const gy = e.clientY - rect.top;
      const under = screenToIsoPlane(gx, gy); // iso-plane point under cursor
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.tzoom * Math.exp(-e.deltaY * 0.0012)));
      if (under && appRef.current) {
        // Keep the point under the cursor stationary: solve for the center
        // whose pivot places `under` back at the cursor after the zoom.
        const sw = appRef.current.screen.width;
        const sh = appRef.current.screen.height;
        const pivotX = under.x - (gx - sw / 2) / newZoom;
        const pivotY = under.y - (gy - sh / 2) / newZoom;
        const centerTile = isoToWorld(pivotX, pivotY, rotation);
        const clamped = clampCenter(centerTile.x, centerTile.y);
        const cam2 = camRef.current;
        cam2.cx = cam2.tcx = clamped.x;
        cam2.cy = cam2.tcy = clamped.y;
        cam2.zoom = cam2.tzoom = newZoom;
      } else {
        cam.tzoom = newZoom;
      }
      applyCamera();
      overlayDirtyRef.current = true;
      reportCenter();
    };

    // Drag-to-pan with middle or right button (left stays editing).
    let panState: { gx: number; gy: number; cx: number; cy: number } | null = null;
    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 1 && e.button !== 2) return;
      e.preventDefault();
      const cam = camRef.current;
      panState = { gx: e.clientX, gy: e.clientY, cx: cam.cx, cy: cam.cy };
      el.setPointerCapture(e.pointerId);
      el.style.cursor = "grabbing";
    };
    const handlePointerMove = (e: PointerEvent) => {
      if (!panState) return;
      const cam = camRef.current;
      const startIso = worldToIso(panState.cx, panState.cy, 0, rotation);
      const isoX = startIso.x - (e.clientX - panState.gx) / cam.zoom;
      const isoY = startIso.y - (e.clientY - panState.gy) / cam.zoom;
      const tile = isoToWorld(isoX, isoY, rotation);
      const clamped = clampCenter(tile.x, tile.y);
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
      reportCenter();
    };
    const handleContextMenu = (e: MouseEvent) => e.preventDefault();

    // Keyboard: WASD/arrows pan (held), Q/E rotate.
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement ||
      (t instanceof HTMLElement && t.isContentEditable);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
        keysRef.current.add(k);
        e.preventDefault();
      } else if ((k === "q" || k === "e") && !e.repeat && !rotTweenRef.current) {
        rotTweenRef.current = {
          start: performance.now(),
          toDeg: k === "e" ? -90 : 90,
          next: nextRotation(rotation, k === "e" ? 1 : -1),
        };
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase());
    };
    const handleBlur = () => keysRef.current.clear();

    // Per-frame: keyboard pan, target smoothing, rotation tween.
    const tickCamera = (ticker: PIXI.Ticker) => {
      const cam = camRef.current;
      const world = layersRef.current?.world;
      const dtMs = ticker.deltaMS;
      let moved = false;

      // Keyboard pan in screen space → iso plane → tile space.
      const keys = keysRef.current;
      if (keys.size > 0 && !rotTweenRef.current) {
        let dx = 0;
        let dy = 0;
        if (keys.has("a") || keys.has("arrowleft")) dx -= 1;
        if (keys.has("d") || keys.has("arrowright")) dx += 1;
        if (keys.has("w") || keys.has("arrowup")) dy -= 1;
        if (keys.has("s") || keys.has("arrowdown")) dy += 1;
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

      // Smooth toward targets.
      const k = 1 - Math.exp(-dtMs / 90);
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
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    el.addEventListener("pointerdown", handlePointerDown);
    el.addEventListener("pointermove", handlePointerMove);
    el.addEventListener("pointerup", handlePointerUp);
    el.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    app.ticker.add(tickCamera);

    return () => {
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("pointerdown", handlePointerDown);
      el.removeEventListener("pointermove", handlePointerMove);
      el.removeEventListener("pointerup", handlePointerUp);
      el.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      app.ticker.remove(tickCamera);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appReady, rotation, cameraState, applyCamera, clampCenter, screenToIsoPlane]);

  // ---------------------------------------------------------------------
  // Terrain layer — tinted diamond sprites, back-to-front
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!appReady) return;
    const layers = layersRef.current;
    const diamond = diamondTextureRef.current;
    if (!layers || !diamond) return;

    const tileCount = course.width * course.height;
    const sprites = tileSpritesRef.current;
    const elev = (x: number, y: number) => getElevation(course, x, y);

    // Insertion order must be back-to-front FOR THE CURRENT ROTATION, so the
    // sprite pool rebuilds when the camera rotates to a new cardinal.
    if (sprites.length !== tileCount || !cliffGraphicsRef.current || builtRotationRef.current !== rotation) {
      layers.terrain.removeChildren();
      cliffGraphicsRef.current?.destroy();
      sprites.forEach((s) => s.destroy());
      sprites.length = tileCount;
      builtRotationRef.current = rotation;
      // Cliff faces render behind all tile tops.
      const cliffs = new PIXI.Graphics();
      layers.terrain.addChild(cliffs);
      cliffGraphicsRef.current = cliffs;
      const order: number[] = Array.from({ length: tileCount }, (_, i) => i);
      order.sort((a, b) => {
        const da = isoDepth((a % course.width) + 0.5, Math.floor(a / course.width) + 0.5, 0, rotation);
        const db = isoDepth((b % course.width) + 0.5, Math.floor(b / course.width) + 0.5, 0, rotation);
        return da - db;
      });
      for (const idx of order) {
        const sprite = new PIXI.Sprite(diamond);
        sprite.anchor.set(0.5, 0);
        layers.terrain.addChild(sprite);
        sprites[idx] = sprite;
      }
      devLog(`built ${tileCount} diamond sprites (rot ${rotation})`);
    }

    // Tops: position by elevation, tint by terrain color × NW-sun slope shade
    // (the sun is world-fixed; it does not rotate with the camera).
    for (let y = 0; y < course.height; y++) {
      for (let x = 0; x < course.width; x++) {
        const idx = y * course.width + x;
        const sprite = sprites[idx];
        const e = elev(x, y);
        const p = worldToIso(x + 0.5, y, e, rotation); // top corner of tile diamond
        sprite.position.set(p.x, p.y);
        const dzdx = (elev(x + 1, y) - elev(x - 1, y)) / 2;
        const dzdy = (elev(x, y + 1) - elev(x, y - 1)) / 2;
        const slopeShade = Math.max(0.8, Math.min(1.12, 1 - 0.07 * (dzdx + dzdy)));
        sprite.tint = shade(darken(COLORS[course.tiles[idx]], EDGE_DARKEN), slopeShade);
      }
    }

    // Cliff faces: drops exposed toward the camera become vertical dirt
    // quads. Which world-neighbors face the camera depends on rotation:
    // in rotated space the camera-facing edges are +x (screen lower-right)
    // and +y (screen lower-left).
    const cliffs = cliffGraphicsRef.current;
    if (cliffs) {
      cliffs.clear();
      const dSE = unrotateWorld(1, 0, rotation); // world offset of screen-lower-right neighbor
      const dSW = unrotateWorld(0, 1, rotation); // world offset of screen-lower-left neighbor
      // Shared-edge corners (world coords) between tile (x,y) and neighbor at offset d.
      const edgeCorners = (x: number, y: number, dx: number, dy: number): [Point, Point] => {
        if (dx === 1) return [{ x: x + 1, y }, { x: x + 1, y: y + 1 }];
        if (dx === -1) return [{ x, y }, { x, y: y + 1 }];
        if (dy === 1) return [{ x, y: y + 1 }, { x: x + 1, y: y + 1 }];
        return [{ x, y }, { x: x + 1, y }];
      };
      const face = (x: number, y: number, d: Point, color: number) => {
        const e = elev(x, y);
        const nx = x + d.x;
        const ny = y + d.y;
        const ne = nx < 0 || ny < 0 || nx >= course.width || ny >= course.height ? 0 : elev(nx, ny);
        if (ne >= e || e <= 0) return;
        const [c1, c2] = edgeCorners(x, y, d.x, d.y);
        const a = worldToIso(c1.x, c1.y, e, rotation);
        const b = worldToIso(c2.x, c2.y, e, rotation);
        const drop = (e - ne) * ELEVATION_STEP_PX;
        cliffs.poly([a.x, a.y, b.x, b.y, b.x, b.y + drop, a.x, a.y + drop]);
        cliffs.fill(color);
      };
      for (let y = 0; y < course.height; y++) {
        for (let x = 0; x < course.width; x++) {
          face(x, y, dSW, CLIFF_SW);
          face(x, y, dSE, CLIFF_SE);
        }
      }
    }
  }, [appReady, course, rotation]);

  // ---------------------------------------------------------------------
  // Objects layer — obstacles, ground-anchored and depth-sorted
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!appReady) return;
    const layers = layersRef.current;
    if (!layers) return;

    obstacleSpritesRef.current.forEach((sprite) => {
      layers.objects.removeChild(sprite);
      sprite.destroy();
    });
    obstacleSpritesRef.current.clear();

    if (!props.showObstacles) return;

    const addSprite = (obs: Obstacle, img: HTMLImageElement) => {
      const layersNow = layersRef.current;
      if (!layersNow) return;
      const key = `${obs.x},${obs.y}`;
      if (obstacleSpritesRef.current.has(key)) return;
      const sprite = new PIXI.Sprite(PIXI.Texture.from(img));
      // Ground-anchored via the shared placement helper (ZKU-140).
      const e = getElevation(course, obs.x, obs.y);
      const placement = placeObject({ x: obs.x, y: obs.y, w: 1, d: 1 }, e, rotation);
      sprite.anchor.set(0.5, 1);
      sprite.position.set(placement.position.x, placement.position.y);
      const size = TILE_W * 0.72;
      sprite.width = size;
      sprite.height = size;
      sprite.zIndex = placement.zIndex;
      layersNow.objects.addChild(sprite);
      obstacleSpritesRef.current.set(key, sprite);
    };

    obstacles.forEach((obs) => {
      const spriteOrPromise = getObstacleSprite(obs.type, tileSize);
      if (spriteOrPromise instanceof HTMLImageElement) {
        addSprite(obs, spriteOrPromise);
      } else if (spriteOrPromise instanceof Promise) {
        void spriteOrPromise.then((img: HTMLImageElement) => {
          if (appRef.current) addSprite(obs, img);
        });
      }
    });
  }, [appReady, obstacles, tileSize, props.showObstacles, course, rotation]);

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

    const drawMarker = (p: Point, fill: number, alpha = 1) => {
      const g = new PIXI.Graphics();
      const c = tileCenterIso(p.x, p.y, getElevation(course, p.x, p.y), rotation);
      g.ellipse(c.x, c.y, TILE_W * 0.18, TILE_H * 0.36);
      g.fill({ color: fill, alpha });
      g.stroke({ width: 2, color: 0xffffff, alpha });
      g.label = MARKER_LABEL;
      layers.terrainDecals.addChild(g);
    };

    holes.forEach((hole) => {
      if (hole.tee) drawMarker(hole.tee, 0x222222);
      if (hole.green) drawMarker(hole.green, 0x1b5e20);
    });
    if (draftTee) drawMarker(draftTee, 0x222222, 0.55);
    if (draftGreen) drawMarker(draftGreen, 0x1b5e20, 0.55);
  }, [appReady, holes, draftTee, draftGreen, course, rotation]);

  useEffect(() => {
    if (!appReady) return;
    const layers = layersRef.current;
    if (!layers) return;

    const stale = layers.terrainDecals.children.filter((c) => c.label === ROUTE_LABEL);
    stale.forEach((c) => {
      layers.terrainDecals.removeChild(c);
      c.destroy();
    });

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
  }, [appReady, showFixOverlay, failingCorridorSegments, showShotPlan, activePath, course, rotation]);

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


    const tick = () => {
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
            if (editorMode === "SCULPT" && props.sculptRadius && props.sculptRadius > 1) {
              // Brush footprint preview (matches brushFootprint in sculpt.ts).
              const r = props.sculptRadius - 0.5;
              for (let ty = hover.y - props.sculptRadius; ty <= hover.y + props.sculptRadius; ty++) {
                for (let tx = hover.x - props.sculptRadius; tx <= hover.x + props.sculptRadius; tx++) {
                  if (tx < 0 || ty < 0 || tx >= course.width || ty >= course.height) continue;
                  const d2 = (tx - hover.x) ** 2 + (ty - hover.y) ** 2;
                  if (d2 <= r * r + 1e-9) outlineTile(tx, ty, tx === hover.x && ty === hover.y ? 0.9 : 0.45);
                }
              }
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

      // Live golfers/balls: pooled per-golfer objects in the depth-sorted
      // objects layer so props occlude them correctly (ZKU-140; character
      // sprites replace the dots in M11/ZKU-153).
      const pool = golferPoolRef.current;
      const list = liveActive ? golfersRef?.current : null;
      const seen = new Set<number>();
      if (list) {
        for (const golfer of list) {
          seen.add(golfer.id);
          let entry = pool.get(golfer.id);
          if (!entry) {
            const holder = new PIXI.Container();
            const body = new PIXI.Graphics();
            const ball = new PIXI.Graphics();
            ball.circle(0, -2, 2.2);
            ball.fill(0xffffff);
            ball.stroke({ width: 0.8, color: 0x555555 });
            ball.visible = false;
            holder.addChild(body);
            layers.objects.addChild(holder, ball);
            entry = { holder, body, ball, lastColor: "", lastMoodBucket: -1 };
            pool.set(golfer.id, entry);
          }
          // Redraw the body only when color or mood bucket changes.
          const moodBucket = Math.round(Math.max(0, Math.min(1, golfer.mood)) * 10);
          if (entry.lastColor !== golfer.color || entry.lastMoodBucket !== moodBucket) {
            entry.lastColor = golfer.color;
            entry.lastMoodBucket = moodBucket;
            const body = entry.body;
            body.clear();
            body.ellipse(0, 0, 7, 3.2); // ground shadow at the feet
            body.fill({ color: 0x000000, alpha: 0.2 });
            body.circle(0, -7, 5.5);
            body.fill(golfer.color);
            body.stroke({ width: 1.5, color: `hsl(${moodBucket * 12}, 80%, 45%)` });
          }
          const ge = getElevation(course, Math.floor(golfer.x + 0.5), Math.floor(golfer.y + 0.5));
          const c = tileCenterIso(golfer.x, golfer.y, ge, rotation);
          entry.holder.position.set(c.x, c.y);
          // Quantize the depth key so the container only re-sorts when the
          // golfer crosses a meaningful slice of a tile row, not per frame.
          const z = Math.round(entityDepth(golfer.x, golfer.y, ge, rotation) * 10) / 10;
          if (entry.holder.zIndex !== z) entry.holder.zIndex = z;

          if (golfer.ballX != null && golfer.ballY != null) {
            const be = getElevation(course, Math.floor(golfer.ballX + 0.5), Math.floor(golfer.ballY + 0.5));
            const b = tileCenterIso(golfer.ballX, golfer.ballY, be, rotation);
            entry.ball.position.set(b.x, b.y);
            const bz = Math.round(entityDepth(golfer.ballX, golfer.ballY, be, rotation) * 10) / 10;
            if (entry.ball.zIndex !== bz) entry.ball.zIndex = bz;
            entry.ball.visible = true;
          } else {
            entry.ball.visible = false;
          }
        }
      }
      // Retire golfers who finished/left.
      for (const [id, entry] of pool) {
        if (!seen.has(id)) {
          layers.objects.removeChild(entry.holder, entry.ball);
          entry.holder.destroy({ children: true });
          entry.ball.destroy();
          pool.delete(id);
        }
      }
    };

    app.ticker.add(tick);
    return () => {
      app.ticker.remove(tick);
    };
  }, [appReady, wizardStep, holes, activeHoleIndex, draftTee, worldPointToScreen, golfersRef, liveActive, course, rotation, editorMode, props.sculptRadius]);

  // ---------------------------------------------------------------------
  // Input — pointer events through the inverse camera transform
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!appReady) return;
    const app = appRef.current;
    if (!app) return;

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

    const handleClick = (e: PIXI.FederatedPointerEvent) => {
      if (e.button !== 0) return; // middle/right are camera pan, not editing
      const t = screenToTile(e.global.x, e.global.y);
      if (t) onClickTile(t.x, t.y);
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

    app.stage.on("pointerdown", handleClick);
    app.stage.on("pointermove", handleMove);
    return () => {
      app.stage.off("pointerdown", handleClick);
      app.stage.off("pointermove", handleMove);
    };
  }, [appReady, screenToTile, onClickTile, editorMode, selectedTerrain, worldCash, course.tiles, course.width]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        cursor: "crosshair",
      }}
    />
  );
}
