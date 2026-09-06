import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const evidenceDir = path.join(process.cwd(), "artifacts", "zk-686", "playwright");
mkdirSync(evidenceDir, { recursive: true });
test.setTimeout(900_000);
// The animated Pixi canvas makes retained traces/videos enormous during this
// deliberately long real-authoring acceptance path. Stage screenshots and the
// two intentional product-evidence captures remain available.
test.use({ trace: "off", video: "off", screenshot: "only-on-failure" });
test.beforeEach(async ({ page }) => page.setDefaultTimeout(30_000));

type Surface = ReturnType<NonNullable<Window["__coursecraftTest"]>["terrainSurfaceState"]>;

function overlay(page: Page) {
  return page.getByTestId("tutorial-overlay");
}

async function expectStep(page: Page, stage: string) {
  await expect(overlay(page)).toHaveAttribute("data-step-id", stage, { timeout: 30_000 });
}

async function canvas(page: Page) {
  const target = page.locator(".cc-pixi-stage canvas");
  await expect(target).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest));
  return target;
}

function candidateRoute(surface: Surface) {
  const { width, height, owned, elevations } = surface;
  const occupied = surface.holes.flatMap((hole) => [hole.tee, hole.green].filter(Boolean));
  const flatMarkerSite = (point: { x: number; y: number }) => {
    const footprint = [];
    for (let y = point.y - 1; y <= point.y + 1; y++) {
      for (let x = point.x - 1; x <= point.x + 1; x++) footprint.push(elevations[y * width + x] ?? 0);
    }
    return Math.max(...footprint) - Math.min(...footprint) <= 1;
  };
  for (let y = 4; y < height - 4; y += 2) {
    for (let x = 4; x + 12 < width - 4; x++) {
      const start = { x, y };
      const end = { x: x + 10, y };
      if (!Array.from({ length: 11 }, (_, offset) => owned[y * width + x + offset]).every(Boolean)) continue;
      if (!flatMarkerSite(start) || !flatMarkerSite(end)) continue;
      if ([start, end].some((point) => occupied.some((known) => known && Math.hypot(known.x - point.x, known.y - point.y) < 3))) continue;
      return [start, end] as const;
    }
  }
  throw new Error("No owned first-hole route found");
}

async function expectLauncherClear(page: Page) {
  const [launcher, action] = await Promise.all([
    page.getByTestId("bug-report-launcher").boundingBox(),
    page.getByTestId("tutorial-primary-action").boundingBox(),
  ]);
  if (!launcher || !action) throw new Error("Tutorial action or bug-report launcher has no visible rectangle");
  const overlaps = action.x < launcher.x + launcher.width
    && action.x + action.width > launcher.x
    && action.y < launcher.y + launcher.height
    && action.y + action.height > launcher.y;
  expect(overlaps, `tutorial action ${JSON.stringify(action)} overlaps launcher ${JSON.stringify(launcher)}`).toBe(false);
}

