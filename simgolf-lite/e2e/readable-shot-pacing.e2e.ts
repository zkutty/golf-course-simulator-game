import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { sampleRetainedShotMotion, type RetainedShotMotionV1 } from "../src/game/rules/shotMotion";

const state = (page: Page) => page.evaluate(() => ({
  ...JSON.parse(window.render_game_to_text?.() ?? "{}"),
  authority: window.__coursecraftTest?.state(),
}));
async function save(page: Page) {
  const acknowledgement = page.locator('.sr-only[role="status"]');
  const sequence = await acknowledgement.getAttribute("data-announcement-sequence");
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press("Control+KeyS");
  await expect.poll(() => acknowledgement.getAttribute("data-announcement-sequence")).not.toBe(sequence);
  await expect(acknowledgement).toContainText("Quick save complete");
  return page.evaluate(async () => {
    const path = "/src/utils/saveStore.ts";
    return (await import(path)).loadSlot("quick-save");
  });
}

test("management advances yield, cancel, and stop at one day and the Sunday report", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?m47Fixture=1");
  await expect(page.getByTestId("live-next-event")).toBeEnabled();
  const before = await state(page);
  await page.getByTestId("live-next-event").click();
  await expect.poll(async () => (await state(page)).simulation.advancing).toBeNull();
  const event = await state(page);
  expect(event.simulation.speed).toBe("paused");
  expect(event.simulation.dayMinute).toBeGreaterThan(before.simulation.dayMinute);
  expect(event.simulation.onCourse).toBeGreaterThan(0);
  await page.getByTestId("live-finish-day").click();
  await expect(page.getByTestId("live-stop-advance")).toBeVisible();
  await page.getByTestId("live-stop-advance").click();
  await expect(page.getByTestId("live-stop-advance")).toHaveCount(0);
  const stopped = await state(page);
  await page.waitForTimeout(250);
  expect((await state(page)).simulation.dayMinute).toBe(stopped.simulation.dayMinute);
  await page.getByTestId("live-finish-day").click();
  await expect.poll(async () => (await state(page)).simulation.dayIndex, { timeout: 120_000 }).toBe(1);
  const finished = await state(page);
  expect(finished.simulation.speed).toBe("paused");
  expect(finished.simulation.dayMinute).toBe(0);
  const snapshot = await save(page);
  expect(snapshot.live.weekLedger.days).toHaveLength(1);
  expect(snapshot.live.weekLedger.days[0].dayIndex).toBe(0);
  await page.evaluate(async () => {
    await window.__coursecraftTest!.startWeekCloseFixture(3);
    window.__coursecraftTest!.pauseLiveSimulation();
  });
  await page.getByTestId("live-finish-day").click();
  const report = page.getByTestId("week-close-report");
  await expect(report).toBeVisible();
  await expect(report.getByText("Week 3 complete")).toBeVisible();
  const sunday = await state(page);
  expect(sunday.simulation.speed).toBe("paused");
  expect(sunday.simulation.dayMinute).toBe(0);
  expect(sunday.simulation.weekReport.week).toBe(3);
  await page.waitForTimeout(250);
  expect((await state(page)).simulation).toEqual(sunday.simulation);
  await page.screenshot({ path: info.outputPath("one-week-close.png"), fullPage: true });
  const pending = await save(page);
  expect(pending.live.weekReportPending).toEqual({ version: 1, week: 3, resumeSpeed: "1x" });
  // Seed only the deterministic outstanding putt-time debt; load/acknowledge uses the real UI.
  const pendingDebt = { ...pending, live: { ...pending.live, controlledTime: {
    version: 1, scope: "player:week-close-fixture", roundId: "finished-putt", observedShotCount: 1,
    observedTotalSteps: 14, pendingSteps: 14,
  } } };
  await page.evaluate(async (payload) => {
    const path = "/src/utils/saveStore.ts";
    await (await import(path)).saveToSlot("week-close-pending", "manual", "Week close with pending time", payload);
  }, pendingDebt);
  await page.reload();
  await expect(page.getByTestId("speed-paused")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /load game/i }).click();
  await page.getByTestId("save-slot-week-close-pending").getByRole("button", { name: "Load", exact: true }).click();
  await expect(report).toBeVisible();
  await expect(report.getByText("Week 3 complete")).toBeVisible();
  const held = await state(page);
  await page.waitForTimeout(350);
  expect((await state(page)).authority.dayMinute).toBe(held.authority.dayMinute);
  expect((await state(page)).simulation.controlledTimePendingSteps).toBe(14);
  await page.getByTestId("week-close-continue").click();
  await expect(report).toHaveCount(0);
  await expect.poll(async () => (await state(page)).simulation.controlledTimePendingSteps).toBe(0);
  const acknowledged = await save(page);
  expect(acknowledged.live.weekReportPending).toBeUndefined();
  expect(acknowledged.world.week).toBe(4);
  expect(acknowledged.history).toEqual(pending.history);
  expect(acknowledged.live.state.dayMinute).toBeGreaterThanOrEqual(.7 - 1e-10);
  writeFileSync(info.outputPath("day-evidence.json"), JSON.stringify({ before, event, stopped, finished, sunday, errors }, null, 2));
  expect(errors).toEqual([]);
});

