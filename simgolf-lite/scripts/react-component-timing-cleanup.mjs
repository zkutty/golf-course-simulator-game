/**
 * React's development component timings accumulate in the User Timing buffer.
 * Remove only names proven to contain exclusively that instrumentation. Other
 * timings (including React scheduler tracks) remain part of the measurement.
 * Self-contained so Playwright can execute this function in the page realm.
 */
export function clearReactComponentTimings(timing = globalThis.performance) {
  const entries = timing.getEntriesByType("measure");
  const isComponent = (entry) => entry.detail?.devtools?.track === "Components ⚛";
  const names = new Set(entries.filter(isComponent).map((entry) => entry.name));
  let clearedEntries = 0;
  let clearedNames = 0;
  let preservedCollisionNames = 0;
  for (const name of names) {
    const sameName = entries.filter((entry) => entry.name === name);
    if (!sameName.every(isComponent)) {
      preservedCollisionNames += 1;
      continue;
    }
    timing.clearMeasures(name);
    clearedEntries += sameName.length;
    clearedNames += 1;
  }
  return {
    measureEntriesBefore: entries.length,
    reactComponentEntriesBefore: entries.filter(isComponent).length,
    clearedEntries,
    clearedNames,
    preservedCollisionNames,
    measureEntriesAfter: timing.getEntriesByType("measure").length,
  };
}
