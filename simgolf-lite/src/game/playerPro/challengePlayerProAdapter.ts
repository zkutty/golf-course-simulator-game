import type { Course, PinRotation, TeeSet, World } from "../models/types";
import type { PlayerCareerRound, PlayerPlayableRound, PlayerProCareer, PlayerProSkills } from "../models/playerProTypes";
import { normalizeLivingClub } from "../livingClub/livingClub";
import { normalizePeopleProfiles } from "../competition/characters";
import { courseForLayout } from "../models/courseLayouts";
import { getPinPosition, getTeeBox } from "../models/courseSetup";
import {
  acceptChallengeContract,
  evaluateChallengeContract,
  type ChallengeContractEvaluation,
  type ChallengeContractProposal,
  type ChallengeContractScoringMode,
  type ChallengeContractTeamFormat,
} from "../competition/challengeContracts";
import {
  cancelChallengeBeforeFirstShot,
  createChallengeRuntimeState,
  lockChallengeFirstShot,
  reserveChallengeAtFirstTee,
  type ChallengeLivePartyAssets,
  type ChallengeRuntimeState,
} from "../competition/challengeRuntime";
import { settleChallenge, type ChallengeSettlementEvidence, type ChallengeSettlementPartyAssets } from "../competition/challengeSettlement";
import { createChallengeRematchOpportunities, resolveChallengeCustodyRematch } from "../competition/challengeRecovery";
import { startEquippedPlayableRound } from "../competition/equipmentMentor";
import type { EquipmentLoadout, InventoryItem, PlayerInventory, SideBetKind } from "../competition/types";
import {
  challengeGroupPlayerRound,
  challengeGroupPlayerSkills,
  chooseChallengeGroupScrambleBall,
  commitChallengeGroupPlayerShot,
  startChallengeGroupRound,
  withdrawChallengeGroupGolfer,
  type ChallengeGroupRound,
} from "../competition/challengeGroupRound";
import { caddieRecommendation, type PlayerShotSelection } from "./playerPro";
import { stablefordPoints } from "../competition/scoring";
export { createZk725BrowserFixture } from "../testing/zk725BrowserFixture";

export interface PlayerChallengeContractRival {
  id: string;
  name: string;
  skill: number;
  relationship: number;
  holdings: readonly InventoryItem[];
}

export interface PlayerChallengeSideBetDraft {
  kind: SideBetKind;
  stake: number;
  enabled: boolean;
}

export interface PlayerChallengeContractDraft {
  rematchChallengeId?: string;
  opponentId: string;
  layoutId: string;
  teamFormat: ChallengeContractTeamFormat;
  scoring: ChallengeContractScoringMode;
  participantSetups: {
    player: { teeSet: TeeSet; pinRotation: PinRotation };
    rival: { teeSet: TeeSet; pinRotation: PinRotation };
    playerPartner?: { teeSet: TeeSet; pinRotation: PinRotation };
    rivalPartner?: { teeSet: TeeSet; pinRotation: PinRotation };
  };
  playerPartnerId?: string;
  rivalPartnerId?: string;
  playerCash: number;
  rivalCash: number;
  playerItemIds: readonly string[];
  rivalItemIds: readonly string[];
  sideBets: readonly PlayerChallengeSideBetDraft[];
  ownerTransfersConfirmed: boolean;
  prestigeTransfersConfirmed: boolean;
  rivalTransfersConfirmed: boolean;
}

export interface PlayerChallengeContractPreview {
  proposal: ChallengeContractProposal;
  evaluation: ChallengeContractEvaluation;
  rival: PlayerChallengeContractRival;
}

export const RETRY = "Challenge changed; review and retry.";

const EMPTY_LOADOUT: EquipmentLoadout = { clubItemIds: [] };
const RIVAL_CASH = 100_000;

const inventoryFor = (ownerId: string, items: readonly InventoryItem[]): PlayerInventory => ({
  version: 1,
  ownerId,
  items,
  escrowItemIds: [],
  displayItemIds: [],
});

export function playerChallengeContractRivals(world: World): readonly PlayerChallengeContractRival[] {
  const living = normalizePeopleProfiles(normalizeLivingClub(world.livingClub), world.runSeed);
  return living.regulars.filter((regular) => regular.backstory).map((regular) => {
    const knownHoldingIds = new Set(regular.backstory!.knownHoldingIds);
    return {
      id: regular.id,
      name: regular.name,
      skill: regular.skill,
      relationship: regular.relationship.score,
      holdings: regular.backstory!.holdings.filter((item) => knownHoldingIds.has(item.id)
        && item.transferable && item.ownerId === regular.id && item.custodianId === regular.id),
    };
  });
}

