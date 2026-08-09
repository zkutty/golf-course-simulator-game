import type {
  Course,
  StaffMember,
  StaffRole,
  StaffTrait,
  World,
} from "../models/types";
import type { PlayerCareerRound, PlayerPlayableRound } from "../models/playerProTypes";
import type { CompletedRound } from "../retention/types";
import { analyzeArchitecture } from "../architecture/architecture";
import { normalizeM48DesignTestSession } from "../architecture/comparison";
import { normalizeTournamentCalendar } from "../tournaments/tournaments";
import { courseForLayout } from "../models/courseLayouts";
import { STORY_DEFINITION_BY_ID, SYSTEMIC_EVENT_DEFINITIONS } from "./content";
import { lastItem } from "../../utils/array";
import { greenGeometryVersion } from "../greens/greenSurface";
import { isValidGreenRollout } from "../greens/greenRollout";
import { normalizeShotSlopeContext } from "../models/shotSlope";
import { shotSlopeExplanation } from "../models/shotSlopeEvidence";
import type {
  ArchitectureRevisionSummary,
  ArchitectureShotEvidence,
  LivingClubState,
  LivingPersonAppearance,
  PersonMemory,
  RegularCandidate,
  RegularGolfer,
  RelationshipTier,
  ReturnToDesignContext,
  ScheduledStoryCallback,
  StoryChoiceDefinition,
  StoryEffect,
  StoryEventDefinition,
  StoryEventInstance,
  StoryFactKey,
  StoryFactSnapshot,
  StoryJournalEntry,
  StoryParticipantRole,
} from "./types";

const MAX_CANDIDATES = 64;
const MAX_REGULARS = 24;
const MAX_EVIDENCE = 480;
const MAX_REVISIONS = 8;
const MAX_STORY_INSTANCES = 80;
const MAX_STORY_JOURNAL = 120;
const MAX_CALLBACKS = 24;
const MAX_MEMORIES = 16;
const MAX_VISITS = 20;
const MAX_STAFF_HISTORY = 16;
const STAFF_TRAITS: StaffTrait[] = ["steady", "meticulous", "mentor", "inventive", "warm", "frugal", "competitive", "safetyMinded"];
const STAFF_NAMES = ["Casey", "Taylor", "Drew", "Robin", "Emerson", "Quinn", "Skyler", "Cameron", "Reese", "Parker"];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;

function hashText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hashValue(hash: number, value: string | number): number {
  const text = typeof value === "number" ? Number.isFinite(value) ? value.toFixed(3) : "0" : value;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function courseGeometryVersion(course: Course): string {
  let hash = hashText(`${course.width}:${course.height}:${course.activeCourseId ?? "course"}`);
  hash = hashValue(hash, greenGeometryVersion(course));
  for (const terrain of course.tiles) hash = hashValue(hash, terrain);
  for (const elevation of course.elevations) hash = hashValue(hash, elevation);
  for (const hole of course.holes) {
    hash = hashValue(hash, hole.id ?? "");
    for (const point of [
      hole.tee,
      hole.green,
      ...(Object.values(hole.teeBoxes ?? {}).filter(Boolean)),
      ...(Object.values(hole.pinPositions ?? {}).filter(Boolean)),
      ...(hole.waypoints ?? []),
    ]) {
      if (!point) continue;
      hash = hashValue(hash, point.x);
      hash = hashValue(hash, point.y);
    }
  }
  for (const obstacle of course.obstacles) {
    hash = hashValue(hash, obstacle.type);
    hash = hashValue(hash, obstacle.x);
    hash = hashValue(hash, obstacle.y);
  }
  return `g-${hash.toString(36)}`;
}

export function snapshotGeometryVersion(snapshot: PlayerPlayableRound["course"]): string {
  if (typeof snapshot.geometryVersion === "string" && snapshot.geometryVersion.startsWith("g-")) return snapshot.geometryVersion;
  let hash = hashText(`${snapshot.width}:${snapshot.height}:${snapshot.courseId}`);
  hash = hashValue(hash, snapshot.greenSnapshot?.geometryVersion ?? greenGeometryVersion(snapshot));
  for (const terrain of snapshot.tiles) hash = hashValue(hash, terrain);
  for (const elevation of snapshot.elevations) hash = hashValue(hash, elevation);
  for (const hole of snapshot.holes) {
    hash = hashValue(hash, hole.id);
    for (const point of [hole.tee, hole.pin, ...hole.waypoints]) {
      hash = hashValue(hash, point.x);
      hash = hashValue(hash, point.y);
    }
  }
  for (const obstacle of snapshot.obstacles) {
    hash = hashValue(hash, obstacle.type);
    hash = hashValue(hash, obstacle.x);
    hash = hashValue(hash, obstacle.y);
  }
  return `g-${hash.toString(36)}`;
}

function relationshipTier(score: number, rounds: number): RelationshipTier {
  if (rounds >= 12 && score >= 60) return "clubIcon";
  if (score <= -15) return "rival";
  if (score >= 25) return "friend";
  if (score >= 5) return "acquaintance";
  return "new";
}

function appearanceFor(id: string, staff = false): LivingPersonAppearance {
  const seed = hashText(id);
  return {
    portrait: staff
      ? (seed % 2 ? "workwear" : "formal")
      : (["cap", "visor", "heritage", "sport"] as const)[seed % 4],
    palette: seed % 6,
    accent: Math.floor(seed / 7) % 6,
  };
}

function emptyStoryState(): LivingClubState["story"] {
  return {
    instances: [],
    callbacks: [],
    journal: [],
    cooldownUntil: {},
    chainStage: {},
    settlementLedger: [],
  };
}

export function emptyLivingClubState(): LivingClubState {
  return {
    version: 1,
    sequence: 1,
    candidates: [],
    regulars: [],
    story: emptyStoryState(),
    architecture: { evidence: [], revisions: [], returnContext: null, testSession: null, comparison: null },
  };
}

function normalizeMemory(raw: unknown): PersonMemory | null {
  if (!raw || typeof raw !== "object") return null;
  const memory = raw as PersonMemory;
  if (!memory.id || !memory.summary) return null;
  return {
    ...memory,
    week: Math.max(1, Math.floor(finite(memory.week, 1))),
    immutable: true,
    evidence: memory.evidence && typeof memory.evidence === "object" ? memory.evidence : undefined,
  };
}

function normalizeRegular(raw: unknown): RegularGolfer | null {
  if (!raw || typeof raw !== "object") return null;
  const regular = raw as RegularGolfer;
  if (!regular.id || !regular.name) return null;
  const score = clamp(finite(regular.relationship?.score), -100, 100);
  const rounds = Math.max(0, Math.floor(finite(regular.rounds)));
  return {
    ...regular,
    kind: "regular",
    appearance: regular.appearance ?? appearanceFor(regular.id),
    skill: clamp(finite(regular.skill, 0.5), 0, 1),
    loyalty: clamp(finite(regular.loyalty, 50), 0, 100),
    visits: Math.max(rounds, Math.floor(finite(regular.visits, rounds))),
    rounds,
    bestToPar: Math.floor(finite(regular.bestToPar, 99)),
    member: regular.member === true,
    preferences: regular.preferences ?? { pace: "balanced", challenge: "balanced", hospitality: "club" },
    relationship: {
      score,
      tier: relationshipTier(score, rounds),
      interactionIds: Array.isArray(regular.relationship?.interactionIds)
        ? regular.relationship.interactionIds.filter((item): item is string => typeof item === "string").slice(-40)
        : [],
    },
    memories: Array.isArray(regular.memories)
      ? regular.memories.map(normalizeMemory).filter((item): item is PersonMemory => item != null).slice(-MAX_MEMORIES)
      : [],
    recentThoughts: Array.isArray(regular.recentThoughts)
      ? regular.recentThoughts.filter((item): item is string => typeof item === "string").slice(-4)
      : [],
    history: Array.isArray(regular.history) ? regular.history.slice(-MAX_VISITS) : [],
  };
}

function normalizeCandidate(raw: unknown): RegularCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as RegularCandidate;
  if (!candidate.key || !candidate.name) return null;
  return {
    ...candidate,
    visits: Math.max(1, Math.floor(finite(candidate.visits, 1))),
    firstWeek: Math.max(1, Math.floor(finite(candidate.firstWeek, 1))),
    lastWeek: Math.max(1, Math.floor(finite(candidate.lastWeek, 1))),
    lastDay: clamp(Math.floor(finite(candidate.lastDay)), 0, 6),
    loyalty: clamp(finite(candidate.loyalty, 50), 0, 100),
    bestToPar: Math.floor(finite(candidate.bestToPar, 99)),
    courseIds: Array.isArray(candidate.courseIds)
      ? [...new Set(candidate.courseIds.filter((item): item is string => typeof item === "string"))].slice(-6)
      : [],
  };
}

