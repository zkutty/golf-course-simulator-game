import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

const outputRoot = resolve(process.env.ZK1210_EVIDENCE_DIR ?? "../zk1210-path-material-evidence");
const commit = process.env.ZK1210_COMMIT ?? "unknown";

type ScreenPoint = { x: number; y: number };
type PathDiagnostic = {
  active: boolean;
  mode: string;
  quality: string;
  componentCount: number;
  stripCount: number;
  roles: string[];
  textureIds: string[];
  widths: { shoulder: number; edge: number };
  ownership: string[];
  commit: string;
  camera: { rotation: number; zoom: number; targetZoom: number };
};

function averageRegion(image: PNG, start: ScreenPoint, end: ScreenPoint, from: number, to: number) {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const samples = Math.max(1, Math.floor(length * (to - from)));
  const sum = [0, 0, 0];
  for (let index = 0; index < samples; index++) {
    const t = from + (to - from) * ((index + 0.5) / samples);
    const x = Math.max(0, Math.min(image.width - 1, Math.round(start.x + (end.x - start.x) * t)));
    const y = Math.max(0, Math.min(image.height - 1, Math.round(start.y + (end.y - start.y) * t)));
    const offset = (y * image.width + x) * 4;
    sum[0] += image.data[offset];
    sum[1] += image.data[offset + 1];
    sum[2] += image.data[offset + 2];
  }
  return { samples, rgb: sum.map((value) => value / samples) };
}

function colorDistance(a: readonly number[], b: readonly number[]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function compactedCoreTextureStats(image: PNG, center: ScreenPoint, radius: number) {
  const luminance = (x: number, y: number) => {
    const offset = (y * image.width + x) * 4;
    return image.data[offset] * 0.2126 + image.data[offset + 1] * 0.7152 + image.data[offset + 2] * 0.0722;
  };
  const values: number[] = [];
  const neighborDeltas: number[] = [];
  const minX = Math.max(1, Math.floor(center.x - radius));
  const maxX = Math.min(image.width - 2, Math.ceil(center.x + radius));
  const minY = Math.max(1, Math.floor(center.y - radius));
  const maxY = Math.min(image.height - 2, Math.ceil(center.y + radius));
  const inside = (x: number, y: number) => (x - center.x) ** 2 + (y - center.y) ** 2 <= radius ** 2;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    if (!inside(x, y)) continue;
    const value = luminance(x, y);
    values.push(value);
    if (inside(x + 1, y)) neighborDeltas.push(Math.abs(value - luminance(x + 1, y)));
    if (inside(x, y + 1)) neighborDeltas.push(Math.abs(value - luminance(x, y + 1)));
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length);
  const meanNeighborDelta = neighborDeltas.reduce((sum, value) => sum + value, 0)
    / Math.max(1, neighborDeltas.length);
  return {
    radius,
    samples: values.length,
    standardDeviation: Math.sqrt(variance),
    meanNeighborDelta,
    fineEdgeRatio: neighborDeltas.filter((value) => value >= 1.5).length / Math.max(1, neighborDeltas.length),
    plateauRatio: neighborDeltas.filter((value) => value < 0.75).length / Math.max(1, neighborDeltas.length),
  };
}

function median(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function pointToSegmentDistanceSquared(point: ScreenPoint, a: ScreenPoint, b: ScreenPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-8) return (point.x - a.x) ** 2 + (point.y - a.y) ** 2;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return (point.x - (a.x + dx * t)) ** 2 + (point.y - (a.y + dy * t)) ** 2;
}

function changedOutsidePaddedPath(
  visible: PNG,
  hidden: PNG,
  path: readonly ScreenPoint[],
  paddingPx: number,
) {
  let outside = 0;
  let changed = 0;
  const paddingSquared = paddingPx ** 2;
  for (let y = 0; y < visible.height; y++) for (let x = 0; x < visible.width; x++) {
    const inPathRoi = path.some((point, index) => index + 1 < path.length
      && pointToSegmentDistanceSquared({ x, y }, point, path[index + 1]) <= paddingSquared);
    if (inPathRoi) continue;
    outside++;
    const offset = (y * visible.width + x) * 4;
    const delta = Math.abs(visible.data[offset] - hidden.data[offset])
      + Math.abs(visible.data[offset + 1] - hidden.data[offset + 1])
      + Math.abs(visible.data[offset + 2] - hidden.data[offset + 2]);
    if (delta > 18) changed++;
  }
  return { outside, changed, ratio: outside === 0 ? 0 : changed / outside };
}

