import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
export function canvasClip(state) {
  assert.ok(state && state.current && state.connected && state.visible && state.tag === "CANVAS", "Unique current visible connected canvas required");
  for (const key of ["x", "y", "width", "height", "viewportWidth", "viewportHeight", "intrinsicWidth", "intrinsicHeight", "dpr", "zoom"]) assert.ok(Number.isFinite(state[key]), "Finite canvas geometry required");
  assert.ok(state.width > 0 && state.height > 0 && state.intrinsicWidth > 0 && state.intrinsicHeight > 0, "Nonempty canvas required");
  assert.equal(state.dpr, 1, "Canonical Desktop Chrome DPR1 required");
  assert.equal(state.zoom, 1, "Canonical unzoomed viewport required");
  assert.ok(state.x >= 0 && state.y >= 0 && state.x + state.width <= state.viewportWidth && state.y + state.height <= state.viewportHeight, "Raw canvas rectangle must be fully inside viewport; epsilon overshoots rejected");
  // Match the installed element-capture integer enclosure; do not invoke private APIs.
  const x = Math.floor(state.x + 0.001), y = Math.floor(state.y + 0.001);
  const width = Math.ceil(state.x + state.width - 0.001) - x;
  const height = Math.ceil(state.y + state.height - 0.001) - y;
  assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= state.viewportWidth && y + height <= state.viewportHeight, "Canvas enclosure must be fully inside viewport; partial clips rejected");
  return { x, y, width, height };
}
function readCanvas(node) {
  const matches = document.querySelectorAll(".cc-pixi-stage canvas");
  const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
  return { current: matches.length === 1 && matches[0] === node, connected: node.isConnected, visible: style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && Number(style.opacity) > 0,
    tag: node.tagName, x: rect.x, y: rect.y, width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight,
    intrinsicWidth: node.width, intrinsicHeight: node.height, dpr: devicePixelRatio, zoom: visualViewport?.scale ?? 1 };
}
export async function captureVisibleCanvas(page, outputPath) {
  const locator = page.locator(".cc-pixi-stage canvas");
  assert.equal(await locator.count(), 1, "Exactly one canvas required");
  const handle = await page.$(".cc-pixi-stage canvas", { strict: true });
  assert.ok(handle, "Attached canvas required");
  let failed = false, primary, result;
  try {
    const before = await handle.evaluate(readCanvas), clip = canvasClip(before);
    const png = await page.screenshot({ type: "png", clip, scale: "device", animations: "allow", caret: "initial", timeout: 10000 });
    const after = await handle.evaluate(readCanvas); canvasClip(after);
    assert.deepEqual(after, before, "Canvas identity/current connection/geometry changed during capture");
    assert.ok(png.length >= 24 && png.length <= 12 * 1024 * 1024, "Bounded PNG required");
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "PNG signature required");
    assert.equal(png.subarray(12, 16).toString(), "IHDR", "PNG IHDR required");
    assert.equal(png.readUInt32BE(16), clip.width, "PNG width must match DPR1 integer clip");
    assert.equal(png.readUInt32BE(20), clip.height, "PNG height must match DPR1 integer clip");
    result = { method: "public-page-screenshot-canvas-viewport-clip-v1", clip, before, after, bytes: png.length, sha256: createHash("sha256").update(png).digest("hex"), qualification: "Pre/post current canvas geometry checked; compositor capture is asynchronous. PNG header establishes format/dimensions, not pixel content. Decoded real controls/artifact QA required." };
    await writeFile(outputPath, png, { flag: "wx" });
  } catch (error) { failed = true; primary = error; }
  try { await handle.dispose(); } catch (error) { if (!failed) { failed = true; primary = error; } }
  if (failed) throw primary;
  return result;
}