function normalizeStoryInstance(raw: unknown): StoryEventInstance | null {
  if (!raw || typeof raw !== "object") return null;
  const instance = raw as StoryEventInstance;
  const definition = STORY_DEFINITION_BY_ID.get(instance.definitionId);
  if (!definition || !instance.id) return null;
  return {
    ...instance,
    week: Math.max(1, Math.floor(finite(instance.week, 1))),
    day: clamp(Math.floor(finite(instance.day)), 0, 6),
    priority: definition.priority,
    category: definition.category,
    participantIds: Array.isArray(instance.participantIds) ? instance.participantIds.filter((item): item is string => typeof item === "string").slice(0, 4) : [],
    status: ["pending", "presented", "deferred", "resolved", "expired"].includes(instance.status) ? instance.status : "resolved",
    expiresWeek: Math.max(1, Math.floor(finite(instance.expiresWeek, instance.week + definition.expiresAfterWeeks))),
    resolution: instance.resolution === "chosen" || instance.resolution === "default" || instance.resolution === "expired" ? instance.resolution : null,
    facts: instance.facts && typeof instance.facts === "object" ? instance.facts : { key: instance.id, facts: {} },
  };
}

function normalizeEvidence(raw: unknown): ArchitectureShotEvidence | null {
  if (!raw || typeof raw !== "object") return null;
  const evidence = raw as ArchitectureShotEvidence;
  const validPoint = (point: unknown): point is { x: number; y: number } => {
    if (!point || typeof point !== "object") return false;
    const { x, y } = point as { x?: unknown; y?: unknown };
    return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y);
  };
  if (!evidence.id || !evidence.courseId || !evidence.holeId || !evidence.geometryVersion || !validPoint(evidence.from) || !validPoint(evidence.landing) || !validPoint(evidence.rest)) return null;
  const shotSlope = normalizeShotSlopeContext(evidence.shotSlope);
  return {
    ...evidence,
    ...(validPoint(evidence.aim) ? { aim: { ...evidence.aim } } : { aim: undefined }),
    ...(validPoint(evidence.physicalRest) ? { physicalRest: { ...evidence.physicalRest } } : { physicalRest: undefined }),
    ...(shotSlope
      ? { shotSlope, slopeExplanation: shotSlopeExplanation(shotSlope) }
      : { shotSlope: undefined, slopeExplanation: undefined }),
    ...(evidence.greenRollout && isValidGreenRollout(evidence.greenRollout) ? { greenRollout: evidence.greenRollout } : { greenRollout: undefined }),
    week: Math.max(1, Math.floor(finite(evidence.week, 1))),
    day: clamp(Math.floor(finite(evidence.day)), 0, 6),
    shotNumber: Math.max(1, Math.floor(finite(evidence.shotNumber, 1))),
    scoreToPar: Math.floor(finite(evidence.scoreToPar)),
    waitMinutes: Math.max(0, finite(evidence.waitMinutes)),
  };
}

function normalizeCallback(raw: unknown): ScheduledStoryCallback | null {
  if (!raw || typeof raw !== "object") return null;
  const callback = raw as ScheduledStoryCallback;
  if (!callback.id || !callback.sourceInstanceId || !STORY_DEFINITION_BY_ID.has(callback.eventId)) return null;
  return {
    ...callback,
    dueWeek: Math.max(1, Math.floor(finite(callback.dueWeek, 1))),
    participantIds: Array.isArray(callback.participantIds)
      ? callback.participantIds.filter((item): item is string => typeof item === "string").slice(0, 4)
      : [],
  };
}

function normalizeJournalEntry(raw: unknown): StoryJournalEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as StoryJournalEntry;
  if (!entry.id || !entry.eventInstanceId || !entry.choiceId || !STORY_DEFINITION_BY_ID.has(entry.definitionId)) return null;
  return {
    ...entry,
    week: Math.max(1, Math.floor(finite(entry.week, 1))),
    participantIds: Array.isArray(entry.participantIds)
      ? entry.participantIds.filter((item): item is string => typeof item === "string").slice(0, 4)
      : [],
    resolution: entry.resolution === "default" || entry.resolution === "expired" ? entry.resolution : "chosen",
    facts: entry.facts && typeof entry.facts === "object" ? entry.facts : { key: entry.id, facts: {} },
  };
}

