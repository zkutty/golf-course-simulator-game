import type { ControlledRoundSnapshotV2 } from "../rules/roundSnapshot";
import type { ReliefResolution, ShotRuling, SharedShotOutcome } from "../rules/contracts";
import type { BiomeCompatibilityMetadata, LandTheme } from "./biomes";
import type { ShotSlopeContext } from "./shotSlope";
import type { GreenRoundSnapshotV1 } from "../greens/greenSurface";
import type { GreenRolloutV1 } from "../greens/greenRollout";
import type { GreenPuttingV1 } from "../greens/greenPutting";
import type { HandicapProfile, RoundHandicapSnapshot } from "../competition/persistence";

export const PLAYER_PRO_SKILLS = [
  "power",
  "driving",
  "irons",
  "shortGame",
  "putting",
  "recovery",
] as const;

export type PlayerProSkill = (typeof PLAYER_PRO_SKILLS)[number];
export type PlayerProSkills = Record<PlayerProSkill, number>;
export type PlayerProHandedness = "right" | "left";
export type PlayerProBackground = "architect" | "operator" | "host";
export type PlayerProAppearance = "classic" | "sport" | "heritage";
export type PlayerShotTechnique = "normal" | "draw" | "fade" | "punch" | "flop" | "backspin";
export type PlayerRoundKind = "casual" | "friendly" | "wager" | "exhibition" | "tournament";
export type PlayerRoundPhase = "awaiting_shot" | "flight" | "hole_complete" | "round_complete" | "conceded";

export interface PlayerProPoint {
  x: number;
  y: number;
}

export interface PlayerProIdentity {
  id: string;
  name: string;
  appearance: PlayerProAppearance;
  handedness: PlayerProHandedness;
  background: PlayerProBackground;
}

export interface PlayerSkillEvidence {
  id: string;
  skill: PlayerProSkill;
  amount: number;
  reason: string;
  holeId: string;
  shotNumber: number;
  successful: boolean;
}

export interface PlayerRoundHoleSnapshot {
  id: string;
  name: string;
  par: number;
  tee: PlayerProPoint;
  pin: PlayerProPoint;
  waypoints: PlayerProPoint[];
  /** Immutable ZK-717 handicap facts captured when the round begins. */
  strokeIndex?: number | null;
  teeSet?: "forward" | "member" | "championship";
  pinRotation?: "A" | "B" | "C";
}

export interface PlayerRoundCourseSnapshot {
  courseId: string;
  courseName: string;
  /** Canonical identity of the routed course at round start. */
  geometryVersion?: string;
  theme: LandTheme;
  biomeCompatibility?: BiomeCompatibilityMetadata;
  width: number;
  height: number;
  yardsPerTile: number;
  tiles: string[];
  elevations: number[];
  obstacles: Array<PlayerProPoint & { type: string }>;
  holes: PlayerRoundHoleSnapshot[];
  rating?: { courseRating: number; slope: number };
  /** Immutable M62 fine-green geometry, policy, and local condition. */
  greenSnapshot?: GreenRoundSnapshotV1;
  /** Frozen drainage authority paired with round weather for green rollout. */
  greenDrainageLevel?: number;
  /** Frozen M50 rules map used by Player Pro and live callers. */
  rulesSnapshot?: ControlledRoundSnapshotV2;
  weather?: {
    kind: string;
    temperatureF: number;
    windMph: number;
    rainInches: number;
    carryMultiplier: number;
    dispersionMultiplier: number;
    paceMultiplier: number;
  };
}

export interface PlayerShotTrace {
  id: string;
  holeId: string;
  shotNumber: number;
  club: string;
  technique: PlayerShotTechnique;
  flightProfile?: "low" | "standard" | "high";
  power: number;
  from: PlayerProPoint;
  aim: PlayerProPoint;
  landing: PlayerProPoint;
  rest: PlayerProPoint;
  carryYards: number;
  rollYards: number;
  lieBefore: string;
  lieAfter: string;
  penaltyStrokes: number;
  holed: boolean;
  seed: number;
  evidence: PlayerSkillEvidence[];
  /** Optional M50 payload; absent on older persisted traces. */
  sharedOutcome?: SharedShotOutcome;
  /** Optional direct M50 fields retained for legacy trace compatibility. */
  ruling?: ShotRuling;
  relief?: ReliefResolution;
  finalPosition?: PlayerProPoint;
  /** Optional immutable ZK-631 slope facts. Older completed shots omit it. */
  shotSlope?: ShotSlopeContext;
  /** Optional V1 path; absent on historical pre-M62 traces. */
  greenRollout?: GreenRolloutV1;
  /** Immutable automatic-putting resolution when this shot reached the green. */
  greenPutting?: GreenPuttingV1;
}

