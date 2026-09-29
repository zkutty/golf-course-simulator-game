import { describe, expect, it, vi } from "vitest";
import type * as PIXI from "pixi.js";
import { DEFAULT_COURSE } from "../../../game/models/defaults";
import type { TerrainStrokePreview } from "../../../game/models/terrainStroke";
import type { RenderSnapshot } from "../RenderSnapshot";
import { SceneSystemHost } from "../SceneSystemHost";
import { createOverlaysDiagnosticsSceneSystem, type OverlayTickInput } from "./overlaysDiagnosticsScene";

function point(x = 0, y = 0) {
  return {
    x,
    y,
    set(nextX: number, nextY = nextX) {
      this.x = nextX;
      this.y = nextY;
    },
  };
}

class FakeDisplay {
  parent: FakeContainer | null = null;
  label = "";
  position = point();
  destroy = vi.fn((_options?: { children?: boolean }) => {});
}

class FakeGraphics extends FakeDisplay {
  clear = vi.fn();
  circle = vi.fn();
  ellipse = vi.fn();
  stroke = vi.fn();
  fill = vi.fn();
  moveTo = vi.fn();
  lineTo = vi.fn();
  poly = vi.fn();
}

class FakeText extends FakeDisplay {
  text = "";
}

class FakeContainer extends FakeDisplay {
  children: FakeDisplay[] = [];
  override destroy = vi.fn((options?: { children?: boolean }) => {
    if (!options?.children) return;
    for (const child of this.children) child.destroy(options);
    this.children = [];
  });

  addChild<T extends FakeDisplay>(...children: T[]): T {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
    return children[0];
  }

  removeChild<T extends FakeDisplay>(child: T): T {
    this.children = this.children.filter((candidate) => candidate !== child);
    child.parent = null;
    return child;
  }
}

function snapshot(revision = 1): RenderSnapshot {
  return {
    course: DEFAULT_COURSE,
    obstacles: DEFAULT_COURSE.obstacles,
    effectiveTiles: DEFAULT_COURSE.tiles,
    holes: DEFAULT_COURSE.holes,
    draftTee: null,
    draftGreen: null,
    rotation: 0,
    graphicsQuality: "high",
    colorVision: "standard",
    reducedMotion: false,
    animationsEnabled: true,
    showObstacles: true,
    atlasRevision: 1,
    surveyMode: false,
    worldSeed: 42,
    surfaceHeightAt: () => 0,
    revisions: {
      atmosphere: 0,
      surfaceCare: 0,
      structuresProps: 0,
      playerProCollection: 0,
      mobilityEntities: 0,
      liveEntities: 0,
      naturalProps: 0,
      overlaysDiagnostics: revision,
      estateSurvey: 0,
    },
  };
}

function fixture(options: { perfEnabled?: boolean } = {}) {
  const terrainDecals = new FakeContainer();
  const fx = new FakeContainer();
  const screenOverlay = new FakeContainer();
  const graphics: FakeGraphics[] = [];
  const texts: FakeText[] = [];
  const published = vi.fn();
  let clock = 10;
  const system = createOverlaysDiagnosticsSceneSystem(
    {
      terrainDecals: terrainDecals as unknown as PIXI.Container,
      fx: fx as unknown as PIXI.Container,
      screenOverlay: screenOverlay as unknown as PIXI.Container,
    },
    {
      createContainer: () => new FakeContainer() as unknown as PIXI.Container,
      createGraphics: () => {
        const graphic = new FakeGraphics();
        graphics.push(graphic);
        return graphic as unknown as PIXI.Graphics;
      },
      createText: () => {
        const text = new FakeText();
        texts.push(text);
        return text as unknown as PIXI.Text;
      },
      readPerfEnabled: () => options.perfEnabled ?? false,
      now: () => ++clock,
      publishPerf: published,
    },
  );
  return { terrainDecals, fx, screenOverlay, graphics, texts, published, system };
}

function tickInput(patch: Partial<OverlayTickInput> = {}): OverlayTickInput {
  return {
    wizardStep: "TEE",
    holes: DEFAULT_COURSE.holes,
    activeHoleIndex: 0,
    draftTee: null,
    worldPointToScreen: (x, y) => ({ x, y }),
    course: DEFAULT_COURSE,
    effectiveTiles: DEFAULT_COURSE.tiles,
    rotation: 0,
    surfaceHeightAt: () => 0,
    editorMode: "PAINT",
    terrainStrokePreview: null,
    colorVision: "standard",
    graphicsQuality: "low",
    ...patch,
  };
}

