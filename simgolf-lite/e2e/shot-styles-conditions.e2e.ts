import { writeFileSync } from "node:fs";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { PNG } from "pngjs";
import { assertUncoveredRoi, captureClock, installedCaptureClock, installCaptureClock } from "./retained-shot-capture-clock";
import type { PlayerPlayableRound } from "../src/game/models/playerProTypes";
import { sampleRetainedShotMotion, type RetainedShotMotionV1 } from "../src/game/rules/shotMotion";
import { worldToIso, type IsoRotation } from "../src/game/render/iso";
import { sampleGreenRolloutSurface } from "../src/game/greens/greenRollout";

// Setup-only terrain/obstacles. No round, pending shot, outcome or cursor is injected.
const state = (page: Page) => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
const round = async (page: Page) => (await state(page)).playerPro.activeRound;
async function triggerQuickSave(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press("Control+KeyS");
}
async function waitForQuickSave(page: Page) {
  const clock = installedCaptureClock(page);
  if (!clock) {
    await expect(page.locator('.sr-only[role="status"]')).toContainText("Quick save complete");
    return;
  }
  await expect.poll(async () => {
    await clock.flushTimers();
    return page.locator('.sr-only[role="status"]').textContent();
  }).toContain("Quick save complete");
}
async function quickSave(page: Page) {
  await triggerQuickSave(page);
  await waitForQuickSave(page);
}
async function savedRound(page: Page): Promise<PlayerPlayableRound | null> {
  return page.evaluate(async () => {
    const path = "/src/utils/saveStore.ts";
    return (await (await import(path)).loadSlot("quick-save"))?.world.playerPro?.activeRound ?? null;
  });
}
async function verifyCommittedShot(page: Page) {
  await waitForQuickSave(page);
  await expect.poll(async () => (await savedRound(page))?.pendingShot?.sharedOutcome?.motion?.identity.shotId).not.toBeUndefined();
  const saved = (await savedRound(page))!;
  return { saved, shot: saved.pendingShot!, motion: saved.pendingShot!.sharedOutcome!.motion! };
}
type CommittedShot = Awaited<ReturnType<typeof verifyCommittedShot>>;
type ReadCommittedShot = () => Promise<CommittedShot>;
// Independent camera prerequisite for the two views whose launch point initially
// projects beneath the HUD. All inputs remain native pointer/key/wheel events.
async function cameraPreflight(page: Page, rotation: IsoRotation) {
  const bounds = await page.locator(".cc-pixi-stage").boundingBox();
  if (!bounds) throw new Error("Missing native canvas bounds.");
  const exposed = { x: bounds.x + 320, y: bounds.y + 420 };
  const assertCanvas = async (point: { x: number; y: number }) => {
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y) === document.querySelector(".cc-pixi-stage canvas"), point),
      "native camera input must land on uncovered canvas").toBe(true);
  };
  await assertCanvas(exposed);
  await page.mouse.click(exposed.x, exposed.y);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.viewportInputState()?.attached)).toBe(true);
  for (let step = 0; step < rotation / 90; step++) {
    await assertCanvas(exposed);
    await page.keyboard.press("KeyE");
    await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.viewportInputState()?.rotation.committed)).toBe((step + 1) * 90);
    await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.viewportInputState()?.rotation.tweening)).toBe(false);
    await page.waitForTimeout(350);
  }
  const panLaunch = async () => {
    for (let step = 0; step < 5; step++) {
      const at = await page.evaluate(() => window.__coursecraftPixiTest!.tileToScreen(4, 8));
      if (!at) throw new Error("Missing launch projection.");
      if (Math.abs(at.x - 330) < 30 && Math.abs(at.y - 420) < 30) break;
      const end = { x: exposed.x + Math.max(-180, Math.min(180, 330 - at.x)),
        y: exposed.y + Math.max(-150, Math.min(150, 420 - at.y)) };
      await assertCanvas(exposed); await assertCanvas(end);
      await page.mouse.move(exposed.x, exposed.y);
      await page.mouse.down({ button: "middle" });
      await page.mouse.move(end.x, end.y, { steps: 4 });
      await page.mouse.up({ button: "middle" });
      await page.waitForFunction(() => {
        const camera = window.__coursecraftPixiTest!.cameraTransform()?.camera;
        return camera && Math.abs(camera.center.x - camera.targetCenter.x) < .01 && Math.abs(camera.center.y - camera.targetCenter.y) < .01;
      });
    }
  };
  // Pan BEFORE wheel so the tee cannot route zoom into the shot HUD.
  await panLaunch();
  for (let step = 0; step < 8; step++) {
    const zoom = await page.evaluate(() => window.__coursecraftPixiTest!.cameraTransform()?.camera.zoom ?? 0);
    if (zoom >= .65) break;
    const at = await page.evaluate(() => window.__coursecraftPixiTest!.tileToScreen(4, 8));
    if (!at) throw new Error("Missing wheel anchor.");
    const wheel = { x: bounds.x + at.x, y: bounds.y + at.y };
    await assertCanvas(wheel);
    await page.mouse.move(wheel.x, wheel.y);
    await page.mouse.wheel(0, -120);
    await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.cameraTransform()?.camera.zoom ?? 0)).toBeGreaterThan(zoom + .02);
    await page.waitForFunction(() => {
      const camera = window.__coursecraftPixiTest!.cameraTransform()?.camera;
      return camera && Math.abs(camera.zoom - camera.targetZoom) < .0001;
    });
  }
  await panLaunch();
  const at = await page.evaluate(() => window.__coursecraftPixiTest!.tileToScreen(4, 8));
  if (!at) throw new Error("Missing final launch projection.");
  await assertCanvas({ x: bounds.x + at.x, y: bounds.y + at.y });
  expect(Math.abs(at.x - 330)).toBeLessThan(30);
  expect(Math.abs(at.y - 420)).toBeLessThan(30);
}
function supportedWaterZoom(camera: { zoom: number; targetZoom: number } | null | undefined) {
  return Boolean(camera && Number.isFinite(camera.zoom) && Number.isFinite(camera.targetZoom)
    && camera.zoom > 0 && camera.targetZoom > 0 && Math.max(camera.zoom, camera.targetZoom) <= 0.8754523170304658
    && Math.abs(camera.zoom - camera.targetZoom) < .0001);
}
type FramingBounds = { x: number; y: number; width: number; height: number };
function waterPauseRoiGeometry(projection: { x: number; y: number }, image: { width: number; height: number },
  canvas: FramingBounds, section: FramingBounds, shadow: string) {
  const finite = [projection.x, projection.y, image.width, image.height, canvas.x, canvas.y, canvas.width, canvas.height,
    section.x, section.y, section.width, section.height].every(Number.isFinite);
  const dimensions = image.width > 0 && image.height > 0 && canvas.width > 0 && canvas.height > 0 && section.width > 0 && section.height > 0;
  const roiInside = Math.round(projection.x) - 3 >= 0 && Math.round(projection.x) + 3 < image.width
    && Math.round(projection.y) - 3 >= 0 && Math.round(projection.y) + 3 < image.height;
  const sectionIntersects = section.x < canvas.x + canvas.width && section.x + section.width > canvas.x
    && section.y < canvas.y + canvas.height && section.y + section.height > canvas.y;
  const sourceShadowMatches = shadow === "rgba(0, 0, 0, 0.42) 0px 24px 64px 0px";
  const roiRightCss = canvas.x + (Math.round(projection.x) + 3 + .5) * canvas.width / image.width;
  const clearanceCss = section.x - roiRightCss;
  return { roiRightCss, clearanceCss, sourceShadowMatches,
    clear: finite && dimensions && roiInside && sectionIntersects && sourceShadowMatches && clearanceCss >= 128 };
}
async function setup(page: Page, scenario: "obstacle" | "water" | "slopes", rotation: IsoRotation = 0, controlledInfo?: TestInfo) {
  if (controlledInfo) await installCaptureClock(page, controlledInfo, { maxRuns: 160, maxLogicalMs: 8000 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  const tutorial = page.getByRole("dialog", { name: "First-launch tutorial" });
  if (await tutorial.count()) await tutorial.getByRole("button", { name: "Skip tutorial" }).click();
  await page.evaluate((scenario) => window.__coursecraftTest!.setPlayerProFixture({ shotStyles: true, scenario }), scenario);
  await page.getByTestId("workspace-operate").click();
  await page.getByTestId("open-player-pro").click();
  await page.getByTestId("player-pro-tab-play").click();
  await page.getByTestId("start-player-round").click();
  await expect(page.getByTestId("player-shot-hud")).toBeVisible();
  await expect.poll(async () => (await round(page)).phase).toBe("awaiting_shot");
  await expect.poll(() => page.evaluate(() => Boolean(window.__coursecraftPixiTest))).toBe(true);
  // The diagnostic API can mount before the asynchronous Pixi input controller.
  // Require native listeners before fitting the camera or sending rotation keys.
  await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.viewportInputState()?.attached)).toBe(true);
  await page.evaluate(() => window.__coursecraftPixiTest!.fitWholeCourse());
  if (rotation >= 180) {
    await cameraPreflight(page, rotation);
    if (controlledInfo) await captureClock(page).holdQuiescent("player");
    return errors;
  }
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  for (let step = 0; step < rotation / 90; step++) {
    await page.keyboard.press("KeyE");
    await expect.poll(async () => (await state(page)).camera.rotation).toBe((step + 1) * 90);
    await page.waitForTimeout(350); // Existing rotation tween settles before the next physical key.
  }
  const origin = await page.evaluate(() => window.__coursecraftPixiTest!.tileToScreen(4, 8));
  const bounds = await page.locator(".cc-pixi-stage").boundingBox();
  if (!origin || !bounds) throw new Error("Missing camera projection.");
  await page.mouse.move(bounds.x + origin.x, bounds.y + origin.y);
  for (let step = 0; step < 8; step++) {
    const zoom = await page.evaluate(() => window.__coursecraftPixiTest!.cameraTransform()?.camera.zoom ?? 0);
    if (zoom >= .65) break;
    await page.mouse.wheel(0, -120);
    await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.cameraTransform()?.camera.zoom ?? 0)).toBeGreaterThan(zoom + .02);
  }
  let waterTargetZoom: number | undefined;
  if (scenario === "water") {
    // Settle the original zoom before framing its full retained path left of the shadow.
    await page.waitForFunction(() => {
      const camera = window.__coursecraftPixiTest!.cameraTransform()?.camera;
      return camera && Math.abs(camera.zoom - camera.targetZoom) < .0001;
    });
    const camera = await page.evaluate(() => window.__coursecraftPixiTest!.cameraTransform()?.camera);
    expect(supportedWaterZoom(camera), "water framing requires its source-bounded original zoom").toBe(true);
    waterTargetZoom = camera!.targetZoom;
  }
  const launchX = scenario === "water" ? 150 : 330;
  // Real camera input keeps the shot left of the pause dialog.
  for (let step = 0; step < 5; step++) {
    const at = await page.evaluate(() => window.__coursecraftPixiTest!.tileToScreen(4, 8));
    if (!at) throw new Error("Missing launch projection.");
    if (Math.abs(at.x - launchX) < 30 && Math.abs(at.y - 420) < 30) break;
    await page.mouse.move(bounds.x + 320, bounds.y + 420);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(bounds.x + 320 + Math.max(-180, Math.min(180, launchX - at.x)),
      bounds.y + 420 + Math.max(-150, Math.min(150, 420 - at.y)), { steps: 4 });
    await page.mouse.up({ button: "middle" });
    await page.waitForFunction(() => {
      const camera = window.__coursecraftPixiTest!.cameraTransform()?.camera;
      return camera && Math.abs(camera.center.x - camera.targetCenter.x) < .01 && Math.abs(camera.center.y - camera.targetCenter.y) < .01;
    });
  }
  if (scenario === "water") {
    const framing = await page.evaluate(() => ({
      launch: window.__coursecraftPixiTest!.tileToScreen(4, 8),
      camera: window.__coursecraftPixiTest!.cameraTransform()?.camera,
    }));
    if (!framing.launch) throw new Error("Missing final water launch projection.");
    expect(Math.abs(framing.launch.x - launchX)).toBeLessThan(30);
    expect(Math.abs(framing.launch.y - 420)).toBeLessThan(30);
    expect(supportedWaterZoom(framing.camera)).toBe(true);
    expect(framing.camera!.targetZoom).toBe(waterTargetZoom);
  } else {
    await page.waitForFunction(() => {
      const camera = window.__coursecraftPixiTest!.cameraTransform()?.camera;
      return camera && Math.abs(camera.zoom - camera.targetZoom) < .0001;
    });
  }
  if (controlledInfo) await captureClock(page).holdQuiescent("player");
  return errors;
}
async function commit(page: Page, club: string, target: { x: number; y: number }, firstProgress: number, requireWaterAim = false) {
  await page.getByTestId("player-shot-club").selectOption(club);
  await page.getByTestId("player-shot-style").selectOption("straight_run");
  await page.getByTestId("player-shot-power").focus();
  await page.keyboard.press("Home");
  await expect(page.getByTestId("player-shot-power")).toHaveValue("25");
  const bounds = await page.locator(".cc-pixi-stage canvas").boundingBox();
  if (!bounds) throw new Error("Missing native canvas bounds.");
  const pointerExit = { x: bounds.x + bounds.width * .35, y: bounds.y + bounds.height * .45 };
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y) === document.querySelector(".cc-pixi-stage canvas"), pointerExit),
    "aim pointer exit must land on uncovered interior canvas").toBe(true);
  const screen = await page.evaluate((target) => window.__coursecraftPixiTest!.tileToScreen(target.x, target.y), target);
  if (!screen) throw new Error("Missing aim projection.");
  if (requireWaterAim) {
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y) === document.querySelector(".cc-pixi-stage canvas"),
      { x: bounds.x + screen.x, y: bounds.y + screen.y }), "water aim must hit uncovered canvas").toBe(true);
  }
  await page.locator(".cc-pixi-stage").click({ position: screen });
  await page.mouse.move(pointerExit.x, pointerExit.y);
  await expect.poll(async () => Math.hypot((await round(page)).aim.x - target.x, (await round(page)).aim.y - target.y)).toBeLessThan(1);
  await expect(page.getByTestId("commit-player-shot")).toBeEnabled();
  // The held scheduler keeps native commit/save sequential without consuming
  // the original phase. The bounded reader below owns every forward step.
  const firstPhase = () => captureClock(page).acquire(firstProgress, "airborne");
  await page.getByTestId("commit-player-shot").click();
  await triggerQuickSave(page);
  let committed: Promise<CommittedShot> | undefined;
  const readCommitted = () => committed ??= verifyCommittedShot(page);
  return { readCommitted, firstPhase };
}
async function pixelEvidence(page: Page, info: TestInfo, name: string, point: { x: number; y: number }, heightYards: number, marker: "ball" | "relief" | "penalty-rest" = "ball", requireWaterClearance = false, pausedOverlay?: Awaited<ReturnType<ReturnType<typeof captureClock>["clearView"]>>) {
  const camera = (await state(page)).camera;
  const iso = worldToIso(point.x + .5, point.y + .5, heightYards / 2.5, camera.rotation as IsoRotation);
  const transform = await page.evaluate(() => window.__coursecraftPixiTest!.cameraTransform());
  const canvas = page.locator(".cc-pixi-stage canvas");
  const bounds = await canvas.boundingBox();
  if (!transform || !bounds) throw new Error("Missing camera transform.");
  const body = await canvas.screenshot({ path: info.outputPath(name + ".png") });
  await info.attach(name, { body, contentType: "image/png" });
  const pixels = PNG.sync.read(body);
  const x = ((iso.x - transform.world.pivot.x) * transform.world.scale.x + transform.world.position.x) * pixels.width / bounds.width;
  const y = ((iso.y - 2 - transform.world.pivot.y) * transform.world.scale.y + transform.world.position.y) * pixels.height / bounds.height;
  expect(x).toBeGreaterThan(12); expect(x).toBeLessThan(pixels.width - 12);
  expect(y).toBeGreaterThan(12); expect(y).toBeLessThan(pixels.height - 12);
  let pauseGeometry: ReturnType<typeof waterPauseRoiGeometry> | undefined;
  if (requireWaterClearance) {
    if (!pausedOverlay) throw new Error("Missing retained actual water pause geometry.");
    const { sectionBounds, bounds: canvasBounds, shadow } = pausedOverlay;
    expect(bounds).toEqual(canvasBounds);
    pauseGeometry = waterPauseRoiGeometry({ x, y }, pixels, canvasBounds, sectionBounds, shadow);
    expect(pauseGeometry.clear, "water's full PNG ROI must clear the original pause shadow by 128 CSS pixels: " + JSON.stringify(pauseGeometry)).toBe(true);
  }
  let count = 0;
  const radius = marker === "relief" ? 12 : 3;
  await assertUncoveredRoi(page, { x, y }, radius, pixels, bounds);
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    const index = (Math.round(y + dy) * pixels.width + Math.round(x + dx)) * 4;
    const [r, g, b] = [pixels.data[index], pixels.data[index + 1], pixels.data[index + 2]];
    if (marker === "relief" ? r > 100 && g > 70 && r > g * 1.1 && b < g * .8
      : marker === "penalty-rest" ? r > 120 && r > g * 1.5 && r > b * 1.5
      : Math.min(r, g, b) > 70 && Math.max(r, g, b) - Math.min(r, g, b) < 25) count++;
  }
  expect(count, marker + " must occupy its canonical retained projection").toBeGreaterThan(0);
  return { point, heightYards, iso, projection: { x, y }, visiblePixels: count, camera, transform, ...(pauseGeometry ? { pauseGeometry } : {}) };
}
async function capture(page: Page, info: TestInfo, readCommitted: ReadCommittedShot, progress: number, name: string, phase = "airborne", ready = () => captureClock(page).acquire(progress, phase), requireWaterClearance = false) {
  await ready();
  const pauseProof = await captureClock(page).nativePause();
  const frozen = pauseProof.frame!;
  const { shot, motion } = await readCommitted();
  expect(frozen.shotId).toBe(shot.id);
  expect(frozen.shotId).toBe(motion.identity.shotId);
  expect(frozen.motionProgress).toBeGreaterThanOrEqual(progress);
  const expected = sampleRetainedShotMotion(motion, frozen.motionProgress)!;
  expect(frozen.phase).toBe(phase);
  expect(frozen.point.x).toBeCloseTo(expected.point.x, 7);
  expect(frozen.point.y).toBeCloseTo(expected.point.y, 7);
  expect(frozen.heightYards).toBeCloseTo(expected.heightYards, 7);
  const pausedOverlay = await captureClock(page).clearView(name, pauseProof);
  const visible = await pixelEvidence(page, info, name, expected.point, expected.heightYards, "ball", requireWaterClearance, pausedOverlay);
  expect(frozen.ball.x).toBeCloseTo(visible.iso.x, 6);
  expect(frozen.ball.y).toBeCloseTo(visible.iso.y, 6);
  return { frozen, expected, visible, pausedOverlay };
}
async function finish(page: Page, motion: RetainedShotMotionV1) {
  await page.getByTestId("skip-player-shot").click();
  await captureClock(page).run(16, "render actual native Skip completion");
  await expect.poll(async () => (await round(page)).phase).not.toBe("flight");
  await quickSave(page);
  await expect.poll(async () => (await savedRound(page))?.pendingShot).toBeNull();
  const saved = (await savedRound(page))!;
  expect(saved.shots.at(-1)!.sharedOutcome!.motion).toEqual(motion);
  expect(saved.strokes).toBe(1);
  return saved;
}