async function expectTutorialInViewport(page: Page) {
  const card = await page.getByTestId("tutorial-card").boundingBox();
  const viewport = page.viewportSize();
  if (!card || !viewport) throw new Error("Tutorial card or viewport rectangle unavailable");
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.y).toBeGreaterThanOrEqual(0);
  expect(card.x + card.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(card.y + card.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function dismissAchievementToasts(page: Page) {
  const toast = page.getByTestId("achievement-toast");
  for (let index = 0; index < 6 && await toast.count(); index++) {
    await toast.first().evaluate((element: HTMLElement) => element.click()).catch(() => undefined);
  }
  await expect(toast).toHaveCount(0);
}

async function dismissPostOperationOverlays(page: Page, freezeLive = false) {
  const pause = async () => {
    if (!freezeLive) return;
    await page.evaluate(() => window.__coursecraftTest!.pauseLiveSimulation());
    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text!()).simulation.speed)).toBe("paused");
  };
  await pause();
  let consecutiveClearPasses = 0;
  for (let pass = 0; pass < 12 && consecutiveClearPasses < 2; pass++) {
    let closedLayer = false;
    const weekClose = page.getByTestId("week-close-report");
    if (await weekClose.isVisible().catch(() => false)) {
      await page.getByTestId("week-close-continue").click();
      closedLayer = true;
      await pause();
    }
    const livingClub = page.getByTestId("living-club-panel");
    if (await livingClub.isVisible().catch(() => false)) {
      await livingClub.getByRole("button", { name: "Close", exact: true }).click();
      closedLayer = true;
      await pause();
    }
    const teeSetupOffer = page.getByTestId("tee-setup-offer");
    if (await teeSetupOffer.isVisible().catch(() => false)) {
      await teeSetupOffer.getByRole("button", { name: "Not now", exact: true }).click();
      closedLayer = true;
      await pause();
    }
    const advisor = page.getByTestId("advisor-card");
    if (await advisor.isVisible().catch(() => false)) {
      await advisor.getByRole("button", { name: "Got it", exact: true }).click();
      closedLayer = true;
      await pause();
    }
    consecutiveClearPasses = closedLayer ? 0 : consecutiveClearPasses + 1;
    await page.evaluate(() => new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))));
  }
  expect(consecutiveClearPasses, "post-operation overlays did not stabilize").toBe(2);
}

async function setInGameLocale(page: Page, locale: "en" | "pseudo") {
  await page.getByRole("button").filter({ hasText: "☰" }).click();
  const pause = page.getByTestId("pause-overlay");
  await expect(pause).toBeVisible();
  await pause.locator("button").nth(3).click();
  const settings = page.getByTestId("options-screen");
  await settings.getByRole("tab").nth(3).click();
  await settings.locator("select").last().selectOption(locale);
  await settings.locator("footer button").last().click();
  await pause.locator("button").first().click();
  await expect(page.locator("html")).toHaveAttribute("data-locale", locale);
}

async function pagePoint(page: Page, target: Locator, point: { x: number; y: number }) {
  const projection = await page.evaluate(({ x, y }) => {
    const renderer = window.__coursecraftPixiTest!;
    return { point: renderer.tileToScreen(x, y), viewport: renderer.viewport() };
  }, point);
  const box = await target.boundingBox();
  if (!box || !projection.point || !projection.viewport) throw new Error("Course projection unavailable");
  return {
    x: box.x + projection.point.x * box.width / projection.viewport.width,
    y: box.y + projection.point.y * box.height / projection.viewport.height,
  };
}

async function dragRoute(page: Page, target: Locator, start: { x: number; y: number }, end: { x: number; y: number }) {
  const from = await pagePoint(page, target, start);
  const to = await pagePoint(page, target, end);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

async function clickTile(page: Page, target: Locator, point: { x: number; y: number }) {
  const projected = await pagePoint(page, target, point);
  await page.mouse.click(projected.x, projected.y);
}

async function begin(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Quick Start/ }).click();
  await expect(page.getByRole("dialog", { name: "First-launch tutorial" })).toBeVisible();
  await page.getByRole("button", { name: "Start guided course" }).click();
  await expectStep(page, "welcome");
}

async function beginClassic(page: Page) {
  await beginProfile(page, "classic");
}

async function beginProfile(page: Page, profile: "classic" | "simulation", accept = true) {
  await page.goto("/");
  await page.getByRole("button", { name: "New Game" }).click();
  await page.getByRole("button", { name: "Sandbox" }).click();
  await page.getByRole("button", { name: "Next →" }).click();
  await page.getByRole("button", { name: "Next →" }).click();
  await page.getByTestId(`experience-profile-${profile}`).click();
  await page.getByRole("button", { name: "Next →" }).click();
  await page.getByRole("button", { name: "⛳ Start building" }).click();
  await expect(page.getByRole("dialog", { name: "First-launch tutorial" })).toBeVisible();
  if (accept) {
    await page.getByRole("button", { name: "Start guided course" }).click();
    await expectStep(page, "welcome");
  }
}

