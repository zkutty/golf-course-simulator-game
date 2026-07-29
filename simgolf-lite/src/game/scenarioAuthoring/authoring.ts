import { createObjectiveState } from "../models/objectives";
import type { GoalDefinition } from "../models/objectives";
import { normalizeCourseLayouts, validateDraftRouting } from "../models/courseLayouts";
import type { Course, ScenarioConstraints, World } from "../models/types";
import { STORY_DEFINITION_BY_ID } from "../livingClub/content";
import type { ChallengePayloadV1, CoursePackageV1 } from "../contentPackages/types";
import { remapImportedCourseIdentity } from "../contentPackages/packageFormat";
import { SUPPORTED_GOAL_TEMPLATE_IDS } from "./templates";

const GOAL_METRICS = new Set([
  "cash", "reputation", "courseRating", "holesBuilt", "publishedHoles", "publishedCourses",
  "weeklyProfit", "profitStreak", "totalRounds", "condition", "tournamentPlacement",
]);
const CONSTRAINT_KEYS = new Set(["noLoans", "fixedGreenFee", "protectedTrees"]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,95}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export interface CoursePlayabilityReport {
  valid: boolean;
  blockers: string[];
}

export interface ScenarioAuthoringReport {
  valid: boolean;
  blockers: string[];
}

export function validateCoursePlayability(course: Course): CoursePlayabilityReport {
  const blockers: string[] = [];
  let normalized: Course;
  try {
    normalized = normalizeCourseLayouts(course);
  } catch {
    return { valid: false, blockers: ["course: cannot normalize course layouts"] };
  }
  if (!normalized.layouts?.length) blockers.push("course: at least one routing is required");
  for (const layout of normalized.layouts ?? []) {
    const validation = validateDraftRouting(normalized, layout.id);
    for (const reason of validation.reasons) blockers.push(`layout ${layout.id}: ${reason}`);
    if (layout.draftHoleIds.length > 0 && layout.publishedHoleIds.length === 0) {
      blockers.push(`layout ${layout.id}: publish the tested routing before packaging`);
    }
  }
  return { valid: blockers.length === 0, blockers: [...new Set(blockers)] };
}

function validateGoal(goal: unknown, index: number, blockers: string[]): goal is GoalDefinition {
  if (!isRecord(goal)) {
    blockers.push(`challenge.goals[${index}]: goal must be an object`);
    return false;
  }
  const id = goal.id;
  const allowedGoalKeys = new Set(["id", "label", "description", "labelKey", "descriptionKey", "match", "conditions", "deadlineWeek"]);
  for (const key of Object.keys(goal)) if (!allowedGoalKeys.has(key)) blockers.push(`challenge.goals[${index}]: unsupported field ${key}`);
  if (typeof id !== "string" || !ID_PATTERN.test(id)) blockers.push(`challenge.goals[${index}]: stable goal ID is invalid`);
  if (typeof goal.label !== "string" || goal.label.trim().length === 0 || goal.label.length > 160) blockers.push(`challenge.goals[${index}]: label is required and capped at 160 characters`);
  if (goal.description !== undefined && (typeof goal.description !== "string" || goal.description.length > 500)) blockers.push(`challenge.goals[${index}]: description exceeds 500 characters`);
  if (goal.match !== undefined && goal.match !== "all" && goal.match !== "any") blockers.push(`challenge.goals[${index}]: match must be all or any`);
  if (!Array.isArray(goal.conditions) || goal.conditions.length < 1 || goal.conditions.length > 8) {
    blockers.push(`challenge.goals[${index}]: one to eight conditions are required`);
    return false;
  }
  for (const [conditionIndex, condition] of goal.conditions.entries()) {
    if (!isRecord(condition)) {
      blockers.push(`challenge.goals[${index}].conditions[${conditionIndex}]: condition must be an object`);
      continue;
    }
    for (const key of Object.keys(condition)) if (!["metric", "comparator", "target"].includes(key)) blockers.push(`challenge.goals[${index}].conditions[${conditionIndex}]: unsupported field ${key}`);
    if (typeof condition.metric !== "string" || !GOAL_METRICS.has(condition.metric)) blockers.push(`challenge.goals[${index}].conditions[${conditionIndex}]: unsupported metric`);
    if (condition.comparator !== ">=" && condition.comparator !== "<=") blockers.push(`challenge.goals[${index}].conditions[${conditionIndex}]: unsupported comparator`);
    if (typeof condition.target !== "number" || !Number.isFinite(condition.target)) blockers.push(`challenge.goals[${index}].conditions[${conditionIndex}]: target must be finite`);
  }
  if (goal.deadlineWeek !== undefined && (typeof goal.deadlineWeek !== "number" || !Number.isInteger(goal.deadlineWeek) || goal.deadlineWeek < 1 || goal.deadlineWeek > 10_000)) blockers.push(`challenge.goals[${index}]: deadline week is outside 1..10000`);
  return true;
}

