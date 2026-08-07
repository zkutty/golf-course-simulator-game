import { describe, expect, it } from "vitest";
import { createDefaultPlayerPro, normalizePlayerPro } from "../playerPro/playerPro";
import { acceptChallengeContract, type ChallengeContractProposal } from "./challengeContracts";
import {
  createChallengeRuntimeState,
  lockChallengeFirstShot,
  reserveChallengeAtFirstTee,
} from "./challengeRuntime";
import {
  settleChallenge,
  type ChallengeSettlementEvidence,
  type ChallengeSettlementPartyAssets,
} from "./challengeSettlement";
import { createChallengeRematchOpportunities, resolveChallengeCustodyRematch } from "./challengeRecovery";
import type { InventoryItem } from "./types";
import type { PlayerChallengeRecord, PlayerProCareer } from "../models/playerProTypes";

function item(id: string, ownerId: string, category: InventoryItem["category"] = "club"): InventoryItem {
  return {
    id,
    definitionId: `${id}-definition`,
    name: id,
    category,
    ownerId,
    custodianId: ownerId,
    authoredValue: 500,
    remainingValue: 500,
    prestige: 20,
    unique: false,
    confirmationRequired: false,
    transferable: true,
    transferHistory: [],
  };
}

function fixture(category: InventoryItem["category"] = "club") {
  const career = createDefaultPlayerPro({ seed: 725_003, name: "Settlement Tester" });
  const playerId = career.identity.id;
  const playerItem = item("player-stake", playerId, category);
  const rivalItem = item("rival-stake", "rival-captain", category);
  const proposal: ChallengeContractProposal = {
    id: `settlement-contract-${category}`,
    parties: [
      {
        id: "player-party",
        side: "player",
        captainId: playerId,
        availableCash: 5_000,
        inventory: { version: 1, ownerId: playerId, items: [playerItem], escrowItemIds: [], displayItemIds: [playerItem.id], selectedVehicleId: category === "vehicle" ? playerItem.id : undefined },
        bundle: { cash: 100, itemIds: [playerItem.id] },
      },
      {
        id: "rival-party",
        side: "rival",
        captainId: "rival-captain",
        availableCash: 5_000,
        inventory: { version: 1, ownerId: "rival-captain", items: [rivalItem], escrowItemIds: [], displayItemIds: [rivalItem.id], selectedVehicleId: category === "vehicle" ? rivalItem.id : undefined },
        bundle: { cash: 100, itemIds: [rivalItem.id] },
      },
    ],
    terms: {
      format: { teamFormat: "individual", scoring: "net-match" },
      teams: [
        { id: "player-team", partyId: "player-party", captainId: playerId, partnerIds: [] },
        { id: "rival-team", partyId: "rival-party", captainId: "rival-captain", partnerIds: [] },
      ],
      participantSetups: [
        { participantId: playerId, teeSet: "member", pinRotation: "A" },
        { participantId: "rival-captain", teeSet: "member", pinRotation: "A" },
      ],
      sideBets: [
        { id: "skins", kind: "skins", stake: 20, holeIds: [] },
        { id: "nassau", kind: "nassau", stake: 30, holeIds: [] },
      ],
    },
  };
  const contract = acceptChallengeContract(proposal, [
    { partyId: "player-party", ownerId: playerId, ownerConfirmedItemIds: [playerItem.id], prestigeConfirmedItemIds: [] },
    { partyId: "rival-party", ownerId: "rival-captain", ownerConfirmedItemIds: [rivalItem.id], prestigeConfirmedItemIds: [] },
  ], { week: 5, day: 1 });
  const parties: ChallengeSettlementPartyAssets[] = [
    {
      partyId: "player-party",
      captainId: playerId,
      captainName: career.identity.name,
      cash: 3_000,
      inventory: proposal.parties[0].inventory,
      loadout: category === "club" ? { clubItemIds: [playerItem.id] } : { clubItemIds: [] },
      rivalCustody: [],
      settlementLedger: [],
    },
    {
      partyId: "rival-party",
      captainId: "rival-captain",
      captainName: "Rival Captain",
      cash: 4_000,
      inventory: proposal.parties[1].inventory,
      loadout: category === "club" ? { clubItemIds: [rivalItem.id] } : { clubItemIds: [] },
      rivalCustody: [],
      settlementLedger: [],
    },
  ];
  const accepted = createChallengeRuntimeState(contract);
  const reserved = reserveChallengeAtFirstTee({ state: accepted, parties, transitionId: "reserve-settlement", at: { week: 5, day: 2 } });
  const locked = lockChallengeFirstShot({ state: reserved.state, transitionId: "shot-lock", shotId: "shot-1", at: { week: 5, day: 2 } });
  return {
    career,
    playerId,
    playerItem,
    rivalItem,
    state: locked,
    parties: reserved.parties.map((party, index) => ({ ...parties[index], ...party })) as ChallengeSettlementPartyAssets[],
  };
}

