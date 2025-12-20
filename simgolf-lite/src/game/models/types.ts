export type Terrain =
  | "fairway"
  | "rough"
  | "sand"
  | "water"
  | "green"
  | "tee"
  | "path";

export interface Point {
  x: number;
  y: number;
}

export interface Hole {
  tee: Point | null;
  green: Point | null;
  par?: number;
  name?: string;
}

export interface Course {
  width: number;
  height: number;
  tiles: Terrain[]; // length = width * height
  holes: Hole[]; // 9 or 18 (MVP: 9)
  name: string;
  baseGreenFee: number; // dollars
  condition: number; // 0..1 (maintenance affects this)
}

export interface World {
  week: number;
  cash: number;
  reputation: number; // 0..100
  staffLevel: number; // 0..5
  marketingLevel: number; // 0..5
  maintenanceBudget: number; // dollars per week
}

export interface DemandBreakdown {
  courseQuality: number; // 0..100
  condition: number; // 0..100
  reputation: number; // 0..100
  priceAttractiveness: number; // 0..100
  marketing: number; // 0..100
  staff: number; // 0..100
  demandIndex: number; // 0..1.2-ish
}

export interface SatisfactionBreakdown {
  playability: number; // 0..100 (hole-based)
  condition: number; // 0..100
  staff: number; // 0..100
  satisfaction: number; // 0..100
}

export interface WeekResult {
  visitors: number;
  revenue: number;
  costs: number;
  profit: number;
  avgSatisfaction: number; // 0..100
  reputationDelta: number; // signed
  visitorNoise: number; // signed
  demand?: DemandBreakdown;
  satisfaction?: SatisfactionBreakdown;
  tips?: string[];
}


