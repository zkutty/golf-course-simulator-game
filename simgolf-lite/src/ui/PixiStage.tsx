import { useEffect, useRef } from "react";
import * as PIXI from "pixi.js";
import type { Course, Hole, Obstacle, Point, Terrain } from "../game/models/types";
import type { ShotPlanStep } from "../game/sim/shots/solveShotsToGreen";
import type { CameraState } from "../game/render/camera";
import { getObstacleSprite } from "../render/iconSprites";
import { computeTerrainChangeCost } from "../game/models/terrainEconomics";

const COLORS: Record<Terrain, string> = {
  fairway: "#4fa64f",
  rough: "#2f7a36",
  deep_rough: "#1f5f2c",
  sand: "#d7c48a",
  water: "#2b7bbb",
  green: "#5dbb6a",
  tee: "#8b6b4f",
  path: "#8f8f8f",
};

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

/**
 * Generate a simple colored texture for a terrain type
 */
function createTerrainTexture(app: PIXI.Application, terrain: Terrain, tileSize: number): PIXI.Texture {
  const graphics = new PIXI.Graphics();
  graphics.rect(0, 0, tileSize, tileSize);
  graphics.fill(COLORS[terrain]);
  
  return app.renderer.generateTexture(graphics);
}

export function PixiStage(props: PixiStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const terrainTexturesRef = useRef<Map<Terrain, PIXI.Texture>>(new Map());
  const tileSpritesRef = useRef<Map<number, PIXI.Sprite>>(new Map());
  const obstacleSpritesRef = useRef<Map<string, PIXI.Sprite>>(new Map());
  const hoverLineRef = useRef<PIXI.Graphics | null>(null);
  const hoverTileRef = useRef<{ x: number; y: number } | null>(null);

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
  } = props;

  // Initialize PixiJS application
  useEffect(() => {
    if (!containerRef.current) return;

    const initApp = async () => {
      const app = new PIXI.Application();
      
      await app.init({
        width: containerRef.current!.clientWidth,
        height: containerRef.current!.clientHeight,
        backgroundColor: 0xf0f0f0,
        antialias: false,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });

      if (!containerRef.current) {
        app.destroy(true, { children: true, texture: true });
        return;
      }
      
      containerRef.current.appendChild(app.canvas);

      // Generate terrain textures
      const textures = new Map<Terrain, PIXI.Texture>();
      for (const terrain of Object.keys(COLORS) as Terrain[]) {
        textures.set(terrain, createTerrainTexture(app, terrain, tileSize));
      }
      terrainTexturesRef.current = textures;

      appRef.current = app;
    };

    initApp();

    return () => {
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: true });
        appRef.current = null;
      }
    };
  }, [tileSize]);

  // Handle resize
  useEffect(() => {
    if (!appRef.current || !containerRef.current) return;
    const resize = () => {
      if (!appRef.current || !containerRef.current) return;
      appRef.current.renderer.resize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    window.addEventListener("resize", resize);
    resize();
    return () => window.removeEventListener("resize", resize);
  }, []);

  // Render terrain tiles
  useEffect(() => {
    if (!appRef.current || terrainTexturesRef.current.size === 0) return;
    const app = appRef.current;
    const textures = terrainTexturesRef.current;

    // Clear existing sprites
    tileSpritesRef.current.forEach((sprite) => sprite.destroy());
    tileSpritesRef.current.clear();

    // Create sprites for each tile
    for (let y = 0; y < course.height; y++) {
      for (let x = 0; x < course.width; x++) {
        const idx = y * course.width + x;
        const terrain = course.tiles[idx];
        const texture = textures.get(terrain);
        if (!texture) continue;

        const sprite = new PIXI.Sprite(texture);
        sprite.x = x * tileSize;
        sprite.y = y * tileSize;
        sprite.width = tileSize;
        sprite.height = tileSize;
        
        app.stage.addChild(sprite);
        tileSpritesRef.current.set(idx, sprite);
      }
    }
  }, [course.tiles, course.width, course.height, tileSize]);

  // Render obstacles
  useEffect(() => {
    if (!appRef.current || !props.showObstacles) return;

    // Clear existing obstacle sprites
    obstacleSpritesRef.current.forEach((sprite) => sprite.destroy());
    obstacleSpritesRef.current.clear();

    // Load obstacle textures and create sprites
    obstacles.forEach((obs) => {
      const key = `${obs.x},${obs.y}`;
      const spriteOrPromise = getObstacleSprite(obs.type, tileSize);
      
      if (spriteOrPromise instanceof HTMLImageElement) {
        if (!appRef.current) return;
        const texture = PIXI.Texture.from(spriteOrPromise);
        const sprite = new PIXI.Sprite(texture);
        sprite.x = obs.x * tileSize;
        sprite.y = obs.y * tileSize;
        sprite.width = tileSize;
        sprite.height = tileSize;
        
        appRef.current.stage.addChild(sprite);
        obstacleSpritesRef.current.set(key, sprite);
      } else if (spriteOrPromise instanceof Promise) {
        spriteOrPromise.then((img: HTMLImageElement) => {
          if (!appRef.current) return;
          const texture = PIXI.Texture.from(img);
          const sprite = new PIXI.Sprite(texture);
          sprite.x = obs.x * tileSize;
          sprite.y = obs.y * tileSize;
          sprite.width = tileSize;
          sprite.height = tileSize;
          
          appRef.current!.stage.addChild(sprite);
          obstacleSpritesRef.current.set(key, sprite);
        });
      }
    });
  }, [obstacles, tileSize, props.showObstacles]);

  // Render markers (tee/green)
  useEffect(() => {
    if (!appRef.current) return;
    const app = appRef.current;

    // Remove existing markers (marked with _isMarker flag)
    const toRemove: any[] = [];
    app.stage.children.forEach((child) => {
      if ((child as any)._isMarker) {
        toRemove.push(child);
      }
    });
    toRemove.forEach((child) => {
      if (child instanceof PIXI.Graphics) {
        child.destroy();
      }
      app.stage.removeChild(child);
    });

    // Draw markers
    holes.forEach((hole) => {
      if (hole.tee) {
        const graphics = new PIXI.Graphics();
        graphics.circle(hole.tee.x * tileSize + tileSize / 2, hole.tee.y * tileSize + tileSize / 2, tileSize * 0.2);
        graphics.fill(0x000000);
        graphics.stroke({ width: 2, color: 0xffffff });
        app.stage.addChild(graphics);
        (graphics as any)._isMarker = true;
      }
      if (hole.green) {
        const graphics = new PIXI.Graphics();
        graphics.circle(hole.green.x * tileSize + tileSize / 2, hole.green.y * tileSize + tileSize / 2, tileSize * 0.2);
        graphics.fill(0x1b5e20);
        graphics.stroke({ width: 2, color: 0xffffff });
        app.stage.addChild(graphics);
        (graphics as any)._isMarker = true;
      }
    });
  }, [holes, tileSize]);

  // Handle hover line overlay
  useEffect(() => {
    if (!appRef.current) return;
    const app = appRef.current;

    if (!hoverLineRef.current) {
      hoverLineRef.current = new PIXI.Graphics();
      app.stage.addChild(hoverLineRef.current);
    }

    const line = hoverLineRef.current;
    line.clear();

    // Draw hover line for distance preview (placement mode)
    const isGreenPlacement = wizardStep === "GREEN" || wizardStep === "MOVE_GREEN";
    if (isGreenPlacement && hoverTileRef.current) {
      const hole = holes[activeHoleIndex];
      const fromPoint = hole?.tee || draftTee;
      if (fromPoint) {
        line.moveTo(fromPoint.x * tileSize + tileSize / 2, fromPoint.y * tileSize + tileSize / 2);
        line.lineTo(hoverTileRef.current.x * tileSize + tileSize / 2, hoverTileRef.current.y * tileSize + tileSize / 2);
        line.stroke({ width: 2, color: 0x6496ff, alpha: 0.6 });
        app.render();
      }
    }
  }, [wizardStep, holes, activeHoleIndex, draftTee, tileSize]);

  // Handle click events
  useEffect(() => {
    if (!appRef.current) return;
    const app = appRef.current;

    const handleClick = (e: PIXI.FederatedPointerEvent) => {
      const x = Math.floor(e.global.x / tileSize);
      const y = Math.floor(e.global.y / tileSize);
      
      if (x >= 0 && y >= 0 && x < course.width && y < course.height) {
        onClickTile(x, y);
      }
    };

    const handleMove = (e: PIXI.FederatedPointerEvent) => {
      const x = Math.floor(e.global.x / tileSize);
      const y = Math.floor(e.global.y / tileSize);
      
      if (x >= 0 && y >= 0 && x < course.width && y < course.height) {
        const prevHover = hoverTileRef.current;
        hoverTileRef.current = { x, y };
        
        // Trigger hover line update if placement mode and hover changed
        if ((prevHover?.x !== x || prevHover?.y !== y) && appRef.current) {
          const app = appRef.current;
          // Update hover line inline
          if (!hoverLineRef.current) {
            hoverLineRef.current = new PIXI.Graphics();
            app.stage.addChild(hoverLineRef.current);
          }
          const line = hoverLineRef.current;
          line.clear();
          const isGreenPlacement = wizardStep === "GREEN" || wizardStep === "MOVE_GREEN";
          if (isGreenPlacement) {
            const hole = holes[activeHoleIndex];
            const fromPoint = hole?.tee || draftTee;
            if (fromPoint) {
              line.moveTo(fromPoint.x * tileSize + tileSize / 2, fromPoint.y * tileSize + tileSize / 2);
              line.lineTo(x * tileSize + tileSize / 2, y * tileSize + tileSize / 2);
              line.stroke({ width: 2, color: 0x6496ff, alpha: 0.6 });
              app.render();
            }
          }
          
          // Force cursor update by updating container style
          if (containerRef.current) {
            const cursor = editorMode === "PAINT" && selectedTerrain && worldCash !== undefined
              ? (() => {
                  const idx = y * course.width + x;
                  const prev = course.tiles[idx];
                  const cost = computeTerrainChangeCost(prev, selectedTerrain);
                  return cost.net > 0 && worldCash < cost.net ? "not-allowed" : "crosshair";
                })()
              : "crosshair";
            containerRef.current.style.cursor = cursor;
          }
        }
      } else {
        hoverTileRef.current = null;
      }
    };

    app.stage.eventMode = "static";
    app.stage.on("pointerdown", handleClick);
    app.stage.on("pointermove", handleMove);

    return () => {
      app.stage.off("pointerdown", handleClick);
      app.stage.off("pointermove", handleMove);
    };
  }, [onClickTile, tileSize, course.width, course.height, course.tiles, editorMode, selectedTerrain, worldCash, wizardStep, holes, activeHoleIndex, draftTee]);

  // Update cursor style - triggered on hover change
  useEffect(() => {
    if (!containerRef.current) return;
    
    const cursor = (() => {
      if (editorMode === "PAINT" && selectedTerrain && worldCash !== undefined) {
        const hover = hoverTileRef.current;
        if (hover) {
          const idx = hover.y * course.width + hover.x;
          const prev = course.tiles[idx];
          const cost = computeTerrainChangeCost(prev, selectedTerrain);
          return cost.net > 0 && worldCash < cost.net ? "not-allowed" : "crosshair";
        }
      }
      return "crosshair";
    })();
    
    containerRef.current.style.cursor = cursor;
  }, [editorMode, selectedTerrain, worldCash, course.tiles, course.width]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
