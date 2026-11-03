import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import { createParklandVisualReferenceCourse } from "../src/game/testing/referenceCourse";
import { buildContinuousPathPlan, classifyContinuousPathPoint, type PathRibbonRole } from "../src/game/paths/continuousPathPlan";
import { worldToIso, type IsoRotation } from "../src/game/render/iso";
import type { Point } from "../src/game/models/types";
import { buildParklandComposableMeshGeometry } from "../src/game/render/parklandComposable";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const commit = process.env.ZK714_COMMIT ?? process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim();
const outputRoot = resolve(process.env.ZK714_EVIDENCE_DIR ?? resolve(tmpdir(), "coursecraft-zk714-evidence", `${commit.slice(0, 12)}-${createHash("sha256").update(projectRoot).digest("hex").slice(0, 8)}`), "cross-section");
const sourcePaths = ["src/game/paths/continuousPathPlan.ts", "src/game/paths/continuousPathRibbon.ts", "src/game/paths/continuousPathTopology.ts", "src/game/render/renderSnapshot.ts", "src/ui/renderer/scenes/pathMaterialScene.ts", "src/ui/renderer/scenes/surfaceEditorScene.ts", "src/ui/PixiStage.tsx", "src/App.tsx"] as const;
const sourceHashes = process.env.ZK714_SOURCE_HASHES ?? JSON.stringify(Object.fromEntries(sourcePaths.map(path => [path, createHash("sha256").update(readFileSync(resolve(projectRoot, path))).digest("hex")])));
type ScreenPoint = Point;
type PathDiagnostic = { active: boolean; mode: string; quality: string; roles: string[]; textureIds: string[];
  widths: { shoulder: number; edge: number }; ownership: string[]; commit: string; planKey: string;
  camera: { rotation: IsoRotation; zoom: number; targetZoom: number } };
type Camera = { position: Point; pivot: Point; scale: Point };
type Pixel = { x: number; y: number };

