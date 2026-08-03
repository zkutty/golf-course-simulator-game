import { expect, test } from "@playwright/test";

test("shareable vision page links from the title screen and tells the full story", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  await page.getByRole("button", { name: /The Vision/ }).click();
  await expect(page).toHaveURL(/[?&]view=vision/);
  await expect(page.getByTestId("vision-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Build the course. Shape the world." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Systems that meet on the course." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Play the course you imagined." })).toBeVisible();
  await page.waitForTimeout(1_000);

  const desktop = await page.screenshot({ path: "artifacts/vision-page-desktop.png" });
  await testInfo.attach("vision-page-desktop", { body: desktop, contentType: "image/png" });

  await page.getByRole("link", { name: "The Systems" }).click();
  await expect(page.locator("#vision-systems")).toBeInViewport();
  await page.waitForTimeout(650);
  await page.screenshot({ path: "artifacts/vision-page-systems.png" });
  await page.getByRole("link", { name: "Play It" }).click();
  await expect(page.locator("#vision-play")).toBeInViewport();
  await page.locator("#vision-play").evaluate((element) => {
    const scroller = element.closest(".cc-vision");
    if (scroller instanceof HTMLElement) {
      scroller.style.scrollBehavior = "auto";
      scroller.scrollTop += element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 72;
    }
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "artifacts/vision-page-player-pro-intro.png" });
  await expect(page.getByRole("heading", { name: "Step onto your own fairways" })).toBeVisible();
  await expect(page.getByText("Player Pro · matches · tournaments · growth")).toBeVisible();
  await page.getByRole("heading", { name: "Build a story only you could tell" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/vision-page-player-pro-grid.png" });
  const landscapesLink = page.getByRole("link", { name: "The Landscapes" });
  await landscapesLink.focus();
  await expect(landscapesLink).toBeFocused();
  await landscapesLink.press("Enter");
  await expect(page.locator("#vision-biomes")).toBeInViewport();
  await expect(page.getByRole("heading", { name: "Every landscape asks a different question." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The CourseCraft foundations" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "More ways to make a course" })).toBeVisible();
  await expect(page.locator(".cc-vision-biome")).toHaveCount(8);
  await expect(page.locator('[data-biome-collection="core"] .cc-vision-biome')).toHaveCount(3);
  await expect(page.locator('[data-biome-collection="expanded"] .cc-vision-biome')).toHaveCount(5);
  await expect(page.locator('[data-biome-id="parkland"]')).toContainText("Parkland");
  await expect(page.locator('[data-biome-id="links"]')).toContainText("Links");
  await expect(page.locator('[data-biome-id="desert"]')).toContainText("Desert");
  await expect(page.locator('[data-biome-id="parkland"] img')).toHaveAttribute("alt", /pond, mature trees/i);
  await expect(page.locator('[data-biome-id="links"] img')).toHaveAttribute("alt", /exposed coast with dunes/i);
  await expect(page.locator('[data-biome-id="desert"] img')).toHaveAttribute("alt", /cacti, rocky native planting/i);
  expect(await page.locator(".cc-vision-biome img").evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0))).toBe(true);
  await page.screenshot({ path: "artifacts/vision-page-biomes.png" });
  await page.locator('[data-biome-collection="expanded"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/vision-page-biomes-expanded-desktop.png" });
  await page.getByRole("link", { name: "The World" }).click();
  await expect(page.locator("#vision-world")).toBeInViewport();
  await page.waitForTimeout(650);
  await page.screenshot({ path: "artifacts/vision-page-clubhouse.png" });
  await page.getByRole("button", { name: "Back to game" }).first().click();
  await expect(page).not.toHaveURL(/[?&]view=vision/);
  await expect(page.getByRole("button", { name: /The Vision/ })).toBeVisible();

  await page.goto("/?view=vision");
  await expect(page.getByTestId("vision-page")).toBeVisible();
  expect(errors).toEqual([]);
});

test("vision page remains readable on a phone-sized viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?view=vision");
  await expect(page.getByRole("heading", { name: "Build the course. Shape the world." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Buildings with a job to do." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Play the course you imagined." })).toBeVisible();
  await page.waitForTimeout(1_000);

  const mobile = await page.screenshot({ path: "artifacts/vision-page-mobile.png" });
  await testInfo.attach("vision-page-mobile", { body: mobile, contentType: "image/png" });
  await page.locator("#vision-systems").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/vision-page-mobile-systems.png" });
  await page.locator("#vision-play").evaluate((element) => {
    const scroller = element.closest(".cc-vision");
    if (scroller instanceof HTMLElement) {
      scroller.style.scrollBehavior = "auto";
      scroller.scrollTop += element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 64;
    }
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "artifacts/vision-page-mobile-player-pro-intro.png" });
  await page.getByRole("heading", { name: "Every landscape asks a different question." }).scrollIntoViewIfNeeded();
  await expect(page.locator(".cc-vision-biome")).toHaveCount(8);
  await expect(page.locator('[data-biome-collection="core"] .cc-vision-biome')).toHaveCount(3);
  await expect(page.locator('[data-biome-collection="expanded"] .cc-vision-biome')).toHaveCount(5);
  await page.screenshot({ path: "artifacts/vision-page-mobile-biomes.png" });
  await page.locator('[data-biome-collection="expanded"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/vision-page-biomes-expanded-mobile.png" });
  await page.screenshot({ path: "artifacts/vision-page-mobile-player-pro-grid.png" });
});

test("vision biome catalog stays complete and readable at a tablet breakpoint", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 820, height: 900 });
  await page.goto("/?view=vision");
  await page.locator("#vision-biomes").scrollIntoViewIfNeeded();
  await expect(page.locator(".cc-vision-biome")).toHaveCount(8);
  expect(await page.locator('[data-biome-id]').evaluateAll((cards) =>
    cards.map((card) => card.getAttribute("data-biome-id")),
  )).toEqual(["parkland", "links", "desert", "tropical-coastal-resort", "temperate-japan", "alpine-mountain", "heathland", "australian-sandbelt"]);
  await page.locator('[data-biome-collection="expanded"]').scrollIntoViewIfNeeded();
  const tablet = await page.screenshot({ path: "artifacts/vision-page-biomes-expanded-tablet.png" });
  await testInfo.attach("vision-page-biomes-tablet", { body: tablet, contentType: "image/png" });
});
