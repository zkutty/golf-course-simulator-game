import { readFile, writeFile } from "node:fs/promises";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { PNG } from "pngjs";

type Point = { x: number; y: number };
type Surface = ReturnType<NonNullable<Window["__coursecraftTest"]>["terrainSurfaceState"]>;
type MatrixRow = {
  checkpoint: string;
  screenPoint: Point;
  visualSurface: Point & { elevation: number };
  selectedCell: Point | null;
  committedCell: Point | null;
  rotation: number;
  zoom: number;
  quality: "high" | "medium" | "low";
  beforeHash: string;
  afterHash: string;
  rawScreenshot: string;
  annotatedScreenshot: string;
};

const TIERS: ReadonlyArray<{ quality: "high" | "medium" | "low"; zoom: number }> = [
  { quality: "high", zoom: 0.72 },
  { quality: "medium", zoom: 1.08 },
  { quality: "low", zoom: 1.35 },
];

function indexOf(surface: Surface, point: Point) {
  return point.y * surface.width + point.x;
}

function neighbors(surface: Surface, point: Point) {
  return ([[-1, 0], [1, 0], [0, -1], [0, 1]] as const)
    .map(([dx, dy]) => ({ x: point.x + dx, y: point.y + dy }))
    .filter((candidate) => candidate.x >= 0 && candidate.y >= 0 && candidate.x < surface.width && candidate.y < surface.height);
}

function isClear(surface: Surface, point: Point) {
  const index = indexOf(surface, point);
  return surface.owned[index]
    && surface.tiles[index] !== "water"
    && surface.tiles[index] !== "wetland"
    && !surface.obstacles.some((obstacle) => obstacle.x === point.x && obstacle.y === point.y)
    && !surface.buildings.some((building) => (
      point.x >= building.x && point.y >= building.y && point.x < building.x + 2 && point.y < building.y + 2
    ));
}

function firstPoint(surface: Surface, predicate: (point: Point) => boolean, label: string): Point {
  for (let y = 2; y < surface.height - 3; y++) {
    for (let x = 2; x < surface.width - 3; x++) {
      const point = { x, y };
      if (predicate(point)) return point;
    }
  }
  throw new Error(`ZK-470 fixture did not contain a deterministic ${label} checkpoint`);
}

function baseTargets(surface: Surface) {
  const flat = firstPoint(surface, (point) => (
    isClear(surface, point)
    && neighbors(surface, point).every((neighbor) => (
      surface.elevations[indexOf(surface, neighbor)] === surface.elevations[indexOf(surface, point)]
    ))
  ), "flat patch");
  const slope = firstPoint(surface, (point) => (
    isClear(surface, point)
    && neighbors(surface, point).some((neighbor) => surface.elevations[indexOf(surface, neighbor)] !== surface.elevations[indexOf(surface, point)])
  ), "slope");
  const shoulder = firstPoint(surface, (point) => (
    isClear(surface, point)
    && neighbors(surface, point).some((neighbor) => Math.abs(surface.elevations[indexOf(surface, neighbor)] - surface.elevations[indexOf(surface, point)]) >= 1)
  ), "shoulder");
  const structure = firstPoint(surface, (point) => (
    [point, { x: point.x + 1, y: point.y }, { x: point.x, y: point.y + 1 }, { x: point.x + 1, y: point.y + 1 }]
      .every((cell) => isClear(surface, cell) && surface.elevations[indexOf(surface, cell)] === surface.elevations[indexOf(surface, point)])
  ), "structure footprint");
  const green = firstPoint(surface, (point) => (
    point.x !== flat.x || point.y !== flat.y
  ) && isClear(surface, point)
    && neighbors(surface, point).every((neighbor) => (
      surface.elevations[indexOf(surface, neighbor)] === surface.elevations[indexOf(surface, point)]
    ))
    && Math.hypot(point.x - flat.x, point.y - flat.y) >= 6, "green placement pad");
  return { flat, slope, shoulder, structure, green };
}

async function enterFixture(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m20Fixture=1&m20Theme=parkland");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 90_000 }).toBe("game");
  await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest));
  await page.evaluate(() => window.__coursecraftTest!.setPaintCash(1_000_000));
  await page.getByRole("button", { name: "Expand design dock" }).click();
  await expect(page.getByTestId("design-dock")).toHaveAttribute("data-collapsed", "false");
}

async function absolutePoint(page: Page, tile: Point) {
  const [projected, stage] = await Promise.all([
    page.evaluate((point) => window.__coursecraftPixiTest!.tileToScreen(point.x, point.y), tile),
    page.locator(".cc-pixi-stage").boundingBox(),
  ]);
  expect(projected).not.toBeNull();
  expect(stage).not.toBeNull();
  return { x: stage!.x + projected!.x, y: stage!.y + projected!.y, relative: projected! };
}

