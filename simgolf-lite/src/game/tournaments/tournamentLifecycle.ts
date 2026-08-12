import type { Course, World } from "../models/types";
import { PLAYER_PRO_SKILLS, type PlayerProCareer } from "../models/playerProTypes";
import { activeCourseLayout, courseForLayout, layoutById } from "../models/courseLayouts";
import { getParSetting, resolveCourseSetup } from "../models/courseSetup";
import { computeAutoPar } from "../sim/holeMetrics";
import { courseHandicapUnrounded, playingHandicapFromUnrounded, strokesByHole } from "../competition/handicap";
import { captureTeamHandicapSnapshots } from "../competition/teamAuthority";
import type { CompetitionTeam } from "../competition/types";
import { scoreStrokePlay } from "../competition/scoring";
import { evaluateTournamentCourseQualification, revalidatePrescribedTournamentSetup } from "./eligibility";
import { absoluteGameDay, tournamentCalendar } from "./tournaments";
import type {
  TournamentActivationSnapshot,
  TournamentEvent,
  TournamentRoundScorecard,
  TournamentScoringMode,
  TournamentTeamFormat,
  TournamentTier,
} from "./types";
import { PRO_AM_MEMBER_ALLOWANCE, tournamentTemplate } from "./tournamentTemplates";
import { reconstructIndividualTournamentStandings } from "./tournamentStandings";
import { projectProAmTeamStandings, reconstructProAmTournamentEvidence, scoreProAmRoundEvidence } from "./proAmField";

export const TOURNAMENT_LIFECYCLE_DEFAULTS: Record<TournamentTier, { scoringMode: TournamentScoringMode; roundCount: 1 | 2 | 4; teamFormat: TournamentTeamFormat }> = {
  local: { scoringMode: "stableford", roundCount: 1, teamFormat: "individual" },
  regional: { scoringMode: "net-stroke", roundCount: 2, teamFormat: "individual" },
  championship: { scoringMode: "gross-stroke", roundCount: 4, teamFormat: "individual" },
};

export function playerTournamentEligibility(career: PlayerProCareer, event: TournamentEvent): { eligible: boolean; reason: string | null } {
  const minimum: Record<TournamentTier, number> = { local: 35, regional: 52, championship: 68 };
  const average = PLAYER_PRO_SKILLS.reduce((sum, skill) => sum + career.skills[skill], 0) / PLAYER_PRO_SKILLS.length;
  if (event.status !== "scheduled") return { eligible: false, reason: "event_status" };
  if (average < minimum[event.tier]) return { eligible: false, reason: `skill:${minimum[event.tier]}` };
  if (career.tournaments.some((record) => record.eventId === event.id && record.status !== "withdrawn")) return { eligible: false, reason: "already_entered" };
  return { eligible: true, reason: null };
}

const freeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(freeze);
  }
  return value;
};

function roundSchedule(event: TournamentEvent) {
  const count = Math.max(1, Math.min(4, Math.floor(event.roundCount ?? 1)));
  return Array.from({ length: count }, (_, index) => {
    const absolute = absoluteGameDay(event.scheduledWeek, event.scheduledDay) + index;
    return { roundNumber: index + 1, scheduledWeek: Math.floor(absolute / 7) + 1, scheduledDay: absolute % 7, status: "scheduled" as const, scorecards: [] };
  });
}

export type TournamentActivationResult = { ok: true; event: TournamentEvent } | { ok: false; reason: string };
export type TournamentActivationPreviewResult = { ok: true; snapshot: TournamentActivationSnapshot; qualification: ReturnType<typeof revalidatePrescribedTournamentSetup> } | { ok: false; reason: string };

