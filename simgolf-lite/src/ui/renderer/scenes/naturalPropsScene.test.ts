import { describe, expect, it, vi } from "vitest";
import type * as PIXI from "pixi.js";
import { DEFAULT_STATE } from "../../../game/gameState";
import { BIOME_KEYS } from "../../../game/models/biomes";
import type { Terrain } from "../../../game/models/types";
import { deriveHabitatComposition } from "../../../game/render/habitatComposition";
import { createParklandVisualReferenceCourse } from "../../../game/testing/referenceCourse";
import type { RenderSnapshot } from "../RenderSnapshot";
import {
  createNaturalPropsSceneSystem,
  deriveHabitatMassPlans,
  deriveWetShoreComposition,
  naturalPropFallbackBiome,
} from "./naturalPropsScene";

class FakeContainer {
  children: unknown[] = [];

  addChild<T extends { parent?: FakeContainer | null }>(child: T): T {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  removeChild<T extends { parent?: FakeContainer | null }>(child: T): T {
    this.children = this.children.filter((candidate) => candidate !== child);
    child.parent = null;
    return child;
  }
}

function point() {
  return {
    x: 0,
    y: 0,
    set(x: number, y = x) {
      this.x = x;
      this.y = y;
    },
  };
}

function fakeTexture() {
  return {
    width: 64,
    height: 64,
    destroy: vi.fn(),
  } as unknown as PIXI.Texture;
}

function fakeSprite(texture: PIXI.Texture) {
  return {
    texture,
    parent: null as FakeContainer | null,
    label: "",
    anchor: point(),
    position: point(),
    scale: point(),
    skew: point(),
    width: 0,
    height: 0,
    tint: 0,
    alpha: 1,
    zIndex: 0,
    destroy: vi.fn(),
  } as unknown as PIXI.Sprite;
}

function fakeGraphics() {
  const graphics = {
    parent: null as FakeContainer | null,
    position: point(),
    ellipse: vi.fn(),
    circle: vi.fn(),
    fill: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    destroy: vi.fn(),
  };
  return graphics as unknown as PIXI.Graphics;
}

function fakeHabitatContainer() {
  const container = new FakeContainer() as FakeContainer & {
    label: string;
    eventMode: string;
    position: ReturnType<typeof point>;
    zIndex: number;
    sortableChildren: boolean;
    sortChildren: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
  Object.assign(container, {
    label: "",
    eventMode: "none",
    position: point(),
    zIndex: 0,
    sortableChildren: false,
    sortChildren: vi.fn(),
    destroy: vi.fn(),
  });
  return container as unknown as PIXI.Container;
}

function habitatMemberSprites(children: readonly unknown[]): readonly { label: string; zIndex: number }[] {
  return children.flatMap((child) => {
    const mass = child as { label?: string; children?: readonly { label?: string; zIndex?: number }[] };
    if (!mass.label?.startsWith("habitat-mass:")) return [];
    return (mass.children ?? []).map((member) => ({ label: member.label ?? "", zIndex: member.zIndex ?? 0 }));
  });
}

function snapshot(overrides: Partial<RenderSnapshot> = {}): RenderSnapshot {
  const course = {
    ...DEFAULT_STATE.course,
    obstacles: [{ x: 8, y: 9, type: "tree" as const }],
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
    surfaceHeightAt: () => 0,
    revisions: {
      atmosphere: 0,
      surfaceCare: 0,
      structuresProps: 0,
      playerProCollection: 0,
      naturalProps: 1,
      overlaysDiagnostics: 0,
      estateSurvey: 0,
    },
    ...overrides,
  };
}

describe("natural props scene ownership", () => {
  it("groups Parkland wet-bank reeds and stones without entering course surfaces", () => {
    const width = 24;
    const height = 24;
    const tiles: Terrain[] = Array.from({ length: width * height }, () => "rough" as const);
    for (let y = 8; y <= 14; y++) for (let x = 8; x <= 14; x++) tiles[y * width + x] = "water";
    // A maintained route adjacent to the south bank must remain undressed.
    for (let x = 8; x <= 14; x++) tiles[16 * width + x] = "fairway";
    const course = {
      ...DEFAULT_STATE.course,
      width,
      height,
      tiles,
      elevations: Array.from({ length: width * height }, () => 0),
      obstacles: [],
      buildings: [],
      holes: [],
      theme: "parkland" as const,
    };
    const input = { course, tiles, worldSeed: 1202, quality: "high" as const };
    const high = deriveWetShoreComposition(input);
    const medium = deriveWetShoreComposition({ ...input, quality: "medium" });

    expect(high).toEqual(deriveWetShoreComposition(input));
    expect(high).not.toHaveLength(0);
    expect(new Set(high.map((detail) => detail.kind))).toEqual(new Set(["reeds", "shore_stones"]));
    expect(high.every((detail) => tiles[detail.tileY * width + detail.tileX] === "rough")).toBe(true);
    expect(high.every((detail) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const terrain = tiles[(detail.tileY + dy) * width + detail.tileX + dx];
        if (["fairway", "green", "tee", "path", "sand", "waste_area"].includes(terrain)) return false;
      }
      return true;
    })).toBe(true);
    expect([...new Map(high.map((detail) => [detail.massId, detail])).keys()].length).toBeGreaterThan(0);
    expect(medium.map(({ frame: _frame, ...detail }) => detail))
      .toEqual(high.slice(0, medium.length).map(({ frame: _frame, ...detail }) => detail));
    expect(medium.every((detail) => detail.frame.endsWith("_0"))).toBe(true);
    expect(deriveWetShoreComposition({ ...input, quality: "low" })).toEqual([]);
  });

  it("keeps fixed M19 wet-shore detail counts at normal and detail quality", () => {
    const course = createParklandVisualReferenceCourse();
    const high = deriveWetShoreComposition({ course, tiles: course.tiles, worldSeed: 12_160, quality: "high" });
    const medium = deriveWetShoreComposition({ course, tiles: course.tiles, worldSeed: 12_160, quality: "medium" });
    expect({ rendered: medium.length, masses: new Set(medium.map((detail) => detail.massId)).size })
      .toEqual({ rendered: 16, masses: 4 });
    expect({ rendered: high.length, masses: new Set(high.map((detail) => detail.massId)).size })
      .toEqual({ rendered: 16, masses: 4 });
    expect(medium.map(({ frame: _frame, ...detail }) => detail))
      .toEqual(high.slice(0, medium.length).map(({ frame: _frame, ...detail }) => detail));
  });

  it("derives procedural fallback ownership from every registered biome", () => {
    for (const biome of BIOME_KEYS) {
      expect(naturalPropFallbackBiome(`${biome}_tree_registry_probe`)).toBe(biome);
    }
    expect(naturalPropFallbackBiome("unregistered_tree_probe")).toBeNull();
  });

  it("rebuilds and tears down sprites, shadows, and habitats without destroying shared atlas textures", () => {
    const objects = new FakeContainer();
    const decals = new FakeContainer();
    const atlasTexture = fakeTexture();
    const sprites: ReturnType<typeof fakeSprite>[] = [];
    const graphics: ReturnType<typeof fakeGraphics>[] = [];
    const counts: number[] = [];
    const scene = createNaturalPropsSceneSystem(
      objects as unknown as PIXI.Container,
      decals as unknown as PIXI.Container,
      (count) => counts.push(count),
      {
        getAtlasTexture: () => atlasTexture,
        createSprite: (texture) => {
          const sprite = fakeSprite(texture);
          sprites.push(sprite);
          return sprite;
        },
        createGraphics: () => {
          const item = fakeGraphics();
          graphics.push(item);
          return item;
        },
      },
    );

    scene.create!(snapshot());
    expect(scene.rebuildCount()).toBe(1);
    expect(scene.contentCount()).toBe(1);
    expect(objects.children).toHaveLength(1);
    expect(decals.children).toHaveLength(2);

    scene.update!(snapshot({ atlasRevision: 2 }));
    expect(scene.rebuildCount()).toBe(2);
    expect(sprites[0].destroy).toHaveBeenCalledTimes(1);
    expect(graphics[0].destroy).toHaveBeenCalledTimes(1);
    expect(graphics[1].destroy).toHaveBeenCalledTimes(1);
    expect(atlasTexture.destroy).not.toHaveBeenCalled();
    expect(scene.contentCount()).toBe(1);

    scene.destroy!();
    expect(sprites[1].destroy).toHaveBeenCalledTimes(1);
    expect(atlasTexture.destroy).not.toHaveBeenCalled();
    expect(objects.children).toHaveLength(0);
    expect(decals.children).toHaveLength(0);
    expect(counts).toEqual([0, 1, 0, 1, 0]);
  });

  it("destroys each scene-owned fallback texture on update and final dispose", () => {
    const ownedFallbacks: PIXI.Texture[] = [];
    const scene = createNaturalPropsSceneSystem(
      new FakeContainer() as unknown as PIXI.Container,
      new FakeContainer() as unknown as PIXI.Container,
      undefined,
      {
        getAtlasTexture: () => null,
        createFallbackTexture: () => {
          const texture = fakeTexture();
          ownedFallbacks.push(texture);
          return { texture, owned: true };
        },
        createSprite: fakeSprite,
        createGraphics: fakeGraphics,
      },
    );

    scene.create!(snapshot());
    expect(scene.fallbackTextureCount()).toBe(1);
    scene.update!(snapshot({ atlasRevision: 2 }));
    expect(ownedFallbacks[0].destroy).toHaveBeenCalledWith(true);
    expect(ownedFallbacks[1].destroy).not.toHaveBeenCalled();
    scene.destroy!();
    expect(ownedFallbacks[1].destroy).toHaveBeenCalledWith(true);
  });

  it("keeps sway and tall-prop occlusion metadata inside the scene runtime", () => {
    const sprites: ReturnType<typeof fakeSprite>[] = [];
    const scene = createNaturalPropsSceneSystem(
      new FakeContainer() as unknown as PIXI.Container,
      new FakeContainer() as unknown as PIXI.Container,
      undefined,
      {
        getAtlasTexture: () => fakeTexture(),
        createSprite: (texture) => {
          const sprite = fakeSprite(texture);
          sprites.push(sprite);
          return sprite;
        },
        createGraphics: fakeGraphics,
      },
    );
    scene.create!(snapshot());
    const sprite = sprites[0];

    scene.tick({
      nowMs: 1_000,
      animationsEnabled: true,
      treeSway: true,
      focus: { x: sprite.position.x, y: sprite.position.y },
    });
    expect(sprite.skew.x).not.toBe(0);
    expect(sprite.alpha).toBeLessThan(1);

    scene.tick({
      nowMs: 2_000,
      animationsEnabled: false,
      treeSway: false,
      focus: null,
    });
    expect(sprite.skew.x).toBe(0);
    expect(sprite.alpha).toBe(1);
  });

  it("creates no display objects when natural obstacles are hidden", () => {
    const objects = new FakeContainer();
    const decals = new FakeContainer();
    const scene = createNaturalPropsSceneSystem(
      objects as unknown as PIXI.Container,
      decals as unknown as PIXI.Container,
      undefined,
      {
        getAtlasTexture: () => fakeTexture(),
        createSprite: fakeSprite,
        createGraphics: fakeGraphics,
      },
    );

    scene.create!(snapshot({ showObstacles: false }));
    expect(scene.contentCount()).toBe(0);
    expect(objects.children).toHaveLength(0);
    expect(decals.children).toHaveLength(0);
  });

  it("renders deterministic clustered understory above the surface and tears it down", () => {
    const objects = new FakeContainer();
    const decals = new FakeContainer();
    const detailTexture = fakeTexture();
    const trees = [
      { x: 6, y: 6, type: "tree" as const },
      { x: 9, y: 6, type: "tree" as const },
      { x: 7, y: 9, type: "tree" as const },
    ];
    const course = {
      ...DEFAULT_STATE.course,
      width: 16,
      height: 16,
      tiles: Array.from({ length: 16 * 16 }, () => "rough" as const),
      elevations: Array.from({ length: 16 * 16 }, () => 0),
      obstacles: trees,
      buildings: [],
      holes: [],
      theme: "parkland" as const,
    };
    const detailTextures = vi.fn(() => detailTexture);
    const expectedHabitatDetails = deriveHabitatComposition({
      course,
      tiles: course.tiles,
      obstacles: trees,
      worldSeed: 42,
      quality: "high",
    }).length + deriveWetShoreComposition({
      course,
      tiles: course.tiles,
      worldSeed: 42,
      quality: "high",
    }).length;
    const scene = createNaturalPropsSceneSystem(
      objects as unknown as PIXI.Container,
      decals as unknown as PIXI.Container,
      undefined,
      {
        getAtlasTexture: () => fakeTexture(),
        getHabitatAtlasTexture: detailTextures,
        createSprite: fakeSprite,
        createGraphics: fakeGraphics,
        createContainer: fakeHabitatContainer,
      },
    );

    scene.create!(snapshot({
      course,
      obstacles: trees,
      effectiveTiles: course.tiles,
      graphicsQuality: "high",
    }));
    expect(scene.contentCount()).toBe(3);
    expect(scene.habitatDetailCount()).toBe(expectedHabitatDetails);
    expect(detailTextures).toHaveBeenCalledTimes(expectedHabitatDetails);
    expect(decals.children.some((child) =>
      (child as { label?: string }).label?.startsWith("habitat-mass:"),
    )).toBe(true);

    const firstPlan = habitatMemberSprites(decals.children);
    scene.update!(snapshot({
      course,
      obstacles: trees,
      effectiveTiles: course.tiles,
      graphicsQuality: "high",
      rotation: 180,
      atlasRevision: 2,
    }));
    const rotatedPlan = habitatMemberSprites(decals.children);
    expect(rotatedPlan).toEqual(firstPlan);

    scene.update!(snapshot({
      course,
      obstacles: trees,
      effectiveTiles: course.tiles,
      graphicsQuality: "low",
      atlasRevision: 3,
    }));
    expect(scene.habitatDetailCount()).toBe(0);
    expect(decals.children.some((child) =>
      (child as { label?: string }).label?.startsWith("habitat-mass:"),
    )).toBe(false);
  });

  it("uses one rotation-invariant compositor per compact M19 mass without leaving member cells", () => {
    const course = createParklandVisualReferenceCourse();
    const medium = deriveHabitatComposition({ course, worldSeed: 12_160, quality: "medium" });
    const high = deriveHabitatComposition({ course, worldSeed: 12_160, quality: "high" });
    const low = deriveHabitatComposition({ course, worldSeed: 12_160, quality: "low" });
    const compact = (plans: ReturnType<typeof deriveHabitatMassPlans>) => plans.filter((plan) => plan.memberCount >= 3);
    const mediumPlans = deriveHabitatMassPlans(medium);
    const highPlans = deriveHabitatMassPlans(high);

    expect({ members: medium.length, compactMasses: compact(mediumPlans).length })
      .toEqual({ members: 84, compactMasses: 21 });
    expect({ members: high.length, compactMasses: compact(highPlans).length })
      .toEqual({ members: 160, compactMasses: 41 });
    expect(deriveHabitatMassPlans(low)).toEqual([]);
    expect(deriveHabitatMassPlans(medium)).toEqual(mediumPlans);
    for (const plan of [...compact(mediumPlans), ...compact(highPlans)]) {
      expect(plan.retainedMemberCount).toBeGreaterThanOrEqual(3);
      expect(plan.order).toHaveLength(plan.memberCount);
      for (const member of plan.members) {
        expect(member.worldX).toBeGreaterThanOrEqual(member.tileX + 0.34);
        expect(member.worldX).toBeLessThanOrEqual(member.tileX + 0.66);
        expect(member.worldY).toBeGreaterThanOrEqual(member.tileY + 0.34);
        expect(member.worldY).toBeLessThanOrEqual(member.tileY + 0.66);
      }
      const reached = new Set([0]);
      while (reached.size < plan.members.length) {
        const before = reached.size;
        for (const index of [...reached]) for (let candidate = 0; candidate < plan.members.length; candidate++) {
          const left = plan.members[index];
          const right = plan.members[candidate];
          if (Math.abs(left.tileX - right.tileX) <= 1 && Math.abs(left.tileY - right.tileY) <= 1) reached.add(candidate);
        }
        if (reached.size === before) break;
      }
      expect(reached.size).toBe(plan.members.length);
    }
  });
});
