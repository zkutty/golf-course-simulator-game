import type {
  StoryChoiceDefinition,
  StoryEffect,
  StoryEventDefinition,
  StoryFactKey,
  StoryParticipantRole,
  StoryPredicate,
} from "./types";

const choice = (
  id: string,
  effects: StoryEffect[],
  labelKey = `story.choice.${id}`,
  uncertain = false,
): StoryChoiceDefinition => ({
  id,
  labelKey,
  previewKey: `story.preview.${id}`,
  uncertain,
  effects,
});

const predicate = (fact: StoryFactKey, op: StoryPredicate["op"], value: number): StoryPredicate => ({ fact, op, value });

function event(
  id: string,
  category: StoryEventDefinition["category"],
  priority: StoryEventDefinition["priority"],
  participantRoles: StoryParticipantRole[],
  predicates: StoryPredicate[],
  choices: StoryChoiceDefinition[],
  extra: Partial<StoryEventDefinition> = {},
): StoryEventDefinition {
  return {
    id,
    titleKey: `story.event.${id}.title`,
    bodyKey: `story.event.${id}.body`,
    category,
    priority,
    cooldownWeeks: extra.cooldownWeeks ?? 8,
    predicates,
    participantRoles,
    choices,
    defaultChoiceId: extra.defaultChoiceId ?? choices[0].id,
    expiresAfterWeeks: extra.expiresAfterWeeks ?? (priority === "major" ? 2 : 1),
    testFixture: `${id}-fixture`,
    ...extra,
  };
}

/**
 * M38's first authored pack. Definitions are inert data: eligibility, effects,
 * callbacks, and copy keys are validated before they can enter the reducer.
 */
