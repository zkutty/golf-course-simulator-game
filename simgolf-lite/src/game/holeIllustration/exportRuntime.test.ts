import { describe, expect, it, vi } from "vitest";
import { browserPlatform } from "../../platform/browserPlatform";
import type { PlatformServices } from "../../platform/types";
import { HOLE_ILLUSTRATION_EXPORT_LIMITS, type HoleIllustrationExportArtifact } from "./export";
import { deliverHoleIllustrationPng, deliverHoleIllustrationSvg, injectCourseCraftPngMetadata, rasterizeHoleIllustrationPng } from "./exportRuntime";

function png(width = 3840, height = 2560): Uint8Array {
  const bytes = new Uint8Array(45);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82], 0);
  bytes.set([(width >>> 24) & 255, (width >>> 16) & 255, (width >>> 8) & 255, width & 255], 16);
  bytes.set([(height >>> 24) & 255, (height >>> 16) & 255, (height >>> 8) & 255, height & 255], 20);
  bytes.set([8, 6, 0, 0, 0], 24);
  bytes.set([0, 0, 0, 0], 29);
  bytes.set([0, 0, 0, 0, 73, 69, 78, 68, 0, 0, 0, 0], 33);
  return bytes;
}

function testReadUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function testCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function artifact(over: Partial<HoleIllustrationExportArtifact> = {}): HoleIllustrationExportArtifact {
  return {
    complete: true, kind: "single", width: 3840, height: 2560, viewBox: "0 0 960 640", fileStem: "north-hole-1-member-a", svg: '<svg xmlns="http://www.w3.org/2000/svg" width="3840" height="2560" viewBox="0 0 960 640"></svg>',
    metadata: { schema: "coursecraft-hole-illustration", version: 1, kind: "single", width: 3840, height: 2560, courseName: "Course", layoutId: "north", layoutName: "North", holeId: "hole-1", holeName: "One", tee: "member", pin: "A", frame: "north-up", biome: "parkland", season: "summer", contrast: "standard", snapshotHashes: ["a".repeat(64)], planHashes: ["b".repeat(8)], publishedHoleCount: 9 },
    ...over,
  };
}

function platform(over: Partial<PlatformServices> = {}): PlatformServices {
  return { ...browserPlatform, ...over };
}

