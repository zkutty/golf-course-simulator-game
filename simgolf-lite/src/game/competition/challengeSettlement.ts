import { transferItem } from "./inventory";
import {
  validateChallengeReservedAssetsForMutation,
  validateChallengeRuntimeForMutation,
  type ChallengeLivePartyAssets,
  type ChallengePartyCashChange,
  type ChallengeRuntimeClock,
  type ChallengeRuntimeState,
} from "./challengeRuntime";
import type { AcceptedChallengeContract, ChallengeContractBundleAppraisal } from "./challengeContracts";
import type { EquipmentLoadout, InventoryItem, PlayerInventory, RivalCustodyRecord } from "./types";

export type ChallengeSettlementResolutionKind = "completed" | "concession" | "withdrawal";
export type ChallengeComponentOutcome = "awarded" | "tied" | "refunded";

export interface ChallengeComponentResolutionEvidence {
  componentId: "main" | string;
  outcome: ChallengeComponentOutcome;
  winnerPartyId?: string;
  evidenceIds: readonly string[];
  /** Human-readable authority for non-competitive refunds, retained in settlement history. */
  reason?: string;
}

export interface ChallengeSettlementEvidence {
  resolutionId: string;
  kind: ChallengeSettlementResolutionKind;
  /** Required loser/withdrawn party for non-completed resolutions. */
  resolvedAgainstPartyId?: string;
  components: readonly ChallengeComponentResolutionEvidence[];
}

export interface ChallengeSettlementPartyAssets extends ChallengeLivePartyAssets {
  captainName: string;
  rivalCustody: readonly RivalCustodyRecord[];
  settlementLedger: readonly string[];
}

export interface ChallengeSettlementPartyRecord {
  partyId: string;
  captainId: string;
  cashBefore: number;
  cashDelta: number;
  cashAfter: number;
  returnedItemIds: readonly string[];
  receivedItemIds: readonly string[];
  transferredAwayItemIds: readonly string[];
  inventoryItemIdsAfter: readonly string[];
  escrowItemIdsAfter: readonly string[];
  loadoutAfter: EquipmentLoadout;
  displayItemIdsAfter: readonly string[];
  selectedVehicleIdAfter?: string;
  /** Exact immutable post-state used to prove safe idempotent replay after reload. */
  inventoryAfter: PlayerInventory;
  rivalCustodyAfter: readonly RivalCustodyRecord[];
  settlementLedgerAfter: readonly string[];
}

export interface ChallengeSettlementItemTransfer {
  id: string;
  itemId: string;
  fromPartyId: string;
  fromCaptainId: string;
  toPartyId: string;
  toCaptainId: string;
  before: InventoryItem;
  after: InventoryItem;
  custodyId: string;
}

export interface ChallengeSettlementRecord {
  version: 1;
  id: string;
  transitionId: string;
  settledAt: ChallengeRuntimeClock;
  runtime: ChallengeRuntimeState;
  contract: AcceptedChallengeContract;
  frozenAppraisal: readonly {
    partyId: string;
    bundle: ChallengeContractBundleAppraisal;
  }[];
  evidence: ChallengeSettlementEvidence;
  resolutionEvidenceIds: readonly string[];
  parties: readonly ChallengeSettlementPartyRecord[];
  cashChanges: readonly ChallengePartyCashChange[];
  transferredItems: readonly ChallengeSettlementItemTransfer[];
  resultingCustody: readonly RivalCustodyRecord[];
}

export interface ChallengeSettlementResult {
  settlement: ChallengeSettlementRecord;
  parties: readonly ChallengeSettlementPartyAssets[];
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
    throw new Error("Challenge settlement time must use non-negative whole week/day values.");
  }
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry) => right.includes(entry)) && right.every((entry) => left.includes(entry));
}

