import type { Course, World } from "../models/types";
import { updateLayout } from "../models/courseLayouts";
import { applyPropertyCommand, normalizePropertyCourse, type PropertyCommand } from "../property/property";
import { economicPressureForWorld } from "../balance/experience";
import {
  applySystemControlCommand,
  isValidRelaxedRecoveryStateV1,
  normalizeSystemControlState,
  reconcileSystemControlWorld,
  resolveSystemControlPolicy,
  type AdvancedSystemId,
  type RelaxedRecoveryReason,
  type RelaxedRecoverySource,
} from "../experience/systemControl";

export type ManualOperationsCommand =
  | { type: "SET_COURSE_GREEN_FEE"; courseId: string; greenFee: number }
  | { type: "SET_MAINTENANCE_BUDGET"; amount: number }
  | { type: "PROPERTY_COMMAND"; command: PropertyCommand };

export type RelaxedRecoveryPeriod =
  | { source: "live-day"; day: number; weatherSeverity: number; condition: number }
  | { source: "weekly"; weatherSeverity: number; condition: number };

export type RelaxedRecoveryPeriodKey =
  | { source: "live-day"; day: number }
  | { source: "weekly" };

export type RelaxedRecoveryDisposition = "applied" | "noop" | "duplicate" | "rejected";

export interface RelaxedRecoverySettlementResult extends OperationsCommandResult {
  disposition: RelaxedRecoveryDisposition;
}

export interface RelaxedRecoveryPreflight {
  disposition: "ready" | "duplicate" | "rejected";
  message: string;
}

export interface RelaxedRecoveryEvidence {
  weatherSeverity: number;
  condition: number;
}

export type OperationsCommand = ManualOperationsCommand;

export interface OperationsCommandResult {
  ok: boolean;
  course: Course;
  world: World;
  message: string;
}

