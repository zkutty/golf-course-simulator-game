import { BALANCE } from "../balance/balanceConfig";

// Single source of truth for the fail state (ZKU-163, absorbing the ZKU-77
// direction). Every place that can bankrupt the player — reducer spending,
// weekly tick, live day commits — must decide through these helpers instead
// of hand-rolled comparisons.

/** Immediate bankruptcy: cash fell through the liquidity floor. */
export function hitsLiquidityTrap(cash: number): boolean {
  return cash < BALANCE.distress.liquidityTrapCash;
}

/** Slow bankruptcy: consecutive distress weeks ran out. */
export function distressExhausted(distressWeeks: number): boolean {
  return distressWeeks >= BALANCE.distress.weeksToBankrupt;
}
