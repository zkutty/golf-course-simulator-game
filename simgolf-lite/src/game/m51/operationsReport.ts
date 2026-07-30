import type { Course, World } from "../models/types";
import { m51MobilityAggregateSummary, normalizeM51CourseMobilityState, normalizeM51LiveMobilityState } from "./mobility";
import type { M51LiveMobilityState, MobilityMode, MobilityProductSettlement } from "./types";

export type MobilityReportEvidence = "observed" | "predicted" | "unavailable";

export interface MobilityOperationsReport {
  days: 1 | 7 | 28;
  label: string;
  sparse: boolean;
  /** Financial values are read from the canonical product settlement. */
  evidence: "observed" | "mixed";
  modeMix: Record<MobilityMode, number>;
  fleet: { owned: number; available: number; inUse: number; peakUtilization: number };
  completedRentals: number;
  stockouts: number;
  conversion: { value: number; evidence: MobilityReportEvidence };
  observedMinutesSaved: number;
  productRevenue: number;
  operatingCost: number;
  netContribution: number;
  occupiedTeeHours: number;
  netRevenuePerOccupiedTeeHour: number;
  demand: { stockout: number; lowDemand: number; unaffordable: number; evidence: MobilityReportEvidence };
  recommendation: { id: "add-fleet" | "review-price" | "collect-evidence" | "none"; state: "stockout" | "pricing" | "sparse" | "healthy"; detail: string };
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const courseIdFor = (course: Course) => course.activeCourseId ?? course.layouts?.[0]?.id ?? "course-primary";
const absolute = (week: number, day: number) => week * 7 + day;

function emptyMix(): Record<MobilityMode, number> { return { walk: 0, pushcart: 0, riding_cart: 0 }; }
function productsFor(rows: readonly MobilityProductSettlement[], courseId: string) { return rows.filter((row) => row.courseId === courseId); }
function reportLabel(days: number, sampleDays: number) {
  return sampleDays === 0 ? "No observed mobility history" : sampleDays < days ? `Observed ${sampleDays}-day history (sparse)` : `Observed ${days}-day history`;
}

function recommendation(input: Pick<MobilityOperationsReport, "stockouts" | "fleet" | "demand" | "completedRentals">): MobilityOperationsReport["recommendation"] {
  if (input.stockouts > 0 || input.demand.stockout > 0) return { id: "add-fleet", state: "stockout", detail: "Observed stock-outs are limiting completed rentals; add the affected fleet type before changing price." };
  if (input.demand.unaffordable > 0 && input.completedRentals === 0) return { id: "review-price", state: "pricing", detail: "Price affordability prevented selection; this is distinct from a stock-out." };
  if (input.completedRentals === 0) return { id: "collect-evidence", state: "sparse", detail: "No completed mobility rentals are available yet; collect observed rounds before expanding fleet." };
  return { id: "none", state: "healthy", detail: input.fleet.peakUtilization >= .9 ? "Fleet is heavily utilized without a recorded stock-out." : "Observed mobility service is operating without a current bottleneck." };
}

function buildReport(args: {
  course: Course; world: World; live?: M51LiveMobilityState; week: number; dayIndex: number; days: 1 | 7 | 28;
}): MobilityOperationsReport {
  const courseId = courseIdFor(args.course);
  const current = normalizeM51CourseMobilityState(args.course.m51, args.course);
  const live = args.live ? normalizeM51LiveMobilityState(args.live, args.live.seed) : null;
  const last = absolute(args.week, args.dayIndex);
  const first = last - args.days + 1;
  const historical = (args.world.m51?.history.dailyLedgers ?? []).filter((ledger) => {
    const day = absolute(ledger.week, ledger.dayIndex);
    return day >= first && day <= last;
  });
  const currentProducts = args.days === 1 && live ? productsFor(m51MobilityAggregateSummary(live).products, courseId) : [] as MobilityProductSettlement[];
  const products = args.days === 1 && live ? currentProducts : productsFor(historical.flatMap((ledger) => ledger.products), courseId);
  const observations = [
    ...(args.world.m51?.history.observedEvidence ?? []).filter((row) => row.courseId === courseId && absolute(row.settledAtWeek, row.settledAtDay) >= first && absolute(row.settledAtWeek, row.settledAtDay) <= last),
    ...(args.days === 1 && live ? live.observedEvidence.filter((row) => row.courseId === courseId) : []),
  ];
  const mix = emptyMix();
  for (const row of observations) if (row.completed) mix[row.mode]++;
  const ownedUnits = Object.values(current.fleet).filter((unit) => unit.courseId === courseId && unit.state !== "retired");
  const active = live?.assignments.filter((assignment) => assignment.courseId === courseId && assignment.status === "active" && assignment.mode !== "walk") ?? [];
  const activeIds = new Set(active.flatMap((assignment) => assignment.fleetUnitIds));
  const owned = ownedUnits.length;
  const available = ownedUnits.filter((unit) => unit.state === "available" && !activeIds.has(unit.id)).length;
  const inUse = ownedUnits.filter((unit) => unit.state === "in_use" || activeIds.has(unit.id)).length;
  const peakUtilization = products.length
    ? Math.max(inUse / Math.max(1, owned), ...products.map((row) => row.utilizedUnits / Math.max(1, row.availableUnits)))
    : inUse / Math.max(1, owned);
  const productRevenue = round2(products.reduce((sum, row) => sum + row.grossRevenue, 0));
  const operatingCost = round2(products.reduce((sum, row) => sum + row.operatingCosts, 0));
  const completedRentals = products.reduce((sum, row) => sum + row.returns, 0);
  const stockouts = products.reduce((sum, row) => sum + row.stockouts, 0);
  const observedMinutesSaved = round2(observations.filter((row) => row.completed).reduce((sum, row) => sum + (row.minutesSaved ?? 0), 0));
  const occupiedTeeHours = round2(observations.filter((row) => row.completed).reduce((sum, row) => sum + row.paceMinutes, 0) / 60);
  const selections = args.days === 1 && live ? live.selections.filter((row) => row.courseId === courseId) : [];
  const stockoutDemand = args.days === 1 && live ? live.stockouts.filter((row) => row.courseId === courseId).length : stockouts;
  const unaffordable = selections.filter((row) => row.reason === "unaffordable_fallback").length;
  const lowDemand = selections.filter((row) => row.reason === "preference" && row.mode === "walk").length;
  const conversionEvidence: MobilityReportEvidence = args.days === 1 && live ? "predicted" : observations.length ? "observed" : "unavailable";
  const conversion = conversionEvidence === "predicted"
    ? selections.length ? selections.filter((row) => row.mode !== "walk" && row.status === "confirmed").length / selections.length : 0
    : completedRentals / Math.max(1, completedRentals + stockouts);
  const demand = { stockout: stockoutDemand, lowDemand, unaffordable, evidence: args.days === 1 && live ? "predicted" as const : "unavailable" as const };
  const base = {
    days: args.days, label: reportLabel(args.days, args.days === 1 && live ? 1 : historical.length), sparse: (args.days === 1 && live ? 1 : historical.length) < args.days,
    evidence: observations.length ? "observed" as const : "mixed" as const, modeMix: mix,
    fleet: { owned, available, inUse, peakUtilization: Math.min(1, peakUtilization) }, completedRentals, stockouts,
    conversion: { value: round2(conversion), evidence: conversionEvidence }, observedMinutesSaved, productRevenue, operatingCost,
    netContribution: round2(productRevenue - operatingCost), occupiedTeeHours,
    netRevenuePerOccupiedTeeHour: occupiedTeeHours ? round2((productRevenue - operatingCost) / occupiedTeeHours) : 0,
    demand,
  };
  return { ...base, recommendation: recommendation(base) };
}

/** Read-only operating surface. It consumes M51's live evidence and settled ledgers; it never settles cash. */
export function buildMobilityOperationsReports(args: { course: Course; world: World; live?: M51LiveMobilityState; week: number; dayIndex: number }) {
  return { current: buildReport({ ...args, days: 1 }), reports7: buildReport({ ...args, days: 7 }), reports28: buildReport({ ...args, days: 28 }) };
}
