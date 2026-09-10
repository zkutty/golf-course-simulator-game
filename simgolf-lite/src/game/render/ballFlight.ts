import type { Terrain } from "../models/types";
import { BALANCE } from "../balance/balanceConfig";
import type { ShotTruthProjection } from "../rules/shotTruth";
import type { Point } from "../models/types";

/**
 * Contract for future renderer adapters: sample recorded ground geometry only.
 * Relief is never animated as ball roll. Null means the legacy receipt does
 * not contain a physical path; consumers must label its markers schematic.
 * Existing ballFlightPose remains the legacy cosmetic compatibility export.
 */
export function committedShotGroundPosition(truth: ShotTruthProjection, progress: number): Point | null {
  if (!truth.physicalRest || !Number.isFinite(progress)) return null;
  const t = Math.max(0, Math.min(1, progress));
  if (t === 0) return { ...truth.from };
  if (t === 1) return { ...truth.physicalRest };
  const airFraction = truth.club === "Putter" ? 0 : AIR_FRAC;
  const lerp = (a: Readonly<Point>, b: Readonly<Point>, u: number): Point => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
  if (t < airFraction) return lerp(truth.from, truth.landing, t / airFraction);
  if (truth.rollPath.length === 0) return null;
  const u = (t - airFraction) / (1 - airFraction);
  const path = airFraction === 0 ? [truth.from, ...truth.rollPath] : truth.rollPath;
  const lengths = path.slice(1).map((p, i) => Math.hypot(p.x - path[i].x, p.y - path[i].y));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) * u;
  for (let i = 0; i < lengths.length; i++) {
    if (lengths[i] > 0 && remaining <= lengths[i]) return lerp(path[i], path[i + 1], remaining / lengths[i]);
    remaining -= lengths[i];
  }
  return { ...truth.physicalRest };
}

/**
 * Ball flight 2.0 (ZKU-154) — pure math, no PIXI.
 *
 * The sim's "flight" segment moves the ball linearly from -> to over its
 * duration; the render layer replaces that straight track with a richer
 * profile driven ENTIRELY by segment progress t (so 2x/4x game speeds
 * compress it naturally and it stays deterministic per frame):
 *
 *   t in [0, AIR_FRAC):   airborne — ground track runs from -> L (the
 *                          touchdown point short of the rest position),
 *                          height follows a parabola whose apex scales
 *                          with shot distance.
 *   t in [AIR_FRAC, 1]:   ground phase — touchdown L -> rest `to` with
 *                          surface-specific decaying bounces and roll.
 *
 * Both phases converge exactly on the sim's rest point at t=1, so the
 * golfer always walks to where the ball actually is. Putts skip the air
 * phase entirely (pure ground roll).
 */

/** Fraction of the flight segment spent airborne (rest is bounce/roll). */
export const AIR_FRAC = 0.72;

/**
 * The deliberately small preview receipt consumed by the opening renderer.
 * `flight` and `rollPath` are optional so v1 receipts remain byte-compatible:
 * absent data uses the documented standard arc / endpoint-only fallback, never
 * a new shot solve. A penalized receipt may name a next lie after relief; that
 * position is deliberately excluded from the moving ball path.
 */
export interface RetainedPreviewShot {
  readonly club: string;
  readonly from: Readonly<Point>;
  readonly landing: Readonly<Point>;
  readonly rest: Readonly<Point>;
  readonly penaltyStrokes: number;
  readonly flight?: Readonly<{
    profile?: "low" | "standard" | "high";
    apexHeightYards?: number;
  }>;
  readonly rollPath?: readonly Readonly<Point>[];
}

export interface RetainedPreviewPose {
  readonly ball: Point;
  readonly phase: "launch" | "airborne" | "touchdown" | "rollout" | "rest" | "relief";
  /** Pixel lift is visual-only and has no impact on the retained ground path. */
  readonly heightPx: number;
  readonly landed: boolean;
  /** A relief location is a static next-lie marker, never a ball destination. */
  readonly hasReliefMarker: boolean;
  /** Makes the old-save default auditable without changing saved receipt bytes. */
  readonly profileSource: "retained" | "legacy-standard";
  readonly profile: "low" | "standard" | "high";
}

