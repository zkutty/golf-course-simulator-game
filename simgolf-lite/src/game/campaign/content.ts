import { translate } from "../../i18n/core";
import type { GoalCondition, GoalDefinition } from "../models/objectives";
import type {
  CampaignChapterDefinition,
  CampaignCharacterDefinition,
  CampaignChoiceDefinition,
  CampaignEffect,
  CampaignFact,
  CampaignMatchDefinition,
  CampaignMedalDefinition,
  CampaignPhaseDefinition,
  CampaignPredicate,
  CampaignSceneDefinition,
} from "./types";
import { campaignCurriculum } from "./profileContract";
import { ADVANCED_SYSTEM_IDS } from "../experience/systemControl";

const text = (key: Parameters<typeof translate>[1]) => translate("en", key);

const goal = (
  id: string,
  labelKey: Parameters<typeof translate>[1],
  descriptionKey: Parameters<typeof translate>[1],
  conditions: GoalCondition[],
  deadlineWeek?: number,
): GoalDefinition => ({
  id,
  labelKey,
  label: text(labelKey),
  descriptionKey,
  description: text(descriptionKey),
  conditions,
  ...(deadlineWeek == null ? {} : { deadlineWeek }),
});

const phase = (
  id: string,
  titleKey: Parameters<typeof translate>[1],
  summaryKey: Parameters<typeof translate>[1],
  goals: GoalDefinition[],
): CampaignPhaseDefinition => ({
  id,
  titleKey,
  summaryKey,
  goals,
  ...phaseContract(id),
  introSceneId: `${id}-intro`,
  completionSceneId: `${id}-complete`,
  curriculumSystems: campaignCurriculum(
    id.startsWith("championship-") ? "championship-dream" : "",
    id === "championship-qualify" ? 0 : id === "championship-stage" ? 1 : 2,
  ),
});

const option = (
  id: string,
  labelKey: Parameters<typeof translate>[1],
  previewKey: Parameters<typeof translate>[1],
  effects: CampaignEffect[],
  callbackFact?: string,
): CampaignChoiceDefinition => ({ id, labelKey, previewKey, effects, callbackFact });

const scene = (
  id: string,
  speaker: CampaignSceneDefinition["speaker"],
  titleKey: Parameters<typeof translate>[1],
  bodyKey: Parameters<typeof translate>[1],
  choices: CampaignChoiceDefinition[],
  expression: CampaignSceneDefinition["expression"] = "neutral",
  factKeys: CampaignFact[] = ["cash", "reputation", "condition", "week"],
): CampaignSceneDefinition => ({
  id,
  speaker,
  titleKey,
  bodyKey,
  expression,
  choices: choices.map((choice) => ({
    ...choice,
    effects: [
      ...choice.effects,
      { type: "relationship", characterId: speaker, amount: choice.id === "listen" || choice.id === "study" ? 2 : 1 },
      ...(choice.callbackFact ? [
        { type: "eventPool", eventId: choice.callbackFact } as const,
        { type: "epilogueFact", fact: choice.callbackFact } as const,
      ] : []),
    ],
  })),
  defaultChoiceId: choices[0].id,
  factKeys,
});

const pred = (fact: CampaignFact, op: CampaignPredicate["op"], value: number): CampaignPredicate => ({ fact, op, value });
const medals = (silver: readonly CampaignPredicate[], gold: readonly CampaignPredicate[]): CampaignChapterDefinition["medals"] => [
  { medal: "bronze", labelKey: "campaign.medal.bronze", descriptionKey: "campaign.medal.bronze.description", predicates: [] },
  { medal: "silver", labelKey: "campaign.medal.silver", descriptionKey: "campaign.medal.silver.description", predicates: silver },
  { medal: "gold", labelKey: "campaign.medal.gold", descriptionKey: "campaign.medal.gold.description", predicates: gold },
];

