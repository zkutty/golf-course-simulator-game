import { expect, test } from "@playwright/test";

test("M51 mobility surfaces are reachable, localized, and machine-accessible", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m30Fixture=1");
  await expect.poll(
    () => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.name),
    { timeout: 45_000 },
  ).toBe("M26 Twin Courses Estate");

  await page.evaluate(() => window.__coursecraftTest!.takeSystemControl("mobility"));
  await page.getByRole("button", { name: "Open live overview" }).click();
  const overview = page.getByTestId("live-overview");
  await overview.getByRole("tab", { name: "Mobility" }).click();
  await expect(overview.getByTestId("mobility-operations")).toBeVisible();
  await expect(overview.getByTestId("mobility-current-day")).toContainText("Current day");
  await expect(overview.getByTestId("mobility-demand-state")).toContainText("Demand:");
  await overview.getByLabel("Period").selectOption("28");
  await expect(overview.getByTestId("mobility-history-report")).toContainText(/28-day|No observed/);

  await page.getByRole("button", { name: "Close live overview" }).click();

  await page.getByTestId("open-architecture-review").click();
  const architecture = page.getByTestId("architecture-review");
  await expect(architecture).toHaveAttribute("role", "dialog");
  await expect(architecture).toHaveAttribute("aria-labelledby", "architecture-review-title");
  const mobilityOverlay = architecture.getByTestId("architecture-overlay-mobility");
  await expect(mobilityOverlay).toHaveAttribute("aria-pressed", "false");
  await mobilityOverlay.click();
  await expect(mobilityOverlay).toHaveAttribute("aria-pressed", "true");
  const mode = architecture.getByTestId("architecture-mobility-mode");
  await expect(mode).toBeVisible();
  await mode.selectOption("riding_cart");
  await expect(architecture.getByTestId("architecture-mobility-summary")).toContainText("riding_cart");
  await expect.poll(
    () => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").architectureReview?.overlay?.kind),
  ).toBe("mobility");

  await page.evaluate(() => localStorage.setItem("coursecraft_locale", "pseudo"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-locale", "pseudo");
  await page.getByTestId("open-architecture-review").click();
  await expect(page.getByTestId("architecture-overlay-mobility")).toContainText(/^⟦/);
  expect(errors).toEqual([]);
});
