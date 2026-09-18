import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const outputRoot = resolve(process.env.ZK1202_EVIDENCE_DIR ?? "../zk1202-habitat-evidence");
const commit = process.env.ZK1202_COMMIT ?? "unknown";
const baseUrl = process.env.ZK1202_BASE_URL ?? "";

type Capture = {
  file: string;
  fixture: "m19" | "zk1202-secondary";
  rotation: 0 | 90 | 180 | 270;
  view: "normal" | "detail";
  quality: "high" | "medium";
  focus: { x: number; y: number };
  courseHash: string;
  obstacleHash: string;
  renderer: unknown;
};

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
  input: Omit<Capture, "file" | "courseHash" | "obstacleHash" | "renderer">,
): Promise<Capture> {
  const zoom = input.view === "detail" ? 2 : 1;
  await page.evaluate(({ quality, zoom, focus }) => {
    window.__coursecraftTest!.setGraphicsQualityFixture(quality);
    window.__coursecraftPixiTest!.focusTileForTest(focus.x, focus.y, zoom);
  }, { ...input, zoom });
  await expect.poll(() => page.evaluate(({ quality, zoom }) => {
    const state = window.__coursecraftPixiTest!.rendererAtlasState();
    return state.requested.quality === quality
      && Math.abs(state.camera.zoom - zoom) < 0.001
      && Math.abs(state.camera.targetZoom - zoom) < 0.001;
  }, { ...input, zoom })).toBe(true);
  await page.waitForTimeout(600);
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
    renderer: await page.evaluate(() => window.__coursecraftPixiTest!.rendererAtlasState()),
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
  // Capture the four normal authority views as one Medium run so all four
  // rotations exercise exactly the same atlas residency and world-space plan.
  for (const rotation of [0, 90, 180, 270] as const) {
    await rotateTo(page, rotation);
    captures.push(await capture(page, {
      fixture: "m19",
      rotation,
      view: "normal",
      quality: "medium",
      focus: { x: 24, y: 18 },
    }));
  }
  const scoped = captures.filter((item) => item.fixture === "m19");
  expect(new Set(scoped.map((item) => item.courseHash)).size).toBe(1);
  expect(new Set(scoped.map((item) => item.obstacleHash)).size).toBe(1);
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
