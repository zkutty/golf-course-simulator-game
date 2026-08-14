import { expect, test } from "@playwright/test";

test("M32 resort package survives a mid-stay save and completes its itinerary", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/?propertyFixture=1");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 30_000 }).toBe("game");

  const result = await page.evaluate(() => window.__coursecraftTest!.runResortGoldenPath());
  expect(result.beforeHash).toBe(result.afterHash);
  expect(result).toMatchObject({ status: "checked_out", fulfilled: 3, total: 3, serviceQueue: 0 });
  expect(result.folioTotal).toBe(result.value);

  await page.getByTestId("workspace-legacy").click();
  await page.getByTestId("open-seasons-legacy").click();
  const seasons = page.getByTestId("seasons-legacy-panel");
  await expect(seasons).toBeVisible({ timeout: 45_000 });
  await seasons.getByRole("button", { name: "Club identity", exact: true }).click();
  await seasons.getByText("Manual system overrides", { exact: true }).click();
  await seasons.getByTestId("system-policy-resort").getByRole("button", { name: "Take control", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").systemControl.systems.find((system: { id: string }) => system.id === "resort"))).toMatchObject({ visibility: "full", mode: "manual", source: "save-override" });
  await seasons.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByTestId("workspace-operate").click();
  await page.getByTestId("open-property-management").click();
  await page.getByTestId("property-tab-resort").click();
  const dashboard = page.getByTestId("resort-dashboard");
  await expect(dashboard).toBeVisible();
  await expect(page.getByTestId("resort-capacity")).toContainText("rooms");
  await expect(dashboard).toContainText("Destination appeal");
  await expect(dashboard).toContainText("checked_out");
  await expect(dashboard).toContainText("itinerary 3/3 fulfilled");

  const overflow = await page.getByTestId("property-management-panel").evaluate((element) => ({
    horizontal: element.scrollWidth > element.clientWidth + 1,
    dialogLabel: element.getAttribute("aria-label"),
  }));
  expect(overflow).toEqual({ horizontal: false, dialogLabel: expect.any(String) });

  await dashboard.evaluate((element) => element.scrollIntoView({ block: "start" }));
  const shot = await page.screenshot({ fullPage: true, path: "artifacts/m32-destination-resort.png" });
  await testInfo.attach("destination-resort", { body: shot, contentType: "image/png" });
  await dashboard.getByRole("heading", { name: "Reservations and itineraries" }).evaluate((element) => element.scrollIntoView({ block: "start" }));
  const itineraryShot = await page.screenshot({ fullPage: true, path: "artifacts/m32-resort-itinerary.png" });
  await testInfo.attach("resort-itinerary", { body: itineraryShot, contentType: "image/png" });
  expect(errors).toEqual([]);
});
