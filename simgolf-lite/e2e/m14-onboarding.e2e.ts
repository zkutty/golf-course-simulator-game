import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const evidenceDir = path.join(process.cwd(), "artifacts", "zk-211", "playwright");
mkdirSync(evidenceDir, { recursive: true });
test.setTimeout(900_000);

const tee = { x: 580, y: 370 };
const green = { x: 640, y: 400 };
const remainingHoleRoutes = [
  [{ x: 360, y: 260 }, { x: 420, y: 290 }],
  [{ x: 440, y: 260 }, { x: 500, y: 290 }],
  [{ x: 500, y: 380 }, { x: 560, y: 410 }],
  [{ x: 400, y: 360 }, { x: 460, y: 390 }],
  [{ x: 500, y: 330 }, { x: 560, y: 360 }],
  [{ x: 620, y: 370 }, { x: 680, y: 400 }],
  [{ x: 580, y: 260 }, { x: 640, y: 290 }],
  [{ x: 600, y: 320 }, { x: 660, y: 350 }],
] as const;

function tutorial(page: Page) {
  return page.getByTestId("tutorial-overlay");
}

async function expectStep(page: Page, id: string) {
  await expect(tutorial(page)).toHaveAttribute("data-step-id", id, { timeout: 30_000 });
}

async function capture(page: Page, run: string, name: string) {
  await page.screenshot({ path: path.join(evidenceDir, `${run}-${name}.png`) });
}

async function startFreshTutorial(page: Page, run: string) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Quick Start/ })).toBeVisible();
  await page.getByRole("button", { name: /Quick Start/ }).click();
  await expect(page.getByRole("dialog", { name: "First-launch tutorial" })).toBeVisible();
  await capture(page, run, "00-first-launch-offer");
  await page.getByRole("button", { name: "Start guided course" }).click();
  await expectStep(page, "meet-land");
  await expect(tutorial(page).getByText("Progress saved")).toBeVisible();
  await page.keyboard.press("Escape");
  await expectStep(page, "meet-land");
  await expect(page.getByRole("dialog", { name: "Game paused" })).toHaveCount(0);
}

async function gameCanvas(page: Page) {
  const canvas = page.locator(".cc-pixi-stage canvas");
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toBeVisible();
  return canvas;
}

