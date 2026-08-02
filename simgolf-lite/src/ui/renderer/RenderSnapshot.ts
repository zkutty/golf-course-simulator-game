import type { ColorVisionMode } from "../../game/onboarding/profile";
import type { Course, Hole, Point, Terrain } from "../../game/models/types";
import type { SeasonalVisualState } from "../../game/presentation/seasonalVisualState";
import type { IsoRotation } from "../../game/render/iso";
import type { PlayerPlayableRound, PlayerProPoint } from "../../game/models/playerProTypes";

export type RenderSceneId = "seasonalTerrain" | "surfaceCare" | "structuresProps" | "overlaysDiagnostics";

export type RenderRevisions = Readonly<Record<RenderSceneId, number>>;

export interface RenderSnapshot {
  readonly course: Course;
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
  /** Asset completion is a declared input for systems that resolve atlas frames. */
  readonly atlasRevision: number;
  readonly playerRound?: PlayerPlayableRound | null;
  readonly playerShotAim?: PlayerProPoint | null;
  readonly worldSeed: number;
  readonly surfaceHeightAt: (x: number, y: number) => number;
  readonly revisions: RenderRevisions;
}
export type RenderRevisionDependencies = Readonly<
  Record<RenderSceneId, readonly unknown[]>
>;

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
    seasonalTerrain: 0,
    surfaceCare: 0,
    structuresProps: 0,
    overlaysDiagnostics: 0,
  };

  update(next: RenderRevisionDependencies): RenderRevisions {
    let revisions = this.revisions;
    for (const scene of Object.keys(next) as RenderSceneId[]) {
      if (!dependenciesChanged(this.dependencies[scene], next[scene])) continue;
      if (revisions === this.revisions) revisions = { ...this.revisions };
      revisions = { ...revisions, [scene]: revisions[scene] + 1 };
      this.dependencies[scene] = [...next[scene]];
    }
    this.revisions = revisions;
    return revisions;
  }
}
