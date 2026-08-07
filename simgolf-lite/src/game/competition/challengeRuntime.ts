import { appraiseItem } from "./inventory";
import { challengeRuntimeValidationError } from "./challengeRuntimeCodec";
import type { AcceptedChallengeContract } from "./challengeContracts";
import type { EquipmentLoadout, InventoryItem, PlayerInventory } from "./types";

export const CHALLENGE_RUNTIME_VERSION = 1 as const;

export type ChallengeRuntimePhase = "accepted" | "escrowed" | "shot_locked" | "cancelled";

export interface ChallengeRuntimeClock {
  week: number;
  day: number;
}

export interface ChallengeLivePartyAssets {
  partyId: string;
  captainId: string;
  cash: number;
  inventory: PlayerInventory;
  /** Remains unchanged in escrow; Packet C can apply the frozen fallback only if ownership transfers. */
  loadout: EquipmentLoadout;
}

export interface ChallengeEscrowPartyState {
  partyId: string;
  captainId: string;
  reservedCash: number;
  cashBefore: number;
  cashAfter: number;
  itemIds: readonly string[];
  /** Complete first-tee item records; Packet C need not consult mutable inventory to transfer them. */
  itemSnapshots: readonly InventoryItem[];
  loadoutAtReservation: EquipmentLoadout;
  /** Deterministic ordinary-default slots if Packet C transfers every escrowed item away. */
  defaultLoadoutAfterTransfer: EquipmentLoadout;
}

export interface ChallengeEscrowState {
  id: string;
  reserveTransitionId: string;
  reservedAt: ChallengeRuntimeClock;
  status: "reserved" | "released";
  parties: readonly ChallengeEscrowPartyState[];
  releaseTransitionId?: string;
  releasedAt?: ChallengeRuntimeClock;
}

export interface ChallengeFirstShotLock {
  transitionId: string;
  shotId: string;
  lockedAt: ChallengeRuntimeClock;
}

export interface ChallengeCancellation {
  transitionId: string;
  cancelledAt: ChallengeRuntimeClock;
}

/** One pure aggregate for accepted terms, escrow evidence, and the first-shot point of no return. */
export interface ChallengeRuntimeState {
  version: typeof CHALLENGE_RUNTIME_VERSION;
  id: string;
  contract: AcceptedChallengeContract;
  phase: ChallengeRuntimePhase;
  escrow: ChallengeEscrowState | null;
  firstShot: ChallengeFirstShotLock | null;
  cancellation: ChallengeCancellation | null;
}

export interface ChallengePartyCashChange {
  partyId: string;
  before: number;
  delta: number;
  after: number;
}

export interface ChallengeRuntimeTransitionResult {
  state: ChallengeRuntimeState;
  parties: readonly ChallengeLivePartyAssets[];
  /** Exact caller-facing deltas; the player-side entry is the future World.cash adapter boundary. */
  cashChanges: readonly ChallengePartyCashChange[];
}

const deepClone = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map((entry) => deepClone(entry)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, deepClone(entry)])) as T;
  }
  return value;
};

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
  }
  return value;
};

function assertId(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} requires a stable non-empty ID.`);
}

function assertClock(value: ChallengeRuntimeClock): void {
  if (!Number.isSafeInteger(value.week) || value.week < 0 || !Number.isSafeInteger(value.day) || value.day < 0) {
    throw new Error("Challenge transition time must use non-negative whole week/day values.");
  }
}

function assertCash(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe currency value.`);
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

function fallbackLoadout(loadout: EquipmentLoadout, transferredItemIds: readonly string[]): EquipmentLoadout {
  const transferred = new Set(transferredItemIds);
  return {
    clubItemIds: loadout.clubItemIds.filter((id) => !transferred.has(id)),
    bagItemId: loadout.bagItemId && !transferred.has(loadout.bagItemId) ? loadout.bagItemId : undefined,
    outfitItemId: loadout.outfitItemId && !transferred.has(loadout.outfitItemId) ? loadout.outfitItemId : undefined,
    watchItemId: loadout.watchItemId && !transferred.has(loadout.watchItemId) ? loadout.watchItemId : undefined,
    techniqueId: loadout.techniqueId,
  };
}

function validateRuntimeIdentity(state: ChallengeRuntimeState): void {
  const validationError = challengeRuntimeValidationError(state);
  if (validationError) throw new Error(validationError);
  if (state.version !== CHALLENGE_RUNTIME_VERSION || state.contract.version !== 1 || state.contract.status !== "accepted") {
    throw new Error("Challenge runtime requires one accepted version-1 contract.");
  }
  if (state.id !== `challenge-runtime:${state.contract.id}`) throw new Error("Challenge runtime ID does not match its accepted contract.");
}