const previewMix = (from: Readonly<Point>, to: Readonly<Point>, t: number): Point => ({
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t,
});

function previewRollPosition(shot: RetainedPreviewShot, t: number): Point {
  const path = shot.rollPath && shot.rollPath.length > 0
    ? [shot.landing, ...shot.rollPath]
    : [shot.landing, shot.rest];
  if (path.length < 2) return { ...shot.landing };
  const lengths = path.slice(1).map((point, index) => Math.hypot(point.x - path[index].x, point.y - path[index].y));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) * t;
  for (let index = 0; index < lengths.length; index++) {
    if (lengths[index] > 0 && remaining <= lengths[index]) return previewMix(path[index], path[index + 1], remaining / lengths[index]);
    remaining -= lengths[index];
  }
  return { ...path[path.length - 1] };
}

/**
 * Pure selected-preview adapter. It samples only retained endpoints/path and
 * optional authoritative flight metadata. Legacy v1 receipts get a stable
 * standard arc; a penalty freezes the ball at its actual touchdown while the
 * downstream relief position remains a distinct static marker.
 */
export function retainedPreviewShotPose(shot: RetainedPreviewShot, progress: number): RetainedPreviewPose {
  const t = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const retainedProfile = shot.flight?.profile;
  const profile = retainedProfile ?? "standard";
  const profileSource = retainedProfile ? "retained" as const : "legacy-standard" as const;
  const putt = shot.club === "Putter";
  const airFraction = putt ? 0 : AIR_FRAC;
  const penalized = shot.penaltyStrokes > 0;
  if (t === 0) return { ball: { ...shot.from }, phase: "launch", heightPx: 0, landed: putt, hasReliefMarker: penalized, profileSource, profile };
  if (!putt && t < airFraction) {
    const u = t / airFraction;
    const distance = Math.hypot(shot.landing.x - shot.from.x, shot.landing.y - shot.from.y);
    const fallbackApex = Math.min(20, 5 + distance * 1.15);
    const profileScale = profile === "low" ? .62 : profile === "high" ? 1.38 : 1;
    const apex = shot.flight?.apexHeightYards != null && Number.isFinite(shot.flight.apexHeightYards)
      ? Math.max(2, Math.min(28, shot.flight.apexHeightYards * 1.6))
      : fallbackApex * profileScale;
    return {
      ball: previewMix(shot.from, shot.landing, u),
      phase: "airborne",
      heightPx: 4 * apex * u * (1 - u),
      landed: false,
      hasReliefMarker: penalized,
      profileSource,
      profile,
    };
  }
  if (penalized) {
    return { ball: { ...shot.landing }, phase: "relief", heightPx: 0, landed: true, hasReliefMarker: true, profileSource, profile };
  }
  const groundT = airFraction === 0 ? t : (t - airFraction) / (1 - airFraction);
  const clampedGroundT = Math.max(0, Math.min(1, groundT));
  return {
    ball: previewRollPosition(shot, clampedGroundT),
    phase: clampedGroundT >= 1 ? "rest" : clampedGroundT <= 0 ? "touchdown" : "rollout",
    heightPx: 0,
    landed: true,
    hasReliefMarker: false,
    profileSource,
    profile,
  };
}

export interface LandingBehavior {
  /** How far short of the rest point the ball first touches down, in tiles. */
  rollTiles: number;
  /** Decaying post-touchdown hops (0 = plug/splash dead stop). */
  bounces: number;
  /** First-bounce height as a fraction of the flight apex. */
  bounceScale: number;
  /** Particle burst spawned at touchdown. */
  fx: "sand" | "splash" | "grass" | "check" | null;
  /** Ball vanishes at touchdown (water). */
  sinks: boolean;
}

