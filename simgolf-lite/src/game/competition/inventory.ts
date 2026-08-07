import type {
  AppraisedValue,
  EquipmentLoadout,
  InventoryCategory,
  InventoryItem,
  NonTransferableRewardKind,
  PlayerInventory,
  RivalCustodyRecord,
  StakeBundle,
} from "./types";

export interface CareerAssets {
  cash: number;
  inventory: PlayerInventory;
  loadout: EquipmentLoadout;
  rivalCustody: readonly RivalCustodyRecord[];
  settlementLedger: readonly string[];
}

export interface InventoryNormalizationResult {
  inventory: PlayerInventory;
  loadout: EquipmentLoadout;
  rivalCustody: readonly RivalCustodyRecord[];
  warnings: readonly string[];
}

const CATEGORIES: readonly InventoryCategory[] = [
  "club", "bag", "outfit", "watch", "vehicle", "trophy", "keepsake", "plant-stock", "service-credit",
];
const NON_TRANSFERABLE: readonly NonTransferableRewardKind[] = [
  "species-knowledge", "learned-technique", "relationship", "memory", "profile-unlock",
];
const LEARNED_TECHNIQUES = new Set(["fairway-finder", "knockdown-approach", "soft-hands", "splash-specialist", "lag-putt"]);
const record = (value: unknown): value is Record<string, unknown> => value != null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const money = (value: unknown) => Math.max(0, Math.round(finite(value) ? value : 0));

export function emptyPlayerInventory(ownerId: string): PlayerInventory {
  return { version: 1, ownerId, items: [], escrowItemIds: [], displayItemIds: [] };
}

export function emptyEquipmentLoadout(): EquipmentLoadout {
  return { clubItemIds: [] };
}

export function inventoryItemValue(item: InventoryItem): number {
  if (item.category === "plant-stock") {
    return money((item.remainingPlacements ?? 0) * (item.frozenInstallValueEach ?? 0));
  }
  if (item.category === "service-credit") return money(item.remainingValue);
  return money(item.authoredValue);
}

/** Appraisal inputs and result are copied once; later item mutations cannot reprice an accepted contract. */
export function appraiseItem(item: InventoryItem, week: number, day: number): AppraisedValue {
  const basis = {
    authoredValue: money(item.authoredValue),
    remainingValue: money(item.remainingValue),
    ...(item.category === "plant-stock" ? {
      remainingPlacements: Math.max(0, Math.floor(item.remainingPlacements ?? 0)),
      frozenInstallValueEach: money(item.frozenInstallValueEach),
    } : {}),
  };
  const value = item.category === "plant-stock"
    ? money((basis.remainingPlacements ?? 0) * (basis.frozenInstallValueEach ?? 0))
    : item.category === "service-credit" ? basis.remainingValue : basis.authoredValue;
  return Object.freeze({ itemId: item.id, value, frozenWeek: week, frozenDay: day, basis: Object.freeze(basis) });
}

export function createStakeBundle(args: {
  inventory: PlayerInventory;
  itemIds?: readonly string[];
  cash?: number;
  week: number;
  day: number;
  nonTransferableKinds?: readonly NonTransferableRewardKind[];
}): StakeBundle {
  if (args.nonTransferableKinds?.some((kind) => NON_TRANSFERABLE.includes(kind))) {
    throw new Error("Knowledge, techniques, relationships, memories, and profile unlocks are non-transferable.");
  }
  const itemIds = [...new Set(args.itemIds ?? [])];
  const items = itemIds.map((id) => args.inventory.items.find((item) => item.id === id));
  if (items.some((item) => !item || item.ownerId !== args.inventory.ownerId)) throw new Error("A staked item is not owned by this inventory.");
  if (items.some((item) => item!.custodianId !== args.inventory.ownerId)) throw new Error("A staked item is already held by another custodian.");
  if (itemIds.some((id) => args.inventory.escrowItemIds.includes(id))) throw new Error("A staked item is already in escrow.");
  const cash = money(args.cash);
  const appraisal: AppraisedValue[] = items.map((item) => appraiseItem(item!, args.week, args.day));
  if (cash > 0) appraisal.push(Object.freeze({ cash, value: cash, frozenWeek: args.week, frozenDay: args.day, basis: Object.freeze({ cashFaceValue: cash }) }));
  return Object.freeze({
    cash,
    itemIds: Object.freeze(itemIds),
    appraisal: Object.freeze(appraisal),
    totalValue: appraisal.reduce((sum, entry) => sum + entry.value, 0),
    confirmationItemIds: Object.freeze(items.filter((item) => item!.confirmationRequired).map((item) => item!.id)),
  });
}

export function acceptStakeBundle(bundle: StakeBundle, confirmations: readonly string[], week: number, day: number): StakeBundle {
  const confirmed = new Set(confirmations);
  if (bundle.confirmationItemIds.some((id) => !confirmed.has(id))) throw new Error("Every unique or high-prestige item requires explicit confirmation.");
  if (bundle.acceptedAt) return bundle;
  return Object.freeze({ ...bundle, acceptedAt: { week, day } });
}

