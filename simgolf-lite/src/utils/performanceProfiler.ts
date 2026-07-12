// Stub performance profiler (profiling removed for performance)
export const perfProfiler = {
  measure<T>(_name: string, fn: () => T): T {
    return fn();
  },
  logEvent(_event: string): void {
    // no-op
  },
  getMetrics() {
    return {};
  },
  reset() {
    // no-op
  },
};
