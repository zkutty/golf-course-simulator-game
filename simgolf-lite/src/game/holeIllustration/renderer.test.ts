import { describe, expect, it } from "vitest";
import { hashCanonicalValue } from "../../utils/canonical";
import { BIOME_KEYS } from "../models/biomes";
import type { Course } from "../models/types";
import { SEASONS } from "../seasons/types";
import {
  createHoleIllustrationRenderPlan,
  HOLE_ILLUSTRATION_ENDPOINT_MARKER_MIN_INNER_DIAMETER,
  HOLE_ILLUSTRATION_LAYER_ORDER,
  type HoleIllustrationRenderLayer,
  type HoleIllustrationRenderPlan,
  type HoleIllustrationRenderPrimitive,
} from "./renderPlan";
import { createHoleIllustrationSnapshot } from "./snapshot";
import {
  HOLE_ILLUSTRATION_OUTPUT_LIMITS,
  preflightHoleIllustrationRender,
  renderHoleIllustrationRgba,
  renderHoleIllustrationSvg,
} from "./renderer";
import {
  HOLE_ILLUSTRATION_NON_TEXT_CONTRAST_MINIMUM,
  inspectHoleIllustrationGraphicContrast,
  resolveHoleIllustrationStyle,
} from "./style";

function cell(x: number, y: number): Array<{ x: number; y: number }> {
  return [
    { x: x / 10, y: y / 8 },
    { x: (x + 1) / 10, y: y / 8 },
    { x: (x + 1) / 10, y: (y + 1) / 8 },
    { x: x / 10, y: (y + 1) / 8 },
  ];
}

function layers(): HoleIllustrationRenderLayer[] {
  const cells = [cell(1, 1), cell(4, 4), cell(8, 6)];
  const terrainKinds = ["path", "fairway", "green"] as const;
  const terrainFills = ["#a47e62", "#60b044", "#8ee36a"] as const;
  const terrain: HoleIllustrationRenderPrimitive[] = cells.map((points, index) => ({
    id: `terrain-${index}-${[1, 4, 8][index]}-${[1, 4, 6][index]}`,
    kind: "polygon",
    semantic: `terrain:${terrainKinds[index]}`,
    points,
    fill: terrainFills[index],
    stroke: "#000000",
    strokeWidth: 0.0125,
  }));
  const elevation: HoleIllustrationRenderPrimitive[] = cells.map((points, index) => ({
    id: `elevation-${index}-${[1, 4, 8][index]}-${[1, 4, 6][index]}`,
    kind: "polygon",
    semantic: `elevation:${index}`,
    points,
    fill: index === 0 ? "#ffffff" : "#000000",
    opacity: Math.abs(index / 2 - 0.5) * 0.24,
  }));
  const contents: Record<(typeof HOLE_ILLUSTRATION_LAYER_ORDER)[number], HoleIllustrationRenderPrimitive[]> = {
    terrain,
    "elevation-contours": [...elevation, {
      id: "contour-0-8-6",
      kind: "sample-grid",
      semantic: "contour:bilinear-fixed-1024",
      samples: Array.from({ length: 16 }, (_, index) => ({
        point: { x: (8 + (index % 4) / 3) / 10, y: (6 + Math.floor(index / 4) / 3) / 8 },
        value: index * 8 - 64,
      })),
      markerRadius: { x: 0.0045, y: 0.005625 },
      fill: "#000000",
      opacity: 0.72,
    }],
    paths: [{
      id: "path-0-1-1",
      kind: "polyline",
      semantic: "path:authored-cell",
      points: cells[0],
      closed: true,
      stroke: "#000000",
      strokeWidth: 0.015,
    }],
    "vegetation-obstacles": [{
      id: "obstacle-0-8-6",
      kind: "ellipse",
      semantic: "obstacle:tree",
      center: { x: 0.85, y: 0.8125 },
      radius: { x: 0.034, y: 0.0425 },
      fill: "#287f45",
      stroke: "#000000",
      strokeWidth: 0.0125,
    }],
    surroundings: [{
      id: "surrounding-0-0-1-1",
      kind: "polygon",
      semantic: "surrounding:clubhouse:tier-1",
      points: cells[0],
      fill: "#e0a85c",
      stroke: "#000000",
      strokeWidth: 0.0125,
    }],
    tee: [{
      id: "selected-tee",
      kind: "ellipse",
      semantic: "tee:member",
      center: { x: 0.15, y: 0.1875 },
      radius: { x: 0.025, y: 0.03125 },
      fill: "#ffffff",
      stroke: "#000000",
      strokeWidth: 0.0125,
    }],
    pin: [{
      id: "selected-pin",
      kind: "ellipse",
      semantic: "pin:A",
      center: { x: 0.85, y: 0.8125 },
      radius: { x: 0.022, y: 0.0275 },
      fill: "#d00000",
      stroke: "#000000",
      strokeWidth: 0.0125,
    }],
    route: [{
      id: "authoritative-route-halo",
      kind: "polyline",
      semantic: "route:tee-waypoints-pin:halo",
      points: [{ x: 0.15, y: 0.1875 }, { x: 0.45, y: 0.5625 }, { x: 0.85, y: 0.8125 }],
      closed: false,
      stroke: "#ffffff",
      strokeWidth: 0.0375,
    }, {
      id: "authoritative-route",
      kind: "polyline",
      semantic: "route:tee-waypoints-pin",
      points: [{ x: 0.15, y: 0.1875 }, { x: 0.45, y: 0.5625 }, { x: 0.85, y: 0.8125 }],
      closed: false,
      stroke: "#000000",
      strokeWidth: 0.0125,
      opacity: 0.88,
    }],
  };
  return HOLE_ILLUSTRATION_LAYER_ORDER.map((id, z) => ({ id, z, primitives: contents[id] }));
}

