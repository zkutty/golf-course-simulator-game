/**
 * Return the final item without relying on Array.prototype.at.
 *
 * ZK-533 / COURSECRAFT-4: supported browsers may not provide Array.at.
 */
export function lastItem<T>(items: readonly T[] | null | undefined): T | undefined {
  if (!items || items.length === 0) return undefined;
  return items[items.length - 1];
}

/**
 * Shuffle in place with a caller-owned random source.
 *
 * Fisher-Yates consumes exactly `items.length - 1` random values, so seeded
 * callers get the same permutation across JavaScript runtime versions.
 */
export function shuffleInPlace<T>(items: T[], rng: { next(): number }): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}
