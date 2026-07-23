import { expect, test } from "@playwright/test";

test("pace operations presets, hospitality, and staff assignments are visible and interactive", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/?perfFixture=1");
  await expect(page.getByLabel("Open live overview")).toBeVisible();
  await page.getByLabel("Open live overview").click();
  await page.getByRole("tab", { name: "Pace" }).click();
  await expect(page.getByTestId("pace-operations")).toBeVisible();
  await expect(page.getByLabel("Tee interval minutes")).toHaveValue("10");
  await page.getByRole("button", { name: "brisk", exact: true }).click();
  await expect(page.getByLabel("Tee interval minutes")).toHaveValue("12");
  await page.getByLabel("Beverage service").selectOption("beer_wine");
  await expect.poll(async () => JSON.parse(await page.evaluate(() => window.render_game_to_text?.() ?? "{}"))?.simulation?.pace?.beverageMenu).toBe("beer_wine");
  await page.screenshot({ path: "artifacts/m29-pace/pace-operations.png", fullPage: true });

  await page.getByRole("tab", { name: "Staff" }).click();
  await expect(page.getByText("course marshal", { exact: false })).toBeVisible();
  await page.screenshot({ path: "artifacts/m29-pace/staff-roster.png", fullPage: true });
  expect(errors).toEqual([]);
});