async function pathDiagnostic(page: import("@playwright/test").Page): Promise<PathDiagnostic> {
  return page.evaluate(() => {
    const state = window.__coursecraftPixiTest!.rendererAtlasState() as unknown as {
      pathMaterialCrossSection: PathDiagnostic;
    };
    return state.pathMaterialCrossSection;
  });
}

test("ZK-1210 renders one three-material path cross-section through four rotations", async ({ page }) => {
  test.setTimeout(240_000);
  await mkdir(outputRoot, { recursive: true });
  await page.addInitScript(() => {
    localStorage.setItem("coursecraft_app_profile_v5", JSON.stringify({
      version: 5,
      tutorialOffered: true,
      tutorialCompleted: true,
      accessibility: { reducedMotion: true },
    }));
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m19Fixture=1");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 90_000 }).toBe("game");
  await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest));
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();

  const initialHash = await page.evaluate(() => window.__coursecraftTest!.state().courseHash);
  const captures: unknown[] = [];
  const closePixelGates: unknown[] = [];

  for (let turn = 0; turn < 4; turn++) {
    const rotation = turn * 90;
    if (turn > 0) {
      await page.keyboard.press("e");
      await expect.poll(() => page.evaluate(() => (
        JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation
      ))).toBe(rotation);
    }
    for (const view of [
      { label: "normal", quality: "medium" as const, zoom: 1, focus: { x: 24, y: 18 } },
      { label: "close", quality: "high" as const, zoom: 2.25, focus: { x: 12, y: 12 } },
    ]) {
      await page.evaluate(({ quality, zoom, focus }) => {
        window.__coursecraftTest!.setGraphicsQualityFixture(quality);
        window.__coursecraftPixiTest!.focusTileForTest(focus.x, focus.y, zoom);
      }, view);
      await expect.poll(async () => {
        const diagnostic = await pathDiagnostic(page);
        return diagnostic.active
          && diagnostic.quality === view.quality
          && diagnostic.camera.rotation === rotation
          && Math.abs(diagnostic.camera.zoom - view.zoom) < 0.001;
      }, { timeout: 30_000 }).toBe(true);
      const diagnostic = await pathDiagnostic(page);
      expect(diagnostic.mode).toBe("cross-section");
      expect(diagnostic.roles).toEqual(["shoulder", "edge", "core"]);
      expect(diagnostic.textureIds).toHaveLength(3);
      expect(diagnostic.widths.shoulder).toBeGreaterThan(0.2);
      expect(diagnostic.widths.edge).toBeGreaterThan(0.18);
      expect(diagnostic.ownership.every((item) => !/water|wetland|sand/.test(item))).toBe(true);
      const file = resolve(outputRoot, `zk1210-r${rotation}-${view.label}.png`);
      const screenshot = await canvas.screenshot();
      await writeFile(file, screenshot);
      captures.push({ file, rotation, ...view, diagnostic });

      if (view.label === "close") {
        const image = PNG.sync.read(screenshot);
        const box = await canvas.boundingBox();
        expect(box).not.toBeNull();
        // x=8..13 is a fixed six-cell straight authored segment. Select the
        // unobscured probe with the strongest *minimum* adjacent separation;
        // trees and ground-cover can cross a single tile in some rotations.
        const candidates = await page.evaluate(() => [8, 9, 10, 11, 12, 13].map((x) => ({
          tile: { x, y: 12 },
          pathCenter: window.__coursecraftPixiTest!.tileToScreen(x, 12),
          roughCenter: window.__coursecraftPixiTest!.tileToScreen(x, 11),
        })));
        const probes = candidates.flatMap((candidate) => {
          if (!candidate.pathCenter || !candidate.roughCenter) return [];
          const start = { x: candidate.pathCenter.x - box!.x, y: candidate.pathCenter.y - box!.y };
          const end = { x: candidate.roughCenter.x - box!.x, y: candidate.roughCenter.y - box!.y };
          const core = averageRegion(image, start, end, 0.08, 0.2);
          const edge = averageRegion(image, start, end, 0.32, 0.46);
          const shoulder = averageRegion(image, start, end, 0.54, 0.68);
          const distances = [colorDistance(core.rgb, edge.rgb), colorDistance(edge.rgb, shoulder.rgb)];
          return [{ ...candidate, start, end, core, edge, shoulder, distances, score: Math.min(...distances) }];
        });
        const selected = probes.sort((a, b) => b.score - a.score)[0];
        expect(selected).toBeDefined();
        const { core, edge, shoulder } = selected;
        const textureCandidates = probes.map((probe) => {
          const center = {
            x: probe.start.x + (probe.end.x - probe.start.x) * 0.14,
            y: probe.start.y + (probe.end.y - probe.start.y) * 0.14,
          };
          return { tile: probe.tile, ...compactedCoreTextureStats(image, center, 9) };
        });
        const coreTexture = {
          candidateCount: textureCandidates.length,
          medianStandardDeviation: median(textureCandidates.map((sample) => sample.standardDeviation)),
          medianNeighborDelta: median(textureCandidates.map((sample) => sample.meanNeighborDelta)),
          medianFineEdgeRatio: median(textureCandidates.map((sample) => sample.fineEdgeRatio)),
          medianPlateauRatio: median(textureCandidates.map((sample) => sample.plateauRatio)),
          candidates: textureCandidates,
        };
        // Guard the vocabulary regression without prescribing exact artwork:
        // dense local variation must occur across the straight core, while a
        // broad flat or panel-only fill fails on edge density and plateaus.
        expect(coreTexture.candidateCount).toBe(6);
        expect(coreTexture.medianStandardDeviation).toBeGreaterThan(2.25);
        expect(coreTexture.medianNeighborDelta).toBeGreaterThan(0.7);
        expect(coreTexture.medianFineEdgeRatio).toBeGreaterThan(0.12);
        expect(coreTexture.medianPlateauRatio).toBeLessThan(0.82);
        expect(core.samples).toBeGreaterThanOrEqual(4);
        expect(edge.samples).toBeGreaterThanOrEqual(4);
        expect(shoulder.samples).toBeGreaterThanOrEqual(4);
        expect(
          colorDistance(core.rgb, edge.rgb),
          JSON.stringify({ rotation, selected }),
        ).toBeGreaterThan(18);
        expect(
          colorDistance(edge.rgb, shoulder.rgb),
          JSON.stringify({ rotation, selected }),
        ).toBeGreaterThan(18);

        // The test-only visibility switch proves compositor pixels stay inside
        // a padded visible-route ROI; it does not change course or renderer data.
        const control = await page.evaluate(() => (
          window.__coursecraftPixiTest as unknown as {
            setPathMaterialVisibilityForTest(visible: boolean): boolean;
          }
        ).setPathMaterialVisibilityForTest(false));
        expect(control).toBe(true);
        const hidden = PNG.sync.read(await canvas.screenshot());
        await page.evaluate(() => (
          window.__coursecraftPixiTest as unknown as {
            setPathMaterialVisibilityForTest(visible: boolean): boolean;
          }
        ).setPathMaterialVisibilityForTest(true));
        const pathCells: Array<{ x: number; y: number }> = [];
        let priorY: number | null = null;
        for (let x = 3; x <= 44; x++) {
          const y = 10 + Math.round(Math.sin(x / 6) * 2);
          if (priorY != null) {
            const direction = Math.sign(y - priorY);
            for (let bridgeY = priorY; bridgeY !== y; bridgeY += direction || 1) pathCells.push({ x, y: bridgeY });
          }
          pathCells.push({ x, y });
          priorY = y;
        }
        const pathRoi = (await page.evaluate((cells) => cells.map(({ x, y }) => (
          window.__coursecraftPixiTest!.tileToScreen(x, y)
        )), pathCells))
          .filter((point): point is ScreenPoint => point != null)
          .map((point) => ({ x: point.x - box!.x, y: point.y - box!.y }));
        const paddingPx = 120;
        const outside = changedOutsidePaddedPath(image, hidden, pathRoi, paddingPx);
        expect(outside.ratio).toBeLessThan(0.001);
        closePixelGates.push({
          rotation,
          selectedTile: selected.tile,
          spans: { core, edge, shoulder },
          coreTexture,
          adjacentColorDistance: [colorDistance(core.rgb, edge.rgb), colorDistance(edge.rgb, shoulder.rgb)],
          roi: { kind: "padded-path-polyline", paddingPx, points: pathRoi.length },
          outside,
        });
      }
    }
  }

  expect(await page.evaluate(() => window.__coursecraftTest!.state().courseHash)).toBe(initialHash);
  await writeFile(resolve(outputRoot, "zk1210-path-material-report.json"), `${JSON.stringify({
    version: 1,
    issue: "ZK-1210",
    commit,
    fixture: "m19Fixture",
    viewport: { width: 1440, height: 900 },
    command: "ZK1210_EVIDENCE_DIR=<dir> ZK1210_COMMIT=<sha> npx playwright test e2e/path-material-cross-section.e2e.ts --workers=1 --retries=0",
    initialHash,
    finalHash: await page.evaluate(() => window.__coursecraftTest!.state().courseHash),
    metrics: await page.evaluate(() => window.__coursecraftTest!.m35Metrics()),
    closePixelGates,
    captures,
  }, null, 2)}\n`);
});
