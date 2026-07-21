import type { GoalDefinition } from "../models/objectives";

// Authored goal sets (ZKU-163). Data only — scenarios (ZKU-164) compose their
// own sets from the same vocabulary.

/** Default goal set for Challenge mode: a complete, winnable arc on fresh land. */
export const CHALLENGE_GOALS: GoalDefinition[] = [
  {
    id: "open-the-course",
    label: "Open for business",
    description: "Build 9 playable holes.",
    conditions: [{ metric: "holesBuilt", comparator: ">=", target: 9 }],
  },
  {
    id: "build-a-bankroll",
    label: "Build a bankroll",
    description: "Bank $75,000 in cash.",
    conditions: [{ metric: "cash", comparator: ">=", target: 75_000 }],
  },
  {
    id: "earn-a-name",
    label: "Earn a name",
    description: "Reach 70 reputation with a course rating of 68 or better.",
    conditions: [
      { metric: "reputation", comparator: ">=", target: 70 },
      { metric: "courseRating", comparator: ">=", target: 68 },
    ],
  },
  {
    id: "run-it-well",
    label: "Run it well",
    description: "String together 4 profitable weeks in a row.",
    conditions: [{ metric: "profitStreak", comparator: ">=", target: 4 }],
  },
];

/** Optional late-game goals used by expansion scenarios and custom runs. */
export const EXPANSION_GOALS: GoalDefinition[] = [
  { id: "publish-eighteen", label: "Championship routing", description: "Publish 18 unique, complete holes.", conditions: [{ metric: "publishedHoles", comparator: ">=", target: 18 }] },
  { id: "operate-two-courses", label: "Two-course estate", description: "Publish two complete operating courses.", conditions: [{ metric: "publishedCourses", comparator: ">=", target: 2 }] },
  { id: "publish-thirty-six", label: "Thirty-six hole estate", description: "Publish 36 uniquely assigned, complete holes.", conditions: [{ metric: "publishedHoles", comparator: ">=", target: 36 }] },
];

export function goalById(goals: GoalDefinition[], id: string): GoalDefinition | undefined {
  return goals.find((g) => g.id === id);
}
