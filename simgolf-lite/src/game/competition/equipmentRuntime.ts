import type { PlayerProCareer } from "../models/playerProTypes";
import type { EquipmentModifier, EquipmentPerformanceChannel, FrozenPerformanceLoadout, LearnedTechnique, MentorTechniqueChallenge } from "./types";

export const PERFORMANCE_CHANNEL_MIN = .8;
export const PERFORMANCE_CHANNEL_MAX = 1.2;
export const EQUIPMENT_SIDEGRADE_MIN = .88;
export const EQUIPMENT_SIDEGRADE_MAX = 1.12;
export const LEARNED_TECHNIQUES: readonly LearnedTechnique[] = ["fairway-finder", "knockdown-approach", "soft-hands", "splash-specialist", "lag-putt"];
const CHANNELS: readonly EquipmentPerformanceChannel[] = ["carry", "dispersion", "recovery", "putting", "spin"];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const safe = (modifier: EquipmentModifier): EquipmentModifier | null => CHANNELS.includes(modifier.channel) && Number.isFinite(modifier.multiplier) ? { channel: modifier.channel, multiplier: Number(clamp(modifier.multiplier, .88, 1.12).toFixed(6)), ...(modifier.context ? { context: modifier.context.slice(0, 40) } : {}) } : null;

export function normalizePerformanceLoadoutSnapshot(raw: unknown): FrozenPerformanceLoadout | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Partial<FrozenPerformanceLoadout>;
  if (value.version !== 1 || !Array.isArray(value.itemIds) || !Array.isArray(value.modifiers)) return undefined;
  const techniqueId = LEARNED_TECHNIQUES.includes(value.techniqueId as LearnedTechnique) ? value.techniqueId as LearnedTechnique : undefined;
  const modifiers = value.modifiers.flatMap((modifier) => {
    const normalized = modifier && typeof modifier === "object" ? safe(modifier) : null;
    return normalized && (modifier.sourceKind === "equipment" || modifier.sourceKind === "technique") && typeof modifier.sourceId === "string" ? [{ ...normalized, sourceKind: modifier.sourceKind, sourceId: modifier.sourceId.slice(0, 80) }] : [];
  }).slice(0, 24);
  return Object.freeze({ version: 1, frozenWeek: Math.max(1, Math.floor(Number.isFinite(value.frozenWeek) ? value.frozenWeek! : 1)), frozenDay: clamp(Math.floor(Number.isFinite(value.frozenDay) ? value.frozenDay! : 0), 0, 6), itemIds: Object.freeze([...new Set(value.itemIds.filter((id): id is string => typeof id === "string"))].slice(0, 16)), ...(techniqueId ? { techniqueId } : {}), modifiers: Object.freeze(modifiers.map((modifier) => Object.freeze(modifier))) });
}

export interface PerformanceShotContext { clubId: string; lie: string; flightProfile: "low" | "standard" | "high"; leaveDistanceYards?: number }
const applies = (name: string | undefined, shot: PerformanceShotContext) => {
  const iron = shot.clubId === "five_iron" || shot.clubId === "seven_iron";
  const wedge = shot.clubId === "pitching_wedge" || shot.clubId === "sand_wedge" || shot.clubId === "chip";
  if (!name) return true;
  if (name === "iron-low-flight") return iron && shot.flightProfile === "low";
  if (name === "standard-full-shot") return shot.flightProfile === "standard" && shot.clubId !== "putter" && shot.clubId !== "chip";
  if (name === "difficult-recovery") return shot.lie === "sand" || shot.lie === "deep_rough";
  if (name === "green-putting") return shot.clubId === "putter" || shot.lie === "green";
  if (name === "wood-from-tee") return (shot.clubId === "driver" || shot.clubId === "three_wood") && shot.lie === "tee";
  if (name === "iron-low-fairway") return iron && shot.lie === "fairway" && shot.flightProfile === "low";
  if (name === "greenside-rough") return wedge && (shot.lie === "rough" || shot.lie === "deep_rough");
  if (name === "sand-wedge-from-sand") return shot.clubId === "sand_wedge" && shot.lie === "sand";
  return name === "long-green-putting" && (shot.clubId === "putter" || shot.lie === "green") && (shot.leaveDistanceYards ?? 0) >= 10;
};

export function resolvePerformanceModifiers(snapshot: FrozenPerformanceLoadout | undefined, shot: PerformanceShotContext) {
  const applied = snapshot?.modifiers.filter((modifier) => applies(modifier.context, shot)) ?? [];
  const multiplier = (channel: EquipmentPerformanceChannel) => Number(clamp(applied.filter((modifier) => modifier.channel === channel).reduce((value, modifier) => value * modifier.multiplier, 1), .8, 1.2).toFixed(6));
  return { carry: multiplier("carry"), dispersion: multiplier("dispersion"), recovery: multiplier("recovery"), putting: multiplier("putting"), spin: multiplier("spin"), applied };
}

export function normalizeLearnedTechniques(raw: unknown): LearnedTechnique[] { return Array.isArray(raw) ? raw.filter((value): value is LearnedTechnique => LEARNED_TECHNIQUES.includes(value as LearnedTechnique)).filter((value, index, all) => all.indexOf(value) === index) : []; }

export function normalizeMentorChallenges(raw: unknown): MentorTechniqueChallenge[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const value = candidate as Partial<MentorTechniqueChallenge>;
    if (value.version !== 1 || typeof value.id !== "string" || typeof value.mentorId !== "string" || typeof value.mentorName !== "string" || !LEARNED_TECHNIQUES.includes(value.techniqueId as LearnedTechnique)) return [];
    return [{ version: 1 as const, id: value.id, mentorId: value.mentorId, mentorName: value.mentorName.slice(0, 60), techniqueId: value.techniqueId as LearnedTechnique, objectiveId: typeof value.objectiveId === "string" ? value.objectiveId.slice(0, 80) : value.techniqueId as string, objective: typeof value.objective === "string" ? value.objective.slice(0, 240) : value.techniqueId as string, status: value.status === "complete" ? "complete" as const : "active" as const, startedWeek: Math.max(1, Math.floor(Number.isFinite(value.startedWeek) ? value.startedWeek! : 1)), startedDay: clamp(Math.floor(Number.isFinite(value.startedDay) ? value.startedDay! : 0), 0, 6), attemptRoundIds: Array.isArray(value.attemptRoundIds) ? [...new Set(value.attemptRoundIds.filter((id): id is string => typeof id === "string"))].slice(-20) : [], ...(typeof value.completedRoundId === "string" ? { completedRoundId: value.completedRoundId } : {}) }];
  }).slice(-40);
}

export function normalizedMentorCareerFields(candidate: Partial<PlayerProCareer>) {
  const learnedTechniques = normalizeLearnedTechniques(candidate.learnedTechniques);
  const mentorTechniqueChallenges = normalizeMentorChallenges(candidate.mentorTechniqueChallenges);
  const active = normalizeMentorChallenges(candidate.activeMentorTechniqueChallenge ? [candidate.activeMentorTechniqueChallenge] : [])[0];
  return { learnedTechniques, mentorTechniqueChallenges, activeMentorTechniqueChallenge: active?.status === "active" ? active : null, mentorTechniqueLedger: Array.isArray(candidate.mentorTechniqueLedger) ? candidate.mentorTechniqueLedger.filter((id): id is string => typeof id === "string").slice(-160) : [] };
}
