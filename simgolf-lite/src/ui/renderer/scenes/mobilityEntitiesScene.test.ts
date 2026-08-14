import { describe, expect, it, vi } from "vitest";
import type * as PIXI from "pixi.js";
import type { GolferRenderData } from "../../../game/live/types";
import { DEFAULT_COURSE } from "../../../game/models/defaults";
import type { Course } from "../../../game/models/types";
import { entityDepth } from "../../../game/render/objectPlacement";
import { tileCenterIso } from "../../../game/render/iso";
import type { RenderSnapshot } from "../RenderSnapshot";
import { createMobilityEntitiesSceneSystem } from "./mobilityEntitiesScene";

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

class FakeGraphics {
  parent: FakeContainer | null = null;
  clear = vi.fn();
  circle = vi.fn();
  stroke = vi.fn();
  moveTo = vi.fn();
  lineTo = vi.fn();
  roundRect = vi.fn();
  fill = vi.fn();
  destroy = vi.fn();
}

class FakeContainer {
  children: Array<FakeContainer | FakeGraphics> = [];
  parent: FakeContainer | null = null;
  label = "";
  position = point();
  visible = true;
  zIndex = 0;
  destroy = vi.fn((options?: { children?: boolean }) => {
    if (options?.children) {
      for (const child of this.children) child.destroy();
      this.children = [];
    }
  });

  addChild<T extends FakeContainer | FakeGraphics>(...children: T[]): T {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
    return children[0];
  }

  removeChild<T extends FakeContainer | FakeGraphics>(child: T): T {
    this.children = this.children.filter((candidate) => candidate !== child);
    child.parent = null;
    return child;
  }
}

function golfer(id: number, patch: Partial<GolferRenderData> = {}): GolferRenderData {
  return {
    id,
    x: id,
    y: 4,
    ballX: null,
    ballY: null,
    ballToX: null,
    ballToY: null,
    color: "#f00",
    mood: 0.7,
    thought: null,
    archetype: "casual",
    segKind: "walk",
    segT: 0,
    shot: null,
    dirX: 1,
    dirY: 0,
    scoredHoles: 0,
    lastHoleDelta: 0,
    ...patch,
  };
}

function course(options: {
  cartState?: "available" | "in_use";
  includePushcart?: boolean;
} = {}): Course {
  const cartState = options.cartState ?? "in_use";
  const building = {
    id: "rental",
    type: "cart_rental" as const,
    x: 2,
    y: 2,
    tier: 1 as const,
    price: 20,
  };
  const fleet: NonNullable<Course["m51"]>["fleet"] = {
    cart: {
      id: "cart",
      courseId: "course-primary",
      buildingId: "rental",
      productId: "rental:riding_cart",
      mode: "riding_cart",
      seats: 2,
      state: cartState,
      condition: 1,
      uses: 0,
      wear: 0,
    },
  };
  if (options.includePushcart) {
    fleet.push = {
      id: "push",
      courseId: "course-primary",
      buildingId: "rental",
      productId: "rental:pushcart",
      mode: "pushcart",
      seats: 1,
      state: "available",
      condition: 1,
      uses: 0,
      wear: 0,
    };
  }
  return {
    ...DEFAULT_COURSE,
    buildings: [building],
    m51: {
      version: 3,
      cartRentals: {
        rental: {
          buildingId: "rental",
          tier: 1,
          products: {
            pushcart: {
              id: "rental:pushcart",
              courseId: "course-primary",
              buildingId: "rental",
              mode: "pushcart",
              name: "Pushcart",
              price: 9,
              enabled: true,
            },
            riding_cart: {
              id: "rental:riding_cart",
              courseId: "course-primary",
              buildingId: "rental",
              mode: "riding_cart",
              name: "Riding Cart",
              price: 20,
              enabled: true,
            },
          },
        },
      },
      fleet,
      settledAssignmentIds: [],
    },
  };
}

function snapshot(activeCourse = course(), overrides: Partial<RenderSnapshot> = {}): RenderSnapshot {
  return {
    course: activeCourse,
    obstacles: activeCourse.obstacles,
    effectiveTiles: activeCourse.tiles,
    holes: activeCourse.holes,
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
    surfaceHeightAt: () => 2,
    revisions: {
      atmosphere: 0,
      surfaceCare: 0,
      structuresProps: 0,
      playerProCollection: 0,
      mobilityEntities: 1,
      naturalProps: 0,
      overlaysDiagnostics: 0,
      estateSurvey: 0,
    },
    ...overrides,
  };
}

