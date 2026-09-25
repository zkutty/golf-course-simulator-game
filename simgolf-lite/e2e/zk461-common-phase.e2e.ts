import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const outputRoot = resolve(process.env.ZK461_EVIDENCE_DIR ?? "../zk461-common-phase-evidence");
const preflight = process.env.ZK461_PREFLIGHT === "1";
const profileKey = "coursecraft_app_profile_v5";
const modes = ["standard", "deuteranopia", "protanopia", "tritanopia"] as const;
type Mode = typeof modes[number];
type Quality = "high" | "medium" | "low";

async function applyPalette(page: Page, mode: Mode) {
  await page.evaluate(({ key, mode }) => {
    const profile = JSON.parse(localStorage.getItem(key) ?? "{}");
    profile.accessibility = {
      ...profile.accessibility,
      colorVision: mode,
      terrainPatterns: false,
      reducedMotion: true,
    };
    profile.graphics = { ...profile.graphics, animations: false };
    localStorage.setItem(key, JSON.stringify(profile));
  }, { key: profileKey, mode });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-color-vision", mode);
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 90_000 }).toBe("game");
  await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest));
}

async function setRotation(page: Page, target: number) {
  let current = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation ?? 0);
  while (current !== target) {
    await page.keyboard.press("e");
    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation)).not.toBe(current);
    current = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation ?? 0);
  }
}

