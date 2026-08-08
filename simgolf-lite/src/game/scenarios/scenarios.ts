import type { Course, World } from "../models/types";
import { createObjectiveState } from "../models/objectives";
import { createNewGame } from "../gen/newGame";
import { buildFixtureCourse } from "./fixtures";
import type { ScenarioDefinition } from "./types";
import { translate } from "../../i18n/core";
import { loadCareer } from "../../utils/careerStore";
import { CAMPAIGN_CHAPTER_BY_ID } from "../campaign/content";
import { createCampaignRun } from "../campaign/campaign";
import { biomeCompatibilityMetadataFor } from "../models/biomes";

const text = (key: Parameters<typeof translate>[1]) => translate("en", key);

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
    nameKey: "scenario.backNine.name", name: text("scenario.backNine.name"),
    blurbKey: "scenario.backNine.blurb", blurb: text("scenario.backNine.blurb"),
    seed: 90101,
    theme: "parkland",
    biomeCompatibility: biomeCompatibilityMetadataFor("parkland"),
    experienceProfile: "relaxed",
    economicPressure: "friendly",
    goals: [
      {
        id: "three-holes",
        labelKey: "scenario.goal.threeHoles.label", label: text("scenario.goal.threeHoles.label"),
        descriptionKey: "scenario.goal.threeHoles.description", description: text("scenario.goal.threeHoles.description"),
        conditions: [{ metric: "holesBuilt", comparator: ">=", target: 3 }],
      },
      {
        id: "first-profit",
        labelKey: "scenario.goal.firstProfit.label", label: text("scenario.goal.firstProfit.label"),
        descriptionKey: "scenario.goal.firstProfit.description", description: text("scenario.goal.firstProfit.description"),
        conditions: [{ metric: "profitStreak", comparator: ">=", target: 1 }],
      },
    ],
  },
  {
    id: "muni-rescue",
    order: 2,
    nameKey: "scenario.muniRescue.name", name: text("scenario.muniRescue.name"),
    blurbKey: "scenario.muniRescue.blurb", blurb: text("scenario.muniRescue.blurb"),
    seed: 90202,
    theme: "parkland",
    biomeCompatibility: biomeCompatibilityMetadataFor("parkland"),
    experienceProfile: "classic",
    economicPressure: "balanced",
    startingCash: 15_000,
    startingReputation: 25,
    fixture: "muni",
    goals: [
      {
        id: "restore-turf",
        labelKey: "scenario.goal.restoreTurf.label", label: text("scenario.goal.restoreTurf.label"),
        descriptionKey: "scenario.goal.restoreTurf.description", description: text("scenario.goal.restoreTurf.description"),
        conditions: [{ metric: "condition", comparator: ">=", target: 70 }],
      },
      {
        id: "win-back-town",
        labelKey: "scenario.goal.winBackTown.label", label: text("scenario.goal.winBackTown.label"),
        descriptionKey: "scenario.goal.winBackTown.description", description: text("scenario.goal.winBackTown.description"),
        conditions: [{ metric: "reputation", comparator: ">=", target: 55 }],
      },
    ],
  },
  {
    id: "swamp-deal",
    order: 3,
    nameKey: "scenario.swampDeal.name", name: text("scenario.swampDeal.name"),
    blurbKey: "scenario.swampDeal.blurb", blurb: text("scenario.swampDeal.blurb"),
    seed: 90333,
    theme: "parkland",
    biomeCompatibility: biomeCompatibilityMetadataFor("parkland"),
    experienceProfile: "classic",
    economicPressure: "balanced",
    startingCash: 30_000,
    constraints: { noLoans: true },
    goals: [
      {
        id: "nine-holes-wet",
        labelKey: "scenario.goal.drainBuild.label", label: text("scenario.goal.drainBuild.label"),
        descriptionKey: "scenario.goal.drainBuild.description", description: text("scenario.goal.drainBuild.description"),
        conditions: [{ metric: "holesBuilt", comparator: ">=", target: 9 }],
      },
      {
        id: "respectable-rating",
        labelKey: "scenario.goal.respectable.label", label: text("scenario.goal.respectable.label"),
        descriptionKey: "scenario.goal.respectable.description", description: text("scenario.goal.respectable.description"),
        conditions: [{ metric: "courseRating", comparator: ">=", target: 67 }],
      },
    ],
  },
  {
    id: "links-by-the-sea",
    order: 4,
    nameKey: "scenario.links.name", name: text("scenario.links.name"),
    blurbKey: "scenario.links.blurb", blurb: text("scenario.links.blurb"),
    seed: 90404,
    theme: "links",
    biomeCompatibility: biomeCompatibilityMetadataFor("links"),
    experienceProfile: "classic",
    economicPressure: "balanced",
    constraints: { protectedTrees: true },
    goals: [
      {
        id: "real-links",
        labelKey: "scenario.goal.routLinks.label", label: text("scenario.goal.routLinks.label"),
        descriptionKey: "scenario.goal.routLinks.description", description: text("scenario.goal.routLinks.description"),
        conditions: [{ metric: "holesBuilt", comparator: ">=", target: 9 }],
      },
      {
        id: "championship-rating",
        labelKey: "scenario.goal.properTest.label", label: text("scenario.goal.properTest.label"),
        descriptionKey: "scenario.goal.properTest.description", description: text("scenario.goal.properTest.description"),
        conditions: [{ metric: "courseRating", comparator: ">=", target: 70 }],
      },
    ],
  },
  {
    id: "members-club",
    order: 5,
    nameKey: "scenario.members.name", name: text("scenario.members.name"),
    blurbKey: "scenario.members.blurb", blurb: text("scenario.members.blurb"),
    seed: 90505,
    theme: "parkland",
    biomeCompatibility: biomeCompatibilityMetadataFor("parkland"),
    experienceProfile: "simulation",
    economicPressure: "tight",
    startingCash: 40_000,
    startingReputation: 55,
    fixture: "members",
    constraints: { fixedGreenFee: 110 },
    goals: [
      {
        id: "prestige",
        labelKey: "scenario.goal.prestige.label", label: text("scenario.goal.prestige.label"),
        descriptionKey: "scenario.goal.prestige.description", description: text("scenario.goal.prestige.description"),
        conditions: [{ metric: "reputation", comparator: ">=", target: 75 }],
      },
      {
        id: "steady-books",
        labelKey: "scenario.goal.steadyBooks.label", label: text("scenario.goal.steadyBooks.label"),
        descriptionKey: "scenario.goal.steadyBooks.description", description: text("scenario.goal.steadyBooks.description"),
        conditions: [{ metric: "profitStreak", comparator: ">=", target: 3 }],
      },
    ],
  },
  {
    id: "championship-dream",
    order: 6,
    nameKey: "scenario.championship.name", name: text("scenario.championship.name"),
    blurbKey: "scenario.championship.blurb", blurb: text("scenario.championship.blurb"),
    seed: 90666,
    theme: "parkland",
    biomeCompatibility: biomeCompatibilityMetadataFor("parkland"),
    experienceProfile: "simulation",
    economicPressure: "tight",
    goals: [
      {
        id: "full-course",
        labelKey: "scenario.goal.fullCourse.label", label: text("scenario.goal.fullCourse.label"),
        descriptionKey: "scenario.goal.fullCourse.description", description: text("scenario.goal.fullCourse.description"),
        conditions: [{ metric: "holesBuilt", comparator: ">=", target: 9 }],
      },
      {
        id: "tour-quality",
        labelKey: "scenario.goal.tourQuality.label", label: text("scenario.goal.tourQuality.label"),
        descriptionKey: "scenario.goal.tourQuality.description", description: text("scenario.goal.tourQuality.description"),
        conditions: [
          { metric: "courseRating", comparator: ">=", target: 72 },
          { metric: "reputation", comparator: ">=", target: 80 },
        ],
      },
      {
        id: "war-chest",
        labelKey: "scenario.goal.warChest.label", label: text("scenario.goal.warChest.label"),
        descriptionKey: "scenario.goal.warChest.description", description: text("scenario.goal.warChest.description"),
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
  const campaign = CAMPAIGN_CHAPTER_BY_ID.get(s.id);
  const initialGoals = campaign?.phases[0].goals ?? s.goals;
  const base = createNewGame(
    {
      mode: "career",
      courseName: s.courseName ?? s.name,
      seed: s.seed,
      theme: s.theme,
      experienceProfile: s.experienceProfile,
      economicPressure: s.economicPressure,
    },
    initialGoals
  );

  const course = {
    ...(s.fixture ? buildFixtureCourse(s.fixture, s.seed) : base.course),
    theme: s.theme,
    biomeCompatibility: s.biomeCompatibility,
  };

  const world: World = {
    ...base.world,
    ...(s.startingCash != null ? { cash: s.startingCash } : {}),
    ...(s.startingReputation != null ? { reputation: s.startingReputation } : {}),
    scenarioId: s.id,
    ...(s.constraints ? { constraints: s.constraints } : {}),
    objectives: createObjectiveState(initialGoals),
    ...(campaign ? {
      campaign: createCampaignRun(
        s.id,
        base.world.seasonal?.charter ?? "public-gem",
        loadCareer().campaignChoices,
        base.world.week,
      ),
    } : {}),
  };
  if (s.id === "muni-rescue" && world.livingClub && !world.livingClub.regulars.some((regular) => regular.id === "campaign-jamie")) {
    world.livingClub = {
      ...world.livingClub,
      regulars: [{
        id: "campaign-jamie",
        kind: "regular",
        name: "Jamie Chen",
        archetype: "junior",
        appearance: { portrait: "sport", palette: 3, accent: 1 },
        skill: 0.52,
        preferences: { pace: "balanced", challenge: "competitive", hospitality: "simple" },
        loyalty: 62,
        visits: 3,
        rounds: 3,
        bestToPar: 5,
        member: false,
        relationship: { score: 12, tier: "acquaintance", interactionIds: [] },
        memories: [{
          id: "campaign-jamie-muni-promise",
          week: 1,
          kind: "relationship",
          summary: text("campaign.muni.jamie.memory"),
          immutable: true,
        }],
        recentThoughts: [text("campaign.muni.jamie.thought")],
        history: [],
      }, ...world.livingClub.regulars],
    };
  }
  if (s.constraints?.fixedGreenFee != null) course.baseGreenFee = s.constraints.fixedGreenFee;

  return { course, world };
}