export const SYSTEMIC_EVENT_DEFINITIONS: readonly StoryEventDefinition[] = [
  event("regular-welcome", "golf", "notable", ["regular"], [predicate("regularCount", "gte", 1)], [
    choice("play", [{ type: "relationship", target: "regular", amount: 8 }, { type: "memory", target: "regular", summaryKey: "story.memory.firstRound" }, { type: "scheduleCallback", eventId: "regular-rematch", delayWeeks: 2 }]),
    choice("listen", [{ type: "relationship", target: "regular", amount: 5 }, { type: "reputation", amount: 1 }, { type: "scheduleCallback", eventId: "regular-rematch", delayWeeks: 3 }]),
  ], { chainId: "regular-mentor", stage: 1 }),
  event("regular-rematch", "golf", "major", ["regular", "playerPro"], [], [
    choice("accept", [{ type: "relationship", target: "regular", amount: 10 }, { type: "reputation", amount: 2 }, { type: "memory", target: "regular", summaryKey: "story.memory.rematch" }]),
    choice("defer", [{ type: "relationship", target: "regular", amount: -2 }]),
  ], { callbackOnly: true, chainId: "regular-mentor", stage: 2 }),

  event("superintendent-concern", "staff", "major", ["staff"], [predicate("condition", "lte", 65)], [
    choice("invest", [{ type: "cash", amount: -1800 }, { type: "condition", amount: 0.07 }, { type: "staffMorale", target: "staff", amount: 8 }, { type: "scheduleCallback", eventId: "superintendent-result", delayWeeks: 2 }]),
    choice("acceptRisk", [{ type: "staffMorale", target: "staff", amount: -7 }, { type: "scheduleCallback", eventId: "superintendent-result", delayWeeks: 1 }], undefined, true),
  ], { chainId: "grounds-team", stage: 1 }),
  event("superintendent-result", "staff", "notable", ["staff"], [], [
    choice("recognize", [{ type: "cash", amount: -350 }, { type: "staffMorale", target: "staff", amount: 7 }, { type: "memory", target: "staff", summaryKey: "story.memory.groundsTeam" }]),
    choice("thank", [{ type: "staffMorale", target: "staff", amount: 3 }]),
  ], { callbackOnly: true, chainId: "grounds-team", stage: 2 }),

  event("community-access-request", "community", "major", ["regular"], [predicate("reputation", "gte", 35)], [
    choice("support", [{ type: "cash", amount: -700 }, { type: "reputation", amount: 3 }, { type: "relationship", target: "regular", amount: 6 }, { type: "scheduleCallback", eventId: "community-access-followup", delayWeeks: 3 }]),
    choice("compromise", [{ type: "cash", amount: -250 }, { type: "reputation", amount: 1 }, { type: "scheduleCallback", eventId: "community-access-followup", delayWeeks: 4 }]),
  ], { chainId: "community-access", stage: 1, mutexGroup: "community-policy" }),
  event("community-access-followup", "community", "notable", ["regular"], [], [
    choice("celebrate", [{ type: "reputation", amount: 2 }, { type: "relationship", target: "regular", amount: 5 }, { type: "memory", target: "regular", summaryKey: "story.memory.accessDay" }]),
    choice("measure", [{ type: "reputation", amount: 1 }]),
  ], { callbackOnly: true, chainId: "community-access", stage: 2 }),

  event("sponsor-offer", "finance", "major", ["staff"], [predicate("reputation", "gte", 50), predicate("cash", "lte", 60000)], [
    choice("accept", [{ type: "cash", amount: 4500 }, { type: "reputation", amount: -1 }, { type: "scheduleCallback", eventId: "sponsor-renewal", delayWeeks: 5 }], undefined, true),
    choice("decline", [{ type: "reputation", amount: 1 }]),
  ], { chainId: "sponsor-partnership", stage: 1, mutexGroup: "finance-partner" }),
  event("sponsor-renewal", "finance", "notable", ["staff"], [], [
    choice("renew", [{ type: "cash", amount: 2500 }, { type: "staffMorale", target: "staff", amount: -2 }]),
    choice("decline", [{ type: "reputation", amount: 2 }, { type: "staffMorale", target: "staff", amount: 2 }]),
  ], { callbackOnly: true, chainId: "sponsor-partnership", stage: 2 }),

  event("chef-market-night", "hospitality", "notable", ["staff"], [predicate("staffCount", "gte", 2), predicate("cash", "gte", 2500)], [
    choice("invest", [{ type: "cash", amount: -1100 }, { type: "reputation", amount: 2 }, { type: "staffMorale", target: "staff", amount: 5 }, { type: "scheduleCallback", eventId: "chef-return", delayWeeks: 2 }]),
    choice("pilot", [{ type: "cash", amount: -450 }, { type: "reputation", amount: 1 }, { type: "scheduleCallback", eventId: "chef-return", delayWeeks: 3 }], undefined, true),
  ], { chainId: "hospitality-table", stage: 1 }),
  event("chef-return", "hospitality", "routine", ["staff"], [], [
    choice("expand", [{ type: "cash", amount: 900 }, { type: "staffMorale", target: "staff", amount: 3 }]),
    choice("keepSmall", [{ type: "reputation", amount: 1 }]),
  ], { callbackOnly: true, chainId: "hospitality-table", stage: 2 }),

  event("safety-warning", "safety", "major", ["staff"], [predicate("openClaims", "gte", 1)], [
    choice("invest", [{ type: "cash", amount: -2400 }, { type: "reputation", amount: 1 }, { type: "staffMorale", target: "staff", amount: 4 }, { type: "scheduleCallback", eventId: "safety-review", delayWeeks: 2 }]),
    choice("acceptRisk", [{ type: "reputation", amount: -3 }, { type: "staffMorale", target: "staff", amount: -5 }, { type: "scheduleCallback", eventId: "safety-review", delayWeeks: 1 }], undefined, true),
  ], { chainId: "safety-culture", stage: 1, mutexGroup: "safety-response" }),
  event("safety-review", "safety", "notable", ["staff"], [], [
    choice("publish", [{ type: "reputation", amount: 2 }, { type: "memory", target: "staff", summaryKey: "story.memory.safetyReview" }]),
    choice("internal", [{ type: "staffMorale", target: "allStaff", amount: 2 }]),
  ], { callbackOnly: true, chainId: "safety-culture", stage: 2 }),

  event("course-record-celebration", "golf", "routine", ["regular"], [predicate("regularCount", "gte", 2)], [
    choice("celebrate", [{ type: "cash", amount: -200 }, { type: "relationship", target: "regular", amount: 4 }, { type: "reputation", amount: 1 }]),
    choice("recognize", [{ type: "relationship", target: "regular", amount: 3 }]),
  ]),
  event("junior-clinic", "community", "notable", ["staff"], [predicate("staffCount", "gte", 2), predicate("cash", "gte", 1000)], [
    choice("support", [{ type: "cash", amount: -650 }, { type: "reputation", amount: 2 }, { type: "staffMorale", target: "staff", amount: 3 }]),
    choice("defer", [{ type: "reputation", amount: -1 }]),
  ]),
  event("turf-recovery-window", "property", "notable", ["staff"], [predicate("condition", "lte", 72), predicate("cash", "gte", 1500)], [
    choice("invest", [{ type: "cash", amount: -1400 }, { type: "condition", amount: 0.06 }, { type: "staffMorale", target: "staff", amount: 4 }]),
    choice("acceptRisk", [{ type: "condition", amount: -0.02 }], undefined, true),
  ]),
  event("green-speed-debate", "golf", "routine", ["regular", "staff"], [predicate("regularCount", "gte", 1), predicate("staffCount", "gte", 1)], [
    choice("listen", [{ type: "relationship", target: "regular", amount: 3 }, { type: "staffMorale", target: "staff", amount: 2 }]),
    choice("competitive", [{ type: "relationship", target: "regular", amount: -1 }, { type: "reputation", amount: 1 }]),
  ]),
  event("staff-training-slot", "staff", "routine", ["staff"], [predicate("cash", "gte", 900), predicate("averageStaffMorale", "gte", 45)], [
    choice("invest", [{ type: "cash", amount: -850 }, { type: "staffMorale", target: "staff", amount: 6 }, { type: "memory", target: "staff", summaryKey: "story.memory.training" }]),
    choice("defer", []),
  ]),
  event("member-price-feedback", "finance", "notable", ["regular"], [predicate("reputation", "gte", 55), predicate("regularCount", "gte", 2)], [
    choice("listen", [{ type: "relationship", target: "regular", amount: 4 }, { type: "reputation", amount: 1 }]),
    choice("holdLine", [{ type: "cash", amount: 700 }, { type: "relationship", target: "regular", amount: -3 }], undefined, true),
  ]),
  event("hospitality-overflow", "hospitality", "routine", ["staff"], [predicate("reputation", "gte", 45), predicate("staffCount", "lte", 3)], [
    choice("support", [{ type: "cash", amount: -500 }, { type: "staffMorale", target: "allStaff", amount: 4 }]),
    choice("acceptRisk", [{ type: "reputation", amount: -1 }, { type: "staffMorale", target: "allStaff", amount: -3 }]),
  ]),
  event("tournament-volunteers", "tournament", "notable", ["regular", "staff"], [predicate("scheduledTournaments", "gte", 1)], [
    choice("support", [{ type: "cash", amount: -550 }, { type: "reputation", amount: 2 }, { type: "relationship", target: "regular", amount: 3 }]),
    choice("staffOnly", [{ type: "staffMorale", target: "allStaff", amount: -4 }]),
  ]),
  event("local-paper-profile", "community", "routine", ["regular"], [predicate("reputation", "gte", 60), predicate("regularCount", "gte", 1)], [
    choice("shareCredit", [{ type: "reputation", amount: 2 }, { type: "relationship", target: "regular", amount: 4 }, { type: "staffMorale", target: "allStaff", amount: 3 }]),
    choice("focusCourse", [{ type: "reputation", amount: 1 }]),
  ]),
  event("conservation-walk", "property", "routine", ["regular", "staff"], [predicate("condition", "gte", 70), predicate("regularCount", "gte", 1)], [
    choice("support", [{ type: "cash", amount: -300 }, { type: "reputation", amount: 1 }, { type: "relationship", target: "regular", amount: 2 }]),
    choice("decline", []),
  ]),
  event("pace-complaint", "golf", "notable", ["regular", "staff"], [predicate("regularCount", "gte", 1), predicate("staffCount", "gte", 1)], [
    choice("listen", [{ type: "relationship", target: "regular", amount: 3 }, { type: "staffMorale", target: "staff", amount: 2 }]),
    choice("holdLine", [{ type: "relationship", target: "regular", amount: -2 }]),
  ], { cooldownWeeks: 12 }),
  event("architect-critique", "golf", "major", ["regular", "playerPro"], [predicate("architectureEvidence", "gte", 10)], [
    choice("redesign", [{ type: "cash", amount: -600 }, { type: "relationship", target: "regular", amount: 5 }, { type: "reputation", amount: 1 }, { type: "memory", target: "regular", summaryKey: "story.memory.architecture" }]),
    choice("defend", [{ type: "relationship", target: "regular", amount: -3 }], undefined, true),
  ], { cooldownWeeks: 16 }),
  event("pro-am-invite", "tournament", "major", ["regular", "playerPro"], [predicate("playerCareerPoints", "gte", 12), predicate("regularCount", "gte", 1)], [
    choice("accept", [{ type: "cash", amount: -750 }, { type: "reputation", amount: 3 }, { type: "relationship", target: "regular", amount: 6 }]),
    choice("defer", [{ type: "relationship", target: "regular", amount: -2 }]),
  ], { cooldownWeeks: 18 }),
  event("claimant-conversation", "safety", "notable", ["regular", "staff"], [predicate("openClaims", "gte", 1), predicate("regularCount", "gte", 1)], [
    choice("listen", [{ type: "cash", amount: -500 }, { type: "reputation", amount: 1 }, { type: "relationship", target: "regular", amount: 4 }]),
    choice("formal", [{ type: "staffMorale", target: "staff", amount: 2 }, { type: "relationship", target: "regular", amount: -2 }]),
  ], { mutexGroup: "safety-response" }),
  event("neighborhood-meeting", "community", "major", ["regular", "staff"], [predicate("communityComplaints", "gte", 2)], [
    choice("compromise", [{ type: "cash", amount: -900 }, { type: "reputation", amount: 2 }, { type: "relationship", target: "regular", amount: 3 }]),
    choice("holdLine", [{ type: "reputation", amount: -2 }, { type: "relationship", target: "regular", amount: -4 }], undefined, true),
  ], { mutexGroup: "community-policy" }),
];

