import type { Course, PinRotation, TeeSet, World } from "../models/types";
import type { RegularGolfer } from "../livingClub/types";
import { emptyLivingClubState, normalizeLivingClub } from "../livingClub/livingClub";
import { activeCourseLayout, courseForLayout, layoutById } from "../models/courseLayouts";
import { resolveCourseSetup } from "../models/courseSetup";
import {
  captureTeamHandicapSnapshots,
  type ChallengeTeamFormat,
  type ChallengeTeamScoring,
  type TeamHandicapSnapshot,
} from "../competition/teamAuthority";
import type { CompetitionHole, CompetitionTeam, HandicapCourse } from "../competition/types";
import { applyInvitationConfidence } from "./confidence";

const MAX_INVITATIONS = 40;
const MAX_LEDGER = 160;
/** Detailed evidence must outlive every idempotency key it explains. */
const MAX_HISTORY = MAX_LEDGER;

export type InvitationSource = "organic" | "campaign" | "tournament";
export type InvitationStatus = "proposed" | "accepted" | "declined" | "completed" | "cancelled";
export type InvitationEvidenceKind = "accepted" | "completed" | "rematch" | "mentor" | "story";

export interface InvitationContextOverride {
  source: Exclude<InvitationSource, "organic">;
  id: string;
  /** Authored candidates are ranked ahead of organic suggestions, never silently accepted. */
  personIds: readonly string[];
  title: string;
}

export interface InvitationCandidate {
  personId: string;
  name: string;
  rank: number;
  available: boolean;
  relationship: number;
  rematches: number;
  reasons: readonly string[];
  source: InvitationSource;
  overrideId?: string;
}

export interface InvitationSchedule {
  week: number;
  day: number;
  courseId?: string;
  teeSet: TeeSet;
  pinRotation: PinRotation;
}

export interface PlayerInvitationRecord {
  id: string;
  personId: string;
  personName: string;
  source: InvitationSource;
  overrideId?: string;
  title: string;
  status: InvitationStatus;
  schedule: InvitationSchedule;
  createdWeek: number;
  createdDay: number;
}

export interface InvitationHistoryRecord {
  id: string;
  invitationId: string;
  personId: string;
  kind: InvitationEvidenceKind;
  week: number;
  day: number;
  evidenceId: string;
  relationshipDelta: number;
  confidenceDelta: number;
  mentorSkill?: string;
  storyFact?: string;
}

export interface PlayerInvitationCalendar {
  version: 1;
  invitations: readonly PlayerInvitationRecord[];
  history: readonly InvitationHistoryRecord[];
  settlementLedger: readonly string[];
}

export interface TeamBuilderDraft {
  id: string;
  format: ChallengeTeamFormat;
  scoring: ChallengeTeamScoring;
  teams: readonly CompetitionTeam[];
  /** Mutable planning data: it is intentionally not a round snapshot. */
  playerHandicaps: readonly { id: string; handicapIndex: number }[];
}

export interface TeamBuilderPreview {
  draftId: string;
  frozen: false;
  allowances: readonly TeamHandicapSnapshot[];
}

export interface FrozenTeamBuilder {
  draftId: string;
  frozen: true;
  startedWeek: number;
  startedDay: number;
  allowances: readonly TeamHandicapSnapshot[];
}

declare module "../models/playerProTypes" {
  interface PlayerProCareer {
    invitationCalendar: PlayerInvitationCalendar;
  }
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const integer = (value: number, fallback = 0) => Number.isFinite(value) ? Math.floor(value) : fallback;
const freeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(freeze);
  }
  return value;
};

export function createInvitationCalendar(): PlayerInvitationCalendar {
  return { version: 1, invitations: [], history: [], settlementLedger: [] };
}

function normalizeSchedule(value: unknown): InvitationSchedule | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<InvitationSchedule>;
  if (!Number.isFinite(candidate.week) || !Number.isFinite(candidate.day)) return null;
  return {
    week: Math.max(1, integer(candidate.week ?? 1)),
    day: clamp(integer(candidate.day ?? 0), 0, 6),
    courseId: typeof candidate.courseId === "string" && candidate.courseId ? candidate.courseId : undefined,
    teeSet: candidate.teeSet === "forward" || candidate.teeSet === "championship" ? candidate.teeSet : "member",
    pinRotation: candidate.pinRotation === "B" || candidate.pinRotation === "C" ? candidate.pinRotation : "A",
  };
}