async function buildFirstHole(page: Page, operatorDemo = false) {
  await page.getByRole("button", { name: "Start designing" }).click();
  await expectStep(page, "paint-fairway");
  const courseCanvas = await canvas(page);
  if (operatorDemo) await page.keyboard.press("f");
  else await page.evaluate(() => window.__coursecraftPixiTest!.fitWholeCourse());
  const surface = await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState());
  const [start, end] = candidateRoute(surface);
  await dragRoute(page, courseCanvas, start, end);
  await expect(overlay(page).getByRole("button", { name: "Continue" })).toBeEnabled();
  await overlay(page).getByRole("button", { name: "Continue" }).click();
  await expectStep(page, "place-hole");
  await clickTile(page, await canvas(page), start);
  await expect(page.getByText("Click to place green", { exact: true })).toBeVisible();
  await clickTile(page, await canvas(page), end);
  await expect(overlay(page).getByRole("button", { name: "Continue" })).toBeEnabled();
  await overlay(page).getByRole("button", { name: "Continue" }).click();
  await expectStep(page, "route-readability");
  await page.getByRole("button", { name: "The route reads clearly" }).click();
  await expectStep(page, "validate-hole");
  await expect(overlay(page).getByRole("button", { name: "Continue" })).toBeEnabled();
  await overlay(page).getByRole("button", { name: "Continue" }).click();
  await expectStep(page, "invite-group");
}

async function buildAdditionalHole(page: Page, freezeLive = false) {
  await dismissPostOperationOverlays(page, freezeLive);
  await page.evaluate(() => window.__coursecraftPixiTest!.fitWholeCourse());
  const surface = await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState());
  const [start, end] = candidateRoute(surface);
  await page.locator('[data-tutorial-target="editor-tools"]').getByRole("button", { name: "Design", exact: true }).click();
  await dragRoute(page, await canvas(page), start, end);
  await page.getByRole("button", { name: "Hole Wizard" }).click();
  await clickTile(page, await canvas(page), start);
  await expect(page.getByText("Click to place green", { exact: true })).toBeVisible();
  await clickTile(page, await canvas(page), end);
}