async function placeHole(page: Page, start = tee, end = green) {
  const canvas = await gameCanvas(page);
  await canvas.click({ position: start, force: true });
  await canvas.click({ position: end, force: true });
  await expect(page.getByText("click or Esc to skip")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("click or Esc to skip")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Game paused" })).toHaveCount(0);
}

async function paintAndPlaceHole(page: Page, start: { x: number; y: number }, end: { x: number; y: number }) {
  await page.getByRole("button", { name: "Paint", exact: true }).click();
  const canvas = await gameCanvas(page);
  for (let index = 0; index < 13; index++) {
    const ratio = index / 12;
    await canvas.click({ force: true, position: {
      x: start.x + (end.x - start.x) * ratio,
      y: start.y + (end.y - start.y) * ratio,
    } });
  }
  await page.getByRole("button", { name: "Hole Wizard" }).click();
  await placeHole(page, start, end);
}

async function finishTutorial(page: Page, run: string, reloadStages = false) {
  await startFreshTutorial(page, run);

  await capture(page, run, "step-01-before-meet-land");
  const help = page.getByRole("button", { name: /Help/ });
  const helpBox = await help.boundingBox();
  if (!helpBox) throw new Error("Help control has no visible bounds");
  await page.mouse.click(helpBox.x + helpBox.width / 2, helpBox.y + helpBox.height / 2);
  await expectStep(page, "meet-land");
  await page.getByRole("button", { name: "Show me the tools" }).click();
  await expectStep(page, "paint-corridor");
  await capture(page, run, "step-01-after-transition");

  await capture(page, run, "step-02-before-paint-corridor");
  const canvas = await gameCanvas(page);
  for (let index = 0; index < 13; index++) {
    const ratio = index / 12;
    await canvas.click({ position: {
      x: tee.x + (green.x - tee.x) * ratio,
      y: tee.y + (green.y - tee.y) * ratio,
    } });
  }
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  await capture(page, run, "step-02-after-paint-corridor");
  await page.getByRole("button", { name: "Continue" }).click();
  await expectStep(page, "place-hole");

  if (reloadStages) {
    await expect(tutorial(page).getByText("Progress saved")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: /Continue/ })).toBeVisible();
    await page.getByRole("button", { name: /Continue/ }).click();
    await expectStep(page, "place-hole");
  }

  await capture(page, run, "step-03-before-place-hole");
  await page.getByRole("button", { name: "Hole Wizard" }).click();
  await placeHole(page);
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  await capture(page, run, "step-03-after-place-hole");
  await page.getByRole("button", { name: "Continue" }).click();
  await expectStep(page, "shot-plan");

  await capture(page, run, "step-04-before-shot-plan");
  await expect(page.getByLabel("Show shot plan overlay")).toBeChecked();
  await page.getByRole("button", { name: "I see it" }).click();
  await expectStep(page, "fix-corridor");
  await capture(page, run, "step-04-after-transition");

  await capture(page, run, "step-05-before-fix-corridor");
  const fixOverlay = page.getByLabel("Show fix overlay");
  await expect(fixOverlay).toBeVisible();
  await fixOverlay.check();
  await expect(fixOverlay).toBeChecked();
  await page.getByRole("button", { name: "Continue" }).click();
  await expectStep(page, "open-course");
  await capture(page, run, "step-05-after-transition");

  await capture(page, run, "step-06-before-open-course");
  for (const [index, [start, end]] of remainingHoleRoutes.entries()) {
    if (reloadStages && index === remainingHoleRoutes.length - 1) {
      await expectStep(page, "open-course");
      await page.reload();
      await page.getByRole("button", { name: /Continue/ }).click();
      await expectStep(page, "open-course");
    }
    await paintAndPlaceHole(page, start, end);
  }
  // Completing the ninth valid hole hands off automatically; no milestone
  // edge or extra click is required, and a resumed save stays on this step.
  await expectStep(page, "watch-golfers");
  await capture(page, run, "step-06-after-open-course");
  if (reloadStages) {
    await expect(tutorial(page).getByText("Progress saved")).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /Continue/ }).click();
    await expectStep(page, "watch-golfers");
  }

  await capture(page, run, "step-07-before-watch-golfers");
  await page.getByTitle("Speed 1x").click();
  await expect.poll(
    async () => Number((await page.getByTestId("live-stat-on-course").locator("span").first().innerText())),
    { timeout: 15_000 },
  ).toBeGreaterThan(0);
  await capture(page, run, "step-07-after-golfers-arrive");
  await page.getByRole("button", { name: "Continue" }).click();
  await expectStep(page, "weekly-report");

  await capture(page, run, "step-08-before-weekly-report");
  await page.getByRole("button", { name: /Simulate week/ }).click();
  await expect(page.getByText(/Profit:/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  await capture(page, run, "step-08-after-weekly-report");
  await page.getByRole("button", { name: "Continue" }).click();
  await expectStep(page, "green-fee");

  await capture(page, run, "step-09-before-green-fee");
  await page.getByLabel(/Green fee/).press("ArrowRight");
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  await capture(page, run, "step-09-after-green-fee");
  await page.getByRole("button", { name: "Continue" }).click();
  await expectStep(page, "maintenance");

  if (reloadStages) {
    await expect(tutorial(page).getByText("Progress saved")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: /Continue/ })).toBeVisible();
    await page.getByRole("button", { name: /Continue/ }).click();
    await expectStep(page, "maintenance");
  }

  await capture(page, run, "step-10-before-maintenance");
  await page.getByLabel(/Maintenance budget/).press("ArrowRight");
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  await capture(page, run, "step-10-after-maintenance");
  await page.getByRole("button", { name: "Continue" }).click();
  await expectStep(page, "first-profit");

  await capture(page, run, "step-11-before-first-profit");
  for (let week = 0; week < 3 && await page.getByRole("button", { name: "Continue" }).count() === 0; week++) {
    await page.getByRole("button", { name: /Simulate week/ }).click();
    await expect(page.getByText(/Profit:/)).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  await capture(page, run, "step-11-after-first-profit");
  await page.getByRole("button", { name: "Continue" }).click();
  await expectStep(page, "graduation");

  await capture(page, run, "step-12-before-graduation");
  await page.getByRole("button", { name: "Graduate" }).click();
  await expect(tutorial(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Help/ })).toBeEnabled();
  await capture(page, run, "step-12-after-normal-play");
}

