import type { Course, CourseLayout, LandTheme, World } from "../models/types";
import { normalizeCourseLayouts } from "../models/courseLayouts";
import { normalizePropertyCourse, normalizePropertyEnterprise } from "../property/property";
import type { PropertyAsset } from "../property/types";
import type { FacilityUpkeepPolicy } from "../property/types";
import {
  CLUB_CHARTERS,
  SEASONS,
  type AnnualAward,
  type AnnualRanking,
  type AutomationPreset,
  type ClubCalendarDate,
  type ClubCharter,
  type ClubCharterDefinition,
  type ClubTimelineEntry,
  type ClubYearbook,
  type DailyWeather,
  type SeasonCommand,
  type SeasonCommandPreview,
  type SeasonalState,
  type WeatherKind,
  type WeatherModifiers,
} from "./types";

export const DAYS_PER_WEEK = 7;
export const WEEKS_PER_SEASON = 8;
export const WEEKS_PER_YEAR = 32;
export const DAYS_PER_YEAR = DAYS_PER_WEEK * WEEKS_PER_YEAR;
const MAX_YEARBOOKS = 40;
const MAX_TIMELINE = 320;
const MAX_RESPONSES = 160;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const integer = (value: unknown, fallback = 0) => Math.floor(finite(value, fallback));
const strings = (value: unknown, max: number) =>
  Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string"))].slice(-max) : [];

function hash32(...values: number[]): number {
  let hash = 0x811c9dc5;
  for (const value of values) {
    hash ^= value | 0;
    hash = Math.imul(hash, 0x01000193);
    hash ^= hash >>> 13;
  }
  return hash >>> 0;
}

function unit(seed: number, day: number, salt: number): number {
  return hash32(seed, day, salt) / 0x1_0000_0000;
}

export function absoluteDayFor(week: number, dayOfWeek: number): number {
  return Math.max(0, (Math.max(1, integer(week, 1)) - 1) * DAYS_PER_WEEK + clamp(integer(dayOfWeek), 0, 6));
}

export function weekDayFromAbsoluteDay(absoluteDay: number): { week: number; day: number } {
  const safe = Math.max(0, integer(absoluteDay));
  return { week: Math.floor(safe / DAYS_PER_WEEK) + 1, day: safe % DAYS_PER_WEEK };
}

export function calendarDate(absoluteDay: number): ClubCalendarDate {
  const safe = Math.max(0, integer(absoluteDay));
  const dayOfYear = safe % DAYS_PER_YEAR;
  const weekOfYear = Math.floor(dayOfYear / DAYS_PER_WEEK) + 1;
  const seasonIndex = Math.floor((weekOfYear - 1) / WEEKS_PER_SEASON);
  return {
    absoluteDay: safe,
    year: Math.floor(safe / DAYS_PER_YEAR) + 1,
    weekOfYear,
    season: SEASONS[seasonIndex] ?? "winter",
    weekInSeason: ((weekOfYear - 1) % WEEKS_PER_SEASON) + 1,
    dayOfWeek: dayOfYear % DAYS_PER_WEEK,
  };
}

export function formatClubDate(date: ClubCalendarDate): string {
  return `Year ${date.year} · ${date.season[0].toUpperCase()}${date.season.slice(1)} ${date.weekInSeason}/8 · Day ${date.dayOfWeek + 1}`;
}

const THEME_TEMP: Record<LandTheme, number> = { parkland: 59, links: 55, desert: 72 };
const SEASON_TEMP = { spring: 3, summer: 17, autumn: 5, winter: -12 } as const;
const THEME_RAIN: Record<LandTheme, number> = { parkland: 0.26, links: 0.32, desert: 0.09 };

function rawStormCandidate(runSeed: number, theme: LandTheme, absoluteDay: number): boolean {
  const date = calendarDate(absoluteDay);
  const seasonal = date.season === "summer" ? 0.025 : date.season === "autumn" ? 0.035 : 0.018;
  const themeChance = theme === "links" ? 0.025 : theme === "desert" ? -0.006 : 0.008;
  return unit(runSeed, absoluteDay, 41) < seasonal + themeChance;
}

export function weatherForDay(runSeed: number, theme: LandTheme, absoluteDay: number): DailyWeather {
  const date = calendarDate(absoluteDay);
  const day = date.absoluteDay;
  const wave = Math.sin(((day % DAYS_PER_YEAR) / DAYS_PER_YEAR) * Math.PI * 2 - Math.PI / 2) * 5;
  const temperatureF = Math.round(THEME_TEMP[theme] + SEASON_TEMP[date.season] + wave + (unit(runSeed, day, 11) - 0.5) * 15);
  const windBase = theme === "links" ? 12 : theme === "desert" ? 8 : 6;
  const windMph = Math.round(clamp(windBase + unit(runSeed, day, 17) * 18 + (date.season === "winter" ? 3 : 0), 2, 34));
  const rainChance = clamp(THEME_RAIN[theme] + (date.season === "spring" ? 0.08 : date.season === "summer" ? -0.04 : 0), 0.04, 0.42);
  const wetRoll = unit(runSeed, day, 23);
  const storm = rawStormCandidate(runSeed, theme, day)
    && !rawStormCandidate(runSeed, theme, day - 1)
    && !rawStormCandidate(runSeed, theme, day - 2);
  const drought = theme !== "links" && date.season === "summer" && unit(runSeed, day, 29) < (theme === "desert" ? 0.22 : 0.07);
  let kind: WeatherKind = "clear";
  if (storm) kind = "storm";
  else if (temperatureF <= 34 && wetRoll < rainChance * 0.7) kind = "frost";
  else if (drought) kind = "drought";
  else if (temperatureF >= (theme === "desert" ? 100 : 91) && wetRoll > rainChance) kind = "heat";
  else if (wetRoll < rainChance * 0.22) kind = "heavy_rain";
  else if (wetRoll < rainChance) kind = "rain";
  else if (wetRoll < rainChance + 0.28) kind = "cloudy";
  const rainInches = kind === "storm"
    ? Number((0.8 + unit(runSeed, day, 31) * 1.2).toFixed(2))
    : kind === "heavy_rain"
      ? Number((0.35 + unit(runSeed, day, 31) * 0.55).toFixed(2))
      : kind === "rain" || kind === "frost"
        ? Number((0.05 + unit(runSeed, day, 31) * 0.28).toFixed(2))
        : 0;
  const severity = clamp(
    kind === "storm" ? 0.8 + windMph / 180
      : kind === "heavy_rain" ? 0.55 + rainInches / 4
        : kind === "drought" || kind === "heat" || kind === "frost" ? 0.42 + Math.abs(68 - temperatureF) / 140
          : kind === "rain" ? 0.25 + rainInches / 3
            : windMph / 100,
    0,
    1,
  );
  return { absoluteDay: day, kind, temperatureF, windMph, rainInches, severity, theme, season: date.season };
}

