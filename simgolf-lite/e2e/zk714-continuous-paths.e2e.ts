import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { createNewGame } from "../src/game/gen/newGame";
import { createReferenceCourse } from "../src/game/testing/referenceCourse";
import { appendSurfaceFeature, corridorFeature, rasterizeSurfaceFeatureDetailed } from "../src/game/models/surfaceIntent";
import { prepareSurfaceFeatureEdit } from "../src/game/models/surfaceFeatureEdit";
import { computeTerrainBatch } from "../src/game/models/terrainStroke";
import { terrainCostMult } from "../src/game/balance/experience";
import { biomeCompatibilityMetadataFor } from "../src/game/models/biomes";
import { buildingEntrance } from "../src/game/models/buildings";
import { isOwnedTile } from "../src/game/estate/estate";
import type { Course, Point, SurfaceFeature, Terrain } from "../src/game/models/types";
import { buildContinuousPathPlan, classifyContinuousPathPoint, continuousPathPlanKey, type ContinuousPathPlan } from "../src/game/paths/continuousPathPlan";
import { worldToIso, type IsoRotation } from "../src/game/render/iso";
import { parseSaveText } from "../src/utils/save";
import { CURRENT_SAVE_SCHEMA_VERSION } from "../src/utils/saveFacade";
import type { SaveFile } from "../src/utils/saveStore";

// No factory/parser/G call at module scope: --list is authoring-only.
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const candidate = process.env.ZK714_COMMIT ?? process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim();
const evidence = resolve(process.env.ZK714_EVIDENCE_DIR ?? resolve(tmpdir(), "coursecraft-zk714-evidence", `${candidate.slice(0, 12)}-${createHash("sha256").update(projectRoot).digest("hex").slice(0, 8)}`));
const sourcePaths = ["src/game/paths/continuousPathPlan.ts", "src/game/paths/continuousPathRibbon.ts", "src/game/paths/continuousPathTopology.ts", "src/game/render/renderSnapshot.ts", "src/ui/renderer/scenes/pathMaterialScene.ts", "src/ui/renderer/scenes/surfaceEditorScene.ts", "src/ui/PixiStage.tsx", "src/App.tsx"] as const;
const sourceHashes = process.env.ZK714_SOURCE_HASHES ?? JSON.stringify(Object.fromEntries(sourcePaths.map(path => [path, createHash("sha256").update(readFileSync(resolve(projectRoot, path))).digest("hex")])));
const rotations = [0, 90, 180, 270] as const;
type Quality = "low" | "medium" | "high";
type Box = { minX: number; minY: number; maxX: number; maxY: number };
type FeatureView = { id: string; terrain: Terrain; kind: string; points: Point[]; tangents: unknown; width: number | null; coverage: number[]; renderRings: Point[][] };
type SurfaceState = { width: number; height: number; tiles: Terrain[]; elevations: number[]; owned: boolean[]; features: FeatureView[] };
type ComputeSample = { epoch: number; id: number; key: string; quoteMs: number; keyMs: number; buildMs: number; clipMs: number; drawMs: number; totalMs: number };
type Compute = { epoch: number; resolutionCount: number; buildCount: number; failedBuildCount: number; completedCount: number; samples: ComputeSample[] };
type PathDiagnostic = { active: boolean; mode: string; quality: Quality; roles: string[]; textureIds: string[]; ownership: string[]; planKey: string; commit: string; triangleCount: number; widthRange: { minimum: number; maximum: number }; camera: { rotation: IsoRotation; zoom: number; targetZoom: number } };

function featureView(feature: SurfaceFeature): FeatureView {
  const geometry = feature.geometry;
  return { id: feature.id, terrain: feature.terrain, kind: geometry.kind,
    points: geometry.kind === "corridor" ? geometry.knots : geometry.ring,
    tangents: geometry.tangents ?? null, width: geometry.kind === "corridor" ? geometry.width : null,
    coverage: feature.coverage, renderRings: feature.renderRings ?? [] };
}
function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function assertIdentity() {
  expect(candidate, "full candidate commit identity").toMatch(/^[a-f0-9]{40}$/);
  const manifest: unknown = JSON.parse(sourceHashes);
  expect(manifest && typeof manifest === "object" && !Array.isArray(manifest)).toBeTruthy();
  const entries = Object.entries(manifest as Record<string, unknown>);
  expect(entries.length).toBeGreaterThanOrEqual(4);
  for (const [path, digest] of entries) { expect(path.length).toBeGreaterThan(0); expect(digest).toMatch(/^[a-f0-9]{64}$/); }
  for (const path of sourcePaths) expect((manifest as Record<string, unknown>)[path]).toMatch(/^[a-f0-9]{64}$/);
}

