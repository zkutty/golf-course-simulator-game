export const MAX_ACTIVE_RIPPLES = 24;
export const MAX_ACTIVE_IMPACTS = 32;

/** Adds newest feedback while deterministically retiring the oldest overflow. */
export function appendBoundedEffect<T>(
  effects: T[],
  effect: T,
  limit: number,
): void {
  if (!Number.isInteger(limit) || limit <= 0) return;
  const overflow = effects.length - limit + 1;
  if (overflow > 0) effects.splice(0, overflow);
  effects.push(effect);
}