export function normalizeInvitationCalendar(raw: unknown): PlayerInvitationCalendar {
  const fallback = createInvitationCalendar();
  if (!raw || typeof raw !== "object") return fallback;
  const candidate = raw as Partial<PlayerInvitationCalendar>;
  const invitations = Array.isArray(candidate.invitations) ? candidate.invitations.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const record = value as Partial<PlayerInvitationRecord>;
    const schedule = normalizeSchedule(record.schedule);
    if (!schedule || typeof record.id !== "string" || !record.id || typeof record.personId !== "string" || !record.personId || typeof record.personName !== "string") return [];
    const source: InvitationSource = record.source === "campaign" || record.source === "tournament" ? record.source : "organic";
    const status: InvitationStatus = ["proposed", "accepted", "declined", "completed", "cancelled"].includes(record.status as string)
      ? record.status as InvitationStatus : "proposed";
    return [{
      id: record.id,
      personId: record.personId,
      personName: record.personName.slice(0, 60),
      source,
      overrideId: typeof record.overrideId === "string" ? record.overrideId : undefined,
      title: typeof record.title === "string" && record.title.trim() ? record.title.trim().slice(0, 100) : "Player invitation",
      status,
      schedule,
      createdWeek: Math.max(1, integer(record.createdWeek ?? 1, 1)),
      createdDay: clamp(integer(record.createdDay ?? 0, 0), 0, 6),
    }];
  }).slice(-MAX_INVITATIONS) : [];
  const history = Array.isArray(candidate.history) ? candidate.history.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const record = value as Partial<InvitationHistoryRecord>;
    if (typeof record.id !== "string" || typeof record.invitationId !== "string" || typeof record.personId !== "string" || typeof record.evidenceId !== "string") return [];
    if (!["accepted", "completed", "rematch", "mentor", "story"].includes(record.kind as string)) return [];
    return [{
      id: record.id,
      invitationId: record.invitationId,
      personId: record.personId,
      kind: record.kind as InvitationEvidenceKind,
      week: Math.max(1, integer(record.week ?? 1, 1)),
      day: clamp(integer(record.day ?? 0, 0), 0, 6),
      evidenceId: record.evidenceId,
      relationshipDelta: clamp(Number.isFinite(record.relationshipDelta) ? Math.round(record.relationshipDelta!) : 0, -12, 12),
      confidenceDelta: clamp(Number.isFinite(record.confidenceDelta) ? Math.round(record.confidenceDelta!) : 0, -8, 8),
      mentorSkill: typeof record.mentorSkill === "string" ? record.mentorSkill.slice(0, 40) : undefined,
      storyFact: typeof record.storyFact === "string" ? record.storyFact.slice(0, 100) : undefined,
    }];
  }).slice(-MAX_HISTORY) : [];
  return {
    version: 1,
    invitations,
    history,
    settlementLedger: Array.isArray(candidate.settlementLedger)
      ? candidate.settlementLedger.filter((entry): entry is string => typeof entry === "string").slice(-MAX_LEDGER)
      : [],
  };
}

function competitionHistory(world: World, personId: string): number {
  return world.playerPro?.rounds.filter((round) => round.opponentId === personId).length ?? 0;
}

function preferredPartnerBonus(person: RegularGolfer, playerId: string): number {
  return Array.isArray(person.backstory?.preferredPartners) && person.backstory.preferredPartners.includes(playerId) ? 8 : 0;
}

