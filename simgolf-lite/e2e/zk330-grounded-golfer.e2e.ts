import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const captureRoot = process.env.ZK330_EVIDENCE_DIR
  ? resolve(process.env.ZK330_EVIDENCE_DIR)
  : resolve("../zk330-browser-evidence");

const captures = [
  { rotation: 0 as const, quality: "high" as const, reducedMotion: false },
  { rotation: 1 as const, quality: "medium" as const, reducedMotion: false },
  { rotation: 2 as const, quality: "low" as const, reducedMotion: true },
  { rotation: 3 as const, quality: "high" as const, reducedMotion: true },
] as const;

test("ZK-330 grounds a deterministic golfer traverse on the visible landscape", async ({ browser }) => {
  mkdirSync(captureRoot, { recursive: true });
  const report: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  const requested = process.env.ZK330_CAPTURE_INDEX;
  const matrix = requested === undefined ? captures : [captures[Number(requested)]];
  if (matrix.some((capture) => !capture)) throw new Error(`Invalid ZK330_CAPTURE_INDEX: ${requested}`);

  for (const capture of matrix) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await context.addInitScript((reducedMotion) => {
      localStorage.setItem("coursecraft_app_profile_v5", JSON.stringify({
        version: 5,
        tutorialOffered: true,
        tutorialCompleted: true,
        accessibility: { reducedMotion },
      }));
    }, capture.reducedMotion);
    const page = await context.newPage();
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/?m20Fixture=1&m20Theme=parkland");
    await expect.poll(() => page.evaluate(() => typeof window.__coursecraftTest?.setZk330GroundingFixture)).toBe("function");
    await page.evaluate(() => window.__coursecraftTest!.setZk330GroundingFixture());
    await page.evaluate(({ rotation, quality }) => window.__coursecraftTest!.setZk330CaptureState(rotation, quality), capture);
    const canvas = page.locator(".cc-pixi-stage canvas");
    await expect(canvas).toBeVisible();
    const bankEvidence = await page.evaluate(() => window.__coursecraftTest!.zk330GroundingEvidence());
    expect(bankEvidence).toEqual({
      validBridgeCrossing: true,
      blockedWaterBank: true,
    });

    const samples: Array<Record<string, unknown>> = [];
    for (const progress of [0, .25, .5, .75, 1]) {
      await page.evaluate((nextProgress) => window.__coursecraftTest!.setZk330GroundingProgress(nextProgress), progress);
      await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest?.golferGrounding(330))).not.toBeNull();
      await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest?.golferGrounding(330)?.feet !== null)).toBe(true);
      const grounded = await page.evaluate(() => window.__coursecraftPixiTest!.golferGrounding(330)!);
      expect(grounded.holder.visible).toBe(true);
      expect(grounded.holder.x).toBeCloseTo(grounded.expected.x, 4);
      expect(grounded.holder.y).toBeCloseTo(grounded.expected.y, 4);
      expect(grounded.holder.depth).toBe(grounded.expected.depth);
      expect(grounded.feet).toMatchObject({ x: 0, y: 0 });
      expect(grounded.shadow).toMatchObject({ label: "golfer-contact-shadow", x: 1.5, y: .8 });
      expect(grounded.poolCount).toBe(1);
      expect(grounded.activeEffects).toBe(0);
      const png = progress === .5
        ? resolve(captureRoot, `r${capture.rotation * 90}-${capture.quality}-${capture.reducedMotion ? "reduced" : "motion"}.png`)
        : null;
      if (png) await canvas.screenshot({ path: png });
      samples.push({ progress, png, telemetry: grounded });
    }
    for (let index = 1; index < samples.length; index++) {
      const previous = samples[index - 1].telemetry as { golfer: { x: number; y: number } };
      const current = samples[index].telemetry as { golfer: { x: number; y: number } };
      expect(Math.hypot(current.golfer.x - previous.golfer.x, current.golfer.y - previous.golfer.y)).toBeLessThanOrEqual(1.01);
    }
    await page.evaluate(() => window.__coursecraftTest!.setZk330GroundingProgress(.5));
    await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest?.golferGrounding(330))).not.toBeNull();
    const beforePause = await page.evaluate(() => window.__coursecraftPixiTest!.golferGrounding(330)!);
    await page.evaluate(() => window.__coursecraftTest!.setZk330GroundingPause());
    await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest?.golferGrounding(330))).not.toBeNull();
    const afterPause = await page.evaluate(() => window.__coursecraftPixiTest!.golferGrounding(330)!);
    expect(afterPause.golfer.segKind).toBe("pause");
    expect(afterPause.golfer).toMatchObject({ x: beforePause.golfer.x, y: beforePause.golfer.y });
    expect(afterPause.holder).toMatchObject({ x: beforePause.holder.x, y: beforePause.holder.y, depth: beforePause.holder.depth });
    expect(afterPause.sprite?.walkPhase).toBe(beforePause.sprite?.walkPhase);
    report.push({ ...capture, bankEvidence, samples, pause: { before: beforePause, after: afterPause } });
    await context.close();
  }
  writeFileSync(
    resolve(captureRoot, "zk330-browser-report.json"),
    `${JSON.stringify({ version: 1, captures: report, errors }, null, 2)}\n`,
  );
  expect(errors).toEqual([]);
});
