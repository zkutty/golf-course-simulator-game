import { expect, test, type Page } from "@playwright/test";

async function enterClassicFixture(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  const tutorial = page.getByRole("dialog", { name: "First-launch tutorial" });
  if (await tutorial.count()) await tutorial.getByRole("button", { name: "Skip tutorial" }).click();
  await page.evaluate(() => window.__coursecraftTest!.setZk688ClassicFixture());
}

async function openSystemControlPanel(page: Page) {
  await page.getByTestId("workspace-legacy").click();
  await page.getByTestId("open-seasons-legacy").click();
  const panel = page.getByTestId("seasons-legacy-panel");
  await panel.getByRole("button", { name: "Club identity", exact: true }).click();
  await panel.getByText("Manual system overrides", { exact: true }).click();
  return panel;
}

type ManagementFocusEvent = { target: "pricing" | "maintenance"; nonce: number };

async function recordManagementFocusEvents(page: Page) {
  await page.evaluate(() => {
    const testWindow = window as typeof window & { __zk688ManagementFocusEvents?: ManagementFocusEvent[] };
    testWindow.__zk688ManagementFocusEvents = [];
    document.addEventListener("focusin", (event) => {
      const input = event.target instanceof HTMLInputElement ? event.target : null;
      const target = input?.dataset.testid?.match(/^management-(pricing|maintenance)-target$/)?.[1];
      const nonce = Number(input?.closest<HTMLElement>(".cc-hud")?.dataset.managementFocusNonce);
      if ((target === "pricing" || target === "maintenance") && Number.isSafeInteger(nonce)) {
        testWindow.__zk688ManagementFocusEvents!.push({ target, nonce });
      }
    });
  });
}

async function managementFocusEvents(page: Page) {
  return page.evaluate(() => (
    (window as typeof window & { __zk688ManagementFocusEvents?: ManagementFocusEvent[] })
      .__zk688ManagementFocusEvents ?? []
  ));
}

