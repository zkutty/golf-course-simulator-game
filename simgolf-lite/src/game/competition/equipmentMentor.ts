import type { Course, PinRotation, TeeSet, World } from "../models/types";
import type { PlayerPlayableRound, PlayerProCareer, PlayerShotTrace } from "../models/playerProTypes";
import { normalizeLivingClub } from "../livingClub/livingClub";
import type { EquipmentLoadout, EquipmentModifier, InventoryItem, LearnedTechnique, MentorTechniqueChallenge } from "./types";
import { normalizePerformanceLoadoutSnapshot } from "./equipmentRuntime";
import { startPlayableRound, type StartPlayableRoundArgs } from "../playerPro/playerProRoundStart";
import { activatePlayerChallenge, activatePlayerTournament, createPlayerChallenge, normalizePlayerPro, registerPlayerTournament, type PlayerOpponent } from "../playerPro/playerPro";
import type { TournamentEvent } from "../tournaments/types";
import { createM48DesignTestSession } from "../architecture/comparison";
import { activeCourseLayout } from "../models/courseLayouts";
import { activeCampaignMatch, campaignPhaseBlockers, campaignPhaseEvidenceKind, registerCampaignMatch } from "../campaign/campaign";
import { createTournamentEvent, scheduleTournament } from "../tournaments/tournaments";

const EQUIPMENT_SIDEGRADE_MIN = .88;
const EQUIPMENT_SIDEGRADE_MAX = 1.12;
export const MENTOR_MATCHES_REQUIRED = 2;
export const MENTOR_RELATIONSHIP_REQUIRED = 25;

