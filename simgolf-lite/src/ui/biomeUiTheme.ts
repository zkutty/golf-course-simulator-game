import { BIOME_KEYS, getBiomeDefinition, isLandTheme } from "../game/models/biomes";
import type { LandTheme } from "../game/models/types";
import type { ColorVisionMode } from "../game/onboarding/profile";
import type { ClimateCalendarSeason } from "../game/models/biomes";
import type { WeatherKind } from "../game/seasons/types";

/**
 * ZK-623's deliberately small theming boundary. CourseCraft's brand shell
 * owns commands, type, layout, icons, focus, and permanent controls. A biome
 * may only contribute the contextual values below: restrained accents,
 * low-emphasis surfaces, a descriptive motif, and a weather/season cue.
 */
export const BIOME_UI_ALLOWED_SURFACES = [
  "course-frame", "course-header", "contextual-inspector", "design-dock",
  "new-game-preview", "loading", "seasons-legacy", "condition-report",
  "upkeep-report", "empty-state", "notification", "supporting-illustration",
] as const;

export const BIOME_UI_FORBIDDEN_SURFACES = [
  "layout", "command-order", "shortcuts", "typography", "iconography",
  "navigation", "focus-indicator", "permanent-controls", "semantic-roles",
] as const;

export type BiomeUiMotif = "leaf" | "wind" | "sun";
export type BiomeUiCharacter = "neutral" | "coastal" | "mineral";
export type BiomeUiIllustration = "canopy" | "wind-lines" | "irrigation-rings";
export type BiomeContextSurface = (typeof BIOME_UI_ALLOWED_SURFACES)[number];
export type BiomeStatusTone =
  | "neutral"
  | "positive"
  | "advisory"
  | "warning"
  | "critical";

export const BIOME_CONTEXT_PROFILES = {
  parkland: {
    character: "neutral",
    motif: "leaf",
    illustration: "canopy",
  },
  links: {
    character: "coastal",
    motif: "wind",
    illustration: "wind-lines",
  },
  desert: {
    character: "mineral",
    motif: "sun",
    illustration: "irrigation-rings",
  },
} as const satisfies Record<LandTheme, {
  character: BiomeUiCharacter;
  motif: BiomeUiMotif;
  illustration: BiomeUiIllustration;
}>;

export type BiomeUiTheme = Readonly<{
  biome: LandTheme;
  /** True when an absent/stale value was reduced to the registry fallback. */
  fallback: boolean;
  accent: string;
  accentOnLight: string;
  surface: string;
  edge: string;
  motif: BiomeUiMotif;
  character: BiomeUiCharacter;
  illustration: BiomeUiIllustration;
  seasonSurface: string;
  weatherEdge: string;
  season: ClimateCalendarSeason;
  weather: WeatherKind;
  reducedMotion: boolean;
  allowedSurfaces: typeof BIOME_UI_ALLOWED_SURFACES;
  forbiddenSurfaces: typeof BIOME_UI_FORBIDDEN_SURFACES;
}>;

export type BiomeUiThemeOptions = Readonly<{
  season?: ClimateCalendarSeason;
  weather?: WeatherKind;
  colorVision?: ColorVisionMode;
  reducedMotion?: boolean;
}>;

type Rgb = readonly [number, number, number];
const BRAND_PAPER = "#fffdf6";
const BRAND_INK = "#18251c";

function cssHex(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}

