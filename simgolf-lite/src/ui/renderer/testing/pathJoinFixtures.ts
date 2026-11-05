import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as PIXI from "pixi.js";
import ts from "typescript";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../../../game/models/defaults";
import { biomeCompatibilityMetadataFor } from "../../../game/models/biomes";
import type { Course, Point, Terrain } from "../../../game/models/types";
import { corridorFeature } from "../../../game/models/surfaceIntent";
import { courseWithEffectiveSurfaces } from "../../../game/conditions/surfaceCare";
import { buildVisualHeightfield, createLandscapeComponentCache, sampleLandscapeSurfaceHeight, sampleVisualHeight, type LandscapeComponent, type VisualHeightfield } from "../../../game/render/landscapeGeometry";
import { buildHazardVisualRings, classifyBunkerVisualType } from "../../../game/render/bunkerShapes";
import { buildHazardBankFacePlan } from "../../../game/render/hazardDepth";
import { worldToIso, type IsoRotation } from "../../../game/render/iso";
import { isMaintained } from "../../../game/render/materialFields";
import * as composableRuntime from "../../../game/render/parklandComposable";
import type { ContinuousPathPlan } from "../../../game/paths/continuousPathPlan";
import { buildPathMaterialScenePlan, pathMaterialLayerMesh, pathUnderlayForRenderer } from "../scenes/pathMaterialScene";

export const pathJoinTargets = [{ terrain: "tee", x: 18, y: 3 }, { terrain: "green", x: 18, y: 7 }] as const;
export type JoinQuality = "low" | "high";
export type Polygon = readonly Point[];
export const sourceHash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Explicit immutable-input fixture, not an edit/quote or fabricated rendered tee. */
export function pathJoinFixture(kind: "saved-boundary" | "legacy") {
  const width = 24, height = 20;
  const course: Course = { ...DEFAULT_COURSE, name: `B1 Links ${kind}`, width, height, theme: "links", biomeCompatibility: biomeCompatibilityMetadataFor("links"),
    tiles: Array<Terrain>(width * height).fill("rough"), elevations: Array<number>(width * height).fill(0),
    holes: [{ id: "B1-hole", name: "Actual endpoint surfaces", tee: { x: 18, y: 3 }, green: { x: 18, y: 7 }, parMode: "AUTO" }],
    layouts: [], estate: undefined, property: undefined, obstacles: [], decorations: [], buildings: [],
    greenSurface: undefined, greenProgram: undefined, greenLocalState: undefined, surfaceIntent: { version: 1, nextId: 1, features: [] } };
  for (const target of pathJoinTargets) {
    course.tiles[target.y * width + target.x] = target.terrain;
    const coverage = [14, 15, 16, 17].map(x => target.y * width + x);
    for (const cell of coverage) course.tiles[cell] = "path";
    if (kind === "saved-boundary") {
      const feature = corridorFeature(course, "path", [{ x: 14.5, y: target.y + .5 }, { x: 18, y: target.y + .5 }], 1);
      feature.coverage = coverage;
      course.surfaceIntent!.features.push(feature); course.surfaceIntent!.nextId++;
    }
  }
  return { course, world: { ...structuredClone(DEFAULT_WORLD), cash: 1234 } };
}

