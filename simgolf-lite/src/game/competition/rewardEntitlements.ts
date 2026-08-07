import type { LandTheme } from "../models/biomes";
import { defaultDecorationPlantId, isPlantId, plantFitForBiome } from "../models/plantRegistry";
import type { RegularGolfer } from "../livingClub/types";
import { transferItem } from "./inventory";
import type {
  InventoryItem,
  PlayerInventory,
  RewardDefinition,
  RewardEntitlement,
  RewardEntitlementKind,
  RewardEntitlementState,
  RewardUnlockCondition,
  ServiceCreditScope,
} from "./types";

const MAX_ENTITLEMENTS = 120;
const MAX_LEDGER = 240;
const MAX_CONSUMPTION = 80;
const TIER = { new: 0, acquaintance: 1, friend: 2, rival: 3, clubIcon: 4 } as const;
const record = (value: unknown): value is Record<string, unknown> => value != null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const boundedMoney = (value: unknown) => Math.max(0, Math.min(1_000_000, Math.round(finite(value) ? value : 0)));
const boundedQuantity = (value: unknown) => Math.max(0, Math.min(10_000, Math.floor(finite(value) ? value : 0)));

export interface RewardCareerAssets {
  inventory: PlayerInventory;
  rewards: RewardEntitlementState;
}

export interface RewardGrantContext {
  matchId: string;
  completed: boolean;
  outcome: "win" | "loss" | "draw";
  relationshipTier: keyof typeof TIER;
  week: number;
  day: number;
  biome: LandTheme;
}

export interface RewardMutationResult extends RewardCareerAssets {
  ok: boolean;
  reason?: string;
  entitlement?: RewardEntitlement;
  appliedValue?: number;
}

export function emptyRewardEntitlementState(): RewardEntitlementState {
  return { version: 1, entitlements: [], settlementLedger: [] };
}

function defaultConditions(hook: RewardDefinition): readonly RewardUnlockCondition[] {
  return hook.unlockConditions ?? [
    { kind: "completed-match", outcome: "win" },
    { kind: "relationship-tier", minimum: "acquaintance" },
    ...(hook.itemDefinitionId ? [{ kind: "authored-holding", definitionId: hook.itemDefinitionId } as const] : []),
  ];
}

function conditionsMet(person: RegularGolfer, hook: RewardDefinition, context: RewardGrantContext): boolean {
  return defaultConditions(hook).every((condition) => {
    if (condition.kind === "completed-match") return context.completed && context.outcome === condition.outcome;
    if (condition.kind === "relationship-tier") return TIER[context.relationshipTier] >= TIER[condition.minimum];
    return person.backstory?.holdings.some((holding) => holding.definitionId === condition.definitionId) === true;
  });
}

function serviceScope(hook: RewardDefinition, holding: InventoryItem | undefined): ServiceCreditScope {
  if (hook.serviceScope) return hook.serviceScope;
  if (holding?.definitionId.includes("construction")) return "construction";
  if (holding?.definitionId.includes("stay")) return "lodging";
  if (holding?.definitionId.includes("event")) return "hospitality";
  return "turf-care";
}

function entitlementKind(hook: RewardDefinition, holding: InventoryItem | undefined): RewardEntitlementKind {
  if (hook.rewardKind) return hook.rewardKind;
  if (hook.nonTransferableKind === "learned-technique") return "mentor-hook";
  if (hook.nonTransferableKind === "species-knowledge") return "species-knowledge";
  if (hook.nonTransferableKind === "profile-unlock") return "profile-unlock";
  if (holding?.category === "plant-stock") return "plant-stock";
  if (holding?.category === "service-credit") return "service-credit";
  return "authored-item";
}

function tangibleRewardItem(holding: InventoryItem, ownerId: string, matchId: string, week: number, day: number): InventoryItem {
  const instance = { ...holding, id: `${holding.id}:reward:${matchId}`, transferHistory: [...holding.transferHistory] };
  return transferItem(instance, {
    transferId: `reward:${matchId}:${holding.definitionId}`,
    toOwnerId: ownerId,
    custodianId: ownerId,
    week,
    day,
    reason: "reward",
  });
}

