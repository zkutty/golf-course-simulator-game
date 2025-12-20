export type Terrain =
  | "fairway"
  | "rough"
  | "sand"
  | "water"
  | "green"
  | "tee"
  | "path";

export interface Course {
  width: number;
  height: number;
  tiles: Terrain[]; // length = width * height
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

export interface WeekResult {
  visitors: number;
  revenue: number;
  costs: number;
  profit: number;
  avgSatisfaction: number; // 0..100
  reputationDelta: number; // signed
}