export function validateScenarioAuthoring(challenge: ChallengePayloadV1 | undefined): ScenarioAuthoringReport {
  if (!challenge) return { valid: true, blockers: [] };
  const blockers: string[] = [];
  if (!Number.isFinite(challenge.startingCash ?? 0) || (challenge.startingCash ?? 0) < 0 || (challenge.startingCash ?? 0) > 10_000_000) blockers.push("challenge.startingCash: must be between 0 and 10000000");
  if (!Array.isArray(challenge.goals) || challenge.goals.length > 20) blockers.push("challenge.goals: an array of at most 20 goals is required");
  const goalIds = new Set<string>();
  for (const [index, goal] of (Array.isArray(challenge.goals) ? challenge.goals : []).entries()) {
    if (validateGoal(goal, index, blockers) && typeof goal.id === "string") {
      if (goalIds.has(goal.id)) blockers.push(`challenge.goals[${index}]: duplicate goal ID ${goal.id}`);
      goalIds.add(goal.id);
    }
  }
  if (challenge.goalTemplateIds !== undefined) {
    if (!Array.isArray(challenge.goalTemplateIds) || challenge.goalTemplateIds.length > 20) blockers.push("challenge.goalTemplateIds: at most 20 supported templates");
    const templateIds = new Set<string>();
    for (const [index, id] of (Array.isArray(challenge.goalTemplateIds) ? challenge.goalTemplateIds : []).entries()) {
      if (typeof id !== "string" || !SUPPORTED_GOAL_TEMPLATE_IDS.has(id)) blockers.push(`challenge.goalTemplateIds[${index}]: unsupported goal template`);
      else if (templateIds.has(id)) blockers.push(`challenge.goalTemplateIds[${index}]: duplicate goal template`);
      else templateIds.add(id);
    }
  }
  if (!Array.isArray(challenge.allowedEventIds) || challenge.allowedEventIds.length > 40) blockers.push("challenge.allowedEventIds: at most 40 supported events");
  const eventIds = new Set<string>();
  for (const [index, id] of (Array.isArray(challenge.allowedEventIds) ? challenge.allowedEventIds : []).entries()) {
    if (typeof id !== "string" || !STORY_DEFINITION_BY_ID.has(id)) blockers.push(`challenge.allowedEventIds[${index}]: unsupported event ID`);
    else if (eventIds.has(id)) blockers.push(`challenge.allowedEventIds[${index}]: duplicate event ID`);
    else eventIds.add(id);
  }
  const constraints = challenge.constraints as unknown;
  if (constraints !== undefined) {
    if (!isRecord(constraints)) blockers.push("challenge.constraints: must be an object");
    else {
      for (const key of Object.keys(constraints)) if (!CONSTRAINT_KEYS.has(key)) blockers.push(`challenge.constraints.${key}: unsupported constraint`);
      if (constraints.noLoans !== undefined && typeof constraints.noLoans !== "boolean") blockers.push("challenge.constraints.noLoans: must be boolean");
      if (constraints.protectedTrees !== undefined && typeof constraints.protectedTrees !== "boolean") blockers.push("challenge.constraints.protectedTrees: must be boolean");
      if (constraints.fixedGreenFee !== undefined && (typeof constraints.fixedGreenFee !== "number" || !Number.isFinite(constraints.fixedGreenFee) || constraints.fixedGreenFee < 0 || constraints.fixedGreenFee > 10_000)) blockers.push("challenge.constraints.fixedGreenFee: must be between 0 and 10000");
    }
  }
  return { valid: blockers.length === 0, blockers: [...new Set(blockers)] };
}

export function buildPackageTestRun(value: CoursePackageV1, baseWorld: World, instanceId: string): { course: Course; world: World } {
  const course = remapImportedCourseIdentity(value, instanceId);
  const challenge = value.payload.challenge;
  if (!challenge) return { course, world: structuredClone(baseWorld) };
  const world = structuredClone(baseWorld);
  const constraints = challenge.constraints as ScenarioConstraints | undefined;
  return {
    course,
    world: {
      ...world,
      mode: "challenge",
      difficulty: challenge.difficulty,
      ...(challenge.startingCash == null ? {} : { cash: challenge.startingCash }),
      constraints,
      scenarioId: `package-${value.manifest.contentId}`,
      objectives: challenge.goals.length > 0 ? createObjectiveState(structuredClone(challenge.goals)) : null,
      campaign: undefined,
    },
  };
}