test.describe("ZK-1106 private operator opening", () => {
  test.use({ video: "on", trace: "retain-on-failure" });
  test("real UI builds, watches, edits and compares one private hole", async ({ page }, testInfo) => {
    const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text!()));
    const capture = async (name: string) => {
      const file = testInfo.outputPath(`${name}.png`);
      await page.screenshot({ path: file });
      await testInfo.attach(name, { path: file, contentType: "image/png" });
    };
    const started = Date.now();
    await page.goto("/");
    await page.getByRole("button", { name: /First-hole operator demo/ }).click();
    await expectStep(page, "welcome");
    expect((await state()).experience.profile).toBe("classic");
    await capture("01-new-private-course");
    await buildFirstHole(page, true);
    await capture("02-built-and-ready-to-invite");
    const before = await state();
    await page.getByRole("button", { name: "Invite group", exact: true }).click();
    await expectStep(page, "observe-play");
    await expect(page.getByTestId("opening-current-shot")).not.toBeEmpty();
    await capture("03-recorded-shot-on-course");
    await page.getByRole("button", { name: "Next recorded shot", exact: true }).click();
    const observed = await state();
    expect(observed.onboarding.opening.cursor).toBe(1);
    expect(observed.economy).toEqual(before.economy);
    expect(observed.simulation.arrivalsRemaining).toBe(0);
    await expect(overlay(page).getByText("Progress saved", { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /Continue/ }).click();
    await expectStep(page, "observe-play");
    expect((await state()).onboarding.opening.cursor).toBe(1);
    await page.getByRole("button", { name: "Skip playback to summary", exact: true }).click();
    await page.getByRole("button", { name: "Review reactions", exact: true }).click();
    await expectStep(page, "review-reaction");
    await expect(page.getByTestId("opening-diagnosis")).toContainText("Landing-area opportunity");
    await capture("04-evidence-backed-opportunity");
    await page.getByRole("button", { name: "Receive preview pennant", exact: true }).click();
    await page.getByRole("button", { name: "Improve this hole", exact: true }).click();
    await expectStep(page, "improve-hole");
    const rewarded = await state();
    expect(rewarded.economy.cash).toBe(before.economy.cash + 750);
    const target = rewarded.onboarding.opening.targetCells[0];
    expect(target).toBeDefined();
    const width = rewarded.course.width;
    const point = { x: target % width, y: Math.floor(target / width) };
    await dragRoute(page, await canvas(page), point, { x: point.x + 1, y: point.y });
    await expect(page.getByRole("button", { name: "Retest the same group", exact: true })).toBeEnabled();
    await capture("05-real-fairway-edit");
    const edited = await state();
    expect(edited.economy.cash).toBeLessThan(rewarded.economy.cash);
    await page.getByRole("button", { name: "Retest the same group", exact: true }).click();
    await expectStep(page, "retest-play");
    await page.getByRole("button", { name: "Skip playback to summary", exact: true }).click();
    await page.getByRole("button", { name: "Compare visits", exact: true }).click();
    await expectStep(page, "compare-preview");
    await expect(page.getByTestId("opening-comparison")).toBeVisible();
    const compared = await state();
    expect(compared.economy).toEqual(edited.economy);
    expect(compared.onboarding.preview).toEqual(observed.onboarding.preview);
    expect(compared.onboarding.reward).toEqual(rewarded.onboarding.reward);
    expect(compared.onboarding.opening.candidate.runSeed).toBe(before.onboarding.opening.candidate?.runSeed ?? 424242);
    await expectTutorialInViewport(page);
    await capture("06-honest-comparison");
    await testInfo.attach("opening-evidence-context", { body: JSON.stringify({ seed: 424242, viewport: page.viewportSize(), elapsedSeconds: (Date.now() - started) / 1000, before: observed.onboarding.preview, after: compared.onboarding.opening.candidate, economy: { before: before.economy, rewarded: rewarded.economy, edited: edited.economy } }, null, 2), contentType: "application/json" });
    await page.getByRole("button", { name: "Finish private demo", exact: true }).click();
    await expect(overlay(page)).toHaveCount(0);
    expect((await state()).onboarding).toMatchObject({ active: false, completion: "creative" });
  });
});

