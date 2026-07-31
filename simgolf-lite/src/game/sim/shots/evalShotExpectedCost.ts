import type { Course, Point } from "../../models/types";
import type { ClubSpec, GolferProfile } from "../golferProfiles";
import { computeExpectedLandingPenalty } from "./landingPenalty";
import { evalShotWithWaterCarry } from "./waterCarry";
import type { ShotHandedness, ShotSlopeContext } from "../../models/shotSlope";

export function evalShotExpectedCost(args: {
  course: Course;
  from: Point;
  to: Point;
  golfer: GolferProfile;
  club: ClubSpec;
  /** Optional frozen evaluation facts for retained/replayed shots. */
  shotSlope?: ShotSlopeContext;
  /** Temporary compatibility spelling for integrations using `slopeContext`. */
  slopeContext?: ShotSlopeContext;
  handedness?: ShotHandedness;
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




