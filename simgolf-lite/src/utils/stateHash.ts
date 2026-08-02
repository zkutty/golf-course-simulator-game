import type { Course, World } from "../game/models/types";
import type { LiveSimulationSnapshotV1 } from "../game/live/persistence";
import { withNormalizedHoleSetup } from "../game/models/courseSetup";
import { normalizeCourseLayouts } from "../game/models/courseLayouts";
import { normalizedBuilding } from "../game/models/buildings";
import { normalizeM51CourseMobilityState, normalizeM51MobilityState } from "../game/m51/mobility";
import {
  biomeCompatibilityMetadataFor,
  normalizeBiomeKey,
  validateBiomeCompatibilityMetadata,
} from "../game/models/biomes";
import { withNormalizedGreenContract } from "../game/greens/greenSurface";

export { hashCanonicalValue } from "./canonical";
import { hashCanonicalValue } from "./canonical";

export function hashGameState(value: {
  course: Course;
  world: World;
  live?: LiveSimulationSnapshotV1;
}): string {
  // Callers often pass a full SavePayload. Hash only the persisted game-state
  // contract declared above; UI metadata such as tutorial/profile fields must
  // not make an otherwise lossless save/load round trip look different.
  // Optional collection defaults are semantically empty both before and
  // after migration; canonicalize them so a lossless save/load does not
  // appear different merely because the loader materialized `[]`.
  const normalized = normalizeCourseLayouts(value.course);
  const theme = normalizeBiomeKey(normalized.theme ?? "parkland");
  if (!theme) {
    throw new Error(`Cannot hash unsupported biome "${String(normalized.theme)}".`);
  }
  const compatibility = validateBiomeCompatibilityMetadata(
    normalized.biomeCompatibility,
    theme,
  );
  if (!compatibility.ok) {
    throw new Error(`Cannot hash: ${compatibility.error}`);
  }
  const course = withNormalizedGreenContract({
    ...normalized,
    theme,
    biomeCompatibility: biomeCompatibilityMetadataFor(theme),
    decorations: value.course.decorations ?? [],
    buildings: (value.course.buildings ?? []).map(normalizedBuilding),
    activePinRotation: value.course.activePinRotation ?? "A",
    holes: normalized.holes.map(withNormalizedHoleSetup),
    m51: normalizeM51CourseMobilityState(normalized.m51, normalized),
  });
  const activeRound = value.world.playerPro?.activeRound;
  const playerPro = activeRound
    ? (() => {
        const roundTheme = normalizeBiomeKey(activeRound.course.theme);
        if (!roundTheme) {
          throw new Error(`Cannot hash active round with unsupported biome "${String(activeRound.course.theme)}".`);
        }
        const roundCompatibility = validateBiomeCompatibilityMetadata(
          activeRound.course.biomeCompatibility,
          roundTheme,
        );
        if (!roundCompatibility.ok) {
          throw new Error(`Cannot hash active round: ${roundCompatibility.error}`);
        }
        return {
          ...value.world.playerPro!,
          activeRound: {
            ...activeRound,
            course: {
              ...activeRound.course,
              theme: roundTheme,
              biomeCompatibility: biomeCompatibilityMetadataFor(roundTheme),
            },
          },
        };
      })()
    : value.world.playerPro;
  const world = {
    ...value.world,
    playerPro,
    m51: normalizeM51MobilityState(value.world.m51),
  };
  return hashCanonicalValue({ course, world, live: value.live });
}