/** Deferred comprehensive guard shared by every challenge command that may mutate assets. */
export function validateChallengeRuntimeForMutation(state: ChallengeRuntimeState): void {
  validateRuntimeIdentity(state);
}

function canonicalParties(
  state: ChallengeRuntimeState,
  liveParties: readonly ChallengeLivePartyAssets[],
): readonly ChallengeLivePartyAssets[] {
  if (liveParties.length !== state.contract.parties.length) throw new Error("Challenge transition requires live assets for both captain parties.");
  const ids = liveParties.map((party) => party.partyId);
  if (new Set(ids).size !== ids.length || !sameIds(ids, state.contract.parties.map((party) => party.id))) {
    throw new Error("Live challenge assets must match the accepted stable party IDs exactly.");
  }
  return state.contract.parties.map((contractParty) => {
    const live = liveParties.find((party) => party.partyId === contractParty.id)!;
    if (live.captainId !== contractParty.captainId || live.inventory.ownerId !== contractParty.captainId) {
      throw new Error(`${contractParty.id} live assets must belong to its accepted captain.`);
    }
    assertCash(live.cash, `${contractParty.id} live cash`);
    const inventoryIds = live.inventory.items.map((item) => item.id);
    if (new Set(inventoryIds).size !== inventoryIds.length) throw new Error(`${contractParty.id} live inventory contains duplicate item IDs.`);
    const escrowIds = live.inventory.escrowItemIds;
    if (new Set(escrowIds).size !== escrowIds.length) throw new Error(`${contractParty.id} live inventory contains duplicate escrow IDs.`);
    if (escrowIds.some((id) => !inventoryIds.includes(id))) throw new Error(`${contractParty.id} live inventory contains an orphan escrow ID.`);
    if ((state.phase === "accepted" || (state.phase === "cancelled" && !state.escrow)) && escrowIds.length > 0) {
      throw new Error(`${contractParty.id} cannot transition while another item escrow reservation is active.`);
    }
    return live;
  });
}

function validateFirstTeeItem(contractParty: AcceptedChallengeContract["parties"][number], live: ChallengeLivePartyAssets, itemId: string): InventoryItem {
  const item = live.inventory.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error(`${contractParty.id} first-tee inventory is missing accepted item ${itemId}.`);
  if (item.ownerId !== contractParty.captainId) throw new Error(`${itemId} is no longer owned by the accepted captain.`);
  if (item.custodianId !== contractParty.captainId) throw new Error(`${itemId} has the wrong first-tee custodian or is held elsewhere.`);
  if (item.transferable !== true) throw new Error(`${itemId} is no longer transferable.`);
  if (live.inventory.escrowItemIds.includes(itemId)) throw new Error(`${itemId} is already escrowed or restaked.`);
  const eligibility = contractParty.bundle.itemEligibility.find((entry) => entry.itemId === itemId);
  const acceptedAppraisal = contractParty.bundle.appraisal.find((entry) => entry.itemId === itemId);
  if (!eligibility || !acceptedAppraisal) throw new Error(`${itemId} is missing accepted appraisal or eligibility evidence.`);
  if (eligibility.category !== item.category || eligibility.ownerId !== item.ownerId || eligibility.custodianId !== item.custodianId
    || eligibility.unique !== item.unique || eligibility.prestige !== item.prestige || eligibility.confirmationRequired !== item.confirmationRequired) {
    throw new Error(`${itemId} no longer matches its accepted ownership and confirmation evidence.`);
  }
  const currentAppraisal = appraiseItem(item, acceptedAppraisal.frozenWeek, acceptedAppraisal.frozenDay);
  if (currentAppraisal.value !== acceptedAppraisal.value || JSON.stringify(currentAppraisal.basis) !== JSON.stringify(acceptedAppraisal.basis)) {
    throw new Error(`${itemId} appraisal inputs changed after acceptance.`);
  }
  return item;
}

function validateReservedAssets(
  state: ChallengeRuntimeState,
  liveParties: readonly ChallengeLivePartyAssets[],
): readonly ChallengeLivePartyAssets[] {
  const parties = canonicalParties(state, liveParties);
  if (!state.escrow) throw new Error("Challenge escrow evidence is missing.");
  for (const escrowParty of state.escrow.parties) {
    const live = parties.find((party) => party.partyId === escrowParty.partyId)!;
    if (!sameIds(live.inventory.escrowItemIds, escrowParty.itemIds)) {
      throw new Error(`${escrowParty.partyId} live escrow IDs do not exactly match the reserved challenge item IDs.`);
    }
    for (const id of escrowParty.itemIds) {
      const item = live.inventory.items.find((candidate) => candidate.id === id);
      if (!item || item.ownerId !== escrowParty.captainId || item.custodianId !== escrowParty.captainId) {
        throw new Error(`${id} must remain owned and held by its captain while escrowed.`);
      }
    }
  }
  return parties;
}

