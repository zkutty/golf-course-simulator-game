import type { Course, WeekResult, World } from "../models/types";
import { isCoursePlayable } from "../sim/isCoursePlayable";
import { scoreCourseHoles } from "../sim/holes";
import type { MessageKey } from "../../i18n/catalog";

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
  | "maintenance";

export interface TutorialContext {
  course: Course;
  world: World;
  last?: WeekResult;
  onCourse: number;
}

export interface TutorialStep {
  id: string;
  eyebrowKey: MessageKey;
  titleKey: MessageKey;
  bodyKey: MessageKey;
  target: TutorialTarget;
  allowedTargets?: readonly TutorialTarget[];
  expression: "neutral" | "pleased" | "worried" | "excited";
  canAdvance: (context: TutorialContext, baseline: TutorialBaseline) => boolean;
  actionLabelKey?: MessageKey;
}

export interface TutorialBaseline {
  fairwayTiles: number;
  greenFee: number;
  maintenanceBudget: number;
  week: number;
}

export interface TutorialProgress {
  active: boolean;
  stepIndex: number;
  baseline: TutorialBaseline;
}

const STORAGE_KEY = "coursecraft_tutorial_progress_v1";

const always = () => true;
const validHoles = (course: Course) => scoreCourseHoles(course).holes.filter((hole) => hole.isComplete && hole.isValid).length;
export const FULL_COURSE_HOLE_COUNT = 9;

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: "meet-land",
    eyebrowKey: "tutorial.lesson1.eyebrow", titleKey: "tutorial.lesson1.title", bodyKey: "tutorial.lesson1.body",
    target: "course",
    expression: "neutral",
    canAdvance: always,
    actionLabelKey: "tutorial.lesson1.action",
  },
  {
    id: "paint-corridor",
    eyebrowKey: "tutorial.lesson2.eyebrow", titleKey: "tutorial.lesson2.title", bodyKey: "tutorial.lesson2.body",
    target: "terrain-palette",
    allowedTargets: ["terrain-palette", "course"],
    expression: "pleased",
    canAdvance: ({ course }, baseline) => course.tiles.filter((tile) => tile === "fairway").length >= baseline.fairwayTiles + 4,
  },
  {
    id: "place-hole",
    eyebrowKey: "tutorial.lesson3.eyebrow", titleKey: "tutorial.lesson3.title", bodyKey: "tutorial.lesson3.body",
    target: "hole-wizard",
    allowedTargets: ["hole-wizard", "editor-tools", "course"],
    expression: "neutral",
    canAdvance: ({ course }) => course.holes.some((hole) => !!hole.tee && !!hole.green),
  },
  {
    id: "shot-plan",
    eyebrowKey: "tutorial.lesson4.eyebrow", titleKey: "tutorial.lesson4.title", bodyKey: "tutorial.lesson4.body",
    target: "shot-plan",
    allowedTargets: ["shot-plan", "course"],
    expression: "neutral",
    canAdvance: always,
    actionLabelKey: "tutorial.lesson4.action",
  },
  {
    id: "fix-corridor",
    eyebrowKey: "tutorial.lesson5.eyebrow", titleKey: "tutorial.lesson5.title", bodyKey: "tutorial.lesson5.body",
    target: "fix-overlay",
    allowedTargets: ["fix-overlay", "hole-editor-nav", "hole-wizard", "editor-tools", "course", "terrain-palette"],
    expression: "worried",
    canAdvance: ({ course }) => validHoles(course) >= 1,
  },
  {
    id: "open-course",
    eyebrowKey: "tutorial.lesson6.eyebrow", titleKey: "tutorial.lesson6.title", bodyKey: "tutorial.lesson6.body",
    target: "hole-wizard",
    allowedTargets: ["hole-wizard", "course", "terrain-palette"],
    expression: "pleased",
    canAdvance: ({ course }) => isCoursePlayable(course),
  },
  {
    id: "watch-golfers",
    eyebrowKey: "tutorial.lesson7.eyebrow", titleKey: "tutorial.lesson7.title", bodyKey: "tutorial.lesson7.body",
    target: "speed-controls",
    expression: "excited",
    canAdvance: ({ onCourse }) => onCourse > 0,
  },
  {
    id: "weekly-report",
    eyebrowKey: "tutorial.lesson8.eyebrow", titleKey: "tutorial.lesson8.title", bodyKey: "tutorial.lesson8.body",
    target: "weekly-report",
    expression: "neutral",
    canAdvance: ({ last }) => !!last,
  },
  {
    id: "green-fee",
    eyebrowKey: "tutorial.lesson9.eyebrow", titleKey: "tutorial.lesson9.title", bodyKey: "tutorial.lesson9.body",
    target: "green-fee",
    expression: "neutral",
    canAdvance: ({ course }, baseline) => course.baseGreenFee !== baseline.greenFee,
  },
  {
    id: "maintenance",
    eyebrowKey: "tutorial.lesson10.eyebrow", titleKey: "tutorial.lesson10.title", bodyKey: "tutorial.lesson10.body",
    target: "maintenance",
    expression: "worried",
    canAdvance: ({ world }, baseline) => world.maintenanceBudget !== baseline.maintenanceBudget,
  },
  {
    id: "first-profit",
    eyebrowKey: "tutorial.lesson11.eyebrow", titleKey: "tutorial.lesson11.title", bodyKey: "tutorial.lesson11.body",
    target: "weekly-report",
    expression: "pleased",
    canAdvance: ({ last }) => (last?.profit ?? 0) > 0,
  },
  {
    id: "graduation",
    eyebrowKey: "tutorial.lesson12.eyebrow", titleKey: "tutorial.lesson12.title", bodyKey: "tutorial.lesson12.body",
    target: "course",
    expression: "excited",
    canAdvance: always,
    actionLabelKey: "tutorial.lesson12.action",
  },
];

