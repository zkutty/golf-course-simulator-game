import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { sampleRetainedShotMotion, type RetainedShotMotionV1 } from "../src/game/rules/shotMotion";
import { worldToIso, type IsoRotation } from "../src/game/render/iso";
import type { PlayerShotRenderDiagnostics } from "../src/ui/renderer/scenes/overlaysDiagnosticsScene";

// Only initial course/career setup uses a fixture. Every round start, aim,
// selection, commit, pause, skip and completion below uses the actual UI.
const textState = (page: Page) => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
const roundState = async (page: Page) => (await textState(page)).playerPro.activeRound;
const playback = (page: Page) => page.evaluate(() => (window as unknown as { __ccPlayerShotPlayback?: PlayerShotRenderDiagnostics }).__ccPlayerShotPlayback ?? null);

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  return errors;
}

async function enterRound(page: Page, shotStyles = true, pseudo = false) {
  await page.getByRole("button", { name: pseudo ? /Qüïçk Stárt/ : "Quick Start", exact: !pseudo }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  const tutorial = page.getByRole("dialog", { name: pseudo ? /Fïrst-láüñçh tütôrïál/ : "First-launch tutorial" });
  if (await tutorial.count()) await tutorial.getByRole("button", { name: pseudo ? /Skïp tütôrïál/ : "Skip tutorial" }).click();
  await page.evaluate((highSkill) => window.__coursecraftTest!.setPlayerProFixture(highSkill ? { shotStyles: true } : undefined), shotStyles);
  await page.getByTestId("workspace-operate").click();
  await page.getByTestId("open-player-pro").click();
  await page.getByTestId("player-pro-tab-play").click();
  await page.getByTestId("start-player-round").click();
  await expect(page.getByTestId("player-shot-hud")).toBeVisible();
  await expect.poll(async () => (await roundState(page))?.phase).toBe("awaiting_shot");
  await expect.poll(() => page.evaluate(() => Boolean(window.__coursecraftPixiTest))).toBe(true);
  await page.evaluate(() => window.__coursecraftPixiTest!.fitWholeCourse());
}

async function aimForward(page: Page) {
  const round = await roundState(page);
  const target = { x: Math.min(54, round.ball.x + 14), y: 8 };
  const screen = await page.evaluate((at) => window.__coursecraftPixiTest!.tileToScreen(at.x, at.y), target);
  if (!screen) throw new Error("Aim target has no visible projection");
  const stage = page.locator(".cc-pixi-stage");
  await stage.click({ position: screen });
  await expect.poll(async () => (await roundState(page)).aim?.x).not.toBeNull();
  const picked = (await roundState(page)).aim;
  expect(Math.abs(picked.x - target.x)).toBeLessThan(1);
  expect(Math.abs(picked.y - target.y)).toBeLessThan(1);
}

async function savedPendingMotion(page: Page, shotId: string): Promise<RetainedShotMotionV1 | null> {
  return page.evaluate(async (id) => {
    const path = "/src/utils/saveStore.ts";
    const repository = await import(path);
    const slots = await repository.listSlots();
    for (const slot of slots) {
      const saved = await repository.loadSlot(slot.id);
      const shot = saved?.world.playerPro?.activeRound?.pendingShot;
      if (shot?.id === id) return shot.sharedOutcome?.motion ?? null;
    }
    return null;
  }, shotId);
}

async function captureAirborne(page: Page, info: TestInfo, progress: number, index: number, phase: "airborne" | "rollout" = "airborne") {
  await page.waitForFunction(({ target, phase }) => {
    const frame = (window as unknown as { __ccPlayerShotPlayback?: PlayerShotRenderDiagnostics }).__ccPlayerShotPlayback;
    return frame && frame.phase === phase && frame.motionProgress >= target;
  }, { target: progress, phase });
  await page.getByRole("button", { name: "Open pause menu" }).click();
  await expect(page.getByTestId("pause-overlay")).toBeVisible();
  const frozen = await playback(page);
  if (!frozen) throw new Error("Paused committed shot has no render diagnostics");
  await expect.poll(async () => (await playback(page))?.progress).toBe(frozen.progress);
  await expect.poll(() => savedPendingMotion(page, frozen.shotId)).not.toBeNull();
  const motion = (await savedPendingMotion(page, frozen.shotId))!;
  const state = await textState(page);
  const expected = sampleRetainedShotMotion(motion, frozen.motionProgress)!;
  expect(frozen.phase).toBe(phase);
  expect(frozen.point.x).toBeCloseTo(expected.point.x, 7);
  expect(frozen.point.y).toBeCloseTo(expected.point.y, 7);
  expect(frozen.heightYards).toBeCloseTo(expected.heightYards, 7);
  const iso = worldToIso(expected.point.x + .5, expected.point.y + .5, expected.heightYards / 2.5, state.camera.rotation as IsoRotation);
  expect(frozen.ball.x).toBeCloseTo(iso.x, 6);
  expect(frozen.ball.y).toBeCloseTo(iso.y, 6);
  if (phase === "airborne") expect(frozen.ball.y).toBeLessThan(frozen.shadow.y);
  else expect(frozen.ball.y).toBeCloseTo(frozen.shadow.y, 6);
  const transform = await page.evaluate(() => window.__coursecraftPixiTest!.cameraTransform());
  if (!transform) throw new Error("Missing renderer camera transform");
  const canvas = page.locator(".cc-pixi-stage canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Missing committed canvas");
  const body = await canvas.screenshot({ path: info.outputPath(`${phase}-${index}.png`) });
  await info.attach(`${phase}-${index}`, { body, contentType: "image/png" });
  const pixels = PNG.sync.read(body);
  const x = ((frozen.ball.x - transform.world.pivot.x) * transform.world.scale.x + transform.world.position.x) * pixels.width / bounds.width;
  const y = ((frozen.ball.y - 2 - transform.world.pivot.y) * transform.world.scale.y + transform.world.position.y) * pixels.height / bounds.height;
  expect(x).toBeGreaterThan(4);
  expect(x).toBeLessThan(pixels.width - 4);
  expect(y).toBeGreaterThan(4);
  expect(y).toBeLessThan(pixels.height - 4);
  let visibleBallPixels = 0;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const offset = (Math.round(y + dy) * pixels.width + Math.round(x + dx)) * 4;
    // This is the actual composited screenshot, including the pause menu's
    // dim backdrop. The white ball remains a bright neutral pixel above the
    // green background; requiring undimmed white would test the wrong image.
    const rgb = [pixels.data[offset], pixels.data[offset + 1], pixels.data[offset + 2]];
    if (Math.min(...rgb) > 70 && Math.max(...rgb) - Math.min(...rgb) < 25) visibleBallPixels++;
  }
  expect(visibleBallPixels, "visible ball must occupy its retained projected position beneath the pause backdrop").toBeGreaterThan(0);
  const record = { style: motion.identity.style, frozen, motion, motionIdentity: motion.identity, expected, camera: state.camera, transform, viewport: page.viewportSize(), compositedPauseBackdrop: true, visibleBallPixels, imageHash: createHash("sha256").update(body).digest("hex") };
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("pause-overlay")).toHaveCount(0);
  return record;
}