/** Builds the exact immutable contract consumed by activation; preview has no world mutation. */
export function previewTournamentActivation(event: TournamentEvent, course: Course, week = event.scheduledWeek, day = event.scheduledDay): TournamentActivationPreviewResult {
  if (event.status !== "scheduled") return { ok: false, reason: "Only a scheduled tournament can be activated." };
  if (week !== event.scheduledWeek || day !== event.scheduledDay) return { ok: false, reason: "Tournament activation must occur on its first scheduled day." };
  const defaults = TOURNAMENT_LIFECYCLE_DEFAULTS[event.tier];
  const roundCount = Math.floor(event.roundCount ?? defaults.roundCount);
  if (roundCount < 1 || roundCount > 4) return { ok: false, reason: "A tournament requires between one and four rounds." };
  const scoringMode = event.scoringMode ?? defaults.scoringMode;
  const teamFormat = event.teamFormat ?? defaults.teamFormat;
  let template;
  try { template = event.templateId ? tournamentTemplate(event.templateId) : undefined; }
  catch { return { ok: false, reason: "The tournament template is not supported." }; }
  if (teamFormat !== "individual" && !template) return { ok: false, reason: "Team tournaments require a reusable tournament template." };
  if (template && (template.teamFormat !== teamFormat || !template.scoringModes.includes(scoringMode))) return { ok: false, reason: "The requested scoring mode is not defined by this tournament template." };
  if (!event.field.length || new Set(event.field.map((entrant) => entrant.id)).size !== event.field.length) return { ok: false, reason: "Tournament entrants require unique stable identities." };
  const layout = event.courseId ? layoutById(course, event.courseId) : activeCourseLayout(course);
  if (!layout || layout.state !== "open" || layout.publishedHoleIds.length !== 18) return { ok: false, reason: "Tournament activation requires an open, published 18-hole routing." };
  const host = courseForLayout(course, layout.id);
  const booked = event.qualificationSnapshot ?? evaluateTournamentCourseQualification(host, event.tier);
  const teeSet = event.teeSet ?? booked.teeSet;
  const pinRotation = event.pinRotation ?? booked.pinRotation;
  const qualification = revalidatePrescribedTournamentSetup(host, event.tier, teeSet, pinRotation);
  if (!qualification.eligible) return { ok: false, reason: qualification.blockingReasons[0] ?? "The host course is no longer eligible." };
  const expectedIds = event.holeIds?.length ? event.holeIds : layout.publishedHoleIds;
  const holes = host.holes.map((hole, index) => {
    const id = hole.id ?? `hole-${index + 1}`;
    const setup = resolveCourseSetup(hole, teeSet, pinRotation);
    if (!setup.tee || !setup.pin) return null;
    const setting = getParSetting(hole, setup.teeSet);
    const par = setting.mode === "MANUAL" ? setting.par : computeAutoPar(Math.hypot(setup.pin.x - setup.tee.x, setup.pin.y - setup.tee.y));
    const strokeIndex = Number.isInteger(hole.holeIndex) && hole.holeIndex! >= 1 && hole.holeIndex! <= host.holes.length ? hole.holeIndex! : index + 1;
    return { id, par, strokeIndex, tee: { ...setup.tee }, pin: { ...setup.pin } };
  });
  if (holes.some((hole) => !hole) || holes.length !== 18) return { ok: false, reason: "Every routed hole requires a valid tee, pin, par, and stroke index." };
  const frozenHoles = holes as NonNullable<(typeof holes)[number]>[];
  if (expectedIds.length !== frozenHoles.length || expectedIds.some((id, index) => id !== frozenHoles[index].id)) return { ok: false, reason: "The scheduled routing no longer matches the event card." };
  if (new Set(frozenHoles.map((hole) => hole.strokeIndex)).size !== frozenHoles.length) return { ok: false, reason: "Tournament stroke indexes must be unique across the routed card." };
  const par = frozenHoles.reduce((sum, hole) => sum + hole.par, 0);
  const handicapCourse = { courseRating: qualification.rating, slopeRating: qualification.slope, par };
  const competitionHoles = frozenHoles.map((hole) => ({ id: hole.id, par: hole.par, strokeIndex: hole.strokeIndex }));
  const baseEntrants = event.field.map((entrant) => {
    const handicapIndex = Number.isFinite(entrant.handicapIndex) ? Math.max(-10, Math.min(54, entrant.handicapIndex!)) : Math.max(-10, Math.min(54, (1 - entrant.skill) * 36));
    const unrounded = courseHandicapUnrounded(handicapIndex, handicapCourse);
    return { source: entrant, handicapIndex, unrounded };
  });
  let entrants: TournamentActivationSnapshot["entrants"];
  let teams: TournamentActivationSnapshot["teams"];
  let teamHandicaps: TournamentActivationSnapshot["teamHandicaps"];
  if (!template || teamFormat === "individual") {
    if (template && baseEntrants.some(({ source }) => source.teamRole !== "individual" || source.teamCaptain !== true)) return { ok: false, reason: "Individual template entrants must each captain their own team." };
    const allowance = scoringMode === "gross-stroke" ? 0 : 1;
    entrants = baseEntrants.map(({ source, handicapIndex, unrounded }) => {
      const playingHandicap = playingHandicapFromUnrounded(unrounded, allowance).rounded;
      return { entrantId: source.id, name: source.name, archetype: source.archetype, skill: source.skill, teamId: source.teamId ?? `individual:${source.id}`, ...(template ? { teamRole: source.teamRole ?? "individual" as const, teamOrder: 0, teamCaptain: true } : {}), handicapIndex, allowance, courseHandicapUnrounded: unrounded, playingHandicap, strokesByHole: strokesByHole(playingHandicap, competitionHoles) };
    });
    teams = entrants.map((entrant) => ({ id: entrant.teamId, entrantIds: [entrant.entrantId], ...(template ? { roles: [entrant.teamRole ?? "individual" as const], captainId: entrant.entrantId } : {}) }));
    if (new Set(teams.map((team) => team.id)).size !== teams.length) return { ok: false, reason: "Individual entrants require distinct team identities." };
  } else {
    const grouped = new Map<string, typeof baseEntrants>();
    for (const entrant of baseEntrants) {
      if (!entrant.source.teamId) return { ok: false, reason: "Every team entrant requires a frozen team identity." };
      grouped.set(entrant.source.teamId, [...(grouped.get(entrant.source.teamId) ?? []), entrant]);
    }
    const groups = [...grouped.entries()];
    const expectedTeams = template.rules.teamCount;
    if ((expectedTeams !== "field" && groups.length !== expectedTeams) || groups.some(([, members]) => members.length !== template.rules.teamSize)) return { ok: false, reason: `${template.label} requires ${expectedTeams === "field" ? "complete" : expectedTeams} teams of ${template.rules.teamSize}.` };
    if (groups.some(([, members]) => members.some((member, index) => member.source.teamRole !== template.rules.roles[index]))) return { ok: false, reason: `${template.label} entrant roles must match the frozen template order.` };
    if (groups.some(([, members]) => members.filter((member) => member.source.teamCaptain === true).length !== 1 || members[0].source.teamCaptain !== true)) return { ok: false, reason: `${template.label} requires its first rostered entrant to be the unique team captain.` };
    teams = groups.map(([id, members]) => ({ id, entrantIds: members.map((member) => member.source.id), roles: members.map((member) => member.source.teamRole!), captainId: members[0].source.id }));
    if (teamFormat === "pro-am") {
      entrants = groups.flatMap(([, members]) => members.map(({ source, handicapIndex, unrounded }, teamOrder) => {
        const allowance = PRO_AM_MEMBER_ALLOWANCE;
        const playingHandicap = playingHandicapFromUnrounded(unrounded, allowance).rounded;
        return { entrantId: source.id, name: source.name, archetype: source.archetype, skill: source.skill, teamId: source.teamId!, teamRole: source.teamRole!, teamOrder, teamCaptain: source.teamCaptain === true, handicapIndex, allowance, courseHandicapUnrounded: unrounded, playingHandicap, strokesByHole: strokesByHole(playingHandicap, competitionHoles) };
      }));
    } else {
      const authorityTeams: CompetitionTeam[] = teams.map((team) => ({ id: team.id, playerIds: team.entrantIds }));
      teamHandicaps = captureTeamHandicapSnapshots(authorityTeams, baseEntrants.map(({ source, handicapIndex }) => ({ id: source.id, handicapIndex })), teamFormat, "stroke", handicapCourse, competitionHoles);
      const memberById = new Map(teamHandicaps.flatMap((snapshot) => snapshot.members).map((member) => [member.playerId, member]));
      entrants = groups.flatMap(([, members]) => members.map(({ source }, teamOrder) => {
        const member = memberById.get(source.id)!;
        return { entrantId: source.id, name: source.name, archetype: source.archetype, skill: source.skill, teamId: source.teamId!, teamRole: source.teamRole!, teamOrder, teamCaptain: source.teamCaptain === true, handicapIndex: member.handicapIndex, allowance: member.allowance, courseHandicapUnrounded: member.courseHandicapUnrounded, playingHandicap: member.playingHandicap, strokesByHole: member.strokesByHole };
      }));
    }
  }
  const legacy = !template && teamFormat === "individual";
  const activationSnapshot: TournamentActivationSnapshot = freeze({ version: legacy ? 1 : 2, activationId: `${event.id}:activation:${week}:${day}`, activatedWeek: week, activatedDay: day, scoringMode, teamFormat, courseId: layout.id, courseName: event.courseName ?? host.name, rating: qualification.rating, slope: qualification.slope, par, teeSet, pinRotation, holes: frozenHoles, entrants, teams, ...(!legacy && template ? { templateId: template.id, roundCount, supportedOverrides: template.supportedOverrides, appliedOverrides: Object.fromEntries(template.supportedOverrides.map((override) => [override, override === "scoringMode" ? scoringMode : override === "roundCount" ? roundCount : override === "teeSet" ? teeSet : pinRotation])), formatRules: template.rules, ...(teamHandicaps ? { teamHandicaps } : {}) } : {}) });
  return { ok: true, snapshot: activationSnapshot, qualification };
}