/** Public, current-schema synthetic save; never accesses a user's stored slot. */
function fixture(kind: "matrix" | "editor" | "elevation" = "matrix", theme: Course["theme"] = "parkland", editorWidth = 1): SaveFile {
  const width = kind === "editor" ? 32 : 44; const height = kind === "editor" ? 24 : 56;
  const generated = createNewGame({ mode: "sandbox", courseName: `P714 public ${kind} ${theme}`, seed: 714031,
    theme, experienceProfile: "classic", economicPressure: "balanced" });
  const course: Course = { ...createReferenceCourse(), width, height, theme, biomeCompatibility: biomeCompatibilityMetadataFor(theme),
    name: `P714 public ${kind} ${theme}`, tiles: Array<Terrain>(width * height).fill("rough"),
    elevations: Array<number>(width * height).fill(0),
    holes: [{ id: "q-public-hole", name: "Unconfigured Q hole", tee: null, green: null, parMode: "AUTO" }],
    obstacles: [], buildings: [], decorations: [],
    estate: undefined, property: undefined, surfaceIntent: { version: 1, nextId: 1, features: [] } };
  const paint = (x: number, y: number) => { course.tiles[y * width + x] = "path"; };
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    const n = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let i = 0; i <= n; i++) paint(x1 + Math.sign(x2 - x1) * i, y1 + Math.sign(y2 - y1) * i);
  };
  const saved = (knots: Point[], envelope: number, tangents = false) => {
    const feature = corridorFeature(course, "path", knots, envelope);
    if (tangents && feature.geometry.kind === "corridor") feature.geometry.tangents = knots.map(point => ({ in: { x: point.x - .6, y: point.y }, out: { x: point.x + .6, y: point.y } }));
    const raster = rasterizeSurfaceFeatureDetailed(feature, width, height);
    feature.coverage = raster.tiles.map(point => point.y * width + point.x); feature.renderRings = raster.rings;
    feature.coverage.forEach(cell => { course.tiles[cell] = "path"; });
    course.surfaceIntent!.features.push(feature); course.surfaceIntent!.nextId++;
  };
  if (kind === "editor") {
    saved([{ x: 2.5, y: 3.5 }, { x: 6.5, y: 2.5 }, { x: 9.5, y: 6.5 }, { x: 13.5, y: 5.5 }], editorWidth, true);
    saved([{ x: 20.5, y: 5.5 }, { x: 28.5, y: 5.5 }], 1);
    course.property = { version: 2, assets: [], developments: [], units: [],
      easements: [{ id: "public-exclusion", kind: "maintenance", x: 16, y: 12, width: 1, height: 10, protected: true }],
      safetyPolicy: { restrictedTeeSets: [], closedHoleIds: [], exposureLimit: 0 } };
  } else {
    // Actual bounds, without padding from the frozen 16x16 fixture factories.
    // A: saved S + cross; B: loop + wide straight; C: T + stair diagonal;
    // D: bend + dead end. All four two-form banks fit zoom2.25 in 2560x1440.
    saved([{ x: 6.5, y: 7.5 }, { x: 10.5, y: 6.5 }, { x: 13.5, y: 10.5 }, { x: 17.5, y: 9.5 }], 1.5, true);
    line(8, 19, 14, 19); line(11, 16, 11, 22);
    line(27, 6, 33, 6); line(27, 12, 33, 12); line(27, 7, 27, 11); line(33, 7, 33, 11);
    saved([{ x: 25.5, y: 20.5 }, { x: 35.5, y: 20.5 }], 2.5);
    line(6, 35, 12, 35); line(9, 32, 9, 34);
    for (let i = 0; i < 6; i++) { paint(6 + i, 43 + i); if (i < 5) paint(7 + i, 43 + i); }
    line(25, 32, 31, 32); line(31, 33, 31, 38); line(25, 46, 31, 46);
    if (kind === "elevation") {
      course.elevations = course.elevations.map((_, cell) => {
        const x = cell % width, y = Math.floor(cell / width);
        // Stored elevation authority is integer steps; the renderer interpolates.
        return y < 24 ? Math.round(Math.max(0, x - 10) / 8) : x >= 29 ? 2 : 0;
      });
      course.buildings = [{ id: "public-shop", type: "pro_shop", x: 34, y: 18, tier: 1, price: 10 }];
    }
  }
  return { schemaVersion: CURRENT_SAVE_SCHEMA_VERSION, savedAt: 1_793_664_000_000, course,
    world: { ...generated.world, cash: 1_000_000, reputation: 100, isBankrupt: false }, history: [], tutorial: null };
}

