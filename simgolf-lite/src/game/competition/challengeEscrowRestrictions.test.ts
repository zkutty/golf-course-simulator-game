import { describe, expect, it } from "vitest";
import type { PlayerProCareer } from "../models/playerProTypes";
import { createDefaultPlayerPro } from "../playerPro/playerPro";
import { capturePerformanceLoadout, setEquipmentLoadout } from "./equipmentMentor";
import { createStakeBundle } from "./inventory";
import { applyPlantRewardPlacement, hasPlantRewardPlacement } from "./rewardPlacement";
import { consumePlantStock, consumeServiceCredit, transferRewardEntitlement } from "./rewardEntitlements";
import type { InventoryItem, RewardEntitlement } from "./types";

function item(id: string, ownerId: string, category: InventoryItem["category"]): InventoryItem {
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
    ...(category === "plant-stock" ? { remainingPlacements: 5, frozenInstallValueEach: 100, speciesId: "parkland-perennial-bed" } : {}),
    ...(category === "club" ? { modifiers: [{ channel: "dispersion" as const, multiplier: .95, context: "standard-full-shot" }] } : {}),
  };
}

function entitlement(id: string, itemId: string, kind: "plant-stock" | "service-credit"): RewardEntitlement {
  return {
    version: 1,
    id,
    definitionId: `${id}-definition`,
    name: id,
    kind,
    ownerId: "player",
    transferability: "transferable",
    initialQuantity: 5,
    remainingQuantity: 5,
    initialValue: 500,
    remainingValue: 500,
    status: "active",
    unlockConditions: [],
    consumption: [],
    provenance: {
      rewardDefinitionId: `${id}-definition`,
      grantingPersonId: "rival",
      grantingPersonName: "Rival",
      authoredPersonId: "rival-authored",
      occupation: "fixture",
      matchId: "match",
      grantedWeek: 1,
      grantedDay: 0,
    },
    saveBehavior: "player-career",
    inventoryItemId: itemId,
    ...(kind === "plant-stock" ? { speciesId: "parkland-perennial-bed", biome: "parkland", installationValueEach: 100 } : { serviceScope: "construction" as const }),
  };
}

function career(): PlayerProCareer {
  const base = createDefaultPlayerPro({ seed: 725_003 });
  const club = item("escrow-club", base.identity.id, "club");
  const plant = item("escrow-plant", base.identity.id, "plant-stock");
  const service = item("escrow-service", base.identity.id, "service-credit");
  return {
    ...base,
    inventory: {
      ...base.inventory,
      items: [club, plant, service],
      escrowItemIds: [club.id, plant.id, service.id],
    },
    equipmentLoadout: { clubItemIds: [club.id] },
    rewardEntitlements: {
      version: 1,
      entitlements: [entitlement("plant-entitlement", plant.id, "plant-stock"), entitlement("service-entitlement", service.id, "service-credit")],
      settlementLedger: [],
    },
  };
}

describe("ZK-725 Packet B escrow mutation restrictions", () => {
  it("blocks newly equipping or restaking escrowed items while preserving frozen-play/default behavior", () => {
    const current = career();
    expect(setEquipmentLoadout(current, { clubItemIds: ["escrow-club"] })).toEqual({ ok: false, reason: "Escrowed challenge items cannot be newly equipped." });
    expect(() => createStakeBundle({ inventory: current.inventory, itemIds: ["escrow-club"], week: 2, day: 1 })).toThrow("already in escrow");
    const performance = capturePerformanceLoadout({
      ownerId: current.identity.id,
      inventoryItems: current.inventory.items,
      escrowItemIds: current.inventory.escrowItemIds,
      loadout: current.equipmentLoadout,
      learnedTechniques: current.learnedTechniques,
      week: 2,
      day: 1,
    });
    expect(performance.itemIds).toEqual([]);
    expect(current.equipmentLoadout.clubItemIds).toEqual(["escrow-club"]);
  });

  it("blocks plant/service consumption, placement spending, and entitlement transfer without mutation", () => {
    const current = career();
    const assets = { inventory: current.inventory, rewards: current.rewardEntitlements };
    const before = JSON.stringify(assets);
    const plant = consumePlantStock({
      assets,
      entitlementId: "plant-entitlement",
      consumptionId: "consume-plant",
      speciesId: "parkland-perennial-bed",
      biome: "parkland",
      week: 2,
      day: 1,
      installationCost: 100,
    });
    expect(plant).toMatchObject({ ok: false });
    const service = consumeServiceCredit({ assets, entitlementId: "service-entitlement", consumptionId: "consume-service", scope: "construction", week: 2, day: 1, charge: 100 });
    expect(service).toMatchObject({ ok: false });
    const transferred = transferRewardEntitlement({ assets, entitlementId: "service-entitlement", transferId: "transfer-service", toOwnerId: "friend", week: 2, day: 1 });
    expect(transferred).toMatchObject({ ok: false });
    expect(hasPlantRewardPlacement(current, "parkland-perennial-bed", "parkland")).toBe(false);
    expect(applyPlantRewardPlacement(current, { speciesId: "parkland-perennial-bed", biome: "parkland", x: 1, y: 1, week: 2, installationCost: 100 })).toEqual({ career: current, applied: false });
    expect(JSON.stringify(assets)).toBe(before);
  });
});