/** Comprehensive runtime plus exact live two-party escrow validation for settlement commands. */
export function validateChallengeReservedAssetsForMutation(
  state: ChallengeRuntimeState,
  liveParties: readonly ChallengeLivePartyAssets[],
): readonly ChallengeLivePartyAssets[] {
  validateRuntimeIdentity(state);
  return validateReservedAssets(state, liveParties);
}

function noCashChanges(parties: readonly ChallengeLivePartyAssets[]): readonly ChallengePartyCashChange[] {
  return parties.map((party) => ({ partyId: party.partyId, before: party.cash, delta: 0, after: party.cash }));
}

export function createChallengeRuntimeState(contract: AcceptedChallengeContract): ChallengeRuntimeState {
  if (contract.version !== 1 || contract.status !== "accepted" || typeof contract.id !== "string" || !contract.id) {
    throw new Error("Challenge runtime requires one accepted version-1 contract.");
  }
  const partyIds = contract.parties.map((party) => party.id);
  if (contract.parties.length !== 2 || new Set(partyIds).size !== partyIds.length) throw new Error("Challenge runtime requires two stable contract party IDs.");
  return deepFreeze({
    version: CHALLENGE_RUNTIME_VERSION,
    id: `challenge-runtime:${contract.id}`,
    contract: deepClone(contract),
    phase: "accepted",
    escrow: null,
    firstShot: null,
    cancellation: null,
  });
}

/** Validates both sides before creating either mutation, so first-tee reservation is all-or-nothing. */
export function reserveChallengeAtFirstTee(args: {
  state: ChallengeRuntimeState;
  parties: readonly ChallengeLivePartyAssets[];
  transitionId: string;
  at: ChallengeRuntimeClock;
}): ChallengeRuntimeTransitionResult {
  validateRuntimeIdentity(args.state);
  assertId(args.transitionId, "First-tee transition");
  assertClock(args.at);
  if (args.state.phase === "cancelled") throw new Error("A cancelled challenge cannot enter first-tee escrow.");
  if (args.state.escrow) {
    if (args.state.escrow.reserveTransitionId !== args.transitionId) throw new Error("Challenge first-tee escrow was already created by a different transition ID.");
    const parties = validateReservedAssets(args.state, args.parties);
    return { state: args.state, parties, cashChanges: noCashChanges(parties) };
  }
  if (args.state.phase !== "accepted") throw new Error("Only an accepted challenge may enter first-tee escrow.");
  const parties = canonicalParties(args.state, args.parties);
  const staged = args.state.contract.parties.map((contractParty) => {
    const live = parties.find((party) => party.partyId === contractParty.id)!;
    assertCash(contractParty.totalCashExposure, `${contractParty.id} accepted cash exposure`);
    if (live.cash < contractParty.totalCashExposure) {
      throw new Error(`${contractParty.id} captain lacks ${contractParty.totalCashExposure} cash required at the first tee.`);
    }
    const itemIds = contractParty.bundle.itemIds;
    const items = itemIds.map((id) => validateFirstTeeItem(contractParty, live, id));
    const cashAfter = live.cash - contractParty.totalCashExposure;
    return {
      live,
      next: {
        ...live,
        cash: cashAfter,
        inventory: { ...live.inventory, escrowItemIds: [...live.inventory.escrowItemIds, ...itemIds] },
      },
      cashChange: { partyId: live.partyId, before: live.cash, delta: -contractParty.totalCashExposure, after: cashAfter },
      escrow: {
        partyId: live.partyId,
        captainId: live.captainId,
        reservedCash: contractParty.totalCashExposure,
        cashBefore: live.cash,
        cashAfter,
        itemIds: [...itemIds],
        itemSnapshots: items.map((item) => deepClone(item)),
        loadoutAtReservation: deepClone(live.loadout),
        defaultLoadoutAfterTransfer: fallbackLoadout(live.loadout, itemIds),
      },
    };
  });
  const state = deepFreeze({
    ...args.state,
    phase: "escrowed" as const,
    escrow: {
      id: `challenge-escrow:${args.state.contract.id}`,
      reserveTransitionId: args.transitionId,
      reservedAt: { ...args.at },
      status: "reserved" as const,
      parties: staged.map((entry) => entry.escrow),
    },
  });
  return { state, parties: staged.map((entry) => entry.next), cashChanges: staged.map((entry) => entry.cashChange) };
}

