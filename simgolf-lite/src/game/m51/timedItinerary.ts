import type { ConcessionType, Course, Point } from "../models/types";
import { planPurchase } from "../live/concessions";
import { LIVE } from "../live/liveConfig";
import type { Personality } from "../live/personality";
import type { Segment } from "../live/types";
import type { MobilityMode } from "./types";

/**
 * The one timing authority for live and M47 itineraries.  Wave 1 deliberately
 * emits the legacy walking segments for every mode: a future mobility adapter
 * may change travel semantics here, but must not create a second itinerary,
 * route cache, wallet, or concession flow.
 */
export type TimedItineraryRouter = (from: Point, to: Point) => Point[] | null;

export interface TimedItineraryOptions {
  course: Course;
  cursor: Point;
  personality: Personality;
  rng: () => number;
  wallet?: number;
  route?: TimedItineraryRouter;
  /** Reserved M51 extension point. All modes use legacy walking in Wave 1. */
  mode?: MobilityMode;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class TimedItineraryBuilder {
  readonly segments: Segment[] = [];
  readonly mode: MobilityMode;
  private currentCursor: Point;
  private planningWallet: number;
  private readonly options: TimedItineraryOptions;

  constructor(options: TimedItineraryOptions) {
    this.options = options;
    this.currentCursor = options.cursor;
    this.planningWallet = options.wallet ?? 0;
    this.mode = options.mode ?? "walk";
  }

  get cursor(): Point {
    return this.currentCursor;
  }

  set cursor(value: Point) {
    this.currentCursor = value;
  }

  get wallet(): number {
    return this.planningWallet;
  }

  /**
   * Preserve the legacy router contract exactly: waypoints become individual
   * uncapped walking segments; a missing/empty route becomes one capped
   * straight-line walk. The selected M51 mode is intentionally not weighted.
   */
  appendWalk(from: Point, to: Point, holeIndex: number, cap = Infinity): void {
    const path = this.options.route?.(from, to);
    if (path?.length) {
      let current = from;
      for (const point of path) {
        this.segments.push(this.walkSegment(current, point, holeIndex));
        current = point;
      }
      return;
    }
    this.segments.push(this.walkSegment(from, to, holeIndex, cap));
  }

  appendFlight(
    from: Point,
    to: Point,
    holeIndex: number,
    shot: "swing" | "putt" = "swing",
    trajectory?: { landing: Point; rollPath: readonly Point[] },
  ): void {
    const duration = Math.max(LIVE.pace.flightMin, Math.min(LIVE.pace.flightMax, distance(from, to) * LIVE.pace.flightPerTile));
    this.segments.push({
      kind: "flight",
      from,
      to,
      holeIndex,
      dur: duration,
      shot,
      ...(trajectory ? {
        landing: { ...trajectory.landing },
        rollPath: trajectory.rollPath.map((point) => ({ ...point })),
        rolloutStartT: shot === "putt" ? 0 : 0.72,
      } : {}),
    });
  }

  appendPause(at: Point, holeIndex: number, duration: number, concession?: Segment["concession"]): void {
    this.segments.push({ kind: "pause", from: at, to: at, holeIndex, dur: duration, concession });
  }

  /**
   * Planning reserves wallet once and only appends the existing concession
   * pause. Actual cash/transactions remain owned by `stepLive` when that
   * segment is crossed, so a replan cannot create a second charge.
   */
  visitConcession(type: ConcessionType, holeIndex: number): boolean {
    const purchase = planPurchase({
      course: this.options.course,
      type,
      from: this.currentCursor,
      personality: this.options.personality,
      satisfaction: .7,
      wallet: this.planningWallet,
      rng: this.options.rng,
    });
    if (!purchase) return false;
    this.appendWalk(this.currentCursor, purchase.entrance, holeIndex, LIVE.pace.interHoleWalkCap);
    this.appendPause(purchase.entrance, holeIndex, purchase.serviceMinutes, {
      buildingType: purchase.building.type,
      buildingX: purchase.building.x,
      buildingY: purchase.building.y,
      item: purchase.item,
      amount: purchase.amount,
    });
    this.currentCursor = purchase.entrance;
    this.planningWallet -= purchase.amount;
    return true;
  }

  private walkSegment(from: Point, to: Point, holeIndex: number, cap = Infinity): Segment {
    return { kind: "walk", from, to, holeIndex, dur: Math.min(cap, distance(from, to) * LIVE.pace.walkPerTile) };
  }
}