/** Settles one authored person's hook. Missing people/holdings fail closed without inventing rewards. */
export function grantAuthoredReward(args: {
  assets: RewardCareerAssets;
  person: RegularGolfer;
  hookId: string;
  ownerId: string;
  context: RewardGrantContext;
}): RewardMutationResult {
  const { person, context } = args;
  const hook = person.backstory?.rewardHooks.find((candidate) => candidate.id === args.hookId);
  const ledgerId = `reward:${person.id}:${context.matchId}:${args.hookId}`;
  if (args.assets.rewards.settlementLedger.includes(ledgerId)) return { ...args.assets, ok: true };
  if (!hook || !person.backstory) return { ...args.assets, ok: false, reason: "Authored reward hook is unavailable." };
  if (!conditionsMet(person, hook, context)) return { ...args.assets, ok: false, reason: "Reward unlock conditions are not met." };
  const holding = hook.itemDefinitionId
    ? person.backstory.holdings.find((candidate) => candidate.definitionId === hook.itemDefinitionId)
    : undefined;
  if (hook.itemDefinitionId && !holding) return { ...args.assets, ok: false, reason: "The granting person's authored holding is unavailable." };
  const kind = entitlementKind(hook, holding);
  if (kind === "casino-host-capacity" && holding?.capabilities?.includes("casino-host-capacity") !== true) {
    return { ...args.assets, ok: false, reason: "Casino-host capacity requires an authored licensed holding." };
  }
  const item = holding ? tangibleRewardItem(holding, args.ownerId, context.matchId, context.week, context.day) : undefined;
  const plantSpecies = kind === "plant-stock"
    ? (isPlantId(hook.speciesId) && plantFitForBiome(context.biome, hook.speciesId) !== "imported"
      ? hook.speciesId
      : defaultDecorationPlantId(context.biome, "flower_bed"))
    : undefined;
  const initialQuantity = kind === "plant-stock"
    ? Math.max(1, item?.remainingPlacements ?? 1)
    : kind === "service-credit" ? Math.max(1, item?.remainingValue ?? 1) : 1;
  const initialValue = kind === "plant-stock"
    ? initialQuantity * Math.max(0, item?.frozenInstallValueEach ?? 0)
    : kind === "service-credit" ? Math.max(0, item?.remainingValue ?? 0) : Math.max(0, item?.authoredValue ?? 0);
  const entitlement: RewardEntitlement = {
    version: 1,
    id: `${ledgerId}:entitlement`,
    definitionId: hook.id,
    name: hook.name,
    kind,
    ownerId: args.ownerId,
    transferability: hook.nonTransferableKind ? "non-transferable" : "transferable",
    initialQuantity,
    remainingQuantity: initialQuantity,
    initialValue,
    remainingValue: initialValue,
    status: "active",
    unlockConditions: defaultConditions(hook),
    consumption: [],
    provenance: {
      rewardDefinitionId: hook.id,
      grantingPersonId: person.id,
      grantingPersonName: person.name,
      authoredPersonId: person.backstory.authoredId,
      occupation: person.backstory.occupation,
      matchId: context.matchId,
      grantedWeek: Math.max(0, Math.floor(context.week)),
      grantedDay: Math.max(0, Math.min(6, Math.floor(context.day))),
    },
    saveBehavior: "player-career",
    ...(item ? { inventoryItemId: item.id } : {}),
    ...(plantSpecies ? {
      speciesId: plantSpecies,
      biome: context.biome,
      installationValueEach: Math.max(0, item?.frozenInstallValueEach ?? 0),
    } : {}),
    ...(kind === "service-credit" ? { serviceScope: serviceScope(hook, holding) } : {}),
    ...(kind === "casino-host-capacity" ? { capability: "casino-host-capacity" as const } : {}),
    ...(hook.nonTransferableKind ? { nonTransferableKind: hook.nonTransferableKind } : {}),
    ...(hook.techniqueId ? { techniqueId: hook.techniqueId } : {}),
    ...(hook.profileStyleId ? { profileStyleId: hook.profileStyleId } : {}),
  };
  const grantedItem = item && plantSpecies ? { ...item, speciesId: plantSpecies } : item;
  return {
    ok: true,
    inventory: grantedItem ? { ...args.assets.inventory, items: [...args.assets.inventory.items, grantedItem] } : args.assets.inventory,
    rewards: {
      version: 1,
      entitlements: [...args.assets.rewards.entitlements, entitlement].slice(-MAX_ENTITLEMENTS),
      settlementLedger: [...args.assets.rewards.settlementLedger, ledgerId].slice(-MAX_LEDGER),
    },
    entitlement,
  };
}

function updateLinkedItem(inventory: PlayerInventory, entitlement: RewardEntitlement): PlayerInventory {
  if (!entitlement.inventoryItemId) return inventory;
  return {
    ...inventory,
    items: inventory.items.map((item) => item.id === entitlement.inventoryItemId ? {
      ...item,
      remainingValue: entitlement.remainingValue,
      ...(entitlement.kind === "plant-stock" ? { remainingPlacements: entitlement.remainingQuantity } : {}),
    } : item),
  };
}

export function eligiblePlantStockReward(rewards: RewardEntitlementState | undefined, speciesId: string, biome: LandTheme): RewardEntitlement | undefined {
  return rewards?.entitlements.find((entry) => entry.kind === "plant-stock" && entry.status === "active"
    && entry.remainingQuantity > 0 && entry.speciesId === speciesId && entry.biome === biome);
}

