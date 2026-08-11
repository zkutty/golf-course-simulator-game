import type { Course, World } from "../models/types";
import { absoluteDayFor } from "../seasons/seasons";
import type { PlayerProCareer, PlayerProSkills, PlayerShotTechnique, PlayerTrainingRecord } from "../models/playerProTypes";
import { applyPracticeConfidence, confidenceAtDay } from "./confidence";
import { techniqueRequirement, type PlayerOpponent, type PlayerTrainingOption } from "./playerPro";
import { playerTournamentEligibility } from "../tournaments/tournamentLifecycle";
import { tournamentCalendar } from "../tournaments/tournaments";
import type { TournamentEvent } from "../tournaments/types";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const TRAINING_SKILLS = {
  driving_range: ["power", "driving", "irons"], practice_bays: ["driving", "irons"], putting_green: ["putting"], short_game_area: ["shortGame", "recovery"], practice_holes: ["irons", "shortGame", "putting", "recovery"],
} as const;

export function playerTrainingOptions(course: Course, world: World, day: number, dayMinute = 600): PlayerTrainingOption[] {
  const coach = (world.staffRoster ?? []).some((staff) => staff.role === "club_pro") || Boolean(world.enterprise?.professionals.length);
  const sessions = world.playerPro?.training.filter((record) => record.week === world.week && record.day === day).length ?? 0;
  return (course.property?.assets ?? []).flatMap((asset) => (TRAINING_SKILLS[asset.kind as keyof typeof TRAINING_SKILLS] ?? []).map((skill) => {
    const blocker = !asset.enabled ? "closed" : (asset.constructionDaysRemaining ?? 0) > 0 ? "construction" : asset.condition < .4 ? "condition" : dayMinute < (asset.openHour ?? 7) * 60 || dayMinute >= (asset.closeHour ?? 20) * 60 ? "hours" : !coach ? "coach" : sessions >= 2 ? "daily_cap" : null;
    return { id: `${asset.id}:${skill}`, facilityId: asset.id, facilityName: asset.name, tier: asset.tier, skill, cost: Math.max(25, Math.round(asset.price * 2 + asset.tier * 20)), minutes: 45 + asset.tier * 5, available: blocker == null, blocker };
  }));
}

export function completePlayerTraining(career: PlayerProCareer, world: World, option: PlayerTrainingOption, day: number): { career: PlayerProCareer; cost: number } {
  if (!option.available || world.cash < option.cost) return { career, cost: 0 };
  const id = `training-${world.week}-${day}-${career.training.filter((record) => record.week === world.week && record.day === day).length + 1}`;
  if (career.settlementLedger.includes(id)) return { career, cost: 0 };
  const skillXp = { ...career.skillXp, [option.skill]: career.skillXp[option.skill] + 4 };
  const gain = Math.max(0, Math.floor(skillXp[option.skill] / 12) - Math.floor(career.skillXp[option.skill] / 12));
  const skills = { ...career.skills, [option.skill]: clamp(career.skills[option.skill] + gain, 0, 100) };
  const record: PlayerTrainingRecord = { id, week: world.week, day, facilityId: option.facilityId, facilityName: option.facilityName, skill: option.skill, cost: option.cost, minutes: option.minutes, evidence: 4 };
  return { cost: option.cost, career: { ...career, skills, skillXp, unlockedTechniques: playerTechniqueCatalog(skills).filter((entry) => entry.unlocked).map((entry) => entry.technique), confidence: applyPracticeConfidence(confidenceAtDay(career.confidence, absoluteDayFor(world.week, day)), option.tier), training: [...career.training, record].slice(-80), settlementLedger: [...career.settlementLedger, id].slice(-160) } };
}

export function eligiblePlayerOpponents(world: World): PlayerOpponent[] {
  const customers = (world.enterprise?.customers ?? []).filter((customer) => customer.visits >= 2 || customer.loyalty >= 40).slice(0, 12).map((customer) => ({ id: customer.id, name: customer.name, skill: clamp(customer.skill / 100, .2, .95), relationship: clamp(customer.loyalty - 50, -50, 50) }));
  return customers.length ? customers : (world.enterprise?.professionals ?? []).slice(0, 6).map((professional) => ({ id: professional.id, name: professional.name, skill: clamp(.5 + professional.tier * .08, .4, .95), relationship: 5 }));
}

export function playerProTournamentEntries(world: World, career: PlayerProCareer): TournamentEvent[] {
  const entered = new Set(career.tournaments.filter((record) => record.status === "active").map((record) => record.eventId));
  return tournamentCalendar(world).events.filter((event) => event.status === "scheduled" || (event.status === "active" && entered.has(event.id)));
}

export function playerProTournamentEntryEligibility(career: PlayerProCareer, event: TournamentEvent, world: World, day: number) {
  if (event.status !== "active") {
    const eligibility = playerTournamentEligibility(career, event);
    return eligibility.eligible && (event.scheduledWeek !== world.week || event.scheduledDay !== day) ? { eligible: false, reason: "round_date" } : eligibility;
  }
  const entered = career.tournaments.some((record) => record.eventId === event.id && record.status === "active");
  const round = event.rounds?.find((candidate) => candidate.roundNumber === event.currentRound);
  return { eligible: entered && round?.status === "active" && round.scheduledWeek === world.week && round.scheduledDay === day, reason: "round_date" };
}

export function playerTechniqueCatalog(skills: PlayerProSkills): Array<{ technique: PlayerShotTechnique; unlocked: boolean; requirement: string | null }> {
  return (["normal", "draw", "fade", "punch", "flop", "backspin"] as PlayerShotTechnique[]).map((technique) => ({ technique, unlocked: techniqueRequirement(technique, skills) == null, requirement: techniqueRequirement(technique, skills) }));
}
