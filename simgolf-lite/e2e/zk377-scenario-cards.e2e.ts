import { expect, test } from "@playwright/test";

const careerFixture = {
  version: 2,
  scenarios: { "back-nine": { completed: true, attempts: 2, bestWeek: 8, bestCash: 50_000, bestMedal: "gold" } },
  unlocks: [],
  campaignChoices: [],
};

test("ZK-377 scenario cards expose locked, ready, and completed states with working start callbacks", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.addInitScript((career) => localStorage.setItem("coursecraft_career_v1", JSON.stringify(career)), careerFixture);
  await page.goto("/e2e/fixtures/zk377-scenario-cards.html");

  const completed = page.getByTestId("campaign-card-back-nine");
  const ready = page.getByTestId("campaign-card-muni-rescue");
  const locked = page.getByTestId("campaign-card-swamp-deal");
  await expect(completed).toBeEnabled();
  await expect(completed).toHaveAccessibleName(/1\. The Back Nine.*Completed.*Gold medal.*Best result: week 8.*\$50,000/i);
  await expect(completed).toContainText("Completed");
  await expect(ready).toBeEnabled();
  await expect(ready).toHaveAccessibleName(/2\. Muni Rescue.*Ready to play/i);
  await expect(locked).toBeDisabled();
  await expect(locked).toHaveAccessibleName(/3\. Swamp Deal.*Locked/i);
  await expect(locked).toHaveAccessibleDescription(/Complete the previous scenario to unlock/i);
  for (const card of [completed, ready, locked]) await expect(card.locator("svg")).toHaveCount(1);
  const visibleCopy = await page.locator(".campaign-scenario-list").innerText();
  expect(visibleCopy).not.toMatch(/\p{Extended_Pictographic}/u);
  await locked.click({ force: true });
  await expect(page.getByTestId("scenario-started")).toHaveText("none");
  await ready.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("scenario-started")).toHaveText("muni-rescue");
  expect(errors).toEqual([]);
});

test("ZK-377 scenario cards contain 130 percent pseudo text at 320px and retain screenshot dimensions", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 720 });
  await page.addInitScript((career) => {
    localStorage.setItem("coursecraft_career_v1", JSON.stringify(career));
    localStorage.setItem("coursecraft_locale", "pseudo");
  }, careerFixture);
  await page.goto("/e2e/fixtures/zk377-scenario-cards.html");
  await expect(page.locator("html")).toHaveAttribute("data-locale", "pseudo");

  const list = page.locator(".campaign-scenario-list");
  const locked = page.getByTestId("campaign-card-swamp-deal");
  const completed = page.getByTestId("campaign-card-back-nine");
  const ready = page.getByTestId("campaign-card-muni-rescue");
  await expect(locked).toBeDisabled();
  await expect(locked).toHaveAccessibleName(/Lôçkëd/i);
  await expect(locked).toHaveAccessibleDescription(/Çômplëtë thë prëvïôüs sçëñárïô/i);
  await expect(completed).toHaveAccessibleName(/Çômplëtëd.*Gôld mëdál.*Bëst rësült.*wëëk 8/i);
  for (const card of [completed, ready, locked]) await expect(card.locator("svg")).toHaveCount(1);
  expect(await list.innerText()).not.toMatch(/\p{Extended_Pictographic}/u);

  // Read every computed font style before changing any inline font size.
  const baselines = await list.evaluate((root) => {
    const elements = [root, ...root.querySelectorAll<HTMLElement>("*")];
    return elements.map((element) => {
      const style = getComputedStyle(element);
      return {
        fontSize: Number.parseFloat(style.fontSize),
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
      };
    });
  });
  await list.evaluate((root) => {
    const elements = [root, ...root.querySelectorAll<HTMLElement>("*")];
    const capturedSizes = elements.map((element) => ({ element, size: Number.parseFloat(getComputedStyle(element).fontSize) }));
    for (const { element, size } of capturedSizes) {
      if (Number.isFinite(size)) element.style.setProperty("font-size", `${size * 1.3}px`, "important");
    }
  });
  const scaledSizes = await list.evaluate((root) => [root, ...root.querySelectorAll<HTMLElement>("*")]
    .map((element) => Number.parseFloat(getComputedStyle(element).fontSize)));
  expect(scaledSizes).toHaveLength(baselines.length);
  for (let index = 0; index < baselines.length; index += 1) {
    if (Number.isFinite(baselines[index].fontSize)) {
      expect(Math.abs(scaledSizes[index] / baselines[index].fontSize - 1.3)).toBeLessThan(0.01);
    }
  }

  const layout = await list.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const card = element.querySelector<HTMLElement>("[data-testid=campaign-card-back-nine]")!;
    const cardBounds = card.getBoundingClientRect();
    return {
      left: bounds.left,
      right: bounds.right,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      cardRight: cardBounds.right,
      cardScrollWidth: card.scrollWidth,
      cardClientWidth: card.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  });
  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(320);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  expect(layout.cardRight).toBeLessThanOrEqual(320);
  expect(layout.cardScrollWidth).toBeLessThanOrEqual(layout.cardClientWidth);
  expect(layout.documentWidth).toBeLessThanOrEqual(320);

  const image = await completed.screenshot({ path: testInfo.outputPath("zk377-scenario-card-320px-130pct-pseudo.png") });
  const screenshotBounds = await completed.evaluate((card) => {
    const rect = card.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height) };
  });
  expect(image.readUInt32BE(16)).toBe(screenshotBounds.width);
  expect(image.readUInt32BE(20)).toBe(screenshotBounds.height);
  expect(errors).toEqual([]);
  await testInfo.attach("scenario-card-320px-130pct-pseudo", { body: image, contentType: "image/png" });
});