function contractContext(world: World, draft: PlayerChallengeContractDraft) {
  const career = world.playerPro;
  if (!career) throw new Error("Create a Player Pro before negotiating a challenge.");
  if (career.activeRound || career.activeChallengeGroupRound || career.activeChallengeRuntime) throw new Error("Finish or cancel the active Player Pro challenge first.");
  const rivals = playerChallengeContractRivals(world);
  const rival = rivals.find((candidate) => candidate.id === draft.opponentId);
  if (!rival) throw new Error("The selected authored rival is no longer in the club roster.");
  const knownRivalHoldingIds = new Set(rival.holdings.map((item) => item.id));
  if (draft.rivalItemIds.some((itemId) => !knownRivalHoldingIds.has(itemId))) {
    throw new Error("The selected rival holding has not been revealed.");
  }
  const rematch = draft.rematchChallengeId
    ? career.challenges.find((challenge) => challenge.id === draft.rematchChallengeId)
    : undefined;
  if (draft.rematchChallengeId && (!rematch?.rematch || rematch.status !== "offered"
    || rematch.opponentId !== rival.id
    || !career.rivalCustody.some((custody) => custody.id === rematch.rematch!.custodyId && custody.status === "held"))) {
    throw new Error("The selected custody rematch is no longer available.");
  }
  if (rematch && (draft.teamFormat !== "individual" || draft.playerCash !== 0 || draft.rivalCash !== 0
    || draft.playerItemIds.length !== 0 || draft.rivalItemIds.length !== 0
    || draft.sideBets.some((sideBet) => sideBet.enabled))) {
    throw new Error("Custody recovery rematches use an individual no-stakes contract; the held item is the authored recovery prize.");
  }
  const isTeam = draft.teamFormat !== "individual";
  const playerPartner = draft.playerPartnerId ? rivals.find((candidate) => candidate.id === draft.playerPartnerId) : undefined;
  const rivalPartner = draft.rivalPartnerId ? rivals.find((candidate) => candidate.id === draft.rivalPartnerId) : undefined;
  if (isTeam && (!playerPartner || !rivalPartner)) throw new Error("Team formats require explicit player and rival partner selections.");
  if (isTeam && new Set([career.identity.id, rival.id, playerPartner!.id, rivalPartner!.id]).size !== 4) {
    throw new Error("Challenge captains and partners must be four distinct golfers.");
  }
  const playerPartyId = `challenge-party:player:${career.identity.id}`;
  const rivalPartyId = `challenge-party:rival:${rival.id}`;
  const participantSetups = [
    { participantId: career.identity.id, ...draft.participantSetups.player },
    ...(isTeam ? [{ participantId: playerPartner!.id, ...(draft.participantSetups.playerPartner ?? draft.participantSetups.player) }] : []),
    { participantId: rival.id, ...draft.participantSetups.rival },
    ...(isTeam ? [{ participantId: rivalPartner!.id, ...(draft.participantSetups.rivalPartner ?? draft.participantSetups.rival) }] : []),
  ];
  const proposal: ChallengeContractProposal = {
    id: `player-challenge:${world.runSeed >>> 0}:${(career.challengeSequence ?? 0) + 1}`,
    parties: [
      { id: playerPartyId, side: "player", captainId: career.identity.id, availableCash: world.cash, inventory: career.inventory, bundle: { cash: draft.playerCash, itemIds: [...draft.playerItemIds] } },
      { id: rivalPartyId, side: "rival", captainId: rival.id, availableCash: RIVAL_CASH, inventory: inventoryFor(rival.id, rival.holdings), bundle: { cash: draft.rivalCash, itemIds: [...draft.rivalItemIds] } },
    ],
    terms: {
      format: { teamFormat: draft.teamFormat, scoring: draft.scoring },
      teams: [
        { id: `challenge-team:${career.identity.id}`, partyId: playerPartyId, captainId: career.identity.id, partnerIds: isTeam ? [playerPartner!.id] : [] },
        { id: `challenge-team:${rival.id}`, partyId: rivalPartyId, captainId: rival.id, partnerIds: isTeam ? [rivalPartner!.id] : [] },
      ],
      participantSetups,
      sideBets: draft.sideBets.filter((sideBet) => sideBet.enabled).map((sideBet) => ({
        id: `challenge-sidebet:${sideBet.kind}`,
        kind: sideBet.kind,
        stake: sideBet.stake,
        holeIds: [],
      })),
    },
  };
  return { career, rival, playerPartner, rivalPartner, proposal, playerPartyId, rivalPartyId, rematch };
}

export function previewPlayerChallengeContract(args: {
  course: Course;
  world: World;
  day: number;
  draft: PlayerChallengeContractDraft;
}): PlayerChallengeContractPreview {
  const { rival, proposal } = contractContext(args.world, args.draft);
  const route = courseForLayout(args.course, args.draft.layoutId);
  if (route.holes.length < 3 || proposal.terms.participantSetups.some((setup) => route.holes.some((hole) => !getTeeBox(hole, setup.teeSet) || !getPinPosition(hole, setup.pinRotation)))) {
    throw new Error("Every routed hole must author the selected tee and pin; challenge setup does not use fallbacks.");
  }
  if (route.holes.length !== 9 && route.holes.length !== 18) throw new Error("Authoritative wagered challenges require a 9- or 18-hole route.");
  if (args.draft.teamFormat !== "individual") {
    const setups = Object.values(args.draft.participantSetups).filter((setup): setup is { teeSet: TeeSet; pinRotation: PinRotation } => Boolean(setup));
    if (setups.some((setup) => setup.teeSet !== setups[0].teeSet || setup.pinRotation !== setups[0].pinRotation)) {
      throw new Error("Team formats use one shared tee and pin setup for both captain-to-captain sides.");
    }
    if (args.draft.scoring === "net-stableford") throw new Error("Team Stableford requires a separate team authority and cannot be accepted here.");
    if (args.draft.sideBets.some((sideBet) => sideBet.enabled)) throw new Error("Evidence-backed side bets are individual challenges only.");
  }
  if (args.draft.sideBets.some((sideBet) => sideBet.enabled && sideBet.kind === "nassau")
    && (route.holes.length !== 18 || (args.draft.scoring !== "gross-match" && args.draft.scoring !== "net-match"))) {
    throw new Error("Nassau requires an 18-hole gross or net match challenge.");
  }
  return { proposal, evaluation: evaluateChallengeContract(proposal, { week: args.world.week, day: args.day }), rival };
}

