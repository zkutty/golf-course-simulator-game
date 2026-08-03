import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const evidenceDir = path.join(process.cwd(), "artifacts", "zk-695", "playwright");
mkdirSync(evidenceDir, { recursive: true });
test.use({ hasTouch: true });

async function startCourse(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Quick Start/ }).click();
  await page.getByRole("button", { name: "Skip tutorial" }).click();
  await expect(page.getByTestId("design-dock")).toBeVisible();
}

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  expect(value).not.toBeNull();
  return value!;
}

function overlaps(a: Awaited<ReturnType<typeof box>>, b: Awaited<ReturnType<typeof box>>) {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

async function expectDockClear(page: Page) {
  const dock = await box(page.getByTestId("design-dock"));
  const navigation = await box(page.getByRole("navigation", { name: "Primary game workspaces" }));
  for (const persistent of [page.locator(".cc-live-controls"), page.locator(".cc-minimap")]) {
    if (await persistent.isVisible()) expect(overlaps(dock, await box(persistent))).toBe(false);
  }
  expect(overlaps(dock, navigation)).toBe(false);
  const viewport = page.viewportSize()!;
  expect(dock.x).toBeGreaterThanOrEqual(0);
  expect(dock.y).toBeGreaterThanOrEqual(0);
  expect(dock.x + dock.width).toBeLessThanOrEqual(viewport.width);
  expect(dock.y + dock.height).toBeLessThanOrEqual(viewport.height);
}

test("design dock clears persistent controls and preserves state across collapse and workspaces", async ({ page }) => {
  await startCourse(page);
  const dock = page.getByTestId("design-dock");
  await expect(dock).toHaveAttribute("data-collapsed", "true");
  await expectDockClear(page);
  await page.getByRole("button", { name: "Expand design dock" }).click();
  await expect(dock).toHaveAttribute("data-collapsed", "false");
  await expectDockClear(page);

  await page.getByTestId("design-tool-spline").click();
  await page.getByRole("tab", { name: "Nature" }).click();
  const natureItem = page.locator('[role="option"][aria-disabled="false"]').first();
  await natureItem.click();
  await expect(natureItem).toHaveAttribute("aria-selected", "true");

  const collapse = page.getByRole("button", { name: "Collapse design dock" });
  await collapse.focus();
  await page.keyboard.press("Space");
  await expect(dock).toHaveAttribute("data-collapsed", "true");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  const expand = page.getByRole("button", { name: "Expand design dock" });
  await expect(expand).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dock).toHaveAttribute("data-collapsed", "false");
  await expect(page.getByRole("tab", { name: "Nature" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("design-tool-spline")).toHaveAttribute("aria-pressed", "true");
  await expect(natureItem).toHaveAttribute("aria-selected", "true");

  await page.getByTestId("workspace-operate").click();
  await expect(dock).toHaveCount(0);
  await page.getByTestId("workspace-design").click();
  await expect(page.getByTestId("design-dock")).toBeVisible();
  await expect(page.getByTestId("design-dock")).toHaveAttribute("data-collapsed", "true");
  await page.getByRole("button", { name: "Expand design dock" }).click();
  await expect(page.getByRole("tab", { name: "Nature" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("design-tool-spline")).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Open pause menu" }).click();
  await expect(page.getByRole("dialog", { name: "Game paused" })).toBeVisible();
  await page.getByRole("button", { name: /Resume/ }).click();
  await expectDockClear(page);

  const editor = page.locator(".cc-sidebar-frame");
  await editor.getByRole("button", { name: "Hole Wizard" }).click();
  await expect(page.getByTestId("design-dock")).toHaveCount(0);
  expect(JSON.parse(await page.evaluate(() => window.render_game_to_text!())).editor.designDockVisible).toBe(false);
  await editor.getByRole("button", { name: "Design", exact: true }).click();
  await expect(page.getByTestId("design-dock")).toBeVisible();
  await expect(page.getByTestId("design-dock")).toHaveAttribute("data-collapsed", "true");
  await page.getByRole("button", { name: "Expand design dock" }).click();
  await expect(page.getByRole("tab", { name: "Nature" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("design-tool-spline")).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: path.join(evidenceDir, "desktop-expanded.png") });
});

test("narrow dock remains a bounded scrollable drawer with touch and keyboard affordances", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startCourse(page);
  await expect(page.getByTestId("design-dock")).toHaveAttribute("data-collapsed", "true");
  await expectDockClear(page);

  await page.getByRole("button", { name: "Expand design dock" }).tap({ timeout: 15_000 });
  await expect(page.locator(".cc-live-controls")).toBeHidden();
  await expect(page.locator(".cc-minimap")).toBeHidden();
  await expectDockClear(page);

  const palette = page.getByRole("listbox");
  await expect(palette).toBeVisible();
  const touchItem = palette.locator('[role="option"][aria-disabled="false"]').nth(1);
  await touchItem.tap({ timeout: 15_000 });
  await expect(touchItem).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "Collapse design dock" }).tap({ timeout: 15_000 });
  const expand = page.getByRole("button", { name: "Expand design dock" });
  await expect(expand).toBeVisible();
  await expand.focus();
  await page.keyboard.press("Enter");
  await expect(palette).toBeVisible();
  await expectDockClear(page);
  await page.screenshot({ path: path.join(evidenceDir, "narrow-expanded.png") });
});
