import type { Course, ConcessionType, PinRotation, Point, TeeSet } from "../models/types";
import { scoreCourseHoles } from "../sim/holes";
import { getParSetting, resolveCourseSetup } from "../models/courseSetup";
import { planPurchase } from "./concessions";
import { LIVE } from "./liveConfig";
import type { BuiltRound, WalkRouter } from "./golfer";
import { M47_MAX_OUTCOMES, type GolferCapabilities } from "./m47Types";
import { generateStrategicHolePlan, followUpIntent } from "./strategicOptions";
import { liveCourseSnapshot, resolveLiveShot, terrainAt } from "./livePhysics";
import { evaluateHoleReaction } from "./reactions";
import type { Personality } from "./personality";
import type { ControlledRoundSnapshotV2 } from "../rules/roundSnapshot";

function distance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.y - b.y); }

function walkSeg(from: Point, to: Point, holeIndex: number, cap = Infinity) {
  return { kind: "walk" as const, from, to, holeIndex, dur: Math.min(cap, distance(from, to) * LIVE.pace.walkPerTile) };
}

function flightSeg(from: Point, to: Point, holeIndex: number, shot: "swing" | "putt") {
  const d = distance(from, to);
  return { kind: "flight" as const, from, to, holeIndex, dur: Math.max(LIVE.pace.flightMin, Math.min(LIVE.pace.flightMax, d * LIVE.pace.flightPerTile)), shot };
}

function pauseSeg(at: Point, holeIndex: number, dur: number) {
  return { kind: "pause" as const, from: at, to: at, holeIndex, dur };
}

function roundCourseSetup(course: Course, teeSet: TeeSet, pinRotation: PinRotation): Course {
  return {
    ...course,
    holes: course.holes.map((hole) => {
      const setup = resolveCourseSetup(hole, teeSet, pinRotation);
      const par = getParSetting(hole, setup.teeSet);
      return { ...hole, tee: setup.tee, green: setup.pin, parMode: par.mode, parManual: par.mode === "MANUAL" ? par.par : undefined };
    }),
  };
}

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
  const course = roundCourseSetup(args.course, teeSet, pinRotation);
  const snapshot = liveCourseSnapshot({ course, teeSet, pinRotation, rulesSnapshot: args.rulesSnapshot });
  const summary = scoreCourseHoles(course);
  const segments: BuiltRound["segments"] = [];
  const holePar: number[] = [];
  const holeStrokes: number[] = [];
  const holePlans: NonNullable<BuiltRound["holePlans"]> = [];
  const shotOutcomes: NonNullable<BuiltRound["shotOutcomes"]> = [];
  const holeReactions: NonNullable<BuiltRound["holeReactions"]> = [];
  let cursor = { ...args.entry };
  let planningWallet = args.wallet ?? 0;

  const pushWalk = (from: Point, to: Point, holeIndex: number, cap = Infinity) => {
    if (args.route) {
      const path = args.route(from, to);
      if (path?.length) {
        let current = from;
        for (const point of path) {
          segments.push(walkSeg(current, point, holeIndex));
          current = point;
        }
        return;
      }
    }
    segments.push(walkSeg(from, to, holeIndex, cap));
  };

  const pushPurchase = (type: ConcessionType, holeIndex: number) => {
    const purchase = planPurchase({
      course,
      type,
      from: cursor,
      personality: args.personality,
      satisfaction: .7,
      wallet: planningWallet,
      rng: args.rng,
    });
    if (!purchase) return;
    pushWalk(cursor, purchase.entrance, holeIndex, LIVE.pace.interHoleWalkCap);
    segments.push({
      kind: "pause" as const,
      from: purchase.entrance,
      to: purchase.entrance,
      holeIndex,
      dur: purchase.serviceMinutes,
      concession: {
        buildingType: purchase.building.type,
        buildingX: purchase.building.x,
        buildingY: purchase.building.y,
        item: purchase.item,
        amount: purchase.amount,
      },
    });
    cursor = purchase.entrance;
    planningWallet -= purchase.amount;
  };

  if (!args.skipPreRoundPurchases) {
    pushPurchase("pro_shop", -1);
    pushPurchase("cart_rental", -1);
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
      segments.push(pauseSeg(from, holeIndex, putting ? LIVE.pace.puttPause : LIVE.pace.swingPause));
      segments.push(flightSeg(outcome.from, outcome.landing, holeIndex, putting ? "putt" : "swing"));
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
    played++;
    if (!args.skipPreRoundPurchases && played === Math.max(1, Math.ceil(validHoleCount / 2))) pushPurchase("snack_bar", holeIndex);
  }

  pushWalk(cursor, args.exit ?? args.entry, -1, LIVE.pace.interHoleWalkCap);
  return { segments, holePar, holeStrokes, capabilities: args.capabilities, holePlans, shotOutcomes, holeReactions };
}