function componentMap(state: ChallengeRuntimeState, evidence: ChallengeSettlementEvidence): ReadonlyMap<string, ChallengeComponentResolutionEvidence> {
  assertId(evidence.resolutionId, "Challenge resolution");
  const expectedIds = ["main", ...state.contract.terms.sideBets.map((sideBet) => sideBet.id)];
  const componentIds = evidence.components.map((component) => component.componentId);
  if (!sameIds(componentIds, expectedIds) || new Set(componentIds).size !== componentIds.length) {
    throw new Error("Challenge settlement requires exactly one outcome for the main bundle and every accepted side bet.");
  }
  const partyIds = state.contract.parties.map((party) => party.id);
  const allEvidenceIds: string[] = [];
  for (const component of evidence.components) {
    assertId(component.componentId, "Challenge settlement component");
    if (!Array.isArray(component.evidenceIds) || component.evidenceIds.length === 0) {
      throw new Error(`${component.componentId} requires evidence before settlement.`);
    }
    component.evidenceIds.forEach((evidenceId) => assertId(evidenceId, `${component.componentId} evidence`));
    if (new Set(component.evidenceIds).size !== component.evidenceIds.length) throw new Error(`${component.componentId} contains duplicate evidence IDs.`);
    allEvidenceIds.push(...component.evidenceIds);
    if (component.outcome === "awarded") {
      if (!component.winnerPartyId || !partyIds.includes(component.winnerPartyId)) throw new Error(`${component.componentId} awarded outcome requires one accepted winner party.`);
    } else if (component.outcome === "tied" || component.outcome === "refunded") {
      if (component.winnerPartyId != null) throw new Error(`${component.componentId} tie/refund cannot name a winner.`);
      if (component.outcome === "refunded" && (typeof component.reason !== "string" || !component.reason.trim())) {
        throw new Error(`${component.componentId} refund requires a preserved reason.`);
      }
    } else {
      throw new Error(`${component.componentId} outcome is invalid.`);
    }
  }
  if (new Set(allEvidenceIds).size !== allEvidenceIds.length) throw new Error("Challenge component outcomes cannot reuse an evidence ID.");
  const main = evidence.components.find((component) => component.componentId === "main")!;
  if (evidence.kind === "completed") {
    if (evidence.resolvedAgainstPartyId != null) throw new Error("Completed challenge evidence cannot name a conceding or withdrawing party.");
  } else {
    if (!evidence.resolvedAgainstPartyId || !partyIds.includes(evidence.resolvedAgainstPartyId)) {
      throw new Error("Concession/withdrawal evidence requires the accepted losing party ID.");
    }
    const winner = partyIds.find((partyId) => partyId !== evidence.resolvedAgainstPartyId)!;
    if (main.outcome !== "awarded" || main.winnerPartyId !== winner) {
      throw new Error("Concession/withdrawal must award the main bundle to the other captain party.");
    }
  }
  return new Map(evidence.components.map((component) => [component.componentId, component]));
}

function exactEscrowSnapshots(state: ChallengeRuntimeState, parties: readonly ChallengeSettlementPartyAssets[]): void {
  for (const escrowParty of state.escrow!.parties) {
    const live = parties.find((party) => party.partyId === escrowParty.partyId)!;
    for (const snapshot of escrowParty.itemSnapshots) {
      const current = live.inventory.items.find((item) => item.id === snapshot.id);
      if (!current || JSON.stringify(current) !== JSON.stringify(snapshot)) {
        throw new Error(`${snapshot.id} changed while reserved; settlement refuses mutated escrow evidence.`);
      }
    }
  }
}

function moneyAfter(before: number, delta: number, partyId: string): number {
  if (!Number.isSafeInteger(delta) || delta < 0 || !Number.isSafeInteger(before + delta)) {
    throw new Error(`${partyId} settlement cash exceeds safe currency bounds.`);
  }
  return before + delta;
}

function verifyDuplicate(
  previous: ChallengeSettlementRecord,
  state: ChallengeRuntimeState,
  parties: readonly ChallengeSettlementPartyAssets[],
  transitionId: string,
  evidence: ChallengeSettlementEvidence,
): ChallengeSettlementResult {
  if (previous.transitionId !== transitionId || JSON.stringify(previous.runtime) !== JSON.stringify(state)
    || JSON.stringify(previous.evidence) !== JSON.stringify(evidence)) {
    throw new Error("Challenge was already settled by different transition or resolution evidence.");
  }
  for (const partyRecord of previous.parties) {
    const live = parties.find((party) => party.partyId === partyRecord.partyId);
    if (!live || live.cash !== partyRecord.cashAfter
      || JSON.stringify(live.settlementLedger) !== JSON.stringify(partyRecord.settlementLedgerAfter)
      || JSON.stringify(live.rivalCustody) !== JSON.stringify(partyRecord.rivalCustodyAfter)
      || JSON.stringify(live.inventory) !== JSON.stringify(partyRecord.inventoryAfter)
      || JSON.stringify(live.loadout) !== JSON.stringify(partyRecord.loadoutAfter)
      || !partyRecord.settlementLedgerAfter.includes(previous.id)) {
      throw new Error("Duplicate challenge settlement requires the exact previously recorded post-settlement assets.");
    }
  }
  return {
    settlement: previous,
    parties,
    cashChanges: parties.map((party) => ({ partyId: party.partyId, before: party.cash, delta: 0, after: party.cash })),
  };
}

