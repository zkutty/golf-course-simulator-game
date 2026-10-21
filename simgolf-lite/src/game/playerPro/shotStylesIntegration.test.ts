import { describe, expect, it } from "vitest";
import type { PlayerRoundCourseSnapshot, PlayerProSkills } from "../models/playerProTypes";
import { resolvePlayableShot } from "./playerPro";
import { createShotModelSnapshotV1 } from "../rules/shotModelSnapshot";
import { isValidSharedShotOutcome } from "../rules/contracts";
import { sampleRetainedShotMotion } from "../rules/shotMotion";

const skills: PlayerProSkills = { power: 80, driving: 80, irons: 80, shortGame: 80, recovery: 80, putting: 80 };
const snapshot = (modern = true): PlayerRoundCourseSnapshot => ({ courseId: "styles", courseName: "Styles", theme: "parkland", width: 64, height: 24,
  yardsPerTile: 10, tiles: Array(64 * 24).fill("fairway"), elevations: Array(64 * 24).fill(0), obstacles: [],
  holes: [{ id: "h1", name: "First", par: 4, tee: { x: 3, y: 12 }, pin: { x: 55, y: 12 }, waypoints: [] }],
  ...(modern ? { shotModel: createShotModelSnapshotV1() } : {}) });
const hit = (course: PlayerRoundCourseSnapshot, style: "straight_run" | "draw" | "fade" | "high_spin" | "pitch" = "straight_run") => resolvePlayableShot({
  snapshot: course, holeId: "h1", shotNumber: 1, from: { x: 3, y: 12 }, lie: "fairway", skills, seed: 42,
  selection: { club: style === "pitch" ? "Pitching Wedge" : "7 Iron", technique: "normal", style, power: 1, aim: { x: 50, y: 12 } },
});

describe("versioned shot styles through shared authority", () => {
  it("retains coherent deterministic motion and independent style impacts", () => {
    for (const style of ["straight_run", "draw", "fade", "high_spin", "pitch"] as const) {
      const shot = hit(snapshot(), style);
      expect(shot.shotStyle).toBe(style);
      expect(isValidSharedShotOutcome(shot.sharedOutcome)).toBe(true);
      const motion = shot.sharedOutcome!.motion!;
      expect(sampleRetainedShotMotion(motion, 0)?.point).toEqual(shot.from);
      expect(sampleRetainedShotMotion(motion, 1)?.point).toEqual(shot.sharedOutcome!.physicalRest);
      expect(sampleRetainedShotMotion(motion, .3)?.heightYards).toBeGreaterThan(0);
      expect(JSON.parse(JSON.stringify(shot))).toEqual(shot);
      expect(hit(snapshot(), style)).toEqual(shot);
    }
  });
  it("keeps old snapshots on the historical path without invented motion", () => {
    const shot = hit(snapshot(false));
    expect(shot.shotStyle).toBeUndefined();
    expect(shot.sharedOutcome?.impact).toBeUndefined();
    expect(shot.sharedOutcome?.motion).toBeUndefined();
  });
  it("stops ground travel at the actual sampled collision before recording rollout", () => {
    const course = snapshot();
    course.obstacles = [{ x: 3.3, y: 12, type: "tree" }];
    const shot = hit(course);
    expect(shot.sharedOutcome!.collision.kind).toBe("obstacle");
    expect(shot.sharedOutcome!.motion!.postCollisionPath.length).toBeGreaterThanOrEqual(2);
    expect(shot.greenRollout!.path).toHaveLength(1);
    expect(shot.rollYards).toBe(0);
    expect(isValidSharedShotOutcome(shot.sharedOutcome)).toBe(true);
  });
});