/** Freezes the event contract exactly once from the same authority exposed by preview. */
export function activateTournament(event: TournamentEvent, course: Course, week = event.scheduledWeek, day = event.scheduledDay): TournamentActivationResult {
  if (event.status === "active" && event.activationSnapshot) return { ok: true, event };
  const preview = previewTournamentActivation(event, course, week, day);
  if (!preview.ok) return preview;
  const activationSnapshot = preview.snapshot;
  const { qualification } = preview;
  const roundCount = activationSnapshot.roundCount ?? Math.floor(event.roundCount ?? TOURNAMENT_LIFECYCLE_DEFAULTS[event.tier].roundCount);
  const { scoringMode, teamFormat, teeSet, pinRotation } = activationSnapshot;
  const layoutId = activationSnapshot.courseId;
  const courseName = activationSnapshot.courseName;
  const rounds = roundSchedule({ ...event, roundCount }).map((round, index) => index === 0 ? { ...round, status: "active" as const } : round);
  const field = activationSnapshot.version === 2 ? event.field.map((entrant, index) => ({ ...entrant, handicapIndex: activationSnapshot.entrants[index].handicapIndex })) : event.field;
  return { ok: true, event: { ...event, status: "active", scoringMode, teamFormat, roundCount, currentRound: 1, rounds, activationSnapshot, courseId: layoutId, courseName, holeIds: activationSnapshot.holes.map((hole) => hole.id), field, teeSet, pinRotation, qualificationSnapshot: event.qualificationSnapshot ?? qualification, currentQualification: qualification, warning: undefined } };
}