export function appraisalsEqual(left: StakeBundle, right: StakeBundle): boolean {
  return JSON.stringify(left.appraisal) === JSON.stringify(right.appraisal) && left.totalValue === right.totalValue;
}

export function transferItem(item: InventoryItem, args: {
  transferId: string;
  toOwnerId: string;
  custodianId: string;
  week: number;
  day: number;
  reason: "reward" | "stake" | "recovery" | "import";
}): InventoryItem {
  const existing = item.transferHistory.find((entry) => entry.id === args.transferId);
  if (existing) return item;
  return {
    ...item,
    ownerId: args.toOwnerId,
    custodianId: args.custodianId,
    transferHistory: [...item.transferHistory, {
      id: args.transferId,
      week: args.week,
      day: args.day,
      fromOwnerId: item.ownerId,
      toOwnerId: args.toOwnerId,
      custodianId: args.custodianId,
      reason: args.reason,
    }],
  };
}

export function settleLostStake(args: {
  assets: CareerAssets;
  stake: StakeBundle;
  settlementId: string;
  challengeId: string;
  rivalId: string;
  rivalName: string;
  week: number;
  day: number;
}): CareerAssets {
  if (args.assets.settlementLedger.includes(args.settlementId)) return args.assets;
  if (!args.stake.acceptedAt) throw new Error("A stake must be accepted before custody can change.");
  const lost = new Set(args.stake.itemIds);
  const moved = args.assets.inventory.items.filter((item) => lost.has(item.id)).map((item) => transferItem(item, {
    transferId: args.settlementId,
    toOwnerId: args.rivalId,
    custodianId: args.rivalId,
    week: args.week,
    day: args.day,
    reason: "stake",
  }));
  const movedById = new Map(moved.map((item) => [item.id, item]));
  const valid = (id: string | undefined, category: InventoryCategory) => id && !lost.has(id)
    && args.assets.inventory.items.some((item) => item.id === id && item.category === category) ? id : undefined;
  return {
    ...args.assets,
    inventory: {
      ...args.assets.inventory,
      items: args.assets.inventory.items.filter((item) => !lost.has(item.id)),
      escrowItemIds: args.assets.inventory.escrowItemIds.filter((id) => !lost.has(id)),
      selectedVehicleId: valid(args.assets.inventory.selectedVehicleId, "vehicle"),
      displayItemIds: args.assets.inventory.displayItemIds.filter((id) => !lost.has(id)),
    },
    loadout: {
      clubItemIds: args.assets.loadout.clubItemIds.filter((id) => !lost.has(id)),
      bagItemId: valid(args.assets.loadout.bagItemId, "bag"),
      outfitItemId: valid(args.assets.loadout.outfitItemId, "outfit"),
      watchItemId: valid(args.assets.loadout.watchItemId, "watch"),
      techniqueId: args.assets.loadout.techniqueId,
    },
    rivalCustody: [...args.assets.rivalCustody, ...moved.map((item) => ({
      id: `${args.challengeId}:${item.id}`,
      rivalId: args.rivalId,
      rivalName: args.rivalName,
      challengeId: args.challengeId,
      itemId: item.id,
      itemSnapshot: movedById.get(item.id)!,
      acquiredWeek: args.week,
      acquiredDay: args.day,
      status: "held" as const,
    }))],
    settlementLedger: [...args.assets.settlementLedger, args.settlementId],
  };
}

