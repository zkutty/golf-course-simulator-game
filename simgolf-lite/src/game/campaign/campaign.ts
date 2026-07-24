import type { Course, World } from "../models/types";
import { createObjectiveState } from "../models/objectives";
import { propertyAccessCapacity } from "../property/property";
import type { ClubCharter } from "../seasons/types";
import { CAMPAIGN_CAST, CAMPAIGN_CHAPTER_BY_ID } from "./content";
import type {
  CampaignCharacterId,
  CampaignChoiceRecord,
  CampaignFact,
  CampaignMatchDefinition,
  CampaignMatchRecord,
  CampaignMedal,
  CampaignPredicate,
  CampaignRunState,
  CampaignSceneDefinition,
} from "./types";

const MAX_CHOICES = 120;
const MAX_SCENES = 96;
const MAX_FACTS = 64;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: unknown, fallback = 0) => Number.isFinite(value) ? Number(value) : fallback;

const emptyRelationships = (): Record<CampaignCharacterId, number> => Object.fromEntries(
  CAMPAIGN_CAST.map((character) => [character.id, 0]),
) as Record<CampaignCharacterId, number>;

function validCharter(value: unknown): value is ClubCharter {
  return ["public-gem", "championship-venue", "destination-retreat", "member-institution"].includes(String(value));
}

function validChoice(raw: unknown, fallbackChapterId: string): CampaignChoiceRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Partial<CampaignChoiceRecord>;
  if (typeof source.sceneId !== "string" || typeof source.choiceId !== "string" || !Number.isFinite(source.week)) return null;
  const facts = source.facts && typeof source.facts === "object"
    ? Object.fromEntries(Object.entries(source.facts).filter(([, value]) => Number.isFinite(value)).slice(0, 32))
    : {};
  return {
    chapterId: typeof source.chapterId === "string" ? source.chapterId : fallbackChapterId,
    sceneId: source.sceneId,
    choiceId: source.choiceId,
    week: Math.max(1, Math.floor(source.week!)),
    facts,
    ...(typeof source.callbackFact === "string" ? { callbackFact: source.callbackFact } : {}),
  };
}

export function createCampaignRun(
  chapterId: string,
  charter: ClubCharter = "public-gem",
  priorChoices: CampaignChoiceRecord[] = [],
  startedWeek = 1,
): CampaignRunState {
  const chapter = CAMPAIGN_CHAPTER_BY_ID.get(chapterId);
  if (!chapter) throw new Error(`Unknown campaign chapter: ${chapterId}`);
  return {
    version: 2,
    chapterId,
    phaseIndex: 0,
    completedPhaseIds: [],
    firedComplicationIds: [],
    pendingSceneIds: [chapter.phases[0].introSceneId],
    resolvedSceneIds: [],
    scheduledScenes: [],
    choices: [],
    priorChoices: priorChoices.map((choice) => validChoice(choice, chapterId)).filter((choice): choice is CampaignChoiceRecord => choice != null).slice(-MAX_CHOICES),
    relationships: emptyRelationships(),
    eventPool: [],
    epilogueFacts: [],
    matches: [],
    settlementLedger: [],
    completed: false,
    charter,
    startedWeek: Math.max(1, Math.floor(startedWeek)),
    continuedInSandbox: false,
  };
}

