import { afterEach, describe, expect, it, vi } from "vitest";
import * as PIXI from "pixi.js";
import { createRoutingLabelOverlay } from "./routingLabelOverlay";
import { buildArchitectureRouting, placeRoutingLabels } from "../../../game/architecture/routingLabels";
import { routingLabelFixture } from "../../../game/architecture/routingLabelFixtures";
import { isoToWorld, tileCenterIso } from "../../../game/render/iso";
import type { RenderSnapshot } from "../../../game/render/renderSnapshot";

function harness(rotation: 0 | 90 | 180 | 270 = 0) {
  let layoutDirty = false;
  let forcedLabelLayouts = 0;
  let measuredLabels = 0;
  let invalidate = () => {};
  const events: string[] = [];
  const buttons: Element[] = [];
  class Element {
    dataset: Record<string, string> = {};
    style: Record<string, string> = new Proxy<Record<string, string>>({}, { set(target, key: string, value: string) { target[key] = value; layoutDirty = true; return true; } });
    textContent = "";
    className = "";
    type = "";
    title = "";
    private concealed = false;
    readonly attributes = new Map<string, string>();
    readonly listeners = new Map<string, () => void>();
    get hidden() { return this.concealed; }
    set hidden(value: boolean) {
      if (value !== this.concealed) layoutDirty = true;
      if (!value) events.push(`reveal:${this.dataset.testid}`);
      this.concealed = value;
    }
    setAttribute(key: string, value: string) { this.attributes.set(key, value); }
    addEventListener(key: string, listener: () => void) { this.listeners.set(key, listener); }
    removeEventListener(key: string) { this.listeners.delete(key); }
    append() {}
    remove() {}
    getBoundingClientRect() {
      events.push(`measure:${this.dataset.testid}`);
      measuredLabels++;
      if (layoutDirty) forcedLabelLayouts++;
      layoutDirty = false;
      return { x: 0, y: 0, width: this.hidden ? 0 : 36 + this.textContent.length * 4, height: this.hidden ? 0 : 36 };
    }
  }
  vi.stubGlobal("document", {
    body: { append() {} }, documentElement: {}, activeElement: null,
    createElement(tag: string) { const element = new Element(); if (tag === "button") buttons.push(element); return element; },
    querySelectorAll() { return [{ getBoundingClientRect: () => ({ x: 600, y: 0, width: 800, height: 900 }) }]; },
  });
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { invalidate = callback; } observe() {} disconnect() {} });
  vi.stubGlobal("MutationObserver", undefined);
  const course = routingLabelFixture("crossing");
  const select = vi.fn();
  const snapshot: RenderSnapshot = {
    course, holes: course.holes, obstacles: course.obstacles, effectiveTiles: course.tiles,
    rotation, draftTee: null, draftGreen: null,
    graphicsQuality: "high", colorVision: "standard", reducedMotion: true,
    animationsEnabled: false, showObstacles: false, showMarkers: true,
    atlasRevision: 1, surveyMode: false, worldSeed: 676,
    surfaceHeightAt: () => 0,
    revisions: { atmosphere: 0, surfaceCare: 0, structuresProps: 0, playerProCollection: 0, naturalProps: 0, overlaysDiagnostics: 0, estateSurvey: 0, architectureOverlay: 1 },
    architectureOverlay: { kind: "routing", traces: [], cells: [], points: [], routing: buildArchitectureRouting(course, { courseId: "layout-1", teeSet: "member", pinRotation: "A" }) },
    onArchitectureHoleSelect: select,
  };
  const canvas = { getBoundingClientRect: () => { layoutDirty = false; return { x: 0, y: 0, width: 1400, height: 900, right: 1400, bottom: 900 }; } };
  const project = (point: { x: number; y: number }) => tileCenterIso(point.x, point.y, 0, rotation);
  const overlay = createRoutingLabelOverlay(snapshot, project, () => {}, () => canvas as HTMLCanvasElement);
  const render = () => overlay.container.onRender!({} as PIXI.Renderer);
  const placement = () => buttons.map(button => ({ id: button.dataset.testid, hidden: button.hidden, fits: button.dataset.fits, left: button.style.left, top: button.style.top }));
  return { overlay, buttons, select, events, render, placement, snapshot, project,
    invalidate: () => invalidate(),
    resetMeasures() { forcedLabelLayouts = 0; measuredLabels = 0; events.length = 0; },
    measurements: () => ({ forcedLabelLayouts, measuredLabels }),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("routing control measurement and placement", () => {
  it("preserves collision, reserved-panel and offscreen placement after previously hidden controls are revealed", () => {
    const h = harness();
    h.render();
    const expected = h.placement();
    expect(expected.some(control => control.hidden)).toBe(true);
    expect(expected.some(control => !control.hidden)).toBe(true);
    for (const control of expected.filter(control => !control.hidden)) {
      expect(Number.parseFloat(control.left)).toBeLessThan(600);
    }
    for (const button of h.buttons) button.hidden = true;
    h.invalidate(); h.render();
    expect(h.placement()).toEqual(expected);
    h.buttons[0].listeners.get("click")!();
    expect(h.select).toHaveBeenCalledWith(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }), "routing-1");
    h.overlay.dispose();
  });

  it("coalesces visibility invalidations before measuring every control", () => {
    const h = harness();
    h.render();
    for (const button of h.buttons) button.hidden = true;
    h.invalidate(); h.resetMeasures(); h.render();
    expect(h.measurements().measuredLabels).toBe(h.buttons.length);
    // A layout read flushes pending visibility changes. One batch requires at
    // most one flush regardless of how many controls were previously hidden.
    expect(h.measurements().forcedLabelLayouts).toBeLessThanOrEqual(1);
    h.overlay.dispose();
  });

  it("does no label measurement during unchanged idle render traversals", () => {
    const h = harness();
    h.render(); h.resetMeasures(); h.render();
    expect(h.measurements()).toEqual({ forcedLabelLayouts: 0, measuredLabels: 0 });
    h.overlay.dispose();
  });

  it.each([0, 90, 180, 270] as const)("uses the current nested-parent transform before Pixi's transform refresh at rotation %s", rotation => {
    const h = harness(rotation);
    const stage = new PIXI.Container({ isRenderGroup: true });
    const parent = new PIXI.Container(), nested = new PIXI.Container();
    stage.addChild(parent); parent.addChild(nested); nested.addChild(h.overlay.container);
    stage.position.set(110, 70);
    parent.position.set(510, 160); parent.scale.set(.45, .35); parent.rotation = .12; parent.pivot.set(8, 13);
    const pivot = h.project({ x: h.snapshot.course.width / 2, y: h.snapshot.course.height / 2 });
    nested.position.set(17, -11); nested.rotation = -.18; nested.pivot.set(pivot.x + 4, pivot.y + 7);
    h.overlay.container.position.set(3, 9);
    const group = stage.renderGroup;
    if (!group) throw new Error("Expected a real Pixi render group");
    stage.updateLocalTransform();
    PIXI.updateRenderGroupTransforms(group, true);
    const courseBefore = structuredClone(h.snapshot.course);
    const routes = h.snapshot.architectureOverlay!.routing!;
    const routesBefore = structuredClone(routes);
    const viewport = { x: 0, y: 0, width: 1400, height: 900 };
    const reserved = [{ x: 600, y: 0, width: 800, height: 900 }];
    const originalPlacement = () => {
      const requests = h.buttons.map(button => {
        const route = routes.find(route => route.holeId === button.dataset.holeId)!;
        const point = button.dataset.role === "number" ? route.anchor : button.dataset.role === "tee" ? route.tee! : route.pin!;
        const center = h.overlay.container.toGlobal(h.project(point));
        return { id: `${route.holeId}:${button.dataset.role}`, center, width: 36 + button.textContent.length * 4, height: 36 };
      });
      return placeRoutingLabels(requests, viewport, reserved, point => {
        const local = h.overlay.container.toLocal(point);
        const world = isoToWorld(local.x, local.y, rotation);
        const x = Math.floor(world.x), y = Math.floor(world.y), course = h.snapshot.course;
        return x >= 0 && y >= 0 && x < course.width && y < course.height && !["water", "wetland", "sand", "waste_area"].includes(course.tiles[y * course.width + x]);
      });
    };
    const freshReadsPerLayout: number[] = [];
    const assertPlacement = () => {
      const expected = originalPlacement();
      const fresh = h.overlay.container.getGlobalTransform();
      const matrixBefore = fresh.clone();
      // Pixi invokes the actual onRender list before updating render-group transforms.
      const freshRead = vi.spyOn(h.overlay.container, "getGlobalTransform");
      group.runOnRender({} as PIXI.Renderer);
      const matrices = freshRead.mock.results.map(result => result.value);
      freshRead.mockRestore();
      freshReadsPerLayout.push(matrices.length);
      for (const matrix of matrices) expect(matrix).toEqual(matrixBefore);
      h.buttons.forEach((button, index) => {
        const placement = expected[index];
        expect(Number.parseFloat(button.style.left)).toBeCloseTo(placement.placed.x, 9);
        expect(Number.parseFloat(button.style.top)).toBeCloseTo(placement.placed.y, 9);
        const offscreen = placement.center.x < 0 || placement.center.x > viewport.width || placement.center.y < 0 || placement.center.y > viewport.height;
        expect(button.hidden).toBe(offscreen || !placement.fits);
        expect(button.dataset.fits).toBe(String(placement.fits));
      });
      const scale = Math.hypot(fresh.a, fresh.b);
      let leaderCount = 0;
      for (const [index, route] of routes.entries()) {
        const graphic = h.overlay.container.children[index] as PIXI.Graphics;
        const leaders = graphic.context.instructions.filter(instruction => instruction.action === "stroke" && Math.abs(instruction.data.style.width - 1 / scale) < 1e-9);
        const expectedLeaders = expected.filter(placement => placement.id.startsWith(`${route.holeId}:`) && placement.fits && Math.hypot(placement.placed.x - placement.center.x, placement.placed.y - placement.center.y) > 2);
        expect(leaders).toHaveLength(expectedLeaders.length);
        leaders.forEach((instruction, leaderIndex) => {
          if (instruction.action !== "stroke") throw new Error("Expected leader stroke");
          const placement = expectedLeaders[leaderIndex];
          const from = h.overlay.container.toLocal(placement.center), to = h.overlay.container.toLocal(placement.placed);
          const path = instruction.data.path.instructions.slice(-2);
          expect(path.map(point => point.action)).toEqual(["moveTo", "lineTo"]);
          expect(path[0].data[0]).toBeCloseTo(from.x, 9); expect(path[0].data[1]).toBeCloseTo(from.y, 9);
          expect(path[1].data[0]).toBeCloseTo(to.x, 9); expect(path[1].data[1]).toBeCloseTo(to.y, 9);
          leaderCount++;
        });
      }
      expect(leaderCount).toBeGreaterThan(0);
      expect(fresh).toEqual(matrixBefore);
      expect(h.snapshot.course).toEqual(courseBefore); expect(routes).toEqual(routesBefore);
    };
    assertPlacement();
    const cached = h.overlay.container.worldTransform.clone();
    parent.position.set(440, 210); parent.scale.set(.35, .5); parent.rotation = -.1;
    nested.rotation = .22; nested.pivot.set(pivot.x + 11, pivot.y + 3);
    expect(h.overlay.container.worldTransform).toEqual(cached);
    expect(h.overlay.container.getGlobalTransform()).not.toEqual(cached);
    // The camera changes before the render-group transform phase. No external
    // invalidation is sent: the current matrix must drive the layout signature.
    assertPlacement();
    expect(freshReadsPerLayout).toEqual([1, 1]);
    PIXI.updateRenderGroupTransforms(group, true);
    h.resetMeasures();
    const idleFreshRead = vi.spyOn(h.overlay.container, "getGlobalTransform");
    group.runOnRender({} as PIXI.Renderer);
    expect(idleFreshRead).toHaveBeenCalledTimes(1);
    idleFreshRead.mockRestore();
    expect(h.measurements()).toEqual({ forcedLabelLayouts: 0, measuredLabels: 0 });
    h.overlay.dispose(); stage.destroy({ children: true });
  });

});
