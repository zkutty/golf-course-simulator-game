import type { ObjectiveState } from "./objectives";
import type { TournamentCalendar } from "../tournaments/types";
import type { PropertyCourseState, PropertyEnterpriseState } from "../property/types";
import type { PlayerProCareer } from "./playerProTypes";
import type { LivingClubState } from "../livingClub/types";
import type { SeasonalState } from "../seasons/types";
import type { CampaignRunState } from "../campaign/types";
import type { M49DemandPlan, M49EconomyState } from "../m49/types";
import type { M51CourseMobilityState, M51MobilityAggregateSummary, M51MobilityState } from "../m51/types";
import type { BiomeCompatibilityMetadata, LandTheme } from "./biomes";

export type { LandTheme } from "./biomes";

// Run framing (ZKU-162/165/166). Kept here (not in balance/gen) so save code
// and the sim can reference them without layering cycles.
export type PlayMode = "sandbox" | "challenge" | "career";
export type Difficulty = "easy" | "normal" | "hard";

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

export type TerrainAuthoringTool = "curve" | "spline" | "area" | "edit";

export interface Point {
  x: number;
  y: number;
}

/** Continuous editor/rendering intent layered over the authoritative tile map.
 * Gameplay, economics, routing, and collision continue to read `Course.tiles`. */
export interface SurfacePoint {
  x: number;
  y: number;
}

/**
 * Absolute cubic Bézier control points for a persisted surface node.
 * Storing world-space handles keeps authored curves stable through save/load
 * and every camera rotation.
 */
export interface SurfaceTangentHandles {
  in: SurfacePoint;
  out: SurfacePoint;
}

export interface SurfaceCorridorGeometry {
  kind: "corridor";
  knots: SurfacePoint[];
  width: number;
  tangents?: SurfaceTangentHandles[];
}

export interface SurfaceRegionGeometry {
  kind: "region";
  ring: SurfacePoint[];
  tangents?: SurfaceTangentHandles[];
}

export interface SurfaceFeature {
  id: string;
  terrain: Terrain;
  order: number;
  geometry: SurfaceCorridorGeometry | SurfaceRegionGeometry;
  /** Row-major cells accepted when the feature was committed. */
  coverage: number[];
  /**
   * Optional mask-derived visual contours. New authoring stores these rings
   * after validity clipping so rendering, economics, and simulation coverage
   * cannot disagree. Legacy v1 features continue to render from `geometry`.
   */
  renderRings?: SurfacePoint[][];
}

