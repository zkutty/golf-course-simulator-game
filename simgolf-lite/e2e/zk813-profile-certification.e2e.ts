import { expect, test, type Page } from "@playwright/test";

type ExperienceProfile = "relaxed" | "classic" | "simulation";
type EconomicPressure = "friendly" | "balanced" | "tight";

const AXES: Array<readonly [ExperienceProfile, EconomicPressure]> = [
  ["relaxed", "friendly"],
  ["relaxed", "balanced"],
  ["relaxed", "tight"],
  ["classic", "friendly"],
  ["classic", "balanced"],
  ["classic", "tight"],
  ["simulation", "friendly"],
  ["simulation", "balanced"],
  ["simulation", "tight"],
];

async function resetToTitle(page: Page, errors: string[]) {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "New Game" })).toBeVisible();
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  // Each loop deliberately tears down the previous game document. Firefox and
  // WebKit can surface that prior document's aborted requests while the new
  // title settles, so begin the next setup/run error boundary only now.
  errors.length = 0;
}

async function openExperienceSetup(page: Page) {
  await page.getByRole("button", { name: "New Game" }).click();
  await page.getByRole("button", { name: "Sandbox" }).click();
  await page.getByRole("button", { name: "Next →" }).click();
  await page.getByRole("button", { name: "Next →" }).click();
  await expect(page.getByText("How hands-on do you want to be?")).toBeVisible();
}

async function enterGame(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  const tutorial = page.getByRole("dialog", { name: "First-launch tutorial" });
  if (await tutorial.count()) await tutorial.getByRole("button", { name: "Skip tutorial" }).click();
}

