import type { Course, World } from "../models/types";
import { updateLayout } from "../models/courseLayouts";
import { applyPropertyCommand, normalizePropertyCourse, type PropertyCommand } from "../property/property";
import {
  applySystemControlCommand,
  type AdvancedSystemId,
} from "../experience/systemControl";

export type OperationsCommand =
  | { type: "SET_COURSE_GREEN_FEE"; courseId: string; greenFee: number }
  | { type: "SET_MAINTENANCE_BUDGET"; amount: number }
  | { type: "PROPERTY_COMMAND"; command: PropertyCommand };

export interface OperationsCommandResult {
  ok: boolean;
  course: Course;
  world: World;
  message: string;
}

/** Resolve the authority a deliberate player operation owns. */
export function manualAuthorityForOperationsCommand(
  course: Course,
  command: OperationsCommand,
): Extract<AdvancedSystemId, "maintenance" | "property" | "resort"> {
  if (command.type === "SET_MAINTENANCE_BUDGET") return "maintenance";
  if (command.type === "SET_COURSE_GREEN_FEE") return "property";
  const propertyCommand = command.command;
  if (propertyCommand.type === "SET_UPKEEP" || propertyCommand.type === "MAINTAIN") return "maintenance";
  if (propertyCommand.type === "HIRE_SERVICE") {
    return propertyCommand.role === "maintenance" ? "maintenance" : "resort";
  }
  if (propertyCommand.type === "BOOK_PACKAGE" || propertyCommand.type === "RECOVER_SERVICE") return "resort";
  if ("assetId" in propertyCommand) {
    const assetId = propertyCommand.assetId;
    const asset = normalizePropertyCourse(course.property).assets.find((candidate) => candidate.id === assetId);
    if (asset?.category === "resort") return "resort";
  }
  return "property";
}

/**
 * Shared transition authority for both player input and profile automation.
 * Rejections deliberately delegate to the existing Property authority and
 * preserve scenario rules before any state can change.
 */
export function applyOperationsCommand(
  course: Course,
  world: World,
  command: OperationsCommand,
): OperationsCommandResult {
  if (command.type === "PROPERTY_COMMAND") {
    return applyPropertyCommand(course, world, command.command);
  }
  if (command.type === "SET_COURSE_GREEN_FEE") {
    if (!Number.isFinite(command.greenFee) || command.greenFee < 0) {
      return { ok: false, course, world, message: "Green fee must be a non-negative amount." };
    }
    const amount = Math.round(command.greenFee);
    if (world.constraints?.fixedGreenFee != null && amount !== world.constraints.fixedGreenFee) {
      return { ok: false, course, world, message: "The scenario fixes the green fee." };
    }
    const next = updateLayout(course, command.courseId, { greenFee: amount });
    if (next === course) return { ok: false, course, world, message: "That operating course no longer exists." };
    return { ok: true, course: next, world, message: "Green fee updated." };
  }
  if (!Number.isFinite(command.amount) || command.amount < 0) {
    return { ok: false, course, world, message: "Maintenance budget must be a non-negative amount." };
  }
  const amount = Math.round(command.amount);
  if (world.maintenanceBudget === amount) return { ok: true, course, world, message: "Maintenance budget unchanged." };
  return { ok: true, course, world: { ...world, maintenanceBudget: amount }, message: "Maintenance budget updated." };
}

/**
 * Atomic manual adapter. The operation is validated first against immutable
 * inputs; only an accepted result receives its matching direct-control
 * takeover. Automation deliberately calls applyOperationsCommand directly.
 */
export function applyManualOperationsCommand(
  course: Course,
  world: World,
  command: OperationsCommand,
): OperationsCommandResult {
  const operation = applyOperationsCommand(course, world, command);
  if (!operation.ok) return { ...operation, course, world };
  const authority = manualAuthorityForOperationsCommand(course, command);
  const takeover = applySystemControlCommand(operation.world, {
    type: "TAKE_SYSTEM_CONTROL",
    system: authority,
  });
  if (!takeover.ok) return { ok: false, course, world, message: takeover.message };
  return { ...operation, world: takeover.world };
}
