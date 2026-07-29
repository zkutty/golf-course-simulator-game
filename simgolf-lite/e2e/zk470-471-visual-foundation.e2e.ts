import { expect, test } from "@playwright/test";

function cameraState() {
  return JSON.parse(window.render_game_to_text?.() ?? "{}").camera;
}

test("ZK-471 keeps COZY play framing, Architect overview, and explicit overview controls reversible", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m20Fixture=1&m20Theme=parkland");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), {
    timeout: 90_000,
  }).toBe("game");

  const cozy = page.getByRole("button", { name: "Cozy", exact: true });
  const architect = page.getByRole("button", { name: "Architect", exact: true });
  await expect(cozy).toBeVisible();
  await expect(architect).toBeVisible();

  await cozy.click();
  await expect.poll(() => page.evaluate(cameraState)).toMatchObject({ viewMode: "COZY" });
  const cozyCamera = await page.evaluate(cameraState);

  await page.keyboard.press("f");
  await expect.poll(() => page.evaluate(cameraState)).toMatchObject({ viewMode: "COZY" });
  const overviewCamera = await page.evaluate(cameraState);
  expect(overviewCamera.zoom).toBeLessThanOrEqual(cozyCamera.zoom);
  expect(overviewCamera.visibleEstateBounds).toBeTruthy();

  await architect.click();
  await expect.poll(() => page.evaluate(cameraState)).toMatchObject({ viewMode: "ARCHITECT" });
  const architectCamera = await page.evaluate(cameraState);
  expect(architectCamera.zoom).toBeLessThanOrEqual(cozyCamera.zoom);

  const shot = await page.screenshot({ fullPage: true });
  await testInfo.attach("zk470-471-camera-overview", {
    body: shot,
    contentType: "image/png",
  });

  await cozy.click();
  await expect.poll(() => page.evaluate(cameraState)).toMatchObject({ viewMode: "COZY" });
  expect(errors).toEqual([]);
});
