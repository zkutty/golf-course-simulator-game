import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";
import { M53_SEASONAL_TERRAIN_FIXTURES } from "../src/game/testing/m53SeasonalTerrainFixtures";

const TEE_SETS = ["forward", "member", "championship"] as const;
const PIN_ROTATIONS = ["A", "B", "C"] as const;

interface OverlayProjection {
  traces: Array<{ id: string; from: { x: number; y: number }; to: { x: number; y: number } }>;
  points: Array<{ id: string; center: { x: number; y: number }; radius: number }>;
}

function changedPixels(a: PNG, b: PNG, center: { x: number; y: number }, radius: number): number {
  let changed = 0;
  const minX = Math.max(0, Math.floor(center.x - radius));
  const maxX = Math.min(a.width - 1, Math.ceil(center.x + radius));
  const minY = Math.max(0, Math.floor(center.y - radius));
  const maxY = Math.min(a.height - 1, Math.ceil(center.y + radius));
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    if (Math.hypot(x - center.x, y - center.y) > radius) continue;
    const offset = (y * a.width + x) * 4;
    const delta = Math.abs(a.data[offset] - b.data[offset])
      + Math.abs(a.data[offset + 1] - b.data[offset + 1])
      + Math.abs(a.data[offset + 2] - b.data[offset + 2]);
    if (delta >= 30) changed++;
  }
  return changed;
}

async function openReferenceReview(page: import("@playwright/test").Page) {
  await page.getByTestId("open-architecture-review").click();
  const review = page.getByTestId("architecture-review");
  await review.getByTestId("architecture-overlay-reference").click();
  await review.getByTestId("architecture-hole-filter").selectOption({ index: 1 });
  await expect(review.getByTestId("architecture-reference-plan")).toContainText(/full shots \+ 2 expected putts/, { timeout: 120_000 });
  return review;
}

test("ZK-765 every authored tee and pin setup is selectable in the browser review", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/?m23Fixture=1");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").screen), { timeout: 60_000 }).toBe("game");
  const review = await openReferenceReview(page);
  const reference = review.getByTestId("architecture-reference-plan");

  for (const teeSet of TEE_SETS) for (const pinRotation of PIN_ROTATIONS) {
    await review.getByTestId("architecture-tee-filter").selectOption(teeSet);
    await review.getByTestId("architecture-pin-filter").selectOption(pinRotation);
    await expect(reference).toContainText(`${teeSet} reference:`, { timeout: 120_000 });
    await expect(reference).toContainText(`pin ${pinRotation}`);
    await expect(reference).toContainText(/Effective route: [1-9][0-9]* yd/);
    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").architectureReview?.overlay?.kind)).toBe("reference");
  }
  expect(errors).toEqual([]);
});