export function scoreTournamentRoundCard(event: TournamentEvent, entrantId: string, grossByHole: readonly number[], penalties = 0): TournamentRoundScorecard | null {
  const snapshot = event.activationSnapshot;
  const entrant = snapshot?.entrants.find((candidate) => candidate.entrantId === entrantId);
  if (!snapshot || !entrant || !Array.isArray(grossByHole) || grossByHole.length !== snapshot.holes.length
    || grossByHole.some((score) => !Number.isSafeInteger(score) || score <= 0) || !Number.isSafeInteger(penalties) || penalties < 0) return null;
  try {
    const scored = scoreStrokePlay({ id: entrantId, playingHandicap: entrant.playingHandicap, holeScores: grossByHole.map((gross) => ({ playerId: entrantId, gross, status: "played" as const })) }, snapshot.holes);
    if (![scored.gross, scored.net, scored.stableford].every(Number.isSafeInteger)) return null;
    return { entrantId, status: "completed", grossByHole: [...grossByHole], penalties, grossTotal: scored.gross, netTotal: scored.net, stablefordPoints: scored.stableford };
  } catch {
    return null;
  }
}

export function completeTournamentRoundEvidence(event: TournamentEvent, scorecards: readonly TournamentRoundScorecard[], completionId = `${event.id}:round:${event.currentRound ?? 1}`): { ok: true; event: TournamentEvent; finalRound: boolean } | { ok: false; reason: string } {
  if (event.rounds?.some((round) => round.completionId === completionId)) return { ok: true, event, finalRound: event.status === "completed" };
  if (event.status === "completed" && event.activationSnapshot && event.rounds?.every((round) => round.status === "completed")) return { ok: true, event, finalRound: true };
  if (event.status !== "active" || !event.activationSnapshot || !event.rounds) return { ok: false, reason: "Tournament is not active." };
  if (event.activationSnapshot.teamFormat !== "individual" && event.activationSnapshot.teamFormat !== "pro-am") return { ok: false, reason: "Team standings require the deferred tournament team-round scorer." };
  const roundNumber = event.currentRound ?? 1;
  const current = event.rounds.find((round) => round.roundNumber === roundNumber);
  if (current?.status !== "active") return { ok: false, reason: "Current tournament round is not playable." };
  const expected = new Set(event.activationSnapshot.entrants.map((entrant) => entrant.entrantId));
  const locked = new Map(current.scorecards.filter((card) => card.status === "withdrawn").map((card) => [card.entrantId, card]));
  if (new Set(scorecards.map((card) => card.entrantId)).size !== scorecards.length || scorecards.some((card) => !expected.has(card.entrantId) || locked.has(card.entrantId))) return { ok: false, reason: "Every frozen entrant requires exactly one immutable round scorecard." };
  const supplied = new Map(scorecards.map((card) => [card.entrantId, card]));
  const authoritative = event.activationSnapshot.entrants.map((entrant) => {
    const withdrawn = locked.get(entrant.entrantId);
    if (withdrawn) return withdrawn;
    const card = supplied.get(entrant.entrantId);
    if (!card) return null;
    if (card.status === "withdrawn") return card.grossByHole.length === 0 && card.grossTotal === 0 ? { entrantId: card.entrantId, status: "withdrawn" as const, grossByHole: [], penalties: 0, grossTotal: 0 } : null;
    return scoreTournamentRoundCard(event, card.entrantId, card.grossByHole, card.penalties);
  });
  if (authoritative.some((card) => !card)) return { ok: false, reason: "Completed scorecards require authoritative individual gross evidence for every frozen entrant." };
  const withdrawals = (authoritative as TournamentRoundScorecard[]).filter((card) => card.status === "withdrawn");
  const rounds = event.rounds.map((round) => {
    if (round.roundNumber === roundNumber) return { ...round, status: "completed" as const, scorecards: authoritative as TournamentRoundScorecard[], completionId };
    if (round.roundNumber < roundNumber) return round;
    const scorecards = [...round.scorecards, ...withdrawals.filter((withdrawn) => !round.scorecards.some((card) => card.entrantId === withdrawn.entrantId))];
    return { ...round, status: round.roundNumber === roundNumber + 1 ? "active" as const : round.status, scorecards };
  });
  const finalRound = roundNumber >= (event.roundCount ?? 1);
  const advanced: TournamentEvent = { ...event, rounds, currentRound: finalRound ? roundNumber : roundNumber + 1, status: finalRound ? "completed" : "active" };
  if (event.activationSnapshot.teamFormat === "pro-am") {
    const currentEvidence = scoreProAmRoundEvidence(event.activationSnapshot, roundNumber, authoritative as TournamentRoundScorecard[]);
    if (!currentEvidence.ok) return currentEvidence;
    const reconstructed = reconstructProAmTournamentEvidence(advanced);
    if (!reconstructed.ok) return reconstructed;
    advanced.teamStandings = projectProAmTeamStandings(reconstructed.evidence, finalRound);
    delete advanced.winnerTeamIds;
    if (finalRound && reconstructed.evidence.winnerTeamIds.length) advanced.winnerTeamIds = [...reconstructed.evidence.winnerTeamIds];
    delete advanced.results;
    delete advanced.winnerNames;
    delete advanced.winnerName;
  } else {
    const reconstructed = reconstructIndividualTournamentStandings(advanced);
    if (!reconstructed.ok) return reconstructed;
    advanced.results = reconstructed.results;
    delete advanced.winnerNames;
    delete advanced.winnerName;
    if (finalRound && reconstructed.winnerNames.length) {
      advanced.winnerNames = [...reconstructed.winnerNames];
      advanced.winnerName = reconstructed.winnerNames[0];
    }
  }
  return { ok: true, event: advanced, finalRound };
}

