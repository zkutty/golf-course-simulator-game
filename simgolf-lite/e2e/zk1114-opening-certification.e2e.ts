import { expect, test, type Page } from "@playwright/test";

test.setTimeout(240_000);
test.use({ trace: "off", video: "off", screenshot: "only-on-failure" });
test.beforeEach(async ({ page }) => page.setDefaultTimeout(30_000));

const viewports = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
] as const;

function skipStateInvariant(value: Record<string, unknown>) {
  const onboarding = value.onboarding as Record<string, unknown>;
  const course = value.course as Record<string, unknown>;
  return {
    screenBase: value.screenBase,
    mode: value.mode,
    experience: value.experience,
    tutorialStep: value.tutorialStep,
    economy: value.economy,
    onboarding: {
      authorityHashes: onboarding.authorityHashes,
      carrierVersion: onboarding.carrierVersion,
      active: onboarding.active,
      stage: onboarding.stage,
      profile: onboarding.profile,
      completion: onboarding.completion,
      preview: onboarding.preview,
      reward: onboarding.reward,
      milestones: onboarding.milestones,
      jitQueue: onboarding.jitQueue,
      publicOperation: onboarding.publicOperation,
    },
    course: {
      name: course.name,
      theme: course.theme,
      width: course.width,
      height: course.height,
      smoothSurfaceFeatures: course.smoothSurfaceFeatures,
      surfaceFeatures: course.surfaceFeatures,
      holesOpen: course.holesOpen,
      terrainCounts: course.terrainCounts,
      obstacleCounts: course.obstacleCounts,
      decorations: course.decorations,
      activePinRotation: course.activePinRotation,
      holeSetups: course.holeSetups,
      activeCourseId: course.activeCourseId,
      layouts: course.layouts,
    },
  };
}

async function expectCardInsideViewport(page: Page) {
  const card = await page.getByTestId("tutorial-card").boundingBox();
  const viewport = page.viewportSize();
  if (!card || !viewport) throw new Error("Opening card or viewport is unavailable");
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.y).toBeGreaterThanOrEqual(0);
  expect(card.x + card.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(card.y + card.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function openTitleOptions(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Options/ }).click();
  await expect(page.getByTestId("options-screen")).toBeVisible();
}

/** Capture only after the production Pixi surface has committed a visible frame. */
async function waitForOpeningPresentationFrame(page: Page) {
  await expect(page.locator(".cc-pixi-stage canvas")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest));
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test("ZK-1114 opening presentation survives muted reduced-motion pseudo UI at 200% root font", async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await openTitleOptions(page);
  await page.getByRole("tab", { name: "Audio", exact: true }).click();
  await page.getByLabel("Master volume").fill("0");
  await page.getByRole("tab", { name: "Accessibility", exact: true }).click();
  await page.getByLabel("Reduced motion").check();
  await page.getByLabel("Text scale").selectOption("130");
  await page.getByTestId("options-screen").locator("select").last().selectOption("pseudo");
  await page.getByTestId("options-screen").locator("footer button").last().click();
  await page.getByRole("button").filter({ hasText: /Fïrst-hôlë ôpërátôr dëmô/ }).click();
  await expect(page.getByTestId("tutorial-overlay")).toHaveAttribute("data-step-id", "welcome");

  // Product text scaling is exercised through its visible 130% control above.
  // This additive browser/root-font stress reproduces 200% text-only zoom.
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
  await expect(page.locator("html")).toHaveAttribute("data-locale", "pseudo");
  expect(await page.evaluate(() => document.documentElement.style.fontSize)).toBe("200%");
  const storedProfile = await page.evaluate(() => JSON.parse(localStorage.getItem("coursecraft_app_profile_v5") ?? "null"));
  expect(storedProfile).toMatchObject({ audio: { masterVolume: 0 }, accessibility: { reducedMotion: true, textScale: 130 } });

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expectCardInsideViewport(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
    await expect(page.getByTestId("tutorial-primary-action")).toBeEnabled();
    await waitForOpeningPresentationFrame(page);
    await page.screenshot({ path: testInfo.outputPath(`pseudo-muted-reduced-200pct-${viewport.width}x${viewport.height}.png`) });
  }
  // The confirmation is a second, independently bounded surface. Exercise it
  // at the compact viewport after both product and root-font scaling are live.
  await page.setViewportSize({ width: 390, height: 844 });
  const skipTrigger = page.getByTestId("tutorial-skip-trigger");
  await skipTrigger.click();
  const skipDialog = page.getByTestId("tutorial-skip-dialog");
  await expect(skipDialog).toBeVisible();
  await expect(skipDialog).toHaveAttribute("role", "dialog");
  await expect(skipDialog).toHaveAttribute("aria-labelledby", "tutorial-skip-title");
  await expect(skipDialog).toHaveAttribute("aria-describedby", "tutorial-skip-description");
  await expect(skipDialog).toHaveAccessibleName(/.+/);
  await expect(skipDialog).toHaveAccessibleDescription(/.+/);
  const dialogBox = await skipDialog.boundingBox();
  if (!dialogBox) throw new Error("Tutorial skip confirmation has no visible rectangle");
  expect(dialogBox.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox.y).toBeGreaterThanOrEqual(0);
  expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(390);
  expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await testInfo.attach("skip-confirmation-compact", { body: await page.screenshot(), contentType: "image/png" });

  const keepLearning = page.getByTestId("tutorial-skip-cancel");
  const skipConfirm = page.getByTestId("tutorial-skip-confirm");
  const skipClose = page.getByTestId("tutorial-skip-close");
  await expect(keepLearning).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(skipConfirm).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(skipClose).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(keepLearning).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(skipClose).toBeFocused();
  await skipClose.click();
  await expect(skipDialog).toHaveCount(0);
  await expect(skipTrigger).toBeFocused();
  await skipTrigger.click();
  await expect(skipDialog).toBeVisible();
  await page.getByTestId("tutorial-skip-backdrop").click({ position: { x: 1, y: 1 } });
  await expect(skipDialog).toHaveCount(0);
  await expect(skipTrigger).toBeFocused();
  expect(browserErrors).toEqual([]);
});