/** The first committed shot permanently closes the pre-shot cancellation path. */
export function lockChallengeFirstShot(args: {
  state: ChallengeRuntimeState;
  transitionId: string;
  shotId: string;
  at: ChallengeRuntimeClock;
}): ChallengeRuntimeState {
  validateRuntimeIdentity(args.state);
  assertId(args.transitionId, "First-shot transition");
  assertId(args.shotId, "First shot");
  assertClock(args.at);
  if (args.state.phase === "cancelled") throw new Error("A cancelled challenge cannot lock a first shot.");
  if (!args.state.escrow || args.state.phase === "accepted") throw new Error("First-shot lock requires completed first-tee escrow.");
  if (args.state.firstShot) {
    if (args.state.firstShot.transitionId === args.transitionId && args.state.firstShot.shotId === args.shotId) return args.state;
    throw new Error(`Challenge first shot is already locked to ${args.state.firstShot.shotId}.`);
  }
  if (args.state.phase !== "escrowed" || args.state.escrow.status !== "reserved") throw new Error("Challenge first-shot lock requires active escrow.");
  return deepFreeze({
    ...args.state,
    phase: "shot_locked",
    firstShot: { transitionId: args.transitionId, shotId: args.shotId, lockedAt: { ...args.at } },
  });
}

/** Releases both parties together only before the first shot; no settlement authority is implied. */
export function cancelChallengeBeforeFirstShot(args: {
  state: ChallengeRuntimeState;
  parties: readonly ChallengeLivePartyAssets[];
  transitionId: string;
  at: ChallengeRuntimeClock;
}): ChallengeRuntimeTransitionResult {
  validateRuntimeIdentity(args.state);
  assertId(args.transitionId, "Challenge cancellation transition");
  assertClock(args.at);
  if (args.state.phase === "shot_locked" || args.state.firstShot) {
    throw new Error("Challenge cancellation is closed after the first committed shot; settlement or concession must resolve escrow.");
  }
  if (args.state.phase === "cancelled") {
    if (args.state.cancellation?.transitionId !== args.transitionId) throw new Error("Challenge was already cancelled by a different transition ID.");
    const parties = canonicalParties(args.state, args.parties);
    if (args.state.escrow?.parties.some((escrowParty) => escrowParty.itemIds.some((id) => parties.find((party) => party.partyId === escrowParty.partyId)!.inventory.escrowItemIds.includes(id)))) {
      throw new Error("Duplicate cancellation requires already-released party assets; refusing a second cash refund.");
    }
    return { state: args.state, parties, cashChanges: noCashChanges(parties) };
  }
  if (args.state.phase === "accepted") {
    const parties = canonicalParties(args.state, args.parties);
    const state = deepFreeze({
      ...args.state,
      phase: "cancelled" as const,
      cancellation: { transitionId: args.transitionId, cancelledAt: { ...args.at } },
    });
    return { state, parties, cashChanges: noCashChanges(parties) };
  }
  if (args.state.phase !== "escrowed" || !args.state.escrow || args.state.escrow.status !== "reserved") {
    throw new Error("Only accepted or pre-shot escrowed challenges may be cancelled.");
  }
  const parties = validateReservedAssets(args.state, args.parties);
  const staged = args.state.escrow.parties.map((escrowParty) => {
    const live = parties.find((party) => party.partyId === escrowParty.partyId)!;
    if (!Number.isSafeInteger(live.cash + escrowParty.reservedCash)) throw new Error(`${live.partyId} cash refund exceeds safe currency bounds.`);
    const cashAfter = live.cash + escrowParty.reservedCash;
    return {
      next: {
        ...live,
        cash: cashAfter,
        inventory: { ...live.inventory, escrowItemIds: live.inventory.escrowItemIds.filter((id) => !escrowParty.itemIds.includes(id)) },
      },
      cashChange: { partyId: live.partyId, before: live.cash, delta: escrowParty.reservedCash, after: cashAfter },
    };
  });
  const state = deepFreeze({
    ...args.state,
    phase: "cancelled" as const,
    escrow: {
      ...args.state.escrow,
      status: "released" as const,
      releaseTransitionId: args.transitionId,
      releasedAt: { ...args.at },
    },
    cancellation: { transitionId: args.transitionId, cancelledAt: { ...args.at } },
  });
  return { state, parties: staged.map((entry) => entry.next), cashChanges: staged.map((entry) => entry.cashChange) };
}
