import { expect, test } from "@playwright/test";
import { waitForLegacyBiomeFixture } from "./legacy-biome-fixture";

test("M22 structures, furniture, crossings, rotations, and editor controls", async ({ page }, testInfo) => {
  const errors: string[] = [];
  const failedAssets: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", (response) => { if (response.status() >= 400 && /atlases|assets/.test(response.url())) failedAssets.push(`${response.status()} ${response.url()}`); });
  await page.setViewportSize({ width: 1440, height: 900 });
  const themeCaptures: Buffer[] = [];
  for (const theme of ["parkland", "links", "desert"] as const) {
    await page.goto(`/?m22Fixture=1&m22Theme=${theme}`);
    await waitForLegacyBiomeFixture(page, {
      theme,
      courseName: `M22 ${theme} Visual Release Club`,
      decorationCount: 11,
    });
    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.theme)).toBe(theme);
    const state = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
    expect(state.course.decorations).toHaveLength(11);
    expect(new Set(state.course.decorations.map((decoration: { kind: string }) => decoration.kind))).toEqual(new Set(["fence", "bench", "tee_sign", "lamp", "bin", "parked_cart", "flower_bed", "planter", "ornamental_feature", "bridge", "boardwalk"]));
    const canvas = page.locator(".cc-pixi-stage canvas");
    await expect(canvas).toBeVisible();
    for (const rotation of [0, 90, 180, 270]) {
      if (rotation > 0) await page.keyboard.press("e");
      await expect(page.getByLabel(`View bearing ${rotation} degrees`)).toHaveCount(1);
      const shot = await canvas.screenshot({ path: `artifacts/m22-${theme}-${rotation}.png` });
      await testInfo.attach(`${theme}-${rotation}`, { body: shot, contentType: "image/png" });
      if (rotation === 0) themeCaptures.push(shot);
    }
  }
  expect(themeCaptures[0].equals(themeCaptures[1])).toBe(false);
  expect(themeCaptures[1].equals(themeCaptures[2])).toBe(false);

  await page.getByTestId("decor-tool").click();
  await expect(page.getByTestId("decor-kind-bridge")).toBeVisible();
  await page.getByTestId("decor-kind-boardwalk").click();
  await page.getByTestId("decor-action-rotate").click();
  await page.getByTestId("decor-action-remove").click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").editor?.decorationAction)).toBe("remove");
  expect(failedAssets).toEqual([]);
  expect(errors).toEqual([]);
});
