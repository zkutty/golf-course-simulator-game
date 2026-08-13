import { describe, expect, it, vi } from "vitest";
import type * as PIXI from "pixi.js";
import { DEFAULT_STATE } from "../../../game/gameState";
import type { Hole } from "../../../game/models/types";
import type { RenderSnapshot } from "../RenderSnapshot";
import { createHoleMarkersSceneSystem } from "./holeMarkersScene";

interface FakeDisplay {
  parent: FakeContainer | null;
  destroyed: boolean;
  visible: boolean;
}

interface FakeContainer extends FakeDisplay {
  children: FakeDisplay[];
  label?: string;
  addChild: (...children: FakeDisplay[]) => void;
  removeChild: (child: FakeDisplay) => void;
  destroy: ReturnType<typeof vi.fn>;
}

function container(): FakeContainer {
  const value: FakeContainer = {
    parent: null,
    destroyed: false,
    visible: true,
    children: [],
    addChild: (...children) => {
      for (const child of children) {
        child.parent?.removeChild(child);
        child.parent = value;
        value.children.push(child);
      }
    },
    removeChild: (child) => {
      value.children = value.children.filter((candidate) => candidate !== child);
      if (child.parent === value) child.parent = null;
    },
    destroy: vi.fn(() => { value.destroyed = true; }),
  };
  return value;
}

function graphics() {
  const value = {
    parent: null as FakeContainer | null,
    destroyed: false,
    visible: true,
    label: "",
    zIndex: 0,
    position: { set: vi.fn() },
    clear: vi.fn(),
    ellipse: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    circle: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    poly: vi.fn(),
    destroy: vi.fn(() => { value.destroyed = true; }),
  };
  return value;
}

const HOLE: Hole = {
  id: "hole-1",
  tee: { x: 2, y: 3 },
  green: { x: 8, y: 9 },
  teeBoxes: {
    forward: { x: 1, y: 3 },
    member: { x: 2, y: 3 },
    championship: { x: 3, y: 3 },
  },
  pinPositions: {
    A: { x: 8, y: 9 },
    B: { x: 9, y: 9 },
    C: { x: 8, y: 10 },
  },
  parMode: "AUTO",
};

function snapshot(overrides: Partial<RenderSnapshot> = {}): RenderSnapshot {
  const course = { ...DEFAULT_STATE.course, holes: [HOLE], activePinRotation: "B" as const };
  return {
    course,
    obstacles: course.obstacles,
    effectiveTiles: course.tiles,
    holes: course.holes,
    draftTee: { x: 4, y: 5 },
    draftGreen: { x: 6, y: 7 },
    rotation: 0,
    graphicsQuality: "high",
    colorVision: "standard",
    reducedMotion: false,
    animationsEnabled: true,
    showObstacles: true,
    showMarkers: true,
    selectedTeeSet: "member",
    flagColor: "#d9534f",
    atlasRevision: 1,
    surveyMode: false,
    worldSeed: 42,
    surfaceHeightAt: () => 0,
    revisions: {
      atmosphere: 0,
      surfaceCare: 0,
      structuresProps: 0,
      playerProCollection: 0,
      naturalProps: 0,
      holeMarkers: 1,
      overlaysDiagnostics: 0,
      estateSurvey: 0,
    },
    ...overrides,
  };
}

describe("hole marker scene ownership", () => {
  it("pools marker graphics, retains flags, and removes stale holes", () => {
    const decals = container();
    const objects = container();
    const created: ReturnType<typeof graphics>[] = [];
    const scene = createHoleMarkersSceneSystem(
      decals as unknown as PIXI.Container,
      objects as unknown as PIXI.Container,
      {
        createGraphics: () => {
          const value = graphics();
          created.push(value);
          return value as unknown as PIXI.Graphics;
        },
      },
    );

    scene.create?.(snapshot());
    expect(scene.markerCount()).toBe(8);
    expect(scene.flagCount()).toBe(1);
    expect(decals.children).toHaveLength(8);
    const createdAfterFirstRender = created.length;

    const routeOverlay = graphics();
    decals.addChild(routeOverlay);

    scene.update?.(snapshot({ selectedTeeSet: "forward" }));
    expect(scene.markerCount()).toBe(8);
    expect(scene.flagCount()).toBe(1);
    expect(created).toHaveLength(createdAfterFirstRender);
    expect(decals.children[0]).toBe(routeOverlay);

    scene.update?.(snapshot({ holes: [], draftTee: null, draftGreen: null }));
    expect(scene.markerCount()).toBe(0);
    expect(scene.flagCount()).toBe(0);
    expect(objects.children).toHaveLength(0);
  });

  it("keeps flags independent of marker visibility and destroys all ownership", () => {
    const decals = container();
    const objects = container();
    const created: ReturnType<typeof graphics>[] = [];
    const scene = createHoleMarkersSceneSystem(
      decals as unknown as PIXI.Container,
      objects as unknown as PIXI.Container,
      {
        createGraphics: () => {
          const value = graphics();
          created.push(value);
          return value as unknown as PIXI.Graphics;
        },
      },
    );

    scene.create?.(snapshot({ showMarkers: false, animationsEnabled: false }));
    expect(scene.markerCount()).toBe(0);
    expect(scene.flagCount()).toBe(1);
    const flag = created.at(-1)!;
    scene.tick(2_000);
    expect(flag.clear).toHaveBeenCalledTimes(2);

    scene.destroy?.();
    expect(decals.children).toHaveLength(0);
    expect(objects.children).toHaveLength(0);
    expect(created.every((display) => display.destroyed)).toBe(true);
  });
});
