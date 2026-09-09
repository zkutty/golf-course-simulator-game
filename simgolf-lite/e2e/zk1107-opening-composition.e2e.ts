import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`ZK-1107 opening controls and composition at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.getByRole("button", { name: /First-hole operator demo/ }).click();
    const card = page.getByTestId("tutorial-card");
    const action = page.getByRole("button", { name: "Start designing", exact: true });
    await expect(action).toBeVisible();
    await expect(page.locator(".cc-pixi-stage canvas")).toBeVisible({ timeout: 60_000 });
    await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest?.viewport()), { timeout: 60_000 });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(action).toBeFocused();
    const shell = page.locator(".cc-app");
    await expect(shell).toHaveCSS("--ui-focus", "#0b67a3");
    // Pointer-driven entry focuses the guide without requesting a keyboard
    // ring. Establish keyboard modality before checking :focus-visible.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(action).toBeFocused();
    await expect(page.locator(":focus-visible")).toHaveCount(1);
    const bounds = await card.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(await card.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    if (viewport.width < 600) {
      expect(bounds!.height).toBeLessThan(350);
      const course = await page.locator(".cc-course-pane").boundingBox();
      expect(course!.height).toBeGreaterThan(400);
      const controls = await page.locator(".cc-live-controls").boundingBox();
      expect(controls!.width).toBeGreaterThan(280);
      expect(controls!.height).toBeLessThan(210);
    }
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tutorial-overlay")).toHaveAttribute("data-step-id", "paint-fairway");
    await expect(page.getByTestId("tutorial-primary-action")).toBeDisabled();
    await expect(page.getByTestId("design-dock")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus-visible")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: `artifacts/zk-1107/target/authoring-${viewport.width}x${viewport.height}.png` });
    expect(errors).toEqual([]);
  });
}
