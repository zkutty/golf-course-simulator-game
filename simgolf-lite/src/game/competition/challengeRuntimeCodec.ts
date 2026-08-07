import type { AcceptedChallengeContract, AcceptedChallengeContractParty } from "./challengeContracts";
import type { ChallengeEscrowPartyState, ChallengeRuntimeState } from "./challengeRuntime";
import type { EquipmentLoadout, InventoryItem, PlayerInventory } from "./types";

export type ChallengeRuntimeDecodeResult =
  | { ok: true; state: ChallengeRuntimeState }
  | { ok: false; error: string };

const record = (value: unknown): value is Record<string, unknown> => value != null && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const safeMoney = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const uniqueIds = (value: unknown): value is string[] => Array.isArray(value) && value.every(id) && new Set(value).size === value.length;
const clock = (value: unknown) => record(value) && Number.isSafeInteger(value.week) && (value.week as number) >= 0
  && Number.isSafeInteger(value.day) && (value.day as number) >= 0;
const sameIds = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((entry) => right.includes(entry));

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

function validLoadout(value: unknown): value is EquipmentLoadout {
  if (!record(value) || !uniqueIds(value.clubItemIds)) return false;
  if ([value.bagItemId, value.outfitItemId, value.watchItemId].some((entry) => entry != null && !id(entry))) return false;
  return value.techniqueId == null || ["fairway-finder", "knockdown-approach", "soft-hands", "splash-specialist", "lag-putt"].includes(value.techniqueId as string);
}

function validItem(value: unknown): value is InventoryItem {
  if (!record(value) || !id(value.id) || !id(value.definitionId) || typeof value.name !== "string"
    || !["club", "bag", "outfit", "watch", "vehicle", "trophy", "keepsake", "plant-stock", "service-credit"].includes(value.category as string)
    || !id(value.ownerId) || !id(value.custodianId) || !finite(value.authoredValue) || (value.authoredValue as number) < 0
    || !finite(value.remainingValue) || (value.remainingValue as number) < 0 || !finite(value.prestige) || (value.prestige as number) < 0
    || typeof value.unique !== "boolean" || typeof value.confirmationRequired !== "boolean" || value.transferable !== true
    || !Array.isArray(value.transferHistory)) return false;
  if (value.category === "plant-stock" && (!Number.isSafeInteger(value.remainingPlacements) || (value.remainingPlacements as number) < 0
    || !finite(value.frozenInstallValueEach) || (value.frozenInstallValueEach as number) < 0)) return false;
  return value.transferHistory.every((entry) => record(entry) && id(entry.id) && Number.isSafeInteger(entry.week) && Number.isSafeInteger(entry.day)
    && id(entry.fromOwnerId) && id(entry.toOwnerId) && id(entry.custodianId) && ["reward", "stake", "recovery", "import"].includes(entry.reason as string))
    && (value.modifiers == null || (Array.isArray(value.modifiers) && value.modifiers.every((entry) => record(entry) && finite(entry.multiplier) && typeof entry.channel === "string")))
    && (value.capabilities == null || (Array.isArray(value.capabilities) && value.capabilities.every((entry) => entry === "casino-host-capacity")));
}

function validAppraisal(value: unknown): boolean {
  if (!record(value) || !safeMoney(value.value) || !Number.isSafeInteger(value.frozenWeek) || (value.frozenWeek as number) < 0
    || !Number.isSafeInteger(value.frozenDay) || (value.frozenDay as number) < 0 || !record(value.basis)) return false;
  if (value.itemId != null && !id(value.itemId)) return false;
  if (value.cash != null && (!safeMoney(value.cash) || value.cash !== value.value)) return false;
  if ((value.itemId == null) === (value.cash == null)) return false;
  return Object.values(value.basis).every((entry) => safeMoney(entry));
}

