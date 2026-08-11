import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import { createRenderPerfCourse } from "../testing/referenceCourse";
import { activeCourseLayout, normalizeCourseLayouts } from "../models/courseLayouts";
import { normalizeLivingClub } from "../livingClub/livingClub";
import type { RegularGolfer } from "../livingClub/types";
import { assignPersonProfile } from "../competition/characters";
import { caddieRecommendation, createDefaultPlayerPro, normalizePlayerPro } from "./playerPro";
import { withdrawChallengeGroupGolfer } from "../competition/challengeGroupRound";
import { createZk725BrowserFixture } from "../testing/zk725BrowserFixture";
import {
  autoGroup,
  cancelPlayerChallengeContract,
  commitGroup,
  concedeGroup,
  groupView,
  playerChallengeContractRivals,
  previewPlayerChallengeContract,
  settleGroup,
  startPlayerChallengeContract,
  type PlayerChallengeContractDraft,
} from "./challengePlayerProAdapter";

function regular(id: string, name: string, skill = .62): RegularGolfer {
  const assigned = assignPersonProfile({
    id,
    kind: "regular",
    name,
    archetype: "lowHandicap",
    appearance: { portrait: "cap", palette: 0, accent: 0 },
    skill,
    preferences: { pace: "balanced", challenge: "competitive", hospitality: "club" },
    loyalty: 70,
    visits: 8,
    rounds: 5,
    bestToPar: 3,
    member: true,
    relationship: { score: 20, tier: "acquaintance", interactionIds: [] },
    memories: [],
    recentThoughts: [],
    history: [],
  }, 725_101);
  const knownHoldingIds = assigned.backstory?.holdings.map((holding) => holding.id) ?? [];
  return {
    ...assigned,
    backstory: assigned.backstory ? { ...assigned.backstory, knownHoldingIds } : assigned.backstory,
    rivalProfile: assigned.rivalProfile ? { ...assigned.rivalProfile, knownHoldingIds } : assigned.rivalProfile,
  };
}

function fixture() {
  const course = normalizeCourseLayouts(createRenderPerfCourse("parkland"));
  const living = normalizeLivingClub(DEFAULT_WORLD.livingClub);
  const world = {
    ...DEFAULT_WORLD,
    runSeed: 725_101,
    cash: 10_000,
    livingClub: { ...living, regulars: [regular("rival-one", "Rival One"), regular("partner-one", "Partner One"), regular("partner-two", "Partner Two")] },
    playerPro: createDefaultPlayerPro({ seed: 725_101, name: "Contract Player" }),
  };
  const rival = playerChallengeContractRivals(world)[0];
  const setup = { teeSet: "member" as const, pinRotation: "A" as const };
  const draft: PlayerChallengeContractDraft = {
    opponentId: rival.id,
    layoutId: activeCourseLayout(course).id,
    teamFormat: "individual",
    scoring: "net-match",
    participantSetups: { player: setup, rival: setup, playerPartner: setup, rivalPartner: setup },
    playerCash: 100,
    rivalCash: 100,
    playerItemIds: [],
    rivalItemIds: [],
    sideBets: [{ kind: "skins", stake: 25, enabled: true }],
    ownerTransfersConfirmed: true,
    prestigeTransfersConfirmed: true,
    rivalTransfersConfirmed: true,
  };
  return { course, world, rival, draft };
}

function hiddenHoldingFixture() {
  const fixture = createZk725BrowserFixture(DEFAULT_WORLD);
  const setup = { teeSet: "member" as const, pinRotation: "A" as const };
  const draft: PlayerChallengeContractDraft = {
    opponentId: "rival-one",
    layoutId: activeCourseLayout(fixture.course).id,
    teamFormat: "individual",
    scoring: "net-match",
    participantSetups: { player: setup, rival: setup },
    playerCash: 0,
    rivalCash: 0,
    playerItemIds: [],
    rivalItemIds: ["rival-unrevealed-vault"],
    sideBets: [],
    ownerTransfersConfirmed: true,
    prestigeTransfersConfirmed: true,
    rivalTransfersConfirmed: true,
  };
  return { ...fixture, draft };
}

