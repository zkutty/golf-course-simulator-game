import { describe, expect, it } from "vitest";
import * as PIXI from "pixi.js";
import type { Terrain } from "../models/types";
import {
  buildLandscapeComponents, sampleLandscapeSurfaceHeight, type VisualHeightfield,
} from "./landscapeGeometry";
import { worldToIso } from "./iso";
import { destroySceneSubtree } from "./destroySceneSubtree";
import { createM27ReleaseReferenceCourse } from "../testing/referenceCourse";
import {
  PARKLAND_COMPOSABLE_SEMANTICS as roles,
  appendParklandComposableUndercoat, appendParklandSemanticFields, appendParklandComposableCues,
  buildParklandComposableMeshGeometry, createParklandComposableMesh,
  type ParklandComposableMeshGeometry,
} from "./parklandComposable";

// Compare ordered Float32 bit patterns, including signed zero; triangle and UV
// order must survive indexing, not merely the union of covered cells.
function expandedBits(data: ParklandComposableMeshGeometry) {
  const expanded = new Float32Array(data.indices.length * 4);
  for (let i = 0; i < data.indices.length; i++) {
    const vertex = data.indices[i];
    expanded.set([data.positions[vertex * 2], data.positions[vertex * 2 + 1],
      data.uvs[vertex * 2], data.uvs[vertex * 2 + 1]], i * 4);
  }
  return new Uint32Array(expanded.buffer);
}
function meshData(mesh: PIXI.Mesh) { return mesh.geometry as PIXI.MeshGeometry; }
const colors = { rough: 1, fairway: 2, deep_rough: 3, green: 4, tee: 5 };
const textures = Object.fromEntries(roles.map(role => [role, PIXI.Texture.EMPTY])) as Record<typeof roles[number], PIXI.Texture>;
function fixture() {
  const width = 20, height = 10;
  const tiles: Terrain[] = Array.from({ length: width * height }, (_, i) => roles[Math.floor(i / width) % roles.length]);
  for (const [i, terrain] of [[21, "water"], [63, "sand"], [105, "path"], [127, "water"]] as const) tiles[i] = terrain;
  const components = buildLandscapeComponents(tiles, width, height);
  const field: VisualHeightfield = { width, height, vertices: Float32Array.from(
    { length: (width + 1) * (height + 1) }, (_, i) => Math.sin(i * 0.37) * 1.7,
  ) };
  return { width, height, components, field };
}

