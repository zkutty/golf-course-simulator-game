import { createHash } from "node:crypto";
import { Buffer as NodeBuffer } from "node:buffer";
import * as PIXI from "pixi.js";
import { describe, expect, it } from "vitest";
import type { Terrain } from "../models/types";
import { buildLandscapeComponents, buildVisualHeightfield, createLandscapeComponentCache,
  sampleLandscapeSurfaceHeight, type LandscapeComponent, type VisualHeightfield } from "./landscapeGeometry";
import { destroySceneSubtree } from "./destroySceneSubtree";
import { normalizeCourseLayouts } from "../models/courseLayouts";
import { courseWithEffectiveSurfaces } from "../conditions/surfaceCare";
import { buildTerrainPresentationMap } from "./terrainPresentationPolicy";
import { isoDepth } from "./iso";
import { OrderedMeshBoundsCohort } from "./orderedMeshBounds";
import { hasOwnedHighTurfFanRegistration } from "./guardedTurfFan";
import { createM27ReleaseReferenceCourse } from "../testing/referenceCourse";
import {
  PARKLAND_COMPOSABLE_SEMANTICS as roles, PARKLAND_MATERIAL_FIELD_SOURCE_HASHES as hashes,
  appendParklandComposablePresentation, createParklandComposableTrace, resolveParklandComposableSources,
  type ParklandSemanticFieldSources,
} from "./parklandComposable";

const colors = { fairway: 1, rough: 2, deep_rough: 3, green: 4, tee: 5 };
function fields(quality: "high" | "medium") {
  return Object.fromEntries(roles.map(role => [role, new PIXI.Texture({ source: new PIXI.TextureSource({
    width: 512, height: 512,
    label: `/atlases/biomes/field-parkland-${quality}-${role}.${hashes[quality][role].slice(0, 12)}.png`,
  }) })])) as ParklandSemanticFieldSources<PIXI.Texture>;
}
function fixture(empty = false) {
  const width = 20, height = 10;
  const tiles: Terrain[] = Array.from({ length: width * height }, (_, i) => empty ? "water" : roles[Math.floor(i / width) % 5]);
  return dataFromCourse({ width, height, tiles, elevations: Array(width * height).fill(0), buildings: [] });
}
function dataFromCourse(course: { width: number; height: number; tiles: readonly Terrain[]; elevations: readonly number[]; buildings: [] | ReturnType<typeof createM27ReleaseReferenceCourse>["buildings"] }) {
  const components = buildLandscapeComponents(course.tiles, course.width, course.height);
  const heightfield: VisualHeightfield = { width: course.width, height: course.height,
    vertices: Float32Array.from({ length: (course.width + 1) * (course.height + 1) }, (_, i) => Math.sin(i * 0.27) * 0.7) };
  return { course, components, heightfield, tiles: course.tiles, authoritativeTiles: course.tiles };
}
function append(layer: PIXI.Container, data: ReturnType<typeof fixture>, quality: "high" | "medium",
  textures: ParklandSemanticFieldSources<PIXI.Texture>, shared: boolean, rotation: 0 | 90 | 180 | 270 = 0,
  callback?: (mesh: PIXI.Mesh, subdivisions: number, units: number) => void) {
  const trace = createParklandComposableTrace("parkland", quality);
  const sources = resolveParklandComposableSources("parkland", quality, () => PIXI.Texture.EMPTY)!;
  appendParklandComposablePresentation(layer, sources, textures, data.components, data.course, data.tiles, data.authoritativeTiles,
    quality === "high" ? 4 : 2, data.heightfield, rotation, true, colors, trace, callback,
    shared ? { sharePairedFieldCueAttributes: true, guardedHighTurfFan: true } : { reusePairedFieldCueGeometry: true, guardedHighTurfFan: true });
  return trace.diagnostics(0);
}
function digest(data: Float32Array | Uint32Array) {
  return createHash("sha256").update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).digest("hex");
}
function snapshot(mesh: PIXI.Mesh) {
  const g = mesh.geometry as PIXI.MeshGeometry;
  return { positions: digest(g.positions), uvs: digest(g.uvs), indices: digest(g.indices),
    byteLengths: [g.positions.byteLength, g.uvs.byteLength, g.indices.byteLength],
    batchMode: g.batchMode, batched: mesh.batched, label: mesh.label, tint: mesh.tint,
    alpha: mesh.alpha, blendMode: mesh.blendMode, eventMode: mesh.eventMode, texture: mesh.texture };
}
function paired(layer: PIXI.Container, role: typeof roles[number]) {
  const meshes = layer.children as PIXI.Mesh[];
  return [meshes.find(mesh => mesh.label === `parkland-authoritative-material-field:${role}`)!,
    meshes.find(mesh => mesh.label === `parkland-common-phase:semantic:${role}`)!] as const;
}
function cleanup(layer: PIXI.Container) {
  const geometries = (layer.children as PIXI.Mesh[]).map(mesh => mesh.geometry);
  destroySceneSubtree(layer);
  for (const geometry of geometries) if (geometry.buffers) geometry.destroy(true);
}

