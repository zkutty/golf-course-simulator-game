import { expect, test } from "@playwright/test";

test("ZK-376 contextual inspector keeps summaries concise and routes to detail surfaces", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m20Fixture=1");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 120_000 }).toBe("game");

  await page.getByTestId("open-contextual-inspector").click();
  const inspectTrigger = page.getByTestId("open-contextual-inspector");
  await expect(inspectTrigger.locator("svg[aria-hidden='true']")).toHaveCount(1);
  await expect(inspectTrigger).not.toContainText("⌖");
  const inspector = page.getByTestId("contextual-inspector");
  await expect(inspector).toBeVisible();
  await expect(inspector).toHaveAttribute("aria-labelledby", "contextual-inspector-title");
  await expect(inspector).toHaveAttribute("aria-describedby", "contextual-inspector-description");
  await expect(inspector.getByRole("tab", { name: "Course" })).toHaveAttribute("aria-selected", "true");
  await expect(inspector).toContainText("Course inspector");
  await expect(inspector).toContainText("Open holes");
  const closeButton = inspector.getByRole("button", { name: "Close contextual inspector" });
  await expect(closeButton.locator("svg[aria-hidden='true']")).toHaveCount(1);
  await expect(closeButton).not.toContainText("×");
  await expect(inspector.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "contextual-inspector-tab-course");
  await page.screenshot({ path: "artifacts/zk376-contextual-inspector-open.png", fullPage: true });
  await inspector.getByRole("button", { name: "Architect view" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").workspace)).toBe("design");

  await inspector.getByRole("tab", { name: "Operations" }).click();
  await expect(inspector).toContainText("Operations inspector");
  await inspector.getByRole("button", { name: "Balanced" }).click();
  await expect(inspector).toContainText("Recommended pace preset");

  await inspector.getByRole("tab", { name: "Property" }).click();
  await expect(inspector).toContainText("Property inspector");
  await inspector.getByRole("button", { name: "Open details" }).click();
  await expect(page.getByTestId("property-management-panel")).toBeVisible();
  await page.screenshot({ path: "artifacts/zk376-contextual-inspector.png", fullPage: true });

  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  expect(errors).toEqual([]);
});

test("ZK-377 workspace chrome remains labelled and contained in the pseudo locale", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("coursecraft_locale", "pseudo"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?m20Fixture=1");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 120_000 }).toBe("game");
  await expect(page.locator("html")).toHaveAttribute("data-locale", "pseudo");

  await page.getByTestId("open-contextual-inspector").click();
  const inspector = page.getByTestId("contextual-inspector");
  await expect(inspector).toBeVisible();
  await expect(inspector.locator(".cc-inspector-icon-button")).toHaveAttribute("aria-label", /^⟦.+ ···⟧$/);
  const bounds = await inspector.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