const introChoices = [
  option("listen", "campaign.choice.listen", "campaign.preview.listen", []),
  option("commit", "campaign.choice.commit", "campaign.preview.commit", [{ type: "reputation", amount: 1 }], "committed"),
];
const practicalChoices = [
  option("invest", "campaign.choice.invest", "campaign.preview.invest", [{ type: "cash", amount: -750 }, { type: "condition", amount: 0.04 }], "invested"),
  option("adapt", "campaign.choice.adapt", "campaign.preview.adapt", [{ type: "reputation", amount: 1 }], "adapted"),
];
const communityChoices = [
  option("open", "campaign.choice.open", "campaign.preview.open", [{ type: "cash", amount: -300 }, { type: "reputation", amount: 2 }], "community-open"),
  option("balance", "campaign.choice.balance", "campaign.preview.balance", [{ type: "reputation", amount: 1 }], "community-balanced"),
];
const rivalryChoices = [
  option("accept", "campaign.choice.accept", "campaign.preview.accept", [{ type: "reputation", amount: 1 }, { type: "scheduleScene", sceneId: "rival-callback", delayWeeks: 2 }], "rival-accepted"),
  option("study", "campaign.choice.study", "campaign.preview.study", [{ type: "condition", amount: 0.02 }], "rival-studied"),
];

const match = (
  id: string,
  kind: CampaignMatchDefinition["kind"],
  opponent: CampaignMatchDefinition["opponent"],
  minCareerPoints: number,
): CampaignMatchDefinition => ({
  id,
  kind,
  titleKey: `campaign.match.${kind}.title`,
  descriptionKey: `campaign.match.${kind}.description`,
  ...(opponent ? { opponent } : { tournamentTier: "championship" as const }),
  minCareerPoints,
});

function phaseContract(id: string): Pick<CampaignPhaseDefinition, "requirements" | "recoveryKey" | "estimatedMinutes" | "match"> {
  const base = {
    requirements: [] as CampaignPredicate[],
    recoveryKey: "campaign.recovery.standard" as const,
    estimatedMinutes: 45,
  };
  const contracts: Record<string, Partial<Pick<CampaignPhaseDefinition, "requirements" | "recoveryKey" | "estimatedMinutes" | "match">>> = {
    "back-nine-discover": { estimatedMinutes: 35, recoveryKey: "campaign.recovery.backNineBuild" },
    "back-nine-prove": {
      requirements: [pred("playerCareerRounds", "gte", 1), pred("architectureEvidence", "gte", 1)],
      recoveryKey: "campaign.recovery.backNinePlay",
      estimatedMinutes: 55,
    },
    "back-nine-open": {
      match: match("back-nine-opening-match", "opening", { id: "rowan-opening", characterId: "rowan", name: "Rowan Vale", skill: 0.46 }, 3),
      recoveryKey: "campaign.recovery.openingMatch",
      estimatedMinutes: 50,
    },
    "muni-stabilize": { recoveryKey: "campaign.recovery.muniCondition", estimatedMinutes: 40 },
    "muni-trust": { requirements: [pred("staffLevel", "gte", 1)], recoveryKey: "campaign.recovery.muniTrust", estimatedMinutes: 45 },
    "muni-match": {
      match: match("muni-local-match", "local", { id: "jamie-local", characterId: "jamie", name: "Jamie Chen", skill: 0.52 }, 3),
      recoveryKey: "campaign.recovery.localMatch",
      estimatedMinutes: 50,
    },
    "swamp-survey": { recoveryKey: "campaign.recovery.swampRoute", estimatedMinutes: 45 },
    "swamp-recover": { requirements: [pred("drainageLevel", "gte", 0)], recoveryKey: "campaign.recovery.swampWeather", estimatedMinutes: 55 },
    "swamp-rival": {
      match: match("swamp-rival-match", "rival", { id: "mara-swamp", characterId: "mara", name: "Mara Voss", skill: 0.7 }, 8),
      recoveryKey: "campaign.recovery.rivalMatch",
      estimatedMinutes: 55,
    },
    "links-read": { recoveryKey: "campaign.recovery.linksRoute", estimatedMinutes: 45 },
    "links-wind": {
      requirements: [pred("playerCareerRounds", "gte", 1)],
      recoveryKey: "campaign.recovery.linksWind",
      estimatedMinutes: 55,
    },
    "links-rival": {
      match: match("links-rival-match", "rival", { id: "mara-links", characterId: "mara", name: "Mara Voss", skill: 0.78 }, 8),
      recoveryKey: "campaign.recovery.rivalMatch",
      estimatedMinutes: 55,
    },
    "members-listen": { recoveryKey: "campaign.recovery.membersListen", estimatedMinutes: 40 },
    "members-balance": { requirements: [pred("staffLevel", "gte", 1)], recoveryKey: "campaign.recovery.membersBooks", estimatedMinutes: 50 },
    "members-match": {
      match: match("members-club-match", "club", { id: "beatrice-club", characterId: "beatrice", name: "Beatrice Shaw", skill: 0.68 }, 8),
      recoveryKey: "campaign.recovery.clubMatch",
      estimatedMinutes: 55,
    },
    "championship-qualify": {
      requirements: [pred("playerCareerPoints", "gte", 9)],
      recoveryKey: "campaign.recovery.championshipQualify",
      estimatedMinutes: 55,
    },
    "championship-stage": {
      requirements: [pred("playerSkillAverage", "gte", 40), pred("architectureEvidence", "gte", 1)],
      recoveryKey: "campaign.recovery.championshipStage",
      estimatedMinutes: 60,
    },
    "championship-final": {
      match: match("championship-final", "championship", undefined, 12),
      recoveryKey: "campaign.recovery.championshipFinal",
      estimatedMinutes: 70,
    },
  };
  return { ...base, ...contracts[id] };
}

