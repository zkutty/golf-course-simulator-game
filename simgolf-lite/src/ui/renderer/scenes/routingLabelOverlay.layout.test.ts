import { afterEach, describe, expect, it, vi } from "vitest";
import * as PIXI from "pixi.js";
import { createRoutingLabelOverlay } from "./routingLabelOverlay";
import { buildArchitectureRouting } from "../../../game/architecture/routingLabels";
import { routingLabelFixture } from "../../../game/architecture/routingLabelFixtures";
import { tileCenterIso } from "../../../game/render/iso";
import type { RenderSnapshot } from "../../../game/render/renderSnapshot";

function harness() {
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
  const snapshot = {
    course, holes: course.holes, rotation: 0,
    surfaceHeightAt: () => 0,
    architectureOverlay: { kind: "routing", routing: buildArchitectureRouting(course, { courseId: "layout-1", teeSet: "member", pinRotation: "A" }) },
  } as RenderSnapshot;
  const select = vi.fn();
  snapshot.onArchitectureHoleSelect = select;
  const canvas = { getBoundingClientRect: () => { layoutDirty = false; return { x: 0, y: 0, width: 1400, height: 900, right: 1400, bottom: 900 }; } };
  const overlay = createRoutingLabelOverlay(snapshot, point => tileCenterIso(point.x, point.y), () => {}, () => canvas as HTMLCanvasElement);
  const render = () => overlay.container.onRender!({} as PIXI.Renderer);
  const placement = () => buttons.map(button => ({ id: button.dataset.testid, hidden: button.hidden, fits: button.dataset.fits, left: button.style.left, top: button.style.top }));
  return { overlay, buttons, select, events, render, placement,
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
});