function colorDistance(a: readonly number[], b: readonly number[]) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
function mean(image: PNG, pixels: readonly Pixel[]) {
  expect(pixels.length).toBeGreaterThan(0); const sum = [0, 0, 0];
  for (const { x, y } of pixels) {
    if (!(x >= 0 && x < image.width && y >= 0 && y < image.height)) throw new Error(`ROI pixel (${x},${y}) is outside ${image.width}x${image.height}; never clamp it`);
    const offset = (y * image.width + x) * 4; for (let c = 0; c < 3; c++) sum[c] += image.data[offset + c];
  }
  return { samples: pixels.length, rgb: sum.map(value => value / pixels.length) };
}
function delta(image: PNG, hidden: PNG, { x, y }: Pixel) {
  const n = (y * image.width + x) * 4;
  return Math.abs(image.data[n] - hidden.data[n]) + Math.abs(image.data[n + 1] - hidden.data[n + 1]) + Math.abs(image.data[n + 2] - hidden.data[n + 2]);
}
function cameraPixels(point: Point, camera: Camera, pixelScale: Point): Point {
  return { x: ((point.x - camera.pivot.x) * camera.scale.x + camera.position.x) * pixelScale.x,
    y: ((point.y - camera.pivot.y) * camera.scale.y + camera.position.y) * pixelScale.y };
}
function projected(point: Point, elevation: number, rotation: IsoRotation, camera: Camera, pixelScale: Point): Point {
  const p = worldToIso(point.x, point.y, elevation, rotation);
  // MeshGeometry stores iso coordinates in Float32 before the camera matrix.
  return cameraPixels({ x: Math.fround(p.x), y: Math.fround(p.y) }, camera, pixelScale);
}
function cross(a: Point, b: Point, p: Point) { return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x); }
function triangleMask(width: number, height: number, triangles: readonly Point[][]) {
  const mask = new Uint8Array(width * height);
  const distanceSquared = (p: Point, a: Point, b: Point) => {
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
    return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
  };
  for (const [a, b, c] of triangles) {
    const area = cross(a, b, c); if (Math.abs(area) < 1e-8) continue;
    const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x) - 2)), maxX = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x, c.x) + 2));
    const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y) - 2)), maxY = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y, c.y) + 2));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const p = { x: x + .5, y: y + .5 }; const signs = [cross(a, b, p), cross(b, c, p), cross(c, a, p)];
      if (signs.every(n => n >= -1e-8) || signs.every(n => n <= 1e-8)
        || Math.min(distanceSquared(p, a, b), distanceSquared(p, b, c), distanceSquared(p, c, a)) <= 4) mask[y * width + x] = 1;
    }
  }
  return mask;
}
type ProjectionTriangle = { world: Point[]; screen: Point[]; role: PathRibbonRole | null };
type MappedPoint = { kind: "mapped"; world: Point; roles: (PathRibbonRole | null)[] } | { kind: "none" | "ambiguous" };
type WorldRect = { left: number; right: number; top: number; bottom: number };
function weights(point: Point, triangle: readonly Point[]): number[] | null {
  const [a, b, c] = triangle, area = cross(a, b, c);
  if (Math.abs(area) < 1e-12) return null;
  const values = [cross(b, c, point) / area, cross(c, a, point) / area, cross(a, b, point) / area];
  return values.every(value => value >= -1e-8 && value <= 1 + 1e-8) ? values : null;
}
function weighted(values: readonly number[], points: readonly Point[]): Point {
  return { x: values.reduce((sum, value, index) => sum + value * points[index].x, 0),
    y: values.reduce((sum, value, index) => sum + value * points[index].y, 0) };
}
function pixelWorld(point: Point, triangles: readonly ProjectionTriangle[]): MappedPoint {
  let world: Point | undefined; const roles = new Set<PathRibbonRole | null>();
  for (const triangle of triangles) {
    if (point.x < Math.min(...triangle.screen.map(p => p.x)) - 1e-8 || point.x > Math.max(...triangle.screen.map(p => p.x)) + 1e-8
      || point.y < Math.min(...triangle.screen.map(p => p.y)) - 1e-8 || point.y > Math.max(...triangle.screen.map(p => p.y)) + 1e-8) continue;
    const barycentric = weights(point, triangle.screen); if (!barycentric) continue;
    const candidate = weighted(barycentric, triangle.world);
    // Shared seams may give the same world point twice; a folded/overlapping
    // projection must never be resolved by choosing an arbitrary first face.
    if (world && Math.hypot(world.x - candidate.x, world.y - candidate.y) > 1e-7) return { kind: "ambiguous" };
    world = candidate; roles.add(triangle.role);
  }
  return world ? { kind: "mapped", world, roles: [...roles] } : { kind: "none" };
}
function worldScreen(point: Point, triangles: readonly ProjectionTriangle[]): Point {
  const candidates = triangles.flatMap(triangle => {
    const barycentric = weights(point, triangle.world);
    return barycentric ? [weighted(barycentric, triangle.screen)] : [];
  });
  expect(candidates.length, "world sample must have an actual projected face").toBeGreaterThan(0);
  expect(candidates.every(p => Math.hypot(p.x - candidates[0].x, p.y - candidates[0].y) < 1e-5), "world seam projections must agree").toBe(true);
  return candidates[0];
}
function clipRect(input: readonly Point[], rect: WorldRect): Point[] {
  let polygon = [...input];
  for (const [axis, bound, sign] of [["x", rect.left, 1], ["x", rect.right, -1], ["y", rect.top, 1], ["y", rect.bottom, -1]] as const) {
    const output: Point[] = [];
    for (let index = 0; index < polygon.length; index++) {
      const a = polygon[index], b = polygon[(index + 1) % polygon.length], da = sign * (a[axis] - bound), db = sign * (b[axis] - bound);
      if (da >= 0) output.push(a);
      if ((da < 0) !== (db < 0)) { const t = da / (da - db); output.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); }
    }
    polygon = output;
  }
  return polygon;
}
function polygonArea(points: readonly Point[]): number {
  return Math.abs(points.reduce((sum, a, index) => { const b = points[(index + 1) % points.length]; return sum + a.x * b.y - b.x * a.y; }, 0)) / 2;
}
async function pathDiagnostic(page: Page): Promise<PathDiagnostic> {
  return page.evaluate(() => (window.__coursecraftPixiTest!.rendererAtlasState() as unknown as { pathMaterialCrossSection: PathDiagnostic }).pathMaterialCrossSection);
}

