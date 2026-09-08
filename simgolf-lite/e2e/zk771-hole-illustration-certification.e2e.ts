import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

function uint32(bytes: Buffer, offset: number): number {
  return bytes.readUInt32BE(offset);
}

async function serializedCourseBytes(page: Page): Promise<string> {
  return page.evaluate(() => {
    const course = JSON.parse(window.render_game_to_text?.() ?? "{}").course;
    // The text envelope's presentation budget is live-render telemetry, not
    // persisted course data. Keep every serialized course field otherwise.
    const { presentation: _presentation, ...surfaceCare } = course.surfaceCare ?? {};
    return JSON.stringify({ ...course, ...(course.surfaceCare ? { surfaceCare } : {}) });
  });
}

async function openPreview(page: Page) {
  await page.goto("/?m47Fixture=1");
  await expect.poll(
    () => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").screen),
    { timeout: 60_000 },
  ).toBe("game");
  await expect.poll(
    () => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.holesOpen),
  ).toBe(18);
  await expect(page.getByText("M47 18-Hole Certification Course", { exact: true })).toBeVisible();
  const launcher = page.getByTestId("open-architecture-review");
  await launcher.focus();
  await page.keyboard.press("Enter");
  const review = page.getByTestId("architecture-review");
  const illustration = review.getByTestId("architecture-create-hole-illustration");
  await illustration.focus();
  await page.keyboard.press("Enter");
  const preview = review.getByTestId("hole-illustration-preview");
  await expect(preview).toBeVisible();
  return preview;
}

