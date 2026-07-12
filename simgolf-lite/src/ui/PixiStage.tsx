import { useCallback, useEffect, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import type { Course, Hole, Obstacle, Point, Terrain } from "../game/models/types";
import type { ShotPlanStep } from "../game/sim/shots/solveShotsToGreen";
import type { CameraState } from "../game/render/camera";
import { getObstacleSprite } from "../render/iconSprites";
import { computeTerrainChangeCost } from "../game/models/terrainEconomics";

/**
 * PixiStage — the WebGL renderer for the course (ZKU-138).
 *
 * Layer architecture (draw order back → front):
 *
 *   stage
 *   ├─ world                ← camera transform (pan/zoom) is applied HERE and
 *   │  │                      nowhere else; all world-space content lives below
 *   │  ├─ terrain           ← one sprite per tile (chunked in ZKU-142)
 *   │  ├─ terrainDecals     ← tee/green markers, path & corridor overlays
 *   │  ├─ objects           ← obstacles, golfers, ball, props (y-sorted via zIndex)
 *   │  └─ fx                ← transient effects (particles, highlights)
 *   └─ screenOverlay        ← screen-space UI (wizard hover distance line);
 *                             does NOT move with the camera
 *
 * Input: pointer events are mapped screen → world through the inverse camera
 * transform (screenToTile), so painting/placement stays exact at any pan/zoom.
 * The projection is still flat top-down; ZKU-139 swaps it to isometric.
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

const MARKER_LABEL = "hole-marker";

// Dev-only logging, quiet by default (ZKU-85 convention). Flip locally when
// debugging renderer lifecycle.
const DEV_LOG = false;
function devLog(...args: unknown[]) {
  if (import.meta.env.DEV && DEV_LOG) console.log("[PixiStage]", ...args);
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
}

interface Layers {
  world: PIXI.Container;
  terrain: PIXI.Container;
  terrainDecals: PIXI.Container;
  objects: PIXI.Container;
  fx: PIXI.Container;
  screenOverlay: PIXI.Container;
}

export function PixiStage(props: PixiStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const layersRef = useRef<Layers | null>(null);
  const [appReady, setAppReady] = useState(false);

  const tileSpritesRef = useRef<PIXI.Sprite[]>([]);
  const obstacleSpritesRef = useRef<Map<string, PIXI.Sprite>>(new Map());
  const hoverLineRef = useRef<PIXI.Graphics | null>(null);
  const hoverTileRef = useRef<{ x: number; y: number } | null>(null);
  const overlayDirtyRef = useRef(false);

  const {
    course,
    holes,
    obstacles,
    activeHoleIndex,
    tileSize,
    onClickTile,
    selectedTerrain,
    worldCash,
    editorMode,
    wizardStep,
    draftTee,
    cameraState,
  } = props;

  // ---------------------------------------------------------------------
  // Camera: world container transform + screen↔world mapping
  // ---------------------------------------------------------------------

  const applyCamera = useCallback(() => {
    const app = appRef.current;
    const layers = layersRef.current;
    if (!app || !layers) return;
    const { world } = layers;
    if (cameraState) {
      const zoom = cameraState.zoom;
      world.scale.set(zoom);
      world.position.set(
        app.screen.width / 2 - cameraState.center.x * tileSize * zoom,
        app.screen.height / 2 - cameraState.center.y * tileSize * zoom
      );
    } else {
      world.scale.set(1);
      world.position.set(0, 0);
    }
  }, [cameraState, tileSize]);

  /** Inverse camera transform: global pointer coords → world tile coords. */
  const screenToTile = useCallback(
    (globalX: number, globalY: number): { x: number; y: number } | null => {
      const layers = layersRef.current;
      if (!layers) return null;
      const { world } = layers;
      const wx = (globalX - world.position.x) / (tileSize * world.scale.x);
      const wy = (globalY - world.position.y) / (tileSize * world.scale.y);
      const x = Math.floor(wx);
      const y = Math.floor(wy);
      if (x < 0 || y < 0 || x >= course.width || y >= course.height) return null;
      return { x, y };
    },
    [tileSize, course.width, course.height]
  );

  /** World tile-space point → global screen coords (for screen overlays). */
  const tileToScreen = useCallback(
    (tx: number, ty: number): { x: number; y: number } => {
      const layers = layersRef.current;
      const world = layers?.world;
      if (!world) return { x: 0, y: 0 };
      return {
        x: world.position.x + tx * tileSize * world.scale.x,
        y: world.position.y + ty * tileSize * world.scale.y,
      };
    },
    [tileSize]
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
        backgroundColor: 0xf0f0f0,
        antialias: false,
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

      // Reliable pointer events across the whole canvas, not just sprites.
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
    const app = appRef.current;
    if (!container || !app) return;

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
  // Terrain layer — flat tinted tiles (Texture.WHITE, no texture generation)
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!appReady) return;
    const layers = layersRef.current;
    if (!layers || tileSize <= 0) return;

    const tileCount = course.width * course.height;
    const sprites = tileSpritesRef.current;

    // (Re)build sprite pool only when the count changes; otherwise update in place.
    if (sprites.length !== tileCount) {
      layers.terrain.removeChildren();
      sprites.forEach((s) => s.destroy());
      sprites.length = 0;
      for (let i = 0; i < tileCount; i++) {
        const sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
        layers.terrain.addChild(sprite);
        sprites.push(sprite);
      }
      devLog(`built ${tileCount} tile sprites`);
    }

    for (let y = 0; y < course.height; y++) {
      for (let x = 0; x < course.width; x++) {
        const idx = y * course.width + x;
        const sprite = sprites[idx];
        sprite.tint = COLORS[course.tiles[idx]];
        sprite.position.set(x * tileSize, y * tileSize);
        sprite.width = tileSize;
        sprite.height = tileSize;
      }
    }
  }, [appReady, course.tiles, course.width, course.height, tileSize]);

  // ---------------------------------------------------------------------
  // Objects layer — obstacles (y-sorted)
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!appReady) return;
    const layers = layersRef.current;
    if (!layers) return;

    // Clear previous obstacle sprites
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
      sprite.position.set(obs.x * tileSize, obs.y * tileSize);
      sprite.width = tileSize;
      sprite.height = tileSize;
      sprite.zIndex = obs.y; // y-sort within the objects layer
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
  // Decals layer — tee/green markers
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

    const drawMarker = (p: Point, fill: number) => {
      const g = new PIXI.Graphics();
      g.circle(p.x * tileSize + tileSize / 2, p.y * tileSize + tileSize / 2, tileSize * 0.2);
      g.fill(fill);
      g.stroke({ width: 2, color: 0xffffff });
      g.label = MARKER_LABEL;
      layers.terrainDecals.addChild(g);
    };

    holes.forEach((hole) => {
      if (hole.tee) drawMarker(hole.tee, 0x000000);
      if (hole.green) drawMarker(hole.green, 0x1b5e20);
    });
  }, [appReady, holes, tileSize]);

  // ---------------------------------------------------------------------
  // Screen overlay — wizard hover distance line (ticker-driven, dirty-flagged)
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!appReady) return;
    const app = appRef.current;
    const layers = layersRef.current;
    if (!app || !layers) return;

    if (!hoverLineRef.current) {
      const line = new PIXI.Graphics();
      layers.screenOverlay.addChild(line);
      hoverLineRef.current = line;
    }

    const updateOverlay = () => {
      if (!overlayDirtyRef.current) return;
      overlayDirtyRef.current = false;
      const line = hoverLineRef.current;
      if (!line) return;
      line.clear();

      const isGreenPlacement = wizardStep === "GREEN" || wizardStep === "MOVE_GREEN";
      const hover = hoverTileRef.current;
      if (isGreenPlacement && hover) {
        const hole = holes[activeHoleIndex];
        const fromPoint = hole?.tee || draftTee;
        if (fromPoint) {
          const from = tileToScreen(fromPoint.x + 0.5, fromPoint.y + 0.5);
          const to = tileToScreen(hover.x + 0.5, hover.y + 0.5);
          line.moveTo(from.x, from.y);
          line.lineTo(to.x, to.y);
          line.stroke({ width: 2, color: 0x6496ff, alpha: 0.6 });
        }
      }
    };

    app.ticker.add(updateOverlay);
    return () => {
      app.ticker.remove(updateOverlay);
    };
  }, [appReady, wizardStep, holes, activeHoleIndex, draftTee, tileToScreen]);

  // ---------------------------------------------------------------------
  // Input — pointer events through the inverse camera transform
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!appReady) return;
    const app = appRef.current;
    if (!app) return;

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
