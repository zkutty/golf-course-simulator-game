import type { Course, ExperienceProfile, WeekResult, World } from "../models/types";
import type { MessageKey } from "../../i18n/catalog";
import { hasOpeningEdit, normalizeOpeningDemo, openingShots, openingTargetCells, retestOpening, type OpeningDemo } from "./openingDemo";
import {
  advancedJitLessons,
  applyInvitedPreviewReward,
  createInvitedPreviewEvidence,
  normalizeOnboardingReceipts,
  reconcilePublicMilestones,
  validHoleCount,
  worldHasInvitedPreviewReward,
  type OnboardingReceipts,
} from "./invitedPreview";

export const TUTORIAL_PROGRESS_VERSION = 2 as const;

export type TutorialTarget =
  | "course"
  | "terrain-palette"
  | "hole-wizard"
  | "editor-tools"
  | "hole-editor-nav"
  | "shot-plan"
  | "fix-overlay"
  | "speed-controls"
  | "weekly-report"
  | "green-fee"
  | "staff"
  | "maintenance";

export type TutorialStage =
  | "welcome"
  | "paint-fairway"
  | "place-hole"
  | "route-readability"
  | "validate-hole"
  | "invite-group"
  | "observe-play"
  | "review-reaction"
  | "creative-reward"
  | "improve-hole"
  | "retest-play"
  | "compare-preview"
  | "public-three"
  | "course-pricing"
  | "staffing"
  | "maintenance"
  | "weekly-results"
  | "graduation";

export interface TutorialContext {
  course: Course;
  world: World;
  last?: WeekResult;
  onCourse: number;
}

export interface TutorialStep {
  id: TutorialStage;
  eyebrowKey: MessageKey;
  titleKey: MessageKey;
  bodyKey: MessageKey;
  target: TutorialTarget;
  allowedTargets?: readonly TutorialTarget[];
  expression: "neutral" | "pleased" | "worried" | "excited";
  actionLabelKey?: MessageKey;
}

export interface TutorialBaseline {
  fairwayTiles: number;
  greenFee: number;
  maintenanceBudget: number;
  staffLevel: number;
  week: number;
  observedCompletedRounds: number;
}

export interface TutorialProgress {
  version: typeof TUTORIAL_PROGRESS_VERSION;
  active: boolean;
  stage: TutorialStage;
  profile: ExperienceProfile;
  completion: "none" | "creative" | "full" | "skipped";
  baseline: TutorialBaseline;
  receipts: OnboardingReceipts;
  jitQueue: string[];
  /** Retained only to explain compatibility recovery in diagnostics. */
  migratedLegacyStep?: number;
  opening?: OpeningDemo;
}

export type TutorialViewMode = "COZY" | "ARCHITECT";

const STORAGE_KEY = "coursecraft_tutorial_progress_v2";
const LEGACY_STORAGE_KEY = "coursecraft_tutorial_progress_v1";

