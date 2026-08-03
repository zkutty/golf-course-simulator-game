import type { M48DesignComparison, M48DesignTestSession } from "../architecture/m48Types";
import type { GreenRolloutV1 } from "../greens/greenRollout";
import type { ShotSlopeContext } from "../models/shotSlope";

export type LivingGolferArchetype =
  | "casual"
  | "lowHandicap"
  | "senior"
  | "junior"
  | "tourist"
  | "pro";

export type LivingPersonKind = "regular" | "staff" | "playerPro";
export type RelationshipTier = "new" | "acquaintance" | "friend" | "rival" | "clubIcon";
export type StoryPriority = "routine" | "notable" | "major";
export type StoryCategory =
  | "golf"
  | "staff"
  | "finance"
  | "community"
  | "property"
  | "safety"
  | "hospitality"
  | "tournament";

export interface LivingPersonAppearance {
  portrait: "cap" | "visor" | "heritage" | "sport" | "workwear" | "formal";
  palette: number;
  accent: number;
}

export interface PersonMemoryEvidence {
  courseId?: string;
  holeId?: string;
  roundId?: string;
  tournamentId?: string;
  eventId?: string;
  geometryVersion?: string;
  point?: { x: number; y: number };
}

export interface PersonMemory {
  id: string;
  week: number;
  kind: "round" | "record" | "relationship" | "story" | "staff";
  summary: string;
  immutable: boolean;
  evidence?: PersonMemoryEvidence;
}

export interface RegularVisit {
  id: string;
  week: number;
  day: number;
  courseId: string;
  courseName: string;
  roundId?: string;
  scoreToPar: number;
  mood: number;
  favoriteHoleId?: string;
}

export interface RegularCandidate {
  key: string;
  name: string;
  archetype: LivingGolferArchetype;
  visits: number;
  firstWeek: number;
  lastWeek: number;
  lastDay: number;
  loyalty: number;
  bestToPar: number;
  courseIds: string[];
}

export interface RegularGolfer {
  id: string;
  kind: "regular";
  name: string;
  archetype: LivingGolferArchetype;
  appearance: LivingPersonAppearance;
  skill: number;
  preferences: {
    pace: "relaxed" | "balanced" | "brisk";
    challenge: "social" | "balanced" | "competitive";
    hospitality: "simple" | "club" | "destination";
  };
  loyalty: number;
  visits: number;
  rounds: number;
  bestToPar: number;
  favoriteCourseId?: string;
  favoriteHoleId?: string;
  customerId?: string;
  householdId?: string;
  member: boolean;
  relationship: {
    score: number;
    tier: RelationshipTier;
    interactionIds: string[];
  };
  memories: PersonMemory[];
  recentThoughts: string[];
  history: RegularVisit[];
}

export type StoryFactKey =
  | "cash"
  | "reputation"
  | "condition"
  | "lastWeekProfit"
  | "regularCount"
  | "staffCount"
  | "averageStaffMorale"
  | "architectureEvidence"
  | "playerCareerPoints"
  | "scheduledTournaments"
  | "openClaims"
  | "communityComplaints";

export interface StoryPredicate {
  fact: StoryFactKey;
  op: "eq" | "gte" | "lte";
  value: number;
}

export type StoryParticipantRole = "regular" | "staff" | "playerPro";

export type StoryEffect =
  | { type: "cash"; amount: number }
  | { type: "reputation"; amount: number }
  | { type: "condition"; amount: number }
  | { type: "relationship"; amount: number; target: StoryParticipantRole }
  | { type: "staffMorale"; amount: number; target: "staff" | "allStaff" }
  | { type: "memory"; summaryKey: string; target: StoryParticipantRole }
  | { type: "scheduleCallback"; eventId: string; delayWeeks: number };

export interface StoryChoiceDefinition {
  id: string;
  labelKey: string;
  previewKey: string;
  uncertain?: boolean;
  effects: StoryEffect[];
}

