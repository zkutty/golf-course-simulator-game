import { expect, test } from "@playwright/test";

test("single-cell bunker and natural detail render as organic landscape", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m20Fixture=1&m20Theme=parkland");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), {
    timeout: 90_000,
  }).toBe("game");
  await page.evaluate(() => window.__coursecraftTest?.setGraphicsQualityFixture("medium"));
  await expect.poll(() => page.evaluate(() => (
    JSON.parse(window.render_game_to_text?.() ?? "{}").graphics?.quality
  ))).toBe("medium");
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await page.evaluate(() => window.__coursecraftTest?.setPaintCash(1_000_000));
  await page.evaluate(() => window.__coursecraftTest?.resetM35Metrics());
  await expect.poll(() => page.evaluate(() => (
    window.__coursecraftTest!.m35Metrics().connectedRebuild.count
  ))).toBe(0);

  await page.getByRole("button", { name: "Expand design dock" }).click();
  await expect(page.getByTestId("design-dock")).toHaveAttribute("data-collapsed", "false");
  await page.getByTestId("design-tool-curve").click();
  const width = page.getByLabel("Brush width");
  await width.focus();
  await width.press("Home");
  await expect(width).toHaveValue("1");
  await page.getByTestId("design-card-terrain-sand").click();

  const canvas = page.locator(".cc-pixi-stage canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const target = {
    x: box.x + box.width * 0.52,
    y: box.y + box.height * 0.26,
  };
  const beforeCount = await page.evaluate(() => (
    window.__coursecraftTest!.terrainSurfaceState().features.length
  ));
  await page.mouse.click(target.x, target.y);
  await expect.poll(() => page.evaluate(() => (
    window.__coursecraftTest!.terrainSurfaceState().features.length
  ))).toBe(beforeCount + 1);
  const feature = await page.evaluate(() => (
    window.__coursecraftTest!.terrainSurfaceState().features.at(-1)
  ));
  expect(feature?.terrain).toBe("sand");
  expect(feature?.coverage).toHaveLength(1);

  // A separate wider stroke becomes a connected, shallow fairway bunker.
  // Gameplay remains whole-cell authoritative while the renderer derives one
  // distance-sampled organic contour for the complete accepted component.
  await width.fill("3");
  const connectedPoints = [
    [0.73, 0.24],
    [0.77, 0.23],
    [0.81, 0.25],
  ] as const;
  await page.mouse.move(
    box.x + box.width * connectedPoints[0][0],
    box.y + box.height * connectedPoints[0][1],
  );
  await page.mouse.down();
  for (const [x, y] of connectedPoints.slice(1)) {
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y, {
      steps: 5,
    });
  }
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (
    window.__coursecraftTest!.terrainSurfaceState().features.length
  ))).toBe(beforeCount + 2);
  const connectedFeature = await page.evaluate(() => (
    window.__coursecraftTest!.terrainSurfaceState().features.at(-1)
  ));
  expect(connectedFeature?.terrain).toBe("sand");
  expect(connectedFeature?.coverage.length).toBeGreaterThan(1);

  const shot = await page.screenshot({
    path: "artifacts/m35-landscape-details.png",
    fullPage: true,
  });
  await testInfo.attach("m35-landscape-details", {
    body: shot,
    contentType: "image/png",
  });

  await page.mouse.move(target.x, target.y);
  for (let step = 0; step < 5; step++) {
    await page.mouse.wheel(0, -1200);
    await page.waitForTimeout(35);
  }
  await page.waitForTimeout(900);
  await page.mouse.move(box.x + 8, box.y + box.height - 8);
  await page.waitForTimeout(100);
  const potShot = await page.screenshot({
    path: "artifacts/m35-pot-bunker-detail.png",
    fullPage: true,
  });
  await testInfo.attach("m35-pot-bunker-detail", {
    body: potShot,
    contentType: "image/png",
  });

  // Reverse the same cursor-anchored zoom to restore the authored overview,
  // then zoom to the connected fairway profile.
  await page.mouse.move(target.x, target.y);
  for (let step = 0; step < 5; step++) {
    await page.mouse.wheel(0, 1_200);
    await page.waitForTimeout(35);
  }
  await page.waitForTimeout(1_200);
  const detailTarget = {
    x: box.x + box.width * 0.77,
    y: box.y + box.height * 0.24,
  };
  await page.mouse.move(detailTarget.x, detailTarget.y);
  for (let step = 0; step < 7; step++) {
    await page.mouse.wheel(0, -1200);
    await page.waitForTimeout(35);
  }
  await page.waitForTimeout(1_200);
  await page.mouse.move(box.x + 8, box.y + box.height - 8);
  await page.waitForTimeout(100);
  const metrics = await page.evaluate(() => window.__coursecraftTest!.m35Metrics());
  expect(metrics.connectedRebuild.count).toBeGreaterThan(0);
  expect(metrics.connectedRebuild.maxMs).toBeLessThan(100);
  expect(metrics.chunkRebuild.maxMs).toBeLessThan(100);
  const detailShot = await page.screenshot({
    path: "artifacts/m35-bunker-variants.png",
    fullPage: true,
  });
  await testInfo.attach("m35-bunker-variants", {
    body: detailShot,
    contentType: "image/png",
  });
  expect(errors).toEqual([]);
});
