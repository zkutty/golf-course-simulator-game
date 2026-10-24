import { PIN_ROTATIONS, TEE_SETS } from "../models/types";

/** Successful scalar summaries only; eviction never mutates published aliases. */
export const OPTIONAL_SETUP_HISTORY_LIMIT = 16;
const prefixes = TEE_SETS.flatMap(tee => PIN_ROTATIONS.map(pin => `${tee}:${pin}:`));
const reserved = new Set(prefixes.flatMap(prefix => [prefix, `${prefix}legacy`]));

export class RecentSetupRatings<Value extends object> {
  private readonly values = new Map<string, Value>();
  // Fixed nine typed pairs plus one overflow bucket for existing runtime keys.
  private readonly recent = Array.from({ length: prefixes.length + 1 }, () => [] as string[]);
  get size(): number { return this.values.size; }

  get(key: string): Value | undefined {
    const value = this.values.get(key);
    if (value !== undefined) this.promote(key);
    return value;
  }

  set(key: string, value: Value): this {
    // Required computation has completed before this successful publication.
    this.values.set(key, value);
    this.promote(key);
    return this;
  }

  private promote(key: string): void {
    if (reserved.has(key)) return;
    // Classify the existing full key, preserving delimiter/collision behavior.
    const matched = prefixes.findIndex(prefix => key.startsWith(prefix));
    const keys = this.recent[matched < 0 ? prefixes.length : matched];
    const prior = keys.indexOf(key);
    if (prior >= 0) keys.splice(prior, 1);
    keys.push(key);
    if (keys.length > OPTIONAL_SETUP_HISTORY_LIMIT) {
      const retired = keys.shift();
      if (retired !== undefined) this.values.delete(retired);
    }
  }
}
