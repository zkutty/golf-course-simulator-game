import type { EquipmentLoadout, PlayerInventory, RivalCustodyRecord } from "../competition/types";
import { emptyEquipmentLoadout, emptyPlayerInventory, normalizeInventoryState } from "../competition/inventory";

declare module "../models/playerProTypes" {
  interface PlayerProCareer {
    inventory: PlayerInventory;
    equipmentLoadout: EquipmentLoadout;
    rivalCustody: readonly RivalCustodyRecord[];
  }
}

export function defaultPlayerProInventory(identityId: string) {
  return {
    inventory: emptyPlayerInventory(identityId),
    equipmentLoadout: emptyEquipmentLoadout(),
    rivalCustody: [] as readonly RivalCustodyRecord[],
  };
}

export function normalizePlayerProInventory(raw: unknown, identityId: string) {
  const normalized = normalizeInventoryState(raw, identityId);
  return {
    inventory: normalized.inventory,
    equipmentLoadout: normalized.loadout,
    rivalCustody: normalized.rivalCustody,
  };
}
