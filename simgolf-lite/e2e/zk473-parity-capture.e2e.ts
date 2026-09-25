import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

const outputRoot = resolve(process.env.ZK473_EVIDENCE_DIR ?? "../zk473-parity-evidence");
const commit = process.env.ZK473_COMMIT ?? "unknown";
const viewport = { width: 1440, height: 900 };
const capturesToRecord = [
  { label: "normal-medium", quality: "medium" },
  { label: "normal-high", quality: "high" },
] as const;

type RendererAtlasState = ReturnType<NonNullable<Window["__coursecraftPixiTest"]>["rendererAtlasState"]>;
type NormalFrame = NonNullable<ReturnType<NonNullable<Window["__coursecraftPixiTest"]>["normalFrame"]>>;
type CameraTransform = NonNullable<ReturnType<NonNullable<Window["__coursecraftPixiTest"]>["cameraTransform"]>>;

type Capture = {
  file: string;
  sha256: string;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  label: "normal-medium" | "normal-high";
  quality: "high" | "medium";
  structuredState: unknown;
  normalFrame: NormalFrame;
  cameraTransform: CameraTransform;
  composition: {
    planHash: string;
    courseHash: string;
    obstacleHash: string;
    habitatZoneIds: readonly string[];
    visiblePointCount: number;
  };
  renderer: RendererAtlasState;
};

function rendererProblems(state: RendererAtlasState, quality: "high" | "medium"): string[] {
  const problems: string[] = [];
  const { activation, rendered, requested } = state;
  if (activation.pending !== null) problems.push("activation-pending");
  if (rendered.status !== "activated") problems.push(`rendered-status:${rendered.status}`);
  if (activation.requestId !== activation.latestRequestId) problems.push("latest-request-mismatch");
  if (activation.requestId !== rendered.requestId) problems.push("rendered-request-mismatch");
  if (activation.generation !== rendered.generation || rendered.generation <= 0) problems.push("generation-mismatch");
  if (requested.bundleKey !== rendered.bundleKey || activation.bundleKey !== rendered.bundleKey) problems.push("bundle-mismatch");
  if (requested.quality !== quality || rendered.quality !== quality) problems.push("quality-mismatch");
  const layerGenerations = state.layers ? Object.values(state.layers) : [];
  if (layerGenerations.length === 0 || layerGenerations.some((generation) => generation !== rendered.generation)) {
    problems.push("layer-generation-mismatch");
  }
  if ((state.counts?.terrainChunks ?? 0) <= 0) problems.push("terrain-empty");
  if ((state.counts?.naturalProps.fallbackTextures ?? -1) !== 0) problems.push("natural-prop-fallback");
  if (state.fallbacks.length !== 0) problems.push("fallback-diagnostics");
  return problems;
}

function rendererSignature(state: RendererAtlasState): string {
  return JSON.stringify({
    requested: state.requested,
    rendered: state.rendered,
    activation: state.activation,
    layers: state.layers,
    terrainChunks: state.counts?.terrainChunks,
    naturalPropFallbackTextures: state.counts?.naturalProps.fallbackTextures,
    fallbacks: state.fallbacks,
  });
}

async function waitForStableRenderer(page: import("@playwright/test").Page, quality: "high" | "medium"): Promise<RendererAtlasState> {
  await expect.poll(async () => rendererProblems(
    await page.evaluate(() => window.__coursecraftPixiTest!.rendererAtlasState()),
    quality,
  ), { timeout: 90_000 }).toEqual([]);
  const [first, last] = await page.evaluate(async () => {
    const sample = () => window.__coursecraftPixiTest!.rendererAtlasState();
    const first = sample();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return [first, sample()] as const;
  });
  expect(rendererProblems(first, quality)).toEqual([]);
  expect(rendererProblems(last, quality)).toEqual([]);
  expect(rendererSignature(last)).toBe(rendererSignature(first));
  return last;
}

