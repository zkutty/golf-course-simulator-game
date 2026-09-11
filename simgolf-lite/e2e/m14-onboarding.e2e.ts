import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const evidenceDir = path.join(process.cwd(), "artifacts", "zk-686", "playwright");
mkdirSync(evidenceDir, { recursive: true });
test.setTimeout(900_000);
// The animated Pixi canvas makes retained traces/videos enormous during this
// deliberately long real-authoring acceptance path. Stage screenshots and the
// two intentional product-evidence captures remain available.
const openingEvidence = process.env.COURSECRAFT_OPENING_EVIDENCE === "1";
test.use({ trace: openingEvidence ? "retain-on-failure" : "off", video: openingEvidence ? "on" : "off", screenshot: "only-on-failure" });
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

function candidateRoute(surface: Surface, boundaryMargin = 0) {
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
      // The operator demo teaches landing-area width, not estate-boundary relief.
      // Select geometry before any shots are resolved; never search seeds/scores.
      let hasOwnedMargin = true;
      for (let row = y - boundaryMargin; row <= y + boundaryMargin; row++) {
        for (let col = x - boundaryMargin; col <= end.x + boundaryMargin; col++) {
          if (row < 0 || col < 0 || row >= height || col >= width || !owned[row * width + col]) hasOwnedMargin = false;
        }
      }
      if (!hasOwnedMargin) continue;
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

async function expectComparisonReadable(page: Page) {
  const summary = page.getByTestId("opening-comparison-summary");
  const comparison = page.getByTestId("opening-comparison");
  await expect(page.getByTestId("opening-comparison-state")).toBeVisible();
  await expect(summary).toBeVisible();
  await expect(comparison).toBeVisible();
  await page.getByTestId("opening-comparison-risk").first().scrollIntoViewIfNeeded();
  await expect(page.getByTestId("opening-comparison-risk").first()).toBeVisible();
  await expectTutorialInViewport(page);
  const widths = await page.evaluate(() => {
    const details = document.querySelector<HTMLElement>('[data-testid="opening-demo-details"]');
    const table = document.querySelector<HTMLElement>('[data-testid="opening-comparison"]');
    return {
      documentFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
      detailsFit: details ? details.scrollWidth <= details.clientWidth + 1 : false,
      tableFit: table ? table.scrollWidth <= table.clientWidth + 1 : false,
    };
  });
  expect(widths).toEqual({ documentFits: true, detailsFit: true, tableFit: true });
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

async function focusOpeningHole(page: Page) {
  // The previous real authoring drag can leave Pixi's edge-pan pointer at the
  // course boundary. Re-establish an interior pointer position before the
  // visible Focus action so the test observes only the requested camera glide.
  const stage = await canvas(page);
  const bounds = await stage.boundingBox();
  if (!bounds) throw new Error("Preview-hole canvas has no visible bounds");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.evaluate(() => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())));
  await page.getByRole("button", { name: /^Focus (?:on preview hole|and clear the canvas)$/ }).click();
  // Observe the real camera glide; never mutate the renderer to make a click pass.
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    let previous: { x: number; y: number } | null = null;
    let stable = 0;
    const timeout = window.setTimeout(() => reject(new Error("Preview-hole camera did not settle within 15 seconds")), 15_000);
    const sample = () => {
      const point = window.__coursecraftPixiTest!.tileToScreen(0, 0);
      if (point && previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.01) stable += 1;
      else stable = 0;
      if (stable >= 12) {
        window.clearTimeout(timeout);
        resolve();
        return;
      }
      previous = point;
      window.requestAnimationFrame(sample);
    };
    window.requestAnimationFrame(sample);
  }));
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
  const [start, end] = candidateRoute(surface, operatorDemo ? 4 : 0);
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
  test.use({ hasTouch: true });

  test("real UI builds, watches, edits and compares one private hole", async ({ page }, testInfo) => {
    const browserErrors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text!()));
    const capture = async (name: string) => {
      if (process.env.ZK1107_EVIDENCE) {
        const original = page.viewportSize()!;
        for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
          await page.setViewportSize(viewport);
          await page.waitForTimeout(500);
          const directory = `artifacts/zk-1107/${process.env.ZK1107_EVIDENCE}`;
          mkdirSync(directory, { recursive: true });
          await page.screenshot({ path: `${directory}/${name}-${viewport.width}x${viewport.height}.png` });
          await expectTutorialInViewport(page);
        }
        await page.setViewportSize(original);
        await page.waitForTimeout(500);
      }
      const file = testInfo.outputPath(`${name}.png`);
      await page.screenshot({ path: file });
      await testInfo.attach(name, { path: file, contentType: "image/png" });
    };
    type PreviewShot = { id: string; number: number; club: string; from: { x: number; y: number }; landing: { x: number; y: number }; rest: { x: number; y: number }; penalties: number };
    type PreviewSummary = { id: string; holeId: string; group: Array<{ name: string; shots: number; shotEvidence: PreviewShot[] }> };
    const previewSummary = (value: unknown): PreviewSummary => {
      if (!value || typeof value !== "object") throw new Error("Expected a retained private-preview receipt");
      const candidate = value as { id?: unknown; holeId?: unknown; group?: unknown };
      if (typeof candidate.id !== "string" || typeof candidate.holeId !== "string" || !Array.isArray(candidate.group)) throw new Error("Private-preview receipt is malformed");
      return {
        id: candidate.id,
        holeId: candidate.holeId,
        group: candidate.group.map((golfer) => {
          const item = golfer as { name?: unknown; shots?: unknown; shotEvidence?: unknown };
          const rawShots = Array.isArray(item.shots) ? item.shots as Array<Record<string, unknown>> : null;
          const shots = rawShots?.length ?? item.shots;
          const shotEvidence = Array.isArray(item.shotEvidence)
            ? item.shotEvidence as PreviewShot[]
            : rawShots?.map((shot) => ({
              id: shot.id as string,
              number: shot.shotNumber as number,
              club: shot.club as string,
              from: shot.from as PreviewShot["from"],
              landing: shot.landing as PreviewShot["landing"],
              rest: shot.rest as PreviewShot["rest"],
              penalties: shot.penaltyStrokes as number,
            }));
          if (typeof item.name !== "string" || !Number.isInteger(shots) || shots < 0 || !shotEvidence) throw new Error("Private-preview golfer receipt is malformed");
          return { name: item.name, shots, shotEvidence };
        }),
      };
    };
    const recordedMarkers = (evidence: PreviewSummary) => evidence.group.flatMap((golfer) => golfer.shotEvidence.map((shot) => ({ name: golfer.name, ...shot })));
    const visiblePenalty = async () => {
      const penaltyText = await page.getByTestId("opening-shot-penalty").textContent();
      const penaltyMatch = penaltyText?.match(/(\d+) penalty stroke/);
      if (!penaltyMatch) throw new Error("Missing visible penalty evidence for the current shot");
      return Number(penaltyMatch[1]);
    };
    const playEveryRecordedShot = async (evidence: PreviewSummary, intermediateCapture: string) => {
      const shots = recordedMarkers(evidence);
      expect(shots.length, "private preview must retain more than one resolved shot to prove manual playback").toBeGreaterThan(1);
      let penaltyTotal = 0;
      for (let cursor = (await state()).onboarding.opening.cursor; cursor < shots.length; cursor++) {
        const beforeStep = await state();
        const current = shots[cursor];
        expect(beforeStep.onboarding.opening.cursor, "cursor must advance exactly once per visible recorded shot").toBe(cursor);
        await expect(page.getByTestId("opening-current-shot")).toContainText(current.name);
        await expect(page.getByTestId("opening-current-shot")).toContainText(`shot ${current.number}`);
        await expect(page.getByTestId("opening-current-shot")).toHaveAttribute("data-preview-id", evidence.id);
        await expect(page.getByTestId("opening-current-shot")).toHaveAttribute("data-shot-id", current.id);
        await expect(page.getByTestId("opening-playback-frame")).toContainText(`(${current.from.x}, ${current.from.y})`);
        await expect(page.getByTestId("opening-playback-frame")).toContainText(`landing (${current.landing.x}, ${current.landing.y})`);
        await expect(page.getByTestId("opening-playback-frame")).toContainText(`lie (${current.rest.x}, ${current.rest.y})`);
        await expect(page.getByTestId("opening-demo-details")).toContainText(`Shots: ${cursor}/${shots.length}`);
        const penalty = await visiblePenalty();
        expect(penalty).toBe(current.penalties);
        penaltyTotal += penalty;
        if (cursor === 1) {
          await focusOpeningHole(page);
          await capture(intermediateCapture);
        }
        await page.getByRole("button", { name: "Next recorded shot", exact: true }).click();
        await expect.poll(() => state().then((next) => next.onboarding.opening.cursor)).toBe(cursor + 1);
      }
      expect((await state()).onboarding.opening.cursor).toBe(shots.length);
      return penaltyTotal;
    };
    const started = Date.now();
    // Keep motion enabled while exercising retained playback, speed, and
    // follow cancellation. Reduced-motion equivalence is covered separately.
    await page.emulateMedia({ reducedMotion: "no-preference" });
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
    const retainedAtStart = await state();
    const authorityHashes = retainedAtStart.onboarding.authorityHashes;
    const startFrame = retainedAtStart.onboarding.openingPlayback;
    expect(startFrame.shotId).toBe(retainedAtStart.onboarding.preview.group[0].shotEvidence[0].id);
    expect(startFrame.ball).toEqual(startFrame.shot?.from ?? retainedAtStart.onboarding.preview.group[0].shotEvidence[0].from);
    const startPixels = await (await canvas(page)).screenshot();
    await page.getByTestId("opening-speed-0.5").click();
    await page.getByTestId("opening-play-pause").click();
    await expect.poll(() => state().then((value) => value.onboarding.openingPlayback.progress)).toBeGreaterThan(0.12);
    // Playback replaces the frame every 50 ms, so use the visible control's
    // current screen position for genuine mouse input instead of retaining a
    // DOM node across a render boundary.
    const pauseBounds = await page.getByTestId("opening-play-pause").boundingBox();
    if (!pauseBounds) throw new Error("Playback pause control has no visible bounds");
    await page.mouse.click(pauseBounds.x + pauseBounds.width / 2, pauseBounds.y + pauseBounds.height / 2);
    const moving = await state();
    expect(moving.onboarding.openingPlayback.shotId).toBe(startFrame.shotId);
    expect(moving.onboarding.openingPlayback.ball).not.toEqual(startFrame.ball);
    expect(moving.onboarding.authorityHashes).toEqual(authorityHashes);
    const movingPixels = await (await canvas(page)).screenshot();
    expect(movingPixels.equals(startPixels), "retained playback must change visible canvas pixels").toBe(false);
    await page.getByTestId("opening-replay").click();
    expect((await state()).onboarding.authorityHashes).toEqual(authorityHashes);
    await page.getByTestId("opening-skip").click();
    const skipped = await state();
    expect(skipped.onboarding.opening.cursor).toBe(startFrame.total);
    expect(skipped.onboarding.authorityHashes).toEqual(authorityHashes);
    await page.getByTestId("opening-replay").click();
    expect((await state()).onboarding.opening.cursor).toBe(0);
    await page.evaluate(() => window.__coursecraftPixiTest!.focusTileForTest(0, 0, 0.8));
    const priorProjection = await page.evaluate(() => window.__coursecraftPixiTest!.tileToScreen(0, 0)!);
    await page.getByTestId("opening-follow").click();
    await expect(page.getByTestId("opening-follow")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => {
      const current = await page.evaluate(() => window.__coursecraftPixiTest!.tileToScreen(0, 0)!);
      return Math.abs(current.x - priorProjection.x) + Math.abs(current.y - priorProjection.y);
    }).toBeGreaterThan(10);
    await page.getByTestId("opening-follow").click();
    await expect.poll(async () => {
      const current = await page.evaluate(() => window.__coursecraftPixiTest!.tileToScreen(0, 0)!);
      return Math.abs(current.x - priorProjection.x) + Math.abs(current.y - priorProjection.y);
    }).toBeLessThan(2);
    await page.getByTestId("opening-follow").click();
    const panBox = await (await canvas(page)).boundingBox();
    await page.mouse.move(panBox!.x + 300, panBox!.y + 260);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(panBox!.x + 340, panBox!.y + 300, { steps: 4 });
    await page.mouse.up({ button: "middle" });
    await expect(page.getByTestId("opening-follow")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("opening-follow").click();
    await (await canvas(page)).dispatchEvent("wheel", { deltaY: -120, clientX: 400, clientY: 300 });
    await expect(page.getByTestId("opening-follow")).toHaveAttribute("aria-pressed", "false");
    expect((await state()).onboarding.authorityHashes).toEqual(authorityHashes);
    await focusOpeningHole(page);
    await capture("03-recorded-shot-on-course");
    const firstBaselinePenalty = await visiblePenalty();
    await page.getByRole("button", { name: "Next recorded shot", exact: true }).click();
    const observed = await state();
    const baselineStateReceipt = structuredClone(observed.onboarding.preview);
    const baselineReceipt = previewSummary(baselineStateReceipt);
    const baselineContext = await page.getByTestId("opening-evidence-context").textContent();
    expect(observed.onboarding.opening.cursor).toBe(1);
    expect(observed.economy).toEqual(before.economy);
    expect(observed.simulation.arrivalsRemaining).toBe(0);
    await expect(overlay(page).getByText("Progress saved", { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /Continue/ }).click();
    await expectStep(page, "observe-play");
    expect((await state()).onboarding.opening.cursor).toBe(1);
    const baselinePenalties = firstBaselinePenalty + await playEveryRecordedShot(baselineReceipt, "03b-intermediate-baseline-shot");
    expect((await state()).onboarding.preview).toEqual(baselineStateReceipt);
    await page.getByRole("button", { name: "Review reactions", exact: true }).click();
    await expectStep(page, "review-reaction");
    await expect(page.getByTestId("opening-diagnosis")).toContainText("Observed:");
    await expect(page.getByTestId("opening-diagnosis")).toContainText("shot");
    await expect(page.getByTestId("opening-diagnosis")).toContainText("landing-region");
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
    await focusOpeningHole(page);
    const targetIds = rewarded.onboarding.opening.targetCells;
    await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.openingPreview())).toMatchObject({
      targetIds,
      outlineCount: targetIds.length,
    });
    // The outline stays registered to the same authoritative ids while the
    // actual camera rotates. The test only reads renderer diagnostics; all
    // authoring below remains real keyboard and mouse input.
    for (let rotation = 0; rotation < 4; rotation++) {
      await page.keyboard.press("q");
      await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.openingPreview())).toMatchObject({
        targetIds,
        outlineCount: targetIds.length,
      });
      const projected = await page.evaluate(({ x, y }) => window.__coursecraftPixiTest!.tileToScreen(x, y), point);
      const viewport = await page.evaluate(() => window.__coursecraftPixiTest!.viewport());
      expect(projected).not.toBeNull();
      expect(viewport).not.toBeNull();
      expect(projected!.x).toBeGreaterThan(0);
      expect(projected!.x).toBeLessThan(viewport!.width);
      expect(projected!.y).toBeGreaterThan(0);
      expect(projected!.y).toBeLessThan(viewport!.height);
    }
    const dock = page.getByTestId("design-dock");
    if (await dock.getAttribute("data-collapsed") === "true") await dock.getByRole("button", { name: "Expand Design dock" }).click();
    await dock.getByRole("tab", { name: "Terrain", exact: true }).click();
    await dock.getByTestId("design-card-terrain-fairway").click();
    await dock.getByTestId("design-tool-curve").click();
    // Expanding the dock changes the canvas bounds. The visible Focus action
    // deliberately collapses it after material selection, then recenters the
    // same camera. At every supported layout the authoritative target must be
    // delivered to Pixi rather than a DOM overlay.
    const originalViewport = page.viewportSize()!;
    for (const viewportSize of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewportSize);
      await focusOpeningHole(page);
      await expect(dock).toHaveAttribute("data-collapsed", "true");
      const focusedCanvas = await canvas(page);
      const focusedBounds = await focusedCanvas.boundingBox();
      if (!focusedBounds) throw new Error("Focused canvas has no bounds");
      const targetScreen = await pagePoint(page, focusedCanvas, point);
      const { resolvedTarget, targetHit } = await page.evaluate(({ x, y, bounds }) => {
        const viewport = window.__coursecraftPixiTest!.viewport()!;
        const element = document.elementFromPoint(x, y) as HTMLElement | null;
        return {
          resolvedTarget: window.__coursecraftPixiTest!.screenToTile(
            (x - bounds.x) * viewport.width / bounds.width,
            (y - bounds.y) * viewport.height / bounds.height,
          ),
          targetHit: element ? {
            tagName: element.tagName,
            testId: element.dataset.testid ?? null,
            tutorialTarget: element.dataset.tutorialTarget ?? null,
            role: element.getAttribute("role"),
            text: element.textContent?.trim().slice(0, 120) ?? "",
          } : null,
        };
      }, { x: targetScreen.x, y: targetScreen.y, bounds: focusedBounds });
      console.log(`ZK-1141 target hit ${JSON.stringify({ viewportSize, target, point, targetScreen, targetHit })}`);
      expect(resolvedTarget).toEqual(point);
      expect(targetHit?.tagName, `projected target is occluded at ${viewportSize.width}x${viewportSize.height} by ${JSON.stringify(targetHit)}`).toBe("CANVAS");
      const file = testInfo.outputPath(`05-focus-clear-${viewportSize.width}x${viewportSize.height}.png`);
      await page.screenshot({ path: file });
      await testInfo.attach(`focus-clear-${viewportSize.width}x${viewportSize.height}`, { path: file, contentType: "image/png" });
    }
    await page.setViewportSize(originalViewport);
    await focusOpeningHole(page);
    const beforeRejectedPaint = await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState().tiles);
    await clickTile(page, await canvas(page), { x: point.x + 3, y: point.y });
    await expect(page.getByTestId("opening-paint-recovery")).toContainText("missed the highlighted tiles");
    expect(await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState().tiles)).toEqual(beforeRejectedPaint);
    await clickTile(page, await canvas(page), point);
    await expect(page.getByRole("button", { name: "Retest the same group", exact: true })).toBeEnabled();
    await capture("05-real-fairway-edit");
    const edited = await state();
    const editedSurface = await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState());
    const changedIds = editedSurface.tiles.flatMap((terrain, index) => terrain !== beforeRejectedPaint[index] ? [index] : []);
    expect(changedIds).toEqual([target]);
    expect(editedSurface.features.at(-1)?.coverage).toEqual([target]);
    expect(edited.economy.cash).toBeLessThan(rewarded.economy.cash);
    const editDebit = rewarded.economy.cash - edited.economy.cash;
    expect(editDebit).toBe(120);
    await page.keyboard.press("Control+z");
    await expect(page.getByTestId("tutorial-primary-action")).toBeDisabled();
    await expectStep(page, "improve-hole");
    expect((await state()).economy).toEqual(rewarded.economy);
    expect((await state()).onboarding.reward).toEqual(rewarded.onboarding.reward);
    await page.keyboard.press("Control+Shift+z");
    await expect(page.getByRole("button", { name: "Retest the same group", exact: true })).toBeEnabled();
    expect((await state()).economy).toEqual(edited.economy);
    await page.keyboard.press("Control+z");
    await expect(page.getByTestId("tutorial-primary-action")).toBeDisabled();
    const touchTarget = await pagePoint(page, await canvas(page), point);
    await page.touchscreen.tap(touchTarget.x, touchTarget.y);
    await expect(page.getByRole("button", { name: "Retest the same group", exact: true })).toBeEnabled();
    const touchEditedSurface = await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState());
    expect(touchEditedSurface.tiles.flatMap((terrain, index) => terrain !== beforeRejectedPaint[index] ? [index] : [])).toEqual([target]);
    expect(touchEditedSurface.features.at(-1)?.coverage).toEqual([target]);
    expect((await state()).economy).toEqual(edited.economy);
    // Repeating the exact committed material is a real no-op: it must not
    // append another surface feature, charge again, or disturb eligibility.
    await clickTile(page, await canvas(page), point);
    const repeatedEdit = await state();
    expect(await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState())).toEqual(touchEditedSurface);
    expect(repeatedEdit.economy).toEqual(edited.economy);
    expect(repeatedEdit.onboarding.reward).toEqual(rewarded.onboarding.reward);
    await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.openingPreview())).toMatchObject({
      targetIds,
      outlineCount: targetIds.length,
    });
    await expect(overlay(page).getByText("Progress saved", { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /Continue/ }).click();
    await expectStep(page, "improve-hole");
    expect((await state()).economy).toEqual(edited.economy);
    expect((await state()).onboarding.reward).toEqual(rewarded.onboarding.reward);
    expect(await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState())).toEqual(touchEditedSurface);
    await expect(page.getByRole("button", { name: "Retest the same group", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Retest the same group", exact: true }).click();
    await expectStep(page, "retest-play");
    const retestStarted = await state();
    const retestReceipt = previewSummary(retestStarted.onboarding.opening.candidate);
    expect(retestReceipt.holeId).toBe(baselineReceipt.holeId);
    await expect(page.getByTestId("opening-evidence-context")).toContainText(`seed ${retestStarted.onboarding.opening.context.runSeed}`);
    await expect(page.getByTestId("opening-current-shot")).toHaveAttribute("data-preview-id", retestStarted.onboarding.opening.candidate.id);
    await expect(overlay(page).getByText("Progress saved", { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /Continue/ }).click();
    await expectStep(page, "retest-play");
    expect((await state()).onboarding.opening.candidate).toEqual(retestStarted.onboarding.opening.candidate);
    expect((await state()).economy).toEqual(edited.economy);
    expect((await state()).onboarding.reward).toEqual(rewarded.onboarding.reward);
    const retestPenalties = await playEveryRecordedShot(retestReceipt, "05b-intermediate-retest-shot");
    expect((await state()).onboarding.preview).toEqual(baselineStateReceipt);
    await page.getByRole("button", { name: "Compare visits", exact: true }).click();
    await expectStep(page, "compare-preview");
    await expect(page.getByTestId("opening-comparison")).toBeVisible();
    await expect(page.getByTestId("opening-comparison-state")).toHaveAttribute("data-state", /positive|neutral|negative/);
    await expect(page.getByTestId("opening-comparison-cost")).toContainText(`$${editDebit}`);
    const compared = await state();
    await expect(page.getByTestId("opening-comparison-penalties")).toContainText(`First visit: ${baselinePenalties}`);
    const comparedReceipt = previewSummary(compared.onboarding.opening.candidate);
    await expect(page.getByTestId("opening-comparison-penalties")).toContainText(`Retest: ${retestPenalties}`);
    const comparisonMeasures = compared.onboarding.opening.comparison.measures;
    const countChanges = (measures: typeof comparisonMeasures) => measures.reduce((counts, row) => {
      const compare = (before: number | undefined, after: number | undefined, improvesWhen: "lower" | "higher") => {
        if (!Number.isFinite(before) || !Number.isFinite(after) || before === after) return;
        const improved = improvesWhen === "lower" ? after! < before! : after! > before!;
        if (improved) counts.improved++;
        else counts.worsened++;
      };
      compare(row.strokesBefore, row.strokesAfter, "lower");
      compare(row.satisfactionBefore, row.satisfactionAfter, "higher");
      compare(row.penaltiesBefore, row.penaltiesAfter, "lower");
      compare(row.riskBefore, row.riskAfter, "lower");
      compare(row.riskyLeavesBefore, row.riskyLeavesAfter, "lower");
      return counts;
    }, { improved: 0, worsened: 0 });
    const comparisonCounts = countChanges(comparisonMeasures);
    await expect(page.getByTestId("opening-comparison-summary")).toContainText(`${comparisonCounts.improved} improved, ${comparisonCounts.worsened} worsened`);
    const comparisonRows = page.getByTestId("opening-comparison-row");
    await expect(comparisonRows).toHaveCount(comparisonMeasures.length);
    for (const [index, measure] of comparisonMeasures.entries()) {
      const row = comparisonRows.nth(index);
      await expect(row).toContainText(`${measure.strokesBefore} strokes · ${Math.round(measure.satisfactionBefore)}% satisfaction`);
      await expect(row).toContainText(`${measure.strokesAfter} strokes · ${Math.round(measure.satisfactionAfter)}% satisfaction`);
      await expect(row).toContainText(`Recorded penalties: ${measure.penaltiesBefore}.`);
      await expect(row).toContainText(`Recorded penalties: ${measure.penaltiesAfter}.`);
      await expect(row).toContainText(`${measure.riskBefore} risk · ${measure.riskyLeavesBefore} risky leaves.`);
      await expect(row).toContainText(`${measure.riskAfter} risk · ${measure.riskyLeavesAfter} risky leaves.`);
    }
    await expect(page.getByTestId("opening-comparison-risk-note")).toContainText("Risk = penalties");
    expect(compared.economy).toEqual(edited.economy);
    expect(compared.onboarding.preview).toEqual(baselineStateReceipt);
    expect(compared.onboarding.reward).toEqual(rewarded.onboarding.reward);
    expect(comparedReceipt.holeId).toBe(baselineReceipt.holeId);
    await expectTutorialInViewport(page);
    await capture("06-honest-comparison-with-penalties");
    await expect(overlay(page).getByText("Progress saved", { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /Continue/ }).click();
    await expectStep(page, "compare-preview");
    expect((await state()).onboarding.opening.candidate).toEqual(compared.onboarding.opening.candidate);
    expect((await state()).economy).toEqual(compared.economy);
    expect((await state()).onboarding.opening.comparison.measures).toEqual(comparisonMeasures);
    await setInGameLocale(page, "pseudo");
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await expectComparisonReadable(page);
      const file = testInfo.outputPath(`06-comparison-pseudo-200-${viewport.width}x${viewport.height}.png`);
      await page.screenshot({ path: file });
      await testInfo.attach(`comparison-pseudo-200-${viewport.width}x${viewport.height}`, { path: file, contentType: "image/png" });
      if (process.env.ZK1107_EVIDENCE) {
        const directory = `artifacts/zk-1107/${process.env.ZK1107_EVIDENCE}`;
        mkdirSync(directory, { recursive: true });
        await page.screenshot({ path: `${directory}/06-comparison-pseudo-200-${viewport.width}x${viewport.height}.png` });
      }
    }
    await page.evaluate(() => localStorage.setItem("coursecraft_locale", "en"));
    await page.reload();
    await page.getByRole("button", { name: /Continue/ }).click();
    await expectStep(page, "compare-preview");
    await testInfo.attach("opening-evidence-context", { body: JSON.stringify({ context: baselineContext, viewport: page.viewportSize(), elapsedSeconds: (Date.now() - started) / 1000, before: baselineReceipt, after: comparedReceipt, penalties: { before: baselinePenalties, after: retestPenalties }, economy: { before: before.economy, rewardCredit: rewarded.economy.cash - before.economy.cash, editDebit, rewarded: rewarded.economy, edited: edited.economy } }, null, 2), contentType: "application/json" });
    await page.getByRole("button", { name: "Finish private demo", exact: true }).click();
    await expect(overlay(page)).toHaveCount(0);
    expect((await state()).onboarding).toMatchObject({ active: false, completion: "creative" });
    expect(browserErrors).toEqual([]);
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