export function normalizeCampaignRun(raw: unknown, chapterId?: string, charter?: ClubCharter): CampaignRunState | undefined {
  const candidate = raw && typeof raw === "object" ? raw as Partial<CampaignRunState> : {};
  const chapter = CAMPAIGN_CHAPTER_BY_ID.get(
    typeof candidate.chapterId === "string" ? candidate.chapterId : chapterId ?? "",
  );
  if (!chapter) return undefined;
  const fallback = createCampaignRun(chapter.id, validCharter(charter) ? charter : "public-gem");
  const phaseIndex = clamp(Math.floor(finite(candidate.phaseIndex)), 0, 2) as 0 | 1 | 2;
  const sceneIds = new Set(chapter.scenes.map((scene) => scene.id));
  const phaseIds = new Set(chapter.phases.map((phase) => phase.id));
  const matchIds = new Set(chapter.phases.flatMap((phase) => phase.match ? [phase.match.id] : []));
  const relationships = emptyRelationships();
  if (candidate.relationships && typeof candidate.relationships === "object") {
    for (const character of CAMPAIGN_CAST) {
      relationships[character.id] = clamp(Math.round(finite(candidate.relationships[character.id])), -100, 100);
    }
  }
  const normalizeIds = (value: unknown, allowed?: Set<string>, limit = MAX_SCENES) => Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === "string" && (!allowed || allowed.has(id))))].slice(-limit)
    : [];
  const scheduledScenes = Array.isArray(candidate.scheduledScenes)
    ? candidate.scheduledScenes.filter((entry) =>
      entry && sceneIds.has(entry.sceneId) && Number.isFinite(entry.dueWeek) && typeof entry.sourceSceneId === "string"
    ).map((entry) => ({ ...entry, dueWeek: Math.max(1, Math.floor(entry.dueWeek)) })).slice(-24)
    : [];
  const matches: CampaignMatchRecord[] = Array.isArray(candidate.matches)
    ? candidate.matches.filter((entry) =>
      entry && matchIds.has(entry.definitionId) && typeof entry.roundId === "string"
      && (entry.status === "active" || entry.status === "complete")
    ).map((entry) => ({
      definitionId: entry.definitionId,
      roundId: entry.roundId,
      ...(typeof entry.tournamentId === "string" ? { tournamentId: entry.tournamentId } : {}),
      status: entry.status,
      ...(["won", "lost", "tied", "conceded", "complete"].includes(entry.result ?? "") ? { result: entry.result } : {}),
    })).slice(-12)
    : [];
  const choices = Array.isArray(candidate.choices)
    ? candidate.choices.map((choice) => validChoice(choice, chapter.id)).filter((choice): choice is CampaignChoiceRecord => choice != null).slice(-MAX_CHOICES)
    : [];
  const priorChoices = Array.isArray(candidate.priorChoices)
    ? candidate.priorChoices.map((choice) => validChoice(choice, chapter.id)).filter((choice): choice is CampaignChoiceRecord => choice != null).slice(-MAX_CHOICES)
    : [];
  return {
    ...fallback,
    version: 2,
    phaseIndex,
    completedPhaseIds: normalizeIds(candidate.completedPhaseIds, phaseIds, 3),
    firedComplicationIds: normalizeIds(candidate.firedComplicationIds, undefined, 24),
    pendingSceneIds: normalizeIds(candidate.pendingSceneIds, sceneIds, 8),
    resolvedSceneIds: normalizeIds(candidate.resolvedSceneIds, sceneIds, MAX_SCENES),
    scheduledScenes,
    choices,
    priorChoices,
    relationships,
    eventPool: normalizeIds(candidate.eventPool, undefined, 40),
    epilogueFacts: normalizeIds(candidate.epilogueFacts, undefined, MAX_FACTS),
    matches,
    settlementLedger: normalizeIds(candidate.settlementLedger, undefined, 180),
    completed: candidate.completed === true,
    ...(candidate.medal === "bronze" || candidate.medal === "silver" || candidate.medal === "gold" ? { medal: candidate.medal } : {}),
    ...(candidate.outcome === "victory" || candidate.outcome === "honorable-loss" ? { outcome: candidate.outcome } : {}),
    charter: validCharter(candidate.charter) ? candidate.charter : validCharter(charter) ? charter : fallback.charter,
    startedWeek: Math.max(1, Math.floor(finite(candidate.startedWeek, 1))),
    continuedInSandbox: candidate.continuedInSandbox === true,
  };
}

export function campaignFacts(course: Course, world: World): Record<CampaignFact, number> {
  const living = world.livingClub;
  const player = world.playerPro;
  const completedMatches = player?.rounds.filter((round) =>
    round.opponentId?.startsWith("rowan-")
    || round.opponentId?.startsWith("jamie-")
    || round.opponentId?.startsWith("mara-")
    || round.opponentId?.startsWith("beatrice-")
    || round.tournamentId != null
  ) ?? [];
  const skillValues = player ? Object.values(player.skills) : [];
  const seasonal = world.seasonal;
  return {
    cash: Math.round(world.cash),
    reputation: Math.round(world.reputation),
    condition: Math.round(course.condition * 100),
    week: world.week,
    greenFee: Math.round(course.baseGreenFee),
    accessCapacity: propertyAccessCapacity(course, world),
    staffLevel: world.staffLevel,
    totalRounds: world.objectives?.totalRounds ?? 0,
    regularCount: living?.regulars.length ?? 0,
    architectureEvidence: living?.architecture.evidence.length ?? 0,
    playerCareerPoints: player?.careerPoints ?? 0,
    playerCareerRounds: player?.rounds.length ?? 0,
    playerMatchWins: completedMatches.filter((round) => round.result === "won").length,
    playerSkillAverage: skillValues.length ? Math.round(skillValues.reduce((sum, value) => sum + value, 0) / skillValues.length) : 0,
    scheduledTournaments: world.tournaments?.events.filter((event) => event.status === "scheduled").length ?? 0,
    completedTournaments: world.tournaments?.events.filter((event) => event.status === "completed").length ?? 0,
    severeForecastDays: seasonal?.forecast.filter((day) => day.kind === "heavy_rain" || day.kind === "storm").length ?? 0,
    drainageLevel: seasonal?.operations.drainageLevel ?? 0,
    legacyYears: seasonal?.yearbooks.length ?? 0,
  };
}

