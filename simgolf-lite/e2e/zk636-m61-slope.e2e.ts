import { expect, test, type Page } from "@playwright/test";

type DecisionKind = "uphill" | "downhill" | "sidehill";

interface DecisionTarget {
  kind: DecisionKind;
  x: number;
  y: number;
  screen: { x: number; y: number };
  flatDistanceYards: number;
  elevationDelta: number;
  playsLikeDistanceYards: number;
  crossTargetLine: number;
}

async function enterPlayerProRound(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").screen)).toBe("game");
  const tutorialOffer = page.getByRole("dialog", { name: "First-launch tutorial" });
  if (await tutorialOffer.count()) await tutorialOffer.getByRole("button", { name: "Skip tutorial" }).click();
  await page.evaluate(() => window.__coursecraftTest!.setPlayerProFixture());
  await page.getByTestId("workspace-operate").click();
  await page.getByTestId("open-player-pro").click();
  await page.getByTestId("player-pro-panel").getByRole("button", { name: "Play", exact: true }).click();
  await page.getByTestId("start-player-round").click();
  const hud = page.getByTestId("player-shot-hud");
  await expect.poll(() => page.evaluate(() => {
    const round = JSON.parse(window.render_game_to_text?.() ?? "{}").playerPro?.activeRound;
    return round?.phase === "awaiting_shot" && Boolean(round.aim);
  })).toBe(true);
  await expect(hud).toBeVisible();
  await expect(hud.getByTestId("commit-player-shot")).toBeEnabled();
  await expect.poll(() => page.evaluate(() => Boolean(window.__coursecraftPixiTest))).toBe(true);
  await page.evaluate(() => window.__coursecraftPixiTest!.fitWholeCourse());
}

async function decisionTargets(page: Page): Promise<Record<DecisionKind, DecisionTarget>> {
  return page.evaluate(() => {
    const text = JSON.parse(window.render_game_to_text?.() ?? "{}");
    const ball = text.playerPro.activeRound.ball as { x: number; y: number };
    const surface = window.__coursecraftTest!.terrainSurfaceState();
    const renderer = window.__coursecraftPixiTest!;
    const cell = (x: number, y: number) => surface.elevations[
      Math.max(0, Math.min(surface.height - 1, Math.round(y))) * surface.width
      + Math.max(0, Math.min(surface.width - 1, Math.round(x)))
    ] ?? 0;
    const bx = Math.round(ball.x);
    const by = Math.round(ball.y);
    const gradientX = (cell(bx + 1, by) - cell(bx - 1, by))
      / Math.max(1, Math.min(surface.width - 1, bx + 1) - Math.max(0, bx - 1));
    const gradientY = (cell(bx, by + 1) - cell(bx, by - 1))
      / Math.max(1, Math.min(surface.height - 1, by + 1) - Math.max(0, by - 1));
    const ballElevation = cell(ball.x, ball.y);
    // createPlayerProReferenceCourse inherits the canonical M12 fixture scale.
    const yardsPerTile = 4;
    const candidates: DecisionTarget[] = [];
    for (let y = 1; y < surface.height - 1; y++) {
      for (let x = 1; x < surface.width - 1; x++) {
        const dx = x - ball.x;
        const dy = y - ball.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 7 || distance > 28) continue;
        const screen = renderer.tileToScreen(x, y);
        if (!screen || screen.x < 24 || screen.x > 1_160 || screen.y < 80 || screen.y > 900) continue;
        const elevationDelta = cell(x, y) - ballElevation;
        const unitX = dx / distance;
        const unitY = dy / distance;
        const crossTargetLine = gradientX * -unitY + gradientY * unitX;
        candidates.push({
          kind: "sidehill",
          x,
          y,
          screen,
          flatDistanceYards: distance * yardsPerTile,
          elevationDelta,
          playsLikeDistanceYards: Math.max(distance * yardsPerTile * 0.5, distance * yardsPerTile + elevationDelta * 2.5),
          crossTargetLine,
        });
      }
    }
    const nearest = (predicate: (candidate: DecisionTarget) => boolean, kind: DecisionKind) => {
      const match = candidates
        .filter(predicate)
        .sort((a, b) => a.flatDistanceYards - b.flatDistanceYards || a.y - b.y || a.x - b.x)[0];
      if (!match) throw new Error(`M61 fixture has no visible ${kind} decision target`);
      return { ...match, kind };
    };
    return {
      uphill: nearest((candidate) => candidate.elevationDelta >= 2, "uphill"),
      downhill: nearest((candidate) => candidate.elevationDelta <= -2, "downhill"),
      sidehill: nearest((candidate) => Math.abs(candidate.crossTargetLine) >= 0.2, "sidehill"),
    };
  });
}