function normalizedFixture(file: SaveFile): SaveFile {
  const result = parseSaveText(JSON.stringify(file));
  if (!result.ok) throw new Error(`public normalizer rejected ${file.course.name}: ${JSON.stringify(result.error)}`);
  expect(result.migratedFrom, "current-schema fixture must not migrate").toBeUndefined();
  expect(result.payload.course.width).toBe(file.course.width); expect(result.payload.course.height).toBe(file.course.height);
  expect(result.payload.course.tiles).toEqual(file.course.tiles);
  expect(result.payload.course.elevations).toEqual(file.course.elevations);
  expect(result.payload.course.surfaceIntent).toEqual(file.course.surfaceIntent);
  expect(result.payload.course.property?.easements ?? []).toEqual(file.course.property?.easements ?? []);
  expect(result.payload.world.cash).toBe(file.world.cash);
  return { ...file, ...result.payload };
}
async function surface(page: Page): Promise<SurfaceState> {
  return page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState()) as Promise<SurfaceState>;
}
async function cash(page: Page) { return page.evaluate(() => window.__coursecraftTest!.state().cash); }
async function diagnostic(page: Page): Promise<PathDiagnostic> {
  return page.evaluate(() => (window.__coursecraftPixiTest!.rendererAtlasState() as unknown as { pathMaterialCrossSection: PathDiagnostic }).pathMaterialCrossSection);
}
async function compute(page: Page): Promise<Compute> {
  return page.evaluate(() => (window.__coursecraftPixiTest!.rendererAtlasState() as unknown as { pathPreviewCompute: Compute }).pathPreviewCompute);
}
async function frame(page: Page) { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); }
async function rendererIdentity(page: Page) {
  return { browserVersion: page.context().browser()?.version() ?? null, context: await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
    if (!gl) return { backend: "unexposed", vendor: null, renderer: null, version: null };
    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    return { backend: gl instanceof WebGL2RenderingContext ? "webgl2" : "webgl", vendor: String(gl.getParameter(extension?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR)), renderer: String(gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)), version: String(gl.getParameter(gl.VERSION)) };
  }) };
}
async function boot(page: Page) {
  assertIdentity();
  await page.addInitScript(() => localStorage.setItem("coursecraft_app_profile_v5", JSON.stringify({ version: 5, tutorialOffered: true, tutorialCompleted: true, accessibility: { reducedMotion: true } })));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?m20Fixture=1");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 90_000 }).toBe("game");
  await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest));
  await expect.poll(async () => (await diagnostic(page)).commit).toBe(candidate);
}
const importedSlots = new WeakMap<Page, { count: number; name: string }>();
async function loadPublicSlot(page: Page, button: Locator, expectedKey: string) {
  // The saved state can be ready while the old Pixi effect is tearing down.
  // Hold its exact API identity so a same-key reload cannot pass on that API.
  const previous = await page.evaluateHandle(() => window.__coursecraftPixiTest ?? null);
  try {
    await button.click();
    await expect(page.getByTestId("save-load-screen")).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screenBase)).toBe("in-game");
    await page.waitForFunction(({ previous, expectedKey, candidate }) => {
      const api = window.__coursecraftPixiTest;
      if (!api || api === previous) return false;
      const viewport = api.viewport(), camera = api.cameraTransform();
      if (!viewport || !camera || ![viewport.width, viewport.height, camera.world.scale.x, camera.world.scale.y, camera.camera.zoom]
        .every(value => Number.isFinite(value) && value > 0)) return false;
      const state = (api.rendererAtlasState() as unknown as { pathMaterialCrossSection?: PathDiagnostic }).pathMaterialCrossSection;
      return Boolean(state?.active && state.mode === "continuous" && state.planKey === expectedKey && state.commit === candidate);
    }, { previous, expectedKey, candidate }, { timeout: 30_000 });
  } finally {
    await previous.dispose();
  }
}
async function publicLoad(page: Page, file: SaveFile) {
  if (!(await page.evaluate(() => window.__coursecraftTest!.state().paused))) await page.getByRole("button", { name: "Open pause menu", exact: true }).click();
  await page.getByRole("button", { name: /load game/i }).click();
  const previous = importedSlots.get(page);
  if (previous) {
    const old = page.locator("section.cc-save-load-slot").filter({ has: page.getByRole("heading", { name: previous.name, exact: true }) });
    await old.locator("button.cc-save-load-danger").click(); await old.locator("button.cc-save-load-danger").click(); await expect(old).toHaveCount(0);
  }
  const name = `P714-Q-${(previous?.count ?? 0) + 1}-${file.course.name}`;
  await page.locator("input[type=file][accept='.coursecraft,.json']").setInputFiles({ name: `${name}.coursecraft`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
  const slot = page.locator("section.cc-save-load-slot").filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(slot).toHaveCount(1); await loadPublicSlot(page, slot.getByRole("button", { name: "Load", exact: true }), continuousPathPlanKey(file.course));
  importedSlots.set(page, { count: (previous?.count ?? 0) + 1, name });
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screenBase)).toBe("in-game");
  await page.evaluate(() => window.__coursecraftTest!.pauseLiveSimulation());
  const loaded = await surface(page);
  expect(loaded.width).toBe(file.course.width); expect(loaded.height).toBe(file.course.height);
  expect(loaded.tiles).toEqual(file.course.tiles); expect(loaded.elevations).toEqual(file.course.elevations);
  expect(loaded.features).toEqual((file.course.surfaceIntent?.features ?? []).map(featureView));
  expect(await cash(page)).toBe(file.world.cash);
  expect(loaded.owned).toEqual(file.course.tiles.map((_, cell) => isOwnedTile(file.course, cell % file.course.width, Math.floor(cell / file.course.width))));
  return loaded;
}
async function rotate(page: Page, rotation: IsoRotation) {
  for (let i = 0; i < 4; i++) {
    const current = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation);
    if (current === rotation) return;
    await page.locator("canvas").first().click({ position: { x: 12, y: 12 } });
    await page.keyboard.press("e");
    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation)).toBe((current + 90) % 360);
  }
  throw new Error(`Unable to reach rotation ${rotation}`);
}
async function project(page: Page, points: readonly Point[], rotation: IsoRotation) {
  const view = await page.evaluate(points => ({ transform: window.__coursecraftPixiTest!.cameraTransform()!, heights: points.map(p => window.__coursecraftPixiTest!.surfaceHeightAt(p.x, p.y)) }), [...points]);
  const w = view.transform.world;
  return points.map((p, i) => {
    const iso = worldToIso(p.x, p.y, view.heights[i], rotation);
    return { x: (iso.x - w.pivot.x) * w.scale.x + w.position.x, y: (iso.y - w.pivot.y) * w.scale.y + w.position.y };
  });
}
function vertices(plan: ContinuousPathPlan, box: Box): Point[] {
  const points: Point[] = [];
  for (const layer of plan.layers) for (let i = 0; i < layer.indices.length; i += 3) {
    const triangle = layer.indices.slice(i, i + 3).map(n => ({ x: layer.positions[n * 2], y: layer.positions[n * 2 + 1] }));
    if (triangle.every(p => p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY)) points.push(...triangle);
  }
  expect(points.length, `nonempty final triangle ROI ${JSON.stringify(box)}`).toBeGreaterThan(0); return points;
}
const banks: readonly Box[] = [
  { minX: 5, maxX: 19, minY: 5, maxY: 24 }, { minX: 24, maxX: 37, minY: 5, maxY: 23 },
  { minX: 5, maxX: 14, minY: 31, maxY: 50 }, { minX: 24, maxX: 33, minY: 31, maxY: 48 },
];
function union(a: Box, b: Box): Box { return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) }; }

