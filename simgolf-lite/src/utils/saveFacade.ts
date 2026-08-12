/** Lightweight save contract shared by startup, crash recovery, and package checks. */
export const CURRENT_SAVE_SCHEMA_VERSION = 31 as const;
export const LEGACY_SAVE_KEY = "simgolf_lite_save_v1";

export function resetLegacySave(): void {
  localStorage.removeItem(LEGACY_SAVE_KEY);
}

export function hasLegacySave(): boolean {
  return localStorage.getItem(LEGACY_SAVE_KEY) != null;
}
