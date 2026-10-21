import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import { createGolferCapabilities } from "../live/capabilities";
import { buildStrategicGolferRound } from "../live/m47Round";
import { liveCourseSnapshot } from "../live/livePhysics";
import { caddieRecommendation, commitPlayerShot, createDefaultPlayerPro, normalizePlayerPro, startPlayableRound } from "../playerPro/playerPro";
import { isValidSharedShotOutcome } from "../rules/contracts";
import { isProfileCalibrationV1 } from "../rules/profileCalibration";
import { isValidRetainedShotMotionV1 } from "../rules/shotMotion";
import { isValidShotModelSnapshot, usesClubShotModel } from "../rules/shotModelSnapshot";
import { mulberry32 } from "../../utils/rng";
import { createPlayerProReferenceCourse } from "./referenceCourse";
import { runZK813ProfileCertification, ZK813_CERTIFICATION_ID } from "./zk813ProfileCertification";

describe("ZK-813 current modern physical stream", () => {
  it("passes every profile/receipt/replay control and repeats the complete current report", { timeout: 120_000 }, () => {
    const first = runZK813ProfileCertification();
    const replay = runZK813ProfileCertification();
    expect(first.certificationId).toBe(ZK813_CERTIFICATION_ID);
    expect(first.checks.filter((check) => !check.passed), JSON.stringify(first.checks)).toEqual([]);
    expect(first.passed).toBe(true);
    expect(first.rows).toHaveLength(9);
    expect(first.campaign).toMatchObject({ chapterCount: 6, phaseEvidenceCount: 18, serializedReceipts: 6 });
    expect(first.longSession.uninterruptedHash).toBe(first.longSession.resumedHash);
    expect(first.determinismHash).toMatch(/^[0-9a-f]{8}$/);
    expect(replay).toEqual(first);
  });

  it("strictly retains modern snapshot, profile and immutable committed-shot ownership through reload", () => {
    const seed = 813_813;
    const course = createPlayerProReferenceCourse();
    const career = createDefaultPlayerPro({ seed, name: "Modern profile authority" });
    const world = { ...DEFAULT_WORLD, runSeed: seed, cash: 250_000, reputation: 80, playerPro: career };
    const started = startPlayableRound({ course, world, layoutId: "player-pro-slice", teeSet: "member", pinRotation: "A" });
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error(started.reason);
    expect(isValidShotModelSnapshot(started.round.course.shotModel)).toBe(true);
    expect(usesClubShotModel(started.round.course.shotModel)).toBe(true);
    expect(isProfileCalibrationV1(started.round.course.distanceProfile)).toBe(true);
    expect(started.round.course.distanceProfile!.skills).toEqual(career.skills);
    const pending = commitPlayerShot(started.round, career.skills, caddieRecommendation(started.round, career.skills));
    expect(pending.phase).toBe("flight");
    const shot = pending.pendingShot!;
    expect(isValidSharedShotOutcome(shot.sharedOutcome)).toBe(true);
    const motion = shot.sharedOutcome!.motion!;
    expect(isValidRetainedShotMotionV1(motion)).toBe(true);
    expect(motion.identity).toMatchObject({ shotId: shot.id, holeId: shot.holeId, shotNumber: shot.shotNumber,
      seed: shot.seed >>> 0, club: shot.club, style: shot.shotStyle });
    expect(motion.from.point).toEqual(shot.from);
    expect(motion.landing.point).toEqual(shot.sharedOutcome!.flight.carryEnd);
    expect(motion.physicalRest.point).toEqual(shot.sharedOutcome!.physicalRest);
    const loaded = normalizePlayerPro(JSON.parse(JSON.stringify({ ...career, activeRound: pending })), { seed });
    expect(loaded.activeRound?.course.shotModel).toEqual(pending.course.shotModel);
    expect(loaded.activeRound?.course.distanceProfile).toEqual(pending.course.distanceProfile);
    expect(loaded.activeRound?.pendingShot?.sharedOutcome?.motion).toEqual(motion);
  });

  it("uses current modern evidence for real live rounds without the historical test's wrapper", () => {
    const course = createPlayerProReferenceCourse();
    const personality = { skill: .7, consistency: .76, patience: .55, spendPropensity: .5, prefs: { difficulty: 0, scenery: 0, price: 0 } };
    const capabilities = createGolferCapabilities({ personality, seed: 813_813 });
    const snapshot = liveCourseSnapshot({ course, teeSet: "member", pinRotation: "A", modernShotModel: true, capabilities });
    expect(isValidShotModelSnapshot(snapshot.shotModel)).toBe(true);
    expect(isProfileCalibrationV1(snapshot.distanceProfile)).toBe(true);
    const built = buildStrategicGolferRound({ course, entry: course.holes[0].tee!, rng: mulberry32(813_813), personality, capabilities, skipPreRoundPurchases: true });
    expect(built.shotOutcomes!.length).toBeGreaterThan(0);
    for (const shot of built.shotOutcomes!) {
      expect(isValidSharedShotOutcome(shot.sharedOutcome)).toBe(true);
      expect(isValidRetainedShotMotionV1(shot.sharedOutcome!.motion)).toBe(true);
      expect(shot.sharedOutcome!.motion!.identity).toMatchObject({ shotId: shot.id, holeId: shot.holeId,
        shotNumber: shot.shotNumber, seed: shot.seed >>> 0, club: shot.club, style: shot.shotStyle });
    }
  });
});
