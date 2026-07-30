import type { GoalDefinition } from "../models/objectives";
import type { ClubCharter } from "../seasons/types";
import type { LandTheme } from "../models/types";
import { BIOME_KEYS, getBiomeDefinition } from "../models/biomes";

export interface ScenarioGoalTemplate {
  id: string;
  label: string;
  description: string;
  charter: ClubCharter;
  theme: LandTheme;
  goals: GoalDefinition[];
}

export interface FounderChallengeTemplate {
  id: string;
  label: string;
  description: string;
  goals: GoalDefinition[];
  allowedEventIds: string[];
}

const CHARTERS: readonly ClubCharter[] = [
  "public-gem",
  "championship-venue",
  "destination-retreat",
  "member-institution",
];

const CHARTER_GOALS: Record<ClubCharter, GoalDefinition[]> = {
  "public-gem": [
    { id: "mastery-access", label: "Keep golf accessible", description: "Reach 60 reputation while keeping the course open.", conditions: [{ metric: "reputation", comparator: ">=", target: 60 }] },
    { id: "mastery-community", label: "Build local trust", description: "Complete 9 valid holes and reach 70 condition.", conditions: [{ metric: "holesBuilt", comparator: ">=", target: 9 }, { metric: "condition", comparator: ">=", target: 70 }] },
    { id: "mastery-regulars", label: "Develop a returning club", description: "Complete 3 profitable weeks.", conditions: [{ metric: "profitStreak", comparator: ">=", target: 3 }] },
  ],
  "championship-venue": [
    { id: "mastery-qualification", label: "Qualify the course", description: "Reach a course rating of 70.", conditions: [{ metric: "courseRating", comparator: ">=", target: 70 }] },
    { id: "mastery-presentation", label: "Present a complete route", description: "Publish 9 valid holes.", conditions: [{ metric: "publishedHoles", comparator: ">=", target: 9 }] },
    { id: "mastery-standard", label: "Hold the standard", description: "Reach 75 condition.", conditions: [{ metric: "condition", comparator: ">=", target: 75 }] },
  ],
  "destination-retreat": [
    { id: "mastery-hospitality", label: "Sustain hospitality", description: "Reach 65 reputation.", conditions: [{ metric: "reputation", comparator: ">=", target: 65 }] },
    { id: "mastery-itinerary", label: "Complete the itinerary", description: "Publish one operating course.", conditions: [{ metric: "publishedCourses", comparator: ">=", target: 1 }] },
    { id: "mastery-landscape", label: "Earn destination appeal", description: "Maintain 72 condition.", conditions: [{ metric: "condition", comparator: ">=", target: 72 }] },
  ],
  "member-institution": [
    { id: "mastery-retention", label: "Retain the membership", description: "Reach 75 reputation.", conditions: [{ metric: "reputation", comparator: ">=", target: 75 }] },
    { id: "mastery-tradition", label: "Build tradition", description: "Complete 40 rounds.", conditions: [{ metric: "totalRounds", comparator: ">=", target: 40 }] },
    { id: "mastery-continuity", label: "Compound the institution", description: "Complete 4 profitable weeks.", conditions: [{ metric: "profitStreak", comparator: ">=", target: 4 }] },
  ],
};

/**
 * Safe, data-only optional goals. The matrix is intentionally explicit:
 * every charter has a viable path in every supported biome, while all
 * conditions remain existing objective-engine metrics.
 */
export const SCENARIO_GOAL_TEMPLATES: readonly ScenarioGoalTemplate[] = CHARTERS.flatMap((charter) =>
  BIOME_KEYS.map((theme) => ({
    id: `charter-${charter}-${theme}`,
    label: `${charter} · ${getBiomeDefinition(theme).label}`,
    description: `Optional ${charter} mastery path for ${getBiomeDefinition(theme).label} courses.`,
    charter,
    theme,
    goals: CHARTER_GOALS[charter].map((goal) => ({
      ...goal,
      id: `${charter}-${theme}-${goal.id}`,
      description: `${goal.description} (${theme} path.)`,
      conditions: goal.conditions.map((condition) => ({ ...condition })),
    })),
  })),
);

export const FOUNDER_CHALLENGES: readonly FounderChallengeTemplate[] = [
  {
    id: "founder-opening-day",
    label: "Founder’s Opening Day",
    description: "Open a complete route and welcome the first community round.",
    goals: [{ id: "founder-opening-route", label: "Open the route", description: "Build 9 valid holes.", conditions: [{ metric: "holesBuilt", comparator: ">=", target: 9 }] }],
    allowedEventIds: ["community-access-request", "junior-clinic"],
  },
  {
    id: "founder-course-record",
    label: "Founder’s Course Record",
    description: "Create a measured, playable course worthy of a record book.",
    goals: [{ id: "founder-record-quality", label: "Set the standard", description: "Reach a course rating of 72.", conditions: [{ metric: "courseRating", comparator: ">=", target: 72 }] }],
    allowedEventIds: ["course-record-celebration", "architect-critique"],
  },
  {
    id: "founder-grounds-compact",
    label: "Founder’s Grounds Compact",
    description: "Protect condition while the club earns its name.",
    goals: [{ id: "founder-grounds-condition", label: "Keep the grounds", description: "Reach 80 condition.", conditions: [{ metric: "condition", comparator: ">=", target: 80 }] }],
    allowedEventIds: ["superintendent-concern", "turf-recovery-window"],
  },
  {
    id: "founder-club-year",
    label: "Founder’s Club Year",
    description: "Build a durable institution through visible operations.",
    goals: [{ id: "founder-club-continuity", label: "Keep the club moving", description: "Complete 4 profitable weeks.", conditions: [{ metric: "profitStreak", comparator: ">=", target: 4 }] }],
    allowedEventIds: ["regular-welcome", "regular-rematch", "community-access-followup"],
  },
];

export const LEGACY_GOALS: readonly GoalDefinition[] = [
  { id: "legacy-annual-yearbook", label: "Leave a yearbook", description: "Complete 32 weeks of optional sandbox play.", conditions: [{ metric: "totalRounds", comparator: ">=", target: 32 }] },
  { id: "legacy-prestige-record", label: "Leave a prestige record", description: "Reach 80 reputation.", conditions: [{ metric: "reputation", comparator: ">=", target: 80 }] },
  { id: "legacy-course-history", label: "Leave a course history", description: "Publish two operating courses.", conditions: [{ metric: "publishedCourses", comparator: ">=", target: 2 }] },
];

export const SUPPORTED_GOAL_TEMPLATE_IDS = new Set([
  ...SCENARIO_GOAL_TEMPLATES.map((template) => template.id),
  ...FOUNDER_CHALLENGES.map((template) => template.id),
  "legacy-goals",
]);

export function supportedGoalTemplate(id: string): ScenarioGoalTemplate | FounderChallengeTemplate | null {
  return SCENARIO_GOAL_TEMPLATES.find((template) => template.id === id)
    ?? FOUNDER_CHALLENGES.find((template) => template.id === id)
    ?? (id === "legacy-goals" ? { id, label: "Legacy sandbox", description: "Optional long-form legacy goals.", goals: [...LEGACY_GOALS], allowedEventIds: [] } : null);
}
