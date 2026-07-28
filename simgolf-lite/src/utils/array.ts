/**
 * Return the final item without relying on Array.prototype.at.
 *
 * ZK-533 / COURSECRAFT-4: supported browsers may not provide Array.at.
 */
export function lastItem<T>(items: readonly T[] | null | undefined): T | undefined {
  if (!items || items.length === 0) return undefined;
  return items[items.length - 1];
}
