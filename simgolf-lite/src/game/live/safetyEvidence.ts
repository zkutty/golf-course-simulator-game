import type { Course } from "../models/types";
import type { PropertyShotTrace } from "../property/types";
import type { Golfer, LiveState } from "./types";
import type { LiveShotOutcome } from "./m47Types";

function shotType(outcome: LiveShotOutcome): PropertyShotTrace["shotType"] {
  if (outcome.club === "Putter" || outcome.lieBefore === "green") return "putt";
  if (outcome.shotNumber === 1 && outcome.lieBefore === "tee") return "drive";
  if (outcome.intent === "recovery" || !["tee", "fairway", "green"].includes(outcome.lieBefore)) return "recovery";
  return "approach";
}

function fromOutcome(course: Course, golfer: Golfer, outcome: LiveShotOutcome): PropertyShotTrace {
  const physicalRest = outcome.sharedOutcome?.physicalRest ?? outcome.greenRollout?.rest ?? outcome.landing;
  return {
    golferId: golfer.id,
    holeId: outcome.holeId,
    holeName: course.holes.find((hole) => hole.id === outcome.holeId)?.name,
    teeSet: golfer.teeSet,
    shotType: shotType(outcome),
    from: { ...outcome.from },
    to: { ...physicalRest },
    aim: { ...outcome.aim },
    landing: { ...outcome.landing },
    physicalRest: { ...physicalRest },
    rest: { ...outcome.rest },
    slopeExplanation: outcome.slopeExplanation,
  };
}

/**
 * Safety consumes completed physical positions when available. Old live
 * states retain their segment-only behavior instead of inventing evidence.
 */
export function livePropertyShotTraces(live: LiveState, course: Course): PropertyShotTrace[] {
  return live.golfers.flatMap((golfer) => golfer.shotOutcomes?.length
    ? golfer.shotOutcomes
        .filter((outcome) => outcome.club !== "Putter" && outcome.lieBefore !== "green")
        .map((outcome) => fromOutcome(course, golfer, outcome))
    : golfer.segments
        .filter((segment) => segment.kind === "flight" && segment.shot !== "putt")
        .map((segment) => ({
          golferId: golfer.id,
          holeId: segment.holeId,
          holeName: course.holes.find((hole) => hole.id === segment.holeId)?.name,
          teeSet: golfer.teeSet,
          shotType: segment.holeIndex >= 0
            && segment.from.x === (course.holes[segment.holeIndex]?.tee?.x ?? Number.NaN)
            && segment.from.y === (course.holes[segment.holeIndex]?.tee?.y ?? Number.NaN)
            ? "drive" as const
            : "approach" as const,
          from: { ...segment.from },
          to: { ...segment.to },
        })));
}