export function forecastForDay(runSeed: number, theme: LandTheme, absoluteDay: number): DailyWeather[] {
  return Array.from({ length: 7 }, (_, offset) => weatherForDay(runSeed, theme, absoluteDay + offset));
}

export function weatherModifiers(weather: DailyWeather, drainageLevel = 0): WeatherModifiers {
  const wind = Math.max(0, weather.windMph - 7);
  const drainage = clamp(integer(drainageLevel), 0, 3);
  const wetRelief = 1 - drainage * 0.11;
  const base: WeatherModifiers = {
    carryMultiplier: clamp(1 - wind * 0.0025, 0.89, 1),
    dispersionMultiplier: clamp(1 + wind * 0.012, 1, 1.36),
    demandMultiplier: 1,
    paceMultiplier: 1,
    turfWearMultiplier: 1,
    turfRecoveryMultiplier: 1,
    lodgingMultiplier: 1,
    eventCancellationRisk: 0,
  };
  if (weather.kind === "rain") return { ...base, carryMultiplier: base.carryMultiplier * 0.97, dispersionMultiplier: base.dispersionMultiplier * 1.05, demandMultiplier: 0.88, paceMultiplier: 1.08, turfWearMultiplier: 1 + 0.14 * wetRelief, turfRecoveryMultiplier: 1.12, lodgingMultiplier: 1.03, eventCancellationRisk: 0.08 * wetRelief };
  if (weather.kind === "heavy_rain") return { ...base, carryMultiplier: base.carryMultiplier * 0.93, dispersionMultiplier: base.dispersionMultiplier * 1.12, demandMultiplier: 0.62, paceMultiplier: 1.2, turfWearMultiplier: 1 + 0.42 * wetRelief, turfRecoveryMultiplier: 1.08, lodgingMultiplier: 1.07, eventCancellationRisk: 0.34 * wetRelief };
  if (weather.kind === "storm") return { ...base, carryMultiplier: base.carryMultiplier * 0.86, dispersionMultiplier: base.dispersionMultiplier * 1.28, demandMultiplier: 0.2, paceMultiplier: 1.38, turfWearMultiplier: 1 + 0.72 * wetRelief, turfRecoveryMultiplier: 0.9, lodgingMultiplier: 1.12, eventCancellationRisk: clamp(0.8 * wetRelief, 0.4, 0.8) };
  if (weather.kind === "heat") return { ...base, demandMultiplier: 0.82, paceMultiplier: 1.08, turfWearMultiplier: 1.24, turfRecoveryMultiplier: 0.78, lodgingMultiplier: 1.04, eventCancellationRisk: 0.08 };
  if (weather.kind === "drought") return { ...base, demandMultiplier: 0.9, turfWearMultiplier: 1.34, turfRecoveryMultiplier: 0.62, lodgingMultiplier: 1.02, eventCancellationRisk: 0.04 };
  if (weather.kind === "frost") return { ...base, carryMultiplier: base.carryMultiplier * 0.94, dispersionMultiplier: base.dispersionMultiplier * 1.06, demandMultiplier: 0.7, paceMultiplier: 1.12, turfWearMultiplier: 1.12, turfRecoveryMultiplier: 0.72, eventCancellationRisk: 0.22 };
  if (weather.kind === "cloudy") return { ...base, demandMultiplier: 0.98, turfRecoveryMultiplier: 1.03 };
  return base;
}

