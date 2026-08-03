import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const evidenceDir = path.join(process.cwd(), "artifacts", "zk-694", "playwright");
mkdirSync(evidenceDir, { recursive: true });
test.use({ trace: "off" });

test("ZK-694 keeps Golfopedia text navigation tooltip-free with visible interaction states", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript(() => {
    localStorage.setItem("coursecraft_app_profile_v5", JSON.stringify({ version: 5, tutorialOffered: true }));
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Quick Start/ }).click();
  await page.getByRole("button", { name: /Help/ }).click();

  const fairway = page.getByRole("button", { name: "Fairway", exact: true });
  await fairway.hover();
  await page.waitForTimeout(600);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await fairway.focus();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(fairway).toHaveAttribute("aria-current", "page");
  await expect(fairway).toHaveCSS("border-left-width", "4px");

  const golfers = page.getByRole("tab", { name: "Golfers", exact: true });
  await golfers.hover();
  await page.waitForTimeout(600);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await golfers.focus();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await golfers.click();
  await expect(golfers).toHaveAttribute("aria-selected", "true");
  await expect(golfers).toHaveCSS("box-shadow", /rgb\(230, 188, 100\)/);

  const screenshot = await page.screenshot({ path: path.join(evidenceDir, "golfopedia-navigation-states.png"), fullPage: true });
  await testInfo.attach("golfopedia-navigation-states", { body: screenshot, contentType: "image/png" });
  expect(errors).toEqual([]);
});
