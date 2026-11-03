import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { getBiomeDefinition } from "../../../game/models/biomes";
import type { Terrain } from "../../../game/models/types";
import { hazardChunkUnderlay } from "../../../game/render/hazardDepth";
import { TILE_H, TILE_W, worldToIso } from "../../../game/render/iso";
import { maintainedChunkUnderlay } from "../../../game/render/landscapeGeometry";
import { isMaintained } from "../../../game/render/materialFields";
import { terrainSurfaceInsetPx } from "../../../game/render/terrainRelief";
import { getTerrainMaterial, pickTerrainBaseFrame } from "../../../game/render/terrainMaterials";
import { pathUnderlayForRenderer, type PathMaterialScenePlan } from "./pathMaterialScene";

// Execute the actual production dispatch fragments without mounting React,
// creating a GPU renderer, or rebuilding G. The fake owners record material
// selection; coordinator screenshots cover actual pixels and projection.
const source = readFileSync(new URL("../../PixiStage.tsx", import.meta.url), "utf8");
function fragment(begin: string, end: string): string {
  const start = source.indexOf(begin), finish = source.indexOf(end, start);
  if (start < 0 || finish < start) throw new Error("Production terrain dispatch boundary changed");
  return source.slice(start, finish);
}
const nativeDispatch = fragment("        const underlayTerrain = hazardChunkUnderlay(", "        if (!joinedMaintainedTop && props.terrainPatterns");
const lowDispatch = fragment('    if (quality === "low" && !composableActive) {', "    const bandLayer = new PIXI.Container();");
const parsed = ts.createSourceFile("PixiStage.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const tintHelpers = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && ["darken", "shade"].includes(node.name?.text ?? ""))
  .map((node) => node.getText(parsed)).join("\n");
function execute(body: string, scope: Record<string, unknown>): void {
  const code = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function(...Object.keys(scope), code)(...Object.values(scope));
}
class Container {
  children: unknown[] = [];
  addChild(...children: unknown[]) { this.children.push(...children); return children[0]; }
}
class Sprite {
  texture: unknown;
  tint = 0xffffff;
  width = 0;
  height = 0;
  anchorValues: number[] = [];
  positionValues: number[] = [];
  anchor = { set: (...values: number[]) => { this.anchorValues = values; } };
  position = { set: (...values: number[]) => { this.positionValues = values; } };
  constructor(texture: unknown) { this.texture = texture; }
}
function renderUnderlay(theme: "links" | "desert", withPath: boolean, seasonal: boolean) {
  const tiles: Terrain[] = Array(16).fill("rough");
  if (withPath) { tiles[5] = "path"; tiles[6] = "path"; }
  const original = [...tiles];
  const plan: PathMaterialScenePlan = {
    mode: "continuous", key: "accepted-fixture", quality: "low", roles: ["shoulder", "edge", "core"], textureRoles: [], layers: [],
    underlayTiles: Array(16).fill("rough"), underlay: withPath ? [{ terrain: "rough", cells: [5, 6] }] : [],
    suppressWholeCellPaths: true, componentCount: 1, triangleCount: 0, widths: { minimum: .6, maximum: .6 },
  };
  const presentation = pathUnderlayForRenderer(tiles, plan);
  const chunk = { container: new Container() }, layer = new Container(), terrain = new Container(), pathLayer = new Container();
  const scope = {
    PIXI: { Container, Sprite }, course: { theme, width: 4, height: 4 }, w: 4, x: 1, y: 1,
    terrain: presentation[5], lowJoinedMaintainedTopReady: true, composableTurfOwnsTransitions: false,
    hazardChunkUnderlay, maintainedChunkUnderlay, getTerrainMaterial, pickTerrainBaseFrame, isMaintained,
    elev: () => 0, worldToIso, terrainSurfaceInsetPx, rotation: 0,
    mowingQualityAt: () => 1, mowingShadeAt: () => 1, holeAxes: [],
    seasonalByTerrain: { rough: seasonal ? { color: 0x897654, textureTint: 0xe1d2c3 } : null },
    THEMED_COLORS: { rough: getBiomeDefinition(theme).presentation.tileTints.rough }, EDGE_DARKEN: .88,
    props: { graphicsQuality: "low", colorVision: "standard" }, TILE_W, TILE_H, diamond: { frame: "fallback" }, chunk,
    getTerrainFrame: (biome: string, quality: string, frame: string) => ({ biome, quality, frame }),
    terrainScene: { borrowTexture: (texture: unknown) => texture, lowPresentationLayer: null },
    quality: "low", composableActive: false, rendererLayers: { terrain }, components: [],
    componentDepth: () => 0, heightfield: {}, project: (point: unknown) => point,
    sampleLandscapeSurfaceHeight: () => 0,
    composableRuntime: { createParklandComposableMesh: (texture: unknown, cells: unknown) => ({ texture, cells }) },
    textureFor: (surface: string) => ({ owner: "procedural", theme, surface }), pathScenePlan: plan,
    layer, pathMaterialLayer: pathLayer, sharedContourDiagnosticsRef: { current: null }, EMPTY_SHARED_CONTOUR_DIAGNOSTICS: {},
    stampAtlasGeneration: () => undefined, atlasRevision: 1, recordM35Metric: () => undefined, rebuildStartedAt: performance.now(),
  };
  execute(`${tintHelpers}\n${nativeDispatch}`, scope);
  execute(lowDispatch, scope);
  const sprite = chunk.container.children[0] as Sprite;
  return { native: { texture: sprite.texture, tint: sprite.tint, width: sprite.width, height: sprite.height,
    anchor: sprite.anchorValues, position: sprite.positionValues },
  extraWholeCellOwners: (terrain.children[0] as Container).children,
  pathLayerInstalled: layer.children.includes(pathLayer), tiles, original };
}

describe("Low path underlay material ownership", () => {
  it.each([
    ["links", false], ["links", true], ["desert", false], ["desert", true],
  ] as const)("uses exactly the ordinary %s rough material and no additional path-cell coat (seasonal=%s)", (theme, seasonal) => {
    const ordinary = renderUnderlay(theme, false, seasonal), path = renderUnderlay(theme, true, seasonal);
    expect(path.native).toEqual(ordinary.native);
    expect(path.native.texture).toEqual({ biome: theme, quality: "low", frame: pickTerrainBaseFrame(getTerrainMaterial(theme, "rough"), 1, 1) });
    expect(path.extraWholeCellOwners).toEqual(ordinary.extraWholeCellOwners);
    expect(path.extraWholeCellOwners).toEqual([]);
    expect(path.pathLayerInstalled).toBe(true);
    expect(path.tiles).toEqual(path.original);
  });
});
