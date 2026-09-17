import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { PNG } from "pngjs";
import { M53_SEASONAL_TERRAIN_FIXTURES } from "../src/game/testing/m53SeasonalTerrainFixtures";

const PRIMARY_BIOMES = ["parkland", "links", "desert"] as const;
const QUALITY_REVERSAL = ["medium", "low", "high"] as const;
// Derived from visibleGroundCoverTier(), rather than guessed. Each LOD
// boundary needs its immediately-below, exact, and immediately-above state.
const ZOOM_LOD_CHECKPOINTS = [
  { boundary: 0.34, values: [0.33, 0.34, 0.35], tiers: [0, 1, 1] },
  { boundary: 0.72, values: [0.71, 0.72, 0.73], tiers: [1, 2, 2] },
] as const;

interface BrowserAtlasFile {
  readonly json: string;
  readonly image: string;
}

interface BrowserAtlasTier {
  readonly base: {
    readonly buildings: BrowserAtlasFile;
    readonly terrain: BrowserAtlasFile;
    readonly details: BrowserAtlasFile;
    readonly props: BrowserAtlasFile;
    readonly fields: Record<string, { readonly image: string }>;
  };
  seasonal: Record<string, unknown>;
}

interface BrowserAtlasManifest {
  readonly biomes: Record<string, Record<string, BrowserAtlasTier>>;
}

type SeasonalFixture = typeof M53_SEASONAL_TERRAIN_FIXTURES[number];

// Calibrated once against all 18 matched slow/reversal pairs: healthy maximum
// 0.249, controlled material-family minimum 1.021. This fixed 0.8 ceiling is
// outside the >3x healthy envelope without being derived from the frame under
// test or adjusted per biome.
const MATERIAL_FAMILY_DISTANCE_LIMIT = 0.8;
const MIN_VISIBLE_COVERAGE = 0.8;
const MAX_FLAT_BLOCK_RATIO = 0.04;

interface VisibleMaterialSignature {
  visibleCoverage: number;
  flatBlockRatio: number;
  luminance: readonly number[];
  chroma: readonly number[];
}

interface VisibleMaterialAssessment {
  readonly signature: VisibleMaterialSignature;
  readonly materialFamilyDistance: number | null;
  readonly issues: readonly string[];
}

interface WheelSequenceEvidence {
  readonly kind: "slow-forward" | "rapid-reversal";
  readonly boundary: number;
  readonly deltas: readonly number[];
  readonly targetZooms: readonly number[];
  readonly renderedZooms: readonly number[];
  readonly tiers: readonly (0 | 1 | 2)[];
}

function normalizeHistogram(histogram: readonly number[], total: number): number[] {
  return histogram.map((value) => value / Math.max(Number.EPSILON, total));
}

function visibleMaterialSignature(body: Buffer): VisibleMaterialSignature {
  const png = PNG.sync.read(body);
  const blockWidth = 12;
  const blockHeight = 6;
  const luminance = Array.from({ length: 16 }, () => 0);
  const chroma = Array.from({ length: 64 }, () => 0);
  let visibleWeight = 0;
  let histogramWeight = 0;
  let flat = 0;
  let sampled = 0;
  const minX = Math.floor(png.width * 0.08);
  const maxX = Math.floor(png.width * 0.92);
  const minY = Math.floor(png.height * 0.08);
  const maxY = Math.floor(png.height * 0.92);
  for (let y = minY; y < maxY; y += 2) {
    for (let x = minX; x < maxX; x += 2) {
      const offset = (y * png.width + x) * 4;
      const alpha = png.data[offset + 3] / 255;
      visibleWeight += alpha;
      if (alpha <= 0.05) continue;
      const red = png.data[offset];
      const green = png.data[offset + 1];
      const blue = png.data[offset + 2];
      const light = Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue);
      luminance[Math.min(15, Math.floor(light / 16))] += alpha;
      const redGreen = Math.max(-255, Math.min(255, red - green));
      const greenBlue = Math.max(-255, Math.min(255, green - blue));
      const redGreenBin = Math.min(7, Math.floor((redGreen + 255) / 64));
      const greenBlueBin = Math.min(7, Math.floor((greenBlue + 255) / 64));
      chroma[redGreenBin * 8 + greenBlueBin] += alpha;
      histogramWeight += alpha;
    }
  }
  for (let y = minY; y + blockHeight < maxY; y += blockHeight) {
    for (let x = minX; x + blockWidth < maxX; x += blockWidth) {
      let minimum = 255;
      let maximum = 0;
      let blockVisibleWeight = 0;
      for (let dy = 0; dy < blockHeight; dy++) for (let dx = 0; dx < blockWidth; dx++) {
        const offset = ((y + dy) * png.width + x + dx) * 4;
        const alpha = png.data[offset + 3] / 255;
        blockVisibleWeight += alpha;
        if (alpha <= 0.05) continue;
        for (let channel = 0; channel < 3; channel++) {
          minimum = Math.min(minimum, png.data[offset + channel]);
          maximum = Math.max(maximum, png.data[offset + channel]);
        }
      }
      if (blockVisibleWeight < blockWidth * blockHeight * 0.8) continue;
      sampled++;
      if (maximum - minimum <= 3) flat++;
    }
  }
  const histogramSamples = Math.ceil((maxX - minX) / 2) * Math.ceil((maxY - minY) / 2);
  return {
    visibleCoverage: visibleWeight / Math.max(1, histogramSamples),
    flatBlockRatio: flat / Math.max(1, sampled),
    luminance: normalizeHistogram(luminance, histogramWeight),
    chroma: normalizeHistogram(chroma, histogramWeight),
  };
}

