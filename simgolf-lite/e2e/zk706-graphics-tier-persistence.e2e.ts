import { expect, test, type Page } from "@playwright/test";

type FixtureQuality = "low" | "medium";

const fixtureUrl = (quality: FixtureQuality) =>
  `/?m53Fixture=1&m53Theme=desert&m53Season=winter&m53Weather=storm&m53Rotation=0&m53Quality=${quality}`;

async function graphicsState(page: Page) {
  return page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return {
      fixture: state.seasons?.presentation?.terrain?.quality,
      renderer: state.graphics?.quality,
      atlas: state.graphics?.atlas,
      rotation: state.camera?.rotation,
    };
  });
}

async function expectSelectedTier(page: Page, quality: FixtureQuality, rotation: number) {
  await expect.poll(() => graphicsState(page), { timeout: 120_000 }).toMatchObject({
    fixture: quality,
    renderer: quality,
    atlas: quality,
    rotation,
  });
}

test("ZK-706 keeps explicit M53 fixture tiers through camera interaction, profile reconciliation, and renderer remount", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });

  for (const quality of ["low", "medium"] as const) {
    // The fixture must remain an explicit runtime selection even when the
    // persisted player profile asks for a different tier.
    await page.addInitScript(() => {
      localStorage.setItem("coursecraft_app_profile_v5", JSON.stringify({
        version: 5,
        graphics: { quality: "high" },
      }));
    });
    await page.goto(fixtureUrl(quality));
    await expectSelectedTier(page, quality, 0);

    const canvas = page.locator(".cc-pixi-stage canvas");
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(box!.x + box!.width * .55, box!.y + box!.height * .45);
    await page.mouse.wheel(0, -440);
    await page.mouse.wheel(0, 260);
    await expectSelectedTier(page, quality, 0);

    await page.mouse.move(box!.x + box!.width * .52, box!.y + box!.height * .5);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(box!.x + box!.width * .62, box!.y + box!.height * .56);
    await page.mouse.up({ button: "middle" });
    await expectSelectedTier(page, quality, 0);

    await page.keyboard.press("e");
    await expectSelectedTier(page, quality, 90);
    await page.keyboard.press("f");
    await expectSelectedTier(page, quality, 90);

    // This is the profile-change event that previously allowed the persisted
    // High preference to replace the M53 fixture after camera interaction.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("coursecraft-profile-change")));
    await expectSelectedTier(page, quality, 90);

    // A reload remounts Pixi and its renderer/atlas selection from the same
    // fixture URL, which must still outrank the stored player profile.
    await page.reload();
    await expectSelectedTier(page, quality, 0);
  }

  expect(errors).toEqual([]);
});