function pointCount(source: readonly HoleIllustrationRenderLayer[]): number {
  return source.reduce((total, layer) => total + layer.primitives.reduce((subtotal, item) => subtotal
    + (item.kind === "ellipse" ? 1 : item.kind === "sample-grid" ? item.samples.length : item.points.length), 0), 0);
}

function sealPlan(input: Omit<HoleIllustrationRenderPlan, "hash"> & { hash?: string }): HoleIllustrationRenderPlan {
  const { hash: _ignored, ...facts } = input;
  return { ...facts, hash: hashCanonicalValue(facts) } as HoleIllustrationRenderPlan;
}

function fixture(): HoleIllustrationRenderPlan {
  const planLayers = layers();
  return sealPlan({
    version: 1,
    hashAlgorithm: "fnv1a32-canonical-v1",
    snapshotHash: "a".repeat(64),
    settings: {
      frame: "north-up",
      biome: "parkland",
      season: "summer",
      contrast: "high-contrast",
      viewport: { width: 100, height: 80, padding: 0 },
    },
    styleId: "parkland:summer",
    background: "#ffffff",
    frame: {
      mode: "north-up",
      originCourse: { x: 0, y: 0 },
      rotationDegrees: 0,
      matrix: { a: 1, b: 0, c: 0, d: 1 },
      translation: { x: 0, y: 0 },
      crop: { width: 10, height: 8 },
      scaleToUnit: 0.1,
    },
    layers: planLayers,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    budget: {
      sourceCells: 3,
      sourceFeatures: 3,
      primitiveCount: planLayers.reduce((total, layer) => total + layer.primitives.length, 0),
      pointCount: pointCount(planLayers),
      runtime: "bounded-n-log-n",
      memory: "bounded",
    },
  });
}

function pixel(data: Uint8ClampedArray, width: number, x: number, y: number): number[] {
  const index = (y * width + x) * 4;
  return Array.from(data.slice(index, index + 4));
}

function hashBytes(data: Uint8ClampedArray): string {
  let hash = 0x811c9dc5;
  for (const byte of data) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function opaqueHex(color: string): number[] {
  return [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16)).concat(255);
}

function courseFixture(
  tee = { x: 1, y: 10 },
  pin = { x: 10, y: 1 },
  waypoints: Array<{ x: number; y: number }> = [{ x: 3, y: 4 }],
): Course {
  const width = 12;
  const height = 12;
  const tiles: Course["tiles"] = Array.from({ length: width * height }, () => "rough");
  tiles[tee.y * width + tee.x] = "tee";
  tiles[pin.y * width + pin.x] = "green";
  return {
    width,
    height,
    tiles,
    elevations: Array.from({ length: width * height }, (_, index) => index % 3),
    holes: [{
      id: "adapter-hole",
      tee,
      green: pin,
      teeBoxes: { forward: tee, member: tee, championship: tee },
      pinPositions: { A: pin, B: pin, C: pin },
      waypoints,
      parMode: "AUTO",
    }],
    layouts: [{
      id: "adapter-layout",
      name: "Adapter layout",
      draftHoleIds: ["adapter-hole"],
      publishedHoleIds: ["adapter-hole"],
      roundLength: 9,
      state: "open",
      greenFee: 50,
    }],
    activeCourseId: "adapter-layout",
    obstacles: [],
    buildings: [],
    decorations: [],
    yardsPerTile: 10,
    name: "Adapter fixture",
    baseGreenFee: 50,
    condition: 1,
  };
}

function wideAxisCourseFixture(): Course {
  const width = 300;
  const height = 200;
  const tee = { x: 250, y: 100 };
  const pin = { x: 280, y: 100 };
  const tiles: Course["tiles"] = Array.from({ length: width * height }, () => "rough");
  tiles[tee.y * width + tee.x] = "tee";
  tiles[pin.y * width + pin.x] = "green";
  return {
    ...courseFixture(),
    width,
    height,
    tiles,
    elevations: Array.from({ length: width * height }, () => 0),
    holes: [{
      id: "adapter-hole",
      tee,
      green: pin,
      teeBoxes: { forward: tee, member: tee, championship: tee },
      pinPositions: { A: pin, B: pin, C: pin },
      waypoints: [],
      parMode: "AUTO",
    }],
  };
}

function complexCourseFixture(): Course {
  const course = courseFixture();
  const tiles = [...course.tiles];
  tiles[4 * course.width + 3] = "path";
  return {
    ...course,
    tiles,
    obstacles: [{ x: 5, y: 5, type: "tree" }, { x: 7, y: 3, type: "rock" }],
    buildings: [{ type: "clubhouse", x: 4, y: 5 }],
    decorations: [{ kind: "bench", x: 6, y: 5, rotation: 0 }],
    greenSurface: {
      version: 1,
      samplesPerAxis: 4,
      fixedPointScale: 1024,
      interpolation: "bilinear",
      tiles: [{
        x: 10,
        y: 1,
        offsets: [128, 96, 64, 32, 96, 64, 32, 0, 64, 32, 0, -32, 32, 0, -32, -64],
      }],
    },
  };
}

function releasedSnapshot() {
  const result = createHoleIllustrationSnapshot(courseFixture(), {
    layoutId: "adapter-layout",
    routeSource: "published",
    holeId: "adapter-hole",
    teeSet: "member",
    pinRotation: "A",
    marginTiles: 0,
  });
  if (!result.complete) throw new Error(result.message);
  return result.snapshot;
}

function releasedComplexSnapshot() {
  const result = createHoleIllustrationSnapshot(complexCourseFixture(), {
    layoutId: "adapter-layout",
    routeSource: "published",
    holeId: "adapter-hole",
    teeSet: "member",
    pinRotation: "A",
    marginTiles: 0,
  });
  if (!result.complete) throw new Error(result.message);
  return result.snapshot;
}