const rivalSkills = (skill: number): PlayerProSkills => {
  const rating = Math.max(20, Math.min(85, Math.round(24 + skill * 70)));
  return { power: rating, driving: rating, irons: rating, shortGame: rating, putting: rating, recovery: rating };
};

const rivalHandicap = (skill: number) => Math.max(-2, Math.min(36, 32 - skill * 38));

function startContractGroup(args: {
  course: Course;
  world: World;
  day: number;
  draft: PlayerChallengeContractDraft;
  contract: ReturnType<typeof acceptChallengeContract>;
  career: PlayerProCareer;
  rival: PlayerChallengeContractRival;
  playerPartner?: PlayerChallengeContractRival;
  rivalPartner?: PlayerChallengeContractRival;
}): ChallengeGroupRound {
  const setupRound = (setup: { teeSet: TeeSet; pinRotation: PinRotation }) => {
    const started = startEquippedPlayableRound({ course: args.course, world: args.world, kind: "friendly", layoutId: args.draft.layoutId, teeSet: setup.teeSet, pinRotation: setup.pinRotation, day: args.day });
    if (!started.ok) throw new Error(started.reason);
    return started.round;
  };
  const playerRound = setupRound(args.draft.participantSetups.player);
  const rivalRound = setupRound(args.draft.participantSetups.rival);
  const playerTeam = args.contract.terms.teams.find((team) => team.partyId === args.contract.parties.find((party) => party.side === "player")!.id)!;
  const rivalTeam = args.contract.terms.teams.find((team) => team.partyId === args.contract.parties.find((party) => party.side === "rival")!.id)!;
  const participant = (person: PlayerChallengeContractRival, controller: "ai", teamId: string, round: PlayerPlayableRound) => ({
    id: person.id,
    name: person.name,
    controller,
    teamId,
    skills: rivalSkills(person.skill),
    handicapIndex: rivalHandicap(person.skill),
    setup: { course: round.course, teeSet: round.teeSet, pinRotation: round.pinRotation },
  });
  const isTeam = args.draft.teamFormat !== "individual";
  const playerPartnerRound = isTeam ? setupRound(args.draft.participantSetups.playerPartner ?? args.draft.participantSetups.player) : null;
  const rivalPartnerRound = isTeam ? setupRound(args.draft.participantSetups.rivalPartner ?? args.draft.participantSetups.rival) : null;
  return startChallengeGroupRound({
    id: args.contract.id,
    course: playerRound.course,
    rulesSnapshot: playerRound.rulesSnapshot,
    teeSet: playerRound.teeSet,
    pinRotation: playerRound.pinRotation,
    participants: [
      {
        id: args.career.identity.id,
        name: args.career.identity.name,
        controller: "player",
        teamId: playerTeam.id,
        handedness: args.career.identity.handedness,
        skills: args.career.skills,
        confidenceSnapshot: args.career.confidence,
        handicapIndex: args.career.handicapProfile.handicapIndex,
        setup: { course: playerRound.course, teeSet: playerRound.teeSet, pinRotation: playerRound.pinRotation },
        equipment: { loadout: args.career.equipmentLoadout, items: args.career.inventory.items },
      },
      ...(isTeam ? [participant(args.playerPartner!, "ai", playerTeam.id, playerPartnerRound!)] : []),
      participant(args.rival, "ai", rivalTeam.id, rivalRound),
      ...(isTeam ? [participant(args.rivalPartner!, "ai", rivalTeam.id, rivalPartnerRound!)] : []),
    ],
    ...(isTeam ? { teamFormat: args.draft.teamFormat as Exclude<ChallengeContractTeamFormat, "individual"> } : { individualFormat: args.draft.scoring }),
    scoringMode: args.draft.scoring,
    individualContests: isTeam ? [] : args.contract.terms.sideBets.map((sideBet) => ({ id: sideBet.id, kind: sideBet.kind, holeIds: sideBet.holeIds })),
    sideBets: [],
    rngSeed: (args.world.runSeed ^ args.contract.id.length * 104729) >>> 0,
    startedWeek: args.world.week,
    startedDay: args.day,
  });
}