function entitlementItemIsEscrowed(assets: RewardCareerAssets, entitlement: RewardEntitlement | undefined): boolean {
  return Boolean(entitlement?.inventoryItemId && assets.inventory.escrowItemIds.includes(entitlement.inventoryItemId));
}

/** Waives installation only. The placed plant remains an ordinary player planting for care, water, seasonality, removal, and salvage. */
export function consumePlantStock(args: {
  assets: RewardCareerAssets;
  entitlementId: string;
  consumptionId: string;
  speciesId: string;
  biome: LandTheme;
  week: number;
  day: number;
  installationCost: number;
}): RewardMutationResult {
  const entitlement = args.assets.rewards.entitlements.find((entry) => entry.id === args.entitlementId);
  if (!entitlement || entitlement.kind !== "plant-stock" || entitlement.status !== "active" || entitlement.remainingQuantity < 1
    || entitlement.speciesId !== args.speciesId || entitlement.biome !== args.biome || entitlementItemIsEscrowed(args.assets, entitlement)) {
    return { ...args.assets, ok: false, reason: "Eligible plant stock is unavailable." };
  }
  if (entitlement.consumption.some((entry) => entry.id === args.consumptionId)) return { ...args.assets, ok: true, entitlement, appliedValue: 0 };
  const remainingQuantity = entitlement.remainingQuantity - 1;
  const remainingValue = Math.max(0, entitlement.remainingValue - (entitlement.installationValueEach ?? 0));
  const next: RewardEntitlement = {
    ...entitlement,
    remainingQuantity,
    remainingValue,
    status: remainingQuantity === 0 ? "consumed" : "active",
    consumption: [...entitlement.consumption, {
      id: args.consumptionId,
      week: args.week,
      day: args.day,
      system: "plant-installation" as const,
      quantity: 1,
      value: boundedMoney(args.installationCost),
      note: "One zero-installation placement; ongoing care, water, seasonality, removal, and salvage remain unchanged.",
    }].slice(-MAX_CONSUMPTION),
  };
  const rewards = { ...args.assets.rewards, entitlements: args.assets.rewards.entitlements.map((entry) => entry.id === next.id ? next : entry) };
  return { ok: true, rewards, inventory: updateLinkedItem(args.assets.inventory, next), entitlement: next, appliedValue: boundedMoney(args.installationCost) };
}

export function consumeServiceCredit(args: {
  assets: RewardCareerAssets;
  entitlementId: string;
  consumptionId: string;
  scope: ServiceCreditScope;
  week: number;
  day: number;
  charge: number;
}): RewardMutationResult {
  const entitlement = args.assets.rewards.entitlements.find((entry) => entry.id === args.entitlementId);
  if (!entitlement || entitlement.kind !== "service-credit" || entitlement.status !== "active" || entitlement.serviceScope !== args.scope
    || entitlementItemIsEscrowed(args.assets, entitlement)) {
    return { ...args.assets, ok: false, reason: "Matching finite service credit is unavailable." };
  }
  if (entitlement.consumption.some((entry) => entry.id === args.consumptionId)) return { ...args.assets, ok: true, entitlement, appliedValue: 0 };
  const applied = Math.min(boundedMoney(args.charge), entitlement.remainingValue);
  if (applied <= 0) return { ...args.assets, ok: false, reason: "No charge or credit remains." };
  const remainingValue = entitlement.remainingValue - applied;
  const next: RewardEntitlement = {
    ...entitlement,
    remainingQuantity: remainingValue,
    remainingValue,
    status: remainingValue === 0 ? "consumed" : "active",
    consumption: [...entitlement.consumption, {
      id: args.consumptionId,
      week: args.week,
      day: args.day,
      system: args.scope,
      quantity: applied,
      value: applied,
      note: `Applied only to one ${args.scope} charge; no recurring discount or upkeep waiver.`,
    }].slice(-MAX_CONSUMPTION),
  };
  const rewards = { ...args.assets.rewards, entitlements: args.assets.rewards.entitlements.map((entry) => entry.id === next.id ? next : entry) };
  return { ok: true, rewards, inventory: updateLinkedItem(args.assets.inventory, next), entitlement: next, appliedValue: applied };
}