async function capture(page: Page, info: TestInfo, file: SaveFile, plan: ContinuousPathPlan, label: string, box: Box, zoom: number, rotation: IsoRotation, quality: Quality) {
  assertIdentity();
  await rotate(page, rotation);
  const roi = vertices(plan, box);
  const bounds = { minX: Math.min(...roi.map(p => p.x)), maxX: Math.max(...roi.map(p => p.x)), minY: Math.min(...roi.map(p => p.y)), maxY: Math.max(...roi.map(p => p.y)) };
  await page.evaluate(({ quality, x, y, zoom }) => { window.__coursecraftTest!.setGraphicsQualityFixture(quality); window.__coursecraftPixiTest!.focusTileForTest(x, y, zoom); }, { quality, x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2, zoom });
  await expect.poll(async () => { const d = await diagnostic(page); return d.active && d.quality === quality && d.camera.rotation === rotation && Math.abs(d.camera.zoom - zoom) < .001; }, { timeout: 30_000 }).toBe(true);
  const d = await diagnostic(page);
  const atlas = await page.evaluate(() => window.__coursecraftPixiTest!.rendererAtlasState());
  expect(atlas.requested.biome).toBe(file.course.theme); expect(atlas.rendered.biome).toBe(file.course.theme);
  expect(atlas.requested.quality).toBe(quality); expect(atlas.rendered.quality).toBe(quality);
  expect(d.mode).toBe("continuous"); expect(d.roles).toEqual(["shoulder", "edge", "core"]);
  expect(d.textureIds).toHaveLength(3); expect(d.textureIds.every(id => typeof id === "string" && id.length > 0)).toBe(true);
  expect(d.ownership).toEqual(["accepted-path-coverage"]); expect(d.planKey).toBe(plan.key); expect(d.triangleCount).toBeGreaterThan(0);
  expect(d.widthRange.minimum).toBeCloseTo(.6); expect(d.widthRange.maximum).toBeCloseTo(1.5);
  const projected = await project(page, roi, rotation); const canvas = page.locator("canvas").first(); const rect = await canvas.boundingBox();
  expect(rect).not.toBeNull();
  expect(projected.every(p => p.x >= 8 && p.y >= 8 && p.x <= rect!.width - 8 && p.y <= rect!.height - 8), `all final triangles visible at actual zoom${zoom}; ${JSON.stringify({ bounds, projected: { minX: Math.min(...projected.map(p => p.x)), maxX: Math.max(...projected.map(p => p.x)), minY: Math.min(...projected.map(p => p.y)), maxY: Math.max(...projected.map(p => p.y)) }, rect })}`).toBe(true);
  const visible = await canvas.evaluate(node => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const bounds = node.getBoundingClientRect();
    const clip = { left: Math.max(0, bounds.left), right: Math.min(viewport.width, bounds.right), top: Math.max(0, bounds.top), bottom: Math.min(viewport.height, bounds.bottom) };
    const clippedBy: { element: string; overflowX: string; overflowY: string }[] = [];
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent); const box = parent.getBoundingClientRect();
      const clipX = style.overflowX !== "visible", clipY = style.overflowY !== "visible";
      if (clipX) { clip.left = Math.max(clip.left, box.left + parent.clientLeft); clip.right = Math.min(clip.right, box.left + parent.clientLeft + parent.clientWidth); }
      if (clipY) { clip.top = Math.max(clip.top, box.top + parent.clientTop); clip.bottom = Math.min(clip.bottom, box.top + parent.clientTop + parent.clientHeight); }
      if (clipX || clipY) clippedBy.push({ element: parent.tagName.toLowerCase(), overflowX: style.overflowX, overflowY: style.overflowY });
    }
    return { viewport, clip, clippedBy };
  });
  expect(projected.every(p => p.x + rect!.x >= 8 && p.y + rect!.y >= 8
    && p.x + rect!.x <= visible.viewport.width - 8 && p.y + rect!.y <= visible.viewport.height - 8
    && p.x + rect!.x >= visible.clip.left + 8 && p.x + rect!.x <= visible.clip.right - 8
    && p.y + rect!.y >= visible.clip.top + 8 && p.y + rect!.y <= visible.clip.bottom - 8),
  `all final triangles must be in page viewport and effective canvas clipping intersection: ${JSON.stringify({ label, zoom, rect, visible })}`).toBe(true);
  const identity = { candidate, sourceHashes, fixtureHash: hash(file), theme: file.course.theme, label, zoom, rotation, quality, viewport: page.viewportSize(), roiVisibility: visible, dpr: await page.evaluate(() => devicePixelRatio), browser: await rendererIdentity(page), diagnostic: d, camera: await page.evaluate(() => window.__coursecraftPixiTest!.cameraTransform()), renderer: await page.evaluate(() => window.__coursecraftPixiTest!.rendererAtlasState()), roi: bounds };
  await mkdir(evidence, { recursive: true });
  const path = resolve(evidence, `${label}.png`); await canvas.screenshot({ path });
  await writeFile(resolve(evidence, `${label}.json`), JSON.stringify(identity, null, 2));
  await info.attach(label, { path, contentType: "image/png" });
}

function fixtureDefinitionHash() {
  const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const from = source.indexOf("function fixture("); const to = source.indexOf("\nfunction normalizedFixture(", from);
  if (from < 0 || to < 0) throw new Error("Q-F frozen fixture definition is missing");
  return createHash("sha256").update(source.slice(from, to)).digest("hex");
}
type FixtureKind = "matrix" | "editor" | "elevation";
type FrozenFixturePacket = { version: 1; sha256Encoding: string; candidate: string; sourceSHA256: string;
  fixtureDefinitionSHA256: string; fixtures: Record<FixtureKind, { sha256: string; payload: SaveFile }>;
  parserCases: { kind: FixtureKind; theme: Course["theme"]; sha256: string }[] };

test("P714 [fixture-parser] nine real public normalizer cases, zero G builds, exact frozen inputs", async () => {
  const fixtures: Partial<FrozenFixturePacket["fixtures"]> = {}; const parserCases: FrozenFixturePacket["parserCases"] = [];
  const definitionSHA256 = fixtureDefinitionHash();
  expect(definitionSHA256, "correction3 fixture input definition remains byte-for-byte frozen").toBe("ad34df93b70d976811093ef98fe59b3f07a8dea75e9b624b4a485f93d56d2698");
  for (const kind of ["matrix", "editor", "elevation"] as const) {
    console.log(`Q-F generation:start ${kind}`);
    const input = fixture(kind);
    console.log(`Q-F generation:end ${kind}`);
    let base: SaveFile | undefined;
    for (const theme of ["parkland", "links", "desert"] as const) {
      console.log(`Q-F parser:start ${kind}/${theme}`);
      const themed = theme === "parkland" ? input : { ...base!, course: { ...base!.course, theme, biomeCompatibility: biomeCompatibilityMetadataFor(theme) } };
      const normalized = normalizedFixture(themed);
      parserCases.push({ kind, theme, sha256: hash(normalized) });
      if (theme === "parkland") { base = normalized; fixtures[kind] = { sha256: hash(normalized), payload: normalized }; }
      console.log(`Q-F parser:end ${kind}/${theme}`);
    }
  }
  expect(parserCases).toHaveLength(9);
  const packet: FrozenFixturePacket = { version: 1, sha256Encoding: "UTF-8 JSON.stringify(payload), no trailing newline", candidate,
    sourceSHA256: createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex"),
    fixtureDefinitionSHA256: definitionSHA256, fixtures: fixtures as FrozenFixturePacket["fixtures"], parserCases };
  await mkdir(evidence, { recursive: true });
  const path = resolve(evidence, "public-normalized-fixtures.json");
  await writeFile(path, JSON.stringify(packet, null, 2));
  console.log(`Q-F persisted ${path} ${JSON.stringify(Object.fromEntries(Object.entries(packet.fixtures).map(([kind, entry]) => [kind, entry.sha256])))}`);
});

