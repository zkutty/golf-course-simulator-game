import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const evidenceDir = path.join(process.cwd(), "artifacts", "zk-211", "playwright");
mkdirSync(evidenceDir, { recursive: true });
test.setTimeout(900_000);

const tee = { x: 580, y: 370 };
const green = { x: 640, y: 400 };
type SurfaceLayout = ReturnType<NonNullable<Window["__coursecraftTest"]>["terrainSurfaceState"]>;

function remainingHoleRoutes(surface: SurfaceLayout) {
  const { width, height, owned } = surface;
  // Ten tiles clears the 90-yard valid-hole minimum at the default 10 yards
  // per tile. Screen-safe candidates are filtered after projection below.
  const segmentLength = Math.max(9, Math.min(10, width - 4));
  const candidates: Array<readonly [{ x: number; y: number }, { x: number; y: number }]> = [];
  for (let y = 3; y < height - 3; y += 2) {
    let x = 3;
    while (x < width - 3) {
      while (x < width - 3 && !owned[y * width + x]) x++;
      const start = x;
      while (x < width - 3 && owned[y * width + x]) x++;
      const end = x - 1;
      const safeEnd = Math.min(end - 1, width - 4);
      for (
        let segmentStart = Math.max(start + 1, 3);
        segmentStart + segmentLength <= safeEnd;
        segmentStart += segmentLength + 3
      ) {
        candidates.push([
          { x: segmentStart, y },
          { x: segmentStart + segmentLength, y },
        ]);
      }
    }
  }
  const anchor = surface.holes[0]?.tee ?? {
    x: width / 2,
    y: height / 2,
  };
  candidates.sort((a, b) => {
    const distance = (route: typeof a) => {
      const midpointX = (route[0].x + route[1].x) / 2;
      return (midpointX - anchor.x) ** 2 + (route[0].y - anchor.y) ** 2;
    };
    return distance(a) - distance(b) || a[0].y - b[0].y || a[0].x - b[0].x;
  });
  return candidates;
}

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

async function waitForPixiTest(page: Page) {
  await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest));
}

async function projectedTilePosition(
  page: Page,
  canvas: Awaited<ReturnType<typeof gameCanvas>>,
  point: { x: number; y: number },
) {
  await waitForPixiTest(page);
  const projection = await page.evaluate(
    ({ x, y }) => {
      const renderer = window.__coursecraftPixiTest;
      const position = renderer?.tileToScreen(x, y) ?? null;
      const viewport = renderer?.viewport() ?? null;
      return position && viewport ? { position, viewport } : null;
    },
    point,
  );
  if (!projection) throw new Error(`Renderer could not project tile ${point.x},${point.y}`);
  const box = await canvas.boundingBox();
  const position = box ? {
    x: projection.position.x * box.width / projection.viewport.width,
    y: projection.position.y * box.height / projection.viewport.height,
  } : projection.position;
  if (
    !box
    || position.x < 0
    || position.y < 0
    || position.x >= box.width
    || position.y >= box.height
  ) {
    throw new Error(
      `Projected tile ${point.x},${point.y} outside canvas at ${position.x.toFixed(1)},${position.y.toFixed(1)}`,
    );
  }
  return {
    canvas: position,
    page: { x: box.x + position.x, y: box.y + position.y },
  };
}

async function clickTile(
  page: Page,
  canvas: Awaited<ReturnType<typeof gameCanvas>>,
  point: { x: number; y: number },
) {
  const position = await projectedTilePosition(page, canvas, point);
  await canvas.click({ position: position.canvas, force: true });
}

async function dragTiles(
  page: Page,
  canvas: Awaited<ReturnType<typeof gameCanvas>>,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const from = await projectedTilePosition(page, canvas, start);
  const to = await projectedTilePosition(page, canvas, end);
  await page.mouse.move(from.page.x, from.page.y);
  await page.mouse.down();
  await page.mouse.move(to.page.x, to.page.y, { steps: 12 });
  await page.mouse.up();
}

async function dragCanvas(
  page: Page,
  canvas: Awaited<ReturnType<typeof gameCanvas>>,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas has no visible bounds");
  await page.mouse.move(box.x + start.x, box.y + start.y);
  await page.mouse.down();
  await page.mouse.move(box.x + end.x, box.y + end.y, { steps: 12 });
  await page.mouse.up();
}

