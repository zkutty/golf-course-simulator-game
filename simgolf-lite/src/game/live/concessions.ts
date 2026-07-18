import type { Building, ConcessionType, Course, Point } from "../models/types";
import { BALANCE } from "../../game/balance/balanceConfig";
import { clamp } from "../../utils/clamp";
import {
  concessionAppeal,
  concessionGoodsCost,
  concessionItemPrice,
  concessionsOnCourse,
  servicePoint,
} from "../models/concessions";
import type { Personality } from "./personality";

/**
 * Live concession behavior (M4, ZKU-118/119).
 *
 * Plan time (seeded rng, deterministic): a round picks up candidate DETOURS —
 * walk to the counter, wait to be served, walk on. Visit time (advanceGolfer):
 * the golfer decides whether to actually BUY using their current mood, so a
 * miserable round means window shopping while a great one loosens the wallet.
 */

// A planned stop at a concession counter, attached to the pause segment.
// The buy roll is salted by the golfer's persistent roll counter (not a
// plan-local index), so a mid-round re-plan can never replay a consumed roll.
export interface ConcessionStopInfo {
  kind: ConcessionType;
  price: number;
  goodsCost: number;
  appeal: number; // building's tier/pricing appeal, folded into the buy roll
}

// One realized transaction, drained by stepLive into cash + itemized rollups.
export interface ConcessionPurchase {
  kind: ConcessionType;
  amount: number;
  goodsCost: number;
}

export interface PlannedStop {
  building: Building;
  point: Point;
  serviceMinutes: number;
  info: ConcessionStopInfo;
}

function toStop(course: Course, b: Building): PlannedStop | null {
  const point = servicePoint(course, b);
  if (!point) return null;
  const kind = b.type as ConcessionType;
  return {
    building: b,
    point,
    serviceMinutes: BALANCE.concessions.buildings[kind].serviceMinutes,
    info: {
      kind,
      price: concessionItemPrice(b),
      goodsCost: concessionGoodsCost(b),
      appeal: concessionAppeal(b),
    },
  };
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function nearestStop(stops: PlannedStop[], from: Point): PlannedStop | null {
  let best: PlannedStop | null = null;
  let bestD = Infinity;
  for (const stop of stops) {
    const d = dist(from, stop.point);
    if (d < bestD) {
      bestD = d;
      best = stop;
    }
  }
  return best;
}

/**
 * Detours to weave into a fresh round, decided at plan time from spend
 * propensity (ZKU-119). Returns stops keyed to where they slot in:
 * pre-round (cart rental, pro shop), between holes (snack bar, with a
 * detour-distance cap so nobody hikes across the map for a hot dog), and
 * post-round (pro shop browse on the way out).
 */
export function planRoundStops(args: {
  course: Course;
  personality: Personality;
  rng: () => number;
  entry: Point;
}): {
  preRound: PlannedStop[];
  snackAfterHole: (green: Point, holesPlayed: number, snackStopsSoFar: number) => PlannedStop | null;
  postRound: PlannedStop | null;
} {
  const { course, personality, rng, entry } = args;
  const R = BALANCE.concessions.routing;
  const eagerness = R.eagernessBase + personality.spendPropensity * R.eagernessSpendScale;

  // Resolve every reachable counter once per plan (service-point lookups
  // rebuild the footprint set, so don't repeat them per hole).
  const stopsByType: Record<ConcessionType, PlannedStop[]> = {
    proshop: [],
    snackbar: [],
    cartrental: [],
  };
  for (const b of concessionsOnCourse(course)) {
    const stop = toStop(course, b);
    if (stop) stopsByType[stop.info.kind].push(stop);
  }

  // Draw every plan-time roll unconditionally so the rng stream the rest of
  // the round consumes (mishits, putts) is invariant to which concessions
  // exist — placing a snack bar must not rewrite every golfer's scores.
  const cartRoll = rng();
  const shopInRoll = rng();
  const postRoll = rng();

  const preRound: PlannedStop[] = [];
  const cart = nearestStop(stopsByType.cartrental, entry);
  if (cart && cartRoll < R.preRoundCartChance * eagerness) preRound.push(cart);
  const shop = nearestStop(stopsByType.proshop, entry);
  if (shop && shopInRoll < R.preRoundProShopChance * eagerness) preRound.push(shop);

  const postRound = shop && postRoll < R.postRoundProShopChance * eagerness ? shop : null;

  const snackAfterHole = (
    green: Point,
    holesPlayed: number,
    snackStopsSoFar: number
  ): PlannedStop | null => {
    const roll = rng(); // drawn before any early-out, same stream invariance
    if (snackStopsSoFar >= R.maxSnackStops) return null;
    const snack = nearestStop(stopsByType.snackbar, green);
    if (!snack) return null;
    // Straight-line cap — an approximation of the routed detour cost.
    if (dist(green, snack.point) > R.detourMaxTiles) return null;
    const hunger = holesPlayed * BALANCE.concessions.purchase.hungerPerHole;
    return roll < (R.snackStopBaseChance * eagerness + hunger) ? snack : null;
  };

  return { preRound, snackAfterHole, postRound };
}

/**
 * The buy roll at the counter (ZKU-118): spend propensity carries most of the
 * weight, current mood and the shop's tier/pricing appeal tilt it, and a
 * price-sensitive golfer reads the premium markup before reaching for cash.
 * The wallet is a hard floor — nobody spends money they don't have.
 */
export function decidePurchase(args: {
  personality: Personality;
  mood: number;
  wallet: number;
  info: { price: number; appeal: number };
  roll: number; // 0..1, from a seeded rng
}): boolean {
  const { personality, mood, wallet, info, roll } = args;
  if (wallet < info.price) return false;
  const P = BALANCE.concessions.purchase;
  const chance =
    P.base +
    personality.spendPropensity * P.spendWeight +
    (mood - 0.5) * P.moodWeight +
    // prefs.price is -1 (price-sensitive) .. +1 (happy to pay); appeal is the
    // building's pricing posture (negative for premium markups). A bargain
    // hunter is extra drawn to budget stands and extra repelled by premium
    // ones, while a price-tolerant golfer largely shrugs the markup off.
    -personality.prefs.price * info.appeal * P.pricePrefWeight +
    info.appeal;
  return roll < clamp(chance, 0.02, 0.95);
}

/** Wallet rolled at spawn: propensity sets the budget, rng adds spread. */
export function rollWallet(personality: Personality, rng: () => number): number {
  const P = BALANCE.concessions.purchase;
  const spread = P.walletSpreadMin + rng() * (P.walletSpreadMax - P.walletSpreadMin);
  return Math.round(P.walletBase + personality.spendPropensity * P.walletSpendScale * spread);
}
