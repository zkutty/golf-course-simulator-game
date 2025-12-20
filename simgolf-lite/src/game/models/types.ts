export type Terrain =
  | "fairway"
  | "rough"
  | "deep_rough"
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
  parMode: "AUTO" | "MANUAL";
  parManual?: 3 | 4 | 5;
  name?: string;
}

export type ObstacleType = "tree" | "bush";

export interface Obstacle {
  x: number;
  y: number;
  type: ObstacleType;
}

export interface Course {
  width: number;
  height: number;
  tiles: Terrain[]; // length = width * height
  holes: Hole[]; // 9 or 18 (MVP: 9)
  obstacles: Obstacle[]; // overlay layer (not terrain)
  yardsPerTile: number; // distance model (default 10)
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
  weights: {
    courseQuality: number;
    condition: number;
    reputation: number;
    priceAttractiveness: number;
    marketing: number;
    staff: number;
  };
  contributions: {
    courseQuality: number;
    condition: number;
    reputation: number;
    priceAttractiveness: number;
    marketing: number;
    staff: number;
  };
  demandIndex: number; // 0..1.2-ish
}

export interface SatisfactionBreakdown {
  playability: number; // 0..100 (hole-based)
  difficulty: number; // 0..100 (higher = harder)
  aesthetics: number; // 0..100
  condition: number; // 0..100
  staff: number; // 0..100
  weights: {
    playability: number;
    aesthetics: number;
    difficultyEase: number; // uses (100 - difficulty)
    condition: number;
    staff: number;
  };
  satisfaction: number; // 0..100
}

export interface WeekResult {
  visitors: number;
  revenue: number;
  costs: number;
  profit: number;
  overhead?: {
    insurance: number;
    utilities: number;
    admin: number;
    baseStaff: number;
    total: number;
  };
  avgSatisfaction: number; // 0..100
  reputationDelta: number; // signed
  visitorNoise: number; // signed
  demand?: DemandBreakdown;
  satisfaction?: SatisfactionBreakdown;
  tips?: string[];
  topIssues?: string[];
  capitalSpending?: {
    spent: number; // total positive charges since last week tick
    refunded: number; // total refunds since last week tick
    net: number; // spent - refunded
    byTerrainSpent: Partial<Record<Terrain, number>>; // charges attributed to target terrain
    byTerrainTiles: Partial<Record<Terrain, number>>; // tiles changed into terrain (count)
  };
  maintenancePressure?: {
    totalWeight: number;
    avgWeight: number;
    wear: number; // 0..1 applied this week
  };
}


