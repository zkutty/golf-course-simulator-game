import { expect, test, type Page } from "@playwright/test";

async function enterSimulationFixture(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  const tutorial = page.getByRole("dialog", { name: "First-launch tutorial" });
  if (await tutorial.count()) await tutorial.getByRole("button", { name: "Skip tutorial" }).click();
  await page.evaluate(() => window.__coursecraftTest!.setZk689SimulationFixture());
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").systemControl?.profile)).toBe("simulation");
  await expect(page.getByTestId("seasons-legacy-panel")).toBeVisible();
}

async function openNavigator(page: Page) {
  let panel = page.getByTestId("seasons-legacy-panel");
  if (!await panel.count()) {
    await page.getByTestId("workspace-legacy").click();
    await page.getByTestId("open-seasons-legacy").click();
    panel = page.getByTestId("seasons-legacy-panel");
  }
  await panel.getByRole("button", { name: "Club identity", exact: true }).click();
  await expect(panel.getByTestId("simulation-operations")).toBeVisible();
  return panel;
}

test("ZK-689 Simulation exposes all thirteen responsibilities through existing specialist surfaces", async ({ page }, testInfo) => {
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await enterSimulationFixture(page);

  let panel = await openNavigator(page);
  await expect(panel.getByTestId("system-control-summary")).toContainText("Simulation · 0 automated · 13 direct");
  await expect(panel.locator("[data-testid^=simulation-operation-]")).toHaveCount(13);
  await expect(panel.locator('[data-evidence-kind="forecast"]')).not.toHaveCount(0);
  await expect(panel.locator('[data-evidence-kind="current"]')).not.toHaveCount(0);
  await expect(panel.locator('[data-evidence-kind="settled"]')).not.toHaveCount(0);
  expect(await page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return {
      profile: state.systemControl.profile,
      pressure: state.experience.economicPressure,
      systems: state.systemControl.systems.length,
      manual: state.systemControl.systems.filter((system: { mode: string }) => system.mode === "manual").length,
    };
  })).toEqual({ profile: "simulation", pressure: "balanced", systems: 13, manual: 13 });

  for (const system of ["localized-turf", "irrigation"] as const) {
    panel = await openNavigator(page);
    await panel.getByTestId(`system-operation-open-${system}`).click();
    await expect(panel.locator(`[data-operation-system="${system}"]`)).toBeFocused();
  }

  panel = await openNavigator(page);
  const drainage = panel.getByTestId("system-operation-open-drainage");
  await drainage.focus();
  await page.keyboard.press("Enter");
  await expect(panel.getByTestId("improve-drainage")).toBeVisible();
  await expect(panel.locator('[data-operation-system="drainage"]')).toBeFocused();

  panel = await openNavigator(page);
  await panel.getByTestId("system-operation-open-maintenance").click();
  await expect(page.getByTestId("management-maintenance-target")).toBeFocused();

  panel = await openNavigator(page);
  await panel.getByTestId("system-operation-open-staffing").click();
  let live = page.getByTestId("live-overview");
  await expect(live.getByRole("tab", { name: "Staff" })).toHaveAttribute("aria-selected", "true");
  await expect(live.locator('[data-testid^="staff-shift-controls-"]')).not.toHaveCount(0);
  await live.getByRole("button", { name: "Close live overview" }).click();
  await page.getByRole("button", { name: "Open live overview" }).click();
  live = page.getByTestId("live-overview");
  await expect(live.getByRole("tab", { name: "Golfers" })).toHaveAttribute("aria-selected", "true");
  panel = await openNavigator(page);
  await panel.getByTestId("system-operation-open-pace").click();
  live = page.getByTestId("live-overview");
  await expect(live.getByRole("tab", { name: "Pace" })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => live.getByTestId("pace-operations").evaluate((target) => target.contains(document.activeElement))).toBe(true);
  panel = await openNavigator(page);
  await panel.getByTestId("system-operation-open-mobility").click();
  live = page.getByTestId("live-overview");
  await expect(live.getByRole("tab", { name: "Mobility" })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => live.getByTestId("mobility-operations").evaluate((target) => target.contains(document.activeElement))).toBe(true);
  await live.getByRole("button", { name: "Close live overview" }).click();
  await page.getByRole("button", { name: "Open live overview" }).click();
  live = page.getByTestId("live-overview");
  await expect(live.getByRole("tab", { name: "Golfers" })).toHaveAttribute("aria-selected", "true");
  await live.getByRole("button", { name: "Close live overview" }).click();

  panel = await openNavigator(page);
  await panel.getByTestId("system-operation-open-pace").click();
  live = page.getByTestId("live-overview");
  await expect(live.getByRole("tab", { name: "Pace" })).toHaveAttribute("aria-selected", "true");
  await expect(live.getByTestId("pace-operations")).toBeVisible();
  await live.getByRole("button", { name: "Close live overview" }).click();

  panel = await openNavigator(page);
  await panel.getByTestId("system-operation-open-mobility").click();
  live = page.getByTestId("live-overview");
  await expect(live.getByRole("tab", { name: "Mobility" })).toHaveAttribute("aria-selected", "true");
  await expect(live.getByTestId("mobility-fleet-controls")).toBeVisible();
  await expect(live.getByTestId("mobility-current-day")).toContainText("Current observation");
  await expect(live.getByTestId("mobility-history-report")).toContainText("Settled history");
  await live.getByRole("button", { name: "Close live overview" }).click();

  for (const [system, tab] of [["memberships", "campus"], ["property", "campus"], ["resort", "resort"], ["community", "community"]] as const) {
    panel = await openNavigator(page);
    await panel.getByTestId(`system-operation-open-${system}`).click();
    const property = page.getByTestId("property-management-panel");
    await expect(property.getByTestId(`property-tab-${tab}`)).toHaveAttribute("aria-pressed", "true");
    if (system === "memberships") {
      const membership = property.getByTestId("membership-operations");
      const topTier = membership.getByRole("button", { name: "Top tier reached" });
      await expect(membership).toContainText("already at the top tier");
      await expect(membership).not.toContainText("Tier 5");
      await expect(topTier).toBeDisabled();
      const cashBeforeBlockedMembership = await page.evaluate(() => window.__coursecraftTest!.state().cash);
      let membershipDialogs = 0;
      const countMembershipDialog = async (dialog: import("@playwright/test").Dialog) => { membershipDialogs++; await dialog.dismiss(); };
      page.on("dialog", countMembershipDialog);
      await topTier.evaluate((button: HTMLButtonElement) => button.click());
      expect(membershipDialogs).toBe(0);
      expect(await page.evaluate(() => window.__coursecraftTest!.state().cash)).toBe(cashBeforeBlockedMembership);
      page.off("dialog", countMembershipDialog);
    }
    await property.getByRole("button", { name: "Close property management", exact: true }).click();
  }

  panel = await openNavigator(page);
  await panel.getByTestId("system-operation-open-tournaments").click();
  const tournaments = page.getByTestId("tournament-panel");
  await expect(tournaments).toBeFocused();
  await tournaments.getByTestId("tournament-tier").selectOption("championship");
  await expect(tournaments.getByTestId("tournament-readiness").locator("li").filter({ hasText: "✕" }).first()).toBeVisible();
  const beforeBlockedTournament = await page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return { cash: state.economy.cash, scheduled: state.tournament.scheduled };
  });
  let tournamentDialogs = 0;
  const countTournamentDialog = async (dialog: import("@playwright/test").Dialog) => { tournamentDialogs++; await dialog.dismiss(); };
  page.on("dialog", countTournamentDialog);
  await tournaments.getByTestId("schedule-tournament").click();
  await expect(tournaments.getByRole("status")).toContainText("Not eligible:");
  expect(tournamentDialogs).toBe(0);
  expect(await page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return { cash: state.economy.cash, scheduled: state.tournament.scheduled };
  })).toEqual(beforeBlockedTournament);
  page.off("dialog", countTournamentDialog);
  await tournaments.getByRole("button", { name: "Close tournaments" }).click();

  panel = await openNavigator(page);
  await panel.getByTestId("simulation-operation-community").scrollIntoViewIfNeeded();
  const shot = await page.screenshot({ path: testInfo.outputPath("zk689-simulation-responsibility.png"), fullPage: true });
  await testInfo.attach("zk689-simulation-responsibility", { body: shot, contentType: "image/png" });

  await page.evaluate(() => window.__coursecraftTest!.setZk689SimulationFixture());
  await expect(page.getByTestId("seasons-legacy-panel")).toBeVisible();
  await page.getByTestId("seasons-legacy-panel").getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() => window.__coursecraftTest!.showZk688AdvisorMessage("pricing"));
  const beforeAdvisorNavigation = await page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return {
      cash: state.economy.cash,
      manual: state.systemControl.systems.filter((system: { mode: string }) => system.mode === "manual").length,
      overrides: state.systemControl.systems.filter((system: { override: boolean }) => system.override).length,
    };
  });
  await page.getByTestId("advisor-open-management").click();
  await expect(page.getByTestId("management-pricing-target")).toBeFocused();
  expect(await page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return {
      cash: state.economy.cash,
      manual: state.systemControl.systems.filter((system: { mode: string }) => system.mode === "manual").length,
      overrides: state.systemControl.systems.filter((system: { override: boolean }) => system.override).length,
    };
  })).toEqual(beforeAdvisorNavigation);
  expect(errors).toEqual([]);
});

