import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import {
  buildPreviewAtlas,
  doctor,
  normalizeCandidate,
  validateBenchmark,
  validateManifest,
  verifyAtlasDeterminism,
} from "./pixellab-pilot.mjs";

describe("PixelLab pilot pipeline", () => {
  it("keeps the MCP bridge pinned and reports credentials without exposing them", () => {
    const previous = process.env.PIXELLAB_AUTH_HEADER;
    process.env.PIXELLAB_AUTH_HEADER = "Bearer test-only-token-with-safe-length";
    try {
      const result = doctor({ requireAuth: true });
      expect(result.ok).toBe(true);
      expect(result.auth).toBe("present-valid-shape");
      expect(JSON.stringify(result)).not.toContain("test-only-token");
    } finally {
      if (previous === undefined) delete process.env.PIXELLAB_AUTH_HEADER;
      else process.env.PIXELLAB_AUTH_HEADER = previous;
    }
  });

  it("validates reference PNG hashes, alpha, anchors, and animation grids", () => {
    const result = validateManifest();
    expect(result.errors).toEqual([]);
    expect(result.assets).toBeGreaterThanOrEqual(10);
    expect(result.approvedPixelLab).toBe(0);
    expect(result.warnings).toContain("no approved PixelLab static candidate");
    expect(result.warnings).toContain("no approved PixelLab animation candidate");
  });

  it("keeps benchmark weights and provider coverage complete while live scores are pending", () => {
    const result = validateBenchmark();
    expect(result).toMatchObject({ ok: true, status: "awaiting-live-generation", weights: 100 });
  });

  it("rebuilds every production atlas byte-for-byte in an isolated directory", () => {
    expect(verifyAtlasDeterminism()).toMatchObject({ ok: true, files: 8, errors: [] });
  }, 30_000);

  it("normalizes alpha art with premultiplied downsampling and a bottom-center anchor", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "coursecraft-art-normalize-"));
    const output = path.join(directory, "oak.png");
    try {
      const result = normalizeCandidate({
        input: path.resolve("src/assets/props/natural/parkland_tree_oak.png"),
        output,
        width: 64,
        height: 96,
        padding: 4,
      });
      expect(result.target).toEqual({ width: 64, height: 96 });
      expect(existsSync(output)).toBe(true);
      const png = PNG.sync.read(readFileSync(output));
      expect([png.width, png.height]).toEqual([64, 96]);
      let bottomVisible = false;
      for (let y = 88; y < 92; y += 1) {
        for (let x = 0; x < png.width; x += 1) {
          if (png.data[(y * png.width + x) * 4 + 3] > 8) bottomVisible = true;
        }
      }
      expect(bottomVisible).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("builds a review-only atlas without changing production sources", () => {
    const parent = path.join(process.cwd(), "test-results");
    mkdirSync(parent, { recursive: true });
    const directory = mkdtempSync(path.join(parent, "pixellab-preview-unit-"));
    try {
      const result = buildPreviewAtlas({
        candidate: path.resolve("artifacts/pixellab-pilot/high-res-cart-rental-192x160.png"),
        frame: "parkland_cart_rental_t1",
        output: directory,
      });
      expect(result.frame).toBe("parkland_cart_rental_t1");
      expect(result.frameCount).toBeGreaterThan(20);
      expect(existsSync(path.join(directory, "buildings-decor.png"))).toBe(true);
      expect(existsSync(path.join(directory, "_building-source"))).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