test("one-hole invited preview is save-safe, evidence-backed, and rewards exactly once", async ({ page }) => {
  await begin(page);
  await buildFirstHole(page);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text!()).editor.activeHole)).toBe(1);
  await expect(page.getByRole("heading", { name: "Hole 1" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.routeOverlay())).toMatchObject({ visibleLayers: 1 });
  expect((await page.evaluate(() => window.__coursecraftPixiTest!.routeOverlay())).points).toBeGreaterThan(1);
  await expectTutorialInViewport(page);
  await expectLauncherClear(page);
  const beforePreview = await page.evaluate(() => JSON.parse(window.render_game_to_text!()).economy);
  await page.screenshot({ path: path.join(evidenceDir, "01-before-private-invite.png") });

  await page.getByRole("button", { name: "Invite group" }).click();
  await expectStep(page, "observe-play");
  await expect(page.getByTestId("invited-preview-evidence")).toBeVisible();
  const observed = await page.evaluate(() => JSON.parse(window.render_game_to_text!()));
  expect(observed.onboarding.preview.group).toHaveLength(2);
  expect(observed.onboarding.preview.group.every((golfer: { shots: number; thought: string }) => golfer.shots > 0 && golfer.thought.length > 0)).toBe(true);
  expect(observed.simulation.arrivalsRemaining).toBe(0);
  expect(observed.economy).toEqual(beforePreview);

  await expect(overlay(page).getByText("Progress saved")).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await page.getByRole("button", { name: /Continue/ }).click();
  await expectStep(page, "observe-play");
  await expect(page.getByTestId("invited-preview-evidence")).toBeVisible();
  await page.getByRole("button", { name: "Review reactions" }).click();
  await expectStep(page, "review-reaction");
  await page.getByRole("button", { name: "Receive preview pennant" }).click();
  await expectStep(page, "creative-reward");
  await expect(page.getByTestId("invited-preview-reward-receipt")).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text!()).editor.activeHole)).toBe(1);
  await expectTutorialInViewport(page);
  await expectLauncherClear(page);
  const rewarded = await page.evaluate(() => JSON.parse(window.render_game_to_text!()));
  expect(rewarded.economy.cash).toBe(beforePreview.cash + 750);
  expect(rewarded.economy.reputation).toBe(beforePreview.reputation + 1);
  expect(rewarded.onboarding.reward).toMatchObject({ id: "founders-preview-pennant", cash: 750, reputation: 1 });
  await page.screenshot({ path: path.join(evidenceDir, "02-after-preview-reward.png") });

  await page.reload();
  await page.getByRole("button", { name: /Continue/ }).click();
  await expectStep(page, "creative-reward");
  const replay = await page.evaluate(() => JSON.parse(window.render_game_to_text!()).economy);
  expect(replay).toEqual(rewarded.economy);
  expect(rewarded.onboarding.profile).toBe("relaxed");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(overlay(page)).toHaveCount(0);
  const completed = await page.evaluate(() => JSON.parse(window.render_game_to_text!()).onboarding);
  expect(completed).toMatchObject({ active: false, completion: "creative" });
});

