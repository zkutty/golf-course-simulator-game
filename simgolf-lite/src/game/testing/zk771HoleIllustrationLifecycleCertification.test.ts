import { DOMParser } from "@xmldom/xmldom";
import { describe, expect, it, vi } from "vitest";
import { canonicalJson, hashCanonicalValue } from "../../utils/canonical";
import {
  CURRENT_SAVE_SCHEMA_VERSION,
  parseSaveText,
  payloadForPersistence,
} from "../../utils/save";
import {
  buildHoleIllustrationExport,
  HOLE_ILLUSTRATION_EXPORT_LIMITS,
  holeIllustrationSvgWithinLimit,
  type HoleIllustrationExportArtifact,
  type HoleIllustrationExportResult,
} from "../holeIllustration/export";
import {
  buildHoleIllustrationPreview,
  type HoleIllustrationEvidenceScope,
  type HoleIllustrationPreviewSettings,
} from "../holeIllustration/preview";
import {
  createHoleIllustrationRenderPlan,
  HOLE_ILLUSTRATION_RENDER_LIMITS,
} from "../holeIllustration/renderPlan";
import {
  deliverHoleIllustrationPng,
  type HoleIllustrationRasterAdapters,
} from "../holeIllustration/exportRuntime";
import {
  HOLE_ILLUSTRATION_OUTPUT_LIMITS,
  preflightHoleIllustrationRender,
} from "../holeIllustration/renderer";
import { createHoleIllustrationSnapshot } from "../holeIllustration/snapshot";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import type { Course, Hole, Point } from "../models/types";
import { browserPlatform } from "../../platform/browserPlatform";

const METADATA_KEYS = [
  "biome",
  "contrast",
  "courseName",
  "frame",
  "height",
  "holeId",
  "holeName",
  "kind",
  "layoutId",
  "layoutName",
  "pin",
  "planHashes",
  "publishedHoleCount",
  "schema",
  "season",
  "snapshotHashes",
  "tee",
  "version",
  "width",
] as const;

function hole(index: number): Hole {
  const column = index % 5;
  const row = Math.floor(index / 5);
  const tee = { x: 6 + column * 20, y: 6 + row * 15 };
  const green = { x: tee.x + 12, y: tee.y + 4 };
  return {
    id: `lifecycle-hole-${index + 1}`,
    name: `Lifecycle hole ${index + 1}`,
    tee,
    green,
    teeBoxes: {
      forward: { x: tee.x + 1, y: tee.y },
      member: tee,
      championship: { x: tee.x - 1, y: tee.y },
    },
    pinPositions: {
      A: green,
      B: { x: green.x - 1, y: green.y },
      C: { x: green.x, y: green.y - 1 },
    },
    waypoints: [{ x: tee.x + 6, y: tee.y + 1 }],
    parMode: "MANUAL",
    parManual: 4,
    templateAttribution: {
      templateId: `lifecycle-template-${index + 1}`,
      sourceLabel: "Local certification fixture",
      licenseName: "CC-BY-4.0",
      attribution: "CourseCraft lifecycle certificate",
    },
  };
}

function estate(holeCount: number = 18): Course {
  const course = structuredClone(DEFAULT_COURSE);
  course.width = 220;
  course.height = 140;
  const holes = Array.from({ length: holeCount }, (_, index) => hole(index));
  const tiles: Course["tiles"] = new Array(course.width * course.height).fill("rough");
  const elevations = new Array(course.width * course.height).fill(0);
  for (const candidate of holes) {
    const tee = candidate.tee!;
    const green = candidate.green!;
    for (const marker of Object.values(candidate.teeBoxes!)) {
      if (marker) tiles[marker.y * course.width + marker.x] = "tee";
    }
    for (const marker of Object.values(candidate.pinPositions!)) {
      if (marker) tiles[marker.y * course.width + marker.x] = "green";
    }
    tiles[(tee.y + 1) * course.width + tee.x + 4] = "fairway";
    tiles[(tee.y + 2) * course.width + tee.x + 8] = "sand";
    elevations[green.y * course.width + green.x] = 4;
  }
  const ids = holes.map((candidate) => candidate.id!);
  return {
    ...course,
    name: "ZK-771 lifecycle estate",
    tiles,
    elevations,
    holes,
    layouts: [{
      id: "lifecycle-routing",
      name: "Lifecycle routing",
      draftHoleIds: [...ids],
      publishedHoleIds: [...ids],
      roundLength: holeCount >= 18 ? 18 : 9,
      state: "open",
      greenFee: 77,
    }],
    activeCourseId: "lifecycle-routing",
    activePinRotation: "A",
    obstacles: [{ x: 12, y: 7, type: "tree" }],
    buildings: [],
    decorations: [],
    greenSurface: undefined,
    greenLocalState: undefined,
    surfaceIntent: undefined,
    surfaceCare: undefined,
    estate: undefined,
    property: undefined,
    m51: undefined,
  };
}

