import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("paused unselected status avoids no-op commits while live updates stay responsive", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.stack ?? error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  try {
    await page.goto("/e2e/fixtures/live-status-publication-fixture.html");
    await page.waitForFunction(() => typeof (window as unknown as {
      runLiveStatusPublicationRegression?: unknown;
    }).runLiveStatusPublicationRegression === "function");
    const report = await page.evaluate(() => (window as unknown as {
      runLiveStatusPublicationRegression: () => Promise<{
        stable: { commitDelta: number };
        cleared: { commitDelta: number };
      }>;
    }).runLiveStatusPublicationRegression());
    const path = testInfo.outputPath("live-status-publication-report.json");
    await writeFile(path, `${JSON.stringify({ report, errors }, null, 2)}\n`);
    await testInfo.attach("live-status-publication-report", { path, contentType: "application/json" });
    expect(errors).toEqual([]);
    // Keep these soft so the unchanged-source control completes every semantic
    // phase and distinguishes the two no-op defects from fixture failures.
    expect.soft(report.stable.commitDelta, "clean paused unselected commits").toBe(0);
    expect.soft(report.cleared.commitDelta, "clean paused commits after clearing selection").toBe(0);
  } catch (error) {
    const partial = await page.evaluate(() => (window as unknown as {
      liveStatusPublicationPartial?: unknown;
    }).liveStatusPublicationPartial ?? null).catch(() => null);
    await writeFile(testInfo.outputPath("live-status-publication-partial.json"), `${JSON.stringify({ errors, partial, error: String(error) }, null, 2)}\n`);
    throw error;
  }
});