describe("ZK-768 DOM-free deterministic illustration adapters", () => {
  it("consumes the released snapshot and render-plan builders end to end", () => {
    const snapshot = createHoleIllustrationSnapshot(courseFixture(), {
      layoutId: "adapter-layout",
      routeSource: "published",
      holeId: "adapter-hole",
      teeSet: "member",
      pinRotation: "A",
      marginTiles: 0,
    });
    expect(snapshot.complete).toBe(true);
    if (!snapshot.complete) return;
    const planned = createHoleIllustrationRenderPlan(snapshot.snapshot, {
      frame: "tee-to-green",
      biome: "links",
      season: "autumn",
      contrast: "high-contrast",
      viewport: { width: 120, height: 90, padding: 0.05 },
    });
    expect(planned.complete).toBe(true);
    if (!planned.complete) return;
    expect(renderHoleIllustrationSvg(planned.plan)).toMatchObject({ complete: true, planHash: planned.plan.hash });
    expect(renderHoleIllustrationRgba(planned.plan, { pixelRatio: 2 })).toMatchObject({
      complete: true,
      width: 240,
      height: 180,
      planHash: planned.plan.hash,
    });
  });

  it("accepts the complete 48-case real producer matrix", () => {
    const snapshot = releasedComplexSnapshot();
    let cases = 0;
    const evidence: string[] = [];
    for (const frame of ["north-up", "tee-to-green"] as const) {
      for (const biome of BIOME_KEYS) {
        for (const season of SEASONS) {
          for (const contrast of ["standard", "high-contrast"] as const) {
            const settings = {
              frame,
              biome,
              season,
              contrast,
              viewport: { width: 96, height: 72, padding: 0.08 },
            } as const;
            const planned = createHoleIllustrationRenderPlan(snapshot, settings);
            const repeated = createHoleIllustrationRenderPlan(snapshot, settings);
            expect(planned.complete).toBe(true);
            expect(repeated.complete).toBe(true);
            if (!planned.complete || !repeated.complete) continue;
            expect(repeated.plan.hash).toBe(planned.plan.hash);
            for (const layerId of HOLE_ILLUSTRATION_LAYER_ORDER) {
              expect(planned.plan.layers.find((layer) => layer.id === layerId)?.primitives.length).toBeGreaterThan(0);
            }
            const budget = preflightHoleIllustrationRender(planned.plan, { pixelRatio: 1 });
            expect(budget).toMatchObject({
              complete: true,
              planHash: planned.plan.hash,
              svg: { withinLimit: true },
              rgba: { withinLimits: true, pixelVisitEstimateExact: true },
            });
            const svg = renderHoleIllustrationSvg(planned.plan);
            const repeatedSvg = renderHoleIllustrationSvg(planned.plan);
            const rgba = renderHoleIllustrationRgba(planned.plan, { pixelRatio: 1 });
            const repeatedRgba = renderHoleIllustrationRgba(planned.plan, { pixelRatio: 1 });
            expect(svg).toEqual(repeatedSvg);
            expect(rgba).toEqual(repeatedRgba);
            expect(svg.complete && rgba.complete).toBe(true);
            if (!svg.complete || !rgba.complete) continue;
            if (budget.complete) expect(budget.svg.characters).toBe(svg.svg.length);
            evidence.push([
              frame, biome, season, contrast, planned.plan.hash,
              hashCanonicalValue(svg.svg), hashBytes(rgba.data),
            ].join(":"));
            cases++;
          }
        }
      }
    }
    expect(cases).toBe(48);
    expect(hashCanonicalValue(evidence)).toBe("5747a09b");
  });

  it("reports every registered palette and certifies high-contrast graphic boundaries", () => {
    const evidence: string[] = [];
    let reports = 0;
    let highContrastReports = 0;
    let certifiedMinimum = Infinity;
    for (const biome of BIOME_KEYS) for (const season of SEASONS) {
      for (const contrast of ["standard", "high-contrast"] as const) {
        const report = inspectHoleIllustrationGraphicContrast(biome, season, contrast);
        expect(report.styleId).toBe(`${biome}:${season}`);
        expect(report.threshold).toBe(HOLE_ILLUSTRATION_NON_TEXT_CONTRAST_MINIMUM);
        expect(report.pairs).toHaveLength(contrast === "high-contrast" ? 31 : 20);
        expect(Object.isFrozen(report)).toBe(true);
        expect(report.pairs.some((pair) => pair.id.startsWith("terrain:") && pair.id.endsWith(":outline")))
          .toBe(contrast === "high-contrast");
        expect(report.pairs.find((pair) => pair.id === "route:core:halo"))
          .toMatchObject({ requiredForCertification: true });
        evidence.push(`${report.styleId}:${contrast}:${report.minimumRatio.toFixed(12)}:${report.meetsThreshold}`);
        if (contrast === "high-contrast") {
          expect(report.meetsThreshold).toBe(true);
          expect(report.minimumRatio).toBeGreaterThanOrEqual(3);
          expect(report.pairs.find((pair) => pair.id === "route:halo:outline"))
            .toMatchObject({ ratio: 21, requiredForCertification: true });
          certifiedMinimum = Math.min(certifiedMinimum, report.minimumRatio);
          highContrastReports++;
        }
        reports++;
      }
    }
    expect(reports).toBe(24);
    expect(highContrastReports).toBe(12);
    expect(certifiedMinimum).toBeCloseTo(3.681979343743816, 12);
    expect(hashCanonicalValue(evidence)).toBe("338f2913");
  });

  it("preflights exact SVG and bounded RGBA budgets for pixel ratios 1 through 4", () => {
    const snapshot = releasedComplexSnapshot();
    const planned = createHoleIllustrationRenderPlan(snapshot, {
      frame: "tee-to-green",
      biome: "links",
      season: "autumn",
      contrast: "high-contrast",
      viewport: { width: 96, height: 72, padding: 0.08 },
    });
    expect(planned.complete).toBe(true);
    if (!planned.complete) return;
    const svg = renderHoleIllustrationSvg(planned.plan);
    expect(svg.complete).toBe(true);
    if (!svg.complete) return;

    const evidence: string[] = [];
    for (const pixelRatio of [1, 2, 3, 4]) {
      const budget = preflightHoleIllustrationRender(planned.plan, { pixelRatio });
      expect(budget).toEqual(preflightHoleIllustrationRender(planned.plan, { pixelRatio }));
      expect(budget.complete).toBe(true);
      if (!budget.complete) continue;
      expect(budget.svg).toMatchObject({ characters: svg.svg.length, withinLimit: true });
      expect(budget.rgba).toMatchObject({
        pixelRatio,
        width: 96 * pixelRatio,
        height: 72 * pixelRatio,
        pixels: 96 * 72 * pixelRatio ** 2,
        rgbaBytes: 96 * 72 * pixelRatio ** 2 * 4,
        coverageBytes: 96 * 72 * pixelRatio ** 2,
        allocationBytes: 96 * 72 * pixelRatio ** 2 * 5,
        withinLimits: true,
        pixelVisitEstimateExact: true,
      });
      const rgba = renderHoleIllustrationRgba(planned.plan, { pixelRatio });
      expect(rgba.complete).toBe(true);
      if (!rgba.complete) continue;
      expect(rgba.data).toHaveLength(budget.rgba.rgbaBytes);
      evidence.push(`${pixelRatio}:${budget.rgba.estimatedPixelVisits}:${hashBytes(rgba.data)}`);
    }
    expect(hashCanonicalValue(evidence)).toBe("69917a72");
  });

  it("keeps standard and high-contrast route halos below visible tee and pin endpoints at 1x through 4x", () => {
    const snapshot = releasedComplexSnapshot();
    for (const contrast of ["standard", "high-contrast"] as const) {
      const planned = createHoleIllustrationRenderPlan(snapshot, {
        frame: "tee-to-green",
        biome: "links",
        season: "autumn",
        contrast,
        viewport: { width: 96, height: 72, padding: 0.08 },
      });
      expect(planned.complete).toBe(true);
      if (!planned.complete) continue;
      const svg = renderHoleIllustrationSvg(planned.plan);
      expect(svg.complete).toBe(true);
      if (!svg.complete) continue;
      expect(svg.svg.indexOf('data-layer="route"')).toBeLessThan(svg.svg.indexOf('data-layer="tee"'));
      expect(svg.svg.indexOf('data-layer="tee"')).toBeLessThan(svg.svg.indexOf('data-layer="pin"'));
      expect(svg.svg).toContain('id="authoritative-route-halo"');

      const tee = planned.plan.layers.find((layer) => layer.id === "tee")?.primitives[0];
      const pin = planned.plan.layers.find((layer) => layer.id === "pin")?.primitives[0];
      expect(tee?.kind === "ellipse" && pin?.kind === "ellipse").toBe(true);
      if (tee?.kind !== "ellipse" || pin?.kind !== "ellipse") continue;
      const palette = resolveHoleIllustrationStyle("links", "autumn", contrast);
      for (const marker of [tee, pin]) {
        const strokePixels = marker.strokeWidth! * Math.min(
          planned.plan.settings.viewport.width,
          planned.plan.settings.viewport.height,
        );
        expect(marker.radius.x * planned.plan.settings.viewport.width * 2 - strokePixels)
          .toBeGreaterThanOrEqual(HOLE_ILLUSTRATION_ENDPOINT_MARKER_MIN_INNER_DIAMETER);
        expect(marker.radius.y * planned.plan.settings.viewport.height * 2 - strokePixels)
          .toBeGreaterThanOrEqual(HOLE_ILLUSTRATION_ENDPOINT_MARKER_MIN_INNER_DIAMETER);
      }
      for (const pixelRatio of [1, 2, 3, 4]) {
        const rgba = renderHoleIllustrationRgba(planned.plan, { pixelRatio });
        expect(rgba.complete).toBe(true);
        if (!rgba.complete) continue;
        expect(pixel(rgba.data, rgba.width,
          Math.floor(tee.center.x * rgba.width), Math.floor(tee.center.y * rgba.height)))
          .toEqual(opaqueHex(palette.tee.fill));
        expect(pixel(rgba.data, rgba.width,
          Math.floor(pin.center.x * rgba.width), Math.floor(pin.center.y * rgba.height)))
          .toEqual(opaqueHex(palette.pin.fill));
      }
    }
  });

  it("accepts the full tiny-axis producer viewport domain without weakening exact geometry", () => {
    const snapshot = releasedComplexSnapshot();
    const viewports = [
      { width: 1, height: 1 },
      { width: 1, height: 100 },
      { width: 100, height: 1 },
      { width: 2, height: 2 },
      { width: 2, height: 100 },
      { width: 100, height: 2 },
      { width: 3, height: 3 },
    ] as const;
    const evidence: string[] = [];
    let cases = 0;
    let maximumStrokeWidth = 0;
    let maximumEllipseRadius = 0;
    for (const viewport of viewports) for (const frame of ["north-up", "tee-to-green"] as const) {
      const planned = createHoleIllustrationRenderPlan(snapshot, {
        frame,
        biome: "links",
        season: "autumn",
        contrast: "high-contrast",
        viewport: { ...viewport, padding: 0.08 },
      });
      expect(planned.complete).toBe(true);
      if (!planned.complete) continue;
      for (const item of planned.plan.layers.flatMap((layer) => layer.primitives)) {
        maximumStrokeWidth = Math.max(maximumStrokeWidth, item.strokeWidth ?? 0);
        if (item.kind === "ellipse") {
          maximumEllipseRadius = Math.max(maximumEllipseRadius, item.radius.x, item.radius.y);
        }
      }
      const budget = preflightHoleIllustrationRender(planned.plan, { pixelRatio: 1 });
      const svg = renderHoleIllustrationSvg(planned.plan);
      const rgba = renderHoleIllustrationRgba(planned.plan, { pixelRatio: 1 });
      expect(budget).toMatchObject({ complete: true, svg: { withinLimit: true }, rgba: { withinLimits: true } });
      expect(svg).toMatchObject({ complete: true, planHash: planned.plan.hash });
      expect(rgba).toMatchObject({
        complete: true,
        width: viewport.width,
        height: viewport.height,
        planHash: planned.plan.hash,
      });
      if (budget.complete && svg.complete && rgba.complete) {
        evidence.push([
          viewport.width, viewport.height, frame, planned.plan.hash,
          budget.rgba.estimatedPixelVisits, hashCanonicalValue(svg.svg), hashBytes(rgba.data),
        ].join(":"));
      }
      cases++;
    }
    expect(cases).toBe(14);
    expect(maximumStrokeWidth).toBe(3);
    expect(maximumEllipseRadius).toBe(2);
    expect(hashCanonicalValue(evidence)).toBe("c1dedb55");
  });

  it("rejects resealed geometry beyond the tight tiny-axis producer extrema", () => {
    const planned = createHoleIllustrationRenderPlan(releasedComplexSnapshot(), {
      frame: "north-up",
      biome: "links",
      season: "autumn",
      contrast: "high-contrast",
      viewport: { width: 1, height: 1, padding: 0.08 },
    });
    expect(planned.complete).toBe(true);
    if (!planned.complete) return;
    const oversizedStroke = sealPlan({
      ...planned.plan,
      layers: planned.plan.layers.map((layer) => ({
        ...layer,
        primitives: layer.primitives.map((item) => item.id === "authoritative-route-halo"
          ? { ...item, strokeWidth: 3.000_001 }
          : item),
      })),
      hash: undefined,
    });
    const oversizedRadius = sealPlan({
      ...planned.plan,
      layers: planned.plan.layers.map((layer) => ({
        ...layer,
        primitives: layer.primitives.map((item) => item.id === "selected-tee" && item.kind === "ellipse"
          ? { ...item, radius: { ...item.radius, x: 2.000_001 } }
          : item),
      })),
      hash: undefined,
    });
    for (const hostile of [oversizedStroke, oversizedRadius]) {
      expect(preflightHoleIllustrationRender(hostile, { pixelRatio: 1 }))
        .toMatchObject({ complete: false, code: "INVALID_PLAN" });
      expect(renderHoleIllustrationSvg(hostile)).toMatchObject({ complete: false, code: "INVALID_PLAN" });
      expect(renderHoleIllustrationRgba(hostile, { pixelRatio: 1 }))
        .toMatchObject({ complete: false, code: "INVALID_PLAN" });
    }
  });

  it("accepts real cardinal, diagonal, reverse, and dogleg projections in both frames", () => {
    const routes = [
      [{ x: 1, y: 1 }, { x: 10, y: 1 }, [{ x: 5, y: 3 }]],
      [{ x: 10, y: 1 }, { x: 1, y: 1 }, [{ x: 6, y: 4 }]],
      [{ x: 1, y: 1 }, { x: 1, y: 10 }, [{ x: 4, y: 5 }]],
      [{ x: 1, y: 10 }, { x: 1, y: 1 }, [{ x: 5, y: 6 }]],
      [{ x: 2, y: 10 }, { x: 9, y: 2 }, [{ x: 8, y: 8 }]],
      [{ x: 9, y: 10 }, { x: 2, y: 3 }, [{ x: 3, y: 9 }]],
    ] as const;
    let accepted = 0;
    for (const [tee, pin, waypoints] of routes) {
      const snapshot = createHoleIllustrationSnapshot(courseFixture(tee, pin, [...waypoints]), {
        layoutId: "adapter-layout",
        routeSource: "published",
        holeId: "adapter-hole",
        teeSet: "member",
        pinRotation: "A",
        marginTiles: 0,
      });
      expect(snapshot.complete).toBe(true);
      if (!snapshot.complete) continue;
      for (const frame of ["north-up", "tee-to-green"] as const) {
        const planned = createHoleIllustrationRenderPlan(snapshot.snapshot, {
          frame,
          biome: "parkland",
          season: "winter",
          contrast: "standard",
          viewport: { width: 111, height: 79, padding: 0.13 },
        });
        expect(planned.complete).toBe(true);
        if (planned.complete) {
          expect(renderHoleIllustrationSvg(planned.plan)).toMatchObject({ complete: true });
          accepted++;
        }
      }
    }
    expect(accepted).toBe(12);
  });

  it("accepts released 300x200 course coordinates beyond 255 in both frames", () => {
    const snapshot = createHoleIllustrationSnapshot(wideAxisCourseFixture(), {
      layoutId: "adapter-layout",
      routeSource: "published",
      holeId: "adapter-hole",
      teeSet: "member",
      pinRotation: "A",
      marginTiles: 0,
    });
    expect(snapshot.complete).toBe(true);
    if (!snapshot.complete) return;

    const hashes: string[] = [];
    for (const frame of ["north-up", "tee-to-green"] as const) {
      const planned = createHoleIllustrationRenderPlan(snapshot.snapshot, {
        frame,
        biome: "parkland",
        season: "summer",
        contrast: "standard",
        viewport: { width: 96, height: 72, padding: 0.08 },
      });
      expect(planned.complete).toBe(true);
      if (!planned.complete) continue;
      hashes.push(planned.plan.hash);
      expect(renderHoleIllustrationSvg(planned.plan)).toMatchObject({
        complete: true,
        planHash: planned.plan.hash,
      });
      expect(renderHoleIllustrationRgba(planned.plan, { pixelRatio: 2 })).toMatchObject({
        complete: true,
        width: 192,
        height: 144,
        planHash: planned.plan.hash,
      });
    }
    expect(hashes).toEqual(["bccefe31", "255fc713"]);
  });

  it("rejects a compensated tee-to-green origin outside the Wave 0 frame contract", () => {
    const snapshot = createHoleIllustrationSnapshot(wideAxisCourseFixture(), {
      layoutId: "adapter-layout",
      routeSource: "published",
      holeId: "adapter-hole",
      teeSet: "member",
      pinRotation: "A",
      marginTiles: 0,
    });
    expect(snapshot.complete).toBe(true);
    if (!snapshot.complete) return;
    const planned = createHoleIllustrationRenderPlan(snapshot.snapshot, {
      frame: "tee-to-green",
      biome: "parkland",
      season: "summer",
      contrast: "standard",
      viewport: { width: 96, height: 72, padding: 0.08 },
    });
    expect(planned.complete).toBe(true);
    if (!planned.complete) return;
    expect(planned.plan.frame.originCourse).toEqual({ x: 250, y: 100 });

    const deltaX = 50;
    const forged = sealPlan({
      ...planned.plan,
      frame: {
        ...planned.plan.frame,
        originCourse: {
          ...planned.plan.frame.originCourse,
          x: planned.plan.frame.originCourse.x + deltaX,
        },
        translation: {
          x: planned.plan.frame.translation.x + planned.plan.frame.matrix.a * deltaX,
          y: planned.plan.frame.translation.y + planned.plan.frame.matrix.b * deltaX,
        },
      },
      hash: undefined,
    });
    expect(renderHoleIllustrationSvg(forged)).toMatchObject({ complete: false, code: "INVALID_PLAN" });
    expect(renderHoleIllustrationRgba(forged, { pixelRatio: 2 }))
      .toMatchObject({ complete: false, code: "INVALID_PLAN" });
  });

  it("serializes every primitive kind in stable layer order with exact physical mapping and provenance", () => {
    const plan = fixture();
    const result = renderHoleIllustrationSvg(plan);
    expect(result.complete).toBe(true);
    if (!result.complete) return;
    expect(result).toMatchObject({ mimeType: "image/svg+xml", width: 100, height: 80, planHash: plan.hash });
    expect(result.svg).toContain(`data-coursecraft-plan-hash="${plan.hash}"`);
    expect(result.svg).toContain(`data-snapshot-hash="${plan.snapshotHash}"`);
    expect(result.svg).toContain("points=\"10,10 20,10 20,20 10,20\"");
    for (const kind of ["polygon", "polyline", "ellipse", "sample-grid"]) {
      expect(result.svg).toContain(`data-kind="${kind}"`);
    }
    let previous = -1;
    for (const id of HOLE_ILLUSTRATION_LAYER_ORDER) {
      const index = result.svg.indexOf(`data-layer="${id}"`);
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }
    expect(result.svg).toContain("opacity=\"0.12\"");
    expect(result.svg).toContain("stroke-width=\"1.2\"");
    expect(result.svg).toContain("stroke-linecap=\"round\" stroke-linejoin=\"round\"");
    expect(hashCanonicalValue(result.svg)).toBe("a06060bb");
  });

  it("is byte-stable across repeat SVG and RGBA renders", () => {
    const plan = fixture();
    expect(renderHoleIllustrationSvg(plan)).toEqual(renderHoleIllustrationSvg(plan));
    expect(renderHoleIllustrationRgba(plan, { pixelRatio: 1 })).toEqual(renderHoleIllustrationRgba(plan, { pixelRatio: 1 }));
  });

  it("rasterizes background, z-order, representative fills, strokes, and opacity", () => {
    const result = renderHoleIllustrationRgba(fixture(), { pixelRatio: 1 });
    expect(result.complete).toBe(true);
    if (!result.complete) return;
    expect(result).toMatchObject({ format: "rgba8", width: 100, height: 80, stride: 400, pixelRatio: 1 });
    expect(result.data).toHaveLength(100 * 80 * 4);
    expect(pixel(result.data, result.width, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(pixel(result.data, result.width, 42, 48)).toEqual([96, 176, 68, 255]);
    expect(pixel(result.data, result.width, 81, 68)).toEqual([125, 200, 93, 255]);
    expect(pixel(result.data, result.width, 18, 12)).toEqual([224, 168, 92, 255]);
    expect(pixel(result.data, result.width, 85, 65)).toEqual([208, 0, 0, 255]);
  });

  it("maps normalized geometry and stroke widths to bounded high-DPI physical output", () => {
    const plan = fixture();
    const one = renderHoleIllustrationRgba(plan, { pixelRatio: 1 });
    const two = renderHoleIllustrationRgba(plan, { pixelRatio: 2 });
    expect(one.complete && two.complete).toBe(true);
    if (!one.complete || !two.complete) return;
    expect(two).toMatchObject({ width: 200, height: 160, stride: 800, pixelRatio: 2, planHash: plan.hash });
    expect(two.data).toHaveLength(one.data.length * 4);
    expect(pixel(two.data, two.width, 84, 96)).toEqual(pixel(one.data, one.width, 42, 48));
  });

  it("fails closed on declared SVG injection and ignores undeclared metadata", () => {
    const source = fixture();
    const injectedLayers = source.layers.map((layer) => ({
      ...layer,
      primitives: layer.primitives.map((item) => item.id === "obstacle-0-8-6"
        ? { ...item, semantic: "obstacle:tree:<script>alert('x')</script>&\"'" }
        : item),
    }));
    const injected = sealPlan({ ...source, layers: injectedLayers, hash: undefined });
    expect(renderHoleIllustrationSvg(injected)).toMatchObject({ complete: false, code: "INVALID_PLAN" });
    const extraLayers = source.layers.map((layer) => ({
      ...layer,
      primitives: layer.primitives.map((item) => item.id === "obstacle-0-8-6"
        ? { ...item, unsafeMetadata: "<script>alert('x')</script>" }
        : item),
    }));
    const result = renderHoleIllustrationSvg({ ...source, layers: extraLayers } as HoleIllustrationRenderPlan);
    expect(result.complete).toBe(true);
    if (!result.complete) return;
    expect(result.svg).not.toContain("<script>");
  });

  it("fails closed on tampering, malformed signed plans, and layer-order changes", () => {
    const source = fixture();
    const tampered: HoleIllustrationRenderPlan = { ...source, background: "#000000" };
    const forged: HoleIllustrationRenderPlan = { ...source, hash: "ffffffff" };
    const reordered = sealPlan({ ...source, layers: [...source.layers].reverse(), hash: undefined });
    const outOfBoundsLayers = source.layers.map((layer, layerIndex) => ({
      ...layer,
      primitives: layer.primitives.map((item, itemIndex) => layerIndex === 0 && itemIndex === 0 && item.kind === "polygon"
        ? { ...item, points: [{ x: -0.1, y: 0.1 }, ...item.points.slice(1)] }
        : item),
    }));
    const outOfBounds = sealPlan({ ...source, layers: outOfBoundsLayers, hash: undefined });
    for (const plan of [tampered, forged, reordered, outOfBounds]) {
      expect(preflightHoleIllustrationRender(plan, { pixelRatio: 1 }))
        .toMatchObject({ complete: false, code: "INVALID_PLAN" });
      expect(renderHoleIllustrationSvg(plan)).toMatchObject({ complete: false, code: "INVALID_PLAN" });
      expect(renderHoleIllustrationRgba(plan, { pixelRatio: 1 })).toMatchObject({ complete: false, code: "INVALID_PLAN" });
    }
  });

  it("rejects paintless primitives and preflights the exact union-mask work bound", () => {
    const source = fixture();
    const obstacle = source.layers[3].primitives[0];
    expect(obstacle.kind).toBe("ellipse");
    if (obstacle.kind !== "ellipse") return;
    const paintlessLayers = source.layers.map((layer) => ({
      ...layer,
      primitives: layer.id === "vegetation-obstacles"
        ? Array.from({ length: 400 }, (_, index) => ({
          ...obstacle,
          id: `obstacle-${index}-8-6`,
          fill: undefined,
          stroke: undefined,
          strokeWidth: undefined,
        }))
        : layer.primitives,
    }));
    const paintless = sealPlan({
      ...source,
      layers: paintlessLayers,
      budget: { ...source.budget, sourceFeatures: 402, primitiveCount: 413, pointCount: 456 },
      hash: undefined,
    });
    expect(renderHoleIllustrationRgba(paintless, { pixelRatio: 1 }))
      .toMatchObject({ complete: false, code: "INVALID_PLAN" });

    const denseLayers = source.layers.map((layer) => ({
      ...layer,
      primitives: layer.id === "vegetation-obstacles"
        ? Array.from({ length: 4_000 }, (_, index) => ({
          ...obstacle,
          id: `obstacle-${index}-8-6`,
          strokeWidth: 0.005625,
        }))
        : layer.primitives,
    }));
    const scaledLayers = denseLayers.map((layer) => ({
      ...layer,
      primitives: layer.primitives.map((item) => {
        if (item.id.startsWith("terrain-")) return { ...item, strokeWidth: 0.003125 };
        if (item.id.startsWith("surrounding-")) return { ...item, strokeWidth: 0.006875 };
        if (item.id === "authoritative-route-halo") return { ...item, strokeWidth: 0.0175 };
        if (item.id === "selected-tee" || item.id === "selected-pin") return { ...item, strokeWidth: 0.01 };
        return item;
      }),
    }));
    const dense = sealPlan({
      ...source,
      settings: { ...source.settings, viewport: { ...source.settings.viewport, width: 500, height: 400 } },
      layers: scaledLayers,
      budget: { ...source.budget, sourceFeatures: 4_002, primitiveCount: 4_013, pointCount: 4_056 },
      hash: undefined,
    });
    expect(preflightHoleIllustrationRender(dense, { pixelRatio: 4 })).toMatchObject({
      complete: true,
      rgba: {
        estimatedPixelVisits: HOLE_ILLUSTRATION_OUTPUT_LIMITS.maxRasterPixelVisits + 1,
        pixelVisitEstimateExact: false,
        withinLimits: false,
      },
    });
    expect(renderHoleIllustrationRgba(dense, { pixelRatio: 4 }))
      .toMatchObject({ complete: false, code: "ALLOCATION_EXCEEDED" });
  });

  it("composites producer-opacity joins once and matches explicit round SVG caps and joins", () => {
    const source = fixture();
    const result = renderHoleIllustrationRgba(source, { pixelRatio: 2 });
    expect(result.complete).toBe(true);
    if (!result.complete) return;
    expect(pixel(result.data, result.width, 84, 84)).toEqual([31, 31, 31, 255]);
    expect(pixel(result.data, result.width, 89, 89)).toEqual([31, 31, 31, 255]);
    expect(pixel(result.data, result.width, 29, 29)).toEqual([255, 255, 255, 255]);
    expect(pixel(result.data, result.width, 170, 130)).toEqual([208, 0, 0, 255]);
    const svg = renderHoleIllustrationSvg(source);
    expect(svg.complete).toBe(true);
    if (svg.complete) {
      expect(svg.svg).toContain("stroke-linecap=\"round\" stroke-linejoin=\"round\"");
    }
  });

  it("rejects XML-invalid Unicode scalars before SVG serialization", () => {
    const source = fixture();
    for (const invalid of ["\ud800", "\ufffe", "\uffff"]) {
      const invalidLayers = source.layers.map((layer) => ({
        ...layer,
        primitives: layer.primitives.map((item) => item.id === "obstacle-0-8-6"
          ? { ...item, semantic: `obstacle:tree:${invalid}` }
          : item),
      }));
      const plan = sealPlan({ ...source, layers: invalidLayers, hash: undefined });
      expect(renderHoleIllustrationSvg(plan)).toMatchObject({ complete: false, code: "INVALID_PLAN" });
    }
  });

  it("rejects self-hashed invented producer facts, styles, frames, geometry, opacity, and budgets", () => {
    const source = fixture();
    const bogusStyle = sealPlan({
      ...source,
      settings: {
        ...source.settings,
        biome: "bogus" as HoleIllustrationRenderPlan["settings"]["biome"],
      },
      styleId: "bogus:summer" as HoleIllustrationRenderPlan["styleId"],
      hash: undefined,
    });
    const wrongStyleId = sealPlan({ ...source, styleId: "links:summer", hash: undefined });
    const contradictoryFrame = sealPlan({
      ...source,
      frame: { ...source.frame, rotationDegrees: 1 },
      hash: undefined,
    });
    const wrongSchemaLayers = source.layers.map((layer) => ({
      ...layer,
      primitives: layer.primitives.map((item) => item.id === "terrain-0-1-1"
        ? { ...item, semantic: "surrounding:clubhouse" }
        : item),
    }));
    const wrongSchema = sealPlan({ ...source, layers: wrongSchemaLayers, hash: undefined });
    const inventedElevationLayers = source.layers.map((layer) => ({
      ...layer,
      primitives: layer.primitives.map((item, index) => layer.id === "elevation-contours" && index === 0
        ? {
          ...item,
          id: "elevation-999-999-999",
          semantic: "elevation:not-a-number",
          points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
        }
        : item),
    }));
    const inventedElevation = sealPlan({ ...source, layers: inventedElevationLayers, hash: undefined });
    const degenerateLayers = source.layers.map((layer) => ({
      ...layer,
      primitives: layer.primitives.map((item) => item.id === "terrain-0-1-1"
        ? { ...item, points: Array.from({ length: 4 }, () => ({ x: 0.1, y: 0.125 })) }
        : item),
    }));
    const degenerate = sealPlan({ ...source, layers: degenerateLayers, hash: undefined });
    const zeroOpacityLayers = source.layers.map((layer) => ({
      ...layer,
      primitives: layer.primitives.map((item) =>
        item.id === "terrain-0-1-1" || item.id === "authoritative-route" ? { ...item, opacity: 0 } : item),
    }));
    const zeroOpacity = sealPlan({ ...source, layers: zeroOpacityLayers, hash: undefined });
    const impossibleFeatures = sealPlan({
      ...source,
      budget: { ...source.budget, sourceFeatures: Number.MAX_SAFE_INTEGER },
      hash: undefined,
    });
    for (const plan of [
      bogusStyle,
      wrongStyleId,
      contradictoryFrame,
      wrongSchema,
      inventedElevation,
      degenerate,
      zeroOpacity,
      impossibleFeatures,
    ]) {
      expect(renderHoleIllustrationSvg(plan)).toMatchObject({ complete: false, code: "INVALID_PLAN" });
    }
  });

  it("rejects open-polyline fills and nonpositive or sub-resolution strokes", () => {
    const source = fixture();
    for (const changes of [
      { fill: "#000000" },
      { strokeWidth: 0 },
      { strokeWidth: 0.001 },
    ]) {
      const invalidLayers = source.layers.map((layer) => ({
        ...layer,
        primitives: layer.primitives.map((item) => item.id === "authoritative-route"
          ? { ...item, ...changes }
          : item),
      }));
      const invalid = sealPlan({ ...source, layers: invalidLayers, hash: undefined });
      expect(renderHoleIllustrationSvg(invalid)).toMatchObject({ complete: false, code: "INVALID_PLAN" });
      expect(renderHoleIllustrationRgba(invalid, { pixelRatio: 1 }))
        .toMatchObject({ complete: false, code: "INVALID_PLAN" });
    }
  });

  it("rejects unsafe dimensions, pixel ratios, and raster allocations before output", () => {
    const source = fixture();
    for (const pixelRatio of [0, 1.5, 5, Number.NaN]) {
      expect(preflightHoleIllustrationRender(source, { pixelRatio }))
        .toMatchObject({ complete: false, code: "INVALID_OPTIONS" });
      expect(renderHoleIllustrationRgba(source, { pixelRatio })).toMatchObject({ complete: false, code: "INVALID_OPTIONS" });
    }
    const hugeResult = createHoleIllustrationRenderPlan(releasedSnapshot(), {
      frame: "north-up",
      biome: "parkland",
      season: "summer",
      contrast: "high-contrast",
      viewport: { width: 8_192, height: 8_192, padding: 0 },
    });
    expect(hugeResult.complete).toBe(true);
    if (!hugeResult.complete) return;
    const huge = hugeResult.plan;
    expect(renderHoleIllustrationSvg(huge)).toMatchObject({ complete: true, width: 8_192, height: 8_192 });
    expect(preflightHoleIllustrationRender(huge, { pixelRatio: 1 })).toMatchObject({
      complete: true,
      svg: { withinLimit: true },
      rgba: { withinLimits: false },
    });
    expect(renderHoleIllustrationRgba(huge, { pixelRatio: 1 })).toMatchObject({ complete: false, code: "ALLOCATION_EXCEEDED" });

    const invalidDimensions = sealPlan({
      ...source,
      settings: { ...source.settings, viewport: { ...source.settings.viewport, width: 0 } },
      hash: undefined,
    });
    expect(renderHoleIllustrationSvg(invalidDimensions)).toMatchObject({ complete: false, code: "INVALID_PLAN" });
    expect(HOLE_ILLUSTRATION_OUTPUT_LIMITS.maxRasterBytes).toBe(64 * 1024 * 1024);
  });
});
