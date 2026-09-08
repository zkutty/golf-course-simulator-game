import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

function uint32(bytes: Buffer, offset: number): number {
  return bytes.readUInt32BE(offset);
}

test("ZK-770 downloads truthful SVG/PNG artwork offline without changing the course", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", { configurable: true, value: async () => undefined });
  });

  await page.goto("/?m23Fixture=1");
  await expect.poll(
    () => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").screen),
    { timeout: 60_000 },
  ).toBe("game");
  const courseBefore = await page.evaluate(() => JSON.stringify(JSON.parse(window.render_game_to_text?.() ?? "{}").course));

  await page.getByTestId("open-architecture-review").click();
  const review = page.getByTestId("architecture-review");
  await review.getByTestId("architecture-create-hole-illustration").click();
  const preview = review.getByTestId("hole-illustration-preview");
  await expect(preview).toBeVisible();

  const previewSource = await preview.locator("figure img").getAttribute("src");
  expect(previewSource).toMatch(/^data:image\/svg\+xml,/);
  const previewSvg = decodeURIComponent(previewSource!.slice("data:image/svg+xml,".length));
  const previewBody = previewSvg.slice(previewSvg.indexOf(">") + 1, previewSvg.lastIndexOf("</svg>"));

  const svgDownloadPromise = page.waitForEvent("download");
  await preview.getByRole("button", { name: "Download single SVG" }).click();
  const svgDownload = await svgDownloadPromise;
  const svgPath = testInfo.outputPath(svgDownload.suggestedFilename());
  await svgDownload.saveAs(svgPath);
  const svg = await readFile(svgPath, "utf8");
  expect(svgDownload.suggestedFilename()).toMatch(/\.svg$/);
  expect(svg).toContain('width="3840" height="2560" viewBox="0 0 960 640"');
  expect(svg).toContain('<metadata id="coursecraft-export">');
  expect(svg).toContain(previewBody);
  await expect(preview.getByTestId("hole-illustration-export-status")).toContainText("Saved");

  const pngDownloadPromise = page.waitForEvent("download");
  await preview.getByRole("button", { name: "Download single PNG" }).click();
  const pngDownload = await pngDownloadPromise;
  const pngPath = testInfo.outputPath(pngDownload.suggestedFilename());
  await pngDownload.saveAs(pngPath);
  const png = await readFile(pngPath);
  expect(pngDownload.suggestedFilename()).toMatch(/\.png$/);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(uint32(png, 16)).toBe(3840);
  expect(uint32(png, 20)).toBe(2560);
  expect(png.includes(Buffer.from("tEXtCourseCraft\0"))).toBe(true);
  await expect(preview.getByTestId("hole-illustration-export-status")).toContainText("Saved");

  await preview.getByRole("button", { name: "Share single PNG" }).click();
  await expect(preview.getByTestId("hole-illustration-export-status")).toContainText("Shared");
  await expect(preview.getByRole("button", { name: "Download course atlas SVG" })).toBeDisabled();
  await expect(preview.getByRole("button", { name: "Download course atlas PNG" })).toBeDisabled();
  await expect(preview).toContainText("A course atlas requires exactly 9 or 18 unique, existing holes");

  const screenshotPath = testInfo.outputPath("zk770-export-controls.png");
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach("zk770-export-controls", { path: screenshotPath, contentType: "image/png" });

  const courseAfter = await page.evaluate(() => JSON.stringify(JSON.parse(window.render_game_to_text?.() ?? "{}").course));
  expect(courseAfter).toBe(courseBefore);
  expect(errors).toEqual([]);
});
