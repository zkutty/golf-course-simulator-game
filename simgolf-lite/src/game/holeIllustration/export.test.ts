import { DOMParser } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import type { Course, Hole } from "../models/types";
import { buildHoleIllustrationPreview, defaultHoleIllustrationPreviewSettings } from "./preview";
import { buildHoleIllustrationExport, holeIllustrationSvgWithinLimit } from "./export";

function estate(layoutSize: 9 | 18 = 9): Course {
  const width = 64, height = 64;
  const tiles: Course["tiles"] = new Array(width * height).fill("rough");
  const holes: Hole[] = Array.from({ length: 18 }, (_, index) => {
    const row = Math.floor(index / 3), column = index % 3;
    const tee = { x: 3 + column * 20, y: 3 + row * 10 };
    const green = { x: tee.x + 12, y: tee.y + 4 };
    tiles[tee.y * width + tee.x] = "tee";
    tiles[green.y * width + green.x] = "green";
    return {
      id: `hole-${index + 1}`,
      name: index === 0 ? `Long & <unsafe> ${"title ".repeat(20)}` : `Hole ${index + 1}`,
      tee, green,
      teeBoxes: { forward: tee, member: tee, championship: tee },
      pinPositions: { A: green, B: green, C: green },
      parMode: "MANUAL",
      parManual: 3,
    };
  });
  const first = holes.slice(0, layoutSize).map((hole) => hole.id!);
  const second = holes.slice(9, 18).map((hole) => hole.id!);
  return {
    width, height, tiles, elevations: new Array(width * height).fill(0), holes,
    layouts: [
      { id: "north", name: `North & <Championship> ${"Course ".repeat(20)}`, draftHoleIds: first, publishedHoleIds: first, roundLength: layoutSize, state: "open", greenFee: 80 },
      ...(layoutSize === 9 ? [{ id: "south", name: "South Nine", draftHoleIds: second, publishedHoleIds: second, roundLength: 9 as const, state: "open" as const, greenFee: 60 }] : []),
    ],
    activeCourseId: "north", obstacles: [], buildings: [], decorations: [], yardsPerTile: 10,
    name: "Private founder must not appear", baseGreenFee: 80, condition: 1,
  };
}

function setup(course: Course) {
  const settings = defaultHoleIllustrationPreviewSettings(course)!;
  const evidence = { status: "ready" as const, layoutId: settings.layoutId, holeId: settings.holeId, teeSet: settings.teeSet, pinRotation: settings.pinRotation };
  return { settings, evidence };
}

function expectAccessibleStandaloneSvg(svg: string): { titleId: string; descriptionId: string; title: string; description: string } {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = document.documentElement;
  const labelledBy = (root.getAttribute("aria-labelledby") ?? "").trim().split(/\s+/).filter(Boolean);
  expect(root.getAttribute("role")).toBe("img");
  expect(labelledBy).toHaveLength(2);
  expect(labelledBy[0]).not.toBe(labelledBy[1]);
  const title = document.getElementById(labelledBy[0]);
  const description = document.getElementById(labelledBy[1]);
  expect(title?.tagName).toBe("title");
  expect(description?.tagName).toBe("desc");
  expect(title?.textContent?.trim()).toMatch(/\S/);
  expect(description?.textContent?.trim()).toMatch(/\S/);
  const ids: string[] = [];
  const elements = document.getElementsByTagName("*");
  for (let index = 0; index < elements.length; index++) {
    const id = elements.item(index)?.getAttribute("id");
    if (id) ids.push(id);
  }
  expect(new Set(ids).size).toBe(ids.length);
  return { titleId: labelledBy[0], descriptionId: labelledBy[1], title: title!.textContent!.trim(), description: description!.textContent!.trim() };
}

