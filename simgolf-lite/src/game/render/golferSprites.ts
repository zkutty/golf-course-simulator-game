import type { GolferArchetypeName, SegmentKind } from "../live/types";
import { rotateWorld, type IsoRotation } from "./iso";

/**
 * Golfer character animation state (ZKU-153) — pure math, no PIXI.
 *
 * The golfer atlas (scripts/gen-golfer-sprites.mjs) authors five direction
 * ROWS per animation and the renderer mirrors them for the remaining three
 * screen octants:
 *
 *   row 0..4 = [s, sw, w, nw, n];  se/e/ne = mirror of sw/w/nw
 *
 * walk/idle rows are FACING octants; swing/putt rows are ball TARGET
 * octants (the authored stance already faces 90° off-target, like a real
 * golfer). Every frame has a grayscale clothing twin (`_t` suffix) that the
 * renderer tints with the golfer's color.
 *
 * Clip timing contract: the pause segment before a flight is the
 * address/windup, so swing frames 0..CONTACT are driven by pause progress —
 * the CONTACT frame lands exactly when the sim launches the ball (flight
 * start). Early flight shows the follow-through, then idle/watching.
 */

export const GOLFER_FRAME_W = 48;
export const GOLFER_FRAME_H = 72;
/** Feet line inside the frame (ground anchor pairs with anchor 0.5, this/H). */
export const GOLFER_FEET_Y = 69;
/** On-screen sprite width at zoom 1 (~0.55 tiles — chibi, under tree height). */
export const GOLFER_DISPLAY_W = 26;

export const GOLFER_VARIANTS = 3;

export type GolferAnim = "walk" | "idle" | "swing" | "putt" | "cheer" | "mad";

export const GOLFER_ANIM_COLS: Record<GolferAnim, number> = {
  walk: 6,
  idle: 2,
  swing: 8,
  putt: 4,
  cheer: 4,
  mad: 4,
};

/** Swing frame indices: 0..CONTACT windup (pause-driven), then follow/finish. */
export const SWING_CONTACT_FRAME = 5;
export const SWING_FOLLOW_FRAME = 6;
export const SWING_FINISH_FRAME = 7;
/** Putt frame indices: 0..CONTACT stroke (pause-driven), then hold. */
export const PUTT_CONTACT_FRAME = 2;
export const PUTT_HOLD_FRAME = 3;

/** Walk stride cycles per tile of ground covered. */
export const WALK_STRIDES_PER_TILE = 1.35;
export const IDLE_FPS = 1.6;
export const REACT_FPS = 5;
/** How long a hole-out reaction plays, in real seconds. */
export const REACTION_SEC = 1.6;

export type GolferReaction = "cheer" | "mad";

/**
 * Screen-space octant of a world-space direction under a camera rotation.
 * 0=e, 1=se, 2=s, 3=sw, 4=w, 5=nw, 6=n, 7=ne (screen y grows downward).
 */
export function facingOctant(dirX: number, dirY: number, rotation: IsoRotation): number {
  const r = rotateWorld(dirX, dirY, rotation);
  // 2:1 dimetric projection of the direction vector.
  const sx = r.x - r.y;
  const sy = (r.x + r.y) / 2;
  const angle = Math.atan2(sy, sx); // -PI..PI, 0 = screen east
  return ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
}

/** Atlas row + mirror flag for a screen octant (see module header). */
export function octantRow(oct: number): { row: number; mirror: boolean } {
  const o = ((oct % 8) + 8) % 8;
  if (o >= 2 && o <= 6) return { row: o - 2, mirror: false };
  if (o === 1) return { row: 1, mirror: true }; // se ← sw
  if (o === 0) return { row: 2, mirror: true }; // e  ← w
  return { row: 3, mirror: true }; // ne ← nw
}

/** Which body/outfit variant a golfer wears — stable per identity. */
export function golferVariant(archetype: GolferArchetypeName, id: number): number {
  switch (archetype) {
    case "pro":
      return 0;
    case "lowHandicap":
      return id % 2 === 0 ? 0 : 1;
    case "senior":
      return 2;
    case "junior":
      return 1;
    case "tourist":
      return id % 2 === 0 ? 2 : 1;
    default:
      return id % GOLFER_VARIANTS;
  }
}