const CREATIVE_STAGES: readonly TutorialStage[] = [
  "welcome", "paint-fairway", "place-hole", "route-readability", "validate-hole",
  "invite-group", "observe-play", "review-reaction", "creative-reward",
];
const CLASSIC_OPERATIONS_STAGES: readonly TutorialStage[] = [
  "public-three", "course-pricing", "staffing", "maintenance", "weekly-results", "graduation",
];

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  { id: "welcome", eyebrowKey: "tutorial.preview.welcome.eyebrow", titleKey: "tutorial.preview.welcome.title", bodyKey: "tutorial.preview.welcome.body", target: "course", expression: "neutral", actionLabelKey: "tutorial.preview.welcome.action" },
  { id: "paint-fairway", eyebrowKey: "tutorial.preview.paint.eyebrow", titleKey: "tutorial.preview.paint.title", bodyKey: "tutorial.preview.paint.body", target: "terrain-palette", allowedTargets: ["terrain-palette", "course"], expression: "pleased" },
  { id: "place-hole", eyebrowKey: "tutorial.preview.place.eyebrow", titleKey: "tutorial.preview.place.title", bodyKey: "tutorial.preview.place.body", target: "hole-wizard", allowedTargets: ["hole-wizard", "editor-tools", "course"], expression: "neutral" },
  { id: "route-readability", eyebrowKey: "tutorial.preview.route.eyebrow", titleKey: "tutorial.preview.route.title", bodyKey: "tutorial.preview.route.body", target: "shot-plan", allowedTargets: ["shot-plan", "course"], expression: "neutral", actionLabelKey: "tutorial.preview.route.action" },
  { id: "validate-hole", eyebrowKey: "tutorial.preview.validate.eyebrow", titleKey: "tutorial.preview.validate.title", bodyKey: "tutorial.preview.validate.body", target: "fix-overlay", allowedTargets: ["fix-overlay", "hole-editor-nav", "hole-wizard", "editor-tools", "course", "terrain-palette"], expression: "worried" },
  { id: "invite-group", eyebrowKey: "tutorial.preview.invite.eyebrow", titleKey: "tutorial.preview.invite.title", bodyKey: "tutorial.preview.invite.body", target: "course", expression: "excited", actionLabelKey: "tutorial.preview.invite.action" },
  { id: "observe-play", eyebrowKey: "tutorial.preview.observe.eyebrow", titleKey: "tutorial.preview.observe.title", bodyKey: "tutorial.preview.observe.body", target: "course", expression: "neutral", actionLabelKey: "tutorial.preview.observe.action" },
  { id: "review-reaction", eyebrowKey: "tutorial.preview.reaction.eyebrow", titleKey: "tutorial.preview.reaction.title", bodyKey: "tutorial.preview.reaction.body", target: "course", expression: "pleased", actionLabelKey: "tutorial.preview.reaction.action" },
  { id: "creative-reward", eyebrowKey: "tutorial.preview.reward.eyebrow", titleKey: "tutorial.preview.reward.title", bodyKey: "tutorial.preview.reward.body", target: "course", expression: "excited", actionLabelKey: "tutorial.preview.reward.action" },
  { id: "public-three", eyebrowKey: "tutorial.operations.three.eyebrow", titleKey: "tutorial.operations.three.title", bodyKey: "tutorial.operations.three.body", target: "hole-wizard", allowedTargets: ["hole-wizard", "editor-tools", "course", "terrain-palette"], expression: "pleased" },
  { id: "course-pricing", eyebrowKey: "tutorial.operations.pricing.eyebrow", titleKey: "tutorial.operations.pricing.title", bodyKey: "tutorial.operations.pricing.body", target: "green-fee", expression: "neutral" },
  { id: "staffing", eyebrowKey: "tutorial.operations.staff.eyebrow", titleKey: "tutorial.operations.staff.title", bodyKey: "tutorial.operations.staff.body", target: "staff", expression: "neutral" },
  { id: "maintenance", eyebrowKey: "tutorial.operations.maintenance.eyebrow", titleKey: "tutorial.operations.maintenance.title", bodyKey: "tutorial.operations.maintenance.body", target: "maintenance", expression: "worried" },
  { id: "weekly-results", eyebrowKey: "tutorial.operations.results.eyebrow", titleKey: "tutorial.operations.results.title", bodyKey: "tutorial.operations.results.body", target: "weekly-report", expression: "pleased" },
  { id: "graduation", eyebrowKey: "tutorial.operations.complete.eyebrow", titleKey: "tutorial.operations.complete.title", bodyKey: "tutorial.operations.complete.body", target: "course", expression: "excited", actionLabelKey: "tutorial.operations.complete.action" },
];

const OPENING_STEPS: readonly TutorialStep[] = [
  { id: "improve-hole", eyebrowKey: "opening.improve.eyebrow", titleKey: "opening.improve.title", bodyKey: "opening.improve.body", target: "terrain-palette", allowedTargets: ["terrain-palette", "editor-tools", "course"], expression: "neutral", actionLabelKey: "opening.retest.action" },
  { id: "retest-play", eyebrowKey: "opening.retest.eyebrow", titleKey: "opening.retest.title", bodyKey: "opening.retest.body", target: "course", expression: "neutral", actionLabelKey: "opening.compare.action" },
  { id: "compare-preview", eyebrowKey: "opening.compare.eyebrow", titleKey: "opening.compare.title", bodyKey: "opening.compare.body", target: "course", expression: "neutral", actionLabelKey: "opening.finish" },
];
const STEPS = Object.fromEntries([...TUTORIAL_STEPS, ...OPENING_STEPS].map((step) => [step.id, step])) as Record<TutorialStage, TutorialStep>;
const knownStages = new Set<TutorialStage>([...TUTORIAL_STEPS, ...OPENING_STEPS].map((step) => step.id));