describe("ZK-725 deferred Player Pro challenge adapter", () => {
  it("filters unrevealed holdings from player-facing rivals and rejects a direct hidden preview", () => {
    const fixture = hiddenHoldingFixture();
    expect(JSON.stringify(playerChallengeContractRivals(fixture.world))).not.toContain("UNREVEALED RIVAL VAULT");
    expect(() => previewPlayerChallengeContract({ course: fixture.course, world: fixture.world, day: 2, draft: fixture.draft }))
      .toThrow("The selected rival holding has not been revealed.");
  });

  it("rejects a direct hidden holding start before contract authority", () => {
    const fixture = hiddenHoldingFixture();
    expect(() => startPlayerChallengeContract({ course: fixture.course, world: fixture.world, day: 2, draft: fixture.draft }))
      .toThrow("The selected rival holding has not been revealed.");
  });

  it("uses authored rival holdings and validates participant tee/pin choices without fallback", () => {
    const f = fixture();
    expect(f.rival.holdings.length).toBeGreaterThan(0);
    const preview = previewPlayerChallengeContract({ course: f.course, world: f.world, day: 2, draft: f.draft });
    expect(preview.evaluation.valueComparison).toMatchObject({ playerValue: 100, rivalValue: 100, withinTolerance: true });
    const invalid = { ...f.draft, participantSetups: { ...f.draft.participantSetups, rival: { teeSet: "championship" as const, pinRotation: "C" as const } } };
    expect(() => previewPlayerChallengeContract({ course: f.course, world: f.world, day: 2, draft: invalid })).toThrow("does not use fallbacks");
  });

  it.each(["four-ball", "alternate-shot", "scramble"] as const)("starts %s under the negotiated team authority and captain-owned escrow", (teamFormat) => {
    const f = fixture();
    const teamDraft = { ...f.draft, teamFormat, playerPartnerId: "partner-one", rivalPartnerId: "partner-two", sideBets: f.draft.sideBets.map((sideBet) => ({ ...sideBet, enabled: false })) };
    const started = startPlayerChallengeContract({ course: f.course, world: f.world, day: 2, draft: teamDraft });
    expect(started.career.activeChallengeGroupRound?.teamAuthority?.format).toBe(teamFormat);
    expect(started.career.activeChallengeRuntime?.phase).toBe("escrowed");
    expect(started.career.activeChallengeRuntime?.contract.terms.teams.map((team) => team.captainId)).toEqual([started.career.identity.id, f.rival.id]);
    expect(cancelPlayerChallengeContract({ world: started.world, day: 2 }).cash).toBe(f.world.cash);
  });

  it("accepts and reserves once under a persisted sequence, then cancels atomically before a shot", () => {
    const f = fixture();
    const started = startPlayerChallengeContract({ course: f.course, world: f.world, day: 2, draft: f.draft });
    expect(started.world.cash).toBe(9_875);
    expect(started.career).toMatchObject({ challengeSequence: 1, activeChallengeRuntime: { phase: "escrowed" } });
    expect(started.career.challenges[0].id).toBe("player-challenge:725101:1");
    const reloaded = normalizePlayerPro(JSON.parse(JSON.stringify(started.career)), { seed: 725_101 });
    expect(reloaded.challengeSequence).toBe(1);
    const cancelled = cancelPlayerChallengeContract({ world: started.world, day: 2 });
    expect(cancelled.cash).toBe(10_000);
    expect(cancelled.playerPro).toMatchObject({ activeChallengeRuntime: null, activeRound: null, challenges: [{ status: "declined" }] });
  });

  it("locks the first group shot and settles negotiated scoring plus side-bet evidence", () => {
    const f = fixture();
    const started = startPlayerChallengeContract({ course: f.course, world: f.world, day: 2, draft: f.draft });
    const completed = autoGroup(started.world, 2);
    expect(completed.playerPro?.activeChallengeRuntime?.phase).toBe("shot_locked");
    expect(completed.playerPro?.activeChallengeGroupRound?.phase).toBe("complete");
    const settled = settleGroup(completed, 2);
    const career = settled.playerPro!;
    expect(career.activeChallengeRuntime).toBeNull();
    const record = career.challenges.find((challenge) => challenge.challengeSettlement)!;
    expect(record.challengeSettlement?.contract.terms.format.scoring).toBe("net-match");
    expect(record.challengeSettlement?.evidence.components.find((component) => component.componentId.includes("skins"))?.evidenceIds.every((id) => id.startsWith("group:"))).toBe(true);
    expect(record.challengeSettlement?.runtime.phase).toBe("shot_locked");
  });

  it("plays an authored no-stakes rematch and atomically recovers the exact rival-custody item on a verified win", () => {
    const f = fixture();
    const rivalItem = f.rival.holdings[0];
    const playerId = f.world.playerPro!.identity.id;
    const playerItem = {
      ...rivalItem,
      id: "player-custody-stake",
      ownerId: playerId,
      custodianId: playerId,
    };
    const sourceWorld = {
      ...f.world,
      playerPro: {
        ...f.world.playerPro!,
        inventory: { ...f.world.playerPro!.inventory, items: [playerItem] },
      },
    };
    const sourceDraft: PlayerChallengeContractDraft = {
      ...f.draft,
      playerCash: 0,
      rivalCash: 0,
      playerItemIds: [playerItem.id],
      rivalItemIds: [rivalItem.id],
      sideBets: [],
    };
    const started = startPlayerChallengeContract({ course: f.course, world: sourceWorld, day: 2, draft: sourceDraft });
    const sourceView = groupView(started.career)!;
    const lockedWorld = commitGroup(started.world, caddieRecommendation(sourceView.round, sourceView.skills), 2);
    const lostWorld = concedeGroup(lockedWorld, 2);
    const custody = lostWorld.playerPro!.rivalCustody.find((entry) => entry.itemId === playerItem.id)!;
    const rematch = lostWorld.playerPro!.challenges.find((entry) => entry.id === custody.rematchChallengeId)!;
    expect(rematch.status).toBe("offered");

    const rematchDraft: PlayerChallengeContractDraft = {
      ...f.draft,
      rematchChallengeId: rematch.id,
      opponentId: rematch.opponentId,
      playerCash: 0,
      rivalCash: 0,
      playerItemIds: [],
      rivalItemIds: [],
      sideBets: [],
    };
    const replay = startPlayerChallengeContract({ course: f.course, world: lostWorld, day: 3, draft: rematchDraft });
    expect(replay.career.challenges.find((entry) => entry.id === rematch.id)).toMatchObject({ status: "active", rematch: { activeContractId: "player-challenge:725101:2" } });
    const replayView = groupView(replay.career)!;
    const replayLocked = commitGroup(replay.world, caddieRecommendation(replayView.round, replayView.skills), 3);
    const replayCareer = replayLocked.playerPro!;
    const rivalGolfer = replayCareer.activeChallengeGroupRound!.golfers.find((golfer) => golfer.id !== replayCareer.identity.id)!;
    const rivalWithdrawn = withdrawChallengeGroupGolfer(replayCareer.activeChallengeGroupRound!, rivalGolfer.id, "Authored custody rematch withdrawal fixture.");
    const completedWin = autoGroup({ ...replayLocked, playerPro: { ...replayCareer, activeChallengeGroupRound: rivalWithdrawn } }, 3);
    const recoveredWorld = settleGroup(completedWin, 3);
    expect(recoveredWorld.playerPro!.rivalCustody.find((entry) => entry.id === custody.id)?.status).toBe("recovered");
    expect(recoveredWorld.playerPro!.inventory.items.filter((entry) => entry.id === playerItem.id)).toHaveLength(1);
    expect(recoveredWorld.playerPro!.challenges.find((entry) => entry.id === rematch.id)).toMatchObject({
      status: "complete",
      result: "won",
      settled: true,
      rematch: { recoveredSettlementId: `challenge-rematch-recovery:${custody.id}` },
    });
  });
});