export function createTutorialProgress(course: Course, world: World): TutorialProgress {
  return {
    active: true,
    stepIndex: 0,
    baseline: {
      fairwayTiles: course.tiles.filter((tile) => tile === "fairway").length,
      greenFee: course.baseGreenFee,
      maintenanceBudget: world.maintenanceBudget,
      week: world.week,
    },
  };
}

/**
 * Reconcile event-driven tutorial progress against the authoritative course.
 *
 * The ninth-hole milestone can be awarded before React renders the tutorial
 * CTA, and a save can be resumed after that edge has already happened. Keep
 * this deliberately single-step: duplicate milestone/course updates move the
 * lesson exactly once and can never skip the golfer-observation instruction.
 */
export function reconcileTutorialProgress(progress: TutorialProgress, course: Course): TutorialProgress {
  if (TUTORIAL_STEPS[progress.stepIndex]?.id !== "open-course") return progress;
  if (validHoles(course) < FULL_COURSE_HOLE_COUNT) return progress;
  return { ...progress, stepIndex: progress.stepIndex + 1 };
}

export function loadTutorialProgress(): TutorialProgress | null {
  try {
    return normalizeTutorialProgress(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    return null;
  }
}

export function normalizeTutorialProgress(value: unknown): TutorialProgress | null {
  if (!value || typeof value !== "object") return null;
  const progress = value as TutorialProgress;
  const baseline = progress.baseline;
  if (
    progress.active !== true ||
    !Number.isInteger(progress.stepIndex) ||
    !baseline ||
    !Number.isFinite(baseline.fairwayTiles) ||
    !Number.isFinite(baseline.greenFee) ||
    !Number.isFinite(baseline.maintenanceBudget) ||
    !Number.isFinite(baseline.week)
  ) return null;
  return { ...progress, stepIndex: Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, progress.stepIndex)) };
}

export function saveTutorialProgress(progress: TutorialProgress | null): void {
  if (progress) localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  else localStorage.removeItem(STORAGE_KEY);
}