function emptyReceipts(): OnboardingReceipts {
  return { preview: { status: "not-invited", evidence: null, rewardReceipt: null }, milestones: [] };
}

function baselineFor(course: Course, world: World, observedCompletedRounds: number): TutorialBaseline {
  return {
    fairwayTiles: course.tiles.filter((tile) => tile === "fairway").length,
    greenFee: course.baseGreenFee,
    maintenanceBudget: world.maintenanceBudget,
    staffLevel: world.staffLevel,
    week: world.week,
    observedCompletedRounds: Math.max(0, Math.floor(observedCompletedRounds)),
  };
}

export function createTutorialProgress(course: Course, world: World, observedCompletedRounds = 0): TutorialProgress {
  return {
    version: TUTORIAL_PROGRESS_VERSION,
    active: true,
    stage: "welcome",
    profile: world.experienceProfile ?? "classic",
    completion: "none",
    baseline: baselineFor(course, world, observedCompletedRounds),
    receipts: emptyReceipts(),
    jitQueue: [],
  };
}

export function restartTutorialProgress(
  previous: TutorialProgress | null,
  course: Course,
  world: World,
  observedCompletedRounds = 0,
): TutorialProgress {
  const fresh = createTutorialProgress(course, world, observedCompletedRounds);
  if (!previous) return fresh;
  // Restart the guide, not its immutable reward/baseline evidence.
  return { ...fresh, receipts: previous.receipts, jitQueue: previous.jitQueue, ...(previous.opening ? { opening: { ...previous.opening, cursor: 0 } } : {}) };
}

export function resumeTutorialProgress(
  previous: TutorialProgress | null,
  course: Course,
  world: World,
  observedCompletedRounds = 0,
): TutorialProgress {
  const resumablePartial = previous
    && !previous.active
    && (previous.completion === "skipped"
      || (previous.profile === "classic" && previous.completion === "creative" && CLASSIC_OPERATIONS_STAGES.includes(previous.stage)));
  if (resumablePartial) return { ...previous, active: true, completion: "none" };
  return restartTutorialProgress(previous, course, world, observedCompletedRounds);
}

export function tutorialStep(progress: TutorialProgress): TutorialStep {
  if (progress.opening && progress.stage === "creative-reward") return { ...STEPS[progress.stage], actionLabelKey: progress.opening.targetCells.length ? "opening.improve.action" : "opening.finish", bodyKey: "opening.reward.body" };
  return STEPS[progress.stage];
}

export function tutorialStepIndex(progress: TutorialProgress): number {
  return TUTORIAL_STEPS.findIndex((step) => step.id === progress.stage);
}

export function tutorialCanAdvance(progress: TutorialProgress, context: TutorialContext): boolean {
  switch (progress.stage) {
    case "paint-fairway": return context.course.tiles.filter((tile) => tile === "fairway").length >= progress.baseline.fairwayTiles + 4;
    case "place-hole": return context.course.holes.some((hole) => !!hole.tee && !!hole.green);
    case "validate-hole":
    case "invite-group": return validHoleCount(context.course) >= 1;
    case "observe-play": return progress.opening
      ? !!progress.receipts.preview.evidence && progress.opening.cursor >= openingShots(progress.receipts.preview.evidence).length
      : progress.receipts.preview.evidence != null;
    case "improve-hole": return !!progress.opening && hasOpeningEdit(context.course, progress.opening) && validHoleCount(context.course) === 1;
    case "retest-play": return !!progress.opening?.candidate && progress.opening.cursor >= openingShots(progress.opening.candidate).length;
    case "compare-preview": return !!progress.opening?.candidate;
    case "review-reaction": return progress.receipts.preview.evidence != null;
    case "public-three": return validHoleCount(context.course) >= 3;
    case "course-pricing": return context.course.baseGreenFee !== progress.baseline.greenFee;
    case "staffing": return context.world.staffLevel !== progress.baseline.staffLevel;
    case "maintenance": return context.world.maintenanceBudget !== progress.baseline.maintenanceBudget;
    case "weekly-results": return !!context.last || context.world.week > progress.baseline.week;
    default: return true;
  }
}

function nextStage(stage: TutorialStage): TutorialStage | null {
  const sequence = [...CREATIVE_STAGES, ...CLASSIC_OPERATIONS_STAGES];
  const index = sequence.indexOf(stage);
  return index >= 0 ? sequence[index + 1] ?? null : null;
}

