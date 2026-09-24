import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const outputRoot = resolve(
  process.env.ZK1200_EVIDENCE_DIR ?? "/private/tmp/zk1200-dependency-complete-cycle1-evidence",
);
const profileKey = "coursecraft_app_profile_v5";
type Quality = "high" | "medium" | "low";
type Mode = "standard" | "deuteranopia" | "protanopia" | "tritanopia";
type RendererState = ReturnType<NonNullable<Window["__coursecraftPixiTest"]>["rendererAtlasState"]>;

async function applyPalette(page: Page, mode: Mode) {
  await page.evaluate(({ key, mode }) => {
    const profile = JSON.parse(localStorage.getItem(key) ?? "{}");
    profile.version = 5;
    profile.tutorialOffered = true;
    profile.tutorialCompleted = true;
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

function deterministicPresentationProjection(renderer: RendererState) {
  const shared = renderer.sharedContours;
  const fringe = renderer.parklandComposable.pairFringes;
  return {
    policy: shared.policy,
    mappings: shared.mappings,
    authoritativeBytes: shared.authoritativeBytes,
    presentationBytes: shared.presentationBytes,
    authoritativeCellCounts: shared.authoritativeCellCounts,
    presentationCellCounts: shared.presentationCellCounts,
    authoritativeComponentCounts: shared.authoritativeComponentCounts,
    presentationComponentCounts: shared.presentationComponentCounts,
    authoritativeRingCounts: shared.authoritativeRingCounts,
    presentationRingCounts: shared.presentationRingCounts,
    pair: fringe && {
      authoritativeDifferingTurfAdjacencies: fringe.authoritativeDifferingTurfAdjacencies,
      sameElevationDifferingTurfAdjacencies: fringe.sameElevationDifferingTurfAdjacencies,
      omittedDifferentElevation: fringe.omittedDifferentElevation,
      omittedSamePresentation: fringe.omittedSamePresentation,
      presentationDifferingTurfAdjacencies: fringe.presentationDifferingTurfAdjacencies,
      presentationSameElevationDifferingTurfAdjacencies:
        fringe.presentationSameElevationDifferingTurfAdjacencies,
      presentationOmittedDifferentElevation: fringe.presentationOmittedDifferentElevation,
      plannedStrips: fringe.plannedStrips,
      plannedCorners: fringe.plannedCorners,
      pairCounts: fringe.pairCounts,
      directionCounts: fringe.directionCounts,
      authorityHashes: fringe.authorityHashes,
    },
  };
}

test("ZK-1200 dependency-complete presentation is deterministic across the native matrix", async ({ page }) => {
  test.setTimeout(900_000);
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
  const initialState = await page.evaluate(() => window.__coursecraftTest!.state());
  const initialCourseHash = initialState.courseHash;
  expect(initialCourseHash).toBe("3cf67481");

  const captures: Array<Record<string, unknown>> = [];
  let deterministicProjection: unknown = null;
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
      const renderer = window.__coursecraftPixiTest!.rendererAtlasState();
      return renderer.parklandComposable.active
        && renderer.parklandComposable.quality === quality
        && renderer.parklandComposable.camera.rotation === rotation
        && Math.abs(renderer.parklandComposable.camera.zoom - zoom) < 0.001;
    }, { quality, rotation, zoom }), { timeout: 90_000 }).toBe(true);
    await page.waitForTimeout(250);
    const renderer = await page.evaluate(() => window.__coursecraftPixiTest!.rendererAtlasState());
    expect(renderer.sharedContours).toMatchObject({
      authoritativeSingletonDeepRough: 0,
      distinctSingletonDeepRoughFields: 0,
      distinctSingletonDeepRoughBands: 0,
      coalescedSingletonDeepRough: 0,
      enclosedSingletonRoughToFairway: 0,
      authoritativeCellCounts: { fairway: 182, rough: 1012, deep_rough: 275 },
      presentationCellCounts: { fairway: 182, rough: 1012, deep_rough: 275 },
      authoritativeComponentCounts: { fairway: 1, rough: 3, deep_rough: 3 },
      presentationComponentCounts: { fairway: 1, rough: 3, deep_rough: 3 },
      authoritativeRingCounts: { fairway: 1, rough: 4, deep_rough: 3 },
      presentationRingCounts: { fairway: 1, rough: 4, deep_rough: 3 },
      tileSurfaceConnectedMasks: 0,
    });
    expect(renderer.sharedContours.policy).toEqual({
      classification: {
        fairway: "tile-surface", rough: "tile-surface", deep_rough: "tile-surface",
        green: "tile-surface", tee: "tile-surface", sand: "organic-hazard",
        water: "organic-hazard", wetland: "organic-hazard", waste_area: "organic-hazard",
        path: "route",
      },
      tileSurface: ["fairway", "rough", "deep_rough", "green", "tee"],
      organicHazard: ["sand", "water", "wetland", "waste_area"],
      route: ["path"],
    });
    expect(renderer.sharedContours.mappings).toEqual([]);

    expect(renderer.parklandComposable).toMatchObject({
      active: true,
      source: "approved-zk463-assets",
      undercoatDraws: 1,
      semanticComposition: "motif-ink-over-common-undercoat",
      samePresentationEmitters: 0,
      emittedLegacyTurfContourRuns: 0,
      fullCellOutlines: false,
      legacyDiamondTopPlane: false,
    });
    expect(renderer.parklandComposable.pairFringes).toMatchObject({
      authoritativeDifferingTurfAdjacencies: 191,
      sameElevationDifferingTurfAdjacencies: 185,
      omittedDifferentElevation: 6,
      omittedSamePresentation: 98,
      presentationDifferingTurfAdjacencies: 191,
      presentationSameElevationDifferingTurfAdjacencies: 185,
      presentationOmittedDifferentElevation: 6,
      omittedBlocked: 0,
      plannedStrips: 87,
      emittedStrips: 87,
      cornerCandidates: 7,
      plannedCorners: 7,
      emittedCorners: 7,
      omittedMixedPairCorners: 0,
      missingOwners: 0,
      exactlyOnceOwnerKeys: true,
      mixedPairMasks: 0,
      samePresentationEmitters: 0,
      fullCellSprites: 0,
      ownershipOverlaps: 0,
      doubleOwners: 0,
      missingAssetSourceIds: [],
      pairCounts: {
        "fairway--green": 8,
        "fairway--deep_rough": 23,
        "fairway--rough": 21,
        "fairway--tee": 5,
        "rough--green": 15,
        "rough--tee": 15,
      },
      directionCounts: { n: 30, e: 13, s: 29, w: 15 },
    });
    expect(renderer.parklandComposable.pairFringes.authorityHashes.tilesBefore)
      .toBe(renderer.parklandComposable.pairFringes.authorityHashes.tilesAfter);
    expect(renderer.parklandComposable.pairFringes.authorityHashes.presentationTilesBefore)
      .toBe(renderer.parklandComposable.pairFringes.authorityHashes.presentationTilesAfter);
    expect(renderer.parklandComposable.pairFringes.authorityHashes.elevationsBefore)
      .toBe(renderer.parklandComposable.pairFringes.authorityHashes.elevationsAfter);
    if (quality === "low") expect(renderer.counts?.connectedSurfaces).toBe(0);

    const projection = deterministicPresentationProjection(renderer);
    if (deterministicProjection == null) deterministicProjection = projection;
    else expect(projection).toEqual(deterministicProjection);
    expect(await page.evaluate(() => window.__coursecraftTest!.state().courseHash)).toBe(initialCourseHash);
    const bytes = await page.screenshot({ fullPage: false });
    const file = resolve(
      outputRoot,
      `zk1200-${label}-${mode}-${quality}-r${rotation}-z${Math.round(zoom * 100)}-1440x900.png`,
    );
    await writeFile(file, bytes);
    captures.push({
      file,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      width: 1440,
      height: 900,
      label,
      mode,
      quality,
      rotation,
      zoom,
      renderer,
    });
  };

  for (const rotation of [0, 90, 180, 270]) {
    await capture("hole100", "standard", "medium", rotation, 1, { x: 24, y: 18 });
  }
  for (const rotation of [0, 90]) {
    await capture("hole100", "standard", "high", rotation, 2, { x: 24, y: 18 });
    await capture("green200", "standard", "high", rotation, 2, { x: 39, y: 20 });
  }
  await capture("overview50", "standard", "medium", 0, 0.5, { x: 24, y: 18 });
  await capture("hole100", "standard", "low", 0, 1, { x: 24, y: 18 });

  for (const mode of ["deuteranopia", "protanopia", "tritanopia"] as const) {
    await applyPalette(page, mode);
    await capture("accessibility-hole100", mode, "medium", 0, 1, { x: 24, y: 18 });
  }

  const beforeRepeat = deterministicProjection;
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), {
    timeout: 90_000,
  }).toBe("game");
  await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest));
  await expect.poll(() => page.evaluate(() => (
    window.__coursecraftPixiTest!.rendererAtlasState().parklandComposable.active
  )), { timeout: 90_000 }).toBe(true);
  const afterRepeat = await page.evaluate(() => window.__coursecraftPixiTest!.rendererAtlasState());
  expect(deterministicPresentationProjection(afterRepeat)).toEqual(beforeRepeat);
  expect(await page.evaluate(() => window.__coursecraftTest!.state().courseHash)).toBe(initialCourseHash);

  await page.keyboard.press("Control+KeyS");
  await expect(page.locator('.sr-only[role="status"]')).toContainText("Quick save complete");
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().paused)).toBe(true);
  await page.getByRole("button", { name: /load game/i }).click();
  await expect(page.getByTestId("save-slot-quick-save")).toContainText("Quick Save");
  await page.getByTestId("save-slot-quick-save")
    .getByRole("button", { name: "Load", exact: true })
    .click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screenBase), {
    timeout: 90_000,
  }).toBe("in-game");
  await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest));
  await expect.poll(() => page.evaluate(() => (
    window.__coursecraftPixiTest!.rendererAtlasState().parklandComposable.pairFringes?.exactlyOnceOwnerKeys
      ?? false
  )), { timeout: 90_000 }).toBe(true);
  const afterLoad = await page.evaluate(() => window.__coursecraftPixiTest!.rendererAtlasState());
  expect(deterministicPresentationProjection(afterLoad)).toEqual(beforeRepeat);
  const postLoadState = await page.evaluate(() => window.__coursecraftTest!.state());
  expect(postLoadState.terrainCounts).toEqual(initialState.terrainCounts);

  // The fixture's state hash includes world/live state that the save loader
  // normalizes. Restore the exact canonical fixture after proving terrain and
  // presentation parity so the retained final state is the required M19 hash.
  await page.goto("/?m19Fixture=1");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().courseHash), {
    timeout: 90_000,
  }).toBe(initialCourseHash);
  await page.waitForFunction(() => Boolean(
    window.__coursecraftPixiTest?.rendererAtlasState().parklandComposable.pairFringes?.exactlyOnceOwnerKeys,
  ));
  const finalRenderer = await page.evaluate(() => window.__coursecraftPixiTest!.rendererAtlasState());
  expect(deterministicPresentationProjection(finalRenderer)).toEqual(beforeRepeat);

  expect(captures).toHaveLength(13);
  expect(runtimeErrors).toEqual([]);
  const reportPath = resolve(outputRoot, "zk1200-dependency-complete-report.json");
  await writeFile(reportPath, `${JSON.stringify({
    version: 1,
    issue: "ZK-1200",
    viewport: { width: 1440, height: 900 },
    initialCourseHash,
    postLoadStateHash: postLoadState.courseHash,
    finalCourseHash: await page.evaluate(() => window.__coursecraftTest!.state().courseHash),
    deterministicProjection,
    runtimeErrors,
    captures,
  }, null, 2)}\n`);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  expect(report.captures).toHaveLength(13);
});
