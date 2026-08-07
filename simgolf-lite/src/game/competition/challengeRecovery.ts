import type { PlayerChallengeRecord, PlayerProCareer } from "../models/playerProTypes";
import { recoverRivalItem } from "./custodyRecovery";
import { validateChallengeRuntimeForMutation, type ChallengeRuntimeClock } from "./challengeRuntime";
import type { ChallengeSettlementRecord } from "./challengeSettlement";

export type ChallengeRematchOutcome = "won" | "lost" | "tied";

function assertId(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} requires a stable non-empty ID.`);
}

function assertClock(value: ChallengeRuntimeClock): void {
  if (!Number.isSafeInteger(value.week) || value.week < 0 || !Number.isSafeInteger(value.day) || value.day < 0) {
    throw new Error("Challenge rematch time must use non-negative whole week/day values.");
  }
}

function validateSourceSettlement(settlement: ChallengeSettlementRecord): void {
  validateChallengeRuntimeForMutation(settlement.runtime);
  if (settlement.version !== 1 || settlement.contract.id !== settlement.runtime.contract.id
    || settlement.id !== `challenge-settlement:${settlement.contract.id}`
    || settlement.runtime.phase !== "shot_locked") {
    throw new Error("Custody rematch requires one valid source challenge settlement.");
  }
}

function rematchRecord(custody: PlayerProCareer["rivalCustody"][number], settlement: ChallengeSettlementRecord): PlayerChallengeRecord {
  const id = custody.rematchChallengeId ?? `rematch:${custody.id}`;
  return {
    id,
    opponentId: custody.rivalId,
    opponentName: custody.rivalName,
    kind: "friendly",
    status: "offered",
    relationship: 0,
    wager: 0,
    settled: false,
    challengeContractId: settlement.contract.id,
    rematch: {
      custodyId: custody.id,
      sourceContractId: settlement.contract.id,
      sourceSettlementId: settlement.id,
      attempts: [],
    },
  };
}

/** Adds one visible, stable authored rematch opportunity per player-held custody record. */
export function createChallengeRematchOpportunities(
  career: PlayerProCareer,
  settlement: ChallengeSettlementRecord,
): PlayerProCareer {
  validateSourceSettlement(settlement);
  const custodyIds = new Set(settlement.resultingCustody.map((entry) => entry.id));
  const eligible = career.rivalCustody.filter((entry) => entry.status === "held" && custodyIds.has(entry.id));
  if (eligible.length === 0) return career;
  const additions: PlayerChallengeRecord[] = [];
  for (const custody of eligible) {
    const id = custody.rematchChallengeId ?? `rematch:${custody.id}`;
    const existing = career.challenges.find((challenge) => challenge.id === id);
    if (existing) {
      if (existing.rematch?.custodyId !== custody.id || existing.rematch.sourceSettlementId !== settlement.id) {
        throw new Error(`${id} conflicts with the authored custody rematch identity.`);
      }
    } else {
      additions.push(rematchRecord(custody, settlement));
    }
  }
  if (additions.length === 0) return career;
  return {
    ...career,
    rivalCustody: career.rivalCustody.map((custody) => custodyIds.has(custody.id)
      ? { ...custody, rematchChallengeId: custody.rematchChallengeId ?? `rematch:${custody.id}` }
      : custody),
    challenges: [...career.challenges, ...additions].slice(-30),
  };
}

/** Records rematch evidence; only a verified win invokes the existing exactly-once recovery primitive. */
export function resolveChallengeCustodyRematch(args: {
  career: PlayerProCareer;
  sourceSettlement: ChallengeSettlementRecord;
  rematchChallengeId: string;
  transitionId: string;
  evidenceId: string;
  outcome: ChallengeRematchOutcome;
  at: ChallengeRuntimeClock;
}): { career: PlayerProCareer; recoveredItemId: string | null } {
  validateSourceSettlement(args.sourceSettlement);
  assertId(args.rematchChallengeId, "Custody rematch");
  assertId(args.transitionId, "Custody rematch transition");
  assertId(args.evidenceId, "Custody rematch evidence");
  assertClock(args.at);
  if (!(["won", "lost", "tied"] as const).includes(args.outcome)) throw new Error("Custody rematch outcome is invalid.");
  const challenge = args.career.challenges.find((entry) => entry.id === args.rematchChallengeId);
  if (!challenge?.rematch || challenge.challengeContractId !== args.sourceSettlement.contract.id
    || challenge.rematch.sourceSettlementId !== args.sourceSettlement.id) {
    throw new Error("Custody rematch is not linked to the validated source settlement.");
  }
  const custody = args.career.rivalCustody.find((entry) => entry.id === challenge.rematch!.custodyId);
  const transfer = args.sourceSettlement.transferredItems.find((entry) => entry.custodyId === custody?.id);
  if (!custody || !transfer || custody.challengeId !== args.sourceSettlement.contract.id
    || custody.settlementId !== args.sourceSettlement.id || transfer.itemId !== custody.itemId) {
    throw new Error("Custody rematch has mismatched item or settlement evidence.");
  }
  const prior = challenge.rematch.attempts.find((attempt) => attempt.transitionId === args.transitionId || attempt.evidenceId === args.evidenceId);
  if (prior) {
    if (prior.transitionId !== args.transitionId || prior.evidenceId !== args.evidenceId || prior.result !== args.outcome) {
      throw new Error("Custody rematch evidence was already recorded by a conflicting transition.");
    }
    const recovered = args.outcome === "won";
    if (recovered !== (custody.status === "recovered")) throw new Error("Custody rematch retry does not match the recorded recovery state.");
    return { career: args.career, recoveredItemId: recovered ? custody.itemId : null };
  }
  if (custody.status !== "held" || challenge.rematch.recoveredSettlementId) {
    throw new Error("Rival-held item is no longer available for a new rematch recovery.");
  }
  const attempt = {
    transitionId: args.transitionId,
    evidenceId: args.evidenceId,
    result: args.outcome,
    week: args.at.week,
    day: args.at.day,
  } as const;
  if (args.outcome !== "won") {
    return {
      recoveredItemId: null,
      career: {
        ...args.career,
        challenges: args.career.challenges.map((entry) => entry.id === challenge.id ? {
          ...entry,
          status: "offered" as const,
          result: args.outcome,
          settled: false,
          rematch: { ...challenge.rematch!, attempts: [...challenge.rematch!.attempts, attempt] },
        } : entry),
      },
    };
  }

  const recoverySettlementId = `challenge-rematch-recovery:${custody.id}`;
  const recovered = recoverRivalItem({
    assets: {
      cash: 0,
      inventory: args.career.inventory,
      loadout: args.career.equipmentLoadout,
      rivalCustody: args.career.rivalCustody,
      settlementLedger: args.career.settlementLedger,
    },
    custodyId: custody.id,
    settlementId: recoverySettlementId,
    playerId: args.career.identity.id,
    week: args.at.week,
    day: args.at.day,
  });
  return {
    recoveredItemId: custody.itemId,
    career: {
      ...args.career,
      inventory: recovered.inventory,
      equipmentLoadout: recovered.loadout,
      rivalCustody: recovered.rivalCustody,
      settlementLedger: [...recovered.settlementLedger],
      challenges: args.career.challenges.map((entry) => entry.id === challenge.id ? {
        ...entry,
        status: "complete" as const,
        result: "won" as const,
        settled: true,
        rematch: {
          ...challenge.rematch!,
          attempts: [...challenge.rematch!.attempts, attempt],
          recoveredSettlementId: recoverySettlementId,
        },
      } : entry),
    },
  };
}