function histogramDistance(left: readonly number[], right: readonly number[]): number {
  return left.reduce((total, value, index) => total + Math.abs(value - right[index]), 0);
}

function assessVisibleMaterial(body: Buffer, reference?: Buffer): VisibleMaterialAssessment {
  const signature = visibleMaterialSignature(body);
  const referenceSignature = reference ? visibleMaterialSignature(reference) : null;
  const materialFamilyDistance = referenceSignature
    ? histogramDistance(signature.luminance, referenceSignature.luminance)
      + histogramDistance(signature.chroma, referenceSignature.chroma)
    : null;
  const issues: string[] = [];
  if (signature.visibleCoverage < MIN_VISIBLE_COVERAGE) issues.push("insufficient-visible-coverage");
  if (signature.flatBlockRatio >= MAX_FLAT_BLOCK_RATIO) issues.push("flat-material-blocks");
  if (materialFamilyDistance !== null && materialFamilyDistance >= MATERIAL_FAMILY_DISTANCE_LIMIT) {
    issues.push("material-family-discontinuity");
  }
  return { signature, materialFamilyDistance, issues };
}

function expectVisibleMaterial(body: Buffer, label: string, reference?: Buffer): VisibleMaterialAssessment {
  const assessment = assessVisibleMaterial(body, reference);
  expect(assessment.issues, `${label} visible material issues`).toEqual([]);
  return assessment;
}

function rotateMaterialFamily(body: Buffer): Buffer {
  const png = PNG.sync.read(body);
  const minX = Math.floor(png.width * 0.25);
  const maxX = Math.floor(png.width * 0.75);
  const minY = Math.floor(png.height * 0.25);
  const maxY = Math.floor(png.height * 0.75);
  for (let y = minY; y < maxY; y++) for (let x = minX; x < maxX; x++) {
    const offset = (y * png.width + x) * 4;
    if (png.data[offset + 3] <= 12) continue;
    const red = png.data[offset];
    const green = png.data[offset + 1];
    const blue = png.data[offset + 2];
    png.data[offset] = rotatedChannel(green, red);
    png.data[offset + 1] = rotatedChannel(blue, green);
    png.data[offset + 2] = rotatedChannel(red, blue);
  }
  return PNG.sync.write(png);
}

function rotatedChannel(primary: number, secondary: number): number {
  return Math.max(0, Math.min(255, Math.round(primary * 0.85 + (255 - secondary) * 0.15)));
}

async function retainJsonEvidence(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
  const evidencePath = testInfo.outputPath(`${name}.json`);
  await writeFile(evidencePath, `${JSON.stringify(value, null, 2)}\n`);
  await testInfo.attach(name, { path: evidencePath, contentType: "application/json" });
}

async function rendererState(page: Page) {
  return page.evaluate(() => window.__coursecraftPixiTest?.rendererAtlasState() ?? null);
}

async function expectAtomicGeneration(page: Page, quality: "high" | "medium" | "low") {
  await expect.poll(async () => {
    const state = await rendererState(page);
    if (!state?.layers) return null;
    return {
      requested: state.requested.quality,
      rendered: state.rendered.quality,
      active: state.activation.bundleKey,
      generations: [...new Set(Object.values(state.layers))],
      stampsMatch: Object.values(state.layers).every((generation) => generation === state.rendered.generation),
      terrainChunks: state.counts?.terrainChunks ?? 0,
      connectedSurfaces: state.counts?.connectedSurfaces ?? -1,
      structuresAndProps: state.counts?.structuresAndProps ?? 0,
      dressing: state.counts?.dressing ?? 0,
    };
  }, { timeout: 120_000 }).toMatchObject({
    requested: quality,
    rendered: quality,
    active: expect.stringMatching(new RegExp(`:${quality}$`)),
    generations: [expect.any(Number)],
    stampsMatch: true,
    terrainChunks: expect.any(Number),
    connectedSurfaces: quality === "low" ? 0 : expect.any(Number),
    structuresAndProps: expect.any(Number),
    dressing: quality === "low" ? 0 : expect.any(Number),
  });
  const state = await rendererState(page);
  expect(state?.counts?.terrainChunks).toBeGreaterThan(0);
  if (quality !== "low") expect(state?.counts?.connectedSurfaces).toBeGreaterThan(0);
  expect(state?.counts?.structuresAndProps).toBeGreaterThan(0);
  if (quality !== "low") expect(state?.counts?.dressing).toBeGreaterThan(0);
  expect(state?.fallbacks).toEqual([]);
}

