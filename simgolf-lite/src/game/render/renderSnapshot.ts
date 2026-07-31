import type { GameState } from "../gameState";
import type { Course } from "../models/types";

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
export interface RenderSnapshot {
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
export function createRenderSnapshot(input: RenderSnapshotInput): RenderSnapshot {
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
  previous: RenderSnapshot | null | undefined,
  next: RenderSnapshot,
): readonly RenderSystem[] {
  if (!previous) return RENDER_SYSTEMS;
  return RENDER_SYSTEMS.filter((system) => previous.revisions[system] !== next.revisions[system]);
}