function compactedCoreTextureStats(image: PNG, center: ScreenPoint, radius: number, certify: (pixel: Pixel) => void) {
  const luminance = (x: number, y: number) => {
    certify({ x, y }); // Also certifies every x+1/y+1 neighbor actually read.
    const offset = (y * image.width + x) * 4;
    return image.data[offset] * 0.2126 + image.data[offset + 1] * 0.7152 + image.data[offset + 2] * 0.0722;
  };
  const values: number[] = [];
  const neighborDeltas: number[] = [];
  const minX = Math.max(1, Math.floor(center.x - radius));
  const maxX = Math.min(image.width - 2, Math.ceil(center.x + radius));
  const minY = Math.max(1, Math.floor(center.y - radius));
  const maxY = Math.min(image.height - 2, Math.ceil(center.y + radius));
  const inside = (x: number, y: number) => (x + .5 - center.x) ** 2 + (y + .5 - center.y) ** 2 <= radius ** 2;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    if (!inside(x, y)) continue;
    const value = luminance(x, y);
    values.push(value);
    if (inside(x + 1, y)) neighborDeltas.push(Math.abs(value - luminance(x + 1, y)));
    if (inside(x, y + 1)) neighborDeltas.push(Math.abs(value - luminance(x, y + 1)));
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length);
  const meanNeighborDelta = neighborDeltas.reduce((sum, value) => sum + value, 0)
    / Math.max(1, neighborDeltas.length);
  return {
    radius,
    samples: values.length,
    standardDeviation: Math.sqrt(variance),
    meanNeighborDelta,
    fineEdgeRatio: neighborDeltas.filter((value) => value >= 1.5).length / Math.max(1, neighborDeltas.length),
    plateauRatio: neighborDeltas.filter((value) => value < 0.75).length / Math.max(1, neighborDeltas.length),
  };
}

function median(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}