/** Resolve the authority a deliberate player operation owns. */
export function manualAuthorityForOperationsCommand(
  course: Course,
  command: ManualOperationsCommand,
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
  command: ManualOperationsCommand,
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

const RECOVERY_RECEIPT_LIMIT = 32;

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function recoveryPeriodId(world: World, source: RelaxedRecoverySource, week: number, day?: number): string {
  return `relaxed-recovery-v1:${world.runSeed}:${source}:${week}:${day == null ? "week" : `day-${day}`}`;
}

function isSupportedRecoverySource(source: unknown): source is RelaxedRecoverySource {
  return source === "live-day" || source === "weekly";
}

/**
 * Trusted commit preflight. Callers use this before running any course/world
 * settlement work so rejected or overlapping periods cannot escape as partial
 * commits through a derived course, report, objective, or campaign update.
 */
export function preflightRelaxedRecoveryPeriod(
  previousWorld: World,
  period: RelaxedRecoveryPeriodKey,
): RelaxedRecoveryPreflight {
  if (!isSupportedRecoverySource((period as { source?: unknown }).source)
    || (period.source === "live-day" && (!Number.isInteger(period.day) || period.day < 0 || period.day > 6))) {
    return { disposition: "rejected", message: "relaxed-recovery|invalid-period" };
  }
  if (previousWorld.systemControl?.recovery != null
    && !isValidRelaxedRecoveryStateV1(previousWorld.systemControl.recovery)) {
    return { disposition: "rejected", message: "relaxed-recovery|invalid-liability" };
  }
  const previous = reconcileSystemControlWorld(previousWorld);
  const policy = resolveSystemControlPolicy(previous);
  const state = normalizeSystemControlState(previous.systemControl, policy.profile);
  const current = state.recovery;
  if (!current) return { disposition: "ready", message: "relaxed-recovery|ready" };

  const week = previous.week;
  const day = period.source === "live-day" ? period.day : undefined;
  const liveAbsoluteDay = week * 7 + (day ?? 6);
  const overlapsSettledPeriod = period.source === "weekly"
    ? week <= current.lastSettled.weeklyWeek || current.lastSettled.liveAbsoluteDay >= week * 7
    : liveAbsoluteDay <= current.lastSettled.liveAbsoluteDay || (day === 6 && week <= current.lastSettled.weeklyWeek);
  const id = recoveryPeriodId(previous, period.source, week, day);
  if (overlapsSettledPeriod || current.receipts.some((receipt) => receipt.id === id)) {
    return { disposition: "duplicate", message: `relaxed-recovery|duplicate|${id}` };
  }
  return { disposition: "ready", message: "relaxed-recovery|ready" };
}

function recoveryReasons(course: Course, world: World, evidence: RelaxedRecoveryEvidence): RelaxedRecoveryReason[] {
  const reasons: RelaxedRecoveryReason[] = [];
  if (world.cash < 0) reasons.push("cash-deficit");
  if (evidence.condition < 0.66) reasons.push("poor-turf");
  if (evidence.weatherSeverity >= 0.55) reasons.push("severe-weather");
  if (normalizePropertyCourse(course.property).assets.some((asset) => (asset.constructionDaysRemaining ?? 0) > 0)
    || world.loans.some((loan) => loan.kind === "EXPANSION" && loan.status === "ACTIVE")) {
    reasons.push("expansion-stress");
  }
  return reasons;
}

/**
 * Relaxed recovery is a deterministic, recoverable reserve advance. It can
 * prevent a new liquidity loss, but never revives an already-bankrupt run,
 * counts as profit, or mutates objective/career/competition authority.
 */
export function applyRelaxedRecoverySettlement(
  course: Course,
  previousWorld: World,
  settledWorld: World,
  period: RelaxedRecoveryPeriod,
): RelaxedRecoverySettlementResult {
  if (!isSupportedRecoverySource((period as { source?: unknown }).source)
    || !Number.isFinite(period.weatherSeverity) || !Number.isFinite(period.condition)
    || (period.source === "live-day" && (!Number.isInteger(period.day) || period.day < 0 || period.day > 6))) {
    return { ok: false, course, world: previousWorld, disposition: "rejected", message: "relaxed-recovery|invalid-period" };
  }
  const expectedSettledWeek = period.source === "weekly" ? previousWorld.week + 1 : previousWorld.week;
  if (settledWorld.week !== expectedSettledWeek
    || settledWorld.runSeed !== previousWorld.runSeed
    || settledWorld.experienceProfile !== previousWorld.experienceProfile) {
    return { ok: false, course, world: previousWorld, disposition: "rejected", message: "relaxed-recovery|stale-settlement" };
  }
  const preflight = preflightRelaxedRecoveryPeriod(previousWorld, period);
  if (preflight.disposition !== "ready") {
    return {
      ok: preflight.disposition === "duplicate",
      course,
      world: previousWorld,
      disposition: preflight.disposition,
      message: preflight.message,
    };
  }
  if (previousWorld.isBankrupt || previousWorld.objectives?.outcome === "LOST") {
    const terminalWorld = reconcileSystemControlWorld({
      ...settledWorld,
      experienceProfile: previousWorld.experienceProfile,
      isBankrupt: previousWorld.isBankrupt || settledWorld.isBankrupt,
      ...(previousWorld.objectives?.outcome === "LOST" ? { objectives: previousWorld.objectives } : {}),
      systemControl: previousWorld.systemControl,
    });
    return { ok: true, course, world: terminalWorld, disposition: "noop", message: "relaxed-recovery|terminal-state-preserved" };
  }
  const previous = reconcileSystemControlWorld(previousWorld);
  const reconciled = reconcileSystemControlWorld({
    ...settledWorld,
    experienceProfile: previous.experienceProfile,
    systemControl: previous.systemControl,
  });
  const policy = resolveSystemControlPolicy(reconciled);
  const state = normalizeSystemControlState(previous.systemControl, policy.profile);
  if (!state.recovery && policy.profile !== "relaxed") {
    return { ok: true, course, world: reconciled, disposition: "noop", message: "relaxed-recovery|not-applicable" };
  }
  const current = state.recovery ?? {
    version: 1 as const,
    outstandingAdvance: 0,
    totalRelief: 0,
    totalRepaid: 0,
    receipts: [],
    lastSettled: { liveAbsoluteDay: -1, weeklyWeek: -1 },
  };
  const week = previous.week;
  const day = period.source === "live-day" ? period.day : undefined;
  const liveAbsoluteDay = week * 7 + (day ?? 6);
  const id = recoveryPeriodId(reconciled, period.source, week, day);

  // All reserve evidence is cent-denominated. Snap fractional-cent simulation
  // residue away from terminal state without ever leaving positive cash while
  // an advance is outstanding.
  const roundedCash = money(reconciled.cash);
  const settlementCash = reconciled.cash < 0
    ? Math.min(-0.01, roundedCash)
    : reconciled.cash > 0 && current.outstandingAdvance > 0
      ? Math.max(0.01, roundedCash)
      : roundedCash;
  const relief = policy.profile === "relaxed" && settlementCash < 0 ? money(-settlementCash) : 0;
  const repayment = relief === 0 && settlementCash > 0 && current.outstandingAdvance > 0
    ? money(Math.min(settlementCash, current.outstandingAdvance))
    : 0;
  const lastSettled = {
    liveAbsoluteDay: period.source === "weekly" ? liveAbsoluteDay : Math.max(current.lastSettled.liveAbsoluteDay, liveAbsoluteDay),
    weeklyWeek: period.source === "weekly" || day === 6 ? week : current.lastSettled.weeklyWeek,
  };

  if (relief === 0 && repayment === 0) {
    const tracked = reconcileSystemControlWorld({ ...reconciled, systemControl: { ...state, recovery: { ...current, lastSettled } } });
    return { ok: true, course, world: tracked, disposition: "noop", message: "relaxed-recovery|not-needed" };
  }

  const cashAfter = money(settlementCash + relief - repayment);
  const outstandingAdvance = money(current.outstandingAdvance + relief - repayment);
  const automatedDomains = policy.systems
    .filter((entry) => entry.mode === "automated" && entry.automationAdapter === "seasonal-operations")
    .map((entry) => entry.id);
  const receipt = {
    id,
    source: period.source,
    week,
    ...(day == null ? {} : { day }),
    economicPressure: economicPressureForWorld(reconciled),
    cashBefore: money(previous.cash),
    cashAfterSettlement: settlementCash,
    relief,
    repayment,
    cashAfter,
    outstandingAdvance,
    reasons: recoveryReasons(course, reconciled, period),
    automatedDomains,
  };
  const recovery = {
    version: 1 as const,
    outstandingAdvance,
    totalRelief: money(current.totalRelief + relief),
    totalRepaid: money(current.totalRepaid + repayment),
    receipts: [...current.receipts, receipt].slice(-RECOVERY_RECEIPT_LIMIT),
    lastSettled,
  };
  const recovered = reconcileSystemControlWorld({
    ...reconciled,
    cash: cashAfter,
    ...(relief > 0 ? { distressWeeks: 0, isBankrupt: false } : {}),
    systemControl: { ...state, recovery },
  });
  return {
    ok: true,
    course,
    world: recovered,
    disposition: "applied",
    message: `relaxed-recovery|${relief > 0 ? "advance" : "repayment"}|${relief || repayment}|${outstandingAdvance}`,
  };
}
