import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import type { Terrain } from "../models/types";
import { buildingTiles } from "../models/buildings";
import { createParklandVisualReferenceCourse } from "../testing/referenceCourse";
import {
  PARKLAND_PAIR_FRINGE_CORNERS,
  PARKLAND_PAIR_FRINGE_DIRECTIONS,
  buildParklandPairFringePlan,
  parklandPairFringeAssetRole,
  parklandPairFringeRotationMapping,
} from "./parklandPairFringes";
import { PARKLAND_PAIR_FRINGE_SOURCE_HASHES } from "./parklandPairFringeHashes";
import {
  PARKLAND_PAIR_ATLAS_COLUMNS,
  PARKLAND_PAIR_ATLAS_ROLES,
} from "../../render/parklandComposableAssets/pairAtlas";

const assetRoot = new URL("../../assets/terrain/parkland-composable-v1/", import.meta.url);
const derivedAssetRoot = new URL("../../assets/terrain/parkland-pair-atlas-v2/", import.meta.url);
const materialFieldRoot = new URL("../../assets/terrain/fields/parkland/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", assetRoot), "utf8")) as {
  files: Record<string, {
    sha256: string;
    role: string;
    pair?: string;
    direction?: string;
    corner?: string;
    clipBounds?: { x: number; y: number; width: number; height: number };
  }>;
};
const derivedManifest = JSON.parse(readFileSync(new URL("manifest.json", derivedAssetRoot), "utf8")) as {
  contract: string;
  sourceManifestSha256: string;
  columns: number;
  roles: string[];
  qualities: Record<"high" | "medium" | "low", {
    parameters: {
      width: number;
      height: number;
      depth: number;
      cornerReach: number;
      overlap: number;
      textureScale: number;
      textureAlphaDrop: number;
      alpha: number[];
    };
    frameSize: [number, number];
    atlasSha256: string;
    determinismVerified: boolean;
    frames: Record<string, {
      guidePath: string;
      guideSha256: string;
      semanticPath: string;
      semanticSha256: string;
      materialInputs: null | {
        owner: { path: string; sha256: string };
        neighbor: { path: string; sha256: string };
      };
      rgbaSha256: string;
      metrics: {
        visiblePixels: number;
        coverage: number;
        alphaLevels: number[];
        distinctVisibleColors: number;
        transparentRgbPixels: number;
        bandPixels: number[];
        zonePixels?: { outer: number; intermix: number; inner: number };
        modulatedPixels: number;
        outsideDiamondPixels: number;
        oppositeSidePixels?: number;
        incidentOverlapPixels?: number;
        continuityPixels?: number;
        densityCrossover?: boolean;
        ownerContributionPixels?: number;
        neighborContributionPixels?: number;
        intermixPixels?: number;
        noFringeRmsDelta?: number;
        withoutOwnerRmsDelta?: number;
        withoutNeighborRmsDelta?: number;
        withoutOwnerRgbaSha256?: string;
        withoutNeighborRgbaSha256?: string;
        finalPixelControls?: {
          enabledVsNoFringeRms: number;
          enabledVsWithoutOwnerRms: number;
          enabledVsWithoutNeighborRms: number;
          noFringeControlRms: number;
          enabledSha256: string;
          noFringeSha256: string;
          withoutOwnerSha256: string;
          withoutNeighborSha256: string;
        };
      };
    }>;
  }>;
};

function alphaMetrics(image: PNG) {
  let visible = 0;
  let center = 0;
  let transparentRgb = 0;
  const radiusX = Math.max(1, Math.floor(image.width * 0.18));
  const radiusY = Math.max(1, Math.floor(image.height * 0.18));
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const offset = (y * image.width + x) * 4;
    const alpha = image.data[offset + 3];
    if (alpha > 0) visible++;
    else if (image.data[offset] !== 0 || image.data[offset + 1] !== 0 || image.data[offset + 2] !== 0) transparentRgb++;
    if (
      Math.abs(x - Math.floor(image.width / 2)) <= radiusX
      && Math.abs(y - Math.floor(image.height / 2)) <= radiusY
      && alpha > 0
    ) center++;
  }
  return { coverage: visible / (image.width * image.height), center, transparentRgb };
}