export interface StoryEventDefinition {
  id: string;
  titleKey: string;
  bodyKey: string;
  category: StoryCategory;
  priority: StoryPriority;
  cooldownWeeks: number;
  predicates: StoryPredicate[];
  participantRoles: StoryParticipantRole[];
  choices: StoryChoiceDefinition[];
  defaultChoiceId: string;
  expiresAfterWeeks: number;
  chainId?: string;
  stage?: number;
  mutexGroup?: string;
  callbackOnly?: boolean;
  repeatable?: boolean;
  testFixture: string;
}

export interface StoryFactSnapshot {
  key: string;
  facts: Partial<Record<StoryFactKey, number>>;
}

export interface StoryEventInstance {
  id: string;
  definitionId: string;
  week: number;
  day: number;
  priority: StoryPriority;
  category: StoryCategory;
  participantIds: string[];
  facts: StoryFactSnapshot;
  status: "pending" | "presented" | "deferred" | "resolved" | "expired";
  expiresWeek: number;
  choiceId?: string;
  resolvedWeek?: number;
  resolution: "chosen" | "default" | "expired" | null;
}

export interface ScheduledStoryCallback {
  id: string;
  eventId: string;
  dueWeek: number;
  sourceInstanceId: string;
  participantIds: string[];
}

export interface StoryJournalEntry {
  id: string;
  eventInstanceId: string;
  definitionId: string;
  week: number;
  participantIds: string[];
  choiceId: string;
  resolution: "chosen" | "default" | "expired";
  facts: StoryFactSnapshot;
}

export interface StoryEngineState {
  instances: StoryEventInstance[];
  callbacks: ScheduledStoryCallback[];
  journal: StoryJournalEntry[];
  cooldownUntil: Record<string, number>;
  chainStage: Record<string, number>;
  settlementLedger: string[];
  lastEvaluationKey?: string;
}

export type ArchitectureEvidenceSource = "playerPro" | "regular";
export type ArchitectureShotType = "drive" | "approach" | "recovery" | "putt";

export interface ArchitectureShotEvidence {
  id: string;
  source: ArchitectureEvidenceSource;
  sourceSegment: string;
  golferId: string;
  golferName: string;
  roundId: string;
  week: number;
  day: number;
  courseId: string;
  courseName: string;
  holeId: string;
  teeSet: "forward" | "member" | "championship";
  geometryVersion: string;
  shotType: ArchitectureShotType;
  shotNumber: number;
  from: { x: number; y: number };
  aim?: { x: number; y: number };
  landing: { x: number; y: number };
  physicalRest?: { x: number; y: number };
  rest: { x: number; y: number };
  scoreToPar: number;
  waitMinutes: number;
  lieBefore?: string;
  lieAfter?: string;
  /** Original immutable slope facts; absent on historical evidence. */
  shotSlope?: ShotSlopeContext;
  slopeExplanation?: string;
  /** Exact retained ground path used by the architecture trace overlay. */
  greenRollout?: GreenRolloutV1;
}

export interface ArchitectureRevisionSummary {
  id: string;
  geometryVersion: string;
  courseId: string;
  courseName: string;
  firstWeek: number;
  lastWeek: number;
  rounds: number;
  shots: number;
  averageToPar: number;
  architectureScore: number | null;
  holeIds: string[];
}

export interface ReturnToDesignContext {
  roundId: string;
  shotId: string | null;
  holeId: string;
  courseId: string;
  geometryVersion: string;
  point: { x: number; y: number };
  openedWeek: number;
}

export interface ArchitectureEvidenceState {
  evidence: ArchitectureShotEvidence[];
  revisions: ArchitectureRevisionSummary[];
  returnContext: ReturnToDesignContext | null;
  /** M48 design-test context is bounded, optional, and explicitly no-economy. */
  testSession?: M48DesignTestSession | null;
  comparison?: M48DesignComparison | null;
}

export interface LivingClubState {
  version: 1;
  sequence: number;
  candidates: RegularCandidate[];
  regulars: RegularGolfer[];
  story: StoryEngineState;
  architecture: ArchitectureEvidenceState;
}
