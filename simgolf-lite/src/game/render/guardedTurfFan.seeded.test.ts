import { createHash } from "node:crypto";
import * as PIXI from "pixi.js";
import { describe, expect, it } from "vitest";
import { generateWildLandWithObstacles } from "../gen/generateWildLand";
import { courseWithEffectiveSurfaces } from "../conditions/surfaceCare";
import { createParklandVisualReferenceCourse } from "../testing/referenceCourse";
import { buildVisualHeightfield, createLandscapeComponentCache } from "./landscapeGeometry";
import { worldToIso, type IsoRotation } from "./iso";
import { buildTerrainPresentationMap } from "./terrainPresentationPolicy";
import { OrderedMeshBoundsCohort } from "./orderedMeshBounds";
import { copyGuardedTurfFan, prepareGuardedTurfFan } from "./guardedTurfFan";
import { appendParklandComposablePresentation, createParklandComposableTrace,
  PARKLAND_COMPOSABLE_SEMANTICS as roles, PARKLAND_MATERIAL_FIELD_SOURCE_HASHES as hashes,
  resolveParklandComposableSources, type ParklandSemanticFieldSources } from "./parklandComposable";

const digest = (a: Float32Array | Uint32Array) => createHash("sha256").update(
  new Uint8Array(a.buffer, a.byteOffset, a.byteLength),
).digest("hex");
function environment(rotation: IsoRotation) {
  const width = 640, height = 480, app = new PIXI.Application(), canvas = { width, height };
  const source = { resource: canvas, resolution: 1, _resolution: 1, pixelWidth: width, pixelHeight: height };
  const texture = { source, frame: { x: 0, y: 0, width, height } };
  const target = { isRoot: true, colorTexture: source, resolution: 1, pixelWidth: width, pixelHeight: height };
  const renderer = Object.create(PIXI.WebGLRenderer.prototype) as PIXI.WebGLRenderer;
  const pipe = Object.assign(Object.create(PIXI.MeshPipe.prototype), { renderer, _adaptor: Object.create(PIXI.GlMeshAdaptor.prototype) });
  Object.assign(renderer, {
    type: PIXI.RendererType.WEBGL,
    view: Object.assign(Object.create(PIXI.ViewSystem.prototype), { canvas, texture, renderTarget: target, screen: { x: 0, y: 0, width, height } }),
    renderGroup: Object.create(PIXI.RenderGroupSystem.prototype), renderTarget: Object.create(PIXI.RenderTargetSystem.prototype),
    globalUniforms: Object.create(PIXI.GlobalUniformSystem.prototype), renderPipes: { mesh: pipe }, _roundPixels: 0,
    gl: { VERTEX_SHADER: 35633, HIGH_FLOAT: 36338, getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }) },
  });
  (app as unknown as { renderer: PIXI.WebGLRenderer }).renderer = renderer;
  const world = new PIXI.Container();app.stage.addChild(world);
  const center = worldToIso(12, 9, 0, rotation);world.pivot.set(center.x, center.y);
  return { app, world };
}
function seededCourse(seed: number, cliff: boolean) {
  const width = 24, height = 18;
  const generated = generateWildLandWithObstacles(width, height, seed, [], "parkland");
  const course = { ...createParklandVisualReferenceCourse(), width, height,
    tiles: generated.tiles, elevations: cliff ? generated.elevations.map((_, i) => i % width < width / 2 ? 0 : 15) : generated.elevations,
    obstacles: generated.obstacles, buildings: [], holes: [{ tee: { x: 3, y: 9 }, green: { x: 20, y: 9 }, parMode: "MANUAL" as const, parManual: 4 as const }],
  };
  // Seeded hazards/rough remain; canonical maintained terrain exercises every field/cue owner.
  for (let i = 0; i < roles.length; i++) for (let x = 3; x <= 20; x++) course.tiles[(5 + i) * width + x] = roles[i];
  return course;
}
function fields() {
  return Object.fromEntries(roles.map(role => [role, new PIXI.Texture({ source: new PIXI.TextureSource({ width: 512, height: 512,
    label: `/atlases/biomes/field-parkland-high-${role}.${hashes.high[role].slice(0, 12)}.png` }) })])) as ParklandSemanticFieldSources<PIXI.Texture>;
}
function presentation(seed: number, cliff: boolean, rotation: IsoRotation, fan: boolean, textures: ParklandSemanticFieldSources<PIXI.Texture>) {
  const course = seededCourse(seed, cliff), heightfield = buildVisualHeightfield(course);
  const effective = courseWithEffectiveSurfaces(course).tiles;
  const tiles = buildTerrainPresentationMap(effective, course.width, course.height, course.theme).presentationTiles;
  const cache = createLandscapeComponentCache(), options = { cornerRadius: .4, cornerSegments: 4 };
  cache.update(effective, course.width, course.height, options);
  const components = cache.update(tiles, course.width, course.height, options).components;
  const env = environment(rotation), layer = new PIXI.Container();env.world.addChild(layer);
  const cohort = new OrderedMeshBoundsCohort();
  const calls: { mesh: PIXI.Mesh<PIXI.MeshGeometry>; subdivisions: number; units: number; args: number }[] = [];
  appendParklandComposablePresentation(layer, resolveParklandComposableSources("parkland", "high", () => PIXI.Texture.EMPTY)!,
    textures, components, course, effective, tiles, 4, heightfield, rotation, true,
    { fairway: 1, rough: 2, deep_rough: 3, green: 4, tee: 5 }, createParklandComposableTrace("parkland", "high"),
    (...args) => {
      const [mesh, subdivisions, units] = args;
      calls.push({ mesh: mesh as PIXI.Mesh<PIXI.MeshGeometry>, subdivisions, units, args: args.length });
      expect(cohort.registerTurf(mesh as PIXI.Mesh<PIXI.MeshGeometry>, subdivisions, units)).toBe(true);
    }, fan ? { reusePairedFieldCueGeometry: true, guardedHighTurfFan: true } : undefined);
  cache.clear();
  return { ...env, cohort, calls, original: calls.map(({ mesh }) => mesh.geometry.indices),
    buffers: calls.map(({ mesh }) => [digest(mesh.geometry.positions), digest(mesh.geometry.uvs)]),
    close() { cohort.dispose();env.app.stage.destroy({ children: true }); } };
}
function selectedOutput(original: Uint32Array, baseline: Uint32Array, candidate: Uint32Array) {
  const keys = new Map<string, number>();
  for (let o = 0; o < original.length; o += 96) {
    const key = `${original[o]},${original[o + 1]},${original[o + 2]}`;
    expect(keys.has(key)).toBe(false);keys.set(key, o / 96);
  }
  const fan = new Uint32Array(48);let cursor = 0, fans = 0;
  expect(baseline.length % 96).toBe(0);
  for (let o = 0; o < baseline.length; o += 96) {
    const unit = keys.get(`${baseline[o]},${baseline[o + 1]},${baseline[o + 2]}`);
    expect(unit).toBeDefined();copyGuardedTurfFan(original, unit!, fan, 0);
    let equal = true;for (let k = 0; k < 48; k++) if (candidate[cursor + k] !== fan[k]) equal = false;
    if (equal) { cursor += 48;fans++; }
    else { expect(candidate.subarray(cursor, cursor + 96)).toEqual(baseline.subarray(o, o + 96));cursor += 96; }
  }
  expect(cursor).toBe(candidate.length);return { selected: baseline.length / 96, fans };
}

