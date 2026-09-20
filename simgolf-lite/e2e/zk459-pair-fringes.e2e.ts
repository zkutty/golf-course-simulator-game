import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const outputRoot = resolve(process.env.ZK459_EVIDENCE_DIR ?? "../zk459-pair-fringe-evidence");
const profileKey = "coursecraft_app_profile_v5";
type Mode = "standard" | "deuteranopia" | "protanopia" | "tritanopia";
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
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), {
    timeout: 90_000,
  }).toBe("game");
  await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest));
}

async function setRotation(page: Page, target: number) {
  let current = await page.evaluate(() => (
    JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation ?? 0
  ));
  while (current !== target) {
    await page.keyboard.press("e");
    await expect.poll(() => page.evaluate(() => (
      JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation
    ))).not.toBe(current);
    current = await page.evaluate(() => (
      JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation ?? 0
    ));
  }
}

test("ZK-459 renders one source-faithful pair fringe per canonical M19 owner", async ({ page }) => {
  test.setTimeout(600_000);
  await mkdir(outputRoot, { recursive: true });
  const runtimeErrors: string[] = [];
  page.on("console", (entry) => {
    if (entry.type() === "error") runtimeErrors.push(entry.text());
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.stack ?? error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m19Fixture=1");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), {
    timeout: 90_000,
  }).toBe("game");
  await applyPalette(page, "standard");
  const initialCourseHash = await page.evaluate(() => window.__coursecraftTest!.state().courseHash);

  const captures: Array<Record<string, unknown>> = [];
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
      const fringe = state.parklandComposable.pairFringes;
      return fringe?.active
        && fringe.quality === quality
        && fringe.rotation === rotation
        && state.parklandComposable.camera.rotation === rotation
        && Math.abs(state.parklandComposable.camera.zoom - zoom) < 0.001;
    }, { quality, rotation, zoom }), { timeout: 90_000 }).toBe(true);
    await page.waitForTimeout(250);
    const renderer = await page.evaluate(() => window.__coursecraftPixiTest!.rendererAtlasState());
    const fringe = renderer.parklandComposable.pairFringes;
    expect(fringe).toMatchObject({
      active: true,
      quality,
      rotation,
      authoritativeDifferingTurfAdjacencies: 289,
      sameElevationDifferingTurfAdjacencies: 261,
      omittedDifferentElevation: 28,
      omittedSamePresentation: 157,
      presentationDifferingTurfAdjacencies: 108,
      presentationSameElevationDifferingTurfAdjacencies: 104,
      presentationOmittedDifferentElevation: 4,
      omittedBlocked: 0,
      plannedStrips: 104,
      emittedStrips: 104,
      cornerCandidates: 16,
      plannedCorners: 16,
      emittedCorners: 16,
      omittedMixedPairCorners: 2,
      missingOwners: 0,
      pairCounts: {
        "fairway--green": 8,
        "fairway--rough": 61,
        "fairway--tee": 6,
        "rough--green": 15,
        "rough--tee": 14,
      },
      directionCounts: { n: 31, e: 20, s: 31, w: 22 },
      exactlyOnceOwnerKeys: true,
      mixedPairMasks: 0,
      samePresentationEmitters: 0,
      fullCellSprites: 0,
      ownershipOverlaps: 0,
      doubleOwners: 0,
      missingAssetSourceIds: [],
    });
    expect(Object.values(fringe.pairCounts).reduce((sum: number, count) => sum + Number(count), 0)).toBe(104);
    expect(new Set(fringe.assetSourceIds).size).toBe(fringe.assetSourceIds.length);
    expect(fringe.assetSourceHashes).toHaveLength(fringe.assetSourceIds.length);
    expect(fringe.assetSourceIds.every((id) => id.startsWith(`${quality}/`))).toBe(true);
    expect(fringe.assetSourceHashes.every((hash) => /^[a-f0-9]{64}$/u.test(hash))).toBe(true);
    expect(fringe.authorityHashes.tilesAfter).toBe(fringe.authorityHashes.tilesBefore);
    expect(fringe.authorityHashes.elevationsAfter).toBe(fringe.authorityHashes.elevationsBefore);
    // Fixture quality switches retain previously loaded bundles by design;
    // each selected tier contributes exactly one 86-role packet.
    expect(renderer.residency.parklandComposableFields).toBeGreaterThanOrEqual(86);
    expect(renderer.residency.parklandComposableFields % 86).toBe(0);
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
      fringe,
    });
  };

  for (const rotation of [0, 90, 180, 270]) {
    await capture("hole100", "standard", "medium", rotation, 1, { x: 24, y: 18 });
  }
  for (const rotation of [0, 90]) {
    await capture("hole100", "standard", "high", rotation, 1, { x: 24, y: 18 });
    await capture("green200", "standard", "high", rotation, 2, { x: 39, y: 20 });
  }
  await capture("overview50", "standard", "medium", 0, 0.5, { x: 24, y: 18 });
  await capture("hole100", "standard", "low", 0, 1, { x: 24, y: 18 });
  for (const mode of ["deuteranopia", "protanopia", "tritanopia"] as const) {
    await applyPalette(page, mode);
    await capture("hole100", mode, "medium", 0, 1, { x: 24, y: 18 });
  }

  const finalCourseHash = await page.evaluate(() => window.__coursecraftTest!.state().courseHash);
  expect(captures).toHaveLength(13);
  expect(new Set(captures.map((item) => (
    `${item.label}:${item.mode}:${item.quality}:${item.rotation}:${item.zoom}`
  ))).size).toBe(13);
  expect(finalCourseHash).toBe(initialCourseHash);
  expect(runtimeErrors).toEqual([]);
  const reportPath = resolve(outputRoot, "zk459-pair-fringes-report.json");
  await writeFile(reportPath, `${JSON.stringify({
    version: 1,
    issue: "ZK-459",
    fixture: "m19Fixture",
    initialCourseHash,
    finalCourseHash,
    runtimeErrors,
    captures,
  }, null, 2)}\n`);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  expect(report.captures).toHaveLength(13);
});
