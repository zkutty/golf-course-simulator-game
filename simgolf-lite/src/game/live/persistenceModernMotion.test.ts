import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import type { Course } from "../models/types";
import { createLiveState, stepLive } from "./simulation";
import { restoreLiveSimulation, snapshotLiveSimulation } from "./persistence";

function retainedSnapshot() {
  const course: Course = { name: "Strict retained live save", width: 64, height: 20,
    tiles: Array(1280).fill("fairway"), elevations: Array(1280).fill(0),
    holes: [{ id: "strict", tee: { x: 3, y: 10 }, green: { x: 40, y: 10 }, parMode: "MANUAL", parManual: 4 }],
    obstacles: [], buildings: [], yardsPerTile: 10, baseGreenFee: 60, condition: .8 };
  const state = createLiveState(course, DEFAULT_WORLD, 2);
  for (let step = 0; !state.golfers.length && step < 2000; step++) stepLive(state, course, 1);
  const snapshot = snapshotLiveSimulation({ state, pendingCash: 0, speed: "paused", selectedGolferId: null });
  const owner = snapshot.state.golfers[0].shotOutcomes!.find((shot) => shot.sharedOutcome?.motion)!;
  expect(owner).toBeDefined();
  return { snapshot, owner, segment: snapshot.state.golfers[0].segments.find((segment) => segment.shotId === owner.id)! };
}

describe("modern live motion rejects malformed persisted authority", () => {
  it.each([
    ["null shared outcome", (owner: Record<string, unknown>) => { owner.sharedOutcome = null; }],
    ["null impact", (owner: Record<string, unknown>) => { (owner.sharedOutcome as Record<string, unknown>).impact = null; }],
    ["missing impact", (owner: Record<string, unknown>) => { delete (owner.sharedOutcome as Record<string, unknown>).impact; }],
    ["nonfinite impact", (owner: Record<string, unknown>) => { ((owner.sharedOutcome as Record<string, unknown>).impact as Record<string, unknown>).forwardRollPotentialYards = Number.NaN; }],
    ["JSON null impact potential", (owner: Record<string, unknown>) => { ((owner.sharedOutcome as Record<string, unknown>).impact as Record<string, unknown>).forwardRollPotentialYards = null; }],
    ["null motion", (owner: Record<string, unknown>) => { (owner.sharedOutcome as Record<string, unknown>).motion = null; }],
    ["missing motion", (owner: Record<string, unknown>) => { delete (owner.sharedOutcome as Record<string, unknown>).motion; }],
    ["null style", (owner: Record<string, unknown>) => { owner.shotStyle = null; }],
    ["wrong dispersion owner seed", (owner: Record<string, unknown>) => { ((owner.sharedOutcome as Record<string, unknown>).appliedDispersion as Record<string, unknown>).seed = 77; }],
    ["wrong dispersion owner club", (owner: Record<string, unknown>) => { ((owner.sharedOutcome as Record<string, unknown>).appliedDispersion as Record<string, unknown>).clubId = "putter"; }],
    ["malformed nested wind", (owner: Record<string, unknown>) => { (owner.sharedOutcome as Record<string, unknown>).appliedWind = null; }],
  ] as const)("rejects %s instead of discarding the modern certificate", (_name, mutate) => {
    const { snapshot, owner } = retainedSnapshot();
    mutate(owner as unknown as Record<string, unknown>);
    expect(restoreLiveSimulation(snapshot) === null).toBe(true);
  });

  it.each(["null", "missing"] as const)("rejects a %s segment motion with retained shot association", (kind) => {
    const { snapshot, segment } = retainedSnapshot();
    if (kind === "null") Object.assign(segment, { motion: null });
    else delete segment.motion;
    expect(restoreLiveSimulation(snapshot) === null).toBe(true);
  });

  it("rejects an unsupported model even when segment and outcome claim the same version", () => {
    const { snapshot, owner, segment } = retainedSnapshot();
    owner.sharedOutcome!.motion!.identity.modelVersion = "club_styles_v999";
    segment.motion!.identity.modelVersion = "club_styles_v999";
    expect(restoreLiveSimulation(snapshot) === null).toBe(true);
  });

  it("requires exactly one associated segment for a retained outcome", () => {
    const { snapshot, segment } = retainedSnapshot();
    snapshot.state.golfers[0].segments.push(structuredClone(segment));
    expect(restoreLiveSimulation(snapshot) === null).toBe(true);
  });

  it("retains valid canonical authority and accepts genuinely absent historical carriers", () => {
    const { snapshot } = retainedSnapshot();
    expect(restoreLiveSimulation(snapshot)).not.toBeNull();
    const old = structuredClone(snapshot);
    for (const golfer of old.state.golfers) {
      delete golfer.lastMotionSegmentIndex;
      for (const segment of golfer.segments) {
        delete segment.motion; delete segment.shotId; delete segment.motionContactTerrain;
      }
      for (const owner of golfer.shotOutcomes ?? []) {
        delete owner.shotStyle;
        if (owner.sharedOutcome) { delete owner.sharedOutcome.motion; delete owner.sharedOutcome.impact; }
      }
    }
    expect(restoreLiveSimulation(old)).not.toBeNull();
  });
});