async function saveAndReload(page: Page, name: string) {
  await page.keyboard.press("Escape");
  const pause = page.getByTestId("pause-overlay");
  await expect(pause).toBeVisible();
  await pause.getByRole("button", { name: /save game/i }).click();
  await page.getByPlaceholder("New save name…").fill(name);
  await page.getByRole("button", { name: "Save to new slot" }).click();
  await expect(page.getByText(name)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
}

function errorsFor(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

test("ZK-813 structural start matrix keeps all nine selected profile and pressure pairs visible through run creation", async ({ page }) => {
  page.setDefaultTimeout(15_000);
  const errors = errorsFor(page);

  for (const [profile, pressure] of AXES) {
    await resetToTitle(page, errors);
    await openExperienceSetup(page);
    const profileCard = page.getByTestId(`experience-profile-${profile}`);
    await profileCard.focus();
    await page.keyboard.press("Enter");
    await expect(profileCard).toHaveAttribute("aria-pressed", "true");
    await expect(profileCard).toContainText("You manage");
    await expect(profileCard).toContainText("Your team manages");
    await page.getByTestId("economic-pressure-advanced").locator("summary").click();
    const pressureButton = page.getByTestId(`economic-pressure-${pressure}`);
    await pressureButton.focus();
    await page.keyboard.press("Enter");
    await expect(pressureButton).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Next →" }).click();
    await expect(page.getByTestId("setup-review")).toContainText(new RegExp(`${profile}.*${pressure}`, "i"));
    await page.getByRole("button", { name: "⛳ Start building" }).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").experience))
      .toEqual({ profile, economicPressure: pressure });
    expect(errors, `${profile}:${pressure} setup/run console and page errors`).toEqual([]);
  }
});

const CAMPAIGN_ASSIGNMENTS: Array<readonly [string, ExperienceProfile, EconomicPressure]> = [
  ["back-nine", "relaxed", "friendly"],
  ["muni-rescue", "relaxed", "friendly"],
  ["swamp-deal", "classic", "balanced"],
  ["links-by-the-sea", "classic", "balanced"],
  ["members-club", "classic", "balanced"],
  ["championship-dream", "simulation", "balanced"],
];

for (const [label, assignments] of [
  ["Relaxed and Classic", CAMPAIGN_ASSIGNMENTS.slice(0, 3)],
  ["late Classic and Simulation", CAMPAIGN_ASSIGNMENTS.slice(3)],
] as const) {
  test(`ZK-813 campaign fixtures expose ${label} authored assignments without treating fixture state as gameplay proof`, async ({ page }, testInfo) => {
    page.setDefaultTimeout(15_000);
    const errors = errorsFor(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterGame(page);

    for (const [chapterId, profile, pressure] of assignments) {
      await page.evaluate(([id]) => window.__coursecraftTest!.setZk690CampaignFixture(id), [chapterId] as const);
      await expect.poll(() => page.evaluate(() => {
        const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
        return [state.campaign.chapterId, state.experience.profile, state.experience.economicPressure];
      }), { timeout: 10_000 }).toEqual([chapterId, profile, pressure]);
    }

    const [, profile, pressure] = assignments.at(-1)!;
    const scene = page.getByTestId("campaign-scene");
    await expect(scene).toBeVisible();
    await expect(scene).toContainText(new RegExp(`Active setup: ${profile}.*${pressure}`, "i"));
    const shot = await page.screenshot({ path: testInfo.outputPath(`zk813-campaign-${label.replaceAll(" ", "-")}.png`), fullPage: true });
    await testInfo.attach("campaign-assignment", { body: shot, contentType: "image/png" });
    expect(errors).toEqual([]);
  });
}

test("ZK-813 Classic control takeover remains authoritative and save-safe", async ({ page }, testInfo) => {
  page.setDefaultTimeout(20_000);
  const errors = errorsFor(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterGame(page);
  await page.evaluate(() => window.__coursecraftTest!.setZk688ClassicFixture());
  const panel = page.getByTestId("seasons-legacy-panel");
  await panel.getByRole("button", { name: "Club identity", exact: true }).click();
  await panel.getByText("Back-office systems", { exact: true }).click();
  const drainage = panel.getByTestId("back-office-policy-drainage");
  await drainage.getByRole("button", { name: "Take control" }).click();
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return state.systemControl.systems.find((system: { id: string }) => system.id === "drainage");
  })).toMatchObject({ visibility: "full", mode: "manual", source: "save-override", override: true });
  await panel.getByRole("button", { name: "Close", exact: true }).click();

  await saveAndReload(page, "ZK-813 Classic authority");
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return {
      axes: state.experience,
      drainage: state.systemControl.systems.find((system: { id: string }) => system.id === "drainage"),
    };
  })).toMatchObject({
    axes: { profile: "classic", economicPressure: "balanced" },
    drainage: { visibility: "full", mode: "manual", source: "save-override", override: true },
  });

  await page.getByTestId("workspace-legacy").click();
  await page.getByTestId("open-seasons-legacy").click();
  const reloadedPanel = page.getByTestId("seasons-legacy-panel");
  await reloadedPanel.getByRole("button", { name: "Club identity", exact: true }).click();
  await reloadedPanel.getByText("Manual system overrides", { exact: true }).click();
  await expect(reloadedPanel.getByTestId("system-policy-drainage")).toContainText("manual (save override)");
  const shot = await page.screenshot({ path: testInfo.outputPath("zk813-classic-authority-reload.png"), fullPage: true });
  await testInfo.attach("classic-authority-reload", { body: shot, contentType: "image/png" });
  expect(errors).toEqual([]);
});

