interface ScoringDependencies {
  tileDependencies: ReadonlyMap<number, unknown>;
  elevationDependencies: ReadonlyMap<number, unknown>;
}

export function scoringDependencyWeight(entries: ReadonlyMap<unknown, ScoringDependencies> | undefined): number {
  return [...(entries?.values() ?? [])].reduce((sum, entry) => sum + entry.tileDependencies.size + entry.elevationDependencies.size, 0);
}

/** Drop oldest payloads until both independent retention budgets hold. */
export function trimScoringDependencyCache<K, V extends ScoringDependencies>(entries: Map<K, V>, maxEntries: number, maxDependencies: number): void {
  while (entries.size > maxEntries || scoringDependencyWeight(entries) > maxDependencies) {
    entries.delete(entries.keys().next().value!);
  }
}
