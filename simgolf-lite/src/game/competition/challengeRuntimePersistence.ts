import type { ChallengeRuntimeState } from "./challengeRuntime";
import type { PlayerInventory } from "./types";

type DecodeResult = { ok: true; state: ChallengeRuntimeState } | { ok: false; error: string };

const record = (value: unknown): value is Record<string, unknown> => value != null && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const money = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.every(id) && new Set(value).size === value.length;
const same = (left: readonly string[], right: readonly string[]) => left.length === right.length
  && left.every((entry) => right.includes(entry)) && right.every((entry) => left.includes(entry));
const INVALID = { ok: false, error: "Challenge runtime save is invalid." } as const;

/** Small synchronous gate for phase, identity, and money; full contract evidence is deferred to mutations. */
export function decodePersistedChallengeRuntime(
  raw: unknown,
  player?: { id: string; inventory: PlayerInventory },
): DecodeResult {
  try {
    const value = raw;
    if (!record(value) || value.version !== 1 || !record(value.contract)
      || value.contract.version !== 1 || value.contract.status !== "accepted" || !id(value.contract.id)
      || value.id !== `challenge-runtime:${value.contract.id}` || !Array.isArray(value.contract.parties)
      || value.contract.parties.length !== 2
      || !["accepted", "escrowed", "shot_locked", "cancelled"].includes(value.phase as string)) return INVALID;

    const parties = value.contract.parties;
    for (const party of parties) {
      if (!record(party) || !id(party.id) || !["player", "rival"].includes(party.side as string)
        || !id(party.captainId) || !money(party.totalCashExposure) || !money(party.sideBetCashExposure)
        || !record(party.bundle) || !money(party.bundle.cash) || !ids(party.bundle.itemIds)
        || party.totalCashExposure !== party.bundle.cash + party.sideBetCashExposure) return INVALID;
    }
    if (parties[0].id === parties[1].id || parties[0].captainId === parties[1].captainId
      || parties[0].side === parties[1].side) return INVALID;

    const phase = value.phase;
    const escrow = value.escrow;
    if ((phase === "accepted" && (escrow != null || value.firstShot != null || value.cancellation != null))
      || ((phase === "escrowed" || phase === "shot_locked") && !record(escrow))) return INVALID;
    if (record(escrow)) {
      if (escrow.id !== `challenge-escrow:${value.contract.id}` || !Array.isArray(escrow.parties) || escrow.parties.length !== 2
        || escrow.status !== (phase === "cancelled" ? "released" : "reserved")) return INVALID;
      for (const party of parties) {
        const escrowParty = escrow.parties.find((entry) => record(entry) && entry.partyId === party.id);
        if (!record(escrowParty) || escrowParty.captainId !== party.captainId
          || escrowParty.reservedCash !== party.totalCashExposure || !money(escrowParty.cashBefore)
          || !money(escrowParty.cashAfter) || escrowParty.cashAfter !== escrowParty.cashBefore - (escrowParty.reservedCash as number)
          || !same(escrowParty.itemIds as string[], party.bundle.itemIds as string[])) return INVALID;
      }
    }
    if ((phase === "shot_locked") !== record(value.firstShot) || (phase === "cancelled") !== record(value.cancellation)) return INVALID;
    const state = value as unknown as ChallengeRuntimeState;
    if (player) {
      const party = state.contract.parties.find((entry) => entry.side === "player");
      const expected = party && party.captainId === player.id
        ? state.phase === "escrowed" || state.phase === "shot_locked" ? party.bundle.itemIds : []
        : null;
      if (!expected || player.inventory.ownerId !== player.id || !same(player.inventory.escrowItemIds, expected)
        || expected.some((itemId) => player.inventory.items.filter((item) => item.id === itemId
          && item.ownerId === player.id && item.custodianId === player.id).length !== 1)) {
        return INVALID;
      }
    }
    return { ok: true, state };
  } catch {
    return INVALID;
  }
}

/** Rejects mismatched financial persistence instead of repairing it. */
export function persistedChallengeRuntimeError(rawCareer: unknown): string | null {
  if (!record(rawCareer) || rawCareer.activeChallengeRuntime == null) return null;
  if (!record(rawCareer.identity) || !id(rawCareer.identity.id) || !record(rawCareer.inventory)) {
    return INVALID.error;
  }
  const decoded = decodePersistedChallengeRuntime(rawCareer.activeChallengeRuntime, {
    id: rawCareer.identity.id,
    inventory: rawCareer.inventory as unknown as PlayerInventory,
  });
  return decoded.ok ? null : decoded.error;
}
