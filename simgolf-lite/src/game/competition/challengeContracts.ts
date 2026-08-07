import { appraiseItem } from "./inventory";
import type { AppraisedValue, InventoryItem, NonTransferableRewardKind, PlayerInventory, SideBetKind } from "./types";

export const CHALLENGE_CONTRACT_VERSION = 1 as const;
export const CHALLENGE_CONTRACT_VALUE_TOLERANCE = .2;
export const CHALLENGE_CONTRACT_HIGH_PRESTIGE = 75;

export type ChallengeContractPartySide = "player" | "rival";
export type ChallengeContractTeamFormat = "individual" | "four-ball" | "alternate-shot" | "scramble";
export type ChallengeContractScoringMode = "gross-stroke" | "net-stroke" | "gross-match" | "net-match" | "net-stableford";
export type ChallengeContractTeeSet = "forward" | "member" | "championship";
export type ChallengeContractPinRotation = "A" | "B" | "C";

export interface ChallengeContractClock {
  week: number;
  day: number;
}

export interface ChallengeContractBundleInput {
  cash: number;
  itemIds: readonly string[];
  /** Command-boundary evidence for career assets that must never enter inventory appraisal. */
  nonTransferableKinds?: readonly NonTransferableRewardKind[];
}

export interface ChallengeContractPartyInput {
  /** Stable negotiation identity; callers supply it and acceptance preserves it verbatim. */
  id: string;
  side: ChallengeContractPartySide;
  captainId: string;
  availableCash: number;
  inventory: PlayerInventory;
  bundle: ChallengeContractBundleInput;
}

export interface ChallengeContractTeamInput {
  id: string;
  partyId: string;
  captainId: string;
  partnerIds: readonly string[];
}

export interface ChallengeContractParticipantSetupInput {
  participantId: string;
  teeSet: ChallengeContractTeeSet;
  pinRotation: ChallengeContractPinRotation;
}

export interface ChallengeContractSideBetInput {
  id: string;
  kind: SideBetKind;
  /** Positive per-captain cash exposure; this is reserved separately from bundle appraisal. */
  stake: number;
  /** Empty means every applicable hole. */
  holeIds: readonly string[];
}

export interface ChallengeContractTermsInput {
  format: {
    teamFormat: ChallengeContractTeamFormat;
    scoring: ChallengeContractScoringMode;
  };
  teams: readonly ChallengeContractTeamInput[];
  participantSetups: readonly ChallengeContractParticipantSetupInput[];
  sideBets: readonly ChallengeContractSideBetInput[];
}

export interface ChallengeContractProposal {
  id: string;
  parties: readonly ChallengeContractPartyInput[];
  terms: ChallengeContractTermsInput;
}

export interface ChallengeContractPartyConfirmation {
  partyId: string;
  /** Must be the captain and owner of every item in this party's bundle. */
  ownerId: string;
  /** One explicit transfer confirmation is required for every item. */
  ownerConfirmedItemIds: readonly string[];
  /** A separate second confirmation is required for every unique/high-prestige item. */
  prestigeConfirmedItemIds: readonly string[];
}

export interface ChallengeContractBundleAppraisal {
  cash: number;
  itemIds: readonly string[];
  appraisal: readonly AppraisedValue[];
  /** Frozen ownership/custody and prestige evidence used by acceptance eligibility. */
  itemEligibility: readonly ChallengeContractItemEligibility[];
  totalValue: number;
  requiredOwnerConfirmationItemIds: readonly string[];
  requiredPrestigeConfirmationItemIds: readonly string[];
}

export interface ChallengeContractItemEligibility {
  itemId: string;
  category: InventoryItem["category"];
  ownerId: string;
  custodianId: string;
  transferable: true;
  unique: boolean;
  prestige: number;
  confirmationRequired: boolean;
  escrowed: false;
}

