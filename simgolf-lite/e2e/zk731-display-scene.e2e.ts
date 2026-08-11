import { expect, test, type Page, type TestInfo } from "@playwright/test";

async function startDisplayFixture(page: Page, width = 1440, height = 1000) {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  const tutorialOffer = page.getByRole("dialog", { name: "First-launch tutorial" });
  if (await tutorialOffer.count()) await tutorialOffer.getByRole("button", { name: "Skip tutorial" }).click();
  await page.evaluate(() => window.__coursecraftTest!.setZk731DisplayFixture());
  await expect.poll(
    () => page.evaluate(() => window.__coursecraftPixiTest?.playerProCollectionDisplay().items.length ?? 0),
    { timeout: 15_000 },
  ).toBe(7);
  await page.evaluate(() => window.__coursecraftPixiTest!.focusTileForTest(5, 34, 1.15));
}

async function captureCanvas(page: Page, testInfo: TestInfo, name: string) {
  const canvas = page.locator(".cc-course-pane canvas").first();
  await expect(canvas).toBeVisible();
  await testInfo.attach(name, {
    body: await canvas.screenshot({ path: `artifacts/${name}.png` }),
    contentType: "image/png",
  });
}

async function hideCanvasObstructions(page: Page) {
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".cc-course-pane canvas");
    if (!canvas) throw new Error("Course canvas unavailable");
    const target = canvas.getBoundingClientRect();
    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      if (element === canvas || element.contains(canvas)) continue;
      const bounds = element.getBoundingClientRect();
      const intersects = bounds.right > target.left
        && bounds.left < target.right
        && bounds.bottom > target.top
        && bounds.top < target.bottom;
      if (intersects) element.style.setProperty("visibility", "hidden", "important");
    }
  });
}

test("ZK-731B visible collection dressing agrees with text, ignores unrelated state, and follows custody", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await startDisplayFixture(page);

  const state = JSON.parse(await page.evaluate(() => window.render_game_to_text?.() ?? "{}"));
  expect(JSON.stringify(state)).not.toContain("UNREVEALED RIVAL VAULT");
  expect(state.playerPro.social.worldDisplay).toMatchObject({
    vehicle: { id: "zk731-roadster", category: "vehicle" },
    equipped: [
      { id: "zk731-bag", category: "bag" },
      { id: "zk731-outfit", category: "outfit" },
      { id: "zk731-watch", category: "watch" },
    ],
    collection: [
      { id: "zk731-trophy", category: "trophy" },
      { id: "zk731-keepsake", category: "keepsake" },
      { id: "zk731-stock", category: "plant-stock" },
    ],
  });
  const rendered = await page.evaluate(() => window.__coursecraftPixiTest!.playerProCollectionDisplay());
  expect(rendered.items.map((item) => item.label).sort()).toEqual([
    "player-pro-display:bag:zk731-bag",
    "player-pro-display:keepsake:zk731-keepsake",
    "player-pro-display:outfit:zk731-outfit",
    "player-pro-display:plant-stock:zk731-stock",
    "player-pro-display:trophy:zk731-trophy",
    "player-pro-display:vehicle:zk731-roadster",
    "player-pro-display:watch:zk731-watch",
  ]);
  expect(new Set(rendered.items.map((item) => `${item.x}:${item.y}`)).size).toBe(7);
  await captureCanvas(page, testInfo, "zk731-display-wide-owned");

  await page.evaluate(() => window.__coursecraftTest!.setPaintCash(123_456));
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().cash)).toBe(123_456);
  await page.waitForTimeout(100);
  expect((await page.evaluate(() => window.__coursecraftPixiTest!.playerProCollectionDisplay())).rebuilds).toBe(rendered.rebuilds);

  await page.evaluate(() => window.__coursecraftTest!.moveZk731DisplayVehicleToCustody());
  await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.playerProCollectionDisplay().items.length)).toBe(6);
  const settled = JSON.parse(await page.evaluate(() => window.render_game_to_text?.() ?? "{}"));
  expect(settled.playerPro.social.worldDisplay.vehicle).toBeNull();
  expect(settled.playerPro.social.custody).toEqual([
    expect.objectContaining({ itemName: "ZK-731 Roadster", status: "held" }),
  ]);
  expect((await page.evaluate(() => window.__coursecraftPixiTest!.playerProCollectionDisplay())).items.some((item) => item.label.includes("roadster"))).toBe(false);
  await captureCanvas(page, testInfo, "zk731-display-wide-custody");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.__coursecraftPixiTest!.focusTileForTest(5, 34, .9));
  await hideCanvasObstructions(page);
  await captureCanvas(page, testInfo, "zk731-display-mobile-custody");
  expect(errors).toEqual([]);
});
