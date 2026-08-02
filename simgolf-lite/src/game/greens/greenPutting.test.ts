import { describe, expect, it } from "vitest";
import type { PlayerRoundCourseSnapshot } from "../models/playerProTypes";
import { createFlatGreenSurfaceV1, createGreenProgram, createHealthyGreenLocalState } from "./greenSurface";
import { estimateAutomaticPutts, isValidGreenPutting, resolveAutomaticPutts } from "./greenPutting";

function snapshot(): PlayerRoundCourseSnapshot {
  const width = 16;
  const height = 12;
  const tiles = Array.from({ length: width * height }, () => "fairway");
  for (let y = 3; y <= 8; y++) for (let x = 8; x <= 14; x++) tiles[y * width + x] = "green";
  const holes = [{ id: "putting-hole", name: "Putting Hole", par: 4, tee: { x: 1, y: 6 }, pin: { x: 12, y: 6 }, waypoints: [] }];
  const carrier = { width, height, tiles, holes };
  return {
    courseId: "putting-test",
    courseName: "Putting test",
    theme: "parkland",
    width,
    height,
    yardsPerTile: 3,
    tiles,
    elevations: new Array(width * height).fill(0),
    obstacles: [],
    holes,
    greenSnapshot: {
      version: 1,
      geometryVersion: "flat",
      surface: createFlatGreenSurfaceV1(),
      program: createGreenProgram("balanced"),
      localState: createHealthyGreenLocalState(carrier),
    },
  };
}

const skilled = { putting: 95, shortGame: 92, recovery: 90 };
const developing = { putting: 18, shortGame: 18, recovery: 18 };

describe("ZK-640 automatic putting", () => {
  it("is deterministic, bounded, and validates its persisted evidence", () => {
    const args = { snapshot: snapshot(), holeId: "putting-hole", rest: { x: 10.8, y: 6 }, skills: skilled, seed: 640 };
    const first = resolveAutomaticPutts(args);
    expect(first).toEqual(resolveAutomaticPutts(args));
    expect(first.putts).toBeGreaterThanOrEqual(1);
    expect(first.putts).toBeLessThanOrEqual(3);
    expect(isValidGreenPutting(first)).toBe(true);
  });

  it("separates short/easy, ordinary, and long/severe leaves by skill", () => {
    const value = snapshot();
    const easy = resolveAutomaticPutts({ snapshot: value, holeId: "putting-hole", rest: { x: 11.75, y: 6 }, skills: skilled, seed: 3 });
    const ordinary = resolveAutomaticPutts({ snapshot: value, holeId: "putting-hole", rest: { x: 10.2, y: 6 }, skills: { putting: 50, shortGame: 50, recovery: 50 }, seed: 3 });
    const hard = resolveAutomaticPutts({
      snapshot: value,
      holeId: "putting-hole",
      rest: { x: 8.1, y: 3.1 },
      skills: developing,
      seed: 3,
      rollout: { breakTiles: 6, evidence: { realizedSpeedFeet: 14, effectiveMoisture: .9 } } as never,
    });
    expect(easy.putts).toBe(1);
    expect(ordinary.putts).toBe(2);
    expect(hard.putts).toBe(3);
  });

  it("offers an unseeded estimate without exposing a resolved outcome", () => {
    const value = snapshot();
    const plan = estimateAutomaticPutts({ snapshot: value, holeId: "putting-hole", rest: { x: 9.5, y: 6 }, skills: skilled });
    expect(plan.expectedPutts).toBeGreaterThanOrEqual(1);
    expect(plan.expectedPutts).toBeLessThanOrEqual(3);
    expect("seed" in plan).toBe(false);
    expect("putts" in plan).toBe(false);
  });
});
