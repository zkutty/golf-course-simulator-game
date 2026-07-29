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
  | "misses";

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