test("ZK-688 Classic keeps the ordinary management loop visible and makes back-office control reversible", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await enterClassicFixture(page);

  const panel = page.getByTestId("seasons-legacy-panel");
  await panel.getByRole("button", { name: "Club identity", exact: true }).click();
  await expect(panel.getByTestId("system-control-summary")).toContainText("Classic · 13 automated · 0 direct");
  await panel.getByText("Manual system overrides", { exact: true }).click();
  await expect(panel.locator("[data-testid^=system-policy-]")).toHaveCount(7);
  await panel.getByText("Back-office systems", { exact: true }).click();
  await expect(panel.locator("[data-testid^=back-office-policy-]")).toHaveCount(6);

  await panel.getByTestId("back-office-policy-drainage").getByRole("button", { name: "Take control" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").systemControl.systems.find((system: { id: string }) => system.id === "drainage"))).toMatchObject({ visibility: "full", mode: "manual", source: "save-override" });
  await panel.getByRole("button", { name: "Season", exact: true }).click();
  await expect(panel.getByTestId("improve-drainage")).toBeVisible();
  await panel.getByRole("button", { name: "Club identity", exact: true }).click();
  await panel.getByText("Manual system overrides", { exact: true }).click();
  await panel.getByTestId("system-policy-drainage").getByRole("button", { name: "Return" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").systemControl.systems.find((system: { id: string }) => system.id === "drainage"))).toMatchObject({ visibility: "hidden", mode: "automated", source: "profile-default" });
  await panel.getByRole("button", { name: "Season", exact: true }).click();
  await expect(panel.getByTestId("improve-drainage")).toHaveCount(0);
  await panel.getByRole("button", { name: "Close", exact: true }).click();

  await expect(page.getByTestId("open-architecture-review")).toBeVisible();
  await expect(page.getByTestId("open-course-manager")).toBeVisible();
  await expect(page.getByTestId("open-land-office")).toBeVisible();
  await page.getByTestId("workspace-operate").click();
  await expect(page.getByTestId("open-player-pro")).toBeVisible();
  await expect(page.getByTestId("open-tournaments")).toBeVisible();
  await expect(page.getByTestId("open-property-management")).toBeVisible();

  await page.getByTestId("open-property-management").click();
  const property = page.getByTestId("property-management-panel");
  await expect(property.getByText("Memberships and lockers")).toBeAttached();
  await expect(property.locator('select[aria-label*="hours" i]')).toHaveCount(0);
  await property.getByTestId("property-tab-resort").click();
  await expect(property.getByTestId("resort-package-room_only")).toBeVisible();
  await expect(property.getByTestId("resort-staff-front-desk")).toHaveCount(0);
  await expect(property.getByTestId("resort-capacity")).toHaveCount(0);
  await property.getByTestId("property-tab-community").click();
  await expect(property.getByTestId("development-preview-houses-sell")).toBeVisible();
  await expect(property.getByTestId("m33-safety-heatmap")).toHaveCount(0);
  await expect(property.getByTestId("property-tab-ledger")).toHaveCount(0);
  await property.getByRole("button", { name: "Close property management", exact: true }).click();

  await page.getByLabel("Open live overview").click();
  const live = page.getByTestId("live-overview");
  await expect(live.getByRole("tab", { name: "Golfers" })).toBeVisible();
  await expect(live.getByRole("tab", { name: "Staff" })).toBeVisible();
  await expect(live.getByRole("tab", { name: "Pace" })).toHaveCount(0);
  await live.getByRole("button", { name: "Close live overview" }).click();

  await page.getByRole("button", { name: "Architect", exact: true }).click();
  await page.getByRole("button", { name: "Upgrades", exact: true }).click();
  await expect(page.getByTestId("green-program-presets")).toBeVisible();
  await expect(page.getByTestId("green-program-targetSpeedFeet")).toHaveCount(0);
  await expect(page.getByText("Bridge loan", { exact: false })).toBeVisible();
  await expect(page.locator('[data-tutorial-target="staff"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Event Feed" })).toBeVisible();
  await page.getByTestId("workspace-legacy").click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByTestId("open-progression")).toBeVisible();

  const shot = await page.screenshot({ path: testInfo.outputPath("zk688-classic-management.png"), fullPage: true });
  await testInfo.attach("zk688-classic-management", { body: shot, contentType: "image/png" });
  expect(errors).toEqual([]);
});

test("ZK-688 Relaxed retains pace summary without direct pace or mobility evidence", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  const tutorial = page.getByRole("dialog", { name: "First-launch tutorial" });
  if (await tutorial.count()) await tutorial.getByRole("button", { name: "Skip tutorial" }).click();
  await page.evaluate(() => window.__coursecraftTest!.setM39Fixture());
  await page.getByTestId("seasons-legacy-panel").getByRole("button", { name: "Close", exact: true }).click();

  await page.getByLabel("Open live overview").click();
  const live = page.getByTestId("live-overview");
  await live.getByRole("tab", { name: "Pace" }).click();
  await expect(live.getByTestId("pace-summary")).toBeVisible();
  await expect(live.getByTestId("pace-operations")).toHaveCount(0);
  await expect(live.getByTestId("pace-identity")).toHaveCount(0);
  await expect(live.getByRole("tab", { name: "Mobility" })).toHaveCount(0);
});

test("ZK-688 pace, mobility, and staffing claims reveal independent evidence and Return restores Classic", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await enterClassicFixture(page);
  await page.getByTestId("seasons-legacy-panel").getByRole("button", { name: "Close", exact: true }).click();

  await page.getByLabel("Open live overview").click();
  let live = page.getByTestId("live-overview");
  await expect(live.getByRole("tab", { name: "Pace" })).toHaveCount(0);
  await expect(live.getByRole("tab", { name: "Mobility" })).toHaveCount(0);
  await live.getByRole("tab", { name: "Staff" }).click();
  await expect(live.locator('select[aria-label^="Assign"]')).not.toHaveCount(0);
  await expect(live.getByTestId("staff-shift-readonly")).toHaveCount(0);
  await live.getByRole("button", { name: "Close live overview" }).click();

  let panel = await openSystemControlPanel(page);
  await panel.getByText("Back-office systems", { exact: true }).click();
  await panel.getByTestId("back-office-policy-pace").getByRole("button", { name: "Take control" }).click();
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByLabel("Open live overview").click();
  live = page.getByTestId("live-overview");
  await live.getByRole("tab", { name: "Pace" }).click();
  await expect(live.getByTestId("pace-operations")).toBeVisible();
  await expect(live.getByRole("tab", { name: "Mobility" })).toHaveCount(0);
  await live.getByRole("button", { name: "Close live overview" }).click();
  panel = await openSystemControlPanel(page);
  await panel.getByTestId("system-policy-pace").getByRole("button", { name: "Return" }).click();
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByLabel("Open live overview").click();
  live = page.getByTestId("live-overview");
  await expect(live.getByRole("tab", { name: "Pace" })).toHaveCount(0);
  await live.getByRole("button", { name: "Close live overview" }).click();

  panel = await openSystemControlPanel(page);
  await panel.getByText("Back-office systems", { exact: true }).click();
  await panel.getByTestId("back-office-policy-mobility").getByRole("button", { name: "Take control" }).click();
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByLabel("Open live overview").click();
  live = page.getByTestId("live-overview");
  await expect(live.getByRole("tab", { name: "Pace" })).toHaveCount(0);
  await live.getByRole("tab", { name: "Mobility" }).click();
  await expect(live.getByTestId("mobility-operations")).toBeVisible();
  await live.getByRole("button", { name: "Close live overview" }).click();
  panel = await openSystemControlPanel(page);
  await panel.getByTestId("system-policy-mobility").getByRole("button", { name: "Return" }).click();
  await panel.getByRole("button", { name: "Close", exact: true }).click();

  panel = await openSystemControlPanel(page);
  await panel.getByTestId("system-policy-staffing").getByRole("button", { name: "Take control" }).click();
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByLabel("Open live overview").click();
  live = page.getByTestId("live-overview");
  await live.getByRole("tab", { name: "Staff" }).click();
  await expect(live.getByTestId("staff-shift-readonly")).toContainText("read-only");
  await expect(live.locator('[data-testid^="staff-shift-"]:not([data-testid="staff-shift-readonly"])')).not.toHaveCount(0);
  await expect(live.getByText(/Shift \d{1,2}:\d{2} [AP]M–\d{1,2}:\d{2} [AP]M/).first()).toBeVisible();
  const shot = await page.screenshot({ path: testInfo.outputPath("zk688-staffing-shifts.png"), fullPage: true });
  await testInfo.attach("zk688-staffing-shifts", { body: shot, contentType: "image/png" });
  await live.getByRole("button", { name: "Close live overview" }).click();
  panel = await openSystemControlPanel(page);
  await panel.getByTestId("system-policy-staffing").getByRole("button", { name: "Return" }).click();
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByLabel("Open live overview").click();
  live = page.getByTestId("live-overview");
  await live.getByRole("tab", { name: "Staff" }).click();
  await expect(live.getByTestId("staff-shift-readonly")).toHaveCount(0);
});

for (const target of ["pricing", "maintenance"] as const) {
  test(`ZK-688 advisor Review plan focuses and consumes the ${target} target`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await enterClassicFixture(page);
    await page.evaluate((managementTarget) => window.__coursecraftTest!.showZk688AdvisorMessage(managementTarget), target);
    await page.getByTestId("advisor-open-management").click();

    const control = page.getByTestId(`management-${target}-target`);
    await expect(control).toBeFocused();
    await expect(page.locator(".cc-hud")).not.toHaveAttribute("data-management-focus");
    await page.getByRole("button", { name: "Architect", exact: true }).click();
    await page.getByRole("button", { name: "Editor", exact: true }).click();
    await expect(page.getByRole("button", { name: "Hole Wizard", exact: true })).toBeVisible();
  });
}

test("ZK-688 sequential advisor Review plan requests receive unique focus identities", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await enterClassicFixture(page);
  await recordManagementFocusEvents(page);

  for (const target of ["pricing", "maintenance"] as const) {
    await page.evaluate((managementTarget) => window.__coursecraftTest!.showZk688AdvisorMessage(managementTarget), target);
    await page.getByTestId("advisor-open-management").click();
    await expect(page.getByTestId(`management-${target}-target`)).toBeFocused();
    await expect(page.locator(".cc-hud")).not.toHaveAttribute("data-management-focus");
  }

  expect(await managementFocusEvents(page)).toEqual([
    { target: "pricing", nonce: 1 },
    { target: "maintenance", nonce: 2 },
  ]);
});

