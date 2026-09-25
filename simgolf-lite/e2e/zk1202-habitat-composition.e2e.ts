import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const outputRoot = resolve(process.env.ZK1202_EVIDENCE_DIR ?? "../zk1202-habitat-evidence");
const baseUrl = process.env.ZK1202_BASE_URL ?? "";
const representativeOnly = process.env.ZK1237_REPRESENTATIVE === "1";
const viewportShard = process.env.ZK1237_VIEWPORT_SHARD;
if (viewportShard != null && viewportShard !== "compact" && viewportShard !== "desktop") {
  throw new Error(`Unsupported ZK1237_VIEWPORT_SHARD: ${viewportShard}`);
}
const normalFrameViewports = viewportShard === "compact"
  ? [{ width: 800, height: 500 }] as const
  : viewportShard === "desktop"
    ? [{ width: 1440, height: 900 }] as const
    : [{ width: 800, height: 500 }, { width: 1440, height: 900 }] as const;
const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: gitRoot, encoding: "utf8" }).trim();
const workingTreeStatus = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
  cwd: gitRoot,
  encoding: "utf8",
});
const workingTreeDiff = execFileSync("git", ["diff", "--binary", "--no-ext-diff", "HEAD"], {
  cwd: gitRoot,
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});
const workingTreeDiffSha256 = createHash("sha256").update(workingTreeDiff).digest("hex");
const sourceFingerprintSha256 = createHash("sha256")
  .update(commit).update("\0").update(workingTreeStatus).update("\0").update(workingTreeDiff).digest("hex");

type Capture = {
  file: string;
  fixture: "m19" | "zk1202-secondary";
  rotation: 0 | 90 | 180 | 270;
  view: "normal" | "detail";
  quality: "high" | "medium";
  focus: { x: number; y: number } | null;
  courseHash: string;
  obstacleHash: string;
  naturalObstacleCount: number;
  renderer: unknown;
};

type RendererAtlasState = ReturnType<NonNullable<Window["__coursecraftPixiTest"]>["rendererAtlasState"]>;

function rendererProblems(state: RendererAtlasState, quality?: "high" | "medium" | "low"): string[] {
  const problems: string[] = [];
  const { activation, rendered, requested } = state;
  if (activation.pending !== null) problems.push("activation-pending");
  if (rendered.status !== "activated") problems.push(`rendered-status:${rendered.status}`);
  if (activation.requestId !== activation.latestRequestId) problems.push("latest-request-mismatch");
  if (activation.requestId !== rendered.requestId) problems.push("rendered-request-mismatch");
  if (activation.generation !== rendered.generation || rendered.generation <= 0) problems.push("generation-mismatch");
  if (requested.bundleKey !== rendered.bundleKey || activation.bundleKey !== rendered.bundleKey) problems.push("bundle-mismatch");
  if (requested.quality !== rendered.quality || (quality != null && rendered.quality !== quality)) problems.push("quality-mismatch");
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

async function waitForStableRenderer(
  page: import("@playwright/test").Page,
  quality?: "high" | "medium" | "low",
): Promise<{ first: RendererAtlasState; last: RendererAtlasState; signature: string }> {
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
  return { first, last, signature: rendererSignature(last) };
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function capture(
  page: import("@playwright/test").Page,
  input: Omit<Capture, "file" | "courseHash" | "obstacleHash" | "naturalObstacleCount" | "renderer">,
): Promise<Capture> {
  const zoom = input.view === "detail" ? 2 : null;
  await page.evaluate(({ quality, zoom, focus }) => {
    window.__coursecraftTest!.setGraphicsQualityFixture(quality);
    if (zoom != null && focus) window.__coursecraftPixiTest!.focusTileForTest(focus.x, focus.y, zoom);
  }, { ...input, zoom });
  await expect.poll(() => page.evaluate(({ quality, zoom }) => {
    const state = window.__coursecraftPixiTest!.rendererAtlasState();
    const expectedZoom = zoom ?? window.__coursecraftPixiTest!.normalFrame()?.zoom;
    return state.requested.quality === quality
      && expectedZoom != null
      && Math.abs(state.camera.zoom - expectedZoom) < 0.001
      && Math.abs(state.camera.targetZoom - expectedZoom) < 0.001;
  }, { ...input, zoom })).toBe(true);
  await waitForStableRenderer(page, input.quality);
  await page.waitForTimeout(600);
  const readiness = await waitForStableRenderer(page, input.quality);
  const file = resolve(outputRoot, `zk1202-${input.fixture}-${input.view}-r${input.rotation}.png`);
  await writeFile(file, await page.screenshot({ fullPage: true }));
  return {
    file,
    rotation: input.rotation,
    fixture: input.fixture,
    view: input.view,
    quality: input.quality,
    focus: input.focus,
    courseHash: await page.evaluate(() => window.__coursecraftTest!.state().courseHash),
    obstacleHash: stableHash(await page.evaluate(() => JSON.stringify(
      window.__coursecraftTest!.terrainSurfaceState().obstacles,
    ))),
    naturalObstacleCount: await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState().obstacles.length),
    renderer: {
      atlas: await page.evaluate(() => window.__coursecraftPixiTest!.rendererAtlasState()),
      readiness,
    },
  };
}

async function rotateTo(
  page: import("@playwright/test").Page,
  rotation: Capture["rotation"],
): Promise<void> {
  let current = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation ?? 0);
  while (current !== rotation) {
    const next = ((current + 90) % 360) as Capture["rotation"];
    await page.keyboard.press("e");
    // Rotation input is ignored while its previous camera transition is in
    // flight, so acknowledge each turn before requesting the next one.
    await expect.poll(() => page.evaluate(() => (
      JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation
    ))).toBe(next);
    current = next;
  }
}