// Only frozen consumed fragments are pinned: unrelated Stage actor/contact work
// may change concurrently. Every fragment below matches integration4fca382.
const STAGE_PINS: Record<string, string> = {
  "landscapeOptionsForQuality": "97050e99bd9ba0fc5a40d09ca97bda4ae964d38338ea9682d1d34f5d89d7cecb",
  "effectiveSurfaceTilesForRenderer": "c54a53ec35142d53584a6f9e23770fb28cec06dfb6c5af9d56399f50f41834fc",
  "visualHeightfieldForRenderer": "5ae334e45a7570a90c5c2942904bdf0c6f41681e3a9da22d548bf92ff5f3139d",
  "terrainPresentation": "7dfeee6d747c518c3671318125a08cffaa893c19500d16ac794a6c8baad94b0e",
  "presentationTiles": "03a74546eb5d1723633adcf31d90f864c85c60be2f7453a769061eb9336bb456",
  "subdivisions": "461534f5c7e2bb135b44e65a95f552a577fb98333020c33b5f1bc6923a000126",
  "components": "48313bccdbea6182abbb52f351610c8155562fb779b8e26590feddf5d9d1c248",
  "project": "5d767f77a9f50172a71c402e5c7700be93a683e5af69a6ec4e42b11568b401a8",
  "composableSources": "ff91530ed12fa24d73a992c61ce9861181b47238a637343f5f4b98f1047dc6ee",
  "composableActive": "50d84d2dfdef2b0055164e4ecf42867db5432e4b0bfbe4c0368ebddea1355d15",
  "lowPredicate": "9eb9992989261fe1cbb02411991fccf0f23ec003b77e3b38ebf6d8327157a951",
  "low.mesh": "9b4d836d3606559df2f75350b78bce2b89fe5a8da310558379ed859311d45a6f",
  "low.mask": "1e3e4e91766c0c529a89b09b57945d2783def2ec247d6d932010104005ce318e",
  "high.presentationTerrain": "435829068c10d7251e49d3a1ba1b7ff7cafeea0625ec7f3d6363cc781922a51b",
  "high.exactComposableCue": "7d31762852ab1104dab325c0982a27be5d71e707518c5b3bb8520aaaef01fa8c",
  "high.mesh": "a75b6c5f04989b57cec6f88f5a2963ac6a34228146d2f6b4a5faf38b2cccc302",
  "high.isSand": "857b96c841097a3486ef08d88212a07d26b657f835bd6c42501a3f42843db287",
  "high.bunkerVisualType": "b82d805265a36fb016a3820cae1239fad6d16e12e5b0085cf84a41ee9409f9d4",
  "high.visualRings": "2639b30ebc1e5732f5b67e392939fcc6187e1c0b750d1f703a361746a96a1a28",
  "high.hazardPlans": "08e7effd5edffff56ec41635b57fd25bea9e33311a8398a0d207f0f5e716a781",
  "high.maskRings": "2dc12725ee2b1c956f365846f3b298d2ed58c6f19beb7bc8b1106bb4c9087dfa",
  "high.mask": "7249c9926b7c67ae16cb756a669b0def43a46e99cdbb3e15cb2dc1d0668548b2",
  "path.data": "78354444f2d4a9d19c58ed830e01540ae4a7a0bcbdc8a1c67288031c9313597d",
  "path.mesh": "93c8a6d32cf23f4029e8885a3cd4a730bcac2511b02ee8ff4f5e883917134457",
};
const stageSource = readFileSync(new URL("../../PixiStage.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("PixiStage.tsx", stageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function one(root: ts.Node, predicate: (node: ts.Node) => boolean, label: string) {
  const matches: ts.Node[] = [];
  const visit = (node: ts.Node) => { if (predicate(node)) matches.push(node); ts.forEachChild(node, visit); };
  visit(root);
  if (matches.length !== 1) throw new Error(`B1_SETUP ${label}: ${matches.length} source candidates`);
  return matches[0];
}
function variable(root: ts.Node, name: string, contains = "") {
  const node = one(root, node => ts.isVariableDeclaration(node) && node.name.getText(parsed) === name && Boolean(node.initializer?.getText(parsed).includes(contains)), `${name}/${contains}`) as ts.VariableDeclaration;
  return node.initializer!.getText(parsed);
}
function fragments() {
  const low = one(parsed, node => ts.isIfStatement(node) && node.expression.getText(parsed) === 'quality === "low" && !composableActive', "Low maintained branch") as ts.IfStatement;
  const high = one(parsed, node => ts.isForOfStatement(node) && node.expression.getText(parsed) === "sortedComponents", "High component branch") as ts.ForOfStatement;
  const paths = one(parsed, node => ts.isForOfStatement(node) && node.expression.getText(parsed) === "pathScenePlan.layers", "actual path mesh branch") as ts.ForOfStatement;
  const result: Record<string, string> = {};
  for (const name of ["landscapeOptionsForQuality", "effectiveSurfaceTilesForRenderer", "visualHeightfieldForRenderer"]) {
    result[name] = one(parsed, node => ts.isFunctionDeclaration(node) && node.name?.text === name, name).getText(parsed);
  }
  for (const [name, needle] of [["terrainPresentation", "buildTerrainPresentationMap"], ["presentationTiles", "terrainPresentation?.presentationTiles"], ["subdivisions", 'quality === "high" ? 4'], ["components", "landscapeComponentCacheRef.current.update"], ["project", "sampleVisualHeight(heightfield"], ["composableSources", "resolveParklandComposableSources"], ["composableActive", "Boolean(composableSources)"]]) result[name] = variable(parsed, name, needle);
  result.lowPredicate = low.expression.getText(parsed);
  for (const name of ["mesh", "mask"]) result[`low.${name}`] = variable(low.thenStatement, name);
  for (const [name, needle] of [["presentationTerrain", ""], ["exactComposableCue", ""], ["mesh", "createParklandComposableMesh"], ["isSand", ""], ["bunkerVisualType", ""], ["visualRings", ""], ["hazardPlans", ""], ["maskRings", "hazardPlans.some"], ["mask", "createLandscapeRingMask(maskRings"]]) result[`high.${name}`] = variable(high.statement, name, needle);
  for (const name of ["data", "mesh"]) result[`path.${name}`] = variable(paths.statement, name);
  for (const [name, hash] of Object.entries(STAGE_PINS)) if (!result[name] || sourceHash(result[name]) !== hash) throw new Error(`B1_SETUP frozen Stage fragment changed: ${name}`);
  return result;
}
const pinned = fragments();
export const pathJoinSourceReceipt = { integration: "4fca382", stageFileSHA256: sourceHash(stageSource), fragments: STAGE_PINS };
function execute<T>(name: string, scope: Record<string, unknown>): T {
  const js = ts.transpileModule(`const value = (${pinned[name]});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(scope), `${js}\nreturn value;`)(...Object.values(scope)) as T;
}

export interface FinalTriangles { positions: Float32Array; indices: Uint32Array; triangles: Point[][]; }
function finalTriangles(mesh: PIXI.Mesh): FinalTriangles {
  const positions = mesh.geometry.getBuffer("aPosition").data, indices = mesh.geometry.getIndex().data;
  if (!(positions instanceof Float32Array) || !(indices instanceof Uint32Array) || positions.length % 2 || indices.length % 3
    || !positions.every(Number.isFinite) || !indices.every(i => i * 2 + 1 < positions.length)) throw new Error("B1_SETUP malformed actual MeshGeometry buffers");
  const triangles: Point[][] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const triangle = Array.from(indices.subarray(i, i + 3), n => ({ x: positions[n * 2], y: positions[n * 2 + 1] }));
    if (Math.abs(polygonArea(triangle)) > 1e-12) triangles.push(triangle);
  }
  if (!triangles.length) throw new Error("B1_SETUP actual mesh has no nondegenerate Float32 triangles");
  return { positions, indices, triangles };
}
function actualMaskPolygon(mask: PIXI.Graphics): Point[] {
  if (mask.context.instructions.some(instruction => instruction.action !== "fill" || Boolean(instruction.data.hole))) throw new Error("B1_SETUP unexpected native one-cell mask action/hole");
  const polygons = mask.context.instructions.flatMap(instruction => instruction.action === "fill"
    ? instruction.data.path.instructions.filter(path => path.action === "poly").map(path => (path.data[0] as number[]).slice()) : []);
  if (polygons.length !== 1 || polygons[0].length < 6 || polygons[0].length % 2 || !polygons[0].every(Number.isFinite)) throw new Error("B1_SETUP expected actual one-cell component's single native mask polygon");
  const numbers = polygons[0], points = Array.from({ length: numbers.length / 2 }, (_, i) => ({ x: numbers[i * 2], y: numbers[i * 2 + 1] }));
  const orientation = Math.sign(polygonArea(points));
  if (!orientation || points.some((p, i) => cross(p, points[(i + 1) % points.length], points[(i + 2) % points.length]) * orientation < -1e-10)) throw new Error("B1_SETUP actual protected mask is not a convex single component; no approximate mask supported");
  return points;
}

/** Call THROUGH the actual Stage constructors, retaining real mesh+mask objects.
 * White is a borrowed texture only: this certifies geometry, not atlas pixels. */
export function renderPathJoinComponent(course: Course, plan: ContinuousPathPlan, quality: JoinQuality, rotation: IsoRotation, target: typeof pathJoinTargets[number]) {
  const effective = execute<(...args: unknown[]) => Terrain[]>("effectiveSurfaceTilesForRenderer", { courseWithEffectiveSurfaces });
  const effectiveTiles = effective(course.tiles, course.width, course.height, course.surfaceCare, course.surfaceIntent, course.estate);
  const pathScene = buildPathMaterialScenePlan(plan, quality);
  if (pathScene.mode !== "continuous") throw new Error("B1_SETUP real G material plan unavailable");
  const pathTerrainTiles = pathUnderlayForRenderer(effectiveTiles, pathScene);
  const terrainPresentation = execute<ReturnType<typeof composableRuntime.buildTerrainPresentationMap>>("terrainPresentation", { presentationRuntime: composableRuntime, pathTerrainTiles, course });
  const presentationTiles = execute<Terrain[]>("presentationTiles", { terrainPresentation, pathTerrainTiles });
  const options = execute<(quality: JoinQuality) => { cornerRadius: number; cornerSegments: number }>("landscapeOptionsForQuality", {});
  const components = execute<LandscapeComponent[]>("components", { landscapeComponentCacheRef: { current: createLandscapeComponentCache() }, presentationTiles, course, landscapeOptionsForQuality: options, quality });
  const component = components.find(component => component.terrain === target.terrain && component.cells.includes(target.y * course.width + target.x));
  if (!component || component.cells.length !== 1 || component.rings.length !== 1 || !isMaintained(component.terrain)) throw new Error("B1_SETUP actual maintained protected component does not match the fixture endpoint");
  const makeField = execute<(...args: unknown[]) => VisualHeightfield>("visualHeightfieldForRenderer", { buildVisualHeightfield });
  const heightfield = makeField(course.tiles, course.elevations, course.width, course.height, course.buildings, course.property?.assets, course.theme);
  const project = execute<(point: Point) => Point>("project", { worldToIso, sampleVisualHeight, heightfield, rotation });
  const subdivisions = execute<number>("subdivisions", { quality });
  const composableSources = execute<null>("composableSources", { composableRuntime, course, quality, getParklandComposableField: () => { throw new Error("B1_SETUP Links unexpectedly selected a Parkland atlas source"); } });
  const composableActive = execute<boolean>("composableActive", { composableSources });
  if (composableActive || composableSources !== null || subdivisions !== (quality === "low" ? 1 : 4)) throw new Error("B1_SETUP wrong actual Links geometry/material branch");
  const scope: Record<string, unknown> = { composableRuntime, course, component, quality, subdivisions, composableActive, project, heightfield, rotation, worldToIso, sampleLandscapeSurfaceHeight,
    textureFor: () => PIXI.Texture.WHITE, buildHazardVisualRings, classifyBunkerVisualType, presentationTiles, buildHazardBankFacePlan };
  let topMesh: PIXI.Mesh | null, mask: PIXI.Graphics;
  if (execute<boolean>("lowPredicate", scope)) {
    topMesh = execute<PIXI.Mesh | null>("low.mesh", scope); mask = execute<PIXI.Graphics>("low.mask", scope);
  } else {
    for (const name of ["presentationTerrain", "exactComposableCue", "isSand", "bunkerVisualType", "visualRings", "hazardPlans"]) scope[name] = execute(`high.${name}`, scope);
    if (scope.exactComposableCue !== false) throw new Error("B1_SETUP selected a different High top-plane owner");
    topMesh = execute<PIXI.Mesh | null>("high.mesh", scope);
    scope.maskRings = execute("high.maskRings", scope); mask = execute<PIXI.Graphics>("high.mask", scope);
  }
  if (!topMesh) { mask.destroy(); throw new Error("B1_SETUP actual maintained mesh constructor returned null"); }
  const maintainedMesh = topMesh;
  maintainedMesh.mask = mask;
  const top = finalTriangles(maintainedMesh), maskPolygon = actualMaskPolygon(mask);
  const meshes: PIXI.Mesh[] = [];
  const layers = plan.layers.map(pathLayer => {
    const data = execute<ReturnType<typeof pathMaterialLayerMesh>>("path.data", { pathLayer, project, pathMaterialLayerMesh });
    const mesh = execute<PIXI.Mesh>("path.mesh", { PIXI, data, texture: PIXI.Texture.WHITE }); meshes.push(mesh);
    const final = finalTriangles(mesh);
    const endpointTriangles: Point[][] = [];
    for (let i = 0; i < final.indices.length; i += 3) {
      const ns = Array.from(final.indices.subarray(i, i + 3));
      if (!ns.every(n => pathLayer.positions[n * 2 + 1] >= target.y - 1e-8 && pathLayer.positions[n * 2 + 1] <= target.y + 1 + 1e-8)) continue;
      const triangle = ns.map(n => ({ x: final.positions[n * 2], y: final.positions[n * 2 + 1] }));
      if (Math.abs(polygonArea(triangle)) > 1e-12) endpointTriangles.push(triangle);
    }
    return { role: pathLayer.role, ...final, endpointTriangles, maximumWorldX: Math.max(...Array.from({ length: pathLayer.positions.length / 2 }, (_, i) => pathLayer.positions[i * 2])),
      endpointWorldVertices: Array.from({ length: pathLayer.positions.length / 2 }, (_, i) => ({ x: pathLayer.positions[i * 2], y: pathLayer.positions[i * 2 + 1] })).filter(p => p.x >= 17 && p.y >= target.y && p.y <= target.y + 1) };
  });
  const tolerancePx = quantizationAllowance([top.positions, ...layers.map(layer => layer.positions)]);
  return { component, subdivisions, fieldVertices: Array.from(heightfield.vertices), top, mask, maskPolygon, layers, tolerancePx,
    terrainInputs: { effectiveTiles, pathTerrainTiles, presentationTiles },
    destroy() { maintainedMesh.mask = null; const topGeometry = maintainedMesh.geometry; maintainedMesh.destroy(); topGeometry.destroy(); mask.destroy(); for (const mesh of meshes) { const geometry = mesh.geometry; mesh.destroy(); geometry.destroy(); } } };
}

const cross = (a: Point, b: Point, p: Point) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
export function polygonArea(points: Polygon): number { return points.reduce((s, p, i) => { const q = points[(i + 1) % points.length]; return s + p.x * q.y - p.y * q.x; }, 0) / 2; }
export function quantizationAllowance(buffers: readonly Float32Array[]): number {
  let maximumUlp = 0;
  for (const buffer of buffers) for (const value of buffer) {
    if (!Number.isFinite(value)) throw new Error("B1_SETUP nonfinite final Float32 coordinate");
    const v = Math.abs(value); maximumUlp = Math.max(maximumUlp, v < 2 ** -126 ? 2 ** -149 : 2 ** (Math.floor(Math.log2(v)) - 23));
  }
  const allowance = 8 * maximumUlp;
  if (!(allowance > 0 && allowance <= .05)) throw new Error(`B1_SETUP Float32 allowance exceeds .05 logical px: ${allowance}`);
  return allowance;
}
/** Independent convex clipping: inputs are FINAL mesh triangles and the real
 * Graphics polygon. No production sampler enters the contact oracle. */
function clipPolygon(subject: Polygon, clip: Polygon): Point[] {
  let points = [...subject]; const sign = Math.sign(polygonArea(clip));
  for (let i = 0; i < clip.length && points.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length], next: Point[] = [];
    for (let j = 0; j < points.length; j++) {
      const p = points[j], q = points[(j + 1) % points.length], dp = sign * cross(a, b, p), dq = sign * cross(a, b, q);
      if (dp >= 0) next.push(p);
      if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); next.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) }); }
    }
    points = next;
  }
  return points;
}
function edges(polygon: Polygon) { return polygon.map((a, i) => [a, polygon[(i + 1) % polygon.length]] as const); }
function closestPoint(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x, dy = b.y - a.y, d = dx * dx + dy * dy;
  const t = d ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / d)) : 0;
  return { x: a.x + t * dx, y: a.y + t * dy };
}
function merge(intervals: [number, number][]) {
  const result: [number, number][] = [];
  for (const interval of intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = result.at(-1); if (last && interval[0] <= last[1] + 1e-12) last[1] = Math.max(last[1], interval[1]); else result.push([...interval]);
  }
  return result;
}
function segmentInterval(a: Point, b: Point, polygon: Polygon, tolerancePx: number): [number, number] | null {
  let lo = 0, hi = 1; const sign = Math.sign(polygonArea(polygon));
  for (const [p, q] of edges(polygon)) {
    const start = sign * cross(p, q, a), delta = sign * (cross(p, q, b) - cross(p, q, a));
    const bound = -tolerancePx * Math.hypot(q.x - p.x, q.y - p.y);
    if (Math.abs(delta) < 1e-12) { if (start < bound) return null; }
    else if (delta > 0) lo = Math.max(lo, (bound - start) / delta); else hi = Math.min(hi, (bound - start) / delta);
    if (lo > hi) return null;
  }
  return [lo, hi];
}
export function measureVisibleJoin(path: readonly Polygon[], top: readonly Polygon[], mask: Polygon, tolerancePx: number) {
  if (!path.length || !top.length || !mask.length || !(tolerancePx >= 0 && tolerancePx <= .05)) throw new Error("B1_SETUP incomplete contact oracle input");
  const visible = top.map(triangle => clipPolygon(triangle, mask)).filter(p => p.length >= 3 && Math.abs(polygonArea(p)) > 1e-10);
  if (!visible.length) throw new Error("B1_SETUP actual top mesh has no area inside its native mask");
  let gapPx = Infinity, closest: { path: Point; top: Point } | null = null, contactLengthPx = 0;
  const contactSegments: { maskEdge: Point[]; interval: [number, number]; lengthPx: number }[] = [];
  for (const triangle of path) for (const polygon of visible) {
    if (Math.abs(polygonArea(clipPolygon(triangle, polygon))) > 1e-10) gapPx = 0;
    for (const [a, b] of edges(triangle)) for (const [c, d] of edges(polygon)) {
      for (const [p, u, v, isPath] of [[a, c, d, true], [b, c, d, true], [c, a, b, false], [d, a, b, false]] as const) {
        const q = closestPoint(p, u, v), distance = Math.hypot(p.x - q.x, p.y - q.y);
        if (distance < gapPx) { gapPx = distance; closest = isPath ? { path: p, top: q } : { path: q, top: p }; }
      }
    }
  }
  for (const [a, b] of edges(mask)) {
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy); if (length <= 1e-12) continue;
    const covered = merge(visible.flatMap(p => { const span = segmentInterval(a, b, p, tolerancePx); return span ? [span] : []; }));
    const matched: [number, number][] = [];
    for (const triangle of path) for (const [c, d] of edges(triangle)) {
      // Both edge endpoints must lie on the actual mask line, within only
      // Float32 quantization. Projection intervals are NEVER expanded: a
      // corner/tangent-only touch cannot become positive-width contact.
      if (Math.abs(cross(a, b, c)) / length > tolerancePx || Math.abs(cross(a, b, d)) / length > tolerancePx) continue;
      const t = (p: Point) => ((p.x - a.x) * dx + (p.y - a.y) * dy) / (length * length);
      const lo = Math.max(0, Math.min(t(c), t(d))), hi = Math.min(1, Math.max(t(c), t(d)));
      for (const [u, v] of covered) if (Math.min(hi, v) >= Math.max(lo, u)) matched.push([Math.max(lo, u), Math.min(hi, v)]);
    }
    for (const interval of merge(matched)) {
      const span = (interval[1] - interval[0]) * length;
      if (span <= 2 * tolerancePx) continue;
      contactLengthPx += span; contactSegments.push({ maskEdge: [a, b], interval, lengthPx: span });
    }
  }
  return { gapPx, closest, contactLengthPx, positiveContact: gapPx <= tolerancePx && contactLengthPx > 2 * tolerancePx, tolerancePx, visibleTriangleCount: visible.length, visiblePolygons: visible, contactSegments };
}