test("ZK-1114 visible restart and skip leave the opening economy and reward untouched", async ({ page }) => {
  const browserErrors: string[] = [];
  const nativeDialogs: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("dialog", (dialog) => {
    nativeDialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await page.goto("/");
  await page.getByRole("button", { name: /First-hole operator demo/ }).click();
  const before = await page.evaluate(() => JSON.parse(window.render_game_to_text!()));
  await page.getByRole("button", { name: "Restart guide", exact: true }).click();
  await expect(page.getByTestId("tutorial-overlay")).toHaveAttribute("data-step-id", "welcome");
  const restarted = await page.evaluate(() => JSON.parse(window.render_game_to_text!()));
  expect(restarted.economy).toEqual(before.economy);
  expect(restarted.onboarding.reward).toBeNull();
  const skipTrigger = page.getByRole("button", { name: "Skip tutorial", exact: true });
  const beforeSkip = await page.evaluate(() => JSON.parse(window.render_game_to_text!()));
  const beforeSkipInvariant = skipStateInvariant(beforeSkip);
  await skipTrigger.click();
  const skipDialog = page.getByTestId("tutorial-skip-dialog");
  await expect(skipDialog).toBeVisible();
  await expect(page.getByTestId("tutorial-skip-cancel")).toBeFocused();
  expect(skipStateInvariant(await page.evaluate(() => JSON.parse(window.render_game_to_text!())))).toEqual(beforeSkipInvariant);
  await page.getByTestId("tutorial-skip-cancel").click();
  await expect(skipDialog).toHaveCount(0);
  await expect(skipTrigger).toBeFocused();
  await skipTrigger.click();
  await expect(skipDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(skipDialog).toHaveCount(0);
  await expect(skipTrigger).toBeFocused();
  await skipTrigger.click();
  await expect(skipDialog).toBeVisible();
  await page.getByTestId("tutorial-skip-confirm").click();
  await expect(page.getByTestId("tutorial-overlay")).toHaveCount(0);
  const skipped = await page.evaluate(() => JSON.parse(window.render_game_to_text!()));
  expect(skipped.economy).toEqual(before.economy);
  expect(skipped.onboarding).toMatchObject({ active: false, completion: "skipped", reward: null });
  expect(nativeDialogs).toEqual([]);
  expect(browserErrors).toEqual([]);
});