// Runs after [fixture-parser] in the default nonparallel file order. A standalone
// invocation requires its exact verified public-normalized-fixtures.json first.
test("P714 [fixture-geometry] full frozen-input G width topology and confinement criteria", async () => {
  const packet = JSON.parse(await readFile(resolve(evidence, "public-normalized-fixtures.json"), "utf8")) as FrozenFixturePacket;
  expect(packet.version).toBe(1); expect(packet.fixtureDefinitionSHA256).toBe(fixtureDefinitionHash());
  // Exactly three plans; all parser work and fixture generation are separate.
  for (const kind of ["matrix", "editor", "elevation"] as const) {
    const entry = packet.fixtures[kind]; expect(hash(entry.payload)).toBe(entry.sha256); const file = entry.payload;
    console.log(`Q-F geometry:build:start ${kind}`); const buildStarted = performance.now();
    const plan = buildContinuousPathPlan(file.course);
    console.log(`Q-F geometry:build:end ${kind} ${JSON.stringify({ buildMs: performance.now() - buildStarted, triangles: plan.layers.reduce((sum, layer) => sum + layer.indices.length / 3, 0) })}`);
    for (const theme of ["parkland", "links", "desert"] as const) {
      const themedCourse: Course = { ...file.course, theme, biomeCompatibility: biomeCompatibilityMetadataFor(theme) };
      expect(continuousPathPlanKey(themedCourse)).toBe(plan.key);
    }
    expect(plan.key).toBe(continuousPathPlanKey(file.course));
    expect(plan.coverage).toEqual(file.course.tiles.flatMap((terrain, cell) => terrain === "path" ? [cell] : []));
    expect(plan.layers.map(layer => layer.role)).toEqual(["shoulder", "edge", "core"]);
    expect(plan.edges.some(edge => edge.source === "intent")).toBe(true);
    const containment = { checked: 0, degenerate: 0, violations: 0, examples: [] as unknown[] };
    console.log(`Q-F geometry:validation:start ${kind}`); const validationStarted = performance.now();
    for (const layer of plan.layers) for (let i = 0; i < layer.indices.length; i += 3) {
      const ns = layer.indices.slice(i, i + 3); const triangle = ns.map(n => ({ x: layer.positions[n * 2], y: layer.positions[n * 2 + 1] }));
      const x = Math.floor(triangle.reduce((s, p) => s + p.x, 0) / 3), y = Math.floor(triangle.reduce((s, p) => s + p.y, 0) / 3);
      const area = (triangle[1].x - triangle[0].x) * (triangle[2].y - triangle[0].y) - (triangle[1].y - triangle[0].y) * (triangle[2].x - triangle[0].x);
      if (Math.abs(area) < 1e-12) { containment.degenerate++; continue; }
      containment.checked++;
      // All three vertices in one convex charged tile proves whole containment.
      const charged = file.course.tiles[y * file.course.width + x] === "path";
      const inside = triangle.every(p => p.x >= x - 1e-8 && p.x <= x + 1 + 1e-8 && p.y >= y - 1e-8 && p.y <= y + 1 + 1e-8);
      if (!charged || !inside) {
        containment.violations++;
        if (containment.examples.length < 10) containment.examples.push({ role: layer.role, triangleIndex: i / 3, triangle, cell: [x, y], charged, inside });
      }
    }
    console.log(`Q-F geometry:validation:end ${kind} ${JSON.stringify({ ...containment, validationMs: performance.now() - validationStarted })}`);
    expect(containment, `every triangle checked; first ten failures ${JSON.stringify(containment.examples)}`).toMatchObject({ violations: 0 });
    if (kind !== "editor") {
      expect(plan.diagnostics.loopCount).toBeGreaterThan(0);
      expect(plan.diagnostics.junctionCount).toBeGreaterThanOrEqual(2);
      expect(classifyContinuousPathPoint(plan, { x: 30.5, y: 9.5 })).toBeNull();
      expect(classifyContinuousPathPoint(plan, { x: 6.9, y: 44.1 })).toBeNull();
      expect(plan.edges.some(edge => Math.abs(edge.width - .9) < 1e-9)).toBe(true);
      expect(plan.edges.some(edge => Math.abs(edge.width - 1.5) < 1e-9)).toBe(true);
    } else expect(isOwnedTile(file.course, 16, 14)).toBe(false);
    if (kind === "elevation") expect(buildingEntrance(file.course, file.course.buildings![0])).toEqual({ x: 35, y: 20 });
  }
});

test("P714 [pilot] parkland high saved-S and cross close rotation0", async ({ page }, info) => {
  await page.setViewportSize({ width: 2560, height: 1440 }); await boot(page);
  const file = normalizedFixture(fixture()); await publicLoad(page, file);
  await capture(page, info, file, buildContinuousPathPlan(file.course), "close-bank0-r0", banks[0], 2.25, 0, "high");
});

test("P714 [visual-matrix] 36 bounded captures at actual normal1 and close2.25", async ({ page }, info) => {
  test.setTimeout(1_800_000); await page.setViewportSize({ width: 2560, height: 1440 }); await boot(page);
  const file = normalizedFixture(fixture()); const loaded = await publicLoad(page, file); const plan = buildContinuousPathPlan(file.course);
  let captures = 0;
  for (const rotation of rotations) {
    for (let bank = 0; bank < 2; bank++) { await capture(page, info, file, plan, `normal-bank${bank}-r${rotation}`, union(banks[bank * 2], banks[bank * 2 + 1]), 1, rotation, "high"); captures++; }
    for (let bank = 0; bank < 4; bank++) {
      if (bank === 0 && rotation === 0 && process.env.ZK714_PILOT_CAPTURE_ACCEPTED === "1") {
        const prior = JSON.parse(await readFile(resolve(evidence, "close-bank0-r0.json"), "utf8"));
        expect(prior).toMatchObject({ candidate, sourceHashes, fixtureHash: hash(file), zoom: 2.25, rotation: 0, quality: "high" });
      } else { await capture(page, info, file, plan, `close-bank${bank}-r${rotation}`, banks[bank], 2.25, rotation, "high"); captures++; }
    }
  }
  expect(await surface(page)).toEqual(loaded);
  for (const theme of ["parkland", "links", "desert"] as const) for (const quality of ["low", "medium", "high"] as const) {
    if (theme === "parkland" && quality === "high") continue;
    const themed = normalizedFixture(fixture("matrix", theme)); await publicLoad(page, themed);
    await capture(page, info, themed, buildContinuousPathPlan(themed.course), `representative-${theme}-${quality}`, banks[0], 2.25, 0, quality); captures++;
  }
  await publicLoad(page, file);
  for (const [width, height, zoom] of [[390, 844, 1], [1024, 768, 2.25]]) {
    await page.setViewportSize({ width, height });
    await page.getByRole("button", { name: "Expand design dock" }).click();
    await page.getByTestId("design-card-terrain-path").click(); await expect(page.getByTestId("design-path-width")).toBeVisible();
    await page.getByTestId("design-tool-edit").click(); await expect(page.getByTestId("design-tool-edit")).toBeVisible();
    await capture(page, info, file, plan, `responsive-${width}x${height}`, { minX: 24, maxX: 33, minY: 45, maxY: 48 }, zoom, 0, "medium"); captures++;
    await page.getByRole("button", { name: "Collapse design dock" }).click();
  }
  await page.setViewportSize({ width: 2560, height: 1440 });
  const elevated = normalizedFixture(fixture("elevation")); await publicLoad(page, elevated); const elevatedPlan = buildContinuousPathPlan(elevated.course);
  for (const rotation of [0, 90] as const) { await capture(page, info, elevated, elevatedPlan, `elevation-chunk-entrance-r${rotation}`, union(banks[0], banks[1]), 1, rotation, "high"); captures++; }
  expect(captures).toBe(process.env.ZK714_PILOT_CAPTURE_ACCEPTED === "1" ? 35 : 36);
});