describe("ZK-770 hole illustration export runtime", () => {
  it("inserts inspectable deterministic CourseCraft PNG metadata after truthful IHDR", () => {
    const first = injectCourseCraftPngMetadata(png(), artifact().metadata);
    expect(injectCourseCraftPngMetadata(png(), artifact().metadata)).toEqual(first);
    expect(new TextDecoder().decode(first)).toContain("tEXtCourseCraft\0");
    expect(new TextDecoder().decode(first)).toContain('"width":3840');
    expect([...first.slice(16, 24)]).toEqual([0, 0, 15, 0, 0, 0, 10, 0]);
    let offset = 8, textChunk: { typeAndData: Uint8Array; crc: number } | undefined;
    while (offset + 12 <= first.length) {
      const length = testReadUint32(first, offset);
      const type = new TextDecoder().decode(first.slice(offset + 4, offset + 8));
      const crcOffset = offset + 8 + length;
      if (type === "tEXt") textChunk = { typeAndData: first.slice(offset + 4, crcOffset), crc: testReadUint32(first, crcOffset) };
      offset = crcOffset + 4;
    }
    expect(textChunk).toBeDefined();
    expect(textChunk!.crc).toBe(testCrc32(textChunk!.typeAndData));
    expect(() => injectCourseCraftPngMetadata(new Uint8Array(40), artifact().metadata)).toThrow("signature");
    const oversized = new Uint8Array(HOLE_ILLUSTRATION_EXPORT_LIMITS.maxPngBytes);
    oversized.set(png());
    expect(() => injectCourseCraftPngMetadata(oversized, artifact().metadata)).toThrow("24 MiB");
  });

  it("rasterizes the exact final SVG, injects metadata, and always revokes its URL", async () => {
    const revoke = vi.fn();
    const load = vi.fn(async () => ({}) as CanvasImageSource);
    const encode = vi.fn(async () => new Blob([Uint8Array.from(png()).buffer], { type: "image/png" }));
    let sourceBlob: Blob | undefined;
    const expected = artifact();
    const result = await rasterizeHoleIllustrationPng(expected, { createObjectURL: (blob) => { sourceBlob = blob; return "blob:exact-svg"; }, revokeObjectURL: revoke, loadImage: load, encodeCanvas: encode });
    expect(result.type).toBe("image/png");
    expect(sourceBlob?.type).toBe("image/svg+xml");
    await expect(sourceBlob!.text()).resolves.toBe(expected.svg);
    expect(load).toHaveBeenCalledWith("blob:exact-svg");
    expect(encode).toHaveBeenCalledWith(expect.anything(), 3840, 2560);
    expect(revoke).toHaveBeenCalledWith("blob:exact-svg");
    await expect(rasterizeHoleIllustrationPng(artifact(), { createObjectURL: () => "blob:failed", revokeObjectURL: revoke, loadImage: async () => { throw new Error("decode failed"); }, encodeCanvas: encode })).rejects.toThrow("decode failed");
    expect(revoke).toHaveBeenCalledWith("blob:failed");
    await expect(rasterizeHoleIllustrationPng(artifact(), { createObjectURL: () => "blob:wrong-size", revokeObjectURL: revoke, loadImage: load, encodeCanvas: async () => new Blob([Uint8Array.from(png(960, 640)).buffer], { type: "image/png" }) })).rejects.toThrow("dimensions");
  });

  it("routes SVG with the correct MIME and reports save, cancellation, and failure", async () => {
    const chooseExport = vi.fn(async () => true);
    const saved = await deliverHoleIllustrationSvg(artifact(), platform({ files: { ...browserPlatform.files, chooseExport } }));
    expect(saved.status).toBe("saved");
    expect(chooseExport).toHaveBeenCalledWith("north-hole-1-member-a.svg", artifact().svg, "image/svg+xml");
    chooseExport.mockResolvedValueOnce(false);
    expect(await deliverHoleIllustrationSvg(artifact(), platform({ files: { ...browserPlatform.files, chooseExport } }))).toMatchObject({ status: "cancelled" });
    chooseExport.mockRejectedValueOnce(new Error("dialog failed"));
    expect(await deliverHoleIllustrationSvg(artifact(), platform({ files: { ...browserPlatform.files, chooseExport } }))).toMatchObject({ status: "failed", message: "dialog failed" });
  });

  it("routes PNG through screenshot save or share fallbacks and rejects pixel/runtime failures", async () => {
    const adapters = { createObjectURL: () => "blob:png", revokeObjectURL: vi.fn(), loadImage: async () => ({}) as CanvasImageSource, encodeCanvas: async () => new Blob([Uint8Array.from(png()).buffer], { type: "image/png" }) };
    const save = vi.fn(async () => "/Pictures/export.png");
    const saved = await deliverHoleIllustrationPng(artifact(), { platform: platform({ screenshots: { save } }), adapters, toDataUrl: async () => "data:image/png;base64,valid" });
    expect(saved).toMatchObject({ status: "saved", location: "/Pictures/export.png" });
    expect(save).toHaveBeenCalledWith("data:image/png;base64,valid", "north-hole-1-member-a.png");
    const shareFile = vi.fn(async () => "copied" as const);
    expect(await deliverHoleIllustrationPng(artifact(), { share: true, adapters, shareFile })).toMatchObject({ status: "copied" });
    expect(save).toHaveBeenCalledTimes(1);
    expect(await deliverHoleIllustrationPng(artifact({ width: 5000, height: 5000 }), { adapters })).toMatchObject({ status: "failed", message: expect.stringContaining("pixel limit") });
    expect(await deliverHoleIllustrationPng(artifact(), { adapters: { ...adapters, loadImage: async () => { throw new Error("image failed"); } } })).toMatchObject({ status: "failed", message: "image failed" });
  });
});
