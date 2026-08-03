import { expect, test } from "@playwright/test";

test("ZK-672 explicit inspector Flyover control still starts the cinematic", async ({ page }) => {
  await page.goto("/?m23Fixture=1");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.name)).toBe("M23 Course Standards Club");
  await page.getByRole("button", { name: "Exit", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.getByText("▶ Flyover", { exact: true }).click();
  await expect(page.getByText("click or Esc to skip")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("click or Esc to skip")).toHaveCount(0);
});
