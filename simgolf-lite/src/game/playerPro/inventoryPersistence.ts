import type { EquipmentLoadout, PlayerInventory, RewardEntitlementState, RivalCustodyRecord } from "../competition/types";
import { emptyEquipmentLoadout, emptyPlayerInventory, normalizeInventoryState } from "../competition/inventory";

declare module "../models/playerProTypes" {
  interface PlayerProCareer {
    inventory: PlayerInventory;
    equipmentLoadout: EquipmentLoadout;
    rivalCustody: readonly RivalCustodyRecord[];
    rewardEntitlements: RewardEntitlementState;
  }
}

export function defaultPlayerProInventory(identityId: string) {
  return {
    inventory: emptyPlayerInventory(identityId),
    equipmentLoadout: emptyEquipmentLoadout(),
    rivalCustody: [] as readonly RivalCustodyRecord[],
    rewardEntitlements: { version: 1 as const, entitlements: [], settlementLedger: [] },
  };
}

export function normalizePlayerProInventory(raw: unknown, identityId: string) {
  const normalized = normalizeInventoryState(raw, identityId);
  const candidateRewards = (raw as { rewardEntitlements?: RewardEntitlementState } | null)?.rewardEntitlements;
  const rewardEntitlements = candidateRewards?.version === 1
    && Array.isArray(candidateRewards.entitlements) && candidateRewards.entitlements.every((entry) => entry?.version === 1
      && typeof entry.id === "string" && Array.isArray(entry.consumption))
    && Array.isArray(candidateRewards.settlementLedger)
    ? candidateRewards
    : { version: 1 as const, entitlements: [], settlementLedger: [] };
  return {
    inventory: normalized.inventory,
    equipmentLoadout: normalized.loadout,
    rivalCustody: normalized.rivalCustody,
    rewardEntitlements,
  };
}