export function advanceTutorialProgress(progress: TutorialProgress, context: TutorialContext): TutorialProgress {
  if (!progress.active || !tutorialCanAdvance(progress, context)) return progress;
  if (progress.stage === "invite-group") {
    const spentPreviewId = context.world.onboardingRewards?.receipts.find((receipt) => receipt.id === "founders-preview-pennant")?.previewId;
    const retainedEvidence = progress.receipts.preview.evidence?.id === spentPreviewId ? progress.receipts.preview.evidence : null;
    const evidence = retainedEvidence ?? createInvitedPreviewEvidence(context.course, context.world);
    if (!evidence) return progress;
    return {
      ...progress, stage: "observe-play",
      receipts: { ...progress.receipts, preview: { ...progress.receipts.preview, status: "observed", evidence } },
      ...(progress.opening ? { opening: { ...progress.opening, cursor: 0, targetCells: retainedEvidence ? progress.opening.targetCells : openingTargetCells(context.course, evidence) } } : {}),
    };
  }
  if (progress.opening && progress.stage === "creative-reward") return progress.opening.targetCells.length
    ? { ...progress, stage: "improve-hole" }
    : { ...progress, active: false, completion: "creative" };
  if (progress.opening && progress.stage === "improve-hole") {
    const baseline = progress.receipts.preview.evidence;
    const candidate = baseline && retestOpening(context.course, context.world, baseline);
    if (!candidate || candidate.holeFingerprint === baseline?.holeFingerprint) return progress;
    return { ...progress, stage: "retest-play", opening: { ...progress.opening, candidate, cursor: 0 } };
  }
  if (progress.opening && progress.stage === "retest-play") return { ...progress, stage: "compare-preview" };
  if (progress.opening && progress.stage === "compare-preview") return { ...progress, active: false, completion: "creative" };
  if (progress.stage === "review-reaction") {
    return progress;
  }
  if (progress.stage === "creative-reward" && progress.profile !== "classic") {
    return { ...progress, active: false, completion: "creative", jitQueue: advancedJitLessons(progress.profile) };
  }
  if (progress.stage === "graduation") return { ...progress, active: false, completion: "full" };
  const stage = nextStage(progress.stage);
  return stage ? { ...progress, stage } : progress;
}

export function claimTutorialPreviewReward(
  progress: TutorialProgress,
  course: Course,
  world: World,
): { progress: TutorialProgress; world: World; applied: boolean } {
  if (!progress.active || progress.stage !== "review-reaction") return { progress, world, applied: false };
  const transaction = applyInvitedPreviewReward(world, progress.receipts.preview, course);
  if (!transaction.preview.rewardReceipt) return { progress, world, applied: false };
  return {
    progress: { ...progress, stage: "creative-reward", receipts: { ...progress.receipts, preview: transaction.preview } },
    world: transaction.world,
    applied: transaction.applied,
  };
}

/** Repair an interrupted save after either side of the atomic reward commit persisted first. */
export function reconcileTutorialRewardTransaction(
  progress: TutorialProgress,
  course: Course,
  world: World,
): { progress: TutorialProgress; world: World; applied: boolean } {
  const preview = progress.receipts.preview;
  const receipt = preview.rewardReceipt;
  if (!receipt) return { progress, world, applied: false };
  if (worldHasInvitedPreviewReward(world)) return { progress, world, applied: false };
  if (
    preview.evidence
    && receipt.previewId === preview.evidence.id
    && receipt.id === "founders-preview-pennant"
    && receipt.cash === 750
    && receipt.reputation === 1
  ) {
    const recovered = applyInvitedPreviewReward(world, preview, course);
    if (recovered.applied) {
      return {
        progress: { ...progress, receipts: { ...progress.receipts, preview: recovered.preview } },
        world: recovered.world,
        applied: true,
      };
    }
  }
  const sanitized: TutorialProgress = {
    ...progress,
    receipts: {
      preview: { status: preview.evidence ? "observed" : "not-invited", evidence: preview.evidence, rewardReceipt: null },
      milestones: [],
    },
  };
  return { progress: sanitized, world, applied: false };
}

export function skipTutorial(progress: TutorialProgress): TutorialProgress {
  return { ...progress, active: false, completion: progress.receipts.preview.rewardReceipt ? "creative" : "skipped" };
}