test("following ordinary AI uses a real-time retained shot at every speed and preserves authority on pause and skip", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/?m47Fixture=1");
  await expect(page.getByTestId("live-next-event")).toBeEnabled();
  await page.getByTestId("live-next-event").click();
  await expect.poll(async () => (await state(page)).simulation.onCourse).toBeGreaterThan(0);
  const actorId = (await state(page)).golfers[0].id as number;
  await page.getByRole("button", { name: "Open live overview" }).click();
  await page.getByTestId("live-overview").locator("button:has(b)").first().click();
  await expect.poll(async () => (await state(page)).simulation.following).toBe(actorId);
  await page.getByTestId("speed-4x").click();
  await expect(page.getByTestId("followed-shot-playback")).toBeVisible();
  const initial = await state(page);
  const key = initial.simulation.focusedShot.key;
  const minute = initial.authority.dayMinute;
  const samples = [];
  for (const speed of ["1x", "2x", "4x"] as const) {
    await page.getByTestId(`speed-${speed}`).click();
    const previous = (await state(page)).simulation.focusedShot.progress;
    await page.waitForTimeout(900);
    const current = await state(page);
    expect(current.simulation.focusedShot.key).toBe(key);
    expect(current.simulation.focusedShot.progress - previous).toBeGreaterThan(.04);
    expect(current.simulation.focusedShot.progress - previous).toBeLessThan(.25);
    expect(current.authority.dayMinute).toBe(minute);
    samples.push(current);
  }
  await page.getByTestId("speed-paused").click();
  const paused = await state(page);
  await page.waitForTimeout(300);
  expect((await state(page)).simulation.focusedShot).toEqual(paused.simulation.focusedShot);
  const saved = await save(page);
  const golfer = saved.live.state.golfers.find((entry: { id: number }) => entry.id === actorId);
  const segment = golfer.segments[golfer.segIndex];
  const motion = segment.motion as RetainedShotMotionV1;
  expect(saved.live.focusedShot).toBeDefined();
  for (const sample of samples) {
    const frame = sample.simulation.focusedShot;
    const rendered = sample.golfers.find((entry: { id: number }) => entry.id === actorId);
    const expected = sampleRetainedShotMotion(motion, frame.motionProgress)!;
    expect(rendered.ballMotion.pose.time).toBe(frame.motionProgress);
    expect(rendered.ballMotion.identity).toEqual(motion.identity);
    expect(rendered.ballMotion.pose.point.x).toBeCloseTo(expected.point.x, 7);
    expect(rendered.ballMotion.pose.point.y).toBeCloseTo(expected.point.y, 7);
    expect(rendered.ballMotion.pose.heightYards).toBeCloseTo(expected.heightYards, 7);
  }
  await page.screenshot({ path: info.outputPath("paused-followed-flight.png"), fullPage: true });
  const outcomes = golfer.shotOutcomes;
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /load game/i }).click();
  await page.getByTestId("save-slot-quick-save").getByRole("button", { name: "Load", exact: true }).click();
  await expect.poll(async () => (await state(page)).simulation.focusedShot?.key ?? null).toBe(key);
  await expect(page.getByTestId("skip-followed-shot")).toBeVisible();
  const reloaded = await save(page);
  expect(reloaded.live.focusedShot.cursor).toEqual(saved.live.focusedShot.cursor);
  expect(reloaded.live.state.golfers.find((entry: { id: number }) => entry.id === actorId).shotOutcomes).toEqual(outcomes);
  await page.getByTestId("skip-followed-shot").click();
  await expect.poll(async () => (await state(page)).simulation.focusedShot?.key ?? null).not.toBe(key);
  const after = await save(page);
  const settled = after.live.state.golfers.find((entry: { id: number }) => entry.id === actorId);
  expect(settled.shotOutcomes).toEqual(outcomes);
  expect(settled.segIndex).toBeGreaterThan(golfer.segIndex);
  expect(after.live.speed).toBe("paused");
  writeFileSync(info.outputPath("follow-evidence.json"), JSON.stringify({ initial, samples, paused, before: saved.live, after: after.live, errors }, null, 2));
  expect(errors).toEqual([]);
});

