/**
 * Debounce utility for performance optimization
 */

export function debounce<Args extends unknown[]>(
  func: (...args: Args) => void,
  waitMs: number
): ((...args: Args) => void) & { cancel: () => void; flush: () => void } {
  let timeoutId: number | null = null;
  let lastArgs: Args | null = null;

  const debounced = (...args: Args) => {
    lastArgs = args;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = window.setTimeout(() => {
      func(...args);
      timeoutId = null;
      lastArgs = null;
    }, waitMs);
  };

  debounced.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
      lastArgs = null;
    }
  };

  debounced.flush = () => {
    if (timeoutId !== null && lastArgs !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
      func(...lastArgs);
      lastArgs = null;
    }
  };

  return debounced;
}