describe("overlay and diagnostics scene ownership", () => {
  it("uses the sole overlaysDiagnostics host ID and preserves dynamic display identity across updates", () => {
    const scene = fixture();
    const host = new SceneSystemHost([scene.system]);
    expect(host.sync(snapshot(1))).toEqual(["overlaysDiagnostics"]);
    expect(scene.terrainDecals.children).toHaveLength(1);
    expect(scene.screenOverlay.children).toHaveLength(1);
    const highlight = scene.terrainDecals.children[0];
    const line = scene.screenOverlay.children[0];

    expect(host.sync(snapshot(1))).toEqual([]);
    expect(host.sync(snapshot(2))).toEqual(["overlaysDiagnostics"]);
    expect(scene.terrainDecals.children[0]).toBe(highlight);
    expect(scene.screenOverlay.children[0]).toBe(line);

    host.dispose();
    expect(scene.terrainDecals.children).toEqual([]);
    expect(scene.fx.children).toEqual([]);
    expect(scene.screenOverlay.children).toEqual([]);
    expect(highlight.destroy).toHaveBeenCalledOnce();
    expect(line.destroy).toHaveBeenCalledOnce();
  });

  it("redraws only through explicit hover and invalidation seams", () => {
    const scene = fixture();
    scene.system.create!(snapshot());
    const highlight = scene.graphics[0];
    scene.system.tick(tickInput());
    expect(highlight.clear).toHaveBeenCalledOnce();

    scene.system.tick(tickInput());
    expect(highlight.clear).toHaveBeenCalledOnce();
    expect(scene.system.setHover({ x: 3, y: 4 })).toBe(true);
    scene.system.tick(tickInput());
    expect(highlight.clear).toHaveBeenCalledTimes(2);
    expect(highlight.poly).toHaveBeenCalled();

    expect(scene.system.setHover({ x: 3, y: 4 })).toBe(false);
    scene.system.tick(tickInput());
    expect(highlight.clear).toHaveBeenCalledTimes(2);
    scene.system.invalidate();
    scene.system.tick(tickInput());
    expect(highlight.clear).toHaveBeenCalledTimes(3);
  });

  it("retains cloned E2E terrain-preview diagnostics across dirty redraws", () => {
    const scene = fixture();
    scene.system.create!(snapshot());
    scene.system.setHover({ x: 2, y: 2 });
    const preview = {
      previewKind: "stroke",
      tiles: [{ x: 2, y: 2, terrain: "green" }],
      acceptedTiles: [{ x: 2, y: 2, terrain: "green" }],
      excludedTiles: [],
      affordable: true,
    } as unknown as TerrainStrokePreview;
    const input = tickInput({ selectedTerrain: "green", terrainStrokePreview: preview });
    scene.system.tick(input);
    const first = scene.system.terrainPreview();
    expect(first).toMatchObject({ revision: 1, previewKind: "stroke", selectedTerrain: "green", materials: ["green"] });
    first!.materials.push("sand");
    expect(scene.system.terrainPreview()?.materials).toEqual(["green"]);

    scene.system.invalidate();
    scene.system.tick(input);
    expect(scene.system.terrainPreview()?.revision).toBe(2);
  });

  it("creates, publishes, and tears down the perf HUD through its scene lifecycle", () => {
    const scene = fixture({ perfEnabled: true });
    scene.system.create!(snapshot());
    scene.system.beginFrame(1_500);
    scene.system.markPerf("hover+flags");
    scene.system.finishFrame(1_500, 16, () => ({
      golfers: 24,
      bubbles: 2,
      ripples: 1,
      impacts: 3,
      ambientObjects: 4,
      chunksVisible: 5,
      chunksTotal: 6,
      objects: 30,
    }));

    expect(scene.texts).toHaveLength(1);
    expect(scene.texts[0].text).toContain("golfers 24");
    expect(scene.published).toHaveBeenCalledOnce();
    expect(scene.published.mock.calls[0][0]).toMatchObject({ golfers: 24, chunksVisible: 5, objects: 30 });

    scene.system.destroy!();
    expect(scene.texts[0].destroy).toHaveBeenCalledOnce();
    expect(scene.screenOverlay.children).toEqual([]);
  });
});
