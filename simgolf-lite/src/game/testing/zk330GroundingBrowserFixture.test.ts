import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import { restoreLiveSimulation, snapshotLiveSimulation } from "../live/persistence";
import { liveRenderData } from "../live/simulation";
import {
  createZk330GroundingCourse,
  createZk330GroundingLiveState,
  createZk330GroundingPausedLiveState,
  ZK330_TRAVERSAL,
} from "./zk330GroundingBrowserFixture";

const course = createZk330GroundingCourse();
const world = { ...DEFAULT_WORLD, runSeed: 330_330, cash: 250_000, isBankrupt: false, distressWeeks: 0 };
const snapshot = (state: ReturnType<typeof createZk330GroundingLiveState>) => snapshotLiveSimulation({
  state, pendingCash: 0, speed: "paused", selectedGolferId: 330,
});

describe("ZK-330 grounding fixture persistence", () => {
  it.each(ZK330_TRAVERSAL)("retains golfer 330 at $label through the real snapshot validator", (sample) => {
    const original = createZk330GroundingLiveState(course, world, sample.progress);
    const restored = restoreLiveSimulation(snapshot(original));

    expect(restored).not.toBeNull();
    const golfer = restored!.state.golfers[0];
    expect(golfer).toMatchObject({ id: 330, holeIds: [], pinRotationsByHole: {}, pos: { x: sample.x, y: sample.y } });
    expect(golfer.segments).toEqual(original.golfers[0].segments);
    expect(restored!.selectedGolferId).toBe(330);
    expect(restored!.speed).toBe("paused");
    expect(liveRenderData(restored!.state)).toEqual([expect.objectContaining({ id: 330, x: sample.x, y: sample.y, segKind: sample.progress === 1 ? null : "walk" })]);
  });

  it("retains the paused golfer pose and segment through the real snapshot validator", () => {
    const original = createZk330GroundingPausedLiveState(course, world);
    const restored = restoreLiveSimulation(snapshot(original));

    expect(restored).not.toBeNull();
    expect(restored!.state.golfers[0]).toMatchObject({ id: 330, holeIds: [], pinRotationsByHole: {}, pos: { x: 22, y: 20 }, segElapsed: 50 });
    expect(restored!.state.golfers[0].segments).toEqual(original.golfers[0].segments);
    expect(liveRenderData(restored!.state)).toEqual([expect.objectContaining({ id: 330, x: 22, y: 20, segKind: "pause", segT: .5 })]);
  });

  it("rejects an unbooked pin-map key and accepts the same snapshot with matching empty keys", () => {
    const invalid = snapshot(createZk330GroundingLiveState(course, world, 0));
    invalid.state.golfers[0].pinRotationsByHole = { "stale-template-hole": "A" };
    expect(restoreLiveSimulation(invalid)).toBeNull();

    invalid.state.golfers[0].pinRotationsByHole = {};
    expect(restoreLiveSimulation(invalid)?.state.golfers[0].id).toBe(330);
  });
});