describe("internal paired turf attribute sharing", () => {
  it("preserves every byte, draw/style, callback order/arity and final geometry through all qualities and rotations", () => {
    for (const quality of ["high", "medium"] as const) for (const rotation of [0, 90, 180, 270] as const) {
      const data = fixture(), textures = fields(quality), baseline = new PIXI.Container(), shared = new PIXI.Container();
      const calls: Array<{ label: string; arity: number; subdivisions: number; units: number; owned: boolean }> = [];
      const published = new Map<PIXI.Mesh, PIXI.Geometry>();
      const expected: typeof calls = [];
      const callback = (log: typeof calls, capture: boolean) => (...args: [PIXI.Mesh, number, number]) => {
        const [mesh, subdivisions, units] = args;
        log.push({ label: mesh.label, arity: args.length, subdivisions, units,
          owned: hasOwnedHighTurfFanRegistration(mesh) });
        if (capture) published.set(mesh, mesh.geometry);
      };
      try {
        const original = append(baseline, data, quality, textures, false, rotation, callback(expected, false));
        expect(append(shared, data, quality, textures, true, rotation, callback(calls, true))).toEqual(original);
        expect(calls).toEqual(expected); expect(calls).toHaveLength(10);
        expect(calls.slice(0, 5).map(call => call.label)).toEqual(roles.map(role => `parkland-authoritative-material-field:${role}`));
        expect((shared.children as PIXI.Mesh[]).map(snapshot)).toEqual((baseline.children as PIXI.Mesh[]).map(snapshot));
        for (const [mesh, geometry] of published) expect(mesh.geometry).toBe(geometry);
        for (const role of roles) {
          const [field, cue] = paired(shared, role);
          expect(field.geometry).not.toBe(cue.geometry);
          for (const name of ["aPosition", "aUV"]) {
            expect(field.geometry.getBuffer(name)).toBe(cue.geometry.getBuffer(name));
            expect(field.geometry.getBuffer(name).uid).toBe(cue.geometry.getBuffer(name).uid);
          }
          expect(field.geometry.indexBuffer).not.toBe(cue.geometry.indexBuffer);
          expect(field.geometry.indices).not.toBe(cue.geometry.indices);
        }
      } finally { cleanup(baseline); cleanup(shared); Object.values(textures).forEach(texture => texture.destroy(true)); }
    }
  });

  it("admits final paired geometries to the real cohort, keeps index selection independent and releases peers exactly once", () => {
    const layer = new PIXI.Container(), textures = fields("high"), cohort = new OrderedMeshBoundsCohort();
    try {
      append(layer, fixture(), "high", textures, true, 0, (mesh, subdivisions, units) => {
        expect(cohort.registerTurf(mesh, subdivisions, units)).toBe(true);
      });
      for (const role of roles) {
        const [field, cue] = paired(layer, role), g = field.geometry as PIXI.MeshGeometry;
        const cueIndices = cue.geometry.indices, shared = g.getBuffer("aPosition");
        g.indices = g.indices.slice(0, 96);
        expect(cue.geometry.indices).toBe(cueIndices);
        g.destroy(true); g.destroy(true); field.destroy();
        expect(shared.destroyed).toBe(false); expect(shared.listenerCount("update")).toBe(1);
        expect(cue.getBounds().width).toBeGreaterThan(0);
      }
      expect(() => cohort.dispose()).not.toThrow();
      cleanup(layer); cleanup(layer);
      Object.values(textures).forEach(texture => expect(texture.destroyed).toBe(false));
    } finally { cohort.dispose(); cleanup(layer); Object.values(textures).forEach(texture => texture.destroy(true)); }
  });

  it("retires staged peers on undercoat fallback while keeping field owners and the original cue builder alive", () => {
    const data = fixture(), textures = fields("high"), layer = new PIXI.Container();
    textures.rough.source.label = "/unknown/rough.png";
    try {
      append(layer, data, "high", textures, true);
      expect(layer.children[0].label).toBe("parkland-common-phase:undercoat");
      for (const role of roles) {
        const [field, cue] = paired(layer, role);
        expect(field.geometry.getBuffer("aPosition")).not.toBe(cue.geometry.getBuffer("aPosition"));
        expect(field.geometry.getBuffer("aPosition").listenerCount("update")).toBe(1);
        expect(digest((field.geometry as PIXI.MeshGeometry).positions)).toBe(digest((cue.geometry as PIXI.MeshGeometry).positions));
      }
    } finally { cleanup(layer); Object.values(textures).forEach(texture => texture.destroy(true)); }
  });

  for (const failAt of [1, 3, 7]) it(`retires unpublished peers when callback ${failAt} throws, preserving published layer ownership`, () => {
    const layer = new PIXI.Container(), textures = fields("high");
    let callbacks = 0;
    try {
      expect(() => append(layer, fixture(), "high", textures, true, 0, () => {
        if (++callbacks === failAt) throw new Error("injected callback failure");
      })).toThrow("injected callback failure");
      expect(layer.children).toHaveLength(failAt);
      for (const mesh of layer.children as PIXI.Mesh[]) {
        const buffer = mesh.geometry.getBuffer("aPosition");
        const peers = (layer.children as PIXI.Mesh[]).filter(peer => peer.geometry.getBuffer("aPosition") === buffer);
        expect(buffer.destroyed).toBe(false);
        expect(buffer.listenerCount("update")).toBe(peers.length);
      }
      const buffers = (layer.children as PIXI.Mesh[]).flatMap(mesh => mesh.geometry.buffers);
      cleanup(layer); cleanup(layer);
      for (const buffer of buffers) expect(buffer.destroyed).toBe(true);
      Object.values(textures).forEach(texture => expect(texture.destroyed).toBe(false));
    } finally { cleanup(layer); Object.values(textures).forEach(texture => texture.destroy(true)); }
  });

  it("creates no peer buffers for an empty turf workload", () => {
    const layer = new PIXI.Container(), textures = fields("high");
    try { append(layer, fixture(true), "high", textures, true); expect(layer.children).toHaveLength(0); }
    finally { cleanup(layer); Object.values(textures).forEach(texture => texture.destroy(true)); }
  });

  it("reports full unchanged M27 pair bytes/hashes and unique attribute ownership for root source acceptance", () => {
    const course = normalizeCourseLayouts(createM27ReleaseReferenceCourse("parkland"));
    const heightfield = buildVisualHeightfield(course), effective = courseWithEffectiveSurfaces(course).tiles;
    const presentation = buildTerrainPresentationMap(effective, course.width, course.height, course.theme).presentationTiles;
    const cache = createLandscapeComponentCache(), options = { cornerRadius: .4, cornerSegments: 4 };
    cache.update(effective, course.width, course.height, options);
    const components = cache.update(presentation, course.width, course.height, options).components;
    const depths = new Map<LandscapeComponent, number>();
    const depth = (component: LandscapeComponent) => {
      if (depths.has(component)) return depths.get(component)!;
      let total = 0, samples = 0;
      const step = Math.max(1, Math.floor(component.cells.length / 64));
      for (let cursor = 0; cursor < component.cells.length; cursor += step) {
        const index = component.cells[cursor], x = index % course.width, y = Math.floor(index / course.width);
        total += isoDepth(x + .5, y + .5, sampleLandscapeSurfaceHeight(heightfield, component, x + .5, y + .5), 0);
        samples++;
      }
      const value = total / Math.max(1, samples); depths.set(component, value); return value;
    };
    const sorted = [...components].sort((a, b) => depth(a) - depth(b));
    const data = { course, heightfield, components: sorted, tiles: presentation, authoritativeTiles: effective };
    const textures = fields("high"), baseline = new PIXI.Container(), shared = new PIXI.Container();
    try {
      append(baseline, data, "high", textures, false); append(shared, data, "high", textures, true);
      expect((shared.children as PIXI.Mesh[]).map(snapshot)).toEqual((baseline.children as PIXI.Mesh[]).map(snapshot));
      const originalMeshes = baseline.children as PIXI.Mesh[], candidateMeshes = shared.children as PIXI.Mesh[];
      candidateMeshes.forEach((mesh, slot) => {
        const original = originalMeshes[slot].geometry as PIXI.MeshGeometry;
        const candidate = mesh.geometry as PIXI.MeshGeometry;
        for (const key of ["positions", "uvs", "indices"] as const) {
          const a = original[key], b = candidate[key];
          expect(NodeBuffer.from(a.buffer, a.byteOffset, a.byteLength)
            .equals(NodeBuffer.from(b.buffer, b.byteOffset, b.byteLength))).toBe(true);
        }
      });
      const expected = [
        [10116, "85eed6cce5972707a9ed90d766af7aafbdcba25e481f2aec06881fc02f760584", "611fbd3a36c329681fb7cd204c63d4fde992355733485a61a7499dcfa758a3b2", "d982c2ad8aa96b243cd73dcea4db4a1f36d43e6c5ee1762eb0a3c4656a746c9d"],
        [19105, "2b8dce78db2ed11b1973a4bcef163113c0cad914dcb803a8a73fdfe87542831d", "c4a8b351784ef088e2b0214f9075125e578bee5dd32390f723fc4414f80439bf", "3efbf0f81518949d0ae19e4d7960996ecbf85a2d082bee9b2172787734cf3f6e"],
        [40, "2ac882af1e8ad456689dbff145f8d5fe87c17c695347ee50f1963434fc354e90", "d94ce6d4fd7994f2243228f08dbde091f1443a58061dfc52f04938a1658cffcc", "2899ae3b4fbf312a3446bdf053608e607422521fd22f19b03ea29e09a4b431a0"],
        [324, "07eba866ac18b5140fef34cb85091a42163c4fa52540a28ae39920901fd6b515", "111e8a92ac14243a1d5fb14f3ca8066616e4ff961aac248a8fb5b46c84afe4f5", "00e61109275f3ebe09c67344a0e4adcd4aadc6a20a3968775578c10ef0460b39"],
        [36, "5c6538890104daabd6770cbffd4352cb2475c437489c43b9767cc330f8d78132", "5d14e1c9897dccef1521a0dee593ba4422b347e56d111b037e01cc92471cc99b", "1fd8196b970d54cf2de6cea373001a4140a0090bf562d96aa76a4396e60b657e"],
      ] as const;
      let duplicateAttributeBytes = 0;
      const counts = roles.map((role, slot) => {
        const [field, cue] = paired(shared, role), g = field.geometry as PIXI.MeshGeometry;
        expect(g.getBuffer("aPosition")).toBe(cue.geometry.getBuffer("aPosition"));
        expect(g.getBuffer("aUV")).toBe(cue.geometry.getBuffer("aUV"));
        for (const key of ["positions", "uvs", "indices"] as const) {
          const a = g[key], b = cue.geometry[key];
          expect(NodeBuffer.from(a.buffer, a.byteOffset, a.byteLength)
            .equals(NodeBuffer.from(b.buffer, b.byteOffset, b.byteLength))).toBe(true);
        }
        const [units, positionsHash, uvsHash, indicesHash] = expected[slot];
        expect(g.indices.length / 96).toBe(units);
        expect([digest(g.positions), digest(g.uvs), digest(g.indices)]).toEqual([positionsHash, uvsHash, indicesHash]);
        const attributeBytes = g.positions.byteLength + g.uvs.byteLength;
        duplicateAttributeBytes += attributeBytes;
        return { role, vertices: g.positions.length / 2, indices: g.indices.length, attributeBytes,
          positionsHash: digest(g.positions), uvsHash: digest(g.uvs), indicesHash: digest(g.indices) };
      });
      expect(duplicateAttributeBytes).toBeGreaterThan(0);
      const unique = (layer: PIXI.Container) => new Set(roles.flatMap(role => [...paired(layer, role)])
        .flatMap(mesh => [mesh.geometry.getBuffer("aPosition"), mesh.geometry.getBuffer("aUV")])).size;
      expect(unique(baseline)).toBe(20); expect(unique(shared)).toBe(10);
      console.info("M27_SHARED_TURF_ATTRIBUTE_COUNTS=" + JSON.stringify({ duplicateAttributeBytes, counts }));
    } finally { cleanup(baseline); cleanup(shared); cache.clear(); Object.values(textures).forEach(texture => texture.destroy(true)); }
  });
});
