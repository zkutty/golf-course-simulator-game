import type { Course, WeekResult, World } from "../models/types";
import { isCoursePlayable } from "../sim/isCoursePlayable";
import { scoreCourseHoles } from "../sim/holes";

export type TutorialTarget =
  | "course"
  | "terrain-palette"
  | "hole-wizard"
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
  eyebrow: string;
  title: string;
  body: string;
  target: TutorialTarget;
  expression: "neutral" | "pleased" | "worried" | "excited";
  canAdvance: (context: TutorialContext, baseline: TutorialBaseline) => boolean;
  actionLabel?: string;
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

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: "meet-land",
    eyebrow: "Lesson 1 of 12",
    title: "Meet your patch of earth",
    body: "This is real sandbox land. We will build on it together, and everything you do here remains playable when the lesson ends.",
    target: "course",
    expression: "neutral",
    canAdvance: always,
    actionLabel: "Show me the tools",
  },
  {
    id: "paint-corridor",
    eyebrow: "Lesson 2 of 12",
    title: "Give the ball somewhere to go",
    body: "Choose Fairway and paint a generous corridor. A few tiles are enough to continue; wider corridors are kinder to wayward shots.",
    target: "terrain-palette",
    expression: "pleased",
    canAdvance: ({ course }, baseline) => course.tiles.filter((tile) => tile === "fairway").length >= baseline.fairwayTiles + 4,
  },
  {
    id: "place-hole",
    eyebrow: "Lesson 3 of 12",
    title: "Pin down a hole",
    body: "Open the Hole Wizard, place a tee at one end of your corridor and a green at the other, then confirm it.",
    target: "hole-wizard",
    expression: "neutral",
    canAdvance: ({ course }) => course.holes.some((hole) => !!hole.tee && !!hole.green),
  },
  {
    id: "shot-plan",
    eyebrow: "Lesson 4 of 12",
    title: "Read the shot plan",
    body: "The dotted route estimates how golfers attack the hole. Effective distance includes elevation and hazards, not just the ruler distance.",
    target: "shot-plan",
    expression: "neutral",
    canAdvance: always,
    actionLabel: "I see it",
  },
  {
    id: "fix-corridor",
    eyebrow: "Lesson 5 of 12",
    title: "Make it playable",
    body: "If the hole is flagged, use its Fix overlay and widen the marked landing corridor. The lesson accepts any valid design — no exact score required.",
    target: "fix-overlay",
    expression: "worried",
    canAdvance: ({ course }) => validHoles(course) >= 1,
  },
  {
    id: "open-course",
    eyebrow: "Lesson 6 of 12",
    title: "Open for play",
    body: "A full course needs nine valid holes. Keep using the wizard; you can continue the lesson early if this run already has a playable course.",
    target: "hole-wizard",
    expression: "pleased",
    canAdvance: ({ course }) => isCoursePlayable(course),
  },
  {
    id: "watch-golfers",
    eyebrow: "Lesson 7 of 12",
    title: "Let the first group breathe",
    body: "Set the clock to 1× and watch a group arrive. Their reaction bubbles are honest little course reviews.",
    target: "speed-controls",
    expression: "excited",
    canAdvance: ({ onCourse }) => onCourse > 0,
  },
  {
    id: "weekly-report",
    eyebrow: "Lesson 8 of 12",
    title: "Close the books",
    body: "Open the Results tab after a week closes. Revenue is nice; profit is what survives after staff, maintenance, and overhead.",
    target: "weekly-report",
    expression: "neutral",
    canAdvance: ({ last }) => !!last,
  },
  {
    id: "green-fee",
    eyebrow: "Lesson 9 of 12",
    title: "Price with a light touch",
    body: "Adjust the green fee. Higher prices earn more per round but can cool demand, especially for casual golfers.",
    target: "green-fee",
    expression: "neutral",
    canAdvance: ({ course }, baseline) => course.baseGreenFee !== baseline.greenFee,
  },
  {
    id: "maintenance",
    eyebrow: "Lesson 10 of 12",
    title: "Protect the grass",
    body: "Change the maintenance budget. Underfunding saves cash today, then quietly taxes condition and reputation tomorrow.",
    target: "maintenance",
    expression: "worried",
    canAdvance: ({ world }, baseline) => world.maintenanceBudget !== baseline.maintenanceBudget,
  },
  {
    id: "first-profit",
    eyebrow: "Lesson 11 of 12",
    title: "Reach a profitable week",
    body: "Now tune the loop: fair price, healthy condition, attractive holes. Any positive weekly profit clears this lesson.",
    target: "weekly-report",
    expression: "pleased",
    canAdvance: ({ last }) => (last?.profit ?? 0) > 0,
  },
  {
    id: "graduation",
    eyebrow: "Lesson 12 of 12",
    title: "Your course is open",
    body: "You know the loop: design, observe, read the numbers, adjust. The sandbox is yours — and the career scenarios are waiting when you want a sharper test.",
    target: "course",
    expression: "excited",
    canAdvance: always,
    actionLabel: "Graduate",
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
