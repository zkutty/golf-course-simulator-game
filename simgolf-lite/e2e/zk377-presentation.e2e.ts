import { expect, test, type Locator, type Page } from "@playwright/test";

test.setTimeout(60_000);

async function expectContained(page: Page, panel: Locator) {
  const panelBox = await panel.boundingBox();
  expect(panelBox).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(panelBox!.x).toBeGreaterThanOrEqual(0);
  expect(panelBox!.y).toBeGreaterThanOrEqual(0);
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(viewport.width + 0.5);
  expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(viewport.height + 0.5);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(viewport.width);
}

async function expectPanelControlsReachable(page: Page, panel: Locator) {
  const controls = panel.locator("button:not([disabled])");
  const count = await controls.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    await control.scrollIntoViewIfNeeded();
    await control.focus();
    await expect(control).toBeFocused();
    const controlBox = await control.boundingBox();
    const panelBox = await panel.boundingBox();
    expect(controlBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    const viewport = page.viewportSize()!;
    expect(controlBox!.x).toBeGreaterThanOrEqual(panelBox!.x - 0.5);
    expect(controlBox!.y).toBeGreaterThanOrEqual(panelBox!.y - 0.5);
    expect(controlBox!.x + controlBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 0.5);
    expect(controlBox!.y + controlBox!.height).toBeLessThanOrEqual(panelBox!.y + panelBox!.height + 0.5);
    expect(controlBox!.x).toBeGreaterThanOrEqual(0);
    expect(controlBox!.y).toBeGreaterThanOrEqual(0);
    expect(controlBox!.x + controlBox!.width).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(controlBox!.y + controlBox!.height).toBeLessThanOrEqual(viewport.height + 0.5);
  }
}

async function expectNoHorizontalPanelOverflow(panel: Locator) {
  await expect.poll(() => panel.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(0);
}

async function computedFont(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      family: style.fontFamily,
      size: Number.parseFloat(style.fontSize),
      weight: style.fontWeight,
      lineHeight: style.lineHeight,
    };
  });
}

async function measureTextWidth(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return context.measureText(element.textContent ?? "").width;
  });
}