/** Landing behavior per surface (terrain under the REST point). */
export function landingBehavior(terrain: Terrain | null): LandingBehavior {
  switch (terrain) {
    case "fairway":
    case "tee":
    case "path":
      return { rollTiles: 1.6, bounces: 2, bounceScale: 0.22, fx: "grass", sinks: false };
    case "green":
      return { rollTiles: 0.5, bounces: 1, bounceScale: 0.12, fx: "check", sinks: false };
    case "sand":
      return { rollTiles: 0.12, bounces: 0, bounceScale: 0, fx: "sand", sinks: false };
    case "waste_area":
      return { rollTiles: BALANCE.terrain.rolloutTiles.waste_area, bounces: 1, bounceScale: 0.08, fx: "sand", sinks: false };
    case "water":
    case "wetland":
      return { rollTiles: 0, bounces: 0, bounceScale: 0, fx: "splash", sinks: true };
    case "rough":
    case "deep_rough":
      return { rollTiles: 0.35, bounces: 1, bounceScale: 0.1, fx: "grass", sinks: false };
    default:
      return { rollTiles: 0.5, bounces: 1, bounceScale: 0.15, fx: null, sinks: false };
  }
}

/** Apex height in iso-plane px for a shot of `distTiles` ground distance. */
export function apexHeightPx(distTiles: number, shot: "swing" | "putt"): number {
  if (shot === "putt") return 0;
  return Math.min(64, 10 + distTiles * 3.4);
}

export interface BallFlightPose {
  /** Ground-track position as a fraction of the from->to line, 0..1. */
  groundFrac: number;
  /** Height above the ground reference, iso-plane px (>= 0). */
  heightPx: number;
  /** Shadow strength 0..1 (1 = on the ground) — scale/alpha the ellipse. */
  shadow: number;
  /** True the moment the profile enters the ground phase (touchdown). */
  landed: boolean;
  /** Ball hidden (sunk in water after touchdown). */
  hidden: boolean;
}

/**
 * Flight profile at segment progress `t` (0..1) for a shot of
 * `distTiles` ground length onto `behavior`'s surface.
 */
export function ballFlightPose(
  t: number,
  distTiles: number,
  shot: "swing" | "putt",
  behavior: LandingBehavior
): BallFlightPose {
  const tt = Math.max(0, Math.min(1, t));
  if (shot === "putt" || distTiles < 1e-6) {
    // Pure roll: ground track eases out (fast off the putter, slowing).
    const frac = 1 - (1 - tt) * (1 - tt);
    return { groundFrac: frac, heightPx: 0, shadow: 1, landed: tt > 0, hidden: false };
  }

  const apex = apexHeightPx(distTiles, shot);
  // Touchdown point short of the rest position (never behind the origin).
  const landFrac = Math.max(0.2, 1 - behavior.rollTiles / Math.max(distTiles, 1e-6));

  if (tt < AIR_FRAC) {
    const u = tt / AIR_FRAC; // 0..1 through the air
    const height = 4 * apex * u * (1 - u);
    return {
      groundFrac: u * landFrac,
      heightPx: height,
      shadow: Math.max(0.25, 1 - height / (apex + 1e-6) * 0.8),
      landed: false,
      hidden: false,
    };
  }

  // Ground phase: touchdown -> rest with decaying hops.
  const u = (tt - AIR_FRAC) / (1 - AIR_FRAC); // 0..1 through the ground phase
  if (behavior.sinks) {
    return { groundFrac: landFrac, heightPx: 0, shadow: 0, landed: true, hidden: u > 0.1 };
  }
  const frac = landFrac + (1 - landFrac) * (1 - (1 - u) * (1 - u)); // ease-out roll
  let height = 0;
  if (behavior.bounces > 0) {
    // Decaying |sin| hops across the ground phase; n bounces fit in u<0.7.
    const hopPhase = u * behavior.bounces;
    const hopIdx = Math.floor(hopPhase);
    if (hopIdx < behavior.bounces) {
      const hu = hopPhase - hopIdx;
      const decay = Math.pow(0.42, hopIdx);
      const apexPx = apexHeightPx(distTiles, shot) * behavior.bounceScale * decay;
      height = 4 * apexPx * hu * (1 - hu);
    }
  }
  return {
    groundFrac: frac,
    heightPx: height,
    shadow: height > 0.5 ? 0.75 : 1,
    landed: true,
    hidden: false,
  };
}
