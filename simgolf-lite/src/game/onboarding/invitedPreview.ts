import type { Course, ExperienceProfile, Point, World } from "../models/types";
import { getExperienceProfile } from "../balance/experience";
import { ARCHETYPES, golferName } from "../live/archetypes";
import { createGolferCapabilities, stableGolferSeed } from "../live/capabilities";
import { buildStrategicGolferRound } from "../live/m47Round";
import type { GolferArchetypeName } from "../live/types";
import { rollPersonality } from "../live/personality";
import { scoreCourseHoles } from "../sim/holes";
import { mulberry32 } from "../../utils/rng";
import { hashCanonicalValue } from "../../utils/canonical";
import { normalizedBuilding } from "../models/buildings";

export const INVITED_PREVIEW_VERSION = 1 as const;
export const INVITED_PREVIEW_REWARD_ID = "founders-preview-pennant" as const;
export const INVITED_PREVIEW_REWARD_CASH = 750 as const;
export const INVITED_PREVIEW_REWARD_REPUTATION = 1 as const;
export const PUBLIC_OPERATION_MILESTONES = [3, 6, 9] as const;

export interface InvitedPreviewShotEvidence {
  shotNumber: number;
  intent: "safe" | "hero" | "positional" | "recovery" | "approach";
  club: string;
  from: Point;
  landing: Point;
  rest: Point;
  lieAfter: string;
  penaltyStrokes: number;
}

export interface InvitedPreviewGolferEvidence {
  id: string;
  name: string;
  archetype: GolferArchetypeName;
  par: number;
  strokes: number;
  expectedScore: number;
  satisfaction: number;
  reaction: "delighted" | "pleased" | "neutral" | "frustrated" | "unfair";
  thought: string;
  shots: InvitedPreviewShotEvidence[];
}

/**
 * A compact result from a deliberately private one-hole preview. It contains
 * only authoritative shot/reaction evidence; it has no tee-sheet, cash,
 * ledger, objective, record, or tournament carrier to mutate.
 */
export interface InvitedPreviewEvidence {
  version: typeof INVITED_PREVIEW_VERSION;
  id: string;
  runSeed: number;
  holeFingerprint: string;
  holeId: string;
  holeIndex: number;
  courseName: string;
  group: InvitedPreviewGolferEvidence[];
}

export interface PreviewRewardReceipt {
  id: typeof INVITED_PREVIEW_REWARD_ID;
  previewId: string;
  cash: typeof INVITED_PREVIEW_REWARD_CASH;
  reputation: typeof INVITED_PREVIEW_REWARD_REPUTATION;
}

export interface PublicMilestoneReceipt {
  id: string;
  holes: (typeof PUBLIC_OPERATION_MILESTONES)[number];
  previewId: string;
}

export interface InvitedPreviewState {
  status: "not-invited" | "observed" | "rewarded";
  evidence: InvitedPreviewEvidence | null;
  rewardReceipt: PreviewRewardReceipt | null;
}

export interface OnboardingReceipts {
  preview: InvitedPreviewState;
  milestones: PublicMilestoneReceipt[];
}

export function validHoleCount(course: Course): number {
  return scoreCourseHoles(course).holes.filter((hole) => hole.isComplete && hole.isValid).length;
}

function firstValidHoleIndex(course: Course): number {
  return scoreCourseHoles(course).holes.findIndex((hole) => hole.isComplete && hole.isValid);
}

export function canonicalInvitedPreviewEvidenceId(evidence: Omit<InvitedPreviewEvidence, "id">): string {
  return `invited-preview:${evidence.runSeed >>> 0}:${hashCanonicalValue(evidence)}`;
}

function invitedHoleFingerprint(course: Course, holeIndex: number): string {
  return hashCanonicalValue({
    theme: course.theme,
    width: course.width,
    height: course.height,
    yardsPerTile: course.yardsPerTile,
    tiles: course.tiles,
    elevations: course.elevations,
    obstacles: course.obstacles,
    buildings: course.buildings.map(normalizedBuilding),
    greenSurface: course.greenSurface,
    holeIndex,
    hole: course.holes[holeIndex],
  });
}