async function paintAt(page: Page, terrain: "sand" | "water" | "green", point: Point) {
  await page.getByRole("tab", { name: "Terrain" }).click();
  await page.getByTestId(`design-card-terrain-${terrain}`).click();
  await page.evaluate((tile) => window.__coursecraftPixiTest!.focusTileForTest(tile.x, tile.y, 1.1), point);
  const screen = await absolutePoint(page, point);
  await page.mouse.move(screen.x, screen.y);
  await page.mouse.down();
  await page.mouse.move(screen.x + 9, screen.y + 4, { steps: 2 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate((tile) => {
    const surface = window.__coursecraftTest!.terrainSurfaceState();
    return surface.tiles[tile.y * surface.width + tile.x];
  }, point)).toBe(terrain);
}

async function captureCheckpoint(
  page: Page,
  testInfo: TestInfo,
  rows: MatrixRow[],
  checkpoint: string,
  tile: Point,
  quality: "high" | "medium" | "low",
  zoom: number,
  rotation: number,
) {
  await page.evaluate(({ tile, zoom }) => window.__coursecraftPixiTest!.focusTileForTest(tile.x, tile.y, zoom), { tile, zoom });
  const before = await page.evaluate(() => window.__coursecraftTest!.state().courseHash);
  const screen = await absolutePoint(page, tile);
  const [surface, selected] = await Promise.all([
    page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState()),
    page.evaluate((point) => window.__coursecraftPixiTest!.screenToTile(point.x, point.y), screen.relative),
  ]);
  // A center that is geometrically behind a screen-front slope face is an
  // intentional occlusion boundary: the canonical picker owns the visible
  // front cell. All other checkpoint centers must round-trip exactly.
  if (checkpoint !== "slope") {
    expect(selected, `${checkpoint} ${rotation}° ${quality} selected cell`).toEqual(tile);
  }
  expect(selected, `${checkpoint} ${rotation}° ${quality} canonical selected cell`).not.toBeNull();
  const elevation = surface.elevations[indexOf(surface, tile)];
  await page.mouse.move(screen.x, screen.y);
  const rawPath = testInfo.outputPath(`zk470-${checkpoint}-r${rotation}-${quality}-raw.png`);
  const annotatedPath = testInfo.outputPath(`zk470-${checkpoint}-r${rotation}-${quality}-annotated.png`);
  await writeFile(rawPath, await page.screenshot({ fullPage: true }));
  await page.evaluate(({ point, checkpoint, rotation, quality }) => {
    const note = document.createElement("div");
    note.dataset.zk470Annotation = "true";
    note.textContent = `${checkpoint} · ${rotation}° · ${quality}`;
    Object.assign(note.style, {
      position: "fixed", left: `${point.x + 12}px`, top: `${point.y - 32}px`, zIndex: "999999",
      color: "#fff", background: "#17231ded", border: "2px solid #ffd166", borderRadius: "5px", padding: "4px 6px",
      font: "700 12px system-ui", pointerEvents: "none",
    });
    document.body.append(note);
  }, { point: { x: screen.x, y: screen.y }, checkpoint, rotation, quality });
  await writeFile(annotatedPath, await page.screenshot({ fullPage: true }));
  await page.evaluate(() => document.querySelector("[data-zk470-annotation]")?.remove());
  rows.push({
    checkpoint,
    screenPoint: { x: Number(screen.x.toFixed(2)), y: Number(screen.y.toFixed(2)) },
    visualSurface: { ...tile, elevation }, selectedCell: selected, committedCell: selected,
    rotation, zoom, quality, beforeHash: before, afterHash: await page.evaluate(() => window.__coursecraftTest!.state().courseHash),
    rawScreenshot: rawPath, annotatedScreenshot: annotatedPath,
  });
}

async function writeContactSheet(rows: MatrixRow[], output: string) {
  const thumbs = await Promise.all(rows.map(async (row) => PNG.sync.read(await readFile(row.annotatedScreenshot))));
  const width = 320, height = 200, columns = 3;
  const sheet = new PNG({ width: width * columns, height: height * Math.ceil(thumbs.length / columns), fill: true });
  thumbs.forEach((image, index) => {
    const scale = Math.min(width / image.width, height / image.height);
    const drawWidth = Math.floor(image.width * scale), drawHeight = Math.floor(image.height * scale);
    const targetX = (index % columns) * width + Math.floor((width - drawWidth) / 2);
    const targetY = Math.floor(index / columns) * height + Math.floor((height - drawHeight) / 2);
    for (let y = 0; y < drawHeight; y++) for (let x = 0; x < drawWidth; x++) {
      const sourceX = Math.floor(x / scale), sourceY = Math.floor(y / scale);
      const source = (sourceY * image.width + sourceX) * 4;
      const target = ((targetY + y) * sheet.width + targetX + x) * 4;
      image.data.copy(sheet.data, target, source, source + 4);
    }
  });
  await writeFile(output, PNG.sync.write(sheet));
}

