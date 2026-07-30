/**
 * Stable semantic plant identifiers persisted by player-authored features.
 *
 * Natural/generated obstacles intentionally omit a plant id and provenance so
 * historical saves retain their free-to-keep behavior. The registry must
 * provide one definition for every id in this list.
 */
export const PLANT_IDS = [
  "parkland-oak",
  "parkland-wild-shrub",
  "parkland-perennial-bed",
  "parkland-annual-planter",
  "parkland-specimen-tree",
  "links-hawthorn",
  "links-gorse",
  "links-heather-bed",
  "links-coastal-planter",
  "links-windbreak",
  "desert-mesquite",
  "desert-agave",
  "desert-xeric-bed",
  "desert-succulent-planter",
  "desert-sculptural-cactus",
] as const;

export type PlantId = (typeof PLANT_IDS)[number];

/** Only unambiguous post-migration authoring records player provenance. */
export type FeatureOrigin = "natural" | "player";