function validContractParty(value: unknown): value is AcceptedChallengeContractParty {
  if (!record(value) || !id(value.id) || !["player", "rival"].includes(value.side as string) || !id(value.captainId) || !id(value.teamId)
    || !safeMoney(value.availableCash) || !safeMoney(value.sideBetCashExposure) || !safeMoney(value.totalCashExposure) || !record(value.bundle)) return false;
  const bundle = value.bundle;
  if (!safeMoney(bundle.cash) || !uniqueIds(bundle.itemIds) || !Array.isArray(bundle.appraisal) || !bundle.appraisal.every(validAppraisal)
    || !Array.isArray(bundle.itemEligibility) || !safeMoney(bundle.totalValue)
    || !uniqueIds(bundle.requiredOwnerConfirmationItemIds) || !uniqueIds(bundle.requiredPrestigeConfirmationItemIds)
    || !uniqueIds(bundle.ownerConfirmedItemIds) || !uniqueIds(bundle.prestigeConfirmedItemIds)) return false;
  if (value.totalCashExposure !== (bundle.cash as number) + (value.sideBetCashExposure as number)
    || (value.availableCash as number) < (value.totalCashExposure as number)
    || !sameIds(bundle.requiredOwnerConfirmationItemIds, bundle.itemIds)
    || !sameIds(bundle.ownerConfirmedItemIds, bundle.itemIds)
    || !sameIds(bundle.prestigeConfirmedItemIds, bundle.requiredPrestigeConfirmationItemIds)) return false;
  const appraisals = bundle.appraisal as unknown[];
  const itemAppraisalIds = appraisals.map((entry) => (entry as { itemId?: string }).itemId).filter((entry): entry is string => typeof entry === "string");
  const cashAppraisals = appraisals.filter((entry) => record(entry) && entry.cash != null);
  if (!sameIds(itemAppraisalIds, bundle.itemIds) || cashAppraisals.length !== (bundle.cash === 0 ? 0 : 1)
    || (cashAppraisals[0] && (cashAppraisals[0] as { cash: number }).cash !== bundle.cash)
    || appraisals.reduce<number>((sum, entry) => sum + ((entry as { value: number }).value), 0) !== bundle.totalValue) return false;
  const eligibility = bundle.itemEligibility as unknown[];
  if (!sameIds(eligibility.map((entry) => record(entry) ? entry.itemId as string : ""), bundle.itemIds)) return false;
  return eligibility.every((entry) => record(entry) && id(entry.itemId)
    && ["club", "bag", "outfit", "watch", "vehicle", "trophy", "keepsake", "plant-stock", "service-credit"].includes(entry.category as string)
    && entry.ownerId === value.captainId && entry.custodianId === value.captainId && entry.transferable === true && entry.escrowed === false
    && typeof entry.unique === "boolean" && finite(entry.prestige) && (entry.prestige as number) >= 0 && typeof entry.confirmationRequired === "boolean");
}

function validContract(value: unknown): value is AcceptedChallengeContract {
  if (!record(value) || value.version !== 1 || value.status !== "accepted" || !id(value.id) || !clock(value.acceptedAt)
    || !Array.isArray(value.parties) || value.parties.length !== 2 || !value.parties.every(validContractParty)
    || !record(value.terms) || !record(value.valueComparison)) return false;
  const parties = value.parties as unknown as AcceptedChallengeContractParty[];
  if (new Set(parties.map((party) => party.id)).size !== 2 || parties.filter((party) => party.side === "player").length !== 1
    || parties.filter((party) => party.side === "rival").length !== 1 || new Set(parties.map((party) => party.captainId)).size !== 2) return false;
  const terms = value.terms;
  if (!record(terms.format) || !["individual", "four-ball", "alternate-shot", "scramble"].includes(terms.format.teamFormat as string)
    || !["gross-stroke", "net-stroke", "gross-match", "net-match", "net-stableford"].includes(terms.format.scoring as string)
    || !Array.isArray(terms.teams) || terms.teams.length !== 2 || !Array.isArray(terms.participantSetups) || !Array.isArray(terms.sideBets)) return false;
  const teams = terms.teams as unknown[];
  if (teams.some((team) => !record(team) || !id(team.id) || !id(team.partyId) || !id(team.captainId)
    || !uniqueIds(team.partnerIds) || !uniqueIds(team.participantIds) || !sameIds(team.participantIds, [team.captainId as string, ...(team.partnerIds as string[])]))) return false;
  for (const party of parties) {
    const team = teams.find((entry) => record(entry) && entry.partyId === party.id);
    if (!record(team) || team.id !== party.teamId || team.captainId !== party.captainId) return false;
  }
  const participants = teams.flatMap((team) => (team as { participantIds: string[] }).participantIds);
  if (new Set(participants).size !== participants.length) return false;
  const setups = terms.participantSetups as unknown[];
  if (setups.some((setup) => !record(setup) || !id(setup.participantId) || !["forward", "member", "championship"].includes(setup.teeSet as string)
    || !["A", "B", "C"].includes(setup.pinRotation as string))
    || !sameIds(setups.map((setup) => (setup as { participantId: string }).participantId), participants)) return false;
  let sideBetExposure = 0;
  const sideBetIds: string[] = [];
  for (const sideBet of terms.sideBets as unknown[]) {
    if (!record(sideBet) || !id(sideBet.id) || sideBetIds.includes(sideBet.id) || !["skins", "nassau", "closest-to-pin", "longest-drive"].includes(sideBet.kind as string)
      || !safeMoney(sideBet.stake) || sideBet.stake === 0 || !uniqueIds(sideBet.holeIds)
      || !Number.isSafeInteger(sideBetExposure + (sideBet.stake as number))) return false;
    sideBetIds.push(sideBet.id);
    sideBetExposure += sideBet.stake as number;
  }
  if (parties.some((party) => party.sideBetCashExposure !== sideBetExposure)) return false;
  const player = parties.find((party) => party.side === "player")!;
  const rival = parties.find((party) => party.side === "rival")!;
  const comparison = value.valueComparison;
  const signed = player.bundle.totalValue - rival.bundle.totalValue;
  const absolute = Math.abs(signed);
  const maximum = Math.max(player.bundle.totalValue, rival.bundle.totalValue);
  const relative = maximum === 0 ? 0 : absolute / maximum;
  return comparison.playerPartyId === player.id && comparison.rivalPartyId === rival.id
    && comparison.playerValue === player.bundle.totalValue && comparison.rivalValue === rival.bundle.totalValue
    && comparison.playerMinusRivalValue === signed && comparison.absoluteValueDifference === absolute
    && comparison.relativeValueDifference === relative && comparison.valueDifferencePercent === relative * 100
    && comparison.withinTolerance === (maximum === 0 || BigInt(absolute) * 100n <= BigInt(maximum) * 20n)
    && comparison.cashBalancingAmount === absolute
    && comparison.cashBalancingPartyId === (signed === 0 ? null : signed < 0 ? player.id : rival.id);
}

