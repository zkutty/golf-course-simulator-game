import type { Building, ConcessionType, Course, Point } from "../models/types";
import { BUILDING_SPECS, buildingEntrance, isConcession } from "../models/buildings";
import type { Personality } from "./personality";

export interface PlannedPurchase {
  building: Building & { type: ConcessionType };
  entrance: Point;
  amount: number;
  item: string;
  serviceMinutes: number;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function rollDiscretionaryWallet(personality: Personality, rng: () => number): number {
  return Math.round(12 + personality.spendPropensity * 70 + rng() * 35);
}

/** Deterministic, personality/satisfaction/proximity/price-driven purchase decision. */
export function planPurchase(args: {
  course: Course;
  type: ConcessionType;
  from: Point;
  personality: Personality;
  satisfaction: number;
  wallet: number;
  rng: () => number;
}): PlannedPurchase | null {
  const options = args.course.buildings.filter(isConcession).filter((b) => b.type === args.type);
  if (options.length === 0) return null;
  const ranked = options
    .map((building) => ({
      building,
      entrance: buildingEntrance(args.course, building),
    }))
    .sort((a, b) =>
      Math.hypot(a.entrance.x - args.from.x, a.entrance.y - args.from.y) -
      Math.hypot(b.entrance.x - args.from.x, b.entrance.y - args.from.y)
    );
  const pick = ranked[0];
  const spec = BUILDING_SPECS[pick.building.type];
  const amount = Math.max(1, Math.round(pick.building.price ?? spec.defaultPrice!));
  if (amount > args.wallet) return null;
  const distance = Math.hypot(pick.entrance.x - args.from.x, pick.entrance.y - args.from.y);
  const priceAppeal = clamp01(1.25 - amount / Math.max(8, spec.defaultPrice! * 2.5));
  const proximity = 1 / (1 + distance / 28);
  const tierAppeal = 0.9 + ((pick.building.tier ?? 1) - 1) * 0.12;
  const chance = clamp01(
    args.personality.spendPropensity *
      (0.45 + args.satisfaction * 0.55) *
      (0.55 + proximity * 0.45) *
      priceAppeal *
      tierAppeal
  );
  if (args.rng() >= chance) return null;
  return {
    building: pick.building,
    entrance: pick.entrance,
    amount,
    item: spec.item!,
    serviceMinutes: spec.serviceMinutes! / Math.max(1, pick.building.tier ?? 1),
  };
}
