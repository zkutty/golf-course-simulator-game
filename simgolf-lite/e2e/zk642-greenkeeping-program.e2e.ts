import { expect, test } from "@playwright/test";

test("ZK-642 green programs expose persistent advanced targets and realized tradeoffs", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(20_000);
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/?m23Fixture=1");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 30_000 }).toBe("game");

  const exitHoleEditor = page.getByRole("button", { name: "Exit", exact: true });
  if (await exitHoleEditor.isVisible()) {
    await exitHoleEditor.evaluate((button: HTMLButtonElement) => button.click());
    await expect(exitHoleEditor).toHaveCount(0);
  }
  await page.getByTestId("workspace-legacy").click();
  await page.getByTestId("open-seasons-legacy").click();
  const seasons = page.getByTestId("seasons-legacy-panel");
  await seasons.getByRole("button", { name: "Club identity", exact: true }).click();
  await seasons.getByText("Back-office systems", { exact: true }).click();
  const localizedTurf = seasons.getByTestId("back-office-policy-localized-turf");
  await localizedTurf.getByRole("button", { name: "Take control", exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return state.systemControl.systems.find((system: { id: string }) => system.id === "localized-turf");
  })).toMatchObject({ visibility: "full", mode: "manual", source: "save-override" });
  await seasons.getByRole("button", { name: "Close", exact: true }).click();
  const architect = page.getByRole("button", { name: "Architect", exact: true });
  if (await architect.isVisible()) await architect.click();
  await page.getByRole("button", { name: "Upgrades", exact: true }).click();

  await expect(page.getByTestId("green-program-balanced")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("green-keeping-realized")).toContainText("budget");
  const initial = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course.greenKeeping);
  expect(initial.program).toBe("balanced");
  expect(initial.explicitAdvancedControls).toBe(false);

  await page.getByTestId("green-program-championship").click();
  await expect(page.getByTestId("green-program-championship")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course.greenKeeping.program)).toBe("championship");

  const speedTarget = page.getByTestId("green-program-targetSpeedFeet");
  await speedTarget.focus();
  for (let step = 0; step < 13; step++) await page.keyboard.press("ArrowRight");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course.greenKeeping)).toMatchObject({
    program: "custom",
    explicitAdvancedControls: true,
    targets: { speedFeet: 12.8 },
  });
  await expect(page.getByText("Seasonal weather and water policy affect delivery", { exact: false })).toBeVisible();

  const screenshot = await page.screenshot({ fullPage: true });
  await testInfo.attach("zk642-greenkeeping-controls", { body: screenshot, contentType: "image/png" });
  expect(errors).toEqual([]);
});