describe("ZK-459 canonical Parkland pair fringe planner", () => {
  it("reconciles the exact M19 authority including the high/medium density crossover", () => {
    const course = createParklandVisualReferenceCourse();
    const plan = buildParklandPairFringePlan({
      tiles: course.tiles,
      elevations: course.elevations,
      width: course.width,
      height: course.height,
      includeDensityCrossovers: true,
    });
    expect(plan.diagnostics).toMatchObject({
      authoritativeDifferingTurfAdjacencies: 191,
      sameElevationDifferingTurfAdjacencies: 185,
      omittedDifferentElevation: 6,
      omittedSamePresentation: 0,
      omittedBlocked: 0,
      plannedStrips: 185,
      cornerCandidates: 25,
      plannedCorners: 25,
      mixedPairMasks: 0,
      fullCellSprites: 0,
      ownershipOverlaps: 0,
      doubleOwners: 0,
      pairCounts: {
        "fairway--deep_rough": 23,
        "fairway--green": 8,
        "fairway--rough": 21,
        "fairway--tee": 5,
        "rough--green": 15,
        "rough--tee": 15,
        "rough--deep_rough": 98,
      },
      directionCounts: { n: 59, e: 36, s: 57, w: 33 },
    });
    expect(Object.values(plan.diagnostics.pairCounts).reduce((total, count) => total + count, 0)).toBe(185);
    expect(plan.diagnostics.omittedSamePresentation + plan.diagnostics.plannedStrips).toBe(185);
    expect(new Set(plan.edges.map((edge) => edge.ownerKey)).size).toBe(plan.edges.length);
    expect(new Set(plan.corners.map((corner) => corner.ownerKey)).size).toBe(plan.corners.length);
    expect(plan.diagnostics.pairCounts["rough--deep_rough"]).toBe(98);
    expect(plan.edges.some((edge) => edge.pair === "rough--deep_rough")).toBe(true);
  });

  it("preserves the legacy Low plan without density crossover emitters", () => {
    const course = createParklandVisualReferenceCourse();
    const plan = buildParklandPairFringePlan({
      tiles: course.tiles,
      elevations: course.elevations,
      width: course.width,
      height: course.height,
      includeDensityCrossovers: false,
    });
    expect(plan.diagnostics).toMatchObject({
      omittedSamePresentation: 98,
      plannedStrips: 87,
      plannedCorners: 7,
    });
    expect(plan.edges.some((edge) => edge.pair === "rough--deep_rough")).toBe(false);
  });

  it("classifies the M19 clubhouse overlap without stealing same-presentation omissions", () => {
    const course = createParklandVisualReferenceCourse();
    const blockedCells = new Set(course.buildings.flatMap((building) => (
      buildingTiles(building).map(({ x, y }) => y * course.width + x)
    )));
    const plan = buildParklandPairFringePlan({
      tiles: course.tiles,
      elevations: course.elevations,
      width: course.width,
      height: course.height,
      blockedCells,
      includeDensityCrossovers: true,
    });
    expect(plan.diagnostics).toMatchObject({
      authoritativeDifferingTurfAdjacencies: 191,
      omittedDifferentElevation: 6,
      omittedSamePresentation: 0,
      omittedBlocked: 0,
      plannedStrips: 185,
    });
    expect(
      plan.diagnostics.omittedDifferentElevation
      + plan.diagnostics.omittedSamePresentation
      + plan.diagnostics.omittedBlocked
      + plan.diagnostics.plannedStrips,
    ).toBe(plan.diagnostics.authoritativeDifferingTurfAdjacencies);
  });

  it("preserves unordered pair identity without mixing masks or crossing excluded joins", () => {
    const tiles: Terrain[] = [
      "fairway", "rough", "green",
      "tee", "fairway", "deep_rough",
      "rough", "rough", "rough",
    ];
    const plan = buildParklandPairFringePlan({
      tiles,
      elevations: new Array(tiles.length).fill(1),
      width: 3,
      height: 3,
      blockedCells: new Set([2]),
      includeDensityCrossovers: true,
    });
    const edges = new Map(plan.edges.map((edge) => [edge.ownerKey, edge]));
    expect(plan.diagnostics.omittedBlocked).toBeGreaterThan(0);
    expect(plan.diagnostics.omittedSamePresentation).toBe(0);
    for (const edge of plan.edges) {
      expect(parklandPairFringeAssetRole(edge)).toBe(`edge:${edge.pair}:${edge.direction}`);
      expect(edge.ownerCell).not.toBe(2);
      expect(edge.neighborCell).not.toBe(2);
    }
    for (const corner of plan.corners) {
      expect(parklandPairFringeAssetRole(corner)).toBe(`corner:${corner.pair}:${corner.corner}`);
      const compatible = corner.compatibleEdgeOwnerKeys.map((key) => edges.get(key)!);
      expect(compatible).toHaveLength(2);
      expect(compatible.every((edge) => edge.pair === corner.pair)).toBe(true);
      expect(compatible.every((edge) => edge.pair === corner.pair)).toBe(true);
    }
  });

  it("maps every world-owned edge through all camera rotations without changing its asset identity", () => {
    const expected = {
      0: ["n", "e", "s", "w"],
      90: ["e", "s", "w", "n"],
      180: ["s", "w", "n", "e"],
      270: ["w", "n", "e", "s"],
    } as const;
    for (const rotation of [0, 90, 180, 270] as const) {
      const mapping = parklandPairFringeRotationMapping(rotation);
      expect(mapping.map((item) => item.worldDirection)).toEqual(PARKLAND_PAIR_FRINGE_DIRECTIONS);
      expect(mapping.map((item) => item.assetDirection)).toEqual(PARKLAND_PAIR_FRINGE_DIRECTIONS);
      expect(mapping.map((item) => item.screenDirection)).toEqual(expected[rotation]);
    }
  });

  it("guards every quality's consumed source alpha, interior, coverage, and manifest hash", () => {
    const course = createParklandVisualReferenceCourse();
    const plan = buildParklandPairFringePlan({
      tiles: course.tiles,
      elevations: course.elevations,
      width: course.width,
      height: course.height,
      includeDensityCrossovers: true,
    });
    const roles = new Set([
      ...plan.edges.map(parklandPairFringeAssetRole),
      ...plan.corners.map(parklandPairFringeAssetRole),
    ]);
    for (const quality of ["high", "medium", "low"] as const) for (const role of roles) {
      const [kind, pair, position] = role.split(":");
      const relative = kind === "edge"
        ? `${quality}/edge-${pair}-${position}.png`
        : `${quality}/corner-${pair}-${position}.png`;
      const bytes = readFileSync(new URL(relative, assetRoot));
      const metadata = manifest.files[relative];
      expect(createHash("sha256").update(bytes).digest("hex"), relative).toBe(metadata.sha256);
      expect(metadata.role, relative).toBe(kind === "edge" ? "pair-half-edge" : "pair-corner");
      expect(metadata.pair, relative).toBe(pair);
      expect(kind === "edge" ? metadata.direction : metadata.corner, relative).toBe(position);
      expect(metadata.clipBounds, relative).toBeTruthy();
      const alpha = alphaMetrics(PNG.sync.read(bytes));
      expect(alpha.coverage, relative).toBeGreaterThan(0);
      expect(alpha.coverage, relative).toBeLessThanOrEqual(kind === "edge" ? 0.12 : 0.08);
      expect(alpha.center, relative).toBe(0);
      expect(alpha.transparentRgb, relative).toBe(0);
    }
  });

  it("exhaustively matches the compact runtime provenance table to all tracked pair assets", () => {
    let verified = 0;
    for (const quality of ["high", "medium", "low"] as const) {
      const expected = Object.entries(manifest.files).filter(([path, metadata]) => (
        path.startsWith(`${quality}/`)
        && (metadata.role === "pair-half-edge" || metadata.role === "pair-corner")
      ));
      expect(expected, quality).toHaveLength(80);
      const hashes = PARKLAND_PAIR_FRINGE_SOURCE_HASHES[quality];
      expect(Object.keys(hashes), quality).toHaveLength(expected.length);
      for (const [path, metadata] of expected) {
        const role = metadata.role === "pair-half-edge"
          ? `edge:${metadata.pair}:${metadata.direction}` as keyof typeof hashes
          : `corner:${metadata.pair}:${metadata.corner}` as keyof typeof hashes;
        expect(hashes[role], path).toBe(metadata.sha256);
        verified++;
      }
    }
    expect(verified).toBe(240);
  });

  it("packs deterministic derived multi-band frames with exact guide provenance", () => {
    expect(new Set(PARKLAND_PAIR_ATLAS_ROLES).size).toBe(80);
    expect(derivedManifest).toMatchObject({
      contract: "parkland-pair-derived-runtime-v3",
      columns: PARKLAND_PAIR_ATLAS_COLUMNS,
      roles: PARKLAND_PAIR_ATLAS_ROLES,
    });
    expect(derivedManifest.sourceManifestSha256).toBe(
      createHash("sha256").update(readFileSync(new URL("manifest.json", assetRoot))).digest("hex"),
    );
    const frames = {
      high: { size: [256, 128], depth: 16, cornerReach: 12, overlap: 2 },
      medium: { size: [128, 64], depth: 8, cornerReach: 6, overlap: 1 },
      low: { size: [64, 32], depth: 4, cornerReach: 3, overlap: 1 },
    } as const;
    for (const quality of ["high", "medium", "low"] as const) {
      const expected = frames[quality];
      const [width, height] = expected.size;
      const atlasBytes = readFileSync(new URL(`${quality}-pair-atlas.png`, derivedAssetRoot));
      const atlas = PNG.sync.read(atlasBytes);
      const qualityManifest = derivedManifest.qualities[quality];
      expect(qualityManifest.determinismVerified).toBe(true);
      expect(qualityManifest.frameSize).toEqual(expected.size);
      expect(qualityManifest.parameters).toMatchObject({
        width,
        height,
        depth: expected.depth,
        cornerReach: expected.cornerReach,
        overlap: expected.overlap,
      });
      expect(createHash("sha256").update(atlasBytes).digest("hex")).toBe(qualityManifest.atlasSha256);
      expect([atlas.width, atlas.height], quality).toEqual([
        width * PARKLAND_PAIR_ATLAS_COLUMNS,
        height * PARKLAND_PAIR_ATLAS_ROLES.length / PARKLAND_PAIR_ATLAS_COLUMNS,
      ]);
      for (const [index, role] of PARKLAND_PAIR_ATLAS_ROLES.entries()) {
        const [kind, pair, position] = role.split(":");
        const frame = qualityManifest.frames[role];
        expect(frame.guidePath).toBe(`${quality}/${kind}-${pair}-${position}.png`);
        expect(frame.guideSha256).toBe(manifest.files[frame.guidePath].sha256);
        expect(frame.semanticPath).toBe(`${quality}/semantic-${pair.split("--")[0]}.png`);
        expect(frame.semanticSha256).toBe(manifest.files[frame.semanticPath].sha256);
        if (quality === "low") {
          expect(frame.materialInputs).toBeNull();
        } else {
          const [owner, neighbor] = pair.split("--");
          expect(frame.materialInputs?.owner.path).toBe(`${quality}/${owner}.png`);
          expect(frame.materialInputs?.neighbor.path).toBe(`${quality}/${neighbor}.png`);
          for (const input of [frame.materialInputs?.owner, frame.materialInputs?.neighbor]) {
            const bytes = readFileSync(new URL(input!.path, materialFieldRoot));
            expect(createHash("sha256").update(bytes).digest("hex")).toBe(input!.sha256);
          }
        }
        const extracted = Buffer.alloc(width * height * 4);
        const frameX = index % PARKLAND_PAIR_ATLAS_COLUMNS * width;
        const frameY = Math.floor(index / PARKLAND_PAIR_ATLAS_COLUMNS) * height;
        for (let y = 0; y < height; y++) {
          const atlasStart = ((frameY + y) * atlas.width + frameX) * 4;
          atlas.data.copy(extracted, y * width * 4, atlasStart, atlasStart + width * 4);
        }
        expect(createHash("sha256").update(extracted).digest("hex"), `${quality}:${role}`).toBe(frame.rgbaSha256);
        const expectedAlphaLevels = qualityManifest.parameters.alpha.flatMap((alpha) => [
          alpha,
          alpha - qualityManifest.parameters.textureAlphaDrop,
        ]).sort((a, b) => b - a);
        expect(frame.metrics.alphaLevels.length).toBeGreaterThanOrEqual(4);
        expect(frame.metrics.alphaLevels.every((alpha) => expectedAlphaLevels.includes(alpha))).toBe(true);
        expect(frame.metrics.alphaLevels.some((alpha) => (
          qualityManifest.parameters.alpha.every((base) => base !== alpha)
        ))).toBe(true);
        expect(frame.metrics.bandPixels).toHaveLength(3);
        expect(frame.metrics.bandPixels.every((count) => count > 0)).toBe(true);
        expect(frame.metrics.bandPixels.reduce((sum, count) => sum + count, 0)).toBe(frame.metrics.visiblePixels);
        expect(frame.metrics.modulatedPixels).toBeGreaterThan(0);
        expect(frame.metrics.modulatedPixels).toBeLessThan(frame.metrics.visiblePixels / 3);
        expect(Math.min(...frame.metrics.alphaLevels)).toBeGreaterThan(0);
        expect(frame.metrics.transparentRgbPixels).toBe(0);
        expect(frame.metrics.outsideDiamondPixels).toBe(0);
        expect(frame.metrics.distinctVisibleColors).toBeGreaterThanOrEqual(3);
        if (quality === "low") {
          expect(frame.metrics.zonePixels).toBeUndefined();
        } else {
          expect(frame.metrics.zonePixels).toEqual({
            outer: frame.metrics.bandPixels[0],
            intermix: frame.metrics.bandPixels[1],
            inner: frame.metrics.bandPixels[2],
          });
          expect(frame.metrics.ownerContributionPixels).toBe(frame.metrics.visiblePixels);
          expect(frame.metrics.neighborContributionPixels).toBe(frame.metrics.visiblePixels);
          expect(frame.metrics.intermixPixels).toBe(frame.metrics.bandPixels[1]);
          expect(frame.metrics.noFringeRmsDelta).toBe(0);
          expect(frame.metrics.withoutOwnerRmsDelta).toBeGreaterThan(1);
          expect(frame.metrics.withoutNeighborRmsDelta).toBeGreaterThan(1);
          expect(frame.metrics.withoutOwnerRgbaSha256).not.toBe(frame.rgbaSha256);
          expect(frame.metrics.withoutNeighborRgbaSha256).not.toBe(frame.rgbaSha256);
          expect(frame.metrics.withoutOwnerRgbaSha256).not.toBe(frame.metrics.withoutNeighborRgbaSha256);
          expect(frame.metrics.densityCrossover).toBe(pair === "rough--deep_rough");
          const controls = frame.metrics.finalPixelControls!;
          expect(controls.noFringeControlRms).toBe(0);
          expect(controls.enabledVsNoFringeRms).toBeGreaterThan(1);
          expect(controls.enabledVsWithoutOwnerRms).toBeGreaterThan(0.5);
          expect(controls.enabledVsWithoutNeighborRms).toBeGreaterThan(0.5);
          expect(controls.enabledSha256).not.toBe(controls.noFringeSha256);
          expect(controls.enabledSha256).not.toBe(controls.withoutOwnerSha256);
          expect(controls.enabledSha256).not.toBe(controls.withoutNeighborSha256);
        }
        if (kind === "edge") {
          expect(frame.metrics.coverage).toBeGreaterThanOrEqual(0.05);
          expect(frame.metrics.coverage).toBeLessThan(0.06);
          expect(frame.metrics.oppositeSidePixels).toBe(0);
        } else {
          expect(frame.metrics.coverage).toBeGreaterThanOrEqual(0.009);
          expect(frame.metrics.coverage).toBeLessThan(0.017);
          expect(frame.metrics.visiblePixels).toBeGreaterThanOrEqual(32);
          expect(frame.metrics.incidentOverlapPixels).toBeGreaterThan(0);
          expect(frame.metrics.incidentOverlapPixels).toBeLessThan(frame.metrics.visiblePixels / 2);
          expect(frame.metrics.continuityPixels).toBeGreaterThan(frame.metrics.incidentOverlapPixels ?? 0);
        }
      }
    }
    expect(derivedManifest.qualities.low.atlasSha256).toBe(
      "cfe49db34543f3fc684ec2f65ef29fefb8f3d4615821526095863414ea4caacf",
    );
  });

  it("does not invent corner vocabulary outside the four declared patches", () => {
    expect(PARKLAND_PAIR_FRINGE_CORNERS).toEqual(["ne", "se", "sw", "nw"]);
  });
});
