import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import type { Course, World } from "../models/types";
import { createRenderPerfCourse } from "../testing/referenceCourse";
import { isProfileCalibrationV1 } from "../rules/profileCalibration";
import { usesClubShotModel } from "../rules/shotModelSnapshot";
import {
  autoFinishPlayerRound, caddieRecommendation, commitPlayerShot, createDefaultPlayerPro, finishPlayerShot,
  normalizePlayerPro, previewPlayableShot, startPlayableRound,
} from "./playerPro";
import { settlePlayerRound } from "./playerProSettlement";
import { normalizeLoadedSaveResult } from "../../utils/save";

/** Same routed certification property as the historical M36 regression fixture. */
function certifiedCourse(holeCount: 9 | 18): Course {
  const base = createRenderPerfCourse("parkland");
  const holes = base.holes.slice(0, holeCount).map((hole, index) => ({
    ...hole, id: `modern-cert-hole-${index + 1}`,
    teeBoxes: { member: hole.tee }, pinPositions: { A: hole.green },
    parByTee: { member: { mode: "MANUAL" as const, par: hole.parManual ?? 5 } },
  }));
  const ids = holes.map((hole) => hole.id);
  return {
    ...base, holes,
    layouts: [{ id: `modern-cert-${holeCount}`, name: `${holeCount}-Hole Modern Certification`,
      draftHoleIds: ids, publishedHoleIds: ids, roundLength: holeCount, state: "open", greenFee: 0 }],
    activeCourseId: `modern-cert-${holeCount}`, activePinRotation: "A",
  };
}
function world(): World {
  return { ...DEFAULT_WORLD, runSeed: 360037, cash: 10_000,
    playerPro: createDefaultPlayerPro({ seed: 360037, name: "Modern Certification" }) };
}
function planningRound() {
  const currentWorld = world();
  const career = currentWorld.playerPro!;
  career.skills = { power: 80, driving: 80, irons: 80, shortGame: 80, putting: 80, recovery: 80 };
  const course = certifiedCourse(9);
  course.tiles = course.tiles.map(() => "fairway");
  course.elevations = course.elevations.map(() => 0);
  course.obstacles = [];
  const result = startPlayableRound({ course, world: currentWorld, layoutId: "modern-cert-9" });
  if (!result.ok) throw new Error(result.reason);
  return { round: result.round, skills: career.skills };
}

