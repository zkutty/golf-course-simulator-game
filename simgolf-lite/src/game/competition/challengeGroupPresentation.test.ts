import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import { createRenderPerfCourse } from "../testing/referenceCourse";
import { caddieRecommendation, createDefaultPlayerPro, startPlayableRound } from "../playerPro/playerPro";
import { challengeGroupPlayerRound, challengeGroupPlayerSkills, commitChallengeGroupPlayerShot, decodeChallengeGroupRound, startChallengeGroupRound, type ChallengeGroupRound } from "./challengeGroupRound";
import { challengeGroupFeaturedShot, challengeGroupPresentationRound, checkpointChallengeGroupPresentation, createChallengeGroupPresentation, isChallengeGroupPresentation, skipChallengeGroupPresentation } from "./challengeGroupPresentation";

function fixture() {
  const base = createRenderPerfCourse("parkland");
  const holes = base.holes.slice(0, 9).map((hole, index) => ({ ...hole, id: `group-hole-${index + 1}`,
    teeBoxes: { member: hole.tee }, pinPositions: { A: hole.green }, parByTee: { member: { mode: "MANUAL" as const, par: 5 as const } } }));
  const ids = holes.map((hole) => hole.id);
  const layout = { id: "group-fixture", name: "Group fixture", draftHoleIds: ids, publishedHoleIds: ids, roundLength: 9 as const, state: "open" as const, greenFee: 0 };
  const course = { ...base, holes, layouts: [layout], activeCourseId: layout.id };
  const career = createDefaultPlayerPro({ seed: 1409 });
  const result = startPlayableRound({ course, world: { ...DEFAULT_WORLD, playerPro: career }, layoutId: layout.id });
  if (!result.ok) throw new Error(result.reason);
  return startChallengeGroupRound({ id: "group-1409", course: result.round.course, teeSet: result.round.teeSet, pinRotation: result.round.pinRotation,
    participants: ["a", "b", "c", "d"].map((id, index) => ({ id, name: id, controller: index === 1 ? "player" : "ai", skills: career.skills, handicapIndex: 10 })),
    scoringMode: "gross-stroke", rngSeed: 1409, startedWeek: 1, startedDay: 2 });
}
function commit(round: ChallengeGroupRound) {
  const view = challengeGroupPlayerRound(round)!;
  return commitChallengeGroupPlayerShot(round, round.playerGolferId, caddieRecommendation(view, challengeGroupPlayerSkills(round)));
}

describe("bounded ChallengeGroup retained presentation", () => {
  it("features actual newly committed turns for every participant without changing any result evidence", () => {
    const before = fixture();
    let after = before;
    for (let index = 0; index < 8; index++) after = commit(after);
    const original = JSON.stringify(after);
    const display = createChallengeGroupPresentation(before, after);
    expect(JSON.stringify(after)).toBe(original);
    const { presentation, ...authority } = display;
    expect(authority).toEqual(after);
    expect(presentation!.entries).toHaveLength(4);
    expect(presentation!.entries.map((entry) => after.turnEvidence[entry.turn - 1].golferId).sort()).toEqual(["a", "b", "c", "d"]);
    expect(presentation!.entries.map((entry) => entry.turn)).toEqual(presentation!.entries.map((entry) => entry.turn).sort((a, b) => a - b));
    expect(presentation!.throughTurn - presentation!.startTurn).toBeGreaterThan(4);
    expect(decodeChallengeGroupRound(JSON.stringify(display))).toMatchObject({ ok: true });
    let playing = display;
    const observed: string[] = [];
    while (challengeGroupFeaturedShot(playing)) {
      const featured = challengeGroupFeaturedShot(playing)!;
      const projection = challengeGroupPresentationRound(playing)!;
      observed.push(featured.golfer.id);
      expect(projection.pendingShot).toBe(featured.shot);
      expect(projection.ball).toEqual(featured.shot.from);
      expect(featured.plan.durationMs).toBeGreaterThanOrEqual(featured.shot.club === "Putter" ? 2400 : 6000);
      playing = checkpointChallengeGroupPresentation(playing, featured.shot.id, 1, true);
    }
    expect(observed).toHaveLength(4);
    expect(decodeChallengeGroupRound(playing)).toMatchObject({ ok: true });
    expect(challengeGroupFeaturedShot(skipChallengeGroupPresentation(display))).toBeNull();
  });

  it("resumes one strict source-owned cursor; rejects stale group, identity, turn and extra fields", () => {
    const before = fixture();
    const display = createChallengeGroupPresentation(before, commit(before));
    const featured = challengeGroupFeaturedShot(display)!;
    const checkpoint = checkpointChallengeGroupPresentation(display, featured.shot.id, .45);
    const restored = decodeChallengeGroupRound(JSON.stringify(checkpoint));
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(challengeGroupPresentationRound(restored.round)?.shotPresentation?.progress).toBeCloseTo(.45);
    expect(checkpointChallengeGroupPresentation(checkpoint, featured.shot.id, .2)).toBe(checkpoint);
    expect(checkpointChallengeGroupPresentation(checkpoint, "other", .8)).toBe(checkpoint);
    for (const patch of [{ groupId: "other" }, { throughTurn: 0 }, { index: 99 }, { extra: true },
      { entries: [] }, { entries: [{ ...display.presentation!.entries[0], cursor: { version: 1, key: "other", elapsedMs: 10 } }] }]) {
      const invalid = { ...display, presentation: { ...display.presentation!, ...patch } };
      expect(isChallengeGroupPresentation(invalid.presentation, invalid as ChallengeGroupRound)).toBe(false);
      expect(decodeChallengeGroupRound(invalid)).toMatchObject({ ok: false });
    }
    const forged = structuredClone(display);
    forged.turnEvidence = forged.turnEvidence.map((turn) => turn.turn === featured.turn.turn ? { ...turn, seed: turn.seed + 1 } : turn);
    expect(decodeChallengeGroupRound(forged)).toMatchObject({ ok: false });
  });

  it("accepts legacy in-progress saves without replaying history and starts only new turns", () => {
    const legacy = commit(fixture());
    expect(decodeChallengeGroupRound(legacy)).toMatchObject({ ok: true });
    expect(challengeGroupFeaturedShot(legacy)).toBeNull();
    expect(createChallengeGroupPresentation(legacy, legacy)).toBe(legacy);
    const next = createChallengeGroupPresentation(legacy, commit(legacy));
    expect(next.presentation!.entries.every((entry) => entry.turn > legacy.turnEvidence.length)).toBe(true);
  });
});