async function chooseStyle(page: Page, club: string, style: string, pointerAim = true) {
  if (!pointerAim) await page.getByTestId("player-shot-hud").getByRole("button", { name: "Use caddie line" }).click();
  await page.getByTestId("player-shot-club").selectOption(club);
  await page.getByTestId("player-shot-style").selectOption(style);
  await expect(page.getByTestId("player-shot-style")).toHaveValue(style);
  const power = page.getByTestId("player-shot-power");
  await power.focus();
  await page.keyboard.press("Home");
  await expect(power).toHaveValue("25");
  if (pointerAim) await aimForward(page);
  await expect(page.getByTestId("commit-player-shot")).toBeEnabled();
}

async function keepShotVisibleBesidePauseMenu(page: Page) {
  // Actual middle-button camera input keeps the moving ball visible beside the
  // pause dialog. The readonly projection is used only to aim the pan gesture.
  for (let step = 0; step < 5; step++) {
    const ball = (await roundState(page)).ball;
    const point = await page.evaluate((at) => window.__coursecraftPixiTest!.tileToScreen(at.x, at.y), ball);
    const bounds = await page.locator(".cc-pixi-stage").boundingBox();
    if (!point || !bounds) throw new Error("Shot camera projection is unavailable");
    if (Math.abs(point.x - 330) < 30 && Math.abs(point.y - 420) < 30) return;
    await page.mouse.move(bounds.x + 320, bounds.y + 420);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(bounds.x + 320 + Math.max(-180, Math.min(180, 330 - point.x)),
      bounds.y + 420 + Math.max(-150, Math.min(150, 420 - point.y)), { steps: 4 });
    await page.mouse.up({ button: "middle" });
    await page.waitForFunction(() => {
      const camera = window.__coursecraftPixiTest!.cameraTransform()?.camera;
      return camera && Math.abs(camera.center.x - camera.targetCenter.x) < .01
        && Math.abs(camera.center.y - camera.targetCenter.y) < .01;
    });
  }
}

