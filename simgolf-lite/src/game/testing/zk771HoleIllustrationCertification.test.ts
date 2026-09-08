import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { buildHoleIllustrationExport, HOLE_ILLUSTRATION_EXPORT_LIMITS } from "../holeIllustration/export";
import { injectCourseCraftPngMetadata } from "../holeIllustration/exportRuntime";
import { BIOME_KEYS } from "../models/biomes";
import { SEASONS } from "../seasons/types";
import { zk771CertificationEstate, zk771Evidence, zk771Settings } from "./zk771HoleIllustrationFixtures";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function digestBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(45);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82], 0);
  bytes.set([(width >>> 24) & 255, (width >>> 16) & 255, (width >>> 8) & 255, width & 255], 16);
  bytes.set([(height >>> 24) & 255, (height >>> 16) & 255, (height >>> 8) & 255, height & 255, 8, 6, 0, 0, 0], 20);
  bytes.set([0, 0, 0, 0, 73, 69, 78, 68, 0, 0, 0, 0], 33);
  return bytes;
}

function encodedPng(width: number, height: number): Uint8Array {
  const image = new PNG({ width, height, colorType: 6 });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = 42; image.data[offset + 1] = 94; image.data[offset + 2] = 65; image.data[offset + 3] = 255;
  }
  return PNG.sync.write(image, { colorType: 6 });
}

function readPng(bytes: Uint8Array): { width: number; height: number } {
  const decoded = PNG.sync.read(Buffer.from(bytes));
  return { width: decoded.width, height: decoded.height };
}

function requireComplete<T extends { readonly complete: boolean }>(value: T): asserts value is T & { readonly complete: true; readonly svg: string; readonly metadata: { readonly tee: string; readonly pin: string; readonly width: number; readonly height: number } } {
  expect(value.complete, value.complete ? "" : JSON.stringify(value)).toBe(true);
}