function buildPreviewGolfer(
  course: Course,
  world: World,
  holeId: string,
  archetype: GolferArchetypeName,
  salt: number,
): InvitedPreviewGolferEvidence {
  const seed = ((world.runSeed >>> 0) ^ Math.imul(salt, 0x45d9f3b)) >>> 0;
  const rng = mulberry32(seed);
  const definition = ARCHETYPES[archetype];
  const personality = rollPersonality(definition.personality, rng);
  const capabilities = createGolferCapabilities({
    personality,
    seed: stableGolferSeed(`${holeId}:${archetype}:${salt}`, seed),
  });
  const entry = { ...course.holes[0].tee! };
  const round = buildStrategicGolferRound({
    course,
    entry,
    exit: entry,
    rng,
    personality,
    capabilities,
    skipPreRoundPurchases: true,
  });
  const reaction = round.holeReactions?.[0];
  if (!reaction) throw new Error("Invited preview did not produce authoritative reaction evidence");
  return {
    id: `preview-golfer:${salt}`,
    name: golferName(rng(), rng()),
    archetype,
    par: round.holePar[0] ?? 4,
    strokes: round.holeStrokes[0] ?? reaction.actualScore,
    expectedScore: reaction.expectedScore,
    satisfaction: reaction.satisfaction,
    reaction: reaction.outcome,
    thought: reaction.thought,
    shots: (round.shotOutcomes ?? []).filter((shot) => shot.holeId === holeId).slice(0, 12).map((shot) => ({
      shotNumber: shot.shotNumber,
      intent: shot.intent,
      club: shot.club,
      from: { ...shot.from },
      landing: { ...shot.landing },
      rest: { ...shot.rest },
      lieAfter: shot.lieAfter,
      penaltyStrokes: shot.penaltyStrokes,
    })),
  };
}

/** Run the private group through the shared strategic shot/reaction authority. */
export function createInvitedPreviewEvidence(course: Course, world: World): InvitedPreviewEvidence | null {
  const holeIndex = firstValidHoleIndex(course);
  const sourceHole = course.holes[holeIndex];
  if (holeIndex < 0 || !sourceHole?.tee || !sourceHole.green) return null;
  const holeId = sourceHole.id ?? `hole-${holeIndex + 1}`;
  const previewCourse: Course = {
    ...course,
    activeCourseId: undefined,
    layouts: undefined,
    holes: [{ ...sourceHole, id: holeId, tee: { ...sourceHole.tee }, green: { ...sourceHole.green } }],
  };
  const evidence: Omit<InvitedPreviewEvidence, "id"> = {
    version: INVITED_PREVIEW_VERSION,
    runSeed: world.runSeed >>> 0,
    holeFingerprint: invitedHoleFingerprint(course, holeIndex),
    holeId,
    holeIndex,
    courseName: course.name,
    group: [
      buildPreviewGolfer(previewCourse, world, holeId, "casual", 1),
      buildPreviewGolfer(previewCourse, world, holeId, "lowHandicap", 2),
    ],
  };
  return { ...evidence, id: canonicalInvitedPreviewEvidenceId(evidence) };
}

/** Prove a carrier is the exact deterministic preview for this course/world. */
export function invitedPreviewEvidenceMatchesAuthority(evidence: InvitedPreviewEvidence, course: Course, world: World): boolean {
  const authoritative = createInvitedPreviewEvidence(course, world);
  return authoritative != null && hashCanonicalValue(authoritative) === hashCanonicalValue(evidence);
}

export function grantInvitedPreviewReward(state: InvitedPreviewState): InvitedPreviewState {
  if (!state.evidence) return state;
  if (state.rewardReceipt) return state.status === "rewarded" ? state : { ...state, status: "rewarded" };
  return {
    ...state,
    status: "rewarded",
    rewardReceipt: { id: INVITED_PREVIEW_REWARD_ID, previewId: state.evidence.id, cash: INVITED_PREVIEW_REWARD_CASH, reputation: INVITED_PREVIEW_REWARD_REPUTATION },
  };
}