test("ZK-771 real 18-hole browser delivery is keyboard-safe and fail-closed", async ({ page }, testInfo) => {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  let downloads = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("download", () => { downloads += 1; });
  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith("data:") || url.startsWith("blob:")) return;
    try {
      if (new URL(url).hostname !== "127.0.0.1") externalRequests.push(url);
    } catch { externalRequests.push(url); }
  });
  await page.addInitScript(() => {
    const delivery = { shared: 0, copied: 0 };
    Object.defineProperty(window, "__zk771Delivery", { configurable: true, value: delivery });
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => { delivery.shared += 1; },
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write: async () => { delivery.copied += 1; } },
    });
    Object.defineProperty(window, "ClipboardItem", {
      configurable: true,
      value: class ClipboardItem { constructor(_items: Record<string, Blob>) {} },
    });
  });

  const preview = await openPreview(page);
  const courseBefore = await serializedCourseBytes(page);
  const svgDownload = page.waitForEvent("download");
  const svgButton = preview.getByRole("button", { name: "Download single SVG" });
  await svgButton.focus();
  await page.keyboard.press("Enter");
  const svg = await svgDownload;
  const svgPath = testInfo.outputPath(svg.suggestedFilename());
  await svg.saveAs(svgPath);
  const svgBytes = await readFile(svgPath, "utf8");
  expect(svg.suggestedFilename()).toMatch(/\.svg$/);
  expect(svgBytes).toContain('width="3840" height="2560" viewBox="0 0 960 640"');
  expect(svgBytes).toContain('<metadata id="coursecraft-export">');
  await expect(preview.getByTestId("hole-illustration-export-status")).toContainText("Saved");

  const pngDownload = page.waitForEvent("download");
  const pngButton = preview.getByRole("button", { name: "Download single PNG" });
  await pngButton.focus();
  await pngButton.press("Enter");
  const png = await pngDownload;
  const pngPath = testInfo.outputPath(png.suggestedFilename());
  await png.saveAs(pngPath);
  const pngBytes = await readFile(pngPath);
  expect(png.suggestedFilename()).toMatch(/\.png$/);
  expect([...pngBytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(uint32(pngBytes, 16)).toBe(3840);
  expect(uint32(pngBytes, 20)).toBe(2560);
  expect(pngBytes.includes(Buffer.from("tEXtCourseCraft\0"))).toBe(true);
  await expect(preview.getByTestId("hole-illustration-export-status")).toContainText("Saved");

  const atlasSvgButton = preview.getByRole("button", { name: "Download course atlas SVG" });
  const atlasPngButton = preview.getByRole("button", { name: "Download course atlas PNG" });
  await expect(atlasSvgButton).toBeEnabled();
  await expect(atlasPngButton).toBeEnabled();
  const atlasSvgDownload = page.waitForEvent("download");
  await atlasSvgButton.focus();
  await page.keyboard.press("Enter");
  const atlasSvg = await atlasSvgDownload;
  const atlasSvgPath = testInfo.outputPath(atlasSvg.suggestedFilename());
  await atlasSvg.saveAs(atlasSvgPath);
  const atlasSvgBytes = await readFile(atlasSvgPath, "utf8");
  expect(atlasSvg.suggestedFilename()).toMatch(/\.svg$/);
  expect(atlasSvgBytes).toContain('width="2400" height="3900" viewBox="0 0 2400 3900"');
  expect(atlasSvgBytes).toContain('data-export-kind="atlas"');
  expect(atlasSvgBytes.match(/data-atlas-index=/g)).toHaveLength(18);
  expect(atlasSvgBytes).toContain("&quot;publishedHoleCount&quot;:18");

  const atlasPngDownload = page.waitForEvent("download");
  await atlasPngButton.focus();
  await page.keyboard.press("Enter");
  const atlasPng = await atlasPngDownload;
  const atlasPngPath = testInfo.outputPath(atlasPng.suggestedFilename());
  await atlasPng.saveAs(atlasPngPath);
  const atlasPngBytes = await readFile(atlasPngPath);
  expect(atlasPng.suggestedFilename()).toMatch(/\.png$/);
  expect([...atlasPngBytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(uint32(atlasPngBytes, 16)).toBe(2400);
  expect(uint32(atlasPngBytes, 20)).toBe(3900);
  expect(atlasPngBytes.includes(Buffer.from("tEXtCourseCraft\0"))).toBe(true);
  await expect(preview.getByTestId("hole-illustration-export-status")).toContainText("Saved");
  const previewScreenshot = testInfo.outputPath("zk771-hole-illustration-delivery.png");
  await preview.screenshot({ path: previewScreenshot });
  await testInfo.attach("zk771-hole-illustration-delivery", { path: previewScreenshot, contentType: "image/png" });

  const shareButton = preview.getByRole("button", { name: "Share single PNG" });
  await shareButton.focus();
  await shareButton.press("Enter");
  await expect(preview.getByTestId("hole-illustration-export-status")).toContainText("Shared");
  expect(await page.evaluate(() => (window as typeof window & { __zk771Delivery: { shared: number; copied: number } }).__zk771Delivery)).toEqual({ shared: 1, copied: 0 });

  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: async () => { throw new Error("share rejected"); } });
  });
  await shareButton.focus();
  await shareButton.press("Enter");
  await expect(preview.getByTestId("hole-illustration-export-status")).toContainText("Copied");
  expect(await page.evaluate(() => (window as typeof window & { __zk771Delivery: { shared: number; copied: number } }).__zk771Delivery)).toEqual({ shared: 1, copied: 1 });

  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write: async () => { throw new Error("clipboard rejected"); } } });
  });
  const fallbackDownload = page.waitForEvent("download");
  await shareButton.focus();
  await shareButton.press("Enter");
  const fallback = await fallbackDownload;
  expect(fallback.suggestedFilename()).toMatch(/\.png$/);
  await expect(preview.getByTestId("hole-illustration-export-status")).toContainText("Downloaded");

  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toBlob = (callback: BlobCallback) => callback(null);
  });
  const downloadsBeforeFailure = downloads;
  await pngButton.focus();
  await pngButton.press("Enter");
  await expect(preview.getByTestId("hole-illustration-export-status")).toContainText("Export failed");
  await page.waitForTimeout(200);
  expect(downloads).toBe(downloadsBeforeFailure);
  expect(await serializedCourseBytes(page)).toBe(courseBefore);
  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});