function normalizeRevision(raw: unknown): ArchitectureRevisionSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const revision = raw as ArchitectureRevisionSummary;
  if (!revision.id || !revision.geometryVersion || !revision.courseId) return null;
  return {
    ...revision,
    firstWeek: Math.max(1, Math.floor(finite(revision.firstWeek, 1))),
    lastWeek: Math.max(1, Math.floor(finite(revision.lastWeek, 1))),
    rounds: Math.max(0, Math.floor(finite(revision.rounds))),
    shots: Math.max(0, Math.floor(finite(revision.shots))),
    averageToPar: finite(revision.averageToPar),
    architectureScore: revision.architectureScore == null ? null : clamp(finite(revision.architectureScore), 0, 100),
    holeIds: Array.isArray(revision.holeIds)
      ? revision.holeIds.filter((item): item is string => typeof item === "string").slice(0, 36)
      : [],
  };
}

export function normalizeLivingClub(raw: unknown): LivingClubState {
  const fallback = emptyLivingClubState();
  if (!raw || typeof raw !== "object") return fallback;
  const candidate = raw as LivingClubState;
  const rawStory = candidate.story && typeof candidate.story === "object" ? candidate.story : fallback.story;
  const rawArchitecture = candidate.architecture && typeof candidate.architecture === "object" ? candidate.architecture : fallback.architecture;
  return {
    version: 1,
    sequence: Math.max(1, Math.floor(finite(candidate.sequence, 1))),
    candidates: Array.isArray(candidate.candidates)
      ? candidate.candidates.map(normalizeCandidate).filter((item): item is RegularCandidate => item != null).slice(-MAX_CANDIDATES)
      : [],
    regulars: Array.isArray(candidate.regulars)
      ? candidate.regulars.map(normalizeRegular).filter((item): item is RegularGolfer => item != null).slice(-MAX_REGULARS)
      : [],
    story: {
      instances: Array.isArray(rawStory.instances)
        ? rawStory.instances.map(normalizeStoryInstance).filter((item): item is StoryEventInstance => item != null).slice(-MAX_STORY_INSTANCES)
        : [],
      callbacks: Array.isArray(rawStory.callbacks)
        ? rawStory.callbacks.map(normalizeCallback).filter((item): item is ScheduledStoryCallback => item != null).slice(-MAX_CALLBACKS)
        : [],
      journal: Array.isArray(rawStory.journal)
        ? rawStory.journal.map(normalizeJournalEntry).filter((item): item is StoryJournalEntry => item != null).slice(-MAX_STORY_JOURNAL)
        : [],
      cooldownUntil: rawStory.cooldownUntil && typeof rawStory.cooldownUntil === "object" ? rawStory.cooldownUntil : {},
      chainStage: rawStory.chainStage && typeof rawStory.chainStage === "object" ? rawStory.chainStage : {},
      settlementLedger: Array.isArray(rawStory.settlementLedger)
        ? rawStory.settlementLedger.filter((item): item is string => typeof item === "string").slice(-240)
        : [],
      lastEvaluationKey: typeof rawStory.lastEvaluationKey === "string" ? rawStory.lastEvaluationKey : undefined,
    },
    architecture: {
      evidence: Array.isArray(rawArchitecture.evidence)
        ? rawArchitecture.evidence.map(normalizeEvidence).filter((item): item is ArchitectureShotEvidence => item != null).slice(-MAX_EVIDENCE)
        : [],
      revisions: Array.isArray(rawArchitecture.revisions)
        ? rawArchitecture.revisions.map(normalizeRevision).filter((item): item is ArchitectureRevisionSummary => item != null).slice(-MAX_REVISIONS)
        : [],
      returnContext: rawArchitecture.returnContext &&
          typeof rawArchitecture.returnContext === "object" &&
          typeof rawArchitecture.returnContext.roundId === "string" &&
          typeof rawArchitecture.returnContext.holeId === "string" &&
          typeof rawArchitecture.returnContext.courseId === "string" &&
          rawArchitecture.returnContext.point &&
          Number.isFinite(rawArchitecture.returnContext.point.x) &&
          Number.isFinite(rawArchitecture.returnContext.point.y)
        ? rawArchitecture.returnContext
        : null,
      testSession: normalizeM48DesignTestSession(rawArchitecture.testSession),
      comparison: rawArchitecture.comparison && typeof rawArchitecture.comparison === "object"
        ? rawArchitecture.comparison as LivingClubState["architecture"]["comparison"]
        : null,
    },
  };
}

export function normalizeStaffCharacter(member: StaffMember, index: number, week = 1): StaffMember {
  const seed = hashText(member.id || `${member.name}:${index}`);
  const firstTrait = STAFF_TRAITS[seed % STAFF_TRAITS.length];
  const secondTrait = STAFF_TRAITS[(seed + 3 + index) % STAFF_TRAITS.length];
  const traits: [StaffTrait, StaffTrait] = firstTrait === secondTrait
    ? [firstTrait, STAFF_TRAITS[(STAFF_TRAITS.indexOf(secondTrait) + 1) % STAFF_TRAITS.length]]
    : [firstTrait, secondTrait];
  return {
    ...member,
    appearance: member.appearance ?? {
      portrait: seed % 4 === 0 ? "formal" : seed % 3 === 0 ? "sport" : "workwear",
      palette: seed % 6,
      accent: Math.floor(seed / 11) % 6,
    },
    traits: member.traits?.length === 2 ? member.traits : traits,
    proficiency: clamp(finite(member.proficiency, 45 + seed % 21), 0, 100),
    tenureStartWeek: Math.max(1, Math.floor(finite(member.tenureStartWeek, week))),
    morale: clamp(finite(member.morale, 70), 0, 100),
    training: Array.isArray(member.training) ? member.training.slice(-MAX_STAFF_HISTORY) : [],
    compensationHistory: Array.isArray(member.compensationHistory) && member.compensationHistory.length
      ? member.compensationHistory.slice(-MAX_STAFF_HISTORY)
      : [{ week, weeklyWage: member.weeklyWage, reason: member.id.startsWith("legacy-") ? "migration" : "hire" }],
    notableActions: Array.isArray(member.notableActions) ? member.notableActions.slice(-MAX_STAFF_HISTORY) : [],
  };
}

function candidateKey(name: string, archetype: string): string {
  return `${name.trim().toLocaleLowerCase()}:${archetype}`;
}