function availabilityFor(world: World, person: RegularGolfer, schedule: InvitationSchedule): { available: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const scheduledTournament = world.tournaments?.events.find((event) => event.status === "scheduled" && event.scheduledWeek === schedule.week && event.scheduledDay === schedule.day);
  if (scheduledTournament) reasons.push(`Tournament ${scheduledTournament.name} already occupies this date.`);
  if (person.history.some((visit) => visit.week === schedule.week && visit.day === schedule.day)) reasons.push(`${person.name} already has a recorded visit on this date.`);
  if (schedule.week < world.week || (schedule.week === world.week && schedule.day < 0)) reasons.push("The requested date is in the past.");
  return { available: reasons.length === 0, reasons };
}

/** Deterministic, inspectable ranking from person preferences, availability, relationship, and proven shared history. */
export function rankInvitationCandidates(args: {
  world: World;
  schedule: InvitationSchedule;
  override?: InvitationContextOverride;
}): readonly InvitationCandidate[] {
  const playerId = args.world.playerPro?.identity.id ?? "player-pro";
  const overrideIds = new Set(args.override?.personIds ?? []);
  const regulars = normalizeLivingClub(args.world.livingClub).regulars;
  return regulars.map((person) => {
    const availability = availabilityFor(args.world, person, args.schedule);
    const rematches = competitionHistory(args.world, person.id);
    const preference = (person.preferences.challenge === "competitive" ? 7 : person.preferences.challenge === "balanced" ? 4 : 2)
      + (person.preferences.pace === "balanced" ? 3 : person.preferences.pace === "relaxed" ? 1 : 2)
      + (person.backstory?.competitiveTemperament === "social" ? 1 : 3);
    const authored = overrideIds.has(person.id);
    const rank = (availability.available ? 20 : -1_000)
      + person.relationship.score * 2
      + Math.round(person.loyalty / 8)
      + rematches * 6
      + preference
      + preferredPartnerBonus(person, playerId)
      + (authored ? 1_000 : 0);
    const reasons = [
      `Relationship ${person.relationship.score >= 0 ? "+" : ""}${person.relationship.score}.`,
      `${person.preferences.challenge} competition preference.`,
      rematches ? `${rematches} recorded rematch${rematches === 1 ? "" : "es"}.` : "No recorded rematch yet.",
      ...(authored ? [`Authored ${args.override!.source} invitation: ${args.override!.title}.`] : []),
      ...availability.reasons,
    ];
    return {
      personId: person.id,
      name: person.name,
      rank,
      available: availability.available,
      relationship: person.relationship.score,
      rematches,
      reasons,
      source: authored ? args.override!.source : "organic" as const,
      overrideId: authored ? args.override!.id : undefined,
    };
  }).sort((a, b) => Number(b.available) - Number(a.available) || b.rank - a.rank || a.personId.localeCompare(b.personId));
}

/** Explains every scheduling and course-setup problem before an invitation may be accepted. */
export function validateInvitationSchedule(args: { course: Course; world: World; schedule: InvitationSchedule }): readonly string[] {
  const issues: string[] = [];
  const { schedule } = args;
  if (schedule.week < args.world.week) issues.push("Choose a current or future week.");
  if (!Number.isInteger(schedule.day) || schedule.day < 0 || schedule.day > 6) issues.push("Choose a valid day of the week.");
  if (args.world.playerPro?.activeRound || args.world.playerPro?.activeChallengeGroupRound) issues.push("Finish the active Player Pro round before accepting another invitation.");
  const tournament = args.world.tournaments?.events.find((event) => event.status === "scheduled" && event.scheduledWeek === schedule.week && event.scheduledDay === schedule.day);
  if (tournament) issues.push(`Tournament ${tournament.name} is already scheduled for this date.`);
  const layout = schedule.courseId ? layoutById(args.course, schedule.courseId) : activeCourseLayout(args.course);
  if (!layout) issues.push("Choose an existing course layout.");
  else if (layout.state !== "open") issues.push(`${layout.name} is closed and cannot host this invitation.`);
  else {
    const host = courseForLayout(args.course, layout.id);
    if (host.holes.length !== 9 && host.holes.length !== 18) issues.push(`${layout.name} needs a published 9- or 18-hole route.`);
    host.holes.forEach((hole, index) => {
      const setup = resolveCourseSetup(hole, schedule.teeSet, schedule.pinRotation);
      if (!setup.tee || !setup.pin) issues.push(`Hole ${index + 1} is missing a playable tee or pin.`);
    });
  }
  return [...new Set(issues)];
}

