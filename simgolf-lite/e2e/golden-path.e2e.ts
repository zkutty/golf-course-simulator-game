import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

test("quick start → playable course → live week → save → reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");

  const result = await page.evaluate(() => window.__coursecraftTest!.runGoldenWeek());
  expect(result.rounds).toBeGreaterThan(0);
  expect(result.week).toBe(2);
  expect(Number.isFinite(result.cash)).toBe(true);
  expect(result.afterHash).toBe(result.beforeHash);

  await page.reload();
  const continueButton = page.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().week)).toBe(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("screen flow, hard pause, dirty guard, and save acknowledgement", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New Game" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screenBase)).toBe("setup-wizard");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screenBase)).toBe("title");

  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screenBase)).toBe("in-game");
  await page.evaluate(() => window.__coursecraftTest!.runGoldenWeek());
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().golferPositions.length), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().dirty)).toBe(true);

  const guardBeforeSave = await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(guardBeforeSave).toBe(true);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("pause-overlay")).toBeVisible();
  const frozen = await page.evaluate(() => window.__coursecraftTest!.state());
  expect(frozen.speed).toBe("paused");
  await page.waitForTimeout(600);
  const stillFrozen = await page.evaluate(() => window.__coursecraftTest!.state());
  expect(stillFrozen.dayMinute).toBe(frozen.dayMinute);
  expect(stillFrozen.golferPositions).toEqual(frozen.golferPositions);

  await page.getByRole("button", { name: /save game/i }).click();
  await expect(page.getByText("E2E golden path")).toBeVisible();
  await page.getByRole("button", { name: "Overwrite" }).first().click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().dirty)).toBe(false);
  const guardAfterSave = await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(guardAfterSave).toBe(false);

  await page.keyboard.press("Escape"); // close save/load, pause remains
  await expect(page.getByTestId("pause-overlay")).toBeVisible();
  await page.keyboard.press("Escape"); // resume
  await expect(page.getByTestId("pause-overlay")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().speed)).toBe("3x");
});

test("every checked-in historical save fixture migrates", async ({ page }) => {
  await page.goto("/");
  const fixtures = ["save-v1.json"];
  for (const fixture of fixtures) {
    const text = readFileSync(path.join(process.cwd(), "e2e", "fixtures", fixture), "utf8");
    const result = await page.evaluate(
      (fixtureText) => window.__coursecraftTest!.validateFixture(fixtureText),
      text
    );
    expect(result).toEqual({ ok: true, migratedFrom: 1 });
  }
});

test("options apply live and persist independently across reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Options" }).click();
  await expect(page.getByTestId("options-screen")).toBeVisible();

  await page.getByLabel("Autosave cadence").selectOption("off");
  await page.getByLabel("Default game speed").selectOption("2x");
  await page.getByRole("button", { name: "Graphics" }).click();
  await page.getByLabel("Animations master").uncheck();
  await page.getByLabel("Resolution scale").fill("0.75");
  await page.getByRole("button", { name: "Audio" }).click();
  await page.getByLabel("Master volume").fill("0.55");
  await page.getByRole("button", { name: "Accessibility" }).click();
  await page.getByLabel("Text scale").selectOption("115");
  await expect.poll(() => page.evaluate(() => document.documentElement.style.fontSize)).toBe("115%");
  await page.getByRole("button", { name: "Done" }).click();

  await page.reload();
  await page.getByRole("button", { name: "Options" }).click();
  await expect(page.getByLabel("Autosave cadence")).toHaveValue("off");
  await expect(page.getByLabel("Default game speed")).toHaveValue("2x");
  await page.getByRole("button", { name: "Graphics" }).click();
  await expect(page.getByLabel("Animations master")).not.toBeChecked();
  await expect(page.getByLabel("Resolution scale")).toHaveValue("0.75");
  await page.getByRole("button", { name: "Audio" }).click();
  await expect(page.getByLabel("Master volume")).toHaveValue("0.55");
  await page.getByRole("button", { name: "Accessibility" }).click();
  await expect(page.getByLabel("Text scale")).toHaveValue("115");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("coursecraft_app_profile_v2") ?? "null"));
  expect(stored).toMatchObject({ version: 2, gameplay: { autosaveCadence: "off", defaultGameSpeed: "2x" }, accessibility: { textScale: 115 } });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset Accessibility" }).click();
  await expect(page.getByLabel("Text scale")).toHaveValue("100");
  const reset = await page.evaluate(() => JSON.parse(localStorage.getItem("coursecraft_app_profile_v2") ?? "null"));
  expect(reset.audio.masterVolume).toBe(0.55);
});