describe("fixed seeded edge-course High fan differential", () => {
  for (const [seed, cliff] of [[104729, false], [130363, true], [155921, false]] as const) {
    it(`preserves seeded ${seed}${cliff ? " legal cliff" : " relief"} across rotations/pan/.15to8views`, () => {
      const textures = fields();let observedFallback = false;
      try {
        for (const rotation of [0, 90, 180, 270] as const) {
          const base = presentation(seed, cliff, rotation, false, textures), candidate = presentation(seed, cliff, rotation, true, textures);
          expect(candidate.calls.map(c => [c.mesh.label, c.subdivisions, c.units, c.args])).toEqual(base.calls.map(c => [c.mesh.label, c.subdivisions, c.units, c.args]));
          expect(base.calls.length).toBe(10);expect(base.cohort.fanDiagnostics().preparedUnits).toBe(0);
          for (let i = 0; i < base.calls.length; i++) {
            expect(candidate.buffers[i]).toEqual(base.buffers[i]);expect(candidate.original[i]).toEqual(base.original[i]);
          }
          try {
            for (const [scale, panX, panY] of [[.15, .125, -.375], [.5, 0, 0], [1, -119.5, 41.25], [2, 50.125, -70.25], [4, 0, 0], [8, 35.5, -47.25]]) {
              for (const env of [base, candidate]) { env.world.scale.set(scale);env.world.position.set(320 + panX, 240 + panY);env.cohort.reconcile(env.app, env.world); }
              let selected = 0, fans = 0;
              for (let i = 0; i < base.calls.length; i++) {
                const result = selectedOutput(base.original[i], base.calls[i].mesh.geometry.indices, candidate.calls[i].mesh.geometry.indices);
                selected += result.selected;fans += result.fans;observedFallback ||= result.selected > result.fans;
                expect([digest(candidate.calls[i].mesh.geometry.positions), digest(candidate.calls[i].mesh.geometry.uvs)]).toEqual(base.buffers[i]);
              }
              expect(candidate.cohort.fanDiagnostics().selectedUnits).toBe(fans);
              if (scale === .15) { expect(selected).toBeGreaterThan(0);expect(fans / selected).toBeGreaterThanOrEqual(.5); }
            }
          } finally {
            for (const env of [base, candidate]) {
              env.cohort.dispose();for (let i = 0; i < env.calls.length; i++) expect(env.calls[i].mesh.geometry.indices).toBe(env.original[i]);
              expect(env.cohort.fanDiagnostics().metadataBytes).toBe(0);env.close();
            }
          }
        }
        expect(observedFallback).toBe(true); // Close detail/cliffs retain original96; qualification is not unconditional.
      } finally { for (const texture of Object.values(textures)) texture.destroy(true); }
    });
  }
  it("declines malformed UV and a folded interior from an actual seeded source geometry", () => {
    const textures = fields(), env = presentation(104729, false, 0, false, textures);
    try {
      const mesh = env.calls.find(c => c.units > 10)!.mesh, geometry = mesh.geometry;
      const uv = geometry.uvs.slice();uv[0] += 2 ** -20;
      expect(prepareGuardedTurfFan(geometry.positions, uv, geometry.indices, geometry.indices.length / 96)).toBeNull();
      const positions = geometry.positions.slice(), center = geometry.indices[60]; // Actual cell center at original mini-quad(2,2)topLeft.
      positions[center * 2] += 10_000;
      const errors = prepareGuardedTurfFan(positions, geometry.uvs, geometry.indices, geometry.indices.length / 96)!;
      expect(errors[0]).toBe(Infinity);expect(errors[1]).toBe(Infinity);
      expect([digest(geometry.positions), digest(geometry.uvs)]).toEqual(env.buffers[env.calls.findIndex(c => c.mesh === mesh)]);
    } finally { env.close();for (const texture of Object.values(textures)) texture.destroy(true); }
  });
});