function favoriteHole(round: CompletedRound): string | undefined {
  let bestIndex = -1;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let index = 0; index < round.holeStrokes.length; index++) {
    const delta = (round.holeStrokes[index] ?? 0) - (round.holePar[index] ?? 0);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = index;
    }
  }
  return bestIndex >= 0 ? round.holeIds?.[bestIndex] : undefined;
}

function revisionForRound(
  revision: ArchitectureRevisionSummary | undefined,
  input: {
    geometryVersion: string;
    courseId: string;
    courseName: string;
    week: number;
    roundScoreToPar: number;
    shotCount: number;
    architectureScore: number | null;
    holeIds: string[];
  },
): ArchitectureRevisionSummary {
  if (!revision) return {
    id: `revision-${input.geometryVersion}`,
    geometryVersion: input.geometryVersion,
    courseId: input.courseId,
    courseName: input.courseName,
    firstWeek: input.week,
    lastWeek: input.week,
    rounds: 1,
    shots: input.shotCount,
    averageToPar: input.roundScoreToPar,
    architectureScore: input.architectureScore,
    holeIds: input.holeIds.slice(0, 36),
  };
  const rounds = revision.rounds + 1;
  return {
    ...revision,
    lastWeek: input.week,
    rounds,
    shots: revision.shots + input.shotCount,
    averageToPar: Number(((revision.averageToPar * revision.rounds + input.roundScoreToPar) / rounds).toFixed(2)),
    architectureScore: input.architectureScore ?? revision.architectureScore,
    holeIds: input.holeIds.slice(0, 36),
  };
}

function withRevision(
  state: LivingClubState,
  input: Parameters<typeof revisionForRound>[1],
): LivingClubState {
  const current = state.architecture.revisions.find((item) => item.geometryVersion === input.geometryVersion && item.courseId === input.courseId);
  const revision = revisionForRound(current, input);
  return {
    ...state,
    architecture: {
      ...state.architecture,
      revisions: [
        ...state.architecture.revisions.filter((item) => item.id !== revision.id),
        revision,
      ].slice(-MAX_REVISIONS),
    },
  };
}

function scoreSegment(archetype: string): string {
  return archetype === "pro" || archetype === "lowHandicap" ? "low-handicap"
    : archetype === "junior" ? "junior"
      : archetype === "senior" ? "senior"
        : archetype === "tourist" ? "visitor" : "casual";
}

export function recordLivingClubRound(world: World, course: Course, round: CompletedRound, day: number): World {
  let living = normalizeLivingClub(world.livingClub);
  const key = candidateKey(round.golferName, round.archetype);
  const priorRegular = living.regulars.find((item) => candidateKey(item.name, item.archetype) === key);
  const priorCandidate = living.candidates.find((item) => item.key === key);
  const courseId = round.courseId ?? course.activeCourseId ?? "course-primary";
  const courseName = round.courseName ?? course.name;
  const routedCourse = courseForLayout(course, courseId);
  const holeId = favoriteHole(round);
  const loyaltyDelta = Math.round((round.mood - 0.45) * 16);
  const candidate: RegularCandidate = priorCandidate
    ? {
        ...priorCandidate,
        visits: priorCandidate.visits + 1,
        lastWeek: world.week,
        lastDay: day,
        loyalty: clamp(priorCandidate.loyalty + loyaltyDelta, 0, 100),
        bestToPar: Math.min(priorCandidate.bestToPar, round.scoreToPar),
        courseIds: [...new Set([...priorCandidate.courseIds, courseId])].slice(-6),
      }
    : {
        key,
        name: round.golferName,
        archetype: round.archetype,
        visits: 1,
        firstWeek: world.week,
        lastWeek: world.week,
        lastDay: day,
        loyalty: clamp(45 + loyaltyDelta, 0, 100),
        bestToPar: round.scoreToPar,
        courseIds: [courseId],
      };
  const customer = world.enterprise?.customers.find((item) => candidateKey(item.name, round.archetype) === key || item.name.toLocaleLowerCase() === round.golferName.toLocaleLowerCase());
  const household = customer ? world.enterprise?.residents.find((item) => item.customerIds?.includes(customer.id)) : undefined;
  const regularId = priorRegular?.id ?? `regular-${hashText(`${world.runSeed}:${key}`).toString(36)}`;
  const visit = {
    id: `visit-${regularId}-${world.week}-${day}-${candidate.visits}`,
    week: world.week,
    day,
    courseId,
    courseName,
    scoreToPar: round.scoreToPar,
    mood: Number(round.mood.toFixed(3)),
    favoriteHoleId: holeId,
  };
  const memory: PersonMemory = {
    id: `memory-${visit.id}`,
    week: world.week,
    kind: round.scoreToPar <= candidate.bestToPar ? "record" : "round",
    summary: round.scoreToPar <= candidate.bestToPar
      ? `Set a personal best of ${round.scoreToPar > 0 ? "+" : ""}${round.scoreToPar} at ${courseName}.`
      : `Played ${courseName} and left ${round.mood >= 0.7 ? "eager to return" : "with mixed feelings"}.`,
    immutable: true,
    evidence: { courseId, holeId, geometryVersion: courseGeometryVersion(routedCourse), point: holeId ? routedCourse.holes.find((item) => item.id === holeId)?.green ?? undefined : undefined },
  };
  const shouldPromote = !!priorRegular || candidate.visits >= 2;
  const regular: RegularGolfer | null = shouldPromote ? {
    id: regularId,
    kind: "regular",
    name: round.golferName,
    archetype: round.archetype,
    appearance: priorRegular?.appearance ?? appearanceFor(regularId),
    skill: priorRegular?.skill ?? clamp(0.35 + (round.archetype === "pro" ? .55 : round.archetype === "lowHandicap" ? .4 : round.archetype === "junior" ? .12 : .22) - round.scoreToPar / 120, .1, .98),
    preferences: priorRegular?.preferences ?? {
      pace: round.archetype === "lowHandicap" || round.archetype === "pro" ? "brisk" : round.archetype === "senior" ? "relaxed" : "balanced",
      challenge: round.archetype === "pro" || round.archetype === "lowHandicap" ? "competitive" : "social",
      hospitality: round.archetype === "tourist" ? "destination" : customer?.member ? "club" : "simple",
    },
    loyalty: candidate.loyalty,
    visits: candidate.visits,
    rounds: (priorRegular?.rounds ?? Math.max(0, candidate.visits - 1)) + 1,
    bestToPar: Math.min(priorRegular?.bestToPar ?? 99, round.scoreToPar),
    favoriteCourseId: courseId,
    favoriteHoleId: holeId ?? priorRegular?.favoriteHoleId,
    customerId: customer?.id ?? priorRegular?.customerId,
    householdId: household?.id ?? priorRegular?.householdId,
    member: customer?.member ?? priorRegular?.member ?? false,
    relationship: priorRegular?.relationship ?? { score: 0, tier: "new", interactionIds: [] },
    memories: [...(priorRegular?.memories ?? []), memory].slice(-MAX_MEMORIES),
    recentThoughts: [
      round.mood >= .8 ? `I keep thinking about ${courseName}.` : `There is still something to solve at ${courseName}.`,
      ...(priorRegular?.recentThoughts ?? []),
    ].slice(0, 4),
    history: [...(priorRegular?.history ?? []), visit].slice(-MAX_VISITS),
  } : null;
  if (regular) regular.relationship.tier = relationshipTier(regular.relationship.score, regular.rounds);
  living = {
    ...living,
    candidates: [
      ...living.candidates.filter((item) => item.key !== key),
      candidate,
    ].sort((a, b) => a.lastWeek - b.lastWeek || a.key.localeCompare(b.key)).slice(-MAX_CANDIDATES),
    regulars: regular
      ? [...living.regulars.filter((item) => item.id !== regular.id), regular]
          .sort((a, b) => a.visits - b.visits || a.id.localeCompare(b.id))
          .slice(-MAX_REGULARS)
      : living.regulars,
  };

  const geometryVersion = courseGeometryVersion(routedCourse);
  const sourceId = regular?.id ?? `candidate-${hashText(`${world.runSeed}:${key}`).toString(36)}`;
  const evidence = (round.shots ?? []).map((shot): ArchitectureShotEvidence => ({
    id: `evidence-${sourceId}-${world.week}-${day}-${shot.id}`,
    source: "regular",
    sourceSegment: scoreSegment(round.archetype),
    golferId: sourceId,
    golferName: round.golferName,
    roundId: `live-${world.week}-${day}-${round.golferId}`,
    week: world.week,
    day,
    courseId,
    courseName,
    holeId: shot.holeId,
    teeSet: round.teeSet ?? "member",
    geometryVersion,
    shotType: shot.shotType,
    shotNumber: shot.shotNumber,
    from: shot.from,
    aim: shot.aim,
    landing: shot.landing,
    physicalRest: shot.sharedOutcome?.physicalRest ?? shot.greenRollout?.rest ?? shot.landing,
    rest: shot.rest,
    scoreToPar: round.scoreToPar,
    waitMinutes: round.waitMinutes ?? 0,
    lieBefore: shot.lieBefore,
    lieAfter: shot.lieAfter,
    shotSlope: shot.shotSlope,
    slopeExplanation: shot.slopeExplanation ?? shotSlopeExplanation(shot.shotSlope),
    greenRollout: shot.greenRollout,
  }));
  living = {
    ...living,
    architecture: {
      ...living.architecture,
      evidence: [...living.architecture.evidence, ...evidence]
        .filter((item, index, all) => all.findIndex((candidateItem) => candidateItem.id === item.id) === index)
        .slice(-MAX_EVIDENCE),
    },
  };
  living = withRevision(living, {
    geometryVersion,
    courseId,
    courseName,
    week: world.week,
    roundScoreToPar: round.scoreToPar,
    shotCount: evidence.length,
    architectureScore: analyzeArchitecture(routedCourse).total,
    holeIds: round.holeIds ?? [],
  });
  return { ...world, livingClub: living };
}