async function exerciseWheelZoomSequence(
  page: Page,
  testInfo: TestInfo,
  theme: typeof PRIMARY_BIOMES[number],
  fixture: SeasonalFixture,
  boundary: number,
  kind: WheelSequenceEvidence["kind"],
): Promise<WheelSequenceEvidence> {
  const deltas = kind === "slow-forward"
    ? Array.from({ length: 8 }, () => -8)
    : [-180, 360, -360, 520, -520];
  const startingZoom = boundary - 0.02;
  await page.evaluate(({ zoom }) => window.__coursecraftPixiTest!.focusTileForTest(60, 40, zoom), {
    zoom: startingZoom,
  });
  await page.locator(".cc-pixi-stage canvas").hover({ position: { x: 496, y: 423 } });
  const initial = await rendererState(page);
  const targetZooms = [initial!.camera.targetZoom];
  const renderedZooms = [initial!.camera.zoom];
  const tiers = [initial!.camera.groundCoverTier];
  for (let eventIndex = 0; eventIndex < deltas.length; eventIndex++) {
    const delta = deltas[eventIndex];
    const previousTarget = targetZooms.at(-1)!;
    await page.mouse.wheel(0, delta);
    await expect.poll(async () => Math.abs((await rendererState(page))!.camera.targetZoom - previousTarget), {
      timeout: 120_000,
    }).toBeGreaterThan(0.0001);
    if (kind === "slow-forward") await page.waitForTimeout(80);
    // Two real animation frames are enough for the world scale and its LOD
    // selection to consume the wheel target without settling the transition.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const state = await rendererState(page);
    expect(state?.requested.biome).toBe(theme);
    expect(state?.rendered.biome).toBe(theme);
    expect(state?.requested.quality).toBe("high");
    expect(state?.rendered.quality).toBe("high");
    expect(state?.fallbacks).toEqual([]);
    expect(state?.counts?.terrainChunks).toBeGreaterThan(0);
    expect(new Set(Object.values(state?.layers ?? {}))).toEqual(new Set([state?.rendered.generation]));
    const structured = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}") as {
      course?: { theme?: string };
      graphics?: { quality?: string };
      camera?: unknown;
    });
    expect(structured.course?.theme).toBe(theme);
    expect(structured.graphics?.quality).toBe("high");
    const frameName = `${theme}-wheel-${boundary}-${kind}-event-${eventIndex + 1}`;
    const frame = await page.locator(".cc-pixi-stage canvas").screenshot({
      path: testInfo.outputPath(`${frameName}.png`),
    });
    const visualMaterial = expectVisibleMaterial(frame, frameName);
    await retainJsonEvidence(testInfo, `${frameName}-provenance`, {
      fixture: { id: fixture.id, query: fixture.query, biome: fixture.biome, quality: fixture.quality, rotation: fixture.rotation },
      pageUrl: page.url(),
      eventIndex: eventIndex + 1,
      kind,
      boundary,
      delta,
      previousTargetZoom: previousTarget,
      targetZoom: state?.camera.targetZoom,
      renderedZoom: state?.camera.zoom,
      groundCoverTier: state?.camera.groundCoverTier,
      requested: state?.requested,
      rendered: state?.rendered,
      activation: state?.activation,
      residency: state?.residency,
      layers: state?.layers,
      counts: state?.counts,
      fallbacks: state?.fallbacks,
      structuredCamera: structured.camera,
      visualMaterial,
    });
    targetZooms.push(state!.camera.targetZoom);
    renderedZooms.push(state!.camera.zoom);
    tiers.push(state!.camera.groundCoverTier);
  }
  await expect.poll(async () => {
    const camera = (await rendererState(page))!.camera;
    return Math.abs(camera.zoom - camera.targetZoom);
  }, { timeout: 120_000 }).toBeLessThan(0.002);
  const settled = await rendererState(page);
  renderedZooms[renderedZooms.length - 1] = settled!.camera.zoom;
  tiers[tiers.length - 1] = settled!.camera.groundCoverTier;
  const [lowerTier, upperTier] = boundary === 0.34 ? [0, 1] as const : [1, 2] as const;
  expect(Math.min(...targetZooms), `${kind} crosses below ${boundary}`).toBeLessThan(boundary);
  expect(Math.max(...targetZooms), `${kind} crosses above ${boundary}`).toBeGreaterThan(boundary);
  expect(Math.min(...renderedZooms), `${kind} rendered zoom crosses below ${boundary}`).toBeLessThan(boundary);
  expect(Math.max(...renderedZooms), `${kind} rendered zoom crosses above ${boundary}`).toBeGreaterThan(boundary);
  expect(tiers, `${kind} rendered lower tier at ${boundary}`).toContain(lowerTier);
  expect(tiers, `${kind} rendered upper tier at ${boundary}`).toContain(upperTier);
  if (kind === "slow-forward") {
    expect(targetZooms.every((zoom, index) => index === 0 || zoom > targetZooms[index - 1])).toBe(true);
  } else {
    const directions = targetZooms.slice(1).map((zoom, index) => Math.sign(zoom - targetZooms[index]));
    expect(directions.every((direction, index) => index === 0 || direction === -directions[index - 1])).toBe(true);
  }
  return { kind, boundary, deltas, targetZooms, renderedZooms, tiers };
}

