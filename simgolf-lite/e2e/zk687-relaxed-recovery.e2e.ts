import { expect, test, type Page } from "@playwright/test";

async function skipTutorialIfOffered(page: Page): Promise<void> {
  const tutorialOffer = page.getByRole("dialog", { name: "First-launch tutorial" });
  const offered = await tutorialOffer.waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true, () => false);
  if (offered) await tutorialOffer.getByRole("button", { name: "Skip tutorial" }).click();
}

test("ZK-687 recovery remains cozy, inspectable, and offers only evidenced takeover", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  await skipTutorialIfOffered(page);
  await page.evaluate(() => window.__coursecraftTest!.setZk687RecoveryFixture());

  const panel = page.getByTestId("seasons-legacy-panel");
  await panel.getByRole("button", { name: "Club identity", exact: true }).click();
  const audit = panel.getByTestId("relaxed-recovery-audit");
  await expect(audit).toContainText("Recovery reserve · 1 actions");
  await audit.getByText(/Recovery reserve/).click();
  await expect(audit.locator('[data-testid^="recovery-receipt-"]')).toContainText(/relief \$[1-9]/);
  await expect(audit).toContainText("tight");
  await expect(audit).toContainText("cash-deficit");

  const advisor = page.getByTestId("advisor-card");
  await expect(advisor).toContainText("The reserve kept the doors open");
  await expect(advisor.getByTestId("advisor-take-control")).toBeVisible();
  await advisor.getByTestId("advisor-take-control").click();
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return state.systemControl.systems.find((system: { id: string }) => system.id === "property");
  })).toMatchObject({ mode: "manual", source: "save-override", override: true });
  await expect(page.getByTestId("advisor-card")).toHaveCount(0);

  const shot = await page.screenshot({ path: testInfo.outputPath("zk687-relaxed-recovery.png"), fullPage: true });
  await testInfo.attach("zk687-relaxed-recovery", { body: shot, contentType: "image/png" });
  expect(errors).toEqual([]);
});