export interface PlayerRoundScorecardHole {
  holeId: string;
  name: string;
  par: number;
  strokes: number;
  penalties: number;
  complete: boolean;
}

export interface PlayerRoundOpponent {
  id: string;
  name: string;
  skill: number;
  relationshipDelta: number;
  wager: number;
  projectedStrokes: number;
}

export interface PlayerPlayableRound {
  version: 1;
  id: string;
  kind: PlayerRoundKind;
  /** Frozen at round start; absent only on legacy active-round payloads. */
  handedness?: PlayerProHandedness;
  phase: PlayerRoundPhase;
  course: PlayerRoundCourseSnapshot;
  /** Immutable handicap, confidence, setup, and eligibility evidence captured at round start. */
  handicapSnapshot?: RoundHandicapSnapshot;
  /** Immutable M50 boundary/penalty foundation captured for save v20. */
  rulesSnapshot?: ControlledRoundSnapshotV2;
  teeSet: "forward" | "member" | "championship";
  pinRotation: "A" | "B" | "C";
  currentHoleIndex: number;
  ball: PlayerProPoint;
  lie: string;
  strokes: number;
  penalties: number;
  scorecard: PlayerRoundScorecardHole[];
  shots: PlayerShotTrace[];
  pendingShot: PlayerShotTrace | null;
  rngSeed: number;
  rngCursor: number;
  autoPlay: boolean;
  rewardsApplied: boolean;
  startedWeek: number;
  startedDay: number;
  completedWeek?: number;
  returnToDesign?: { holeId: string; shotId: string | null };
  opponent?: PlayerRoundOpponent;
  tournamentId?: string;
  tournamentName?: string;
}

export interface PlayerCareerRound {
  id: string;
  kind: PlayerRoundKind;
  courseId: string;
  courseName: string;
  week: number;
  strokes: number;
  penalties: number;
  par: number;
  scoreToPar: number;
  result: "complete" | "won" | "lost" | "tied" | "conceded";
  opponentId?: string;
  opponentName?: string;
  tournamentId?: string;
  tournamentName?: string;
  earnings: number;
  scorecard: PlayerRoundScorecardHole[];
  shots: PlayerShotTrace[];
  evidence: PlayerSkillEvidence[];
  skillGains: Partial<PlayerProSkills>;
  /** Immutable M38 design identity for every retained trace. */
  geometryVersion?: string;
  teeSet?: "forward" | "member" | "championship";
  pinRotation?: "A" | "B" | "C";
  holeSnapshots?: PlayerRoundHoleSnapshot[];
  /** Reserved for immutable rulings retained by later M50 settlement wiring. */
  rulesSnapshot?: ControlledRoundSnapshotV2;
  /** The exact handicap authority used when this round began. */
  handicapSnapshot?: RoundHandicapSnapshot;
}

export interface PlayerTrainingRecord {
  id: string;
  week: number;
  day: number;
  facilityId: string;
  facilityName: string;
  skill: PlayerProSkill;
  cost: number;
  minutes: number;
  evidence: number;
}

export interface PlayerChallengeRecord {
  id: string;
  opponentId: string;
  opponentName: string;
  kind: "friendly" | "wager";
  status: "offered" | "active" | "complete" | "declined";
  relationship: number;
  wager: number;
  roundId?: string;
  result?: "won" | "lost" | "tied" | "conceded";
  settled?: boolean;
}

export interface PlayerTournamentRecord {
  id: string;
  eventId: string;
  name: string;
  tier: "local" | "regional" | "championship";
  status: "registered" | "active" | "complete" | "withdrawn";
  roundId?: string;
  finish?: number;
  fieldSize?: number;
  prize?: number;
  settled?: boolean;
}

export interface PlayerTrophy {
  id: string;
  name: string;
  courseId: string;
  courseName: string;
  week: number;
  tournamentId?: string;
  opponentId?: string;
}

export interface PlayerProCareer {
  version: 1;
  identity: PlayerProIdentity;
  skills: PlayerProSkills;
  skillXp: PlayerProSkills;
  careerPoints: number;
  unlockedTechniques: PlayerShotTechnique[];
  activeRound: PlayerPlayableRound | null;
  rounds: PlayerCareerRound[];
  training: PlayerTrainingRecord[];
  challenges: PlayerChallengeRecord[];
  tournaments: PlayerTournamentRecord[];
  trophies: PlayerTrophy[];
  earnings: number;
  reputation: number;
  settlementLedger: string[];
  handicapProfile: HandicapProfile;
}