for (const rotation of [180, 270] as const) test("camera preflight only: " + rotation, async ({ page }, info) => {
  const errors = await setup(page, "slopes", rotation);
  await quickSave(page);
  const current = (await savedRound(page))!;
  expect(current.phase).toBe("awaiting_shot");
  expect(current.pendingShot).toBeNull();
  expect(current.shots).toHaveLength(0);
  expect((await state(page)).camera.rotation).toBe(rotation);
  expect(errors).toEqual([]);
  await page.locator(".cc-pixi-stage canvas").screenshot({ path: info.outputPath("camera-preflight.png") });
  writeFileSync(info.outputPath("camera-preflight.json"), JSON.stringify({ rotation, camera: (await state(page)).camera,
    input: await page.evaluate(() => window.__coursecraftPixiTest!.viewportInputState()),
    transform: await page.evaluate(() => window.__coursecraftPixiTest!.cameraTransform()), errors }, null, 2));
});

test("obstacle collision and vertical drop use committed motion before static rest", async ({ page }, info) => {
  const errors = await setup(page, "obstacle", 0, info);
  const { readCommitted, firstPhase } = await commit(page, "7 Iron", { x: 18, y: 8 }, .2);
  const airborne = await capture(page, info, readCommitted, .2, "obstacle-before-contact", "airborne", firstPhase);
  const { motion, shot } = await readCommitted();
  expect(shot.sharedOutcome!.collision.kind).toBe("obstacle");
  expect(shot.rollYards).toBe(0);
  expect(motion.postCollisionPath.length).toBeGreaterThanOrEqual(2);
  const collision = motion.events.find((event) => event.kind === "collision")!;
  expect(collision.heightYards).toBeGreaterThan(motion.physicalRest.heightYards);
  const drop = await capture(page, info, readCommitted, .62, "obstacle-drop", "post_collision");
  expect(drop.expected.heightYards).toBeLessThan(collision.heightYards);
  const saved = await finish(page, motion);
  const rest = await pixelEvidence(page, info, "obstacle-rest", motion.physicalRest.point, motion.physicalRest.heightYards);
  expect(saved.penalties).toBe(0);
  writeFileSync(info.outputPath("obstacle-evidence.json"), JSON.stringify({ motion, collision, airborne, drop, rest, errors }, null, 2));
  expect(errors).toEqual([]);
  await captureClock(page).finalize();
});