async function captureMaterialEvidence(
  page: Page,
  testInfo: TestInfo,
  theme: typeof PRIMARY_BIOMES[number],
  quality: typeof QUALITY_REVERSAL[number],
  reference: Buffer,
) {
  const body = await page.locator(".cc-pixi-stage canvas").screenshot({
    path: testInfo.outputPath(`${theme}-${quality}-zoom-generation.png`),
  });
  const assessment = expectVisibleMaterial(body, `${theme}/${quality}`, reference);
  await testInfo.attach(`${theme}-${quality}-zoom-generation`, { body, contentType: "image/png" });
  await retainJsonEvidence(testInfo, `${theme}-${quality}-zoom-generation-signal`, assessment);
  // The reported corruption replaces authored connected surfaces with broad,
  // single-color diamonds. Healthy reference frames keep large flat 12x6
  // blocks below 4%; the prior Desert evidence measured 1.5%.
  expect(assessment.signature.flatBlockRatio, `${theme}/${quality} flat-block ratio`).toBeLessThan(MAX_FLAT_BLOCK_RATIO);
}

async function captureZoomCheckpoint(
  page: Page,
  testInfo: TestInfo,
  theme: typeof PRIMARY_BIOMES[number],
  boundary: number,
  zoom: number,
  expectedTier: 0 | 1 | 2,
  sequence: string,
  fixture: SeasonalFixture,
  wheelSequence: WheelSequenceEvidence,
  reference?: Buffer,
): Promise<Buffer> {
  await page.evaluate((value) => window.__coursecraftPixiTest!.focusTileForTest(60, 40, value), zoom);
  await expect.poll(async () => (await rendererState(page))?.camera, { timeout: 120_000 }).toMatchObject({
    zoom,
    targetZoom: zoom,
    groundCoverTier: expectedTier,
  });
  const state = await rendererState(page);
  expect(state?.rendered.biome).toBe(theme);
  expect(state?.requested.biome).toBe(theme);
  expect(state?.fallbacks).toEqual([]);
  expect(new Set(Object.values(state?.layers ?? {}))).toEqual(new Set([state?.rendered.generation]));
  expect(state?.counts?.terrainChunks).toBeGreaterThan(0);
  const body = await page.locator(".cc-pixi-stage canvas").screenshot({
    path: testInfo.outputPath(`${theme}-lod-${boundary}-${zoom}-${sequence}.png`),
  });
  const assessment = expectVisibleMaterial(body, `${theme} ${boundary}/${zoom} ${sequence}`, reference);
  const browserEvidence = await page.evaluate(() => ({
    dpr: window.devicePixelRatio,
    structured: JSON.parse(window.render_game_to_text?.() ?? "{}") as { camera?: unknown },
  }));
  await retainJsonEvidence(testInfo, `${theme}-lod-${boundary}-${zoom}-${sequence}-provenance`, {
      fixture: {
        id: fixture.id,
        query: fixture.query,
        biome: fixture.biome,
        quality: fixture.quality,
        rotation: fixture.rotation,
      },
      pageUrl: page.url(),
      viewport: { ...page.viewportSize(), dpr: browserEvidence.dpr },
      boundary, zoom, expectedTier, sequence,
      wheelSequence,
      requested: state?.requested,
      rendered: state?.rendered,
      activation: state?.activation,
      residency: state?.residency,
      camera: state?.camera,
      structuredCamera: browserEvidence.structured.camera,
      layers: state?.layers,
      counts: state?.counts,
      fallbacks: state?.fallbacks,
      visualMaterial: assessment,
  });
  return body;
}

interface StructuredCameraEvidence {
  readonly center: { readonly x: number; readonly y: number };
  readonly zoom: number;
  readonly rotation: number;
}

async function waitForStructuredCameraToSettle(page: Page): Promise<StructuredCameraEvidence> {
  let previous: StructuredCameraEvidence | null = null;
  let stableSamples = 0;
  await expect.poll(async () => {
    const current = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera as StructuredCameraEvidence);
    const delta = previous
      ? Math.hypot(current.center.x - previous.center.x, current.center.y - previous.center.y)
        + Math.abs(current.zoom - previous.zoom)
      : Number.POSITIVE_INFINITY;
    stableSamples = delta < 0.002 ? stableSamples + 1 : 0;
    previous = current;
    return stableSamples;
  }, { timeout: 120_000, intervals: [300] }).toBeGreaterThanOrEqual(2);
  return page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera as StructuredCameraEvidence);
}