// M14 retains the expensive authoritative three-, six-, and nine-hole gameplay
// trace. This bounded browser certification keeps a keyboard-launched, pointer-driven first-hole interaction
// in the ZK-813 slice and relies on that existing trace for the later milestones.
test("ZK-813 keyboard launch and pointer first-hole workflow stay localized and contained", async ({ page }, testInfo) => {
  page.setDefaultTimeout(30_000);
  const errors = errorsFor(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  const offer = page.getByRole("dialog", { name: "First-launch tutorial" });
  await expect(offer).toBeVisible();
  await offer.getByRole("button", { name: "Start guided course" }).focus();
  await page.keyboard.press("Enter");
  const overlay = page.getByTestId("tutorial-overlay");
  await expect(overlay).toHaveAttribute("data-step-id", "welcome");
  await page.getByRole("button", { name: "Start designing" }).click();
  await expect(overlay).toHaveAttribute("data-step-id", "paint-fairway");

  const canvas = page.locator(".cc-pixi-stage canvas");
  await expect(canvas).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest));
  await page.evaluate(() => window.__coursecraftPixiTest!.fitWholeCourse());
  const route = await page.evaluate(() => {
    const surface = window.__coursecraftTest!.terrainSurfaceState();
    for (let y = 4; y < surface.height - 4; y += 2) {
      for (let x = 4; x + 12 < surface.width - 4; x++) {
        const start = { x, y };
        const end = { x: x + 10, y };
        if (Array.from({ length: 11 }, (_, offset) => surface.owned[y * surface.width + x + offset]).every(Boolean)) return [start, end];
      }
    }
    throw new Error("No owned first-hole route found");
  });
  const point = async (tile: { x: number; y: number }) => {
    const projection = await page.evaluate((target) => ({ point: window.__coursecraftPixiTest!.tileToScreen(target.x, target.y), viewport: window.__coursecraftPixiTest!.viewport() }), tile);
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Canvas has no bounding box");
    return { x: box.x + projection.point.x * box.width / projection.viewport.width, y: box.y + projection.point.y * box.height / projection.viewport.height };
  };
  const [start, end] = route;
  const from = await point(start);
  const to = await point(end);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await expect(overlay.getByRole("button", { name: "Continue" })).toBeEnabled();
  await overlay.getByRole("button", { name: "Continue" }).click();
  await expect(overlay).toHaveAttribute("data-step-id", "place-hole");
  await canvas.click({ position: { x: from.x - (await canvas.boundingBox())!.x, y: from.y - (await canvas.boundingBox())!.y } });
  await expect(page.getByText("Click to place green", { exact: true })).toBeVisible();
  await canvas.click({ position: { x: to.x - (await canvas.boundingBox())!.x, y: to.y - (await canvas.boundingBox())!.y } });
  await expect(overlay.getByRole("button", { name: "Continue" })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").editor.activeHole)).toBe(1);
  const desktop = await page.screenshot({ path: testInfo.outputPath("zk813-first-hole-desktop.png"), fullPage: true });
  await testInfo.attach("first-hole-desktop", { body: desktop, contentType: "image/png" });

  await page.setViewportSize({ width: 390, height: 640 });
  await page.evaluate(() => localStorage.setItem("coursecraft_locale", "pseudo"));
  await page.reload();
  await page.getByRole("button", { name: /Çôñtïñüë/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-locale", "pseudo");
  const pseudoOverlay = page.getByTestId("tutorial-overlay");
  await expect(pseudoOverlay).toBeVisible();
  await expect(pseudoOverlay).toContainText(/Sët thë tëë áñd grëëñ/);
  await expect(pseudoOverlay.getByRole("button", { name: /Çôñtïñüë/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const overlayBounds = await pseudoOverlay.boundingBox();
  expect(overlayBounds).not.toBeNull();
  expect(overlayBounds!.x).toBeGreaterThanOrEqual(0);
  expect(overlayBounds!.y).toBeGreaterThanOrEqual(0);
  expect(overlayBounds!.x + overlayBounds!.width).toBeLessThanOrEqual(390);
  expect(overlayBounds!.y + overlayBounds!.height).toBeLessThanOrEqual(640);
  const mobile = await page.screenshot({ path: testInfo.outputPath("zk813-first-hole-mobile-pseudo.png"), fullPage: true });
  await testInfo.attach("first-hole-mobile-pseudo", { body: mobile, contentType: "image/png" });
  expect(errors).toEqual([]);
});