export function acceptInvitation(args: {
  course: Course;
  world: World;
  invitationId: string;
  candidate: InvitationCandidate;
  schedule: InvitationSchedule;
}): { ok: true; world: World; invitation: PlayerInvitationRecord } | { ok: false; reasons: readonly string[] } {
  const career = args.world.playerPro;
  if (!career) return { ok: false, reasons: ["Create a Player Pro before accepting invitations."] };
  const issues = [...validateInvitationSchedule({ course: args.course, world: args.world, schedule: args.schedule })];
  const person = normalizeLivingClub(args.world.livingClub).regulars.find((entry) => entry.id === args.candidate.personId);
  if (!person) issues.push("This invitation candidate is no longer available in the club roster.");
  else {
    const availability = availabilityFor(args.world, person, args.schedule);
    if (!args.candidate.available || !availability.available) {
      issues.push(...availability.reasons, "This person is unavailable for the requested date.");
    }
  }
  if (issues.length) return { ok: false, reasons: [...new Set(issues)] };
  const calendar = normalizeInvitationCalendar(career.invitationCalendar);
  const existing = calendar.invitations.find((entry) => entry.id === args.invitationId);
  if (existing) return { ok: true, world: args.world, invitation: existing };
  const invitation: PlayerInvitationRecord = {
    id: args.invitationId,
    personId: args.candidate.personId,
    personName: args.candidate.name,
    source: args.candidate.source,
    overrideId: args.candidate.overrideId,
    title: args.candidate.source === "organic" ? `Round with ${args.candidate.name}` : args.candidate.reasons.find((reason) => reason.startsWith("Authored ")) ?? `Round with ${args.candidate.name}`,
    status: "accepted",
    schedule: args.schedule,
    createdWeek: args.world.week,
    createdDay: 0,
  };
  return { ok: true, invitation, world: { ...args.world, playerPro: { ...career, invitationCalendar: { ...calendar, invitations: [...calendar.invitations, invitation].slice(-MAX_INVITATIONS) } } } };
}

function relationshipTier(score: number, rounds: number): RegularGolfer["relationship"]["tier"] {
  if (rounds >= 12 && score >= 60) return "clubIcon";
  if (score <= -15) return "rival";
  if (score >= 25) return "friend";
  if (score >= 5) return "acquaintance";
  return "new";
}