export function normalizeInventoryState(raw: unknown, ownerId: string, fallbackLoadout: EquipmentLoadout = emptyEquipmentLoadout()): InventoryNormalizationResult {
  const value = record(raw) ? raw : {};
  const rawInventory = record(value.inventory) ? value.inventory : {};
  const warnings: string[] = [];
  const seen = new Set<string>();
  const items: InventoryItem[] = [];
  for (const candidate of Array.isArray(rawInventory.items) ? rawInventory.items : []) {
    if (!record(candidate) || typeof candidate.id !== "string" || seen.has(candidate.id) || typeof candidate.definitionId !== "string"
      || typeof candidate.name !== "string" || !CATEGORIES.includes(candidate.category as InventoryCategory)) {
      warnings.push("Ignored an invalid or duplicate inventory item without mutating valid history.");
      continue;
    }
    seen.add(candidate.id);
    const owner = typeof candidate.ownerId === "string" ? candidate.ownerId : ownerId;
    const category = candidate.category as InventoryCategory;
    const item: InventoryItem = {
      id: candidate.id,
      definitionId: candidate.definitionId,
      name: candidate.name,
      category,
      ownerId: owner,
      custodianId: typeof candidate.custodianId === "string" ? candidate.custodianId : owner,
      authoredValue: money(candidate.authoredValue),
      remainingValue: money(candidate.remainingValue ?? candidate.authoredValue),
      prestige: Math.max(0, Math.min(100, money(candidate.prestige))),
      unique: candidate.unique === true,
      confirmationRequired: candidate.confirmationRequired === true || candidate.unique === true || money(candidate.prestige) >= 75,
      transferable: true,
      transferHistory: Array.isArray(candidate.transferHistory) ? candidate.transferHistory.filter((entry): entry is InventoryItem["transferHistory"][number] => record(entry) && typeof entry.id === "string") : [],
      ...(category === "plant-stock" ? {
        remainingPlacements: Math.max(0, Math.floor(finite(candidate.remainingPlacements) ? candidate.remainingPlacements : 0)),
        frozenInstallValueEach: money(candidate.frozenInstallValueEach),
        ...(typeof candidate.speciesId === "string" ? { speciesId: candidate.speciesId } : {}),
      } : {}),
      ...(Array.isArray(candidate.modifiers) ? { modifiers: candidate.modifiers as InventoryItem["modifiers"] } : {}),
      ...(typeof candidate.description === "string" ? { description: candidate.description } : {}),
    };
    items.push(item);
  }
  const inventory: PlayerInventory = {
    version: 1,
    ownerId,
    items,
    escrowItemIds: Array.isArray(rawInventory.escrowItemIds) ? rawInventory.escrowItemIds.filter((id): id is string => typeof id === "string" && seen.has(id)) : [],
    displayItemIds: Array.isArray(rawInventory.displayItemIds) ? rawInventory.displayItemIds.filter((id): id is string => typeof id === "string" && seen.has(id)) : [],
    selectedVehicleId: typeof rawInventory.selectedVehicleId === "string" && items.some((item) => item.id === rawInventory.selectedVehicleId && item.category === "vehicle") ? rawInventory.selectedVehicleId : undefined,
  };
  const requested = record(value.equipmentLoadout) ? value.equipmentLoadout : {};
  const owned = (id: unknown, category: InventoryCategory) => typeof id === "string" && items.some((item) => item.id === id && item.ownerId === ownerId && item.custodianId === ownerId && item.category === category);
  const clubs = Array.isArray(requested.clubItemIds) ? requested.clubItemIds.filter((id): id is string => owned(id, "club")) : [];
  const fallbackClubs = fallbackLoadout.clubItemIds.filter((id) => owned(id, "club"));
  if (Array.isArray(requested.clubItemIds) && clubs.length !== requested.clubItemIds.length) warnings.push("Invalid equipped club references fell back safely; inventory history was retained.");
  const loadout: EquipmentLoadout = {
    clubItemIds: clubs.length ? clubs : fallbackClubs,
    bagItemId: owned(requested.bagItemId, "bag") ? requested.bagItemId as string : owned(fallbackLoadout.bagItemId, "bag") ? fallbackLoadout.bagItemId : undefined,
    outfitItemId: owned(requested.outfitItemId, "outfit") ? requested.outfitItemId as string : owned(fallbackLoadout.outfitItemId, "outfit") ? fallbackLoadout.outfitItemId : undefined,
    watchItemId: owned(requested.watchItemId, "watch") ? requested.watchItemId as string : owned(fallbackLoadout.watchItemId, "watch") ? fallbackLoadout.watchItemId : undefined,
    techniqueId: typeof requested.techniqueId === "string" && LEARNED_TECHNIQUES.has(requested.techniqueId)
      ? requested.techniqueId as EquipmentLoadout["techniqueId"]
      : fallbackLoadout.techniqueId,
  };
  const custodyIds = new Set<string>();
  const heldItemIds = new Set<string>();
  const rivalCustody = Array.isArray(value.rivalCustody)
    ? value.rivalCustody.filter((entry): entry is RivalCustodyRecord => {
      if (!record(entry) || typeof entry.id !== "string" || custodyIds.has(entry.id) || typeof entry.itemId !== "string" || !record(entry.itemSnapshot)) return false;
      if (entry.status === "held" && (seen.has(entry.itemId) || heldItemIds.has(entry.itemId))) {
        warnings.push("Ignored duplicate held-item custody without duplicating inventory.");
        return false;
      }
      custodyIds.add(entry.id);
      if (entry.status === "held") heldItemIds.add(entry.itemId);
      return true;
    })
    : [];
  return { inventory, loadout, rivalCustody, warnings };
}

export function renderInventoryDebug(state: InventoryNormalizationResult, stakes: readonly StakeBundle[] = []): string {
  const items = state.inventory.items.map((item) => `${item.id} ${item.category} owner=${item.ownerId} custodian=${item.custodianId} value=${inventoryItemValue(item)}`).join("\n") || "(empty)";
  const loadout = `clubs=${state.loadout.clubItemIds.join(",") || "default"} bag=${state.loadout.bagItemId ?? "default"} outfit=${state.loadout.outfitItemId ?? "default"} watch=${state.loadout.watchItemId ?? "default"} technique=${state.loadout.techniqueId ?? "default"}`;
  const custody = state.rivalCustody.map((entry) => `${entry.id} item=${entry.itemId} rival=${entry.rivalId} status=${entry.status}`).join("\n") || "(none)";
  const appraisal = stakes.flatMap((stake) => stake.appraisal.map((entry) => `${entry.itemId ?? "cash"} value=${entry.value} basis=${JSON.stringify(entry.basis)}`)).join("\n") || "(none)";
  return `Inventory\n${items}\nEquipment\n${loadout}\nAppraisal\n${appraisal}\nCustody\n${custody}`;
}