/**
 * The single post-preview transaction. Preview execution is carrier-pure; this
 * bounded benefit is the only permitted world delta and is guarded by the
 * world-owned receipt as well as the tutorial receipt.
 */
export function applyInvitedPreviewReward(
  world: World,
  preview: InvitedPreviewState,
  course: Course,
): { world: World; preview: InvitedPreviewState; applied: boolean } {
  if (!preview.evidence) return { world, preview, applied: false };
  const rewardedPreview = grantInvitedPreviewReward(preview);
  const receipt = rewardedPreview.rewardReceipt!;
  const ledger = world.onboardingRewards?.version === 1 ? world.onboardingRewards : { version: 1 as const, receipts: [] };
  if (ledger.receipts.some((known) => known.id === receipt.id)) {
    return { world, preview: rewardedPreview, applied: false };
  }
  if (!invitedPreviewEvidenceMatchesAuthority(preview.evidence, course, world)) return { world, preview, applied: false };
  return {
    world: {
      ...world,
      cash: world.cash + receipt.cash,
      reputation: Math.min(100, world.reputation + receipt.reputation),
      onboardingRewards: { version: 1, receipts: [...ledger.receipts, receipt].slice(-16) },
    },
    preview: rewardedPreview,
    applied: true,
  };
}

export function reconcilePublicMilestones(
  receipts: OnboardingReceipts,
  course: Course,
): OnboardingReceipts {
  const previewIdValue = receipts.preview.rewardReceipt?.previewId;
  if (!previewIdValue) return receipts;
  const count = validHoleCount(course);
  const milestones = receipts.milestones.slice();
  for (const holes of PUBLIC_OPERATION_MILESTONES) {
    if (count < holes || milestones.some((receipt) => receipt.holes === holes)) continue;
    milestones.push({ id: `public-operation:${previewIdValue}:${holes}`, holes, previewId: previewIdValue });
  }
  if (milestones.length === receipts.milestones.length) return receipts;
  return { ...receipts, milestones };
}

export function worldHasInvitedPreviewReward(world: World | null | undefined): boolean {
  return Boolean(world?.onboardingRewards?.version === 1 && world.onboardingRewards.receipts.some((receipt) => (
    receipt.id === INVITED_PREVIEW_REWARD_ID
    && receipt.cash === INVITED_PREVIEW_REWARD_CASH
    && receipt.reputation === INVITED_PREVIEW_REWARD_REPUTATION
    && new RegExp(`^invited-preview:${world.runSeed >>> 0}:[0-9a-f]{8}$`).test(receipt.previewId)
  )));
}

