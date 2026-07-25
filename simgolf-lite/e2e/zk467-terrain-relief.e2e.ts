import { expect, test } from "@playwright/test";

for (const theme of ["parkland", "links", "desert"] as const) {
  test(`ZK-467 ${theme} renders recessed hazards and biome relief`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/?m20Fixture=1&m20Theme=${theme}`);
    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").screen), {
      timeout: 120_000,
    }).toBe("game");

    const state = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
    expect(state.course.theme).toBe(theme);
    expect(state.course.terrainCounts.water).toBeGreaterThan(0);
    expect(state.course.terrainCounts.sand).toBeGreaterThan(0);
    expect(state.course.terrainCounts.deep_rough).toBeGreaterThan(0);

    const canvas = page.locator(".cc-pixi-stage canvas");
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.wheel(0, -850);
    await page.waitForTimeout(300);
    const detail = await canvas.screenshot({ path: `artifacts/zk467-${theme}-relief.png` });
    await testInfo.attach(`${theme}-relief`, { body: detail, contentType: "image/png" });

    for (const rotation of [90, 180, 270]) {
      await page.keyboard.press("e");
      await expect(page.getByLabel(`View bearing ${rotation} degrees`)).toHaveCount(1);
    }
    expect(errors).toEqual([]);
  });
}