export function predicateMet(predicate: CampaignPredicate, facts: Record<CampaignFact, number>): boolean {
  const value = facts[predicate.fact];
  if (predicate.op === "gte") return value >= predicate.value;
  if (predicate.op === "lte") return value <= predicate.value;
  return value === predicate.value;
}

export function campaignScene(state: CampaignRunState | undefined): CampaignSceneDefinition | null {
  if (!state?.pendingSceneIds.length) return null;
  const chapter = CAMPAIGN_CHAPTER_BY_ID.get(state.chapterId);
  return chapter?.scenes.find((scene) => scene.id === state.pendingSceneIds[0]) ?? null;
}

export function activeCampaignMatch(state: CampaignRunState | undefined): CampaignMatchDefinition | null {
  if (!state || state.completed) return null;
  const chapter = CAMPAIGN_CHAPTER_BY_ID.get(state.chapterId);
  return chapter?.phases[state.phaseIndex]?.match ?? null;
}

function matchResult(world: World, record: CampaignMatchRecord) {
  return world.playerPro?.rounds.find((round) => round.id === record.roundId)?.result;
}

function syncCampaignMatches(state: CampaignRunState, world: World): CampaignRunState {
  let changed = false;
  const settlementLedger = [...state.settlementLedger];
  const relationships = { ...state.relationships };
  const epilogueFacts = [...state.epilogueFacts];
  const chapter = CAMPAIGN_CHAPTER_BY_ID.get(state.chapterId);
  const matches = state.matches.map((record) => {
    if (record.status === "complete") return record;
    const result = matchResult(world, record);
    if (!result) return record;
    changed = true;
    const definition = chapter?.phases.flatMap((phase) => phase.match ? [phase.match] : []).find((match) => match.id === record.definitionId);
    const ledgerId = `match:${record.definitionId}`;
    if (!settlementLedger.includes(ledgerId)) {
      settlementLedger.push(ledgerId);
      if (definition?.opponent) relationships[definition.opponent.characterId] = clamp(
        relationships[definition.opponent.characterId] + (result === "won" ? 3 : 1),
        -100,
        100,
      );
      epilogueFacts.push(`${record.definitionId}:${result}`);
    }
    return { ...record, status: "complete" as const, result };
  });
  if (!changed) return state;
  return {
    ...state,
    matches,
    relationships,
    epilogueFacts: [...new Set(epilogueFacts)].slice(-MAX_FACTS),
    settlementLedger: [...new Set(settlementLedger)].slice(-180),
  };
}

export function registerCampaignMatch(
  world: World,
  definitionId: string,
  roundId: string,
  tournamentId?: string,
): World {
  const state = normalizeCampaignRun(world.campaign, world.scenarioId, world.seasonal?.charter);
  const definition = activeCampaignMatch(state);
  if (!state || !definition || definition.id !== definitionId) return world;
  if (state.matches.some((match) => match.definitionId === definitionId)) return world;
  return {
    ...world,
    campaign: {
      ...state,
      matches: [...state.matches, {
        definitionId,
        roundId,
        ...(tournamentId ? { tournamentId } : {}),
        status: "active" as const,
      }].slice(-12),
    },
  };
}

export function campaignMatchComplete(state: CampaignRunState, match: CampaignMatchDefinition): boolean {
  return state.matches.some((record) => record.definitionId === match.id && record.status === "complete");
}

export function campaignPhaseBlockers(course: Course, world: World): string[] {
  const state = normalizeCampaignRun(world.campaign, world.scenarioId, world.seasonal?.charter);
  const chapter = state ? CAMPAIGN_CHAPTER_BY_ID.get(state.chapterId) : undefined;
  if (!state || !chapter || state.completed) return [];
  const synced = syncCampaignMatches(state, world);
  const phase = chapter.phases[synced.phaseIndex];
  const facts = campaignFacts(course, world);
  const blockers: string[] = [];
  if (world.objectives?.outcome !== "WON") blockers.push("campaign.blocker.objectives");
  for (const requirement of phase.requirements) {
    if (!predicateMet(requirement, facts)) blockers.push(`campaign.blocker.fact:${requirement.fact}:${requirement.op}:${requirement.value}:${facts[requirement.fact]}`);
  }
  if (phase.match) {
    const record = synced.matches.find((match) => match.definitionId === phase.match!.id);
    if (!record) blockers.push(`campaign.blocker.match:start:${phase.match.id}`);
    else if (record.status !== "complete") blockers.push(`campaign.blocker.match:finish:${phase.match.id}`);
  }
  return blockers;
}

