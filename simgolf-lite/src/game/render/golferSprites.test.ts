import { describe, expect, it } from "vitest";
import {
  GOLFER_ANIM_COLS,
  GOLFER_VARIANTS,
  PUTT_CONTACT_FRAME,
  PUTT_HOLD_FRAME,
  SWING_CONTACT_FRAME,
  SWING_FINISH_FRAME,
  SWING_FOLLOW_FRAME,
  facingOctant,
  golferFrameName,
  golferPose,
  golferTint,
  golferVariant,
  octantRow,
  reactionFor,
} from "./golferSprites";
import type { GolferPoseInput } from "./golferSprites";
import { ISO_ROTATIONS } from "./iso";

const base: GolferPoseInput = {
  segKind: null,
  segT: 0,
  shot: null,
  facingOct: 2,
  walkPhase: 0,
  timeSec: 0,
  reaction: null,
};

describe("facingOctant", () => {
  it("maps world diagonals to screen octants at rotation 0", () => {
    // World +x+y projects straight down the screen (south).
    expect(facingOctant(1, 1, 0)).toBe(2);
    // World +x alone runs to the lower-right (southeast).
    expect(facingOctant(1, 0, 0)).toBe(1);
    // World -x-y runs up the screen (north).
    expect(facingOctant(-1, -1, 0)).toBe(6);
    // World +y alone runs to the lower-left (southwest).
    expect(facingOctant(0, 1, 0)).toBe(3);
  });

  it("remaps under camera rotation", () => {
    // At 90° the world is spun a quarter turn: +x+y now faces east.
    expect(facingOctant(1, 1, 90)).toBe(0);
    expect(facingOctant(1, 1, 180)).toBe(6);
    expect(facingOctant(1, 1, 270)).toBe(4);
  });

  it("covers all octants across a full circle at every rotation", () => {
    for (const rot of ISO_ROTATIONS) {
      const seen = new Set<number>();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        seen.add(facingOctant(Math.cos(a), Math.sin(a), rot));
      }
      expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7].sort());
    }
  });
});

describe("octantRow", () => {
  it("uses authored rows for s..n and mirrors for se/e/ne", () => {
    expect(octantRow(2)).toEqual({ row: 0, mirror: false }); // s
    expect(octantRow(3)).toEqual({ row: 1, mirror: false }); // sw
    expect(octantRow(4)).toEqual({ row: 2, mirror: false }); // w
    expect(octantRow(5)).toEqual({ row: 3, mirror: false }); // nw
    expect(octantRow(6)).toEqual({ row: 4, mirror: false }); // n
    expect(octantRow(1)).toEqual({ row: 1, mirror: true }); // se ← sw
    expect(octantRow(0)).toEqual({ row: 2, mirror: true }); // e ← w
    expect(octantRow(7)).toEqual({ row: 3, mirror: true }); // ne ← nw
  });

  it("normalizes out-of-range octants", () => {
    expect(octantRow(10)).toEqual(octantRow(2));
    expect(octantRow(-1)).toEqual(octantRow(7));
  });
});

describe("golferPose — swing contact sync", () => {
  it("holds address at the start of the pre-shot pause", () => {
    const p = golferPose({ ...base, segKind: "pause", shot: "swing", segT: 0 });
    expect(p).toMatchObject({ anim: "swing", col: 0 });
  });

  it("reaches the contact frame exactly as the pause ends (ball launch)", () => {
    const p = golferPose({ ...base, segKind: "pause", shot: "swing", segT: 1 });
    expect(p).toMatchObject({ anim: "swing", col: SWING_CONTACT_FRAME });
    // ... and never over-runs into the follow-through during the pause.
    for (let t = 0; t <= 1; t += 0.05) {
      const col = golferPose({ ...base, segKind: "pause", shot: "swing", segT: t }).col;
      expect(col).toBeLessThanOrEqual(SWING_CONTACT_FRAME);
    }
  });

  it("shows follow-through then finish during ball flight", () => {
    expect(golferPose({ ...base, segKind: "flight", shot: "swing", segT: 0.1 }).col).toBe(
      SWING_FOLLOW_FRAME
    );
    expect(golferPose({ ...base, segKind: "flight", shot: "swing", segT: 0.8 }).col).toBe(
      SWING_FINISH_FRAME
    );
  });

  it("drives the putt stroke the same way", () => {
    expect(golferPose({ ...base, segKind: "pause", shot: "putt", segT: 0 }).col).toBe(0);
    expect(golferPose({ ...base, segKind: "pause", shot: "putt", segT: 1 }).col).toBe(
      PUTT_CONTACT_FRAME
    );
    expect(golferPose({ ...base, segKind: "flight", shot: "putt", segT: 0.5 })).toMatchObject({
      anim: "putt",
      col: PUTT_HOLD_FRAME,
    });
  });
});

describe("golferPose — locomotion and reactions", () => {
  it("cycles walk frames from the stride phase", () => {
    const cols = [0, 0.4, 0.99].map(
      (phase) => golferPose({ ...base, segKind: "walk", walkPhase: phase }).col
    );
    expect(cols).toEqual([0, 2, 5]);
    // Phase wraps rather than clamping.
    expect(golferPose({ ...base, segKind: "walk", walkPhase: 1.5 }).col).toBe(3);
  });

  it("idles when there is no segment", () => {
    expect(golferPose({ ...base }).anim).toBe("idle");
    expect(golferPose({ ...base, timeSec: 100.1 }).col).toBeLessThan(GOLFER_ANIM_COLS.idle);
  });

  it("a reaction overrides whatever the segment says", () => {
    const p = golferPose({ ...base, segKind: "walk", walkPhase: 0.5, reaction: "cheer" });
    expect(p).toMatchObject({ anim: "cheer", row: 0, mirror: false });
  });

  it("classifies hole results", () => {
    expect(reactionFor(-2)).toBe("cheer");
    expect(reactionFor(-1)).toBe("cheer");
    expect(reactionFor(0)).toBeNull();
    expect(reactionFor(1)).toBe("mad");
    expect(reactionFor(3)).toBe("mad");
  });
});

describe("variants, tints, frame names", () => {
  it("assigns stable variants inside the atlas range", () => {
    for (const arch of ["pro", "lowHandicap", "casual", "senior", "junior", "tourist"] as const) {
      for (let id = 1; id < 12; id++) {
        const v = golferVariant(arch, id);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(GOLFER_VARIANTS);
        expect(golferVariant(arch, id)).toBe(v); // deterministic
      }
    }
  });

  it("varies tint by id but stays anchored to the archetype color", () => {
    const a = golferTint("#38bdf8", 1);
    const b = golferTint("#38bdf8", 2);
    expect(a).not.toBe(b);
    // Blue stays dominant channel for every id.
    for (let id = 1; id < 20; id++) {
      const t = golferTint("#38bdf8", id);
      const blue = t & 0xff;
      const red = (t >> 16) & 0xff;
      expect(blue).toBeGreaterThan(red);
    }
    // Malformed colors fall back to a white-ish tint, never throw.
    expect(golferTint("hotpink", 3)).toBeGreaterThan(0);
  });

  it("builds atlas frame names with the tint twin", () => {
    const pose = { anim: "walk" as const, row: 3, col: 4, mirror: false };
    expect(golferFrameName(1, pose, false)).toBe("golfer1_walk_3_4");
    expect(golferFrameName(1, pose, true)).toBe("golfer1_walk_t_3_4");
  });
});
