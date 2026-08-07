import { describe, expect, it } from "vitest";
import type { InventoryItem, PlayerInventory } from "./types";
import {
  acceptChallengeContract,
  compareChallengeBundleValues,
  evaluateChallengeContract,
  type ChallengeContractPartyConfirmation,
  type ChallengeContractProposal,
} from "./challengeContracts";

function item(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: "ordinary-club",
    definitionId: "ordinary-club-definition",
    name: "Ordinary Club",
    category: "club",
    ownerId: "player-captain",
    custodianId: "player-captain",
    authoredValue: 200,
    remainingValue: 200,
    prestige: 20,
    unique: false,
    confirmationRequired: false,
    transferable: true,
    transferHistory: [],
    ...overrides,
  };
}

function inventory(ownerId: string, items: readonly InventoryItem[], escrowItemIds: readonly string[] = []): PlayerInventory {
  return { version: 1, ownerId, items, escrowItemIds, displayItemIds: [] };
}

function proposal(args: {
  playerItems?: readonly InventoryItem[];
  playerItemIds?: readonly string[];
  playerCash?: number;
  playerAvailableCash?: number;
  rivalItems?: readonly InventoryItem[];
  rivalItemIds?: readonly string[];
  rivalCash?: number;
  rivalAvailableCash?: number;
  playerEscrow?: readonly string[];
  nonTransferableKinds?: ChallengeContractProposal["parties"][number]["bundle"]["nonTransferableKinds"];
} = {}): ChallengeContractProposal {
  const playerCash = args.playerCash ?? 10_000;
  const rivalCash = args.rivalCash ?? 10_000;
  return {
    id: "contract-stable-725",
    // Rival-first input proves evaluation does not confuse authored side identity with array position.
    parties: [
      {
        id: "party-rival-stable",
        side: "rival",
        captainId: "rival-captain",
        availableCash: args.rivalAvailableCash ?? rivalCash + 25,
        inventory: inventory("rival-captain", args.rivalItems ?? []),
        bundle: { cash: rivalCash, itemIds: args.rivalItemIds ?? [] },
      },
      {
        id: "party-player-stable",
        side: "player",
        captainId: "player-captain",
        availableCash: args.playerAvailableCash ?? playerCash + 25,
        inventory: inventory("player-captain", args.playerItems ?? [], args.playerEscrow),
        bundle: { cash: playerCash, itemIds: args.playerItemIds ?? [], nonTransferableKinds: args.nonTransferableKinds },
      },
    ],
    terms: {
      format: { teamFormat: "four-ball", scoring: "net-match" },
      teams: [
        { id: "team-player-stable", partyId: "party-player-stable", captainId: "player-captain", partnerIds: ["player-partner"] },
        { id: "team-rival-stable", partyId: "party-rival-stable", captainId: "rival-captain", partnerIds: ["rival-partner"] },
      ],
      participantSetups: [
        { participantId: "player-captain", teeSet: "member", pinRotation: "A" },
        { participantId: "player-partner", teeSet: "forward", pinRotation: "B" },
        { participantId: "rival-captain", teeSet: "championship", pinRotation: "C" },
        { participantId: "rival-partner", teeSet: "member", pinRotation: "A" },
      ],
      sideBets: [
        { id: "side-bet-stable", kind: "closest-to-pin", stake: 25, holeIds: ["h-7", "h-14"] },
      ],
    },
  };
}

function emptyConfirmations(): ChallengeContractPartyConfirmation[] {
  return [
    { partyId: "party-player-stable", ownerId: "player-captain", ownerConfirmedItemIds: [], prestigeConfirmedItemIds: [] },
    { partyId: "party-rival-stable", ownerId: "rival-captain", ownerConfirmedItemIds: [], prestigeConfirmedItemIds: [] },
  ];
}

