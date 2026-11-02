import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as PIXI from "pixi.js";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import type { Terrain } from "../models/types";
import { buildLandscapeComponents, type VisualHeightfield } from "./landscapeGeometry";
import { destroySceneSubtree } from "./destroySceneSubtree";
import {
  PARKLAND_COMPOSABLE_SEMANTICS as roles,
  PARKLAND_MATERIAL_FIELD_SOURCE_HASHES as hashes,
  appendParklandComposablePresentation,
  appendParklandComposableUndercoat,
  appendParklandSemanticFields,
  canOmitParklandUndercoat,
  createParklandComposableTrace,
  resolveParklandComposableSources,
  resolveParklandSemanticFieldSources,
  type ParklandSemanticFieldSources,
} from "./parklandComposable";

const colors = { fairway: 1, rough: 2, deep_rough: 3, green: 4, tee: 5 };
function fields(quality: "high" | "medium") {
  return Object.fromEntries(roles.map(role => {
    const label = `/atlases/biomes/field-parkland-${quality}-${role}.${hashes[quality][role].slice(0, 12)}.png`;
    return [role, new PIXI.Texture({ source: new PIXI.TextureSource({ width: 512, height: 512, label }) })];
  })) as ParklandSemanticFieldSources<PIXI.Texture>;
}
function fixture(width = 20, height = 10) {
  const tiles: Terrain[] = Array.from({ length: width * height }, (_, i) => roles[Math.floor(i / width) % roles.length]);
  // Missing turf, disconnected pieces and hazards exercise the union, not its bounding rectangle.
  if (tiles.length > 100) for (const [i, terrain] of [[21, "water"], [63, "sand"], [105, "path"]] as const) tiles[i] = terrain;
  const components = buildLandscapeComponents(tiles, width, height);
  const heightfield: VisualHeightfield = { width, height, vertices: Float32Array.from(
    { length: (width + 1) * (height + 1) }, (_, i) => Math.sin(i * 0.27) * 0.7,
  ) };
  return { tiles, components, heightfield, course: { width, height, elevations: Array(width * height).fill(0), buildings: [] } };
}
function triangles(meshes: readonly PIXI.Mesh[]) {
  return meshes.flatMap(mesh => {
    const geometry = mesh.geometry as PIXI.MeshGeometry;
    const output: string[] = [];
    for (let i = 0; i < geometry.indices.length; i += 3) {
      output.push(Array.from(geometry.indices.slice(i, i + 3)).flatMap(index => [
        geometry.positions[index * 2], geometry.positions[index * 2 + 1],
        geometry.uvs[index * 2], geometry.uvs[index * 2 + 1],
      ]).join(","));
    }
    return output;
  }).sort();
}
function draw(quality: "high" | "medium" | "low", textures: ParklandSemanticFieldSources<PIXI.Texture> | null, small = false) {
  const data = fixture(small ? 1 : 20, small ? 1 : 10);
  const layer = new PIXI.Container();
  const sources = resolveParklandComposableSources("parkland", quality, () => PIXI.Texture.EMPTY)!;
  const trace = createParklandComposableTrace("parkland", quality);
  appendParklandComposablePresentation(layer, sources, textures, data.components, data.course, data.tiles, data.tiles,
    quality === "high" ? 4 : 2, data.heightfield, 0, true, colors, trace);
  return { layer, diagnostics: trace.diagnostics(0) };
}

