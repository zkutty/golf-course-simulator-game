import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";
import {
  M53_SEASONAL_QUALITIES,
  M53_SEASONAL_TERRAIN_FIXTURES,
} from "../src/game/testing/m53SeasonalTerrainFixtures";
import { SEASONS } from "../src/game/seasons/types";
import { zk571ScreenshotDirectory } from "../scripts/zk571-certification-contract.mjs";

const artifactDirectory = process.env.ZK571_ARTIFACT_DIRECTORY
  ? resolve(process.env.ZK571_ARTIFACT_DIRECTORY)
  : resolve(process.cwd(), "artifacts/zk-571/v1");
const outputDirectory = zk571ScreenshotDirectory(artifactDirectory);

function pixelEvidence(buffer: Buffer) {
  const png = PNG.sync.read(buffer);
  let populatedPixels = 0;
  let pixelHash = 0x811c9dc5;
  for (let offset = 0; offset < png.data.length; offset += 4) {
    if (png.data[offset + 3] > 0) populatedPixels++;
    pixelHash ^= png.data[offset]
      | (png.data[offset + 1] << 8)
      | (png.data[offset + 2] << 16);
    pixelHash = Math.imul(pixelHash, 0x01000193);
  }
  return {
    width: png.width,
    height: png.height,
    populatedPixels,
    populatedRatio: populatedPixels / (png.width * png.height),
    pixelHash: (pixelHash >>> 0).toString(16).padStart(8, "0"),
    sha256: createHash("sha256").update(buffer).digest("hex"),
    bytes: buffer.byteLength,
  };
}

test("ZK-571 publishes a versioned machine-only screenshot/state matrix", async ({ page }) => {
  mkdirSync(outputDirectory, { recursive: true });
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });

  const fixtures = M53_SEASONAL_TERRAIN_FIXTURES.filter((fixture) => {
    return fixture.rotation === 0
      && fixture.quality === M53_SEASONAL_QUALITIES[2];
  });
  expect(fixtures).toHaveLength(12);
  const captures = [];

  for (const fixture of fixtures) {
    await page.goto(fixture.query);
    await expect.poll(() => page.evaluate(() => {
      const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
      return {
        screen: state.screen,
        theme: state.course?.theme,
        season: state.seasons?.calendar?.season,
        weather: state.seasons?.weather?.kind,
        quality: state.graphics?.quality,
        rotation: state.camera?.rotation,
      };
    }), { timeout: 120_000 }).toEqual({
      screen: "game",
      theme: fixture.biome,
      season: fixture.season,
      weather: fixture.weather,
      quality: fixture.quality,
      rotation: fixture.rotation * 90,
    });

    const dock = page.getByTestId("design-dock");
    await expect(dock).toBeVisible();
    await expect(dock).toHaveAttribute("aria-label", /.+/);
    await expect(dock.getByRole("tab")).toHaveCount(3);
    await expect(dock.locator('[role="tabpanel"]')).toHaveCount(3);
    const visibleButtonsMissingName = await page.locator("button:visible").evaluateAll((buttons) =>
      buttons.filter((button) =>
        !button.getAttribute("aria-label")
        && !button.getAttribute("title")
        && !(button.textContent ?? "").trim()).length);
    expect(visibleButtonsMissingName).toBe(0);

    const canvas = page.locator(".cc-pixi-stage canvas");
    await expect(canvas).toBeVisible();
    const buffer = await canvas.screenshot();
    const pixels = pixelEvidence(buffer);
    expect(pixels.populatedRatio).toBeGreaterThan(0.25);
    const filename = `${fixture.id}.png`;
    writeFileSync(resolve(outputDirectory, filename), buffer);
    captures.push({
      fixtureId: fixture.id,
      biome: fixture.biome,
      season: fixture.season,
      weather: fixture.weather,
      rotation: fixture.rotation,
      quality: fixture.quality,
      viewport: { width: 1440, height: 900 },
      filename,
      ...pixels,
    });
  }

  expect(new Set(captures.map((capture) => capture.pixelHash)).size)
    .toBeGreaterThanOrEqual(10);
  for (const season of SEASONS) {
    const seasonCaptures = captures.filter((capture) =>
      capture.season === season);
    expect(seasonCaptures).toHaveLength(3);
    expect(new Set(seasonCaptures.map((capture) => capture.biome)).size).toBe(3);
    expect(new Set(seasonCaptures.map((capture) => capture.pixelHash)).size)
      .toBe(3);
    expect(seasonCaptures.every((capture) =>
      capture.rotation === 0 && capture.quality === "high")).toBe(true);
  }

  await page.setViewportSize({ width: 760, height: 900 });
  await page.goto(fixtures[0]!.query);
  const narrowDock = page.getByTestId("design-dock");
  await expect(narrowDock).toBeVisible();
  const narrowBox = await narrowDock.boundingBox();
  expect(narrowBox).not.toBeNull();
  expect(narrowBox!.width).toBeLessThanOrEqual(302);
  const narrowBuffer = await page.screenshot();
  const narrowPixels = pixelEvidence(narrowBuffer);
  expect(narrowPixels.populatedRatio).toBeGreaterThan(0.25);
  writeFileSync(resolve(outputDirectory, "responsive-narrow.png"), narrowBuffer);

  const manifest = {
    version: 1,
    certificationId: "m53-zk571-v1",
    inspection: "machine-only",
    subjectiveInspectionPerformed: false,
    retainedEvidence:
      "Twelve same-camera/high-quality biome × season captures and one responsive UI capture are retained for the deferred human pass.",
    ephemeralEvidence:
      "Playwright traces, retry screenshots, videos, and attachment copies remain ephemeral test output.",
    captures,
    responsiveCapture: {
      filename: "responsive-narrow.png",
      viewport: { width: 760, height: 900 },
      ...narrowPixels,
    },
  };
  writeFileSync(
    resolve(outputDirectory, "matrix.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  expect(errors).toEqual([]);
});
