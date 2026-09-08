import { describe, expect, it } from "vitest";
import { projectCommittedShot, type CommittedShotCarrier } from "./shotTruth";
import { AIR_FRAC, committedShotGroundPosition } from "../render/ballFlight";
import { shotTruthCues } from "../render/shotTruthCues";
import { liveCourseSnapshot, previewLiveShot, resolveLiveShot } from "../live/livePhysics";
import { createM47CertificationCourse } from "../testing/m47Certification";
import { createGolferCapabilities } from "../live/capabilities";
import { generateStrategicHolePlan } from "../live/strategicOptions";
import { invitedPreviewShot } from "../onboarding/invitedPreviewShot";
import { DISPERSION_CLUBS } from "./dispersionRegistry";

function committed() {
  const course = createM47CertificationCourse(9);
  const personality = { skill: .6, consistency: .6, patience: .5, spendPropensity: .5, prefs: { difficulty: 0, scenery: 0, price: 0 } };
  const capabilities = createGolferCapabilities({ personality, seed: 42 });
  const snapshot = liveCourseSnapshot({ course, teeSet: "member", pinRotation: "A" });
  const hole = course.holes[0];
  const plan = generateStrategicHolePlan({ course, hole, par: 4, personality, capabilities, snapshot });
  return { snapshot, capabilities, holeId: snapshot.holes[0].id, shotNumber: 1, from: hole.tee!, lie: "tee", intent: plan.chosen, seed: 1108 };
}

describe("ZK-1108 committed-shot truth contract", () => {
  it("keeps fixed-input preview, commitment and JSON replay equal without mutating inputs", () => {
    const args = committed();
    const before = structuredClone(args);
    const shot = resolveLiveShot(args);
    expect(previewLiveShot(args)).toEqual(shot);
    const truth = projectCommittedShot(shot);
    expect(projectCommittedShot(JSON.parse(JSON.stringify(shot)))).toEqual(truth);
    expect(args).toEqual(before);
    expect(DISPERSION_CLUBS.some((club) => club.label === truth.club)).toBe(true);
    expect(truth.strokeCost).toBe(1 + shot.penaltyStrokes + (shot.greenPutting?.putts ?? 0));
    expect(Object.isFrozen(truth)).toBe(true);
    expect(Object.isFrozen(truth.rollPath)).toBe(true);
    expect(Object.isFrozen(truth.from)).toBe(true);
    expect(truth.from).not.toBe(shot.from);
  });

  it("preserves exact v1 invited receipt fields and never substitutes physical rest for next lie", () => {
    const shot = resolveLiveShot(committed());
    expect(invitedPreviewShot(shot)).toEqual({ shotNumber: shot.shotNumber, intent: shot.intent, club: shot.club, from: shot.from, landing: shot.landing, rest: shot.rest, lieAfter: shot.lieAfter, penaltyStrokes: shot.penaltyStrokes });
  });

  it("follows the recorded bent roll and stops at physical rest, never the relief drop", () => {
    const shot = resolveLiveShot(committed());
    const landing = { x: 10, y: 10 };
    const physicalRest = { x: 12, y: 12 };
    const finalPosition = { x: 2, y: 2 };
    const carrier: CommittedShotCarrier = {
      ...shot, from: { x: 0, y: 10 }, rest: finalPosition,
      sharedOutcome: { ...shot.sharedOutcome!, flight: { ...shot.sharedOutcome!.flight, carryEnd: landing }, physicalRest, finalPosition, ruling: { ...shot.sharedOutcome!.ruling, status: "penalty", penaltyStrokes: 1 } },
      greenRollout: { ...shot.greenRollout!, landing, rest: physicalRest, path: [landing, { x: 10, y: 12 }, physicalRest] },
    };
    const truth = projectCommittedShot(carrier);
    expect(committedShotGroundPosition(truth, 0)).toEqual(carrier.from);
    expect(committedShotGroundPosition(truth, AIR_FRAC)).toEqual(landing);
    expect(committedShotGroundPosition(truth, AIR_FRAC + (1 - AIR_FRAC) / 2)).toEqual({ x: 10, y: 12 });
    expect(committedShotGroundPosition(truth, 1)).toEqual(physicalRest);
    expect(truth.finalPosition).toEqual(finalPosition);
    expect(truth.penaltyStrokes).toBe(1);
    expect(committedShotGroundPosition(truth, NaN)).toBeNull();
    const putt = { ...truth, club: "Putter" };
    expect(committedShotGroundPosition(putt, 0)).toEqual(carrier.from);
    expect(committedShotGroundPosition(putt, 1)).toEqual(physicalRest);
    expect(committedShotGroundPosition(truth, -2)).toEqual(carrier.from);
    expect(committedShotGroundPosition(truth, 2)).toEqual(physicalRest);
  });

  it("does not invent a physical path for legacy outcomes and localizes schematic cues", () => {
    const shot = resolveLiveShot(committed());
    const legacy = { ...shot, sharedOutcome: undefined, greenRollout: undefined, finalPosition: undefined };
    const truth = projectCommittedShot(legacy);
    expect(truth.source).toBe("legacy-trace");
    expect(truth.physicalRest).toBeNull();
    expect(truth.rollPath).toEqual([]);
    expect(committedShotGroundPosition(truth, .5)).toBeNull();
    expect(shotTruthCues(truth, "en").join(" ")).toContain("Schematic markers");
    expect(shotTruthCues(truth, "en").join(" ")).not.toContain("Final playable position");
    expect(shotTruthCues(truth, "pseudo").every((cue) => cue.startsWith("⟦"))).toBe(true);
    expect(projectCommittedShot(legacy)).toEqual(truth);
  });
});