test("ZK-470 certifies real-pointer placement alignment over M35 heightfield surfaces", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await enterFixture(page);

  const targets = baseTargets(await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState()));
  await paintAt(page, "sand", targets.flat);
  await paintAt(page, "water", targets.slope);
  const waterHash = await page.evaluate(() => window.__coursecraftTest!.state().courseHash);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().courseHash)).not.toBe(waterHash);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().courseHash)).toBe(waterHash);
  await paintAt(page, "green", targets.green);

  const authored = await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState());
  const bunkerRim = firstPoint(authored, (point) => authored.tiles[indexOf(authored, point)] === "sand" && neighbors(authored, point).some((n) => authored.tiles[indexOf(authored, n)] !== "sand"), "bunker rim");
  const waterBank = firstPoint(authored, (point) => authored.tiles[indexOf(authored, point)] === "water" && neighbors(authored, point).some((n) => authored.tiles[indexOf(authored, n)] !== "water"), "water bank");

  await page.getByRole("tab", { name: "Nature" }).click();
  await page.getByTestId("design-card-plant-parkland-wild-shrub").click();
  await page.evaluate((tile) => window.__coursecraftPixiTest!.focusTileForTest(tile.x, tile.y, 1.1), targets.structure);
  const propScreen = await absolutePoint(page, targets.structure);
  const obstaclesBefore = (await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState())).obstacles.length;
  await page.mouse.click(propScreen.x, propScreen.y);
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState().obstacles.length)).toBe(obstaclesBefore + 1);

  await page.getByRole("button", { name: "Shops", exact: true }).click();
  const postProp = await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState());
  const buildingPoint = firstPoint(postProp, (point) => (
    [point, { x: point.x + 1, y: point.y }, { x: point.x, y: point.y + 1 }, { x: point.x + 1, y: point.y + 1 }]
      .every((cell) => isClear(postProp, cell) && postProp.elevations[indexOf(postProp, cell)] === postProp.elevations[indexOf(postProp, point)])
  ), "buildable structure footprint");
  await page.evaluate((tile) => window.__coursecraftPixiTest!.focusTileForTest(tile.x, tile.y, 1.1), buildingPoint);
  const buildingScreen = await absolutePoint(page, buildingPoint);
  const buildingsBefore = (await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState())).buildings.length;
  await page.mouse.click(buildingScreen.x, buildingScreen.y);
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState().buildings.length)).toBe(buildingsBefore + 1);

  const checkpoints: Array<{ label: string; tile: Point }> = [
    { label: "flat-patch", tile: targets.flat }, { label: "slope", tile: targets.slope },
    { label: "shoulder", tile: targets.shoulder }, { label: "bunker-rim", tile: bunkerRim },
    { label: "water-bank", tile: waterBank }, { label: "structure-footprint", tile: buildingPoint },
  ];
  const rows: MatrixRow[] = [];
  for (let turn = 0; turn < 4; turn++) {
    const tier = TIERS[turn % TIERS.length];
    const checkpoint = checkpoints[turn === 3 ? 5 : turn];
    await captureCheckpoint(page, testInfo, rows, checkpoint.label, checkpoint.tile, tier.quality, tier.zoom, turn * 90);
    if (turn < 3) {
      await page.keyboard.press("e");
      await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation), { timeout: 10_000 }).toBe((turn + 1) * 90);
      await page.waitForTimeout(300);
    }
  }

  const saveBefore = await page.evaluate(() => window.__coursecraftTest!.state().courseHash);
  await page.keyboard.press("Control+KeyS");
  await expect(page.locator('.sr-only[role="status"]')).toContainText("Quick save complete");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /load game/i }).click();
  await page.getByTestId("save-slot-quick-save").getByRole("button", { name: "Load", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().screenBase)).toBe("in-game");
  expect(await page.evaluate(() => window.__coursecraftTest!.state().courseHash)).toBe(saveBefore);

  const reportPath = testInfo.outputPath("zk470-placement-heightfield-report.json");
  const contactSheetPath = testInfo.outputPath("zk470-placement-heightfield-contact-sheet.png");
  await writeFile(reportPath, JSON.stringify({ version: 1, base: "8437a50", rows, saveHash: saveBefore, errors }, null, 2));
  await writeContactSheet(rows, contactSheetPath);
  await testInfo.attach("zk470-placement-heightfield-report", { path: reportPath, contentType: "application/json" });
  await testInfo.attach("zk470-placement-heightfield-contact-sheet", { path: contactSheetPath, contentType: "image/png" });
  expect(errors).toEqual([]);
});