async function waitForCommittedStyle(page: Page, style: string, before: number) {
  await expect.poll(async () => (await roundState(page)).phase).not.toBe("flight");
  const after = await roundState(page);
  expect(after.strokes).toBe(before + 1);
  expect(after.recentTrace.shotStyle).toBe(style);
  return after;
}

test("shot styles commit actual UI input and retained motion owns visible airborne frames", async ({ page }, info) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await enterRound(page);
  const style = page.getByTestId("player-shot-style");
  await page.getByTestId("player-shot-club").selectOption("Driver");
  await expect(style.locator('option[value="high_spin"]')).toHaveAttribute("disabled", "");
  await expect(style.locator('option[value="pitch"]')).toHaveAttribute("disabled", "");
  await page.getByTestId("player-shot-club").selectOption("7 Iron");
  await style.focus();
  await page.keyboard.press("h");
  await page.keyboard.press("Tab");
  await expect(style).toHaveValue("high_spin");
  await expect(page.getByTestId("player-shot-flight-high")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("player-shot-flight-low").focus();
  await page.keyboard.press("Enter");
  await expect(style).toHaveValue("high_spin");
  await expect(page.getByTestId("player-shot-flight-high")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#player-shot-flight-constraint")).toContainText("requires high");
  const origin = await page.evaluate(() => window.__coursecraftPixiTest!.tileToScreen(4, 8));
  const stageBounds = await page.locator(".cc-pixi-stage").boundingBox();
  if (!origin || !stageBounds) throw new Error("Shot camera target is unavailable");
  await page.mouse.move(stageBounds.x + origin.x, stageBounds.y + origin.y);
  for (let notch = 0; notch < 8; notch++) {
    const zoom = await page.evaluate(() => window.__coursecraftPixiTest!.cameraTransform()?.camera.zoom ?? 0);
    if (zoom >= .65) break;
    await page.mouse.wheel(0, -120);
    await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.cameraTransform()?.camera.zoom ?? 0)).toBeGreaterThan(zoom + .02);
  }
  await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.cameraTransform()?.camera.zoom ?? 0)).toBeGreaterThan(.64);
  await page.waitForFunction(() => {
    const camera = window.__coursecraftPixiTest!.cameraTransform()?.camera;
    return camera && Math.abs(camera.zoom - camera.targetZoom) < .001
      && Math.abs(camera.center.x - camera.targetCenter.x) < .01
      && Math.abs(camera.center.y - camera.targetCenter.y) < .01;
  });
  await chooseStyle(page, "7 Iron", "straight_run");
  await expect(page.getByTestId("player-shot-rules-preview")).toHaveCount(0);
  await expect(page.getByTestId("player-shot-auto-putt-preview")).toHaveCount(0);
  const before = await roundState(page);
  await page.getByTestId("commit-player-shot").click();
  // Save the actual committed shot before pausing: global quicksave is
  // deliberately ignored while a menu is open or a control has keyboard focus.
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press("Control+KeyS");
  await expect(page.locator('.sr-only[role="status"]')).toContainText("Quick save complete");
  const captures = [];
  for (const [index, progress] of [.12, .32, .54].entries()) captures.push(await captureAirborne(page, info, progress, index));
  expect(new Set(captures.map((capture) => capture.imageHash)).size).toBe(3);
  expect(new Set(captures.map((capture) => JSON.stringify(capture.frozen.point))).size).toBe(3);
  const first = await waitForCommittedStyle(page, "straight_run", before.strokes);
  const authority = captures[0].motion;
  expect(first.recentTrace.physicalRest).toEqual(authority.physicalRest.point);
  await page.screenshot({ path: info.outputPath("first-shot-rest.png"), fullPage: true });

  const committed = [];
  const styledCaptures = [];
  for (const [club, value] of [["7 Iron", "high_spin"], ["Pitching Wedge", "pitch"], ["5 Iron", "draw"], ["7 Iron", "fade"], ["Chip", "chip"], ["5 Iron", "punch"], ["Pitching Wedge", "flop"], ["Putter", "putt"]]) {
    await chooseStyle(page, club, value, false);
    await keepShotVisibleBesidePauseMenu(page);
    const count = (await roundState(page)).strokes;
    await page.getByTestId("commit-player-shot").click();
    await expect(page.getByTestId("skip-player-shot")).toBeVisible();
    if (["high_spin", "pitch", "draw", "fade"].includes(value)) {
      styledCaptures.push(await captureAirborne(page, info, .30, 3 + styledCaptures.length));
    } else if (value === "chip" || value === "putt") {
      styledCaptures.push(await captureAirborne(page, info, value === "chip" ? .74 : .15, 3 + styledCaptures.length, "rollout"));
    }
    await page.getByTestId("skip-player-shot").click();
    const result = await waitForCommittedStyle(page, value, count);
    committed.push(result.recentTrace);
  }
  const highSpin = styledCaptures.find((capture) => capture.style === "high_spin")!;
  const draw = styledCaptures.find((capture) => capture.style === "draw")!;
  const fade = styledCaptures.find((capture) => capture.style === "fade")!;
  expect(highSpin.motion.facts.launchAngleDegrees!).toBeGreaterThan(captures[0].motion.facts.launchAngleDegrees!);
  expect(highSpin.motion.flight!.geometry.apexHeightYards).toBeGreaterThan(captures[0].motion.flight!.geometry.apexHeightYards);
  expect(draw.motion.flight!.geometry.curve!.lateralOffsetTiles * fade.motion.flight!.geometry.curve!.lateralOffsetTiles).toBeLessThan(0);
  expect(styledCaptures.map((capture) => capture.style)).toEqual(["high_spin", "pitch", "draw", "fade", "chip", "putt"]);
  writeFileSync(info.outputPath("shot-style-evidence.json"), JSON.stringify({ setupOnlyFixture: "shotStyles", seed: 360037, viewport: page.viewportSize(), captures, styledCaptures, committed, errors }, null, 2));
  expect(errors).toEqual([]);
});

