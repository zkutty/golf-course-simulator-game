import * as PIXI from "pixi.js";
import { deriveCourseSceneComposition, type CourseSceneCompositionPlanV1 } from "../../../game/render/courseSceneComposition";
import type { HabitatFieldPlacement } from "../../../game/render/habitatFieldTopology";
import { TILE_H, TILE_W, worldToIso } from "../../../game/render/iso";
import type { Point } from "../../../game/models/types";
import type { ColorVisionMode } from "../../../game/onboarding/profile";
import { hashCanonicalValue } from "../../../utils/canonical";
import {
  PARKLAND_HABITAT_CATALOGS,
  PARKLAND_HABITAT_MANIFEST_HASH,
  createHabitatFieldAtlasLoader,
  type HabitatAtlasTier,
  type HabitatFieldAtlasLoader,
  type LoadedHabitatAtlas,
} from "../../../render/habitatFieldAtlas";
import type { RenderSnapshot } from "../RenderSnapshot";
import type { RenderSceneSystem } from "../SceneSystemHost";

export type HabitatFieldSceneStatus = "inactive" | "loading" | "ready" | "failed" | "destroyed";

export interface HabitatFieldDiagnostics {
  readonly manifestHash: string;
  readonly planHash: string | null;
  readonly tier: HabitatAtlasTier | null;
  readonly colorMode: ColorVisionMode | null;
  readonly status: HabitatFieldSceneStatus;
  readonly error: string | null;
  readonly plannedZoneCount: number;
  readonly plannedPlacementCount: number;
  /** Currently visible sprites; suppressed sprites remain alive in the plan/runtime. */
  readonly renderedCount: number;
  readonly suppressedCount: number;
  readonly missingCount: number;
  readonly uniqueOwnerCount: number;
  readonly uniqueFrameCount: number;
  readonly legacyParklandHabitatCount: number;
  readonly rebuildGeneration: number;
  readonly loadGeneration: number;
  readonly staleLoadCount: number;
  readonly residency: readonly string[];
}

export interface HabitatFieldTickInput {
  readonly golfers: readonly Pick<Point, "x" | "y">[];
  readonly editorPreviewPoints: readonly Pick<Point, "x" | "y">[];
}

export interface HabitatFieldSceneSystem extends RenderSceneSystem {
  readonly id: "habitatField";
  tick(input: HabitatFieldTickInput): void;
  diagnostics(): HabitatFieldDiagnostics;
  whenSettled(): Promise<void>;
}

export interface HabitatFieldSceneDependencies {
  readonly loader?: HabitatFieldAtlasLoader;
  readonly derivePlan?: typeof deriveCourseSceneComposition;
  readonly createContainer?: () => PIXI.Container;
  readonly createSprite?: (texture: PIXI.Texture) => PIXI.Sprite;
}

interface PlacementRuntime {
  readonly ownerId: string;
  readonly placement: HabitatFieldPlacement;
  readonly sprite: PIXI.Sprite;
}