test("water physical rest and static legal relief remain distinct with one penalty", async ({ page }, info) => {
  const errors = await setup(page, "water", 0, info);
  const { readCommitted, firstPhase } = await commit(page, "Driver", { x: 18, y: 8 }, .25, true);
  const airborne = await capture(page, info, readCommitted, .25, "water-airborne", "airborne", firstPhase, true);
  const { motion, shot } = await readCommitted();
  expect(shot.penaltyStrokes).toBe(1);
  expect(shot.sharedOutcome!.ruling.penaltyKind).toBe("penalty_area");
  expect(motion.reliefPosition).not.toBeNull();
  expect(motion.reliefPosition).not.toEqual(motion.physicalRest.point);
  const contact = await capture(page, info, readCommitted, .8, "water-ground-contact", "rollout", undefined, true);
  expect(contact.expected.point).not.toEqual(motion.reliefPosition);
  const saved = await finish(page, motion);
  expect(saved.penalties).toBe(1);
  expect(saved.ball).toEqual(shot.sharedOutcome!.finalPosition);
  expect(saved.shots).toHaveLength(1);
  const rest = await pixelEvidence(page, info, "water-physical-rest", motion.physicalRest.point, motion.physicalRest.heightYards, "penalty-rest");
  const relief = await pixelEvidence(page, info, "water-static-relief", motion.reliefPosition!, 0, "relief");
  expect(Math.hypot(rest.projection.x - relief.projection.x, rest.projection.y - relief.projection.y)).toBeGreaterThan(10);
  writeFileSync(info.outputPath("water-evidence.json"), JSON.stringify({ motion, shot, airborne, contact, rest, relief, savedPenalties: saved.penalties, errors }, null, 2));
  expect(errors).toEqual([]);
  await captureClock(page).finalize();
});