test("default career explains learned skill gates through native style controls", async ({ page }, info) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await enterRound(page, false);
  await page.getByTestId("player-shot-club").selectOption("7 Iron");
  const highSpin = page.getByTestId("player-shot-style").locator('option[value="high_spin"]');
  await expect(highSpin).toHaveAttribute("disabled", "");
  await expect(highSpin).toContainText("Requires Irons 62");
  await page.getByText("Style availability and requirements", { exact: true }).click();
  await expect(page.getByTestId("player-shot-style-controls")).toContainText("Requires");
  await page.screenshot({ path: info.outputPath("locked-style-requirements.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test.describe("touch and accessibility", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test("pseudo muted reduced-motion 200% text preserves touch commit and bounds", async ({ page }, info) => {
    const errors = watchErrors(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Options", exact: true }).tap();
    await page.getByRole("tab", { name: "Audio", exact: true }).tap();
    await page.getByLabel("Mute all audio").check();
    await page.getByRole("tab", { name: "Accessibility", exact: true }).tap();
    await page.getByLabel("Reduced motion").check();
    await page.getByLabel("Text scale").selectOption("130");
    await page.getByLabel("Language preview").selectOption("pseudo");
    await page.getByTestId("options-screen").locator("footer button").last().tap();
    await enterRound(page, true, true);
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await expect(page.locator("html")).toHaveAttribute("data-locale", "pseudo");
    await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
    const hud = page.getByTestId("player-shot-hud");
    await page.getByTestId("player-shot-club").selectOption("Pitching Wedge");
    await page.getByTestId("player-shot-style").selectOption("pitch");
    await expect(hud).toContainText("⟦");
    const bounds = await hud.boundingBox();
    if (!bounds) throw new Error("Touch HUD is not measurable");
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(845);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    await page.getByTestId("player-shot-power").fill("25");
    const before = (await roundState(page)).strokes;
    const commit = page.getByTestId("commit-player-shot");
    await commit.scrollIntoViewIfNeeded();
    await commit.tap();
    const after = await waitForCommittedStyle(page, "pitch", before);
    const profile = await page.evaluate(() => JSON.parse(localStorage.getItem("coursecraft_app_profile_v5") ?? "{}"));
    expect(profile.audio.masterMuted).toBe(true);
    const audio = await page.evaluate(async () => {
      const path = "/src/audio/AudioManager.ts";
      return (await import(path)).audioManager.debugSnapshot();
    });
    expect(audio.masterMuted).toBe(true);
    await page.screenshot({ path: info.outputPath("touch-pseudo-muted-reduced-200pct.png"), fullPage: true });
    writeFileSync(info.outputPath("accessibility-evidence.json"), JSON.stringify({ profile, viewport: page.viewportSize(), rootText: "200%", after, errors }, null, 2));
    expect(errors).toEqual([]);
  });
});

test("selected live golfer follows its retained current segment without revealing future motion", async ({ page }, info) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/?m47Fixture=1");
  await expect(page.getByTestId("speed-1x")).toBeVisible();
  await page.getByTestId("speed-1x").click();
  let actor: { id: number; ballMotion: { active: boolean } } | undefined;
  for (let step = 0; step < 100; step++) {
    await page.evaluate(() => window.__coursecraftTest!.advanceLiveClock(200, "1x"));
    actor = (await textState(page)).golfers.find((golfer: { ballMotion?: { active: boolean } }) => golfer.ballMotion?.active);
    if (actor) break;
  }
  expect(actor, "an actual modern live flight is required").toBeDefined();
  await page.getByTestId("speed-paused").click();
  await page.getByRole("button", { name: "Open live overview" }).click();
  const overview = page.getByTestId("live-overview");
  const current = (await textState(page)).golfers.find((golfer: { id: number }) => golfer.id === actor!.id);
  // The overview exposes actual golfers in the same visible row order.
  const index = (await textState(page)).golfers.findIndex((golfer: { id: number }) => golfer.id === actor!.id);
  await overview.locator("button:has(b)").nth(index).click();
  await expect(page.locator(".cc-golfer-inspector")).toBeVisible();
  await expect.poll(async () => (await textState(page)).selectedGolferEvidence?.golferId).toBe(actor!.id);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press("Control+KeyS");
  await expect(page.locator('.sr-only[role="status"]')).toContainText("Quick save complete");
  const saved = await page.evaluate(async () => {
    const path = "/src/utils/saveStore.ts";
    return (await import(path)).loadSlot("quick-save");
  });
  const golfer = saved.live.state.golfers.find((value: { id: number }) => value.id === actor!.id);
  const segment = golfer.segments[golfer.segIndex];
  const motion = segment.motion as RetainedShotMotionV1;
  expect(motion).toBeTruthy();
  const pose = sampleRetainedShotMotion(motion, golfer.segElapsed / segment.dur)!;
  expect(current.ballMotion.identity).toEqual(motion.identity);
  expect(current.ballMotion.pose.point.x).toBeCloseTo(pose.point.x, 5);
  expect(current.ballMotion.pose.point.y).toBeCloseTo(pose.point.y, 5);
  expect(golfer.ball.x).toBeCloseTo(pose.point.x, 5);
  expect(golfer.ball.y).toBeCloseTo(pose.point.y, 5);
  expect(current.ballMotion).not.toHaveProperty("groundPath");
  await page.screenshot({ path: info.outputPath("selected-live-retained-flight.png"), fullPage: true });
  writeFileSync(info.outputPath("selected-live-evidence.json"), JSON.stringify({ seed: saved.world.runSeed, actor: current, identity: motion.identity, pose, viewport: page.viewportSize(), errors }, null, 2));
  expect(errors).toEqual([]);
});

