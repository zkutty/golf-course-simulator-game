// Stub performance profiler (profiling removed for performance)
export const perfProfiler = {
  measure<T>(name: string, fn: () => T): T {
    return fn();
  },
  logEvent(event: string): void {
    // no-op
  },
  getMetrics() {
    return {};
  },
  reset() {
    // no-op
  },
};