for (const scenario of [
  { name: "uphill-r0", target: { x: 18, y: 8 }, rotation: 0 as const },
  { name: "uphill-r1", target: { x: 18, y: 8 }, rotation: 90 as const },
  { name: "uphill-r2", target: { x: 18, y: 8 }, rotation: 180 as const },
  { name: "uphill-r3", target: { x: 18, y: 8 }, rotation: 270 as const },
  { name: "downhill-r0", target: { x: 1, y: 8 }, rotation: 0 as const },
  { name: "sidehill-r0", target: { x: 13, y: 2 }, rotation: 0 as const },
]) test("raised plane canonical absolute height and visible projection: " + scenario.name, async ({ page }, info) => {
  const errors = await setup(page, "slopes", scenario.rotation, info);
  expect((await state(page)).camera.rotation).toBe(scenario.rotation);
  const { readCommitted, firstPhase } = await commit(page, "Pitching Wedge", scenario.target, .18);
  const first = await capture(page, info, readCommitted, .18, scenario.name + "-airborne-0", "airborne", firstPhase);
  expect(first.visible.camera.rotation).toBe(scenario.rotation);
  const { motion, shot, saved } = await readCommitted();
  const sourceSurface = sampleGreenRolloutSurface(saved.course, saved.course.greenSnapshot?.surface, motion.from.point);
  expect(sourceSurface.height).toBeGreaterThan(1);
  expect(motion.from.heightYards).toBeCloseTo(sourceSurface.height * 2.5, 6);
  if (scenario.name.startsWith("uphill")) expect(shot.shotSlope!.targetElevationDelta).toBeGreaterThan(0);
  if (scenario.name.startsWith("downhill")) expect(shot.shotSlope!.targetElevationDelta).toBeLessThan(0);
  if (scenario.name.startsWith("sidehill")) {
    expect(shot.shotSlope!.targetElevationDelta).toBeCloseTo(0, 6);
    expect(Math.abs(shot.shotSlope!.localGradient.crossTargetLine)).toBeGreaterThan(.02);
  }
  const second = await capture(page, info, readCommitted, .48, scenario.name + "-airborne-1");
  expect(first.frozen.point).not.toEqual(second.frozen.point);
  await finish(page, motion);
  const rest = await pixelEvidence(page, info, scenario.name + "-rest", motion.physicalRest.point, motion.physicalRest.heightYards);
  writeFileSync(info.outputPath("slope-evidence.json"), JSON.stringify({ scenario, motion, shotSlope: shot.shotSlope, first, second, rest, errors }, null, 2));
  expect(errors).toEqual([]);
  await captureClock(page).finalize();
});