test("progression and land office presentation preserve status, actions, fonts, and containment", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/e2e/fixtures/zk377-presentation.html");
  const fixture = page.getByTestId("zk377-presentation-ready");
  await expect(fixture).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  const progression = page.getByTestId("progression-panel");
  const progressionHeading = progression.locator(".cc-progression-panel__identity h2");
  const progressionStatus = page.getByTestId("progression-status-regional");
  const progressionFontBefore = await computedFont(progressionHeading);
  const statusFontBefore = await computedFont(progressionStatus);
  const progressionClose = progression.locator(".cc-progression-panel__close");
  const progressionCloseFontBefore = await computedFont(progressionClose);
  await expect(progression).toBeVisible();
  await expect(progression.locator(".cc-progression-panel__tier")).toHaveCount(5);
  await expect(progressionStatus).toHaveText("Unlocks at 45 reputation");
  await expect(page.getByTestId("progression-status-local")).toHaveText("Current tier");
  await expect(page.getByTestId("progression-status-municipal")).toHaveText("Unlocked");
  await expect(progression.locator("svg[viewBox='0 0 24 24'][aria-hidden='true']"))
    .toHaveCount(7);
  await expect(progression).not.toContainText(/[✕✓🔒]/u);
  await expect(progressionClose).toHaveAccessibleName("Close progression");
  await expect(progressionClose.locator("svg[aria-hidden='true']")).toHaveCount(1);
  await expect(progressionClose).toBeFocused();
  await progressionClose.press("Enter");
  await expect(progression).toHaveCount(0);
  await expect(page.getByTestId("callback-log")).toContainText("close:progression");

  await page.getByRole("button", { name: "Open land office" }).click();
  const landOffice = page.getByTestId("land-office");
  const landHeading = landOffice.locator(".cc-land-office__identity h2");
  const landFontBefore = await computedFont(landHeading);
  const landClose = landOffice.locator(".cc-land-office__close");
  const landCloseFontBefore = await computedFont(landClose);
  const centerButton = landOffice.locator(".cc-land-office__center");
  const centerFontBefore = await computedFont(centerButton);
  await expect(landOffice).toBeVisible();
  await expect(landClose).toHaveAccessibleName("Close Land Office");
  await expect(landClose).toBeFocused();
  await expect(landClose.locator("svg[aria-hidden='true']")).toHaveCount(1);
  await expect(landOffice).not.toContainText(/[✕✓🔒]/u);

  const adjacentId = await fixture.getAttribute("data-adjacent-parcel");
  const nonAdjacentId = await fixture.getAttribute("data-non-adjacent-parcel");
  const ownedId = await fixture.getAttribute("data-owned-parcel");
  expect(adjacentId).toBeTruthy();
  expect(nonAdjacentId).toBeTruthy();
  expect(ownedId).toBeTruthy();
  const purchase = landOffice.getByTestId("purchase-parcel");
  await expect(purchase).toBeEnabled();
  await purchase.click();
  await expect(purchase).toContainText("Confirm purchase");
  await expect(page.getByTestId("callback-log")).not.toContainText(`purchase:${adjacentId}`);
  await purchase.click();
  await expect(page.getByTestId("callback-log")).toContainText(`purchase:${adjacentId}`);

  await landOffice.getByTestId(`parcel-${nonAdjacentId}`).click();
  await expect(page.getByTestId("callback-log")).toContainText(`select:${nonAdjacentId}`);
  await expect(purchase).toBeDisabled();
  await expect(landOffice.getByRole("status")).toContainText("adjoining parcel");
  await expect(landOffice.getByTestId(`parcel-${nonAdjacentId}`).locator("svg[aria-hidden='true']"))
    .toHaveCount(1);

  await landOffice.getByTestId(`parcel-${adjacentId}`).click();
  await page.getByTestId("cash-zero").click();
  await expect(purchase).toBeDisabled();
  await expect(landOffice.getByRole("status")).toContainText("Not enough cash");
  await page.getByTestId("cash-available").click();
  await expect(purchase).toBeEnabled();

  await landOffice.getByTestId(`parcel-${ownedId}`).click();
  await expect(landOffice.getByRole("status")).toHaveText("Owned");
  await expect(landOffice.getByTestId("purchase-parcel")).toHaveCount(0);
  await expect(landOffice.getByTestId(`parcel-${ownedId}`).locator("svg[aria-hidden='true']"))
    .toHaveCount(1);

  await landOffice.getByTestId(`parcel-${adjacentId}`).click();
  const center = JSON.parse((await fixture.getAttribute("data-selected-center"))!);
  await landOffice.getByRole("button", { name: "View parcel" }).click();
  await expect(page.getByTestId("callback-log"))
    .toContainText(`center:${center.x},${center.y}`);
  await landClose.focus();
  await landClose.press("Enter");
  await expect(landOffice).toHaveCount(0);
  await expect(page.getByTestId("callback-log")).toContainText("close:land");

  await page.getByRole("button", { name: "Open progression" }).click();
  const englishStatusWidth = await measureTextWidth(progressionStatus);
  await page.getByTestId("locale-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-locale", "pseudo");
  await expect(progressionStatus).toContainText("⟦");
  const pseudoStatusWidth = await measureTextWidth(progressionStatus);
  expect(pseudoStatusWidth / englishStatusWidth).toBeGreaterThan(1.05);
  const progressionFontPseudo = await computedFont(progressionHeading);
  const statusFontPseudo = await computedFont(progressionStatus);
  const progressionCloseFontPseudo = await computedFont(progressionClose);
  expect(progressionFontPseudo.family).toBe(progressionFontBefore.family);
  expect(statusFontPseudo.family).toBe(statusFontBefore.family);
  expect(progressionFontPseudo.size / progressionFontBefore.size).toBeCloseTo(1, 2);
  expect(progressionCloseFontPseudo).toEqual(progressionCloseFontBefore);

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "130%";
  });
  const progressionFont130 = await computedFont(progressionHeading);
  const statusFont130 = await computedFont(progressionStatus);
  const progressionCloseFont130 = await computedFont(progressionClose);
  expect(progressionFont130.size / progressionFontPseudo.size).toBeCloseTo(1.3, 1);
  expect(statusFont130.size / statusFontPseudo.size).toBeCloseTo(1.3, 1);
  expect(progressionCloseFont130.size / progressionCloseFontPseudo.size).toBeCloseTo(1.3, 1);
  await page.getByTestId("rep-70").click();
  await expect(progression).toContainText("Destination Course");
  await expect(progression).toContainText("Legendary Club");
  await expect(page.getByTestId("progression-status-regional")).toContainText("⟦Üñlôçkëd");
  expect(await computedFont(progressionHeading)).toEqual(progressionFont130);
  await expectContained(page, progression);
  await expectNoHorizontalPanelOverflow(progression);
  await expectPanelControlsReachable(page, progression);
  await progressionStatus.scrollIntoViewIfNeeded();
  await expect(progressionStatus).toBeVisible();

  await progressionClose.focus();
  await progressionClose.press("Enter");
  await page.getByRole("button", { name: /Open land office/i }).click();
  await expect(landOffice).toBeVisible();
  const landFontPseudo130 = await computedFont(landHeading);
  const landCloseFontPseudo130 = await computedFont(landClose);
  const centerFontPseudo130 = await computedFont(centerButton);
  expect(landFontPseudo130.family).toBe(landFontBefore.family);
  expect(landFontPseudo130.size / landFontBefore.size).toBeCloseTo(1.3, 1);
  expect(landCloseFontPseudo130.family).toBe(landCloseFontBefore.family);
  expect(landCloseFontPseudo130.size / landCloseFontBefore.size).toBeCloseTo(1.3, 1);
  expect(centerFontPseudo130.family).toBe(centerFontBefore.family);
  expect(centerFontPseudo130.size / centerFontBefore.size).toBeCloseTo(1.3, 1);
  await expectContained(page, landOffice);
  await expectNoHorizontalPanelOverflow(landOffice);
  await expectPanelControlsReachable(page, landOffice);
  await centerButton.scrollIntoViewIfNeeded();
  await expect(centerButton).toBeVisible();
  expect(pageErrors).toEqual([]);

  const desktopShot = await page.screenshot({ path: testInfo.outputPath("zk377-pseudo-130-desktop.png") });
  await testInfo.attach("zk377-pseudo-130-desktop", { body: desktopShot, contentType: "image/png" });

  await page.setViewportSize({ width: 320, height: 780 });
  await expectContained(page, landOffice);
  await expectNoHorizontalPanelOverflow(landOffice);
  await expectPanelControlsReachable(page, landOffice);
  const mobileShot = await page.screenshot({ path: testInfo.outputPath("zk377-pseudo-130-320.png") });
  await testInfo.attach("zk377-pseudo-130-320", { body: mobileShot, contentType: "image/png" });
  await landClose.focus();
  await landClose.press("Enter");
  await page.getByRole("button", { name: /Open progression/ }).click();
  await expectContained(page, progression);
  await expectNoHorizontalPanelOverflow(progression);
  await expectPanelControlsReachable(page, progression);
  expect(pageErrors).toEqual([]);
});