function emptyDiagnostics(): HabitatFieldDiagnostics {
  return {
    manifestHash: PARKLAND_HABITAT_MANIFEST_HASH,
    planHash: null,
    tier: null,
    colorMode: null,
    status: "inactive",
    error: null,
    plannedZoneCount: 0,
    plannedPlacementCount: 0,
    renderedCount: 0,
    suppressedCount: 0,
    missingCount: 0,
    uniqueOwnerCount: 0,
    uniqueFrameCount: 0,
    legacyParklandHabitatCount: 0,
    rebuildGeneration: 0,
    loadGeneration: 0,
    staleLoadCount: 0,
    residency: [],
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function placementKey(ownerId: string, placement: HabitatFieldPlacement): string {
  return `${ownerId}|${placement.tile.x},${placement.tile.y}`;
}

function tileKey(tile: Pick<Point, "x" | "y">): string {
  return `${tile.x},${tile.y}`;
}

function validatePlanIdentity(plan: CourseSceneCompositionPlanV1): string | null {
  const zoneIds = new Set<string>();
  const ownerIds = new Set<string>();
  const occupiedTiles = new Set<string>();
  const placementTiles = new Set<string>();
  const placementOwners = new Set<string>();

  for (const zone of plan.habitatZones) {
    if (zone.id.trim().length === 0) return "Habitat plan zone id must be nonempty";
    if (zone.ownerId.trim().length === 0) return `Habitat plan zone ${zone.id} ownerId must be nonempty`;
    if (zoneIds.has(zone.id)) return `Habitat plan zone id is duplicated: ${zone.id}`;
    if (ownerIds.has(zone.ownerId)) return `Habitat plan ownerId is duplicated: ${zone.ownerId}`;
    zoneIds.add(zone.id);
    ownerIds.add(zone.ownerId);
    if (zone.ownerId !== zone.id) {
      return `Habitat plan zone owner relation is invalid: zone id=${zone.id}, ownerId=${zone.ownerId}`;
    }
    if (zone.area !== zone.occupancy.length || zone.placements.length !== zone.occupancy.length) {
      return `Habitat plan zone ${zone.id} does not preserve its area/occupancy/placement bijection`;
    }

    const zoneOccupancy = new Set<string>();
    for (const tile of zone.occupancy) {
      const key = tileKey(tile);
      if (zoneOccupancy.has(key) || occupiedTiles.has(key)) {
        return `Habitat plan occupancy tile is duplicated globally: ${key}`;
      }
      zoneOccupancy.add(key);
      occupiedTiles.add(key);
    }

    const zonePlacements = new Set<string>();
    for (const placement of zone.placements) {
      const key = tileKey(placement.tile);
      const ownerKey = placementKey(zone.ownerId, placement);
      if (zonePlacements.has(key) || placementTiles.has(key) || placementOwners.has(ownerKey)) {
        return `Habitat plan placement identity is duplicated globally: ownerId=${zone.ownerId}, tile=${key}`;
      }
      if (!zoneOccupancy.has(key) || placement.family !== zone.family) {
        return `Habitat plan placement does not match zone ${zone.id}: tile=${key}, family=${placement.family}`;
      }
      zonePlacements.add(key);
      placementTiles.add(key);
      placementOwners.add(ownerKey);
    }
    if ([...zoneOccupancy].some((key) => !zonePlacements.has(key))) {
      return `Habitat plan zone ${zone.id} placements do not cover occupancy exactly`;
    }
  }
  return null;
}

function atlasHeader(catalog: LoadedHabitatAtlas["catalog"]): string {
  return `schema=${catalog.schema},version=${catalog.version},tier=${catalog.tier},image=${catalog.image},size=${catalog.width}x${catalog.height},gutter=${catalog.gutterPx},frames=${catalog.frameCount}`;
}

function validateAtlasIdentity(
  atlas: LoadedHabitatAtlas,
  requestedTier: HabitatAtlasTier,
  requestedColorMode: ColorVisionMode,
): string | null {
  const expectedCatalog = PARKLAND_HABITAT_CATALOGS[requestedTier];
  const request = `requested tier=${requestedTier}, colorMode=${requestedColorMode}, manifestHash=${PARKLAND_HABITAT_MANIFEST_HASH}, catalog(${atlasHeader(expectedCatalog)})`;
  const actual = `actual tier=${atlas.tier}, colorMode=${atlas.colorMode}, manifestHash=${atlas.manifestHash}, catalog(${atlasHeader(atlas.catalog)})`;
  if (atlas.tier !== requestedTier
    || atlas.colorMode !== requestedColorMode
    || atlas.manifestHash !== PARKLAND_HABITAT_MANIFEST_HASH
    || atlas.catalog.schema !== expectedCatalog.schema
    || atlas.catalog.version !== expectedCatalog.version
    || atlas.catalog.tier !== expectedCatalog.tier
    || atlas.catalog.image !== expectedCatalog.image
    || atlas.catalog.width !== expectedCatalog.width
    || atlas.catalog.height !== expectedCatalog.height
    || atlas.catalog.gutterPx !== expectedCatalog.gutterPx
    || atlas.catalog.frameCount !== expectedCatalog.frameCount) {
    return `Habitat atlas identity mismatch: ${request}; ${actual}`;
  }
  return null;
}

function placementMatchesAtlas(
  placement: HabitatFieldPlacement,
  atlas: LoadedHabitatAtlas,
): boolean {
  const high = PARKLAND_HABITAT_CATALOGS.high.frames[placement.frameId];
  const selected = atlas.catalog.frames[placement.frameId];
  if (!high || !selected) return false;
  if (selected.family !== placement.family
    || selected.topologyRole !== placement.topologyRole
    || selected.direction !== placement.direction
    || selected.corner !== placement.corner
    || selected.variant !== placement.variant
    || selected.edgeAnchors.join(",") !== placement.edgeAnchors.join(",")) return false;
  const expectedX = placement.atlasAnchor.x / high.frame.width;
  const expectedY = placement.atlasAnchor.y / high.frame.height;
  return Math.abs(selected.anchor.x / selected.frame.width - expectedX) < 1e-12
    && Math.abs(selected.anchor.y / selected.frame.height - expectedY) < 1e-12;
}

function snapshotCourse(snapshot: RenderSnapshot): RenderSnapshot["course"] {
  return {
    ...snapshot.course,
    tiles: [...snapshot.effectiveTiles],
    obstacles: [...snapshot.obstacles],
    holes: [...snapshot.holes],
  };
}

/**
 * Visual-only owner for the verified P2 habitat plan. It never mutates the
 * course, participates in picking, or creates tree/collision substitutes.
 */
export function createHabitatFieldSceneSystem(
  parent: PIXI.Container,
  dependencies: HabitatFieldSceneDependencies = {},
): HabitatFieldSceneSystem {
  const loader = dependencies.loader ?? createHabitatFieldAtlasLoader();
  const derivePlan = dependencies.derivePlan ?? deriveCourseSceneComposition;
  const createContainer = dependencies.createContainer ?? (() => new PIXI.Container());
  const createSprite = dependencies.createSprite ?? ((texture) => new PIXI.Sprite(texture));
  const layer = createContainer();
  layer.label = "habitat-field:verified-plan";
  layer.eventMode = "none";
  layer.sortableChildren = true;
  let layerMounted = false;
  let destroyed = false;
  let generation = 0;
  let staleLoads = 0;
  let runtimes: PlacementRuntime[] = [];
  let diagnostics = emptyDiagnostics();
  let settled = Promise.resolve();

  const clearSprites = () => {
    for (const runtime of runtimes) {
      runtime.sprite.parent?.removeChild(runtime.sprite);
      runtime.sprite.destroy();
    }
    runtimes = [];
  };

  const mount = () => {
    if (layerMounted) return;
    parent.addChild(layer);
    layerMounted = true;
  };

  const fail = (
    currentGeneration: number,
    base: HabitatFieldDiagnostics,
    error: unknown,
    missingCount = base.plannedPlacementCount,
  ) => {
    if (destroyed || currentGeneration !== generation) {
      staleLoads++;
      return;
    }
    clearSprites();
    diagnostics = {
      ...base,
      status: "failed",
      error: message(error),
      renderedCount: 0,
      suppressedCount: 0,
      missingCount,
      staleLoadCount: staleLoads,
      residency: loader.residency(),
    };
  };

  const commit = (
    currentGeneration: number,
    snapshot: RenderSnapshot,
    plan: CourseSceneCompositionPlanV1,
    atlas: LoadedHabitatAtlas,
    base: HabitatFieldDiagnostics,
  ) => {
    if (destroyed || currentGeneration !== generation) {
      staleLoads++;
      return;
    }
    const returnedBase: HabitatFieldDiagnostics = {
      ...base,
      manifestHash: atlas.manifestHash,
      tier: atlas.tier,
      colorMode: atlas.colorMode,
    };
    const identityError = validateAtlasIdentity(atlas, snapshot.graphicsQuality, snapshot.colorVision);
    if (identityError) {
      fail(currentGeneration, returnedBase, new Error(identityError));
      return;
    }
    const prepared: PlacementRuntime[] = [];
    const seen = new Set<string>();
    let missing = 0;
    for (const zone of plan.habitatZones) {
      for (const placement of zone.placements) {
        const key = placementKey(zone.ownerId, placement);
        const texture = atlas.frameTexture(placement.frameId);
        if (seen.has(key) || !texture || !placementMatchesAtlas(placement, atlas)) {
          missing++;
          continue;
        }
        seen.add(key);
        const position = worldToIso(
          placement.worldAnchor.x,
          placement.worldAnchor.y,
          snapshot.surfaceHeightAt(placement.worldAnchor.x, placement.worldAnchor.y),
          snapshot.rotation,
        );
        const frame = atlas.catalog.frames[placement.frameId];
        const sprite = createSprite(texture);
        sprite.label = `habitat-field:${zone.ownerId}:${placement.tile.x},${placement.tile.y}:${placement.frameId}`;
        sprite.eventMode = "none";
        sprite.anchor.set(frame.anchor.x / frame.frame.width, frame.anchor.y / frame.frame.height);
        sprite.position.set(position.x, position.y);
        sprite.width = TILE_W;
        sprite.height = TILE_H;
        sprite.zIndex = position.y;
        prepared.push({ ownerId: zone.ownerId, placement, sprite });
      }
    }
    if (missing > 0 || prepared.length !== base.plannedPlacementCount) {
      for (const runtime of prepared) runtime.sprite.destroy();
      fail(currentGeneration, returnedBase, new Error("Habitat field atlas is missing or mismatches one or more planned frames"), missing || base.plannedPlacementCount - prepared.length);
      return;
    }
    clearSprites();
    for (const runtime of prepared) layer.addChild(runtime.sprite);
    layer.sortChildren();
    runtimes = prepared;
    diagnostics = {
      ...returnedBase,
      status: "ready",
      error: null,
      renderedCount: prepared.length,
      suppressedCount: 0,
      missingCount: 0,
      staleLoadCount: staleLoads,
      residency: loader.residency(),
    };
  };

  const render = (snapshot: RenderSnapshot) => {
    mount();
    generation++;
    const currentGeneration = generation;
    clearSprites();
    if (snapshot.course.theme !== "parkland") {
      diagnostics = {
        ...emptyDiagnostics(),
        status: "inactive",
        rebuildGeneration: currentGeneration,
        loadGeneration: currentGeneration,
        staleLoadCount: staleLoads,
        residency: loader.residency(),
      };
      settled = Promise.resolve();
      return;
    }

    let plan: CourseSceneCompositionPlanV1;
    try {
      plan = derivePlan({ course: snapshotCourse(snapshot), seed: snapshot.worldSeed });
    } catch (error) {
      const base = {
        ...emptyDiagnostics(),
        tier: snapshot.graphicsQuality,
        colorMode: snapshot.colorVision,
        rebuildGeneration: currentGeneration,
        loadGeneration: currentGeneration,
      };
      fail(currentGeneration, base, error);
      settled = Promise.resolve();
      return;
    }
    const placements = plan.habitatZones.flatMap((zone) => zone.placements);
    const base: HabitatFieldDiagnostics = {
      manifestHash: PARKLAND_HABITAT_MANIFEST_HASH,
      planHash: hashCanonicalValue(plan),
      tier: snapshot.graphicsQuality,
      colorMode: snapshot.colorVision,
      status: "loading",
      error: null,
      plannedZoneCount: plan.habitatZones.length,
      plannedPlacementCount: placements.length,
      renderedCount: 0,
      suppressedCount: 0,
      missingCount: 0,
      uniqueOwnerCount: new Set(plan.habitatZones.map((zone) => zone.ownerId)).size,
      uniqueFrameCount: new Set(placements.map((placement) => placement.frameId)).size,
      legacyParklandHabitatCount: 0,
      rebuildGeneration: currentGeneration,
      loadGeneration: currentGeneration,
      staleLoadCount: staleLoads,
      residency: loader.residency(),
    };
    diagnostics = base;
    const planIdentityError = validatePlanIdentity(plan);
    if (planIdentityError) {
      fail(currentGeneration, base, new Error(planIdentityError));
      settled = Promise.resolve();
      return;
    }
    settled = loader.load(snapshot.graphicsQuality, snapshot.colorVision).then(
      (atlas) => commit(currentGeneration, snapshot, plan, atlas, base),
      (error) => fail(currentGeneration, base, error),
    );
  };

  return {
    id: "habitatField",
    create: render,
    update: render,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      generation++;
      clearSprites();
      layer.parent?.removeChild(layer);
      layer.destroy({ children: false });
      loader.destroy();
      diagnostics = {
        ...diagnostics,
        status: "destroyed",
        renderedCount: 0,
        suppressedCount: 0,
        rebuildGeneration: generation,
        staleLoadCount: staleLoads,
        residency: [],
      };
    },
    tick(input) {
      if (destroyed || diagnostics.status !== "ready") return;
      const radius = 2;
      let suppressed = 0;
      const points = [...input.golfers, ...input.editorPreviewPoints];
      for (const runtime of runtimes) {
        const hidden = points.some((point) => Math.max(
          Math.abs(runtime.placement.tile.x - point.x),
          Math.abs(runtime.placement.tile.y - point.y),
        ) <= radius);
        runtime.sprite.visible = !hidden;
        if (hidden) suppressed++;
      }
      diagnostics = {
        ...diagnostics,
        renderedCount: runtimes.length - suppressed,
        suppressedCount: suppressed,
        staleLoadCount: staleLoads,
        residency: loader.residency(),
      };
    },
    diagnostics: () => ({ ...diagnostics, residency: [...diagnostics.residency] }),
    whenSettled: () => settled,
  };
}
