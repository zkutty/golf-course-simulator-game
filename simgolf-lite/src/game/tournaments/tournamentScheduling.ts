import { mulberry32 } from "../../utils/rng";
import { golferName } from "../live/archetypes";
import type { GolferArchetypeName } from "../live/types";
import type { Course, World } from "../models/types";
import { courseForLayout, layoutById } from "../models/courseLayouts";
import { evaluateTournamentEligibility } from "./eligibility";
import type { TournamentEntrant, TournamentEvent, TournamentTemplateId, TournamentTier } from "./types";
import { TOURNAMENT_TIERS } from "./tournamentCatalog";
import { configureTournamentTemplateField, tournamentTemplate } from "./tournamentTemplates";
import { gameDateAfter, tournamentCalendar } from "./tournaments";

const archetypeForTier = (tier: TournamentTier, roll: number): GolferArchetypeName => tier === "championship" ? roll < .68 ? "pro" : "lowHandicap" : tier === "regional" ? roll < .18 ? "pro" : roll < .8 ? "lowHandicap" : "casual" : roll < .1 ? "pro" : roll < .42 ? "lowHandicap" : roll < .78 ? "casual" : "senior";
const eventSeed = (world: World, tier: TournamentTier, week: number, day: number) => (world.runSeed | 0) + week * 7919 + day * 431 + (tier === "local" ? 101 : tier === "regional" ? 503 : 997);

export function createTournamentEvent(args: { course: Course; world: World; tier: TournamentTier; currentDay: number; daysAhead: number; courseId?: string; templateId?: TournamentTemplateId }): { ok: true; event: TournamentEvent } | { ok: false; reason: string } {
  const spec = TOURNAMENT_TIERS[args.tier];
  const layout = args.courseId ? layoutById(args.course, args.courseId) : undefined;
  if (args.courseId && (!layout || layout.state !== "open" || layout.publishedHoleIds.length !== 18)) return { ok: false, reason: "Tournament hosts must be an open, published 18-hole course." };
  const hostCourse = layout ? courseForLayout(args.course, layout.id) : args.course;
  const qualification = evaluateTournamentEligibility({ course: hostCourse, world: args.world, tier: args.tier, currentDay: args.currentDay, daysAhead: args.daysAhead, minReputation: spec.minReputation, bookingCost: spec.bookingCost });
  if (!qualification.eligible) return { ok: false, reason: qualification.blockingReasons[0] ?? "This course does not meet the event standard." };
  const date = gameDateAfter(args.world.week, args.currentDay, args.daysAhead);
  const seed = eventSeed(args.world, args.tier, date.week, date.day);
  const rng = mulberry32(seed);
  let template;
  try { template = args.templateId ? tournamentTemplate(args.templateId) : undefined; }
  catch { return { ok: false, reason: `Tournament template '${String(args.templateId)}' is not supported.` }; }
  const fieldSize = template?.rules.teamCount === 2 ? 4 : spec.fieldSize;
  const generated: TournamentEntrant[] = Array.from({ length: fieldSize }, (_, index) => ({ id: `entrant-${seed}-${index + 1}`, name: golferName(rng(), rng()), archetype: archetypeForTier(args.tier, rng()), skill: spec.skillMin + rng() * (spec.skillMax - spec.skillMin) }));
  const field = args.templateId ? configureTournamentTemplateField(args.templateId, generated) : generated;
  const name = args.tier === "local" ? `${hostCourse.name} Open` : args.tier === "regional" ? `${hostCourse.name} Regional Invitational` : `${hostCourse.name} Championship`;
  return { ok: true, event: { id: `tournament-${seed}`, name, tier: args.tier, courseId: layout?.id, courseName: hostCourse.name, holeIds: hostCourse.holes.map((hole) => hole.id!).filter(Boolean), scheduledWeek: date.week, scheduledDay: date.day, status: "scheduled", bookingCost: spec.bookingCost, revenueAward: spec.revenueAward, reputationAward: spec.reputationAward, field, teeSet: qualification.teeSet, pinRotation: qualification.pinRotation, qualificationSnapshot: qualification, currentQualification: qualification, ...(template ? { templateId: template.id, teamFormat: template.teamFormat, scoringMode: template.scoringModes[0] } : {}) } };
}

export function scheduleTournament(world: World, event: TournamentEvent): World {
  const calendar = tournamentCalendar(world);
  if (world.cash < event.bookingCost || calendar.events.some((candidate) => candidate.id === event.id || (candidate.status === "scheduled" && candidate.scheduledWeek === event.scheduledWeek && candidate.scheduledDay === event.scheduledDay))) return world;
  return { ...world, cash: world.cash - event.bookingCost, tournaments: { version: 2, events: [...calendar.events, event] } };
}
