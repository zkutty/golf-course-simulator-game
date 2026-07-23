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
  await page.waitForTimeout(1_000);

  const desktop = await page.screenshot({ path: "artifacts/vision-page-desktop.png" });
  await testInfo.attach("vision-page-desktop", { body: desktop, contentType: "image/png" });

  await page.getByRole("link", { name: "The Systems" }).click();
  await expect(page.locator("#vision-systems")).toBeInViewport();
  await page.waitForTimeout(650);
  await page.screenshot({ path: "artifacts/vision-page-systems.png" });
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
  await page.waitForTimeout(1_000);

  const mobile = await page.screenshot({ path: "artifacts/vision-page-mobile.png" });
  await testInfo.attach("vision-page-mobile", { body: mobile, contentType: "image/png" });
  await page.locator("#vision-systems").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/vision-page-mobile-systems.png" });
});