export function transferRewardEntitlement(args: {
  assets: RewardCareerAssets;
  entitlementId: string;
  transferId: string;
  toOwnerId: string;
  week: number;
  day: number;
}): RewardMutationResult {
  const entitlement = args.assets.rewards.entitlements.find((entry) => entry.id === args.entitlementId);
  if (!entitlement || entitlementItemIsEscrowed(args.assets, entitlement)) return { ...args.assets, ok: false, reason: "Active reward entitlement is unavailable." };
  if (entitlement.consumption.some((entry) => entry.id === args.transferId)) return { ...args.assets, ok: true, entitlement };
  if (entitlement.status !== "active") return { ...args.assets, ok: false, reason: "Active reward entitlement is unavailable." };
  if (entitlement.transferability !== "transferable") return { ...args.assets, ok: false, reason: "Reward entitlement is non-transferable." };
  const next: RewardEntitlement = {
    ...entitlement,
    ownerId: args.toOwnerId,
    status: "active",
    consumption: [...entitlement.consumption, {
      id: args.transferId,
      week: args.week,
      day: args.day,
      system: "transfer" as const,
      quantity: entitlement.remainingQuantity,
      value: entitlement.remainingValue,
      note: `Transferred finite remaining entitlement to ${args.toOwnerId}.`,
    }].slice(-MAX_CONSUMPTION),
  };
  const inventory = entitlement.inventoryItemId ? {
    ...args.assets.inventory,
    items: args.assets.inventory.items.map((item) => item.id === entitlement.inventoryItemId ? transferItem(item, {
      transferId: args.transferId,
      toOwnerId: args.toOwnerId,
      custodianId: args.toOwnerId,
      week: args.week,
      day: args.day,
      reason: "reward",
    }) : item),
  } : args.assets.inventory;
  return {
    ok: true,
    inventory,
    rewards: { ...args.assets.rewards, entitlements: args.assets.rewards.entitlements.map((entry) => entry.id === next.id ? next : entry) },
    entitlement: next,
  };
}

export function normalizeRewardEntitlementState(raw: unknown, ownerId: string): RewardEntitlementState {
  if (!record(raw)) return emptyRewardEntitlementState();
  const seen = new Set<string>();
  const entitlements: RewardEntitlement[] = [];
  for (const candidate of Array.isArray(raw.entitlements) ? raw.entitlements : []) {
    if (!record(candidate) || candidate.version !== 1 || typeof candidate.id !== "string" || seen.has(candidate.id)
      || typeof candidate.definitionId !== "string" || typeof candidate.name !== "string" || !record(candidate.provenance)) continue;
    seen.add(candidate.id);
    const initialQuantity = boundedQuantity(candidate.initialQuantity);
    const remainingQuantity = Math.min(initialQuantity, boundedQuantity(candidate.remainingQuantity));
    const initialValue = boundedMoney(candidate.initialValue);
    const remainingValue = Math.min(initialValue, boundedMoney(candidate.remainingValue));
    const kind = candidate.kind as RewardEntitlementKind;
    if (!["plant-stock", "service-credit", "authored-item", "mentor-hook", "species-knowledge", "profile-unlock", "casino-host-capacity"].includes(kind)) continue;
    const provenance = candidate.provenance;
    if (typeof provenance.grantingPersonId !== "string" || typeof provenance.grantingPersonName !== "string"
      || typeof provenance.authoredPersonId !== "string" || typeof provenance.occupation !== "string"
      || typeof provenance.matchId !== "string" || typeof provenance.rewardDefinitionId !== "string") continue;
    entitlements.push({
      ...(candidate as unknown as RewardEntitlement),
      version: 1,
      ownerId: typeof candidate.ownerId === "string" ? candidate.ownerId : ownerId,
      transferability: candidate.transferability === "non-transferable" ? "non-transferable" : "transferable",
      initialQuantity,
      remainingQuantity,
      initialValue,
      remainingValue,
      status: remainingQuantity === 0 || ((kind === "plant-stock" || kind === "service-credit") && remainingValue === 0)
        ? "consumed" : candidate.status === "transferred" ? "transferred" : "active",
      unlockConditions: Array.isArray(candidate.unlockConditions) ? candidate.unlockConditions as unknown as RewardUnlockCondition[] : [],
      consumption: Array.isArray(candidate.consumption) ? candidate.consumption.filter(record).slice(-MAX_CONSUMPTION) as unknown as RewardEntitlement["consumption"] : [],
      saveBehavior: "player-career",
    });
  }
  return {
    version: 1,
    entitlements: entitlements.slice(-MAX_ENTITLEMENTS),
    settlementLedger: Array.isArray(raw.settlementLedger) ? raw.settlementLedger.filter((entry): entry is string => typeof entry === "string").slice(-MAX_LEDGER) : [],
  };
}

export function rewardEntitlementTextState(state: RewardEntitlementState): readonly object[] {
  return state.entitlements.map((entry) => ({
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    ownerId: entry.ownerId,
    remainingQuantity: entry.remainingQuantity,
    remainingValue: entry.remainingValue,
    status: entry.status,
    transferability: entry.transferability,
    grantingPersonId: entry.provenance.grantingPersonId,
    matchId: entry.provenance.matchId,
  }));
}
