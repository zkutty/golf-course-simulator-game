import type { Course } from "../models/types";
import { BALANCE } from "../balance/balanceConfig";

export interface ClubSpec {
  name: string;
  carryYards: number;
  dispersionTilesBase: number; // longer clubs generally wider
}

export interface GolferProfile {
  name: "SCRATCH" | "BOGEY";
  yardsPerTile: number;
  clubs: ClubSpec[];
}

export function getGolferProfile(name: GolferProfile["name"], course?: Course): GolferProfile {
  const base =
    name === "SCRATCH"
      ? BALANCE.golfers.scratch
      : BALANCE.golfers.bogey;
  const yardsPerTile = course?.yardsPerTile ?? base.yardsPerTile;
  return {
    name,
    yardsPerTile,
    clubs: base.clubs.slice(),
  };
}