export const CAMPAIGN_CAST: readonly CampaignCharacterDefinition[] = [
  {
    id: "rowan",
    name: "Rowan Vale",
    roleKey: "campaign.cast.rowan.role",
    portrait: { assetId: "campaign-rowan", expressions: { neutral: 0, warm: 1, concerned: 2, celebrating: 3 }, worldSprite: "advisor-caddie" },
    chapters: ["back-nine", "muni-rescue", "championship-dream"],
    gameplayRole: "Advisor and caddie who teaches the build-play-redesign loop without prescribing one layout.",
    voiceNotes: "Warm, economical, observant; speaks in evidence and golf decisions.",
    motivations: ["Help the Player Pro become self-sufficient", "Protect honest recovery paths"],
    relationships: { mara: "Respects Mara's rigor but challenges her certainty.", jamie: "Patient mentor who never speaks for Jamie." },
    stateTriggers: ["playerCareerRounds", "architectureEvidence", "cash"],
    choiceReactions: ["Warms when the player studies evidence.", "Pushes back when investment outruns a credible recovery path."],
    artRequirements: ["Original advisor silhouette", "Four 96px expression crops", "Caddie world sprite", "No licensed-character costume cues"],
    localizationNotes: "Avoid idioms about reading greens; keep sentences compact for UI expansion.",
    epilogueOutcomes: ["Trusted caddie", "Independent mentor"],
  },
  {
    id: "mara",
    name: "Mara Voss",
    roleKey: "campaign.cast.mara.role",
    portrait: { assetId: "campaign-mara", expressions: { neutral: 0, warm: 1, concerned: 2, celebrating: 3 }, worldSprite: "golfer-rival" },
    chapters: ["swamp-deal", "links-by-the-sea", "championship-dream"],
    gameplayRole: "Rival architect whose playable matches expose different strategic readings of the same land.",
    voiceNotes: "Precise, competitive, never villainous; critiques geometry rather than taste.",
    motivations: ["Prove restraint beats spectacle", "Earn the championship commission"],
    relationships: { rowan: "Friendly methodological disagreement.", eli: "Trusts his agronomic constraints.", jamie: "Sees a future competitor rather than a mascot." },
    stateTriggers: ["architectureEvidence", "playerMatchWins", "severeForecastDays"],
    choiceReactions: ["Respects completed matches regardless of result.", "Challenges claims unsupported by played-shot evidence."],
    artRequirements: ["Original architect/rival silhouette", "Four 96px expression crops", "Golfer world sprite", "Readable drafting-roll prop"],
    localizationNotes: "Golf strategy terms must use the shared glossary; rivalry remains respectful in every locale.",
    epilogueOutcomes: ["Respected rival", "Design collaborator"],
  },
  {
    id: "eli",
    name: "Eli Mercer",
    roleKey: "campaign.cast.eli.role",
    portrait: { assetId: "campaign-eli", expressions: { neutral: 0, warm: 1, concerned: 2, celebrating: 3 }, worldSprite: "staff-superintendent" },
    chapters: ["muni-rescue", "swamp-deal", "members-club", "championship-dream"],
    gameplayRole: "Superintendent who grounds weather, condition, staffing, and protected-land tradeoffs.",
    voiceNotes: "Dry, practical, proud of invisible work.",
    motivations: ["Keep turf promises realistic", "Build a team that can survive pressure"],
    relationships: { nadia: "Operational counterpart on public promises.", beatrice: "Will challenge standards that ignore staffing.", mara: "Values her restraint on vulnerable land." },
    stateTriggers: ["condition", "staffLevel", "drainageLevel", "severeForecastDays"],
    choiceReactions: ["Supports funded recovery.", "Names the labor cost of presentation-first choices."],
    artRequirements: ["Original superintendent silhouette", "Four 96px expression crops", "Workwear world sprite", "Weather-safe outerwear variant"],
    localizationNotes: "Keep agronomy plain-language and preserve units through formatted values.",
    epilogueOutcomes: ["Master superintendent", "Sustainable-operations advocate"],
  },
  {
    id: "beatrice",
    name: "Beatrice Shaw",
    roleKey: "campaign.cast.beatrice.role",
    portrait: { assetId: "campaign-beatrice", expressions: { neutral: 0, warm: 1, concerned: 2, celebrating: 3 }, worldSprite: "staff-captain" },
    chapters: ["members-club", "championship-dream"],
    gameplayRole: "Club captain who represents members without reducing the charter conflict to prestige versus access.",
    voiceNotes: "Formal, candid, capable of changing her mind when facts change.",
    motivations: ["Protect standards", "Keep the club socially coherent"],
    relationships: { eli: "Mutual respect with recurring budget tension.", nadia: "Debates access without treating the community as an abstraction.", jamie: "Initially cautious, eventually protective." },
    stateTriggers: ["greenFee", "reputation", "regularCount", "staffLevel"],
    choiceReactions: ["Rewards coherent charter promises.", "Changes position when staff and community facts contradict assumptions."],
    artRequirements: ["Original captain silhouette", "Four 96px expression crops", "Formal world sprite", "Non-branded club insignia"],
    localizationNotes: "Formality should survive translation without aristocratic or gendered stereotypes.",
    epilogueOutcomes: ["Reforming captain", "Keeper of tradition"],
  },
  {
    id: "nadia",
    name: "Nadia Okafor",
    roleKey: "campaign.cast.nadia.role",
    portrait: { assetId: "campaign-nadia", expressions: { neutral: 0, warm: 1, concerned: 2, celebrating: 3 }, worldSprite: "staff-planner" },
    chapters: ["muni-rescue", "swamp-deal", "members-club", "championship-dream"],
    gameplayRole: "Town planner who connects prices, access, safety, protected land, and community promises to live facts.",
    voiceNotes: "Measured and specific; separates public obligations from personal preference.",
    motivations: ["Make growth legible", "Keep public promises auditable"],
    relationships: { eli: "Turns his operating facts into public commitments.", beatrice: "Constructive institutional counterweight.", jamie: "Listens directly and verifies outcomes." },
    stateTriggers: ["greenFee", "accessCapacity", "cash", "reputation"],
    choiceReactions: ["Records access commitments.", "Questions prestige claims that do not match measured capacity."],
    artRequirements: ["Original planner silhouette", "Four 96px expression crops", "Planner world sprite", "Readable map-table prop"],
    localizationNotes: "Civic terminology must remain jurisdiction-neutral and avoid culture-specific bureaucracy jokes.",
    epilogueOutcomes: ["Long-term planning partner", "Independent civic watchdog"],
  },
  {
    id: "jamie",
    name: "Jamie Chen",
    roleKey: "campaign.cast.jamie.role",
    portrait: { assetId: "campaign-jamie", expressions: { neutral: 0, warm: 1, concerned: 2, celebrating: 3 }, worldSprite: "golfer-junior" },
    chapters: ["muni-rescue", "links-by-the-sea", "members-club", "championship-dream"],
    gameplayRole: "Young regular whose stable identity makes access, trust, and long-term club legacy personal.",
    voiceNotes: "Curious, direct, golf-literate without sounding like an adult proxy.",
    motivations: ["Find a place to belong", "Become a fearless links player"],
    relationships: { rowan: "Learns from Rowan without copying him.", mara: "Aspires to challenge her one day.", beatrice: "Tests whether club promises include the next generation." },
    stateTriggers: ["regularCount", "greenFee", "playerCareerRounds", "reputation"],
    choiceReactions: ["Remembers whether access stayed affordable.", "Responds to played matches and repeat visits rather than speeches."],
    artRequirements: ["Original junior-golfer silhouette", "Four 96px expression crops", "Junior golfer world sprite", "Age-appropriate non-branded kit"],
    localizationNotes: "Keep voice direct and age-appropriate; avoid slang that dates quickly or localizes poorly.",
    epilogueOutcomes: ["Club champion", "Community coach"],
  },
] as const;