interface AuthoredEquipmentEffect { definitionId: string; label: string; restriction: string; downside: string; modifiers: readonly EquipmentModifier[] }
export interface MentorTechniqueDefinition { id: LearnedTechnique; name: string; restriction: string; downside: string; objectiveId: string; objective: string; modifiers: readonly EquipmentModifier[] }
const item = (definitionId: string, label: string, restriction: string, downside: string, modifiers: readonly EquipmentModifier[]): AuthoredEquipmentEffect => ({ definitionId, label, restriction, downside, modifiers });
export const AUTHORED_EQUIPMENT_EFFECTS: readonly AuthoredEquipmentEffect[] = [
  item("workshop-flighted-iron", "Workshop Flighted Iron", "Low-flight 5 Iron and 7 Iron shots only.", "Trades 6% carry for 10% tighter dispersion.", [{ channel: "carry", multiplier: .94, context: "iron-low-flight" }, { channel: "dispersion", multiplier: .9, context: "iron-low-flight" }]),
  item("balanced-canvas-bag", "Balanced Canvas Bag", "Standard-flight full shots only.", "Trades 4% carry for 5% tighter dispersion.", [{ channel: "carry", multiplier: .96, context: "standard-full-shot" }, { channel: "dispersion", multiplier: .95, context: "standard-full-shot" }]),
  item("heritage-outfit", "Hand-cut Heritage Outfit", "Recovery shots from sand or deep rough only.", "Improves recovery composure by 8% but widens dispersion by 5%.", [{ channel: "recovery", multiplier: 1.08, context: "difficult-recovery" }, { channel: "dispersion", multiplier: 1.05, context: "difficult-recovery" }]),
  item("field-chronometer", "Field Chronometer", "Putting outcomes from the green only.", "Improves putting read by 8% but reduces committed pace by 6%.", [{ channel: "putting", multiplier: 1.08, context: "green-putting" }, { channel: "carry", multiplier: .94, context: "green-putting" }]),
];
export const authoredEquipmentModifiers = (entry: InventoryItem) => AUTHORED_EQUIPMENT_EFFECTS.find((definition) => definition.definitionId === entry.definitionId)?.modifiers ?? [];
const effects = (id: LearnedTechnique) => ({
  "fairway-finder": [{ channel: "carry", multiplier: .92, context: "wood-from-tee" }, { channel: "dispersion", multiplier: .9, context: "wood-from-tee" }],
  "knockdown-approach": [{ channel: "carry", multiplier: .94, context: "iron-low-fairway" }, { channel: "dispersion", multiplier: .9, context: "iron-low-fairway" }, { channel: "spin", multiplier: 1.1, context: "iron-low-fairway" }],
  "soft-hands": [{ channel: "carry", multiplier: .92, context: "greenside-rough" }, { channel: "spin", multiplier: .9, context: "greenside-rough" }],
  "splash-specialist": [{ channel: "carry", multiplier: .9, context: "sand-wedge-from-sand" }, { channel: "dispersion", multiplier: .88, context: "sand-wedge-from-sand" }, { channel: "recovery", multiplier: 1.08, context: "sand-wedge-from-sand" }],
  "lag-putt": [{ channel: "putting", multiplier: 1.1, context: "long-green-putting" }, { channel: "carry", multiplier: .92, context: "long-green-putting" }],
}[id] as readonly EquipmentModifier[]);
const technique = (id: LearnedTechnique, name: string, restriction: string, downside: string, objectiveId: string, objective: string): MentorTechniqueDefinition => ({ id, name, restriction, downside, objectiveId, objective, modifiers: effects(id) });
export const MENTOR_TECHNIQUES: readonly MentorTechniqueDefinition[] = [
  technique("fairway-finder", "Fairway Finder", "Driver or 3 Wood from the tee only.", "Trades 8% carry for 10% tighter dispersion.", "find-fairway-from-tee", "Hit a penalty-free Driver or 3 Wood tee shot that finishes on the fairway."),
  technique("knockdown-approach", "Knockdown Approach", "Low-flight 5 Iron or 7 Iron from the fairway only.", "Trades 6% carry and 10% more release for 10% tighter dispersion.", "knockdown-green", "Finish a penalty-free low 5 Iron or 7 Iron approach from the fairway on the green."),
  technique("soft-hands", "Soft Hands", "Chip or wedge from rough and deep rough only.", "Trades 8% carry for 10% less release.", "soft-landing", "Finish a penalty-free chip or wedge from rough or deep rough on the green."),
  technique("splash-specialist", "Splash Specialist", "Sand Wedge shots from sand only.", "Trades 10% carry for 12% tighter recovery dispersion.", "splash-to-green", "Finish a penalty-free Sand Wedge shot from sand on the green."),
  technique("lag-putt", "Lag Putt", "Automatic putting from a leave of at least 10 yards only.", "Improves putting read by 10% while reducing pace by 8%.", "long-lag-two-putt", "Take two putts or fewer from an approach leave of at least 10 yards."),
];
export const mentorTechniqueDefinition = (id: LearnedTechnique) => MENTOR_TECHNIQUES.find((definition) => definition.id === id)!;

/**
 * Capture stays with the deferred authored equipment/mentor authority. The
 * resulting value is self-contained, normalized, and synchronously handed to
 * the round-start transaction; play and reload never consult mutable custody.
 */
export function capturePerformanceLoadout(args: {
  ownerId: string;
  inventoryItems: readonly InventoryItem[];
  escrowItemIds?: readonly string[];
  loadout: EquipmentLoadout;
  learnedTechniques: readonly LearnedTechnique[];
  week: number;
  day: number;
}) {
  const requested = new Set([
    ...args.loadout.clubItemIds,
    args.loadout.bagItemId,
    args.loadout.outfitItemId,
    args.loadout.watchItemId,
  ].filter((id): id is string => typeof id === "string"));
  const escrowed = new Set(args.escrowItemIds ?? []);
  const items = args.inventoryItems.filter((entry) => requested.has(entry.id) && !escrowed.has(entry.id)
    && entry.ownerId === args.ownerId && entry.custodianId === args.ownerId);
  const techniqueId = args.loadout.techniqueId && args.learnedTechniques.includes(args.loadout.techniqueId)
    ? args.loadout.techniqueId
    : undefined;
  const raw = {
    version: 1,
    frozenWeek: args.week,
    frozenDay: args.day,
    itemIds: items.map((entry) => entry.id),
    ...(techniqueId ? { techniqueId } : {}),
    modifiers: [
      ...items.flatMap((entry) => (entry.modifiers ?? []).map((modifier) => ({
        ...modifier,
        sourceKind: "equipment" as const,
        sourceId: entry.definitionId,
      }))),
      ...(techniqueId ? effects(techniqueId).map((modifier) => ({
        ...modifier,
        sourceKind: "technique" as const,
        sourceId: techniqueId,
      })) : []),
    ],
  };
  return normalizePerformanceLoadoutSnapshot(raw)!;
}

