import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

test("quick start → playable course → live week → save → reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");

  const result = await page.evaluate(() => window.__coursecraftTest!.runGoldenWeek());
  expect(result.rounds).toBeGreaterThan(0);
  expect(result.week).toBe(2);
  expect(Number.isFinite(result.cash)).toBe(true);
  expect(result.afterHash).toBe(result.beforeHash);

  await page.reload();
  const loadGame = page.getByRole("button", { name: "Load Game" });
  await expect(loadGame).toBeEnabled();
  await loadGame.click();
  await expect(page.getByText(/E2E golden path/)).toBeVisible();
  await page.getByRole("button", { name: "Load", exact: true }).first().click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().week)).toBe(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("every checked-in historical save fixture migrates", async ({ page }) => {
  await page.goto("/");
  const fixtures = ["save-v1.json"];
  for (const fixture of fixtures) {
    const text = readFileSync(path.join(process.cwd(), "e2e", "fixtures", fixture), "utf8");
    const result = await page.evaluate(
      (fixtureText) => window.__coursecraftTest!.validateFixture(fixtureText),
      text
    );
    expect(result).toEqual({ ok: true, migratedFrom: 1 });
  }
});
