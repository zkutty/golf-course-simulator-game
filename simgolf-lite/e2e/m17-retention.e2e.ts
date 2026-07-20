import { expect, test } from "@playwright/test";

test("M17 records, achievements, ticker, photo mode, and PWA identity", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/");

  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBeTruthy();
  expect(await manifest.json()).toMatchObject({ name: "CourseCraft", display: "standalone", orientation: "landscape" });

  await page.getByRole("button", { name: "Trophy Gallery" }).click();
  await expect(page.getByTestId("retention-hub")).toBeVisible();
  await page.getByRole("button", { name: "Achievements" }).click();
  await expect(page.locator("article[data-earned]")).toHaveCount(25);
  await page.screenshot({ fullPage: true, path: "artifacts/m17-achievements.png" });
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  await page.getByRole("button", { name: "Skip tutorial" }).click();
  await page.getByRole("button", { name: /Records/ }).click();
  await expect(page.getByRole("button", { name: "Course History" })).toBeVisible();
  await page.getByRole("button", { name: "Records", exact: true }).click();
  const recordsShot = await page.screenshot({ fullPage: true, path: "artifacts/m17-records.png" });
  await testInfo.attach("m17-records", { body: recordsShot, contentType: "image/png" });
  await page.getByRole("button", { name: "Close" }).click();

  const before = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera.center);
  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("p");
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("course.png");
  await expect(page.getByTestId("photo-mode")).toBeVisible();
  const photoShot = await page.screenshot({ fullPage: true, path: "artifacts/m17-photo-mode.png" });
  await testInfo.attach("m17-photo-mode", { body: photoShot, contentType: "image/png" });
  await page.keyboard.press("p");
  await expect(page.getByTestId("photo-mode")).toBeHidden();
  const after = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera.center);
  expect(after).toEqual(before);
  expect(errors).toEqual([]);
});
