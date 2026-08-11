import type { TournamentEntrant, TournamentTemplate, TournamentTemplateId, TournamentTeamRole } from "./types";

export const PRO_AM_MEMBER_ALLOWANCE = .85;
const FIRST_ROSTER_CAPTAIN = { captainRule: "first-in-roster" as const };
const TEAM_CONTRACT = { scoringModes: ["net-stroke"], supportedOverrides: ["roundCount", "teeSet", "pinRotation"] } as const;
const PAIR_RULES = { version: 1, teamSize: 2, teamCount: 2, roles: ["partner", "partner"] } as const;
const SCORED_TEAM = { teamHoleScoringSupported: true, ...FIRST_ROSTER_CAPTAIN } as const;
const FOUR_BALL = "two-v-two-four-ball";
const ALTERNATE_SHOT = "two-v-two-alternate-shot";
const SCRAMBLE = "two-person-scramble";
const PRO_AM = "four-person-pro-am";

const freeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(freeze);
  }
  return value;
};

export const TOURNAMENT_TEMPLATES: Readonly<Record<TournamentTemplateId, TournamentTemplate>> = freeze({
  individual: {
    id: "individual", label: "Individual", teamFormat: "individual",
    scoringModes: ["stableford", "net-stroke", "gross-stroke"],
    supportedOverrides: ["scoringMode", "roundCount", "teeSet", "pinRotation"],
    rules: { version: 1, teamSize: 1, teamCount: "field", roles: ["individual"], handicapFormula: "100%-individual", orderRule: "independent", ballSelectionRule: "own-ball", teamHoleRule: "individual", teamHoleScoringSupported: true, ...FIRST_ROSTER_CAPTAIN },
  },
  [FOUR_BALL]: {
    id: FOUR_BALL, label: "2v2 Four-Ball", teamFormat: "four-ball",
    ...TEAM_CONTRACT,
    rules: { ...PAIR_RULES, handicapFormula: "85%-per-player", orderRule: "roster-order", ballSelectionRule: "best-net-member", teamHoleRule: "lowest-net-ball", ...SCORED_TEAM },
  },
  [ALTERNATE_SHOT]: {
    id: ALTERNATE_SHOT, label: "2v2 Alternate Shot", teamFormat: "alternate-shot",
    ...TEAM_CONTRACT,
    rules: { ...PAIR_RULES, handicapFormula: "50%-combined", orderRule: "strict-alternation", ballSelectionRule: "shared-ball", teamHoleRule: "single-shared-ball", ...SCORED_TEAM },
  },
  [SCRAMBLE]: {
    id: SCRAMBLE, label: "Two-Person Scramble", teamFormat: "scramble",
    ...TEAM_CONTRACT,
    rules: { ...PAIR_RULES, handicapFormula: "35%-low+15%-high", orderRule: "parallel-then-select", ballSelectionRule: "deterministic-best-candidate", teamHoleRule: "selected-team-ball", ...SCORED_TEAM },
  },
  [PRO_AM]: {
    id: PRO_AM, label: "Four-Person Pro-Am", teamFormat: "pro-am",
    ...TEAM_CONTRACT,
    rules: { version: 1, teamSize: 4, teamCount: "field", roles: ["pro", "amateur", "amateur", "amateur"], handicapFormula: "85%-per-player-pro-am", orderRule: "roster-order", ballSelectionRule: "deferred-pro-am", teamHoleRule: "deferred-best-two-net", teamHoleScoringSupported: false, ...FIRST_ROSTER_CAPTAIN },
  },
});

export function tournamentTemplate(id: TournamentTemplateId): TournamentTemplate {
  const template = TOURNAMENT_TEMPLATES[id];
  if (!template) throw new Error(`Unknown tournament template: ${String(id)}`);
  return template;
}

/** Deterministically authors team IDs, order, and roles without changing entrant identity or gross carriers. */
export function configureTournamentTemplateField(templateId: TournamentTemplateId, field: readonly TournamentEntrant[]): TournamentEntrant[] {
  const template = tournamentTemplate(templateId);
  if (template.teamFormat === "individual") return field.map((entrant) => ({ ...entrant, teamId: entrant.teamId ?? `individual:${entrant.id}`, teamRole: entrant.teamRole ?? "individual", teamCaptain: true }));
  const expected = template.rules.teamCount === "field" ? field.length : template.rules.teamCount * template.rules.teamSize;
  if (!field.length || field.length !== expected || field.length % template.rules.teamSize !== 0) throw new Error(`${template.label} requires ${expected} entrants in teams of ${template.rules.teamSize}.`);
  return field.map((entrant, index) => {
    const memberIndex = index % template.rules.teamSize;
    const teamIndex = Math.floor(index / template.rules.teamSize) + 1;
    const role = template.rules.roles[memberIndex] as TournamentTeamRole;
    return { ...entrant, teamId: entrant.teamId ?? `team-${teamIndex}`, teamRole: entrant.teamRole ?? role, teamCaptain: memberIndex === 0 };
  });
}