/** Pure, atomic allocation of already-reserved challenge assets. */
export function settleChallenge(args: {
  state: ChallengeRuntimeState;
  parties: readonly ChallengeSettlementPartyAssets[];
  transitionId: string;
  at: ChallengeRuntimeClock;
  evidence: ChallengeSettlementEvidence;
  previous?: ChallengeSettlementRecord;
}): ChallengeSettlementResult {
  assertId(args.transitionId, "Challenge settlement transition");
  assertClock(args.at);
  validateChallengeRuntimeForMutation(args.state);
  if (args.state.phase !== "shot_locked" || !args.state.firstShot || args.state.escrow?.status !== "reserved") {
    throw new Error("Challenge settlement requires a comprehensively valid first-shot lock and active escrow.");
  }
  const components = componentMap(args.state, args.evidence);
  if (args.previous) return verifyDuplicate(args.previous, args.state, args.parties, args.transitionId, args.evidence);
  validateChallengeReservedAssetsForMutation(args.state, args.parties);

  const settlementId = `challenge-settlement:${args.state.contract.id}`;
  const parties = args.state.contract.parties.map((contractParty) => args.parties.find((party) => party.partyId === contractParty.id)!);
  if (parties.some((party) => party.settlementLedger.includes(settlementId))) {
    throw new Error("Challenge settlement ledger exists without its required immutable settlement record.");
  }
  exactEscrowSnapshots(args.state, parties);

  const credits = new Map(parties.map((party) => [party.partyId, 0]));
  const creditComponent = (component: ChallengeComponentResolutionEvidence, exposures: ReadonlyMap<string, number>) => {
    if (component.outcome === "awarded") {
      const pool = [...exposures.values()].reduce((sum, value) => sum + value, 0);
      credits.set(component.winnerPartyId!, credits.get(component.winnerPartyId!)! + pool);
    } else {
      for (const [partyId, exposure] of exposures) credits.set(partyId, credits.get(partyId)! + exposure);
    }
  };
  creditComponent(components.get("main")!, new Map(args.state.contract.parties.map((party) => [party.id, party.bundle.cash])));
  for (const sideBet of args.state.contract.terms.sideBets) {
    creditComponent(components.get(sideBet.id)!, new Map(args.state.contract.parties.map((party) => [party.id, sideBet.stake])));
  }
  const totalReserved = args.state.escrow.parties.reduce((sum, party) => sum + party.reservedCash, 0);
  if ([...credits.values()].reduce((sum, value) => sum + value, 0) !== totalReserved) {
    throw new Error("Challenge component cash allocation does not equal the exact reserved cash pool.");
  }

  const main = components.get("main")!;
  const mainWinnerId = main.outcome === "awarded" ? main.winnerPartyId! : null;
  const loserId = mainWinnerId ? args.state.contract.parties.find((party) => party.id !== mainWinnerId)!.id : null;
  const transfers: ChallengeSettlementItemTransfer[] = [];
  const custodyByParty = new Map<string, RivalCustodyRecord[]>();
  if (mainWinnerId && loserId) {
    const winner = parties.find((party) => party.partyId === mainWinnerId)!;
    const loser = parties.find((party) => party.partyId === loserId)!;
    const loserEscrow = args.state.escrow.parties.find((party) => party.partyId === loserId)!;
    for (const before of loserEscrow.itemSnapshots) {
      if (winner.inventory.items.some((item) => item.id === before.id)) throw new Error(`Settlement would duplicate stable item ${before.id}.`);
      const transferId = `${settlementId}:${before.id}`;
      const custodyId = `custody:${args.state.contract.id}:${before.id}`;
      if (loser.rivalCustody.some((entry) => entry.id === custodyId || (entry.status === "held" && entry.itemId === before.id))) {
        throw new Error(`${before.id} already has rival custody evidence.`);
      }
      const after = transferItem(before, {
        transferId,
        toOwnerId: winner.captainId,
        custodianId: winner.captainId,
        week: args.at.week,
        day: args.at.day,
        reason: "stake",
      });
      const custody: RivalCustodyRecord = {
        id: custodyId,
        rivalId: winner.captainId,
        rivalName: winner.captainName,
        challengeId: args.state.contract.id,
        settlementId,
        rematchChallengeId: `rematch:${custodyId}`,
        itemId: after.id,
        itemSnapshot: after,
        acquiredWeek: args.at.week,
        acquiredDay: args.at.day,
        status: "held",
      };
      transfers.push({
        id: transferId,
        itemId: before.id,
        fromPartyId: loser.partyId,
        fromCaptainId: loser.captainId,
        toPartyId: winner.partyId,
        toCaptainId: winner.captainId,
        before: deepClone(before),
        after: deepClone(after),
        custodyId,
      });
      custodyByParty.set(loser.partyId, [...(custodyByParty.get(loser.partyId) ?? []), custody]);
    }
  }

  const nextParties = parties.map((party) => {
    const escrowParty = args.state.escrow!.parties.find((entry) => entry.partyId === party.partyId)!;
    const transferredAway = transfers.filter((entry) => entry.fromPartyId === party.partyId);
    const received = transfers.filter((entry) => entry.toPartyId === party.partyId);
    const transferredIds = transferredAway.map((entry) => entry.itemId);
    const items = [
      ...party.inventory.items.filter((item) => !transferredIds.includes(item.id)),
      ...received.map((entry) => deepClone(entry.after)),
    ];
    if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error(`${party.partyId} settlement produced duplicate inventory item IDs.`);
    const inventory: PlayerInventory = {
      ...party.inventory,
      items,
      escrowItemIds: party.inventory.escrowItemIds.filter((id) => !escrowParty.itemIds.includes(id)),
      displayItemIds: party.inventory.displayItemIds.filter((id) => !transferredIds.includes(id)),
      selectedVehicleId: party.inventory.selectedVehicleId && !transferredIds.includes(party.inventory.selectedVehicleId)
        ? party.inventory.selectedVehicleId
        : undefined,
    };
    const loadout = transferredAway.length ? deepClone(escrowParty.defaultLoadoutAfterTransfer) : deepClone(party.loadout);
    return {
      ...party,
      cash: moneyAfter(party.cash, credits.get(party.partyId)!, party.partyId),
      inventory,
      loadout,
      rivalCustody: [...party.rivalCustody, ...(custodyByParty.get(party.partyId) ?? [])],
      settlementLedger: [...party.settlementLedger, settlementId],
    };
  });

  const cashChanges = nextParties.map((party, index) => ({
    partyId: party.partyId,
    before: parties[index].cash,
    delta: credits.get(party.partyId)!,
    after: party.cash,
  }));
  const partyRecords = nextParties.map((party) => {
    const ownEscrow = args.state.escrow!.parties.find((entry) => entry.partyId === party.partyId)!;
    const transferredAwayItemIds = transfers.filter((entry) => entry.fromPartyId === party.partyId).map((entry) => entry.itemId);
    const receivedItemIds = transfers.filter((entry) => entry.toPartyId === party.partyId).map((entry) => entry.itemId);
    return {
      partyId: party.partyId,
      captainId: party.captainId,
      cashBefore: parties.find((entry) => entry.partyId === party.partyId)!.cash,
      cashDelta: credits.get(party.partyId)!,
      cashAfter: party.cash,
      returnedItemIds: ownEscrow.itemIds.filter((id) => !transferredAwayItemIds.includes(id)),
      receivedItemIds,
      transferredAwayItemIds,
      inventoryItemIdsAfter: party.inventory.items.map((item) => item.id),
      escrowItemIdsAfter: [...party.inventory.escrowItemIds],
      loadoutAfter: deepClone(party.loadout),
      displayItemIdsAfter: [...party.inventory.displayItemIds],
      selectedVehicleIdAfter: party.inventory.selectedVehicleId,
      inventoryAfter: deepClone(party.inventory),
      rivalCustodyAfter: deepClone(party.rivalCustody),
      settlementLedgerAfter: [...party.settlementLedger],
    };
  });
  const record = deepFreeze<ChallengeSettlementRecord>({
    version: 1,
    id: settlementId,
    transitionId: args.transitionId,
    settledAt: { ...args.at },
    runtime: args.state,
    contract: args.state.contract,
    frozenAppraisal: args.state.contract.parties.map((party) => ({ partyId: party.id, bundle: deepClone(party.bundle) })),
    evidence: deepClone(args.evidence),
    resolutionEvidenceIds: args.evidence.components.flatMap((component) => component.evidenceIds),
    parties: partyRecords,
    cashChanges,
    transferredItems: transfers,
    resultingCustody: [...custodyByParty.values()].flat(),
  });
  return { settlement: record, parties: nextParties, cashChanges };
}