export function skipTutorialModule(progress: TutorialProgress): TutorialProgress {
  if (CLASSIC_OPERATIONS_STAGES.includes(progress.stage) && progress.receipts.preview.rewardReceipt) {
    return { ...progress, active: false, completion: "creative" };
  }
  return skipTutorial(progress);
}

/** Reconcile durable receipts and the valid-first-hole handoff exactly once. */
export function reconcileTutorialProgress(progress: TutorialProgress, course: Course): TutorialProgress {
  let next = progress;
  const receipts = reconcilePublicMilestones(progress.receipts, course);
  if (receipts !== progress.receipts) next = { ...next, receipts };
  return next;
}

export function reconcileTutorialSession(
  progress: TutorialProgress,
  course: Course,
  viewMode: TutorialViewMode,
): { progress: TutorialProgress; viewMode: TutorialViewMode } {
  return { progress: reconcileTutorialProgress(progress, course), viewMode };
}

export function tutorialPublicThreeHoleOperation(_progress: TutorialProgress | null | undefined, legacyCompleted = false, world?: World): boolean {
  return legacyCompleted || worldHasInvitedPreviewReward(world);
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizedBaseline(value: unknown): TutorialBaseline {
  const baseline = record(value);
  return {
    fairwayTiles: Math.max(0, Math.floor(finite(baseline.fairwayTiles, 0))),
    greenFee: Math.max(0, finite(baseline.greenFee, 35)),
    maintenanceBudget: Math.max(0, finite(baseline.maintenanceBudget, 1_000)),
    staffLevel: Math.max(0, Math.floor(finite(baseline.staffLevel, 1))),
    week: Math.max(1, Math.floor(finite(baseline.week, 1))),
    observedCompletedRounds: Math.max(0, Math.floor(finite(baseline.observedCompletedRounds, 0))),
  };
}

const legacyStage: TutorialStage[] = [
  "welcome", "paint-fairway", "place-hole", "route-readability", "validate-hole", "validate-hole",
  "invite-group", "weekly-results", "course-pricing", "maintenance", "weekly-results", "graduation",
];

export function normalizeTutorialProgress(value: unknown): TutorialProgress | null {
  if (!value || typeof value !== "object") return null;
  const candidate = record(value);
  const baseline = normalizedBaseline(candidate.baseline);
  if (candidate.version !== TUTORIAL_PROGRESS_VERSION) {
    const legacyIndex = Number.isInteger(candidate.stepIndex) ? Math.max(0, Math.min(11, candidate.stepIndex as number)) : 0;
    return {
      version: TUTORIAL_PROGRESS_VERSION,
      active: candidate.active !== false,
      stage: legacyStage[legacyIndex],
      profile: "classic",
      completion: "none",
      baseline,
      receipts: emptyReceipts(),
      jitQueue: [],
      migratedLegacyStep: legacyIndex,
    };
  }
  const opening = normalizeOpeningDemo(candidate.opening);
  const stage = knownStages.has(candidate.stage as TutorialStage) && (opening || !OPENING_STEPS.some((step) => step.id === candidate.stage)) ? candidate.stage as TutorialStage : "welcome";
  const profile = candidate.profile === "relaxed" || candidate.profile === "simulation" || candidate.profile === "classic" ? candidate.profile : "classic";
  const completion = candidate.completion === "creative" || candidate.completion === "full" || candidate.completion === "skipped" ? candidate.completion : "none";
  return {
    version: TUTORIAL_PROGRESS_VERSION,
    active: candidate.active === true,
    stage,
    profile,
    completion,
    baseline,
    receipts: normalizeOnboardingReceipts(candidate.receipts),
    jitQueue: Array.isArray(candidate.jitQueue) ? [...new Set(candidate.jitQueue.filter((item): item is string => typeof item === "string"))].slice(0, 8) : [],
    ...(opening ? { opening } : {}),
    ...(Number.isInteger(candidate.migratedLegacyStep) ? { migratedLegacyStep: Math.max(0, Math.min(11, candidate.migratedLegacyStep as number)) } : {}),
  };
}

export function loadTutorialProgress(): TutorialProgress | null {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    return normalizeTutorialProgress(JSON.parse(current ?? localStorage.getItem(LEGACY_STORAGE_KEY) ?? "null"));
  } catch {
    return null;
  }
}

export function saveTutorialProgress(progress: TutorialProgress | null): void {
  if (progress) localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  else localStorage.removeItem(STORAGE_KEY);
}