async function visibleHoleRoutes(
  page: Page,
  canvas: Awaited<ReturnType<typeof gameCanvas>>,
  surface: SurfaceLayout,
) {
  const candidates = remainingHoleRoutes(surface);
  await waitForPixiTest(page);
  await page.evaluate(() => window.__coursecraftPixiTest!.fitWholeCourse());
  const projected = await page.evaluate((routes) => {
    const renderer = window.__coursecraftPixiTest!;
    const viewport = renderer.viewport();
    return {
      viewport,
      routes: routes.map((route) => route.map((point) => renderer.tileToScreen(point.x, point.y))),
    };
  }, candidates);
  const box = await canvas.boundingBox();
  if (!box || !projected.viewport) throw new Error("Renderer viewport is unavailable");
  const margin = 14;
  const visible = candidates.filter((_, index) => (
    projected.routes[index].every((point) => {
      if (!point) return false;
      const x = point.x * box.width / projected.viewport!.width;
      const y = point.y * box.height / projected.viewport!.height;
      return x >= margin && y >= margin && x < box.width - margin && y < box.height - margin;
    })
  ));
  if (visible.length < 8) {
    throw new Error(
      `Expected eight owned, visible tutorial corridors; found ${visible.length} of ${candidates.length}`,
    );
  }
  return visible.slice(0, 8).map((route, index) => (
    index % 2 === 0 ? route : [route[1], route[0]] as const
  ));
}

async function placeHole(
  page: Page,
  start: { x: number; y: number } | null = null,
  end: { x: number; y: number } | null = null,
) {
  const canvas = await gameCanvas(page);
  const cameraBeforePlacement = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera);
  if (start && end) {
    await clickTile(page, canvas, start);
    // Placing the tee changes the wizard step and can resize/remount the
    // canvas when the tutorial panel advances. Wait for that UI transition
    // before projecting the green against the current renderer viewport.
    await expect(page.getByText("Click to place green", { exact: true })).toBeVisible();
    await clickTile(page, canvas, end);
  } else {
    await canvas.click({ position: tee, force: true });
    await canvas.click({ position: green, force: true });
  }
  // Completing a wizard hole must not start a delayed flyover or replace the
  // player's current framing. This helper is used repeatedly through the
  // tutorial's multi-hole path.
  await page.waitForTimeout(1_000);
  await expect(page.getByText("click or Esc to skip")).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera)).toEqual(cameraBeforePlacement);
  await expect(page.getByRole("dialog", { name: "Game paused" })).toHaveCount(0);
}

async function paintAndPlaceHole(page: Page, start: { x: number; y: number }, end: { x: number; y: number }) {
  // Keep every route projected from the same whole-course overview as the
  // tutorial advances through repeated hole placements.
  await waitForPixiTest(page);
  await page.evaluate(() => window.__coursecraftPixiTest!.fitWholeCourse());
  await page.getByRole("button", { name: "Paint", exact: true }).click();
  const canvas = await gameCanvas(page);
  await dragTiles(page, canvas, start, end);
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
  await dragCanvas(page, canvas, tee, green);
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
  const surface = await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState());
  const routes = await visibleHoleRoutes(page, canvas, surface);
  for (const [index, [start, end]] of routes.entries()) {
    if (reloadStages && index === routes.length - 1) {
      await expectStep(page, "open-course");
      await page.reload();
      await page.getByRole("button", { name: /Continue/ }).click();
      await expectStep(page, "open-course");
    }
    await paintAndPlaceHole(page, start, end);
    const builtHole = await page.evaluate(
      (holeIndex) => window.__coursecraftTest!.terrainSurfaceState().holes[holeIndex],
      index + 1,
    );
    if (!builtHole.valid) {
      throw new Error(`Generated tutorial hole ${index + 2} is invalid: ${builtHole.issues.join("; ")}`);
    }
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
  await page.evaluate(() => window.__coursecraftTest!.startWeekCloseFixture());
  await expect(page.getByTestId("week-close-report")).toBeVisible();
  await page.getByTestId("week-close-continue").click();
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
    await page.evaluate(() => window.__coursecraftTest!.startWeekCloseFixture());
    await expect(page.getByTestId("week-close-report")).toBeVisible();
    await page.getByTestId("week-close-continue").click();
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
  await expect(advisor).toHaveCount(0);
  await expect(page.getByTestId("tee-setup-offer")).toHaveCount(0);

  await page.getByRole("button", { name: "Open pause menu" }).click();
  await page.getByRole("button", { name: /Options/ }).click();
  await expect(page.getByLabel("Advisor frequency")).toHaveValue("chatty");
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
  await dragCanvas(page, rerunCanvas, { x: 380, y: 220 }, { x: 440, y: 250 });
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