export function publicThreeHoleOperationUnlocked(world: World | null | undefined): boolean {
  return worldHasInvitedPreviewReward(world);
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function point(value: unknown): Point | null {
  const candidate = record(value);
  return finite(candidate.x) && finite(candidate.y) ? { x: candidate.x, y: candidate.y } : null;
}

export function normalizeInvitedPreviewEvidence(value: unknown): InvitedPreviewEvidence | null {
  const candidate = record(value);
  if (candidate.version !== INVITED_PREVIEW_VERSION || typeof candidate.id !== "string" || !Number.isInteger(candidate.runSeed) || typeof candidate.holeFingerprint !== "string" || !/^[0-9a-f]{8}$/.test(candidate.holeFingerprint) || typeof candidate.holeId !== "string" || !Number.isInteger(candidate.holeIndex) || typeof candidate.courseName !== "string" || !Array.isArray(candidate.group) || candidate.group.length < 1 || candidate.group.length > 4) return null;
  const group: InvitedPreviewGolferEvidence[] = [];
  for (const item of candidate.group) {
    const golfer = record(item);
    if (typeof golfer.id !== "string" || typeof golfer.name !== "string" || !["casual", "lowHandicap", "senior", "junior", "tourist", "pro"].includes(String(golfer.archetype)) || !finite(golfer.par) || !finite(golfer.strokes) || !finite(golfer.expectedScore) || !finite(golfer.satisfaction) || !["delighted", "pleased", "neutral", "frustrated", "unfair"].includes(String(golfer.reaction)) || typeof golfer.thought !== "string" || !Array.isArray(golfer.shots) || golfer.shots.length > 12) return null;
    const shots: InvitedPreviewShotEvidence[] = [];
    for (const itemShot of golfer.shots) {
      const shot = record(itemShot);
      const from = point(shot.from); const landing = point(shot.landing); const rest = point(shot.rest);
      if (!Number.isInteger(shot.shotNumber) || !["safe", "hero", "positional", "recovery", "approach"].includes(String(shot.intent)) || typeof shot.club !== "string" || !from || !landing || !rest || typeof shot.lieAfter !== "string" || !finite(shot.penaltyStrokes)) return null;
      shots.push({ shotNumber: shot.shotNumber as number, intent: shot.intent as InvitedPreviewShotEvidence["intent"], club: shot.club, from, landing, rest, lieAfter: shot.lieAfter, penaltyStrokes: shot.penaltyStrokes });
    }
    group.push({ id: golfer.id, name: golfer.name, archetype: golfer.archetype as GolferArchetypeName, par: golfer.par, strokes: golfer.strokes, expectedScore: golfer.expectedScore, satisfaction: Math.max(0, Math.min(100, golfer.satisfaction)), reaction: golfer.reaction as InvitedPreviewGolferEvidence["reaction"], thought: golfer.thought, shots });
  }
  const evidence: Omit<InvitedPreviewEvidence, "id"> = { version: INVITED_PREVIEW_VERSION, runSeed: (candidate.runSeed as number) >>> 0, holeFingerprint: candidate.holeFingerprint, holeId: candidate.holeId, holeIndex: Math.max(0, candidate.holeIndex as number), courseName: candidate.courseName, group };
  if (candidate.id !== canonicalInvitedPreviewEvidenceId(evidence)) return null;
  return { ...evidence, id: candidate.id };
}

export function normalizeOnboardingReceipts(value: unknown): OnboardingReceipts {
  const candidate = record(value);
  const previewCandidate = record(candidate.preview);
  const evidence = normalizeInvitedPreviewEvidence(previewCandidate.evidence);
  const rewardCandidate = record(previewCandidate.rewardReceipt);
  const rewardReceipt = evidence && rewardCandidate.id === INVITED_PREVIEW_REWARD_ID && rewardCandidate.previewId === evidence.id
    ? { id: INVITED_PREVIEW_REWARD_ID, previewId: evidence.id, cash: INVITED_PREVIEW_REWARD_CASH, reputation: INVITED_PREVIEW_REWARD_REPUTATION }
    : null;
  const milestones: PublicMilestoneReceipt[] = [];
  if (Array.isArray(candidate.milestones) && rewardReceipt) {
    for (const item of candidate.milestones.slice(0, PUBLIC_OPERATION_MILESTONES.length)) {
      const receipt = record(item);
      const holes = receipt.holes as PublicMilestoneReceipt["holes"];
      const expectedId = `public-operation:${rewardReceipt.previewId}:${holes}`;
      if (receipt.id !== expectedId || !PUBLIC_OPERATION_MILESTONES.includes(holes) || receipt.previewId !== rewardReceipt.previewId || milestones.some((known) => known.holes === holes)) continue;
      milestones.push({ id: expectedId, holes, previewId: rewardReceipt.previewId });
    }
  }
  return {
    preview: {
      status: rewardReceipt ? "rewarded" : evidence ? "observed" : "not-invited",
      evidence,
      rewardReceipt,
    },
    milestones: milestones.sort((a, b) => a.holes - b.holes),
  };
}

export function advancedJitLessons(profile: ExperienceProfile): string[] {
  if (profile !== "simulation") return [];
  const modules = getExperienceProfile(profile).tutorialModules;
  return modules.filter((module) => module === "advanced-design" || module === "enterprise" || module === "legacy");
}