function expectedFallback(loadout: EquipmentLoadout, itemIds: readonly string[]): EquipmentLoadout {
  const lost = new Set(itemIds);
  return {
    clubItemIds: loadout.clubItemIds.filter((entry) => !lost.has(entry)),
    bagItemId: loadout.bagItemId && !lost.has(loadout.bagItemId) ? loadout.bagItemId : undefined,
    outfitItemId: loadout.outfitItemId && !lost.has(loadout.outfitItemId) ? loadout.outfitItemId : undefined,
    watchItemId: loadout.watchItemId && !lost.has(loadout.watchItemId) ? loadout.watchItemId : undefined,
    techniqueId: loadout.techniqueId,
  };
}

function validEscrowParty(value: unknown, contractParty: AcceptedChallengeContractParty): value is ChallengeEscrowPartyState {
  if (!record(value) || value.partyId !== contractParty.id || value.captainId !== contractParty.captainId
    || value.reservedCash !== contractParty.totalCashExposure || !safeMoney(value.cashBefore) || !safeMoney(value.cashAfter)
    || value.cashAfter !== (value.cashBefore as number) - (value.reservedCash as number) || !uniqueIds(value.itemIds)
    || !sameIds(value.itemIds, contractParty.bundle.itemIds) || !Array.isArray(value.itemSnapshots)
    || !validLoadout(value.loadoutAtReservation) || !validLoadout(value.defaultLoadoutAfterTransfer)) return false;
  const snapshots = value.itemSnapshots as unknown[];
  if (!sameIds(snapshots.map((entry) => record(entry) ? entry.id as string : ""), value.itemIds as string[])
    || !snapshots.every((entry) => validItem(entry) && entry.ownerId === contractParty.captainId && entry.custodianId === contractParty.captainId)) return false;
  return JSON.stringify(value.defaultLoadoutAfterTransfer) === JSON.stringify(expectedFallback(value.loadoutAtReservation, value.itemIds as string[]));
}

