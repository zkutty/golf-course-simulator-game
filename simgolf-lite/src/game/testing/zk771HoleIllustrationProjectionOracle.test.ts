import { describe, expect, it } from "vitest";
import { buildArchitectureReferencePlan } from "../architecture/referencePlan";
import { buildHoleIllustrationExport } from "../holeIllustration/export";
import type { HoleIllustrationPreviewSettings } from "../holeIllustration/preview";
import { createHoleIllustrationSnapshot } from "../holeIllustration/snapshot";
import type { HoleIllustrationSnapshot } from "../holeIllustration/types";
import { zk771CertificationEstate, zk771Evidence, zk771Settings } from "./zk771HoleIllustrationFixtures";
import { assertNear, atlasHoleIds, atlasInnerSvg, atlasOuterPoint, atlasPanel, attributePoint, elements, numericAttribute, parseSvg, pointList, project, projectSnapshotPoint, semanticElement, semanticPoint } from "./zk771HoleIllustrationProjectionOracle";

function snapshot(course: ReturnType<typeof zk771CertificationEstate>, settings: HoleIllustrationPreviewSettings): HoleIllustrationSnapshot {
  const result = createHoleIllustrationSnapshot(course, { layoutId: settings.layoutId, routeSource: "published", holeId: settings.holeId, teeSet: settings.teeSet, pinRotation: settings.pinRotation });
  expect(result.complete, result.complete ? "" : result.message).toBe(true);
  if (!result.complete) throw new Error("Expected authoritative snapshot.");
  return result.snapshot;
}

function single(course: ReturnType<typeof zk771CertificationEstate>, settings: HoleIllustrationPreviewSettings): string {
  const result = buildHoleIllustrationExport(course, settings, zk771Evidence(settings), { kind: "single" });
  expect(result.complete, result.complete ? "" : result.message).toBe(true);
  if (!result.complete) throw new Error("Expected final single export.");
  return result.svg;
}

function atlas(course: ReturnType<typeof zk771CertificationEstate>, settings: HoleIllustrationPreviewSettings): string {
  const result = buildHoleIllustrationExport(course, settings, zk771Evidence(settings), { kind: "atlas" });
  expect(result.complete, result.complete ? "" : result.message).toBe(true);
  if (!result.complete) throw new Error("Expected final atlas export.");
  return result.svg;
}

function twoShotReferenceCourse() {
  const course = structuredClone(zk771CertificationEstate(9));
  const hole = course.holes[3];
  hole.tee = { x: 3, y: 32 };
  hole.teeBoxes = { forward: { x: 4, y: 32 }, member: { x: 3, y: 32 }, championship: { x: 2, y: 32 } };
  hole.green = { x: 58, y: 32 };
  hole.pinPositions = { A: { x: 58, y: 32 }, B: { x: 57, y: 32 }, C: { x: 58, y: 31 } };
  hole.waypoints = [{ x: 30, y: 32 }];
  hole.parMode = "MANUAL";
  hole.parManual = 4;
  for (let x = 2; x <= 58; x += 1) course.tiles[32 * course.width + x] = "fairway";
  course.tiles[32 * course.width + 2] = "tee";
  course.tiles[32 * course.width + 58] = "green";
  return course;
}

function expectedAtlasPanel(index: number) {
  const width = 3000, height = 2500, margin = 48, gap = 24, header = 360, columns = 3;
  const cardWidth = (width - margin * 2 - gap * (columns - 1)) / columns;
  const rowHeight = (height - header - margin - gap * 2) / 3;
  const imageHeight = Math.min(rowHeight - 44, cardWidth * 2 / 3);
  return {
    x: margin + (index % columns) * (cardWidth + gap),
    y: header + Math.floor(index / columns) * (rowHeight + gap) + 44,
    width: cardWidth,
    height: imageHeight,
  };
}

function tamperSemanticAttribute(svg: string, semantic: string, name: string, replacement: number): string {
  const semanticIndex = svg.indexOf(`data-semantic="${semantic}"`);
  if (semanticIndex < 0) throw new Error(`Cannot tamper missing ${semantic}.`);
  const start = svg.lastIndexOf("<", semanticIndex);
  const end = svg.indexOf(">", semanticIndex);
  const tag = svg.slice(start, end + 1);
  const current = ` ${name}="${semanticPoint(svg, semantic)[name === "cx" ? "x" : "y"]}"`;
  if (!tag.includes(current)) throw new Error(`Cannot tamper missing ${name}.`);
  return `${svg.slice(0, start)}${tag.replace(current, ` ${name}="${replacement}"`)}${svg.slice(end + 1)}`;
}