const chapterData = [
  {
    id: "back-nine",
    phases: [
      phase("back-nine-discover", "campaign.phase.backNine.1.title", "campaign.phase.backNine.1.summary", [
        goal("first-hole", "campaign.goal.firstHole", "campaign.goal.firstHole.description", [{ metric: "holesBuilt", comparator: ">=", target: 1 }], 8),
      ]),
      phase("back-nine-prove", "campaign.phase.backNine.2.title", "campaign.phase.backNine.2.summary", [
        goal("play-the-proof", "campaign.goal.playProof", "campaign.goal.playProof.description", [{ metric: "holesBuilt", comparator: ">=", target: 3 }, { metric: "totalRounds", comparator: ">=", target: 1 }], 18),
      ]),
      phase("back-nine-open", "campaign.phase.backNine.3.title", "campaign.phase.backNine.3.summary", [
        goal("open-the-course", "campaign.goal.openCourse", "campaign.goal.openCourse.description", [{ metric: "profitStreak", comparator: ">=", target: 1 }], 28),
      ]),
    ],
    speakers: ["rowan", "rowan", "rowan"] as const,
    choices: [introChoices, practicalChoices, communityChoices],
    complicationSpeaker: "rowan" as const,
    silver: [pred("week", "lte", 24)],
    gold: [pred("week", "lte", 18), pred("architectureEvidence", "gte", 3)],
  },
  {
    id: "muni-rescue",
    phases: [
      phase("muni-stabilize", "campaign.phase.muni.1.title", "campaign.phase.muni.1.summary", [
        goal("restore-basics", "campaign.goal.restoreBasics", "campaign.goal.restoreBasics.description", [{ metric: "condition", comparator: ">=", target: 55 }], 12),
      ]),
      phase("muni-trust", "campaign.phase.muni.2.title", "campaign.phase.muni.2.summary", [
        goal("restore-trust", "campaign.goal.restoreTrust", "campaign.goal.restoreTrust.description", [{ metric: "reputation", comparator: ">=", target: 40 }], 24),
      ]),
      phase("muni-match", "campaign.phase.muni.3.title", "campaign.phase.muni.3.summary", [
        goal("local-match", "campaign.goal.localMatch", "campaign.goal.localMatch.description", [{ metric: "totalRounds", comparator: ">=", target: 5 }, { metric: "reputation", comparator: ">=", target: 55 }], 36),
      ]),
    ],
    speakers: ["nadia", "eli", "jamie"] as const,
    choices: [communityChoices, practicalChoices, rivalryChoices],
    complicationSpeaker: "jamie" as const,
    silver: [pred("reputation", "gte", 60)],
    gold: [pred("reputation", "gte", 68), pred("regularCount", "gte", 1)],
  },
  {
    id: "swamp-deal",
    phases: [
      phase("swamp-survey", "campaign.phase.swamp.1.title", "campaign.phase.swamp.1.summary", [
        goal("dry-route", "campaign.goal.dryRoute", "campaign.goal.dryRoute.description", [{ metric: "holesBuilt", comparator: ">=", target: 3 }], 14),
      ]),
      phase("swamp-recover", "campaign.phase.swamp.2.title", "campaign.phase.swamp.2.summary", [
        goal("weather-proof", "campaign.goal.weatherProof", "campaign.goal.weatherProof.description", [{ metric: "holesBuilt", comparator: ">=", target: 6 }, { metric: "courseRating", comparator: ">=", target: 63 }], 28),
      ]),
      phase("swamp-rival", "campaign.phase.swamp.3.title", "campaign.phase.swamp.3.summary", [
        goal("swamp-rival", "campaign.goal.rivalMatch", "campaign.goal.rivalMatch.description", [{ metric: "holesBuilt", comparator: ">=", target: 9 }, { metric: "courseRating", comparator: ">=", target: 67 }], 42),
      ]),
    ],
    speakers: ["eli", "nadia", "mara"] as const,
    choices: [practicalChoices, communityChoices, rivalryChoices],
    complicationSpeaker: "eli" as const,
    silver: [pred("cash", "gte", 10_000)],
    gold: [pred("cash", "gte", 25_000), pred("architectureEvidence", "gte", 6)],
  },
  {
    id: "links-by-the-sea",
    phases: [
      phase("links-read", "campaign.phase.links.1.title", "campaign.phase.links.1.summary", [
        goal("find-routing", "campaign.goal.findRouting", "campaign.goal.findRouting.description", [{ metric: "holesBuilt", comparator: ">=", target: 3 }], 14),
      ]),
      phase("links-wind", "campaign.phase.links.2.title", "campaign.phase.links.2.summary", [
        goal("wind-test", "campaign.goal.windTest", "campaign.goal.windTest.description", [{ metric: "holesBuilt", comparator: ">=", target: 6 }, { metric: "courseRating", comparator: ">=", target: 66 }], 28),
      ]),
      phase("links-rival", "campaign.phase.links.3.title", "campaign.phase.links.3.summary", [
        goal("links-rival", "campaign.goal.rivalMatch", "campaign.goal.rivalMatch.description", [{ metric: "holesBuilt", comparator: ">=", target: 9 }, { metric: "courseRating", comparator: ">=", target: 70 }], 42),
      ]),
    ],
    speakers: ["mara", "jamie", "mara"] as const,
    choices: [introChoices, practicalChoices, rivalryChoices],
    complicationSpeaker: "mara" as const,
    silver: [pred("architectureEvidence", "gte", 5)],
    gold: [pred("architectureEvidence", "gte", 10), pred("condition", "gte", 75)],
  },
  {
    id: "members-club",
    phases: [
      phase("members-listen", "campaign.phase.members.1.title", "campaign.phase.members.1.summary", [
        goal("listen-members", "campaign.goal.listenMembers", "campaign.goal.listenMembers.description", [{ metric: "reputation", comparator: ">=", target: 65 }], 14),
      ]),
      phase("members-balance", "campaign.phase.members.2.title", "campaign.phase.members.2.summary", [
        goal("balance-books", "campaign.goal.balanceBooks", "campaign.goal.balanceBooks.description", [{ metric: "profitStreak", comparator: ">=", target: 1 }], 28),
      ]),
      phase("members-match", "campaign.phase.members.3.title", "campaign.phase.members.3.summary", [
        goal("club-match", "campaign.goal.clubMatch", "campaign.goal.clubMatch.description", [{ metric: "reputation", comparator: ">=", target: 75 }, { metric: "profitStreak", comparator: ">=", target: 3 }, { metric: "totalRounds", comparator: ">=", target: 15 }], 44),
      ]),
    ],
    speakers: ["beatrice", "eli", "jamie"] as const,
    choices: [introChoices, practicalChoices, communityChoices],
    complicationSpeaker: "beatrice" as const,
    silver: [pred("reputation", "gte", 80)],
    gold: [pred("reputation", "gte", 88), pred("regularCount", "gte", 2)],
  },
  {
    id: "championship-dream",
    phases: [
      phase("championship-qualify", "campaign.phase.championship.1.title", "campaign.phase.championship.1.summary", [
        goal("property-ready", "campaign.goal.propertyReady", "campaign.goal.propertyReady.description", [{ metric: "publishedCourses", comparator: ">=", target: 1 }, { metric: "holesBuilt", comparator: ">=", target: 18 }], 20),
      ]),
      phase("championship-stage", "campaign.phase.championship.2.title", "campaign.phase.championship.2.summary", [
        goal("tour-ready", "campaign.goal.tourReady", "campaign.goal.tourReady.description", [{ metric: "courseRating", comparator: ">=", target: 72 }, { metric: "reputation", comparator: ">=", target: 80 }], 40),
      ]),
      phase("championship-final", "campaign.phase.championship.3.title", "campaign.phase.championship.3.summary", [
        goal("finale", "campaign.goal.finale", "campaign.goal.finale.description", [{ metric: "cash", comparator: ">=", target: 150_000 }, { metric: "totalRounds", comparator: ">=", target: 25 }], 60),
      ]),
    ],
    speakers: ["nadia", "mara", "rowan"] as const,
    choices: [communityChoices, rivalryChoices, introChoices],
    complicationSpeaker: "rowan" as const,
    silver: [pred("week", "lte", 52), pred("playerCareerPoints", "gte", 12)],
    gold: [pred("week", "lte", 44), pred("playerCareerPoints", "gte", 20), pred("scheduledTournaments", "gte", 1)],
  },
] as const;

