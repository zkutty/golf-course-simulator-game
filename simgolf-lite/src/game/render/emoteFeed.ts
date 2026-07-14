import { EMOTE_LABEL, type EmoteKind } from "./emotes";

/**
 * Recent-thoughts feed (ZKU-155): a tiny render-side ring buffer of the
 * bubbles each golfer showed, so the golfer inspector can mirror them as a
 * "recent thoughts" strip. Data-only module (no PIXI) — safe to import
 * from React UI. The renderer writes; the inspector reads.
 */

export interface EmoteFeedEntry {
  kind: EmoteKind;
  label: string;
  atMs: number;
}

const MAX_PER_GOLFER = 4;
const feed = new Map<number, EmoteFeedEntry[]>();

export function recordEmote(golferId: number, kind: EmoteKind, atMs: number): void {
  let list = feed.get(golferId);
  if (!list) {
    list = [];
    feed.set(golferId, list);
  }
  list.push({ kind, label: EMOTE_LABEL[kind], atMs });
  if (list.length > MAX_PER_GOLFER) list.shift();
}

export function recentEmotes(golferId: number): ReadonlyArray<EmoteFeedEntry> {
  return feed.get(golferId) ?? [];
}

/** Drop feeds for golfers who left the course (renderer calls on retire). */
export function forgetGolfer(golferId: number): void {
  feed.delete(golferId);
}

/** Test hook. */
export function __resetEmoteFeedForTests(): void {
  feed.clear();
}