export interface SurfaceIntentV1 {
  version: 1;
  nextId: number;
  features: SurfaceFeature[];
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
export type DaylightPolicy = "finish_started" | "strict_sunset";
export type PaceCompensationPolicy = "refund" | "credit" | "goodwill";

export interface CourseOperations {
  preset: PacePreset;
  teeIntervalMinutes: number;
  maxGroupSize: 2 | 3 | 4;
  starterGapEveryGroups: number;
  timeParStyle: TimeParStyle;
  teeGuidance: TeeGuidance;
  enforcement: PaceEnforcement;
  /** Minutes after the 6:00 AM operating-day origin. No group starts later. */
  lastTeeMinute: number;
  daylightPolicy: DaylightPolicy;
  compensationPolicy: PaceCompensationPolicy;
  beverage: {
    menu: BeverageMenu;
    passes: 0 | 1 | 2 | 3;
    alcoholLimit: 1 | 2 | 3 | 4;
    price: number;
  };
}

export type PaceCohort = "skilled_impatient" | "novice_social" | "general";

export interface PaceCohortHistory {
  samples: number;
  averageDurationMinutes: number;
  averageTimeParVarianceMinutes: number;
  averageWaitMinutes: number;
  pickupRate: number;
  abandonmentRate: number;
  averageSatisfaction: number;
}

export interface PaceHoleHistory {
  holeId: string;
  queueMinutes: number;
  occupancyMinutes: number;
  recoveryDelayMinutes: number;
  visits: number;
}

export interface PaceHistorySample {
  id: string;
  week: number;
  day: number;
  courseId: string;
  preset: PacePreset;
  staffing: string;
  groupsStarted: number;
  groupsFinished: number;
  roundsCompleted: number;
  roundsIncomplete: number;
  averageDurationMinutes: number;
  p50DurationMinutes: number;
  p90DurationMinutes: number;
  averageWaitMinutes: number;
  pickups: number;
  incidents: number;
  refunds: number;
  credits: number;
  goodwillVouchers: number;
  overtimeCost: number;
  compensationCost: number;
  greenFeeRevenue: number;
  beverageRevenue: number;
  occupiedTeeHours: number;
  averageSatisfaction: number;
  cohorts: Record<PaceCohort, PaceCohortHistory>;
  holes: PaceHoleHistory[];
}

export interface CoursePaceHistory {
  courseId: string;
  /** The latest 28 operating days, oldest first. */
  samples: PaceHistorySample[];
}

export interface PaceOperationsState {
  version: 1;
  courses: Record<string, CoursePaceHistory>;
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
  /** Stable deterministic identity used by saves, ledgers, and facility links. */
  id?: string;
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
  generationVersion: 1 | 2;
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
  /** Versioned biome/content/climate identity for portable persistence. */
  biomeCompatibility?: BiomeCompatibilityMetadata;
  /** Optional M35 smooth-authoring metadata. Tiles remain authoritative. */
  surfaceIntent?: SurfaceIntentV1;
  /** M25 land ownership and immutable surveyed-land record. */
  estate?: Estate;
  /** M31-M33 commercial campus, access, resort, and community assets. */
  property?: PropertyCourseState;
  /** M51 Cart Rental offers and individually addressable fleet, portable with the course. */
  m51?: M51CourseMobilityState;
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
  /** M31-M33 customers, bookings, residents, incidents, and commercial ledger. */
  enterprise?: PropertyEnterpriseState;
  /** M36-M37 player-owned golfer, resumable rounds, progression, and competition. */
  playerPro?: PlayerProCareer;
  /** M38 bounded people, story, callback, and architecture-evidence state. */
  livingClub?: LivingClubState;
  /** M39 calendar, weather, charter, automation, and immutable annual legacy. */
  seasonal?: SeasonalState;
  /** M40 phased authored chapter state. Campaign meta remains profile-scoped. */
  campaign?: CampaignRunState;
  /** M30 bounded rolling pace, cohort, and tee-hour operating history. */
  paceOperations?: PaceOperationsState;
  /** M49 bounded segment demand, observed value, price, and reputation evidence. */
  m49?: M49EconomyState;
  /** M51 bounded mobility evidence/aggregates. Course owns the fleet and offers. */
  m51?: M51MobilityState;
}

export type StaffRole = "groundskeeper" | "cart_attendant" | "pro_shop" | "marshal" | "tournament_director" | "club_pro" | "food_service" | "locker_attendant" | "front_desk" | "housekeeping" | "shuttle_driver";

export interface StaffMember {
  id: string;
  name: string;
  role: StaffRole;
  courseId?: string;
  shiftStart: number;
  shiftEnd: number;
  weeklyWage: number;
  /** M38 character identity layered over the existing coverage economics. */
  appearance?: { portrait: "workwear" | "formal" | "sport"; palette: number; accent: number };
  traits?: [StaffTrait, StaffTrait];
  proficiency?: number;
  tenureStartWeek?: number;
  morale?: number;
  training?: Array<{ id: string; week: number; focus: string; gain: number; cost: number }>;
  compensationHistory?: Array<{ week: number; weeklyWage: number; reason: "hire" | "raise" | "migration" }>;
  notableActions?: Array<{ id: string; week: number; summary: string; evidenceId?: string }>;
}

export type StaffTrait =
  | "steady"
  | "meticulous"
  | "mentor"
  | "inventive"
  | "warm"
  | "frugal"
  | "competitive"
  | "safetyMinded";

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
  m49?: M49DemandPlan;
  segments?: {
    casual: { share: number; demandIndex: number; baseVisitors: number };
    core: { share: number; demandIndex: number; baseVisitors: number; cap: number };
    totalBaseVisitors: number;
    m49?: M49DemandPlan;
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
    property?: number;
    propertyCosts?: number;
    propertyVisitors?: number;
    paceOvertime?: number;
    paceCompensation?: number;
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
  /** M51 bounded pace/economic evidence retained with legacy weekly history. */
  m51?: M51MobilityAggregateSummary;
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
  weatherSummary?: {
    playableDays: number;
    rainDays: number;
    severeDays: number;
    averageDemandMultiplier: number;
    averageTurfWearMultiplier: number;
    kinds: string[];
  };
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
