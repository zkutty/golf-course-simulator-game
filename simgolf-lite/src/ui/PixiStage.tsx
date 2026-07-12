import { useCallback, useEffect, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import type { Course, Hole, Obstacle, Point, Terrain } from "../game/models/types";
import type { ShotPlanStep } from "../game/sim/shots/solveShotsToGreen";
import type { GolferRenderData } from "../game/live/types";
import type { CameraState } from "../game/render/camera";
import {
  TILE_H,
  TILE_W,
  isoDepth,
  isoToTile,
  tileCenterIso,
  worldToIso,
  type IsoRotation,
} from "../game/render/iso";
import { getObstacleSprite } from "../render/iconSprites";
import { computeTerrainChangeCost } from "../game/models/terrainEconomics";

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
 * Rotation is plumbed (ROTATION constant) but fixed at 0 until the Q/E
 * camera controls of ZKU-141.
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
const ROTATION: IsoRotation = 0;

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
  editorMode: "PAINT" | "HOLE_WIZARD" | "OBSTACLE";
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
  screenH: number
): number {
  const corners = [
    worldToIso(minX, minY, 0, ROTATION),
    worldToIso(maxX + 1, minY, 0, ROTATION),
    worldToIso(maxX + 1, maxY + 1, 0, ROTATION),
    worldToIso(minX, maxY + 1, 0, ROTATION),
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  if (w <= 0 || h <= 0 || screenW <= 0 || screenH <= 0) return 1;
  const zoom = Math.min((screenW * 0.95) / w, (screenH * 0.95) / h);
  return Math.max(0.1, Math.min(8, zoom));
}

export function PixiStage(props: PixiStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const layersRef = useRef<Layers | null>(null);
  const [appReady, setAppReady] = useState(false);

  const diamondTextureRef = useRef<PIXI.Texture | null>(null);
  const tileSpritesRef = useRef<PIXI.Sprite[]>([]);
  const obstacleSpritesRef = useRef<Map<string, PIXI.Sprite>>(new Map());
  const hoverLineRef = useRef<PIXI.Graphics | null>(null);
  const hoverHighlightRef = useRef<PIXI.Graphics | null>(null);
  const liveGraphicsRef = useRef<PIXI.Graphics | null>(null);
  const hoverTileRef = useRef<{ x: number; y: number } | null>(null);
  const overlayDirtyRef = useRef(false);

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

  const applyCamera = useCallback(() => {
    const app = appRef.current;
    const layers = layersRef.current;
    if (!app || !layers) return;
    const { world } = layers;
    const sw = app.screen.width;
    const sh = app.screen.height;

    let centerTile: Point;
    let zoom: number;
    if (cameraState) {
      centerTile = cameraState.center;
      const b = cameraState.bounds;
      zoom = b
        ? fitZoomForTileBounds(b.minX, b.minY, b.maxX, b.maxY, sw, sh)
        : fitZoomForTileBounds(0, 0, course.width - 1, course.height - 1, sw, sh);
    } else {
      centerTile = { x: course.width / 2, y: course.height / 2 };
      zoom = fitZoomForTileBounds(0, 0, course.width - 1, course.height - 1, sw, sh);
    }

    const centerIso = worldToIso(centerTile.x, centerTile.y, 0, ROTATION);
    world.scale.set(zoom);
    world.position.set(sw / 2 - centerIso.x * zoom, sh / 2 - centerIso.y * zoom);
  }, [cameraState, course.width, course.height]);

  /** Inverse camera transform: global pointer coords → integer tile, or null. */
  const screenToTile = useCallback(
    (globalX: number, globalY: number): { x: number; y: number } | null => {
      const world = layersRef.current?.world;
      if (!world) return null;
      const ix = (globalX - world.position.x) / world.scale.x;
      const iy = (globalY - world.position.y) / world.scale.y;
      const t = isoToTile(ix, iy, ROTATION);
      if (t.x < 0 || t.y < 0 || t.x >= course.width || t.y >= course.height) return null;
      return t;
    },
    [course.width, course.height]
  );

  /** Continuous world tile coords → global screen coords (for screen overlays). */
  const worldPointToScreen = useCallback((wx: number, wy: number): { x: number; y: number } => {
    const world = layersRef.current?.world;
    if (!world) return { x: 0, y: 0 };
    const p = worldToIso(wx, wy, 0, ROTATION);
    return {
      x: world.position.x + p.x * world.scale.x,
      y: world.position.y + p.y * world.scale.y,
    };
  }, []);

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
      liveGraphicsRef.current = null;
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

  // Apply camera whenever it changes
  useEffect(() => {
    if (!appReady) return;
    applyCamera();
    overlayDirtyRef.current = true;
  }, [appReady, applyCamera]);

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

    if (sprites.length !== tileCount) {
      layers.terrain.removeChildren();
      sprites.forEach((s) => s.destroy());
      sprites.length = 0;
      // Row-major insertion is already back-to-front for rotation 0.
      for (let y = 0; y < course.height; y++) {
        for (let x = 0; x < course.width; x++) {
          const sprite = new PIXI.Sprite(diamond);
          sprite.anchor.set(0.5, 0);
          const p = worldToIso(x + 0.5, y, 0, ROTATION); // top corner of tile diamond
          sprite.position.set(p.x, p.y);
          layers.terrain.addChild(sprite);
          sprites.push(sprite);
        }
      }
      devLog(`built ${tileCount} diamond sprites`);
    }

    for (let i = 0; i < tileCount; i++) {
      sprites[i].tint = darken(COLORS[course.tiles[i]], EDGE_DARKEN);
    }
  }, [appReady, course.tiles, course.width, course.height]);

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
      // Ground-anchored at the tile center, standing "up" from the diamond.
      const center = tileCenterIso(obs.x, obs.y, 0, ROTATION);
      sprite.anchor.set(0.5, 1);
      sprite.position.set(center.x, center.y + TILE_H / 2);
      const size = TILE_W * 0.72;
      sprite.width = size;
      sprite.height = size;
      sprite.zIndex = isoDepth(obs.x + 0.5, obs.y + 0.5, 0, ROTATION);
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
  }, [appReady, obstacles, tileSize, props.showObstacles]);

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
      const c = tileCenterIso(p.x, p.y, 0, ROTATION);
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
  }, [appReady, holes, draftTee, draftGreen]);

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
        const top = worldToIso(seg.x + 0.5, seg.y, 0, ROTATION);
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
      const first = tileCenterIso(activePath[0].x, activePath[0].y, 0, ROTATION);
      g.moveTo(first.x, first.y);
      for (let i = 1; i < activePath.length; i++) {
        const p = tileCenterIso(activePath[i].x, activePath[i].y, 0, ROTATION);
        g.lineTo(p.x, p.y);
      }
      g.stroke({ width: 2, color: 0xffffff, alpha: 0.75 });
      g.label = ROUTE_LABEL;
      layers.terrainDecals.addChild(g);
    }
  }, [appReady, showFixOverlay, failingCorridorSegments, showShotPlan, activePath]);

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
    if (!liveGraphicsRef.current) {
      const g = new PIXI.Graphics();
      layers.fx.addChild(g);
      liveGraphicsRef.current = g;
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
            const top = worldToIso(hover.x + 0.5, hover.y, 0, ROTATION);
            highlight.poly([
              top.x, top.y,
              top.x + TILE_W / 2, top.y + TILE_H / 2,
              top.x, top.y + TILE_H,
              top.x - TILE_W / 2, top.y + TILE_H / 2,
            ]);
            highlight.stroke({ width: 2, color: 0xffffff, alpha: 0.9 });
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
              const from = worldPointToScreen(fromPoint.x + 0.5, fromPoint.y + 0.5);
              const to = worldPointToScreen(hover.x + 0.5, hover.y + 0.5);
              line.moveTo(from.x, from.y);
              line.lineTo(to.x, to.y);
              line.stroke({ width: 2, color: 0x6496ff, alpha: 0.6 });
            }
          }
        }
      }

      // Live golfers/balls: cheap dot pass, redrawn every frame while active
      // (character sprites land in M11/ZKU-153).
      const live = liveGraphicsRef.current;
      if (live) {
        live.clear();
        const list = liveActive ? golfersRef?.current : null;
        if (list && list.length > 0) {
          for (const golfer of list) {
            const c = tileCenterIso(golfer.x, golfer.y, 0, ROTATION);
            // shadow
            live.ellipse(c.x, c.y + 3, 7, 3.2);
            live.fill({ color: 0x000000, alpha: 0.2 });
            // body
            live.circle(c.x, c.y - 4, 5.5);
            live.fill(golfer.color);
            const moodHue = Math.round(120 * Math.max(0, Math.min(1, golfer.mood)));
            live.stroke({ width: 1.5, color: `hsl(${moodHue}, 80%, 45%)` });
            // ball in flight
            if (golfer.ballX != null && golfer.ballY != null) {
              const b = tileCenterIso(golfer.ballX, golfer.ballY, 0, ROTATION);
              live.circle(b.x, b.y - 2, 2.2);
              live.fill(0xffffff);
              live.stroke({ width: 0.8, color: 0x555555 });
            }
          }
        }
      }
    };

    app.ticker.add(tick);
    return () => {
      app.ticker.remove(tick);
    };
  }, [appReady, wizardStep, holes, activeHoleIndex, draftTee, worldPointToScreen, golfersRef, liveActive]);

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
