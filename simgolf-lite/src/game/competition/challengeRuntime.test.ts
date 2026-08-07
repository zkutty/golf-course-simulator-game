import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import { createDefaultPlayerPro, normalizePlayerPro } from "../playerPro/playerPro";
import { CURRENT_SAVE_SCHEMA_VERSION, normalizeLoadedSaveResult, payloadForPersistence } from "../../utils/save";
import { acceptChallengeContract, type ChallengeContractProposal } from "./challengeContracts";
import {
  cancelChallengeBeforeFirstShot,
  createChallengeRuntimeState,
  lockChallengeFirstShot,
  reserveChallengeAtFirstTee,
  type ChallengeLivePartyAssets,
} from "./challengeRuntime";
import { decodeChallengeRuntimeState, encodeChallengeRuntimeState } from "./challengeRuntimeCodec";
import type { InventoryItem } from "./types";

function item(id: string, ownerId: string, category: InventoryItem["category"], value = 500): InventoryItem {
  return {
    id,
    definitionId: `${id}-definition`,
    name: id,
    category,
    ownerId,
    custodianId: ownerId,
    authoredValue: value,
    remainingValue: value,
    prestige: 20,
    unique: false,
    confirmationRequired: false,
    transferable: true,
    transferHistory: [],
    modifiers: category === "club" ? [{ channel: "dispersion", multiplier: .95, context: "standard-full-shot" }] : undefined,
  };
}

function acceptedContract(playerId: string) {
  const playerItem = item("player-club", playerId, "club");
  const rivalItem = item("rival-watch", "rival-captain", "watch");
  const proposal: ChallengeContractProposal = {
    id: "runtime-contract-725",
    parties: [
      {
        id: "player-party",
        side: "player",
        captainId: playerId,
        availableCash: 5_000,
        inventory: { version: 1, ownerId: playerId, items: [playerItem], escrowItemIds: [], displayItemIds: [] },
        bundle: { cash: 1_000, itemIds: [playerItem.id] },
      },
      {
        id: "rival-party",
        side: "rival",
        captainId: "rival-captain",
        availableCash: 5_000,
        inventory: { version: 1, ownerId: "rival-captain", items: [rivalItem], escrowItemIds: [], displayItemIds: [] },
        bundle: { cash: 1_000, itemIds: [rivalItem.id] },
      },
    ],
    terms: {
      format: { teamFormat: "four-ball", scoring: "net-match" },
      teams: [
        { id: "player-team", partyId: "player-party", captainId: playerId, partnerIds: ["player-partner"] },
        { id: "rival-team", partyId: "rival-party", captainId: "rival-captain", partnerIds: ["rival-partner"] },
      ],
      participantSetups: [
        { participantId: playerId, teeSet: "member", pinRotation: "A" },
        { participantId: "player-partner", teeSet: "forward", pinRotation: "B" },
        { participantId: "rival-captain", teeSet: "championship", pinRotation: "C" },
        { participantId: "rival-partner", teeSet: "member", pinRotation: "A" },
      ],
      sideBets: [{ id: "runtime-skins", kind: "skins", stake: 25, holeIds: [] }],
    },
  };
  return {
    contract: acceptChallengeContract(proposal, [
      { partyId: "player-party", ownerId: playerId, ownerConfirmedItemIds: [playerItem.id], prestigeConfirmedItemIds: [] },
      { partyId: "rival-party", ownerId: "rival-captain", ownerConfirmedItemIds: [rivalItem.id], prestigeConfirmedItemIds: [] },
    ], { week: 3, day: 2 }),
    playerItem,
    rivalItem,
  };
}

function liveParties(playerId: string, playerItem: InventoryItem, rivalItem: InventoryItem): ChallengeLivePartyAssets[] {
  return [
    {
      partyId: "player-party",
      captainId: playerId,
      cash: 3_000,
      inventory: { version: 1, ownerId: playerId, items: [playerItem], escrowItemIds: [], displayItemIds: [] },
      loadout: { clubItemIds: [playerItem.id] },
    },
    {
      partyId: "rival-party",
      captainId: "rival-captain",
      cash: 4_000,
      inventory: { version: 1, ownerId: "rival-captain", items: [rivalItem], escrowItemIds: [], displayItemIds: [] },
      loadout: { clubItemIds: [], watchItemId: rivalItem.id },
    },
  ];
}

function setup() {
  const career = createDefaultPlayerPro({ seed: 725_002, name: "Escrow Tester" });
  const fixture = acceptedContract(career.identity.id);
  return {
    career,
    ...fixture,
    state: createChallengeRuntimeState(fixture.contract),
    parties: liveParties(career.identity.id, fixture.playerItem, fixture.rivalItem),
  };
}

