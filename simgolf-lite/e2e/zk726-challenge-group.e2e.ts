import { expect, test } from "@playwright/test";

test("app render_game_to_text exposes the persisted ChallengeGroupRound carrier", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  const tutorialOffer = page.getByRole("dialog", { name: "First-launch tutorial" });
  if (await tutorialOffer.count()) await tutorialOffer.getByRole("button", { name: "Skip tutorial" }).click();
  await page.evaluate(() => window.__coursecraftTest!.setChallengeGroupRoundFixture());

  const text = await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return state.playerPro?.activeChallengeGroupRound ?? null;
  })).not.toBeNull();
  void text;
  const state = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").playerPro);
  expect(state.activeRound).toBeNull();
  expect(state.activeChallengeGroupRound).toMatchObject({
    id: "zk726-browser-group",
    phase: "awaiting_player",
    currentHole: 1,
    activeGolferId: "player-pro-726001",
    playerGolferId: "player-pro-726001",
    controls: "player-shot",
    honorsOrder: ["rival-alex", "player-pro-726001", "rival-blair", "rival-devon"],
    golfers: [
      expect.objectContaining({ id: "rival-alex", controller: "ai", ball: expect.any(Object), scorecard: expect.any(Array), latestShot: expect.any(Object), setup: expect.objectContaining({ teeSet: "forward", pinRotation: "B", rating: { courseRating: expect.any(Number), slope: expect.any(Number) } }) }),
      expect.objectContaining({ id: "player-pro-726001", controller: "player", ball: expect.any(Object), handicap: expect.objectContaining({ allowance: 1 }), equipment: expect.any(Object), setup: expect.objectContaining({ teeSet: "member", pinRotation: "A" }) }),
      expect.objectContaining({ id: "rival-blair", controller: "ai", setup: expect.objectContaining({ teeSet: "championship", pinRotation: "C" }) }),
      expect.objectContaining({ id: "rival-devon", controller: "ai", setup: expect.objectContaining({ teeSet: "forward", pinRotation: "B" }) }),
    ],
    recentTurn: expect.objectContaining({ golferId: "rival-alex", ruling: expect.any(Object) }),
    match: { status: "active" },
  });
  await page.screenshot({ path: testInfo.outputPath("zk726-challenge-group.png"), fullPage: true });
  expect(errors).toEqual([]);
});
