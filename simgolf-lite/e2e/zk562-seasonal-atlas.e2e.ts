import { expect, test } from "@playwright/test";

test("Pixi requests the current season and a missing optional overlay preserves the base", async ({ page }, testInfo) => {
  const errors: string[] = [];
  const overlayRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.route("**/atlases/biomes/manifest.json", async (route) => {
    const response = await route.fetch();
    const manifest = await response.json();
    const seasonal = manifest.biomes.parkland.high.seasonal;
    for (const season of ["spring", "winter"]) {
      seasonal[season] = {
        materials: {
          fairway: {
            image: `seasonal-missing-${season}.123456789abc.png`,
            bytes: 1,
            width: 1,
            height: 1,
          },
        },
        props: null,
        decals: null,
      };
    }
    await route.fulfill({ response, json: manifest });
  });
  await page.route("**/seasonal-missing-*.png", async (route) => {
    overlayRequests.push(route.request().url());
    await route.fulfill({ status: 404, contentType: "text/plain", body: "optional overlay absent" });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  // Seasonal overlays are intentionally absent from the Low atlas contract.
  // Select the same High tier whose manifest entries this fixture replaces,
  // independent of the hosted runner's adaptive hardware classification.
  await page.addInitScript(() => {
    localStorage.setItem("coursecraft_app_profile_v5", JSON.stringify({
      version: 5,
      graphics: { quality: "high" },
    }));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  const tutorial = page.getByRole("dialog", { name: "First-launch tutorial" });
  if (await tutorial.count()) await tutorial.getByRole("button", { name: "Skip tutorial" }).click();

  const canvas = page.locator(".cc-pixi-stage canvas");
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return { season: state.seasons?.calendar?.season, quality: state.graphics?.quality };
  })).toEqual({ season: "spring", quality: "high" });
  await expect.poll(() => overlayRequests.some((url) => url.includes("seasonal-missing-spring"))).toBe(true);
  await expect(canvas).toBeVisible();

  // The production M39 fixture advances the same world-owned calendar to
  // winter. This must invalidate the Pixi atlas effect without duplicating
  // season state in the renderer.
  await page.evaluate(() => window.__coursecraftTest!.setM39Fixture());
  await expect.poll(() => page.evaluate(() => (
    JSON.parse(window.render_game_to_text?.() ?? "{}").seasons?.calendar?.season
  ))).toBe("winter");
  await expect.poll(() => overlayRequests.some((url) => url.includes("seasonal-missing-winter"))).toBe(true);
  await expect(canvas).toBeVisible();

  const screenshot = await page.screenshot({
    path: "artifacts/zk-562/seasonal-missing-overlay-base.png",
    fullPage: true,
  });
  await testInfo.attach("seasonal-missing-overlay-base", { body: screenshot, contentType: "image/png" });
  expect(errors).toEqual([]);
});