const FACTS = new Set<StoryFactKey>([
  "cash", "reputation", "condition", "lastWeekProfit", "regularCount", "staffCount",
  "averageStaffMorale", "architectureEvidence", "playerCareerPoints", "scheduledTournaments",
  "openClaims", "communityComplaints",
]);
const EFFECTS = new Set<StoryEffect["type"]>([
  "cash", "reputation", "condition", "relationship", "staffMorale", "memory", "scheduleCallback",
]);

export function validateStoryDefinitions(
  definitions: readonly StoryEventDefinition[] = SYSTEMIC_EVENT_DEFINITIONS,
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (!definition.id || ids.has(definition.id)) errors.push(`duplicate-or-empty:${definition.id}`);
    ids.add(definition.id);
    if (!definition.titleKey || !definition.bodyKey || !definition.testFixture) errors.push(`copy-or-fixture:${definition.id}`);
    if (!Number.isFinite(definition.cooldownWeeks) || definition.cooldownWeeks < 0) errors.push(`cooldown:${definition.id}`);
    if (!definition.choices.length || !definition.choices.some((candidate) => candidate.id === definition.defaultChoiceId)) errors.push(`default:${definition.id}`);
    if (definition.predicates.some((item) => !FACTS.has(item.fact) || !Number.isFinite(item.value))) errors.push(`predicate:${definition.id}`);
    for (const option of definition.choices) {
      if (!option.id || !option.labelKey || !option.previewKey) errors.push(`choice-copy:${definition.id}:${option.id}`);
      if (option.effects.some((effect) => !EFFECTS.has(effect.type))) errors.push(`effect:${definition.id}:${option.id}`);
    }
  }
  for (const definition of definitions) for (const option of definition.choices) for (const effect of option.effects) {
    if (effect.type === "scheduleCallback" && !ids.has(effect.eventId)) errors.push(`callback:${definition.id}:${effect.eventId}`);
  }
  return errors;
}

const VALIDATION_ERRORS = validateStoryDefinitions();
if (VALIDATION_ERRORS.length) throw new Error(`Invalid M38 story definitions: ${VALIDATION_ERRORS.join(", ")}`);

export const STORY_DEFINITION_BY_ID = new Map(SYSTEMIC_EVENT_DEFINITIONS.map((definition) => [definition.id, definition]));
