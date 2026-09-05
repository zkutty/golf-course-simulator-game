import { describe, expect, it } from "vitest";
import { hashCanonicalValue } from "../../utils/canonical";
import type { Course } from "../models/types";
import {
  createHoleIllustrationRenderPlan,
  HOLE_ILLUSTRATION_LAYER_ORDER,
  type HoleIllustrationRenderLayer,
  type HoleIllustrationRenderPlan,
  type HoleIllustrationRenderPrimitive,
} from "./renderPlan";
import { createHoleIllustrationSnapshot } from "./snapshot";
import {
  HOLE_ILLUSTRATION_OUTPUT_LIMITS,
  renderHoleIllustrationRgba,
  renderHoleIllustrationSvg,
} from "./renderer";

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
  const terrainFills = ["#806650", "#60b044", "#8ee36a"] as const;
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
      fill: "#003d19",
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
    const snapshot = releasedSnapshot();
    let cases = 0;
    for (const frame of ["north-up", "tee-to-green"] as const) {
      for (const biome of ["parkland", "links", "desert"] as const) {
        for (const season of ["spring", "summer", "autumn", "winter"] as const) {
          for (const contrast of ["standard", "high-contrast"] as const) {
            const planned = createHoleIllustrationRenderPlan(snapshot, {
              frame,
              biome,
              season,
              contrast,
              viewport: { width: 96, height: 72, padding: 0.08 },
            });
            expect(planned.complete).toBe(true);
            if (!planned.complete) continue;
            expect(renderHoleIllustrationSvg(planned.plan)).toMatchObject({
              complete: true,
              planHash: planned.plan.hash,
            });
            cases++;
          }
        }
      }
    }
    expect(cases).toBe(48);
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
    expect(hashes).toEqual(["815044c0", "a97c723d"]);
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
    expect(hashCanonicalValue(result.svg)).toBe("415e435c");
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
    expect(pixel(result.data, result.width, 81, 61)).toEqual([125, 200, 93, 255]);
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
      budget: { ...source.budget, sourceFeatures: 402, primitiveCount: 412, pointCount: 453 },
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
        if (item.id === "selected-tee" || item.id === "selected-pin") return { ...item, strokeWidth: 0.01 };
        return item;
      }),
    }));
    const dense = sealPlan({
      ...source,
      settings: { ...source.settings, viewport: { ...source.settings.viewport, width: 500, height: 400 } },
      layers: scaledLayers,
      budget: { ...source.budget, sourceFeatures: 4_002, primitiveCount: 4_012, pointCount: 4_053 },
      hash: undefined,
    });
    expect(renderHoleIllustrationRgba(dense, { pixelRatio: 4 }))
      .toMatchObject({ complete: false, code: "ALLOCATION_EXCEEDED" });
  });

  it("composites producer-opacity joins once and matches explicit round SVG caps and joins", () => {
    const source = fixture();
    const result = renderHoleIllustrationRgba(source, { pixelRatio: 2 });
    expect(result.complete).toBe(true);
    if (!result.complete) return;
    expect(pixel(result.data, result.width, 84, 84)).toEqual([12, 21, 8, 255]);
    expect(pixel(result.data, result.width, 89, 89)).toEqual([12, 21, 8, 255]);
    expect(pixel(result.data, result.width, 29, 29)).toEqual([31, 31, 31, 255]);
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