export function startPlayerChallengeContract(args: {
  course: Course;
  world: World;
  day: number;
  draft: PlayerChallengeContractDraft;
}): { world: World; career: PlayerProCareer; round: PlayerPlayableRound } {
  const preview = previewPlayerChallengeContract(args);
  const { career, rival, playerPartner, rivalPartner, playerPartyId, rivalPartyId, rematch } = contractContext(args.world, args.draft);
  const required = preview.evaluation.parties;
  if (!args.draft.ownerTransfersConfirmed && required.some((party) => party.bundle.requiredOwnerConfirmationItemIds.length)) {
    throw new Error("Confirm every selected item transfer before acceptance.");
  }
  if (!args.draft.prestigeTransfersConfirmed && required.some((party) => party.side === "player" && party.bundle.requiredPrestigeConfirmationItemIds.length)) {
    throw new Error("Confirm the player's unique or high-prestige transfer separately.");
  }
  if (!args.draft.rivalTransfersConfirmed && required.some((party) => party.side === "rival" && party.bundle.requiredOwnerConfirmationItemIds.length)) {
    throw new Error("The rival's explicit transfer confirmation is required.");
  }
  const contract = acceptChallengeContract(preview.proposal, required.map((party) => ({
    partyId: party.id,
    ownerId: party.captainId,
    ownerConfirmedItemIds: party.bundle.requiredOwnerConfirmationItemIds,
    prestigeConfirmedItemIds: party.bundle.requiredPrestigeConfirmationItemIds,
  })), { week: args.world.week, day: args.day });
  const playerAssets: ChallengeLivePartyAssets = { partyId: playerPartyId, captainId: career.identity.id, cash: args.world.cash, inventory: career.inventory, loadout: career.equipmentLoadout };
  const rivalAssets: ChallengeLivePartyAssets = { partyId: rivalPartyId, captainId: rival.id, cash: RIVAL_CASH, inventory: inventoryFor(rival.id, rival.holdings), loadout: EMPTY_LOADOUT };
  const reserved = reserveChallengeAtFirstTee({ state: createChallengeRuntimeState(contract), parties: [playerAssets, rivalAssets], transitionId: `reserve:${contract.id}`, at: { week: args.world.week, day: args.day } });
  const playerAfter = reserved.parties.find((party) => party.partyId === playerPartyId)!;
  const startedWorld: World = { ...args.world, cash: playerAfter.cash, playerPro: { ...career, inventory: playerAfter.inventory, equipmentLoadout: playerAfter.loadout } };
  const group = startContractGroup({ course: args.course, world: startedWorld, day: args.day, draft: args.draft, contract, career: startedWorld.playerPro!, rival, playerPartner, rivalPartner });
  const round = challengeGroupPlayerRound(group);
  if (!round) throw new Error("Challenge group did not yield the player-controlled opening turn.");
  const challenge = {
    id: contract.id,
    opponentId: rival.id,
    opponentName: rival.name,
    kind: "wager" as const,
    status: "active" as const,
    relationship: rival.relationship,
    wager: 0,
    roundId: group.id,
    challengeContractId: contract.id,
  };
  const nextCareer: PlayerProCareer = {
    ...career,
    inventory: playerAfter.inventory,
    equipmentLoadout: playerAfter.loadout,
    activeChallengeRuntime: reserved.state,
    challengeSequence: (career.challengeSequence ?? 0) + 1,
    activeRound: null,
    activeChallengeGroupRound: group,
    challenges: rematch
      ? career.challenges.map((entry) => entry.id === rematch.id ? {
        ...entry,
        status: "active" as const,
        roundId: group.id,
        rematch: { ...entry.rematch!, activeContractId: contract.id },
      } : entry)
      : [...career.challenges, challenge].slice(-30),
  };
  return { world: { ...startedWorld, playerPro: nextCareer }, career: nextCareer, round };
}