async function loadFixture(page: import("@playwright/test").Page, query: string, expectedName: string): Promise<void> {
  await page.goto(`${baseUrl}/?${query}`);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.name), { timeout: 90_000 })
    .toBe(expectedName);
  await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest));
}

async function enterNormalGameplay(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => window.__coursecraftTest!.enterNormalGameplayForTest());
  await expect.poll(() => page.evaluate(() => (
    JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.viewMode
  ))).toBe("COZY");
  await expect(page.locator(".cc-sidebar-frame").getByRole("button", { name: "Exit", exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => new URLSearchParams(window.location.search).get("workspace"))).toBe("operate");
}

async function clearTransientUi(page: import("@playwright/test").Page): Promise<void> {
  const achievements = page.getByTestId("achievement-toast");
  for (let index = 0; index < 12 && await achievements.count(); index += 1) await achievements.first().click();
  await page.mouse.move(2, 2);
  await expect(achievements).toHaveCount(0);
  await expect(page.getByTestId("tutorial-milestone-toast")).toHaveCount(0);
  await expect(page.locator('[role="tooltip"]:visible')).toHaveCount(0);
}

async function auditSidebarControls(page: import("@playwright/test").Page, compact: boolean) {
  const launcher = page.getByTestId("bug-report-launcher");
  await expect(launcher).toBeVisible();
  await expect.poll(() => launcher.evaluate((element) => element.parentElement?.id)).toBe("cc-bug-report-dock");
  const controls = page.locator('.cc-sidebar-frame button:not([data-testid="bug-report-launcher"]), .cc-sidebar-frame input, .cc-sidebar-frame select, .cc-sidebar-frame a[href]');
  const allControls: Array<{ index: number; label: string; tag: string; disabled: boolean; rect: { x: number; y: number; width: number; height: number }; launcherOverlap: boolean }> = [];
  for (let index = 0; index < await controls.count(); index += 1) {
    const control = controls.nth(index);
    await control.scrollIntoViewIfNeeded();
    const item = await control.evaluate((element, controlIndex) => {
      const bounds = element.getBoundingClientRect();
      const launcherBounds = document.querySelector<HTMLElement>('[data-testid="bug-report-launcher"]')!.getBoundingClientRect();
      const intersects = bounds.left < launcherBounds.right && bounds.right > launcherBounds.left
        && bounds.top < launcherBounds.bottom && bounds.bottom > launcherBounds.top;
      return {
        index: controlIndex,
        label: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? element.getAttribute("name") ?? "",
        tag: element.tagName.toLowerCase(),
        disabled: (element as HTMLButtonElement | HTMLInputElement | HTMLSelectElement).disabled === true,
        rect: { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height },
        launcherOverlap: intersects,
      };
    }, index);
    expect(item.rect.x).toBeGreaterThanOrEqual(0);
    expect(item.rect.y).toBeGreaterThanOrEqual(0);
    expect(item.rect.x + item.rect.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
    expect(item.rect.y + item.rect.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
    expect(item.launcherOverlap, `Bug launcher overlaps sidebar control ${item.label || item.index}`).toBe(false);
    allControls.push(item);
  }
  const atScrollEdge = async (edge: "top" | "bottom") => page.evaluate((position) => {
    const region = document.querySelector<HTMLElement>(".cc-sidebar-scroll-region")!;
    region.scrollTop = position === "bottom" ? region.scrollHeight : 0;
    const launcher = document.querySelector<HTMLElement>('[data-testid="bug-report-launcher"]')!.getBoundingClientRect();
    const controls = Array.from(document.querySelectorAll<HTMLElement>('.cc-sidebar-frame button:not([data-testid="bug-report-launcher"]), .cc-sidebar-frame input, .cc-sidebar-frame select, .cc-sidebar-frame a[href]'));
    const visibleControls = controls.flatMap((element, index) => {
      const bounds = element.getBoundingClientRect();
      const regionBounds = region.getBoundingClientRect();
      const clipped = region.contains(element)
        ? {
          left: Math.max(bounds.left, regionBounds.left),
          right: Math.min(bounds.right, regionBounds.right),
          top: Math.max(bounds.top, regionBounds.top),
          bottom: Math.min(bounds.bottom, regionBounds.bottom),
        }
        : bounds;
      const visible = clipped.right > clipped.left && clipped.bottom > clipped.top && clipped.bottom > 0 && clipped.right > 0
        && clipped.top < innerHeight && clipped.left < innerWidth;
      if (!visible) return [];
      const overlap = clipped.left < launcher.right && clipped.right > launcher.left
        && clipped.top < launcher.bottom && clipped.bottom > launcher.top;
      return [{
        index,
        label: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? element.getAttribute("name") ?? "",
        rect: { x: clipped.left, y: clipped.top, width: clipped.right - clipped.left, height: clipped.bottom - clipped.top },
        launcherOverlap: overlap,
      }];
    });
    return {
      position,
      scrollTop: region.scrollTop,
      scrollHeight: region.scrollHeight,
      clientHeight: region.clientHeight,
      visibleControls,
    };
  }, edge);
  const top = await atScrollEdge("top");
  await page.waitForTimeout(50);
  const bottom = await atScrollEdge("bottom");
  expect(top.visibleControls.filter((control) => control.launcherOverlap), "Launcher overlap at sidebar scroll top").toEqual([]);
  expect(bottom.visibleControls.filter((control) => control.launcherOverlap), "Launcher overlap at sidebar scroll bottom").toEqual([]);
  if (compact) {
    await expect(page.locator(".cc-sidebar-scroll-affordance")).toBeVisible();
    expect(bottom.scrollHeight).toBeGreaterThan(bottom.clientHeight);
    expect(bottom.clientHeight, "Compact sidebar scroll region cannot reveal an editor control").toBeGreaterThanOrEqual(46);
    expect(bottom.scrollTop).toBeGreaterThan(0);
  }
  await page.locator(".cc-sidebar-scroll-region").evaluate((element) => { element.scrollTop = 0; });
  return {
    launcherDocked: true,
    allControls,
    top,
    bottom,
    scrollAffordanceVisible: compact,
  };
}

test("ZK-1202 certifies compact Parkland habitat against M19 authority views", async ({ page }) => {
  test.setTimeout(180_000);
  await mkdir(outputRoot, { recursive: true });
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(`pageerror:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(`console:${message.text()}`);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  const captures: Capture[] = [];
  await loadFixture(page, "m19Fixture=1", "M19 Parkland Reference Club");
  await enterNormalGameplay(page);
  // Capture the four normal authority views as one Medium run so all four
  // rotations exercise exactly the same atlas residency and world-space plan.
  for (const rotation of [0, 90, 180, 270] as const) {
    await rotateTo(page, rotation);
    captures.push(await capture(page, {
      fixture: "m19",
      rotation,
      view: "normal",
      quality: "medium",
      focus: null,
    }));
  }
  const scoped = captures.filter((item) => item.fixture === "m19");
  expect(new Set(scoped.map((item) => item.courseHash)).size).toBe(1);
  expect(new Set(scoped.map((item) => item.obstacleHash)).size).toBe(1);
  expect(new Set(scoped.map((item) => item.naturalObstacleCount))).toEqual(new Set([63]));
  expect(captures.filter((item) => item.fixture === "m19" && item.view === "normal")).toHaveLength(4);
  expect(runtimeErrors).toEqual([]);
  await writeFile(resolve(outputRoot, "zk1202-habitat-normal-report.json"), `${JSON.stringify({
    version: 2,
    issue: "ZK-1202",
    commit,
    authorityFixture: "m19Fixture",
    viewport: { width: 1440, height: 900 },
    command: "ZK1202_EVIDENCE_DIR=<dir> ZK1202_COMMIT=<sha> npx playwright test e2e/zk1202-habitat-composition.e2e.ts --workers=1 --retries=0",
    runtimeErrors,
    captures,
  }, null, 2)}\n`);
});

test("ZK-1202 certifies M19 Detail habitat and retains grove-fixture coverage", async ({ page }) => {
  test.setTimeout(180_000);
  await mkdir(outputRoot, { recursive: true });
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(`pageerror:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(`console:${message.text()}`);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  const captures: Capture[] = [];
  await loadFixture(page, "m19Fixture=1", "M19 Parkland Reference Club");
  for (const rotation of [0, 180] as const) {
    await rotateTo(page, rotation);
    captures.push(await capture(page, {
      fixture: "m19",
      rotation,
      view: "detail",
      quality: "high",
      focus: { x: 39, y: 20 },
    }));
  }
  // The authored grove fixture stays as a secondary test surface. It never
  // replaces M19 as the authority for the normal/detail capture contract.
  await loadFixture(page, "zk1202HabitatFixture=1", "ZK-1202 Parkland Habitat Club");
  await rotateTo(page, 0);
  captures.push(await capture(page, {
    fixture: "zk1202-secondary",
    rotation: 0,
    view: "detail",
    quality: "high",
    focus: { x: 28, y: 5 },
  }));
  for (const fixture of ["m19", "zk1202-secondary"] as const) {
    const scoped = captures.filter((item) => item.fixture === fixture);
    expect(new Set(scoped.map((item) => item.courseHash)).size).toBe(1);
    expect(new Set(scoped.map((item) => item.obstacleHash)).size).toBe(1);
  }
  expect(new Set(captures.filter((item) => item.fixture === "m19").map((item) => item.naturalObstacleCount)))
    .toEqual(new Set([63]));
  expect(captures.filter((item) => item.fixture === "m19" && item.view === "detail")).toHaveLength(2);
  expect(captures.filter((item) => item.fixture === "zk1202-secondary")).toHaveLength(1);
  expect(runtimeErrors).toEqual([]);
  await writeFile(resolve(outputRoot, "zk1202-habitat-detail-report.json"), `${JSON.stringify({
    version: 2,
    issue: "ZK-1202",
    commit,
    authorityFixture: "m19Fixture",
    secondaryFixture: "zk1202HabitatFixture",
    viewport: { width: 1440, height: 900 },
    command: "ZK1202_EVIDENCE_DIR=<dir> ZK1202_COMMIT=<sha> npx playwright test e2e/zk1202-habitat-composition.e2e.ts --workers=1 --retries=0",
    runtimeErrors,
    captures,
  }, null, 2)}\n`);
});

test("ZK-1237 normal gameplay frame keeps the complete M23 route hierarchy in the playable viewport", async ({ page }) => {
  test.setTimeout(900_000);
  await mkdir(outputRoot, { recursive: true });
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(`pageerror:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(`console:${message.text()}`);
  });
  const captures: Array<{
    file: string;
    pinRotation: "A" | "B" | "C";
    rotation: Capture["rotation"];
    viewport: { width: number; height: number };
    playableViewport: { width: number; height: number };
    route: readonly { x: number; y: number }[];
    visiblePointCount: number;
    habitatZoneIds: readonly string[];
    zoom: number;
    courseHash: string;
    flagBounds: { x: number; y: number; width: number; height: number };
    flagOccluders: string[];
    destinationMarkers: Array<{
      index: number;
      point: { x: number; y: number };
      role: "landing" | "approach" | "pin";
      bounds: { x: number; y: number; width: number; height: number };
      occluders: string[];
    }>;
    overlays: Array<{ selector: string; x: number; y: number; width: number; height: number }>;
    shellGeometry: unknown;
    sidebarControlAudit: unknown;
    navigationAudit: unknown;
    layout: {
      tickerToControls: boolean;
      tickerToFooter: boolean;
      controlsToFooter: boolean;
      launcherToTicker: boolean;
      launcherToControls: boolean;
      launcherToNavigation: boolean;
      launcherToFooterButtons: boolean[];
    };
    renderer: { before: RendererAtlasState; after: RendererAtlasState; signature: string };
  }> = [];

  const pinRotations: readonly ("A" | "B" | "C")[] = representativeOnly ? ["A"] : ["A", "B", "C"];
  const rotations: readonly Capture["rotation"][] = representativeOnly ? [0] : [0, 90, 180, 270];
  for (const viewport of normalFrameViewports) {
    await page.setViewportSize(viewport);
    await loadFixture(page, "m23Fixture=1", "M23 Course Standards Club");
    await expect(page.getByRole("button", { name: "Collapse course minimap" })).toBeVisible();
    await page.evaluate(() => window.__coursecraftTest!.setGraphicsQualityFixture("medium"));
    await waitForStableRenderer(page, "medium");
    await enterNormalGameplay(page);
    await clearTransientUi(page);
    await expect(page.getByRole("button", { name: "Open course minimap" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Collapse course minimap" })).toHaveCount(0);
    const compact = viewport.width === 800;
    const navigationAudit = await page.evaluate(() => {
      const strip = document.querySelector<HTMLElement>(".cc-workspace-nav-strip")!;
      const cue = document.querySelector<HTMLElement>(".cc-workspace-scroll-cue")!;
      return {
        clientWidth: strip.clientWidth,
        scrollWidth: strip.scrollWidth,
        scrollLeft: strip.scrollLeft,
        cueVisible: getComputedStyle(cue).display !== "none",
        cueText: cue.textContent?.trim() ?? "",
      };
    });
    if (compact) {
      expect(navigationAudit.cueVisible).toBe(true);
      expect(navigationAudit.cueText).toContain("More");
      expect(navigationAudit.scrollWidth).toBeGreaterThan(navigationAudit.clientWidth);
      await page.locator(".cc-workspace-scroll-cue").click();
      await expect.poll(() => page.locator(".cc-workspace-nav-strip").evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      await page.locator(".cc-workspace-nav-strip").evaluate((element) => { element.scrollLeft = 0; });
    } else {
      expect(navigationAudit.cueVisible).toBe(false);
      expect(navigationAudit.scrollWidth).toBeLessThanOrEqual(navigationAudit.clientWidth);
    }
    const sidebarControlAudit = await auditSidebarControls(page, compact);
    for (const pinRotation of pinRotations) {
      await page.evaluate((rotation) => window.__coursecraftTest!.setPinRotationForTest(rotation), pinRotation);
      await expect.poll(() => page.evaluate(() => (
        JSON.parse(window.render_game_to_text?.() ?? "{}").course?.activePinRotation
      ))).toBe(pinRotation);
      for (const rotation of rotations) {
        await rotateTo(page, rotation);
        await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.viewport())).toMatchObject({
          height: expect.any(Number),
          width: expect.any(Number),
        });
        await expect.poll(() => page.evaluate(() => {
          const frame = window.__coursecraftPixiTest!.normalFrame();
          const camera = window.__coursecraftPixiTest!.rendererAtlasState().camera;
          return frame?.source === "active-hole"
            && Math.abs(camera.zoom - frame.zoom) < 0.001
            && Math.abs(camera.targetZoom - frame.zoom) < 0.001;
        })).toBe(true);
        // Let the cardinal rotation tween finish before reading world-to-screen positions.
        await page.waitForTimeout(600);
        const rendererBefore = await waitForStableRenderer(page);
        const evidence = await page.evaluate(() => {
          const pixi = window.__coursecraftPixiTest!;
          const frame = pixi.normalFrame()!;
          const viewport = pixi.viewport()!;
          const textState = JSON.parse(window.render_game_to_text?.() ?? "{}");
          const canvas = document.querySelector<HTMLCanvasElement>(".cc-pixi-stage canvas")!;
          const canvasRect = canvas.getBoundingClientRect();
          const overlays = [".cc-live-controls", ".cc-workspace-nav", ".cc-minimap-toggle", ".cc-minimap", ".cc-news", ".cc-sidebar-footer", "[data-testid='bug-report-launcher']"]
            .flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)).map((element) => {
              const rect = element.getBoundingClientRect();
              return { selector, x: rect.left - canvasRect.left, y: rect.top - canvasRect.top, width: rect.width, height: rect.height };
            }));
          const points = frame.visiblePoints.map((point) => {
            const screen = pixi.tileToScreen(point.x, point.y);
            const footprint = screen && { x: screen.x - 18, y: screen.y - 18, width: 36, height: 36 };
            return {
              world: point,
              screen,
              footprint,
              occluders: overlays.filter((rect) => footprint != null
                && footprint.x < rect.x + rect.width && footprint.x + footprint.width > rect.x
                && footprint.y < rect.y + rect.height && footprint.y + footprint.height > rect.y).map((rect) => rect.selector),
            };
          });
          const controls = document.querySelector<HTMLElement>(".cc-live-controls")!;
          const composition = pixi.sceneComposition()!;
          const envelope = composition.holeEnvelopes.find((entry) => entry.holeId === frame.holeId)!;
          const routeWindow = {
            minX: Math.min(...frame.route.map((point) => point.x)) - 5,
            maxX: Math.max(...frame.route.map((point) => point.x)) + 5,
            minY: Math.min(...frame.route.map((point) => point.y)) - 5,
            maxY: Math.max(...frame.route.map((point) => point.y)) + 5,
          };
          const expectedHabitatZoneIds = composition.habitatZones.filter((zone) => zone.occupancy.some((point) => (
            point.x >= envelope.bounds.minX && point.x <= envelope.bounds.maxX
            && point.y >= envelope.bounds.minY && point.y <= envelope.bounds.maxY
            && point.x >= routeWindow.minX && point.x <= routeWindow.maxX
            && point.y >= routeWindow.minY && point.y <= routeWindow.maxY
          ))).map((zone) => zone.id);
          const strategicLandmarks = composition.landmarks
            .filter((landmark) => landmark.holeId === frame.holeId && landmark.kind === "strategic_hazard")
            .map((landmark) => landmark.point);
          const flag = pixi.activeFlagGeometry();
          const destinationMarkers = pixi.activeShotDestinationGeometry().map((marker) => ({
            ...marker,
            occluders: overlays.filter((overlay) => (
              marker.bounds.x < overlay.x + overlay.width && marker.bounds.x + marker.bounds.width > overlay.x
              && marker.bounds.y < overlay.y + overlay.height && marker.bounds.y + marker.bounds.height > overlay.y
            )).map((overlay) => overlay.selector),
          }));
          const setup = textState.course.holeSetups[0];
          const waypoints = frame.route.slice(1, -1);
          const terrain = window.__coursecraftTest!.terrainSurfaceState();
          const rect = (selector: string) => {
            const bounds = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
            return { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height };
          };
          const intersects = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => (
            a.x < b.x + b.width && a.x + a.width > b.x
            && a.y < b.y + b.height && a.y + a.height > b.y
          );
          const ticker = rect(".cc-news");
          const controlsRect = rect(".cc-live-controls");
          const footer = rect(".cc-sidebar-footer");
          const navigation = rect(".cc-workspace-nav");
          const launcher = rect("[data-testid='bug-report-launcher']");
          const courseFrame = rect(".cc-course-frame");
          const sidebar = rect(".cc-sidebar-frame");
          const footerButtons = Array.from(document.querySelectorAll<HTMLElement>('.cc-sidebar-footer button:not([data-testid="bug-report-launcher"])')).map((element) => {
            const bounds = element.getBoundingClientRect();
            const geometry = { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height };
            const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
            return { ...geometry, label: element.textContent?.trim() ?? "", reachable: hit === element || element.contains(hit) };
          });
          const withinBrowser = (bounds: { x: number; y: number; width: number; height: number }) => (
            bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= window.innerWidth && bounds.y + bounds.height <= window.innerHeight
          );
          const launcherHit = document.elementFromPoint(launcher.x + launcher.width / 2, launcher.y + launcher.height / 2);
          const navigationElement = document.querySelector<HTMLElement>(".cc-workspace-nav")!;
          const flagOccluders = overlays.filter((overlay) => flag != null && intersects(flag.bounds, overlay)).map((overlay) => overlay.selector);
          return {
            frame,
            viewport,
            points,
            overlays,
            controls: {
              clientWidth: controls.clientWidth,
              scrollWidth: controls.scrollWidth,
              flexWrap: getComputedStyle(controls).flexWrap,
              speedButtons: ["paused", "1x", "2x", "4x"].map((speed) => {
                const button = controls.querySelector<HTMLElement>(`[data-testid="speed-${speed}"]`)!;
                const rect = button.getBoundingClientRect();
                return { speed, disabled: button.hasAttribute("disabled"), tabIndex: button.tabIndex, x: rect.left - canvasRect.left, y: rect.top - canvasRect.top, width: rect.width, height: rect.height };
              }),
              dailyPin: (() => {
                const selector = controls.querySelector<HTMLElement>("[data-testid='daily-pin-rotation']")!;
                const rect = selector.getBoundingClientRect();
                return { disabled: selector.hasAttribute("disabled"), tabIndex: selector.tabIndex, x: rect.left - canvasRect.left, y: rect.top - canvasRect.top, width: rect.width, height: rect.height };
              })(),
            },
            pin: setup.pinPositions[textState.course.activePinRotation],
            tee: setup.teeBoxes.member,
            waypoints,
            waypointTerrains: waypoints.map((point) => terrain.tiles[point.y * terrain.width + point.x]),
            strategicLandmarks,
            expectedHabitatZoneIds,
            flag,
            flagOccluders,
            destinationMarkers,
            shellGeometry: {
              browser: { width: window.innerWidth, height: window.innerHeight },
              canvas: { x: canvasRect.left, y: canvasRect.top, width: canvasRect.width, height: canvasRect.height },
              courseFrame,
              sidebar,
              navigation: {
                ...navigation,
                clientWidth: navigationElement.clientWidth,
                scrollWidth: navigationElement.scrollWidth,
                withinBrowser: withinBrowser(navigation),
              },
              controls: { ...controlsRect, withinBrowser: withinBrowser(controlsRect) },
              ticker: { ...ticker, withinBrowser: withinBrowser(ticker) },
              footer: { ...footer, withinBrowser: withinBrowser(footer) },
              footerButtons,
              launcher: {
                ...launcher,
                withinBrowser: withinBrowser(launcher),
                reachable: launcherHit?.closest("[data-testid='bug-report-launcher']") != null,
              },
            },
            layout: {
              ticker,
              controls: controlsRect,
              footer,
              navigation,
              launcher,
              footerButtons,
              tickerToControls: intersects(ticker, controlsRect),
              tickerToFooter: intersects(ticker, footer),
              controlsToFooter: intersects(controlsRect, footer),
              launcherToTicker: intersects(launcher, ticker),
              launcherToControls: intersects(launcher, controlsRect),
              launcherToNavigation: intersects(launcher, navigation),
              launcherToFooterButtons: footerButtons.map((button) => intersects(launcher, button)),
            },
            courseHash: window.__coursecraftTest!.state().courseHash,
          };
        });
        expect(evidence.viewport.width).toBeGreaterThan(0);
        expect(evidence.viewport.height).toBeGreaterThan(0);
        expect(evidence.viewport.width).toBeLessThanOrEqual(viewport.width);
        expect(evidence.viewport.height).toBeLessThanOrEqual(viewport.height);
        expect(evidence.waypoints).toHaveLength(2);
        expect(evidence.waypointTerrains).toEqual(["fairway", "fairway"]);
        expect(evidence.frame.route).toEqual([evidence.tee, ...evidence.waypoints, evidence.pin]);
        expect(evidence.frame.route).toHaveLength(4);
        expect(evidence.strategicLandmarks.length).toBeGreaterThan(0);
        for (const landmark of evidence.strategicLandmarks) expect(evidence.frame.visiblePoints).toContainEqual(landmark);
        expect(evidence.frame.habitatZoneIds).toEqual(evidence.expectedHabitatZoneIds);
        expect(evidence.frame.habitatZoneIds.length).toBeGreaterThan(0);
        expect(evidence.points.length).toBeGreaterThan(evidence.frame.route.length);
        expect(evidence.flag).not.toBeNull();
        const pinScreen = evidence.points[evidence.frame.route.length - 1].screen!;
        expect(evidence.flag!.anchor.x).toBeCloseTo(pinScreen.x, 0);
        expect(evidence.flag!.anchor.y).toBeCloseTo(pinScreen.y, 0);
        expect(evidence.flag!.bounds.x).toBeLessThanOrEqual(evidence.flag!.anchor.x + 2);
        expect(evidence.flag!.bounds.x + evidence.flag!.bounds.width).toBeGreaterThanOrEqual(evidence.flag!.anchor.x - 2);
        expect(evidence.flag!.bounds.y).toBeLessThanOrEqual(evidence.flag!.anchor.y + 2);
        expect(evidence.flag!.bounds.y + evidence.flag!.bounds.height).toBeGreaterThanOrEqual(evidence.flag!.anchor.y - 2);
        expect(evidence.flag!.bounds.x, "Flag crops against the playable viewport's left edge").toBeGreaterThanOrEqual(0);
        expect(evidence.flag!.bounds.y, "Flag crops against the playable viewport's top edge").toBeGreaterThanOrEqual(0);
        expect(evidence.flag!.bounds.x + evidence.flag!.bounds.width, "Flag crops against the playable viewport's right edge").toBeLessThanOrEqual(evidence.viewport.width);
        expect(evidence.flag!.bounds.y + evidence.flag!.bounds.height, "Flag crops against the playable viewport's bottom edge").toBeLessThanOrEqual(evidence.viewport.height);
        expect(evidence.flag!.bounds.width, "Flag is too small to read at the resting camera scale").toBeGreaterThanOrEqual(6);
        expect(evidence.flag!.bounds.height, "Flag is too small to read at the resting camera scale").toBeGreaterThanOrEqual(12);
        expect(evidence.flagOccluders, "Flag is covered by application chrome").toEqual([]);
        expect(evidence.destinationMarkers.map((marker) => marker.point)).toEqual(evidence.frame.route.slice(1));
        expect(evidence.destinationMarkers.map((marker) => marker.role)).toEqual(["landing", "approach", "pin"]);
        for (const marker of evidence.destinationMarkers) {
          expect(marker.bounds.x, `${marker.role} marker crops against the playable viewport's left edge`).toBeGreaterThanOrEqual(0);
          expect(marker.bounds.y, `${marker.role} marker crops against the playable viewport's top edge`).toBeGreaterThanOrEqual(0);
          expect(marker.bounds.x + marker.bounds.width, `${marker.role} marker crops against the playable viewport's right edge`).toBeLessThanOrEqual(evidence.viewport.width);
          expect(marker.bounds.y + marker.bounds.height, `${marker.role} marker crops against the playable viewport's bottom edge`).toBeLessThanOrEqual(evidence.viewport.height);
          expect(marker.occluders, `${marker.role} marker is covered by application chrome`).toEqual([]);
        }
        for (const marker of evidence.destinationMarkers.filter((item) => item.role !== "pin")) {
          expect(marker.bounds.width, `${marker.role} marker is too small to read`).toBeGreaterThanOrEqual(6);
          expect(marker.bounds.height, `${marker.role} marker is too small to read`).toBeGreaterThanOrEqual(6);
        }
        for (const overlay of evidence.overlays) {
          const flag = evidence.flag!.bounds;
          expect(flag.x >= overlay.x + overlay.width || flag.x + flag.width <= overlay.x
            || flag.y >= overlay.y + overlay.height || flag.y + flag.height <= overlay.y,
          `Flag footprint overlaps ${overlay.selector}`).toBe(true);
        }
        expect(evidence.layout.tickerToControls, "Ticker overlaps LiveControls").toBe(false);
        expect(evidence.layout.tickerToFooter, "Ticker overlaps Save / Load / Reset footer").toBe(false);
        expect(evidence.layout.controlsToFooter, "LiveControls overlap Save / Load / Reset footer").toBe(false);
        expect(evidence.layout.launcherToTicker, "Bug launcher overlaps ticker").toBe(false);
        expect(evidence.layout.launcherToControls, "Bug launcher overlaps LiveControls").toBe(false);
        expect(evidence.layout.launcherToNavigation, "Bug launcher overlaps navigation").toBe(false);
        expect(evidence.layout.launcherToFooterButtons, "Bug launcher overlaps footer buttons").toEqual([false, false, false]);
        expect(evidence.shellGeometry.courseFrame.width / evidence.shellGeometry.browser.width).toBeGreaterThanOrEqual(.59);
        expect(evidence.shellGeometry.canvas.width / evidence.shellGeometry.browser.width).toBeGreaterThanOrEqual(.56);
        if (viewport.width === 800) expect(evidence.shellGeometry.sidebar.width / viewport.width).toBeLessThanOrEqual(.38);
        expect(evidence.shellGeometry.navigation.withinBrowser).toBe(true);
        expect(evidence.shellGeometry.controls.withinBrowser).toBe(true);
        expect(evidence.shellGeometry.ticker.withinBrowser).toBe(true);
        expect(evidence.shellGeometry.footer.withinBrowser, JSON.stringify(evidence.shellGeometry.footer)).toBe(true);
        expect(evidence.shellGeometry.launcher.withinBrowser).toBe(true);
        expect(evidence.shellGeometry.launcher.reachable).toBe(true);
        expect(evidence.shellGeometry.footerButtons).toHaveLength(3);
        expect(evidence.shellGeometry.footerButtons.every((button) => button.reachable)).toBe(true);
        if (evidence.viewport.width <= 600) {
          expect(evidence.controls.flexWrap).toBe("nowrap");
          expect(evidence.controls.scrollWidth).toBeGreaterThan(evidence.controls.clientWidth);
        }
        expect(evidence.controls.speedButtons.map((button) => button.speed)).toEqual(["paused", "1x", "2x", "4x"]);
        expect(evidence.controls.speedButtons.every((button) => !button.disabled && button.tabIndex >= 0)).toBe(true);
        expect(evidence.controls.dailyPin.disabled).toBe(false);
        expect(evidence.controls.dailyPin.tabIndex).toBeGreaterThanOrEqual(0);
        for (const { world, screen, footprint, occluders } of evidence.points) {
          expect(screen, `No screen projection for ${JSON.stringify(world)}`).not.toBeNull();
          expect(footprint!.x, `Horizontal crop at ${JSON.stringify(world)}`).toBeGreaterThanOrEqual(0);
          expect(footprint!.x + footprint!.width, `Horizontal crop at ${JSON.stringify(world)}`).toBeLessThanOrEqual(evidence.viewport.width);
          expect(footprint!.y, `Vertical crop at ${JSON.stringify(world)}`).toBeGreaterThanOrEqual(0);
          expect(footprint!.y + footprint!.height, `Vertical crop at ${JSON.stringify(world)}`).toBeLessThanOrEqual(evidence.viewport.height);
          expect(occluders, `UI occlusion at ${JSON.stringify(world)}`).toEqual([]);
        }
        const file = resolve(outputRoot, `zk1237-m23-normal-${viewport.width}x${viewport.height}-pin${pinRotation}-r${rotation}.png`);
        for (const target of ["speed-paused", "speed-1x", "speed-2x", "speed-4x", "daily-pin-rotation"]) {
          const control = page.getByTestId(target);
          await control.scrollIntoViewIfNeeded();
          await control.focus();
          await expect(control).toBeFocused();
          await expect(control).toBeInViewport();
          const uncovered = await control.evaluate((element) => {
            const ticker = document.querySelector<HTMLElement>(".cc-news");
            if (!ticker) return true;
            const rect = element.getBoundingClientRect();
            const cover = ticker.getBoundingClientRect();
            return rect.right <= cover.left || rect.left >= cover.right
              || rect.bottom <= cover.top || rect.top >= cover.bottom;
          });
          expect(uncovered, `${target} obscured by global ticker`).toBe(true);
        }
        const navigationButtons = page.locator(".cc-workspace-nav button:visible");
        for (let index = 0; index < await navigationButtons.count(); index++) {
          const control = navigationButtons.nth(index);
          await control.scrollIntoViewIfNeeded();
          await control.focus();
          await expect(control).toBeFocused();
          await expect(control).toBeInViewport();
        }
        if (evidence.viewport.width <= 600) {
          const scrolled = await page.locator(".cc-live-controls").evaluate((element) => {
            element.scrollLeft = element.scrollWidth - element.clientWidth;
            return element.scrollLeft;
          });
          expect(scrolled).toBeGreaterThan(0);
        }
        await page.locator(".cc-live-controls").evaluate((element) => { element.scrollLeft = 0; });
        await page.locator(".cc-workspace-nav-strip").evaluate((element) => { element.scrollLeft = 0; });
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        // Leave the pointer in the page gutter, away from both course tools
        // and sidebar help targets, before recording the resting view.
        await page.mouse.move(2, 2);
        await clearTransientUi(page);
        await expect(page.locator('[data-testid="achievement-toast"], [data-testid="tutorial-milestone-toast"], [role="tooltip"]:visible')).toHaveCount(0);
        await page.waitForTimeout(100);
        await writeFile(file, await page.screenshot({ fullPage: true }));
        const rendererAfter = await waitForStableRenderer(page);
        expect(rendererAfter.signature).toBe(rendererBefore.signature);
        captures.push({
          file,
          pinRotation,
          rotation,
          viewport,
          playableViewport: evidence.viewport,
          route: evidence.frame.route,
          visiblePointCount: evidence.points.length,
          habitatZoneIds: evidence.frame.habitatZoneIds,
          zoom: evidence.frame.zoom,
          courseHash: evidence.courseHash,
          flagBounds: evidence.flag!.bounds,
          flagOccluders: evidence.flagOccluders,
          destinationMarkers: evidence.destinationMarkers,
          overlays: evidence.overlays,
          shellGeometry: evidence.shellGeometry,
          sidebarControlAudit,
          navigationAudit,
          layout: {
            tickerToControls: evidence.layout.tickerToControls,
            tickerToFooter: evidence.layout.tickerToFooter,
            controlsToFooter: evidence.layout.controlsToFooter,
            launcherToTicker: evidence.layout.launcherToTicker,
            launcherToControls: evidence.layout.launcherToControls,
            launcherToNavigation: evidence.layout.launcherToNavigation,
            launcherToFooterButtons: evidence.layout.launcherToFooterButtons,
          },
          renderer: {
            before: rendererBefore.last,
            after: rendererAfter.last,
            signature: rendererAfter.signature,
          },
        });
      }
    }
  }
  expect(captures).toHaveLength(representativeOnly ? normalFrameViewports.length : normalFrameViewports.length * 12);
  expect(new Set(captures.map((item) => item.courseHash)).size).toBe(representativeOnly ? 1 : 3);
  for (const pinRotation of pinRotations) for (const rotation of rotations) {
    const equivalent = captures.filter((item) => item.pinRotation === pinRotation && item.rotation === rotation);
    expect(equivalent).toHaveLength(normalFrameViewports.length);
    expect(new Set(equivalent.map((item) => item.renderer.after.rendered.quality)).size).toBe(1);
    expect(equivalent.every((item) => rendererProblems(item.renderer.after).length === 0)).toBe(true);
  }
  expect(runtimeErrors).toEqual([]);
  const reportSuffix = viewportShard == null ? "" : `-${viewportShard}`;
  await writeFile(resolve(outputRoot, representativeOnly ? `zk1237-normal-frame-smoke-report${reportSuffix}.json` : `zk1237-normal-frame-report${reportSuffix}.json`), `${JSON.stringify({
    version: 4,
    issue: "ZK-1237",
    commit,
    workingTreeDiffSha256,
    sourceFingerprintSha256,
    viewportShard: viewportShard ?? "combined",
    rendererQualityFixture: "medium",
    rendererDiagnosis: "Prior requested-quality/camera polling could pass against PixiStage's generation-0 placeholder before atlas activation and scene stamps completed. The test now derives readiness independently from raw activation, render-context, generation-stamp, chunk, texture-fallback, and diagnostic fields before and after every screenshot; route-destination, flag, transient-overlay, navigation, and full sidebar-control geometry are recorded from the activated frame.",
    runtimeErrors,
    captures,
  }, null, 2)}\n`);
});

