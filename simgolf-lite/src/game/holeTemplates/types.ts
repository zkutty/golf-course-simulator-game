import type {
  Decoration,
  Hole,
  Obstacle,
  PinRotation,
  Point,
  TeeSet,
  Terrain,
} from "../models/types";

export const HOLE_TEMPLATE_VERSION = 1 as const;
export const HOLE_TEMPLATE_FORMAT = "coursecraft-hole-template" as const;
export const HOLE_TEMPLATE_PLAN_VERSION = 1 as const;

export type HoleTemplateSourceKind =
  | "player_photo"
  | "course_web_page"
  | "open_data"
  | "licensed_provider"
  | "manual";

export type HoleTemplateRedistribution =
  | "allowed"
  | "attribution"
  | "share_alike"
  | "private_only"
  | "unknown";

export interface HoleTemplateProvenanceV1 {
  sourceKind: HoleTemplateSourceKind;
  sourceLabel: string;
  /** Canonical ISO-8601 UTC timestamp. */
  importedAt: string;
  rightsAttested: boolean;
  licenseName?: string;
  attribution?: string;
  redistribution: HoleTemplateRedistribution;
  /** Source imagery is never necessary to place or play the blueprint. */
  sourceAssetRetained: boolean;
}

export interface HoleTemplateConfidenceV1 {
  scale: number;
  terrain: number;
  elevation: number;
  notes: string[];
}

export interface HoleTemplateCellV1 extends Point {
  terrain: Terrain;
  /** Integer height steps relative to the template datum. */
  elevationOffset: number;
}

export type HoleTemplateParSettingV1 =
  | { mode: "AUTO" }
  | { mode: "MANUAL"; par: 3 | 4 | 5 };

/** Explicit V1 subset of Hole. New Hole fields cannot silently change V1. */
export interface HoleTemplateHoleV1 {
  tee: Point;
  green: Point;
  teeBoxes?: Partial<Record<TeeSet, Point | null>>;
  pinPositions?: Partial<Record<PinRotation, Point | null>>;
  waypoints?: Point[];
  parByTee?: Partial<Record<TeeSet, HoleTemplateParSettingV1>>;
  parMode: "AUTO" | "MANUAL";
  parManual?: 3 | 4 | 5;
}

/** Installed template features are always player-authored. */
export type HoleTemplateObstacleV1 = Omit<Obstacle, "origin">;
export type HoleTemplateDecorationV1 = Omit<Decoration, "origin">;

/** Portable sparse, local-coordinate hole blueprint. */
export interface HoleTemplateV1 {
  format: typeof HOLE_TEMPLATE_FORMAT;
  version: typeof HOLE_TEMPLATE_VERSION;
  id: string;
  title: string;
  description: string;
  width: number;
  height: number;
  yardsPerTile: number;
  cells: HoleTemplateCellV1[];
  hole: HoleTemplateHoleV1;
  obstacles: HoleTemplateObstacleV1[];
  decorations: HoleTemplateDecorationV1[];
  provenance: HoleTemplateProvenanceV1;
  confidence: HoleTemplateConfidenceV1;
}

export interface HoleTemplateValidationIssue {
  code: "invalid_value" | "missing_value" | "unknown_field" | "duplicate_value" | "unsupported_version";
  path: string;
  message: string;
}

export type HoleTemplateValidationResult =
  | { ok: true; value: HoleTemplateV1; canonicalJson: string }
  | { ok: false; issues: HoleTemplateValidationIssue[] };

export type HoleTemplateRotation = 0 | 1 | 2 | 3;
export type HoleTemplateElevationPolicy = "template-relief" | "preserve-estate-relief";

export interface HoleTemplatePlacement {
  /** Top-left of the transformed blueprint bounds in estate tile space. */
  origin: Point;
  rotation: HoleTemplateRotation;
  mirrorX?: boolean;
  elevationPolicy: HoleTemplateElevationPolicy;
  /** Only valid for template-relief. Omit to choose the deterministic median fit. */
  baseElevation?: number;
  holeId: string;
  holeName?: string;
}

export interface ResolvedHoleTemplatePlacement extends Omit<HoleTemplatePlacement, "mirrorX" | "baseElevation"> {
  mirrorX: boolean;
  /** Null when preserving estate relief. */
  baseElevation: number | null;
}

/** Optimistic-concurrency carrier supplied by the GameState integration layer. */
export interface HoleTemplateTargetVersions {
  terrainVersion: number;
  obstaclesVersion: number;
  markersVersion: number;
  economyVersion: number;
}

export type HoleTemplatePlacementBlockerCode =
  | "invalid_template"
  | "unsupported_version"
  | "invalid_course"
  | "invalid_placement"
  | "invalid_target_versions"
  | "rights_attestation_required"
  | "scale_mismatch"
  | "hole_capacity"
  | "out_of_bounds"
  | "unowned_land"
  | "locked_terrain"
  | "protected_tree"
  | "building_conflict"
  | "decoration_conflict"
  | "hole_conflict"
  | "relief_out_of_range"
  | "invalid_natural_feature"
  | "invalid_decoration"
  | "duplicate_hole_id"
  | "insufficient_funds";

export interface HoleTemplatePlacementBlocker {
  code: HoleTemplatePlacementBlockerCode;
  message: string;
  /** Concrete next step suitable for UI or API clients. */
  action: string;
  path?: string;
  points?: Point[];
}

export interface HoleTemplateQuoteV1 {
  currency: "USD";
  precision: 2;
  terrainConstruction: number;
  terrainSalvageCredit: number;
  earthwork: number;
  siteClearing: number;
  naturalFeatureSalvageCredit: number;
  naturalFeatures: number;
  decorations: number;
  /** Signed category sum before the no-cash-generation floor. */
  subtotal: number;
  /** Exact amount the integration layer would charge. */
  total: number;
}

export interface HoleTemplateTerrainMutation extends Point {
  index: number;
  before: Terrain;
  after: Terrain;
}

export interface HoleTemplateElevationMutation extends Point {
  index: number;
  before: number;
  after: number;
}

export interface HoleTemplateVersionMutation {
  before: HoleTemplateTargetVersions;
  after: HoleTemplateTargetVersions;
}

export interface HoleTemplatePlacementMutations {
  terrain: HoleTemplateTerrainMutation[];
  elevations: HoleTemplateElevationMutation[];
  removeObstacles: Obstacle[];
  addObstacles: Obstacle[];
  addDecorations: Decoration[];
  addHole: Hole;
  cashDelta: number;
  versions: HoleTemplateVersionMutation;
}

export interface HoleTemplatePlanIdentity {
  algorithm: "SHA-256";
  value: string;
}

export interface HoleTemplatePlacementPlanV1 {
  format: "coursecraft-hole-placement-plan";
  version: typeof HOLE_TEMPLATE_PLAN_VERSION;
  identity: HoleTemplatePlanIdentity;
  template: HoleTemplateV1;
  placement: ResolvedHoleTemplatePlacement;
  transformedSize: { width: number; height: number };
  targetVersions: HoleTemplateTargetVersions;
  quote: HoleTemplateQuoteV1;
  mutations: HoleTemplatePlacementMutations;
  blockers: HoleTemplatePlacementBlocker[];
  warnings: string[];
  canApply: boolean;
}

export type HoleTemplatePlacementPlanningResult =
  | { status: "planned"; plan: HoleTemplatePlacementPlanV1 }
  | { status: "rejected"; blockers: HoleTemplatePlacementBlocker[] };