async function enterNormalGameplay(page: import("@playwright/test").Page): Promise<void> {
  // This established test seam invokes the real reducer/UI transition only;
  // it does not write Pixi camera state or call a camera test helper.
  await page.evaluate(() => window.__coursecraftTest!.enterNormalGameplayForTest());
  await expect.poll(() => page.evaluate(() => (
    JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.viewMode
  ))).toBe("COZY");
  await expect(page.locator(".cc-sidebar-frame").getByRole("button", { name: "Exit", exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => new URLSearchParams(window.location.search).get("workspace"))).toBe("operate");
}

async function clearTransientUi(page: import("@playwright/test").Page): Promise<void> {
  // Existing visible-dismissal path used by the normal-frame browser suite.
  const achievements = page.getByTestId("achievement-toast");
  for (let index = 0; index < 12 && await achievements.count(); index += 1) {
    // The notification can finish its own exit transition between count() and
    // click(); that is already a cleared notification, not a reason to wait
    // for Playwright's full test timeout.
    await achievements.first().click({ timeout: 1_000 }).catch(() => undefined);
  }
  await page.mouse.move(2, 2);
  await expect(achievements).toHaveCount(0);
  await expect(page.getByTestId("tutorial-milestone-toast")).toHaveCount(0);
  await expect(page.locator('[role="tooltip"]:visible')).toHaveCount(0);
}

async function rotateTo(page: import("@playwright/test").Page, target: Capture["rotation"]): Promise<void> {
  let current = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation ?? 0) as Capture["rotation"];
  while (current !== target) {
    const next = ((current + 90) % 360) as Capture["rotation"];
    await page.keyboard.press("e");
    await expect.poll(() => page.evaluate(() => (
      JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation
    ))).toBe(next);
    current = next;
  }
}

async function assertActualNormalFrame(page: import("@playwright/test").Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const pixi = window.__coursecraftPixiTest!;
    const frame = pixi.normalFrame();
    const transform = pixi.cameraTransform();
    const camera = pixi.rendererAtlasState().camera;
    return frame?.source === "active-hole"
      && transform != null
      && Math.abs(camera.zoom - frame.zoom) < 0.001
      && Math.abs(camera.targetZoom - frame.zoom) < 0.001
      && Math.abs(transform.camera.zoom - frame.zoom) < 0.001
      && Math.abs(transform.camera.targetZoom - frame.zoom) < 0.001
      && Math.abs(transform.world.scale.x - frame.zoom) < 0.001
      && Math.abs(transform.world.scale.y - frame.zoom) < 0.001;
  })).toBe(true);
  // Cardinal camera motion is asynchronous; take evidence only after its
  // product transition settles, without refitting or focusing the view.
  await page.waitForTimeout(600);
}

async function contactSheet(files: string[], output: string) {
  const images = await Promise.all(files.map(async (file) => PNG.sync.read(await readFile(file))));
  const thumbWidth = 360;
  const thumbHeight = 225;
  const columns = 2;
  const sheet = new PNG({
    width: thumbWidth * columns,
    height: thumbHeight * Math.ceil(images.length / columns),
    fill: true,
  });
  images.forEach((source, index) => {
    const scale = Math.min(thumbWidth / source.width, thumbHeight / source.height);
    const width = Math.floor(source.width * scale);
    const height = Math.floor(source.height * scale);
    const left = (index % columns) * thumbWidth + Math.floor((thumbWidth - width) / 2);
    const top = Math.floor(index / columns) * thumbHeight + Math.floor((thumbHeight - height) / 2);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const sourceX = Math.floor(x / scale);
      const sourceY = Math.floor(y / scale);
      const from = (sourceY * source.width + sourceX) * 4;
      const to = ((top + y) * sheet.width + left + x) * 4;
      source.data.copy(sheet.data, to, from, from + 4);
    }
  });
  await writeFile(output, PNG.sync.write(sheet));
}

