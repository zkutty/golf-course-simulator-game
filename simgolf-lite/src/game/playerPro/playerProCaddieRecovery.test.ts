import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import type { Course } from "../models/types";
import { caddieRecommendation, commitPlayerShot, createDefaultPlayerPro, finishPlayerShot, startPlayableRound } from "./playerPro";

function fixture() {
  const width = 24;
  const height = 18;
  const tiles = Array(width * height).fill("fairway");
  for (let y = 7; y <= 9; y++) for (let x = 9; x <= 11; x++) tiles[y * width + x] = "green";
  const holes = Array.from({ length: 3 }, (_, index) => ({ id: `recovery-${index}`, tee: { x: 2, y: 8 }, green: { x: 10, y: 8 }, parMode: "MANUAL" as const, parManual: 4 as const }));
  const course: Course = { name: "Caddie tree recovery", width, height, tiles, elevations: Array(width * height).fill(0),
    holes, obstacles: [{ type: "tree", x: 7, y: 8 }], buildings: [], yardsPerTile: 10, baseGreenFee: 60, condition: .9,
    layouts: [{ id: "recovery", name: "Tree recovery", draftHoleIds: holes.map((hole) => hole.id), publishedHoleIds: holes.map((hole) => hole.id), roundLength: 9, state: "open", greenFee: 0, legacyPartial: true }], activeCourseId: "recovery" };
  const career = createDefaultPlayerPro({ seed: 360037 });
  const started = startPlayableRound({ course, world: { ...DEFAULT_WORLD, runSeed: 360037, playerPro: career }, layoutId: "recovery" });
  if (!started.ok) throw new Error(started.reason);
  return { career, round: { ...started.round, ball: { x: 6.856643, y: 8.177167 }, lie: "fairway" } };
}

describe("modern caddie obstacle recovery", () => {
  it("escapes an initially overlapped trunk outward before attempting the green", () => {
    const { career, round } = fixture();
    const selection = caddieRecommendation(round, career.skills);
    const radialX = round.ball.x - 7;
    const radialY = round.ball.y - 8;
    expect((selection.aim.x - round.ball.x) * radialX + (selection.aim.y - round.ball.y) * radialY).toBeGreaterThan(0);
    const pending = commitPlayerShot(round, career.skills, selection);
    expect(pending.phase).toBe("flight");
    const shot = pending.pendingShot!;
    expect(Math.hypot(shot.rest.x - round.ball.x, shot.rest.y - round.ball.y)).toBeGreaterThan(.5);
    expect(shot.sharedOutcome?.collision.kind).not.toBe("obstacle");
    const next = finishPlayerShot(pending);
    const approach = caddieRecommendation(next, career.skills);
    expect(approach).not.toEqual(selection);
  });

  it("does not reveal or optimize against the next committed RNG sample", () => {
    const { career, round } = fixture();
    const before = JSON.stringify(round);
    const expected = caddieRecommendation(round, career.skills);
    for (const rngSeed of [1, 1234, 4294967000]) {
      expect(caddieRecommendation({ ...round, rngSeed, rngCursor: 97 }, career.skills)).toEqual(expected);
    }
    expect(JSON.stringify(round)).toBe(before);
  });

  it("plans clear centerlines around an obstructed direct route", () => {
    const { career, round } = fixture();
    const from = { ...round, ball: { x: 5, y: 8 } };
    const selection = caddieRecommendation(from, career.skills);
    const pending = commitPlayerShot(from, career.skills, selection);
    expect(pending.phase).toBe("flight");
    expect(pending.pendingShot?.sharedOutcome?.collision.kind).not.toBe("obstacle");
    expect(Math.hypot(pending.pendingShot!.rest.x - from.ball.x, pending.pendingShot!.rest.y - from.ball.y)).toBeGreaterThan(.5);
  });
});