/**
 * Per-golfer clothing tint: the archetype color nudged light/dark by a hash
 * of the id, so a crowd of one archetype isn't a row of clones. Returns a
 * 0xRRGGBB number for the Pixi sprite tint.
 */
export function golferTint(color: string, id: number): number {
  let r = 255;
  let g = 255;
  let b = 255;
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (m) {
    const v = parseInt(m[1], 16);
    r = (v >> 16) & 0xff;
    g = (v >> 8) & 0xff;
    b = v & 0xff;
  }
  const h = (id * 2654435761) >>> 0;
  const f = 0.86 + ((h >> 8) % 29) / 100; // 0.86 .. 1.14
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x * f)));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

/** Hole-out reaction for a scored hole's strokes-over-par (null = none). */
export function reactionFor(lastHoleDelta: number): GolferReaction | null {
  if (lastHoleDelta <= -1) return "cheer";
  if (lastHoleDelta >= 1) return "mad";
  return null;
}

export interface GolferPoseInput {
  segKind: SegmentKind | null;
  /** Progress through the current segment, 0..1. */
  segT: number;
  shot: "swing" | "putt" | null;
  /** Screen octant the golfer faces (walk dir / shot target, pre-resolved). */
  facingOct: number;
  /** Accumulated stride phase in cycles (renderer integrates distance). */
  walkPhase: number;
  /** Real time in seconds (idle/reaction cycling). */
  timeSec: number;
  /** Active hole-out reaction, if any (overrides everything else). */
  reaction: GolferReaction | null;
}

export interface GolferPose {
  anim: GolferAnim;
  row: number;
  col: number;
  mirror: boolean;
}

/** Map live-entity state to a concrete atlas frame. One place, unit-tested. */
export function golferPose(input: GolferPoseInput): GolferPose {
  const { segKind, segT, shot, facingOct, walkPhase, timeSec, reaction } = input;

  if (reaction) {
    const col = Math.floor(timeSec * REACT_FPS) % GOLFER_ANIM_COLS[reaction];
    return { anim: reaction, row: 0, col, mirror: false };
  }

  if (shot) {
    // swing/putt rows are keyed by TARGET octant; facingOct carries it here.
    const { row, mirror } = octantRow(facingOct);
    if (segKind === "pause") {
      // Windup driven by pause progress → contact lands at ball launch.
      const contact = shot === "swing" ? SWING_CONTACT_FRAME : PUTT_CONTACT_FRAME;
      const col = Math.min(contact, Math.floor(segT * (contact + 1)));
      return { anim: shot, row, col, mirror };
    }
    if (segKind === "flight") {
      if (shot === "putt") return { anim: "putt", row, col: PUTT_HOLD_FRAME, mirror };
      const col = segT < 0.25 ? SWING_FOLLOW_FRAME : SWING_FINISH_FRAME;
      return { anim: "swing", row, col, mirror };
    }
  }

  if (segKind === "walk") {
    const { row, mirror } = octantRow(facingOct);
    const col = Math.floor(walkPhase * GOLFER_ANIM_COLS.walk) % GOLFER_ANIM_COLS.walk;
    return { anim: "walk", row, col, mirror };
  }

  const { row, mirror } = octantRow(facingOct);
  const col = Math.floor(timeSec * IDLE_FPS) % GOLFER_ANIM_COLS.idle;
  return { anim: "idle", row, col, mirror };
}

/** Atlas frame name for a pose. `tint` selects the grayscale clothing twin. */
export function golferFrameName(
  variant: number,
  pose: GolferPose,
  tint: boolean
): `golfer${number}_${GolferAnim}${"" | "_t"}_${number}_${number}` {
  return `golfer${variant}_${pose.anim}${tint ? "_t" : ""}_${pose.row}_${pose.col}`;
}