async function acceptPixelRotation(page: Page, rotation: IsoRotation): Promise<void> {
  test.setTimeout(480_000); expect(commit).toMatch(/^[a-f0-9]{40}$/); await mkdir(outputRoot, { recursive: true });
  await page.addInitScript(() => localStorage.setItem("coursecraft_app_profile_v5", JSON.stringify({ version: 5, tutorialOffered: true, tutorialCompleted: true, accessibility: { reducedMotion: true } })));
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.setViewportSize({ width: 1440, height: 900 }); await page.goto("/?m19Fixture=1");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 90_000 }).toBe("game");
  await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest)); await page.evaluate(() => window.__coursecraftTest!.pauseLiveSimulation());
  const course = createParklandVisualReferenceCourse(); const plan = buildContinuousPathPlan(course);
  const initial = await page.evaluate(() => {
    const actual = window.__coursecraftTest!.terrainSurfaceState();
    // App's existing hook returns effectiveTiles; its shared ambient declaration
    // predates that read-only field. Keep this verified projection test-local.
    return actual as typeof actual & { effectiveTiles: typeof actual.tiles };
  }); expect(initial.tiles).toEqual(course.tiles); expect(Array.isArray(initial.effectiveTiles)).toBe(true);
  const initialCash = await page.evaluate(() => window.__coursecraftTest!.state().cash);
  const canvas = page.locator("canvas").first(); await expect(canvas).toBeVisible();
  const captures: unknown[] = [], closePixelGates: unknown[] = [];
  // Six separated stations inside the straight run. Authored coarse elevation
  // is level here, while the actual visual field retains its biome undulation.
  const stations = Array.from({ length: 6 }, (_, i) => ({ x: 7.8 + i * .5, y: 12.5 }));
  for (const station of stations) {
    expect(classifyContinuousPathPoint(plan, station)).toBe("core");
    expect(classifyContinuousPathPoint(plan, { x: station.x - 1, y: station.y })).toBe("core");
    expect(classifyContinuousPathPoint(plan, { x: station.x + 1, y: station.y })).toBe("core");
    for (const sign of [-1, 1]) for (const [role, offset] of [["core", .13], ["edge", .241], ["shoulder", .283]] as const) expect(classifyContinuousPathPoint(plan, { x: station.x, y: station.y + sign * offset })).toBe(role);
  }
  const assertRotationIdentity = async (step: string) => {
    const actual = await page.evaluate(() => ({ surface: window.__coursecraftTest!.terrainSurfaceState(), cash: window.__coursecraftTest!.state().cash }));
    expect(actual.surface, `${step}: authoritative surface is unchanged`).toEqual(initial);
    expect(actual.cash, `${step}: cash is unchanged`).toBe(initialCash);
    expect((await pathDiagnostic(page)).planKey, `${step}: original plan identity is unchanged`).toBe(plan.key);
  };
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation)).toBe(0);
  await expect.poll(async () => (await pathDiagnostic(page)).planKey).toBe(plan.key);
  // Public WorkspaceNav button calls only selectWorkspace (workspace state/URL).
  // Its focus receives the existing window keyboard binding without painting.
  await page.getByTestId("workspace-design").click();
  await assertRotationIdentity("workspace design focus");
  for (let step = 90; step <= rotation; step += 90) {
    await page.keyboard.press("e");
    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation)).toBe(step);
    await assertRotationIdentity(`rotation ${step}`);
  }
    for (const view of [{ label: "normal", quality: "medium" as const, zoom: 1, focus: { x: 24, y: 18 } }, { label: "close", quality: "high" as const, zoom: 2.25, focus: { x: 9, y: 12.5 } }]) {
      await page.evaluate(({ quality, focus, zoom }) => { window.__coursecraftTest!.setGraphicsQualityFixture(quality); window.__coursecraftPixiTest!.focusTileForTest(focus.x, focus.y, zoom); }, view);
      await expect.poll(async () => { const d = await pathDiagnostic(page); return d.active && d.quality === view.quality && d.camera.rotation === rotation && Math.abs(d.camera.zoom - view.zoom) < .001; }, { timeout: 30_000 }).toBe(true);
      const diagnostic = await pathDiagnostic(page); expect(diagnostic.commit).toBe(commit); expect(diagnostic.mode).toBe("continuous"); expect(diagnostic.roles).toEqual(["shoulder", "edge", "core"]); expect(diagnostic.textureIds).toHaveLength(3);
      expect(diagnostic.widths.shoulder).toBeCloseTo(.036); expect(diagnostic.widths.edge).toBeCloseTo(.048); expect(diagnostic.ownership).toEqual(["accepted-path-coverage"]); expect(diagnostic.planKey).toBe(plan.key);
      const cameraBefore = view.label === "close" ? await page.evaluate(() => window.__coursecraftPixiTest!.cameraTransform()!.world) : null;
      const screenshot = await canvas.screenshot(); const file = resolve(outputRoot, `p714-pixel-r${rotation}-${view.label}.png`); await writeFile(file, screenshot); captures.push({ file, rotation, ...view, diagnostic });
      if (view.label !== "close") continue;
      const image = PNG.sync.read(screenshot);
      const worldPoints = plan.layers.flatMap(layer => Array.from({ length: layer.positions.length / 2 }, (_, n) => ({ x: layer.positions[n * 2], y: layer.positions[n * 2 + 1] })));
      const laneCells = new Set<number>();
      for (const station of stations) for (let y = Math.floor(station.y - .45); y <= Math.floor(station.y + .45); y++) {
        for (let x = Math.floor(station.x - 1); x <= Math.floor(station.x + 1); x++) laneCells.add(y * course.width + x);
      }
      for (const cell of laneCells) {
        expect(initial.effectiveTiles[cell]).toBe("path");
        expect(["rough", "deep_rough", "fairway", "green", "tee"]).toContain(plan.underlayTiles[cell]);
      }
      const pointKey = (p: Point) => `${p.x}:${p.y}`;
      const queryPoints = new Map(worldPoints.map(p => [pointKey(p), p]));
      for (const cell of laneCells) for (let sy = 0; sy <= 4; sy++) for (let sx = 0; sx <= 4; sx++) {
        const p = { x: cell % course.width + sx / 4, y: Math.floor(cell / course.width) + sy / 4 };
        queryPoints.set(pointKey(p), p);
      }
      const queries = [...queryPoints.values()];
      // surfaceHeightAt equals sampleVisualHeight only without hazard recesses.
      // This checks all path vertices and the local High4 turf grid, including
      // integer-boundary lookups; underlay components above are nonhazard turf.
      let recessedQueries = 0; const recessedExamples: { point: Point; terrain: string }[] = [];
      for (const p of queries) {
        const x = Math.max(0, Math.min(course.width - 1, Math.floor(p.x))), y = Math.max(0, Math.min(course.height - 1, Math.floor(p.y)));
        const terrain = initial.effectiveTiles[y * course.width + x];
        if (["water", "wetland", "sand"].includes(terrain)) {
          recessedQueries++; if (recessedExamples.length < 10) recessedExamples.push({ point: p, terrain });
        }
      }
      expect(recessedQueries, `height hook must equal base field at every query: ${JSON.stringify(recessedExamples)}`).toBe(0);
      const runtime = await page.evaluate(points => ({ camera: window.__coursecraftPixiTest!.cameraTransform()!.world,
        viewport: window.__coursecraftPixiTest!.viewport()!, heights: points.map(p => window.__coursecraftPixiTest!.surfaceHeightAt(p.x, p.y)) }), queries);
      expect(runtime.camera).toEqual(cameraBefore);
      expect(runtime.heights.every(Number.isFinite)).toBe(true);
      const heightByPoint = new Map(queries.map((p, i) => [pointKey(p), runtime.heights[i]]));
      const heightAt = (p: Point) => {
        const height = heightByPoint.get(pointKey(p));
        if (height === undefined) throw new Error(`Missing actual runtime height at (${p.x},${p.y})`);
        return height;
      };
      expect(runtime.viewport.width).toBeGreaterThan(0); expect(runtime.viewport.height).toBeGreaterThan(0);
      const pixelScale = { x: image.width / runtime.viewport.width, y: image.height / runtime.viewport.height };
      const projectedVertices = worldPoints.map(p => projected(p, heightAt(p), rotation, runtime.camera, pixelScale));
      const pathTriangles: ProjectionTriangle[] = []; let start = 0;
      for (const layer of plan.layers) {
        for (let i = 0; i < layer.indices.length; i += 3) {
          const indices = layer.indices.slice(i, i + 3);
          pathTriangles.push({ world: indices.map(n => worldPoints[start + n]), screen: indices.map(n => projectedVertices[start + n]), role: layer.role });
        }
        start += layer.positions.length / 2;
      }
      // The actual shared High4 tessellator supplies turf topology/Float32 iso
      // positions. Path and nonhazard underlay both consume the same base field.
      const turfWorld: Point[] = [];
      const turfMesh = buildParklandComposableMeshGeometry([...laneCells], course.width, 4, cell => cell, (_cell, x, y) => {
        const p = { x, y }; turfWorld.push(p); return worldToIso(x, y, heightAt(p), rotation);
      }, true);
      const turfTriangles: ProjectionTriangle[] = [];
      for (let i = 0; i < turfMesh.indices.length; i += 3) {
        const indices = [...turfMesh.indices.slice(i, i + 3)];
        turfTriangles.push({ world: indices.map(n => turfWorld[n]),
          screen: indices.map(n => cameraPixels({ x: turfMesh.positions[n * 2], y: turfMesh.positions[n * 2 + 1] }, runtime.camera, pixelScale)), role: null });
      }
      const triangles = pathTriangles.map(triangle => triangle.screen);
      const coreTriangles = pathTriangles.filter(triangle => triangle.role === "core");
      const rolePixels = new Map<PathRibbonRole, Pixel[]>([["core", []], ["edge", []], ["shoulder", []]]);
      const turfPixels: Pixel[] = []; const textureCandidates: ReturnType<typeof compactedCoreTextureStats>[] = [];
      const band = (station: Point, sign: number, from: number, to: number, role: PathRibbonRole | null): Pixel[] => {
        const rect = { left: station.x - .04, right: station.x + .04,
          top: station.y + Math.min(sign * from, sign * to), bottom: station.y + Math.max(sign * from, sign * to) };
        const source = role === null ? turfTriangles : pathTriangles, found = new Map<string, Pixel>();
        for (const triangle of source) {
          if (triangle.role !== role) continue;
          const polygon = clipRect(triangle.world, rect); if (polygon.length < 3 || polygonArea(polygon) < 1e-12) continue;
          const points = polygon.map(p => weighted(weights(p, triangle.world)!, triangle.screen));
          const left = Math.floor(Math.min(...points.map(p => p.x))), right = Math.ceil(Math.max(...points.map(p => p.x)));
          const top = Math.floor(Math.min(...points.map(p => p.y))), bottom = Math.ceil(Math.max(...points.map(p => p.y)));
          for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
            const center = { x: x + .5, y: y + .5 }, mapping = pixelWorld(center, source);
            if (mapping.kind !== "mapped" || !mapping.roles.includes(role)) continue;
            const world = mapping.world, offset = sign * (world.y - station.y);
            if (offset < from || offset > to || Math.abs(world.x - station.x) > .04 || classifyContinuousPathPoint(plan, world) !== role) continue;
            if (role === null && pixelWorld(center, pathTriangles).kind !== "none") continue;
            if (!(x >= 0 && x < image.width && y >= 0 && y < image.height)) throw new Error(`Exact ${role ?? "turf"} ROI pixel (${x},${y}) is outside ${image.width}x${image.height}`);
            found.set(`${x},${y}`, { x, y });
          }
        }
        return [...found.values()];
      };
      const certified = new Set<string>(), textureReads = new Set<string>();
      const certifyCore = (pixel: Pixel) => {
        textureReads.add(`${pixel.x}:${pixel.y}`);
        // The luminance callback is invoked for every disk pixel and every
        // x+1/y+1 neighbor actually read. Certify that exact finite read set
        // plus its full1px Chebyshev guard; this is not a continuum-disk claim.
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = pixel.x + dx, y = pixel.y + dy, key = `${x}:${y}`;
          if (certified.has(key)) continue;
          if (x < 0 || x >= image.width || y < 0 || y >= image.height) throw new Error(`Texture guard (${x},${y}) for read (${pixel.x},${pixel.y}) is outside image`);
          const mapping = pixelWorld({ x: x + .5, y: y + .5 }, pathTriangles);
          if (mapping.kind !== "mapped") throw new Error(`Texture guard (${x},${y}) for read (${pixel.x},${pixel.y}) has ${mapping.kind} projected coverage`);
          const role = classifyContinuousPathPoint(plan, mapping.world);
          if (!mapping.roles.includes("core") || role !== "core") {
            throw new Error(`Texture guard (${x},${y}) for read (${pixel.x},${pixel.y}) maps to world (${mapping.world.x},${mapping.world.y}), triangle roles ${mapping.roles.join(",")}, classified ${role}`);
          }
          certified.add(key);
        }
      };
      for (const station of stations) {
        for (const [role, from, to] of [["core", .08, .18], ["edge", .224, .258], ["shoulder", .270, .296]] as const) {
          const pixels = [-1, 1].flatMap(sign => {
            const samples = band(station, sign, from, to, role);
            expect(samples.length, `${role} has true-band pixels on normal ${sign}`).toBeGreaterThan(0); return samples;
          });
          expect(pixels.length, `${role} has at least one true-band pixel per station`).toBeGreaterThanOrEqual(1); rolePixels.get(role)!.push(...pixels);
        }
        turfPixels.push(...[-1, 1].flatMap(sign => band(station, sign, .35, .45, null)));
        const center = worldScreen(station, coreTriangles);
        // Fixed original cap: never shrink/search the disk or select by RGB.
        const radius = 9; expect(radius, "insufficient core texture pixels requires a closer evidence view").toBeGreaterThanOrEqual(3);
        expect(center.x - radius >= 1 && center.y - radius >= 1 && center.x + radius < image.width - 1 && center.y + radius < image.height - 1).toBe(true);
        textureCandidates.push(compactedCoreTextureStats(image, center, radius, certifyCore));
      }
      const core = mean(image, rolePixels.get("core")!), edge = mean(image, rolePixels.get("edge")!), shoulder = mean(image, rolePixels.get("shoulder")!);
      for (const region of [core, edge, shoulder]) expect(region.samples).toBeGreaterThanOrEqual(4);
      expect(colorDistance(core.rgb, edge.rgb)).toBeGreaterThan(18); expect(colorDistance(edge.rgb, shoulder.rgb)).toBeGreaterThan(18);
      const coreTexture = { candidateCount: textureCandidates.length, medianStandardDeviation: median(textureCandidates.map(s => s.standardDeviation)), medianNeighborDelta: median(textureCandidates.map(s => s.meanNeighborDelta)), medianFineEdgeRatio: median(textureCandidates.map(s => s.fineEdgeRatio)), medianPlateauRatio: median(textureCandidates.map(s => s.plateauRatio)), candidates: textureCandidates };
      expect(coreTexture.candidateCount).toBeGreaterThanOrEqual(6); expect(coreTexture.medianStandardDeviation).toBeGreaterThan(2.25); expect(coreTexture.medianNeighborDelta).toBeGreaterThan(.7); expect(coreTexture.medianFineEdgeRatio).toBeGreaterThan(.12); expect(coreTexture.medianPlateauRatio).toBeLessThan(.82);
      expect(await page.evaluate(() => (window.__coursecraftPixiTest as unknown as { setPathMaterialVisibilityForTest(v: boolean): boolean }).setPathMaterialVisibilityForTest(false))).toBe(true);
      const hidden = PNG.sync.read(await canvas.screenshot());
      await page.evaluate(() => (window.__coursecraftPixiTest as unknown as { setPathMaterialVisibilityForTest(v: boolean): boolean }).setPathMaterialVisibilityForTest(true));
      const mask = triangleMask(image.width, image.height, triangles); let outside = 0, changed = 0;
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (!mask[y * image.width + x]) { outside++; if (delta(image, hidden, { x, y }) > 18) changed++; }
      expect(outside).toBeGreaterThan(0); expect(changed / outside).toBeLessThan(.001);
      const changedByRole = Object.fromEntries([...rolePixels].map(([role, pixels]) => [role, pixels.filter(p => delta(image, hidden, p) > 18).length]));
      for (const role of ["core", "edge", "shoulder"]) expect(changedByRole[role]).toBeGreaterThan(0);
      expect(turfPixels.length).toBeGreaterThanOrEqual(12); expect(turfPixels.filter(p => delta(image, hidden, p) > 18)).toHaveLength(0);
      closePixelGates.push({ rotation, stations, spans: { core, edge, shoulder }, coreTexture, changedByRole, turfSamples: turfPixels.length, roi: { kind: "projected-final-triangles", paddingPx: 2, triangles: triangles.length }, outside: { samples: outside, changed, ratio: changed / outside }, diagnostic, camera: runtime.camera, pixelScale, mapping: "actual-Float32-triangle-barycentric", certifiedCorePixels: certified.size, textureReadPixels: textureReads.size, textureCertificate: "finite-read-and-neighbor-set-plus-1px-Chebyshev-guard; no continuum claim" });
    }
  expect(await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState())).toEqual(initial);
  expect(await page.evaluate(() => window.__coursecraftTest!.state().cash)).toBe(initialCash);
  expect(captures).toHaveLength(2); expect(closePixelGates).toHaveLength(1);
  await writeFile(resolve(outputRoot, `p714-path-material-r${rotation}-report.json`), JSON.stringify({ version: 3, issue: "ZK-714/ZK-1210", unit: `pixel-r${rotation}`, rotation, commit, sourceHashes, fixture: "m19Fixture", viewport: { width: 1440, height: 900 }, dpr: await page.evaluate(() => devicePixelRatio), retainedCaptures: captures.length, transientHiddenCaptures: closePixelGates.length, aggregateExpected: { rotations: [0, 90, 180, 270], retainedCaptures: 8, transientHiddenCaptures: 4 }, sampling: "six longitudinal stations, exact-role bands on both normals, aggregate >=4 per role; unchanged vocabulary thresholds", closePixelGates, captures }, null, 2));
}

for (const rotation of [0, 90, 180, 270] as const) {
  test(`P714 [pixel-r${rotation}] narrow original three-material vocabulary and final-triangle confinement`, async ({ page }) => {
    await acceptPixelRotation(page, rotation);
  });
}