test("ZK-473 captures settled actual normal gameplay frames at Medium and High", async ({ page }) => {
  test.setTimeout(240_000);
  await mkdir(outputRoot, { recursive: true });
  const runtimeErrors: Array<{ source: "console" | "pageerror"; message: string }> = [];
  page.on("console", (entry) => {
    if (entry.type() === "error") runtimeErrors.push({ source: "console", message: entry.text() });
  });
  page.on("pageerror", (error) => {
    runtimeErrors.push({ source: "pageerror", message: error.stack ?? error.message });
  });
  await page.setViewportSize(viewport);
  await page.goto("/?m19Fixture=1");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 90_000 }).toBe("game");
  await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest));
  await enterNormalGameplay(page);
  await clearTransientUi(page);

  const captures: Capture[] = [];
  for (const rotation of [0, 90, 180, 270] as const) {
    await rotateTo(page, rotation);
    for (const tier of capturesToRecord) {
      await page.evaluate((quality) => window.__coursecraftTest!.setGraphicsQualityFixture(quality), tier.quality);
      await assertActualNormalFrame(page);
      const renderer = await waitForStableRenderer(page, tier.quality);
      await clearTransientUi(page);
      const file = resolve(outputRoot, `parkland-r${rotation}-${tier.label}.png`);
      const screenshot = await page.screenshot({ fullPage: true });
      const image = PNG.sync.read(screenshot);
      expect({ width: image.width, height: image.height }).toEqual(viewport);
      await writeFile(file, screenshot);
      const evidence = await page.evaluate(() => {
        const pixi = window.__coursecraftPixiTest!;
        const frame = pixi.normalFrame()!;
        const transform = pixi.cameraTransform()!;
        const composition = pixi.sceneComposition()!;
        return {
          structuredState: JSON.parse(window.render_game_to_text?.() ?? "{}"),
          frame,
          transform,
          composition: {
            planHash: Array.from(new TextEncoder().encode(JSON.stringify(composition))).reduce(
              (hash, byte) => Math.imul(hash ^ byte, 0x01000193) >>> 0,
              0x811c9dc5,
            ).toString(16).padStart(8, "0"),
            courseHash: composition.courseHash,
            obstacleHash: composition.obstacleHash,
            habitatZoneIds: frame.habitatZoneIds,
            visiblePointCount: frame.visiblePoints.length,
          },
        };
      });
      expect(evidence.frame.source).toBe("active-hole");
      expect(evidence.composition.habitatZoneIds.length).toBeGreaterThan(0);
      expect(evidence.composition.visiblePointCount).toBeGreaterThan(evidence.frame.route.length);
      expect(evidence.transform.camera.zoom).toBeCloseTo(evidence.frame.zoom, 3);
      expect(evidence.transform.camera.targetZoom).toBeCloseTo(evidence.frame.zoom, 3);
      expect(evidence.transform.world.scale.x).toBeCloseTo(evidence.frame.zoom, 3);
      expect(evidence.transform.world.scale.y).toBeCloseTo(evidence.frame.zoom, 3);
      expect(rendererProblems(renderer, tier.quality)).toEqual([]);
      captures.push({
        file,
        sha256: createHash("sha256").update(screenshot).digest("hex"),
        width: image.width,
        height: image.height,
        rotation,
        label: tier.label,
        quality: tier.quality,
        structuredState: evidence.structuredState,
        normalFrame: evidence.frame,
        cameraTransform: evidence.transform,
        composition: evidence.composition,
        renderer,
      });
    }
  }

  expect(captures).toHaveLength(8);
  expect(new Set(captures.map((capture) => `${capture.rotation}:${capture.label}`)).size).toBe(8);
  for (const rotation of [0, 90, 180, 270] as const) {
    const pair = captures.filter((capture) => capture.rotation === rotation);
    expect(pair).toHaveLength(2);
    expect(pair.map((capture) => capture.label).sort()).toEqual(["normal-high", "normal-medium"]);
    expect(pair[0].normalFrame).toEqual(pair[1].normalFrame);
    expect(pair[0].cameraTransform).toEqual(pair[1].cameraTransform);
    expect(pair[0].composition).toEqual(pair[1].composition);
  }
  expect(runtimeErrors).toEqual([]);

  const report = {
    version: 3,
    issue: "ZK-473",
    commit,
    viewport,
    theme: "parkland",
    fixture: "m19Fixture",
    captureContract: {
      flow: "Established enterNormalGameplayForTest reducer/UI transition (exit Hole Edit, Operate workspace, Cozy view); no Pixi focus/zoom/fit helper is called by this test.",
      tiers: "Each cardinal actual normal frame is captured once at Medium/normal LOD and once at High/detail LOD without changing its frame or transform.",
      transientUi: "Only existing visible achievement-toast dismissal and pointer-gutter behavior from the normal-frame E2E suite are used.",
    },
    runtimeErrors,
    terrainState: await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState()),
    command: "ZK473_EVIDENCE_DIR=<dir> ZK473_COMMIT=<sha> npx playwright test e2e/zk473-parity-capture.e2e.ts --workers=1 --retries=0",
    captures,
  };
  await writeFile(resolve(outputRoot, "zk473-parity-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await contactSheet(captures.map((capture) => capture.file), resolve(outputRoot, "zk473-coursecraft-contact-sheet.png"));
});
