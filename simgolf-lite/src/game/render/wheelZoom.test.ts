import { describe, expect, it } from "vitest";
import { worldToIso } from "./iso";
import {
  MAX_WHEEL_DELTA_PX,
  gestureScaleToWheelDelta,
  nextWheelZoomTarget,
  normalizeWheelDelta,
} from "./wheelZoom";

const viewport = { width: 1200, height: 800 };
const cursor = { x: 330, y: 245 };

function anchorScreen(camera: { cx: number; cy: number; zoom: number }, anchor: { x: number; y: number }) {
  const center = worldToIso(camera.cx, camera.cy, 0, 0);
  return {
    x: viewport.width / 2 + (anchor.x - center.x) * camera.zoom,
    y: viewport.height / 2 + (anchor.y - center.y) * camera.zoom,
  };
}

describe("wheel zoom targeting", () => {
  it("normalizes pixel, line, and page deltas with a bounded mouse-wheel step", () => {
    expect(normalizeWheelDelta(2.5, 0, viewport.height)).toBe(2.5);
    expect(normalizeWheelDelta(2, 1, viewport.height)).toBe(32);
    expect(normalizeWheelDelta(1, 2, viewport.height)).toBe(MAX_WHEEL_DELTA_PX);
    expect(normalizeWheelDelta(-1, 2, viewport.height)).toBe(-MAX_WHEEL_DELTA_PX);
  });

  it("keeps a one-direction fractional trackpad stream monotonic", () => {
    let camera = { cx: 32, cy: 32, zoom: 1 };
    const zooms = [0.18, 0.42, 0.75, 1.1, 0.36, 0.22].map((deltaPixels) => {
      camera = nextWheelZoomTarget({ camera, cursor, viewport, deltaPixels, rotation: 0, minZoom: 0.15, maxZoom: 8 });
      return camera.zoom;
    });
    expect(zooms.every((zoom, index) => index === 0 || zoom < zooms[index - 1])).toBe(true);
  });

  it("preserves the cursor anchor across consecutive events and clamps zoom", () => {
    let camera = { cx: 22, cy: 41, zoom: 0.8 };
    const center = worldToIso(camera.cx, camera.cy, 0, 0);
    const anchor = {
      x: center.x + (cursor.x - viewport.width / 2) / camera.zoom,
      y: center.y + (cursor.y - viewport.height / 2) / camera.zoom,
    };
    for (const deltaPixels of [-12.4, -8.2, -3.1, -0.7]) {
      camera = nextWheelZoomTarget({ camera, cursor, viewport, deltaPixels, rotation: 0, minZoom: 0.15, maxZoom: 8 });
      expect(anchorScreen(camera, anchor).x).toBeCloseTo(cursor.x, 8);
      expect(anchorScreen(camera, anchor).y).toBeCloseTo(cursor.y, 8);
    }
    camera = nextWheelZoomTarget({ camera, cursor, viewport, deltaPixels: -1_000_000, rotation: 0, minZoom: 0.15, maxZoom: 8 });
    expect(camera.zoom).toBeLessThanOrEqual(8);
  });

  it("maps Safari pinch scale to the same zoom target contract", () => {
    const camera = { cx: 32, cy: 32, zoom: 1 };
    const zoomedIn = nextWheelZoomTarget({
      camera,
      cursor,
      viewport,
      deltaPixels: gestureScaleToWheelDelta(1.5),
      rotation: 0,
      minZoom: 0.15,
      maxZoom: 8,
    });
    expect(zoomedIn.zoom).toBeCloseTo(1.5, 8);

    const zoomedOut = nextWheelZoomTarget({
      camera: zoomedIn,
      cursor,
      viewport,
      deltaPixels: gestureScaleToWheelDelta(0.5),
      rotation: 0,
      minZoom: 0.15,
      maxZoom: 8,
    });
    expect(zoomedOut.zoom).toBeCloseTo(0.75, 8);
    expect(gestureScaleToWheelDelta(0)).toBe(0);
  });
});