function rgb(hex: string): Rgb {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function hex(value: Rgb): string {
  return `#${value.map((part) => Math.round(Math.max(0, Math.min(255, part))).toString(16).padStart(2, "0")).join("")}`;
}

function mix(from: string, to: string, amount: number): string {
  const start = rgb(from);
  const end = rgb(to);
  return hex([
    start[0] + (end[0] - start[0]) * amount,
    start[1] + (end[1] - start[1]) * amount,
    start[2] + (end[2] - start[2]) * amount,
  ]);
}

function linearChannel(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const [red, green, blue] = rgb(color).map(linearChannel);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const [a, b] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (a + 0.05) / (b + 0.05);
}

/** Keep a registry colour recognisable but dark enough for text or a keyline. */
export function contrastSafeAccent(source: string, background = BRAND_PAPER, minimum = 4.5): string {
  if (contrastRatio(source, background) >= minimum) return source;
  let low = 0;
  let high = 1;
  for (let index = 0; index < 20; index += 1) {
    const amount = (low + high) / 2;
    const candidate = mix(source, BRAND_INK, amount);
    if (contrastRatio(candidate, background) >= minimum) high = amount;
    else low = amount;
  }
  return mix(source, BRAND_INK, high);
}

function accessibleAccent(source: string, mode: ColorVisionMode): string {
  // A CVD setting intentionally favours reliably distinguishable hues over
  // biome hue. Motif/text still identify the biome; semantics never depend on
  // this colour.
  if (mode === "deuteranopia" || mode === "protanopia") return "#075c9e";
  if (mode === "tritanopia") return "#8b3d00";
  return contrastSafeAccent(source);
}

function motifFor(theme: LandTheme): BiomeUiMotif {
  return BIOME_CONTEXT_PROFILES[theme].motif;
}

function accentSource(theme: LandTheme): string {
  const definition = getBiomeDefinition(theme);
  const motif = motifFor(theme);
  // Select a semantic colour from existing registry presentation data. This
  // makes Links read as coastal and Desert as mineral/warm without adding a
  // parallel UI palette to maintain.
  if (motif === "wind") return cssHex(definition.presentation.tileTints.water ?? definition.presentation.preview.propTints.bush);
  if (motif === "sun") return cssHex(definition.presentation.tileTints.waste_area ?? definition.presentation.preview.propTints.rock);
  return cssHex(definition.presentation.preview.propTints.tree);
}

function fallbackTheme(theme: unknown): { theme: LandTheme; fallback: boolean } {
  return isLandTheme(theme)
    ? { theme, fallback: false }
    : { theme: BIOME_KEYS[0], fallback: true };
}

export function biomeUiTheme(theme: unknown, options: BiomeUiThemeOptions = {}): BiomeUiTheme {
  const resolved = fallbackTheme(theme);
  const source = accentSource(resolved.theme);
  const accent = accessibleAccent(source, options.colorVision ?? "standard");
  const weather = options.weather ?? "clear";
  const season = options.season ?? "summer";
  const weatherEdge = weather === "storm" || weather === "heavy_rain"
    ? "#355b7a"
    : weather === "heat" || weather === "drought"
      ? "#8a5800"
      : accent;
  const seasonMix = {
    spring: 0.92,
    summer: 0.88,
    autumn: 0.9,
    winter: 0.94,
  } satisfies Record<ClimateCalendarSeason, number>;
  const profile = BIOME_CONTEXT_PROFILES[resolved.theme];
  return Object.freeze({
    biome: resolved.theme,
    fallback: resolved.fallback,
    accent,
    accentOnLight: contrastSafeAccent(accent),
    surface: mix(accent, BRAND_PAPER, 0.9),
    edge: contrastSafeAccent(weatherEdge),
    motif: profile.motif,
    character: profile.character,
    illustration: profile.illustration,
    seasonSurface: mix(accent, BRAND_PAPER, seasonMix[season]),
    weatherEdge: contrastSafeAccent(weatherEdge),
    season,
    weather,
    reducedMotion: options.reducedMotion === true,
    allowedSurfaces: BIOME_UI_ALLOWED_SURFACES,
    forbiddenSurfaces: BIOME_UI_FORBIDDEN_SURFACES,
  });
}

/** CSS-only handoff: no layout, command, focus, or brand token may be set. */
export function biomeUiStyle(theme: BiomeUiTheme): Record<`--biome-${string}`, string> {
  return {
    "--biome-accent": theme.accent,
    "--biome-accent-on-light": theme.accentOnLight,
    "--biome-surface": theme.surface,
    "--biome-season-surface": theme.seasonSurface,
    "--biome-edge": theme.edge,
    "--biome-weather-edge": theme.weatherEdge,
    "--biome-motion-duration": theme.reducedMotion ? "0ms" : "180ms",
  };
}

export function biomeContextAttributes(
  theme: BiomeUiTheme,
  surface: BiomeContextSurface,
  status: BiomeStatusTone = "neutral",
) {
  return {
    "data-biome-context": surface,
    "data-biome": theme.biome,
    "data-biome-character": theme.character,
    "data-biome-motif": theme.motif,
    "data-biome-illustration": theme.illustration,
    "data-season": theme.season,
    "data-weather": theme.weather,
    "data-status-tone": status,
  } as const;
}
