import type { Course, PinRotation, Point, TeeSet } from "../models/types";
import { scoreCourseHoles } from "../sim/holes";
import { courseForRoundSetup } from "../models/courseSetup";
import { LIVE } from "./liveConfig";
import type { BuiltRound, WalkRouter } from "./golfer";
import { M47_MAX_OUTCOMES, type GolferCapabilities } from "./m47Types";
import { generateStrategicHolePlan, followUpIntent } from "./strategicOptions";
import { liveCourseSnapshot, resolveLiveShot, terrainAt } from "./livePhysics";
import { evaluateHoleReaction } from "./reactions";
import type { Personality } from "./personality";
import type { ControlledRoundSnapshotV2 } from "../rules/roundSnapshot";
import { TimedItineraryBuilder } from "../m51/timedItinerary";

function distance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.y - b.y); }

export function buildStrategicGolferRound(args: {
  course: Course;
  entry: Point;
  exit?: Point;
  rng: () => number;
  personality: Personality;
  capabilities: GolferCapabilities;
  wallet?: number;
  route?: WalkRouter;
  teeSet?: TeeSet;
  pinRotation?: PinRotation;
  rulesSnapshot?: ControlledRoundSnapshotV2;
  startHole?: number;
  skipPreRoundPurchases?: boolean;
}): BuiltRound {
  const teeSet = args.teeSet ?? "member";
  const pinRotation = args.pinRotation ?? args.course.activePinRotation ?? "A";
  const course = courseForRoundSetup(args.course, teeSet, pinRotation);
  const snapshot = liveCourseSnapshot({ course, teeSet, pinRotation, rulesSnapshot: args.rulesSnapshot });
  const summary = scoreCourseHoles(course);
  const itinerary = new TimedItineraryBuilder({ course, cursor: { ...args.entry }, personality: args.personality, rng: args.rng, route: args.route, wallet: args.wallet });
  const holePar: number[] = [];
  const holeStrokes: number[] = [];
  const holePlans: NonNullable<BuiltRound["holePlans"]> = [];
  const shotOutcomes: NonNullable<BuiltRound["shotOutcomes"]> = [];
  const holeReactions: NonNullable<BuiltRound["holeReactions"]> = [];
  let cursor = itinerary.cursor;

  const pushWalk = (from: Point, to: Point, holeIndex: number, cap = Infinity) => {
    itinerary.appendWalk(from, to, holeIndex, cap);
  };

  const pushPurchase = (type: "pro_shop" | "snack_bar" | "cart_rental", holeIndex: number) => {
    itinerary.visitConcession(type, holeIndex);
    cursor = itinerary.cursor;
  };

  if (!args.skipPreRoundPurchases) {
    pushPurchase("pro_shop", -1);
  }
  const firstHole = Math.max(0, args.startHole ?? 0);
  const validHoleCount = summary.holes.slice(firstHole).filter((hole) => hole.isComplete && hole.isValid).length;
  let played = 0;

  for (let holeIndex = firstHole; holeIndex < course.holes.length; holeIndex++) {
    const hole = course.holes[holeIndex];
    const info = summary.holes[holeIndex];
    if (!hole.tee || !hole.green || !info?.isComplete || !info.isValid) continue;
    const holeId = hole.id ?? `hole-${holeIndex + 1}`;
    const par = info.par ?? 4;
    pushWalk(cursor, hole.tee, holeIndex);
    const plan = generateStrategicHolePlan({ course, hole, par, capabilities: args.capabilities, personality: args.personality, snapshot });
    holePlans.push(plan);

    let from = { ...hole.tee };
    let lie: string = terrainAt(course, from);
    const outcomes: NonNullable<BuiltRound["shotOutcomes"]> = [];
    let shotNumber = 0;
    let holed = false;
    while (!holed && shotNumber < Math.max(4, par + 5)) {
      const intent = shotNumber === 0
        ? plan.chosen
        : followUpIntent({
            course,
            hole: { ...hole, tee: from },
            from,
            lie,
            capabilities: args.capabilities,
            personality: args.personality,
            shotNumber,
            snapshot,
            obstacleRecoveryContext: outcomes[shotNumber - 1]?.sharedOutcome?.collision.kind === "obstacle",
          });
      const outcome = resolveLiveShot({
        snapshot,
        capabilities: args.capabilities,
        holeId,
        shotNumber: shotNumber + 1,
        from,
        lie,
        intent,
        seed: (args.rng() * 0xffffffff) >>> 0,
      });
      outcomes.push(outcome);
      // Long 36-hole rounds can legitimately produce more physical attempts
      // than a save should retain. Keep the most recent bounded evidence while
      // preserving the current hole's complete local outcome list for scoring
      // and reaction evaluation.
      shotOutcomes.push(outcome);
      if (shotOutcomes.length > M47_MAX_OUTCOMES) shotOutcomes.shift();
      const putting = lie === "green" || intent.kind === "approach" && distance(from, hole.green) <= 5;
      itinerary.appendPause(from, holeIndex, putting ? LIVE.pace.puttPause : LIVE.pace.swingPause);
      itinerary.appendFlight(outcome.from, outcome.landing, holeIndex, putting ? "putt" : "swing");
      if (distance(outcome.landing, outcome.rest) > .05) pushWalk(outcome.landing, outcome.rest, holeIndex);
      from = { ...outcome.rest };
      lie = outcome.lieAfter;
      holed = outcome.holed;
      shotNumber++;
    }

    holePlans[holePlans.length - 1] = plan;
    holeReactions.push(evaluateHoleReaction({
      plan,
      outcomes,
      capabilities: args.capabilities,
      personality: args.personality,
      condition: course.condition,
    }));
    holePar.push(par);
    holeStrokes.push(outcomes.reduce((sum, outcome) => sum + 1 + outcome.penaltyStrokes, 0));
    cursor = { ...from };
    itinerary.cursor = cursor;
    played++;
    if (!args.skipPreRoundPurchases && played === Math.max(1, Math.ceil(validHoleCount / 2))) pushPurchase("snack_bar", holeIndex);
  }

  pushWalk(cursor, args.exit ?? args.entry, -1, LIVE.pace.interHoleWalkCap);
  return { segments: itinerary.segments, holePar, holeStrokes, capabilities: args.capabilities, holePlans, shotOutcomes, holeReactions };
}