test("complete fresh-state tutorial playthrough A", async ({ page }) => {
  await finishTutorial(page, "fresh-a");
  const advisor = page.getByTestId("advisor-card");
  await expect(advisor).toHaveAttribute("data-priority", "celebration");

  await page.getByRole("button", { name: /Help/ }).click();
  await expect(page.getByRole("dialog", { name: "Golfopedia" })).toBeVisible();
  await expect(advisor).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(advisor).toBeVisible();

  await page.getByRole("button", { name: "Open pause menu" }).click();
  await expect(advisor).toHaveCount(0);
  await page.getByRole("button", { name: /Options/ }).click();
  await page.getByLabel("Advisor frequency").selectOption("chatty");
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: /Resume/ }).click();
  await expect(advisor).toHaveAttribute("data-priority", "celebration");
  await advisor.getByRole("button", { name: "Got it" }).click();

  await expect(advisor).toBeVisible({ timeout: 10_000 });
  await expect(advisor.getByRole("button", { name: "Show me" })).toBeVisible();
  await advisor.getByRole("button", { name: "Show me" }).click();
  await expect(page.getByLabel("Show fix overlay")).toBeVisible();

  await page.getByRole("button", { name: "Open pause menu" }).click();
  await page.getByRole("button", { name: /Options/ }).click();
  await page.getByLabel("Advisor frequency").selectOption("off");
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: /Resume/ }).click();
  await expect(advisor).toHaveCount(0);
});

test("complete fresh-state tutorial playthrough B with reload resume and rerun", async ({ page }) => {
  await finishTutorial(page, "fresh-b", true);
  await page.getByRole("button", { name: "Tutorial" }).click();
  await expectStep(page, "meet-land");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Show me the tools" }).click();
  const rerunCanvas = await gameCanvas(page);
  for (const point of [{ x: 380, y: 220 }, { x: 400, y: 230 }, { x: 420, y: 240 }, { x: 440, y: 250 }]) {
    await rerunCanvas.click({ position: point });
  }
  await page.getByRole("button", { name: "Continue" }).click();
  await expectStep(page, "place-hole");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "I see it" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  // A rerun on an already completed nine-hole course reconciles immediately;
  // it must not strand the player on an already-satisfied construction step.
  await expectStep(page, "watch-golfers");
  if (await page.getByRole("button", { name: "Continue" }).count() === 0) {
    await page.getByTitle("Speed 1x").click();
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  }
  await page.getByRole("button", { name: "Continue" }).click();
  await expectStep(page, "weekly-report");
  await page.getByRole("button", { name: "Continue" }).click();
  await expectStep(page, "green-fee");
  await page.getByLabel(/Green fee/).press("ArrowRight");
  await page.getByRole("button", { name: "Continue" }).click();
  await expectStep(page, "maintenance");
  await page.getByLabel(/Maintenance budget/).press("ArrowRight");
  await page.getByRole("button", { name: "Continue" }).click();
  await expectStep(page, "first-profit");
  await page.getByRole("button", { name: "Continue" }).click();
  await expectStep(page, "graduation");
  await capture(page, "rerun", "late-skip-before-graduation");
  // The rerun remains skippable even at the final lesson.
  await expect(page.getByRole("button", { name: "Skip tutorial" })).toBeVisible();
  await page.getByRole("button", { name: "Skip tutorial" }).click();
  await expect(tutorial(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Help/ })).toBeEnabled();
});