function calculateMedal(state: CampaignRunState, course: Course, world: World): CampaignMedal {
  const chapter = CAMPAIGN_CHAPTER_BY_ID.get(state.chapterId);
  if (!chapter) return "bronze";
  const facts = campaignFacts(course, world);
  if (chapter.medals.find((item) => item.medal === "gold")!.predicates.every((item) => predicateMet(item, facts))) return "gold";
  if (chapter.medals.find((item) => item.medal === "silver")!.predicates.every((item) => predicateMet(item, facts))) return "silver";
  return "bronze";
}

function completionOutcome(state: CampaignRunState): "victory" | "honorable-loss" {
  const finalMatch = state.matches.find((match) => match.definitionId === "championship-final");
  return finalMatch && finalMatch.result !== "won" ? "honorable-loss" : "victory";
}

export function buildCampaignEpilogue(course: Course, world: World, state: CampaignRunState): string[] {
  const facts = campaignFacts(course, world);
  const strongestRelationship = Object.entries(state.relationships)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const priorFacts = state.priorChoices.flatMap((choice) => choice.callbackFact ? [`prior:${choice.callbackFact}`] : []);
  return [...new Set([
    `charter:${world.seasonal?.charter ?? state.charter}`,
    `club:reputation-${facts.reputation}`,
    `club:condition-${facts.condition}`,
    `pro:points-${facts.playerCareerPoints}`,
    `pro:rounds-${facts.playerCareerRounds}`,
    `legacy:years-${facts.legacyYears}`,
    ...(strongestRelationship ? [`relationship:${strongestRelationship[0]}:${strongestRelationship[1]}`] : []),
    ...state.epilogueFacts,
    ...state.choices.flatMap((choice) => choice.callbackFact ? [`choice:${choice.callbackFact}`] : []),
    ...priorFacts,
  ])].slice(-MAX_FACTS);
}

export function advanceCampaign(course: Course, world: World): World {
  if (!world.scenarioId || !world.campaign) return world;
  const chapter = CAMPAIGN_CHAPTER_BY_ID.get(world.scenarioId);
  if (!chapter) return world;
  let current = normalizeCampaignRun(world.campaign, world.scenarioId, world.seasonal?.charter)!;
  current = syncCampaignMatches(current, world);
  if (current.completed) return current === world.campaign ? world : { ...world, campaign: current };
  const facts = campaignFacts(course, world);
  const dueScenes = current.scheduledScenes.filter((entry) => entry.dueWeek <= world.week);
  const scheduledScenes = current.scheduledScenes.filter((entry) => entry.dueWeek > world.week);
  const pendingSceneIds = [...current.pendingSceneIds];
  for (const entry of dueScenes) {
    if (!pendingSceneIds.includes(entry.sceneId) && !current.resolvedSceneIds.includes(entry.sceneId)) pendingSceneIds.push(entry.sceneId);
  }
  const phase = chapter.phases[current.phaseIndex];
  const firedComplicationIds = [...current.firedComplicationIds];
  for (const complication of chapter.complications) {
    if (complication.phaseId !== phase.id || firedComplicationIds.includes(complication.id)) continue;
    if (!complication.predicates.every((item) => predicateMet(item, facts))) continue;
    firedComplicationIds.push(complication.id);
    if (!pendingSceneIds.includes(complication.sceneId) && !current.resolvedSceneIds.includes(complication.sceneId)) pendingSceneIds.push(complication.sceneId);
  }
  const campaign = { ...current, pendingSceneIds, scheduledScenes, firedComplicationIds };
  if (world.objectives?.outcome !== "WON"
    || !phase.requirements.every((item) => predicateMet(item, facts))
    || (phase.match != null && !campaignMatchComplete(campaign, phase.match))) {
    return { ...world, campaign };
  }
  const completedPhaseIds = [...new Set([...campaign.completedPhaseIds, phase.id])];
  if (phase.completionSceneId && !pendingSceneIds.includes(phase.completionSceneId)) pendingSceneIds.push(phase.completionSceneId);
  if (campaign.phaseIndex < 2) {
    const nextIndex = (campaign.phaseIndex + 1) as 1 | 2;
    const nextPhase = chapter.phases[nextIndex];
    if (!pendingSceneIds.includes(nextPhase.introSceneId)) pendingSceneIds.push(nextPhase.introSceneId);
    return {
      ...world,
      objectives: createObjectiveState(nextPhase.goals),
      campaign: {
        ...campaign,
        phaseIndex: nextIndex,
        completedPhaseIds,
        pendingSceneIds,
      },
    };
  }
  const completeState: CampaignRunState = {
    ...campaign,
    completed: true,
    medal: calculateMedal(campaign, course, world),
    outcome: completionOutcome(campaign),
    completedPhaseIds,
    pendingSceneIds,
  };
  completeState.epilogueFacts = buildCampaignEpilogue(course, world, completeState);
  return { ...world, campaign: completeState };
}