function validRuntime(value: unknown): value is ChallengeRuntimeState {
  if (!record(value) || value.version !== 1 || !id(value.id) || !validContract(value.contract)
    || value.id !== `challenge-runtime:${value.contract.id}` || !["accepted", "escrowed", "shot_locked", "cancelled"].includes(value.phase as string)) return false;
  const phase = value.phase;
  const hasEscrow = value.escrow != null;
  const hasShot = value.firstShot != null;
  const hasCancellation = value.cancellation != null;
  if (phase === "accepted") return !hasEscrow && !hasShot && !hasCancellation;
  if (!hasEscrow && phase !== "cancelled") return false;
  if (hasEscrow) {
    if (!record(value.escrow) || value.escrow.id !== `challenge-escrow:${value.contract.id}` || !id(value.escrow.reserveTransitionId)
      || !clock(value.escrow.reservedAt) || !["reserved", "released"].includes(value.escrow.status as string)
      || !Array.isArray(value.escrow.parties) || value.escrow.parties.length !== 2) return false;
    const escrowPartyIds = value.escrow.parties.map((entry) => record(entry) ? entry.partyId : null);
    if (!sameIds(escrowPartyIds as string[], value.contract.parties.map((party) => party.id))) return false;
    for (const contractParty of value.contract.parties) {
      if (!validEscrowParty(value.escrow.parties.find((entry) => record(entry) && entry.partyId === contractParty.id), contractParty)) return false;
    }
    if (value.escrow.status === "released") {
      if (!id(value.escrow.releaseTransitionId) || !clock(value.escrow.releasedAt)) return false;
    } else if (value.escrow.releaseTransitionId != null || value.escrow.releasedAt != null) return false;
  }
  if (hasShot && (!record(value.firstShot) || !id(value.firstShot.transitionId) || !id(value.firstShot.shotId) || !clock(value.firstShot.lockedAt))) return false;
  if (hasCancellation && (!record(value.cancellation) || !id(value.cancellation.transitionId) || !clock(value.cancellation.cancelledAt))) return false;
  if (phase === "escrowed") return hasEscrow && (value.escrow as Record<string, unknown>).status === "reserved" && !hasShot && !hasCancellation;
  if (phase === "shot_locked") return hasEscrow && (value.escrow as Record<string, unknown>).status === "reserved" && hasShot && !hasCancellation;
  if (phase === "cancelled") {
    if (hasShot || !hasCancellation) return false;
    if (!hasEscrow) return true;
    return (value.escrow as Record<string, unknown>).status === "released"
      && (value.escrow as Record<string, unknown>).releaseTransitionId === (value.cancellation as Record<string, unknown>).transitionId;
  }
  return false;
}

/** Comprehensive semantic validation used at the deferred challenge-mutation boundary. */
export function challengeRuntimeValidationError(value: unknown): string | null {
  return validRuntime(value) ? null : "Challenge runtime save is invalid.";
}

export function decodeChallengeRuntimeState(raw: string | unknown): ChallengeRuntimeDecodeResult {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : deepClone(raw);
    const error = challengeRuntimeValidationError(parsed);
    if (error) return { ok: false, error };
    return { ok: true, state: deepFreeze(parsed) };
  } catch {
    return { ok: false, error: "Challenge runtime save is not valid JSON." };
  }
}

export function encodeChallengeRuntimeState(state: ChallengeRuntimeState): string {
  const decoded = decodeChallengeRuntimeState(state);
  if (!decoded.ok) throw new Error(decoded.error);
  return JSON.stringify(decoded.state);
}

export function expectedPlayerChallengeEscrowItemIds(state: ChallengeRuntimeState, playerId: string): readonly string[] | null {
  const party = state.contract.parties.find((entry) => entry.side === "player");
  if (!party || party.captainId !== playerId) return null;
  return state.phase === "escrowed" || state.phase === "shot_locked" ? party.bundle.itemIds : [];
}

export function challengeRuntimeMatchesPlayerInventory(state: ChallengeRuntimeState, playerId: string, inventory: PlayerInventory): boolean {
  const expected = expectedPlayerChallengeEscrowItemIds(state, playerId);
  if (!expected || inventory.ownerId !== playerId || !sameIds(inventory.escrowItemIds, expected)) return false;
  return expected.every((itemId) => inventory.items.filter((item) => item.id === itemId && item.ownerId === playerId && item.custodianId === playerId).length === 1);
}

/** Full-save invariant: malformed runtime or unmatched player reservations reject; financial state is never self-healed. */
export function challengeRuntimeCareerPersistenceError(rawPlayerPro: unknown): string | null {
  if (!record(rawPlayerPro)) return null;
  if (rawPlayerPro.activeChallengeRuntime == null) return null;
  const decoded = decodeChallengeRuntimeState(rawPlayerPro.activeChallengeRuntime);
  if (!decoded.ok) return decoded.error;
  if (!record(rawPlayerPro.identity) || !id(rawPlayerPro.identity.id) || !record(rawPlayerPro.inventory)
    || !Array.isArray(rawPlayerPro.inventory.items) || !Array.isArray(rawPlayerPro.inventory.escrowItemIds)) {
    return "Challenge runtime player inventory evidence is invalid.";
  }
  const identityId = rawPlayerPro.identity.id as string;
  const expected = expectedPlayerChallengeEscrowItemIds(decoded.state, identityId);
  if (!expected || !uniqueIds(rawPlayerPro.inventory.escrowItemIds) || !sameIds(rawPlayerPro.inventory.escrowItemIds, expected)) {
    return "Challenge runtime player escrow IDs do not exactly match the active contract.";
  }
  for (const itemId of expected) {
    const matches = rawPlayerPro.inventory.items.filter((item) => record(item) && item.id === itemId);
    if (matches.length !== 1 || matches[0].ownerId !== identityId || matches[0].custodianId !== identityId) {
      return "Challenge runtime player escrow contains an unowned, missing, or duplicate item.";
    }
  }
  return null;
}
