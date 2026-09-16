import { expect, test, type Page } from "@playwright/test";

test.setTimeout(120_000);
test.use({ trace: "off", video: "off", screenshot: "only-on-failure" });
test.beforeEach(async ({ page }) => page.setDefaultTimeout(30_000));

function stableGameState(value: Record<string, unknown>) {
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

async function renderState(page: Page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text!()) as Record<string, unknown>);
}

test("ZK-1157 Tutorial skip confirmation is safe, accessible, and state-preserving", async ({ page }, testInfo) => {
  const nativeDialogs: string[] = [];
  page.on("dialog", (dialog) => {
    nativeDialogs.push(dialog.message());
    void dialog.dismiss();
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Options/ }).click();
  await page.getByRole("tab", { name: "Accessibility", exact: true }).click();
  await page.getByLabel("Reduced motion").check();
  await page.getByLabel("Text scale").selectOption("130");
  await page.getByTestId("options-screen").locator("select").last().selectOption("pseudo");
  await page.getByTestId("options-screen").locator("footer button").last().click();
  await page.getByRole("button").filter({ hasText: /Fïrst-hôlë ôpërátôr dëmô/ }).click();
  await expect(page.getByTestId("tutorial-overlay")).toHaveAttribute("data-step-id", "welcome");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expect(page.locator("html")).toHaveAttribute("data-locale", "pseudo");
  await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
  const before = await renderState(page);
  const beforeStable = stableGameState(before);
  const trigger = page.getByTestId("tutorial-skip-trigger");

  await trigger.click();
  const dialog = page.getByTestId("tutorial-skip-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName(/.+/);
  await expect(dialog).toHaveAccessibleDescription(/.+/);
  await expect(dialog).toHaveAttribute("aria-labelledby", "tutorial-skip-title");
  await expect(dialog).toHaveAttribute("aria-describedby", "tutorial-skip-description");
  const box = await dialog.boundingBox();
  if (!box) throw new Error("Tutorial skip dialog has no visible rectangle");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await testInfo.attach("zk1157-skip-confirmation-compact", { body: await page.screenshot(), contentType: "image/png" });
  expect(stableGameState(await renderState(page))).toEqual(beforeStable);

  const keepLearning = page.getByTestId("tutorial-skip-cancel");
  const confirm = page.getByTestId("tutorial-skip-confirm");
  const close = page.getByTestId("tutorial-skip-close");
  await expect(keepLearning).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(keepLearning).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();

  await close.click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog).toBeVisible();
  await page.getByTestId("tutorial-skip-backdrop").click({ position: { x: 1, y: 1 } });
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog).toBeVisible();
  await confirm.click();
  await expect(page.getByTestId("tutorial-overlay")).toHaveCount(0);

  const after = stableGameState(await renderState(page));
  expect(after.economy).toEqual(beforeStable.economy);
  expect(after.course).toEqual(beforeStable.course);
  expect((after.onboarding as Record<string, unknown>).authorityHashes).toEqual((beforeStable.onboarding as Record<string, unknown>).authorityHashes);
  expect((after.onboarding as Record<string, unknown>).completion).toBe("skipped");
  expect((after.onboarding as Record<string, unknown>).active).toBe(false);
  expect(nativeDialogs).toEqual([]);
});
