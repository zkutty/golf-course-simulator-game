import { afterEach, describe, expect, it, vi } from "vitest";
import { nextRotation, worldToIso, type IsoRotation } from "../../game/render/iso";
import type { Course } from "../../game/models/types";
import { DEFAULT_KEYBINDINGS } from "../../accessibility/keybindings";
import type { ViewportPointerEventType, ViewportPointerListener } from "./viewportPointerEvents";
import {
  ViewportInputController,
  fitViewportZoomForTileBounds,
  type ViewportApplicationPort,
  type ViewportInputConfig,
  type ViewportWorldPort,
} from "./viewportInputController";

class FakeEventSurface extends EventTarget {
  clientWidth = 800;
  clientHeight = 600;
  style = { cursor: "crosshair" };
  private captures = new Set<number>();
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON() {} };
  }
  setPointerCapture(pointerId: number) { this.captures.add(pointerId); }
  releasePointerCapture(pointerId: number) { this.captures.delete(pointerId); }
  hasPointerCapture(pointerId: number) { return this.captures.has(pointerId); }
}

const course = {
  width: 40,
  height: 24,
  tiles: Array(40 * 24).fill("rough"),
  elevations: Array(40 * 24).fill(0),
} as unknown as Course;

function harness() {
  const element = new FakeEventSurface();
  const windowTarget = new EventTarget();
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("HTMLInputElement", class {});
  vi.stubGlobal("HTMLTextAreaElement", class {});
  vi.stubGlobal("HTMLElement", FakeEventSurface);
  let ticker: ((ticker: { deltaMS: number }) => void) | null = null;
  let resizeCallback: ResizeObserverCallback | null = null;
  class FakeResizeObserver {
    constructor(callback: ResizeObserverCallback) { resizeCallback = callback; }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const pointerListeners = new Map<ViewportPointerEventType, ViewportPointerListener>();
  const pointerEvents = {
    on: vi.fn((name: ViewportPointerEventType, listener: ViewportPointerListener) => pointerListeners.set(name, listener)),
    off: vi.fn((name: ViewportPointerEventType) => pointerListeners.delete(name)),
    suspend: vi.fn(),
    destroy: vi.fn(),
  };
  const app = {
    screen: { width: 800, height: 600 },
    renderer: { resize: vi.fn((width: number, height: number) => {
      app.screen.width = width;
      app.screen.height = height;
    }) },
    stage: {
      hitArea: null,
    },
    ticker: {
      add: vi.fn((listener: (value: { deltaMS: number }) => void) => { ticker = listener; }),
      remove: vi.fn(() => { ticker = null; }),
    },
    canvas: { getBoundingClientRect: () => element.getBoundingClientRect() },
  } as unknown as ViewportApplicationPort;
  const world = {
    pivot: { x: 0, y: 0, set(x: number, y: number) { this.x = x; this.y = y; } },
    position: { x: 0, y: 0, set(x: number, y: number) { this.x = x; this.y = y; } },
    scale: { x: 1, y: 1, set(value: number) { this.x = value; this.y = value; } },
    rotation: 0,
  } satisfies ViewportWorldPort;
  const overlay = { invalidate: vi.fn(), setHover: vi.fn(() => true) };
  const terrain = { cull: vi.fn(() => 4), diagnostics: vi.fn(() => ({ chunksVisible: 4 })) };
  let now = 1000;
  const config: ViewportInputConfig = {
    course,
    rotation: 0,
    animationsEnabled: false,
    cameraSmoothing: false,
    edgeScroll: false,
    edgeScrollSpeed: 1,
    keybindings: DEFAULT_KEYBINDINGS,
    graphicsQuality: "high",
    resolutionScale: 1,
    showGridOverlays: false,
    editor: {
      mode: "PAINT", terrainTool: "curve", playableShotMode: false,
      selectedTerrain: "fairway", onClickTile: vi.fn(), onPresentationChange: vi.fn(),
    },
    onRotationCommit: vi.fn(),
    onViewChange: vi.fn(),
    deriveFrame: (mode) => mode === "overview"
      ? { center: { x: 20, y: 12 }, zoom: 0.5 }
      : { center: { x: 12, y: 8 }, zoom: 1.25 },
  };
  const controller = new ViewportInputController(config, {
    app,
    world,
    element: element as unknown as HTMLElement,
    overlay: () => overlay,
    terrain: () => terrain,
    now: () => now,
    resizeObserver: FakeResizeObserver as unknown as typeof ResizeObserver,
    pointerEvents,
  });
  return {
    app, config, controller, element, overlay, terrain, windowTarget, world, pointerEvents, pointerListeners,
    advance(ms: number) { now += ms; ticker?.({ deltaMS: ms }); },
    resize(width: number, height: number) {
      element.clientWidth = width;
      element.clientHeight = height;
      resizeCallback?.([], {} as ResizeObserver);
    },
  };
}

function pointerEvent(type: string, values: Record<string, unknown> = {}): Event {
  return Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
    button: 0, pointerId: 7, clientX: 400, clientY: 300,
    detail: 1, altKey: false, ...values,
  });
}