test("keyboard, modal, responsive, tooltip, restart, and Simulation JIT paths remain usable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Options/ }).click();
  await page.getByRole("tab", { name: "Accessibility" }).click();
  await page.getByLabel("Text scale").selectOption("130");
  await page.getByLabel("Reduced motion").check();
  await page.getByRole("button", { name: "Done" }).click();

  await beginProfile(page, "simulation", false);
  await expect(page.getByRole("button", { name: "Start guided course" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "First-launch tutorial" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Game paused" })).toHaveCount(0);
  await dismissAchievementToasts(page);
  await setInGameLocale(page, "pseudo");
  const tutorialLauncher = page.getByTestId("tutorial-launcher");
  await expect(tutorialLauncher).toContainText(/Tütôrïál/);
  await tutorialLauncher.click();
  await expectStep(page, "welcome");
  const welcomeDialog = page.getByRole("dialog", { name: /Shápë ôñë mëmôráblë hôlë/ });
  await expect(welcomeDialog).toBeVisible();
  await expect(welcomeDialog).toContainText(/Wë wïll páïñt á fáïr rôütë/);
  await expectTutorialInViewport(page);
  await expectLauncherClear(page);
  const pseudoPrimary = page.getByTestId("tutorial-primary-action");
  await expect(pseudoPrimary).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(welcomeDialog.getByRole("button", { name: /Rëstárt güïdë/ })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(pseudoPrimary).toBeFocused();
  await page.keyboard.press("Escape");
  await expectStep(page, "welcome");
  await expect(welcomeDialog).toBeVisible();
  await expect(pseudoPrimary).toBeFocused();
  await expect(page.getByRole("dialog", { name: /Gámë páüsëd/ })).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expectStep(page, "paint-fairway");
  const pseudoPaintDialog = page.getByRole("dialog", { name: /Páïñt á wëlçômïñg fáïrwáÿ/ });
  await expect(pseudoPaintDialog.getByRole("button", { name: /Rëstárt güïdë/ })).toBeFocused();
  await expect(overlay(page).getByText(/Prôgrëss sávëd/)).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => localStorage.setItem("coursecraft_locale", "en"));
  await page.reload();
  await page.getByRole("button", { name: /Continue/ }).click();
  await expectStep(page, "paint-fairway");
  const paintDialog = page.getByRole("dialog", { name: "Paint a welcoming fairway" });
  await expect(paintDialog.getByRole("button", { name: "Restart guide" })).toBeFocused();
  await page.getByRole("button", { name: "Restart guide" }).click();
  await expectStep(page, "welcome");
  await expect(page.getByTestId("tutorial-primary-action")).toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
  expect(await page.evaluate(() => document.documentElement.style.fontSize)).toBe("130%");
  for (const viewport of [{ width: 1280, height: 720 }, { width: 800, height: 700 }]) {
    await page.setViewportSize(viewport);
    await expectTutorialInViewport(page);
    await expectLauncherClear(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await buildFirstHole(page);
  await page.getByRole("button", { name: "Invite group" }).click();
  await expectStep(page, "observe-play");
  await page.getByRole("button", { name: "Review reactions" }).click();
  await expectStep(page, "review-reaction");
  await page.getByRole("button", { name: "Receive preview pennant" }).click();
  await expectStep(page, "creative-reward");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.getByTestId("tutorial-launcher")).toBeFocused();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text!()).onboarding)).toMatchObject({
    profile: "simulation",
    active: false,
    completion: "creative",
    jitQueue: ["advanced-design", "enterprise", "legacy"],
  });

  const help = page.getByRole("button", { name: /Help/ });
  await help.hover();
  await expect(page.getByRole("tooltip")).toContainText("searchable reference");
  await help.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Golfopedia" })).toBeVisible();
  await expect(page.getByLabel("Search Golfopedia")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(help).toBeFocused();
  await page.getByRole("button", { name: "Open pause menu" }).click();
  await expect(page.getByRole("dialog", { name: "Game paused" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Game paused" })).toHaveCount(0);
});

test("Classic completes three-hole public operations through weekly results and graduation", async ({ page }) => {
  test.setTimeout(1_500_000);
  await beginClassic(page);
  await buildFirstHole(page);
  await page.getByRole("button", { name: "Invite group" }).click();
  await expectStep(page, "observe-play");
  await page.getByRole("button", { name: "Review reactions" }).click();
  await expectStep(page, "review-reaction");
  await page.getByRole("button", { name: "Receive preview pennant" }).click();
  await expectStep(page, "creative-reward");
  await page.getByRole("button", { name: "Continue" }).click();
  await expectStep(page, "public-three");
  await buildAdditionalHole(page);
  await expectStep(page, "public-three");
  await buildAdditionalHole(page);
  await expect(overlay(page).getByRole("button", { name: "Continue" })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text!()).onboarding.milestones)).toEqual([3]);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text!()).onboarding.publicOperation)).toMatchObject({
    unlocked: true,
    validHoles: 3,
  });
  await page.evaluate(() => {
    for (let index = 0; index < 8; index++) window.advanceTime?.(2_000);
  });
  await expect.poll(() => page.evaluate(() => {
    const simulation = JSON.parse(window.render_game_to_text!()).simulation;
    return simulation.onCourse + simulation.roundsToday;
  })).toBeGreaterThan(0);
  await overlay(page).getByRole("button", { name: "Continue" }).click();
  await expectStep(page, "course-pricing");
  await page.getByLabel(/Green fee/).press("ArrowRight");
  await overlay(page).getByRole("button", { name: "Continue" }).click();
  await expectStep(page, "staffing");
  await page.getByRole("button", { name: /Staff level/ }).click();
  await overlay(page).getByRole("button", { name: "Continue" }).click();
  await expectStep(page, "maintenance");
  await page.getByLabel(/Maintenance budget/).press("ArrowRight");
  await overlay(page).getByRole("button", { name: "Continue" }).click();
  await expectStep(page, "weekly-results");
  const currentWeek = await page.evaluate(() => window.__coursecraftTest!.state().week);
  await page.evaluate(() => {
    for (let index = 0; index < 1_120; index++) window.advanceTime?.(2_000);
  });
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().week), { timeout: 60_000 }).toBe(currentWeek + 1);
  const weekCloseReport = page.getByTestId("week-close-report");
  await expect.poll(async () => await weekCloseReport.isVisible() || await overlay(page).getByRole("button", { name: "Continue" }).isEnabled()).toBe(true);
  if (await weekCloseReport.isVisible()) await page.getByTestId("week-close-continue").click();
  await expect(page.getByText("Last week", { exact: true })).toBeVisible();
  await expect(overlay(page).getByRole("button", { name: "Continue" })).toBeEnabled();
  await overlay(page).getByRole("button", { name: "Continue" }).click();
  await expectStep(page, "graduation");
  const graduationWeekClose = page.getByTestId("week-close-report");
  await expect(graduationWeekClose).toBeVisible();
  await graduationWeekClose.getByTestId("week-close-continue").click();
  await expect(graduationWeekClose).toHaveCount(0);
  await overlay(page).getByTestId("tutorial-primary-action").click();
  await expect(overlay(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text!()).onboarding)).toMatchObject({
    profile: "classic",
    active: false,
    completion: "full",
  });
  await expect(page.getByRole("button", { name: /Help/ })).toBeEnabled();

  // Continue the same authoritative Classic run from its public three-hole
  // operation to a real nine-hole course. This preserves one browser trace
  // across design -> observe -> manage -> improve -> expand instead of using
  // a fixture whose round length merely says nine.
  await dismissAchievementToasts(page);
  await dismissPostOperationOverlays(page, true);
  for (let expectedHoles = 4; expectedHoles <= 9; expectedHoles++) {
    await buildAdditionalHole(page, true);
    await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState().holes.filter((hole) => hole.valid).length)).toBe(expectedHoles);
  }
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text!()).onboarding.milestones)).toEqual([3, 6, 9]);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text!()).onboarding.publicOperation)).toMatchObject({
    unlocked: true,
    validHoles: 9,
  });
  await page.screenshot({ path: path.join(evidenceDir, "03-classic-nine-hole-management-cycle.png"), fullPage: true });
});