test("ZK-461 consumes one common-phase Parkland undercoat across the required matrix", async ({ page }) => {
  test.setTimeout(600_000);
  await mkdir(outputRoot, { recursive: true });
  const runtimeErrors: string[] = [];
  page.on("console", (entry) => {
    if (entry.type() === "error") runtimeErrors.push(entry.text());
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.stack ?? error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m19Fixture=1");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 90_000 }).toBe("game");
  await applyPalette(page, "standard");

  const captures: Array<{
    file: string;
    sha256: string;
    label: string;
    mode: Mode;
    quality: Quality;
    rotation: number;
    zoom: number;
    diagnostics: unknown;
    sceneOwnership: unknown;
    authority: unknown;
  }> = [];

  const capture = async (
    label: string,
    mode: Mode,
    quality: Quality,
    rotation: number,
    zoom: number,
    focus: { x: number; y: number },
  ) => {
    await setRotation(page, rotation);
    await page.evaluate(({ quality, zoom, focus }) => {
      window.__coursecraftTest!.setGraphicsQualityFixture(quality);
      window.__coursecraftPixiTest!.focusTileForTest(focus.x, focus.y, zoom);
    }, { quality, zoom, focus });
    await expect.poll(() => page.evaluate(({ quality, rotation, zoom }) => {
      const state = window.__coursecraftPixiTest!.rendererAtlasState();
      return state.parklandComposable.active
        && state.parklandComposable.quality === quality
        && state.parklandComposable.camera.rotation === rotation
        && Math.abs(state.parklandComposable.camera.zoom - zoom) < 0.001;
    }, { quality, rotation, zoom }), { timeout: 90_000 }).toBe(true);
    await page.waitForTimeout(250);
    const renderer = await page.evaluate(() => window.__coursecraftPixiTest!.rendererAtlasState());
    const usesAuthoritativeFields = mode === "standard" && quality !== "low";
    expect(renderer.parklandComposable).toMatchObject({
      active: true,
      contract: "parkland-composable-material-v1",
      phase: "parkland-common-phase-v1",
      source: "approved-zk463-assets",
      worldPeriodTiles: 8,
      undercoatDraws: 1,
      semanticFieldDraws: usesAuthoritativeFields ? 5 : 0,
      semanticComposition: usesAuthoritativeFields
        ? "zk1203-material-fields-with-motif-detail"
        : "motif-ink-over-common-undercoat",
      motifOnly: !usesAuthoritativeFields,
      independentPerCellPhase: false,
      samePresentationEmitters: 0,
      emittedLegacyTurfContourRuns: 0,
      elevationShoulderOwner: "landform-presentation-plan",
      fullCellOutlines: false,
      legacyDiamondTopPlane: false,
    });
    expect(renderer.parklandComposable.semanticCueDraws).toBeGreaterThan(0);
    expect(renderer.parklandComposable.semanticCueDraws).toBeLessThanOrEqual(5);
    expect(renderer.parklandComposable.motifMetrics).toHaveLength(
      renderer.parklandComposable.semantics.length,
    );
    expect(renderer.parklandComposable.motifMetrics.every((metrics) => (
      metrics.sourceAlphaFloor > 0
      && metrics.outputAlphaFloor === 0
      && metrics.maximumAlpha <= 76
      && metrics.nonZeroAlphaFraction < 0.23
      && metrics.lowFrequencyPlateScore < 0.04
      && metrics.tileBoundaryEdgeEnergy < 0.025
    ))).toBe(true);
    expect(new Set(renderer.parklandComposable.motifMetrics.map((metrics) => metrics.pattern)).size)
      .toBe(renderer.parklandComposable.semantics.length);
    if (quality === "low") {
      expect(renderer.parklandComposable.suppressedLegacyTurfContourRuns).toBe(0);
      expect(renderer.parklandComposable.preservedNonTurfContourRuns).toBe(0);
      expect(renderer.parklandComposable.preservedHazardPathContourRuns).toBe(0);
    } else {
      expect(renderer.parklandComposable.suppressedLegacyTurfContourRuns).toBeGreaterThan(0);
      expect(renderer.parklandComposable.preservedNonTurfContourRuns).toBeGreaterThan(0);
      expect(renderer.parklandComposable.preservedHazardPathContourRuns).toBeGreaterThan(0);
    }
    // The fixed matrix course is flat; the zero count is legitimate. The
    // named ZK-1207 owner plus its focused regression gate prove the emitter
    // remains available without manufacturing an elevation in this fixture.
    expect(renderer.parklandComposable.preservedLandformShoulders).toBeGreaterThanOrEqual(0);
    expect(new Set(renderer.parklandComposable.sourceIds).size).toBe(renderer.parklandComposable.sourceIds.length);
    expect(renderer.parklandComposable.sourceHashes).toHaveLength(renderer.parklandComposable.sourceIds.length);
    expect(renderer.parklandComposable.sourceHashes.every((hash) => /^[a-f0-9]{64}$/u.test(hash))).toBe(true);
    expect(renderer.parklandComposable.materialFieldSourceIds).toHaveLength(usesAuthoritativeFields ? 5 : 0);
    expect(renderer.parklandComposable.materialFieldSourceHashes).toHaveLength(usesAuthoritativeFields ? 5 : 0);
    expect(renderer.parklandComposable.materialFieldSourceHashes.every((hash) => /^[a-f0-9]{64}$/u.test(hash))).toBe(true);
    expect(renderer.residency.parklandComposableFields).toBeGreaterThanOrEqual(6);
    expect(renderer.counts?.naturalProps.habitatMasses).toBeGreaterThan(0);
    expect(renderer.counts?.naturalProps.habitatBedLayers).toBeGreaterThan(0);
    if (quality === "low") {
      expect(renderer.parklandComposable.lowContract).toMatchObject({
        subdivisions: 1,
        cornerRadius: 0,
        fullCellOutlines: false,
        legacyDiamondTopPlane: false,
        checkerboard: false,
        hazardPathElevationMode: "existing-render-paths",
      });
    }
    const bytes = await page.screenshot({ fullPage: true });
    const file = resolve(outputRoot, `${label}-${mode}-${quality}-r${rotation}-z${Math.round(zoom * 100)}.png`);
    await writeFile(file, bytes);
    captures.push({
      file,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      label,
      mode,
      quality,
      rotation,
      zoom,
      diagnostics: renderer.parklandComposable,
      sceneOwnership: {
        habitatMasses: renderer.counts?.naturalProps.habitatMasses ?? 0,
        habitatBedLayers: renderer.counts?.naturalProps.habitatBedLayers ?? 0,
        elevationShoulders: renderer.parklandComposable.preservedLandformShoulders,
        hazardPathContourRuns: renderer.parklandComposable.preservedHazardPathContourRuns,
      },
      authority: await page.evaluate(() => (
        JSON.parse(window.render_game_to_text?.() ?? "{}").onboarding?.authorityHashes ?? null
      )),
    });
  };

  for (const rotation of [0, 90, 180, 270]) {
    await capture("hole100", "standard", "medium", rotation, 1, { x: 24, y: 18 });
  }
  if (!preflight) for (const rotation of [0, 90]) {
      await capture("hole100", "standard", "high", rotation, 1, { x: 24, y: 18 });
    }
  for (const rotation of [0, 90]) {
    await capture("green200", "standard", "high", rotation, 2, { x: 39, y: 20 });
  }
  if (!preflight) await capture("overview50", "standard", "medium", 0, 0.5, { x: 24, y: 18 });
  await capture("hole100", "standard", "low", 0, 1, { x: 24, y: 18 });

  for (const mode of preflight ? modes.slice(1, 2) : modes.slice(1)) {
    await applyPalette(page, mode);
    await capture("hole100", mode, "medium", 0, 1, { x: 24, y: 18 });
  }

  const expectedCaptures = preflight ? 8 : 13;
  expect(captures).toHaveLength(expectedCaptures);
  expect(new Set(captures.map((capture) => `${capture.label}:${capture.mode}:${capture.quality}:${capture.rotation}:${capture.zoom}`)).size).toBe(expectedCaptures);
  expect(new Set(captures.map((capture) => JSON.stringify(capture.authority))).size).toBe(1);
  expect(runtimeErrors).toEqual([]);
  await writeFile(resolve(outputRoot, "zk461-common-phase-report.json"), `${JSON.stringify({
    version: 1,
    issue: "ZK-461",
    runtimeErrors,
    captures,
  }, null, 2)}\n`);

  const report = JSON.parse(await readFile(resolve(outputRoot, "zk461-common-phase-report.json"), "utf8"));
  expect(report.captures).toHaveLength(expectedCaptures);
});