export function resolveCampaignChoice(
  course: Course,
  world: World,
  sceneId: string,
  choiceId: string,
): { ok: boolean; course: Course; world: World; reason?: string } {
  const state = normalizeCampaignRun(world.campaign, world.scenarioId, world.seasonal?.charter);
  const chapter = state ? CAMPAIGN_CHAPTER_BY_ID.get(state.chapterId) : undefined;
  const scene = chapter?.scenes.find((item) => item.id === sceneId);
  const choice = scene?.choices.find((item) => item.id === choiceId);
  if (!state || !scene || !choice || state.pendingSceneIds[0] !== sceneId) return { ok: false, course, world, reason: "unavailable" };
  const settlementId = `choice:${sceneId}:${choiceId}`;
  if (state.settlementLedger.includes(settlementId)) return { ok: false, course, world, reason: "settled" };
  let nextCourse = course;
  let nextWorld = world;
  const relationships = { ...state.relationships };
  const scheduledScenes = [...state.scheduledScenes];
  const eventPool = [...state.eventPool];
  const epilogueFacts = [...state.epilogueFacts];
  for (const effect of choice.effects) {
    if (effect.type === "cash") nextWorld = { ...nextWorld, cash: nextWorld.cash + effect.amount };
    if (effect.type === "reputation") nextWorld = { ...nextWorld, reputation: clamp(nextWorld.reputation + effect.amount, 0, 100) };
    if (effect.type === "condition") nextCourse = { ...nextCourse, condition: clamp(nextCourse.condition + effect.amount, 0, 1) };
    if (effect.type === "relationship") relationships[effect.characterId] = clamp(relationships[effect.characterId] + effect.amount, -100, 100);
    if (effect.type === "eventPool") eventPool.push(effect.eventId);
    if (effect.type === "epilogueFact") epilogueFacts.push(effect.fact);
    if (effect.type === "scheduleScene") {
      scheduledScenes.push({ sceneId: effect.sceneId, dueWeek: world.week + Math.max(1, effect.delayWeeks), sourceSceneId: sceneId });
    }
  }
  const facts = campaignFacts(nextCourse, nextWorld);
  const record: CampaignChoiceRecord = {
    chapterId: state.chapterId,
    sceneId,
    choiceId,
    week: world.week,
    facts,
    ...(choice.callbackFact ? { callbackFact: choice.callbackFact } : {}),
  };
  const campaign: CampaignRunState = {
    ...state,
    pendingSceneIds: state.pendingSceneIds.slice(1),
    resolvedSceneIds: [...new Set([...state.resolvedSceneIds, sceneId])].slice(-MAX_SCENES),
    scheduledScenes: scheduledScenes.slice(-24),
    relationships,
    eventPool: [...new Set(eventPool)].slice(-40),
    epilogueFacts: [...new Set(epilogueFacts)].slice(-MAX_FACTS),
    settlementLedger: [...state.settlementLedger, settlementId].slice(-180),
    choices: [...state.choices, record].slice(-MAX_CHOICES),
    charter: nextWorld.seasonal?.charter ?? state.charter,
  };
  return { ok: true, course: nextCourse, world: { ...nextWorld, campaign } };
}

export function continueCampaignInSandbox(world: World): World {
  const campaign = normalizeCampaignRun(world.campaign, world.scenarioId, world.seasonal?.charter);
  if (!campaign?.completed) return world;
  return {
    ...world,
    mode: "sandbox",
    scenarioId: undefined,
    constraints: undefined,
    objectives: undefined,
    campaign: { ...campaign, continuedInSandbox: true },
  };
}
