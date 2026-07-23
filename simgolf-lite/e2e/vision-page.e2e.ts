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
  await expect(page.getByRole("heading", { name: "Take every shot" })).toBeVisible();
  await expect(page.getByText("Windows · macOS · Steam Cloud · Workshop · save-compatible demo")).toBeVisible();
  await page.getByRole("heading", { name: "Own a game made to last" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/vision-page-player-pro-grid.png" });
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
  await page.getByRole("heading", { name: "Know who walks the course" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/vision-page-mobile-player-pro-grid.png" });
});
