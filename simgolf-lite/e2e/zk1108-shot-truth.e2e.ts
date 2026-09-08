import { test, expect, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";

const state = (page: Page) => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
const saved = (page: Page) => page.evaluate(async (path) => (await import(path)).loadSlot("quick-save"), "/src/utils/saveStore.ts");
const quickSave = async (page: Page) => {
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press("Control+KeyS");
  await expect(page.locator('.sr-only[role="status"]')).toContainText("Quick save complete");
};

test("current-shot channel follows actual live action and survives keyboard save/reload", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/?m47Fixture=1");
  await expect(page.getByTestId("speed-1x")).toBeVisible();
  await page.getByTestId("speed-1x").focus();
  await page.keyboard.press("Enter");
  let flyingId: number | undefined;
  for (let i = 0; i < 100; i++) {
    await page.evaluate(() => window.advanceTime?.(200));
    flyingId = (await state(page)).golfers.find((g: { segment: string }) => g.segment === "flight")?.id;
    if (flyingId !== undefined) break;
  }
  expect(flyingId, "a visible live flight is required").toBeDefined();
  await page.evaluate(() => window.__coursecraftTest?.pauseLiveSimulation());
  const during = await state(page);
  await page.screenshot({ path: info.outputPath("live-flight.png"), fullPage: true });
  await quickSave(page);
  const beforeSave = await saved(page);
  const before = beforeSave.live.state.golfers.find((g: { id: number }) => g.id === flyingId);
  let observedResult = false;
  for (let i = 0; i < 100; i++) {
    await page.getByTestId("speed-1x").focus();
    await page.keyboard.press("Enter");
    await page.evaluate(() => {
      window.advanceTime?.(200);
      window.__coursecraftTest?.pauseLiveSimulation();
    });
    await expect.poll(async () => (await state(page)).simulation.speed).toBe("paused");
    observedResult = (await state(page)).golfers.find((g: { id: number }) => g.id === flyingId)?.shotEvidence.phase === "result";
    if (observedResult) break;
  }
  expect(observedResult, "a completed observed shot must yield a result").toBe(true);
  await page.evaluate(() => window.__coursecraftTest?.pauseLiveSimulation());
  await quickSave(page);
  await expect.poll(async () => (await saved(page)).live.state.golfers.find((g: { id: number }) => g.id === flyingId).segIndex).toBeGreaterThan(before.segIndex);
  const afterSave = await saved(page);
  const after = afterSave.live.state.golfers.find((g: { id: number }) => g.id === flyingId);
  await page.getByRole("button", { name: "Open live overview" }).click();
  await page.getByTestId("live-overview").locator("button:has(b)").filter({ hasText: after.name }).click();
  const inspector = page.locator(".cc-golfer-inspector");
  const follow = inspector.locator("button[aria-pressed]");
  await expect(follow).toHaveAccessibleName(/follow/i);
  await follow.focus();
  await expect(follow).toBeFocused();
  const channel = page.getByTestId("golfer-shot-evidence");
  await expect(channel).toHaveCount(1);
  await expect(channel).toHaveAccessibleName("Selected golfer shot evidence");
  const selected = (await state(page)).selectedGolferEvidence;
  expect(selected.golferId).toBe(flyingId);
  expect(selected.channel.phase).toBe("result");
  await expect(channel).toHaveAttribute("data-phase", selected.channel.phase);
  const selectedTelemetry = (await state(page)).golfers.find((g: { id: number }) => g.id === selected.golferId);
  expect(selectedTelemetry.shotEvidence).toEqual(selected.channel);
  if (selected.channel.phase === "result") {
    expect(selectedTelemetry.latestRuling).not.toBeNull();
    await expect(channel).toContainText("penalty stroke(s)");
  } else {
    expect(selectedTelemetry.latestRuling).toBeNull();
    expect(selectedTelemetry.latestSharedOutcome).toBeNull();
  }
  await channel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("single-channel.png"), fullPage: true });
  await page.reload();
  await expect(page.getByTestId("speed-1x")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /load game/i }).focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("save-slot-quick-save").getByRole("button", { name: "Load", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screenBase)).toBe("in-game");
  expect(await page.evaluate(() => window.__coursecraftTest?.state().golferPositions)).toEqual(
    afterSave.live.state.golfers.map((g: { id: number; pos: { x: number; y: number } }) => [g.id, g.pos.x, g.pos.y]),
  );
  expect((await saved(page)).live.state.golfers.find((g: { id: number }) => g.id === flyingId).shotOutcomes).toEqual(after.shotOutcomes);
  const reloaded = await state(page);
  expect(reloaded.golfers.find((g: { id: number }) => g.id === selected.golferId).shotEvidence).toEqual(selected.channel);
  await page.screenshot({ path: info.outputPath("reloaded.png"), fullPage: true });
  writeFileSync(info.outputPath("evidence.json"), JSON.stringify({ during, before, after, selected, reloaded, errors }, null, 2));
  expect(errors).toEqual([]);
});
