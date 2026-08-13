import { describe, expect, it, vi } from "vitest";
import type * as PIXI from "pixi.js";
import { DEFAULT_STATE } from "../../../game/gameState";
import type { PropertyAsset, ResidentialUnit } from "../../../game/property/types";
import { worldToIso } from "../../../game/render/iso";
import type { RenderSnapshot } from "../RenderSnapshot";
import { SceneSystemHost } from "../SceneSystemHost";
import { createPropertyAssetsSceneSystem } from "./propertyAssetsScene";

interface FakeDisplay {
  parent: FakeContainer | null;
  destroyed: boolean;
}

interface FakeContainer extends FakeDisplay {
  children: FakeDisplay[];
  addChild: (...children: FakeDisplay[]) => void;
  removeChild: (child: FakeDisplay) => void;
}

type Operation = readonly [string, ...unknown[]];

interface FakeGraphics extends FakeDisplay {
  zIndex: number;
  operations: Operation[];
  poly: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  roundRect: ReturnType<typeof vi.fn>;
  rect: ReturnType<typeof vi.fn>;
  circle: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

function container(): FakeContainer {
  const value: FakeContainer = {
    parent: null,
    destroyed: false,
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
  };
  return value;
}

function graphics(): FakeGraphics {
  const operations: Operation[] = [];
  const value: FakeGraphics = {
    parent: null,
    destroyed: false,
    zIndex: 0,
    operations,
    poly: vi.fn((...args: unknown[]) => { operations.push(["poly", ...args]); return value; }),
    fill: vi.fn((...args: unknown[]) => { operations.push(["fill", ...args]); return value; }),
    stroke: vi.fn((...args: unknown[]) => { operations.push(["stroke", ...args]); return value; }),
    roundRect: vi.fn((...args: unknown[]) => { operations.push(["roundRect", ...args]); return value; }),
    rect: vi.fn((...args: unknown[]) => { operations.push(["rect", ...args]); return value; }),
    circle: vi.fn((...args: unknown[]) => { operations.push(["circle", ...args]); return value; }),
    moveTo: vi.fn((...args: unknown[]) => { operations.push(["moveTo", ...args]); return value; }),
    lineTo: vi.fn((...args: unknown[]) => { operations.push(["lineTo", ...args]); return value; }),
    destroy: vi.fn(() => { value.destroyed = true; }),
  };
  return value;
}

function asset(
  id: string,
  kind: PropertyAsset["kind"],
  category: PropertyAsset["category"],
  x: number,
  overrides: Partial<PropertyAsset> = {},
): PropertyAsset {
  return {
    id,
    kind,
    name: id,
    category,
    tier: 2,
    x,
    y: 1,
    width: 4,
    height: 4,
    capacity: 8,
    condition: 0.75,
    price: 10,
    enabled: true,
    ...overrides,
  };
}

const ASSETS: PropertyAsset[] = [
  asset("homes", "houses", "community", 1, { tenure: "sold" }),
  asset("closed-lodge", "lodge", "resort", 10, { enabled: false }),
  asset("open-hotel", "hotel", "resort", 20),
  asset("shuttle", "shuttle", "access", 30),
  asset("practice", "driving_range", "practice", 40, {
    route: { id: "route", points: [{ x: 40, y: 1 }, { x: 42, y: 2 }] },
    stations: [
      { id: "target", kind: "target", x: 41, y: 1, capacity: 1 },
      { id: "tee", kind: "tee", x: 42, y: 2, capacity: 1 },
    ],
    constructionDaysRemaining: 2,
  }),
  asset("parking", "parking", "access", 50),
  asset("netting", "netting", "safety", 60, { tier: 3 }),
  asset("screening", "screening", "safety", 70, { coverageHeight: 9 }),
  asset("fence", "safety_fence", "safety", 80),
  asset("berm", "berm", "safety", 90),
  asset("sign", "warning_signage", "safety", 100),
];

const UNITS: ResidentialUnit[] = [
  {
    id: "occupied",
    developmentId: "development",
    assetId: "homes",
    lotNumber: 1,
    type: "detached_home",
    status: "sold",
    tenure: "private",
    householdId: "household",
    marketValue: 100,
  },
  {
    id: "vacant",
    developmentId: "development",
    assetId: "homes",
    lotNumber: 2,
    type: "detached_home",
    status: "vacant",
    tenure: "private",
    marketValue: 100,
  },
];

function snapshot(
  revision: number,
  assets: PropertyAsset[] = ASSETS,
  surfaceHeightAt: RenderSnapshot["surfaceHeightAt"] = (x, y) => x + y,
): RenderSnapshot {
  const property = DEFAULT_STATE.course.property!;
  const course = {
    ...DEFAULT_STATE.course,
    property: { ...property, assets, units: UNITS },
  };
  return {
    course,
    obstacles: course.obstacles,
    effectiveTiles: course.tiles,
    holes: course.holes,
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
    surfaceHeightAt,
    hasResortServicePressure: true,
    revisions: {
      atmosphere: 0,
      surfaceCare: 0,
      structuresProps: 0,
      playerProCollection: 0,
      naturalProps: 0,
      propertyAssets: revision,
      overlaysDiagnostics: 0,
      estateSurvey: 0,
    },
  };
}

function hasOperation(graphic: FakeGraphics, name: string, argument: unknown): boolean {
  return graphic.operations.some(([operation, first]) => operation === name && expect.objectContaining(argument as object).asymmetricMatch(first));
}

describe("property asset scene ownership", () => {
  it("preserves every representative M31-M33 drawing branch and asset order", () => {
    const objects = container();
    const created: FakeGraphics[] = [];
    const surfaceHeightAt = vi.fn((x: number, y: number) => x + y);
    const scene = createPropertyAssetsSceneSystem(
      objects as unknown as PIXI.Container,
      { createGraphics: () => {
        const value = graphics();
        created.push(value);
        return value as unknown as PIXI.Graphics;
      } },
    );

    scene.create?.(snapshot(1, ASSETS, surfaceHeightAt));

    expect(scene.contentCount()).toBe(ASSETS.length);
    expect(objects.children).toEqual(created);
    expect(created.map((graphic) => graphic.zIndex)).toEqual(
      ASSETS.map(({ x, y, width, height }) => (x + width + y + height) * 10 + 5),
    );

    const [homes, closedLodge, hotel, shuttle, practice, parking, netting, screening, fence, berm, sign] = created;
    expect(hasOperation(homes, "fill", { color: 0xf4d77b, alpha: 0.95 })).toBe(true);
    expect(hasOperation(homes, "fill", { color: 0x6f817d, alpha: 0.72 })).toBe(true);
    expect(hasOperation(homes, "fill", { color: 0xefe2c7, alpha: 0.95 })).toBe(true);
    expect(hasOperation(closedLodge, "stroke", { width: 3, color: 0xf3eee2, alpha: 0.95 })).toBe(true);
    expect(hasOperation(hotel, "stroke", { width: 2, color: 0xfff2c4, alpha: 0.95 })).toBe(true);

    const hotelCenter = worldToIso(22, 3, 25, 0);
    expect(shuttle.lineTo).toHaveBeenCalledWith(hotelCenter.x, hotelCenter.y - 5);
    expect(surfaceHeightAt.mock.calls.filter(([x, y]) => x === 22 && y === 3)).toHaveLength(2);

    expect(hasOperation(practice, "stroke", { width: 2.8, color: 0xf7e9a8, alpha: 0.9 })).toBe(true);
    expect(practice.circle.mock.calls.some(([, , radius]) => radius === 4)).toBe(true);
    expect(practice.circle.mock.calls.some(([, , radius]) => radius === 3)).toBe(true);
    expect(hasOperation(practice, "stroke", { width: 4, color: 0xe0a32f, alpha: 0.9 })).toBe(true);
    expect(parking.roundRect).toHaveBeenCalledTimes(4);
    expect(hasOperation(netting, "stroke", { width: 2, color: 0x355c3d, alpha: 0.75 })).toBe(true);
    expect(hasOperation(screening, "fill", { color: 0x2f663d, alpha: 0.75 })).toBe(true);
    expect(hasOperation(fence, "stroke", { width: 2, color: 0x5c5d57, alpha: 0.75 })).toBe(true);
    expect(hasOperation(berm, "stroke", { width: 7, color: 0x806a42, alpha: 0.75 })).toBe(true);
    expect(hasOperation(sign, "fill", { color: 0xe6b942, alpha: 0.75 })).toBe(true);
  });

  it("rebuilds only owned graphics, clears empty state, and disposes twice safely", () => {
    const objects = container();
    const siblingBefore = graphics();
    const siblingAfter = graphics();
    objects.addChild(siblingBefore);
    const created: FakeGraphics[] = [];
    const scene = createPropertyAssetsSceneSystem(
      objects as unknown as PIXI.Container,
      { createGraphics: () => {
        const value = graphics();
        created.push(value);
        return value as unknown as PIXI.Graphics;
      } },
    );
    const host = new SceneSystemHost([scene]);

    expect(host.sync(snapshot(1, ASSETS.slice(0, 2)))).toEqual(["propertyAssets"]);
    const firstOwned = [...created];
    objects.addChild(siblingAfter);
    expect(host.sync(snapshot(1, ASSETS.slice(0, 2)))).toEqual([]);
    expect(objects.children).toEqual([siblingBefore, ...firstOwned, siblingAfter]);

    expect(host.sync(snapshot(2, ASSETS.slice(0, 1)))).toEqual(["propertyAssets"]);
    expect(firstOwned.every((graphic) => graphic.destroyed)).toBe(true);
    expect(objects.children).toEqual([siblingBefore, siblingAfter, created.at(-1)]);

    expect(host.sync(snapshot(3, []))).toEqual(["propertyAssets"]);
    expect(scene.contentCount()).toBe(0);
    expect(objects.children).toEqual([siblingBefore, siblingAfter]);

    host.dispose();
    host.dispose();
    expect(objects.children).toEqual([siblingBefore, siblingAfter]);
    expect(siblingBefore.destroyed).toBe(false);
    expect(siblingAfter.destroyed).toBe(false);
  });
});