describe("ZK-1259 turf vertex indexing", () => {
  it("pins actual Pixi automatic batching at exactly 100 vertices", () => {
    for (const count of [99, 100, 101]) {
      const geometry = new PIXI.MeshGeometry({ positions: new Float32Array(count * 2), uvs: new Float32Array(count * 2), indices: new Uint32Array([0, 1, 2]) });
      const mesh = new PIXI.Mesh({ geometry, texture: PIXI.Texture.EMPTY });
      expect(mesh.batched).toBe(count <= 100);
      geometry.batchMode = "no-batch"; expect(mesh.batched).toBe(false);
      mesh.destroy(); geometry.destroy();
    }
  });

  it("preserves original small/large transform paths, leaving general reuse callers unchanged", () => {
    for (const [subdivisions, smallCount] of [[1, 25], [2, 6], [4, 1]]) {
      for (const count of [smallCount, smallCount + 1]) {
        const entries = Array.from({ length: count }, (_, i) => i);
        const project = (_entry: number, x: number, y: number) => ({ x, y });
        const old = createParklandComposableMesh(PIXI.Texture.EMPTY, entries, count, subdivisions, entry => entry, project, false)!;
        const indexed = createParklandComposableMesh(PIXI.Texture.EMPTY, entries, count, subdivisions, entry => entry, project, false, true)!;
        const generic = createParklandComposableMesh(PIXI.Texture.EMPTY, entries, count, subdivisions, entry => entry, project, true)!;
        expect(indexed.batched).toBe(old.batched);
        expect(meshData(indexed).positions.length).toBe(count === smallCount ? meshData(old).positions.length : meshData(generic).positions.length);
        expect(meshData(indexed).batchMode).toBe(count === smallCount ? "auto" : "no-batch");
        expect(meshData(generic).batchMode).toBe("auto");
        if (count > smallCount) {
          expect(meshData(indexed).positions.length / 2).toBeLessThanOrEqual(100);
          expect(generic.batched).toBe(true); // Fails if the explicit no-batch protection is lost.
        }
        for (const mesh of [old, indexed, generic]) { const geometry = mesh.geometry; mesh.destroy(); geometry.destroy(); }
      }
    }
  });

  it("preserves every expanded ordered triangle/UV bit for all turf, qualities, rotations, slopes and disconnected components", () => {
    const { width, components, field } = fixture();
    const all = components.filter(component => roles.includes(component.terrain as typeof roles[number]))
      .flatMap(component => component.cells.map(cell => ({ component, cell })));
    // Reversed traversal also checks that shared vertices never reorder triangles.
    const groups = [all, ...roles.map(role => all.filter(entry => entry.component.terrain === role)), [...all].reverse()];
    for (const subdivisions of [1, 2, 4]) for (const rotation of [0, 90, 180, 270] as const) for (const entries of groups) {
      const project = (entry: typeof all[number], x: number, y: number) => worldToIso(x, y, sampleLandscapeSurfaceHeight(field, entry.component, x, y), rotation);
      const old = buildParklandComposableMeshGeometry(entries, width, subdivisions, entry => entry.cell, project, false);
      const mesh = createParklandComposableMesh(PIXI.Texture.EMPTY, entries, width, subdivisions, entry => entry.cell, project, false, true)!;
      const indexed = meshData(mesh);
      expect(expandedBits(indexed)).toEqual(expandedBits(old));
      expect(indexed.indices.length).toBe(old.indices.length);
      expect(indexed.positions.length).toBeLessThan(old.positions.length);
      expect(mesh.batched).toBe(false);
      mesh.destroy(); indexed.destroy();
    }
  });

  it("indexes all three turf emitters with the same draw count and fresh owned geometry/buffers", () => {
    const { width, components, field } = fixture();
    for (const quality of ["low", "medium", "high"] as const) {
      const subdivisions = quality === "high" ? 4 : quality === "medium" ? 2 : 1;
      const layer = new PIXI.Container();
      expect(appendParklandComposableUndercoat(layer, PIXI.Texture.EMPTY, components, width, subdivisions, field, 0, 0xffffff)).toBe(true);
      expect(appendParklandSemanticFields(layer, PIXI.Texture.EMPTY, quality === "low" ? null : textures, quality,
        components, width, subdivisions, field, 0, colors)).toHaveLength(5);
      expect(appendParklandComposableCues(layer, textures, components, width, subdivisions, field, 0, () => 0xffffff)).toHaveLength(5);
      const meshes = layer.children as PIXI.Mesh[];
      expect(meshes).toHaveLength(11);
      expect(new Set(meshes.map(mesh => mesh.geometry)).size).toBe(11);
      expect(new Set(meshes.map(mesh => meshData(mesh).positions.buffer)).size).toBe(11);
      for (const mesh of meshes) {
        expect(mesh.batched).toBe(false);
        expect(meshData(mesh).batchMode).toBe("no-batch");
        // No mesh reduction: every original triangle remains in its original draw.
        const oldVertices = meshData(mesh).indices.length / 6 * 4;
        expect(meshData(mesh).positions.length / 2).toBeLessThan(oldVertices);
      }
      const geometries = meshes.map(mesh => mesh.geometry);
      destroySceneSubtree(layer);
      expect(meshes.every(mesh => mesh.destroyed)).toBe(true);
      expect(PIXI.Texture.EMPTY.destroyed).toBe(false);
      for (const geometry of geometries) geometry.destroy();
    }
  });

  it("reports natural field and cue units from the emitter, without including the undercoat", () => {
    const { width, components, field } = fixture();
    const layer = new PIXI.Container();
    const reported: Array<{ mesh: PIXI.Mesh; subdivisions: number; units: number }> = [];
    const onTileMesh = (mesh: PIXI.Mesh, subdivisions: number, units: number) => {
      reported.push({ mesh, subdivisions, units });
    };
    expect(appendParklandComposableUndercoat(layer, PIXI.Texture.EMPTY,
      components, width, 4, field, 0, 0xffffff)).toBe(true);
    appendParklandSemanticFields(layer, PIXI.Texture.EMPTY, textures, "high",
      components, width, 4, field, 0, colors, onTileMesh);
    appendParklandComposableCues(layer, textures, components, width, 4, field, 0,
      () => 0xffffff, onTileMesh);
    expect(reported).toHaveLength(10);
    expect(reported.every(({ mesh, subdivisions, units }) =>
      layer.children.includes(mesh) && subdivisions === 4
      && units > 0 && mesh.geometry.indices.length === units * 96)).toBe(true);
    expect(reported.some(({ mesh }) => mesh === layer.children[0])).toBe(false);
    const geometries = (layer.children as PIXI.Mesh[]).map(mesh => mesh.geometry);
    destroySceneSubtree(layer);
    for (const geometry of geometries) geometry.destroy();
  });

  it("reduces vertices for the full unchanged M27 turf workload without removing triangles", () => {
    const course = createM27ReleaseReferenceCourse("parkland");
    const cells = course.tiles.flatMap((terrain, cell) => roles.includes(terrain as typeof roles[number]) ? [cell] : []);
    const totals = [];
    for (const [quality, subdivisions] of [["low", 1], ["medium", 2], ["high", 4]] as const) {
      const oldCount = cells.length * 4 * subdivisions * subdivisions;
      const mesh = createParklandComposableMesh(PIXI.Texture.EMPTY, cells, course.width, subdivisions, cell => cell,
        (_cell, x, y) => ({ x, y }), false, true)!;
      const geometry = meshData(mesh);
      expect(geometry.indices.length).toBe(cells.length * 6 * subdivisions * subdivisions);
      expect(geometry.positions.length / 2).toBeLessThan(oldCount * 0.4);
      expect(mesh.batched).toBe(false);
      totals.push({ quality, turfCells: cells.length, unsharedVertices: oldCount, indexedVertices: geometry.positions.length / 2, triangles: geometry.indices.length / 3 });
      mesh.destroy(); geometry.destroy();
    }
    console.info("M27_TURF_VERTEX_COUNTS=" + JSON.stringify(totals));
  });
});
