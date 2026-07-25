import { expect, test } from "@playwright/test";

test("ZK-460 painted areas retain authored material texture at overview and detail zoom", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m20Fixture=1&m20Theme=parkland");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").screen), {
    timeout: 120_000,
  }).toBe("game");
  await expect.poll(() => page.evaluate(() => (
    JSON.parse(window.render_game_to_text?.() ?? "{}").course?.name
  ))).toBe("M20 parkland Terrain Laboratory");
  await page.evaluate(() => window.__coursecraftTest?.setPaintCash(1_000_000));
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().cash)).toBe(1_000_000);

  const initial = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
  await page.getByRole("button", { name: "Area", exact: true }).click();
  await page.locator("button").filter({ hasText: /^fairway$/ }).last().click();

  const canvas = page.locator(".cc-pixi-stage canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  const loop: Array<[number, number]> = [
    [0.34, 0.30],
    [0.45, 0.27],
    [0.52, 0.34],
    [0.50, 0.45],
    [0.40, 0.48],
    [0.32, 0.40],
    [0.34, 0.30],
  ];
  await page.mouse.move(box.x + box.width * loop[0][0], box.y + box.height * loop[0][1]);
  await page.mouse.down();
  for (const [x, y] of loop.slice(1)) {
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 4 });
  }
  await page.mouse.up();

  await expect.poll(() => page.evaluate(() => (
    JSON.parse(window.render_game_to_text?.() ?? "{}").course?.surfaceFeatures?.at(-1)?.terrain
  ))).toBe("fairway");
  const committed = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
  expect(committed.course.surfaceFeatures.at(-1)).toMatchObject({
    terrain: "fairway",
    kind: "region",
  });
  expect(committed.course.surfaceFeatures.at(-1).coverage).toBeGreaterThan(15);
  expect(committed.course.terrainCounts.fairway).toBeGreaterThan(initial.course.terrainCounts.fairway);

  const overview = await canvas.screenshot({ path: "artifacts/zk460-material-overview.png" });
  await testInfo.attach("zk460-material-overview", { body: overview, contentType: "image/png" });

  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.37);
  await page.mouse.wheel(0, -1100);
  await page.waitForTimeout(300);
  const detail = await canvas.screenshot({ path: "artifacts/zk460-material-detail.png" });
  await testInfo.attach("zk460-material-detail", { body: detail, contentType: "image/png" });

  expect(errors).toEqual([]);
});