test("ZK-1237 diagnoses UI-safe normal framing after leaving the hole editor", async ({ page }) => {
  test.setTimeout(120_000);
  await mkdir(outputRoot, { recursive: true });
  const diagnostics: unknown[] = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 800, height: 500 }] as const) {
    await page.setViewportSize(viewport);
    await loadFixture(page, "m23Fixture=1", "M23 Course Standards Club");
    await enterNormalGameplay(page);
    await page.evaluate(() => window.__coursecraftTest!.setPinRotationForTest("A"));
    await expect.poll(() => page.evaluate(() => (
      JSON.parse(window.render_game_to_text?.() ?? "{}").course?.activePinRotation
    ))).toBe("A");
    await expect(page.getByRole("button", { name: "Open course minimap" })).toBeVisible();
    for (const rotation of [0, 180] as const) {
      await rotateTo(page, rotation);
      await expect.poll(() => page.evaluate(() => {
        const frame = window.__coursecraftPixiTest!.normalFrame();
        const camera = window.__coursecraftPixiTest!.rendererAtlasState().camera;
        return frame?.source === "active-hole" && Math.abs(camera.zoom - frame.zoom) < 0.001;
      })).toBe(true);
      await page.waitForTimeout(600);
      const rendererBefore = await waitForStableRenderer(page);
      const geometry = await page.evaluate(() => {
        const pixi = window.__coursecraftPixiTest!;
        const frame = pixi.normalFrame()!;
        const canvas = document.querySelector<HTMLCanvasElement>(".cc-pixi-stage canvas")!;
        const canvasRect = canvas.getBoundingClientRect();
        const selectors = [".cc-live-controls", ".cc-workspace-nav", ".cc-minimap-toggle", ".cc-minimap", ".cc-news"];
        const overlays = selectors.flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)).map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            selector,
            x: rect.left - canvasRect.left,
            y: rect.top - canvasRect.top,
            width: rect.width,
            height: rect.height,
          };
        }));
        const project = (world: { x: number; y: number }) => {
          const screen = pixi.tileToScreen(world.x, world.y)!;
          const footprint = { x: screen.x - 18, y: screen.y - 18, width: 36, height: 36 };
          return {
            world,
            screen,
            footprint,
            occluders: overlays.filter((rect) => footprint.x < rect.x + rect.width
              && footprint.x + footprint.width > rect.x
              && footprint.y < rect.y + rect.height
              && footprint.y + footprint.height > rect.y).map((rect) => rect.selector),
          };
        };
        const route = frame.route.map(project);
        const visiblePoints = frame.visiblePoints.map(project);
        return {
          browserViewport: { width: window.innerWidth, height: window.innerHeight },
          playableViewport: pixi.viewport(),
          canvas: { x: canvasRect.left, y: canvasRect.top, width: canvasRect.width, height: canvasRect.height },
          overlays,
          route,
          visiblePoints,
          zoom: frame.zoom,
        };
      });
      const file = resolve(outputRoot, `zk1237-ui-safe-${viewport.width}x${viewport.height}-pinA-r${rotation}.png`);
      await writeFile(file, await page.screenshot({ fullPage: true }));
      const rendererAfter = await waitForStableRenderer(page);
      expect(rendererAfter.signature).toBe(rendererBefore.signature);
      expect(geometry.route.every((point) => point.occluders.length === 0)).toBe(true);
      expect(geometry.visiblePoints.every((point) => point.occluders.length === 0)).toBe(true);
      diagnostics.push({ file, rotation, renderer: { before: rendererBefore.last, after: rendererAfter.last }, ...geometry });
    }
  }
  await writeFile(resolve(outputRoot, "zk1237-ui-safe-report.json"), `${JSON.stringify({
    version: 1,
    issue: "ZK-1237",
    diagnostics,
  }, null, 2)}\n`);
  expect(diagnostics).toHaveLength(4);
});