test("ZK-377 genuine English scenario cards contain 130 percent text at 320px", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 720 });
  await page.addInitScript((career) => localStorage.setItem("coursecraft_career_v1", JSON.stringify(career)), careerFixture);
  await page.goto("/e2e/fixtures/zk377-scenario-cards.html");
  await expect(page.locator("html")).toHaveAttribute("data-locale", "en");
  const list = page.locator(".campaign-scenario-list");
  const completed = page.getByTestId("campaign-card-back-nine");
  await expect(completed).toHaveAccessibleName(/Completed.*Gold medal.*Best result: week 8.*\$50,000/i);

  const baseline = await list.evaluate((root) => [root, ...root.querySelectorAll<HTMLElement>("*")].map((element) => {
    const style = getComputedStyle(element);
    return {
      fontSize: Number.parseFloat(style.fontSize),
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
    };
  }));
  await list.evaluate((root) => {
    const elements = [root, ...root.querySelectorAll<HTMLElement>("*")];
    const capturedSizes = elements.map((element) => ({ element, size: Number.parseFloat(getComputedStyle(element).fontSize) }));
    for (const { element, size } of capturedSizes) {
      if (Number.isFinite(size)) element.style.setProperty("font-size", `${size * 1.3}px`, "important");
    }
  });
  const scaledSizes = await list.evaluate((root) => [root, ...root.querySelectorAll<HTMLElement>("*")]
    .map((element) => Number.parseFloat(getComputedStyle(element).fontSize)));
  expect(scaledSizes).toHaveLength(baseline.length);
  for (let index = 0; index < baseline.length; index += 1) {
    if (Number.isFinite(baseline[index].fontSize)) {
      expect(Math.abs(scaledSizes[index] / baseline[index].fontSize - 1.3)).toBeLessThan(0.01);
    }
  }
  const bounds = await list.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, documentWidth: document.documentElement.scrollWidth };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(320);
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
  expect(bounds.documentWidth).toBeLessThanOrEqual(320);
  const image = await completed.screenshot({ path: testInfo.outputPath("zk377-scenario-card-320px-130pct-en.png") });
  const screenshotBounds = await completed.evaluate((card) => {
    const rect = card.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height) };
  });
  expect(image.readUInt32BE(16)).toBe(screenshotBounds.width);
  expect(image.readUInt32BE(20)).toBe(screenshotBounds.height);
  expect(errors).toEqual([]);
  await testInfo.attach("scenario-card-320px-130pct-en", { body: image, contentType: "image/png" });
});