export const CHARTER_DEFINITIONS: Record<ClubCharter, ClubCharterDefinition> = {
  "public-gem": {
    id: "public-gem",
    name: "Public Gem",
    promise: "Accessible golf, local trust, and a course worth belonging to.",
    tradeoff: "Lower pricing power and greater community scrutiny.",
    eventPool: ["municipal-cup", "junior-day", "community-open"],
    masteryGoals: ["Keep fees accessible", "Build local trust", "Develop returning regulars"],
    benefits: { demandMultiplier: 1.08, reputationMultiplier: 1.08, operatingCostMultiplier: 1, lodgingMultiplier: 0.94, tournamentMultiplier: 0.96, relationshipMultiplier: 1.12 },
  },
  "championship-venue": {
    id: "championship-venue",
    name: "Championship Venue",
    promise: "Exacting golf, complete setups, and tournaments that test the best.",
    tradeoff: "Higher presentation costs and less tolerance for weak condition.",
    eventPool: ["regional-invitational", "national-qualifier", "course-setup-week"],
    masteryGoals: ["Qualify every tee", "Host a championship", "Produce a course record"],
    benefits: { demandMultiplier: 0.98, reputationMultiplier: 1.04, operatingCostMultiplier: 1.06, lodgingMultiplier: 1, tournamentMultiplier: 1.16, relationshipMultiplier: 0.98 },
  },
  "destination-retreat": {
    id: "destination-retreat",
    name: "Destination Retreat",
    promise: "A complete stay where golf, hospitality, and landscape reinforce one another.",
    tradeoff: "More capital is tied to service capacity and weather-sensitive trips.",
    eventPool: ["stay-and-play-week", "architects-retreat", "destination-cup"],
    masteryGoals: ["Sustain lodging service", "Complete guest itineraries", "Earn destination appeal"],
    benefits: { demandMultiplier: 0.96, reputationMultiplier: 1, operatingCostMultiplier: 1.04, lodgingMultiplier: 1.16, tournamentMultiplier: 1.04, relationshipMultiplier: 1.02 },
  },
  "member-institution": {
    id: "member-institution",
    name: "Member Institution",
    promise: "Continuity, relationships, and standards that compound over generations.",
    tradeoff: "A narrower audience and strong expectations around staff and tradition.",
    eventPool: ["captains-match", "founders-day", "member-guest"],
    masteryGoals: ["Retain members", "Develop named staff", "Complete a relationship arc"],
    benefits: { demandMultiplier: 0.92, reputationMultiplier: 1.03, operatingCostMultiplier: 1.02, lodgingMultiplier: 1.02, tournamentMultiplier: 1.02, relationshipMultiplier: 1.14 },
  },
};

export function charterDefinition(charter: ClubCharter): ClubCharterDefinition {
  return CHARTER_DEFINITIONS[charter];
}

function normalizeWeather(input: unknown, fallback: DailyWeather): DailyWeather {
  if (!input || typeof input !== "object") return fallback;
  const candidate = input as Partial<DailyWeather>;
  const kinds = new Set<WeatherKind>(["clear", "cloudy", "rain", "heavy_rain", "storm", "heat", "drought", "frost"]);
  return {
    ...fallback,
    absoluteDay: Math.max(0, integer(candidate.absoluteDay, fallback.absoluteDay)),
    kind: kinds.has(candidate.kind as WeatherKind) ? candidate.kind as WeatherKind : fallback.kind,
    temperatureF: clamp(integer(candidate.temperatureF, fallback.temperatureF), -20, 125),
    windMph: clamp(integer(candidate.windMph, fallback.windMph), 0, 70),
    rainInches: clamp(finite(candidate.rainInches, fallback.rainInches), 0, 5),
    severity: clamp(finite(candidate.severity, fallback.severity), 0, 1),
  };
}

function validCharter(value: unknown): value is ClubCharter {
  return CLUB_CHARTERS.includes(value as ClubCharter);
}

export function createSeasonalState(args: {
  runSeed: number;
  theme?: LandTheme;
  week?: number;
  day?: number;
  migrated?: boolean;
}): SeasonalState {
  const theme = args.theme ?? "parkland";
  const absoluteDay = absoluteDayFor(args.week ?? 1, args.day ?? 0);
  const currentWeather = weatherForDay(args.runSeed, theme, absoluteDay);
  return {
    version: 1,
    calendar: calendarDate(absoluteDay),
    lastCommittedAbsoluteDay: args.migrated ? absoluteDay - 1 : -1,
    currentWeather,
    forecast: forecastForDay(args.runSeed, theme, absoluteDay),
    forecastPublishedAbsoluteDay: absoluteDay,
    charter: "public-gem",
    charterSelectedYear: 1,
    charterReviewedYears: [],
    charterChanges: [],
    automation: {
      preset: "balanced",
      advancedOperations: args.migrated === true,
      overrides: args.migrated ? ["hours", "upkeep", "pricing", "staffing", "parking", "lodging", "community", "safety"] : [],
      lastAppliedAbsoluteDay: -1,
      decisions: [],
      baselineMaintenanceBudget: 0,
      baselineGreenFees: {},
      baselineAssetPrices: {},
    },
    operations: {
      turfPriority: "playability",
      waterPolicy: "balanced",
      drainageLevel: 0,
      drainageConstructionDays: 0,
      closedCourseIds: [],
      closedHoleIds: [],
      responses: [],
    },
    yearbooks: [],
    timeline: [],
    hallOfFame: [],
    lastClosedYear: 0,
  };
}