function settings(course: Course): HoleIllustrationPreviewSettings {
  return {
    layoutId: course.layouts![0].id,
    routeSource: "published",
    holeId: course.layouts![0].publishedHoleIds[0],
    teeSet: "member",
    pinRotation: "A",
    frame: "north-up",
    biome: "parkland",
    season: "summer",
    contrast: "standard",
    showContours: true,
    showVegetation: true,
    showHazards: true,
    showShotLine: true,
    showLabels: true,
    showLandingDistances: false,
  };
}

function evidence(value: HoleIllustrationPreviewSettings): HoleIllustrationEvidenceScope {
  return {
    status: "ready",
    layoutId: value.layoutId,
    holeId: value.holeId,
    teeSet: value.teeSet,
    pinRotation: value.pinRotation,
  };
}

function completeArtifact(
  course: Course,
  value: HoleIllustrationPreviewSettings = settings(course),
  kind: "single" | "atlas" = "single",
): HoleIllustrationExportArtifact {
  const result = buildHoleIllustrationExport(course, value, evidence(value), { kind });
  if (!result.complete) throw new Error(`${result.code}: ${result.message}`);
  return result;
}

function assertAtomicFailure(result: HoleIllustrationExportResult, code?: string): void {
  expect(result.complete).toBe(false);
  if (result.complete) return;
  if (code) expect(result.code).toBe(code);
  expect(Object.keys(result).sort()).toEqual(["code", "complete", "failures", "message"]);
  expect(Object.hasOwn(result, "svg")).toBe(false);
  expect(Object.hasOwn(result, "metadata")).toBe(false);
  expect(Object.hasOwn(result, "width")).toBe(false);
}

function minimalPng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(45);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  bytes.set([(width >>> 24) & 255, (width >>> 16) & 255, (width >>> 8) & 255, width & 255], 16);
  bytes.set([(height >>> 24) & 255, (height >>> 16) & 255, (height >>> 8) & 255, height & 255, 8, 6, 0, 0, 0], 20);
  bytes.set([0, 0, 0, 0, 73, 69, 78, 68, 0, 0, 0, 0], 33);
  return bytes;
}

