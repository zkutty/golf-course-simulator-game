import { expect, test } from "@playwright/test";

test("pseudo locale brackets shell, options, game, and pause copy and persists", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.removeItem("coursecraft_locale");
    localStorage.removeItem("coursecraft_app_profile_v5");
    localStorage.removeItem("coursecraft_app_profile_v4");
  });
  await page.reload();

  await page.getByRole("button", { name: "Options" }).click();
  await page.getByRole("tab", { name: "Accessibility" }).click();
  await page.getByLabel("Language preview").selectOption("pseudo");

  await expect(page.locator("html")).toHaveAttribute("data-locale", "pseudo");
  await expect(page.getByRole("dialog")).toContainText("⟦Ôptïôñs");
  await expect(page.getByRole("dialog")).toContainText("⟦Láñgüágë prëvïëw");
  await testInfo.attach("pseudo-options", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  await page.getByRole("button", { name: /Dôñë/ }).click();
  await expect(page.getByRole("button", { name: /Qüïçk Stárt/ })).toBeVisible();
  await page.getByRole("button", { name: /Qüïçk Stárt/ }).click();
  if (await page.getByRole("dialog", { name: /Fïrst-láüñçh tütôrïál/ }).count()) await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Ôpëñ páüsë mëñü/ }).click();
  await expect(page.getByRole("dialog", { name: /Gámë páüsëd/ })).toBeVisible();
  await expect(page.getByRole("dialog", { name: /Gámë páüsëd/ })).toContainText("⟦Ësç rësümës");
  await testInfo.attach("pseudo-pause", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  await page.getByRole("button", { name: /Ôptïôñs/ }).click();
  await page.getByRole("tab", { name: /Áççëssïbïlïtÿ/ }).click();
  await page.getByLabel(/Láñgüágë prëvïëw/).selectOption("en");
  await expect(page.getByTestId("options-screen")).toContainText("Options");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-locale", "en");
});