async function captureProductionPanRotation(
  page: Page,
  testInfo: TestInfo,
  theme: typeof PRIMARY_BIOMES[number],
  fixture: SeasonalFixture,
): Promise<void> {
  const canvas = page.locator(".cc-pixi-stage canvas");
  await page.evaluate(() => window.__coursecraftPixiTest!.focusTileForTest(32, 22, 0.72));
  await canvas.hover({ position: { x: 496, y: 423 } });

  // A short supported keyboard pan synchronizes the structured camera after
  // the test-only setup hook; the second bounded action is the pan under test.
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(100);
  await page.keyboard.up("KeyD");
  const before = await waitForStructuredCameraToSettle(page);

  await page.keyboard.down("KeyW");
  await page.waitForTimeout(100);
  await page.keyboard.up("KeyW");
  await expect.poll(() => page.evaluate(({ center }) => {
    const current = JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.center as { x: number; y: number } | undefined;
    return current ? Math.hypot(current.x - center.x, current.y - center.y) : 0;
  }, { center: before.center }), { timeout: 120_000 }).toBeGreaterThan(0.5);
  const settledAfterPan = await waitForStructuredCameraToSettle(page);
  const afterPanState = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}") as {
    course: { theme: string };
    graphics: { quality: string };
    camera: { center: { x: number; y: number }; zoom: number; rotation: number };
  });
  expect(afterPanState.course.theme).toBe(theme);
  expect(afterPanState.graphics.quality).toBe("high");
  expect(afterPanState.camera.zoom).toBeCloseTo(0.72, 2);
  expect(afterPanState.camera.center).toEqual(settledAfterPan.center);
  const panDistance = Math.hypot(
    afterPanState.camera.center.x - before.center.x,
    afterPanState.camera.center.y - before.center.y,
  );
  expect(panDistance).toBeGreaterThan(0.5);

  const beforeRotationFrame = await canvas.screenshot();
  await page.keyboard.press("q");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation), {
    timeout: 120_000,
  }).not.toBe(0);
  const structured = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}") as {
    course: { theme: string };
    graphics: { quality: string };
    camera: { center: { x: number; y: number }; zoom: number; rotation: number };
  });
  expect(structured.course.theme).toBe(theme);
  expect(structured.graphics.quality).toBe("high");
  expect(structured.camera.zoom).toBeCloseTo(0.72, 2);
  const rotationCenterDrift = Math.hypot(
    structured.camera.center.x - afterPanState.camera.center.x,
    structured.camera.center.y - afterPanState.camera.center.y,
  );
  expect(rotationCenterDrift).toBeLessThan(0.01);
  const state = await rendererState(page);
  expect(state?.requested.biome).toBe(theme);
  expect(state?.rendered.biome).toBe(theme);
  expect(state?.fallbacks).toEqual([]);
  expect(state?.counts?.terrainChunks).toBeGreaterThan(0);
  expect(new Set(Object.values(state?.layers ?? {}))).toEqual(new Set([state?.rendered.generation]));
  expect(state?.camera).toMatchObject({ zoom: 0.72, targetZoom: 0.72, groundCoverTier: 2 });
  const body = await canvas.screenshot({
    path: testInfo.outputPath(`${theme}-lod-0.72-0.72-pan-rotation.png`),
  });
  const visualMaterial = expectVisibleMaterial(body, `${theme} production pan/rotation`, beforeRotationFrame);
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  await retainJsonEvidence(testInfo, `${theme}-lod-0.72-0.72-pan-rotation-provenance`, {
    fixture: { id: fixture.id, query: fixture.query, biome: fixture.biome, quality: fixture.quality, rotation: fixture.rotation },
    pageUrl: page.url(),
    viewport: { ...page.viewportSize(), dpr },
    action: { syncPan: "KeyD/100ms", pan: "KeyW/100ms", rotate: "q" },
    beforePan: before,
    afterPan: afterPanState.camera,
    panDistance,
    rotationCenterDrift,
    afterRotation: structured.camera,
    requested: state?.requested,
    rendered: state?.rendered,
    activation: state?.activation,
    residency: state?.residency,
    camera: state?.camera,
    layers: state?.layers,
    counts: state?.counts,
    fallbacks: state?.fallbacks,
    visualMaterial,
  });
  await page.keyboard.press("e");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation), {
    timeout: 120_000,
  }).toBe(0);
}

test("ZK-674 visible material signal rejects only the controlled material-family discontinuity", () => {
  const png = new PNG({ width: 160, height: 120 });
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const offset = (y * png.width + x) * 4;
    const texture = (x * 7 + y * 11) % 29;
    png.data[offset] = 48 + texture;
    png.data[offset + 1] = 118 + texture;
    png.data[offset + 2] = 58 + Math.floor(texture / 2);
    png.data[offset + 3] = 255;
  }
  const healthy = PNG.sync.write(png);
  expect(assessVisibleMaterial(healthy, healthy).issues).toEqual([]);
  const mutated = assessVisibleMaterial(rotateMaterialFamily(healthy), healthy);
  expect(mutated.issues).toEqual(["material-family-discontinuity"]);
  expect(mutated.materialFamilyDistance).toBeGreaterThanOrEqual(MATERIAL_FAMILY_DISTANCE_LIMIT);
  expect(mutated.signature.flatBlockRatio).toBeLessThan(MAX_FLAT_BLOCK_RATIO);
});