export interface ChallengeContractPartyAppraisal {
  id: string;
  side: ChallengeContractPartySide;
  captainId: string;
  availableCash: number;
  sideBetCashExposure: number;
  /** Bundle cash plus this captain's exposure to every authored side bet. */
  totalCashExposure: number;
  bundle: ChallengeContractBundleAppraisal;
}

export interface ChallengeContractValueComparison {
  playerPartyId: string;
  rivalPartyId: string;
  playerValue: number;
  rivalValue: number;
  /** Positive means the player's bundle is more valuable; negative means the rival's is. */
  playerMinusRivalValue: number;
  absoluteValueDifference: number;
  relativeValueDifference: number;
  valueDifferencePercent: number;
  withinTolerance: boolean;
  /** Full cash addition that would make the lower-valued bundle exactly equal. */
  cashBalancingAmount: number;
  cashBalancingPartyId: string | null;
}

export interface ChallengeContractEvaluation {
  version: typeof CHALLENGE_CONTRACT_VERSION;
  contractId: string;
  appraisalFrozenAt: ChallengeContractClock;
  parties: readonly ChallengeContractPartyAppraisal[];
  valueComparison: ChallengeContractValueComparison;
  appraisalEligible: boolean;
}

export interface AcceptedChallengeContractTeam extends ChallengeContractTeamInput {
  participantIds: readonly string[];
}

export interface AcceptedChallengeContractTerms {
  format: ChallengeContractTermsInput["format"];
  teams: readonly AcceptedChallengeContractTeam[];
  participantSetups: readonly ChallengeContractParticipantSetupInput[];
  sideBets: readonly ChallengeContractSideBetInput[];
}

export interface AcceptedChallengeContractBundle extends ChallengeContractBundleAppraisal {
  ownerConfirmedItemIds: readonly string[];
  prestigeConfirmedItemIds: readonly string[];
}

export interface AcceptedChallengeContractParty extends Omit<ChallengeContractPartyAppraisal, "bundle"> {
  teamId: string;
  bundle: AcceptedChallengeContractBundle;
}

/** Pure accepted authority. Runtime/round ownership may defer loading it until a later integration packet. */
export interface AcceptedChallengeContract {
  version: typeof CHALLENGE_CONTRACT_VERSION;
  id: string;
  status: "accepted";
  acceptedAt: ChallengeContractClock;
  parties: readonly AcceptedChallengeContractParty[];
  terms: AcceptedChallengeContractTerms;
  valueComparison: ChallengeContractValueComparison;
}

const SIDE_BET_KINDS: readonly SideBetKind[] = ["skins", "nassau", "closest-to-pin", "longest-drive"];
const TEAM_FORMATS: readonly ChallengeContractTeamFormat[] = ["individual", "four-ball", "alternate-shot", "scramble"];
const SCORING_MODES: readonly ChallengeContractScoringMode[] = ["gross-stroke", "net-stroke", "gross-match", "net-match", "net-stableford"];
const TEE_SETS: readonly ChallengeContractTeeSet[] = ["forward", "member", "championship"];
const PIN_ROTATIONS: readonly ChallengeContractPinRotation[] = ["A", "B", "C"];

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

function assertUniqueIds(ids: readonly string[], label: string): void {
  ids.forEach((id) => assertId(id, label));
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contains duplicate IDs.`);
}

function assertCurrency(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative whole currency value.`);
}

