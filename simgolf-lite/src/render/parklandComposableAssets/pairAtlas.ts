import type { ParklandPairFringeAssetRole, ParklandPairFringePair } from "../../game/render/parklandPairFringes";

export const PARKLAND_PAIR_ATLAS_COLUMNS = 2;

const pairs: readonly ParklandPairFringePair[] = [
  "fairway--rough", "fairway--deep_rough", "fairway--green", "fairway--tee",
  "rough--deep_rough", "rough--green", "rough--tee",
  "deep_rough--green", "deep_rough--tee", "green--tee",
];

export const PARKLAND_PAIR_ATLAS_ROLES: readonly ParklandPairFringeAssetRole[] = pairs.flatMap((pair) => [
  ...(["n", "e", "s", "w"] as const).map((direction) => `edge:${pair}:${direction}` as const),
  ...(["ne", "se", "sw", "nw"] as const).map((corner) => `corner:${pair}:${corner}` as const),
]);