async function openDesignDock(page: Page) {
  // Loading remounts the dock in its collapsed state. These public controls
  // restore its workspace/mode without changing the terrain tool or draft.
  await page.getByTestId("workspace-design").click();
  await expect(page.getByTestId("workspace-design")).toHaveAttribute("aria-current", "page");
  await page.locator('[data-tutorial-target="editor-tools"]').getByRole("button", { name: "Design", exact: true }).click();
  const dock = page.getByTestId("design-dock"); await expect(dock).toBeVisible();
  if (await dock.getAttribute("data-collapsed") === "true") await page.getByRole("button", { name: "Expand design dock", exact: true }).click();
  await expect(dock).toHaveAttribute("data-collapsed", "false");
}
async function editorReady(page: Page, file: SaveFile) {
  await page.setViewportSize({ width: 1600, height: 1000 }); await boot(page); await publicLoad(page, file);
  await openDesignDock(page); await page.getByTestId("design-card-terrain-path").click();
  await page.evaluate(() => window.__coursecraftPixiTest!.focusTileForTest(8, 5, 1.5)); await frame(page);
}
async function mousePoint(page: Page, point: Point) {
  const p = (await project(page, [point], 0))[0]; const canvas = page.locator(".cc-pixi-stage canvas").first(); const box = await canvas.boundingBox();
  expect(box).not.toBeNull(); expect(p.x >= 8 && p.y >= 8 && p.x <= box!.width - 8 && p.y <= box!.height - 8, `gesture point must be inside canvas: ${JSON.stringify({ point, projected: p, box })}`).toBe(true);
  const position = { x: p.x + box!.x, y: p.y + box!.y };
  const target = await canvas.evaluate((node, position) => {
    const hit = document.elementFromPoint(position.x, position.y);
    return { isMainCanvas: hit === node, viewport: { width: window.innerWidth, height: window.innerHeight },
      hit: hit ? { tag: hit.tagName.toLowerCase(), className: hit.getAttribute("class"), testId: hit.getAttribute("data-testid"), label: hit.getAttribute("aria-label") } : null };
  }, position);
  expect(position.x >= 8 && position.y >= 8 && position.x <= target.viewport.width - 8 && position.y <= target.viewport.height - 8, `gesture point must be on screen: ${JSON.stringify({ point, position, target })}`).toBe(true);
  expect(target.isMainCanvas, `gesture must reach the actual main canvas: ${JSON.stringify({ point, position, target })}`).toBe(true);
  return position;
}
async function selectS(page: Page, point = { x: 4.5, y: 3 }) {
  const before = await surface(page), beforeCash = await cash(page);
  await page.evaluate(() => window.__coursecraftPixiTest!.focusTileForTest(8, 5, 1.5)); await frame(page);
  // First-segment t=.5 is (4.5,3), inside the saved S and away from every
  // node/handle. A node click starts a drag and pointer-up commits input-plane
  // coordinates, so it is an edit gesture rather than selection-only setup.
  await page.getByTestId("design-tool-edit").click(); const p = await mousePoint(page, point); await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId("surface-authoring-instructions")).toContainText("Drag gold nodes");
  expect(await surface(page), "selecting the saved stroke must preserve all authoritative geometry/coverage").toEqual(before);
  expect(await cash(page), "selection-only setup must neither charge nor refund").toBe(beforeCash);
}
function candidateWidth(file: SaveFile, width: number, current?: Course) {
  const course = current ?? file.course; const source = course.surfaceIntent!.features[0];
  if (source.geometry.kind !== "corridor") throw new Error("fixture corridor");
  const feature = { ...source, geometry: { ...source.geometry, width } };
  const prepared = prepareSurfaceFeatureEdit(course, feature, file.world.cash, terrainCostMult(file.world.economicPressure ?? "balanced"), file.world.reputation)!;
  expect(prepared.commitAllowed).toBe(true); return prepared;
}

test("P714 [ui-prefix] width draft cancel apply undo redo and exact public reload", async ({ page }, info) => {
  const file = normalizedFixture(fixture("editor")); await editorReady(page, file); const initial = await surface(page); const initialCash = await cash(page);
  await selectS(page);
  const expected = candidateWidth(file, 2.5);
  expect(expected.preview.changedCount).toBeGreaterThan(0); expect(expected.preview.net).toBeGreaterThan(0);
  const beforeDraft = await compute(page);
  await page.getByTestId("design-path-width").selectOption("2.5"); await expect(page.getByTestId("design-path-width-apply")).toBeEnabled();
  const expectedKey = continuousPathPlanKey({ ...file.course, tiles: expected.tiles, surfaceIntent: expected.intent });
  await expect.poll(async () => { const current = await compute(page); return { completed: current.completedCount > beforeDraft.completedCount, key: current.samples.at(-1)?.key ?? null }; }).toEqual({ completed: true, key: expectedKey });
  expect(await surface(page)).toEqual(initial); expect(await cash(page)).toBe(initialCash);
  const draft = await compute(page); expect(draft.samples.at(-1)?.key).toBe(continuousPathPlanKey({ ...file.course, tiles: expected.tiles, surfaceIntent: expected.intent }));
  await page.getByTestId("design-path-width-cancel").click(); expect(await surface(page)).toEqual(initial);
  await page.getByTestId("design-path-width").selectOption("2.5"); await page.getByTestId("design-path-width-apply").click();
  await expect.poll(async () => (await surface(page)).features[0].width).toBe(2.5);
  const applied = await surface(page); expect(applied.tiles).toEqual(expected.tiles); expect(applied.features).toEqual(expected.intent.features.map(featureView)); expect(await cash(page)).toBe(expected.preview.projectedCash);
  expect(applied.features[1]).toEqual(initial.features[1]); expect((await diagnostic(page)).planKey).toBe(draft.samples.at(-1)!.key);
  await page.getByRole("button", { name: "Undo terrain edit", exact: true }).click(); expect(await surface(page)).toEqual(initial); expect(await cash(page)).toBe(initialCash);
  await page.getByRole("button", { name: "Redo terrain edit", exact: true }).click(); expect(await surface(page)).toEqual(applied); expect(await cash(page)).toBe(expected.preview.projectedCash);
  await page.getByTestId("design-dock").locator(".cc-design-toolbar strong").click(); await page.keyboard.press("Control+KeyS");
  await expect(page.locator('.sr-only[role="status"]')).toContainText("Quick save complete", { timeout: 30_000 });
  await page.getByRole("button", { name: "Open pause menu", exact: true }).click(); await page.getByRole("button", { name: /load game/i }).click();
  await loadPublicSlot(page, page.getByTestId("save-slot-quick-save").getByRole("button", { name: "Load", exact: true }), expectedKey); await page.evaluate(() => window.__coursecraftTest!.pauseLiveSimulation());
  expect(await surface(page)).toEqual(applied); expect(await cash(page)).toBe(expected.preview.projectedCash); expect((await diagnostic(page)).planKey).toBe(draft.samples.at(-1)!.key);
  await info.attach("width-edit-persistence-prefix", { body: Buffer.from(JSON.stringify({ candidate, sourceHashes, fixtureHash: hash(file), expectedCash: expected.preview.projectedCash, expectedKey, draft,
    scope: "width draft, cancel, apply, undo, redo, and exact public quick-save reload; affordability and custom load are independent tests",
    priorRootAcceptance: { candidate: "aa9067d58738d7f28f2747ae2c9dceefdf76d836", successfulExpectSteps: 85, traceSHA256: "4a0879897caf89f2da672c37b84432f796ce28f8aeb3ee4b94712fc0804c09d0" } }, null, 2)), contentType: "application/json" });
});

