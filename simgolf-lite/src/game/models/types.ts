import type { ObjectiveState } from "./objectives";
import type { TournamentCalendar } from "../tournaments/types";

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
  | "waste_area"
  | "water"
  | "wetland"
  | "green"
  | "tee"
  | "path";

export interface Point {
  x: number;
  y: number;
}

export const TEE_SETS = ["forward", "member", "championship"] as const;
export type TeeSet = (typeof TEE_SETS)[number];
export type ParSetting =
  | { mode: "AUTO" }
  | { mode: "MANUAL"; par: 3 | 4 | 5 };
export const PIN_ROTATIONS = ["A", "B", "C"] as const;
export type PinRotation = (typeof PIN_ROTATIONS)[number];

export interface Hole {
  /** Stable identity used by layouts, records, events, and navigation. */
  id?: string;
  /** Authoritative M23 marker collections. Legacy tee/green aliases remain
   * mirrored to Member/A while older fixtures and integrations transition. */
  teeBoxes?: Partial<Record<TeeSet, Point | null>>;
  pinPositions?: Partial<Record<PinRotation, Point | null>>;
  tee: Point | null;
  green: Point | null;
  waypoints?: Point[]; // Optional waypoints for dog legs (between tee and green)
  /** Tee-specific par policy. Legacy parMode/parManual remain mirrored to the
   * Member tee for compatibility with older saves and integrations. */
  parByTee?: Partial<Record<TeeSet, ParSetting>>;
  parMode: "AUTO" | "MANUAL";
  parManual?: 3 | 4 | 5;
  name?: string;
  holeIndex?: number; // Stroke index (1-18, defaults to array index + 1)
}

export type CourseOperatingState = "open" | "closed";

export type PacePreset = "relaxed" | "balanced" | "brisk";
export type TimeParStyle = "relaxed" | "standard" | "brisk";
export type TeeGuidance = "open" | "recommended" | "required";
export type PaceEnforcement = "advisory" | "active" | "strict";
export type BeverageMenu = "off" | "refreshments" | "beer_wine";

export interface CourseOperations {
  preset: PacePreset;
  teeIntervalMinutes: number;
  maxGroupSize: 2 | 3 | 4;
  starterGapEveryGroups: number;
  timeParStyle: TimeParStyle;
  teeGuidance: TeeGuidance;
  enforcement: PaceEnforcement;
  beverage: {
    menu: BeverageMenu;
    passes: 0 | 1 | 2 | 3;
    alcoholLimit: 1 | 2 | 3 | 4;
    price: number;
  };
}

/** A named operating routing on the shared estate. Hole geometry remains in
 * `Course.holes`; layouts own ordering, publication, price, and availability. */
export interface CourseLayout {
  id: string;
  name: string;
  draftHoleIds: string[];
  publishedHoleIds: string[];
  roundLength: 9 | 18;
  state: CourseOperatingState;
  greenFee: number;
  operations?: CourseOperations;
  /** Migrated partial routings may keep operating until their first publish. */
  legacyPartial?: boolean;
}

export type ObstacleType = "tree" | "bush" | "rock";

export type ConcessionType = "pro_shop" | "snack_bar" | "cart_rental";
export type BuildingType = "clubhouse" | ConcessionType;
export type BuildingTier = 1 | 2 | 3;

// Multi-tile structure anchored at its top-left footprint tile; footprint
// dimensions come from BUILDING_SPECS (src/game/models/buildings.ts).
export interface Building {
  type: BuildingType;
  x: number;
  y: number;
  /** Concessions are configurable; clubhouse intentionally leaves these unset. */
  tier?: BuildingTier;
  price?: number;
}

export interface ConcessionTransaction {
  id: string;
  golferId: number;
  golferName: string;
  buildingType: ConcessionType;
  buildingX: number;
  buildingY: number;
  item: string;
  amount: number;
  atMinute: number;
}

export interface Obstacle {
  x: number;
  y: number;
  type: ObstacleType;
}

export type DecorationKind =
  | "fence" | "bench" | "tee_sign" | "lamp" | "bin" | "parked_cart"
  | "flower_bed" | "planter" | "ornamental_feature" | "bridge" | "boardwalk";
