import { expect, test } from "@playwright/test";

function money(text: string): number {
  return Number(text.replace(/[^0-9.-]/g, ""));
}

test("terrain strokes preview and commit atomically, cancel safely, and reject unaffordable work", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m20Fixture=1&m20Theme=parkland");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.name))
    .toBe("M20 parkland Terrain Laboratory");
  await page.evaluate(() => window.__coursecraftTest!.setPaintCash(100_000));
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().cash)).toBe(100_000);

  const canvas = page.locator(".cc-pixi-stage canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Course canvas has no bounds");
  // Stay clear of the HUD, minimap, and live-controls overlays while still
  // crossing a representative run of visible course tiles.
  const start = { x: box.x + box.width * 0.43, y: box.y + box.height * 0.54 };

  // The responsive Design dock starts collapsed at this viewport.  Capture
  // the stable canvas geometry first, then make the terrain palette part of
  // the fixture's explicit readiness contract before selecting a material.
  // This avoids polling canvas visibility while the dock's first expansion
  // performs its one-off responsive layout work.
  const designDock = page.getByTestId("design-dock");
  await designDock.getByRole("button", { name: "Expand design dock" }).click();
  await expect(designDock).toHaveAttribute("data-collapsed", "false");

  await designDock.getByTestId("design-card-terrain-green").click();
  const beforeStroke = await page.evaluate(() => window.__coursecraftTest!.state());
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 110, start.y, { steps: 12 });
  const card = page.getByTestId("terrain-stroke-preview");
  await expect(card).toBeVisible();
  const previewText = await card.innerText();
  const changed = Number(previewText.match(/(\d+) tiles/i)?.[1] ?? 0);
  expect(changed).toBeGreaterThan(1);
  const projectedText = previewText.match(/Cash ([^→]+) → ([^\n]+)/)?.[2];
  expect(projectedText).toBeTruthy();
  const projectedCash = money(projectedText!);
  await page.mouse.up();

  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().terrainVersion)).toBe(beforeStroke.terrainVersion + 1);
  const afterStroke = await page.evaluate(() => window.__coursecraftTest!.state());
  expect(afterStroke.economyVersion).toBe(beforeStroke.economyVersion + 1);
  expect(afterStroke.cash).toBe(projectedCash);
  expect((afterStroke.terrainCounts.green ?? 0) - (beforeStroke.terrainCounts.green ?? 0)).toBe(changed);

  const beforeCancel = await page.evaluate(() => window.__coursecraftTest!.state());
  await page.mouse.move(start.x - 30, start.y + 20);
  await page.mouse.down();
  await page.mouse.move(start.x + 80, start.y + 30, { steps: 8 });
  await expect(card).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await page.mouse.up();
  const afterCancel = await page.evaluate(() => window.__coursecraftTest!.state());
  expect(afterCancel.terrainVersion).toBe(beforeCancel.terrainVersion);
  expect(afterCancel.economyVersion).toBe(beforeCancel.economyVersion);
  expect(afterCancel.cash).toBe(beforeCancel.cash);

  await designDock.getByTestId("design-card-terrain-water").click();
  await page.evaluate(() => window.__coursecraftTest!.setPaintCash(1));
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().cash)).toBe(1);
  const beforeRejected = await page.evaluate(() => window.__coursecraftTest!.state());
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect(card).toContainText("Insufficient funds");
  await expect(card).toContainText("short");
  await page.mouse.up();
  const afterRejected = await page.evaluate(() => window.__coursecraftTest!.state());
  expect(afterRejected.terrainVersion).toBe(beforeRejected.terrainVersion);
  expect(afterRejected.economyVersion).toBe(beforeRejected.economyVersion);
  expect(afterRejected.cash).toBe(1);
  expect(afterRejected.terrainCounts).toEqual(beforeRejected.terrainCounts);
});