function playerShotType(club: string, lie: string, shotNumber: number): ArchitectureShotEvidence["shotType"] {
  if (club === "Putter") return "putt";
  if (shotNumber === 1 && lie === "tee") return "drive";
  if (!["tee", "fairway", "green"].includes(lie)) return "recovery";
  return "approach";
}

export function recordPlayerRoundArchitecture(
  world: World,
  playable: PlayerPlayableRound,
  careerRound: PlayerCareerRound,
): { world: World; careerRound: PlayerCareerRound } {
  let living = normalizeLivingClub(world.livingClub);
  const geometryVersion = snapshotGeometryVersion(playable.course);
  const evidence = careerRound.shots.map((shot): ArchitectureShotEvidence => ({
    id: `evidence-player-${careerRound.id}-${shot.id}`,
    source: "playerPro",
    sourceSegment: "player-pro",
    golferId: world.playerPro?.identity.id ?? "player-pro",
    golferName: world.playerPro?.identity.name ?? "Player Pro",
    roundId: careerRound.id,
    week: careerRound.week,
    day: playable.startedDay,
    courseId: careerRound.courseId,
    courseName: careerRound.courseName,
    holeId: shot.holeId,
    teeSet: playable.teeSet,
    geometryVersion,
    shotType: playerShotType(shot.club, shot.lieBefore, shot.shotNumber),
    shotNumber: shot.shotNumber,
    from: shot.from,
    aim: shot.aim,
    landing: shot.landing,
    physicalRest: shot.sharedOutcome?.physicalRest ?? shot.greenRollout?.rest ?? shot.landing,
    rest: shot.rest,
    scoreToPar: careerRound.scoreToPar,
    waitMinutes: 0,
    lieBefore: shot.lieBefore,
    lieAfter: shot.lieAfter,
    shotSlope: shot.shotSlope,
    slopeExplanation: shotSlopeExplanation(shot.shotSlope),
    greenRollout: shot.greenRollout,
  }));
  living = {
    ...living,
    architecture: {
      ...living.architecture,
      evidence: [...living.architecture.evidence, ...evidence]
        .filter((item, index, all) => all.findIndex((candidateItem) => candidateItem.id === item.id) === index)
        .slice(-MAX_EVIDENCE),
    },
  };
  living = withRevision(living, {
    geometryVersion,
    courseId: careerRound.courseId,
    courseName: careerRound.courseName,
    week: careerRound.week,
    roundScoreToPar: careerRound.scoreToPar,
    shotCount: evidence.length,
    architectureScore: null,
    holeIds: playable.course.holes.map((hole) => hole.id),
  });
  return {
    world: { ...world, livingClub: living },
    careerRound: {
      ...careerRound,
      geometryVersion,
      teeSet: playable.teeSet,
      pinRotation: playable.pinRotation,
      holeSnapshots: playable.course.holes.map((hole) => ({
        ...hole,
        tee: { ...hole.tee },
        pin: { ...hole.pin },
        waypoints: hole.waypoints.map((point) => ({ ...point })),
      })),
    },
  };
}

