import type { LandTheme } from "../models/types";
import type {
  ClimateExposure,
  ClimateFoliagePhase,
  ClimateMoistureRegime,
  ClimatePhenologyRegime,
} from "../models/biomes";
import type { SystemControlCommand } from "../experience/systemControl";

export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type SeasonName = (typeof SEASONS)[number];

export interface ClubCalendarDate {
  /** Zero-based, monotonic day used by every scheduled system. */
  absoluteDay: number;
  /** One-based club year. */
  year: number;
  /** One-based week within the 32-week club year. */
  weekOfYear: number;
  season: SeasonName;
  /** One-based week within the eight-week season. */
  weekInSeason: number;
  /** Zero-based Monday-through-Sunday day. */
  dayOfWeek: number;
}

export type WeatherKind =
  | "clear"
  | "cloudy"
  | "rain"
  | "heavy_rain"
  | "storm"
  | "heat"
  | "drought"
  | "frost";

export interface DailyWeather {
  absoluteDay: number;
  kind: WeatherKind;
  temperatureF: number;
  windMph: number;
  rainInches: number;
  severity: number;
  theme: LandTheme;
  season: SeasonName;
}

/** A bounded, continuous handoff between two calendar-season profiles. */
export interface ClimatePhenologyTransition {
  readonly fromSeason: SeasonName;
  readonly toSeason: SeasonName;
  /** Zero for a stable profile; otherwise progresses in 1/14-day increments. */
  readonly blend: number;
  readonly phase: "stable" | "leaving" | "entering";
}

/**
 * Read-only semantic state for render, ambience, vegetation, and reports.
 * It projects from the immutable club calendar and biome registry only; it
 * deliberately does not become save state or an alternate weather authority.
 */
export interface BiomeClimatePhenologyState {
  readonly biome: LandTheme;
  readonly calendar: Readonly<ClubCalendarDate & {
    /** Within the calendar season, in [0, 1). */
    seasonProgress: number;
  }>;
  readonly identity: Readonly<{
    regime: ClimatePhenologyRegime;
    exposure: ClimateExposure;
  }>;
  readonly transition: Readonly<ClimatePhenologyTransition>;
  readonly climate: Readonly<{
    targetTemperatureF: number;
    precipitationChance: number;
    windBaseMph: number;
    stormChance: number;
    droughtChance: number;
  }>;
  readonly vegetation: Readonly<{
    dormancy: number;
    flowering: number;
    foliage: Readonly<{
      from: ClimateFoliagePhase;
      to: ClimateFoliagePhase;
      dominant: ClimateFoliagePhase;
    }>;
    moisture: Readonly<{
      from: ClimateMoistureRegime;
      to: ClimateMoistureRegime;
      dominant: ClimateMoistureRegime;
    }>;
  }>;
  readonly frost: Readonly<{
    enabled: boolean;
    maximumTemperatureF: number;
    precipitationChanceMultiplier: number;
  }>;
  readonly snow: Readonly<{
    enabled: boolean;
    maximumTemperatureF: number;
    chance: number;
  }>;
}

export interface WeatherModifiers {
  carryMultiplier: number;
  dispersionMultiplier: number;
  demandMultiplier: number;
  paceMultiplier: number;
  turfWearMultiplier: number;
  turfRecoveryMultiplier: number;
  lodgingMultiplier: number;
  eventCancellationRisk: number;
}

export const CLUB_CHARTERS = [
  "public-gem",
  "championship-venue",
  "destination-retreat",
  "member-institution",
] as const;
export type ClubCharter = (typeof CLUB_CHARTERS)[number];

export interface CharterBenefits {
  demandMultiplier: number;
  reputationMultiplier: number;
  operatingCostMultiplier: number;
  lodgingMultiplier: number;
  tournamentMultiplier: number;
  relationshipMultiplier: number;
}

export interface ClubCharterDefinition {
  id: ClubCharter;
  name: string;
  promise: string;
  tradeoff: string;
  eventPool: string[];
  masteryGoals: string[];
  benefits: CharterBenefits;
}