describe("ZK-725 Packet B challenge runtime and escrow", () => {
  it("atomically reserves both captain exposures and freezes full Packet C evidence", () => {
    const fixture = setup();
    const result = reserveChallengeAtFirstTee({ state: fixture.state, parties: fixture.parties, transitionId: "reserve-1", at: { week: 3, day: 3 } });
    expect(result.state.phase).toBe("escrowed");
    expect(result.cashChanges).toEqual([
      { partyId: "player-party", before: 3_000, delta: -1_025, after: 1_975 },
      { partyId: "rival-party", before: 4_000, delta: -1_025, after: 2_975 },
    ]);
    expect(result.parties.map((party) => ({ id: party.partyId, cash: party.cash, escrow: party.inventory.escrowItemIds }))).toEqual([
      { id: "player-party", cash: 1_975, escrow: ["player-club"] },
      { id: "rival-party", cash: 2_975, escrow: ["rival-watch"] },
    ]);
    expect(result.parties[0].loadout.clubItemIds).toEqual(["player-club"]);
    expect(result.state.escrow?.parties[0]).toMatchObject({
      reservedCash: 1_025,
      cashBefore: 3_000,
      cashAfter: 1_975,
      itemSnapshots: [{ id: "player-club", definitionId: "player-club-definition", ownerId: fixture.career.identity.id }],
      loadoutAtReservation: { clubItemIds: ["player-club"] },
      defaultLoadoutAfterTransfer: { clubItemIds: [] },
    });
    expect(Object.isFrozen(result.state.escrow?.parties[0].itemSnapshots[0])).toBe(true);
  });

  it("stages both sides before mutation and leaves every input byte-identical on failure", () => {
    const fixture = setup();
    const hostile = fixture.parties.map((party) => ({ ...party, inventory: { ...party.inventory } }));
    hostile[1] = { ...hostile[1], cash: 1_024 };
    const stateBefore = JSON.stringify(fixture.state);
    const assetsBefore = JSON.stringify(hostile);
    expect(() => reserveChallengeAtFirstTee({ state: fixture.state, parties: hostile, transitionId: "reserve-fail", at: { week: 3, day: 3 } })).toThrow("lacks 1025 cash");
    expect(JSON.stringify(fixture.state)).toBe(stateBefore);
    expect(JSON.stringify(hostile)).toBe(assetsBefore);

    hostile[1] = { ...fixture.parties[1], inventory: { ...fixture.parties[1].inventory, items: [] } };
    expect(() => reserveChallengeAtFirstTee({ state: fixture.state, parties: hostile, transitionId: "reserve-missing", at: { week: 3, day: 3 } })).toThrow("missing accepted item");
    expect(fixture.parties[0].cash).toBe(3_000);
    expect(fixture.parties[0].inventory.escrowItemIds).toEqual([]);
  });

  it.each([
    ["wrong owner", { ownerId: "player-partner" }, /no longer owned/],
    ["wrong custodian", { custodianId: "rival-captain" }, /wrong first-tee custodian/],
    ["changed appraisal", { authoredValue: 501 }, /appraisal inputs changed/],
  ])("revalidates first-tee %s evidence without mutating either party", (_label, itemChange, error) => {
    const fixture = setup();
    const changedItem = { ...fixture.playerItem, ...itemChange };
    const parties = [
      { ...fixture.parties[0], inventory: { ...fixture.parties[0].inventory, items: [changedItem] } },
      fixture.parties[1],
    ];
    const before = JSON.stringify(parties);
    expect(() => reserveChallengeAtFirstTee({ state: fixture.state, parties, transitionId: "reserve-revalidate", at: { week: 3, day: 3 } })).toThrow(error);
    expect(JSON.stringify(parties)).toBe(before);
    expect(fixture.state.phase).toBe("accepted");
  });

  it("makes duplicate first-tee and first-shot transitions idempotent but rejects conflicting IDs", () => {
    const fixture = setup();
    const reserved = reserveChallengeAtFirstTee({ state: fixture.state, parties: fixture.parties, transitionId: "reserve-stable", at: { week: 3, day: 3 } });
    const duplicate = reserveChallengeAtFirstTee({ state: reserved.state, parties: reserved.parties, transitionId: "reserve-stable", at: { week: 3, day: 3 } });
    expect(duplicate.state).toBe(reserved.state);
    expect(duplicate.cashChanges.every((change) => change.delta === 0)).toBe(true);
    expect(duplicate.parties.map((party) => party.cash)).toEqual([1_975, 2_975]);
    expect(() => reserveChallengeAtFirstTee({ state: reserved.state, parties: reserved.parties, transitionId: "reserve-other", at: { week: 3, day: 3 } })).toThrow("different transition ID");

    const locked = lockChallengeFirstShot({ state: reserved.state, transitionId: "shot-lock-1", shotId: "shot-1", at: { week: 3, day: 3 } });
    expect(locked.phase).toBe("shot_locked");
    expect(lockChallengeFirstShot({ state: locked, transitionId: "shot-lock-1", shotId: "shot-1", at: { week: 3, day: 3 } })).toBe(locked);
    expect(() => lockChallengeFirstShot({ state: locked, transitionId: "shot-lock-2", shotId: "shot-2", at: { week: 3, day: 3 } })).toThrow("already locked to shot-1");
    const duplicateTeeAfterShot = reserveChallengeAtFirstTee({ state: locked, parties: reserved.parties, transitionId: "reserve-stable", at: { week: 3, day: 3 } });
    expect(duplicateTeeAfterShot.state).toBe(locked);
    expect(duplicateTeeAfterShot.cashChanges.every((change) => change.delta === 0)).toBe(true);
  });

  it("cancels atomically before a shot, refunds once, and rejects cancellation after shot lock", () => {
    const fixture = setup();
    const reserved = reserveChallengeAtFirstTee({ state: fixture.state, parties: fixture.parties, transitionId: "reserve-cancel", at: { week: 3, day: 3 } });
    const cancelled = cancelChallengeBeforeFirstShot({ state: reserved.state, parties: reserved.parties, transitionId: "cancel-1", at: { week: 3, day: 3 } });
    expect(cancelled.state).toMatchObject({ phase: "cancelled", escrow: { status: "released", releaseTransitionId: "cancel-1" } });
    expect(cancelled.parties.map((party) => ({ cash: party.cash, escrow: party.inventory.escrowItemIds }))).toEqual([
      { cash: 3_000, escrow: [] },
      { cash: 4_000, escrow: [] },
    ]);
    expect(cancelled.cashChanges.map((change) => change.delta)).toEqual([1_025, 1_025]);
    const duplicate = cancelChallengeBeforeFirstShot({ state: cancelled.state, parties: cancelled.parties, transitionId: "cancel-1", at: { week: 3, day: 3 } });
    expect(duplicate.state).toBe(cancelled.state);
    expect(duplicate.cashChanges.every((change) => change.delta === 0)).toBe(true);
    expect(() => cancelChallengeBeforeFirstShot({ state: cancelled.state, parties: cancelled.parties, transitionId: "cancel-other", at: { week: 3, day: 3 } })).toThrow("different transition ID");

    const locked = lockChallengeFirstShot({ state: reserved.state, transitionId: "shot-lock", shotId: "shot-1", at: { week: 3, day: 3 } });
    const before = JSON.stringify(reserved.parties);
    expect(() => cancelChallengeBeforeFirstShot({ state: locked, parties: reserved.parties, transitionId: "too-late", at: { week: 3, day: 3 } })).toThrow("closed after the first committed shot");
    expect(JSON.stringify(reserved.parties)).toBe(before);
  });

  it("round-trips accepted, first-tee, and first-shot crash boundaries through career/save normalization", () => {
    const fixture = setup();
    const reserved = reserveChallengeAtFirstTee({ state: fixture.state, parties: fixture.parties, transitionId: "reserve-reload", at: { week: 3, day: 3 } });
    const locked = lockChallengeFirstShot({ state: reserved.state, transitionId: "shot-reload", shotId: "shot-1", at: { week: 3, day: 3 } });
    const phases = [
      { state: fixture.state, assets: fixture.parties[0] },
      { state: reserved.state, assets: reserved.parties[0] },
      { state: locked, assets: reserved.parties[0] },
    ];
    for (const phase of phases) {
      const encoded = encodeChallengeRuntimeState(phase.state);
      const decoded = decodeChallengeRuntimeState(encoded);
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) continue;
      expect(JSON.stringify(decoded.state)).toBe(encoded);
      expect(Object.isFrozen(decoded.state)).toBe(true);
      const career = {
        ...fixture.career,
        inventory: phase.assets.inventory,
        equipmentLoadout: phase.assets.loadout,
        activeChallengeRuntime: decoded.state,
      };
      const normalizedCareer = normalizePlayerPro(JSON.parse(JSON.stringify(career)), { seed: 725_002 });
      expect(JSON.stringify(normalizedCareer.activeChallengeRuntime)).toBe(encoded);
      const save = normalizeLoadedSaveResult({
        schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
        savedAt: 1,
        course: DEFAULT_COURSE,
        world: { ...DEFAULT_WORLD, cash: phase.assets.cash, playerPro: career },
      });
      expect(save.ok).toBe(true);
      if (save.ok) expect(JSON.stringify(save.payload.world.playerPro?.activeChallengeRuntime)).toBe(encoded);
      expect(() => payloadForPersistence({ course: DEFAULT_COURSE, world: { ...DEFAULT_WORLD, cash: phase.assets.cash, playerPro: career } })).not.toThrow();
    }
  });

  it("defers opaque contract evidence at load but comprehensively rejects it before mutation", () => {
    const fixture = setup();
    const corruptState = JSON.parse(JSON.stringify(fixture.state)) as {
      contract: { terms: { sideBets: Array<{ kind: string }> } };
    };
    corruptState.contract.terms.sideBets[0].kind = "invented-side-bet";
    const normalized = normalizePlayerPro({
      ...fixture.career,
      inventory: fixture.parties[0].inventory,
      equipmentLoadout: fixture.parties[0].loadout,
      activeChallengeRuntime: corruptState,
    }, { seed: 725_002 });
    expect(normalized.activeChallengeRuntime).not.toBeNull();
    if (!normalized.activeChallengeRuntime) throw new Error("Expected compact persistence decoding to preserve the runtime.");
    const stateBefore = JSON.stringify(normalized.activeChallengeRuntime);
    const partiesBefore = JSON.stringify(fixture.parties);
    expect(() => reserveChallengeAtFirstTee({
      state: normalized.activeChallengeRuntime!,
      parties: fixture.parties,
      transitionId: "reserve-corrupt",
      at: { week: 3, day: 3 },
    })).toThrow("Challenge runtime save is invalid");
    expect(JSON.stringify(normalized.activeChallengeRuntime)).toBe(stateBefore);
    expect(JSON.stringify(fixture.parties)).toBe(partiesBefore);
  });

  it("strictly rejects malformed runtime, missing reservation IDs, and extra active-runtime escrow IDs", () => {
    const fixture = setup();
    const reserved = reserveChallengeAtFirstTee({ state: fixture.state, parties: fixture.parties, transitionId: "reserve-hostile", at: { week: 3, day: 3 } });
    const baseCareer = {
      ...fixture.career,
      inventory: reserved.parties[0].inventory,
      equipmentLoadout: reserved.parties[0].loadout,
      activeChallengeRuntime: reserved.state,
    };
    const save = (career: unknown) => normalizeLoadedSaveResult({
      schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
      savedAt: 1,
      course: DEFAULT_COURSE,
      world: { ...DEFAULT_WORLD, cash: reserved.parties[0].cash, playerPro: career },
    });

    const malformed = { ...baseCareer, activeChallengeRuntime: { ...reserved.state, version: 99 } };
    expect(() => normalizePlayerPro(malformed, { seed: 725_002 })).toThrow("runtime save is invalid");
    expect(save(malformed)).toMatchObject({ ok: false, error: { code: "INVALID_WORLD" } });

    const financial = JSON.parse(JSON.stringify(baseCareer)) as {
      activeChallengeRuntime: { escrow: { parties: Array<{ cashAfter: number }> } };
    };
    financial.activeChallengeRuntime.escrow.parties[0].cashAfter += 1;
    expect(() => normalizePlayerPro(financial, { seed: 725_002 })).toThrow("runtime save is invalid");
    expect(save(financial)).toMatchObject({ ok: false, error: { code: "INVALID_WORLD" } });

    const missing = { ...baseCareer, inventory: { ...baseCareer.inventory, escrowItemIds: [] } };
    expect(() => normalizePlayerPro(missing, { seed: 725_002 })).toThrow("runtime save is invalid");
    expect(save(missing)).toMatchObject({ ok: false, error: { code: "INVALID_WORLD" } });

    const extraItem = item("orphan-extra", fixture.career.identity.id, "bag", 100);
    const extra = { ...baseCareer, inventory: { ...baseCareer.inventory, items: [...baseCareer.inventory.items, extraItem], escrowItemIds: [...baseCareer.inventory.escrowItemIds, extraItem.id] } };
    expect(() => normalizePlayerPro(extra, { seed: 725_002 })).toThrow("runtime save is invalid");
    expect(save(extra)).toMatchObject({ ok: false, error: { code: "INVALID_WORLD" } });
    expect(() => payloadForPersistence({ course: DEFAULT_COURSE, world: { ...DEFAULT_WORLD, cash: reserved.parties[0].cash, playerPro: extra } })).toThrow("runtime save is invalid");
  });
});
