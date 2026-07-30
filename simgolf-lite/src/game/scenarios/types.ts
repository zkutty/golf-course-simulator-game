import type { Difficulty, LandTheme, ScenarioConstraints } from "../models/types";
import type { GoalDefinition } from "../models/objectives";
import type { MessageKey } from "../../i18n/catalog";
import type { BiomeCompatibilityMetadata } from "../models/biomes";

// Career scenario format (ZKU-164): pure data. Goals come from the ZKU-163
// vocabulary; constraints are the ScenarioConstraints the sim/UI enforce.

export type FixtureKey = "muni" | "members";

export interface ScenarioDefinition {
  id: string;
  /** Ladder position, 1-based; completing N unlocks N+1. */
  order: number;
  name: string;
  blurb: string;
  nameKey: MessageKey;
  blurbKey: MessageKey;
  seed: number;
  theme: LandTheme;
  biomeCompatibility: BiomeCompatibilityMetadata;
  difficulty: Difficulty;
  /** Course name the run starts with (defaults to the scenario name). */
  courseName?: string;
  /** Starting cash override (otherwise difficulty-scaled default). */
  startingCash?: number;
  goals: GoalDefinition[];
  constraints?: ScenarioConstraints;
  /** Prebuilt-course scenarios start from an authored fixture. */
  fixture?: FixtureKey;
  /** World tweaks for prebuilt courses (e.g. a muni's tattered reputation). */
  startingReputation?: number;
}
