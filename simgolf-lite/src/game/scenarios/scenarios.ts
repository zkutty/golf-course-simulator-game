import type { Course, World } from "../models/types";
import { createObjectiveState } from "../models/objectives";
import { createNewGame } from "../gen/newGame";
import { buildFixtureCourse } from "./fixtures";
import type { ScenarioDefinition } from "./types";

// The launch career ladder (ZKU-164): six authored scenarios, escalating.
// Data only — every goal uses the ZKU-163 condition vocabulary.
//
// Deviation from the original sketch, noted on the Linear issue:
// "Championship Dream" ships with the rating-goal fallback (18 holes and
// tournaments aren't in the sim yet — 9-hole MVP, M6 pending).

export const SCENARIOS: ScenarioDefinition[] = [
  {
    id: "back-nine",
    order: 1,
    name: "The Back Nine",
    blurb:
      "A friendly patch of parkland behind your uncle's farm. Get three holes open and show the books can balance.",
    seed: 90101,
    theme: "parkland",
    difficulty: "easy",
    courseName: "The Back Nine",
    goals: [
      {
        id: "three-holes",
        label: "Open three holes",
        description: "Build 3 playable holes.",
        conditions: [{ metric: "holesBuilt", comparator: ">=", target: 3 }],
      },
      {
        id: "first-profit",
        label: "Turn a profit",
        description: "Finish a week in the black.",
        conditions: [{ metric: "profitStreak", comparator: ">=", target: 1 }],
      },
    ],
  },
  {
    id: "muni-rescue",
    order: 2,
    name: "Muni Rescue",
    blurb:
      "The city's beloved municipal course has gone to seed. Nine tired holes, no budget, and a town watching. Bring it back.",
    seed: 90202,
    theme: "parkland",
    difficulty: "normal",
    startingCash: 15_000,
    startingReputation: 25,
    fixture: "muni",
    goals: [
      {
        id: "restore-turf",
        label: "Restore the turf",
        description: "Bring course condition back to 70%.",
        conditions: [{ metric: "condition", comparator: ">=", target: 70 }],
      },
      {
        id: "win-back-town",
        label: "Win back the town",
        description: "Reach 55 reputation.",
        conditions: [{ metric: "reputation", comparator: ">=", target: 55 }],
      },
    ],
  },
  {
    id: "swamp-deal",
    order: 3,
    name: "Swamp Deal",
    blurb:
      "The land was cheap for a reason: it's half water. No bank will touch the deal — design your way out of the wet.",
    seed: 90333,
    theme: "parkland",
    difficulty: "normal",
    startingCash: 30_000,
    constraints: { noLoans: true },
    goals: [
      {
        id: "nine-holes-wet",
        label: "Drain and build",
        description: "Open all 9 holes on the wetland parcel.",
        conditions: [{ metric: "holesBuilt", comparator: ">=", target: 9 }],
      },
      {
        id: "respectable-rating",
        label: "Make it respectable",
        description: "Reach a course rating of 67.",
        conditions: [{ metric: "courseRating", comparator: ">=", target: 67 }],
      },
    ],
  },
  {
    id: "links-by-the-sea",
    order: 4,
    name: "Links by the Sea",
    blurb:
      "Dunes, fescue, and a cold gray sea. The handful of trees are heritage-listed — the course must be found, not forced.",
    seed: 90404,
    theme: "links",
    difficulty: "normal",
    constraints: { protectedTrees: true },
    goals: [
      {
        id: "real-links",
        label: "Rout the links",
        description: "Open all 9 holes.",
        conditions: [{ metric: "holesBuilt", comparator: ">=", target: 9 }],
      },
      {
        id: "championship-rating",
        label: "A proper test",
        description: "Reach a course rating of 70.",
        conditions: [{ metric: "courseRating", comparator: ">=", target: 70 }],
      },
    ],
  },
  {
    id: "members-club",
    order: 5,
    name: "The Members Club",
    blurb:
      "Fairhaven's committee sets the green fee, not you — and their members expect perfection. Keep the standards, keep the streak.",
    seed: 90505,
    theme: "parkland",
    difficulty: "hard",
    startingCash: 40_000,
    startingReputation: 55,
    fixture: "members",
    constraints: { fixedGreenFee: 110 },
    goals: [
      {
        id: "prestige",
        label: "Uphold the name",
        description: "Reach 75 reputation with picky, premium golfers.",
        conditions: [{ metric: "reputation", comparator: ">=", target: 75 }],
      },
      {
        id: "steady-books",
        label: "Steady the books",
        description: "String together 3 profitable weeks at the committee's fee.",
        conditions: [{ metric: "profitStreak", comparator: ">=", target: 3 }],
      },
    ],
  },
  {
    id: "championship-dream",
    order: 6,
    name: "Championship Dream",
    blurb:
      "Raw land, hard money, and one ambition: a course worthy of hosting a championship. Build the resume the tour can't ignore.",
    seed: 90666,
    theme: "parkland",
    difficulty: "hard",
    goals: [
      {
        id: "full-course",
        label: "The full course",
        description: "Open all 9 holes.",
        conditions: [{ metric: "holesBuilt", comparator: ">=", target: 9 }],
      },
      {
        id: "tour-quality",
        label: "Tour quality",
        description: "Reach a course rating of 72 and 80 reputation.",
        conditions: [
          { metric: "courseRating", comparator: ">=", target: 72 },
          { metric: "reputation", comparator: ">=", target: 80 },
        ],
      },
      {
        id: "war-chest",
        label: "A championship war chest",
        description: "Bank $150,000 to fund the bid.",
        conditions: [{ metric: "cash", comparator: ">=", target: 150_000 }],
      },
    ],
  },
];

export function getScenario(id: string | undefined): ScenarioDefinition | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

/**
 * Start a scenario run: authored fixture or fresh themed land, plus the
 * scenario's goals, constraints, and world tweaks. Deterministic.
 */
export function createScenarioGame(s: ScenarioDefinition): { course: Course; world: World } {
  const base = createNewGame(
    {
      mode: "career",
      courseName: s.courseName ?? s.name,
      seed: s.seed,
      theme: s.theme,
      difficulty: s.difficulty,
    },
    s.goals
  );

  const course = s.fixture ? buildFixtureCourse(s.fixture, s.seed) : base.course;

  const world: World = {
    ...base.world,
    ...(s.startingCash != null ? { cash: s.startingCash } : {}),
    ...(s.startingReputation != null ? { reputation: s.startingReputation } : {}),
    scenarioId: s.id,
    ...(s.constraints ? { constraints: s.constraints } : {}),
    objectives: createObjectiveState(s.goals),
  };
  if (s.constraints?.fixedGreenFee != null) course.baseGreenFee = s.constraints.fixedGreenFee;

  return { course, world };
}
