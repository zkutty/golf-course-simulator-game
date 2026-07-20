import { expect, test } from "@playwright/test";

test("M20 surfaces, editor catalog, themes, rotations, and zoom detail", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });

  for (const theme of ["parkland", "links", "desert"] as const) {
    await page.goto(`/?m20Fixture=1&m20Theme=${theme}`);
    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.name)).toBe(`M20 ${theme} Terrain Laboratory`);
    const state = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
    expect(Object.keys(state.course.terrainCounts).sort()).toEqual(["deep_rough", "fairway", "green", "path", "rough", "sand", "tee", "waste_area", "water", "wetland"].sort());

    const canvas = page.locator(".cc-pixi-stage canvas");
    await expect(canvas).toBeVisible();
    if (theme === "parkland") {
      await expect(page.getByText("Playing surfaces", { exact: true })).toBeVisible();
      await expect(page.getByText("Hazards", { exact: true })).toBeVisible();
      await expect(page.getByText("Natural ground", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "waste_area", exact: true }).click();
      await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").editor?.selectedTerrain)).toBe("waste_area");
      await page.getByRole("button", { name: "wetland", exact: true }).click();
      await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").editor?.selectedTerrain)).toBe("wetland");
    }

    for (const rotation of [0, 90, 180, 270]) {
      if (rotation > 0) await page.keyboard.press("e");
      await expect(page.getByLabel(`View bearing ${rotation} degrees`)).toHaveCount(1);
      const shot = await canvas.screenshot({ path: `artifacts/m20-${theme}-${rotation}.png` });
      await testInfo.attach(`${theme}-${rotation}`, { body: shot, contentType: "image/png" });
    }
    // Fit overview, then zoom close enough to retain tier-2 micro-detail.
    await page.keyboard.press("f");
    await canvas.hover();
    await page.mouse.wheel(0, -1400);
    const detail = await canvas.screenshot({ path: `artifacts/m20-${theme}-detail.png` });
    await testInfo.attach(`${theme}-detail`, { body: detail, contentType: "image/png" });
  }
  expect(errors).toEqual([]);
});