describe("ZK-771 hole-illustration machine certification", () => {
  it("certifies deterministic complete/fail-closed export boundaries without claiming human visual approval", () => {
    const outputHashes: string[] = [];
    const checks = [
      "fixture-semantics", "presentation-matrix", "ordered-atlas", "tee-pin-invariance",
      "png-encode-decode", "atomic-failures", "save-immutability",
    ];
    const matrix: Array<{ biome: string; season: string; frame: string; contrast: string; svgHash: string }> = [];
    const matrixArtifacts: Array<{ file: string; label: string }> = [];
    const scenarios: Array<{ holeId: string; kind: string; svgHash: string; semanticCount: number }> = [];
    const atlases: Array<{ holes: number; width: number; height: number; svgHash: string; pngHash: string }> = [];
    for (const size of [9, 18] as const) {
      const course = zk771CertificationEstate(size);
      const before = JSON.stringify(course);
      const settings = zk771Settings(course);
      const request = { kind: "atlas" as const, includeMap: true };
      const first = buildHoleIllustrationExport(course, settings, zk771Evidence(settings), request);
      const second = buildHoleIllustrationExport(course, settings, zk771Evidence(settings), request);
      requireComplete(first); requireComplete(second);
      expect(first.svg).toBe(second.svg);
      expect(first.metadata).toEqual(second.metadata);
      expect(first.width * first.height).toBeLessThanOrEqual(HOLE_ILLUSTRATION_EXPORT_LIMITS.maxRasterPixels);
      expect((first.svg.match(/data-atlas-index=/g) ?? [])).toHaveLength(size);
      expect((first.svg.match(/data-hole-id=/g) ?? [])).toHaveLength(size);
      expect(first.svg).toContain('data-course-map="true"');
      expect(first.svg).toContain('data-cover-title-band="true"');
      expect(first.svg).toContain('data-legend="true"');
      const encoded = encodedPng(first.width, first.height);
      const metadataPng = injectCourseCraftPngMetadata(encoded, first.metadata);
      expect(readPng(metadataPng)).toEqual({ width: first.width, height: first.height });
      expect(new TextDecoder().decode(metadataPng)).toContain("tEXtCourseCraft\0");
      atlases.push({ holes: size, width: first.width, height: first.height, svgHash: digest(first.svg), pngHash: digestBytes(metadataPng) });
      const withoutMap = buildHoleIllustrationExport(course, settings, zk771Evidence(settings), { kind: "atlas", includeMap: false });
      requireComplete(withoutMap);
      expect(withoutMap.svg).not.toContain('data-course-map="true"');
      expect(withoutMap.svg).not.toBe(first.svg);
      const artifactDir = process.env.ZK771_CERT_ARTIFACT_DIR;
      if (artifactDir) {
        mkdirSync(artifactDir, { recursive: true });
        writeFileSync(join(artifactDir, `atlas-${size}-map.svg`), first.svg);
        writeFileSync(join(artifactDir, `atlas-${size}-no-map.svg`), withoutMap.svg);
        writeFileSync(join(artifactDir, `atlas-${size}.png`), metadataPng);
      }
      outputHashes.push(digest(first.svg));
      expect(JSON.stringify(course)).toBe(before);
    }

    const course = zk771CertificationEstate(9);
    const disjoint = zk771CertificationEstate(18, "disjoint");
    expect(disjoint.layouts).toHaveLength(2);
    expect(new Set(disjoint.layouts!.flatMap((layout) => layout.publishedHoleIds)).size).toBe(18);
    expect(disjoint.layouts!.every((layout) => layout.publishedHoleIds.length === 9)).toBe(true);
    for (const [index, kind] of ["straight", "dogleg", "split", "water-carry", "elevation", "wooded", "overlap", "alternate-tee-pin", "long-title"].entries()) {
      const settings = { ...zk771Settings(course), holeId: course.holes[index].id! };
      const single = buildHoleIllustrationExport(course, settings, zk771Evidence(settings), { kind: "single" });
      requireComplete(single);
      const semanticCount = (single.svg.match(/data-semantic=/g) ?? []).length;
      expect(semanticCount).toBeGreaterThan(4);
      expect(single.svg).toContain(`data-semantic="tee:${settings.teeSet}"`);
      expect(single.svg).toContain(`data-semantic="pin:${settings.pinRotation}"`);
      if (kind === "water-carry") expect(single.svg).toContain('data-semantic="terrain:water"');
      if (kind === "elevation") expect(single.svg).toContain('data-layer="elevation-contours"');
      if (kind === "wooded") expect(single.svg).toContain('data-semantic="terrain:deep_rough"');
      if (kind === "wooded") expect(single.svg).toContain('data-semantic="obstacle:tree"');
      scenarios.push({ holeId: settings.holeId, kind, svgHash: digest(single.svg), semanticCount });
    }
    for (const biome of BIOME_KEYS) for (const season of SEASONS) for (const frame of ["north-up", "tee-to-green"] as const) for (const contrast of ["standard", "high-contrast"] as const) {
      const settings = { ...zk771Settings(course), biome, season, frame, contrast };
      const single = buildHoleIllustrationExport(course, settings, zk771Evidence(settings), { kind: "single" });
      requireComplete(single);
      expect(single.svg).toContain(`data-semantic="tee:${settings.teeSet}"`);
      expect(single.svg).toContain(`data-semantic="pin:${settings.pinRotation}"`);
      matrix.push({ biome, season, frame, contrast, svgHash: digest(single.svg) });
      const artifactDir = process.env.ZK771_CERT_ARTIFACT_DIR;
      if (artifactDir) {
        mkdirSync(artifactDir, { recursive: true });
        const file = `matrix-${biome}-${season}-${frame}-${contrast}.svg`;
        writeFileSync(join(artifactDir, file), single.svg);
        matrixArtifacts.push({ file, label: `${biome} ${season} ${frame} ${contrast}` });
      }
    }
    expect(matrix).toHaveLength(48);
    expect(new Set(matrix.map((row) => row.svgHash)).size).toBeGreaterThan(8);
    for (const [teeSet, pinRotation] of [["forward", "B"], ["member", "A"], ["championship", "C"]] as const) {
      const settings = zk771Settings(course, teeSet, pinRotation);
      const single = buildHoleIllustrationExport(course, settings, zk771Evidence(settings), { kind: "single" });
      const atlas = buildHoleIllustrationExport(course, settings, zk771Evidence(settings), { kind: "atlas" });
      requireComplete(single); requireComplete(atlas);
      expect(single.svg).toContain('width="3840" height="2560" viewBox="0 0 960 640"');
      expect(atlas.metadata).toMatchObject({ tee: teeSet, pin: pinRotation });
      expect(atlas.svg.match(new RegExp(`data-semantic="tee:${teeSet}"`, "g"))).toHaveLength(9);
      expect(atlas.svg.match(new RegExp(`data-semantic="pin:${pinRotation}"`, "g"))).toHaveLength(9);
      const bytes = injectCourseCraftPngMetadata(png(single.width, single.height), single.metadata);
      expect(new TextDecoder().decode(bytes)).toContain("tEXtCourseCraft\0");
      outputHashes.push(digest(single.svg));
    }

    const duplicate = structuredClone(course); duplicate.layouts![0].publishedHoleIds[1] = duplicate.layouts![0].publishedHoleIds[0];
    const missing = structuredClone(course); missing.layouts![0].publishedHoleIds[1] = "missing-certified-hole";
    const wrongLength = structuredClone(course); wrongLength.layouts![0].publishedHoleIds = wrongLength.layouts![0].publishedHoleIds.slice(0, 8);
    const incomplete = structuredClone(course); incomplete.holes[2].pinPositions!.A = null; incomplete.holes[2].green = null;
    for (const invalid of [duplicate, missing, wrongLength, incomplete]) {
      const settings = zk771Settings(invalid);
      const result = buildHoleIllustrationExport(invalid, settings, zk771Evidence(settings), { kind: "atlas" });
      expect(result.complete).toBe(false);
      if (!result.complete) expect(Object.hasOwn(result, "svg")).toBe(false);
    }

    expect(outputHashes).toHaveLength(5);
    const resultPath = process.env.ZK771_CERT_RESULT_PATH;
    const artifactDir = process.env.ZK771_CERT_ARTIFACT_DIR;
    if (artifactDir) {
      const cells = matrixArtifacts.map(({ file, label }, index) => `<g transform="translate(${(index % 4) * 250} ${Math.floor(index / 4) * 190})"><text x="4" y="14" font-size="11">${label}</text><image href="${file}" x="0" y="20" width="240" height="160"/></g>`).join("");
      writeFileSync(join(artifactDir, "contact-sheet.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="2280" viewBox="0 0 1000 2280"><rect width="100%" height="100%" fill="#f4ead3"/><text x="12" y="26" font-size="20">ZK-771 human review contact sheet — machine output only; human sign-off required</text>${cells}</svg>`);
      writeFileSync(join(artifactDir, "visual-manifest.json"), `${JSON.stringify({ schemaVersion: 1, purpose: "human-reviewable final SVG contact sheet and retained atlas artifacts", machineClaim: false, matrix: matrixArtifacts, atlases: [9, 18].flatMap((size) => [`atlas-${size}-map.svg`, `atlas-${size}-no-map.svg`, `atlas-${size}.png`]), contactSheet: "contact-sheet.svg" })}\n`);
    }
    if (resultPath) writeFileSync(resultPath, `${JSON.stringify({ certificationId: "zk771-hole-illustration-machine-certification-v1", passed: true, checks, matrix, scenarios, atlases, outputHashes })}\n`);
  });
});
