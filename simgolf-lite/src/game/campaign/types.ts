import type { MessageKey } from "../../i18n/catalog";
import type { GoalDefinition } from "../models/objectives";
import type { ClubCharter } from "../seasons/types";
import type { AdvancedSystemId } from "../experience/systemControl";

export type CampaignCharacterId =
  | "rowan"
  | "mara"
  | "eli"
  | "beatrice"
  | "nadia"
  | "jamie";

export type CampaignExpression = "neutral" | "warm" | "concerned" | "celebrating";
export type CampaignMedal = "bronze" | "silver" | "gold";

export interface CampaignCharacterDefinition {
  id: CampaignCharacterId;
  name: string;
  roleKey: MessageKey;
  portrait: {
    assetId: string;
    expressions: Record<CampaignExpression, number>;
    worldSprite: string;
  };
  chapters: string[];
  gameplayRole: string;
  voiceNotes: string;
  motivations: string[];
  relationships: Partial<Record<CampaignCharacterId, string>>;
  stateTriggers: CampaignFact[];
  choiceReactions: string[];
  artRequirements: string[];
  localizationNotes: string;
  epilogueOutcomes: string[];
}

export type CampaignFact =
  | "cash"
  | "reputation"
  | "condition"
  | "week"
  | "greenFee"
  | "accessCapacity"
  | "staffLevel"
  | "totalRounds"
  | "regularCount"
  | "architectureEvidence"
  | "playerCareerPoints"
  | "playerCareerRounds"
  | "playerMatchWins"
  | "playerSkillAverage"
  | "scheduledTournaments"
  | "completedTournaments"
  | "severeForecastDays"
  | "drainageLevel"
  | "legacyYears";

export interface CampaignPredicate {
  fact: CampaignFact;
  op: "gte" | "lte" | "eq";
  value: number;
}

export type CampaignEffect =
  | { type: "cash"; amount: number }
  | { type: "reputation"; amount: number }
  | { type: "condition"; amount: number }
  | { type: "relationship"; characterId: CampaignCharacterId; amount: number }
  | { type: "eventPool"; eventId: string }
  | { type: "epilogueFact"; fact: string }
  | { type: "scheduleScene"; sceneId: string; delayWeeks: number };

export interface CampaignChoiceDefinition {
  id: string;
  labelKey: MessageKey;
  previewKey: MessageKey;
  effects: CampaignEffect[];
  callbackFact?: string;
}

export interface CampaignSceneDefinition {
  id: string;
  titleKey: MessageKey;
  bodyKey: MessageKey;
  speaker: CampaignCharacterId;
  expression: CampaignExpression;
  choices: CampaignChoiceDefinition[];
  defaultChoiceId: string;
  factKeys: CampaignFact[];
}

export type CampaignMatchKind = "opening" | "local" | "rival" | "club" | "championship";

export interface CampaignMatchDefinition {
  id: string;
  kind: CampaignMatchKind;
  titleKey: MessageKey;
  descriptionKey: MessageKey;
  opponent?: {
    id: string;
    characterId: CampaignCharacterId;
    name: string;
    skill: number;
  };
  minCareerPoints: number;
  tournamentTier?: "championship";
}

export interface CampaignPhaseDefinition {
  id: string;
  titleKey: MessageKey;
  summaryKey: MessageKey;
  goals: GoalDefinition[];
  requirements: CampaignPredicate[];
  recoveryKey: MessageKey;
  estimatedMinutes: number;
  match?: CampaignMatchDefinition;
  introSceneId: string;
  completionSceneId?: string;
  /** Cumulative guidance topics only. This never gates system visibility or authority. */
  curriculumSystems: readonly AdvancedSystemId[];
}

export interface CampaignComplicationDefinition {
  id: string;
  phaseId: string;
  predicates: CampaignPredicate[];
  sceneId: string;
  factKeys: CampaignFact[];
  recoveryKey: MessageKey;
}

export interface CampaignMedalDefinition {
  medal: CampaignMedal;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
  predicates: readonly CampaignPredicate[];
}

export interface CampaignChapterDefinition {
  id: string;
  phases: readonly [CampaignPhaseDefinition, CampaignPhaseDefinition, CampaignPhaseDefinition];
  complications: readonly CampaignComplicationDefinition[];
  scenes: readonly CampaignSceneDefinition[];
  medals: readonly [CampaignMedalDefinition, CampaignMedalDefinition, CampaignMedalDefinition];
  rewards: readonly string[];
  supportedCharters: readonly ClubCharter[];
  epilogueKey: MessageKey;
}

export interface CampaignChoiceRecord {
  chapterId: string;
  sceneId: string;
  choiceId: string;
  week: number;
  facts: Record<string, number>;
  callbackFact?: string;
  participationBaseline?: CampaignParticipationBaselineV1;
}

export type CampaignParticipationBaselineV1 =
  | { kind: "architecture-evidence"; ids: string[] }
  | { kind: "player-pro-round"; ids: string[] }
  | { kind: "exact-campaign-match"; definitionId: string }
  | { kind: "legacy-recovery" };

export interface CampaignScheduledScene {
  sceneId: string;
  dueWeek: number;
  sourceSceneId: string;
}

export interface CampaignMatchRecord {
  definitionId: string;
  roundId: string;
  tournamentId?: string;
  status: "active" | "complete";
  result?: "won" | "lost" | "tied" | "conceded" | "complete";
}

export interface CampaignParticipationReceiptV1 {
  id: string;
  phaseId: string;
  sceneId: string;
  choiceId: string;
  week: number;
  source: "player-choice" | "legacy-recovery";
  baseline: CampaignParticipationBaselineV1;
}

export interface CampaignParticipationStateV1 {
  version: 1;
  receipts: CampaignParticipationReceiptV1[];
  /** Explicit migration provenance; never inferred from choices in a v3 run. */
  legacyEligiblePhaseIds: string[];
}

export interface CampaignRunState {
  version: 3;
  chapterId: string;
  phaseIndex: 0 | 1 | 2;
  completedPhaseIds: string[];
  firedComplicationIds: string[];
  pendingSceneIds: string[];
  resolvedSceneIds: string[];
  scheduledScenes: CampaignScheduledScene[];
  choices: CampaignChoiceRecord[];
  priorChoices: CampaignChoiceRecord[];
  relationships: Record<CampaignCharacterId, number>;
  eventPool: string[];
  epilogueFacts: string[];
  matches: CampaignMatchRecord[];
  settlementLedger: string[];
  completed: boolean;
  medal?: CampaignMedal;
  outcome?: "victory" | "honorable-loss";
  charter: ClubCharter;
  startedWeek: number;
  continuedInSandbox: boolean;
  /** Bounded direct-player provenance. Legacy choices remain independently verifiable. */
  participation: CampaignParticipationStateV1;
}