export function startEquippedPlayableRound(args: StartPlayableRoundArgs) {
  const career = args.world.playerPro;
  const performanceLoadout = career ? capturePerformanceLoadout({
    ownerId: career.identity.id,
    inventoryItems: career.inventory.items,
    escrowItemIds: career.inventory.escrowItemIds,
    loadout: career.equipmentLoadout,
    learnedTechniques: career.learnedTechniques,
    week: args.world.week,
    day: args.day ?? 0,
  }) : undefined;
  return startPlayableRound({ ...args, performanceLoadout });
}

export interface MentorEligibility { mentorId: string; techniqueId: LearnedTechnique | null; completedMatches: number; relationship: number; revealCount: number; eligible: boolean; blockers: readonly string[] }
export function mentorTechniqueEligibility(world: World, mentorId: string): MentorEligibility {
  const person = normalizeLivingClub(world.livingClub).regulars.find((candidate) => candidate.id === mentorId);
  const techniqueId = person?.rivalProfile?.signatureTechnique ?? null;
  const completedMatches = world.playerPro?.rounds.filter((round) => round.opponentId === mentorId && ["won", "lost", "tied"].includes(round.result)).length ?? 0;
  const relationship = person?.relationship.score ?? 0;
  const revealCount = person?.backstory?.revealedHistory.length ?? 0;
  const required = Math.max(2, person?.rivalProfile?.mentorMatchesRequired ?? 2);
  const blockers = [!person && "Mentor is not in the current club roster.", !techniqueId && "This person has no authored mentor technique.", completedMatches < required && `Complete ${required} matches with this mentor.`, relationship < 25 && "Reach relationship 25.", revealCount < 1 && "Reveal at least one relationship-gated story fact.", techniqueId && world.playerPro?.learnedTechniques.includes(techniqueId) && "Technique already learned.", world.playerPro?.activeMentorTechniqueChallenge && "Finish the active mentor objective first."].filter((value): value is string => typeof value === "string");
  return { mentorId, techniqueId, completedMatches, relationship, revealCount, eligible: blockers.length === 0, blockers };
}

export function startMentorTechniqueChallenge(args: { world: World; mentorId: string; challengeId: string; day: number }): { ok: true; world: World; challenge: MentorTechniqueChallenge } | { ok: false; reasons: readonly string[] } {
  const career = args.world.playerPro;
  if (!career) return { ok: false, reasons: ["Create a Player Pro before starting mentor practice."] };
  const existing = career.mentorTechniqueChallenges.find((entry) => entry.id === args.challengeId);
  if (existing) return { ok: true, world: args.world, challenge: existing };
  const eligibility = mentorTechniqueEligibility(args.world, args.mentorId);
  if (!eligibility.eligible || !eligibility.techniqueId) return { ok: false, reasons: eligibility.blockers };
  const person = normalizeLivingClub(args.world.livingClub).regulars.find((entry) => entry.id === args.mentorId)!;
  const definition = mentorTechniqueDefinition(eligibility.techniqueId);
  const challenge: MentorTechniqueChallenge = { version: 1, id: args.challengeId, mentorId: person.id, mentorName: person.name, techniqueId: definition.id, objectiveId: definition.objectiveId, objective: definition.objective, status: "active", startedWeek: args.world.week, startedDay: Math.max(0, Math.min(6, Math.floor(args.day))), attemptRoundIds: [] };
  return { ok: true, challenge, world: { ...args.world, playerPro: { ...career, activeMentorTechniqueChallenge: challenge, mentorTechniqueChallenges: [...career.mentorTechniqueChallenges, challenge].slice(-40) } } };
}

