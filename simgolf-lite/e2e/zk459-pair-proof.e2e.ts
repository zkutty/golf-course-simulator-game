import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const outputRoot = resolve(process.env.ZK459_PROOF_DIR ?? "../zk459-pair-proof-evidence");
const profileKey = "coursecraft_app_profile_v5";
type Quality = "high" | "medium" | "low";
type Mode = "standard" | "deuteranopia";

const proofs = [
  { pair: "fairway--deep_rough", feature: "straight", focus: { x: 29, y: 21 } },
  { pair: "fairway--green", feature: "inner-turn-se", focus: { x: 37, y: 17 } },
  { pair: "fairway--rough", feature: "outer-turn-nw", focus: { x: 39, y: 14 } },
  { pair: "fairway--tee", feature: "straight", focus: { x: 10, y: 18 } },
  { pair: "rough--green", feature: "outer-turn-sw", focus: { x: 42, y: 17 } },
  { pair: "rough--tee", feature: "straight", focus: { x: 5, y: 14 } },
] as const;

async function applyPalette(page: Page, mode: Mode) {
  await page.evaluate(({ key, mode }) => {
    const profile = JSON.parse(localStorage.getItem(key) ?? "{}");
    profile.accessibility = {
      ...profile.accessibility,
      colorVision: mode,
      terrainPatterns: false,
      reducedMotion: true,
    };
    profile.graphics = { ...profile.graphics, animations: false };
    localStorage.setItem(key, JSON.stringify(profile));
  }, { key: profileKey, mode });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-color-vision", mode);
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), {
    timeout: 90_000,
  }).toBe("game");
  await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest));
}

test("ZK-459 proves all six derived pair materials before the M19 matrix", async ({ page }) => {
  test.setTimeout(600_000);
  await mkdir(outputRoot, { recursive: true });
  const errors: string[] = [];
  page.on("console", (entry) => {
    if (entry.type() === "error") errors.push(entry.text());
  });
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m19Fixture=1");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), {
    timeout: 90_000,
  }).toBe("game");

  const captures: Array<Record<string, unknown>> = [];
  const captureSet = async (mode: Mode, quality: Quality) => {
    await applyPalette(page, mode);
    for (const proof of proofs) {
      await page.evaluate(({ quality, focus }) => {
        window.__coursecraftTest!.setGraphicsQualityFixture(quality);
        window.__coursecraftPixiTest!.focusTileForTest(focus.x, focus.y, 4);
      }, { quality, focus: proof.focus });
      await expect.poll(() => page.evaluate(({ quality }) => {
        const state = window.__coursecraftPixiTest!.rendererAtlasState();
        return state.parklandComposable.pairFringes?.quality === quality
          && Math.abs(state.parklandComposable.camera.zoom - 4) < 0.001;
      }, { quality }), { timeout: 90_000 }).toBe(true);
      await page.waitForTimeout(180);
      const bytes = await page.screenshot({ fullPage: true });
      const name = `${mode}-${quality}-${proof.pair}-${proof.feature}.png`;
      await writeFile(resolve(outputRoot, name), bytes);
      captures.push({
        file: name,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        mode,
        quality,
        ...proof,
      });
    }
  };

  for (const quality of ["medium", "high", "low"] as const) {
    await captureSet("standard", quality);
  }
  await captureSet("deuteranopia", "medium");

  expect(captures).toHaveLength(24);
  expect(new Set(captures.map((capture) => capture.sha256)).size).toBe(24);
  expect(errors).toEqual([]);
  await writeFile(resolve(outputRoot, "zk459-pair-proof-report.json"), `${JSON.stringify({
    version: 2,
    issue: "ZK-459",
    fixture: "m19Fixture-all-six-pair-closeups",
    zoom: 4,
    errors,
    captures,
  }, null, 2)}\n`);
});