function keyEvent(key: string, code: string): Event {
  return Object.assign(new Event("keydown", { cancelable: true }), {
    key, code, repeat: false,
    ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("ViewportInputController", () => {
  it("fits the same tile bounds deterministically at every cardinal rotation", () => {
    const results = ([0, 90, 180, 270] as const).map((rotation) =>
      fitViewportZoomForTileBounds(0, 0, 39, 23, 800, 600, rotation));
    expect(results[0]).toBeCloseTo(results[2], 12);
    expect(results[1]).toBeCloseTo(results[3], 12);
    expect(results.every((zoom) => zoom > 0.15 && zoom < 8)).toBe(true);
  });

  it("owns one listener/ticker lifecycle and applies/culls its initialized frame", () => {
    const { app, config, controller, terrain, world, pointerEvents } = harness();
    expect(app.ticker.add).toHaveBeenCalledTimes(1);
    expect(pointerEvents.on).toHaveBeenCalledTimes(3);

    controller.initializeDefault();
    expect(controller.cameraSnapshot()).toMatchObject({ cx: 12, cy: 8, tcx: 12, tcy: 8, zoom: 1.25, tzoom: 1.25, initialized: true });
    expect(world.position).toMatchObject({ x: 400, y: 300 });
    expect(terrain.cull).toHaveBeenCalled();
    expect(config.onViewChange).toHaveBeenCalledWith(expect.objectContaining({ zoom: 1.25 }));

    controller.destroy();
    expect(app.ticker.remove).toHaveBeenCalledTimes(1);
    expect(pointerEvents.off).toHaveBeenCalledTimes(3);
    expect(pointerEvents.suspend).toHaveBeenCalledTimes(1);
    expect(pointerEvents.destroy).toHaveBeenCalledTimes(1);
    controller.destroy();
    expect(pointerEvents.destroy).toHaveBeenCalledTimes(1);
    expect(controller.snapshot().attached).toBe(false);
  });

  it("preserves the pre-flyover camera and restores it after a skip", () => {
    const { controller, advance } = harness();
    controller.initializeDefault();
    const before = controller.cameraSnapshot();
    controller.startFlyover([
      { at: 0, x: 4, y: 4, zoom: 1 },
      { at: 1, x: 30, y: 18, zoom: 2 },
    ]);
    advance(1000);
    expect(controller.snapshot().flyover.active).toBe(true);
    controller.endFlyover();
    expect(controller.cameraSnapshot()).toMatchObject({ tcx: before.tcx, tcy: before.tcy, tzoom: before.tzoom });
    expect(controller.snapshot().flyover.active).toBe(false);
    controller.destroy();
  });

  it("owns captured terrain gestures through final-point commit and teardown", () => {
    const { config, controller, element } = harness();
    const commit = vi.fn();
    config.editor.onPreviewTerrainStroke = (points) => ({ affordable: true, acceptedTiles: points } as never);
    config.editor.onCommitTerrainStroke = commit;
    controller.update(config);
    controller.initializeDefault();
    element.dispatchEvent(pointerEvent("pointerdown"));
    element.dispatchEvent(pointerEvent("pointermove", { clientX: 420 }));
    element.dispatchEvent(pointerEvent("pointerup", { clientX: 440 }));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0][0].length).toBeGreaterThan(2);
    expect(controller.snapshot().input.editorGesture).toBeNull();
    controller.destroy();
    element.dispatchEvent(pointerEvent("pointerdown"));
    element.dispatchEvent(pointerEvent("pointerup", { clientX: 450 }));
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("gives flyover skip priority over editor Escape", () => {
    const { controller } = harness();
    controller.initializeDefault();
    controller.startFlyover([
      { at: 0, x: 4, y: 4, zoom: 1 },
      { at: 1, x: 8, y: 8, zoom: 1 },
    ]);
    window.dispatchEvent(keyEvent("Escape", "Escape"));
    expect(controller.snapshot().flyover.active).toBe(false);
    controller.destroy();
  });

  it("consumes Escape only while it owns an editor gesture", () => {
    const { config, controller, element, windowTarget } = harness();
    const downstream = vi.fn();
    windowTarget.addEventListener("keydown", downstream);
    config.editor.onPreviewTerrainStroke = (points) => ({ affordable: true, acceptedTiles: points } as never);
    config.editor.onCommitTerrainStroke = vi.fn();
    controller.update(config);
    controller.initializeDefault();
    const idleEscape = keyEvent("Escape", "Escape");
    windowTarget.dispatchEvent(idleEscape);
    expect(downstream).toHaveBeenCalledTimes(1);
    expect(idleEscape.defaultPrevented).toBe(false);
    element.dispatchEvent(pointerEvent("pointerdown"));
    expect(controller.snapshot().input.editorGesture).toBe("terrain");
    const ownedEscape = keyEvent("Escape", "Escape");
    windowTarget.dispatchEvent(ownedEscape);
    expect(ownedEscape.defaultPrevented).toBe(true);
    expect(controller.snapshot().input.editorGesture).toBeNull();
    controller.destroy();
  });

  it("owns fine-green strokes through final-point commit", () => {
    const { config, controller, element } = harness();
    const tiles = config.course.tiles.slice();
    tiles[8 * config.course.width + 12] = "green";
    config.course = { ...config.course, tiles };
    config.editor.mode = "SCULPT";
    config.editor.onPreviewFineGreenStroke = () => ({ surface: {} } as never);
    const commit = vi.fn();
    config.editor.onCommitFineGreenStroke = commit;
    controller.update(config);
    controller.initializeDefault();
    element.dispatchEvent(pointerEvent("pointerdown"));
    element.dispatchEvent(pointerEvent("pointerup", { clientX: 430 }));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0][0].length).toBeGreaterThan(1);
    controller.destroy();
  });

  it("owns spline draft and keyboard commit", () => {
    const { config, controller, element } = harness();
    config.editor.terrainTool = "spline";
    config.editor.onPreviewTerrainStroke = (points) => ({ affordable: true, acceptedTiles: points } as never);
    const commit = vi.fn();
    config.editor.onCommitTerrainStroke = commit;
    controller.update(config);
    controller.initializeDefault();
    element.dispatchEvent(pointerEvent("pointerdown"));
    element.dispatchEvent(pointerEvent("pointerdown", { clientX: 430 }));
    window.dispatchEvent(keyEvent("Enter", "Enter"));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(controller.editorPresentation().splineDraft).toEqual([]);
    controller.destroy();
  });

  it("owns surface node drag and affordability-gated delete", () => {
    const { config, controller, element } = harness();
    config.course = { ...config.course, surfaceIntent: {
      version: 1,
      nextId: 2,
      features: [{
        id: "surface-1", terrain: "fairway", order: 1,
        coverage: [8 * 40 + 12],
        geometry: { kind: "corridor", width: 2,
          knots: [{ x: 12, y: 8 }, { x: 16, y: 8 }, { x: 18, y: 10 }] },
      }],
    } } as Course;
    config.editor.terrainTool = "edit";
    config.editor.onPreviewSurfaceFeatureEdit = () => ({ affordable: true } as never);
    const commit = vi.fn();
    config.editor.onCommitSurfaceFeatureEdit = commit;
    controller.update(config);
    controller.initializeDefault();
    element.dispatchEvent(pointerEvent("pointerdown"));
    element.dispatchEvent(pointerEvent("pointermove", { clientX: 430 }));
    element.dispatchEvent(pointerEvent("pointerup", { clientX: 440 }));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(controller.editorPresentation()).toMatchObject({
      selectedFeatureId: "surface-1", selectedNode: 0, surfaceDraft: null,
    });
    window.dispatchEvent(keyEvent("Delete", "Delete"));
    expect(commit).toHaveBeenCalledTimes(2);
    controller.destroy();
  });

  it("owns wheel, pan, rotation and stage hover/click arbitration", () => {
    const { config, controller, element, overlay, pointerListeners } = harness();
    const primary = vi.fn();
    config.onPrimaryPointer = primary;
    controller.update(config);
    controller.initializeDefault();
    const before = controller.cameraSnapshot();
    element.dispatchEvent(Object.assign(new Event("wheel", { cancelable: true }), {
      deltaY: -120, deltaMode: 0, clientX: 400, clientY: 300,
    }));
    expect(controller.cameraSnapshot().tzoom).toBeGreaterThan(before.tzoom);
    element.dispatchEvent(pointerEvent("pointerdown", { button: 2 }));
    element.dispatchEvent(pointerEvent("pointermove", { button: 2, clientX: 440 }));
    element.dispatchEvent(pointerEvent("pointerup", { button: 2, clientX: 440 }));
    expect(controller.snapshot().input.panning).toBe(false);
    window.dispatchEvent(keyEvent("e", "KeyE"));
    expect(config.onRotationCommit).toHaveBeenCalledWith(90);
    pointerListeners.get("pointermove")?.({ global: { x: 400, y: 300 } } as never);
    expect(overlay.setHover).toHaveBeenCalled();
    pointerListeners.get("pointerdown")?.({ button: 0, global: { x: 400, y: 300 } } as never);
    expect(primary).toHaveBeenCalled();
    controller.destroy();
  });

  it("resizes, clears held keys on blur, and tears down active captures", () => {
    const running = harness();
    running.controller.initializeDefault();
    running.resize(640, 360);
    expect(running.controller.viewport()).toEqual({ width: 640, height: 360 });
    window.dispatchEvent(keyEvent("w", "KeyW"));
    expect(running.controller.snapshot().input.heldPanActions).toEqual(["panUp"]);
    window.dispatchEvent(new Event("blur"));
    expect(running.controller.snapshot().input.heldPanActions).toEqual([]);
    running.element.dispatchEvent(pointerEvent("pointerdown", { button: 2 }));
    expect(running.controller.snapshot().input.panning).toBe(true);
    running.controller.destroy();
    expect(running.controller.snapshot().input.panning).toBe(false);

    const editing = harness();
    editing.config.editor.onPreviewTerrainStroke = () => ({ affordable: true } as never);
    editing.config.editor.onCommitTerrainStroke = vi.fn();
    editing.controller.update(editing.config);
    editing.controller.initializeDefault();
    editing.element.dispatchEvent(pointerEvent("pointerdown"));
    expect(editing.controller.snapshot().input.editorGesture).toBe("terrain");
    editing.controller.destroy();
    expect(editing.controller.snapshot().input.editorGesture).toBeNull();
  });
});


describe("committed rotation projection authority", () => {
  for (const animationsEnabled of [false, true]) for (const direction of [-1, 1] as const) {
    it(`keeps camera, picking and culling aligned for all bearings (${animationsEnabled ? "animated" : "instant"}, ${direction})`, () => {
      const { config, controller, world, app, overlay, terrain, advance } = harness();
      const nextConfig = { ...config, animationsEnabled };
      controller.update(nextConfig);
      controller.initializeDefault();
      controller.focusTileForTest(12.5, 8.5, .75);
      const initialCamera = controller.snapshot().camera;
      if (!animationsEnabled) {
        vi.mocked(nextConfig.onRotationCommit).mockImplementation((committed) => {
          expect({ x: world.pivot.x, y: world.pivot.y }).toEqual(worldToIso(initialCamera.center.x, initialCamera.center.y, 0, committed));
          expect(controller.worldPointToScreen(initialCamera.center.x, initialCamera.center.y)).toEqual({ x: app.screen.width / 2, y: app.screen.height / 2 });
          expect(controller.screenToTile(app.screen.width / 2, app.screen.height / 2)).toEqual({ x: 12, y: 8 });
        });
      }
      let rotation: IsoRotation = 0;
      for (let turn = 0; turn < 4; turn++) {
        const culls = terrain.cull.mock.calls.length;
        const invalidations = overlay.invalidate.mock.calls.length;
        window.dispatchEvent(keyEvent(direction === 1 ? "e" : "q", direction === 1 ? "KeyE" : "KeyQ"));
        if (animationsEnabled) {
          expect(controller.snapshot().rotation.tweening).toBe(true);
          advance(125);
          expect(world.rotation).not.toBe(0);
          advance(125);
        }
        rotation = nextRotation(rotation, direction);
        expect(nextConfig.onRotationCommit).toHaveBeenLastCalledWith(rotation);
        expect(controller.snapshot().rotation).toMatchObject({ committed: rotation, tweening: false, screenRadians: 0 });
        expect(controller.snapshot().camera).toEqual(initialCamera);
        const pivot = worldToIso(initialCamera.center.x, initialCamera.center.y, 0, rotation);
        expect({ x: world.pivot.x, y: world.pivot.y }).toEqual(pivot);
        expect(controller.worldPointToScreen(initialCamera.center.x, initialCamera.center.y)).toEqual({ x: app.screen.width / 2, y: app.screen.height / 2 });
        expect(controller.screenToTile(app.screen.width / 2, app.screen.height / 2)).toEqual({ x: 12, y: 8 });
        expect(controller.screenToWorldPoint(app.screen.width / 2, app.screen.height / 2)).toEqual(initialCamera.center);
        expect(terrain.cull.mock.calls.length).toBeGreaterThan(culls);
        expect(overlay.invalidate.mock.calls.length).toBeGreaterThan(invalidations);
        expect(terrain.cull).toHaveBeenLastCalledWith(expect.objectContaining({ pivotX: pivot.x, pivotY: pivot.y, scale: initialCamera.zoom, rotation: 0 }));
        const point = controller.worldPointToScreen(14.5, 10.5);
        expect(controller.screenToWorldPoint(point.x, point.y)).toEqual({ x: 14.5, y: 10.5 });
        // React's next config arrives after the immediate commit. It must
        // neither hide a stale pivot nor move the already-correct camera.
        controller.update({ ...nextConfig, rotation });
        expect({ x: world.pivot.x, y: world.pivot.y }).toEqual(pivot);
        expect(controller.worldPointToScreen(initialCamera.center.x, initialCamera.center.y)).toEqual({ x: app.screen.width / 2, y: app.screen.height / 2 });
        expect(controller.snapshot().camera).toEqual(initialCamera);
      }
      controller.destroy();
    });
  }
});