/** Deferred adapter for the legacy mentor round so App keeps only orchestration. */
export function startPlayerMentorTechniqueRound(args: {
  course: Course;
  world: World;
  opponent: PlayerOpponent;
  challengeId: string;
  layoutId: string;
  day: number;
}): { ok: true; career: PlayerProCareer } | { ok: false; reason: string } {
  const initiated = startMentorTechniqueChallenge({ world: args.world, mentorId: args.opponent.id, challengeId: args.challengeId, day: args.day });
  if (!initiated.ok) return { ok: false, reason: initiated.reasons.join(" ") };
  const created = createPlayerChallenge(initiated.world.playerPro!, args.opponent, "friendly", 0);
  const started = startEquippedPlayableRound({
    course: args.course,
    world: initiated.world,
    kind: "friendly",
    layoutId: args.layoutId,
    teeSet: "member",
    pinRotation: args.course.activePinRotation ?? "A",
    day: args.day,
    opponent: { id: args.opponent.id, name: args.opponent.name, skill: args.opponent.skill, relationshipDelta: 0, wager: 0, projectedStrokes: 0 },
  });
  if (!started.ok) return started;
  return { ok: true, career: { ...activatePlayerChallenge(created.career, created.challenge.id, started.round.id), activeRound: started.round } };
}

export function startPlayerProCareerRound(args: StartPlayableRoundArgs): { ok: true; career: PlayerProCareer } | { ok: false; reason: string } {
  const started = startEquippedPlayableRound(args);
  if (!started.ok) return started;
  const career = normalizePlayerPro(args.world.playerPro, { seed: args.world.runSeed, founderName: args.world.founderName });
  return { ok: true, career: { ...career, activeRound: started.round } };
}

export function startPlayerProTournamentRound(args: { course: Course; world: World; event: TournamentEvent; layoutId: string; day: number }): { ok: true; career: PlayerProCareer } | { ok: false; reason: string } {
  const career = normalizePlayerPro(args.world.playerPro, { seed: args.world.runSeed, founderName: args.world.founderName });
  const registered = registerPlayerTournament(career, args.event);
  if (registered === career) return { ok: false, reason: "eligibility" };
  const started = startEquippedPlayableRound({ course: args.course, world: args.world, kind: "tournament", layoutId: args.event.courseId ?? args.layoutId, teeSet: args.event.teeSet ?? "member", pinRotation: args.event.pinRotation ?? args.course.activePinRotation ?? "A", day: args.day, tournament: { id: args.event.id, name: args.event.name } });
  if (!started.ok) return started;
  return { ok: true, career: { ...activatePlayerTournament(registered, args.event.id, started.round.id), activeRound: started.round } };
}

export function startArchitectureTestPlayerRound(args: {
  course: Course;
  world: World;
  layoutId: string;
  holeId: string;
  teeSet: TeeSet;
  pinRotation: PinRotation;
  day: number;
}): { ok: true; world: World; career: PlayerProCareer } | { ok: false; reason: "setup" | string } {
  const session = createM48DesignTestSession({ course: args.course, courseId: args.layoutId, holeId: args.holeId, teeSet: args.teeSet, pinRotation: args.pinRotation, week: args.world.week, seed: args.world.runSeed ^ 0x48_0001 });
  if (!session) return { ok: false, reason: "setup" };
  const started = startEquippedPlayableRound({ course: args.course, world: args.world, layoutId: args.layoutId, teeSet: session.teeSet, pinRotation: session.pinRotation, kind: "exhibition", day: args.day });
  if (!started.ok) return started;
  const career = normalizePlayerPro(args.world.playerPro, { seed: args.world.runSeed, founderName: args.world.founderName });
  const nextCareer = { ...career, activeRound: started.round };
  const living = normalizeLivingClub(args.world.livingClub);
  return { ok: true, career: nextCareer, world: { ...args.world, livingClub: { ...living, architecture: { ...living.architecture, testSession: session, comparison: null } }, playerPro: nextCareer } };
}

