import { describe, expect, it } from "vitest";
import {
  EMOTE_COOLDOWN_MS,
  EMOTE_MAX_CONCURRENT,
  EMOTE_TOTAL_MS,
  createEmoteScheduler,
  emotePresentation,
  feeEmote,
  hazardEmote,
  holeOutEmote,
  moodEmote,
  pruneEmotes,
  resolveOverlaps,
  tryShowEmote,
} from "./emotes";

describe("emote triggers", () => {
  it("maps hole results to bubbles", () => {
    expect(holeOutEmote(-2)).toBe("star");
    expect(holeOutEmote(-1)).toBe("star");
    expect(holeOutEmote(0)).toBe("happy");
    expect(holeOutEmote(1)).toBe("angry");
    expect(holeOutEmote(3)).toBe("storm");
  });

  it("fires mood bubbles only on threshold crossings", () => {
    expect(moodEmote(0.4, 0.3)).toBe("storm");
    expect(moodEmote(0.3, 0.3)).toBeNull(); // already below — no re-fire
    expect(moodEmote(0.8, 0.9)).toBe("happy");
    expect(moodEmote(0.9, 0.95)).toBeNull();
    expect(moodEmote(0.5, 0.6)).toBeNull();
  });

  it("raises the alarm on hazard touchdowns only", () => {
    expect(hazardEmote("sand")).toBe("alert");
    expect(hazardEmote("splash")).toBe("alert");
    expect(hazardEmote("grass")).toBeNull();
    expect(hazardEmote("check")).toBeNull();
    expect(hazardEmote(null)).toBeNull();
  });

  it("has fee opinions from a deterministic minority", () => {
    const cheapKinds = new Set<string | null>();
    let commenters = 0;
    for (let id = 1; id <= 30; id++) {
      const e = feeEmote(60, id);
      if (e) {
        commenters++;
        cheapKinds.add(e);
      }
      expect(feeEmote(60, id)).toBe(e); // deterministic
    }
    expect(commenters).toBeGreaterThan(0);
    expect(commenters).toBeLessThan(30);
    expect([...cheapKinds]).toEqual(["cashBad"]);
    // Mid-priced fees draw no comment at all.
    for (let id = 1; id <= 30; id++) expect(feeEmote(40, id)).toBeNull();
  });
});

describe("emote scheduler", () => {
  it("caps concurrent bubbles and rejects overflow from unselected golfers", () => {
    const s = createEmoteScheduler();
    for (let id = 1; id <= EMOTE_MAX_CONCURRENT; id++) {
      expect(tryShowEmote(s, id, "happy", 1000 + id, false)).toBe(true);
    }
    expect(tryShowEmote(s, 99, "storm", 2000, false)).toBe(false);
    expect(s.active.length).toBe(EMOTE_MAX_CONCURRENT);
  });

  it("lets the selected golfer evict the oldest bubble when full", () => {
    const s = createEmoteScheduler();
    for (let id = 1; id <= EMOTE_MAX_CONCURRENT; id++) {
      tryShowEmote(s, id, "happy", 1000 + id, false);
    }
    expect(tryShowEmote(s, 99, "star", 2000, true)).toBe(true);
    expect(s.active.length).toBe(EMOTE_MAX_CONCURRENT);
    expect(s.active.some((e) => e.golferId === 99)).toBe(true);
    expect(s.active.some((e) => e.golferId === 1)).toBe(false); // oldest evicted
  });

  it("enforces per-golfer cooldown and one bubble per golfer", () => {
    const s = createEmoteScheduler();
    expect(tryShowEmote(s, 7, "happy", 1000, false)).toBe(true);
    expect(tryShowEmote(s, 7, "storm", 1200, false)).toBe(false); // already showing
    pruneEmotes(s, 1000 + EMOTE_TOTAL_MS + 1);
    expect(s.active.length).toBe(0);
    expect(tryShowEmote(s, 7, "storm", 1000 + EMOTE_TOTAL_MS + 1, false)).toBe(false); // cooling down
    expect(tryShowEmote(s, 7, "storm", 1000 + EMOTE_COOLDOWN_MS + 1, false)).toBe(true);
  });

  it("prunes bubbles of golfers who left", () => {
    const s = createEmoteScheduler();
    tryShowEmote(s, 1, "happy", 1000, false);
    tryShowEmote(s, 2, "storm", 1000, false);
    pruneEmotes(s, 1001, new Set([2]));
    expect(s.active.map((e) => e.golferId)).toEqual([2]);
  });
});

describe("presentation & overlap", () => {
  it("pops in, holds, then fades up and out", () => {
    const pop = emotePresentation(60);
    expect(pop.scale).toBeGreaterThan(0);
    expect(pop.scale).toBeLessThanOrEqual(1.12);
    const hold = emotePresentation(1000);
    expect(hold).toMatchObject({ scale: 1, alpha: 1, rise: 0 });
    const fade = emotePresentation(EMOTE_TOTAL_MS - 100);
    expect(fade.alpha).toBeLessThan(1);
    expect(fade.rise).toBeGreaterThan(0);
    expect(emotePresentation(EMOTE_TOTAL_MS + 1).done).toBe(true);
  });

  it("fans out overlapping bubbles horizontally", () => {
    const offsets = resolveOverlaps([
      { x: 100, y: 100 },
      { x: 110, y: 105 }, // collides with first
      { x: 400, y: 100 }, // far away
    ]);
    expect(offsets[0]).toBe(0);
    expect(offsets[1]).toBeGreaterThanOrEqual(34); // pushed clear
    expect(offsets[2]).toBe(0);
    // The two resolved bubbles no longer overlap.
    expect(Math.abs(110 + offsets[1] - 100)).toBeGreaterThanOrEqual(44);
  });
});
