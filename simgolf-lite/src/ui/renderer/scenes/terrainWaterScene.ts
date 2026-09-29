import * as PIXI from "pixi.js";
import { visibleGroundCoverTier } from "../../../game/render/groundCover";
import type { RenderSnapshot } from "../RenderSnapshot";

function shade(color: number, factor: number): number {
  const channel = (shift: number) => (color >> shift) & 0xff;
  if (factor <= 1) {
    return (Math.round(channel(16) * factor) << 16)
      | (Math.round(channel(8) * factor) << 8)
      | Math.round(channel(0) * factor);
  }
  const amount = Math.min(1, factor - 1);
  const lighten = (value: number) => Math.round(value + (255 - value) * amount);
  return (lighten(channel(16)) << 16) | (lighten(channel(8)) << 8) | lighten(channel(0));
}

export interface TerrainWaterSprite {
  sprite: PIXI.Sprite | PIXI.Mesh;
  baseTint: number;
  phase: number;
  gx: number;
  gy: number;
}

export interface TerrainWaterChunk {
  container: PIXI.Container;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  waterSprites: TerrainWaterSprite[];
  foamSprites: Array<{ sprite: PIXI.Sprite; phase: number }>;
  groundCoverSprites: Array<{ display: PIXI.Container; tier: 1 | 2 }>;
}

export interface TerrainWaterLayers {
  surround: PIXI.Container;
  terrain: PIXI.Container;
  smoothSurfaces: PIXI.Container;
  estateSeam: PIXI.Container;
}

export interface TerrainCullViewport {
  rotation: number;
  pivotX: number;
  pivotY: number;
  scale: number;
  screenWidth: number;
  screenHeight: number;
  graphicsQuality: "high" | "medium" | "low";
  resolutionScale: number;
}

export interface TerrainWaterSceneDiagnostics {
  revision: number;
  surroundRebuilds: number;
  chunkRebuilds: number;
  connectedRebuilds: number;
  chunksTotal: number;
  chunksVisible: number;
  chunkWaterSprites: number;
  chunkFoamSprites: number;
  joinedWaterSprites: number;
  generatedTextures: number;
  borrowedTextures: number;
}

type TerrainWaterPhase = "surround" | "terrain" | "connected";
type TerrainWaterRenderer = (snapshot: RenderSnapshot) => void | (() => void);

type DestroyableTexture = Pick<PIXI.Texture, "destroy" | "destroyed">;

/**
 * One owner for terrain, connected surfaces, scenic surround and water.
 * PixiStage retains the stable containers and compositing order; this system
 * owns every mutable resource installed into those containers.
 */
export class TerrainWaterSceneSystem {
  readonly id = "terrainWater" as const;
  readonly layers: TerrainWaterLayers;

  diamondTexture: PIXI.Texture | null = null;
  chunks: TerrainWaterChunk[] = [];
  surfaceWaterSprites: TerrainWaterSprite[] = [];
  previousTiles: readonly string[] | null = null;
  previousCareVisualSignatures: readonly string[] | null = null;
  previousElevations: readonly number[] | null = null;
  builtRotation: number | null = null;
  builtSeasonalTerrainSignature: string | null = null;
  builtAtlasGeneration: number | null = null;
  lowPresentationLayer: PIXI.Container | null = null;
  readonly landscapeMaterialTextures = new Map<string, PIXI.Texture>();

  private revision: number | null = null;
  private surroundRebuilds = 0;
  private chunkRebuilds = 0;
  private connectedRebuilds = 0;
  private renderers = new Map<TerrainWaterPhase, TerrainWaterRenderer>();
  private phaseCleanups = new Map<TerrainWaterPhase, () => void>();
  private waterAnimation = { last: 0, wasAnimating: false };
  private generatedTextures = new Set<DestroyableTexture>();
  private borrowedTextures = new Set<DestroyableTexture>();
  private releasedTextures = new WeakSet<object>();
  private destroyed = false;

  constructor(layers: TerrainWaterLayers) {
    this.layers = layers;
  }

  /**
   * PixiStage supplies the projection/material algorithms, but only this
   * scene lifecycle is allowed to invoke them. Re-registering a closure after
   * an unrelated React render does not rebuild or release scene resources.
   */
  setRenderer(phase: TerrainWaterPhase, renderer: TerrainWaterRenderer): void {
    if (this.destroyed) throw new Error("Cannot configure a destroyed terrain/water scene.");
    this.renderers.set(phase, renderer);
  }

  create(snapshot: RenderSnapshot): void {
    this.rebuild(snapshot);
  }

  update(snapshot: RenderSnapshot): void {
    this.rebuild(snapshot);
  }

  private rebuild(snapshot: RenderSnapshot): void {
    const revision = snapshot.revisions.terrainWater;
    if (revision === undefined) throw new Error("Terrain/water snapshot revision is required.");
    if (!this.syncRevision(revision)) return;
    for (const phase of ["surround", "terrain", "connected"] as const) {
      const renderer = this.renderers.get(phase);
      if (!renderer) throw new Error(`Terrain/water ${phase} renderer is not configured.`);
      this.phaseCleanups.get(phase)?.();
      this.phaseCleanups.delete(phase);
      const cleanup = renderer(snapshot);
      if (cleanup) this.phaseCleanups.set(phase, cleanup);
      if (phase === "surround") this.surroundRebuilds++;
      else if (phase === "connected") this.connectedRebuilds++;
    }
  }

  syncRevision(revision: number): boolean {
    if (this.destroyed) throw new Error("Terrain/water scene is destroyed.");
    if (this.revision === revision) return false;
    this.revision = revision;
    return true;
  }

