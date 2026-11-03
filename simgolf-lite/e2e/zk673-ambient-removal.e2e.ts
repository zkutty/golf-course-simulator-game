import { expect, test } from "@playwright/test";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { PNG } from "pngjs";
import type { Zk673Sample } from "./fixtures/zk673-atmosphere";

test.use({ viewport: { width: 1000, height: 760 }, deviceScaleFactor: 1,
  trace: "off", video: "off", screenshot: "off" });

function changedPixels(a: Buffer, b?: Buffer): number {
  const image = PNG.sync.read(a);
  const other = b ? PNG.sync.read(b) : undefined;
  let changes = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const expected = other ? other.data.subarray(offset, offset + 3) : [0x28, 0x41, 0x3b];
    const delta = [0, 1, 2].reduce((sum, channel) => sum + Math.abs(image.data[offset + channel] - expected[channel]), 0);
    if (delta >= 6) changes++;
  }
  return changes;
}

function summary(samples: Zk673Sample[]) {
  const metrics = ["frameMs", "tickMs", "submissionMs", "drawCalls", "clearCalls"] as const;
  return Object.fromEntries(metrics.map(metric => {
    const values = samples.map(sample => sample[metric]).sort((a, b) => a - b);
    return [metric, { median: values[Math.floor(values.length / 2)],
      p95: values[Math.floor(values.length * .95)], mean: values.reduce((sum, value) => sum + value, 0) / values.length }];
  })) as Record<typeof metrics[number], { median: number; p95: number; mean: number }>;
}
async function treeBytes(directory: string): Promise<number> {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    bytes += entry.isDirectory() ? await treeBytes(filename) : (await stat(filename)).size;
  }
  return bytes;
}