function buildChapter(raw: (typeof chapterData)[number]): CampaignChapterDefinition {
  const scenes: CampaignSceneDefinition[] = [];
  raw.phases.forEach((item, index) => {
    const facts: CampaignFact[] = raw.id === "muni-rescue"
      ? ["cash", "condition", "greenFee", "accessCapacity", "staffLevel", "regularCount"]
      : raw.id === "swamp-deal" || raw.id === "links-by-the-sea"
        ? ["cash", "condition", "severeForecastDays", "drainageLevel", "architectureEvidence"]
        : raw.id === "members-club"
          ? ["cash", "reputation", "greenFee", "staffLevel", "regularCount"]
          : raw.id === "championship-dream"
            ? ["reputation", "playerCareerPoints", "playerSkillAverage", "scheduledTournaments", "legacyYears"]
            : ["cash", "condition", "playerCareerRounds", "architectureEvidence"];
    scenes.push(scene(item.introSceneId, raw.speakers[index], item.titleKey, item.summaryKey, raw.choices[index], index === 2 ? "concerned" : "neutral", facts));
    scenes.push(scene(item.completionSceneId!, raw.speakers[index], "campaign.scene.progress.title", "campaign.scene.progress.body", introChoices, "warm"));
  });
  const complicationFacts: Record<string, [CampaignFact[], CampaignFact[]]> = {
    "back-nine": [["condition", "playerCareerRounds"], ["cash", "architectureEvidence"]],
    "muni-rescue": [["condition", "staffLevel"], ["greenFee", "accessCapacity", "regularCount"]],
    "swamp-deal": [["severeForecastDays", "drainageLevel"], ["cash", "architectureEvidence"]],
    "links-by-the-sea": [["severeForecastDays", "playerCareerRounds"], ["condition", "architectureEvidence"]],
    "members-club": [["greenFee", "staffLevel"], ["reputation", "regularCount"]],
    "championship-dream": [["playerCareerPoints", "playerSkillAverage"], ["scheduledTournaments", "legacyYears"]],
  };
  scenes.push(scene(`${raw.id}-complication-a`, raw.complicationSpeaker, "campaign.scene.complication.title", "campaign.scene.complication.body", practicalChoices, "concerned", complicationFacts[raw.id][0]));
  scenes.push(scene(`${raw.id}-complication-b`, raw.complicationSpeaker, "campaign.scene.choice.title", "campaign.scene.choice.body", communityChoices, "concerned", complicationFacts[raw.id][1]));
  scenes.push(scene("rival-callback", "mara", "campaign.scene.callback.title", "campaign.scene.callback.body", introChoices, "warm"));
  const complicationsByChapter: Record<string, [CampaignPredicate[], CampaignPredicate[]]> = {
    "back-nine": [[pred("condition", "lte", 85)], [pred("architectureEvidence", "gte", 1)]],
    "muni-rescue": [[pred("condition", "lte", 65)], [pred("regularCount", "gte", 1)]],
    "swamp-deal": [[pred("severeForecastDays", "gte", 1)], [pred("drainageLevel", "lte", 1)]],
    "links-by-the-sea": [[pred("severeForecastDays", "gte", 1)], [pred("architectureEvidence", "gte", 2)]],
    "members-club": [[pred("greenFee", "eq", 110)], [pred("staffLevel", "lte", 2)]],
    "championship-dream": [[pred("playerCareerPoints", "gte", 9)], [pred("playerSkillAverage", "lte", 55)]],
  };
  return {
    id: raw.id,
    phases: raw.phases,
    complications: [
      { id: `${raw.id}-pressure`, phaseId: raw.phases[1].id, predicates: complicationsByChapter[raw.id][0], sceneId: `${raw.id}-complication-a`, factKeys: complicationFacts[raw.id][0], recoveryKey: raw.phases[1].recoveryKey },
      { id: `${raw.id}-choice`, phaseId: raw.phases[2].id, predicates: complicationsByChapter[raw.id][1], sceneId: `${raw.id}-complication-b`, factKeys: complicationFacts[raw.id][1], recoveryKey: raw.phases[2].recoveryKey },
    ],
    scenes,
    medals: medals(raw.silver, raw.gold),
    rewards: [`campaign-unlock-${raw.id}`, `campaign-cosmetic-${raw.id}`],
    supportedCharters: ["public-gem", "championship-venue", "destination-retreat", "member-institution"],
    epilogueKey: "campaign.epilogue.summary",
  };
}

