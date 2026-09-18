import { advanceGolfer } from "../live/golfer";
import { createRenderPerfLiveState } from "../live/simulation";
import type { LiveState } from "../live/types";
import { findWalkPathCells } from "../live/walkPath";
import type { Course, World } from "../models/types";
import { createBiomeAuthoringReferenceCourse } from "./biomeAuthoring";

export const ZK330_TRAVERSAL = Object.freeze([
  { label: "flat-fairway", x: 20, y: 20, terrain: "fairway", elevation: 0, progress: 0 },
  { label: "gentle-rough-slope", x: 21, y: 20, terrain: "rough", elevation: 1, progress: .25 },
  { label: "crest-fairway", x: 22, y: 20, terrain: "fairway", elevation: 2, progress: .5 },
  { label: "basin-rough", x: 23, y: 20, terrain: "rough", elevation: 0, progress: .75 },
  { label: "green-destination", x: 24, y: 20, terrain: "green", elevation: 1, progress: 1 },
] as const);

export function createZk330GroundingCourse(): Course {
  const base = createBiomeAuthoringReferenceCourse("parkland");
  const tiles = [...base.tiles];
  const elevations = [...base.elevations];
  for (const sample of ZK330_TRAVERSAL) {
    tiles[sample.y * base.width + sample.x] = sample.terrain;
    elevations[sample.y * base.width + sample.x] = sample.elevation;
  }
  for (let y = 0; y < base.height; y++) tiles[y * base.width + 42] = "water";
  return {
    ...base,
    name: "ZK-330 Grounded Golfer Traverse",
    tiles,
    elevations,
    decorations: [...(base.decorations ?? []), { kind: "bridge", x: 41, y: 32, rotation: 0, span: 1 }],
  };
}

export function zk330BankEvidence(course: Course) {
  const valid = findWalkPathCells(course, { x: 40, y: 32 }, { x: 44, y: 32 });
  const blocked = findWalkPathCells({ ...course, decorations: (course.decorations ?? []).filter((decoration) => decoration.kind !== "bridge") }, { x: 40, y: 32 }, { x: 44, y: 32 });
  return {
    validBridgeCrossing: valid?.some((point) => point.x === 42 && point.y === 32) ?? false,
    blockedWaterBank: blocked === null,
  };
}

export function createZk330GroundingLiveState(course: Course, world: World, progress: number): LiveState {
  const state = createRenderPerfLiveState(course, world);
  const template = state.golfers[0];
  const from: { x: number; y: number } = { x: ZK330_TRAVERSAL[0].x, y: ZK330_TRAVERSAL[0].y };
  const to: { x: number; y: number } = { x: ZK330_TRAVERSAL.at(-1)!.x, y: ZK330_TRAVERSAL.at(-1)!.y };
  const duration = 100;
  const golfer = {
    ...template,
    id: 330,
    name: "ZK-330 Grounding Golfer",
    color: "#38bdf8",
    segments: [{ kind: "walk" as const, from, to, dur: duration, holeIndex: -1 }],
    segIndex: 0,
    segElapsed: 0,
    pos: from,
    ball: null,
    currentHole: -1,
    holeIds: [],
    holePar: [],
    holeStrokes: [],
  };
  const clampedProgress = Math.max(0, Math.min(1, progress));
  advanceGolfer(golfer, clampedProgress * duration, course.condition);
  // The simulation correctly advances a segment boundary before its next
  // partial tick; this capture fixture makes that terminal render position
  // explicit so the destination remains visible in the end-state PNG.
  if (clampedProgress === 1) golfer.pos = { ...to };
  state.golfers = [golfer];
  state.arrivals = [];
  state.nextArrivalIdx = 0;
  state.roundsStarted = 1;
  return state;
}

export function createZk330GroundingPausedLiveState(course: Course, world: World): LiveState {
  const state = createZk330GroundingLiveState(course, world, .5);
  const golfer = state.golfers[0];
  golfer.segments = [{ kind: "pause", from: { ...golfer.pos }, to: { ...golfer.pos }, dur: 100, holeIndex: -1 }];
  golfer.segIndex = 0;
  golfer.segElapsed = 50;
  return state;
}