test("ZK-765 reference overlays remain populated across every biome and camera rotation", async ({ page }, testInfo) => {
  const errors: string[] = [];
  const failedAssets: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", (response) => {
    if (response.status() >= 400 && /atlases\/biomes/.test(response.url())) failedAssets.push(`${response.status()} ${response.url()}`);
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  const allFixtures = M53_SEASONAL_TERRAIN_FIXTURES.filter((fixture) => fixture.season === "summer" && fixture.quality === "high");
  expect(allFixtures).toHaveLength(12);
  const visualBiome = process.env.ZK765_VISUAL_BIOME;
  const fixtures = process.env.ZK765_VISUAL_SLICE === "1"
    ? allFixtures.filter((fixture) => fixture.rotation === 0 && (!visualBiome || fixture.biome === visualBiome))
    : allFixtures;
  for (const fixture of fixtures) {
    await page.goto(fixture.query);
    await expect.poll(async () => {
      const state = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
      return { screen: state.screen, theme: state.course?.theme, rotation: state.camera?.rotation };
    }, { timeout: 120_000 }).toEqual({ screen: "game", theme: fixture.biome, rotation: fixture.rotation * 90 });
    const review = await openReferenceReview(page);
    await expect.poll(() => page.evaluate(() => {
      const architecture = JSON.parse(window.render_game_to_text?.() ?? "{}").architectureReview;
      return { kind: architecture?.overlay?.kind, traces: architecture?.overlay?.traces, points: architecture?.overlay?.points };
    }), { timeout: 120_000 }).toMatchObject({ kind: "reference", traces: expect.any(Number), points: expect.any(Number) });
    const architecture = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").architectureReview);
    expect(architecture.overlay.traces).toBeGreaterThan(0);
    expect(architecture.overlay.points).toBeGreaterThan(0);

    const canvas = page.locator(".cc-pixi-stage canvas");
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (fixture.biome === "parkland" && fixture.rotation === 0 && box) {
      const before = await page.evaluate(() => (window as unknown as { __ccReferencePlanDiagnostics?: { requests: number; solves: number } }).__ccReferencePlanDiagnostics);
      expect(before).toBeDefined();
      await page.mouse.move(box.x + box.width * .25, box.y + box.height * .25);
      await page.mouse.move(box.x + box.width * .75, box.y + box.height * .75, { steps: 250 });
      await expect(review.getByTestId("architecture-reference-plan")).toContainText(/full shots \+ 2 expected putts/);
      const after = await page.evaluate(() => (window as unknown as { __ccReferencePlanDiagnostics?: { requests: number; solves: number } }).__ccReferencePlanDiagnostics);
      expect(after).toEqual(before);
    }
    const projection = await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __ccArchitectureOverlayProjection?: OverlayProjection }).__ccArchitectureOverlayProjection,
    ), { timeout: 30_000 }).toMatchObject({ traces: expect.any(Array), points: expect.any(Array) }).then(() => page.evaluate(() =>
      (window as unknown as { __ccArchitectureOverlayProjection: OverlayProjection }).__ccArchitectureOverlayProjection,
    ));
    expect(projection.traces).toHaveLength(architecture.overlay.traces);
    expect(projection.points).toHaveLength(architecture.overlay.points);

    const overlayPath = testInfo.outputPath(`zk765-${fixture.biome}-rotation-${fixture.rotation}-reference.png`);
    const overlayShot = await canvas.screenshot({ path: overlayPath });
    await review.getByTestId("architecture-overlay-traces").click();
    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").architectureReview?.overlay))
      .toMatchObject({ kind: "traces", traces: 0, points: 0 });
    const baselinePath = testInfo.outputPath(`zk765-${fixture.biome}-rotation-${fixture.rotation}-baseline.png`);
    const baselineShot = await canvas.screenshot({ path: baselinePath });
    const overlayPng = PNG.sync.read(overlayShot);
    const baselinePng = PNG.sync.read(baselineShot);
    expect(overlayPng.width).toBe(baselinePng.width);
    expect(overlayPng.height).toBe(baselinePng.height);
    const routeChanges = projection.traces.reduce((sum, trace) => sum + [0.25, 0.5, 0.75].reduce((traceSum, ratio) =>
      traceSum + changedPixels(overlayPng, baselinePng, {
        x: trace.from.x + (trace.to.x - trace.from.x) * ratio,
        y: trace.from.y + (trace.to.y - trace.from.y) * ratio,
      }, 7), 0), 0);
    const landingChanges = projection.points.reduce((sum, point) =>
      sum + changedPixels(overlayPng, baselinePng, point.center, point.radius + 3), 0);
    expect(routeChanges, `${fixture.id}:reference-route-pixels`).toBeGreaterThanOrEqual(20);
    expect(landingChanges, `${fixture.id}:reference-landing-pixels`).toBeGreaterThanOrEqual(12);
    await testInfo.attach(`zk765-${fixture.biome}-rotation-${fixture.rotation}-reference`, { path: overlayPath, contentType: "image/png" });
    await testInfo.attach(`zk765-${fixture.biome}-rotation-${fixture.rotation}-baseline`, { path: baselinePath, contentType: "image/png" });
  }

  expect(failedAssets).toEqual([]);
  expect(errors).toEqual([]);
});
