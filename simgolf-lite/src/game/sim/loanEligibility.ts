import type { Course, World } from "../models/types";
import { getEffectiveBalance, type EffectiveBalance } from "../balance/difficulty";
import { scoreCourseHoles } from "./holes";
import { isCoursePlayable } from "./isCoursePlayable";

function validHoleCount(course: Course): number {
  return scoreCourseHoles(course).holes.filter((hole) => hole.isComplete && hole.isValid).length;
}

export function canTakeBridgeLoan(
  course: Course,
  world: World,
  balance: EffectiveBalance = getEffectiveBalance(world.difficulty)
): boolean {
  if (world.constraints?.noLoans || world.isBankrupt) return false;
  const holes = validHoleCount(course);
  return (
    world.reputation >= balance.loans.bridge.repMin &&
    (isCoursePlayable(course) || holes >= balance.loans.bridge.minValidHolesAlt) &&
    world.week - (world.lastBridgeLoanWeek ?? -999) >= balance.loans.bridgeCooldownWeeks &&
    !(world.loans ?? []).some((loan) => loan.status === "ACTIVE" && loan.kind === "BRIDGE")
  );
}

export function canTakeExpansionLoan(
  course: Course,
  world: World,
  balance: EffectiveBalance = getEffectiveBalance(world.difficulty)
): boolean {
  if (world.constraints?.noLoans || world.isBankrupt) return false;
  return (
    world.reputation >= balance.loans.expansion.repMin &&
    validHoleCount(course) >= balance.loans.expansion.minValidHoles &&
    (world.lastWeekProfit ?? 0) > 0 &&
    !(world.loans ?? []).some((loan) => loan.status === "ACTIVE" && loan.kind === "EXPANSION")
  );
}