describe("ZK-770 hole illustration export preparation", () => {
  it("preserves the exact final preview presentation in a truthful high-resolution SVG", () => {
    const course = estate(), before = JSON.stringify(course), { settings, evidence } = setup(course);
    const preview = buildHoleIllustrationPreview(course, settings, evidence);
    const result = buildHoleIllustrationExport(course, settings, evidence, { kind: "single" });
    const repeated = buildHoleIllustrationExport(course, settings, evidence, { kind: "single" });
    expect(result.complete).toBe(true);
    if (!result.complete || !preview.complete) return;
    expect(repeated).toEqual(result);
    const previewInner = preview.svg!.slice(preview.svg!.indexOf(">") + 1, preview.svg!.lastIndexOf("</svg>"));
    expect(result).toMatchObject({ width: 3840, height: 2560, viewBox: "0 0 960 640" });
    expect(result.svg).toContain('width="3840" height="2560" viewBox="0 0 960 640"');
    expect(result.svg).toContain(previewInner);
    expect(result.metadata).toMatchObject({ schema: "coursecraft-hole-illustration", version: 1, kind: "single", tee: "member", pin: "A", frame: "north-up", biome: "parkland", season: "summer", contrast: "standard", publishedHoleCount: 9 });
    expect(Object.keys(result.metadata).sort()).toEqual(["biome", "contrast", "courseName", "frame", "height", "holeId", "holeName", "kind", "layoutId", "layoutName", "pin", "planHashes", "publishedHoleCount", "schema", "season", "snapshotHashes", "tee", "version", "width"]);
    const accessible = expectAccessibleStandaloneSvg(result.svg);
    expect(accessible.title).toContain("Long & <unsafe>");
    expect(accessible.description).toBe("member tee, Pin A, north-up, parkland, summer, standard.");
    expect(result.svg).toContain("Long &amp; &lt;unsafe&gt;");
    expect(result.svg).not.toContain("<unsafe>");
    expect(new DOMParser().parseFromString(result.svg, "image/svg+xml").getElementsByTagName("parsererror")).toHaveLength(0);
    expect(JSON.stringify(course)).toBe(before);
  });

  it.each([9, 18] as const)("assembles an exact ordered %i-hole published atlas", (size) => {
    const course = estate(size), before = JSON.stringify(course), { settings, evidence } = setup(course);
    const first = buildHoleIllustrationExport(course, settings, evidence, { kind: "atlas", includeMap: true });
    const second = buildHoleIllustrationExport(course, settings, evidence, { kind: "atlas", includeMap: true });
    expect(first).toEqual(second);
    expect(first.complete, first.complete ? "" : JSON.stringify(first)).toBe(true);
    if (!first.complete) return;
    expect((first.svg.match(/data-atlas-index=/g) ?? [])).toHaveLength(size);
    expect([...first.svg.matchAll(/data-hole-id="([^"]+)"/g)].map((match) => match[1])).toEqual(Array.from({ length: size }, (_, index) => `hole-${index + 1}`));
    if (size === 9) expect(first.svg).not.toContain('data-hole-id="hole-18"');
    expect(first.svg).toContain('data-course-map="true"');
    expect(first.svg).toContain('data-cover-title-band="true"');
    expect(first.svg).toContain("published atlas · member tee · Pin A · north-up");
    const displayedTitle = /<text x="48" y="96"[^>]*>([^<]*(?:&[^;]+;[^<]*)*)<\/text>/.exec(first.svg)?.[1] ?? "";
    expect(displayedTitle).toContain("…");
    expect(displayedTitle.length).toBeLessThan(80);
    expect(first.metadata.snapshotHashes).toHaveLength(size);
    expect(first.metadata.planHashes).toHaveLength(size);
    expect(first.width * first.height).toBeLessThanOrEqual(16_777_216);
    expect(new DOMParser().parseFromString(first.svg, "image/svg+xml").getElementsByTagName("parsererror")).toHaveLength(0);
    const accessible = expectAccessibleStandaloneSvg(first.svg);
    expect(accessible.title).toContain(`${size}-hole published atlas`);
    expect(accessible.description).toBe("member tee, Pin A, north-up, parkland, summer, standard.");
    expect(JSON.stringify(course)).toBe(before);
  });

  it("isolates layouts and toggles only the selected course routing map", () => {
    const course = estate(), { settings, evidence } = setup(course);
    const north = buildHoleIllustrationExport(course, settings, evidence, { kind: "atlas", includeMap: false });
    expect(north.complete).toBe(true);
    if (!north.complete) return;
    expect(north.svg).not.toContain('data-course-map="true"');
    expect(north.svg).not.toContain("south");
    expect([...north.svg.matchAll(/data-hole-id="([^"]+)"/g)].every((match) => Number(match[1].split("-")[1]) <= 9)).toBe(true);
    const southSettings = { ...settings, layoutId: "south", holeId: "hole-10" };
    const south = buildHoleIllustrationExport(course, southSettings, { ...evidence, layoutId: "south", holeId: "hole-10" }, { kind: "atlas", includeMap: true });
    expect(south.complete).toBe(true);
    if (!south.complete) return;
    expect([...south.svg.matchAll(/data-hole-id="([^"]+)"/g)].map((match) => match[1])).toEqual(Array.from({ length: 9 }, (_, index) => `hole-${index + 10}`));
    expect(south.svg).not.toContain('data-hole-id="hole-1"');
    expect(south.svg).toContain('data-course-map="true"');
  });

  it("uses one alternate tee and pin identity across every atlas panel", () => {
    const course = estate(), { settings } = setup(course);
    const alternate = { ...settings, teeSet: "championship" as const, pinRotation: "C" as const };
    const result = buildHoleIllustrationExport(course, alternate, { status: "ready", layoutId: alternate.layoutId, holeId: alternate.holeId, teeSet: "championship", pinRotation: "C" }, { kind: "atlas" });
    expect(result.complete).toBe(true);
    if (!result.complete) return;
    expect(result.metadata).toMatchObject({ tee: "championship", pin: "C" });
    expect(result.svg.match(/data-semantic="tee:championship"/g)).toHaveLength(9);
    expect(result.svg.match(/data-semantic="pin:C"/g)).toHaveLength(9);
  });

  it("rejects duplicate, missing, invalid-length, and incomplete routes without partial output", () => {
    const base = estate(), { settings, evidence } = setup(base);
    const duplicate = structuredClone(base); duplicate.layouts![0].publishedHoleIds[1] = duplicate.layouts![0].publishedHoleIds[0];
    expect(buildHoleIllustrationExport(duplicate, settings, evidence, { kind: "atlas" })).toMatchObject({ complete: false, code: "INVALID_ROUTE", failures: [{ index: 2, holeId: "hole-1" }] });
    const ambiguous = structuredClone(base); ambiguous.holes.push(structuredClone(ambiguous.holes[0]));
    expect(buildHoleIllustrationExport(ambiguous, settings, evidence, { kind: "atlas" })).toMatchObject({ complete: false, code: "INVALID_ROUTE", failures: [{ index: 1, holeId: "hole-1" }] });
    const missing = structuredClone(base); missing.layouts![0].publishedHoleIds[1] = "missing-hole";
    expect(buildHoleIllustrationExport(missing, settings, evidence, { kind: "atlas" })).toMatchObject({ complete: false, code: "INVALID_ROUTE", failures: [{ index: 2, holeId: "missing-hole" }] });
    const short = structuredClone(base); short.layouts![0].publishedHoleIds = short.layouts![0].publishedHoleIds.slice(0, 8);
    expect(buildHoleIllustrationExport(short, settings, evidence, { kind: "atlas" })).toMatchObject({ complete: false, code: "INVALID_ROUTE" });
    const incomplete = structuredClone(base); incomplete.holes[2].pinPositions!.A = null; incomplete.holes[2].green = null;
    const result = buildHoleIllustrationExport(incomplete, settings, evidence, { kind: "atlas" });
    expect(result).toMatchObject({ complete: false, code: "INCOMPLETE_HOLE" });
    if (!result.complete) expect(result.failures).toContainEqual(expect.objectContaining({ index: 3, holeId: "hole-3" }));
    const missingTee = structuredClone(base); missingTee.holes[2].teeBoxes!.member = null; missingTee.holes[2].tee = null;
    const teeResult = buildHoleIllustrationExport(missingTee, settings, evidence, { kind: "atlas" });
    expect(teeResult).toMatchObject({ complete: false, code: "INCOMPLETE_HOLE" });
    if (!teeResult.complete) expect(teeResult.failures).toContainEqual(expect.objectContaining({ index: 3, holeId: "hole-3" }));
  });

  it("checks UTF-8 SVG byte ceilings without allocating export buffers", () => {
    expect(holeIllustrationSvgWithinLimit("abc", 3)).toBe(true);
    expect(holeIllustrationSvgWithinLimit("é", 1)).toBe(false);
    expect(holeIllustrationSvgWithinLimit("abc", -1)).toBe(false);
  });
});
