import type { LandTheme } from "../game/models/types";
import { getBiomeDefinition } from "../game/models/biomes";
import type { MessageKey, MessageParams } from "../i18n/catalog";
import { translateCurrent } from "../i18n/core";

export interface CourseVibeMetrics {
  slope: number;
  averageDifficulty: number;
  averageAesthetics: number;
}

export type CourseVibeTone =
  | "everyday"
  | "punishing"
  | "championship"
  | "resort"
  | "beginner";

const VIBE_MESSAGE: Record<CourseVibeTone, MessageKey> = {
  everyday: "hud.vibe.everyday",
  punishing: "hud.vibe.punishing",
  championship: "hud.vibe.championship",
  resort: "hud.vibe.resort",
  beginner: "hud.vibe.beginner",
};

export function courseVibeTone(metrics: CourseVibeMetrics): CourseVibeTone {
  if (metrics.slope >= 145 || metrics.averageDifficulty >= 78) return "punishing";
  if (metrics.slope >= 132 || metrics.averageDifficulty >= 62) return "championship";
  if (metrics.averageAesthetics >= 75 && metrics.slope < 132) return "resort";
  if (metrics.slope <= 110 && metrics.averageDifficulty <= 42) return "beginner";
  return "everyday";
}

export function courseVibeLabel(
  theme: LandTheme | undefined,
  metrics: CourseVibeMetrics,
  translate: (key: MessageKey, params?: MessageParams) => string = translateCurrent,
): string {
  const biome = getBiomeDefinition(theme);
  return translate(VIBE_MESSAGE[courseVibeTone(metrics)], { biome: biome.label });
}