function changeRound(world: World, eventId: string, from: "active" | "interrupted", to: "active" | "interrupted"): World {
  const calendar = tournamentCalendar(world);
  const event = calendar.events.find((candidate) => candidate.id === eventId);
  if (!event || event.status !== "active") return world;
  let changed = false;
  const rounds = event.rounds?.map((round) => {
    if (round.roundNumber !== (event.currentRound ?? 1) || round.status !== from) return round;
    changed = true;
    return { ...round, status: to };
  });
  return !rounds || !changed ? world : { ...world, tournaments: { version: 2, events: calendar.events.map((candidate) => candidate.id === eventId ? { ...event, rounds } : candidate) } };
}

export const interruptTournamentRound = (world: World, eventId: string) => changeRound(world, eventId, "active", "interrupted");
export const resumeTournamentRound = (world: World, eventId: string) => changeRound(world, eventId, "interrupted", "active");

export function withdrawTournamentEntrant(world: World, eventId: string, entrantId: string): World {
  const calendar = tournamentCalendar(world);
  const event = calendar.events.find((candidate) => candidate.id === eventId);
  if (!event?.activationSnapshot || event.status !== "active" || !event.activationSnapshot.entrants.some((entrant) => entrant.entrantId === entrantId)) return world;
  let changed = false;
  const rounds = event.rounds?.map((round) => {
    if (round.roundNumber !== (event.currentRound ?? 1) || round.scorecards.some((card) => card.entrantId === entrantId)) return round;
    changed = true;
    return { ...round, scorecards: [...round.scorecards, { entrantId, status: "withdrawn" as const, grossByHole: [], penalties: 0, grossTotal: 0 }] };
  });
  return !rounds || !changed ? world : { ...world, tournaments: { version: 2, events: calendar.events.map((candidate) => candidate.id === eventId ? { ...event, rounds } : candidate) } };
}