/** Applies only an evidence-backed social outcome. It never transfers, escrows, or deletes property. */
export function applyInvitationEvidence(args: {
  world: World;
  invitationId: string;
  evidenceId: string;
  kind: InvitationEvidenceKind;
  relationshipDelta?: number;
  confidenceDelta?: number;
  mentorSkill?: string;
  storyFact?: string;
}): { ok: true; world: World; history: InvitationHistoryRecord } | { ok: false; reason: string } {
  const career = args.world.playerPro;
  if (!career) return { ok: false, reason: "Create a Player Pro before recording invitation evidence." };
  const calendar = normalizeInvitationCalendar(career.invitationCalendar);
  const invitation = calendar.invitations.find((entry) => entry.id === args.invitationId);
  if (!invitation) return { ok: false, reason: "Invitation not found." };
  const ledgerId = `invitation:${args.invitationId}:${args.evidenceId}`;
  const previous = calendar.history.find((entry) => entry.evidenceId === args.evidenceId && entry.invitationId === args.invitationId);
  if (calendar.settlementLedger.includes(ledgerId) && previous) return { ok: true, world: args.world, history: previous };
  // Pre-ZK-729 saves or an older bounded history may retain a ledger key after
  // its detail was evicted. The key still proves the effect was settled, so a
  // retry must remain a successful no-op rather than invite a second effect.
  if (calendar.settlementLedger.includes(ledgerId)) return {
    ok: true,
    world: args.world,
    history: {
      id: `invitation-history:${args.invitationId}:${args.evidenceId}`,
      invitationId: args.invitationId,
      personId: invitation.personId,
      kind: args.kind,
      week: args.world.week,
      day: invitation.schedule.day,
      evidenceId: args.evidenceId,
      relationshipDelta: 0,
      confidenceDelta: 0,
    },
  };
  const relationshipDelta = clamp(Math.round(args.relationshipDelta ?? (args.kind === "completed" ? 3 : args.kind === "mentor" ? 2 : 1)), -12, 12);
  const confidenceDelta = clamp(Math.round(args.confidenceDelta ?? (args.kind === "completed" ? 2 : 0)), -8, 8);
  const history: InvitationHistoryRecord = {
    id: `invitation-history:${args.invitationId}:${args.evidenceId}`,
    invitationId: args.invitationId,
    personId: invitation.personId,
    kind: args.kind,
    week: args.world.week,
    day: invitation.schedule.day,
    evidenceId: args.evidenceId,
    relationshipDelta,
    confidenceDelta,
    mentorSkill: args.mentorSkill?.slice(0, 40),
    storyFact: args.storyFact?.slice(0, 100),
  };
  const living = args.world.livingClub ? normalizeLivingClub(args.world.livingClub) : emptyLivingClubState();
  const regulars = living.regulars.map((person) => {
    if (person.id !== invitation.personId) return person;
    const score = clamp(person.relationship.score + relationshipDelta, -100, 100);
    return {
      ...person,
      relationship: {
        score,
        tier: relationshipTier(score, person.rounds),
        interactionIds: [...person.relationship.interactionIds, ledgerId].slice(-40),
      },
      memories: [...person.memories, {
        id: `memory:${ledgerId}`,
        week: args.world.week,
        kind: args.kind === "mentor" ? "relationship" as const : "round" as const,
        summary: args.storyFact ?? `Invitation ${args.kind}`,
        immutable: true,
        evidence: { eventId: args.evidenceId },
      }].slice(-16),
    };
  });
  const nextCalendar: PlayerInvitationCalendar = {
    ...calendar,
    invitations: calendar.invitations.map((entry) => entry.id === invitation.id && args.kind === "completed" ? { ...entry, status: "completed" as const } : entry),
    history: [...calendar.history, history].slice(-MAX_HISTORY),
    settlementLedger: [...calendar.settlementLedger, ledgerId].slice(-MAX_LEDGER),
  };
  const nextCareer = {
    ...career,
    confidence: applyInvitationConfidence(career.confidence, confidenceDelta),
    invitationCalendar: nextCalendar,
  };
  const campaign = args.storyFact && args.world.campaign
    ? { ...args.world.campaign, epilogueFacts: [...new Set([...args.world.campaign.epilogueFacts, args.storyFact])].slice(-80) }
    : args.world.campaign;
  return {
    ok: true,
    history,
    world: {
      ...args.world,
      playerPro: nextCareer,
      livingClub: { ...living, regulars },
      ...(campaign ? { campaign } : {}),
    },
  };
}

function allowancesFor(draft: TeamBuilderDraft, course: HandicapCourse, holes: readonly CompetitionHole[]): readonly TeamHandicapSnapshot[] {
  return captureTeamHandicapSnapshots(draft.teams, draft.playerHandicaps, draft.format, draft.scoring, course, holes);
}

/** A preview recalculates current values and does not become round authority. */
export function previewTeamBuilder(draft: TeamBuilderDraft, course: HandicapCourse, holes: readonly CompetitionHole[]): TeamBuilderPreview {
  return { draftId: draft.id, frozen: false, allowances: allowancesFor(draft, course, holes) };
}

/** The same ZK-728 API is called once more at round start, freezing the then-current handicaps. */
export function freezeTeamBuilderAtRoundStart(args: {
  draft: TeamBuilderDraft;
  course: HandicapCourse;
  holes: readonly CompetitionHole[];
  startedWeek: number;
  startedDay: number;
}): FrozenTeamBuilder {
  return freeze({
    draftId: args.draft.id,
    frozen: true,
    startedWeek: Math.max(1, integer(args.startedWeek, 1)),
    startedDay: clamp(integer(args.startedDay), 0, 6),
    allowances: allowancesFor(args.draft, args.course, args.holes),
  });
}
