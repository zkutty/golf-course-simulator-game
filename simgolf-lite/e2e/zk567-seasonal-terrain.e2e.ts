import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";
import {
  M53_SEASONAL_TERRAIN_FIXTURES,
  M53_SEASONAL_QUALITIES,
} from "../src/game/testing/m53SeasonalTerrainFixtures";
import { SEASONS } from "../src/game/seasons/types";

const fixtureUrl = (query: string) => `${process.env.ZK567_BASE_URL ?? ""}${query}`;

test("ZK-567 seasonal terrain machine matrix keeps typed state and populated pixels", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });

  // The pure golden fixture test pins all 144 combinations. This browser
  // slice exercises every biome and season while distributing four rotations
  // and three quality paths across 12 machine captures.
  const browserFixtures = M53_SEASONAL_TERRAIN_FIXTURES.filter((fixture) => {
    const seasonIndex = SEASONS.indexOf(fixture.season);
    return fixture.rotation === seasonIndex
      && fixture.quality === M53_SEASONAL_QUALITIES[
        (seasonIndex + ["parkland", "links", "desert"].indexOf(fixture.biome)) % 3
      ];
  });
  expect(browserFixtures).toHaveLength(12);
  const pixelHashes = new Set<string>();

  for (const fixture of browserFixtures) {
    await page.goto(fixtureUrl(fixture.query));
    await expect.poll(async () => {
      const state = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
      return {
        screen: state.screen,
        theme: state.course?.theme,
        season: state.seasons?.calendar?.season,
        weather: state.seasons?.weather?.kind,
        quality: state.seasons?.presentation?.terrain?.quality,
        profileQuality: state.graphics?.quality,
        resolvedQuality: state.graphics?.quality,
        decalBudget: state.seasons?.presentation?.terrain?.decalBudget,
        profile: state.seasons?.presentation?.terrain?.profile,
        rotation: state.camera?.rotation,
      };
    }, { timeout: 120_000 }).toEqual({
      screen: "game",
      theme: fixture.biome,
      season: fixture.season,
      weather: fixture.weather,
      quality: fixture.quality,
      profileQuality: fixture.quality,
      resolvedQuality: fixture.quality,
      decalBudget: fixture.quality === "low" ? 0 : fixture.quality === "medium" ? 220 : 420,
      profile: fixture.biome === "parkland"
        ? "four-season"
        : fixture.biome === "links" ? "exposed-muted" : "drought-heat-led",
      rotation: fixture.rotation * 90,
    });

    const state = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
    const terrain = state.seasons.presentation.terrain;
    expect(Object.keys(terrain.terrains)).toHaveLength(10);
    expect(terrain.terrains.water).toMatchObject({
      aquatic: true,
      opaqueCoverage: 0,
      supportedCues: ["water-sheen"],
    });
    expect(terrain.terrains.water.channels.snow).toBe(0);
    expect(Object.values(terrain.terrains).every((entry: unknown) =>
      (entry as { opaqueCoverage: number }).opaqueCoverage === 0)).toBe(true);
    if (fixture.season === "winter" && fixture.biome !== "desert") {
      expect(terrain.terrains.rough.channels.snow).toBeGreaterThan(0);
    }
    if (fixture.biome === "links" && fixture.season === "winter") {
      expect(terrain.terrains.rough.channels.frost).toBeGreaterThan(0);
    }
    if (fixture.season === "summer" && fixture.biome !== "links") {
      expect(terrain.terrains.rough.channels.drought).toBeGreaterThan(0);
    }

    const canvas = page.locator(".cc-pixi-stage canvas");
    await expect(canvas).toBeVisible();
    const shot = await canvas.screenshot();
    const png = PNG.sync.read(shot);
    let nonTransparent = 0;
    let checksum = 0x811c9dc5;
    for (let offset = 0; offset < png.data.length; offset += 4) {
      if (png.data[offset + 3] > 0) nonTransparent++;
      checksum ^= png.data[offset] | (png.data[offset + 1] << 8) | (png.data[offset + 2] << 16);
      checksum = Math.imul(checksum, 0x01000193);
    }
    expect(nonTransparent).toBeGreaterThan(png.width * png.height * .25);
    pixelHashes.add((checksum >>> 0).toString(16));
    await testInfo.attach(fixture.id, { body: shot, contentType: "image/png" });
  }

  expect(pixelHashes.size).toBeGreaterThanOrEqual(10);
  expect(errors).toEqual([]);
});

test("ZK-567 Low chunks retint across a same-mounted authoritative season transition", async ({ page }) => {
  const start = M53_SEASONAL_TERRAIN_FIXTURES.find((fixture) =>
    fixture.biome === "parkland"
    && fixture.season === "spring"
    && fixture.rotation === 0
    && fixture.quality === "low");
  expect(start).toBeDefined();
  await page.goto(fixtureUrl(start!.query));
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return {
      screen: state.screen,
      season: state.seasons?.calendar?.season,
      quality: state.graphics?.quality,
    };
  }), { timeout: 120_000 }).toEqual({
    screen: "game",
    season: "spring",
    quality: "low",
  });

  const canvas = page.locator(".cc-pixi-stage canvas");
  await expect(canvas).toBeVisible();
  const canvasHandle = await canvas.elementHandle();
  expect(canvasHandle).not.toBeNull();
  const before = await canvas.screenshot();
  await expect.poll(() => page.evaluate(() =>
    typeof window.__coursecraftTest?.setM53SeasonalFixture === "function"
    && typeof window.__coursecraftTest?.resetM35Metrics === "function"),
  ).toBe(true);
  await page.evaluate(() => {
    window.__coursecraftTest.resetM35Metrics();
    window.__coursecraftTest.setM53SeasonalFixture("summer");
  });

  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return {
      season: state.seasons?.calendar?.season,
      weather: state.seasons?.weather?.kind,
      quality: state.graphics?.quality,
      droughtPositive:
        (state.seasons?.presentation?.terrain?.terrains?.rough?.channels?.drought ?? 0) > 0,
      chunkRebuildPositive: (() => {
        const count = window.__coursecraftTest.m35Metrics().chunkRebuild.count;
        return count > 0;
      })(),
    };
  }), { timeout: 120_000 }).toMatchObject({
    season: "summer",
    weather: "drought",
    quality: "low",
    droughtPositive: true,
    chunkRebuildPositive: true,
  });
  const transitioned = await page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return {
      drought: state.seasons.presentation.terrain.terrains.rough.channels.drought,
      chunkRebuilds: window.__coursecraftTest.m35Metrics().chunkRebuild.count,
      width: state.course.width,
      height: state.course.height,
    };
  });
  expect(transitioned.drought).toBeGreaterThan(0);
  const chunkCount = Math.ceil(transitioned.width / 16) * Math.ceil(transitioned.height / 16);
  expect(transitioned.chunkRebuilds).toBeGreaterThanOrEqual(chunkCount);
  // Every recorded pass must cover the complete course: the seasonal
  // treatment signature is a whole-renderer revision, never a stray dirty
  // tile. The external-store fixture can publish a bounded series of
  // authoritative world/live snapshots while it changes seed, week, and day.
  expect(transitioned.chunkRebuilds % chunkCount).toBe(0);
  expect(transitioned.chunkRebuilds).toBeLessThanOrEqual(chunkCount * 12);
  expect(await canvasHandle!.evaluate((node) =>
    node === document.querySelector(".cc-pixi-stage canvas"))).toBe(true);
  const after = await canvas.screenshot();
  expect(after.equals(before)).toBe(false);
});
