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
import { ELEVATION_STEP_PX, isoToWorld, worldToIso, type IsoRotation } from "../src/game/render/iso";
import type { Point } from "../src/game/models/types";

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
    expect(x >= 0 && x < image.width && y >= 0 && y < image.height, "ROI must be visible, never clamped").toBe(true);
    const offset = (y * image.width + x) * 4; for (let c = 0; c < 3; c++) sum[c] += image.data[offset + c];
  }
  return { samples: pixels.length, rgb: sum.map(value => value / pixels.length) };
}
function delta(image: PNG, hidden: PNG, { x, y }: Pixel) {
  const n = (y * image.width + x) * 4;
  return Math.abs(image.data[n] - hidden.data[n]) + Math.abs(image.data[n + 1] - hidden.data[n + 1]) + Math.abs(image.data[n + 2] - hidden.data[n + 2]);
}
function projected(point: Point, elevation: number, rotation: IsoRotation, camera: Camera): Point {
  const p = worldToIso(point.x, point.y, elevation, rotation);
  return { x: (p.x - camera.pivot.x) * camera.scale.x + camera.position.x, y: (p.y - camera.pivot.y) * camera.scale.y + camera.position.y };
}
function unprojected(point: Point, elevation: number, rotation: IsoRotation, camera: Camera): Point {
  return isoToWorld((point.x - camera.position.x) / camera.scale.x + camera.pivot.x,
    (point.y - camera.position.y) / camera.scale.y + camera.pivot.y + elevation * ELEVATION_STEP_PX, rotation);
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
async function pathDiagnostic(page: Page): Promise<PathDiagnostic> {
  return page.evaluate(() => (window.__coursecraftPixiTest!.rendererAtlasState() as unknown as { pathMaterialCrossSection: PathDiagnostic }).pathMaterialCrossSection);
}

function compactedCoreTextureStats(image: PNG, center: ScreenPoint, radius: number) {
  const luminance = (x: number, y: number) => {
    const offset = (y * image.width + x) * 4;
    return image.data[offset] * 0.2126 + image.data[offset + 1] * 0.7152 + image.data[offset + 2] * 0.0722;
  };
  const values: number[] = [];
  const neighborDeltas: number[] = [];
  const minX = Math.max(1, Math.floor(center.x - radius));
  const maxX = Math.min(image.width - 2, Math.ceil(center.x + radius));
  const minY = Math.max(1, Math.floor(center.y - radius));
  const maxY = Math.min(image.height - 2, Math.ceil(center.y + radius));
  const inside = (x: number, y: number) => (x - center.x) ** 2 + (y - center.y) ** 2 <= radius ** 2;
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


test("P714 [pixel] narrow original three-material vocabulary and final-triangle confinement through four rotations", async ({ page }) => {
  test.setTimeout(480_000); expect(commit).toMatch(/^[a-f0-9]{40}$/); await mkdir(outputRoot, { recursive: true });
  await page.addInitScript(() => localStorage.setItem("coursecraft_app_profile_v5", JSON.stringify({ version: 5, tutorialOffered: true, tutorialCompleted: true, accessibility: { reducedMotion: true } })));
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.setViewportSize({ width: 1440, height: 900 }); await page.goto("/?m19Fixture=1");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 90_000 }).toBe("game");
  await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest)); await page.evaluate(() => window.__coursecraftTest!.pauseLiveSimulation());
  const course = createParklandVisualReferenceCourse(); const plan = buildContinuousPathPlan(course);
  const initial = await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState()); expect(initial.tiles).toEqual(course.tiles);
  const canvas = page.locator("canvas").first(); await expect(canvas).toBeVisible();
  const captures: unknown[] = [], closePixelGates: unknown[] = [];
  // Six separated stations inside the verified flat straight run. Half-tile
  // spacing retains six longitudinal stations without sampling the x12 terrace.
  const stations = Array.from({ length: 6 }, (_, i) => ({ x: 7.8 + i * .5, y: 12.5 }));
  for (const station of stations) {
    expect(classifyContinuousPathPoint(plan, station)).toBe("core");
    expect(classifyContinuousPathPoint(plan, { x: station.x - 1, y: station.y })).toBe("core");
    expect(classifyContinuousPathPoint(plan, { x: station.x + 1, y: station.y })).toBe("core");
    for (const sign of [-1, 1]) for (const [role, offset] of [["core", .13], ["edge", .241], ["shoulder", .283]] as const) expect(classifyContinuousPathPoint(plan, { x: station.x, y: station.y + sign * offset })).toBe(role);
  }
  for (const rotation of [0, 90, 180, 270] as const) {
    if (rotation > 0) { await canvas.click({ position: { x: 8, y: 8 } }); await page.keyboard.press("e"); await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation)).toBe(rotation); }
    for (const view of [{ label: "normal", quality: "medium" as const, zoom: 1, focus: { x: 24, y: 18 } }, { label: "close", quality: "high" as const, zoom: 2.25, focus: { x: 9, y: 12.5 } }]) {
      await page.evaluate(({ quality, focus, zoom }) => { window.__coursecraftTest!.setGraphicsQualityFixture(quality); window.__coursecraftPixiTest!.focusTileForTest(focus.x, focus.y, zoom); }, view);
      await expect.poll(async () => { const d = await pathDiagnostic(page); return d.active && d.quality === view.quality && d.camera.rotation === rotation && Math.abs(d.camera.zoom - view.zoom) < .001; }, { timeout: 30_000 }).toBe(true);
      const diagnostic = await pathDiagnostic(page); expect(diagnostic.commit).toBe(commit); expect(diagnostic.mode).toBe("continuous"); expect(diagnostic.roles).toEqual(["shoulder", "edge", "core"]); expect(diagnostic.textureIds).toHaveLength(3);
      expect(diagnostic.widths.shoulder).toBeCloseTo(.036); expect(diagnostic.widths.edge).toBeCloseTo(.048); expect(diagnostic.ownership).toEqual(["accepted-path-coverage"]); expect(diagnostic.planKey).toBe(plan.key);
      const screenshot = await canvas.screenshot(); const file = resolve(outputRoot, `p714-pixel-r${rotation}-${view.label}.png`); await writeFile(file, screenshot); captures.push({ file, rotation, ...view, diagnostic });
      if (view.label !== "close") continue;
      const image = PNG.sync.read(screenshot);
      const worldPoints = plan.layers.flatMap(layer => Array.from({ length: layer.positions.length / 2 }, (_, n) => ({ x: layer.positions[n * 2], y: layer.positions[n * 2 + 1] })));
      const runtime = await page.evaluate(points => ({ camera: window.__coursecraftPixiTest!.cameraTransform()!.world, heights: points.map(p => window.__coursecraftPixiTest!.surfaceHeightAt(p.x, p.y)), stationHeights: Array.from({ length: 6 }, (_, i) => window.__coursecraftPixiTest!.surfaceHeightAt(7.8 + i * .5, 12.5)) }), worldPoints);
      expect(runtime.stationHeights.every(h => Math.abs(h - runtime.stationHeights[0]) < 1e-8), "pixel lane must remain flat").toBe(true);
      const projectedVertices = worldPoints.map((p, i) => projected(p, runtime.heights[i], rotation, runtime.camera));
      const triangles: Point[][] = []; let start = 0;
      for (const layer of plan.layers) { for (let i = 0; i < layer.indices.length; i += 3) triangles.push(layer.indices.slice(i, i + 3).map(n => projectedVertices[start + n])); start += layer.positions.length / 2; }
      const rolePixels = new Map<PathRibbonRole, Pixel[]>([["core", []], ["edge", []], ["shoulder", []]]);
      const turfPixels: Pixel[] = []; const textureCandidates: ReturnType<typeof compactedCoreTextureStats>[] = [];
      const elevation = runtime.stationHeights[0];
      const band = (station: Point, sign: number, from: number, to: number, role: PathRibbonRole | null): Pixel[] => {
        const a = projected({ x: station.x, y: station.y + sign * from }, elevation, rotation, runtime.camera), b = projected({ x: station.x, y: station.y + sign * to }, elevation, rotation, runtime.camera);
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 4)); const found = new Map<string, Pixel>();
        for (let i = 0; i <= steps; i++) {
          const x = Math.floor(a.x + (b.x - a.x) * i / steps), y = Math.floor(a.y + (b.y - a.y) * i / steps);
          const world = unprojected({ x: x + .5, y: y + .5 }, elevation, rotation, runtime.camera); const offset = sign * (world.y - station.y);
          if (offset < from || offset > to || Math.abs(world.x - station.x) > .04 || classifyContinuousPathPoint(plan, world) !== role) continue;
          expect(x >= 0 && x < image.width && y >= 0 && y < image.height).toBe(true); found.set(`${x},${y}`, { x, y });
        }
        return [...found.values()];
      };
      for (const station of stations) {
        for (const [role, from, to] of [["core", .08, .18], ["edge", .224, .258], ["shoulder", .270, .296]] as const) {
          const pixels = [-1, 1].flatMap(sign => band(station, sign, from, to, role));
          expect(pixels.length, `${role} has at least one true-band pixel per station`).toBeGreaterThanOrEqual(1); rolePixels.get(role)!.push(...pixels);
        }
        turfPixels.push(...[-1, 1].flatMap(sign => band(station, sign, .35, .45, null)));
        const center = projected(station, elevation, rotation, runtime.camera), along = projected({ x: station.x + 1, y: station.y }, elevation, rotation, runtime.camera), edge = projected({ x: station.x, y: station.y + .216 }, elevation, rotation, runtime.camera);
        const clearance = Math.abs(cross(center, along, edge)) / Math.hypot(along.x - center.x, along.y - center.y);
        const radius = Math.min(9, clearance - 1); expect(radius, "insufficient core texture pixels requires a closer evidence view").toBeGreaterThanOrEqual(3);
        expect(center.x - radius >= 1 && center.y - radius >= 1 && center.x + radius < image.width - 1 && center.y + radius < image.height - 1).toBe(true);
        textureCandidates.push(compactedCoreTextureStats(image, center, radius));
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
      closePixelGates.push({ rotation, stations, spans: { core, edge, shoulder }, coreTexture, changedByRole, turfSamples: turfPixels.length, roi: { kind: "projected-final-triangles", paddingPx: 2, triangles: triangles.length }, outside: { samples: outside, changed, ratio: changed / outside }, diagnostic, camera: runtime.camera });
    }
  }
  expect(await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState())).toEqual(initial);
  await writeFile(resolve(outputRoot, "p714-path-material-report.json"), JSON.stringify({ version: 2, issue: "ZK-714/ZK-1210", commit, sourceHashes, fixture: "m19Fixture", viewport: { width: 1440, height: 900 }, dpr: await page.evaluate(() => devicePixelRatio), retainedCaptures: 8, transientHiddenCaptures: 4, sampling: "six longitudinal stations, exact-role bands on both normals, aggregate >=4 per role; unchanged vocabulary thresholds", closePixelGates, captures }, null, 2));
});
