import type { GameState } from "../gameState";
import type { ColorVisionMode } from "../onboarding/profile";
import type { Course, Hole, Obstacle, Point, TeeSet, Terrain } from "../models/types";
import type { SeasonalVisualState } from "../presentation/seasonalVisualState";
import type { PlayerPlayableRound, PlayerProPoint } from "../models/playerProTypes";
import type { IsoRotation } from "./iso";
import type { PlayerProWorldDisplayPresentation } from "../playerPro/socialPresentation";

/** Stable ownership boundaries for the Pixi scene-system migration. */
export const RENDER_SYSTEMS = [
  "terrain-materials",
  "structures-props",
  "mobile-entities",
  "overlays-diagnostics",
  "atmosphere",
  "viewport-input",
] as const;

export type RenderSystem = (typeof RENDER_SYSTEMS)[number];
export type RenderRevision = number | string;
export type RenderSystemRevisions = Readonly<Record<RenderSystem, RenderRevision>>;

/**
 * Typed renderer input derived from authoritative game state plus host-owned
 * live/viewport revisions. Systems must only observe their declared revision.
 */
export interface RenderSubsystemSnapshot {
  readonly course: Course;
  readonly revisions: RenderSystemRevisions;
}

export interface RenderSnapshotInput {
  readonly state: GameState;
  /** Live golfers, vehicles, wildlife, and transient flight state stay external to the reducer. */
  readonly mobileEntitiesRevision?: number;
  /** UI-only overlays and diagnostics not represented by `selectedTerrain`. */
  readonly overlayRevision?: number;
  /** Camera, pane size, and input-mode changes are host-owned. */
  readonly viewportInputRevision?: number;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

/**
 * Creates the coarse-grained invalidation contract. The existing GameSession
 * version fields remain authoritative for persistent course edits; the host
 * supplies only revisions for state it already owns outside GameSession.
 */
export function createRenderSnapshot(input: RenderSnapshotInput): RenderSubsystemSnapshot {
  const { state } = input;
  const atmosphereRevision = state.world.seasonal?.calendar.absoluteDay ?? 0;
  return Object.freeze({
    course: state.course,
    revisions: Object.freeze({
      "terrain-materials": nonNegativeInteger(state.terrainVersion),
      "structures-props": nonNegativeInteger(state.markersVersion),
      "mobile-entities": nonNegativeInteger(input.mobileEntitiesRevision),
      "overlays-diagnostics": `${state.selectedTerrain}:${nonNegativeInteger(input.overlayRevision)}`,
      atmosphere: nonNegativeInteger(atmosphereRevision),
      "viewport-input": nonNegativeInteger(input.viewportInputRevision),
    }),
  });
}

/** Returns only the systems that need an update for a new snapshot. */
export function changedRenderSystems(
  previous: RenderSubsystemSnapshot | null | undefined,
  next: RenderSubsystemSnapshot,
): readonly RenderSystem[] {
  if (!previous) return RENDER_SYSTEMS;
  return RENDER_SYSTEMS.filter((system) => previous.revisions[system] !== next.revisions[system]);
}

/**
 * Concrete scene IDs hosted by PixiStage. These refine the coarse migration
 * boundaries above without creating a second renderer snapshot authority.
 */
export type RenderSceneId =
  | "atmosphere"
  | "surfaceCare"
  | "structuresProps"
  | "playerProCollection"
  | "naturalProps"
  | "holeMarkers"
  | "overlaysDiagnostics"
  | "estateSurvey";

type LegacyRenderSceneId = Exclude<RenderSceneId, "holeMarkers">;

/** New bounded scenes stay optional for compatibility with older test fixtures. */
export type RenderRevisions = Readonly<
  Record<LegacyRenderSceneId, number> & Partial<Record<RenderSceneId, number>>
>;

/** Canonical typed payload consumed by every hosted Pixi scene system. */
export interface RenderSnapshot {
  readonly course: Course;
  /** Natural obstacles may be previewed independently of the persisted course object. */
  readonly obstacles: readonly Obstacle[];
  readonly effectiveTiles: readonly Terrain[];
  readonly holes: readonly Hole[];
  readonly draftTee: Point | null;
  readonly draftGreen: Point | null;
  readonly rotation: IsoRotation;
  readonly seasonalVisualState?: SeasonalVisualState;
  readonly graphicsQuality: "high" | "medium" | "low";
  readonly colorVision: ColorVisionMode;
  readonly reducedMotion: boolean;
  readonly animationsEnabled: boolean;
  readonly showObstacles: boolean;
  readonly showMarkers?: boolean;
  readonly selectedTeeSet?: TeeSet;
  readonly flagColor?: string;
  /** Asset completion is a declared input for systems that resolve atlas frames. */
  readonly atlasRevision: number;
  readonly playerRound?: PlayerPlayableRound | null;
  readonly playerShotAim?: PlayerProPoint | null;
  /** Player-visible inventory projection; never raw career or rival state. */
  readonly playerProWorldDisplay?: PlayerProWorldDisplayPresentation | null;
  readonly surveyMode: boolean;
  readonly selectedParcelId?: string | null;
  readonly worldSeed: number;
  readonly surfaceHeightAt: (x: number, y: number) => number;
  readonly revisions: RenderRevisions;
}

export type RenderRevisionDependencies = Readonly<
  Record<LegacyRenderSceneId, readonly unknown[]> &
  Partial<Record<RenderSceneId, readonly unknown[]>>
>;

export interface StructuresPropsRevisionInput {
  readonly atlasRevision: number;
  readonly course: Pick<
    Course,
    "buildings" | "decorations" | "elevations" | "height" | "property" | "theme" | "width"
  >;
  readonly effectiveTiles: readonly Terrain[];
  readonly graphicsQuality: RenderSnapshot["graphicsQuality"];
  readonly rotation: IsoRotation;
  readonly seasonalPlantsSignature: string;
}

export interface PlayerProCollectionRevisionInput {
  readonly atlasRevision: number;
  readonly course: Pick<Course, "buildings" | "elevations" | "height" | "theme" | "width">;
  readonly graphicsQuality: RenderSnapshot["graphicsQuality"];
  readonly rotation: IsoRotation;
  readonly surfaceHeightAt: RenderSnapshot["surfaceHeightAt"];
  readonly worldDisplay?: PlayerProWorldDisplayPresentation | null;
}

export interface HoleMarkersRevisionInput {
  readonly holes: readonly Hole[];
  readonly activePinRotation: Course["activePinRotation"];
  readonly draftTee: Point | null;
  readonly draftGreen: Point | null;
  readonly selectedTeeSet?: TeeSet;
  readonly showMarkers?: boolean;
  readonly rotation: IsoRotation;
  readonly surfaceHeightAt: RenderSnapshot["surfaceHeightAt"];
  readonly flagColor?: string;
  readonly animationsEnabled: boolean;
  readonly reducedMotion: boolean;
}

/** Exact physical/presentation inputs consumed by tee, cup, draft, and flag visuals. */
export function holeMarkersRevisionDependencies(
  input: HoleMarkersRevisionInput,
): readonly unknown[] {
  return [
    input.holes,
    input.activePinRotation ?? "A",
    input.draftTee,
    input.draftGreen,
    input.selectedTeeSet ?? "member",
    input.showMarkers !== false,
    input.rotation,
    input.surfaceHeightAt,
    input.flagColor ?? "#d9534f",
    input.animationsEnabled,
    input.reducedMotion,
  ];
}

/** Exact visible and physical inputs consumed by the Player Pro display scene. */
export function playerProCollectionRevisionDependencies(
  input: PlayerProCollectionRevisionInput,
): readonly unknown[] {
  return [
    input.atlasRevision,
    input.course.buildings,
    input.course.elevations,
    input.course.height,
    input.course.theme,
    input.course.width,
    input.graphicsQuality,
    input.rotation,
    input.surfaceHeightAt,
    input.worldDisplay?.revision ?? "player-pro-display:none",
  ];
}

/** Exact physical/presentation inputs consumed by the authored-props scene. */
export function structuresPropsRevisionDependencies(
  input: StructuresPropsRevisionInput,
): readonly unknown[] {
  const { course } = input;
  return [
    input.atlasRevision,
    course.buildings,
    course.decorations,
    course.elevations,
    course.height,
    course.property?.assets,
    course.theme,
    course.width,
    input.effectiveTiles,
    input.graphicsQuality,
    input.rotation,
    input.seasonalPlantsSignature,
  ];
}

function dependenciesChanged(
  previous: readonly unknown[] | undefined,
  next: readonly unknown[],
): boolean {
  if (!previous || previous.length !== next.length) return true;
  return next.some((value, index) => !Object.is(value, previous[index]));
}

/**
 * Converts React/input identities into explicit, monotonic scene revisions.
 * Each scene owns its dependency list, so adding a system does not broaden
 * invalidation for existing layers.
 */
export class RenderRevisionTracker {
  private dependencies: Partial<Record<RenderSceneId, readonly unknown[]>> = {};
  private revisions: RenderRevisions = {
    atmosphere: 0,
    surfaceCare: 0,
    structuresProps: 0,
    playerProCollection: 0,
    naturalProps: 0,
    overlaysDiagnostics: 0,
    estateSurvey: 0,
  };

  update(next: RenderRevisionDependencies): RenderRevisions {
    let revisions = this.revisions;
    for (const scene of Object.keys(next) as RenderSceneId[]) {
      const sceneDependencies = next[scene];
      if (!sceneDependencies) continue;
      if (!dependenciesChanged(this.dependencies[scene], sceneDependencies)) continue;
      if (revisions === this.revisions) revisions = { ...this.revisions };
      revisions = { ...revisions, [scene]: (revisions[scene] ?? 0) + 1 };
      this.dependencies[scene] = [...sceneDependencies];
    }
    this.revisions = revisions;
    return revisions;
  }
}