const unbounded = {
  left: -Infinity,
  right: Infinity,
  top: -Infinity,
  bottom: Infinity,
};

function fixture() {
  const objects = new FakeContainer();
  const holders: FakeContainer[] = [];
  const graphics: FakeGraphics[] = [];
  const system = createMobilityEntitiesSceneSystem(
    objects as unknown as PIXI.Container,
    {
      createContainer: () => {
        const holder = new FakeContainer();
        holders.push(holder);
        return holder as unknown as PIXI.Container;
      },
      createGraphics: () => {
        const graphic = new FakeGraphics();
        graphics.push(graphic);
        return graphic as unknown as PIXI.Graphics;
      },
    },
  );
  return { objects, holders, graphics, system };
}

describe("M51 mobility entities scene ownership", () => {
  it("owns one direct objects-layer holder per shared unit and one graphic per holder", () => {
    const scene = fixture();
    scene.system.create!(snapshot(course({ cartState: "in_use" })));
    scene.system.tick({
      golfers: [
        golfer(1, { mobilityUnitId: "cart", mobilityUnitMode: "riding_cart", mobilityAssignmentId: "a" }),
        golfer(2, { mobilityUnitId: "cart", mobilityUnitMode: "riding_cart", mobilityAssignmentId: "a" }),
      ],
      cullBounds: unbounded,
    });

    expect(scene.system.unitCount()).toBe(1);
    expect(scene.objects.children).toEqual([scene.holders[0]]);
    expect(scene.holders[0].parent).toBe(scene.objects);
    expect(scene.holders[0].children).toEqual([scene.graphics[0]]);
    expect(scene.graphics[0].parent).toBe(scene.holders[0]);
    expect(scene.holders[0].label).toBe("mobility-entity:cart");
  });

  it("renders parked fleet from an empty golfer list with the legacy shapes, colors, and alpha", () => {
    const scene = fixture();
    scene.system.create!(snapshot(course({ cartState: "available", includePushcart: true })));
    scene.system.tick({ golfers: [], cullBounds: unbounded });

    expect(scene.system.unitCount()).toBe(2);
    const cartIndex = scene.holders.findIndex((holder) => holder.label === "mobility-entity:cart");
    const pushIndex = scene.holders.findIndex((holder) => holder.label === "mobility-entity:push");
    const cart = scene.graphics[cartIndex];
    const push = scene.graphics[pushIndex];
    expect(cart.roundRect).toHaveBeenCalledWith(-10, -9, 20, 10, 3);
    expect(cart.fill).toHaveBeenNthCalledWith(1, { color: 0xe7dfba, alpha: 0.62 });
    expect(cart.stroke).toHaveBeenCalledWith({ width: 1.5, color: 0x374438, alpha: 0.95 });
    expect(cart.fill).toHaveBeenNthCalledWith(2, { color: 0x263126, alpha: 0.95 });
    expect(push.circle.mock.calls).toEqual([[-3, 0, 3.5], [4, 0, 3.5]]);
    expect(push.stroke).toHaveBeenNthCalledWith(2, { width: 2, color: 0xead99b, alpha: 0.62 });
  });

  it("updates position, quantized depth, and culling from tick input without replacing ownership", () => {
    const scene = fixture();
    const stableCourse = course({ cartState: "in_use" });
    const height = () => 3;
    scene.system.create!(snapshot(stableCourse, { rotation: 90, surfaceHeightAt: height }));
    const active = golfer(1, {
      x: 5,
      y: 7,
      mobilityUnitId: "cart",
      mobilityUnitMode: "riding_cart",
      mobilityAssignmentId: "a",
    });
    scene.system.tick({ golfers: [active], cullBounds: unbounded });

    const holder = scene.holders[0];
    const projected = tileCenterIso(5, 7, 3, 90);
    expect([holder.position.x, holder.position.y]).toEqual([projected.x, projected.y + 2]);
    expect(holder.zIndex).toBe(Math.round((entityDepth(5, 7, 3, 90) - 0.05) * 10) / 10);
    expect(holder.visible).toBe(true);

    scene.system.tick({
      golfers: [{ ...active, x: 8, y: 9 }],
      cullBounds: { left: -1, right: 1, top: -1, bottom: 1 },
    });
    const moved = tileCenterIso(8, 9, 3, 90);
    expect([holder.position.x, holder.position.y]).toEqual([moved.x, moved.y + 2]);
    expect(holder.visible).toBe(false);
    expect(scene.holders).toHaveLength(1);
  });

  it("updates cached course, rotation, and surface authority without rebuilding a unit", () => {
    const scene = fixture();
    const initialCourse = course({ cartState: "available" });
    scene.system.create!(snapshot(initialCourse, { surfaceHeightAt: () => 1 }));
    scene.system.tick({ golfers: [], cullBounds: unbounded });
    const holder = scene.holders[0];

    const movedCourse = {
      ...initialCourse,
      buildings: initialCourse.buildings.map((building) => ({ ...building, x: 6, y: 8 })),
    };
    scene.system.update!(snapshot(movedCourse, { rotation: 180, surfaceHeightAt: () => 4 }));
    scene.system.tick({ golfers: [], cullBounds: unbounded });
    const projected = tileCenterIso(6.2, 8.7, 4, 180);

    expect(scene.holders).toEqual([holder]);
    expect([holder.position.x, holder.position.y]).toEqual([projected.x, projected.y + 2]);
    expect(holder.zIndex).toBe(Math.round((entityDepth(6.2, 8.7, 4, 180) - 0.05) * 10) / 10);
  });

  it("redraws only when the state and mode signature changes", () => {
    const scene = fixture();
    scene.system.create!(snapshot());
    const active = golfer(1, {
      mobilityUnitId: "cart",
      mobilityUnitMode: "riding_cart",
      mobilityAssignmentId: "a",
    });
    scene.system.tick({ golfers: [active], cullBounds: unbounded });
    scene.system.tick({ golfers: [{ ...active, x: active.x + 1 }], cullBounds: unbounded });
    expect(scene.graphics[0].clear).toHaveBeenCalledTimes(1);

    scene.system.tick({
      golfers: [{ ...active, mobilityUnitMode: "pushcart" }],
      cullBounds: unbounded,
    });
    expect(scene.graphics[0].clear).toHaveBeenCalledTimes(2);
  });

  it("retires stale units without touching sibling objects and survives double destroy", () => {
    const scene = fixture();
    const sibling = new FakeContainer();
    sibling.label = "unowned-sibling";
    scene.objects.addChild(sibling);
    scene.system.create!(snapshot(course({ cartState: "in_use" })));
    const active = golfer(1, {
      mobilityUnitId: "cart",
      mobilityUnitMode: "riding_cart",
      mobilityAssignmentId: "a",
    });
    scene.system.tick({ golfers: [active], cullBounds: unbounded });
    const firstHolder = scene.holders[0];
    const firstGraphic = scene.graphics[0];

    scene.system.tick({ golfers: [], cullBounds: unbounded });
    expect(scene.objects.children).toEqual([sibling]);
    expect(firstHolder.destroy).toHaveBeenCalledTimes(1);
    expect(firstGraphic.destroy).toHaveBeenCalledTimes(1);

    scene.system.tick({ golfers: [active], cullBounds: unbounded });
    const replacement = scene.holders[1];
    scene.system.destroy!();
    scene.system.destroy!();
    expect(scene.objects.children).toEqual([sibling]);
    expect(sibling.destroy).not.toHaveBeenCalled();
    expect(replacement.destroy).toHaveBeenCalledTimes(1);
    expect(scene.system.unitCount()).toBe(0);
  });

  it("preserves the walking connection shape and line treatment", () => {
    const scene = fixture();
    scene.system.create!(snapshot());
    scene.system.tick({
      golfers: [golfer(7, { mobilityAssignmentId: "walk-a", mobilityUnitMode: "walk" })],
      cullBounds: unbounded,
    });

    const graphic = scene.graphics[0];
    expect(scene.holders[0].label).toBe("mobility-entity:walk:walk-a");
    expect(graphic.circle).toHaveBeenCalledWith(0, -4, 7);
    expect(graphic.stroke).toHaveBeenNthCalledWith(1, { width: 1.5, color: 0xf4f1db, alpha: 0.85 });
    expect(graphic.stroke).toHaveBeenNthCalledWith(2, { width: 1.5, color: 0x385d45, alpha: 0.9 });
  });
});
