import type { PinRotation, TeeSet, Terrain } from "../models/types";

export type HoleIllustrationRouteSource = "published" | "draft";

export interface HoleIllustrationSnapshotRequest {
  readonly layoutId: string;
  readonly routeSource: HoleIllustrationRouteSource;
  readonly holeId: string;
  readonly teeSet: TeeSet;
  readonly pinRotation: PinRotation;
  /** Landscape context beyond the four-tile playable corridor, clamped to 0..64. */
  readonly marginTiles?: number;
}

export interface HoleIllustrationLocalPoint {
  /** North-up snapshot-local coordinates. */
  readonly x: number;
  readonly y: number;
  /** Snapshot-local coordinates after rotating the tee-to-pin bearing north. */
  readonly teeToGreen: { readonly x: number; readonly y: number };
}

export interface HoleIllustrationFrame {
  readonly mode: "north-up" | "tee-to-green";
  readonly originCourse: { readonly x: number; readonly y: number };
  /** Clockwise-positive course-space rotation applied before translation. */
  readonly rotationDegrees: number;
  /** Exact published coefficients used by the snapshot: x'=a*x+c*y, y'=b*x+d*y. */
  readonly matrix: { readonly a: number; readonly b: number; readonly c: number; readonly d: number };
  readonly translation: { readonly x: number; readonly y: number };
  readonly crop: { readonly width: number; readonly height: number };
  /** Deterministic fit into a unit square; consumers may multiply by their viewport. */
  readonly scaleToUnit: number;
}

export interface HoleIllustrationCell extends HoleIllustrationLocalPoint {
  readonly terrain: Terrain;
  readonly elevation: number;
}

export interface HoleIllustrationContourTile extends HoleIllustrationLocalPoint {
  readonly offsets: readonly number[];
}

export interface HoleIllustrationObstacle extends HoleIllustrationLocalPoint {
  readonly type: string;
  readonly plantId?: string;
}

export interface HoleIllustrationDecoration extends HoleIllustrationLocalPoint {
  readonly kind: string;
  readonly rotation: number;
  readonly variant?: number;
  readonly plantId?: string;
  readonly span?: number;
  readonly footprint: readonly HoleIllustrationLocalPoint[];
}

export interface HoleIllustrationSurrounding extends HoleIllustrationLocalPoint {
  readonly type: string;
  readonly tier?: number;
  readonly footprint: readonly HoleIllustrationLocalPoint[];
}

export interface HoleIllustrationProvenance {
  readonly templateId: string;
  readonly sourceLabel: string;
  readonly licenseName?: string;
  readonly attribution?: string;
}

export interface HoleIllustrationSnapshot {
  readonly version: 1;
  readonly hash: string;
  readonly route: {
    readonly layoutId: string;
    readonly source: HoleIllustrationRouteSource;
    readonly holeId: string;
    /** Zero-based position in the explicitly selected route. */
    readonly order: number;
    readonly length: number;
    readonly routingIds: readonly string[];
  };
  readonly selection: { readonly teeSet: TeeSet; readonly pinRotation: PinRotation };
  readonly tee: HoleIllustrationLocalPoint;
  readonly pin: HoleIllustrationLocalPoint;
  readonly waypoints: readonly HoleIllustrationLocalPoint[];
  readonly par: 3 | 4 | 5;
  readonly parMode: "AUTO" | "MANUAL";
  readonly distanceTiles: number;
  readonly yardage: number;
  readonly yardsPerTile: number;
  readonly north: { readonly x: 0; readonly y: -1 };
  readonly framing: {
    readonly marginTiles: number;
    readonly corridorRadiusTiles: number;
    readonly northUp: HoleIllustrationFrame;
    readonly teeToGreen: HoleIllustrationFrame;
  };
  /** Canonically ordered cells in the buffered playable corridor and intersecting footprints. */
  readonly terrain: readonly HoleIllustrationCell[];
  readonly contours: {
    readonly version: 1;
    readonly samplesPerAxis: 4;
    readonly fixedPointScale: 1024;
    readonly interpolation: "bilinear";
    readonly tiles: readonly HoleIllustrationContourTile[];
  };
  readonly obstacles: readonly HoleIllustrationObstacle[];
  readonly decorations: readonly HoleIllustrationDecoration[];
  readonly surroundings: readonly HoleIllustrationSurrounding[];
  readonly provenance?: HoleIllustrationProvenance;
}

export type HoleIllustrationIncompleteCode =
  | "INVALID_COURSE"
  | "INVALID_LAYOUT"
  | "INVALID_SELECTION"
  | "MISSING_HOLE"
  | "HOLE_NOT_ROUTED"
  | "MISSING_TEE"
  | "MISSING_PIN"
  | "INVALID_TEE"
  | "INVALID_PIN"
  | "INVALID_ROUTE";

export interface HoleIllustrationIncomplete {
  readonly complete: false;
  readonly version: 1;
  readonly code: HoleIllustrationIncompleteCode;
  readonly message: string;
}

export type HoleIllustrationSnapshotResult =
  | { readonly complete: true; readonly snapshot: HoleIllustrationSnapshot }
  | HoleIllustrationIncomplete;
