import type { ObjectiveState } from "./objectives";

// Run framing (ZKU-162/165/166). Kept here (not in balance/gen) so save code
// and the sim can reference them without layering cycles.
export type PlayMode = "sandbox" | "challenge" | "career";
export type Difficulty = "easy" | "normal" | "hard";
export type LandTheme = "parkland" | "links" | "desert";

// Scenario rule overrides (ZKU-164), persisted denormalized on World so a
// save stays self-contained even if scenario definitions change later.
export interface ScenarioConstraints {
  /** Bank won't lend on this deal. */
  noLoans?: boolean;
  /** Green fee locked by the scenario (dollars). */
  fixedGreenFee?: number;
  /** Heritage trees: tree obstacles cannot be removed. */
  protectedTrees?: boolean;
}

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
  waypoints?: Point[]; // Optional waypoints for dog legs (between tee and green)
  parMode: "AUTO" | "MANUAL";
  parManual?: 3 | 4 | 5;
  name?: string;
  holeIndex?: number; // Stroke index (1-18, defaults to array index + 1)
}

export type ObstacleType = "tree" | "bush" | "rock";

export type BuildingType = "clubhouse";

// Multi-tile structure anchored at its top-left footprint tile; footprint
// dimensions come from BUILDING_SPECS (src/game/models/buildings.ts).
export interface Building {
  type: BuildingType;
  x: number;
  y: number;
}

export interface Obstacle {
  x: number;
  y: number;
  type: ObstacleType;
}

export interface Course {
  width: number;
  height: number;
  tiles: Terrain[]; // length = width * height
  // Per-tile elevation in integer steps, same row-major indexing as tiles.
  // 0 = base level; see src/game/models/elevation.ts. Older saves migrate
  // to a flat (all-zero) field on load.
  elevations: number[]; // length = width * height
  holes: Hole[]; // 9 or 18 (MVP: 9)
  obstacles: Obstacle[]; // overlay layer (not terrain)
  // Multi-tile structures (ZKU-152; extended by M4 concessions). Older
  // saves migrate to an empty list on load.
  buildings: Building[];
  yardsPerTile: number; // distance model (default 10)
  name: string;
  baseGreenFee: number; // dollars
  condition: number; // 0..1 (maintenance affects this)
  // Land theme the wild land was generated with (ZKU-162/166). Older saves
  // migrate to "parkland" (the identity theme) on load.
  theme?: LandTheme;
}

// Staff as people (ZKU-121): individual employees replace the old aggregate
// staff level. Wage is snapshotted at hire; shift picks the on-course window.
export type StaffRole = "groundskeeper" | "cartAttendant" | "proShop" | "marshal";
export type StaffShift = "full" | "morning" | "afternoon";

export interface StaffMember {
  id: number;
  name: string;
  role: StaffRole;
  shift: StaffShift;
  wage: number; // dollars per week
}

export interface World {
  week: number;
  cash: number;
  reputation: number; // 0..100
  // Derived cache of min(5, staff roster size); kept so the demand and
  // satisfaction formulas (score.ts) survive the roster migration (ZKU-121).
  staffLevel: number; // 0..5
  marketingLevel: number; // 0..5
  maintenanceBudget: number; // dollars per week
  // Individual staff roster (ZKU-121). Optional so hand-built worlds (tuner,
  // tests) fall back to the aggregate staffLevel; saves migrate on load.
  staff?: StaffMember[];
  nextStaffId?: number;
  // Run state
  runSeed: number;
  distressWeeks: number; // 0..2 (bankrupt when reaches 2 and still negative)
  isBankrupt: boolean;
  lastWeekProfit: number;
  lastBridgeLoanWeek: number; // used to rate-limit bridge loans
  loans: Loan[];
  // Objective engine state (ZKU-163). null = free play (no goals). Older
  // saves migrate to null on load.
  objectives?: ObjectiveState | null;
  // Run framing (ZKU-162/165). Older saves migrate to sandbox/normal.
  mode?: PlayMode;
  difficulty?: Difficulty;
  founderName?: string;
  // Career (ZKU-164): which scenario this run is, and its rule overrides.
  scenarioId?: string;
  constraints?: ScenarioConstraints;
}

export type LoanKind = "BRIDGE" | "EXPANSION";
export type LoanStatus = "ACTIVE" | "PAID" | "DEFAULTED";

export interface Loan {
  id: string;
  kind: LoanKind;
  principal: number;
  apr: number; // e.g. 0.18
  termWeeks: number;
  weeksRemaining: number;
  weeklyPayment: number;
  balance: number;
  status: LoanStatus;
  missedPayments: number;
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
  segments?: {
    casual: { share: number; demandIndex: number; baseVisitors: number };
    core: { share: number; demandIndex: number; baseVisitors: number; cap: number };
    totalBaseVisitors: number;
  };
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
  turnaways?: number;
  capacity?: number;
  revenue: number;
  costs: number;
  profit: number;
  tax?: number;
  variableCosts?: {
    labor: number;
    consumables: number;
    merchantFees: number;
    total: number;
  };
  overhead?: {
    insurance: number;
    utilities: number;
    admin: number;
    baseStaff: number;
    total: number;
  };
  maintenance?: {
    required: number;
    budget: number;
    shortfall: number; // positive if under, negative if over
  };
  avgSatisfaction: number; // 0..100
  reputationDelta: number; // signed
  reputationMomentum?: string;
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


