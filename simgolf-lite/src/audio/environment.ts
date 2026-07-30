import type { Course, Point, Terrain } from "../game/models/types";
import type { SeasonName, WeatherKind } from "../game/seasons/types";
import type { AmbientMix, AudioSurface, MusicContext } from "./AudioManager";
import type { SunoAmbienceContext } from "./sunoLibrary";
import { getBiomeDefinition } from "../game/models/biomes";

export function audioSurfaceFor(input: {
  screen: "menu" | "setup" | "game" | "loading";
  showVision: boolean;
}): AudioSurface {
  if (input.screen === "menu" && input.showVision) return "vision";
  return input.screen;
}

export function worldAmbienceEnabledFor(surface: AudioSurface): boolean {
  return surface === "game";
}

export type AudioScene =
  | "silent"
  | "menu"
  | "design"
  | "operate"
  | "play"
  | "tournament"
  | "crisis"
  | "evening"
  | "finale";

export interface MusicSelectionInput {
  screen: "menu" | "setup" | "game" | "loading";
  viewMode: "COZY" | "ARCHITECT";
  cash: number;
  liveRunning: boolean;
  won: boolean;
  theme?: Course["theme"];
  playerRoundActive?: boolean;
  tournamentTier?: "local" | "regional" | "championship";
  /** Game-clock minutes. Evening intentionally yields to the night ambience bed. */
  dayMinute?: number;
}

/**
 * The ordered score route, kept separate from playback so it is cheap to test
 * and cannot bypass AudioManager's gesture gate or single-stream ownership.
 */
export function audioSceneFor(input: MusicSelectionInput): AudioScene {
  if (input.screen === "loading") return "silent";
  if (input.screen === "menu" || input.screen === "setup") return "menu";
  if (input.won) return "finale";
  if (input.cash < 0) return "crisis";
  if (input.tournamentTier) return "tournament";
  if (input.playerRoundActive) return "play";
  // Let the existing authored night bed own the file-backed background stream.
  // Higher-priority game states above retain their score at night.
  // Day zero is also represented as minute 0 during tutorial entry, so keep
  // the authored score until the clock has actually reached the evening bed.
  if (input.dayMinute != null && input.dayMinute >= 700) return "evening";
  if (input.viewMode === "ARCHITECT" || !input.liveRunning) return "design";
  return "operate";
}

export function musicContextFor(input: MusicSelectionInput): MusicContext {
  switch (audioSceneFor(input)) {
    case "silent":
    case "evening":
      return "silent";
    case "menu":
      return "title";
    case "design":
      return getBiomeDefinition(input.theme).content.audio.designMusic;
    case "operate":
      return "live";
    case "play":
      return "play";
    case "tournament":
      return `tournament-${input.tournamentTier!}`;
    case "crisis":
      return "tension";
    case "finale":
      return "victory";
  }
}

export function ambientMixFor(input: {
  course: Course;
  center: Point;
  dayMinute: number;
  visibleGolfers: number;
  paused: boolean;
  enabled?: boolean;
  weatherKind?: WeatherKind;
  season?: SeasonName;
  radius?: number;
}): AmbientMix {
  const radius = input.radius ?? 9;
  const minX = Math.max(0, Math.floor(input.center.x - radius));
  const maxX = Math.min(input.course.width - 1, Math.ceil(input.center.x + radius));
  const minY = Math.max(0, Math.floor(input.center.y - radius));
  const maxY = Math.min(input.course.height - 1, Math.ceil(input.center.y + radius));
  const counts: Partial<Record<Terrain, number>> = {};
  let total = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const terrain = input.course.tiles[y * input.course.width + x];
      counts[terrain] = (counts[terrain] ?? 0) + 1;
      total++;
    }
  }
  const obstacleCount = input.course.obstacles.filter((item) =>
    item.x >= minX && item.x <= maxX && item.y >= minY && item.y <= maxY
  ).length;
  const share = (terrain: Terrain) => (counts[terrain] ?? 0) / Math.max(1, total);
  const dawn = 1 - Math.min(1, Math.abs(input.dayMinute - 100) / 230);
  const dusk = Math.max(0, (input.dayMinute - 620) / 220);
  // A planned, closed, or under-construction facility must not make the
  // current course sound like a campus or resort.
  const nearbyProperty = input.course.property?.assets.filter((asset) =>
    asset.enabled
    && (asset.constructionDaysRemaining ?? 0) <= 0
    && Math.hypot(asset.x - input.center.x, asset.y - input.center.y) <= radius
  ) ?? [];
  const nearResort = nearbyProperty.some((asset) => asset.category === "resort" || asset.category === "community");
  const nearCampus = nearbyProperty.some((asset) =>
    asset.category === "access" || asset.category === "practice" || asset.category === "clubhouse"
  );
  const wet = input.weatherKind === "rain" || input.weatherKind === "heavy_rain" || input.weatherKind === "storm";
  let bed: SunoAmbienceContext = getBiomeDefinition(input.course.theme).content.audio.ambience;
  if (wet) bed = "rain";
  else if (input.season === "winter" || input.weatherKind === "frost") bed = "winter";
  else if (input.dayMinute >= 700 || input.dayMinute < 45) bed = "night";
  else if (nearResort) bed = "resort";
  else if (nearCampus) bed = "campus";
  else if (share("water") + share("wetland") * .8 >= .12) bed = "water";
  return {
    enabled: input.enabled ?? true,
    birds: clamp01(obstacleCount / 18 + dawn * .42),
    water: clamp01((share("water") + share("wetland") * .8) * 3.2),
    wind: clamp01((share("rough") + share("deep_rough") + share("sand") + share("waste_area")) * 1.35 + .12),
    murmur: clamp01(input.visibleGolfers / 16),
    crickets: clamp01(dusk),
    bed,
    paused: input.paused,
  };
}

export function distanceVolume(point: Point, center: Point, audibleRadius = 28): number {
  return clamp01(1 - Math.hypot(point.x - center.x, point.y - center.y) / audibleRadius);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