test("initial and mid-tutorial skip paths remain playable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Quick Start/ }).click();
  await page.getByRole("button", { name: "Skip tutorial" }).click();
  await expect(page.getByRole("dialog", { name: "First-launch tutorial" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Paint" })).toBeEnabled();

  await page.getByRole("button", { name: "Tutorial" }).click();
  await page.getByRole("button", { name: "Show me the tools" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Skip tutorial" }).click();
  await expect(tutorial(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Paint" })).toBeEnabled();
});

test("Golfopedia global entry, keyboard close, and every data-driven entry", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Quick Start/ }).click();
  await page.getByRole("button", { name: "Skip tutorial" }).click();
  await page.getByRole("button", { name: /Help/ }).click();
  await expect(page.getByRole("dialog", { name: "Golfopedia" })).toBeVisible();
  await expect(page.getByLabel("Search Golfopedia")).toBeFocused();

  const terrain = ["Fairway", "Rough", "Deep Rough", "Sand", "Water", "Green", "Tee", "Path"];
  for (const title of terrain) {
    await page.getByRole("button", { name: title, exact: true }).click();
    await expect(page.getByTestId("golfopedia-entry")).toContainText(title);
  }
  await page.getByRole("tab", { name: "Golfers", exact: true }).click();
  const golferButtons = page.getByRole("dialog", { name: "Golfopedia" }).locator("nav button");
  await expect(golferButtons).toHaveCount(6);
  for (const button of await golferButtons.all()) {
    const title = await button.innerText();
    await button.click();
    await expect(page.getByTestId("golfopedia-entry")).toContainText(title);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Golfopedia" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Help/ })).toBeFocused();
});

test("representative delegated and contextual tooltips work by mouse and keyboard", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Quick Start/ }).click();
  await page.getByRole("button", { name: "Skip tutorial" }).click();

  const help = page.getByRole("button", { name: /Help/ });
  await help.hover();
  await expect(page.getByRole("tooltip")).toContainText("searchable reference");
  await page.mouse.move(20, 20);
  await expect(page.getByRole("tooltip")).toHaveCount(0);

  await page.getByRole("button", { name: "Cozy" }).click();
  const contextualCards = [
    ["Cash help", "management-cash"],
    ["Reputation help", "management-reputation"],
    ["Condition help", "management-condition"],
    ["Open holes help", "management-demand"],
  ] as const;
  for (const [label, entry] of contextualCards) {
    const contextualCard = page.getByLabel(label);
    await contextualCard.focus();
    await expect(contextualCard.getByRole("tooltip")).toBeVisible();
    await contextualCard.getByRole("button", { name: /Learn more in Golfopedia/ }).click();
    await expect(page.getByTestId("golfopedia-entry")).toHaveAttribute("data-entry-id", entry);
    await page.keyboard.press("Escape");
  }

  await page.getByRole("button", { name: "Architect" }).click();
  const fairway = page.getByRole("button", { name: "fairway", exact: true });
  await fairway.focus();
  await expect(page.getByRole("tooltip")).toContainText("Build $");
  await page.getByRole("button", { name: /Learn more in Golfopedia/ }).click();
  await expect(page.getByTestId("golfopedia-entry")).toHaveAttribute("data-entry-id", "terrain-fairway");
  await page.keyboard.press("Escape");
  await expect(fairway).toBeFocused();
});

test("back, modal close, and Escape paths do not trap the player", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /New Game/ }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: /Quick Start/ })).toBeVisible();

  await page.getByRole("button", { name: /Options/ }).click();
  await page.getByRole("button", { name: "Close options" }).click();
  await page.getByRole("button", { name: /Options/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Options" })).toHaveCount(0);
  await page.getByRole("button", { name: /Options/ }).click();
  await page.getByLabel("Advisor frequency").selectOption("chatty");
  await page.getByRole("button", { name: "Done" }).click();


  await page.getByRole("button", { name: /Quick Start/ }).click();
  await expect(page.getByRole("dialog", { name: "First-launch tutorial" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "First-launch tutorial" })).toHaveCount(0);
  await expect(page.getByTestId("advisor-card")).toHaveAttribute("data-priority", "hint");
  await page.getByTestId("advisor-card").getByRole("button", { name: "Got it" }).click();

  await page.getByRole("button", { name: "Open pause menu" }).click();
  await page.keyboard.press("Escape");
});

test("responsive, increased text, and reduced-motion layouts remain usable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Options/ }).click();
  await page.getByRole("tab", { name: "Accessibility" }).click();
  await page.getByLabel("Text scale").selectOption("130");
  await page.getByLabel("Reduced motion").check();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: /Quick Start/ }).click();
  await page.getByRole("button", { name: "Skip tutorial" }).click();

  const viewports = [
    { width: 1280, height: 720, name: "1280x720" },
    { width: 1440, height: 900, name: "1440x900" },
    { width: 2560, height: 1440, name: "2560x1440" },
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("button", { name: /Help/ })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport + 1);
    await capture(page, "visual", `${viewport.name}-text-130-reduced-motion`);
  }
  await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
});