test("ZK-689 confirmations, staff shifts, mobility policy, and reload preserve one authoritative result", async ({ page }, testInfo) => {
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await enterSimulationFixture(page);

  let panel = await openNavigator(page);
  await panel.getByTestId("system-operation-open-staffing").click();
  let live = page.getByTestId("live-overview");
  const shift = live.locator('[data-testid^="staff-shift-controls-"]').first();
  await shift.locator('input[type="time"]').nth(0).fill("08:30");
  await shift.locator('input[type="time"]').nth(1).fill("17:00");
  await shift.getByRole("button", { name: "Apply shift" }).click();
  await expect(live.locator('[data-testid^="staff-shift-"]:not([data-testid="staff-shift-readonly"]):not([data-testid^="staff-shift-controls-"])').first()).toContainText("8:30 AM–5:00 PM");
  await live.getByRole("button", { name: "Close live overview" }).click();

  panel = await openNavigator(page);
  await panel.getByTestId("system-operation-open-mobility").click();
  live = page.getByTestId("live-overview");
  const product = live.locator('[data-testid*="-pushcart"]').first();
  const cashBefore = await page.evaluate(() => window.__coursecraftTest!.state().cash);
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Forecast capacity");
    await dialog.accept();
  });
  await product.getByRole("button", { name: /Buy 1/ }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().cash)).toBeLessThan(cashBefore);
  const cashAfterPurchase = await page.evaluate(() => window.__coursecraftTest!.state().cash);
  page.once("dialog", async (dialog) => dialog.dismiss());
  await product.getByRole("button", { name: /Buy 1/ }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().cash)).toBe(cashAfterPurchase);

  const price = product.locator('input[type="number"]');
  await price.fill("37");
  await product.getByRole("button", { name: "Apply standing policy" }).click();
  await expect(product).toContainText("$37");
  await live.getByRole("button", { name: "Close live overview" }).click();

  panel = await openNavigator(page);
  await panel.getByTestId("system-operation-open-financing").click();
  const financeCash = await page.evaluate(() => window.__coursecraftTest!.state().cash);
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toMatch(/each week|weekly/);
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: /Bridge Loan/ }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().cash)).toBe(financeCash);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("pause-overlay")).toBeVisible();
  await page.getByRole("button", { name: /save game/i }).click();
  await page.getByPlaceholder("New save name…").fill("ZK-689 operations");
  await page.getByRole("button", { name: "Save to new slot" }).click();
  await expect(page.getByText("ZK-689 operations")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().dirty)).toBe(false);
  await page.reload();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").systemControl.profile)).toBe("simulation");

  await page.getByRole("button", { name: "Open live overview" }).click();
  live = page.getByTestId("live-overview");
  await live.getByRole("tab", { name: "Staff" }).click();
  await expect(live.getByText("Shift 8:30 AM–5:00 PM")).toBeVisible();
  await live.getByRole("tab", { name: "Mobility" }).click();
  await expect(live.locator('[data-testid*="-pushcart"]').first()).toContainText("$37");
  await expect(live.locator('[data-testid*="-pushcart"]').first()).toContainText(/1\/\d+ fleet units/);
  const shot = await page.screenshot({ path: testInfo.outputPath("zk689-mobility-reload.png"), fullPage: true });
  await testInfo.attach("zk689-mobility-reload", { body: shot, contentType: "image/png" });
  expect(errors).toEqual([]);
});