export type AutomationPreset = "stewardship" | "balanced" | "growth";
export type AutomationSystem =
  | "hours"
  | "upkeep"
  | "pricing"
  | "staffing"
  | "parking"
  | "lodging"
  | "community"
  | "safety";

export type TurfPriority = "playability" | "recovery" | "presentation";
export type WaterPolicy = "conserve" | "balanced" | "irrigate";

export interface SeasonalResponse {
  id: string;
  absoluteDay: number;
  action: string;
  cost: number;
  capacityDelta: number;
  riskReduction: number;
}

export interface AnnualAward {
  id: string;
  title: string;
  recipient: string;
  fact: string;
}

export interface AnnualRanking {
  rank: number;
  clubId: string;
  clubName: string;
  score: number;
  player: boolean;
}

export interface ClubTimelineEntry {
  id: string;
  absoluteDay: number;
  year: number;
  kind: "charter" | "weather" | "course" | "people" | "championship" | "year-close";
  title: string;
  detail: string;
  personId?: string;
  courseId?: string;
  holeId?: string;
  photoId?: string;
}

export interface ClubYearbook {
  id: string;
  year: number;
  charter: ClubCharter;
  generatedAbsoluteDay: number;
  cash: number;
  reputation: number;
  courseCondition: number;
  completedRounds: number;
  playerProRounds: number;
  tournamentChampions: string[];
  notablePeople: Array<{ id: string; name: string; note: string }>;
  constructionCount: number;
  incidentCount: number;
  storyCount: number;
  awards: AnnualAward[];
  rankings: AnnualRanking[];
  dismissed: boolean;
  rewardSettled: boolean;
}

export interface SeasonalState {
  version: 1;
  calendar: ClubCalendarDate;
  lastCommittedAbsoluteDay: number;
  currentWeather: DailyWeather;
  forecast: DailyWeather[];
  forecastPublishedAbsoluteDay: number;
  charter: ClubCharter;
  charterSelectedYear: number;
  charterReviewedYears: number[];
  charterChanges: Array<{
    id: string;
    year: number;
    from: ClubCharter;
    to: ClubCharter;
    cost: number;
  }>;
  automation: {
    preset: AutomationPreset;
    advancedOperations: boolean;
    overrides: AutomationSystem[];
    lastAppliedAbsoluteDay: number;
    decisions: string[];
    baselineMaintenanceBudget: number;
    baselineGreenFees: Record<string, number>;
    baselineAssetPrices: Record<string, number>;
  };
  operations: {
    turfPriority: TurfPriority;
    waterPolicy: WaterPolicy;
    drainageLevel: number;
    drainageConstructionDays: number;
    closedCourseIds: string[];
    closedHoleIds: string[];
    responses: SeasonalResponse[];
  };
  yearbooks: ClubYearbook[];
  timeline: ClubTimelineEntry[];
  hallOfFame: AnnualAward[];
  lastClosedYear: number;
  pendingYearbookId?: string;
}

export interface SeasonCommandPreview {
  ok: boolean;
  cost: number;
  days: number;
  capacityDelta: number;
  riskReduction: number;
  blockers: string[];
  summary: string;
}

export type SeasonCommand =
  | { type: "SELECT_CHARTER"; charter: ClubCharter; confirmed?: boolean }
  | { type: "SET_AUTOMATION"; preset: AutomationPreset }
  | { type: "SET_ADVANCED_OPERATIONS"; enabled: boolean }
  | { type: "SET_AUTOMATION_OVERRIDE"; system: AutomationSystem; manual: boolean }
  | { type: "SET_TURF_PRIORITY"; priority: TurfPriority }
  | { type: "SET_WATER_POLICY"; policy: WaterPolicy }
  | { type: "IMPROVE_DRAINAGE" }
  | { type: "SET_COURSE_CLOSED"; courseId: string; closed: boolean; currentDay: number }
  | { type: "SET_HOLES_CLOSED"; holeIds: string[]; currentDay: number }
  | { type: "RESCHEDULE_TOURNAMENT"; eventId: string; days: number; currentDay: number }
  | { type: "ACKNOWLEDGE_YEARBOOK"; yearbookId: string }
  | SystemControlCommand;