export const CAMPAIGN_CHAPTERS: readonly CampaignChapterDefinition[] = chapterData.map(buildChapter);
export const CAMPAIGN_CHAPTER_BY_ID = new Map(CAMPAIGN_CHAPTERS.map((chapter) => [chapter.id, chapter]));
export const CAMPAIGN_CHARACTER_BY_ID = new Map(CAMPAIGN_CAST.map((character) => [character.id, character]));

function validateMedal(medal: CampaignMedalDefinition, errors: string[], chapterId: string) {
  if (!medal.labelKey || !medal.descriptionKey) errors.push(`medal-copy:${chapterId}:${medal.medal}`);
  if (medal.predicates.some((item) => !Number.isFinite(item.value))) errors.push(`medal-predicate:${chapterId}:${medal.medal}`);
}

export function validateCampaignContent(chapters: readonly CampaignChapterDefinition[] = CAMPAIGN_CHAPTERS): string[] {
  const errors: string[] = [];
  const chapterIds = new Set<string>();
  for (const chapter of chapters) {
    if (!chapter.id || chapterIds.has(chapter.id)) errors.push(`chapter:${chapter.id}`);
    chapterIds.add(chapter.id);
    if (chapter.phases.length !== 3) errors.push(`phases:${chapter.id}`);
    const phaseIds = new Set<string>();
    for (const item of chapter.phases) {
      if (!item.id || phaseIds.has(item.id) || item.goals.length === 0) errors.push(`phase:${chapter.id}:${item.id}`);
      phaseIds.add(item.id);
      if (!item.introSceneId || !item.goals.every((entry) => entry.conditions.length > 0)) errors.push(`phase-content:${chapter.id}:${item.id}`);
      if (!item.recoveryKey || item.estimatedMinutes < 20 || item.estimatedMinutes > 90) errors.push(`phase-recovery:${chapter.id}:${item.id}`);
      if (item.curriculumSystems.some((system) => !ADVANCED_SYSTEM_IDS.includes(system))) errors.push(`phase-curriculum-system:${chapter.id}:${item.id}`);
      if (item.match && (!item.match.id || item.match.minCareerPoints < 0 || (item.match.kind === "championship") !== Boolean(item.match.tournamentTier))) {
        errors.push(`phase-match:${chapter.id}:${item.id}`);
      }
    }
    const expectedCurriculumLengths = chapter.id === "championship-dream" ? [5, 10, 13] : [0, 0, 0];
    if (chapter.phases.some((item, index) => item.curriculumSystems.length !== expectedCurriculumLengths[index])) {
      errors.push(`phase-curriculum:${chapter.id}`);
    }
    if (chapter.id === "championship-dream" && chapter.phases.some((item, index) =>
      item.curriculumSystems.some((system) => !chapter.phases[Math.min(2, index + 1)].curriculumSystems.includes(system)))) {
      errors.push(`phase-curriculum-cumulative:${chapter.id}`);
    }
    const sceneIds = new Set(chapter.scenes.map((item) => item.id));
    for (const item of chapter.scenes) {
      if (!item.choices.length || !item.choices.some((candidate) => candidate.id === item.defaultChoiceId)) errors.push(`scene:${chapter.id}:${item.id}`);
      for (const choice of item.choices) for (const effect of choice.effects) {
        if (effect.type === "scheduleScene" && !sceneIds.has(effect.sceneId)) errors.push(`callback:${chapter.id}:${item.id}:${effect.sceneId}`);
      }
    }
    for (const complication of chapter.complications) {
      if (!phaseIds.has(complication.phaseId) || !sceneIds.has(complication.sceneId) || !complication.factKeys.length || !complication.recoveryKey) errors.push(`complication:${chapter.id}:${complication.id}`);
    }
    chapter.medals.forEach((medal) => validateMedal(medal, errors, chapter.id));
    if (chapter.supportedCharters.length !== 4 || chapter.rewards.length < 2 || !chapter.epilogueKey) errors.push(`chapter-contract:${chapter.id}`);
  }
  if (CAMPAIGN_CAST.length !== 6 || new Set(CAMPAIGN_CAST.map((character) => character.id)).size !== 6) errors.push("cast");
  for (const character of CAMPAIGN_CAST) {
    if (character.chapters.length < 2 || character.motivations.length < 2 || character.epilogueOutcomes.length < 2) errors.push(`cast-arc:${character.id}`);
    if (character.stateTriggers.length < 2 || character.choiceReactions.length < 2 || character.artRequirements.length < 3 || !character.localizationNotes) errors.push(`cast-production:${character.id}`);
    if (Object.keys(character.relationships).length < 2) errors.push(`cast-relationships:${character.id}`);
  }
  return errors;
}

const VALIDATION_ERRORS = validateCampaignContent();
if (VALIDATION_ERRORS.length) throw new Error(`Invalid M40 campaign content: ${VALIDATION_ERRORS.join(", ")}`);
