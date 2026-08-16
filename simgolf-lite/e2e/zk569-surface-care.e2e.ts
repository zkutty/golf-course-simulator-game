import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

const url = "/?m53Fixture=1&m53Theme=parkland&m53Season=summer&m53Weather=drought&m53Rotation=0&m53Quality=high";

function populatedPixels(buffer: Buffer): number {
  const png = PNG.sync.read(buffer);
  let populated = 0;
  for (let offset = 0; offset < png.data.length; offset += 4) {
    if (png.data[offset + 3] > 0) populated++;
  }
  return populated;
}

test("ZK-569 projects and clears bounded care evidence on the mounted course", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);

  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return {
      screen: state.screen,
      quality: state.graphics?.quality,
      fixture: typeof window.__coursecraftTest?.setM53SurfaceCareFixture,
      pixi: typeof window.__coursecraftPixiTest?.surfaceCareLayer,
    };
  }), { timeout: 120_000 }).toEqual({
    screen: "game",
    quality: "high",
    fixture: "function",
    pixi: "function",
  });

  const canvas = page.locator(".cc-pixi-stage canvas");
  await expect(canvas).toBeVisible();
  const canvasHandle = await canvas.elementHandle();
  expect(canvasHandle).not.toBeNull();

  await page.evaluate(() => {
    window.__coursecraftTest!.resetM35Metrics();
    window.__coursecraftTest!.setM53SurfaceCareFixture("evidence");
  });
  const readEvidence = () => page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    const presentation = state.course?.surfaceCare?.presentation;
    const layer = window.__coursecraftPixiTest?.surfaceCareLayer();
    return {
      signature: presentation?.signature ?? "",
      observedZones: presentation?.observedZones ?? 0,
      commands: presentation?.commands ?? 0,
      budget: presentation?.budget ?? 0,
      cueCounts: presentation?.cueCounts ?? {},
      holes: Object.keys(presentation?.holeCounts ?? {}).length,
      layer,
      chunkRebuilds: window.__coursecraftTest?.m35Metrics().chunkRebuild.count ?? 0,
    };
  });
  await expect.poll(readEvidence, { timeout: 120_000 }).toMatchObject({
    observedZones: expect.any(Number),
    commands: expect.any(Number),
    budget: 480,
    cueCounts: {
      "worn-line": expect.any(Number),
      divot: expect.any(Number),
      compaction: expect.any(Number),
      "mud-softness": expect.any(Number),
      "dry-stress": expect.any(Number),
      "wet-disease-risk": expect.any(Number),
      "weed-pressure": expect.any(Number),
      overgrowth: expect.any(Number),
      thinning: expect.any(Number),
      "bare-failure": expect.any(Number),
      "repair-reseed": expect.any(Number),
      "repair-resod": expect.any(Number),
      "recovery-dressing": expect.any(Number),
      "groundskeeper-work": expect.any(Number),
    },
    holes: expect.any(Number),
    layer: {
      children: expect.any(Number),
      workers: expect.any(Number),
      index: expect.any(Number),
      seasonalIndex: expect.any(Number),
      markerIndex: expect.any(Number),
      objectsIndex: expect.any(Number),
    },
    chunkRebuilds: expect.any(Number),
  });
  const evidence = await readEvidence();
  expect(evidence.observedZones).toBeGreaterThanOrEqual(7);
  expect(evidence.commands).toBeGreaterThan(20);
  expect(evidence.commands).toBeLessThanOrEqual(evidence.budget);
  expect(evidence.holes).toBeGreaterThanOrEqual(2);
  expect(evidence.layer!.children).toBeGreaterThan(0);
  expect(evidence.layer!.workers).toBeGreaterThan(0);
  expect(evidence.layer!.seasonalIndex).toBeLessThan(evidence.layer!.index);
  expect(evidence.layer!.index).toBeLessThan(evidence.layer!.markerIndex);
  expect(evidence.layer!.markerIndex).toBeLessThan(evidence.layer!.objectsIndex);
  expect(evidence.chunkRebuilds).toBeGreaterThan(0);

  const evidenceShot = await canvas.screenshot();
  const evidencePng = PNG.sync.read(evidenceShot);
  expect(populatedPixels(evidenceShot)).toBeGreaterThan(
    evidencePng.width * evidencePng.height * 0.25,
  );
  await testInfo.attach("zk569-observed-care", {
    body: evidenceShot,
    contentType: "image/png",
  });

  const beforeResolutionRebuilds = evidence.chunkRebuilds;
  await page.evaluate(() =>
    window.__coursecraftTest!.setM53SurfaceCareFixture("resolved"));
  const readResolved = () => page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    const presentation = state.course?.surfaceCare?.presentation;
    return {
      commands: presentation?.commands ?? -1,
      cueCounts: presentation?.cueCounts ?? null,
      layer: window.__coursecraftPixiTest?.surfaceCareLayer(),
      chunkRebuilds: window.__coursecraftTest?.m35Metrics().chunkRebuild.count ?? 0,
    };
  });
  await expect.poll(readResolved, { timeout: 120_000 }).toMatchObject({
    commands: 0,
    cueCounts: {},
    layer: { children: 0, workers: 0 },
    chunkRebuilds: expect.any(Number),
  });
  const resolved = await readResolved();
  expect(resolved.chunkRebuilds).toBeGreaterThan(beforeResolutionRebuilds);
  expect(await canvasHandle!.evaluate((node) =>
    node === document.querySelector(".cc-pixi-stage canvas"))).toBe(true);

  const resolvedShot = await canvas.screenshot();
  expect(resolvedShot.equals(evidenceShot)).toBe(false);
  await testInfo.attach("zk569-resolved-care", {
    body: resolvedShot,
    contentType: "image/png",
  });

  await page.evaluate(() =>
    window.__coursecraftTest!.setM53SurfaceCareFixture("healthy"));
  const readRoutine = () => page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    const presentation = state.course?.surfaceCare?.presentation;
    return {
      signature: presentation?.signature ?? "",
      commands: presentation?.commands ?? -1,
      layer: window.__coursecraftPixiTest?.surfaceCareLayer(),
      chunkRebuilds:
        window.__coursecraftTest?.m35Metrics().chunkRebuild.count ?? 0,
    };
  });
  await expect.poll(readRoutine, { timeout: 120_000 }).toMatchObject({
    commands: 0,
    layer: { children: 0 },
  });
  const healthy = await readRoutine();

  await page.evaluate(() => {
    window.__coursecraftTest!.resetM35Metrics();
    window.__coursecraftTest!.setM53SurfaceCareFixture("cue-only");
  });
  await expect.poll(readRoutine, { timeout: 120_000 }).toMatchObject({
    commands: expect.any(Number),
    layer: { children: expect.any(Number) },
    chunkRebuilds: 0,
  });
  const cueOnly = await readRoutine();
  expect(cueOnly.commands).toBeGreaterThan(0);
  expect(cueOnly.layer!.children).toBeGreaterThan(0);
  expect(cueOnly.signature).not.toBe(healthy.signature);
  expect(cueOnly.chunkRebuilds).toBe(0);

  await page.evaluate(() => {
    window.__coursecraftTest!.resetM35Metrics();
    window.__coursecraftTest!.setM53SurfaceCareFixture("mowing");
  });
  await expect.poll(readRoutine, { timeout: 120_000 }).toMatchObject({
    commands: 0,
    layer: { children: 0 },
    chunkRebuilds: expect.any(Number),
  });
  const mowing = await readRoutine();
  expect(mowing.signature).not.toBe(cueOnly.signature);
  expect(mowing.chunkRebuilds).toBeGreaterThan(0);
  expect(await canvasHandle!.evaluate((node) =>
    node === document.querySelector(".cc-pixi-stage canvas"))).toBe(true);
  expect(errors).toEqual([]);
});