for (const theme of PRIMARY_BIOMES) {
  test(`ZK-674 keeps ${theme} atlas generations atomic through tier and zoom reversals`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    const failedAssets: string[] = [];
    let releaseAutumnOverlay = () => {};
    const autumnOverlayGate = new Promise<void>((resolve) => {
      releaseAutumnOverlay = resolve;
    });
    let markAutumnOverlayRequested = () => {};
    const autumnOverlayRequested = new Promise<void>((resolve) => {
      markAutumnOverlayRequested = resolve;
    });
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400 && /atlases\/biomes/.test(response.url())) {
        failedAssets.push(`${response.status()} ${response.url()}`);
      }
    });

    // Make the previously unsafe partial-generation window deterministic.
    // The live scene must retain the complete prior generation while the new
    // tier's independently requested sheets and fields are still in flight.
    await page.route(/atlases\/biomes\/manifest\.json/, async (route) => {
      const response = await route.fetch();
      const manifest = await response.json() as BrowserAtlasManifest;
      const tier = manifest.biomes.parkland.high;
      const uniqueFrame = (file: BrowserAtlasFile, family: string): BrowserAtlasFile => ({
        ...file,
        json: `${file.json}?zk674-autumn-overlay=${family}`,
        image: `${file.image}?zk674-autumn-overlay=${family}`,
      });
      tier.seasonal.autumn = {
        owner: "parkland",
        season: "autumn",
        materials: {
          fairway: {
            image: `${tier.base.fields.fairway.image}?zk674-autumn-overlay=fairway`,
          },
        },
        frames: {
          buildings: uniqueFrame(tier.base.buildings, "buildings"),
          "natural-props": uniqueFrame(tier.base.props, "natural-props"),
          "terrain-details": uniqueFrame(tier.base.details, "terrain-details"),
        },
      };
      await route.fulfill({ response, json: manifest });
    });
    await page.route(/atlases\/biomes\/.*-(?:(?:medium|low)|links-high)\./, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });
    await page.route(/zk674-autumn-overlay=/, async (route) => {
      markAutumnOverlayRequested();
      await autumnOverlayGate;
      await route.continue();
    });

    const fixture = M53_SEASONAL_TERRAIN_FIXTURES.find((candidate) => (
      candidate.biome === theme
      && candidate.season === "summer"
      && candidate.quality === "high"
      && candidate.rotation === 0
    ));
    expect(fixture).toBeDefined();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(fixture!.query);
    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}")), {
      timeout: 120_000,
    }).toMatchObject({
      screen: "game",
      course: { theme },
      graphics: { quality: "high" },
    });
    const canvas = page.locator(".cc-pixi-stage canvas");
    await expect(canvas).toBeVisible({ timeout: 120_000 });
    await expectAtomicGeneration(page, "high");
    const unrelatedObjectProbe = await page.evaluate(() => (
      window.__coursecraftPixiTest!.unrelatedObjectCountProbe()
    ));
    expect(unrelatedObjectProbe.before).toBeGreaterThan(0);
    expect(unrelatedObjectProbe.after).toBe(unrelatedObjectProbe.before);

    // A→B→A must invalidate B even if its assets finish well after the view
    // has returned to A. The active global atlas may not drift behind React.
    await page.evaluate(() => window.__coursecraftTest!.setGraphicsQualityFixture("medium"));
    await expect.poll(async () => (await rendererState(page))?.requested.quality, { timeout: 120_000 }).toBe("medium");
    const pending = await rendererState(page);
    expect(pending?.rendered.quality).toBe("high");
    expect(new Set(Object.values(pending?.layers ?? {}))).toEqual(new Set([pending?.rendered.generation]));
    await page.evaluate(() => window.__coursecraftTest!.setGraphicsQualityFixture("high"));
    await expect.poll(async () => (await rendererState(page))?.activation.pending, { timeout: 120_000 }).toBeNull();
    await page.waitForTimeout(1_800);
    await expectAtomicGeneration(page, "high");

    // The same now-resident B tier can activate as one complete generation.
    await page.evaluate(() => window.__coursecraftTest!.setGraphicsQualityFixture("medium"));
    await expectAtomicGeneration(page, "medium");

    // Supersede two in-flight requests and finish on Low. An older completion
    // may become resident, but it must never become the active render context.
    await page.evaluate(() => window.__coursecraftTest!.setGraphicsQualityFixture("low"));
    await page.waitForTimeout(35);
    await page.evaluate(() => window.__coursecraftTest!.setGraphicsQualityFixture("high"));
    await page.waitForTimeout(20);
    await page.evaluate(() => window.__coursecraftTest!.setGraphicsQualityFixture("low"));
    await expectAtomicGeneration(page, "low");

    // Zoom LOD is independent of the atlas quality selection; certify it on
    // High so both authored cover tiers are observable.
    await page.evaluate(() => window.__coursecraftTest!.setGraphicsQualityFixture("high"));
    await expectAtomicGeneration(page, "high");
    await canvas.hover();
    const slowForwardCaptures = new Map<string, Buffer>();
    const wheelSequences = new Map<string, WheelSequenceEvidence>();
    for (const checkpoint of ZOOM_LOD_CHECKPOINTS) {
      const slowSequence = await exerciseWheelZoomSequence(page, testInfo, theme, fixture!, checkpoint.boundary, "slow-forward");
      wheelSequences.set(`${checkpoint.boundary}:slow-forward`, slowSequence);
      for (let index = 0; index < checkpoint.values.length; index++) {
        const zoom = checkpoint.values[index];
        const capture = await captureZoomCheckpoint(page, testInfo, theme, checkpoint.boundary,
          zoom, checkpoint.tiers[index], "slow-forward", fixture!, slowSequence);
        slowForwardCaptures.set(`${checkpoint.boundary}:${zoom}`, capture);
      }
      const rapidSequence = await exerciseWheelZoomSequence(page, testInfo, theme, fixture!, checkpoint.boundary, "rapid-reversal");
      wheelSequences.set(`${checkpoint.boundary}:rapid-reversal`, rapidSequence);
      for (let index = checkpoint.values.length - 1; index >= 0; index--) {
        const zoom = checkpoint.values[index];
        await captureZoomCheckpoint(page, testInfo, theme, checkpoint.boundary,
          zoom, checkpoint.tiers[index], "rapid-reversal", fixture!, rapidSequence,
          slowForwardCaptures.get(`${checkpoint.boundary}:${zoom}`));
      }
    }
    // Real production keyboard pan followed by production rotation. The focus
    // hook establishes only the starting camera and never substitutes for pan.
    await captureProductionPanRotation(page, testInfo, theme, fixture!);

    // Freeze a same-camera reference for the reload boundary. Reload must
    // rehydrate the exact fixture at the same focus, zoom, quality and rotation.
    await page.evaluate(() => window.__coursecraftPixiTest!.focusTileForTest(60, 40, 0.72));
    const beforeReloadBody = await canvas.screenshot({
      path: testInfo.outputPath(`${theme}-reload-reference.png`),
    });

    // The seasonal fixture has no exposed reducer edit/undo action; do not
    // manufacture a second harness. Reload is available and is the relevant
    // cache boundary, so prove the same fixture identity rehydrates cleanly.
    await page.reload();
    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}")), {
      timeout: 120_000,
    }).toMatchObject({ screen: "game", course: { theme }, graphics: { quality: "high" } });
    await expectAtomicGeneration(page, "high");
    await page.evaluate(() => window.__coursecraftPixiTest!.focusTileForTest(60, 40, 0.72));
    await expect.poll(async () => (await rendererState(page))?.camera, { timeout: 120_000 }).toMatchObject({
      zoom: 0.72,
      targetZoom: 0.72,
      groundCoverTier: 2,
    });
    const reloaded = await rendererState(page);
    const reloadedBody = await page.locator(".cc-pixi-stage canvas").screenshot({
      path: testInfo.outputPath(`${theme}-reload-settled.png`),
    });
    const reloadedAssessment = expectVisibleMaterial(reloadedBody, `${theme} reload`, beforeReloadBody);
    const reloadBrowserEvidence = await page.evaluate(() => ({
      dpr: window.devicePixelRatio,
      structured: JSON.parse(window.render_game_to_text?.() ?? "{}") as { camera?: unknown },
    }));
    await retainJsonEvidence(testInfo, `${theme}-reload-provenance`, {
        sequence: "reload",
        fixture: { id: fixture!.id, query: fixture!.query, biome: fixture!.biome, quality: fixture!.quality, rotation: fixture!.rotation },
        pageUrl: page.url(),
        viewport: { ...page.viewportSize(), dpr: reloadBrowserEvidence.dpr },
        requested: reloaded?.requested,
        rendered: reloaded?.rendered,
        activation: reloaded?.activation,
        residency: reloaded?.residency,
        camera: reloaded?.camera,
        appOverviewCamera: reloadBrowserEvidence.structured.camera,
        layers: reloaded?.layers,
        counts: reloaded?.counts,
        fallbacks: reloaded?.fallbacks,
        visualMaterial: reloadedAssessment,
    });

    // Controlled same-camera negative: preserve real scene detail and alpha,
    // but rotate the central material family. Prove the shared helper rejects
    // for that exact reason rather than merely proving that expect() throws.
    const beforeNegative = await rendererState(page);
    expect(beforeNegative?.rendered.biome).toBe(theme);
    const negative = rotateMaterialFamily(reloadedBody);
    const negativePath = testInfo.outputPath(`${theme}-negative-material-family.png`);
    await writeFile(negativePath, negative);
    await testInfo.attach(`${theme}-negative-material-family`, { body: negative, contentType: "image/png" });
    const negativeAssessment = assessVisibleMaterial(negative, reloadedBody);
    expect(negativeAssessment.issues).toEqual(["material-family-discontinuity"]);
    expect(negativeAssessment.materialFamilyDistance).toBeGreaterThanOrEqual(MATERIAL_FAMILY_DISTANCE_LIMIT);
    expect(negativeAssessment.signature.flatBlockRatio).toBeLessThan(MAX_FLAT_BLOCK_RATIO);
    await retainJsonEvidence(testInfo, `${theme}-negative-material-family-signal`, negativeAssessment);
    await captureZoomCheckpoint(page, testInfo, theme, 0.72, 0.72, 2, "negative-source-repeat", fixture!,
      wheelSequences.get("0.72:rapid-reversal")!, reloadedBody);

    for (const quality of QUALITY_REVERSAL) {
      await page.evaluate((value) => window.__coursecraftTest!.setGraphicsQualityFixture(value), quality);
      await expectAtomicGeneration(page, quality);
      const qualityReference = await canvas.screenshot();
      await captureMaterialEvidence(page, testInfo, theme, quality, qualityReference);
    }

    if (theme === "parkland") {
      // Theme requests are held exactly like tiers. First prove a canceled
      // Parkland→Links→Parkland request cannot activate late, then allow the
      // same resident Links bundle to commit in place and return.
      await page.evaluate(() => window.__coursecraftTest!.setRendererThemeFixture("links"));
      await expect.poll(async () => (await rendererState(page))?.requested.biome, { timeout: 120_000 }).toBe("links");
      expect((await rendererState(page))?.rendered.biome).toBe("parkland");
      await page.evaluate(() => window.__coursecraftTest!.setRendererThemeFixture("parkland"));
      await page.waitForTimeout(1_800);
      await expect.poll(async () => {
        const state = await rendererState(page);
        return {
          requested: state?.requested.biome,
          rendered: state?.rendered.biome,
          active: state?.activation.bundleKey,
          pending: state?.activation.pending,
          stampsMatch: state?.layers
            ? Object.values(state.layers).every((generation) => generation === state.rendered.generation)
            : false,
        };
      }, { timeout: 120_000 }).toEqual({ requested: "parkland", rendered: "parkland", active: "parkland:high", pending: null, stampsMatch: true });

      await page.evaluate(() => window.__coursecraftTest!.setRendererThemeFixture("links"));
      await expect.poll(async () => (await rendererState(page))?.rendered.biome, { timeout: 120_000 }).toBe("links");
      await page.evaluate(() => window.__coursecraftTest!.setRendererThemeFixture("parkland"));
      await expect.poll(async () => (await rendererState(page))?.rendered.biome, { timeout: 120_000 }).toBe("parkland");

      // The browser manifest injects an actual authored autumn overlay route
      // with unique gated URLs, proving the presentation remains held until
      // every overlay asset can commit as one generation.
      const summerState = await rendererState(page);
      await page.evaluate(() => window.__coursecraftTest!.setRendererSeasonFixture("autumn"));
      await expect.poll(async () => (await rendererState(page))?.requested.season, { timeout: 120_000 }).toBe("autumn");
      await autumnOverlayRequested;
      const heldAutumn = await rendererState(page);
      expect(heldAutumn?.rendered.season).toBe("summer");
      expect(heldAutumn?.rendered.generation).toBe(summerState?.rendered.generation);
      expect(heldAutumn?.rendered.seasonalVisualSignature).toBe(summerState?.rendered.seasonalVisualSignature);
      expect(heldAutumn?.layers).toEqual(summerState?.layers);
      releaseAutumnOverlay();
      await expect.poll(async () => {
        const state = await rendererState(page);
        return {
          requested: state?.requested.season,
          rendered: state?.rendered.season,
          overlay: state?.rendered.overlayKey,
          stampsMatch: state?.layers
            ? Object.values(state.layers).every((generation) => generation === state.rendered.generation)
            : false,
        };
      }, { timeout: 120_000 }).toEqual({
        requested: "autumn",
        rendered: "autumn",
        overlay: "parkland:high:autumn",
        stampsMatch: true,
      });
      await page.evaluate(() => window.__coursecraftTest!.setRendererSeasonFixture("summer"));
      await expect.poll(async () => (await rendererState(page))?.rendered.season, { timeout: 120_000 }).toBe("summer");
    }

    expect(failedAssets).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("ZK-674 publishes one stable UI fallback generation after a failed bundle load", async ({ page }) => {
  const fixture = M53_SEASONAL_TERRAIN_FIXTURES.find((candidate) => (
    candidate.biome === "parkland"
    && candidate.season === "summer"
    && candidate.quality === "high"
    && candidate.rotation === 0
  ));
  expect(fixture).toBeDefined();
  let failedBundleRequests = 0;
  await page.route(/terrain-parkland-high\..*\.json/, async (route) => {
    failedBundleRequests++;
    await route.abort("failed");
  });
  await page.goto(fixture!.query);
  await expect.poll(async () => {
    const state = await rendererState(page);
    return {
      status: state?.rendered.status,
      pending: state?.activation.pending,
      terrainChunks: state?.counts?.terrainChunks ?? 0,
    };
  }, { timeout: 120_000 }).toMatchObject({
    status: "fallback",
    pending: null,
    terrainChunks: expect.any(Number),
  });
  const settled = await rendererState(page);
  expect(settled?.counts?.terrainChunks).toBeGreaterThan(0);
  expect(settled?.fallbacks).toHaveLength(1);
  await page.waitForTimeout(2_000);
  const stable = await rendererState(page);
  expect(failedBundleRequests).toBe(1);
  expect(stable?.rendered.status).toBe("fallback");
  expect(stable?.rendered.requestId).toBe(settled?.rendered.requestId);
  expect(stable?.rendered.generation).toBe(settled?.rendered.generation);
  expect(stable?.counts?.terrainRebuilds).toBe(settled?.counts?.terrainRebuilds);
  expect(stable?.activation.pending).toBeNull();
});
