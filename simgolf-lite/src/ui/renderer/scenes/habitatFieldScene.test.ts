import { describe, expect, it, vi } from "vitest";
import type * as PIXI from "pixi.js";
import {
  deriveCourseSceneComposition,
  type CourseSceneCompositionPlanV1,
} from "../../../game/render/courseSceneComposition";
import { createParklandVisualReferenceCourse } from "../../../game/testing/referenceCourse";
import type { RenderSnapshot } from "../RenderSnapshot";
import {
  PARKLAND_HABITAT_CATALOGS,
  PARKLAND_HABITAT_MANIFEST_HASH,
  type HabitatAtlasTier,
  type HabitatFieldAtlasLoader,
  type LoadedHabitatAtlas,
} from "../../../render/habitatFieldAtlas";
import { createHabitatFieldSceneSystem } from "./habitatFieldScene";

class FakeContainer {
  children: unknown[] = [];
  parent: FakeContainer | null = null;
  label = "";
  eventMode = "auto";
  sortableChildren = false;
  destroy = vi.fn();

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

  sortChildren() {
    this.children.sort((left, right) => (
      (left as { zIndex?: number }).zIndex ?? 0
    ) - ((right as { zIndex?: number }).zIndex ?? 0));
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
    height: 32,
    destroy: vi.fn(),
  } as unknown as PIXI.Texture;
}

function fakeSprite(texture: PIXI.Texture) {
  return {
    texture,
    parent: null as FakeContainer | null,
    label: "",
    eventMode: "auto",
    visible: true,
    anchor: point(),
    position: point(),
    width: 0,
    height: 0,
    zIndex: 0,
    destroy: vi.fn(),
  } as unknown as PIXI.Sprite;
}

function snapshot(overrides: Partial<RenderSnapshot> = {}): RenderSnapshot {
  const course = createParklandVisualReferenceCourse();
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
    worldSeed: 12_160,
    surfaceHeightAt: (x, y) => (x + y) / 100,
    revisions: {
      atmosphere: 0,
      surfaceCare: 0,
      structuresProps: 0,
      playerProCollection: 0,
      naturalProps: 0,
      habitatField: 1,
      overlaysDiagnostics: 0,
      estateSurvey: 0,
    },
    ...overrides,
  };
}

function loadedAtlas(
  tier: HabitatAtlasTier,
  colorMode: RenderSnapshot["colorVision"],
  texture = fakeTexture(),
  missingFrame: string | null = null,
): LoadedHabitatAtlas {
  return {
    tier,
    colorMode,
    catalog: PARKLAND_HABITAT_CATALOGS[tier],
    manifestHash: PARKLAND_HABITAT_MANIFEST_HASH,
    frameTexture: (id) => id === missingFrame ? null : texture,
  };
}

function immediateLoader(shared = fakeTexture()): HabitatFieldAtlasLoader & { load: ReturnType<typeof vi.fn> } {
  return {
    load: vi.fn(async (tier: HabitatAtlasTier, mode: RenderSnapshot["colorVision"]) => loadedAtlas(tier, mode, shared)),
    destroy: vi.fn(),
    residency: () => ["test"],
  };
}

function habitatLayer(parent: FakeContainer): FakeContainer {
  return parent.children[0] as FakeContainer;
}

