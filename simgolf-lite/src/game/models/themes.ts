import {
  BIOME_DEFINITIONS,
  BIOME_KEYS,
  type BiomeDefinition,
  type LandTheme,
  type ThemeGenConfig,
} from "./biomes";

export type { ThemeGenConfig } from "./biomes";

/**
 * Stable pre-M52 facade. BIOME_DEFINITIONS remains the source of every value;
 * ZK-560 can migrate consumers to the richer nested contract independently.
 */
export interface LandThemeDefinition {
  key: LandTheme;
  label: string;
  blurb: string;
  generation: ThemeGenConfig;
  tileTints: BiomeDefinition<LandTheme>["presentation"]["tileTints"];
  cliffFaces: BiomeDefinition<LandTheme>["presentation"]["cliffFaces"];
}

function legacyTheme(definition: BiomeDefinition<LandTheme>): LandThemeDefinition {
  return {
    key: definition.key,
    label: definition.label,
    blurb: definition.blurb,
    generation: definition.generation,
    tileTints: definition.presentation.tileTints,
    cliffFaces: definition.presentation.cliffFaces,
  };
}

export const LAND_THEMES = Object.fromEntries(
  BIOME_KEYS.map((key) => [key, legacyTheme(BIOME_DEFINITIONS[key])]),
) as Record<LandTheme, LandThemeDefinition>;

export function getLandTheme(theme: LandTheme | undefined): LandThemeDefinition {
  return LAND_THEMES[theme ?? "parkland"];
}
