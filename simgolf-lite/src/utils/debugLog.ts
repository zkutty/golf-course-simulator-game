/** Development-only diagnostics. Set VITE_DEBUG_LOGS=1 to opt in. */
export const DEBUG_LOGS = import.meta.env.DEV && import.meta.env.VITE_DEBUG_LOGS === "1";

export function debugLog(...args: unknown[]): void {
  if (DEBUG_LOGS) console.log(...args);
}