function evidence(
  main: "player-party" | "rival-party" | "tie" | "refund",
  skins: "player-party" | "rival-party" | "tie" | "refund" = "tie",
  nassau: "player-party" | "rival-party" | "tie" | "refund" = "refund",
  kind: ChallengeSettlementEvidence["kind"] = "completed",
): ChallengeSettlementEvidence {
  const component = (componentId: string, outcome: typeof main) => ({
    componentId,
    outcome: outcome === "tie" ? "tied" as const : outcome === "refund" ? "refunded" as const : "awarded" as const,
    ...(outcome === "player-party" || outcome === "rival-party" ? { winnerPartyId: outcome } : {}),
    ...(outcome === "refund" ? { reason: `Authoritative ${componentId} refund fixture.` } : {}),
    evidenceIds: [`evidence:${kind}:${componentId}:${outcome}`],
  });
  return {
    resolutionId: `resolution:${kind}:${main}:${skins}:${nassau}`,
    kind,
    ...(kind === "completed" ? {} : { resolvedAgainstPartyId: main === "player-party" ? "rival-party" : "player-party" }),
    components: [component("main", main), component("skins", skins), component("nassau", nassau)],
  };
}

describe("ZK-725 Packet C settlement authority", () => {
  it("allocates main and component side-bet cash independently and imports rival snapshots once", () => {
    const f = fixture();
    const result = settleChallenge({
      state: f.state,
      parties: f.parties,
      transitionId: "settle-player-win",
      at: { week: 5, day: 3 },
      evidence: evidence("player-party", "player-party", "rival-party"),
    });
    expect(result.cashChanges).toEqual([
      { partyId: "player-party", before: 2_850, delta: 240, after: 3_090 },
      { partyId: "rival-party", before: 3_850, delta: 60, after: 3_910 },
    ]);
    expect(result.parties[0].inventory.items.find((entry) => entry.id === f.rivalItem.id)).toMatchObject({ ownerId: f.playerId, custodianId: f.playerId });
    expect(result.parties[1].inventory.items.some((entry) => entry.id === f.rivalItem.id)).toBe(false);
    expect(result.settlement.transferredItems).toHaveLength(1);
    expect(result.settlement.frozenAppraisal[0].bundle.appraisal).toEqual(f.state.contract.parties[0].bundle.appraisal);
    expect(Object.isFrozen(result.settlement)).toBe(true);
  });

  it("transfers a player loss to named rival custody with deterministic loadout/display fallback", () => {
    const f = fixture();
    const result = settleChallenge({ state: f.state, parties: f.parties, transitionId: "settle-player-loss", at: { week: 5, day: 3 }, evidence: evidence("rival-party") });
    const player = result.parties[0];
    expect(player.inventory.items.some((entry) => entry.id === f.playerItem.id)).toBe(false);
    expect(player.inventory.escrowItemIds).toEqual([]);
    expect(player.inventory.displayItemIds).toEqual([]);
    expect(player.loadout.clubItemIds).toEqual([]);
    expect(player.rivalCustody[0]).toMatchObject({
      rivalId: "rival-captain",
      rivalName: "Rival Captain",
      challengeId: f.state.contract.id,
      settlementId: result.settlement.id,
      itemId: f.playerItem.id,
      status: "held",
    });
  });

  it("clears a selected staked vehicle through the frozen fallback", () => {
    const f = fixture("vehicle");
    const result = settleChallenge({ state: f.state, parties: f.parties, transitionId: "settle-vehicle-loss", at: { week: 5, day: 3 }, evidence: evidence("rival-party") });
    expect(result.parties[0].inventory.selectedVehicleId).toBeUndefined();
    expect(result.parties[0].inventory.displayItemIds).toEqual([]);
  });

  it.each([
    ["tie", evidence("tie", "tie", "tie")],
    ["refund", evidence("refund", "refund", "refund")],
  ])("returns each captain's own cash and items on main %s", (_label, resolution) => {
    const f = fixture();
    const result = settleChallenge({ state: f.state, parties: f.parties, transitionId: `settle-${_label}`, at: { week: 5, day: 3 }, evidence: resolution });
    expect(result.parties.map((party) => party.cash)).toEqual([3_000, 4_000]);
    expect(result.parties.map((party) => party.inventory.escrowItemIds)).toEqual([[], []]);
    expect(result.settlement.transferredItems).toEqual([]);
    expect(result.settlement.parties.map((party) => party.returnedItemIds)).toEqual([[f.playerItem.id], [f.rivalItem.id]]);
  });

  it.each([
    ["concession", "rival-party", "player-party"],
    ["withdrawal", "player-party", "rival-party"],
  ] as const)("requires explicit %s loser evidence and awards the main bundle to the other party", (kind, winner, loser) => {
    const f = fixture();
    const resolution = evidence(winner, "refund", "refund", kind);
    expect(resolution.resolvedAgainstPartyId).toBe(loser);
    const result = settleChallenge({ state: f.state, parties: f.parties, transitionId: `settle-${kind}`, at: { week: 5, day: 3 }, evidence: resolution });
    expect(result.settlement.evidence.kind).toBe(kind);
    expect(result.settlement.transferredItems[0].toPartyId).toBe(winner);
  });

  it("rejects incomplete, duplicated, mismatched, and mutated evidence without changing either side", () => {
    const f = fixture();
    const stateBefore = JSON.stringify(f.state);
    const partiesBefore = JSON.stringify(f.parties);
    const incomplete = { ...evidence("player-party"), components: evidence("player-party").components.slice(0, 2) };
    expect(() => settleChallenge({ state: f.state, parties: f.parties, transitionId: "settle-incomplete", at: { week: 5, day: 3 }, evidence: incomplete })).toThrow("exactly one outcome");
    const duplicateSource = evidence("player-party");
    const duplicateEvidence = {
      ...duplicateSource,
      components: duplicateSource.components.map((component, index) => index === 1
        ? { ...component, evidenceIds: duplicateSource.components[0].evidenceIds }
        : component),
    };
    expect(() => settleChallenge({ state: f.state, parties: f.parties, transitionId: "settle-duplicate", at: { week: 5, day: 3 }, evidence: duplicateEvidence })).toThrow("cannot reuse");
    const changed = f.parties.map((party, index) => index === 0 ? {
      ...party,
      inventory: { ...party.inventory, items: party.inventory.items.map((entry) => ({ ...entry, authoredValue: 501 })) },
    } : party);
    expect(() => settleChallenge({ state: f.state, parties: changed, transitionId: "settle-mutated", at: { week: 5, day: 3 }, evidence: evidence("player-party") })).toThrow("changed while reserved");
    expect(JSON.stringify(f.state)).toBe(stateBefore);
    expect(JSON.stringify(f.parties)).toBe(partiesBefore);
  });

  it("is idempotent across a JSON reload and rejects conflicting replay or post-assets", () => {
    const f = fixture();
    const resolution = evidence("player-party", "rival-party", "tie");
    const first = settleChallenge({ state: f.state, parties: f.parties, transitionId: "settle-reload", at: { week: 5, day: 3 }, evidence: resolution });
    const previous = JSON.parse(JSON.stringify(first.settlement)) as typeof first.settlement;
    const parties = JSON.parse(JSON.stringify(first.parties)) as typeof first.parties;
    const duplicate = settleChallenge({ state: previous.runtime, parties, transitionId: "settle-reload", at: { week: 5, day: 3 }, evidence: resolution, previous });
    expect(duplicate.settlement).toBe(previous);
    expect(duplicate.cashChanges.every((change) => change.delta === 0)).toBe(true);
    expect(() => settleChallenge({ state: previous.runtime, parties, transitionId: "settle-other", at: { week: 5, day: 3 }, evidence: resolution, previous })).toThrow("different transition");
    const hostile = parties.map((party, index) => index === 0 ? { ...party, cash: party.cash + 1 } : party);
    expect(() => settleChallenge({ state: previous.runtime, parties: hostile, transitionId: "settle-reload", at: { week: 5, day: 3 }, evidence: resolution, previous })).toThrow("exact previously recorded");
  });
});