test("ZK-688 explicit HUD navigation cancels a pending focus without poisoning retry", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await enterClassicFixture(page);
  await recordManagementFocusEvents(page);
  await page.evaluate(() => window.__coursecraftTest!.showZk688AdvisorMessage("pricing"));
  await page.getByRole("button", { name: "Architect", exact: true }).click();

  await page.evaluate(async () => {
    const review = document.querySelector<HTMLButtonElement>('[data-testid="advisor-open-management"]');
    if (!review) throw new Error("Advisor Review plan action is unavailable");
    review.click();
    await new Promise<void>((resolve, reject) => queueMicrotask(() => {
      const editor = [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.trim() === "Editor");
      if (!editor) {
        reject(new Error("HUD Editor tab is unavailable"));
        return;
      }
      editor.click();
      resolve();
    }));
  });

  await expect(page.locator(".cc-hud")).not.toHaveAttribute("data-management-focus");
  await expect(page.getByRole("button", { name: "Hole Wizard", exact: true })).toBeVisible();
  expect(await managementFocusEvents(page)).toEqual([]);

  await page.evaluate(() => window.__coursecraftTest!.showZk688AdvisorMessage("maintenance"));
  await page.getByTestId("advisor-open-management").click();
  await expect(page.getByTestId("management-maintenance-target")).toBeFocused();
  await expect(page.locator(".cc-hud")).not.toHaveAttribute("data-management-focus");
  expect(await managementFocusEvents(page)).toEqual([{ target: "maintenance", nonce: 2 }]);
});
