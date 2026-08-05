import { describe, expect, it } from "vitest";
import type { EquipmentLoadout, InventoryItem } from "./types";
import {
  acceptStakeBundle,
  appraiseItem,
  createStakeBundle,
  emptyPlayerInventory,
  normalizeInventoryState,
  recoverRivalItem,
  renderInventoryDebug,
  settleLostStake,
} from "./inventory";

function item(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: "item-club-1",
    definitionId: "authored-club-1",
    name: "Workshop Iron",
    category: "club",
    ownerId: "player",
    custodianId: "player",
    authoredValue: 900,
    remainingValue: 900,
    prestige: 80,
    unique: true,
    confirmationRequired: true,
    transferable: true,
    transferHistory: [],
    ...overrides,
  };
}

describe("ZK-723 inventory, appraisal, and custody", () => {
  it("freezes reproducible authored, remaining-credit, and plant-placement appraisal inputs", () => {
    const plant = item({ id: "plant", category: "plant-stock", remainingPlacements: 7, frozenInstallValueEach: 45, authoredValue: 999, remainingValue: 315 });
    const service = item({ id: "credit", category: "service-credit", authoredValue: 1200, remainingValue: 425 });
    expect(appraiseItem(plant, 8, 2)).toMatchObject({ value: 315, basis: { remainingPlacements: 7, frozenInstallValueEach: 45 } });
    expect(appraiseItem(service, 8, 2)).toMatchObject({ value: 425, basis: { remainingValue: 425 } });
    const inventory = { ...emptyPlayerInventory("player"), items: [plant, service] };
    const accepted = acceptStakeBundle(createStakeBundle({ inventory, itemIds: ["plant", "credit"], week: 8, day: 2 }), ["plant", "credit"], 8, 2);
    plant.remainingPlacements = 1;
    service.remainingValue = 1;
    expect(accepted.totalValue).toBe(740);
    expect(accepted.appraisal.map((entry) => entry.value)).toEqual([315, 425]);
  });

  it("blocks every non-transferable reward kind at the command boundary", () => {
    for (const kind of ["species-knowledge", "learned-technique", "relationship", "memory", "profile-unlock"] as const) {
      expect(() => createStakeBundle({ inventory: emptyPlayerInventory("player"), week: 1, day: 0, nonTransferableKinds: [kind] })).toThrow("non-transferable");
    }
  });

  it("requires confirmation for unique/high-prestige items and changes custody idempotently", () => {
    const inventory = { ...emptyPlayerInventory("player"), items: [item()], escrowItemIds: ["item-club-1"] };
    expect(() => createStakeBundle({ inventory, itemIds: ["item-club-1"], week: 1, day: 0 })).toThrow("escrow");
    const available = { ...inventory, escrowItemIds: [] };
    const proposal = createStakeBundle({ inventory: available, itemIds: ["item-club-1"], week: 1, day: 0 });
    expect(() => acceptStakeBundle(proposal, [], 1, 0)).toThrow("confirmation");
    const stake = acceptStakeBundle(proposal, ["item-club-1"], 1, 0);
    const loadout: EquipmentLoadout = { clubItemIds: ["item-club-1"] };
    const assets = { cash: 0, inventory: available, loadout, rivalCustody: [], settlementLedger: [] };
    const lost = settleLostStake({ assets, stake, settlementId: "settle-1", challengeId: "challenge-1", rivalId: "rival", rivalName: "Rival", week: 2, day: 3 });
    expect(lost.inventory.items).toEqual([]);
    expect(lost.loadout.clubItemIds).toEqual([]);
    expect(lost.rivalCustody[0]).toMatchObject({ itemId: "item-club-1", status: "held", itemSnapshot: { ownerId: "rival", custodianId: "rival" } });
    expect(settleLostStake({ assets: lost, stake, settlementId: "settle-1", challengeId: "challenge-1", rivalId: "rival", rivalName: "Rival", week: 2, day: 3 })).toBe(lost);
    const recovered = recoverRivalItem({ assets: lost, custodyId: lost.rivalCustody[0].id, settlementId: "settle-2", playerId: "player", week: 3, day: 1 });
    expect(recovered.inventory.items[0]).toMatchObject({ id: "item-club-1", ownerId: "player", custodianId: "player" });
    expect(recovered.rivalCustody[0]).toMatchObject({ status: "recovered", recoveredWeek: 3, recoveredDay: 1 });
    expect(recoverRivalItem({ assets: recovered, custodyId: lost.rivalCustody[0].id, settlementId: "settle-2", playerId: "player", week: 3, day: 1 })).toBe(recovered);
  });

  it("falls back from invalid equipment references without deleting inventory or transfer history", () => {
    const raw = {
      inventory: { ...emptyPlayerInventory("player"), items: [item()] },
      equipmentLoadout: { clubItemIds: ["missing"], bagItemId: "item-club-1" },
      rivalCustody: [],
    };
    const normalized = normalizeInventoryState(JSON.parse(JSON.stringify(raw)), "player");
    expect(normalized.inventory.items).toHaveLength(1);
    expect(normalized.loadout).toEqual({ clubItemIds: [], bagItemId: undefined, outfitItemId: undefined, watchItemId: undefined });
    expect(normalized.warnings.join(" ")).toContain("fell back safely");
    expect(renderInventoryDebug(normalized)).toContain("owner=player custodian=player");
  });
});