test("challenge playback shows each participant and reloads a retained AI shot without replaying outcomes", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  const tutorial = page.getByRole("dialog", { name: "First-launch tutorial" });
  if (await tutorial.count()) await tutorial.getByRole("button", { name: "Skip tutorial" }).click();
  await page.evaluate(() => window.__coursecraftTest!.setChallengeGroupRoundFixture());
  await expect(page.getByTestId("challenge-group-playback")).toBeVisible();
  await expect.poll(async () => (await state(page)).playerPro.groupPresentation?.frame?.progress ?? 0).toBeGreaterThan(.25);
  const initial = await state(page);
  expect(initial.playerPro.groupPresentation.actorId).toBe("rival-alex");
  await page.screenshot({ path: info.outputPath("group-opening-rival-alex.png"), fullPage: true });
  await page.getByTestId("skip-challenge-group").click();
  await expect(page.getByTestId("commit-player-shot")).toBeVisible();
  await expect(page.getByTestId("live-finish-day")).toBeDisabled();
  await page.getByTestId("commit-player-shot").click();
  await expect(page.getByTestId("challenge-group-playback")).toBeVisible();
  const committed = await save(page);
  const authority = committed.world.playerPro.activeChallengeGroupRound;
  const batchActors = authority.presentation.entries.map((entry: { turn: number }) => authority.turnEvidence[entry.turn - 1].golferId);
  expect(batchActors.length).toBeGreaterThan(0);
  expect(batchActors.length).toBeLessThanOrEqual(4);
  expect(new Set(batchActors).size).toBe(batchActors.length);
  const observed: string[] = [initial.playerPro.groupPresentation.actorId];
  const observedBatch: string[] = [];
  let reloaded = false;
  for (let index = 0; index < batchActors.length; index++) {
    await expect.poll(async () => (await state(page)).playerPro.groupPresentation?.frame?.progress ?? 0).toBeGreaterThan(.12);
    const current = await state(page);
    const actor = current.playerPro.groupPresentation.actorId as string;
    expect(observedBatch).not.toContain(actor);
    expect(actor).toBe(batchActors[index]);
    observed.push(actor);
    observedBatch.push(actor);
    expect(current.simulation.dayMinute).toBe(initial.simulation.dayMinute);
    const moving = await page.evaluate(() => (window as unknown as { __ccPlayerShotPlayback?: { shotId: string; motionProgress: number; point: { x: number; y: number }; heightYards: number } }).__ccPlayerShotPlayback ?? null);
    const turn = authority.turnEvidence[current.playerPro.groupPresentation.turn - 1];
    const golfer = authority.golfers.find((entry: { id: string }) => entry.id === actor);
    const shot = golfer.shots.find((entry: { id: string }) => entry.id === turn.shotId);
    expect(moving?.shotId).toBe(shot.id);
    const expected = sampleRetainedShotMotion(shot.sharedOutcome.motion, moving!.motionProgress)!;
    expect(moving!.point.x).toBeCloseTo(expected.point.x, 7);
    expect(moving!.point.y).toBeCloseTo(expected.point.y, 7);
    expect(moving!.heightYards).toBeCloseTo(expected.heightYards, 7);
    if (!reloaded && actor !== authority.playerGolferId) {
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /save game/i }).click();
      const slot = page.getByTestId("save-slot-quick-save");
      await slot.getByRole("button", { name: "Overwrite", exact: true }).click();
      await expect(page.locator(".cc-save-load-notice")).toContainText("Overwrote");
      const paused = await page.evaluate(async () => {
        const path = "/src/utils/saveStore.ts";
        return (await import(path)).loadSlot("quick-save");
      });
      const before = paused.world.playerPro.activeChallengeGroupRound;
      await slot.getByRole("button", { name: "Load", exact: true }).click();
      await expect.poll(async () => (await state(page)).playerPro.groupPresentation?.actorId).toBe(actor);
      const loaded = await save(page);
      expect(loaded.world.playerPro.activeChallengeGroupRound.turnEvidence).toEqual(before.turnEvidence);
      expect(loaded.world.playerPro.activeChallengeGroupRound.rngCursor).toBe(before.rngCursor);
      expect(loaded.world.playerPro.activeChallengeGroupRound.presentation.index).toBe(before.presentation.index);
      reloaded = true;
    }
    await page.screenshot({ path: info.outputPath(`group-${actor}.png`), fullPage: true });
    await page.getByTestId("skip-challenge-shot").click();
    await expect.poll(async () => (await state(page)).playerPro.groupPresentation?.actorId ?? null).not.toBe(actor);
  }
  expect([...new Set(observed)].sort()).toEqual(authority.golfers.map((entry: { id: string }) => entry.id).sort());
  expect(reloaded).toBe(true);
  await expect.poll(async () => (await state(page)).simulation.controlledTimePendingSteps).toBe(0);
  const after = await save(page);
  expect(after.world.playerPro.activeChallengeGroupRound.turnEvidence).toEqual(authority.turnEvidence);
  expect(after.world.playerPro.activeChallengeGroupRound.rngCursor).toBe(authority.rngCursor);
  expect(after.live.state.dayMinute).toBeGreaterThan(initial.simulation.dayMinute);
  writeFileSync(info.outputPath("group-evidence.json"), JSON.stringify({ observed, authority, after, errors }, null, 2));
  expect(errors).toEqual([]);
});