test("P714 [ui-affordability] unaffordable saved-path expansion preserves authoritative state and cash", async ({ page }, info) => {
  const file = normalizedFixture(fixture("editor")); await editorReady(page, file); await selectS(page);
  const initial = await surface(page); const expected = candidateWidth(file, 2.5);
  expect(expected.preview.changedCount).toBeGreaterThan(0); expect(expected.preview.net).toBeGreaterThan(0);
  await page.getByTestId("design-path-width").selectOption("2.5"); await expect(page.getByTestId("design-path-width-apply")).toBeEnabled();
  expect(await surface(page)).toEqual(initial); expect(await cash(page)).toBe(file.world.cash);
  await page.evaluate(() => window.__coursecraftTest!.setPaintCash(0));
  await expect(page.getByTestId("design-path-width-apply")).toBeDisabled(); expect(await surface(page)).toEqual(initial); expect(await cash(page)).toBe(0);
  await page.getByTestId("design-path-width-cancel").click();
  await expect(page.getByTestId("design-path-width-apply")).toHaveCount(0); await expect(page.getByTestId("design-path-width")).toHaveValue("1");
  expect(await surface(page)).toEqual(initial); expect(await cash(page)).toBe(0);
  await info.attach("unaffordable-width-contract", { body: Buffer.from(JSON.stringify({ candidate, sourceHashes, fixtureHash: hash(file), positiveExpansionNet: expected.preview.net, expectedCash: 0 }, null, 2)), contentType: "application/json" });
});

test("P714 [ui-custom-load] same-ID public custom-width load clears an existing width draft", async ({ page }, info) => {
  const file = normalizedFixture(fixture("editor")); await editorReady(page, file); await selectS(page); const initial = await surface(page);
  await page.getByTestId("design-path-width").selectOption("1.5"); await expect(page.getByTestId("design-path-width-apply")).toBeEnabled();
  expect(await surface(page)).toEqual(initial); expect(await cash(page)).toBe(file.world.cash);
  const custom = normalizedFixture(fixture("editor", "parkland", 1.7));
  expect(custom.course.surfaceIntent!.features[0].id).toBe(file.course.surfaceIntent!.features[0].id);
  const customSaveState = await publicLoad(page, custom);
  // Do not reselect the Path card here: that action itself clears a width
  // draft. Opening the dock preserves the tool/draft so these checks can fail.
  await openDesignDock(page);
  await expect(page.getByTestId("design-path-width-apply")).toHaveCount(0);
  await expect(page.getByTestId("design-tool-curve")).toHaveAttribute("aria-pressed", "true");
  expect(await surface(page)).toEqual(customSaveState); expect(await cash(page)).toBe(custom.world.cash);
  expect(customSaveState.features[0].width).toBe(1.7);
  await selectS(page); await expect(page.getByTestId("design-path-width")).toHaveValue("1.7");
  await expect(page.getByTestId("design-path-width-apply")).toHaveCount(0);
  expect(await surface(page)).toEqual(customSaveState); expect(await cash(page)).toBe(custom.world.cash);
  await info.attach("custom-load-width-contract", { body: Buffer.from(JSON.stringify({ candidate, sourceHashes, fixtureHash: hash(file), customFixtureHash: hash(custom), sameFeatureId: customSaveState.features[0].id, expectedWidth: 1.7 }, null, 2)), contentType: "application/json" });
});

