import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

const outputRoot = resolve(process.env.ZK473_EVIDENCE_DIR ?? "../zk473-parity-evidence");
const commit = process.env.ZK473_COMMIT ?? "unknown";

const tiers = [
  { label: "overview", zoom: 0.34, quality: "low" as const },
  { label: "normal", zoom: 0.72, quality: "high" as const },
  { label: "detail", zoom: 1.1, quality: "high" as const },
];

type Capture = {
  file: string;
  rotation: number;
  tier: string;
  zoom: number;
  quality: "high" | "medium" | "low";
  structuredState: unknown;
  terrainState: unknown;
};

async function contactSheet(files: string[], output: string) {
  const images = await Promise.all(files.map(async (file) => PNG.sync.read(await readFile(file))));
  const thumbWidth = 360;
  const thumbHeight = 225;
  const columns = 3;
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

test("ZK-473 retains the exact-candidate Parkland rotation and zoom matrix", async ({ page }) => {
  test.setTimeout(240_000);
  await mkdir(outputRoot, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m20Fixture=1&m20Theme=parkland");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 90_000 }).toBe("game");
  await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest));

  const captures: Capture[] = [];
  for (let turn = 0; turn < 4; turn++) {
    const rotation = turn * 90;
    if (turn > 0) {
      await page.keyboard.press("e");
      await expect.poll(() => page.evaluate(() => (
        JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation
      ))).toBe(rotation);
    }
    for (const tier of tiers) {
      await page.evaluate(({ quality, zoom }) => {
        window.__coursecraftTest!.setGraphicsQualityFixture(quality);
        window.__coursecraftPixiTest!.focusTileForTest(32, 22, zoom);
      }, tier);
      await expect.poll(() => page.evaluate((zoom) => {
        const camera = JSON.parse(window.render_game_to_text?.() ?? "{}").camera;
        return Math.abs((camera?.zoom ?? 0) - zoom) < 0.001;
      }, tier.zoom)).toBe(true);
      await page.waitForTimeout(500);
      const file = resolve(outputRoot, `parkland-r${rotation}-${tier.label}.png`);
      await writeFile(file, await page.screenshot({ fullPage: true }));
      captures.push({
        file,
        rotation,
        tier: tier.label,
        zoom: tier.zoom,
        quality: tier.quality,
        structuredState: await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}")),
        terrainState: await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState()),
      });
    }
  }

  const report = {
    version: 1,
    issue: "ZK-473",
    commit,
    viewport: { width: 1440, height: 900 },
    theme: "parkland",
    fixture: "m20Fixture",
    command: "ZK473_EVIDENCE_DIR=<dir> ZK473_COMMIT=<sha> npx playwright test e2e/zk473-parity-capture.e2e.ts --workers=1 --retries=0",
    captures,
  };
  await writeFile(resolve(outputRoot, "zk473-parity-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await contactSheet(captures.map((capture) => capture.file), resolve(outputRoot, "zk473-coursecraft-contact-sheet.png"));
});
