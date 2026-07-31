import { BIOME_KEYS, isLandTheme } from "../game/models/biomes";
import type { ClimateCalendarSeason } from "../game/models/biomes";
import type { LandTheme } from "../game/models/types";
import { activeWeather, seasonalState } from "../game/seasons/seasons";
import type { WeatherKind } from "../game/seasons/types";
import type { SavePayload } from "../utils/save";

export type LoadingBiomeContext = Readonly<{
  theme: LandTheme;
  season: ClimateCalendarSeason;
  weather: WeatherKind;
}>;

const NEUTRAL_LOADING_SEASON: ClimateCalendarSeason = "summer";
const NEUTRAL_LOADING_WEATHER: WeatherKind = "clear";

/** Setup/scenario/manifest loading has no parsed seasonal destination yet. */
export function neutralLoadingBiomeContext(theme: unknown): LoadingBiomeContext {
  return Object.freeze({
    theme: isLandTheme(theme) ? theme : BIOME_KEYS[0],
    season: NEUTRAL_LOADING_SEASON,
    weather: NEUTRAL_LOADING_WEATHER,
  });
}

/** A parsed save owns the exact destination day, calendar, and weather. */
export function savedLoadingBiomeContext(payload: SavePayload): LoadingBiomeContext {
  const theme = isLandTheme(payload.course.theme)
    ? payload.course.theme
    : BIOME_KEYS[0];
  const course = payload.course.theme === theme
    ? payload.course
    : { ...payload.course, theme };
  const rawDay = payload.live?.state.dayIndex;
  const day = Number.isFinite(rawDay)
    ? Math.max(0, Math.min(6, Math.floor(rawDay!)))
    : 0;
  return Object.freeze({
    theme,
    season: seasonalState(payload.world, course, day).calendar.season,
    weather: activeWeather(payload.world, course, day).kind,
  });
}