  ownGeneratedTexture<T extends PIXI.Texture>(texture: T): T {
    if (this.destroyed) throw new Error("Cannot register a generated texture after terrain teardown.");
    this.generatedTextures.add(texture);
    return texture;
  }

  borrowTexture<T extends PIXI.Texture>(texture: T): T {
    if (this.destroyed) throw new Error("Cannot register a borrowed texture after terrain teardown.");
    this.borrowedTextures.add(texture);
    return texture;
  }

  releaseGeneratedTexture(texture: DestroyableTexture | null | undefined): void {
    if (!texture || !this.generatedTextures.delete(texture)) return;
    if (this.releasedTextures.has(texture as object)) return;
    this.releasedTextures.add(texture as object);
    if (!texture.destroyed) texture.destroy(true);
  }

  markChunkRebuild(): void { this.chunkRebuilds++; }

  cull(viewport: TerrainCullViewport): number {
    if (viewport.rotation !== 0) {
      for (const chunk of this.chunks) chunk.container.visible = true;
      return this.chunks.length;
    }
    const halfW = viewport.screenWidth / 2 / viewport.scale;
    const halfH = viewport.screenHeight / 2 / viewport.scale;
    const left = viewport.pivotX - halfW;
    const right = viewport.pivotX + halfW;
    const top = viewport.pivotY - halfH;
    const bottom = viewport.pivotY + halfH;
    const requestedTier = visibleGroundCoverTier(viewport.scale, viewport.resolutionScale);
    const coverTier = viewport.graphicsQuality === "high"
      ? requestedTier
      : viewport.graphicsQuality === "medium"
        ? Math.min(1, requestedTier) as 0 | 1
        : 0;
    let visible = 0;
    for (const chunk of this.chunks) {
      const inView = chunk.maxX >= left && chunk.minX <= right
        && chunk.maxY >= top && chunk.minY <= bottom;
      chunk.container.visible = inView;
      for (const cover of chunk.groundCoverSprites) {
        cover.display.visible = inView && cover.tier <= coverTier;
      }
      if (inView) visible++;
    }
    return visible;
  }

  tickWater(nowMs: number, enabled: boolean): void {
    if (enabled) {
      if (nowMs - this.waterAnimation.last <= 140) return;
      this.waterAnimation.last = nowMs;
      this.waterAnimation.wasAnimating = true;
      const time = nowMs / 1000;
      const bucket = Math.floor(nowMs / 700);
      for (const chunk of this.chunks) {
        if (!chunk.container.visible) continue;
        for (const water of chunk.waterSprites) {
          let factor = 1 + 0.05 * Math.sin(time * 1.6 + water.phase);
          if ((water.gx * 31 + water.gy * 57 + bucket) % 89 === 0) factor = 1.22;
          water.sprite.tint = shade(water.baseTint, factor);
        }
        for (const foam of chunk.foamSprites) {
          foam.sprite.alpha = 0.16 + 0.14 * (0.5 + 0.5 * Math.sin(time * 2.1 + foam.phase));
        }
      }
      for (const water of this.surfaceWaterSprites) {
        let factor = 1 + 0.05 * Math.sin(time * 1.6 + water.phase);
        if ((water.gx * 31 + water.gy * 57 + bucket) % 89 === 0) factor = 1.22;
        water.sprite.tint = shade(water.baseTint, factor);
      }
      return;
    }
    if (!this.waterAnimation.wasAnimating) return;
    this.waterAnimation.wasAnimating = false;
    for (const chunk of this.chunks) {
      for (const water of chunk.waterSprites) water.sprite.tint = water.baseTint;
      for (const foam of chunk.foamSprites) foam.sprite.alpha = 0.26;
    }
    for (const water of this.surfaceWaterSprites) water.sprite.tint = water.baseTint;
  }

  diagnostics(): TerrainWaterSceneDiagnostics {
    return {
      revision: this.revision ?? 0,
      surroundRebuilds: this.surroundRebuilds,
      chunkRebuilds: this.chunkRebuilds,
      connectedRebuilds: this.connectedRebuilds,
      chunksTotal: this.chunks.length,
      chunksVisible: this.chunks.filter((chunk) => chunk.container.visible).length,
      chunkWaterSprites: this.chunks.reduce((total, chunk) => total + chunk.waterSprites.length, 0),
      chunkFoamSprites: this.chunks.reduce((total, chunk) => total + chunk.foamSprites.length, 0),
      joinedWaterSprites: this.surfaceWaterSprites.length,
      generatedTextures: this.generatedTextures.size,
      borrowedTextures: this.borrowedTextures.size,
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const cleanup of this.phaseCleanups.values()) cleanup();
    this.phaseCleanups.clear();
    this.renderers.clear();
    for (const layer of Object.values(this.layers)) {
      layer.removeChildren().forEach((child: { destroy(options?: { children?: boolean }): void }) => child.destroy({ children: true }));
    }
    this.chunks = [];
    this.surfaceWaterSprites = [];
    this.lowPresentationLayer = null;
    this.landscapeMaterialTextures.clear();
    for (const texture of [...this.generatedTextures]) this.releaseGeneratedTexture(texture);
    this.generatedTextures.clear();
    // Borrowed atlas textures outlive the scene and are released only by the
    // atlas residency owner. Deliberately drop references without destroy().
    this.borrowedTextures.clear();
    this.diamondTexture = null;
  }
}

export function createTerrainWaterSceneSystem(layers: TerrainWaterLayers): TerrainWaterSceneSystem {
  return new TerrainWaterSceneSystem(layers);
}