test("ZK-673 actual Pixi removes overlays and retains atmosphere effects", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const fixtureDir = path.resolve(import.meta.dirname, "fixtures");
  const html = await readFile(path.join(fixtureDir, "zk673-atmosphere.html"), "utf8");
  const source = await readFile(path.join(fixtureDir, "zk673-atmosphere.ts"), "utf8");
  // Ordinary e2e runs exercise the candidate at the configured app server.
  // Supplying both URLs additionally enables the untouched-base control and
  // paired component performance comparison.
  const paired = !!process.env.ZK673_BASE_URL && !!process.env.ZK673_CANDIDATE_URL;
  const candidateUrl = process.env.ZK673_CANDIDATE_URL ?? testInfo.project.use.baseURL;
  if (!candidateUrl) throw new Error("Candidate URL requires Playwright baseURL or ZK673_CANDIDATE_URL");
  const origins: Array<{ label: "base" | "candidate"; url: string }> = [
    ...(paired ? [{ label: "base" as const, url: process.env.ZK673_BASE_URL! }] : []),
    { label: "candidate", url: candidateUrl },
  ];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const assertionsOnly = process.env.ZK673_ASSERTIONS_ONLY === "1";
  const reports = [];
  for (const origin of origins) {
    // Read the server's canonical optimized Pixi URL so the fixture and actual
    // scene use the same classes. The baseline receives no filesystem writes.
    const moduleResponse = await request.get(`${origin.url}/src/ui/renderer/scenes/atmosphereScene.ts`);
    expect(moduleResponse.ok()).toBe(true);
    const moduleSource = await moduleResponse.text();
    const pixiUrl = moduleSource.match(/from\s+["']([^"']*pixi[^"']*)["']/)?.[1];
    expect(pixiUrl, `${origin.label}: canonical Pixi dependency`).toBeTruthy();
    const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext } }).outputText
      .replace('"pixi.js"', JSON.stringify(pixiUrl))
      .replaceAll('"../../src/', '"/src/');
    await page.route(`${origin.url}/e2e/fixtures/zk673-atmosphere.html`, route => route.fulfill({ contentType: "text/html", body: html }));
    await page.route(`${origin.url}/e2e/fixtures/zk673-atmosphere.ts`, route => route.fulfill({ contentType: "text/javascript", body: js }));
    await page.goto(`${origin.url}/e2e/fixtures/zk673-atmosphere.html`);
    await expect.poll(() => page.evaluate(() => !!window.zk673Atmosphere), { timeout: 20_000 }).toBe(true);
    const renderer = await page.evaluate(() => window.zk673Atmosphere.renderer);
    expect(renderer.webglVersion).toMatch(/WebGL/);
    expect(renderer.terrainTiles).toBe(2400);
    expect(renderer.populationPrimitives).toBe(180);
    const timeline = await page.evaluate(() => window.zk673Atmosphere.timeline());
    expect(timeline.stable).toBe(true);
    expect(timeline.ticks).toBe(276);

    const active = await page.evaluate(() => window.zk673Atmosphere.pose(0, 37, 20_000));
    expect(active.shimmerVisible).toBe(true);
    expect(active.heronVisible).toBe(true);
    const fullPath = testInfo.outputPath(`${origin.label}-populated-day.png`);
    await page.locator("canvas").screenshot({ path: fullPath });
    const capture = async (kind: "sky" | "clouds" | "shimmer" | "heron") => {
      await page.evaluate(layer => window.zk673Atmosphere.isolate(layer), kind);
      return page.locator("canvas").screenshot();
    };
    const sky = await capture("sky");
    const clouds = await capture("clouds");
    const shimmer = await capture("shimmer");
    const heron = await capture("heron");
    const pixels = { sky: changedPixels(sky), clouds: changedPixels(clouds),
      shimmer: changedPixels(shimmer), heron: changedPixels(heron) };
    await writeFile(testInfo.outputPath(`${origin.label}-sky-isolated.png`), sky);
    await writeFile(testInfo.outputPath(`${origin.label}-clouds-isolated.png`), clouds);
    expect(pixels.shimmer, `${origin.label}: actual shimmer pixels`).toBeGreaterThan(20);
    expect(pixels.heron, `${origin.label}: actual heron pixels`).toBeGreaterThan(3);
    const removalPass = active.skyGraphics === 0 && active.clouds === 0 && pixels.sky === 0 && pixels.clouds === 0;
    // Explicit baseline-positive control: this removal assertion rejects base.
    expect(removalPass, `${origin.label}: overlay removal visual regression predicate`).toBe(origin.label === "candidate");
    expect(timeline.peakSkyGraphics).toBe(origin.label === "base" ? 1 : 0);
    expect(timeline.peakClouds).toBe(origin.label === "base" ? 3 : 0);
    if (origin.label === "base") {
      expect(pixels.sky).toBeGreaterThan(20);
      expect(pixels.clouds).toBeGreaterThan(100);
    }

    await page.evaluate(() => { window.zk673Atmosphere.pose(0, 0, 20_000); window.zk673Atmosphere.isolate("tint"); });
    const dawn = await page.locator("canvas").screenshot();
    const dawnTint = await page.evaluate(() => window.zk673Atmosphere.pose(0, 0, 20_000).tint);
    expect(dawnTint).toBe(0xebf2ff);
    await page.evaluate(() => window.zk673Atmosphere.pose(0, 420, 20_000, false));
    const neutral = await page.locator("canvas").screenshot();
    const tintPixels = changedPixels(dawn, neutral);
    expect(tintPixels, `${origin.label}: isolated time-of-day tint pixels`).toBeGreaterThan(10_000);
    const disabled = await page.evaluate(() => window.zk673Atmosphere.pose(90, 37, 20_000, true, false));
    expect(disabled.heronVisible).toBe(false);
    expect(disabled.shimmerVisible).toBe(false);
    expect(disabled.tint).toBe(0xffffff);
    await page.evaluate(() => window.zk673Atmosphere.pose(180, 840, 20_000));
    await page.locator("canvas").screenshot({ path: testInfo.outputPath(`${origin.label}-rotated-evening.png`) });
    const samples = paired && !assertionsOnly ? await page.evaluate(() => window.zk673Atmosphere.measure()) : [];
    expect(samples).toHaveLength(paired && !assertionsOnly ? 360 : 0);
    const disposed = await page.evaluate(() => window.zk673Atmosphere.dispose());
    expect(disposed).toEqual({ remaining: 0, fx: 0, objects: 0, stage: 2,
      objectsDestroyed: true, ownedTextureDestroyed: true, borrowedWhiteDestroyed: false });
    reports.push({ label: origin.label, renderer, timeline, active, pixels, tintPixels, removalPass,
      summary: samples.length ? summary(samples) : null, samples, disposed });
    await page.unrouteAll({ behavior: "wait" });
  }
  if (assertionsOnly || !paired) {
    await writeFile(testInfo.outputPath("zk673-visual-assertions.json"), `${JSON.stringify({
      scope: "synthetic-course visual/lifecycle assertions; paired performance measurement not requested",
      browserVersion: page.context().browser()?.version(), errors, reports,
    }, null, 2)}\n`);
    expect(errors).toEqual([]);
    expect(await treeBytes(testInfo.outputDir), "bounded output cap").toBeLessThan(32 * 1024 * 1024);
    return;
  }
  const [base, candidate] = reports;
  if (!base.summary || !candidate.summary) throw new Error("Missing paired performance samples");
  // rAF is vsync/host scheduling, render is CPU submission, tick is CPU work.
  // None measures GPU completion. Fixed absolute floors accommodate browser
  // timer quantization for these tiny values; relative margins catch larger regressions.
  const bounds = {
    tickMeanMs: base.summary.tickMs.mean * 1.25 + .01,
    submissionP95Ms: base.summary.submissionMs.p95 * 1.25 + .3,
    rafP95Ms: Math.max(base.summary.frameMs.p95 * 1.20, base.summary.frameMs.p95 + 4),
  };
  const report = { scope: "synthetic populated course, actual atmosphere and Pixi/WebGL; component evidence only",
    measurement: "120 warmup + 360 sampled rAF frames per variant; 24 tick calls/frame normalized per tick; render CPU submission excludes GPU completion",
    order: "base then candidate, sequential single worker", browserVersion: page.context().browser()?.version(), bounds, errors, reports };
  await writeFile(testInfo.outputPath("zk673-component-acceptance.json"), `${JSON.stringify(report, null, 2)}\n`);
  expect(candidate.summary.tickMs.mean, "tick CPU mean: 25% + 0.01ms noise floor").toBeLessThanOrEqual(bounds.tickMeanMs);
  expect(candidate.summary.submissionMs.p95, "render submission p95: 25% + 0.3ms noise floor").toBeLessThanOrEqual(bounds.submissionP95Ms);
  expect(candidate.summary.frameMs.p95, "rAF frame p95: max 20% / 4ms noise floor").toBeLessThanOrEqual(bounds.rafP95Ms);
  expect(base.summary.clearCalls.mean).toBe(1);
  expect(candidate.summary.clearCalls.mean).toBe(0);
  expect(candidate.summary.drawCalls.mean).toBeLessThanOrEqual(base.summary.drawCalls.mean);
  expect(errors).toEqual([]);
  expect(await treeBytes(testInfo.outputDir), "bounded output cap").toBeLessThan(32 * 1024 * 1024);
});
