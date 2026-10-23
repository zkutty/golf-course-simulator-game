import * as PIXI from "pixi.js";
import { describe, expect, it } from "vitest";
import { createArchitectureOverlaySceneSystem } from "./architectureOverlayScene";
import { buildArchitectureRouting } from "../../../game/architecture/routingLabels";
import { routingLabelFixture } from "../../../game/architecture/routingLabelFixtures";
import { tileCenterIso } from "../../../game/render/iso";
import type { Point } from "../../../game/models/types";
import { hashCanonicalValue } from "../../../utils/canonical";
import type { RenderSnapshot } from "../../../game/render/renderSnapshot";
import { architectureOverlayRevisionDependencies } from "../../../game/render/renderSnapshot";

function snapshot(overrides: Partial<RenderSnapshot> = {}): RenderSnapshot {
  const course = routingLabelFixture("incomplete");
  return { course, holes: course.holes, obstacles: [], effectiveTiles: course.tiles, rotation: 0, draftTee: null, draftGreen: null, graphicsQuality: "high", colorVision: "standard", reducedMotion: true, animationsEnabled: false, showObstacles: false, showMarkers: true, surfaceHeightAt: () => 0, atlasRevision: 1, surveyMode: false, worldSeed: 676, revisions: { atmosphere: 0, surfaceCare: 0, structuresProps: 0, playerProCollection: 0, naturalProps: 0, overlaysDiagnostics: 0, estateSurvey: 0, architectureOverlay: 1 }, architectureOverlay: { kind: "routing", traces: [], cells: [], points: [], routing: buildArchitectureRouting(course, { courseId: "layout-1", teeSet: "member", pinRotation: "A" }) }, ...overrides };
}
describe("ZK-676 scene ownership and authority", () => {
  it("owns one bounded routing container, draws no incomplete connectors, and destroys every descendant on toggle/dispose", () => {
    const layer = new PIXI.Container(), sibling = new PIXI.Container();
    sibling.label = "unrelated"; layer.addChild(sibling);
    const scene = createArchitectureOverlaySceneSystem(layer);
    for (let i = 0; i < 12; i++) {
      scene.render!(snapshot());
      expect(layer.children).toHaveLength(2);
      const routing = layer.children[1] as PIXI.Container;
      expect(routing.children).toHaveLength(4);
      expect(routing.children[0].getLocalBounds().width).toBeGreaterThan(0);
      expect(routing.children.slice(1).map(c => c.getLocalBounds().width)).toEqual([0, 0, 0]);
      const children = [...routing.children];
      scene.render!(snapshot({ architectureOverlay: null }));
      expect(layer.children).toEqual([sibling]);
      expect(routing.destroyed).toBe(true); expect(children.every(child => child.destroyed)).toBe(true);
    }
    scene.render!(snapshot()); scene.dispose!(); scene.dispose!();
    expect(layer.children).toEqual([sibling]);
  });
  it("retains controls across equivalent read-only geometry updates and changes only selection emphasis", () => {
    const layer = new PIXI.Container(), scene = createArchitectureOverlaySceneSystem(layer), first = snapshot();
    scene.render!(first);
    const container = layer.children[0] as PIXI.Container;
    const next = { ...first, architectureOverlay: { ...first.architectureOverlay!, routing: structuredClone(first.architectureOverlay!.routing), selectedRoutingHoleId: "routing-2" } };
    scene.render!(next);
    expect(layer.children[0]).toBe(container);
    expect(container.children[0].alpha).toBe(.28);
    expect(container.children[1].alpha).toBe(1);
    scene.dispose!();
  });
  const renderSpine = (spine: Point[]) => {
    const original = snapshot();
    const course = { ...original.course, holes: original.course.holes.map(hole => hole.id === "routing-1" ? {
      ...hole, tee: spine[0], green: spine.at(-1)!, teeBoxes: { member: spine[0] }, pinPositions: { A: spine.at(-1)! }, waypoints: spine.slice(1, -1),
    } : hole) };
    const source = snapshot({ course, holes: course.holes, architectureOverlay: { kind: "routing", traces: [], cells: [], points: [], routing: buildArchitectureRouting(course, { courseId: "layout-1", teeSet: "member", pinRotation: "A" }) } });
    const sourceHash = hashCanonicalValue({ course, overlay: source.architectureOverlay });
    const layer = new PIXI.Container(), scene = createArchitectureOverlaySceneSystem(layer);
    scene.render!(source);
    const graphic = (layer.children[0] as PIXI.Container).children[0] as PIXI.Graphics;
    const polygons = graphic.context.instructions.flatMap(instruction => instruction.action === "fill"
      ? instruction.data.path.instructions.filter(path => path.action === "poly").map(path => (path.data[0] as number[]).slice()) : []);
    const line = graphic.context.instructions.find(instruction => instruction.action === "stroke");
    if (!line || line.action !== "stroke") throw new Error("Missing native routing stroke");
    const drawnSpine = line.data.path.instructions.map(path => path.data.slice(0, 2));
    expect(drawnSpine).toEqual(spine.map(point => { const p = tileCenterIso(point.x, point.y); return [p.x, p.y]; }));
    expect(hashCanonicalValue({ course, overlay: source.architectureOverlay })).toBe(sourceHash);
    expect(source.activeShotDestinations).toBeUndefined();
    scene.dispose!();
    return polygons;
  };

  it.each([
    { direction: "north", spine: [{ x: 8, y: 8 }, { x: 6, y: 6 }, { x: 4, y: 4 }, { x: 4, y: 4 }], expected: { x: 0, y: -1 } },
    { direction: "diagonal", spine: [{ x: 2, y: 4 }, { x: 4, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 4 }], expected: { x: 2 / Math.sqrt(5), y: 1 / Math.sqrt(5) } },
  ])("drawn arrow follows the $direction terminal direction despite repeated pin coordinates", ({ spine, expected }) => {
    const polygons = renderSpine(spine);
    expect(polygons).toHaveLength(1);
    const triangle = polygons[0];
    expect(triangle).toHaveLength(6);
    expect(triangle.every(Number.isFinite)).toBe(true);
    // Inspect the actual native triangle: its apex must point from the base
    // toward the pin, parallel to the known screen-space terminal direction.
    const base = { x: (triangle[2] + triangle[4]) / 2, y: (triangle[3] + triangle[5]) / 2 };
    const forward = { x: triangle[0] - base.x, y: triangle[1] - base.y };
    const length = Math.hypot(forward.x, forward.y);
    expect(length).toBeGreaterThan(0);
    expect(forward.x / length).toBeCloseTo(expected.x, 10);
    expect(forward.y / length).toBeCloseTo(expected.y, 10);
    const pin = tileCenterIso(spine.at(-1)!.x, spine.at(-1)!.y);
    expect((pin.x - triangle[0]) * expected.x + (pin.y - triangle[1]) * expected.y).toBeGreaterThan(0);
  });

  it("drawn arrow is absent when every projected spine coordinate is identical", () => {
    expect(renderSpine(Array.from({ length: 5 }, () => ({ x: 4, y: 4 })))).toEqual([]);
  });
  it("declares the exact optional callback as an invalidation input alongside the unchanged overlay reference", () => {
    const s = snapshot(), callback = () => {};
    const inputs = { ...s, activePinRotation: s.course.activePinRotation, onArchitectureHoleSelect: callback };
    expect(architectureOverlayRevisionDependencies(inputs)).toContain(callback);
    expect(architectureOverlayRevisionDependencies(inputs)).toContain(s.architectureOverlay);
  });
});