describe("ZK-725 authored custody rematches", () => {
  it("persists a visible rematch, denies loss/tie recovery, recovers once on win, and retries idempotently", () => {
    const f = fixture();
    const settled = settleChallenge({ state: f.state, parties: f.parties, transitionId: "settle-custody", at: { week: 5, day: 3 }, evidence: evidence("rival-party") });
    const player = settled.parties[0];
    const sourceChallenge: PlayerChallengeRecord = {
      id: f.state.contract.id,
      opponentId: "rival-captain",
      opponentName: "Rival Captain",
      kind: "wager" as const,
      status: "complete" as const,
      relationship: 0,
      wager: 0,
      settled: true,
      challengeContractId: f.state.contract.id,
      challengeSettlement: settled.settlement,
    };
    let career: PlayerProCareer = {
      ...f.career,
      inventory: player.inventory,
      equipmentLoadout: player.loadout,
      rivalCustody: player.rivalCustody,
      settlementLedger: [...player.settlementLedger],
      activeChallengeRuntime: null,
      challenges: [sourceChallenge],
    };
    career = createChallengeRematchOpportunities(career, settled.settlement);
    const rematch = career.challenges.find((entry) => entry.rematch)!;
    expect(rematch).toMatchObject({ status: "offered", opponentName: "Rival Captain", rematch: { custodyId: player.rivalCustody[0].id, attempts: [] } });

    const lost = resolveChallengeCustodyRematch({ career, sourceSettlement: settled.settlement, rematchChallengeId: rematch.id, transitionId: "rematch-loss", evidenceId: "rematch-proof-loss", outcome: "lost", at: { week: 6, day: 1 } });
    expect(lost.recoveredItemId).toBeNull();
    expect(lost.career.rivalCustody[0].status).toBe("held");
    const tied = resolveChallengeCustodyRematch({ career: lost.career, sourceSettlement: settled.settlement, rematchChallengeId: rematch.id, transitionId: "rematch-tie", evidenceId: "rematch-proof-tie", outcome: "tied", at: { week: 6, day: 2 } });
    expect(tied.recoveredItemId).toBeNull();
    expect(tied.career.inventory.items.some((entry) => entry.id === f.playerItem.id)).toBe(false);
    const wonArgs = { career: tied.career, sourceSettlement: settled.settlement, rematchChallengeId: rematch.id, transitionId: "rematch-win", evidenceId: "rematch-proof-win", outcome: "won" as const, at: { week: 6, day: 3 } };
    const won = resolveChallengeCustodyRematch(wonArgs);
    expect(won.recoveredItemId).toBe(f.playerItem.id);
    expect(won.career.inventory.items.find((entry) => entry.id === f.playerItem.id)).toMatchObject({ ownerId: f.playerId, custodianId: f.playerId });
    expect(won.career.rivalCustody[0]).toMatchObject({ status: "recovered", recoveredWeek: 6, recoveredDay: 3 });
    expect(won.career.challenges.find((entry) => entry.id === rematch.id)).toMatchObject({ status: "complete", result: "won", settled: true });
    const retry = resolveChallengeCustodyRematch({ ...wonArgs, career: won.career });
    expect(retry.career).toBe(won.career);
    expect(() => resolveChallengeCustodyRematch({ ...wonArgs, career: won.career, outcome: "lost" })).toThrow("conflicting transition");

    const normalized = normalizePlayerPro(JSON.parse(JSON.stringify(won.career)), { seed: 725_003 });
    expect(normalized.challenges.find((entry) => entry.id === rematch.id)?.rematch?.attempts).toHaveLength(3);
    expect(normalized.rivalCustody[0].status).toBe("recovered");
  });
});
