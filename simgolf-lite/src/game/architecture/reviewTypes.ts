import type { MobilityMode } from "../m51/types";

export type ArchitectureOverlayKind =
  | "traces"
  | "dispersion"
  | "heatmap"
  | "recovery"
  | "scoring"
  | "hazards"
  | "walking"
  | "congestion"
  | "options"
  | "advantage"
  | "bailouts"
  | "carries"
  | "misses"
  | "mobility";

export interface ArchitectureOverlayTrace {
  id: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  current: boolean;
  emphasized?: boolean;
}

export interface ArchitectureOverlayCell {
  id: string;
  x: number;
  y: number;
  value: number;
  current: boolean;
}

export interface ArchitectureOverlayPoint {
  id: string;
  x: number;
  y: number;
  value: number;
  current: boolean;
  label?: string;
}

export interface ArchitectureOverlayRender {
  kind: ArchitectureOverlayKind;
  traces: ArchitectureOverlayTrace[];
  cells: ArchitectureOverlayCell[];
  points: ArchitectureOverlayPoint[];
}

/** Read-only route forecast metadata for the Architecture Review overlay. */
export interface ArchitectureMobilityOverlay {
  evidence: "predicted";
  modes: MobilityMode[];
  weather: "dry" | "wet" | "cart_path_only";
  transfers: number;
  inaccessibleDestinations: Array<{ id: string; mode: MobilityMode; reason: "prohibited" | "unreachable" }>;
  missingLinkWarnings: string[];
  pathUtilization: number;
}

export type ArchitectureRulesEvidenceStatus = "retained" | "reconstructed" | "historical" | "unavailable";

/**
 * Rules feedback is intentionally separate from the retained shot record.
 * Current geometry may be reconstructed from the controlled-round contract;
 * historical geometry is never replayed against a newer course.
 */
export interface ArchitectureRulesEvidence {
  evidenceId: string;
  holeId: string;
  geometry: "current" | "historical";
  status: ArchitectureRulesEvidenceStatus;
  penalty: {
    strokes: number;
    kind: "none" | "out_of_bounds" | "penalty_area" | "unknown";
    classification: "red" | "yellow" | null;
  } | null;
  obstacle: {
    collision: "none" | "terrain" | "obstacle" | "not-retained";
    type: "tree" | "bush" | "rock" | null;
  };
  recovery: {
    attempted: boolean;
    troubleLie: boolean;
  };
  relief: {
    required: boolean;
    status: "not_required" | "resolved" | "unavailable" | "unknown";
    type: "none" | "play_as_it_lies" | "stroke_and_distance" | "back_on_line" | "lateral" | "unknown";
    legalCandidates: number;
  };
}

export interface ArchitectureRulesFeedback {
  id: string;
  level: "warning" | "advice";
  holeId?: string;
  message: string;
}

export interface ArchitectureRulesReview {
  evidence: ArchitectureRulesEvidence[];
  currentEvidence: number;
  historicalEvidence: number;
  penaltyCount: number;
  obstacleCollisionCount: number;
  recoveryAttemptCount: number;
  reliefResolvedCount: number;
  feedback: ArchitectureRulesFeedback[];
}
