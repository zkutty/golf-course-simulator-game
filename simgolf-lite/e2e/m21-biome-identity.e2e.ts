import { expect, test } from "@playwright/test";
import { waitForLegacyBiomeFixture } from "./legacy-biome-fixture";

test("M21 biome packs, rotations, density, and course-only captures", async ({ page }, testInfo) => {
  const errors: string[] = [];
  const failedAssets: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", (response) => {
    if (response.status() >= 400 && /atlases|assets/.test(response.url())) failedAssets.push(`${response.status()} ${response.url()}`);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  const themeCaptures: Buffer[] = [];
  const propCluster = {
    parkland: { x: 100, y: 350 },
    links: { x: 390, y: 285 },
    desert: { x: 445, y: 285 },
  };

  for (const theme of ["parkland", "links", "desert"] as const) {
    await page.goto(`/?m21Fixture=1&m21Theme=${theme}`);
    await waitForLegacyBiomeFixture(page, {
      theme,
      courseName: `M21 ${theme} Biome Preserve`,
      minimumObstacleCount: 21,
    });
    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.theme)).toBe(theme);
    const state = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
    expect(state.course.name).toBe(`M21 ${theme} Biome Preserve`);
    expect(Object.values(state.course.obstacleCounts as Record<string, number>).reduce((sum, value) => sum + value, 0)).toBeGreaterThan(20);
    const canvas = page.locator(".cc-pixi-stage canvas");
    await expect(canvas).toBeVisible();
    for (const rotation of [0, 90, 180, 270]) {
      if (rotation > 0) await page.keyboard.press("e");
      await expect(page.getByLabel(`View bearing ${rotation} degrees`)).toHaveCount(1);
      const shot = await canvas.screenshot({ path: `artifacts/m21-${theme}-${rotation}.png` });
      await testInfo.attach(`${theme}-${rotation}`, { body: shot, contentType: "image/png" });
      if (rotation === 0) themeCaptures.push(shot);
    }
    await page.keyboard.press("e");
    await expect(page.getByLabel("View bearing 0 degrees")).toHaveCount(1);
    await page.keyboard.press("f");
    await page.mouse.move(propCluster[theme].x, propCluster[theme].y);
    await page.mouse.wheel(0, -1500);
    const detail = await canvas.screenshot({ path: `artifacts/m21-${theme}-detail.png` });
    await testInfo.attach(`${theme}-detail`, { body: detail, contentType: "image/png" });
  }

  expect(themeCaptures[0].equals(themeCaptures[1])).toBe(false);
  expect(themeCaptures[1].equals(themeCaptures[2])).toBe(false);
  expect(failedAssets).toEqual([]);
  expect(errors).toEqual([]);
});

test("M21 new-game previews expose distinct deterministic ecology", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: /New Game/i }).click();
  await page.getByRole("button", { name: "Next →" }).click();
  await expect(page.getByText("Pick your land", { exact: true })).toBeVisible();
  const captures: Buffer[] = [];
  for (const theme of ["Parkland", "Links", "Desert"] as const) {
    await page.getByRole("button").filter({ hasText: theme }).first().click();
    const preview = page.locator("canvas").first();
    await expect(preview).toBeVisible();
    const shot = await preview.screenshot({ path: `artifacts/m21-preview-${theme.toLowerCase()}.png` });
    captures.push(shot);
    await testInfo.attach(`preview-${theme.toLowerCase()}`, { body: shot, contentType: "image/png" });
  }
  expect(captures[0].equals(captures[1])).toBe(false);
  expect(captures[1].equals(captures[2])).toBe(false);
});