export function normalizeSeasonalState(
  input: unknown,
  args: { runSeed: number; theme?: LandTheme; week?: number; day?: number; migrated?: boolean },
): SeasonalState {
  const fallback = createSeasonalState(args);
  if (!input || typeof input !== "object") return fallback;
  const candidate = input as Partial<SeasonalState>;
  const calendar = calendarDate(Math.max(0, integer(candidate.calendar?.absoluteDay, fallback.calendar.absoluteDay)));
  const automationPresets = new Set<AutomationPreset>(["stewardship", "balanced", "growth"]);
  const turfPriorities = new Set(["playability", "recovery", "presentation"]);
  const waterPolicies = new Set(["conserve", "balanced", "irrigate"]);
  const yearbooks = Array.isArray(candidate.yearbooks)
    ? candidate.yearbooks.filter((book): book is ClubYearbook => !!book && typeof book === "object" && Number.isInteger(book.year)).slice(-MAX_YEARBOOKS)
    : [];
  const timeline = Array.isArray(candidate.timeline)
    ? candidate.timeline.filter((entry): entry is ClubTimelineEntry => !!entry && typeof entry === "object" && typeof entry.id === "string").slice(-MAX_TIMELINE)
    : [];
  const hallOfFame = Array.isArray(candidate.hallOfFame)
    ? candidate.hallOfFame.filter((award): award is AnnualAward => !!award && typeof award === "object" && typeof award.id === "string").slice(-120)
    : [];
  const weatherFallback = weatherForDay(args.runSeed, args.theme ?? "parkland", calendar.absoluteDay);
  return {
    version: 1,
    calendar,
    lastCommittedAbsoluteDay: integer(candidate.lastCommittedAbsoluteDay, fallback.lastCommittedAbsoluteDay),
    currentWeather: normalizeWeather(candidate.currentWeather, weatherFallback),
    forecast: Array.isArray(candidate.forecast)
      ? candidate.forecast.slice(0, 7).map((weather, offset) => normalizeWeather(weather, weatherForDay(args.runSeed, args.theme ?? "parkland", calendar.absoluteDay + offset)))
      : fallback.forecast,
    forecastPublishedAbsoluteDay: Math.max(0, integer(candidate.forecastPublishedAbsoluteDay, calendar.absoluteDay)),
    charter: validCharter(candidate.charter) ? candidate.charter : fallback.charter,
    charterSelectedYear: Math.max(1, integer(candidate.charterSelectedYear, 1)),
    charterReviewedYears: Array.isArray(candidate.charterReviewedYears)
      ? [...new Set(candidate.charterReviewedYears.map((year) => integer(year)).filter((year) => year > 0))].slice(-40)
      : [],
    charterChanges: Array.isArray(candidate.charterChanges)
      ? candidate.charterChanges.filter((entry) => entry && validCharter(entry.from) && validCharter(entry.to)).slice(-40)
      : [],
    automation: {
      preset: automationPresets.has(candidate.automation?.preset as AutomationPreset) ? candidate.automation!.preset : fallback.automation.preset,
      advancedOperations: candidate.automation?.advancedOperations === true,
      overrides: strings(candidate.automation?.overrides, 8) as SeasonalState["automation"]["overrides"],
      lastAppliedAbsoluteDay: integer(candidate.automation?.lastAppliedAbsoluteDay, -1),
      decisions: strings(candidate.automation?.decisions, 16),
      baselineMaintenanceBudget: Math.max(0, finite(candidate.automation?.baselineMaintenanceBudget)),
      baselineGreenFees: candidate.automation?.baselineGreenFees && typeof candidate.automation.baselineGreenFees === "object"
        ? Object.fromEntries(Object.entries(candidate.automation.baselineGreenFees).filter(([, value]) => typeof value === "number" && Number.isFinite(value)).slice(0, 36))
        : {},
      baselineAssetPrices: candidate.automation?.baselineAssetPrices && typeof candidate.automation.baselineAssetPrices === "object"
        ? Object.fromEntries(Object.entries(candidate.automation.baselineAssetPrices).filter(([, value]) => typeof value === "number" && Number.isFinite(value)).slice(0, 160))
        : {},
    },
    operations: {
      turfPriority: turfPriorities.has(candidate.operations?.turfPriority ?? "") ? candidate.operations!.turfPriority : fallback.operations.turfPriority,
      waterPolicy: waterPolicies.has(candidate.operations?.waterPolicy ?? "") ? candidate.operations!.waterPolicy : fallback.operations.waterPolicy,
      drainageLevel: clamp(integer(candidate.operations?.drainageLevel), 0, 3),
      drainageConstructionDays: clamp(integer(candidate.operations?.drainageConstructionDays), 0, 60),
      closedCourseIds: strings(candidate.operations?.closedCourseIds, 36),
      closedHoleIds: strings(candidate.operations?.closedHoleIds, 36),
      responses: Array.isArray(candidate.operations?.responses)
        ? candidate.operations.responses.filter((response) => response && typeof response.id === "string").slice(-MAX_RESPONSES)
        : [],
    },
    yearbooks,
    timeline,
    hallOfFame,
    lastClosedYear: Math.max(0, integer(candidate.lastClosedYear)),
    ...(typeof candidate.pendingYearbookId === "string" && yearbooks.some((book) => book.id === candidate.pendingYearbookId)
      ? { pendingYearbookId: candidate.pendingYearbookId }
      : {}),
  };
}

export function seasonalState(world: World, course: Course, day = 0): SeasonalState {
  return normalizeSeasonalState(world.seasonal, {
    runSeed: world.runSeed,
    theme: course.theme,
    week: world.week,
    day,
    migrated: world.seasonal == null,
  });
}

export function activeWeather(world: World, course: Course, day: number): DailyWeather {
  return weatherForDay(world.runSeed, course.theme ?? "parkland", absoluteDayFor(world.week, day));
}

export function weatherAdjustedCourse(course: Course, weather: DailyWeather, drainageLevel = 0): Course {
  const modifiers = weatherModifiers(weather, drainageLevel);
  return { ...course, yardsPerTile: course.yardsPerTile / Math.max(0.7, modifiers.carryMultiplier) };
}

export function charterBenefits(world: World, course: Course, day = 0) {
  const state = seasonalState(world, course, day);
  return charterDefinition(state.charter).benefits;
}

function automationPolicy(preset: AutomationPreset, weather: DailyWeather, charter: ClubCharter) {
  const severe = weather.severity >= 0.55;
  const wet = weather.kind === "rain" || weather.kind === "heavy_rain" || weather.kind === "storm";
  const upkeep: FacilityUpkeepPolicy = preset === "stewardship" || severe ? "premium" : preset === "growth" ? "lean" : "standard";
  const hours = severe ? [9, 17] as const : preset === "growth" ? [6, 22] as const : [7, 20] as const;
  const priceMultiplier = charter === "public-gem" ? 0.94 : charter === "championship-venue" ? 1.12 : charter === "destination-retreat" ? 1.08 : 1.03;
  const maintenanceMultiplier = preset === "stewardship" ? 1.22 : preset === "growth" ? 0.94 : 1.05;
  return {
    upkeep,
    openHour: hours[0],
    closeHour: hours[1],
    priceMultiplier,
    maintenanceMultiplier: maintenanceMultiplier * (severe || wet ? 1.15 : weather.kind === "drought" ? 1.2 : 1),
  };
}