describe("ZK-1137 independent illustration projection oracle", () => {
  it("fails closed for absent SVG numeric attributes and preserves xMidYMid meet placement math", () => {
    expect(() => semanticPoint('<svg><ellipse data-semantic="tee:member" cy="2"/></svg>', "tee:member")).toThrow("Missing numeric SVG cx");
    const known = elements(parseSvg('<svg x="11" y="7" width="100" height="100" viewBox="0 0 960 640" preserveAspectRatio="xMidYMid meet"/>'), "svg")[0];
    assertNear(atlasOuterPoint(known, { x: 0, y: 0 }), { x: 11, y: 23.666666666666668 }, .000001, "known transform");
    const zeroWidth = elements(parseSvg('<svg x="0" y="0" width="0" height="100" viewBox="0 0 960 640" preserveAspectRatio="xMidYMid meet"/>'), "svg")[0];
    expect(() => atlasOuterPoint(zeroWidth, { x: 1, y: 1 })).toThrow("Invalid nested atlas dimensions");
  });

  it("projects authoritative snapshot tee, pin, route, water corners, and obstacle centres into final single SVG", () => {
    const course = zk771CertificationEstate(9);
    const settings = { ...zk771Settings(course, "championship", "C"), holeId: course.holes[1].id!, frame: "tee-to-green" as const };
    const source = snapshot(course, settings);
    expect(source.waypoints.length).toBeGreaterThan(0);
    const document = parseSvg(single(course, settings));
    assertNear(attributePoint(semanticElement(document, "tee:championship", "ellipse")), projectSnapshotPoint(source, source.tee, settings.frame, .5, .5), .001, "tee");
    assertNear(attributePoint(semanticElement(document, "pin:C", "ellipse")), projectSnapshotPoint(source, source.pin, settings.frame, .5, .5), .001, "pin");
    const route = pointList(semanticElement(document, "route:tee-waypoints-pin", "polyline"));
    expect(route).toHaveLength(source.waypoints.length + 2);
    for (const [index, item] of [source.tee, ...source.waypoints, source.pin].entries()) assertNear(route[index], projectSnapshotPoint(source, item, settings.frame, .5, .5));

    const waterCourse = zk771CertificationEstate(9);
    const waterSettings = { ...zk771Settings(waterCourse), holeId: waterCourse.holes[3].id!, frame: "north-up" as const };
    const waterSnapshot = snapshot(waterCourse, waterSettings);
    const water = waterSnapshot.terrain.find((item) => item.terrain === "water");
    expect(water).toBeDefined();
    if (!water) throw new Error("Expected captured water cell.");
    const waterCorners = pointList(semanticElement(parseSvg(single(waterCourse, waterSettings)), "terrain:water", "polygon"));
    expect(waterCorners).toHaveLength(4);
    [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([dx, dy], index) => assertNear(waterCorners[index], projectSnapshotPoint(waterSnapshot, water, waterSettings.frame, dx, dy)));

    const woodedCourse = zk771CertificationEstate(9);
    const woodedSettings = { ...zk771Settings(woodedCourse), holeId: woodedCourse.holes[5].id!, frame: "north-up" as const };
    const woodedSnapshot = snapshot(woodedCourse, woodedSettings);
    const woodedDocument = parseSvg(single(woodedCourse, woodedSettings));
    for (const [index, obstacle] of woodedSnapshot.obstacles.entries()) {
      const element = elements(woodedDocument, "ellipse").find((item) => item.getAttribute("id") === `obstacle-${index}-${obstacle.x}-${obstacle.y}`);
      expect(element, `missing captured ${obstacle.type} obstacle`).toBeDefined();
      if (element) assertNear(attributePoint(element), projectSnapshotPoint(woodedSnapshot, obstacle, woodedSettings.frame, .5, .5));
    }
  });

  it("compares independently-built M69 geometry, nested atlas transforms, and deliberate M69 atlas omission", () => {
    const course = twoShotReferenceCourse();
    const settings = { ...zk771Settings(course, "championship", "C"), holeId: course.holes[3].id!, frame: "north-up" as const };
    const source = snapshot(course, settings);
    const document = parseSvg(single(course, settings));
    const plan = buildArchitectureReferencePlan(course, course.holes[3], settings.teeSet, settings.pinRotation);
    expect(plan.status).toBe("complete");
    expect(plan.segments.length).toBeGreaterThan(1);
    expect(plan.landingZones.length).toBeGreaterThan(0);
    const segments = elements(document, "line").filter((item) => item.getAttribute("data-m69-segment") === "true");
    expect(segments).toHaveLength(plan.segments.length);
    for (const [index, segment] of plan.segments.entries()) {
      assertNear(attributePoint(segments[index], "x1", "y1"), project(source, segment.from, settings.frame));
      assertNear(attributePoint(segments[index], "x2", "y2"), project(source, segment.to, settings.frame));
    }
    const landings = elements(document, "circle").filter((item) => item.hasAttribute("data-m69-landing"));
    expect(landings).toHaveLength(plan.landingZones.length);
    for (const [index, landing] of plan.landingZones.entries()) assertNear(attributePoint(landings[index]), project(source, landing.center, settings.frame));

    const atlasSvg = atlas(course, settings);
    expect(atlasSvg).not.toContain("data-m69-segment");
    expect(atlasSvg).not.toContain("data-m69-landing");
    const nested = atlasInnerSvg(atlasPanel(atlasSvg, settings.holeId));
    const placement = expectedAtlasPanel(course.layouts![0].publishedHoleIds.indexOf(settings.holeId));
    expect(numericAttribute(nested, "x")).toBeCloseTo(placement.x, 8);
    expect(numericAttribute(nested, "y")).toBeCloseTo(placement.y, 8);
    expect(numericAttribute(nested, "width")).toBeCloseTo(placement.width, 8);
    expect(numericAttribute(nested, "height")).toBeCloseTo(placement.height, 8);
    expect(nested.getAttribute("viewBox")).toBe("0 0 960 640");
    assertNear(atlasOuterPoint(nested, attributePoint(semanticElement(nested, "tee:championship", "ellipse"))), atlasOuterPoint(nested, projectSnapshotPoint(source, source.tee, settings.frame, .5, .5)));
    assertNear(atlasOuterPoint(nested, attributePoint(semanticElement(nested, "pin:C", "ellipse"))), atlasOuterPoint(nested, projectSnapshotPoint(source, source.pin, settings.frame, .5, .5)));
    const nestedRoute = pointList(semanticElement(nested, "route:tee-waypoints-pin", "polyline"));
    const expectedRoute = [source.tee, ...source.waypoints, source.pin].map((point) => atlasOuterPoint(nested, projectSnapshotPoint(source, point, settings.frame, .5, .5)));
    nestedRoute.forEach((point, index) => assertNear(atlasOuterPoint(nested, point), expectedRoute[index]));
    const waterCourse = zk771CertificationEstate(9);
    const waterSettings = { ...zk771Settings(waterCourse, "championship", "C"), holeId: waterCourse.holes[3].id!, frame: "north-up" as const };
    const waterSource = snapshot(waterCourse, waterSettings);
    const water = waterSource.terrain.find((item) => item.terrain === "water");
    expect(water).toBeDefined();
    if (!water) throw new Error("Expected atlas water source cell.");
    const waterNested = atlasInnerSvg(atlasPanel(atlas(waterCourse, waterSettings), waterSettings.holeId));
    const waterCorners = pointList(semanticElement(waterNested, "terrain:water", "polygon"));
    [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([dx, dy], index) => assertNear(
      atlasOuterPoint(waterNested, waterCorners[index]),
      atlasOuterPoint(waterNested, projectSnapshotPoint(waterSource, water, waterSettings.frame, dx, dy)),
    ));
  });

  it("exports exactly each disjoint published layout and names coordinate tampering as a verifier failure", () => {
    const course = zk771CertificationEstate(18, "disjoint");
    expect(course.layouts).toHaveLength(2);
    const published = new Set<string>();
    for (const layout of course.layouts!) {
      const settings = { ...zk771Settings(course, "championship", "C"), layoutId: layout.id, holeId: layout.publishedHoleIds[0], frame: "north-up" as const };
      expect(atlasHoleIds(atlas(course, settings))).toEqual(layout.publishedHoleIds);
      for (const id of layout.publishedHoleIds) {
        expect(published.has(id), `layout leak for ${id}`).toBe(false);
        published.add(id);
      }
    }
    expect(published.size).toBe(18);
    const singleCourse = zk771CertificationEstate(9);
    const settings = { ...zk771Settings(singleCourse), frame: "north-up" as const };
    const source = snapshot(singleCourse, settings);
    const serialized = single(singleCourse, settings);
    const tee = attributePoint(semanticElement(parseSvg(serialized), "tee:member", "ellipse"));
    expect(() => assertNear({ x: 1001, y: 0 }, { x: 1000, y: 0 }, 1, "tee")).not.toThrow();
    expect(() => assertNear({ x: 1001.001, y: 0 }, { x: 1000, y: 0 }, 1, "tee")).toThrow("tee coordinate mismatch");
    const tampered = tamperSemanticAttribute(serialized, "tee:member", "cx", tee.x + 1);
    expect(() => assertNear(semanticPoint(tampered, "tee:member"), projectSnapshotPoint(source, source.tee, settings.frame, .5, .5), .001, "tee")).toThrow("tee coordinate mismatch");
  });
});
