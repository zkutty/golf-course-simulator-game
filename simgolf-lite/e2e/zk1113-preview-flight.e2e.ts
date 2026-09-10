import { expect, test } from "@playwright/test";

test("ZK-1113 selected-preview flight remains bounded across display settings", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /quick start/i })).toBeVisible();

  const evidence = await page.evaluate(async () => {
    localStorage.setItem("coursecraft_ambience", "off");
    const { DEFAULT_STATE } = await import("/src/game/gameState.ts");
    const { retainedPreviewShotPose, AIR_FRAC } = await import("/src/game/render/ballFlight.ts");
    const { createOpeningPreviewSceneSystem } = await import("/src/ui/renderer/scenes/openingPreviewScene.ts");
    const pixiUrl = performance.getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((entry) => entry.includes("/pixi__js.js"));
    if (!pixiUrl) throw new Error("Production Pixi module was not loaded by openingPreviewScene");
    const PIXI = await import(pixiUrl);
    const app = new PIXI.Application();
    await app.init({ width: 800, height: 480, backgroundColor: 0x24515a, antialias: false, resolution: 1 });
    app.canvas.id = "zk1113-production-preview";
    app.canvas.style.cssText = "display:block !important;width:800px !important;height:480px !important;margin:20px auto;border:6px solid #172e30;image-rendering:pixelated";
    document.body.replaceChildren(app.canvas);
    const shot = {
      id: "zk1113-retained-shot", shotNumber: 1, intent: "approach" as const, club: "8i",
      from: { x: 2, y: 2 }, landing: { x: 8, y: 2 }, rest: { x: 11, y: 4 }, lieAfter: "green", penaltyStrokes: 0,
      flight: { profile: "high" as const, apexHeightYards: 8 }, rollPath: [{ x: 8, y: 4 }, { x: 11, y: 4 }],
    };
    const relief = { ...shot, id: "zk1113-relief", rest: { x: 1, y: 8 }, penaltyStrokes: 1 };
    const canonical = JSON.stringify({ shot, relief });
    const poses = {
      launch: retainedPreviewShotPose(shot, 0),
      touchdown: retainedPreviewShotPose(shot, AIR_FRAC),
      rest: retainedPreviewShotPose(shot, 1),
      speeds: ([0.5, 1, 2] as const).map((speed) => ({ speed, pose: retainedPreviewShotPose(shot, Math.min(1, .35 * speed)) })),
      relief: retainedPreviewShotPose(relief, 1),
    };
    const snapshotFor = (activeShot: typeof shot, progress: number, cue: "sand" | "water" | "green" | "obstacle", rotation = 0, graphicsQuality = "high", reducedMotion = false) => {
      const tiles = [...DEFAULT_STATE.course.tiles];
      tiles[Math.floor(activeShot.landing.y + .5) * DEFAULT_STATE.course.width + Math.floor(activeShot.landing.x + .5)] = cue === "water" ? "water" : cue === "sand" ? "sand" : "green";
      return {
        course: DEFAULT_STATE.course,
        obstacles: cue === "obstacle" ? [...DEFAULT_STATE.course.obstacles, { x: activeShot.landing.x, y: activeShot.landing.y, type: "tree" }] : DEFAULT_STATE.course.obstacles,
        effectiveTiles: tiles, holes: DEFAULT_STATE.course.holes, draftTee: null, draftGreen: null, rotation,
        graphicsQuality, colorVision: "standard", reducedMotion, animationsEnabled: !reducedMotion,
        showObstacles: true, atlasRevision: 0, surveyMode: false, worldSeed: 1113, surfaceHeightAt: () => 2,
        openingMarker: { previewId: "zk1113", golferId: "g1", golferName: "Preview", shotId: activeShot.id, shot: activeShot, index: 0, total: 1, progress, golfer: activeShot.from, ball: activeShot.landing, landing: activeShot.landing, rest: activeShot.rest, complete: false },
        revisions: { openingPreview: 1 },
      } as never;
    };
    const impactTypes: string[] = [];
    for (const cue of ["sand", "water", "green", "obstacle"] as const) {
      for (const rotation of [0, 90, 180, 270] as const) {
        for (const graphicsQuality of ["low", "medium", "high"] as const) {
          const layer = new PIXI.Container(); app.stage.addChild(layer);
          const system = createOpeningPreviewSceneSystem(layer);
          system.render!(snapshotFor(shot, .8, cue, rotation, graphicsQuality, graphicsQuality === "low"));
          app.renderer.render(app.stage);
          const debug = (layer.children[0] as { __coursecraftOpeningPreview?: { impact?: { type?: string }; impactCount?: number } }).__coursecraftOpeningPreview;
          if (!debug || debug.impactCount !== 1 || debug.impact?.type !== cue) throw new Error(`Missing single ${cue} impact at ${rotation}/${graphicsQuality}`);
          impactTypes.push(`${cue}:${rotation}:${graphicsQuality}`);
          system.dispose?.();
          if (layer.children.length) throw new Error("Opening-preview effect did not clean up");
          app.stage.removeChild(layer); layer.destroy();
        }
      }
    }
    const captureLayer = new PIXI.Container(); captureLayer.position.set(380, 120); app.stage.addChild(captureLayer);
    const captureSystem = createOpeningPreviewSceneSystem(captureLayer);
    const diagnostics = () => (captureLayer.children[0] as { __coursecraftOpeningPreview?: { impact?: { type?: string }; impactCount?: number } }).__coursecraftOpeningPreview;
    captureSystem.render!(snapshotFor(shot, .5, "green")); app.renderer.render(app.stage);
    (window as unknown as { __zk1113RenderImpact?: () => unknown }).__zk1113RenderImpact = () => {
      captureLayer.position.set(380, 120); captureSystem.render!(snapshotFor(shot, .8, "green")); app.renderer.render(app.stage); return diagnostics();
    };
    (window as unknown as { __zk1113RenderRelief?: () => unknown }).__zk1113RenderRelief = () => {
      captureLayer.position.set(380, 120); captureSystem.render!(snapshotFor(relief, 1, "water")); app.renderer.render(app.stage); return diagnostics();
    };
    return { canonicalBefore: canonical, canonicalAfter: JSON.stringify({ shot, relief }), poses, impactTypes, diagnostics: diagnostics() };
  });

  expect(evidence.canonicalAfter).toBe(evidence.canonicalBefore);
  expect(evidence.poses.launch.ball).toEqual({ x: 2, y: 2 });
  expect(evidence.poses.touchdown.ball).toEqual({ x: 8, y: 2 });
  expect(evidence.poses.rest.ball).toEqual({ x: 11, y: 4 });
  expect(evidence.poses.relief.ball).toEqual({ x: 8, y: 2 });
  expect(evidence.poses.relief.phase).toBe("relief");
  expect(evidence.poses.speeds.map((entry) => entry.speed)).toEqual([0.5, 1, 2]);
  expect(evidence.impactTypes).toHaveLength(48);
  expect(evidence.diagnostics).toMatchObject({ impact: null, impactCount: 0 });
  await testInfo.attach("preview-flight-evidence", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
  const settleCanvas = () => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await settleCanvas();
  await page.locator("#zk1113-production-preview").screenshot({ path: testInfo.outputPath("moving-ball.png") });
  const impactDiagnostics = await page.evaluate(() => (window as unknown as { __zk1113RenderImpact: () => unknown }).__zk1113RenderImpact());
  expect(impactDiagnostics).toMatchObject({ impact: { type: "green" }, impactCount: 1 });
  await settleCanvas();
  await page.locator("#zk1113-production-preview").screenshot({ path: testInfo.outputPath("green-impact.png") });
  const reliefDiagnostics = await page.evaluate(() => (window as unknown as { __zk1113RenderRelief: () => unknown }).__zk1113RenderRelief());
  expect(reliefDiagnostics).toMatchObject({ impact: { type: "water" }, impactCount: 1 });
  await settleCanvas();
  await page.locator("#zk1113-production-preview").screenshot({ path: testInfo.outputPath("penalty-touchdown-relief-marker.png") });
  expect(errors).toEqual([]);
});
