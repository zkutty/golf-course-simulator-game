import { expect, type Page, type TestInfo } from "@playwright/test";
import { PLAYER_SHOT_CONTACT_FRACTION, playerShotDurationMs } from "../src/game/playerPro/shotPlayback";
import type { PlayerShotRenderDiagnostics } from "../src/ui/renderer/scenes/overlaysDiagnosticsScene";

// Only explicitly enrolled test pages use this scheduler. Node deadlines remain real.
export interface CapturePlan { maxRuns: number; maxLogicalMs: number }
interface PublicRound {
  id: string;
  phase: string;
  pendingShot: { id: string; club: string; carryYards: number } | null;
  presentation: { shotId: string; progress: number; motionProgress: number } | null;
}
interface CaptureState {
  screenBase: string; modal: string | null; paused: boolean;
  onboarding: { authorityHashes: { course: string; world: string; rewardLedger: string } };
  simulation: { speed: string };
  playerPro: { activeRound: PublicRound | null };
  golfers: { id: number; ballMotion?: { active: boolean } }[];
  camera: unknown;
  graphics: unknown;
}
const clocks = new WeakMap<Page, RetainedShotCaptureClock>();
const publicState = (page: Page) => page.evaluate(() => {
  const state: CaptureState = JSON.parse(window.render_game_to_text?.() ?? "{}");
  return state;
});
const frame = (page: Page) => page.evaluate(() => (window as unknown as {
  __ccPlayerShotPlayback?: PlayerShotRenderDiagnostics;
}).__ccPlayerShotPlayback ?? null);
const same = (actual: unknown, expected: unknown, message: string) => expect(actual, message).toEqual(expected);

export function forwardCaptureStep(progress: number, minimum: number, durationMs: number): number {
  if (![progress, minimum, durationMs].every(Number.isFinite) || progress < 0 || progress >= 1
    || minimum < 0 || minimum >= 1 || durationMs <= 0) throw new Error("Invalid forward capture cursor/target/duration");
  const target = PLAYER_SHOT_CONTACT_FRACTION + minimum * (1 - PLAYER_SHOT_CONTACT_FRACTION);
  return Math.max(16, Math.floor((target - progress) * durationMs - 16));
}
export function validateCaptureFrame(actual: PlayerShotRenderDiagnostics | null, shotId: string, minimum: number, phase: string) {
  if (!actual || actual.shotId !== shotId) throw new Error("Retained capture identity is missing or different");
  if (actual.motionProgress < minimum || actual.phase !== phase) throw new Error("Original retained phase/fraction not acquired");
  return actual;
}

export class RetainedShotCaptureClock {
  private readonly page: Page;
  private readonly info: TestInfo;
  private readonly plan: CapturePlan;
  private held = false;
  private inFlight = false;
  private runs = 0;
  private logicalMs = 0;
  private freezeDeadline = 0;
  readonly evidence: { reason: string; milliseconds: number; logicalMs: number }[] = [];
  constructor(page: Page, info: TestInfo, plan: CapturePlan) {
    this.page = page;
    this.info = info;
    this.plan = plan;
  }

  async holdQuiescent(kind: "player" | "live") {
    const before = await publicState(this.page);
    const round = before.playerPro.activeRound;
    expect(before.simulation.speed).toBe("paused");
    expect(before.golfers.some((actor) => actor.ballMotion?.active)).toBe(false);
    if (kind === "player") {
      expect(round?.phase).toBe("awaiting_shot");
      expect(round?.pendingShot).toBeNull();
    } else expect(round).toBeNull();
    // pauseAt can skip due callbacks: it is used once, before active gameplay,
    // with the actual paused/no-pending state and canonical authority checked.
    const future = await this.page.evaluate(() => Date.now() + 1000);
    await this.page.clock.pauseAt(future);
    this.held = true;
    const after = await publicState(this.page);
    same(after.onboarding.authorityHashes, before.onboarding.authorityHashes, "Quiescent clock admission preserves canonical course/world (including seed)");
    same(after.playerPro.activeRound, round, "Quiescent clock admission preserves round/carrier");
    expect(after.simulation.speed).toBe("paused");
    // Converge the existing camera through normal callbacks before any shot.
    // This strengthens readiness, not its camera position/zoom or workload.
    let settled = false;
    for (let step = 0; step < 60; step++) {
      const camera = await this.page.evaluate(() => window.__coursecraftPixiTest!.cameraTransform()?.camera);
      if (camera && camera.center.x === camera.targetCenter.x && camera.center.y === camera.targetCenter.y && camera.zoom === camera.targetZoom) { settled = true; break; }
      await this.run(16, "quiescent camera convergence before workload");
    }
    expect(settled, "Existing camera settles within 960 logical milliseconds").toBe(true);
    await this.info.attach("capture-clock-admission", { body: JSON.stringify({ before, after, plan: this.plan,
      seedEvidence: "Canonical world hash includes runSeed; no omitted public seed is invented" }, null, 2), contentType: "application/json" });
  }