export function setReturnToDesignContext(
  world: World,
  round: PlayerPlayableRound,
  shotId: string | null,
): World {
  const living = normalizeLivingClub(world.livingClub);
  const shot = shotId ? round.shots.find((item) => item.id === shotId) : lastItem(round.shots);
  const holeId = shot?.holeId ?? round.course.holes[round.currentHoleIndex]?.id;
  if (!holeId) return world;
  const point = shot?.rest ?? round.course.holes.find((hole) => hole.id === holeId)?.pin;
  if (!point) return world;
  const context: ReturnToDesignContext = {
    roundId: round.id,
    shotId: shot?.id ?? null,
    holeId,
    courseId: round.course.courseId,
    geometryVersion: snapshotGeometryVersion(round.course),
    point: { ...point },
    openedWeek: world.week,
  };
  return { ...world, livingClub: { ...living, architecture: { ...living.architecture, returnContext: context } } };
}

function storyFacts(course: Course, world: World, living: LivingClubState): StoryFactSnapshot {
  const staff = (world.staffRoster ?? []).map((item, index) => normalizeStaffCharacter(item, index, world.week));
  const tournaments = normalizeTournamentCalendar(world.tournaments, course).events.filter((event) => event.status === "scheduled").length;
  const facts: Record<StoryFactKey, number> = {
    cash: world.cash,
    reputation: world.reputation,
    condition: course.condition * 100,
    lastWeekProfit: world.lastWeekProfit,
    regularCount: living.regulars.length,
    staffCount: staff.length,
    averageStaffMorale: staff.length ? staff.reduce((sum, item) => sum + (item.morale ?? 70), 0) / staff.length : 0,
    architectureEvidence: living.architecture.evidence.length,
    playerCareerPoints: world.playerPro?.careerPoints ?? 0,
    scheduledTournaments: tournaments,
    openClaims: world.enterprise?.claims.filter((claim) => claim.status === "open" || claim.status === "filed").length ?? 0,
    communityComplaints: world.enterprise?.complaints.filter((complaint) => complaint.status !== "resolved").length ?? 0,
  };
  return { key: `${world.runSeed}:${world.week}:${Object.values(facts).map((value) => Math.round(value * 100) / 100).join(":")}`, facts };
}

function eligible(definition: StoryEventDefinition, facts: StoryFactSnapshot): boolean {
  return definition.predicates.every((item) => {
    const value = facts.facts[item.fact] ?? 0;
    return item.op === "eq" ? value === item.value : item.op === "gte" ? value >= item.value : value <= item.value;
  });
}

function participantsFor(definition: StoryEventDefinition, world: World, living: LivingClubState, salt: number): string[] | null {
  const result: string[] = [];
  for (const role of definition.participantRoles) {
    if (role === "regular") {
      if (!living.regulars.length) return null;
      const regular = [...living.regulars].sort((a, b) => a.id.localeCompare(b.id))[salt % living.regulars.length];
      result.push(regular.id);
    } else if (role === "staff") {
      const staff = [...(world.staffRoster ?? [])].sort((a, b) => a.id.localeCompare(b.id));
      if (!staff.length) return null;
      result.push(staff[salt % staff.length].id);
    } else {
      if (!world.playerPro) return null;
      result.push(world.playerPro.identity.id);
    }
  }
  return result;
}

function createStoryInstance(
  definition: StoryEventDefinition,
  world: World,
  living: LivingClubState,
  day: number,
  participantIds: string[],
  facts: StoryFactSnapshot,
): { living: LivingClubState; instance: StoryEventInstance } {
  const sequence = living.sequence;
  const instance: StoryEventInstance = {
    id: `story-${world.runSeed >>> 0}-${world.week}-${day}-${sequence}-${definition.id}`,
    definitionId: definition.id,
    week: world.week,
    day,
    priority: definition.priority,
    category: definition.category,
    participantIds,
    facts,
    status: "pending",
    expiresWeek: world.week + definition.expiresAfterWeeks,
    resolution: null,
  };
  return {
    instance,
    living: {
      ...living,
      sequence: sequence + 1,
      story: {
        ...living.story,
        instances: [...living.story.instances, instance].slice(-MAX_STORY_INSTANCES),
      },
    },
  };
}

function applyRegularEffect(living: LivingClubState, targetId: string | undefined, effect: StoryEffect, instance: StoryEventInstance, choice: StoryChoiceDefinition): LivingClubState {
  if (!targetId) return living;
  return {
    ...living,
    regulars: living.regulars.map((regular) => {
      if (regular.id !== targetId) return regular;
      if (effect.type === "relationship") {
        const score = clamp(regular.relationship.score + effect.amount, -100, 100);
        return {
          ...regular,
          relationship: {
            score,
            tier: relationshipTier(score, regular.rounds),
            interactionIds: [...regular.relationship.interactionIds, `${instance.id}:${choice.id}`].slice(-40),
          },
        };
      }
      if (effect.type === "memory") {
        const memory: PersonMemory = {
          id: `memory-${instance.id}-${choice.id}-${regular.id}`,
          week: instance.week,
          kind: "story",
          summary: effect.summaryKey,
          immutable: true,
          evidence: { eventId: instance.definitionId },
        };
        return { ...regular, memories: [...regular.memories, memory].slice(-MAX_MEMORIES) };
      }
      return regular;
    }),
  };
}

function targetForRole(role: StoryParticipantRole, instance: StoryEventInstance, world: World, living: LivingClubState): string | undefined {
  if (role === "regular") return instance.participantIds.find((id) => living.regulars.some((regular) => regular.id === id));
  if (role === "staff") return instance.participantIds.find((id) => world.staffRoster?.some((staff) => staff.id === id));
  return instance.participantIds.find((id) => id === world.playerPro?.identity.id);
}