test("P714 [ui-paint] each path width paints through actual spline UI and excludes protected gap", async ({ page }) => {
  const file = normalizedFixture(fixture("editor")); await editorReady(page, file);
  await page.getByRole("button", { name: "Collapse course minimap", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open course minimap", exact: true })).toBeVisible();
  let currentCourse = file.course;
  for (const [index, width] of [1, 1.5, 2.5].entries()) {
    await page.evaluate(y => window.__coursecraftPixiTest!.focusTileForTest(13, y, 1.5), 14.5 + index * 3); await frame(page);
    const before = await surface(page), beforeCash = await cash(page); await page.getByTestId("design-tool-spline").click(); await page.getByTestId("design-path-width").selectOption(String(width));
    for (const p of [{ x: 5.5, y: 14.5 + index * 3 }, { x: 20.5, y: 14.5 + index * 3 }]) { const screen = await mousePoint(page, p); await page.mouse.click(screen.x, screen.y); }
    await frame(page); expect(await surface(page)).toEqual(before); await page.keyboard.press("Enter");
    await expect.poll(async () => (await surface(page)).features.length).toBe(before.features.length + 1);
    const after = await surface(page); const added = after.features.at(-1)!; expect(added.width).toBe(width);
    // Pointer inversion may quantize knots. Quote the actual accepted UI
    // geometry against the pre-stroke course through existing pure authority.
    const raw = corridorFeature(currentCourse, "path", added.points, width);
    const raster = rasterizeSurfaceFeatureDetailed(raw, currentCourse.width, currentCourse.height);
    const quote = computeTerrainBatch({ course: currentCourse, tiles: raster.tiles.map(p => ({ ...p, terrain: "path" as const })), cash: beforeCash,
      costMult: terrainCostMult(file.world.economicPressure ?? "balanced"), reputation: file.world.reputation, protectedTrees: file.world.constraints?.protectedTrees });
    expect(quote.affordable).toBe(true); expect(quote.excluded.unowned).toBeGreaterThan(0);
    const accepted = new Set(quote.acceptedTiles.map(p => p.y * currentCourse.width + p.x));
    const clipped = rasterizeSurfaceFeatureDetailed(raw, currentCourse.width, currentCourse.height, accepted);
    const expectedFeature = { ...raw, coverage: clipped.tiles.map(p => p.y * currentCourse.width + p.x), renderRings: clipped.rings };
    const tiles = [...currentCourse.tiles]; quote.tiles.forEach(p => { tiles[p.y * currentCourse.width + p.x] = p.terrain; });
    currentCourse = { ...currentCourse, tiles, surfaceIntent: appendSurfaceFeature({ ...currentCourse, tiles }, expectedFeature) };
    expect(after.tiles).toEqual(currentCourse.tiles); expect(after.features).toEqual(currentCourse.surfaceIntent!.features.map(featureView)); expect(await cash(page)).toBe(quote.projectedCash);
    expect(added.coverage.length).toBeGreaterThan(0); expect(added.coverage.every(cell => cell % after.width !== 16)).toBe(true);
    expect(after.tiles[16 + (14 + index * 3) * after.width]).toBe("rough"); expect(after.features[1]).toEqual(before.features[1]);
  }
});

test("P714 [compute] complete changed S previews and unchanged updates keep original budgets", async ({ page }, info) => {
  test.setTimeout(300_000); const file = normalizedFixture(fixture("editor")); await editorReady(page, file); await selectS(page);
  await page.evaluate(() => window.__coursecraftTest!.resetM35Metrics());
  const initial = await surface(page); const samples: ComputeSample[] = [];
  for (let i = 0; i < 21; i++) {
    const before = await compute(page); await page.getByTestId("design-path-width").selectOption(i % 2 ? "1.5" : "2.5");
    await expect.poll(async () => (await compute(page)).completedCount, { timeout: 30_000 }).toBeGreaterThan(before.completedCount);
    const after = await compute(page); const next = after.samples.filter(s => s.id > (before.samples.at(-1)?.id ?? 0));
    expect(next).toHaveLength(1); expect(next[0].key).not.toBe(samples.at(-1)?.key); samples.push(next[0]);
    expect(await surface(page)).toEqual(initial);
  }
  const cold = samples[0], changed = samples.slice(1); expect(changed).toHaveLength(20);
  for (const sample of samples) {
    const phases = [sample.quoteMs, sample.keyMs, sample.buildMs, sample.clipMs, sample.drawMs];
    expect(phases.every(n => Number.isFinite(n) && n >= 0)).toBe(true); expect(sample.totalMs).toBeCloseTo(phases.reduce((a, b) => a + b, 0), 8);
  }
  const beforeStable = await compute(page);
  for (let i = 0; i < 20; i++) {
    await page.evaluate(i => { window.__coursecraftPixiTest!.setZoomForTest(i % 2 ? 1.5 : 1.55); window.__coursecraftTest!.setGraphicsQualityFixture((["low", "medium", "high"] as const)[i % 3]); window.__coursecraftTest!.setPaintCash(1_000_000 + i); }, i);
    await frame(page);
  }
  const stable = await compute(page); expect(stable.buildCount).toBe(beforeStable.buildCount); expect(stable.completedCount).toBe(beforeStable.completedCount); expect(stable.failedBuildCount).toBe(0);
  await page.getByTestId("design-path-width-apply").click();
  // Actual node and explicit tangent gestures, following the existing M35 UI.
  await page.evaluate(() => window.__coursecraftPixiTest!.focusTileForTest(8, 5, 1.5)); await frame(page);
  const first = await mousePoint(page, { x: 2.5, y: 3.5 }); await page.mouse.move(first.x, first.y); await page.mouse.down(); await page.mouse.move(first.x + 20, first.y - 10, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => (await surface(page)).features[0].points[0]).not.toEqual(initial.features[0].points[0]);
  const moved = (await surface(page)).features[0]; const tangent = moved.tangents as { out: Point }[];
  const handle = await mousePoint(page, tangent[0].out); await page.mouse.move(handle.x, handle.y); await page.mouse.down(); await page.mouse.move(handle.x + 18, handle.y + 20, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => (await surface(page)).features[0].tangents).not.toEqual(moved.tangents);
  const metrics = await page.evaluate(() => window.__coursecraftTest!.m35Metrics()); const final = await compute(page);
  const p95 = [...changed].sort((a, b) => a.totalMs - b.totalMs)[Math.ceil(changed.length * .95) - 1].totalMs;
  expect(p95).toBeLessThanOrEqual(50); expect(metrics.surfacePreview.count).toBe(final.completedCount); expect(final.buildCount).toBeGreaterThanOrEqual(21); expect(final.failedBuildCount).toBe(0);
  expect(metrics.surfacePreview.p95Ms).toBeLessThanOrEqual(50);
  expect(metrics.surfaceCommit.count).toBeGreaterThan(0); expect(metrics.surfaceCommit.p95Ms).toBeLessThanOrEqual(100); expect(metrics.chunkRebuild.maxMs).toBeLessThanOrEqual(100); expect(metrics.connectedRebuild.maxMs).toBeLessThanOrEqual(100);
  const receipt = { candidate, sourceHashes, fixtureHash: hash(file), dimensions: [file.course.width, file.course.height], browser: await rendererIdentity(page), cold, coldIdentity: "first changed uncached preview after reset; application and base plan already mounted", changed, p95, beforeStable, stable, final, metrics, interpretation: "CPU through actual successful Graphics submission; GPU completion is outside this timer" };
  await mkdir(evidence, { recursive: true }); await writeFile(resolve(evidence, "complete-preview-compute.json"), JSON.stringify(receipt, null, 2));
  await info.attach("complete-preview-compute", { body: Buffer.from(JSON.stringify(receipt, null, 2)), contentType: "application/json" });
});