function automatedAsset(asset: PropertyAsset, baselinePrice: number, policy: ReturnType<typeof automationPolicy>, overrides: Set<string>): PropertyAsset {
  return {
    ...asset,
    ...(!overrides.has("hours") && ["practice", "clubhouse", "resort"].includes(asset.category)
      ? { openHour: policy.openHour, closeHour: policy.closeHour }
      : {}),
    ...(!overrides.has("upkeep") && !["access", "community", "safety"].includes(asset.category)
      ? { upkeepPolicy: policy.upkeep }
      : {}),
    ...(!overrides.has("pricing") && baselinePrice > 0
      ? { price: Math.max(1, Math.round(baselinePrice * policy.priceMultiplier)) }
      : {}),
  };
}

function applyAutomation(course: Course, world: World, state: SeasonalState, weather: DailyWeather): { course: Course; world: World; state: SeasonalState } {
  if (state.automation.advancedOperations || state.automation.lastAppliedAbsoluteDay === state.calendar.absoluteDay) {
    return { course, world, state };
  }
  const overrides = new Set<string>(state.automation.overrides);
  const policy = automationPolicy(state.automation.preset, weather, state.charter);
  const normalized = normalizeCourseLayouts(course);
  const baselineGreenFees = {
    ...Object.fromEntries(normalized.layouts!.map((layout) => [layout.id, layout.greenFee])),
    ...state.automation.baselineGreenFees,
  };
  const property = normalizePropertyCourse(course.property);
  const baselineAssetPrices = {
    ...Object.fromEntries(property.assets.map((asset) => [asset.id, asset.price])),
    ...state.automation.baselineAssetPrices,
  };
  const layouts = normalized.layouts!.map((layout) => !overrides.has("pricing")
    ? { ...layout, greenFee: Math.max(10, Math.round((baselineGreenFees[layout.id] ?? layout.greenFee) * policy.priceMultiplier)) }
    : layout);
  const nextCourse: Course = {
    ...course,
    layouts,
    baseGreenFee: layouts.find((layout) => layout.id === course.activeCourseId)?.greenFee ?? course.baseGreenFee,
    property: { ...property, assets: property.assets.map((asset) => automatedAsset(asset, baselineAssetPrices[asset.id] ?? asset.price, policy, overrides)) },
  };
  const baseMaintenance = Math.max(350, state.automation.baselineMaintenanceBudget || world.maintenanceBudget);
  const nextWorld = overrides.has("upkeep")
    ? world
    : { ...world, maintenanceBudget: Math.round(baseMaintenance * policy.maintenanceMultiplier) };
  const decisions = [
    `${state.automation.preset} hours ${policy.openHour}:00–${policy.closeHour}:00`,
    `${policy.upkeep} upkeep`,
    `weather reserve ${Math.round((policy.maintenanceMultiplier - 1) * 100)}%`,
  ];
  return {
    course: nextCourse,
    world: nextWorld,
    state: {
      ...state,
      automation: {
        ...state.automation,
        lastAppliedAbsoluteDay: state.calendar.absoluteDay,
        decisions,
        baselineMaintenanceBudget: baseMaintenance,
        baselineGreenFees,
        baselineAssetPrices,
      },
    },
  };
}

function award(id: string, title: string, recipient: string, fact: string): AnnualAward {
  return { id, title, recipient, fact };
}