function applyChoiceEffects(
  course: Course,
  world: World,
  living: LivingClubState,
  instance: StoryEventInstance,
  choice: StoryChoiceDefinition,
): { course: Course; world: World; living: LivingClubState } {
  let nextCourse = course;
  let nextWorld = world;
  let nextLiving = living;
  for (const effect of choice.effects) {
    if (effect.type === "cash") nextWorld = { ...nextWorld, cash: nextWorld.cash + effect.amount };
    else if (effect.type === "reputation") nextWorld = { ...nextWorld, reputation: clamp(nextWorld.reputation + effect.amount, 0, 100) };
    else if (effect.type === "condition") nextCourse = { ...nextCourse, condition: clamp(nextCourse.condition + effect.amount, 0, 1) };
    else if (effect.type === "relationship" || effect.type === "memory") {
      nextLiving = applyRegularEffect(nextLiving, targetForRole(effect.target, instance, nextWorld, nextLiving), effect, instance, choice);
    } else if (effect.type === "staffMorale") {
      const target = targetForRole("staff", instance, nextWorld, nextLiving);
      nextWorld = {
        ...nextWorld,
        staffRoster: (nextWorld.staffRoster ?? []).map((staff, index) => {
          const normalized = normalizeStaffCharacter(staff, index, nextWorld.week);
          if (effect.target === "staff" && normalized.id !== target) return normalized;
          return { ...normalized, morale: clamp((normalized.morale ?? 70) + effect.amount, 0, 100) };
        }),
      };
    } else if (effect.type === "scheduleCallback") {
      const callback: ScheduledStoryCallback = {
        id: `callback-${instance.id}-${choice.id}-${effect.eventId}`,
        eventId: effect.eventId,
        dueWeek: nextWorld.week + effect.delayWeeks,
        sourceInstanceId: instance.id,
        participantIds: [...instance.participantIds],
      };
      nextLiving = {
        ...nextLiving,
        story: {
          ...nextLiving.story,
          callbacks: [...nextLiving.story.callbacks.filter((item) => item.id !== callback.id), callback].slice(-MAX_CALLBACKS),
        },
      };
    }
  }
  return { course: nextCourse, world: nextWorld, living: nextLiving };
}

function resolveInstance(
  course: Course,
  world: World,
  living: LivingClubState,
  instanceId: string,
  choiceId: string,
  resolution: "chosen" | "default" | "expired",
): { course: Course; world: World; living: LivingClubState; ok: boolean } {
  const instance = living.story.instances.find((item) => item.id === instanceId);
  if (!instance || instance.status === "resolved" || instance.status === "expired") return { course, world, living, ok: false };
  const definition = STORY_DEFINITION_BY_ID.get(instance.definitionId);
  const choice = definition?.choices.find((item) => item.id === choiceId);
  const ledgerId = `${instance.id}:${choiceId}`;
  if (!definition || !choice || living.story.settlementLedger.includes(ledgerId)) return { course, world, living, ok: false };
  const applied = applyChoiceEffects(course, world, living, instance, choice);
  const status = resolution === "expired" ? "expired" : "resolved";
  const resolvedInstance: StoryEventInstance = {
    ...instance,
    status,
    choiceId,
    resolvedWeek: world.week,
    resolution,
  };
  const journalEntry = {
    id: `journal-${instance.id}`,
    eventInstanceId: instance.id,
    definitionId: instance.definitionId,
    week: world.week,
    participantIds: [...instance.participantIds],
    choiceId,
    resolution,
    facts: instance.facts,
  };
  const nextLiving: LivingClubState = {
    ...applied.living,
    story: {
      ...applied.living.story,
      instances: applied.living.story.instances.map((item) => item.id === instance.id ? resolvedInstance : item),
      journal: [...applied.living.story.journal.filter((item) => item.id !== journalEntry.id), journalEntry].slice(-MAX_STORY_JOURNAL),
      cooldownUntil: { ...applied.living.story.cooldownUntil, [definition.id]: world.week + definition.cooldownWeeks },
      chainStage: definition.chainId
        ? { ...applied.living.story.chainStage, [definition.chainId]: Math.max(definition.stage ?? 1, applied.living.story.chainStage[definition.chainId] ?? 0) }
        : applied.living.story.chainStage,
      settlementLedger: [...applied.living.story.settlementLedger, ledgerId].slice(-240),
    },
  };
  return { course: applied.course, world: applied.world, living: nextLiving, ok: true };
}

export function resolveStoryChoice(
  course: Course,
  world: World,
  instanceId: string,
  choiceId: string,
): { course: Course; world: World; ok: boolean } {
  const living = normalizeLivingClub(world.livingClub);
  const result = resolveInstance(course, world, living, instanceId, choiceId, "chosen");
  return { course: result.course, world: { ...result.world, livingClub: result.living }, ok: result.ok };
}

export function acknowledgeStoryEvent(world: World, instanceId: string, deferred = false): World {
  const living = normalizeLivingClub(world.livingClub);
  let changed = false;
  const instances = living.story.instances.map((instance) => {
    if (instance.id !== instanceId || (instance.status !== "pending" && instance.status !== "presented")) return instance;
    changed = true;
    return { ...instance, status: deferred ? "deferred" as const : "presented" as const };
  });
  return changed ? { ...world, livingClub: { ...living, story: { ...living.story, instances } } } : world;
}

export function advanceLivingClubDay(course: Course, world: World, day: number): { course: Course; world: World } {
  let living = normalizeLivingClub(world.livingClub);
  let nextCourse = course;
  let nextWorld: World = {
    ...world,
    staffRoster: (world.staffRoster ?? []).map((staff, index) => {
      const normalized = normalizeStaffCharacter(staff, index, world.week);
      const daily = world.lastWeekProfit >= 0 ? 0.15 : -0.2;
      return { ...normalized, morale: clamp((normalized.morale ?? 70) + daily, 0, 100) };
    }),
  };
  // Expiration is reducer-authoritative and resolves the documented default once.
  for (const instance of living.story.instances) {
    if (!["pending", "presented", "deferred"].includes(instance.status) || nextWorld.week <= instance.expiresWeek) continue;
    const definition = STORY_DEFINITION_BY_ID.get(instance.definitionId);
    if (!definition) continue;
    const resolved = resolveInstance(nextCourse, nextWorld, living, instance.id, definition.defaultChoiceId, "expired");
    nextCourse = resolved.course;
    nextWorld = resolved.world;
    living = resolved.living;
  }
  const evaluationKey = `${nextWorld.week}:${day}`;
  if (living.story.lastEvaluationKey === evaluationKey) return { course: nextCourse, world: { ...nextWorld, livingClub: living } };
  living = { ...living, story: { ...living.story, lastEvaluationKey: evaluationKey } };
  if (living.story.instances.some((instance) => ["pending", "presented", "deferred"].includes(instance.status))) {
    return { course: nextCourse, world: { ...nextWorld, livingClub: living } };
  }
  const facts = storyFacts(nextCourse, nextWorld, living);
  const due = [...living.story.callbacks].filter((item) => item.dueWeek <= nextWorld.week).sort((a, b) => a.dueWeek - b.dueWeek || a.id.localeCompare(b.id))[0];
  if (due) {
    const definition = STORY_DEFINITION_BY_ID.get(due.eventId);
    if (definition) {
      const created = createStoryInstance(definition, nextWorld, living, day, due.participantIds, facts);
      living = {
        ...created.living,
        story: { ...created.living.story, callbacks: created.living.story.callbacks.filter((item) => item.id !== due.id) },
      };
      return { course: nextCourse, world: { ...nextWorld, livingClub: living } };
    }
  }
  const resolvedDefinitionIds = new Set(living.story.instances.filter((instance) => instance.status === "resolved" || instance.status === "expired").map((instance) => instance.definitionId));
  const candidates = SYSTEMIC_EVENT_DEFINITIONS.filter((definition) =>
    !definition.callbackOnly &&
    (definition.repeatable || !resolvedDefinitionIds.has(definition.id)) &&
    (living.story.cooldownUntil[definition.id] ?? 0) <= nextWorld.week &&
    eligible(definition, facts) &&
    (!definition.chainId || (living.story.chainStage[definition.chainId] ?? 0) < (definition.stage ?? 1)) &&
    (!definition.mutexGroup || !living.story.instances.some((instance) => {
      const other = STORY_DEFINITION_BY_ID.get(instance.definitionId);
      return other?.mutexGroup === definition.mutexGroup && instance.week === nextWorld.week;
    }))
  ).sort((a, b) => {
    const priority = { major: 3, notable: 2, routine: 1 };
    return priority[b.priority] - priority[a.priority] || a.id.localeCompare(b.id);
  });
  if (candidates.length) {
    const index = hashText(`${nextWorld.runSeed}:${nextWorld.week}:${day}:${facts.key}`) % candidates.length;
    const definition = candidates[index];
    const participants = participantsFor(definition, nextWorld, living, index);
    if (participants) living = createStoryInstance(definition, nextWorld, living, day, participants, facts).living;
  }
  return { course: nextCourse, world: { ...nextWorld, livingClub: living } };
}