export function startPlayerCampaignMatch(args: {
  course: Course;
  world: World;
  day: number;
  championshipName: string;
}): { ok: true; world: World; career: PlayerProCareer } | {
  ok: false;
  reason: string;
  points?: number;
} {
  const match = activeCampaignMatch(args.world.campaign);
  if (!match || !args.world.campaign) return { ok: false, reason: "unavailable" };
  const exactMatchEvidencePending = campaignPhaseEvidenceKind(args.world.campaign, args.world.campaign.phaseIndex) === "exact-campaign-match";
  const blocked = campaignPhaseBlockers(args.course, args.world)
    .some((reason) => !reason.startsWith("campaign.blocker.match:")
      && !(exactMatchEvidencePending && reason.endsWith(":exact-campaign-match")));
  if (blocked) return { ok: false, reason: "objectives" };
  const career = normalizePlayerPro(args.world.playerPro, {
    seed: args.world.runSeed,
    founderName: args.world.founderName,
  });
  if (career.careerPoints < match.minCareerPoints) {
    return { ok: false, reason: "points", points: match.minCareerPoints };
  }
  const layoutId = activeCourseLayout(args.course).id;

  if (match.opponent) {
    const opponent: PlayerOpponent = {
      id: match.opponent.id,
      name: match.opponent.name,
      skill: match.opponent.skill,
      relationship: args.world.campaign.relationships[match.opponent.characterId],
    };
    const created = createPlayerChallenge(career, opponent, "friendly", 0);
    const started = startEquippedPlayableRound({
      course: args.course,
      world: args.world,
      kind: "friendly",
      layoutId,
      teeSet: "member",
      pinRotation: args.course.activePinRotation ?? "A",
      day: args.day,
      opponent: { ...opponent, relationshipDelta: 0, wager: 0, projectedStrokes: 0 },
    });
    if (!started.ok) return started;
    const nextCareer = {
      ...activatePlayerChallenge(created.career, created.challenge.id, started.round.id),
      activeRound: started.round,
    };
    return {
      ok: true,
      career: nextCareer,
      world: registerCampaignMatch({ ...args.world, playerPro: nextCareer }, match.id, started.round.id),
    };
  }

  const created = createTournamentEvent({
    course: args.course,
    world: args.world,
    tier: "championship",
    currentDay: args.day,
    daysAhead: 1,
    courseId: layoutId,
  });
  if (!created.ok) return created;
  const event = { ...created.event, name: args.championshipName };
  const scheduledWorld = scheduleTournament(args.world, event);
  const registered = registerPlayerTournament(career, event, { campaignQualified: true });
  const started = startEquippedPlayableRound({
    course: args.course,
    world: scheduledWorld,
    kind: "tournament",
    layoutId: event.courseId ?? layoutId,
    teeSet: event.teeSet ?? "championship",
    pinRotation: event.pinRotation ?? args.course.activePinRotation ?? "A",
    day: args.day,
    tournament: { id: event.id, name: event.name },
  });
  if (!started.ok) return started;
  const nextCareer = {
    ...activatePlayerTournament(registered, event.id, started.round.id),
    activeRound: started.round,
  };
  return {
    ok: true,
    career: nextCareer,
    world: registerCampaignMatch({ ...scheduledWorld, playerPro: nextCareer }, match.id, started.round.id, event.id),
  };
}

