/**
 * Debounce utility for performance optimization
 */

export function debounce<T extends (...args: any[]) => void>(
  func: T,
  waitMs: number
): T & { cancel: () => void; flush: () => void } {
  let timeoutId: number | null = null;
  let lastArgs: Parameters<T> | null = null;
  
  const debounced = ((...args: Parameters<T>) => {
    lastArgs = args;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = window.setTimeout(() => {
      func(...args);
      timeoutId = null;
      lastArgs = null;
    }, waitMs);
  }) as T & { cancel: () => void; flush: () => void };
  
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