test("week-close report owns pointer and keyboard input across supported viewports", async ({ page }) => {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByRole("button", { name: "Quick Start" }).click();
    const tutorialOffer = page.getByRole("dialog", { name: "First-launch tutorial" });
    if (await tutorialOffer.count()) await tutorialOffer.getByRole("button", { name: "Skip tutorial" }).click();

    const pause = page.getByRole("button", { name: "Open pause menu" });
    await pause.focus();
    await expect(pause).toBeFocused();
    await page.evaluate(() => window.__coursecraftTest!.startWeekCloseFixture(3));

    const report = page.getByTestId("week-close-report");
    const continueButton = report.getByTestId("week-close-continue");
    await expect(report).toBeVisible({ timeout: 15_000 });
    await expect(continueButton).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>(".cc-main")?.inert)).toBe(true);

    const main = await page.locator(".cc-main").boundingBox();
    if (!main) throw new Error("Main game surface is unavailable");
    const blockedPoint = { x: main.x + 4, y: main.y + 4 };
    await expect.poll(() => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="week-close-report"]') !== null, blockedPoint)).toBe(true);
    await page.mouse.click(blockedPoint.x, blockedPoint.y);
    await expect(report).toBeVisible();
    await expect(page.getByTestId("pause-overlay")).toHaveCount(0);

    await page.keyboard.press("Tab");
    await expect(continueButton).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(continueButton).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(report).toHaveCount(0);
    await expect(pause).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>(".cc-main")?.inert)).toBe(false);
  }
});