describe("ZK-1133 hole-illustration lifecycle certification", () => {
  it("round-trips canonical saves byte-for-byte without persisting generated image material", () => {
    const course = estate(18);
    const artifact = completeArtifact(course);
    expect(artifact.svg).toContain("<svg");

    const seed = payloadForPersistence({ course, world: structuredClone(DEFAULT_WORLD) });
    const firstLoad = parseSaveText(JSON.stringify({
      schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
      savedAt: 771,
      ...seed,
    }));
    expect(firstLoad.ok, firstLoad.ok ? "" : JSON.stringify(firstLoad.error)).toBe(true);
    if (!firstLoad.ok) return;

    // Parse once to cross the public migration/normalization boundary, then prove
    // the canonical representation is an idempotent byte-for-byte fixed point.
    const first = payloadForPersistence(firstLoad.payload);
    const firstBytes = canonicalJson(first);
    const secondLoad = parseSaveText(JSON.stringify({
      schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
      savedAt: 772,
      ...first,
    }));
    expect(secondLoad.ok, secondLoad.ok ? "" : JSON.stringify(secondLoad.error)).toBe(true);
    if (!secondLoad.ok) return;
    const secondBytes = canonicalJson(payloadForPersistence(secondLoad.payload));
    expect(secondBytes.length).toBe(firstBytes.length);
    expect(secondBytes === firstBytes).toBe(true);

    const before = completeArtifact(course);
    const after = completeArtifact(firstLoad.payload.course);
    expect(after.metadata.snapshotHashes).toEqual(before.metadata.snapshotHashes);
    expect(after.metadata.planHashes).toEqual(before.metadata.planHashes);

    for (const forbidden of [
      "<svg",
      "data:image",
      "image/png",
      "image/svg+xml",
      "coursecraft-export",
      artifact.metadata.snapshotHashes[0],
      artifact.metadata.planHashes[0],
    ]) expect(firstBytes).not.toContain(forbidden);
  });

  it("invalidates the correct snapshot and render-plan hash axes while ignoring an unrelated business value", () => {
    const course = estate(9);
    const baseSettings = settings(course);
    const base = buildHoleIllustrationPreview(course, baseSettings, evidence(baseSettings));
    const repeat = buildHoleIllustrationPreview(course, baseSettings, evidence(baseSettings));
    expect(base.complete).toBe(true);
    expect(repeat).toEqual(base);
    expect(base.metadata).toBeDefined();
    if (!base.metadata) return;
    const baseMetadata = base.metadata;

    const geometry = structuredClone(course);
    const relevant: Point = { x: course.holes[0].tee!.x + 4, y: course.holes[0].tee!.y + 1 };
    geometry.tiles[relevant.y * geometry.width + relevant.x] = "water";
    const geometryPreview = buildHoleIllustrationPreview(geometry, baseSettings, evidence(baseSettings));
    expect(geometryPreview.metadata?.snapshotHash).not.toBe(baseMetadata.snapshotHash);
    expect(geometryPreview.metadata?.planHash).not.toBe(baseMetadata.planHash);

    const stylePlanHashes = [
      { ...baseSettings, frame: "tee-to-green" as const },
      { ...baseSettings, biome: "links" as const },
      { ...baseSettings, season: "winter" as const },
      { ...baseSettings, contrast: "high-contrast" as const },
    ].map((variation) => {
      const preview = buildHoleIllustrationPreview(course, variation, evidence(variation));
      expect(preview.metadata?.snapshotHash).toBe(baseMetadata.snapshotHash);
      expect(preview.metadata?.planHash).not.toBe(baseMetadata.planHash);
      return preview.metadata?.planHash;
    });

    const irrelevant = { ...course, baseGreenFee: course.baseGreenFee + 123 };
    const irrelevantPreview = buildHoleIllustrationPreview(irrelevant, baseSettings, evidence(baseSettings));
    expect(irrelevantPreview.metadata?.snapshotHash).toBe(baseMetadata.snapshotHash);
    expect(irrelevantPreview.metadata?.planHash).toBe(baseMetadata.planHash);

    const observedHashes = {
      baseSnapshotHash: baseMetadata.snapshotHash,
      basePlanHash: baseMetadata.planHash,
      geometrySnapshotHash: geometryPreview.metadata?.snapshotHash,
      geometryPlanHash: geometryPreview.metadata?.planHash,
      stylePlanHashes,
      irrelevantSnapshotHash: irrelevantPreview.metadata?.snapshotHash,
      irrelevantPlanHash: irrelevantPreview.metadata?.planHash,
    };
    expect(observedHashes).toEqual({
      baseSnapshotHash: "53d15aa360d26076605da88a0dc4c8a9abc5fed9bd46948b25d6a25c2b331661",
      basePlanHash: "689de52d",
      geometrySnapshotHash: "861149d129d07841537dbb9c8e3ae69499bd2fe3fe5d74995a436d8d7f9de398",
      geometryPlanHash: "e4793531",
      stylePlanHashes: ["fabff24e", "e466816b", "20c54b9b", "babd3343"],
      irrelevantSnapshotHash: "53d15aa360d26076605da88a0dc4c8a9abc5fed9bd46948b25d6a25c2b331661",
      irrelevantPlanHash: "689de52d",
    });
    expect(hashCanonicalValue(observedHashes)).toBe("4d51df36");
  });

  it("fails 8/17/19-hole, duplicate, missing, incomplete, and oversized exports atomically", async () => {
    for (const count of [8, 17, 19]) {
      const course = estate(count);
      assertAtomicFailure(
        buildHoleIllustrationExport(course, settings(course), evidence(settings(course)), { kind: "atlas" }),
        "INVALID_ROUTE",
      );
    }

    const duplicate = estate(9);
    duplicate.layouts![0].publishedHoleIds[1] = duplicate.layouts![0].publishedHoleIds[0];
    assertAtomicFailure(
      buildHoleIllustrationExport(duplicate, settings(duplicate), evidence(settings(duplicate)), { kind: "atlas" }),
      "INVALID_ROUTE",
    );

    const missing = estate(9);
    missing.layouts![0].publishedHoleIds[1] = "missing-hole";
    assertAtomicFailure(
      buildHoleIllustrationExport(missing, settings(missing), evidence(settings(missing)), { kind: "atlas" }),
      "INVALID_ROUTE",
    );

    const incomplete = estate(9);
    incomplete.holes[4].pinPositions!.A = null;
    incomplete.holes[4].green = null;
    assertAtomicFailure(
      buildHoleIllustrationExport(incomplete, settings(incomplete), evidence(settings(incomplete)), { kind: "atlas" }),
      "INCOMPLETE_HOLE",
    );

    const artifact = completeArtifact(estate(9));
    const createObjectURL = vi.fn(() => "blob:must-not-be-created");
    const save = vi.fn(async () => "/must-not-save.png");
    const result = await deliverHoleIllustrationPng(
      { ...artifact, width: 5_000, height: 5_000 },
      {
        platform: { ...browserPlatform, screenshots: { save } },
        adapters: {
          createObjectURL,
          revokeObjectURL: vi.fn(),
          loadImage: vi.fn(async () => ({}) as CanvasImageSource),
          encodeCanvas: vi.fn(async () => new Blob()),
        },
      },
    );
    expect(result).toMatchObject({ status: "failed", message: expect.stringContaining("pixel limit") });
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();

    const validAdapters: HoleIllustrationRasterAdapters = {
      createObjectURL: () => "blob:bounded",
      revokeObjectURL: vi.fn(),
      loadImage: async () => ({}) as CanvasImageSource,
      encodeCanvas: async (_source, width, height) => new Blob(
        [Uint8Array.from(minimalPng(width, height)).buffer],
        { type: "image/png" },
      ),
    };
    const dataUrlResult = await deliverHoleIllustrationPng(artifact, {
      platform: { ...browserPlatform, screenshots: { save } },
      adapters: validAdapters,
      toDataUrl: async () => "x".repeat(HOLE_ILLUSTRATION_EXPORT_LIMITS.maxDataUrlCharacters + 1),
    });
    expect(dataUrlResult).toMatchObject({ status: "failed", message: expect.stringContaining("bridge limit") });
    expect(save).not.toHaveBeenCalled();
  }, 120_000);

  it("publishes deterministic runtime, memory, pixel, work, and byte ceilings", () => {
    const course = estate(9);
    const value = settings(course);
    const snapshotResult = createHoleIllustrationSnapshot(course, {
      layoutId: value.layoutId,
      routeSource: value.routeSource,
      holeId: value.holeId,
      teeSet: value.teeSet,
      pinRotation: value.pinRotation,
    });
    expect(snapshotResult.complete).toBe(true);
    if (!snapshotResult.complete) return;
    const planResult = createHoleIllustrationRenderPlan(snapshotResult.snapshot, {
      frame: value.frame,
      biome: value.biome,
      season: value.season,
      contrast: value.contrast,
      viewport: { width: 960, height: 640, padding: 0.06 },
    });
    expect(planResult.complete).toBe(true);
    if (!planResult.complete) return;

    expect(planResult.plan.budget).toMatchObject({ runtime: "bounded-n-log-n", memory: "bounded" });
    expect(planResult.plan.budget.primitiveCount).toBeLessThanOrEqual(HOLE_ILLUSTRATION_RENDER_LIMITS.maxPrimitives);
    expect(planResult.plan.budget.pointCount).toBeLessThanOrEqual(HOLE_ILLUSTRATION_RENDER_LIMITS.maxPoints);
    const first = preflightHoleIllustrationRender(planResult.plan, { pixelRatio: 4 });
    const second = preflightHoleIllustrationRender(planResult.plan, { pixelRatio: 4 });
    expect(second).toEqual(first);
    expect(first.complete).toBe(true);
    if (!first.complete) return;
    expect(first.svg).toMatchObject({
      characterLimit: HOLE_ILLUSTRATION_OUTPUT_LIMITS.maxSvgCharacters,
      withinLimit: true,
    });
    expect(first.rgba).toMatchObject({
      width: 3_840,
      height: 2_560,
      pixels: 9_830_400,
      rgbaBytes: 39_321_600,
      coverageBytes: 9_830_400,
      allocationBytes: 49_152_000,
      pixelLimit: HOLE_ILLUSTRATION_OUTPUT_LIMITS.maxRasterPixels,
      allocationByteLimit: HOLE_ILLUSTRATION_OUTPUT_LIMITS.maxRasterBytes,
      pixelVisitLimit: HOLE_ILLUSTRATION_OUTPUT_LIMITS.maxRasterPixelVisits,
      withinLimits: true,
    });

    const artifact = completeArtifact(course);
    const svgBytes = new TextEncoder().encode(artifact.svg).byteLength;
    expect(svgBytes).toBeLessThanOrEqual(HOLE_ILLUSTRATION_EXPORT_LIMITS.maxSvgBytes);
    expect(artifact.width * artifact.height).toBeLessThanOrEqual(HOLE_ILLUSTRATION_EXPORT_LIMITS.maxRasterPixels);
    expect(holeIllustrationSvgWithinLimit(artifact.svg)).toBe(true);
    expect(holeIllustrationSvgWithinLimit("é", 1)).toBe(false);
  });

  it("keeps exact metadata and compact provenance allowlists and performs no network or generative work", () => {
    const course = estate(9);
    const originalAttribution = course.holes[0].templateAttribution!;
    course.holes[0].templateAttribution = {
      ...originalAttribution,
      sourceImage: "data:image/png;base64,forbidden-reference",
      prompt: "forbidden generative prompt",
    } as typeof originalAttribution;

    const fetch = vi.fn(() => { throw new Error("network access is forbidden"); });
    const websocket = vi.fn(() => { throw new Error("websocket access is forbidden"); });
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("WebSocket", websocket);
    try {
      const value = settings(course);
      const snapshotResult = createHoleIllustrationSnapshot(course, {
        layoutId: value.layoutId,
        routeSource: value.routeSource,
        holeId: value.holeId,
        teeSet: value.teeSet,
        pinRotation: value.pinRotation,
      });
      expect(snapshotResult.complete).toBe(true);
      if (!snapshotResult.complete) return;
      expect(snapshotResult.snapshot.provenance).toEqual(originalAttribution);
      expect(Object.keys(snapshotResult.snapshot.provenance!).sort()).toEqual([
        "attribution", "licenseName", "sourceLabel", "templateId",
      ]);

      const artifact = completeArtifact(course, value);
      expect(Object.keys(artifact.metadata).sort()).toEqual([...METADATA_KEYS].sort());
      expect(artifact.metadata.snapshotHashes).toEqual([snapshotResult.snapshot.hash]);
      expect(artifact.svg).not.toContain("forbidden-reference");
      expect(artifact.svg).not.toContain("forbidden generative prompt");
      expect(artifact.svg).not.toMatch(/<(?:script|foreignObject|image)\b/i);
      expect(artifact.svg).not.toMatch(/\b(?:href|src)=["']https?:/i);
      expect(fetch).not.toHaveBeenCalled();
      expect(websocket).not.toHaveBeenCalled();

      const changed = structuredClone(course);
      changed.holes[0].templateAttribution = { ...originalAttribution, attribution: "Changed compact credit" };
      expect(completeArtifact(changed).metadata.snapshotHashes[0]).not.toBe(artifact.metadata.snapshotHashes[0]);
      expect(hashCanonicalValue(artifact.metadata)).toMatch(/^[0-9a-f]{8}$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("exports single and atlas SVGs with resolved accessible image names and descriptions", () => {
    const course = estate(9);
    const artifacts = [
      completeArtifact(course),
      completeArtifact(course, settings(course), "atlas"),
    ];
    const receipts = artifacts.map((artifact) => {
      const document = new DOMParser().parseFromString(artifact.svg, "image/svg+xml");
      expect(document.getElementsByTagName("parsererror")).toHaveLength(0);
      const root = document.documentElement;
      expect(root.tagName).toBe("svg");
      expect(root.getAttribute("role")).toBe("img");
      const labelledBy = (root.getAttribute("aria-labelledby") ?? "").trim().split(/\s+/).filter(Boolean);
      expect(labelledBy).toHaveLength(2);
      expect(new Set(labelledBy).size).toBe(2);
      const title = document.getElementById(labelledBy[0]);
      const description = document.getElementById(labelledBy[1]);
      expect(title?.tagName).toBe("title");
      expect(description?.tagName).toBe("desc");
      expect(title?.textContent?.trim()).toMatch(/\S/);
      expect(description?.textContent?.trim()).toMatch(/\S/);
      return {
        kind: artifact.kind,
        role: root.getAttribute("role"),
        labelledBy,
        title: title?.textContent?.trim(),
        description: description?.textContent?.trim(),
      };
    });
    expect(hashCanonicalValue(receipts)).toBe("67935ebe");
  });
});