describe("verified habitat field scene", () => {
  it("atomically creates exactly one noninteractive sprite per accepted P2 placement", async () => {
    const parent = new FakeContainer();
    const sprites: ReturnType<typeof fakeSprite>[] = [];
    const input = snapshot();
    const plan = deriveCourseSceneComposition({ course: input.course, seed: input.worldSeed });
    const expected = plan.habitatZones.reduce((total, zone) => total + zone.placements.length, 0);
    const scene = createHabitatFieldSceneSystem(parent as unknown as PIXI.Container, {
      loader: immediateLoader(),
      createContainer: () => new FakeContainer() as unknown as PIXI.Container,
      createSprite: (texture) => {
        const sprite = fakeSprite(texture);
        sprites.push(sprite);
        return sprite;
      },
    });

    scene.create!(input);
    await scene.whenSettled();

    const diagnostics = scene.diagnostics();
    expect(diagnostics).toMatchObject({
      status: "ready",
      manifestHash: PARKLAND_HABITAT_MANIFEST_HASH,
      plannedZoneCount: plan.habitatZones.length,
      plannedPlacementCount: expected,
      renderedCount: expected,
      suppressedCount: 0,
      missingCount: 0,
      uniqueOwnerCount: plan.habitatZones.length,
      legacyParklandHabitatCount: 0,
    });
    expect(diagnostics.planHash).toMatch(/^[a-f0-9]{8}$/);
    expect(sprites).toHaveLength(expected);
    expect(new Set(sprites.map((sprite) => sprite.label)).size).toBe(expected);
    expect(sprites.every((sprite) => sprite.eventMode === "none" && sprite.width === 64 && sprite.height === 32)).toBe(true);
    expect(sprites.every((sprite) => sprite.zIndex === sprite.position.y)).toBe(true);
  });

  it("rejects duplicate plan ownership before loading textures or creating sprites", async () => {
    const parent = new FakeContainer();
    const input = snapshot();
    const accepted = deriveCourseSceneComposition({ course: input.course, seed: input.worldSeed });
    const firstOwner = accepted.habitatZones[0].ownerId;
    const corrupted: CourseSceneCompositionPlanV1 = {
      ...accepted,
      habitatZones: accepted.habitatZones.map((zone, index) => (
        index === 1 ? { ...zone, ownerId: firstOwner } : zone
      )),
    };
    const loader = immediateLoader();
    const createSprite = vi.fn(fakeSprite);
    const scene = createHabitatFieldSceneSystem(parent as unknown as PIXI.Container, {
      loader,
      derivePlan: () => corrupted,
      createContainer: () => new FakeContainer() as unknown as PIXI.Container,
      createSprite,
    });

    scene.create!(input);
    await scene.whenSettled();

    expect(scene.diagnostics()).toMatchObject({
      status: "failed",
      plannedZoneCount: accepted.habitatZones.length,
      plannedPlacementCount: accepted.habitatZones.flatMap((zone) => zone.placements).length,
      uniqueOwnerCount: accepted.habitatZones.length - 1,
      renderedCount: 0,
      suppressedCount: 0,
    });
    expect(scene.diagnostics().error).toContain(`ownerId is duplicated: ${firstOwner}`);
    expect(loader.load).not.toHaveBeenCalled();
    expect(createSprite).not.toHaveBeenCalled();
    expect(habitatLayer(parent).children).toHaveLength(0);
  });

  it.each([
    {
      name: "wrong tier",
      atlas: loadedAtlas("low", "standard"),
      diagnostics: { tier: "low", colorMode: "standard", manifestHash: PARKLAND_HABITAT_MANIFEST_HASH },
      actual: "actual tier=low, colorMode=standard",
    },
    {
      name: "wrong color mode",
      atlas: loadedAtlas("high", "protanopia"),
      diagnostics: { tier: "high", colorMode: "protanopia", manifestHash: PARKLAND_HABITAT_MANIFEST_HASH },
      actual: "actual tier=high, colorMode=protanopia",
    },
    {
      name: "wrong manifest hash",
      atlas: { ...loadedAtlas("high", "standard"), manifestHash: "wrong-manifest-hash" },
      diagnostics: { tier: "high", colorMode: "standard", manifestHash: "wrong-manifest-hash" },
      actual: "actual tier=high, colorMode=standard, manifestHash=wrong-manifest-hash",
    },
    {
      name: "wrong catalog header",
      atlas: {
        ...loadedAtlas("high", "standard"),
        catalog: {
          ...PARKLAND_HABITAT_CATALOGS.high,
          schema: "WrongHabitatAtlasSchema",
        } as unknown as LoadedHabitatAtlas["catalog"],
      },
      diagnostics: { tier: "high", colorMode: "standard", manifestHash: PARKLAND_HABITAT_MANIFEST_HASH },
      actual: "catalog(schema=WrongHabitatAtlasSchema,version=1,tier=high",
    },
  ])("fails closed with truthful diagnostics for a $name response", async ({ atlas, diagnostics, actual }) => {
    const parent = new FakeContainer();
    const frameTexture = vi.fn(atlas.frameTexture);
    const returnedAtlas: LoadedHabitatAtlas = { ...atlas, frameTexture };
    const loader: HabitatFieldAtlasLoader = {
      load: vi.fn(async () => returnedAtlas),
      destroy: vi.fn(),
      residency: () => [],
    };
    const createSprite = vi.fn(fakeSprite);
    const scene = createHabitatFieldSceneSystem(parent as unknown as PIXI.Container, {
      loader,
      createContainer: () => new FakeContainer() as unknown as PIXI.Container,
      createSprite,
    });

    scene.create!(snapshot());
    await scene.whenSettled();

    expect(scene.diagnostics()).toMatchObject({
      ...diagnostics,
      status: "failed",
      renderedCount: 0,
      suppressedCount: 0,
    });
    expect(scene.diagnostics().error).toContain(
      `requested tier=high, colorMode=standard, manifestHash=${PARKLAND_HABITAT_MANIFEST_HASH}`,
    );
    expect(scene.diagnostics().error).toContain(actual);
    expect(frameTexture).not.toHaveBeenCalled();
    expect(createSprite).not.toHaveBeenCalled();
    expect(habitatLayer(parent).children).toHaveLength(0);
  });

  it("rebuilds deterministically for rotation, quality, and color mode without destroying shared textures", async () => {
    const parent = new FakeContainer();
    const shared = fakeTexture();
    const loader = immediateLoader(shared);
    const scene = createHabitatFieldSceneSystem(parent as unknown as PIXI.Container, {
      loader,
      createContainer: () => new FakeContainer() as unknown as PIXI.Container,
      createSprite: fakeSprite,
    });

    scene.create!(snapshot());
    await scene.whenSettled();
    const first = habitatLayer(parent).children.map((child) => ({
      label: (child as PIXI.Sprite).label,
      x: (child as PIXI.Sprite).position.x,
      y: (child as PIXI.Sprite).position.y,
    }));
    const firstHash = scene.diagnostics().planHash;
    scene.update!(snapshot({
      rotation: 90,
      graphicsQuality: "medium",
      colorVision: "tritanopia",
      atlasRevision: 2,
    }));
    await scene.whenSettled();
    const second = habitatLayer(parent).children.map((child) => ({
      label: (child as PIXI.Sprite).label,
      x: (child as PIXI.Sprite).position.x,
      y: (child as PIXI.Sprite).position.y,
    }));

    expect(loader.load.mock.calls).toEqual([
      ["high", "standard"],
      ["medium", "tritanopia"],
    ]);
    expect(scene.diagnostics()).toMatchObject({ tier: "medium", colorMode: "tritanopia", planHash: firstHash });
    expect(second.map(({ label }) => label).sort()).toEqual(first.map(({ label }) => label).sort());
    expect(second.map(({ x, y }) => [x, y])).not.toEqual(first.map(({ x, y }) => [x, y]));
    expect(shared.destroy).not.toHaveBeenCalled();

    scene.destroy!();
    expect(shared.destroy).not.toHaveBeenCalled();
    expect(parent.children).toEqual([]);
    expect(loader.destroy).toHaveBeenCalledTimes(1);
  });

  it("ignores stale async loads and commits only the latest complete generation", async () => {
    const parent = new FakeContainer();
    const pending: Array<(atlas: LoadedHabitatAtlas) => void> = [];
    const loader: HabitatFieldAtlasLoader = {
      load: (tier, mode) => new Promise((resolve) => pending.push(() => resolve(loadedAtlas(tier, mode)))),
      destroy: vi.fn(),
      residency: () => [],
    };
    const scene = createHabitatFieldSceneSystem(parent as unknown as PIXI.Container, {
      loader,
      createContainer: () => new FakeContainer() as unknown as PIXI.Container,
      createSprite: fakeSprite,
    });

    scene.create!(snapshot());
    scene.update!(snapshot({ graphicsQuality: "low", colorVision: "protanopia", atlasRevision: 2 }));
    pending[0](loadedAtlas("high", "standard"));
    await Promise.resolve();
    expect(habitatLayer(parent).children).toHaveLength(0);
    expect(scene.diagnostics()).toMatchObject({ status: "loading", tier: "low", colorMode: "protanopia" });
    pending[1](loadedAtlas("low", "protanopia"));
    await scene.whenSettled();
    expect(scene.diagnostics()).toMatchObject({ status: "ready", staleLoadCount: 1 });
  });

  it("fails closed on a missing frame without leaving a partial false field", async () => {
    const parent = new FakeContainer();
    const input = snapshot();
    const plan = deriveCourseSceneComposition({ course: input.course, seed: input.worldSeed });
    const missing = plan.habitatZones[0].placements[0].frameId;
    const loader: HabitatFieldAtlasLoader = {
      load: async (tier, mode) => loadedAtlas(tier, mode, fakeTexture(), missing),
      destroy: vi.fn(),
      residency: () => [],
    };
    const scene = createHabitatFieldSceneSystem(parent as unknown as PIXI.Container, {
      loader,
      createContainer: () => new FakeContainer() as unknown as PIXI.Container,
      createSprite: fakeSprite,
    });

    scene.create!(input);
    await scene.whenSettled();
    expect(scene.diagnostics()).toMatchObject({ status: "failed", renderedCount: 0, suppressedCount: 0 });
    expect(scene.diagnostics().missingCount).toBeGreaterThan(0);
    expect(habitatLayer(parent).children).toHaveLength(0);
  });

  it("suppresses near live golfers/editor previews at tick time and restores the same sprites when clear", async () => {
    const parent = new FakeContainer();
    const input = snapshot();
    const plan = deriveCourseSceneComposition({ course: input.course, seed: input.worldSeed });
    const target = plan.habitatZones[0].placements[0].tile;
    const scene = createHabitatFieldSceneSystem(parent as unknown as PIXI.Container, {
      loader: immediateLoader(),
      createContainer: () => new FakeContainer() as unknown as PIXI.Container,
      createSprite: fakeSprite,
    });
    scene.create!(input);
    await scene.whenSettled();
    const original = [...habitatLayer(parent).children];

    scene.tick({ golfers: [target], editorPreviewPoints: [{ x: target.x + 20, y: target.y + 20 }] });
    expect(scene.diagnostics().suppressedCount).toBeGreaterThan(0);
    expect((habitatLayer(parent).children as Array<{ visible: boolean }>).some((sprite) => !sprite.visible)).toBe(true);

    scene.tick({ golfers: [], editorPreviewPoints: [] });
    expect(scene.diagnostics()).toMatchObject({ suppressedCount: 0, renderedCount: original.length });
    expect(habitatLayer(parent).children).toEqual(original);
    expect((habitatLayer(parent).children as Array<{ visible: boolean }>).every((sprite) => sprite.visible)).toBe(true);
  });

  it("does not load or render for non-Parkland themes", async () => {
    const parent = new FakeContainer();
    const loader = immediateLoader();
    const base = snapshot();
    const scene = createHabitatFieldSceneSystem(parent as unknown as PIXI.Container, {
      loader,
      createContainer: () => new FakeContainer() as unknown as PIXI.Container,
      createSprite: fakeSprite,
    });
    scene.create!(snapshot({ course: { ...base.course, theme: "links" } }));
    await scene.whenSettled();
    expect(scene.diagnostics()).toMatchObject({ status: "inactive", plannedPlacementCount: 0, renderedCount: 0 });
    expect(loader.load).not.toHaveBeenCalled();
  });
});
