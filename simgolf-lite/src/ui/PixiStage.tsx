import { useEffect, useRef, useState } from "react";
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
// Convert hex color string to number (e.g., "#4fa64f" -> 0x4fa64f)
function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

function createTerrainTexture(app: PIXI.Application, terrain: Terrain, tileSize: number): PIXI.Texture {
  if (tileSize <= 0) {
    throw new Error(`Invalid tileSize: ${tileSize}`);
  }
  const graphics = new PIXI.Graphics();
  const colorNum = hexToNumber(COLORS[terrain]);
  graphics.rect(0, 0, tileSize, tileSize);
  graphics.fill({ color: colorNum });
  
  const texture = app.renderer.generateTexture(graphics);
  if (!texture) {
    console.warn(`[PixiStage] Failed to generate texture for ${terrain} (size: ${tileSize}, color: ${COLORS[terrain]} = 0x${colorNum.toString(16)})`);
  }
  return texture;
}

const DEBUG_PIXI = true; // Set to false once rendering is confirmed

export function PixiStage(props: PixiStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const appReadyRef = useRef(false); // Track when app is fully initialized
  const [appReady, setAppReady] = useState(false); // State to trigger effect re-runs
  const terrainTexturesRef = useRef<Map<Terrain, PIXI.Texture>>(new Map());
  const tileSpritesRef = useRef<Map<number, PIXI.Sprite>>(new Map());
  const obstacleSpritesRef = useRef<Map<string, PIXI.Sprite>>(new Map());
  const hoverLineRef = useRef<PIXI.Graphics | null>(null);
  const hoverTileRef = useRef<{ x: number; y: number } | null>(null);
  const debugMarkerRef = useRef<PIXI.Graphics | null>(null);
  const terrainContainerRef = useRef<PIXI.Container | null>(null);
  
  // Hover state refs (no React state to avoid high-frequency renders)
  const hoverWorldPosRef = useRef<{ x: number; y: number } | null>(null);
  const isHoveringRef = useRef(false);
  const previewDistanceRef = useRef<number | null>(null);
  
  // Dirty flags for rendering optimization
  const overlayDirtyRef = useRef(false);
  
  // Reusable Graphics objects (don't recreate per frame)
  const overlayGraphicsRef = useRef<PIXI.Graphics | null>(null);

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
      // Wait a tick to ensure container has dimensions
      await new Promise(resolve => setTimeout(resolve, 0));
      
      if (!containerRef.current) return;
      
      const app = new PIXI.Application();
      
      // Get container dimensions - use fallback if not available yet
      const container = containerRef.current;
      const width = Math.max(container.clientWidth || container.offsetWidth || 800, 100);
      const height = Math.max(container.clientHeight || container.offsetHeight || 600, 100);
      
      await app.init({
        width,
        height,
        backgroundColor: 0xf0f0f0,
        antialias: false,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });

      if (!containerRef.current) {
        app.destroy(true, { children: true, texture: true });
        return;
      }
      
      // Ensure canvas has proper styling
      app.canvas.style.display = "block";
      app.canvas.style.width = "100%";
      app.canvas.style.height = "100%";
      app.canvas.style.position = "absolute";
      app.canvas.style.top = "0";
      app.canvas.style.left = "0";
      
      containerRef.current.appendChild(app.canvas);
      
      // Create a container for terrain (makes it easier to manage)
      const terrainContainer = new PIXI.Container();
      terrainContainer.x = 0;
      terrainContainer.y = 0;
      app.stage.addChild(terrainContainer);
      terrainContainerRef.current = terrainContainer;
      
      console.log(`[PixiStage] Initialized Pixi app: ${width}x${height}, tileSize: ${tileSize}`);
      console.log(`[PixiStage] Canvas element:`, {
        width: app.canvas.width,
        height: app.canvas.height,
        clientWidth: app.canvas.clientWidth,
        clientHeight: app.canvas.clientHeight,
        style: app.canvas.style.cssText,
      });

      // Generate terrain textures (only if tileSize is valid)
      if (tileSize > 0) {
        const textures = new Map<Terrain, PIXI.Texture>();
        for (const terrain of Object.keys(COLORS) as Terrain[]) {
          try {
            const texture = createTerrainTexture(app, terrain, tileSize);
            textures.set(terrain, texture);
          } catch (err) {
            console.error(`[PixiStage] Failed to create texture for ${terrain}:`, err);
          }
        }
        terrainTexturesRef.current = textures;
        console.log(`[PixiStage] Generated ${textures.size} terrain textures`);
      } else {
        console.warn(`[PixiStage] Skipping texture generation: tileSize is ${tileSize}`);
      }

      // Add debug marker (bright red rectangle at 0,0)
      if (DEBUG_PIXI) {
        const debugMarker = new PIXI.Graphics();
        debugMarker.rect(0, 0, 50, 50);
        debugMarker.fill({ color: 0xff0000 });
        debugMarker.alpha = 0.8;
        app.stage.addChild(debugMarker);
        debugMarkerRef.current = debugMarker;
        console.log(`[PixiStage] Added debug marker at (0,0) size 50x50`);
      }

      appRef.current = app;
      appReadyRef.current = true;
      setAppReady(true); // Trigger terrain rendering effect
      
      // Initial render
      app.render();
      
      console.log(`[PixiStage] App ready, terrain render should trigger`);
    };

    initApp();

    return () => {
      appReadyRef.current = false;
      setAppReady(false);
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: true });
        appRef.current = null;
        terrainContainerRef.current = null;
        debugMarkerRef.current = null;
        // Clear textures and sprites when app is destroyed
        terrainTexturesRef.current.clear();
        tileSpritesRef.current.forEach((sprite) => sprite.destroy());
        tileSpritesRef.current.clear();
      }
    };
  }, []); // Only run once on mount, not on tileSize changes
  
  // Regenerate textures when tileSize changes (if app already exists)
  useEffect(() => {
    if (!appRef.current || tileSize <= 0) return;
    
    // Regenerate textures with new tileSize
    const textures = new Map<Terrain, PIXI.Texture>();
    for (const terrain of Object.keys(COLORS) as Terrain[]) {
      try {
        const texture = createTerrainTexture(appRef.current!, terrain, tileSize);
        textures.set(terrain, texture);
      } catch (err) {
        console.error(`[PixiStage] Failed to regenerate texture for ${terrain}:`, err);
      }
    }
    terrainTexturesRef.current = textures;
    console.log(`[PixiStage] Regenerated ${textures.size} terrain textures for tileSize: ${tileSize}`);
  }, [tileSize]);
  
  // Handle resize with ResizeObserver
  useEffect(() => {
    if (!appRef.current || !containerRef.current) return;
    
    const resize = () => {
      if (!appRef.current || !containerRef.current) return;
      const width = Math.max(containerRef.current.clientWidth || containerRef.current.offsetWidth || 100, 100);
      const height = Math.max(containerRef.current.clientHeight || containerRef.current.offsetHeight || 100, 100);
      appRef.current.renderer.resize(width, height);
      // Re-render after resize
      appRef.current.render();
    };
    
    // Use ResizeObserver for better dimension tracking
    const ro = new ResizeObserver(() => {
      resize();
    });
    ro.observe(containerRef.current);
    
    // Also listen to window resize
    window.addEventListener("resize", resize);
    resize(); // Initial resize
    
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);

  // Render terrain tiles
  useEffect(() => {
    // Wait for app to be ready
    if (!appRef.current || !appReadyRef.current) {
      console.log("[PixiStage] App not ready yet, skipping terrain render");
      return;
    }
    if (!terrainContainerRef.current) {
      console.log("[PixiStage] Terrain container not ready, skipping terrain render");
      return;
    }
    if (tileSize <= 0) {
      console.log(`[PixiStage] Invalid tileSize: ${tileSize}, skipping terrain render`);
      return;
    }
    
    const app = appRef.current;
    const terrainContainer = terrainContainerRef.current;
    
    if (terrainTexturesRef.current.size === 0) {
      console.log("[PixiStage] No textures available, attempting to generate on-demand...");
      // Try to generate textures now if app exists and tileSize is valid
      const textures = new Map<Terrain, PIXI.Texture>();
      for (const terrain of Object.keys(COLORS) as Terrain[]) {
        try {
          const texture = createTerrainTexture(app, terrain, tileSize);
          textures.set(terrain, texture);
        } catch (err) {
          console.error(`[PixiStage] Failed to create texture for ${terrain}:`, err);
        }
      }
      terrainTexturesRef.current = textures;
      console.log(`[PixiStage] Generated ${textures.size} terrain textures on-demand`);
    }
    const textures = terrainTexturesRef.current;

    // Clear existing sprites from container
    terrainContainer.removeChildren();
    tileSpritesRef.current.forEach((sprite) => sprite.destroy());
    tileSpritesRef.current.clear();

    // Create sprites for each tile
    let spriteCount = 0;
    const maxX = course.width * tileSize;
    const maxY = course.height * tileSize;
    
    for (let y = 0; y < course.height; y++) {
      for (let x = 0; x < course.width; x++) {
        const idx = y * course.width + x;
        const terrain = course.tiles[idx];
        const texture = textures.get(terrain);
        if (!texture) {
          console.warn(`[PixiStage] No texture for terrain: ${terrain} at (${x}, ${y})`);
          continue;
        }

        const sprite = new PIXI.Sprite(texture);
        sprite.x = x * tileSize;
        sprite.y = y * tileSize;
        sprite.width = tileSize;
        sprite.height = tileSize;
        sprite.visible = true; // Explicitly set visibility
        sprite.alpha = 1.0; // Ensure full opacity
        
        terrainContainer.addChild(sprite);
        tileSpritesRef.current.set(idx, sprite);
        spriteCount++;
      }
    }
    
    console.log(`[PixiStage] Created ${spriteCount} terrain sprites (course: ${course.width}x${course.height}, tileSize: ${tileSize})`);
    console.log(`[PixiStage] Terrain bounds: (0,0) to (${maxX},${maxY}), container position: (${terrainContainer.x},${terrainContainer.y}), scale: (${terrainContainer.scale.x},${terrainContainer.scale.y})`);
    
    // Trigger render after adding all sprites
    app.render();
  }, [course.tiles, course.width, course.height, tileSize, appReady]);

  // Render obstacles
  useEffect(() => {
    if (!appRef.current || !appReadyRef.current || !props.showObstacles) return;
    if (!terrainContainerRef.current) return;

    // Clear existing obstacle sprites
    obstacleSpritesRef.current.forEach((sprite) => sprite.destroy());
    obstacleSpritesRef.current.clear();

    const terrainContainer = terrainContainerRef.current;

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
        
        terrainContainer.addChild(sprite);
        obstacleSpritesRef.current.set(key, sprite);
        appRef.current.render();
      } else if (spriteOrPromise instanceof Promise) {
        spriteOrPromise.then((img: HTMLImageElement) => {
          if (!appRef.current || !terrainContainerRef.current) return;
          const texture = PIXI.Texture.from(img);
          const sprite = new PIXI.Sprite(texture);
          sprite.x = obs.x * tileSize;
          sprite.y = obs.y * tileSize;
          sprite.width = tileSize;
          sprite.height = tileSize;
          
          terrainContainerRef.current!.addChild(sprite);
          obstacleSpritesRef.current.set(key, sprite);
          appRef.current!.render();
        });
      }
    });
  }, [obstacles, tileSize, props.showObstacles]);

  // Render markers (tee/green)
  useEffect(() => {
    if (!appRef.current || !appReadyRef.current) return;
    if (!terrainContainerRef.current) return;
    
    const app = appRef.current;
    const terrainContainer = terrainContainerRef.current;

    // Remove existing markers (marked with _isMarker flag)
    const toRemove: any[] = [];
    terrainContainer.children.forEach((child) => {
      if ((child as any)._isMarker) {
        toRemove.push(child);
      }
    });
    toRemove.forEach((child) => {
      if (child instanceof PIXI.Graphics) {
        child.destroy();
      }
      terrainContainer.removeChild(child);
    });

    // Draw markers
    holes.forEach((hole) => {
      if (hole.tee) {
        const graphics = new PIXI.Graphics();
        graphics.circle(hole.tee.x * tileSize + tileSize / 2, hole.tee.y * tileSize + tileSize / 2, tileSize * 0.2);
        graphics.fill(0x000000);
        graphics.stroke({ width: 2, color: 0xffffff });
        terrainContainer.addChild(graphics);
        (graphics as any)._isMarker = true;
      }
      if (hole.green) {
        const graphics = new PIXI.Graphics();
        graphics.circle(hole.green.x * tileSize + tileSize / 2, hole.green.y * tileSize + tileSize / 2, tileSize * 0.2);
        graphics.fill(0x1b5e20);
        graphics.stroke({ width: 2, color: 0xffffff });
        terrainContainer.addChild(graphics);
        (graphics as any)._isMarker = true;
      }
    });
    
    app.render();
  }, [holes, tileSize]);

  // Set up PIXI ticker for consolidated rendering (only one ticker loop per app)
  useEffect(() => {
    if (!appRef.current || !appReadyRef.current) return;
    const app = appRef.current;
    
    // Create reusable overlay graphics if not exists
    if (!overlayGraphicsRef.current) {
      overlayGraphicsRef.current = new PIXI.Graphics();
      app.stage.addChild(overlayGraphicsRef.current);
    }
    if (!hoverLineRef.current) {
      hoverLineRef.current = new PIXI.Graphics();
      app.stage.addChild(hoverLineRef.current);
    }
    
    // Use app's ticker (ensures only one ticker loop per app instance)
    const updateOverlay = () => {
      if (!overlayDirtyRef.current) return;
      
      const line = hoverLineRef.current;
      if (line) {
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
          }
        }
      }
      
      overlayDirtyRef.current = false;
    };
    
    // Add to app's ticker (PIXI apps automatically render on ticker updates)
    app.ticker.add(updateOverlay);
    
    return () => {
      app.ticker.remove(updateOverlay);
    };
  }, [wizardStep, holes, activeHoleIndex, draftTee, tileSize]);

  // Handle click events
  useEffect(() => {
    if (!appRef.current || !appReadyRef.current) return;
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
        hoverWorldPosRef.current = { x, y };
        isHoveringRef.current = true;
        
        // Calculate preview distance if needed
        const isGreenPlacement = wizardStep === "GREEN" || wizardStep === "MOVE_GREEN";
        if (isGreenPlacement) {
          const hole = holes[activeHoleIndex];
          const fromPoint = hole?.tee || draftTee;
          if (fromPoint) {
            const dx = x - fromPoint.x;
            const dy = y - fromPoint.y;
            previewDistanceRef.current = Math.sqrt(dx * dx + dy * dy) * course.yardsPerTile;
          } else {
            previewDistanceRef.current = null;
          }
        } else {
          previewDistanceRef.current = null;
        }
        
        // Mark overlay dirty instead of rendering immediately
        if (prevHover?.x !== x || prevHover?.y !== y) {
          overlayDirtyRef.current = true;
          
          // Update cursor style (lightweight, no render needed)
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
        hoverWorldPosRef.current = null;
        isHoveringRef.current = false;
        previewDistanceRef.current = null;
        // Mark overlay dirty to clear hover visuals
        overlayDirtyRef.current = true;
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

  return (
    <div 
      ref={containerRef} 
      style={{ 
        width: "100%", 
        height: "100%", 
        position: "relative",
        overflow: "hidden"
      }} 
    />
  );
}
