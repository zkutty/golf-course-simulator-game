import { expect, test, type Page } from "@playwright/test";

const state = (page: Page) => page.evaluate(() => ({
  simulation: JSON.parse(window.render_game_to_text?.() ?? "{}").simulation,
  authority: window.__coursecraftTest?.state(),
}));

async function seedSundaySave(page: Page) {
  await page.evaluate(async () => {
    await window.__coursecraftTest!.seedLoadingSaveFixture({ id: "deferred-sunday", theme: "parkland", week: 4, dayIndex: 0 });
    const path = "/src/utils/saveStore.ts";
    const store = await import(path);
    const saved = await store.loadSlot("deferred-sunday");
    if (!saved?.live) throw new Error("Expected the seeded live save.");
    await store.saveToSlot("deferred-sunday", "manual", "Deferred Sunday", { ...saved, live: { ...saved.live,
      weekReportPending: { version: 1, week: 3, resumeSpeed: "4x" },
      controlledTime: { version: 1, scope: "player:deferred", roundId: "finished-putt", observedShotCount: 1,
        observedTotalSteps: 14, pendingSteps: 14 },
    } });
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
}

test("title defers the live driver and restores queued Sunday authority before its first frame", async ({ page }) => {
  let requests = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/src/hooks/LiveSimulationController.tsx*", async (route) => {
    requests++;
    await gate;
    await route.continue();
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Quick Start", exact: true })).toBeVisible();
  expect(requests).toBe(0);
  await seedSundaySave(page);
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect.poll(() => requests).toBe(1);
  await expect(page.getByText("Restoring your course…", { exact: true })).toBeVisible();
  await expect.poll(async () => (await state(page)).simulation?.controlledTimePendingSteps).toBe(14);
  const held = await state(page);
  expect(held.authority).toMatchObject({ week: 4, dayMinute: 0, screenBase: "loading" });
  expect(held.simulation).toMatchObject({ dayIndex: 0, dayMinute: 0, controlledTimePendingSteps: 14, weekReport: { week: 3 } });
  await page.evaluate(() => window.advanceTime?.(2000));
  await page.waitForTimeout(250);
  expect(await state(page)).toEqual(held);
  release();
  await expect(page.getByTestId("week-close-report")).toBeVisible();
  await expect(page.getByTestId("speed-paused")).toBeVisible();
  await expect.poll(async () => (await state(page)).simulation.controlledTimePendingSteps).toBe(14);
  const restored = await state(page);
  expect(restored.authority).toMatchObject({ week: 4, dayMinute: 0 });
  expect(restored.simulation.weekReport.week).toBe(3);
});

test("failed first-use driver import exposes reload recovery and retains queued authority", async ({ page }) => {
  await page.route("**/src/hooks/LiveSimulationController.tsx*", (route) => route.abort("failed"));
  await page.goto("/");
  await seedSundaySave(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Couldn’t open Live overview");
  await expect(page.getByRole("button", { name: "Reload CourseCraft", exact: true })).toBeVisible();
  const held = await state(page);
  await page.evaluate(() => window.advanceTime?.(2000));
  await page.waitForTimeout(250);
  expect(await state(page)).toEqual(held);
  expect(held.simulation).toMatchObject({ dayMinute: 0, controlledTimePendingSteps: 14, weekReport: { week: 3 } });
  await expect(page.getByTestId("live-next-event")).toHaveCount(0);
});