export function tryStart(args: Parameters<typeof startPlayerChallengeContract>[0]):
  | { ok: true; value: ReturnType<typeof startPlayerChallengeContract> }
  | { ok: false; reason: string } {
  try {
    return { ok: true, value: startPlayerChallengeContract(args) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export function lockPlayerChallengeShot(career: PlayerProCareer, shotId: string, week: number, day: number): PlayerProCareer {
  const runtime = career.activeChallengeRuntime;
  if (!runtime || runtime.phase === "shot_locked") return career;
  return {
    ...career,
    activeChallengeRuntime: lockChallengeFirstShot({ state: runtime, transitionId: `first-shot:${runtime.contract.id}`, shotId, at: { week, day } }),
  };
}

export function commitRound(world: World, round: PlayerPlayableRound, day: number): World {
  const career = world.playerPro;
  if (!career?.activeChallengeRuntime) return world;
  let nextCareer: PlayerProCareer = { ...career, activeRound: round };
  if (career.activeChallengeRuntime.phase === "escrowed") {
    const shotId = round.pendingShot?.id ?? round.shots[0]?.id;
    if (!shotId) throw new Error("The first challenge shot did not produce lock evidence.");
    nextCareer = lockPlayerChallengeShot(nextCareer, shotId, world.week, day);
  }
  return { ...world, playerPro: nextCareer };
}

export function groupView(career: PlayerProCareer) {
  const group = career.activeChallengeGroupRound;
  if (!group) return null;
  const round = challengeGroupPlayerRound(group);
  return round ? { round, skills: challengeGroupPlayerSkills(group) } : null;
}

export function commitGroup(world: World, selection: PlayerShotSelection, day: number): World {
  const career = world.playerPro;
  const group = career?.activeChallengeGroupRound;
  if (!career || !group || group.phase !== "awaiting_player") return world;
  const nextGroup = commitChallengeGroupPlayerShot(group, group.playerGolferId, selection);
  if (nextGroup === group) return world;
  const firstPlayerTurn = nextGroup.turnEvidence.find((turn) => turn.golferId === group.playerGolferId && !group.turnEvidence.some((existing) => existing.shotId === turn.shotId));
  let nextCareer: PlayerProCareer = { ...career, activeChallengeGroupRound: nextGroup };
  if (career.activeChallengeRuntime?.phase === "escrowed") {
    if (!firstPlayerTurn) throw new Error("The first challenge shot did not produce group lock evidence.");
    nextCareer = lockPlayerChallengeShot(nextCareer, firstPlayerTurn.shotId, world.week, day);
  }
  return { ...world, playerPro: nextCareer };
}

export function chooseGroupBall(world: World, playerId: string): World {
  const career = world.playerPro;
  const group = career?.activeChallengeGroupRound;
  if (!career || !group || group.phase !== "awaiting_ball_choice") return world;
  return { ...world, playerPro: { ...career, activeChallengeGroupRound: chooseChallengeGroupScrambleBall(group, playerId) } };
}

export function autoGroup(world: World, day: number): World {
  let next = world;
  for (let guard = 0; guard < 960; guard += 1) {
    const career = next.playerPro;
    const group = career?.activeChallengeGroupRound;
    if (!career || !group || group.phase === "complete") return next;
    if (group.phase === "awaiting_ball_choice") {
      const player = group.golfers.find((golfer) => golfer.id === group.playerGolferId)!;
      const ball = group.teamAuthority?.balls.find((candidate) => candidate.teamId === player.teamId);
      const choice = ball?.candidates.slice().sort((left, right) => left.distanceToPin - right.distanceToPin)[0];
      if (!choice) throw new Error("Scramble auto-finish is missing a candidate ball.");
      next = chooseGroupBall(next, choice.playerId);
      continue;
    }
    const view = groupView(career);
    if (!view) throw new Error("Challenge auto-finish could not project the player turn.");
    const before = next;
    next = commitGroup(next, caddieRecommendation(view.round, view.skills), day);
    if (next === before) throw new Error("Challenge auto-finish could not advance the player turn.");
  }
  throw new Error("Challenge auto-finish exceeded its deterministic turn bound.");
}

function liveParties(career: PlayerProCareer, cash: number, runtime: ChallengeRuntimeState): readonly ChallengeSettlementPartyAssets[] {
  return runtime.contract.parties.map((party) => {
    const escrow = runtime.escrow?.parties.find((candidate) => candidate.partyId === party.id);
    if (!escrow) throw new Error("Challenge party escrow evidence is missing.");
    if (party.side === "player") return {
      partyId: party.id,
      captainId: party.captainId,
      captainName: career.identity.name,
      cash,
      inventory: career.inventory,
      loadout: career.equipmentLoadout,
      rivalCustody: career.rivalCustody,
      settlementLedger: career.settlementLedger,
    };
    return {
      partyId: party.id,
      captainId: party.captainId,
      captainName: career.challenges.find((challenge) => challenge.challengeContractId === runtime.contract.id)?.opponentName ?? party.captainId,
      cash: escrow.cashAfter,
      inventory: { version: 1, ownerId: party.captainId, items: escrow.itemSnapshots, escrowItemIds: escrow.itemIds, displayItemIds: [] },
      loadout: escrow.loadoutAtReservation,
      rivalCustody: [],
      settlementLedger: [],
    };
  });
}

export function cancelPlayerChallengeContract(args: { world: World; day: number }): World {
  const career = args.world.playerPro;
  const runtime = career?.activeChallengeRuntime;
  if (!career || !runtime) return args.world;
  const cancelled = cancelChallengeBeforeFirstShot({ state: runtime, parties: liveParties(career, args.world.cash, runtime), transitionId: `cancel:${runtime.contract.id}`, at: { week: args.world.week, day: args.day } });
  const player = cancelled.parties.find((party) => party.captainId === career.identity.id)!;
  return {
    ...args.world,
    cash: player.cash,
    playerPro: {
      ...career,
      inventory: player.inventory,
      equipmentLoadout: player.loadout,
      activeRound: null,
      activeChallengeGroupRound: null,
      activeChallengeRuntime: null,
      challenges: career.challenges.map((challenge) => challenge.challengeContractId === runtime.contract.id ? { ...challenge, status: "declined" as const } : challenge),
    },
  };
}

function partyForGolfer(runtime: ChallengeRuntimeState, golferId: string): string | undefined {
  const team = runtime.contract.terms.teams.find((candidate) => candidate.captainId === golferId || candidate.partnerIds.includes(golferId));
  return team?.partyId;
}

function uniqueBest(entries: readonly { id: string; value: number }[], maximize: boolean): string | undefined {
  if (!entries.length) return undefined;
  const best = (maximize ? Math.max : Math.min)(...entries.map((entry) => entry.value));
  const winners = entries.filter((entry) => entry.value === best);
  return winners.length === 1 ? winners[0].id : undefined;
}

function groupMainWinner(runtime: ChallengeRuntimeState, group: ChallengeGroupRound): string | undefined {
  const scoring = runtime.contract.terms.format.scoring;
  const isTeam = runtime.contract.terms.format.teamFormat !== "individual";
  if (isTeam) {
    const winner = uniqueBest(group.match.teamStandings.map((standing) => ({
      id: standing.id,
      value: scoring.endsWith("match") ? standing.holesWon : scoring.startsWith("net") ? standing.net : standing.gross,
    })), scoring.endsWith("match"));
    return runtime.contract.terms.teams.find((team) => team.id === winner)?.partyId;
  }
  const values = group.golfers.map((golfer) => ({
    id: golfer.id,
    value: scoring === "net-stableford"
      ? golfer.scorecard.reduce((total, score) => total + (score.gross == null ? 0 : stablefordPoints(score.gross, score.par, score.handicapStrokes)), 0)
      : scoring.endsWith("match")
        ? group.match.standings.find((standing) => standing.id === golfer.id)!.holesWon
        : group.match.standings.find((standing) => standing.id === golfer.id)![scoring.startsWith("net") ? "net" : "gross"],
  }));
  const winner = uniqueBest(values, scoring.endsWith("match") || scoring === "net-stableford");
  return winner ? partyForGolfer(runtime, winner) : undefined;
}

function groupEvidence(runtime: ChallengeRuntimeState, group: ChallengeGroupRound, kind: ChallengeSettlementEvidence["kind"]): ChallengeSettlementEvidence {
  const playerParty = runtime.contract.parties.find((party) => party.side === "player")!;
  const rivalParty = runtime.contract.parties.find((party) => party.side === "rival")!;
  const mainWinner = kind === "completed" ? groupMainWinner(runtime, group) : rivalParty.id;
  const components: Array<ChallengeSettlementEvidence["components"][number]> = [{
    componentId: "main",
    outcome: mainWinner ? "awarded" : "tied",
    ...(mainWinner ? { winnerPartyId: mainWinner } : {}),
    evidenceIds: [`group:${group.id}:main:${group.turnEvidence.length}`],
  }];
  for (const sideBet of runtime.contract.terms.sideBets) {
    const results = group.individualAuthority?.results.filter((result) => result.contestId === sideBet.id) ?? [];
    const scores = new Map<string, number>();
    let evidenceIds: string[] = [];
    if (kind === "completed" && (sideBet.kind === "closest-to-pin" || sideBet.kind === "longest-drive")) {
      const holes = sideBet.holeIds.length ? sideBet.holeIds : group.course.holes.map((hole) => hole.id);
      for (const holeId of holes) {
        const hole = group.course.holes.find((candidate) => candidate.id === holeId);
        const turns = group.turnEvidence.filter((turn) => turn.holeId === holeId);
        if (!hole || !turns.length) continue;
        evidenceIds.push(...turns.map((turn) => `group:${group.id}:${sideBet.id}:${turn.shotId}`));
        const winner = uniqueBest(turns.map((turn) => ({
          id: turn.golferId,
          value: sideBet.kind === "closest-to-pin"
            ? Math.hypot(turn.rest.x - hole.pin.x, turn.rest.y - hole.pin.y)
            : Math.hypot(turn.rest.x - turn.from.x, turn.rest.y - turn.from.y),
        })), sideBet.kind === "longest-drive");
        const partyId = winner ? partyForGolfer(runtime, winner) : undefined;
        if (partyId) scores.set(partyId, (scores.get(partyId) ?? 0) + 1);
      }
    } else if (kind === "completed") {
      evidenceIds = results.map((result, index) => `group:${group.id}:${sideBet.id}:${result.segment}:${index}`);
      results.filter((result) => result.status === "won").forEach((result) => result.winnerIds.forEach((golferId) => {
        const partyId = partyForGolfer(runtime, golferId);
        if (partyId) scores.set(partyId, (scores.get(partyId) ?? 0) + 1 + result.carryHoles);
      }));
    }
    if (kind !== "completed" || !scores.size) {
      components.push({ componentId: sideBet.id, outcome: "refunded", reason: kind === "completed" ? "No unique evidence-backed side-bet winner was recorded." : "Unfinished side bets refund on concession or withdrawal.", evidenceIds: [`group:${group.id}:${sideBet.id}:refund`] });
      continue;
    }
    const winner = uniqueBest([...scores].map(([id, value]) => ({ id, value })), true);
    components.push({
      componentId: sideBet.id,
      outcome: winner ? "awarded" : "tied",
      ...(winner ? { winnerPartyId: winner } : {}),
      evidenceIds,
    });
  }
  return {
    resolutionId: `resolution:${runtime.contract.id}:${group.id}`,
    kind,
    ...(kind === "completed" ? {} : { resolvedAgainstPartyId: playerParty.id }),
    components,
  };
}

function settleGroupWithEvidence(world: World, career: PlayerProCareer, group: ChallengeGroupRound, day: number, kind: ChallengeSettlementEvidence["kind"]): World {
  const runtime = career.activeChallengeRuntime;
  if (!runtime) return world;
  if (runtime.phase !== "shot_locked") throw new Error("A challenge group cannot settle before first-shot lock.");
  const evidence = groupEvidence(runtime, group, kind);
  const settled = settleChallenge({ state: runtime, parties: liveParties(career, world.cash, runtime), transitionId: `settle:${runtime.contract.id}`, at: { week: world.week, day }, evidence });
  const player = settled.parties.find((party) => party.captainId === career.identity.id)!;
  const challenge = career.challenges.find((candidate) => candidate.challengeContractId === runtime.contract.id || candidate.rematch?.activeContractId === runtime.contract.id);
  if (!challenge) throw new Error("Accepted challenge record is missing at group settlement.");
  const winner = evidence.components[0].winnerPartyId;
  const result = winner === runtime.contract.parties.find((party) => party.side === "player")!.id ? "won" as const
    : winner ? kind === "concession" ? "conceded" as const : "lost" as const
      : "tied" as const;
  let nextCareer: PlayerProCareer = {
    ...career,
    inventory: player.inventory,
    equipmentLoadout: player.loadout,
    rivalCustody: player.rivalCustody,
    settlementLedger: [...player.settlementLedger],
    activeRound: null,
    activeChallengeGroupRound: null,
    activeChallengeRuntime: null,
    challenges: career.challenges.map((candidate) => candidate.id === challenge.id ? { ...candidate, challengeSettlement: settled.settlement, status: "complete" as const, settled: true, result } : candidate),
  };
  if (challenge.rematch) {
    const sourceSettlement = nextCareer.challenges.map((candidate) => candidate.challengeSettlement).find((candidate) => candidate?.id === challenge.rematch!.sourceSettlementId);
    if (!sourceSettlement) throw new Error("Custody rematch source settlement is missing.");
    nextCareer = resolveChallengeCustodyRematch({ career: nextCareer, sourceSettlement, rematchChallengeId: challenge.id, transitionId: `rematch:${runtime.contract.id}`, evidenceId: `group:${group.id}:rematch`, outcome: result === "conceded" ? "lost" : result, at: { week: world.week, day } }).career;
  } else {
    nextCareer = createChallengeRematchOpportunities(nextCareer, settled.settlement);
  }
  return { ...world, cash: player.cash, playerPro: nextCareer };
}

export function settleGroup(world: World, day: number): World {
  const career = world.playerPro;
  const group = career?.activeChallengeGroupRound;
  if (!career || !group || group.phase !== "complete") return world;
  return settleGroupWithEvidence(world, career, group, day, "completed");
}

export function concedeGroup(world: World, day: number): World {
  const career = world.playerPro;
  const group = career?.activeChallengeGroupRound;
  if (!career || !group || career.activeChallengeRuntime?.phase !== "shot_locked") return world;
  return settleGroupWithEvidence(world, career, group, day, "concession");
}

export type ChallengeGroupAction =
  | { kind: "shot"; selection: PlayerShotSelection }
  | { kind: "choose"; playerId: string }
  | { kind: "auto" }
  | { kind: "concede" };

export function applyGroupAction(world: World, day: number, action: ChallengeGroupAction): World {
  if (action.kind === "concede") {
    return world.playerPro?.activeChallengeRuntime?.phase === "escrowed"
      ? cancelPlayerChallengeContract({ world, day })
      : concedeGroup(world, day);
  }
  const next = action.kind === "shot" ? commitGroup(world, action.selection, day)
    : action.kind === "choose" ? chooseGroupBall(world, action.playerId)
      : autoGroup(world, day);
  return next.playerPro?.activeChallengeGroupRound?.phase === "complete" ? settleGroup(next, day) : next;
}

export function forceTieFixture(world: World, day: number): World {
  const completed = autoGroup(world, day);
  const career = completed.playerPro;
  const group = career?.activeChallengeGroupRound;
  if (!career || !group || group.phase !== "complete") throw new Error("Challenge tie fixture did not complete.");
  const tiedGroup: ChallengeGroupRound = {
    ...group,
    match: {
      ...group.match,
      standings: group.match.standings.map((standing) => ({ ...standing, holesWon: 0 })),
      teamStandings: group.match.teamStandings.map((standing) => ({ ...standing, holesWon: 0 })),
    },
    ...(group.individualAuthority ? { individualAuthority: { ...group.individualAuthority, results: group.individualAuthority.results.map((result) => result.status === "won" ? { ...result, status: "tied" as const, winnerIds: group.golfers.map((golfer) => golfer.id) } : result) } } : {}),
  };
  return settleGroup({ ...completed, playerPro: { ...career, activeChallengeGroupRound: tiedGroup } }, day);
}

export function forceRivalWithdrawalFixture(world: World): World {
  const career = world.playerPro;
  const group = career?.activeChallengeGroupRound;
  if (!career || !group) throw new Error("No active challenge group fixture.");
  const playerTeamId = group.golfers.find((golfer) => golfer.id === group.playerGolferId)?.teamId;
  const rival = group.golfers.find((golfer) => golfer.id !== group.playerGolferId && golfer.teamId !== playerTeamId);
  if (!rival) throw new Error("No rival challenge golfer fixture.");
  return { ...world, playerPro: { ...career, activeChallengeGroupRound: withdrawChallengeGroupGolfer(group, rival.id, "Representative recovery fixture withdrawal.") } };
}

export function tryCancel(args: Parameters<typeof cancelPlayerChallengeContract>[0]):
  | { ok: true; world: World }
  | { ok: false; reason: string } {
  try {
    const world = cancelPlayerChallengeContract(args);
    return world === args.world
      ? { ok: false, reason: "No pre-shot challenge is active." }
      : { ok: true, world };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function resultEvidence(runtime: ChallengeRuntimeState, round: PlayerCareerRound, resolutionKind: ChallengeSettlementEvidence["kind"]): ChallengeSettlementEvidence {
  const playerParty = runtime.contract.parties.find((party) => party.side === "player")!;
  const rivalParty = runtime.contract.parties.find((party) => party.side === "rival")!;
  const winnerPartyId = round.result === "won"
    ? playerParty.id
    : round.result === "lost" || round.result === "conceded"
      ? rivalParty.id
      : undefined;
  return {
    resolutionId: `resolution:${runtime.contract.id}:${round.id}`,
    kind: resolutionKind,
    ...(resolutionKind !== "completed" ? { resolvedAgainstPartyId: playerParty.id } : {}),
    components: [
      { componentId: "main", outcome: winnerPartyId ? "awarded" : "tied", ...(winnerPartyId ? { winnerPartyId } : {}), evidenceIds: [`round:${round.id}:main`] },
      ...runtime.contract.terms.sideBets.map((sideBet) => ({
        componentId: sideBet.id,
        outcome: "refunded" as const,
        reason: "Legacy individual PlayerPlayableRound does not publish independent side-bet result evidence; the accepted component is explicitly refunded.",
        evidenceIds: [`round:${round.id}:${sideBet.id}:refund:no-independent-authority`],
      })),
    ],
  };
}

export function settlePlayerChallengeContract(args: {
  world: World;
  career: PlayerProCareer;
  round: PlayerCareerRound;
  day: number;
  resolutionKind?: ChallengeSettlementEvidence["kind"];
}): World {
  const runtime = args.career.activeChallengeRuntime;
  if (!runtime) return { ...args.world, playerPro: args.career };
  const shotId = args.career.activeRound?.shots[0]?.id;
  const lockedCareer = runtime.phase === "escrowed" && shotId
    ? lockPlayerChallengeShot(args.career, shotId, args.world.week, args.day)
    : args.career;
  const locked = lockedCareer.activeChallengeRuntime!;
  const evidence = resultEvidence(locked, args.round, args.resolutionKind ?? "completed");
  const settled = settleChallenge({ state: locked, parties: liveParties(lockedCareer, args.world.cash, locked), transitionId: `settle:${locked.contract.id}`, at: { week: args.world.week, day: args.day }, evidence });
  const player = settled.parties.find((party) => party.captainId === lockedCareer.identity.id)!;
  const challenge = lockedCareer.challenges.find((candidate) =>
    candidate.challengeContractId === locked.contract.id || candidate.rematch?.activeContractId === locked.contract.id
  );
  if (!challenge) throw new Error("Accepted challenge record is missing at settlement.");
  const challengeResult = args.round.result === "complete" ? "tied" : args.round.result;
  let nextCareer: PlayerProCareer = {
    ...lockedCareer,
    inventory: player.inventory,
    equipmentLoadout: player.loadout,
    rivalCustody: player.rivalCustody,
    settlementLedger: [...player.settlementLedger],
    activeChallengeRuntime: null,
    challenges: lockedCareer.challenges.map((candidate) => candidate.id === challenge.id ? {
      ...candidate,
      challengeSettlement: settled.settlement,
      status: "complete" as const,
      settled: true,
      result: challengeResult,
    } : candidate),
  };
  if (challenge.rematch) {
    const sourceSettlement = nextCareer.challenges
      .map((candidate) => candidate.challengeSettlement)
      .find((candidate) => candidate?.id === challenge.rematch!.sourceSettlementId);
    if (!sourceSettlement) throw new Error("Custody rematch source settlement is missing.");
    nextCareer = resolveChallengeCustodyRematch({
      career: nextCareer,
      sourceSettlement,
      rematchChallengeId: challenge.id,
      transitionId: `rematch:${locked.contract.id}`,
      evidenceId: `round:${args.round.id}:rematch`,
      outcome: challengeResult === "conceded" ? "lost" : challengeResult,
      at: { week: args.world.week, day: args.day },
    }).career;
  } else {
    nextCareer = createChallengeRematchOpportunities(nextCareer, settled.settlement);
  }
  return { ...args.world, cash: player.cash, playerPro: nextCareer };
}
