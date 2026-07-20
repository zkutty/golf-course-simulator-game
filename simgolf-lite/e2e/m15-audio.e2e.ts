import { expect, test } from "@playwright/test";

test("audio is lazy, mixer controls persist, and live play stays error-free", async ({ page }, testInfo) => {
  const audioRequests: string[] = [];
  const consoleErrors: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/audio/music/")) audioRequests.push(request.url());
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");
  await page.waitForTimeout(250);
  expect(audioRequests).toEqual([]);

  await page.getByRole("button", { name: "Options" }).click();
  await page.getByRole("tab", { name: "Audio" }).click();
  await expect(page.getByRole("slider", { name: "Master volume", exact: true })).toHaveValue("1");
  await expect(page.getByLabel("Mute in background")).toBeChecked();
  await expect.poll(() => audioRequests.length).toBeGreaterThan(0);
  expect(new Set(audioRequests.map((url) => url.split("?")[0])).size).toBe(1);

  await page.getByRole("slider", { name: "Master volume", exact: true }).fill("0.65");
  await page.getByRole("slider", { name: "Music volume", exact: true }).fill("0.35");
  await page.getByRole("slider", { name: "Sound effects", exact: true }).fill("0.45");
  await page.getByRole("slider", { name: "Ambience volume", exact: true }).fill("0.55");
  await page.getByRole("button", { name: "Test music" }).click();
  await page.getByRole("button", { name: "Test sound effects" }).click();
  await page.getByRole("button", { name: "Test ambience" }).click();
  await page.getByLabel("Mute all audio").check();
  await testInfo.attach("m15-audio-options", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await page.getByRole("button", { name: "Done" }).click();

  await page.reload();
  await page.getByRole("button", { name: "Options" }).click();
  await page.getByRole("tab", { name: "Audio" }).click();
  await expect(page.getByLabel("Mute all audio")).toBeChecked();
  await expect(page.getByRole("slider", { name: "Master volume", exact: true })).toHaveValue("0.65");
  await expect(page.getByRole("slider", { name: "Music volume", exact: true })).toHaveValue("0.35");
  await expect(page.getByRole("slider", { name: "Sound effects", exact: true })).toHaveValue("0.45");
  await expect(page.getByRole("slider", { name: "Ambience volume", exact: true })).toHaveValue("0.55");
  await page.getByLabel("Mute all audio").uncheck();
  await page.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Skip tutorial" }).click();
  await page.waitForTimeout(1200);
  await testInfo.attach("m15-live-course", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  expect(consoleErrors).toEqual([]);
});
