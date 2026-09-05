import { BIOME_KEYS, type LandTheme } from "../models/biomes";
import type { Terrain } from "../models/types";
import { SEASONS, type SeasonName } from "../seasons/types";

export const HOLE_ILLUSTRATION_CONTRASTS = ["standard", "high-contrast"] as const;
export type HoleIllustrationContrast = (typeof HOLE_ILLUSTRATION_CONTRASTS)[number];
export type HoleIllustrationStyleId = `${LandTheme}:${SeasonName}`;

export interface HoleIllustrationStylePalette {
  readonly background: string;
  readonly terrain: Readonly<Record<Terrain, string>>;
  readonly elevation: { readonly low: string; readonly high: string };
  readonly contour: string;
  readonly path: string;
  readonly vegetation: Readonly<Record<"tree" | "bush" | "rock" | "decoration", string>>;
  readonly surroundings: { readonly fill: string; readonly stroke: string };
  readonly tee: { readonly fill: string; readonly stroke: string };
  readonly pin: { readonly fill: string; readonly stroke: string };
  readonly route: string;
  readonly ink: string;
}

export interface HoleIllustrationStyle {
  readonly version: 1;
  readonly id: HoleIllustrationStyleId;
  readonly biome: LandTheme;
  readonly season: SeasonName;
  readonly name: string;
  readonly standard: HoleIllustrationStylePalette;
  readonly highContrast: HoleIllustrationStylePalette;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const BASE_TERRAIN = {
  parkland: {
    fairway: "#72a85b", rough: "#547d48", deep_rough: "#385d39", sand: "#d8c58d",
    waste_area: "#a98e61", water: "#3b82a0", wetland: "#537b69", green: "#87bd69",
    tee: "#9ac879", path: "#9b876f",
  },
  links: {
    fairway: "#9aaa62", rough: "#7f884c", deep_rough: "#5e683c", sand: "#ddd0a2",
    waste_area: "#aa946c", water: "#437f94", wetland: "#607967", green: "#a9b971",
    tee: "#b5c37e", path: "#9d8d72",
  },
  desert: {
    fairway: "#659a55", rough: "#918b51", deep_rough: "#706a3d", sand: "#dec38d",
    waste_area: "#b48a59", water: "#348da8", wetland: "#627866", green: "#79aa61",
    tee: "#9d8b64", path: "#a49173",
  },
} as const satisfies Record<LandTheme, Record<Terrain, string>>;

const BIOME_ACCENTS = {
  parkland: {
    background: "#f1ead7", contour: "#405b43", path: "#665a4b", route: "#213d2f",
    vegetation: { tree: "#234d34", bush: "#47703e", rock: "#777269", decoration: "#8a4d33" },
    surroundings: { fill: "#c8b28d", stroke: "#594b3c" },
  },
  links: {
    background: "#eee8d1", contour: "#556044", path: "#625b4e", route: "#253b3b",
    vegetation: { tree: "#405845", bush: "#5f7046", rock: "#706d64", decoration: "#7e523c" },
    surroundings: { fill: "#c1ae8e", stroke: "#554b40" },
  },
  desert: {
    background: "#f3e2c2", contour: "#6c553c", path: "#705943", route: "#263b35",
    vegetation: { tree: "#31563b", bush: "#606c3d", rock: "#7a604c", decoration: "#874a35" },
    surroundings: { fill: "#c89b6a", stroke: "#604331" },
  },
} as const satisfies Record<LandTheme, {
  background: string;
  contour: string;
  path: string;
  route: string;
  vegetation: Record<"tree" | "bush" | "rock" | "decoration", string>;
  surroundings: { fill: string; stroke: string };
}>;

const SEASON_WASH = {
  spring: { color: "#d8edc8", amount: 0.10 },
  summer: { color: "#f4d890", amount: 0.04 },
  autumn: { color: "#c98755", amount: 0.13 },
  winter: { color: "#dbe3df", amount: 0.22 },
} as const satisfies Record<SeasonName, { color: string; amount: number }>;

const HIGH_CONTRAST_TERRAIN: Readonly<Record<Terrain, string>> = deepFreeze({
  fairway: "#60b044", rough: "#34752e", deep_rough: "#174d2a", sand: "#ffe08a",
  waste_area: "#b86b25", water: "#1676a3", wetland: "#386b62", green: "#8ee36a",
  tee: "#d3f29b", path: "#806650",
});

function channel(hex: string, offset: number): number {
  return Number.parseInt(hex.slice(offset, offset + 2), 16);
}

function mixHex(base: string, wash: string, amount: number): string {
  const mixed = [1, 3, 5].map((offset) =>
    Math.round(channel(base, offset) * (1 - amount) + channel(wash, offset) * amount)
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${mixed.join("")}`;
}

function standardPalette(biome: LandTheme, season: SeasonName): HoleIllustrationStylePalette {
  const accent = BIOME_ACCENTS[biome];
  const wash = SEASON_WASH[season];
  const terrain = Object.fromEntries(
    Object.entries(BASE_TERRAIN[biome]).map(([kind, color]) => [kind, mixHex(color, wash.color, wash.amount)]),
  ) as Record<Terrain, string>;
  return deepFreeze({
    background: mixHex(accent.background, wash.color, wash.amount / 2),
    terrain,
    elevation: { low: "#ffffff", high: "#17231d" },
    contour: accent.contour,
    path: accent.path,
    vegetation: accent.vegetation,
    surroundings: accent.surroundings,
    tee: { fill: "#f8f3df", stroke: "#203b2f" },
    pin: { fill: "#d9493f", stroke: "#ffffff" },
    route: accent.route,
    ink: "#1e2922",
  });
}

function highContrastPalette(): HoleIllustrationStylePalette {
  return deepFreeze({
    background: "#ffffff",
    terrain: HIGH_CONTRAST_TERRAIN,
    elevation: { low: "#ffffff", high: "#000000" },
    contour: "#000000",
    path: "#000000",
    vegetation: { tree: "#003d19", bush: "#0c641f", rock: "#3f3f3f", decoration: "#7a2400" },
    surroundings: { fill: "#e0a85c", stroke: "#000000" },
    tee: { fill: "#ffffff", stroke: "#000000" },
    pin: { fill: "#d00000", stroke: "#000000" },
    route: "#000000",
    ink: "#000000",
  });
}

function styleName(biome: LandTheme, season: SeasonName): string {
  return `CourseCraft ${biome[0].toUpperCase()}${biome.slice(1)} — ${season[0].toUpperCase()}${season.slice(1)}`;
}

/** Complete, renderer-neutral style coverage for every currently playable biome and calendar season. */
export const HOLE_ILLUSTRATION_STYLE_REGISTRY: Readonly<Record<HoleIllustrationStyleId, HoleIllustrationStyle>> =
  deepFreeze(Object.fromEntries(BIOME_KEYS.flatMap((biome) => SEASONS.map((season) => {
    const id: HoleIllustrationStyleId = `${biome}:${season}`;
    return [id, {
      version: 1 as const,
      id,
      biome,
      season,
      name: styleName(biome, season),
      standard: standardPalette(biome, season),
      highContrast: highContrastPalette(),
    }];
  }))) as Record<HoleIllustrationStyleId, HoleIllustrationStyle>);

export const HOLE_ILLUSTRATION_STYLE_IDS = deepFreeze(
  BIOME_KEYS.flatMap((biome) => SEASONS.map((season): HoleIllustrationStyleId => `${biome}:${season}`)),
);

export function resolveHoleIllustrationStyle(
  biome: LandTheme,
  season: SeasonName,
  contrast: HoleIllustrationContrast,
): HoleIllustrationStylePalette {
  const style = HOLE_ILLUSTRATION_STYLE_REGISTRY[`${biome}:${season}`];
  return contrast === "high-contrast" ? style.highContrast : style.standard;
}
