import { expect, test } from "@playwright/test";

test("M36-M37 Player Pro aims, resolves, progresses, and returns to design", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  const tutorialOffer = page.getByRole("dialog", { name: "First-launch tutorial" });
  if (await tutorialOffer.count()) await tutorialOffer.getByRole("button", { name: "Skip tutorial" }).click();
  await page.evaluate(() => window.__coursecraftTest!.setPlayerProFixture());

  await page.getByTestId("workspace-operate").click();
  await page.getByTestId("open-player-pro").click();
  const panel = page.getByTestId("player-pro-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Casey Fairway");
  await expect(panel).toContainText("Six-skill profile");
  await panel.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByTestId("player-pro-route")).toHaveValue("player-pro-slice");
  await page.getByTestId("start-player-round").click();

  const hud = page.getByTestId("player-shot-hud");
  await expect(hud).toBeVisible();
  await expect(hud).toContainText("Hole 1 of 3");
  const lowFlight = page.getByTestId("player-shot-flight-low");
  await lowFlight.focus();
  await page.keyboard.press("Enter");
  await expect(lowFlight).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("player-shot-preview")).toContainText("Effective lie:");
  await expect(page.getByTestId("player-shot-rules-preview")).toContainText("Flight: low");
  await expect(page.getByTestId("player-shot-rules-preview")).toContainText("Route evidence:");
  await expect(page.getByTestId("player-shot-rules-preview")).toContainText("Penalty risk:");
  await expect(page.getByTestId("player-shot-green-rollout-preview")).toContainText("Ground path:");
  await page.getByTestId("player-shot-flight-high").click();
  await expect(page.getByTestId("player-shot-flight-high")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("player-shot-rules-preview")).toContainText("Flight: high");
  await page.getByTestId("workspace-design").click();
  await expect(page.getByTestId("open-course-manager")).toBeDisabled();

  const stage = page.locator(".cc-pixi-stage");
  const box = await stage.boundingBox();
  if (!box) throw new Error("Course stage is not measurable");
  await stage.click({ position: { x: Math.round(box.width * 0.57), y: Math.round(box.height * 0.48) } });
  const picked = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").playerPro.activeRound.aim);
  expect(picked).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
  await hud.getByRole("button", { name: "Use caddie line" }).click();
  await page.getByTestId("commit-player-shot").click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").playerPro.activeRound.phase), { timeout: 10_000 }).not.toBe("flight");

  const afterShot = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").playerPro.activeRound);
  expect(afterShot.strokes).toBe(1);
  expect(afterShot.rulesSnapshot).toMatchObject({
    version: 2,
    dimensions: { width: expect.any(Number), height: expect.any(Number) },
    classificationSummary: expect.any(Array),
    snapshot: { version: 2, inBoundsRle: expect.any(String), penaltyComponentsRle: expect.any(String) },
  });
  expect(afterShot.recentTrace).toMatchObject({
    club: expect.any(String),
    aim: expect.any(Object),
    rest: expect.any(Object),
    evidence: expect.any(Array),
    flightProfile: expect.stringMatching(/^(low|standard|high)$/),
    lieEffect: {
      sourceLie: expect.any(String),
      effectiveLie: expect.any(String),
      carryMultiplier: expect.any(Number),
      dispersionMultiplier: expect.any(Number),
      rollMultiplier: expect.any(Number),
    },
    collision: { kind: expect.stringMatching(/^(none|terrain|obstacle)$/) },
    ruling: {
      status: expect.stringMatching(/^(in_play|holed|penalty)$/),
      penaltyKind: expect.stringMatching(/^(none|out_of_bounds|penalty_area)$/),
      penaltyStrokes: expect.any(Number),
    },
    relief: {
      status: expect.stringMatching(/^(not_required|resolved|unavailable)$/),
      type: expect.any(String),
      candidates: expect.any(Array),
    },
    physicalRest: expect.any(Object),
    finalPosition: expect.any(Object),
    sharedOutcome: {
      flightProfile: expect.stringMatching(/^(low|standard|high)$/),
      ruling: expect.any(Object),
      relief: expect.any(Object),
    },
    greenRollout: {
      version: 1,
      landing: expect.any(Object),
      path: expect.arrayContaining([expect.any(Object)]),
      rest: expect.any(Object),
      rollYards: expect.any(Number),
      breakTiles: expect.any(Number),
      pace: expect.stringMatching(/^(slow|medium|fast)$/),
      evidence: {
        geometryHash: expect.any(String),
        program: expect.stringMatching(/^(receptive|balanced|championship|custom)$/),
        realizedSpeedFeet: expect.any(Number),
        realizedFirmness: expect.any(Number),
        effectiveMoisture: expect.any(Number),
        drainageLevel: expect.any(Number),
        trajectory: expect.stringMatching(/^(low|standard|high)$/),
      },
    },
  });
  expect(afterShot.recentTrace.ruling).toHaveProperty("referencePoint");
  expect(afterShot.recentTrace.ruling).toHaveProperty("crossingPoint");
  expect(afterShot.recentTrace.relief).toHaveProperty("selectedCandidateId");
  await expect(page.getByTestId("player-shot-ruling")).toContainText("Ruling:");
  await expect(page.getByTestId("player-shot-ruling")).toContainText("Collision:");
  await expect(page.getByTestId("player-shot-ruling")).toContainText("Relief:");
  await expect(page.getByTestId("player-shot-ruling")).toContainText("Final playable position:");
  await expect(page.getByTestId("player-shot-green-rollout-result")).toContainText("Ground path:");
  const repeatedText = await page.evaluate(() => {
    const readLatestTrace = () => {
      const playerPro = JSON.parse(window.render_game_to_text?.() ?? "{}").playerPro;
      return playerPro.activeRound?.recentTrace ?? playerPro.latestCompletedRound?.latestShot ?? null;
    };
    const first = readLatestTrace();
    const second = readLatestTrace();
    return { first, second };
  });
  expect(repeatedText.first).not.toBeNull();
  expect(JSON.stringify(repeatedText.first)).toBe(JSON.stringify(repeatedText.second));
  const decisionShot = await page.screenshot({ path: "artifacts/m36-player-pro-shot.png", fullPage: true });
  await testInfo.attach("player-pro-shot", { body: decisionShot, contentType: "image/png" });

  await hud.getByRole("button", { name: "Auto-finish" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").playerPro.activeRound?.phase), { timeout: 15_000 }).toBe("round_complete");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").playerPro.rounds)).toBe(1);
  const completed = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").playerPro.latestCompletedRound);
  expect(completed).toMatchObject({
    id: expect.any(String),
    rulesSnapshot: {
      version: 2,
      snapshot: { version: 2 },
      classificationSummary: expect.any(Array),
    },
    latestSharedOutcome: {
      rulesVersion: 1,
      flightProfile: expect.stringMatching(/^(low|standard|high)$/),
      ruling: expect.any(Object),
      relief: expect.any(Object),
      physicalRest: expect.any(Object),
      finalPosition: expect.any(Object),
    },
    automaticPutting: {
      holes: expect.any(Number),
      putts: expect.any(Number),
      latest: expect.objectContaining({ putts: expect.any(Number), leaveDistanceYards: expect.any(Number) }),
    },
  });
  expect(completed.automaticPutting.holes).toBeGreaterThan(0);
  expect(completed.automaticPutting.putts).toBeGreaterThanOrEqual(completed.automaticPutting.holes);
  await expect(hud).toContainText("Career gains, records, and competition rewards were settled once.");
  const completeShot = await page.screenshot({ path: "artifacts/m36-player-pro-complete.png", fullPage: true });
  await testInfo.attach("player-pro-complete", { body: completeShot, contentType: "image/png" });

  await page.getByTestId("return-to-design").click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").playerPro.activeRound)).toBeNull();
  await expect(page.getByTestId("open-course-manager")).toBeEnabled();
  expect(errors).toEqual([]);
});