describe("ZK1396 modern round defaults and full-round certification", () => {
  it("keeps modern target distance geometric while retaining the plays-like slope adjustment", () => {
    const { round, skills } = planningRound();
    const aim = { x: round.ball.x + 10, y: round.ball.y };
    const elevations = round.course.elevations.slice();
    elevations[aim.y * round.course.width + aim.x] = 4;
    const uphillRound = { ...round, course: { ...round.course, elevations } };
    expect(usesClubShotModel(uphillRound.course.shotModel)).toBe(true);
    expect(uphillRound.course.yardsPerTile).toBe(4);

    const preview = previewPlayableShot(uphillRound, skills, {
      club: "7 Iron", aim, power: 1, technique: "normal", style: "straight_run",
    });
    expect(preview.available).toBe(true);
    expect(preview.targetYards).toBe(40);
    expect(preview.shotSlope).toMatchObject({
      flatDistanceYards: 40, targetElevationDelta: 4, playsLikeDistanceYards: 50,
    });
  });

  it("keeps the unseeded preview invariant to future RNG and responds to selected shot controls", () => {
    const { round, skills } = planningRound();
    const selection = { club: "7 Iron", aim: round.course.holes[0].pin, power: .8, technique: "normal" as const,
      style: "straight_run" as const, flightProfile: "standard" as const };
    const original = structuredClone(round);
    const preview = previewPlayableShot(round, skills, selection);
    expect(preview.available).toBe(true);
    expect(preview.sharedOutcome).toBeNull();
    expect(preview.greenRollout).toBeNull();
    expect(preview.automaticPuttingEstimate).toBeNull();
    expect(preview.expectedFlight?.envelope).toHaveLength(33);
    for (const [rngSeed, rngCursor] of [[1, 0], [-40_555, 10], [2_147_483_647, 100]]) {
      expect(previewPlayableShot({ ...round, rngSeed, rngCursor }, skills, selection)).toEqual(preview);
    }
    expect(round).toEqual(original);
    for (const changed of [
      { ...selection, club: "5 Iron" },
      { ...selection, power: .4 },
      { ...selection, style: "draw" as const },
      { ...selection, flightProfile: "high" as const },
      { ...selection, flightProfile: "low" as const },
      { ...selection, club: "Pitching Wedge", style: "pitch" as const },
    ]) {
      const variant = previewPlayableShot(round, skills, changed);
      expect(variant.available).toBe(true);
      expect(variant.sharedOutcome).toBeNull();
      expect(variant.expectedFlight?.envelope).toHaveLength(33);
      expect(variant.expectedFlight).not.toEqual(preview.expectedFlight);
    }
  });

  it("allows a legal partial shot toward a far pin without promising its sampled outcome", () => {
    const { round, skills } = planningRound();
    const selection = { club: "7 Iron", aim: round.course.holes[0].pin, power: .5, technique: "normal" as const };
    const preview = previewPlayableShot(round, skills, selection);
    expect(preview.available).toBe(true);
    expect(preview.blocker).toBeNull();
    expect(preview.targetYards).toBeGreaterThan(preview.carryYards * 3);
    expect(preview.expectedFlight).toBeDefined();
    expect(preview.sharedOutcome).toBeNull();
    const committed = commitPlayerShot(round, skills, selection);
    expect(committed.phase).toBe("flight");
    expect(committed.pendingShot?.sharedOutcome?.requestedCarryYards).toBeCloseTo(preview.carryYards, 6);
    expect(committed.pendingShot?.sharedOutcome?.requestedCarryYards).toBeLessThan(preview.targetYards);
    const resampled = commitPlayerShot({ ...round, rngSeed: round.rngSeed + 1000 }, skills, selection);
    expect(resampled.pendingShot?.landing).not.toEqual(committed.pendingShot?.landing);
    expect(previewPlayableShot({ ...round, rngSeed: round.rngSeed + 1000 }, skills, selection)).toEqual(preview);
  });

  it("strictly reloads a shot-owned display cursor without changing scoring or RNG", () => {
    const currentWorld = world();
    const career = currentWorld.playerPro!;
    const result = startPlayableRound({ course: certifiedCourse(9), world: currentWorld, layoutId: "modern-cert-9" });
    if (!result.ok) throw new Error(result.reason);
    const selection = caddieRecommendation(result.round, career.skills);
    const pending = commitPlayerShot(result.round, career.skills, selection);
    expect(pending.shotPresentation).toEqual({ version: 1, shotId: pending.pendingShot!.id, progress: 0 });
    const cursor = { ...pending.shotPresentation!, progress: .45 };
    const inProgress = { ...pending, shotPresentation: cursor };
    const restored = normalizePlayerPro(JSON.parse(JSON.stringify({ ...career, activeRound: inProgress })), { seed: pending.rngSeed });
    expect(restored.activeRound?.shotPresentation).toEqual(cursor);
    expect(restored.activeRound?.pendingShot).toEqual(pending.pendingShot);
    expect(restored.activeRound?.rngCursor).toBe(pending.rngCursor);
    expect(finishPlayerShot(restored.activeRound!)).toEqual(finishPlayerShot(pending));
    const absent = normalizePlayerPro({ ...career, activeRound: { ...pending, shotPresentation: undefined } }, { seed: pending.rngSeed });
    expect(absent.activeRound?.shotPresentation).toBeUndefined();
    expect(absent.activeRound?.pendingShot).toEqual(pending.pendingShot);

    for (const invalid of [null, [], { ...cursor, version: 2 }, { ...cursor, shotId: "other-shot" },
      { ...cursor, progress: -1 }, { ...cursor, progress: 1.01 }, { ...cursor, progress: NaN },
      { ...cursor, progress: Infinity }, { ...cursor, progress: "0.45" }, { ...cursor, extra: true },
      { version: 1, shotId: cursor.shotId }]) {
      const loaded = normalizePlayerPro({ ...career, activeRound: { ...pending, shotPresentation: invalid } }, { seed: pending.rngSeed });
      expect(loaded.activeRound).toBeNull();
    }
    expect(normalizePlayerPro({ ...career, activeRound: { ...result.round, shotPresentation: cursor } }, { seed: pending.rngSeed }).activeRound).toBeNull();
  });

  it.each([9, 18] as const)("completes and reloads %i modern holes without duplicated settlement", (holeCount) => {
    const course = certifiedCourse(holeCount);
    const currentWorld = world();
    const career = currentWorld.playerPro!;
    const result = startPlayableRound({ course, world: currentWorld,
      layoutId: `modern-cert-${holeCount}`, teeSet: "member", pinRotation: "A" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(usesClubShotModel(result.round.course.shotModel)).toBe(true);
    expect(isProfileCalibrationV1(result.round.course.distanceProfile)).toBe(true);
    expect(result.round.course.distanceProfile?.skills).toEqual(career.skills);

    const selection = caddieRecommendation(result.round, career.skills);
    const preview = previewPlayableShot(result.round, career.skills, selection);
    expect(preview.available, preview.blocker ?? "first caddie selection unavailable").toBe(true);
    expect(preview.sharedOutcome).toBeNull();
    const pending = commitPlayerShot(result.round, career.skills, selection);
    expect(pending.phase).toBe("flight");
    expect(commitPlayerShot(result.round, career.skills, selection).pendingShot).toEqual(pending.pendingShot);
    const restored = normalizePlayerPro(JSON.parse(JSON.stringify({ ...career, activeRound: pending })), { seed: pending.rngSeed });
    expect(restored.activeRound?.course.shotModel).toEqual(pending.course.shotModel);
    expect(restored.activeRound?.course.distanceProfile).toEqual(pending.course.distanceProfile);
    expect(restored.activeRound?.pendingShot).toEqual(pending.pendingShot);
    if (!restored.activeRound) throw new Error("Modern active round failed to reload.");

    const completed = autoFinishPlayerRound(restored.activeRound, restored.skills);
    const nextSelection = caddieRecommendation(completed, restored.skills);
    const diagnostic = completed.phase === "awaiting_shot"
      ? JSON.stringify({ hole: completed.currentHoleIndex, lie: completed.lie, ball: completed.ball,
        selection: nextSelection, blocker: previewPlayableShot(completed, restored.skills, nextSelection).blocker,
        shots: completed.shots.length, recent: completed.shots.slice(-3).map((shot) => ({
          from: shot.from, landing: shot.landing, rest: shot.rest, collision: shot.sharedOutcome?.collision,
        })) })
      : completed.phase;
    expect(completed.phase, diagnostic).toBe("round_complete");
    expect(completed.scorecard).toHaveLength(holeCount);
    expect(completed.scorecard.every((hole) => hole.complete)).toBe(true);
    expect(new Set(completed.shots.map((shot) => shot.id)).size).toBe(completed.shots.length);
    expect(autoFinishPlayerRound(pending, career.skills)).toEqual(completed);
    const settlement = settlePlayerRound(career, completed);
    expect(settlement.career.rounds).toHaveLength(1);
    const saved = normalizeLoadedSaveResult({ schemaVersion: 14, savedAt: 1,
      course, world: { ...currentWorld, playerPro: settlement.career } });
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error("Modern completed round failed to reload.");
    expect(saved.payload.world.playerPro?.rounds[0]?.scorecard).toHaveLength(holeCount);
    expect(settlePlayerRound(saved.payload.world.playerPro!, completed).round).toBeNull();
  });
});
