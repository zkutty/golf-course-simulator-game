/**
 * SimGolf-style emote bubbles (ZKU-155) — pure decision logic, no PIXI.
 *
 * The sim's reaction system is its mood model plus per-hole outcomes; the
 * renderer observes those (read-only render facts on GolferRenderData) and
 * turns edges into thought bubbles. All triggers are EDGE-based (hole-out
 * ticks, mood threshold crossings, hazard touchdowns, spawn) so a state is
 * announced once, not every frame.
 *
 * A tiny scheduler enforces a global concurrency cap and a per-golfer
 * cooldown so busy days don't become bubble soup; the selected golfer's
 * bubbles win eviction fights.
 */

export type EmoteKind =
  | "star" // birdie or better
  | "happy" // par / mood soaring
  | "angry" // bogey
  | "storm" // blow-up hole / mood in the gutter
  | "zzz" // stalled round
  | "cashGood" // bargain green fee
  | "cashBad" // pricey green fee
  | "alert"; // ball found trouble (water/sand)

/** Inspector-feed text for each bubble. */
export const EMOTE_LABEL: Record<EmoteKind, string> = {
  star: "Great hole!",
  happy: "Loving it",
  angry: "Bogey…",
  storm: "Terrible hole!",
  zzz: "Slow round…",
  cashGood: "Great value!",
  cashBad: "Pricey…",
  alert: "Trouble!",
};

export const EMOTE_HOLD_MS = 2500;
export const EMOTE_POP_MS = 180;
export const EMOTE_FADE_MS = 420;
export const EMOTE_TOTAL_MS = EMOTE_POP_MS + EMOTE_HOLD_MS + EMOTE_FADE_MS;
export const EMOTE_MAX_CONCURRENT = 5;
export const EMOTE_COOLDOWN_MS = 6000;
/** Real ms of standing perfectly still before a Zzz grumble. */
export const EMOTE_STALL_MS = 4000;

/** Hole-out bubble from strokes over/under par on the finished hole. */
export function holeOutEmote(delta: number): EmoteKind | null {
  if (delta <= -1) return "star";
  if (delta === 0) return "happy";
  if (delta === 1) return "angry";
  return "storm";
}

/** Mood threshold crossings (with hysteresis so it fires once per swing). */
export function moodEmote(prevMood: number, mood: number): EmoteKind | null {
  if (prevMood >= 0.35 && mood < 0.35) return "storm";
  if (prevMood <= 0.85 && mood > 0.85) return "happy";
  return null;
}

/** Hazard drama when the ball finds sand or water. */
export function hazardEmote(fx: "sand" | "splash" | "grass" | "check" | null): EmoteKind | null {
  return fx === "sand" || fx === "splash" ? "alert" : null;
}

/**
 * Green-fee opinion on walk-in. Only a deterministic third of golfers
 * comment, so a full tee sheet doesn't chant about prices.
 */
export function feeEmote(greenFee: number, golferId: number): EmoteKind | null {
  if (((golferId * 2654435761) >>> 0) % 3 !== 0) return null;
  if (greenFee >= 55) return "cashBad";
  if (greenFee <= 25) return "cashGood";
  return null;
}

export interface ActiveEmote {
  golferId: number;
  kind: EmoteKind;
  t0: number;
}

export interface EmoteScheduler {
  active: ActiveEmote[];
  lastShownByGolfer: Map<number, number>;
}

export function createEmoteScheduler(): EmoteScheduler {
  return { active: [], lastShownByGolfer: new Map() };
}

/** Drop expired bubbles and bubbles of golfers no longer on course. */
export function pruneEmotes(s: EmoteScheduler, nowMs: number, liveIds?: Set<number>): void {
  s.active = s.active.filter(
    (e) => nowMs - e.t0 < EMOTE_TOTAL_MS && (!liveIds || liveIds.has(e.golferId))
  );
}

/**
 * Try to show a bubble. Enforces one bubble per golfer, the per-golfer
 * cooldown, and the global cap (the selected golfer evicts the oldest
 * non-selected bubble when full). Returns true when accepted.
 */
export function tryShowEmote(
  s: EmoteScheduler,
  golferId: number,
  kind: EmoteKind,
  nowMs: number,
  isSelected: boolean
): boolean {
  if (s.active.some((e) => e.golferId === golferId)) return false;
  const last = s.lastShownByGolfer.get(golferId);
  if (last !== undefined && nowMs - last < EMOTE_COOLDOWN_MS) return false;
  if (s.active.length >= EMOTE_MAX_CONCURRENT) {
    if (!isSelected) return false;
    // Evict the oldest bubble that isn't itself the selected golfer's.
    let oldest = -1;
    for (let i = 0; i < s.active.length; i++) {
      if (oldest === -1 || s.active[i].t0 < s.active[oldest].t0) oldest = i;
    }
    if (oldest === -1) return false;
    s.active.splice(oldest, 1);
  }
  s.active.push({ golferId, kind, t0: nowMs });
  s.lastShownByGolfer.set(golferId, nowMs);
  return true;
}

export interface EmotePresentation {
  /** Scale factor for the pop-in ease (overshoots slightly, settles at 1). */
  scale: number;
  /** Overall alpha (fades out at the end). */
  alpha: number;
  /** Upward drift in screen px during the fade-out. */
  rise: number;
  /** True once the bubble is past its lifetime. */
  done: boolean;
}

/** Presentation curve: pop-in ease, hold, fade-up-out. Real-time. */
export function emotePresentation(ageMs: number): EmotePresentation {
  if (ageMs >= EMOTE_TOTAL_MS) return { scale: 1, alpha: 0, rise: 10, done: true };
  if (ageMs < EMOTE_POP_MS) {
    const u = ageMs / EMOTE_POP_MS;
    // Small overshoot for the comic pop.
    const scale = u < 0.7 ? (u / 0.7) * 1.12 : 1.12 - 0.12 * ((u - 0.7) / 0.3);
    return { scale, alpha: Math.min(1, u * 2), rise: 0, done: false };
  }
  const fadeStart = EMOTE_POP_MS + EMOTE_HOLD_MS;
  if (ageMs < fadeStart) return { scale: 1, alpha: 1, rise: 0, done: false };
  const u = (ageMs - fadeStart) / EMOTE_FADE_MS;
  return { scale: 1, alpha: 1 - u, rise: u * 10, done: false };
}

/**
 * Horizontal de-overlap: given bubble anchor screen positions (same order
 * as `s.active`), return per-bubble x offsets so near-coincident bubbles
 * fan out side by side instead of stacking.
 */
export function resolveOverlaps(
  anchors: ReadonlyArray<{ x: number; y: number }>,
  bubbleW = 44
): number[] {
  const offsets = anchors.map(() => 0);
  const placed: Array<{ x: number; y: number; i: number }> = [];
  for (let i = 0; i < anchors.length; i++) {
    let x = anchors[i].x;
    const y = anchors[i].y;
    let moved = true;
    let guard = 0;
    while (moved && guard++ < 8) {
      moved = false;
      for (const p of placed) {
        if (Math.abs(p.y - y) < 30 && Math.abs(p.x - x) < bubbleW) {
          x = p.x + bubbleW; // fan out to the right of the collider
          moved = true;
        }
      }
    }
    offsets[i] = x - anchors[i].x;
    placed.push({ x, y, i });
  }
  return offsets;
}