test("ZK-636 visibly exercises uphill, downhill, and sidehill Player Pro decisions", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await enterPlayerProRound(page);

  const hud = page.getByTestId("player-shot-hud");
  const caddie = page.getByTestId("player-shot-caddie-guidance");
  await expect(caddie).toHaveAttribute("role", "status");
  await expect(caddie).toHaveAttribute("aria-live", "polite");
  await expect(caddie).toContainText("Plays");
  await expect(caddie).toContainText(/ball (above|below) feet|level lie/i);

  const targets = await decisionTargets(page);
  const stage = page.locator(".cc-pixi-stage");
  const stageBox = await stage.boundingBox();
  if (!stageBox) throw new Error("M61 course stage is not measurable");
  const captures: Array<Record<string, unknown>> = [];
  const controlValues: Record<DecisionKind, { club: string; power: string }> = {
    uphill: { club: "5 Iron", power: "100" },
    downhill: { club: "Pitching Wedge", power: "72" },
    sidehill: { club: "Driver", power: "62" },
  };

  for (const kind of ["uphill", "downhill", "sidehill"] as const) {
    const target = targets[kind];
    await page.mouse.click(stageBox.x + target.screen.x, stageBox.y + target.screen.y);
    await expect.poll(async () => page.evaluate(({ x, y }) => {
      const aim = JSON.parse(window.render_game_to_text?.() ?? "{}").playerPro.activeRound.aim;
      return aim ? Math.hypot(aim.x - x, aim.y - y) : Number.POSITIVE_INFINITY;
    }, { x: target.x, y: target.y })).toBeLessThan(1.5);
    const aim = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").playerPro.activeRound.aim);
    expect(Math.hypot(aim.x - target.x, aim.y - target.y)).toBeLessThan(1.5);

    await page.getByTestId("player-shot-club").selectOption(controlValues[kind].club);
    await page.getByTestId("player-shot-power").fill(controlValues[kind].power);
    const preview = page.getByTestId("player-shot-preview");
    await expect(preview).toContainText(`Target ${Math.round(target.playsLikeDistanceYards)} yd`);
    const screenshot = await page.screenshot();
    await testInfo.attach(`m61-${kind}-decision`, { body: screenshot, contentType: "image/png" });
    captures.push({
      ...target,
      aim,
      club: await page.getByTestId("player-shot-club").inputValue(),
      power: await page.getByTestId("player-shot-power").inputValue(),
      preview: await preview.innerText(),
      caddie: await caddie.innerText(),
    });
  }

  expect(targets.uphill.playsLikeDistanceYards).toBeGreaterThan(targets.uphill.flatDistanceYards);
  expect(targets.downhill.playsLikeDistanceYards).toBeLessThan(targets.downhill.flatDistanceYards);
  expect(Math.abs(targets.sidehill.crossTargetLine)).toBeGreaterThanOrEqual(0.2);
  await testInfo.attach("m61-structured-decisions", {
    body: Buffer.from(JSON.stringify(captures, null, 2)),
    contentType: "application/json",
  });

  await page.clock.install();
  await page.getByTestId("commit-player-shot").evaluate((button: HTMLButtonElement) => button.click());
  await expect(hud.getByText("Ball in flight…")).toBeVisible();
  await testInfo.attach("m61-shot-animation", { body: await page.screenshot(), contentType: "image/png" });
  await page.clock.runFor(1_000);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").playerPro.activeRound.phase), { timeout: 10_000 }).not.toBe("flight");
  const trace = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").playerPro.activeRound.recentTrace);
  expect(trace).toMatchObject({
    aim: { x: expect.any(Number), y: expect.any(Number) },
    landing: { x: expect.any(Number), y: expect.any(Number) },
    rest: { x: expect.any(Number), y: expect.any(Number) },
    physicalRest: { x: expect.any(Number), y: expect.any(Number) },
    shotSlope: {
      version: 1,
      handedness: expect.stringMatching(/^(right|left)$/),
      sidehill: expect.stringMatching(/^(ball_above_feet|ball_below_feet)$/),
      naturalCurveBiasTiles: expect.any(Number),
    },
  });
  expect(trace.aim.x).toBeCloseTo(targets.sidehill.x, 0);
  expect(trace.aim.y).toBeCloseTo(targets.sidehill.y, 0);
  expect(trace.physicalRest.x).toBeCloseTo(trace.rest.x, 3);
  expect(trace.physicalRest.y).toBeCloseTo(trace.rest.y, 3);

  await page.evaluate(() => {
    const key = "coursecraft_app_profile_v5";
    const profile = JSON.parse(localStorage.getItem(key) ?? "{}");
    profile.accessibility = {
      ...profile.accessibility,
      colorVision: "deuteranopia",
      terrainPatterns: true,
      reducedMotion: true,
      textScale: 115,
    };
    localStorage.setItem(key, JSON.stringify(profile));
    window.dispatchEvent(new CustomEvent("coursecraft-profile-change"));
  });
  await expect(page.locator("html")).toHaveAttribute("data-color-vision", "deuteranopia");
  await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
  await expect.poll(() => page.evaluate(() => document.documentElement.style.fontSize)).toBe("115%");
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBounds = await hud.boundingBox();
  expect(mobileBounds).not.toBeNull();
  expect(mobileBounds!.x).toBeGreaterThanOrEqual(0);
  expect(mobileBounds!.x + mobileBounds!.width).toBeLessThanOrEqual(390);
  expect(mobileBounds!.y + mobileBounds!.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await testInfo.attach("m61-mobile-accessibility", { body: await page.screenshot(), contentType: "image/png" });
  expect(errors).toEqual([]);
});