export type StaffCommand =
  | { type: "hire"; role: StaffRole; courseId?: string }
  | { type: "train"; staffId: string; focus?: string }
  | { type: "reassign"; staffId: string; courseId: string }
  | { type: "schedule"; staffId: string; shiftStart: number; shiftEnd: number }
  | { type: "compensate"; staffId: string; raise: number }
  | { type: "dismiss"; staffId: string };

export function applyStaffCommand(world: World, command: StaffCommand): { ok: boolean; world: World; reason?: string } {
  let roster = (world.staffRoster ?? []).map((item, index) => normalizeStaffCharacter(item, index, world.week));
  if (command.type === "hire") {
    const cost = 900;
    if (world.cash < cost) return { ok: false, world, reason: "cash" };
    const sequence = normalizeLivingClub(world.livingClub).sequence;
    const id = `staff-${world.runSeed >>> 0}-${sequence}`;
    const wages: Record<StaffRole, number> = {
      groundskeeper: 500, cart_attendant: 420, pro_shop: 480, marshal: 560, tournament_director: 650,
      club_pro: 1050, food_service: 620, locker_attendant: 440, front_desk: 590, housekeeping: 560, shuttle_driver: 540,
    };
    roster = [...roster, normalizeStaffCharacter({
      id,
      name: STAFF_NAMES[hashText(id) % STAFF_NAMES.length],
      role: command.role,
      courseId: command.courseId,
      shiftStart: 0,
      shiftEnd: 840,
      weeklyWage: wages[command.role],
    }, roster.length, world.week)];
    const living = normalizeLivingClub(world.livingClub);
    return { ok: true, world: { ...world, cash: world.cash - cost, staffLevel: clamp(roster.length, 0, 5), staffRoster: roster, livingClub: { ...living, sequence: living.sequence + 1 } } };
  }
  const index = roster.findIndex((item) => item.id === command.staffId);
  if (index < 0) return { ok: false, world, reason: "missing" };
  if (command.type === "dismiss") {
    if (roster.length <= 1 || (roster[index].role === "groundskeeper" && !roster.some((item, staffIndex) => staffIndex !== index && item.role === "groundskeeper"))) {
      return { ok: false, world, reason: "minimum" };
    }
    roster = roster.filter((item) => item.id !== command.staffId);
    return { ok: true, world: { ...world, staffLevel: clamp(roster.length, 0, 5), staffRoster: roster } };
  }
  const staff = roster[index];
  if (command.type === "schedule") {
    if (!Number.isInteger(command.shiftStart) || !Number.isInteger(command.shiftEnd)
      || command.shiftStart < 0 || command.shiftEnd > 1_439
      || command.shiftEnd - command.shiftStart < 60) {
      return { ok: false, world, reason: "shift" };
    }
    if (staff.shiftStart === command.shiftStart && staff.shiftEnd === command.shiftEnd) {
      return { ok: true, world };
    }
    roster[index] = { ...staff, shiftStart: command.shiftStart, shiftEnd: command.shiftEnd };
    return { ok: true, world: { ...world, staffRoster: roster } };
  }
  if (command.type === "train") {
    const cost = 650;
    if (world.cash < cost) return { ok: false, world, reason: "cash" };
    const record = { id: `training-${staff.id}-${world.week}-${(staff.training?.length ?? 0) + 1}`, week: world.week, focus: command.focus ?? staff.role, gain: 5, cost };
    roster[index] = {
      ...staff,
      proficiency: clamp((staff.proficiency ?? 50) + record.gain, 0, 100),
      morale: clamp((staff.morale ?? 70) + 4, 0, 100),
      training: [...(staff.training ?? []), record].slice(-MAX_STAFF_HISTORY),
      notableActions: [...(staff.notableActions ?? []), { id: record.id, week: world.week, summary: `Completed ${record.focus} training.` }].slice(-MAX_STAFF_HISTORY),
    };
    return { ok: true, world: { ...world, cash: world.cash - cost, staffRoster: roster } };
  }
  if (command.type === "reassign") roster[index] = { ...staff, courseId: command.courseId };
  else {
    const raise = clamp(Math.round(command.raise), 10, 500);
    roster[index] = {
      ...staff,
      weeklyWage: staff.weeklyWage + raise,
      morale: clamp((staff.morale ?? 70) + Math.max(2, Math.round(raise / 25)), 0, 100),
      compensationHistory: [...(staff.compensationHistory ?? []), { week: world.week, weeklyWage: staff.weeklyWage + raise, reason: "raise" as const }].slice(-MAX_STAFF_HISTORY),
    };
  }
  return { ok: true, world: { ...world, staffRoster: roster } };
}

export function livingPersonName(world: World, personId: string): string {
  const living = normalizeLivingClub(world.livingClub);
  return living.regulars.find((regular) => regular.id === personId)?.name
    ?? world.staffRoster?.find((staff) => staff.id === personId)?.name
    ?? (world.playerPro?.identity.id === personId ? world.playerPro.identity.name : personId);
}