  async run(milliseconds: number, reason: string) {
    if (this.inFlight || !this.held || !Number.isInteger(milliseconds) || milliseconds < 0
      || this.runs + 1 > this.plan.maxRuns || this.logicalMs + milliseconds > this.plan.maxLogicalMs) {
      throw new Error("Controlled capture exceeded declared forward-only logical budget");
    }
    this.runs++;
    this.logicalMs += milliseconds;
    this.evidence.push({ reason, milliseconds, logicalMs: this.logicalMs });
    this.inFlight = true;
    try { await this.page.clock.runFor(milliseconds); }
    finally { this.inFlight = false; }
  }
  async flushTimers() { await this.run(0, "due timers only; no elapsed time"); }

  async acquire(minimum: number, phase: string, strictMinimum = false) {
    const initial = await publicState(this.page);
    const pending = initial.playerPro.activeRound?.pendingShot;
    if (!pending || initial.playerPro.activeRound?.phase !== "flight") throw new Error("No actual pending flight to acquire");
    for (let step = 0; step < 8; step++) {
      const actual = await frame(this.page);
      if (actual?.shotId === pending.id && actual.phase === phase
        && (strictMinimum ? actual.motionProgress > minimum : actual.motionProgress >= minimum)) {
        return validateCaptureFrame(actual, pending.id, minimum, phase);
      }
      const state = await publicState(this.page);
      const round = state.playerPro.activeRound;
      if (round?.phase !== "flight" || round.pendingShot?.id !== pending.id) throw new Error("Pending carrier changed before original phase acquisition");
      if (actual && actual.shotId !== pending.id) {
        // A newly committed carrier can precede its first renderer publication.
        // Permit at most two ordinary frames to replace that cache; never accept it.
        if (step >= 2 || round.presentation?.shotId !== pending.id) throw new Error("Renderer reports a different pending identity");
        await this.run(16, "initial renderer publication after native commit; stale identity never accepted");
        continue;
      }
      if (actual && actual.motionProgress >= minimum && actual.phase !== phase) throw new Error("Original phase was passed; later phase cannot substitute");
      const cursor = round.presentation;
      if (cursor && cursor.shotId !== pending.id) throw new Error("Public driver identity differs from carrier");
      const milliseconds = cursor ? forwardCaptureStep(cursor.progress, minimum, playerShotDurationMs(pending.club, pending.carryYards)) : 16;
      await this.run(milliseconds, `original ${phase} minimum ${minimum}; forward step ${step + 1}`);
    }
    throw new Error("Original phase not acquired within eight declared forward steps");
  }

  async acquireRestoredIdentity(shotId: string) {
    for (let step = 0; step < 8; step++) {
      const state = await publicState(this.page);
      const actual = await frame(this.page);
      if (state.screenBase === "in-game" && state.modal === null && !state.paused && actual?.shotId === shotId) return;
      const round = state.playerPro.activeRound;
      if (round?.pendingShot && round.pendingShot.id !== shotId) throw new Error("Restored pending carrier has a different identity");
      if (round?.presentation && round.presentation.shotId !== shotId) throw new Error("Restored driver has a different identity");
      if (actual && actual.shotId !== shotId && step >= 2) throw new Error("Restored renderer has a different shot identity");
      await this.run(16, "restore actual frame after native Load; no reinstall/reseed");
    }
    throw new Error("Restored identity not acquired within 128 logical milliseconds");
  }

  remainingFreezeBudget() {
    const remaining = this.freezeDeadline - performance.now();
    if (remaining <= 0) throw new Error("Original 5000ms paused readiness/freeze deadline exceeded");
    return remaining;
  }

  async completeNaturally() {
    const state = await publicState(this.page);
    const pending = state.playerPro.activeRound?.pendingShot;
    if (!pending) throw new Error("Natural completion requires the actual pending carrier");
    const cursor = state.playerPro.activeRound?.presentation;
    const duration = playerShotDurationMs(pending.club, pending.carryYards);
    await this.run(Math.ceil((1 - (cursor?.progress ?? 0)) * duration) + 32, "normal RAFs complete original first style naturally");
    expect((await publicState(this.page)).playerPro.activeRound?.phase).not.toBe("flight");
  }

  async nativePause() {
    await this.page.keyboard.press("Escape");
    await expect(this.page.getByTestId("pause-overlay")).toBeVisible();
    const deadline = performance.now() + 5000;
    this.freezeDeadline = deadline;
    const checkDeadline = () => { if (performance.now() >= deadline) throw new Error("Original 5000ms paused readiness/freeze deadline exceeded"); };
    const paused = await publicState(this.page);
    expect(paused.screenBase).toBe("in-game"); expect(paused.modal).toBeNull(); expect(paused.paused).toBe(true);
    const driver = paused.playerPro.activeRound?.presentation;
    if (!driver) throw new Error("Paused flight has no genuine public driver");
    // Exactly 32ms of normal RAFs while the application is actually paused.
    // First frame may catch the renderer up; neither frame may move the driver.
    await this.run(16, "native paused renderer readiness"); checkDeadline();
    const first = await this.snapshot();
    same(first.driver, driver, "Native pause freezes actual driver across first normal RAF");
    if (!first.frame) throw new Error("Paused committed shot has no render diagnostics");
    expect(first.frame.shotId).toBe(driver.shotId); expect(first.frame.progress).toBe(driver.progress);
    expect(first.pendingId).toBe(driver.shotId); expect(first.roundPhase).toBe("flight");
    await this.run(16, "native paused freeze control"); checkDeadline();
    const second = await this.snapshot();
    same(second, first, "Genuine paused driver/Pixi identity, pose and camera remain exact across normal RAF");
    checkDeadline();
    return first;
  }