const objectiveSatisfied = (id: LearnedTechnique, shot: PlayerShotTrace) => {
  const safe = shot.penaltyStrokes === 0;
  const green = shot.lieAfter === "green" || shot.lieAfter === "cup";
  if (id === "fairway-finder") return safe && shot.lieBefore === "tee" && (shot.club === "Driver" || shot.club === "3 Wood") && shot.lieAfter === "fairway";
  if (id === "knockdown-approach") return safe && shot.lieBefore === "fairway" && (shot.club === "5 Iron" || shot.club === "7 Iron") && shot.flightProfile === "low" && green;
  if (id === "soft-hands") return safe && (shot.lieBefore === "rough" || shot.lieBefore === "deep_rough") && ["Chip", "Pitching Wedge", "Sand Wedge"].includes(shot.club) && green;
  if (id === "splash-specialist") return safe && shot.lieBefore === "sand" && shot.club === "Sand Wedge" && green;
  return Boolean(shot.greenPutting && shot.greenPutting.leaveDistanceYards >= 10 && shot.greenPutting.putts <= 2);
};

export function settleMentorTechniqueChallenge(career: PlayerProCareer, round: PlayerPlayableRound): PlayerProCareer {
  const challenge = career.activeMentorTechniqueChallenge;
  if (!challenge || (round.phase !== "round_complete" && round.phase !== "conceded") || round.opponent?.id !== challenge.mentorId) return career;
  const ledgerId = `mentor:${challenge.id}:${round.id}`;
  if (career.mentorTechniqueLedger.includes(ledgerId)) return career;
  const success = round.phase === "round_complete" && round.shots.some((shot) => objectiveSatisfied(challenge.techniqueId, shot));
  const settled = { ...challenge, ...(success ? { status: "complete" as const, completedRoundId: round.id } : {}), attemptRoundIds: [...challenge.attemptRoundIds, round.id] };
  return { ...career, learnedTechniques: success ? [...new Set([...career.learnedTechniques, challenge.techniqueId])] : career.learnedTechniques, activeMentorTechniqueChallenge: success ? null : settled, mentorTechniqueChallenges: career.mentorTechniqueChallenges.map((entry) => entry.id === challenge.id ? settled : entry), mentorTechniqueLedger: [...career.mentorTechniqueLedger, ledgerId].slice(-160) };
}

export function setEquipmentLoadout(career: PlayerProCareer, loadout: EquipmentLoadout): { ok: true; career: PlayerProCareer } | { ok: false; reason: string } {
  if (career.activeRound || career.activeChallengeGroupRound) return { ok: false, reason: "Equipment and mentor technique are frozen until the round settles." };
  const ids = [...loadout.clubItemIds, loadout.bagItemId, loadout.outfitItemId, loadout.watchItemId].filter((id): id is string => typeof id === "string");
  if (ids.some((id) => career.inventory.escrowItemIds.includes(id))) return { ok: false, reason: "Escrowed challenge items cannot be newly equipped." };
  const items = new Map(career.inventory.items.map((entry) => [entry.id, entry]));
  if (ids.some((id) => items.get(id)?.ownerId !== career.identity.id || items.get(id)?.custodianId !== career.identity.id)) return { ok: false, reason: "Every equipped item must be owned and in the player's custody." };
  if (loadout.clubItemIds.some((id) => items.get(id)?.category !== "club") || (loadout.bagItemId && items.get(loadout.bagItemId)?.category !== "bag") || (loadout.outfitItemId && items.get(loadout.outfitItemId)?.category !== "outfit") || (loadout.watchItemId && items.get(loadout.watchItemId)?.category !== "watch")) return { ok: false, reason: "Equipment must be assigned to its authored loadout slot." };
  if (loadout.techniqueId && !career.learnedTechniques.includes(loadout.techniqueId)) return { ok: false, reason: "The selected mentor technique has not been learned." };
  return { ok: true, career: { ...career, equipmentLoadout: { ...loadout } } };
}

export function auditEquipmentMentorContent(): readonly string[] {
  return [...AUTHORED_EQUIPMENT_EFFECTS, ...MENTOR_TECHNIQUES].flatMap((definition) => !definition.restriction || !definition.downside || definition.modifiers.some((modifier) => modifier.multiplier < EQUIPMENT_SIDEGRADE_MIN || modifier.multiplier > EQUIPMENT_SIDEGRADE_MAX || !modifier.context) ? [`${"id" in definition ? definition.id : definition.definitionId} exceeds the authored sidegrade contract.`] : []);
}