test("midflight autosave reload resumes the same retained shot without rescoring", async ({ page }, info) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await enterRound(page);
  await chooseStyle(page, "7 Iron", "straight_run");
  const before = await roundState(page);
  await page.getByTestId("commit-player-shot").click();
  await page.waitForFunction(() => {
    const frame = (window as unknown as { __ccPlayerShotPlayback?: PlayerShotRenderDiagnostics }).__ccPlayerShotPlayback;
    return frame?.phase === "airborne" && frame.motionProgress > .25;
  });
  await page.getByRole("button", { name: "Open pause menu" }).click();
  await expect(page.getByTestId("pause-overlay")).toBeVisible();
  const paused = await playback(page);
  if (!paused) throw new Error("Actual paused shot diagnostics are required");
  const readCheckpoint = () => page.evaluate(async (shotId) => {
    const path = "/src/utils/saveStore.ts";
    const repository = await import(path);
    const autos = (await repository.listSlots()).filter((slot: { kind: string }) => slot.kind === "auto");
    for (const slot of autos) {
      const saved = await repository.loadSlot(slot.id);
      const round = saved?.world.playerPro?.activeRound;
      if (round?.phase === "flight" && round.pendingShot?.id === shotId && round.shotPresentation?.progress > 0) {
        return { id: slot.id, round, seed: saved.world.runSeed };
      }
    }
    return null;
  }, paused.shotId);
  await expect.poll(readCheckpoint).not.toBeNull();
  const saved = (await readCheckpoint())!;
  expect(saved.round.shotPresentation.progress).toBeGreaterThan(0);
  expect(saved.round.shotPresentation.progress).toBeLessThan(1);
  const motion = saved.round.pendingShot.sharedOutcome.motion as RetainedShotMotionV1;
  await page.reload();
  await page.getByRole("button", { name: "Load Game", exact: true }).click();
  await page.getByTestId(`save-slot-${saved.id}`).getByRole("button", { name: "Load", exact: true }).click();
  await expect(page.getByTestId("player-shot-hud")).toBeVisible();
  await expect.poll(async () => (await playback(page))?.shotId).toBe(paused.shotId);
  const resumed = await playback(page);
  const resumedRound = await roundState(page);
  expect(resumed!.progress).toBeGreaterThanOrEqual(saved.round.shotPresentation.progress);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press("Control+KeyS");
  await expect(page.locator('.sr-only[role="status"]')).toContainText("Quick save complete");
  const reloadedSave = await page.evaluate(async () => {
    const path = "/src/utils/saveStore.ts";
    return (await import(path)).loadSlot("quick-save");
  });
  expect(reloadedSave.world.playerPro.activeRound.pendingShot.sharedOutcome.motion).toEqual(motion);
  expect(resumedRound.strokes).toBe(before.strokes);
  await page.getByTestId("skip-player-shot").click();
  const completed = await waitForCommittedStyle(page, "straight_run", before.strokes);
  expect(completed.recentTrace.id).toBe(paused.shotId);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press("Control+KeyS");
  await expect.poll(() => page.evaluate(async () => {
    const path = "/src/utils/saveStore.ts";
    const saved = await (await import(path)).loadSlot("quick-save");
    return saved?.world.playerPro?.activeRound?.shots.at(-1)?.sharedOutcome?.motion;
  })).toEqual(motion);
  expect(completed.recentTrace.physicalRest).toEqual(motion.physicalRest.point);
  await page.screenshot({ path: info.outputPath("midflight-reloaded-rest.png"), fullPage: true });
  writeFileSync(info.outputPath("reload-evidence.json"), JSON.stringify({ saved, paused, resumed, completed, viewport: page.viewportSize(), errors }, null, 2));
  expect(errors).toEqual([]);
});