  async snapshot() {
    const state = await publicState(this.page);
    return { frame: await frame(this.page), driver: state.playerPro.activeRound?.presentation ?? null,
      pendingId: state.playerPro.activeRound?.pendingShot?.id ?? null, roundPhase: state.playerPro.activeRound?.phase ?? null,
      camera: state.camera, graphics: state.graphics,
      transform: await this.page.evaluate(() => window.__coursecraftPixiTest!.cameraTransform()) };
  }

  async finalize() {
    expect(this.held, "Controlled context reached its admitted held state").toBe(true);
    expect(this.inFlight, "Every admitted runFor branch settled before finalization").toBe(false);
    expect(this.evidence).toHaveLength(this.runs);
    expect(this.runs).toBeLessThanOrEqual(this.plan.maxRuns);
    expect(this.logicalMs).toBeLessThanOrEqual(this.plan.maxLogicalMs);
    let total = 0;
    for (const step of this.evidence) {
      total += step.milliseconds;
      expect(step.logicalMs, "Every recorded forward step agrees with cumulative logical time").toBe(total);
    }
    expect(total).toBe(this.logicalMs);
    await this.info.attach("retained-shot-clock-complete", {
      body: JSON.stringify({ plan: this.plan, actualRunCount: this.runs, logicalMs: this.logicalMs,
        steps: this.evidence, pendingRun: this.inFlight,
        scope: "Resolved Playwright runFor calls and requested normal-callback logical time; not GPU/frame-rate or real-time performance evidence" }, null, 2),
      contentType: "application/json",
    });
  }

  async clearView(name: string, frozen: Awaited<ReturnType<RetainedShotCaptureClock["snapshot"]>>) {
    const canvas = this.page.locator(".cc-pixi-stage canvas");
    const bounds = await canvas.boundingBox();
    const pause = this.page.getByTestId("pause-overlay");
    await expect(pause).toBeVisible();
    const section = pause.locator("section");
    const sectionBounds = await section.boundingBox();
    const shadow = await section.evaluate((element) => getComputedStyle(element).boxShadow);
    if (!bounds || !sectionBounds) throw new Error("Missing actual paused composition geometry");
    const pausedBody = await canvas.screenshot({ path: this.info.outputPath(`${name}-paused.png`) });
    await this.info.attach(`${name}-paused`, { body: pausedBody, contentType: "image/png" });
    await this.page.keyboard.press("Escape");
    await expect(pause).toHaveCount(0);
    const resumed = await publicState(this.page);
    expect(resumed.screenBase).toBe("in-game"); expect(resumed.modal).toBeNull(); expect(resumed.paused).toBe(false);
    same(await this.snapshot(), frozen, "Native resume with scheduler held preserves exact pose/camera/backend/quality");
    same(await canvas.boundingBox(), bounds, "Paused and clear composited captures retain exact canvas bounds");
    await this.info.attach(`${name}-clock`, { body: JSON.stringify(this.evidence, null, 2), contentType: "application/json" });
    return { bounds, sectionBounds, shadow, pausedImage: `${name}-paused.png` };
  }
}

export async function installCaptureClock(page: Page, info: TestInfo, plan: CapturePlan) {
  if (clocks.has(page)) throw new Error("Capture clock must be installed exactly once before navigation");
  await page.clock.install();
  const clock = new RetainedShotCaptureClock(page, info, plan);
  clocks.set(page, clock);
  return clock;
}
export function installedCaptureClock(page: Page) { return clocks.get(page); }
export function captureClock(page: Page) {
  const clock = clocks.get(page);
  if (!clock) throw new Error("This page did not opt into the retained-shot capture clock");
  return clock;
}
export async function assertUncoveredRoi(page: Page, point: { x: number; y: number }, radius: number,
  pixels: { width: number; height: number }, bounds: { x: number; y: number; width: number; height: number }) {
  expect(await page.evaluate(({ point, radius, pixels, bounds }) => {
    const canvas = document.querySelector(".cc-pixi-stage canvas");
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const x = bounds.x + Math.round(point.x + dx) * bounds.width / pixels.width;
      const y = bounds.y + Math.round(point.y + dy) * bounds.height / pixels.height;
      if (document.elementFromPoint(x, y) !== canvas) return false;
    }
    return true;
  }, { point, radius, pixels: { width: pixels.width, height: pixels.height }, bounds }), "Original canonical pixel ROI must be uncovered by DOM UI").toBe(true);
}
