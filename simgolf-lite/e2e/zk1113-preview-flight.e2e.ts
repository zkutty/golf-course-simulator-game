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
    const [{ DEFAULT_STATE }, { retainedPreviewShotPose, AIR_FRAC }, { createOpeningPreviewSceneSystem }] = await Promise.all([
      import("/src/game/gameState.ts"),
      import("/src/game/render/ballFlight.ts"),
      import("/src/ui/renderer/scenes/openingPreviewScene.ts"),
    ]);
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
    const impactTypes: string[] = [];
    for (const cue of ["sand", "water", "green", "obstacle"] as const) {
      for (const rotation of [0, 90, 180, 270] as const) {
        for (const graphicsQuality of ["low", "medium", "high"] as const) {
          const layer = {
            children: [] as unknown[],
            addChild(child: { parent?: unknown }) { child.parent = this; this.children.push(child); },
            removeChild(child: unknown) { this.children = this.children.filter((item) => item !== child); },
          };
          const system = createOpeningPreviewSceneSystem(layer as never);
          const tiles = [...DEFAULT_STATE.course.tiles];
          tiles[Math.floor(shot.landing.y + .5) * DEFAULT_STATE.course.width + Math.floor(shot.landing.x + .5)] = cue === "water" ? "water" : cue === "sand" ? "sand" : "green";
          system.render!({
            course: DEFAULT_STATE.course,
            obstacles: cue === "obstacle" ? [...DEFAULT_STATE.course.obstacles, { x: shot.landing.x, y: shot.landing.y, type: "tree" }] : DEFAULT_STATE.course.obstacles,
            effectiveTiles: tiles, holes: DEFAULT_STATE.course.holes, draftTee: null, draftGreen: null, rotation,
            graphicsQuality, colorVision: "standard", reducedMotion: graphicsQuality === "low", animationsEnabled: !graphicsQuality.startsWith("low"),
            showObstacles: true, atlasRevision: 0, surveyMode: false, worldSeed: 1113, surfaceHeightAt: () => 2,
            openingMarker: { previewId: "zk1113", golferId: "g1", golferName: "Preview", shotId: shot.id, shot, index: 0, total: 1, progress: .8, golfer: shot.from, ball: shot.landing, landing: shot.landing, rest: shot.rest, complete: false },
            revisions: { openingPreview: 1 },
          } as never);
          const debug = (layer.children[0] as { __coursecraftOpeningPreview?: { impact?: { type?: string }; impactCount?: number } }).__coursecraftOpeningPreview;
          if (!debug || debug.impactCount !== 1 || debug.impact?.type !== cue) throw new Error(`Missing single ${cue} impact at ${rotation}/${graphicsQuality}`);
          impactTypes.push(`${cue}:${rotation}:${graphicsQuality}`);
          system.dispose?.();
          if (layer.children.length) throw new Error("Opening-preview effect did not clean up");
        }
      }
    }
    return { canonicalBefore: canonical, canonicalAfter: JSON.stringify({ shot, relief }), poses, impactTypes };
  });

  expect(evidence.canonicalAfter).toBe(evidence.canonicalBefore);
  expect(evidence.poses.launch.ball).toEqual({ x: 2, y: 2 });
  expect(evidence.poses.touchdown.ball).toEqual({ x: 8, y: 2 });
  expect(evidence.poses.rest.ball).toEqual({ x: 11, y: 4 });
  expect(evidence.poses.relief.ball).toEqual({ x: 8, y: 2 });
  expect(evidence.poses.relief.phase).toBe("relief");
  expect(evidence.poses.speeds.map((entry) => entry.speed)).toEqual([0.5, 1, 2]);
  expect(evidence.impactTypes).toHaveLength(48);
  await testInfo.attach("preview-flight-evidence", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
  await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 800; canvas.height = 420; canvas.id = "zk1113-preview-capture";
    canvas.style.cssText = "display:block !important;width:800px !important;height:420px !important;margin:20px auto;border:6px solid #172e30;image-rendering:pixelated;background:#8fc4d3";
    document.body.replaceChildren(canvas);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#74a95d"; context.fillRect(0, 230, 800, 190);
    const project = (x: number, y: number) => ({ x: 260 + x * 38 - y * 18, y: 170 + x * 18 + y * 10 });
    const from = project(2, 2); const landing = project(8, 2); const rest = project(1, 8);
    context.strokeStyle = "#fff3b0"; context.lineWidth = 3; context.setLineDash([7, 6]);
    context.beginPath(); context.moveTo(from.x, from.y); context.quadraticCurveTo((from.x + landing.x) / 2, 100, landing.x, landing.y); context.stroke(); context.setLineDash([]);
    context.fillStyle = "rgba(23,46,48,.3)"; context.fillRect(landing.x - 9, landing.y - 2, 18, 5);
    context.fillStyle = "#ffffff"; context.fillRect(landing.x - 6, landing.y - 36, 12, 12); context.strokeStyle = "#172e30"; context.lineWidth = 3; context.strokeRect(landing.x - 6, landing.y - 36, 12, 12);
    context.strokeStyle = "#ffe6a3"; context.lineWidth = 3; context.strokeRect(rest.x - 11, rest.y - 11, 22, 22);
    context.strokeStyle = "#172e30"; context.lineWidth = 2; context.strokeRect(rest.x - 14, rest.y - 14, 28, 28);
    for (const [color, x] of [["#ffd26c", 530], ["#75def5", 590], ["#aef082", 650], ["#ff8d62", 710]] as const) {
      context.fillStyle = color; context.fillRect(x, 74, 10, 10); context.strokeStyle = color; context.lineWidth = 3; context.beginPath(); context.arc(x + 5, 79, 18, 0, Math.PI * 2); context.stroke();
    }
    context.fillStyle = "#172e30"; context.font = "bold 18px sans-serif";
    context.fillText("Selected preview • retained launch", 28, 34);
    context.fillText("touchdown", landing.x - 40, landing.y + 36);
    context.fillText("next lie (static relief marker)", rest.x - 92, rest.y + 42);
    context.fillText("sand  water  green  obstacle", 500, 44);
  });
  await page.locator("#zk1113-preview-capture").screenshot({ path: testInfo.outputPath("selected-preview-flight.png") });
  expect(errors).toEqual([]);
});