function annualRankings(course: Course, world: World, year: number): AnnualRanking[] {
  const playerScore = Math.round(clamp(
    world.reputation * 0.52 + course.condition * 25 + Math.min(18, (world.playerPro?.rounds.length ?? 0) * 0.4) + Math.min(10, (world.tournaments?.events.filter((event) => event.status === "completed").length ?? 0) * 1.5),
    0,
    100,
  ));
  const rivals = ["Alder Heath", "Northbank Golf", "Saltmere Club", "Red Mesa Links"].map((name, index) => ({
    clubId: `annual-rival-${index + 1}`,
    clubName: name,
    score: 44 + Math.floor(unit(world.runSeed + year * 101, index, 77) * 48),
    player: false,
  }));
  return [{ clubId: "player-club", clubName: course.name, score: playerScore, player: true }, ...rivals]
    .sort((a, b) => b.score - a.score || a.clubId.localeCompare(b.clubId))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

function annualYearbook(course: Course, world: World, state: SeasonalState, year: number, absoluteDay: number): ClubYearbook {
  const living = world.livingClub;
  const tournamentChampions = (world.tournaments?.events ?? [])
    .filter((event) => event.status === "completed" && event.winnerName)
    .slice(-8)
    .map((event) => event.winnerName!);
  const notablePeople = [
    ...(living?.regulars ?? []).sort((a, b) => b.loyalty - a.loyalty).slice(0, 3).map((person) => ({ id: person.id, name: person.name, note: `${person.visits} visits · ${person.loyalty} loyalty` })),
    ...(world.staffRoster ?? []).sort((a, b) => (b.proficiency ?? 0) - (a.proficiency ?? 0)).slice(0, 2).map((person) => ({ id: person.id, name: person.name, note: `${person.role.replaceAll("_", " ")} · ${Math.round(person.morale ?? 65)} morale` })),
  ].slice(0, 5);
  const completedRounds = (living?.regulars ?? []).reduce((sum, regular) => sum + regular.rounds, 0);
  const playerProRounds = world.playerPro?.rounds.length ?? 0;
  const constructionCount = normalizePropertyCourse(course.property).assets.filter((asset) => (asset.constructionDaysRemaining ?? 0) === 0 && asset.category !== "access").length;
  const enterprise = normalizePropertyEnterprise(world.enterprise);
  const incidentCount = enterprise.incidents.length;
  const storyCount = living?.story.instances.filter((instance) => instance.status === "resolved").length ?? 0;
  const awards = [
    award(`year-${year}-course`, "Course of the Year", course.name, `${Math.round(course.condition * 100)} condition · ${Math.round(world.reputation)} reputation`),
    award(`year-${year}-golfer`, "Golfer of the Year", tournamentChampions[0] ?? notablePeople[0]?.name ?? world.playerPro?.identity.name ?? "The Player Pro", `${completedRounds + playerProRounds} recorded club rounds`),
    award(`year-${year}-steward`, "Club Steward", notablePeople.find((person) => (world.staffRoster ?? []).some((staff) => staff.id === person.id))?.name ?? world.founderName ?? "The club team", `${constructionCount} operating facilities · ${storyCount} resolved stories`),
  ];
  return {
    id: `yearbook-${year}`,
    year,
    charter: state.charter,
    generatedAbsoluteDay: absoluteDay,
    cash: Math.round(world.cash),
    reputation: Math.round(world.reputation * 10) / 10,
    courseCondition: Math.round(course.condition * 1000) / 1000,
    completedRounds,
    playerProRounds,
    tournamentChampions,
    notablePeople,
    constructionCount,
    incidentCount,
    storyCount,
    awards,
    rankings: annualRankings(course, world, year),
    dismissed: false,
    rewardSettled: true,
  };
}

function closeYear(course: Course, world: World, state: SeasonalState, absoluteDay: number): { world: World; state: SeasonalState } {
  const year = calendarDate(absoluteDay).year;
  if (state.lastClosedYear >= year) return { world, state };
  const yearbook = annualYearbook(course, world, state, year, absoluteDay);
  const ranking = yearbook.rankings.find((entry) => entry.player)?.rank ?? 5;
  const reward = ranking === 1 ? 5_000 : ranking <= 3 ? 2_500 : 1_000;
  const timelineEntry: ClubTimelineEntry = {
    id: `year-close-${year}`,
    absoluteDay,
    year,
    kind: "year-close",
    title: `Year ${year} entered the club history`,
    detail: `${CHARTER_DEFINITIONS[state.charter].name} · ranking #${ranking} · ${yearbook.awards.length} annual awards`,
    courseId: normalizeCourseLayouts(course).activeCourseId,
  };
  return {
    world: { ...world, cash: world.cash + reward },
    state: {
      ...state,
      yearbooks: [...state.yearbooks.filter((book) => book.year !== year), yearbook].slice(-MAX_YEARBOOKS),
      timeline: [...state.timeline.filter((entry) => entry.id !== timelineEntry.id), timelineEntry].slice(-MAX_TIMELINE),
      hallOfFame: [...state.hallOfFame, ...yearbook.awards].slice(-120),
      lastClosedYear: year,
      pendingYearbookId: yearbook.id,
    },
  };
}

export function advanceSeasonalDay(course: Course, world: World, dayIndex: number): { course: Course; world: World; weather: DailyWeather; modifiers: WeatherModifiers } {
  const absoluteDay = absoluteDayFor(world.week, dayIndex);
  let state = normalizeSeasonalState(world.seasonal, {
    runSeed: world.runSeed,
    theme: course.theme,
    week: world.week,
    day: dayIndex,
    migrated: world.seasonal == null,
  });
  const weather = weatherForDay(world.runSeed, course.theme ?? "parkland", absoluteDay);
  const modifiers = weatherModifiers(weather, state.operations.drainageLevel);
  if (absoluteDay <= state.lastCommittedAbsoluteDay) return { course, world: { ...world, seasonal: state }, weather, modifiers };
  state = {
    ...state,
    calendar: calendarDate(absoluteDay),
    lastCommittedAbsoluteDay: absoluteDay,
    currentWeather: weather,
    forecast: forecastForDay(world.runSeed, course.theme ?? "parkland", absoluteDay + 1),
    forecastPublishedAbsoluteDay: absoluteDay,
    operations: {
      ...state.operations,
      drainageConstructionDays: Math.max(0, state.operations.drainageConstructionDays - 1),
    },
  };
  const automated = applyAutomation(course, world, state, weather);
  course = automated.course;
  world = automated.world;
  state = automated.state;
  if (absoluteDay % DAYS_PER_YEAR === DAYS_PER_YEAR - 1) {
    const closed = closeYear(course, world, state, absoluteDay);
    world = closed.world;
    state = closed.state;
  }
  return { course, world: { ...world, seasonal: state }, weather, modifiers };
}

function currentState(course: Course, world: World, day: number): SeasonalState {
  return normalizeSeasonalState(world.seasonal, {
    runSeed: world.runSeed,
    theme: course.theme,
    week: world.week,
    day,
    migrated: world.seasonal == null,
  });
}

function response(state: SeasonalState, absoluteDay: number, action: string, cost: number, capacityDelta: number, riskReduction: number) {
  return {
    ...state,
    operations: {
      ...state.operations,
      responses: [...state.operations.responses, {
        id: `season-response-${absoluteDay}-${state.operations.responses.length + 1}`,
        absoluteDay,
        action,
        cost,
        capacityDelta,
        riskReduction,
      }].slice(-MAX_RESPONSES),
    },
  };
}

export function previewSeasonCommand(course: Course, world: World, command: SeasonCommand): SeasonCommandPreview {
  const day = "currentDay" in command ? command.currentDay : 0;
  const state = currentState(course, world, day);
  const blockers: string[] = [];
  let cost = 0;
  let days = 0;
  let capacityDelta = 0;
  let riskReduction = 0;
  let summary = command.type.replaceAll("_", " ").toLowerCase();
  if (command.type === "SELECT_CHARTER") {
    const year = calendarDate(absoluteDayFor(world.week, day)).year;
    cost = state.charter === command.charter ? 0 : year === 1 && state.charterChanges.length === 0 ? 0 : 12_500 + year * 2_500;
    if (state.charterReviewedYears.includes(year)) blockers.push("The charter review for this year is already settled.");
    if (!command.confirmed && state.charter !== command.charter) blockers.push("Confirm the annual charter cost and disclosed tradeoff.");
    summary = `${CHARTER_DEFINITIONS[command.charter].name}: ${CHARTER_DEFINITIONS[command.charter].tradeoff}`;
  } else if (command.type === "IMPROVE_DRAINAGE") {
    if (state.operations.drainageLevel >= 3) blockers.push("Drainage is already at the maximum strategic tier.");
    if (state.operations.drainageConstructionDays > 0) blockers.push("The current drainage project must finish first.");
    cost = 18_000 * (state.operations.drainageLevel + 1);
    days = 7 + state.operations.drainageLevel * 3;
    riskReduction = 0.11;
    summary = `Drainage tier ${state.operations.drainageLevel + 1} reduces rain damage and cancellation risk by 11%.`;
  } else if (command.type === "SET_COURSE_CLOSED") {
    const layout = normalizeCourseLayouts(course).layouts!.find((candidate) => candidate.id === command.courseId);
    if (!layout) blockers.push("That operating course no longer exists.");
    if (command.closed && world.playerPro?.activeRound?.course.courseId === command.courseId && !["round_complete", "conceded"].includes(world.playerPro.activeRound.phase)) blockers.push("Finish or concede the active Player Pro round before closing its course.");
    capacityDelta = command.closed ? -(layout?.roundLength ?? 9) * 4 : (layout?.roundLength ?? 9) * 4;
    riskReduction = command.closed ? 0.8 : 0;
    summary = command.closed ? "Close the course and move future tournaments, outings, and golf entitlements by seven days." : "Reopen the course for ordinary, package, Player Pro, and tournament golf.";
  } else if (command.type === "SET_HOLES_CLOSED") {
    const valid = command.holeIds.filter((id) => course.holes.some((hole) => hole.id === id));
    if (valid.length !== command.holeIds.length) blockers.push("One or more selected holes no longer exist.");
    const activeHoleId = world.playerPro?.activeRound?.course.holes[world.playerPro.activeRound.currentHoleIndex]?.id;
    if (activeHoleId && valid.includes(activeHoleId) && !["round_complete", "conceded"].includes(world.playerPro!.activeRound!.phase)) blockers.push("The Player Pro is currently playing a selected hole.");
    capacityDelta = -valid.length * 4;
    riskReduction = Math.min(0.75, valid.length * 0.08);
    summary = `Close ${valid.length} vulnerable hole${valid.length === 1 ? "" : "s"} across golf, packages, and safety policy.`;
  } else if (command.type === "RESCHEDULE_TOURNAMENT") {
    const event = world.tournaments?.events.find((candidate) => candidate.id === command.eventId);
    if (!event || event.status !== "scheduled") blockers.push("Only a scheduled tournament can be moved.");
    if (!Number.isInteger(command.days) || command.days < 1 || command.days > 28) blockers.push("Choose a reschedule window from 1 to 28 days.");
    cost = 500;
    summary = `Move the event ${command.days} day${command.days === 1 ? "" : "s"} and preserve its field, deposit, and qualification snapshot.`;
  }
  if (world.cash < cost) blockers.push(`Need $${cost.toLocaleString()} available.`);
  return { ok: blockers.length === 0, cost, days, capacityDelta, riskReduction, blockers, summary };
}

function moveWeekDay(week: number, day: number, offset: number) {
  return weekDayFromAbsoluteDay(absoluteDayFor(week, day) + offset);
}

function rescheduleForClosure(world: World, courseId: string, offset = 7): World {
  const tournaments = world.tournaments ? {
    ...world.tournaments,
    events: world.tournaments.events.map((event) => {
      if (event.status !== "scheduled" || event.courseId !== courseId) return event;
      const next = moveWeekDay(event.scheduledWeek, event.scheduledDay, offset);
      return { ...event, scheduledWeek: next.week, scheduledDay: next.day, warning: "Rescheduled after a forecast closure." };
    }),
  } : world.tournaments;
  const enterprise = normalizePropertyEnterprise(world.enterprise);
  const outings = enterprise.outings.map((outing) => {
    if (outing.status !== "scheduled") return outing;
    const next = moveWeekDay(outing.week, outing.day, offset);
    return { ...outing, week: next.week, day: next.day };
  });
  const reservations = enterprise.reservations.map((reservation) => ({
    ...reservation,
    entitlements: reservation.entitlements?.map((entitlement) => {
      if (entitlement.kind !== "golf" || entitlement.status === "fulfilled" || entitlement.redeemed) return entitlement;
      const next = moveWeekDay(entitlement.scheduledWeek ?? reservation.week, entitlement.scheduledDay ?? 0, offset);
      return { ...entitlement, scheduledWeek: next.week, scheduledDay: next.day, status: "substituted" as const, note: "Moved after course closure." };
    }),
  }));
  return { ...world, tournaments, enterprise: { ...enterprise, outings, reservations } };
}

export function applySeasonCommand(course: Course, world: World, command: SeasonCommand): { ok: boolean; course: Course; world: World; message: string; preview: SeasonCommandPreview } {
  const preview = previewSeasonCommand(course, world, command);
  if (!preview.ok) return { ok: false, course, world, message: preview.blockers.join(" "), preview };
  const day = "currentDay" in command ? command.currentDay : 0;
  const absoluteDay = absoluteDayFor(world.week, day);
  let state = currentState(course, world, day);
  if (command.type === "SELECT_CHARTER") {
    const year = calendarDate(absoluteDay).year;
    const from = state.charter;
    if (from === command.charter) return { ok: true, course, world: { ...world, seasonal: state }, message: `${CHARTER_DEFINITIONS[from].name} remains the club charter.`, preview };
    const id = `charter-${year}`;
    state = {
      ...state,
      charter: command.charter,
      charterSelectedYear: year,
      charterReviewedYears: [...new Set([...state.charterReviewedYears, year])].slice(-40),
      charterChanges: [...state.charterChanges, { id, year, from, to: command.charter, cost: preview.cost }].slice(-40),
      timeline: [...state.timeline, {
        id,
        absoluteDay,
        year,
        kind: "charter" as const,
        title: `${CHARTER_DEFINITIONS[command.charter].name} charter adopted`,
        detail: CHARTER_DEFINITIONS[command.charter].promise,
      }].slice(-MAX_TIMELINE),
    };
    return { ok: true, course, world: { ...world, cash: world.cash - preview.cost, seasonal: state }, message: preview.summary, preview };
  }
  if (command.type === "SET_AUTOMATION") {
    state = { ...state, automation: { ...state.automation, preset: command.preset, lastAppliedAbsoluteDay: -1 } };
  } else if (command.type === "SET_ADVANCED_OPERATIONS") {
    state = { ...state, automation: { ...state.automation, advancedOperations: command.enabled, lastAppliedAbsoluteDay: -1 } };
  } else if (command.type === "SET_AUTOMATION_OVERRIDE") {
    const overrides = new Set(state.automation.overrides);
    if (command.manual) overrides.add(command.system); else overrides.delete(command.system);
    state = { ...state, automation: { ...state.automation, overrides: [...overrides], lastAppliedAbsoluteDay: -1 } };
  } else if (command.type === "SET_TURF_PRIORITY") {
    state = response({ ...state, operations: { ...state.operations, turfPriority: command.priority } }, absoluteDay, `Turf priority: ${command.priority}`, 0, 0, command.priority === "recovery" ? 0.08 : 0.03);
  } else if (command.type === "SET_WATER_POLICY") {
    state = response({ ...state, operations: { ...state.operations, waterPolicy: command.policy } }, absoluteDay, `Water policy: ${command.policy}`, 0, 0, command.policy === "irrigate" ? 0.14 : command.policy === "balanced" ? 0.07 : 0.02);
  } else if (command.type === "IMPROVE_DRAINAGE") {
    state = response({
      ...state,
      operations: {
        ...state.operations,
        drainageLevel: state.operations.drainageLevel + 1,
        drainageConstructionDays: preview.days,
      },
    }, absoluteDay, `Drainage tier ${state.operations.drainageLevel + 1}`, preview.cost, 0, preview.riskReduction);
    world = { ...world, cash: world.cash - preview.cost };
  } else if (command.type === "SET_COURSE_CLOSED") {
    const normalized = normalizeCourseLayouts(course);
    const layouts = normalized.layouts!.map((layout): CourseLayout => layout.id === command.courseId ? { ...layout, state: command.closed ? "closed" : "open" } : layout);
    course = { ...course, layouts };
    const closedCourseIds = command.closed
      ? [...new Set([...state.operations.closedCourseIds, command.courseId])]
      : state.operations.closedCourseIds.filter((id) => id !== command.courseId);
    state = response({ ...state, operations: { ...state.operations, closedCourseIds } }, absoluteDay, command.closed ? `Closed ${command.courseId}` : `Reopened ${command.courseId}`, 0, preview.capacityDelta, preview.riskReduction);
    if (command.closed) world = rescheduleForClosure(world, command.courseId);
  } else if (command.type === "SET_HOLES_CLOSED") {
    const closedHoleIds = [...new Set(command.holeIds)].slice(0, 36);
    const property = normalizePropertyCourse(course.property);
    course = { ...course, property: { ...property, safetyPolicy: { ...property.safetyPolicy, closedHoleIds } } };
    state = response({ ...state, operations: { ...state.operations, closedHoleIds } }, absoluteDay, `Closed ${closedHoleIds.length} holes`, 0, preview.capacityDelta, preview.riskReduction);
  } else if (command.type === "RESCHEDULE_TOURNAMENT") {
    const tournaments = world.tournaments ? {
      ...world.tournaments,
      events: world.tournaments.events.map((event) => {
        if (event.id !== command.eventId) return event;
        const next = moveWeekDay(event.scheduledWeek, event.scheduledDay, command.days);
        return { ...event, scheduledWeek: next.week, scheduledDay: next.day, warning: "Rescheduled from the seasonal forecast." };
      }),
    } : world.tournaments;
    world = { ...world, cash: world.cash - preview.cost, tournaments };
    state = response(state, absoluteDay, `Rescheduled ${command.eventId} by ${command.days} days`, preview.cost, 0, 0.2);
  } else if (command.type === "ACKNOWLEDGE_YEARBOOK") {
    state = {
      ...state,
      yearbooks: state.yearbooks.map((book) => book.id === command.yearbookId ? { ...book, dismissed: true } : book),
      ...(state.pendingYearbookId === command.yearbookId ? { pendingYearbookId: undefined } : {}),
    };
  }
  return { ok: true, course, world: { ...world, seasonal: state }, message: preview.summary, preview };
}