test("ordinary selected AI golfer displays three canonical airborne positions", async ({ page }, info) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/?m47Fixture=1");
  await expect(page.getByTestId("speed-1x")).toBeVisible();
  await page.evaluate(() => window.__coursecraftTest!.pauseLiveSimulation());
  let actorId: number | undefined;
  for (let step = 0; step < 2000; step++) {
    await page.evaluate(() => window.__coursecraftTest!.advanceLiveClock(20, "1x"));
    const actor = (await textState(page)).golfers.find((golfer: { id: number; ballMotion?: { active: boolean; pose: { phase: string; time: number } } }) =>
      golfer.ballMotion?.active && golfer.ballMotion.pose.phase === "airborne" && golfer.ballMotion.pose.time <= .30);
    if (actor) { actorId = actor.id; break; }
  }
  expect(actorId, "a real early airborne AI segment is required").toBeDefined();
  await page.getByRole("button", { name: "Open live overview" }).click();
  const actors = (await textState(page)).golfers;
  await page.getByTestId("live-overview").locator("button:has(b)").nth(actors.findIndex((golfer: { id: number }) => golfer.id === actorId)).click();
  await expect(page.locator(".cc-golfer-inspector")).toBeVisible();
  await expect.poll(async () => (await textState(page)).selectedGolferEvidence?.golferId).toBe(actorId);
  const follow = page.locator(".cc-golfer-follow");
  if (await follow.getAttribute("aria-pressed") !== "true") await follow.click();
  await expect(follow).toHaveAttribute("aria-pressed", "true");
  const stage = page.locator(".cc-pixi-stage");
  const stageBounds = await stage.boundingBox();
  if (!stageBounds) throw new Error("Missing live stage bounds");
  await page.mouse.move(stageBounds.x + stageBounds.width * .5, stageBounds.y + stageBounds.height * .45);
  for (let notch = 0; notch < 8; notch++) {
    const camera = await page.evaluate(() => window.__coursecraftPixiTest!.cameraTransform()!.camera);
    if (camera.targetZoom >= .75) break;
    await page.mouse.wheel(0, -120);
    await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.cameraTransform()!.camera.targetZoom)).toBeGreaterThan(camera.targetZoom);
  }
  const captures = [];
  let shotId: string | null = null;
  for (const [index, target] of [.15, .35, .55].entries()) {
    for (let step = 0; step < 20; step++) {
      const actor = (await textState(page)).golfers.find((golfer: { id: number }) => golfer.id === actorId);
      if (actor.ballMotion?.pose.time >= target) break;
      await page.evaluate(() => window.__coursecraftTest!.advanceLiveClock(20, "1x"));
    }
    await page.waitForFunction(() => {
      const camera = window.__coursecraftPixiTest!.cameraTransform()?.camera;
      return camera && Math.abs(camera.zoom - camera.targetZoom) < .001
        && Math.abs(camera.center.x - camera.targetCenter.x) < .01
        && Math.abs(camera.center.y - camera.targetCenter.y) < .01;
    });
    const state = await textState(page);
    const current = state.golfers.find((golfer: { id: number }) => golfer.id === actorId);
    expect(current.ballMotion.pose.phase).toBe("airborne");
    expect(current.ballMotion.active).toBe(true);
    shotId ??= current.ballMotion.identity.shotId;
    expect(current.ballMotion.identity.shotId).toBe(shotId);
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press("Control+KeyS");
    const readSavedActor = () => page.evaluate(async (id) => {
      const path = "/src/utils/saveStore.ts";
      const saved = await (await import(path)).loadSlot("quick-save");
      return saved ? { seed: saved.world.runSeed, golfer: saved.live.state.golfers.find((golfer: { id: number }) => golfer.id === id) } : null;
    }, actorId!);
    await expect.poll(async () => {
      const saved = await readSavedActor();
      if (!saved?.golfer) return -1;
      const segment = saved.golfer.segments[saved.golfer.segIndex];
      return saved.golfer.segElapsed / segment.dur;
    }).toBeCloseTo(current.segmentProgress, 6);
    const saved = (await readSavedActor())!;
    const golfer = saved.golfer;
    const segment = golfer.segments[golfer.segIndex];
    const motion = segment.motion as RetainedShotMotionV1;
    const expected = sampleRetainedShotMotion(motion, golfer.segElapsed / segment.dur)!;
    expect(expected.phase).toBe("airborne");
    expect(expected.time).toBeLessThan(motion.flight!.endTime);
    expect(current.ballMotion.identity).toEqual(motion.identity);
    expect(current.ballMotion.pose.point.x).toBeCloseTo(expected.point.x, 7);
    expect(current.ballMotion.pose.point.y).toBeCloseTo(expected.point.y, 7);
    expect(current.ballMotion.pose.heightYards).toBeCloseTo(expected.heightYards, 7);
    expect(golfer.ball.x).toBeCloseTo(expected.point.x, 7);
    expect(golfer.ball.y).toBeCloseTo(expected.point.y, 7);
    const iso = worldToIso(expected.point.x + .5, expected.point.y + .5, expected.heightYards / 2.5, state.camera.rotation as IsoRotation);
    const transform = (await page.evaluate(() => window.__coursecraftPixiTest!.cameraTransform()))!;
    const canvas = stage.locator("canvas");
    const bounds = (await canvas.boundingBox())!;
    const body = await canvas.screenshot({ path: info.outputPath(`ai-airborne-${index}.png`) });
    await info.attach(`ai-airborne-${index}`, { body, contentType: "image/png" });
    const pixels = PNG.sync.read(body);
    const x = ((iso.x - transform.world.pivot.x) * transform.world.scale.x + transform.world.position.x) * pixels.width / bounds.width;
    const y = ((iso.y - 2 - transform.world.pivot.y) * transform.world.scale.y + transform.world.position.y) * pixels.height / bounds.height;
    expect(x).toBeGreaterThan(4); expect(x).toBeLessThan(pixels.width - 4);
    expect(y).toBeGreaterThan(4); expect(y).toBeLessThan(pixels.height - 4);
    let ballPixels = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const offset = (Math.round(y + dy) * pixels.width + Math.round(x + dx)) * 4;
      const rgb = [pixels.data[offset], pixels.data[offset + 1], pixels.data[offset + 2]];
      if (Math.min(...rgb) > 200 && Math.max(...rgb) - Math.min(...rgb) < 25) ballPixels++;
    }
    expect(ballPixels, "ordinary AI ball must be visible at its retained airborne projection").toBeGreaterThan(0);
    captures.push({ seed: saved.seed, actorId, current, motion, expected, iso, transform, camera: state.camera,
      projection: { x, y }, ballPixels, imageHash: createHash("sha256").update(body).digest("hex") });
  }
  expect(new Set(captures.map((capture) => JSON.stringify(capture.expected.point))).size).toBe(3);
  expect(new Set(captures.map((capture) => capture.imageHash)).size).toBe(3);
  writeFileSync(info.outputPath("ai-airborne-evidence.json"), JSON.stringify({ actualSimulationStepMs: 20, viewport: page.viewportSize(), captures, errors }, null, 2));
  expect(errors).toEqual([]);
});