function assertClock(value: ChallengeContractClock): void {
  if (!Number.isSafeInteger(value.week) || value.week < 0 || !Number.isSafeInteger(value.day) || value.day < 0) {
    throw new Error("Contract appraisal time must use non-negative whole week/day values.");
  }
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

interface ValidatedProposal {
  player: ChallengeContractPartyInput;
  rival: ChallengeContractPartyInput;
  teamsByPartyId: ReadonlyMap<string, ChallengeContractTeamInput>;
  participantIds: readonly string[];
  sideBetCashExposure: number;
}

function validateProposal(proposal: ChallengeContractProposal): ValidatedProposal {
  assertId(proposal.id, "Challenge contract");
  if (proposal.parties.length !== 2) throw new Error("A challenge contract requires exactly one player party and one rival party.");
  assertUniqueIds(proposal.parties.map((party) => party.id), "Challenge contract parties");
  const player = proposal.parties.find((party) => party.side === "player");
  const rival = proposal.parties.find((party) => party.side === "rival");
  if (!player || !rival || proposal.parties.some((party) => party.side !== "player" && party.side !== "rival")) {
    throw new Error("A challenge contract requires one stable player party and one stable rival party.");
  }
  for (const party of proposal.parties) {
    assertId(party.captainId, "Challenge captain");
    assertCurrency(party.availableCash, `${party.id} available cash`);
    assertCurrency(party.bundle.cash, `${party.id} bundle cash`);
    if (party.inventory.ownerId !== party.captainId) throw new Error(`${party.id} must use its captain's inventory.`);
  }

  const { format } = proposal.terms;
  if (!TEAM_FORMATS.includes(format.teamFormat) || !SCORING_MODES.includes(format.scoring)) throw new Error("Challenge format is not supported.");
  if (format.teamFormat !== "individual" && format.scoring === "net-stableford") {
    throw new Error("Team challenge contracts do not support net stableford.");
  }
  if (proposal.terms.teams.length !== 2) throw new Error("A challenge contract requires exactly one team per captain party.");
  assertUniqueIds(proposal.terms.teams.map((team) => team.id), "Challenge teams");
  const teamsByPartyId = new Map<string, ChallengeContractTeamInput>();
  const participantIds: string[] = [];
  for (const party of [player, rival]) {
    const matches = proposal.terms.teams.filter((team) => team.partyId === party.id);
    if (matches.length !== 1) throw new Error(`${party.id} must own exactly one challenge team.`);
    const team = matches[0];
    if (team.captainId !== party.captainId) throw new Error("Challenge teams and bundles must be owned captain-to-captain.");
    assertUniqueIds(team.partnerIds, `${team.id} partners`);
    if (team.partnerIds.includes(team.captainId)) throw new Error("A captain cannot also be listed as their own partner.");
    const expectedPartners = format.teamFormat === "individual" ? 0 : 1;
    if (team.partnerIds.length !== expectedPartners) {
      throw new Error(format.teamFormat === "individual" ? "Individual challenge parties cannot name partners." : "Team challenge parties require exactly one partner per captain.");
    }
    teamsByPartyId.set(party.id, team);
    participantIds.push(team.captainId, ...team.partnerIds);
  }
  if (new Set(participantIds).size !== participantIds.length) throw new Error("Every challenge participant may appear on only one team.");

  assertUniqueIds(proposal.terms.participantSetups.map((setup) => setup.participantId), "Participant setups");
  if (!sameIds(proposal.terms.participantSetups.map((setup) => setup.participantId), participantIds)) {
    throw new Error("Participant-specific tee and pin setup must cover every golfer exactly once.");
  }
  for (const setup of proposal.terms.participantSetups) {
    if (!TEE_SETS.includes(setup.teeSet) || !PIN_ROTATIONS.includes(setup.pinRotation)) throw new Error("Participant tee/pin setup is not supported.");
  }

  assertUniqueIds(proposal.terms.sideBets.map((sideBet) => sideBet.id), "Challenge side bets");
  let sideBetCashExposure = 0;
  for (const sideBet of proposal.terms.sideBets) {
    if (!SIDE_BET_KINDS.includes(sideBet.kind)) throw new Error("Challenge side-bet kind is not supported.");
    assertCurrency(sideBet.stake, `${sideBet.id} side-bet stake`);
    if (sideBet.stake === 0) throw new Error("An authored challenge side bet requires a positive per-captain stake.");
    if (!Number.isSafeInteger(sideBetCashExposure + sideBet.stake)) throw new Error("Challenge side-bet exposure exceeds safe currency bounds.");
    sideBetCashExposure += sideBet.stake;
    assertUniqueIds(sideBet.holeIds, `${sideBet.id} side-bet holes`);
  }
  for (const party of [player, rival]) {
    if (!Number.isSafeInteger(party.bundle.cash + sideBetCashExposure) || party.bundle.cash + sideBetCashExposure > party.availableCash) {
      throw new Error(`${party.id} captain cash cannot cover bundle cash plus side-bet exposure.`);
    }
  }
  return { player, rival, teamsByPartyId, participantIds, sideBetCashExposure };
}

function validateItemAppraisalInputs(item: InventoryItem): void {
  if (!Number.isFinite(item.authoredValue) || item.authoredValue < 0 || !Number.isFinite(item.remainingValue) || item.remainingValue < 0
    || !Number.isFinite(item.prestige) || item.prestige < 0) throw new Error(`${item.id} has invalid appraisal inputs.`);
  if (item.category === "plant-stock" && (!Number.isSafeInteger(item.remainingPlacements) || item.remainingPlacements! < 0
    || !Number.isFinite(item.frozenInstallValueEach) || item.frozenInstallValueEach! < 0)) {
    throw new Error(`${item.id} has invalid plant-stock appraisal inputs.`);
  }
}

function appraiseParty(
  party: ChallengeContractPartyInput,
  teammateIds: readonly string[],
  sideBetCashExposure: number,
  at: ChallengeContractClock,
): ChallengeContractPartyAppraisal {
  if ((party.bundle.nonTransferableKinds?.length ?? 0) > 0) {
    throw new Error("Non-transferable career knowledge, techniques, relationships, memories, and unlocks cannot be staked.");
  }
  assertUniqueIds(party.bundle.itemIds, `${party.id} bundle items`);
  assertUniqueIds(party.inventory.items.map((item) => item.id), `${party.id} inventory`);
  const items = party.bundle.itemIds.map((id) => {
    const item = party.inventory.items.find((candidate) => candidate.id === id);
    if (!item) throw new Error(`${id} is not present in ${party.id}'s captain inventory.`);
    if (item.transferable !== true) throw new Error(`${id} is non-transferable and cannot be staked.`);
    if (teammateIds.includes(item.ownerId)) throw new Error(`${id} is teammate property; only the captain may own a team bundle.`);
    if (item.ownerId !== party.captainId) throw new Error(`${id} has the wrong owner for ${party.id}'s bundle.`);
    if (party.inventory.escrowItemIds.includes(id)) throw new Error(`${id} is already escrowed and cannot be staked twice.`);
    if (item.custodianId !== party.captainId) throw new Error(`${id} has the wrong custodian or is already held elsewhere.`);
    validateItemAppraisalInputs(item);
    return item;
  });
  const appraisal: AppraisedValue[] = items.map((item) => appraiseItem(item, at.week, at.day));
  if (party.bundle.cash > 0) {
    appraisal.push({ cash: party.bundle.cash, value: party.bundle.cash, frozenWeek: at.week, frozenDay: at.day, basis: { cashFaceValue: party.bundle.cash } });
  }
  const totalValue = appraisal.reduce((total, entry) => {
    if (!Number.isSafeInteger(entry.value) || entry.value < 0 || !Number.isSafeInteger(total + entry.value)) {
      throw new Error(`${party.id} bundle appraisal exceeds safe currency bounds.`);
    }
    return total + entry.value;
  }, 0);
  return {
    id: party.id,
    side: party.side,
    captainId: party.captainId,
    availableCash: party.availableCash,
    sideBetCashExposure,
    totalCashExposure: party.bundle.cash + sideBetCashExposure,
    bundle: {
      cash: party.bundle.cash,
      itemIds: [...party.bundle.itemIds],
      appraisal,
      itemEligibility: items.map((item) => ({
        itemId: item.id,
        category: item.category,
        ownerId: item.ownerId,
        custodianId: item.custodianId,
        transferable: true,
        unique: item.unique,
        prestige: item.prestige,
        confirmationRequired: item.confirmationRequired,
        escrowed: false,
      })),
      totalValue,
      requiredOwnerConfirmationItemIds: [...party.bundle.itemIds],
      requiredPrestigeConfirmationItemIds: items
        .filter((item) => item.unique || item.prestige >= CHALLENGE_CONTRACT_HIGH_PRESTIGE || item.confirmationRequired)
        .map((item) => item.id),
    },
  };
}

export function compareChallengeBundleValues(
  playerPartyId: string,
  playerValue: number,
  rivalPartyId: string,
  rivalValue: number,
): ChallengeContractValueComparison {
  assertId(playerPartyId, "Player party");
  assertId(rivalPartyId, "Rival party");
  if (playerPartyId === rivalPartyId) throw new Error("Player and rival parties require distinct stable IDs.");
  assertCurrency(playerValue, "Player bundle value");
  assertCurrency(rivalValue, "Rival bundle value");
  const playerMinusRivalValue = playerValue - rivalValue;
  const absoluteValueDifference = Math.abs(playerMinusRivalValue);
  const maximumValue = Math.max(playerValue, rivalValue);
  const relativeValueDifference = maximumValue === 0 ? 0 : absoluteValueDifference / maximumValue;
  const withinTolerance = maximumValue === 0
    || BigInt(absoluteValueDifference) * 100n <= BigInt(maximumValue) * BigInt(CHALLENGE_CONTRACT_VALUE_TOLERANCE * 100);
  return deepFreeze({
    playerPartyId,
    rivalPartyId,
    playerValue,
    rivalValue,
    playerMinusRivalValue,
    absoluteValueDifference,
    relativeValueDifference,
    valueDifferencePercent: relativeValueDifference * 100,
    withinTolerance,
    cashBalancingAmount: absoluteValueDifference,
    cashBalancingPartyId: playerMinusRivalValue === 0 ? null : playerMinusRivalValue < 0 ? playerPartyId : rivalPartyId,
  });
}

/** Validates current ownership/custody and produces a detached appraisal/confirmation eligibility snapshot. */
export function evaluateChallengeContract(proposal: ChallengeContractProposal, appraisalFrozenAt: ChallengeContractClock): ChallengeContractEvaluation {
  assertClock(appraisalFrozenAt);
  const validated = validateProposal(proposal);
  const globalItemIds = proposal.parties.flatMap((party) => party.bundle.itemIds);
  if (new Set(globalItemIds).size !== globalItemIds.length) throw new Error("Challenge captain bundles contain duplicate item IDs.");
  const playerTeam = validated.teamsByPartyId.get(validated.player.id)!;
  const rivalTeam = validated.teamsByPartyId.get(validated.rival.id)!;
  const player = appraiseParty(validated.player, playerTeam.partnerIds, validated.sideBetCashExposure, appraisalFrozenAt);
  const rival = appraiseParty(validated.rival, rivalTeam.partnerIds, validated.sideBetCashExposure, appraisalFrozenAt);
  const valueComparison = compareChallengeBundleValues(player.id, player.bundle.totalValue, rival.id, rival.bundle.totalValue);
  return deepFreeze({
    version: CHALLENGE_CONTRACT_VERSION,
    contractId: proposal.id,
    appraisalFrozenAt: { ...appraisalFrozenAt },
    parties: [player, rival],
    valueComparison,
    appraisalEligible: valueComparison.withinTolerance,
  });
}

function validateConfirmations(
  parties: readonly ChallengeContractPartyAppraisal[],
  confirmations: readonly ChallengeContractPartyConfirmation[],
): ReadonlyMap<string, ChallengeContractPartyConfirmation> {
  assertUniqueIds(confirmations.map((confirmation) => confirmation.partyId), "Challenge party confirmations");
  if (!sameIds(confirmations.map((confirmation) => confirmation.partyId), parties.map((party) => party.id))) {
    throw new Error("Acceptance requires one item-confirmation record from each captain party.");
  }
  const byPartyId = new Map(confirmations.map((confirmation) => [confirmation.partyId, confirmation]));
  for (const party of parties) {
    const confirmation = byPartyId.get(party.id)!;
    if (confirmation.ownerId !== party.captainId) throw new Error(`${party.id} item confirmations must come from the owning captain.`);
    assertUniqueIds(confirmation.ownerConfirmedItemIds, `${party.id} owner confirmations`);
    assertUniqueIds(confirmation.prestigeConfirmedItemIds, `${party.id} prestige confirmations`);
    if (!sameIds(confirmation.ownerConfirmedItemIds, party.bundle.requiredOwnerConfirmationItemIds)) {
      throw new Error("Every transferable career item requires explicit owner confirmation.");
    }
    if (!sameIds(confirmation.prestigeConfirmedItemIds, party.bundle.requiredPrestigeConfirmationItemIds)) {
      throw new Error("Every unique or high-prestige item requires a distinct second confirmation.");
    }
  }
  return byPartyId;
}

function snapshotTerms(proposal: ChallengeContractProposal, validated: ValidatedProposal): AcceptedChallengeContractTerms {
  const participantSetups = validated.participantIds.map((participantId) => {
    const setup = proposal.terms.participantSetups.find((candidate) => candidate.participantId === participantId)!;
    return { participantId, teeSet: setup.teeSet, pinRotation: setup.pinRotation };
  });
  const teams = [validated.player, validated.rival].map((party) => {
    const team = validated.teamsByPartyId.get(party.id)!;
    return {
      id: team.id,
      partyId: team.partyId,
      captainId: team.captainId,
      partnerIds: [...team.partnerIds],
      participantIds: [team.captainId, ...team.partnerIds],
    };
  });
  return {
    format: { ...proposal.terms.format },
    teams,
    participantSetups,
    sideBets: proposal.terms.sideBets.map((sideBet) => ({ ...sideBet, holeIds: [...sideBet.holeIds] })),
  };
}

/** Accepts only an eligible appraisal and returns a detached, recursively immutable authority snapshot. */
export function acceptChallengeContract(
  proposal: ChallengeContractProposal,
  confirmations: readonly ChallengeContractPartyConfirmation[],
  acceptedAt: ChallengeContractClock,
): AcceptedChallengeContract {
  const validated = validateProposal(proposal);
  const evaluation = evaluateChallengeContract(proposal, acceptedAt);
  if (!evaluation.appraisalEligible) {
    throw new Error(`Challenge bundle values exceed the 20% tolerance; ${evaluation.valueComparison.cashBalancingPartyId} must add ${evaluation.valueComparison.cashBalancingAmount} cash to match exactly.`);
  }
  const confirmationsByPartyId = validateConfirmations(evaluation.parties, confirmations);
  const terms = snapshotTerms(proposal, validated);
  const parties = evaluation.parties.map((party) => {
    const confirmation = confirmationsByPartyId.get(party.id)!;
    return {
      ...party,
      teamId: validated.teamsByPartyId.get(party.id)!.id,
      bundle: {
        ...party.bundle,
        ownerConfirmedItemIds: [...confirmation.ownerConfirmedItemIds],
        prestigeConfirmedItemIds: [...confirmation.prestigeConfirmedItemIds],
      },
    };
  });
  return deepFreeze({
    version: CHALLENGE_CONTRACT_VERSION,
    id: proposal.id,
    status: "accepted",
    acceptedAt: { ...acceptedAt },
    parties,
    terms,
    valueComparison: evaluation.valueComparison,
  });
}