export type DecorationRotation = 0 | 1 | 2 | 3;

export interface Decoration {
  kind: DecorationKind;
  x: number;
  y: number;
  rotation: DecorationRotation;
  variant?: number;
  /** Hazard tiles crossed by a bridge/boardwalk; omitted for 1×1 decor. */
  span?: number;
}

export interface ParcelAppraisal {
  acreage: number;
  landValue: number;
  developableValue: number;
  roadAccessValue: number;
  sceneryValue: number;
  waterValue: number;
  elevationValue: number;
  pressureValue: number;
  total: number;
}

export interface EstateParcel {
  id: string;
  name: string;
  tileCount: number;
  acreage: number;
  center: Point;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  adjacentParcelIds: string[];
  publicRoadAccess: boolean;
  developablePercent: number;
  waterPercent: number;
  elevationRange: number;
  sceneryScore: number;
  traits: string[];
  appraisal: ParcelAppraisal;
}

export interface EstateBaseline {
  /** Compact row-major RLE. It is intentionally immutable after generation. */
  terrainRle: string;
  elevationRle: string;
}

export interface Estate {
  generationVersion: 1;
  seed: number;
  starterParcelId: string;
  ownedParcelIds: string[];
  /** Compact row-major parcel indexes into `parcels`. */
  parcelMapRle: string;
  parcels: EstateParcel[];
  naturalBaseline: EstateBaseline;
}

export interface Course {
  width: number;
  height: number;
  tiles: Terrain[]; // length = width * height
  // Per-tile elevation in integer steps, same row-major indexing as tiles.
  // 0 = base level; see src/game/models/elevation.ts. Older saves migrate
  // to a flat (all-zero) field on load.
  elevations: number[]; // length = width * height
  holes: Hole[]; // estate inventory, up to 36
  /** M26 named course routings. Older callers can omit these; normalization
   * synthesizes one starter layout without changing economic behavior. */
  layouts?: CourseLayout[];
  activeCourseId?: string;
  /** Course-wide operational pin used by ordinary live rounds. */
  activePinRotation?: PinRotation;
  obstacles: Obstacle[]; // overlay layer (not terrain)
  // Multi-tile structures (ZKU-152; extended by M4 concessions). Older
  // saves migrate to an empty list on load.
  buildings: Building[];
  // Player-authored visual furniture and walking structures. Pre-M22 saves
  // migrate to an empty list; visuals are selected through the theme registry.
  decorations?: Decoration[];
  yardsPerTile: number; // distance model (default 10)
  name: string;
  baseGreenFee: number; // dollars
  condition: number; // 0..1 (maintenance affects this)
  // Land theme the wild land was generated with (ZKU-162/166). Older saves
  // migrate to "parkland" (the identity theme) on load.
  theme?: LandTheme;
  /** M25 land ownership and immutable surveyed-land record. */
  estate?: Estate;
}

export interface World {
  week: number;
  cash: number;
  reputation: number; // 0..100
  staffLevel: number; // 0..5
  /** Named operational staff. Older saves synthesize this from staffLevel. */
  staffRoster?: StaffMember[];
  marketingLevel: number; // 0..5
  maintenanceBudget: number; // dollars per week
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
  // Scheduled and completed hosted events (M6). Optional for pre-M6 saves.
  tournaments?: TournamentCalendar;
}

export type StaffRole = "groundskeeper" | "cart_attendant" | "pro_shop" | "marshal" | "tournament_director";

export interface StaffMember {
  id: string;
  name: string;
  role: StaffRole;
  courseId?: string;
  shiftStart: number;
  shiftEnd: number;
  weeklyWage: number;
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
  architecture?: { score: number; multiplier: number };
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
  revenueBreakdown?: {
    greenFees: number;
    concessions: number;
    tournaments?: number;
    byConcession: Partial<Record<ConcessionType, number>>;
    transactions: ConcessionTransaction[];
  };
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
  perCourse?: Array<{
    courseId: string;
    courseName: string;
    attendance: number;
    turnaways: number;
    capacity: number;
    revenue: number;
    costs: number;
    profit: number;
    avgSatisfaction: number;
  }>;
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