describe("ZK-725 Packet A challenge contract authority", () => {
  it.each([
    [8_001, 19.99, true],
    [8_000, 20, true],
    [7_999, 20.01, false],
  ])("uses the exact symmetric max-value tolerance at a %s rival value", (rivalValue, percent, eligible) => {
    const playerHigh = compareChallengeBundleValues("player", 10_000, "rival", rivalValue);
    const rivalHigh = compareChallengeBundleValues("player", rivalValue, "rival", 10_000);
    expect(playerHigh.valueDifferencePercent).toBeCloseTo(percent, 10);
    expect(rivalHigh.valueDifferencePercent).toBeCloseTo(percent, 10);
    expect(playerHigh.withinTolerance).toBe(eligible);
    expect(rivalHigh.withinTolerance).toBe(eligible);
    expect(playerHigh.cashBalancingAmount).toBe(10_000 - rivalValue);
    expect(playerHigh.cashBalancingPartyId).toBe("rival");
    expect(rivalHigh.cashBalancingPartyId).toBe("player");
  });

  it("reports precise signed/absolute differences and rejects acceptance at 20.01%", () => {
    const input = proposal({ playerCash: 10_000, rivalCash: 7_999 });
    const evaluated = evaluateChallengeContract(input, { week: 8, day: 2 });
    expect(evaluated.valueComparison).toMatchObject({
      playerMinusRivalValue: 2_001,
      absoluteValueDifference: 2_001,
      cashBalancingAmount: 2_001,
      cashBalancingPartyId: "party-rival-stable",
      withinTolerance: false,
    });
    expect(() => acceptChallengeContract(input, emptyConfirmations(), { week: 8, day: 2 })).toThrow("must add 2001 cash");
  });

  it("reserves side-bet stakes per captain without distorting bundle appraisal", () => {
    const exactlyFunded = proposal({ playerCash: 10_000, rivalCash: 10_000, playerAvailableCash: 10_025, rivalAvailableCash: 10_025 });
    const evaluated = evaluateChallengeContract(exactlyFunded, { week: 8, day: 2 });
    expect(evaluated.parties.map((party) => ({
      id: party.id,
      bundleValue: party.bundle.totalValue,
      sideBetCashExposure: party.sideBetCashExposure,
      totalCashExposure: party.totalCashExposure,
    }))).toEqual([
      { id: "party-player-stable", bundleValue: 10_000, sideBetCashExposure: 25, totalCashExposure: 10_025 },
      { id: "party-rival-stable", bundleValue: 10_000, sideBetCashExposure: 25, totalCashExposure: 10_025 },
    ]);
    expect(() => evaluateChallengeContract(proposal({ playerAvailableCash: 10_024 }), { week: 8, day: 2 })).toThrow("bundle cash plus side-bet exposure");
    const zeroStake = proposal();
    (zeroStake.terms.sideBets[0] as { stake: number }).stake = 0;
    expect(() => evaluateChallengeContract(zeroStake, { week: 8, day: 2 })).toThrow("positive per-captain stake");
  });

  it("requires owner confirmation for every item and a separate prestige confirmation", () => {
    const ordinary = item({ authoredValue: 100, remainingValue: 100 });
    const unique = item({ id: "unique-trophy", definitionId: "unique-trophy-definition", name: "Unique Trophy", category: "trophy", authoredValue: 400, remainingValue: 400, prestige: 10, unique: true, confirmationRequired: true });
    const prestigious = item({ id: "prestige-watch", definitionId: "prestige-watch-definition", name: "Prestige Watch", category: "watch", authoredValue: 500, remainingValue: 500, prestige: 75 });
    const input = proposal({ playerItems: [ordinary, unique, prestigious], playerItemIds: [ordinary.id, unique.id, prestigious.id], playerCash: 0, rivalCash: 1_000 });
    const evaluated = evaluateChallengeContract(input, { week: 4, day: 1 });
    expect(evaluated.parties[0]).toMatchObject({ id: "party-player-stable", bundle: {
      totalValue: 1_000,
      requiredOwnerConfirmationItemIds: ["ordinary-club", "unique-trophy", "prestige-watch"],
      requiredPrestigeConfirmationItemIds: ["unique-trophy", "prestige-watch"],
    } });

    const confirmations = emptyConfirmations();
    confirmations[0] = {
      ...confirmations[0],
      ownerId: "player-partner",
      ownerConfirmedItemIds: [ordinary.id, unique.id, prestigious.id],
      prestigeConfirmedItemIds: [unique.id, prestigious.id],
    };
    expect(() => acceptChallengeContract(input, confirmations, { week: 4, day: 1 })).toThrow("owning captain");
    confirmations[0] = { ...confirmations[0], ownerId: "player-captain", ownerConfirmedItemIds: [ordinary.id], prestigeConfirmedItemIds: [] };
    expect(() => acceptChallengeContract(input, confirmations, { week: 4, day: 1 })).toThrow("Every transferable career item");
    confirmations[0] = { ...confirmations[0], ownerConfirmedItemIds: [ordinary.id, unique.id, prestigious.id] };
    expect(() => acceptChallengeContract(input, confirmations, { week: 4, day: 1 })).toThrow("distinct second confirmation");
    confirmations[0] = { ...confirmations[0], prestigeConfirmedItemIds: [unique.id, prestigious.id] };
    const accepted = acceptChallengeContract(input, confirmations, { week: 4, day: 1 });
    expect(accepted.parties[0].bundle).toMatchObject({
      ownerConfirmedItemIds: [ordinary.id, unique.id, prestigious.id],
      prestigeConfirmedItemIds: [unique.id, prestigious.id],
    });
  });

  it("preserves stable IDs and freezes detached appraisal, setup, team, and side-bet inputs", () => {
    const ordinary = item({ authoredValue: 1_000, remainingValue: 1_000 });
    const input = proposal({ playerItems: [ordinary], playerItemIds: [ordinary.id], playerCash: 0, rivalCash: 1_000 });
    const confirmations = emptyConfirmations();
    confirmations[0] = { ...confirmations[0], ownerConfirmedItemIds: [ordinary.id] };
    const accepted = acceptChallengeContract(input, confirmations, { week: 6, day: 3 });

    expect(accepted).toMatchObject({
      id: "contract-stable-725",
      acceptedAt: { week: 6, day: 3 },
      parties: [
        { id: "party-player-stable", captainId: "player-captain", teamId: "team-player-stable" },
        { id: "party-rival-stable", captainId: "rival-captain", teamId: "team-rival-stable" },
      ],
      terms: { sideBets: [{ id: "side-bet-stable" }] },
    });
    ordinary.authoredValue = 9_999;
    ordinary.unique = true;
    ordinary.prestige = 100;
    ordinary.custodianId = "someone-else";
    (input.terms.participantSetups[0] as { teeSet: string }).teeSet = "forward";
    (input.terms.teams[0].partnerIds as string[])[0] = "changed-partner";
    (input.terms.sideBets[0].holeIds as string[]).push("h-18");
    expect(accepted.parties[0].bundle.appraisal[0]).toMatchObject({ value: 1_000, basis: { authoredValue: 1_000 }, frozenWeek: 6, frozenDay: 3 });
    expect(accepted.parties[0].bundle.itemEligibility[0]).toMatchObject({ ownerId: "player-captain", custodianId: "player-captain", unique: false, prestige: 20, escrowed: false });
    expect(accepted.terms.participantSetups.find((setup) => setup.participantId === "player-captain")).toMatchObject({ teeSet: "member", pinRotation: "A" });
    expect(accepted.terms.teams[0].partnerIds).toEqual(["player-partner"]);
    expect(accepted.terms.sideBets[0].holeIds).toEqual(["h-7", "h-14"]);
    expect(Object.isFrozen(accepted)).toBe(true);
    expect(Object.isFrozen(accepted.terms.participantSetups[0])).toBe(true);
    expect(Object.isFrozen(accepted.parties[0].bundle.appraisal[0].basis)).toBe(true);
  });

  it.each([
    ["wrong owner", item({ ownerId: "somebody-else" }), [], /wrong owner/],
    ["teammate property", item({ ownerId: "player-partner", custodianId: "player-partner" }), [], /teammate property/],
    ["wrong custodian or held", item({ custodianId: "rival-captain" }), [], /wrong custodian|held/],
    ["escrowed", item(), ["ordinary-club"], /escrowed/],
    ["non-transferable inventory item", item({ transferable: false as unknown as true }), [], /non-transferable/],
  ])("rejects %s items before acceptance", (_label, candidate, escrow, message) => {
    const input = proposal({ playerItems: [candidate], playerItemIds: [candidate.id], playerCash: 0, rivalCash: candidate.authoredValue, playerEscrow: escrow });
    expect(() => evaluateChallengeContract(input, { week: 1, day: 0 })).toThrow(message);
  });

  it("rejects non-transferable career kinds and duplicate bundle or inventory item IDs", () => {
    expect(() => evaluateChallengeContract(proposal({ nonTransferableKinds: ["learned-technique"] }), { week: 1, day: 0 })).toThrow("Non-transferable career");
    const duplicateBundle = proposal({ playerItems: [item()], playerItemIds: ["ordinary-club", "ordinary-club"], playerCash: 0, rivalCash: 400 });
    expect(() => evaluateChallengeContract(duplicateBundle, { week: 1, day: 0 })).toThrow(/duplicate.*IDs/i);
    const duplicateInventory = proposal({ playerItems: [item(), item()], playerItemIds: ["ordinary-club"], playerCash: 0, rivalCash: 200 });
    expect(() => evaluateChallengeContract(duplicateInventory, { week: 1, day: 0 })).toThrow(/duplicate.*IDs/i);
  });

  it("enforces captain-to-captain team ownership and complete participant setup", () => {
    const wrongCaptain = proposal();
    (wrongCaptain.terms.teams[0] as { captainId: string }).captainId = "player-partner";
    expect(() => evaluateChallengeContract(wrongCaptain, { week: 1, day: 0 })).toThrow("captain-to-captain");

    const missingSetup = proposal();
    (missingSetup.terms.participantSetups as unknown as Array<unknown>).pop();
    expect(() => evaluateChallengeContract(missingSetup, { week: 1, day: 0 })).toThrow("cover every golfer exactly once");
  });
});
