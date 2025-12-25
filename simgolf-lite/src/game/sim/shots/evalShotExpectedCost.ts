import type { Course, Point } from "../../models/types";
import type { ClubSpec, GolferProfile } from "../golferProfiles";
import { computeExpectedLandingPenalty } from "./landingPenalty";
import { evalShotWithWaterCarry } from "./waterCarry";

export function evalShotExpectedCost(args: {
  course: Course;
  from: Point;
  to: Point;
  golfer: GolferProfile;
  club: ClubSpec;
}) {
  const base = evalShotWithWaterCarry(args);
  if (!base.isValid) return base;

  const landing = computeExpectedLandingPenalty({
    course: args.course,
    target: args.to,
    dispersionTiles: base.dispersionTiles,
  });

  const expectedLandingPenalty = landing.expectedPenalty;
  const expectedShotCost = base.baseStrokeCost + expectedLandingPenalty + base.expectedCarryPenalty;

  return {
    ...base,
    expectedLandingPenalty,
    expectedShotCost,
    debug: [...base.debug, `landPen=+${expectedLandingPenalty.toFixed(2)}`],
  };
}