describe("ZK-1259 redundant opaque undercoat", () => {
  it("certifies all deployed field bytes and every alpha sample", () => {
    for (const quality of ["high", "medium"] as const) for (const role of roles) {
      const filename = `field-parkland-${quality}-${role}.${hashes[quality][role].slice(0, 12)}.png`;
      const bytes = readFileSync(`public/atlases/biomes/${filename}`);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(hashes[quality][role]);
      const png = PNG.sync.read(bytes);
      let nonOpaque = 0;
      for (let i = 3; i < png.data.length; i += 4) if (png.data[i] !== 255) nonOpaque++;
      expect(nonOpaque).toBe(0);
    }
  });

  it("matches every Float32 projected triangle and UV, including holes and slopes, in four rotations", () => {
    const data = fixture();
    for (const quality of ["high", "medium"] as const) for (const rotation of [0, 90, 180, 270] as const) {
      const backing = new PIXI.Container();
      const semantic = new PIXI.Container();
      const textures = fields(quality);
      const subdivisions = quality === "high" ? 4 : 2;
      appendParklandComposableUndercoat(backing, PIXI.Texture.EMPTY, data.components, data.course.width, subdivisions,
        data.heightfield, rotation, 0xffffff);
      appendParklandSemanticFields(semantic, PIXI.Texture.EMPTY, textures, quality, data.components, data.course.width,
        subdivisions, data.heightfield, rotation, colors);
      expect(triangles(semantic.children as PIXI.Mesh[])).toEqual(triangles(backing.children as PIXI.Mesh[]));
      expect(canOmitParklandUndercoat(semantic, quality, textures, semantic.children as PIXI.Mesh[])).toBe(true);
      destroySceneSubtree(backing); destroySceneSubtree(semantic);
      for (const texture of Object.values(textures)) { expect(texture.destroyed).toBe(false); texture.destroy(true); }
    }
  });

  it("omits only the opaque backing draw and reports the loaded source separately", () => {
    for (const quality of ["high", "medium"] as const) {
      const textures = fields(quality);
      const result = draw(quality, textures);
      expect(result.layer.children.some(child => child.label === "parkland-common-phase:undercoat")).toBe(false);
      expect(result.diagnostics).toMatchObject({ undercoatDraws: 0, undercoatSourceLoaded: true, semanticFieldDraws: 5 });
      destroySceneSubtree(result.layer);
      for (const texture of Object.values(textures)) {
        expect(texture.destroyed).toBe(false); expect(texture.source.destroyed).toBe(false); texture.destroy(true);
      }
      expect(PIXI.Texture.EMPTY.destroyed).toBe(false);
    }
  });

  it("retains the backing, before fields, for Low, incomplete/unknown/cropped fields and small batched meshes", () => {
    const textures = fields("high");
    const unknown = fields("high"); unknown.rough.source.label = "/unverified/rough.png";
    const cropped = fields("high"); cropped.rough.frame.width--;
    for (const [quality, input, small] of [
      ["low", null, false], ["high", null, false], ["high", unknown, false], ["high", cropped, false], ["high", textures, true],
    ] as const) {
      const result = draw(quality, input, small);
      const container = quality === "low" ? result.layer.children[0] : result.layer;
      expect(container.children[0].label).toBe("parkland-common-phase:undercoat");
      expect(result.diagnostics).toMatchObject({ undercoatDraws: 1, undercoatSourceLoaded: true });
      destroySceneSubtree(result.layer);
    }
    expect(resolveParklandSemanticFieldSources("high", true, false, role => role === "tee" ? null : textures[role])).toBeNull();
    expect(resolveParklandSemanticFieldSources("high", false, false, role => textures[role])).toBeNull();
    expect(resolveParklandSemanticFieldSources("high", true, true, role => textures[role])).toBeNull();
    for (const input of [textures, unknown, cropped]) for (const texture of Object.values(input)) texture.destroy(true);
  });

  it("fails closed on inherited alpha, filters, masks, blend and destroyed fields", () => {
    const textures = fields("high");
    const data = fixture(); const parent = new PIXI.Container(); const layer = new PIXI.Container(); parent.addChild(layer);
    appendParklandSemanticFields(layer, PIXI.Texture.EMPTY, textures, "high", data.components, data.course.width, 4, data.heightfield, 0, colors);
    const allowed = () => canOmitParklandUndercoat(layer, "high", textures, layer.children as PIXI.Mesh[]);
    expect(allowed()).toBe(true);
    parent.alpha = 0.9; expect(allowed()).toBe(false); parent.alpha = 1;
    parent.blendMode = "add"; expect(allowed()).toBe(false); parent.blendMode = "normal";
    const mask = new PIXI.Graphics(); parent.mask = mask; expect(allowed()).toBe(false); parent.mask = null;
    parent.filters = [{} as PIXI.Filter]; expect(allowed()).toBe(false); parent.filters = null;
    textures.tee.destroy(); expect(allowed()).toBe(false);
    destroySceneSubtree(parent); mask.destroy();
    for (const texture of Object.values(textures)) if (!texture.destroyed) texture.destroy(true);
  });
});
