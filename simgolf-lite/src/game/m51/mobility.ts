import { BALANCE } from "../balance/balanceConfig";
import { normalizedBuilding } from "../models/buildings";
import type { Course, World } from "../models/types";
import type {
  M51CourseMobilityState,
  M51LiveMobilityState,
  M51MobilityState,
  MobilityAssignment,
  MobilityCartRentalConfiguration,
  MobilityCourseAggregate,
  MobilityEvidenceLabel,
  MobilityFleetUnit,
  MobilityGroupSelection,
  M51MobilityAggregateSummary,
  MobilityObservedEvidence,
  MobilityPredictedEvidence,
  MobilityProduct,
  MobilityRouteCacheIdentity,
  MobilitySettlementInput,
  MobilityTransaction,
  MobilityDailyLedger,
  MobilityProductSettlement,
  MobilityWeeklyReport,
} from "./types";
import { M51_MOBILITY_VERSION, MOBILITY_BUSINESS } from "./types";

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const integer = (value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) => Math.round(clamp(finite(value, fallback), min, max));
const text = (value: unknown, fallback = "", max = 120) => typeof value === "string" ? value.slice(0, max) : fallback;
const mode = (value: unknown): "walk" | "pushcart" | "riding_cart" | null => value === "walk" || value === "pushcart" || value === "riding_cart" ? value : null;
const paidMode = (value: unknown): "pushcart" | "riding_cart" | null => value === "pushcart" || value === "riding_cart" ? value : null;
const courseIdFor = (course: Course) => course.activeCourseId ?? course.layouts?.[0]?.id ?? "course-primary";
const productIdFor = (buildingId: string, productMode: "pushcart" | "riding_cart") => `${buildingId}:${productMode}`;

export function emptyM51MobilityState(): M51MobilityState {
  return { version: M51_MOBILITY_VERSION, history: { settledTransactions: [], observedEvidence: [], dailyLedgers: [], weeklyReports: [] }, aggregates: {} };
}

export function emptyM51CourseMobilityState(): M51CourseMobilityState {
  return { version: M51_MOBILITY_VERSION, cartRentals: {}, fleet: {}, settledAssignmentIds: [] };
}

export function emptyM51LiveMobilityState(seed: number): M51LiveMobilityState {
  return { version: M51_MOBILITY_VERSION, seed: seed >>> 0, nextDecisionOrder: 0, selections: [], assignments: [], transactions: [], predictedEvidence: [], observedEvidence: [], stockouts: [] };
}

/** A stable identity for the existing live route cache, never a path payload. */
export function mobilityRouteCacheKey(identity: MobilityRouteCacheIdentity): string {
  const point = (value: { x: number; y: number }) => `${Math.round(value.x)},${Math.round(value.y)}`;
  return `m51:${identity.courseId}:${identity.layoutId}:${identity.mode}:${point(identity.from)}>${point(identity.to)}`;
}

export function mobilityEvidenceLabel(predictedCount: number, observedCount: number): MobilityEvidenceLabel {
  return observedCount > 0 && predictedCount > 0 ? "mixed" : observedCount > 0 ? "observed" : "predicted";
}

function normalizeTransaction(raw: unknown, settledOnly: boolean): MobilityTransaction | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<MobilityTransaction>;
  const mobilityMode = mode(value.mode);
  const status = value.status === "authorized" || value.status === "voided" || value.status === "settled" ? value.status : null;
  const id = text(value.id); const courseId = text(value.courseId); const groupId = text(value.groupId);
  if (!id || !courseId || !groupId || !mobilityMode || !status || (settledOnly && status !== "settled")) return null;
  const settled = status === "settled";
  return {
    id, courseId, groupId, mode: mobilityMode, status,
    ...(text(value.assignmentId) ? { assignmentId: text(value.assignmentId) } : {}),
    ...(text(value.productId) ? { productId: text(value.productId) } : {}),
    ...(text(value.buildingId) ? { buildingId: text(value.buildingId) } : {}),
    ...(Number.isInteger(value.golferId) && (value.golferId ?? 0) >= 0 ? { golferId: value.golferId } : {}),
    ...(text(value.fleetUnitId) ? { fleetUnitId: text(value.fleetUnitId) } : {}),
    amount: clamp(finite(value.amount, 0), 0, 10_000), seed: integer(value.seed, 0, 0, 0xffffffff),
    decisionOrder: integer(value.decisionOrder, 0), authorizedAtMinute: integer(value.authorizedAtMinute, 0),
    ...(settled ? { settledAtWeek: integer(value.settledAtWeek, 0), settledAtDay: integer(value.settledAtDay, 0, 0, 6) } : {}),
  };
}

function normalizeObserved(raw: unknown): MobilityObservedEvidence | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<MobilityObservedEvidence>;
  const mobilityMode = mode(value.mode); const id = text(value.id); const courseId = text(value.courseId); const groupId = text(value.groupId);
  if (value.source !== "observed" || !id || !courseId || !groupId || !mobilityMode) return null;
  return {
    source: "observed", id, courseId, groupId, mode: mobilityMode, completed: value.completed === true,
    paceMinutes: clamp(finite(value.paceMinutes, 0), 0, 24 * 60), cost: clamp(finite(value.cost, 0), 0, 10_000),
    satisfaction: clamp(finite(value.satisfaction, 50), 0, 100), seed: integer(value.seed, 0, 0, 0xffffffff),
    ...(Number.isFinite(value.predictedWalkingMinutes) ? { predictedWalkingMinutes: clamp(value.predictedWalkingMinutes!, 0, 24 * 60) } : {}),
    ...(Number.isFinite(value.actualTravelMinutes) ? { actualTravelMinutes: clamp(value.actualTravelMinutes!, 0, 24 * 60) } : {}),
    ...(Number.isFinite(value.minutesSaved) ? { minutesSaved: clamp(value.minutesSaved!, -24 * 60, 24 * 60) } : {}),
    ...(Number.isFinite(value.walkingFallbackMinutes) ? { walkingFallbackMinutes: clamp(value.walkingFallbackMinutes!, 0, 24 * 60) } : {}),
    ...(Number.isFinite(value.offPathTiles) ? { offPathTiles: integer(value.offPathTiles, 0, 0, 1_000_000) } : {}),
    decisionOrder: integer(value.decisionOrder, 0), settledAtWeek: integer(value.settledAtWeek, 0), settledAtDay: integer(value.settledAtDay, 0, 0, 6),
  };
}

function order<T extends { id: string; settledAtWeek?: number; settledAtDay?: number; decisionOrder: number }>(rows: T[]): T[] {
  return rows.sort((a, b) => (a.settledAtWeek ?? 0) - (b.settledAtWeek ?? 0) || (a.settledAtDay ?? 0) - (b.settledAtDay ?? 0) || a.decisionOrder - b.decisionOrder || compare(a.id, b.id));
}

function dedupe<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => !seen.has(row.id) && !!seen.add(row.id));
}

function normalizeAggregate(courseId: string, raw: unknown): MobilityCourseAggregate | null {
  if (!raw || typeof raw !== "object" || !courseId) return null;
  const value = raw as Partial<MobilityCourseAggregate>;
  return {
    courseId,
    walkingRounds: integer(value.walkingRounds, 0, 0, 100_000), pushcartRounds: integer(value.pushcartRounds, 0, 0, 100_000),
    ridingCartRounds: integer(value.ridingCartRounds, 0, 0, 100_000), observedRounds: integer(value.observedRounds, 0, 0, 100_000),
    observedPaceMinutes: integer(value.observedPaceMinutes, 0, 0, 100_000_000), settledRevenue: clamp(finite(value.settledRevenue, 0), 0, 1_000_000_000),
    operatingCosts: clamp(finite(value.operatingCosts, 0), 0, 1_000_000_000),
    stockouts: integer(value.stockouts, 0, 0, 1_000_000),
    utilizedUnits: integer(value.utilizedUnits, 0, 0, 1_000_000),
    activeRentals: integer(value.activeRentals, 0, 0, BALANCE.mobility.maxFleetUnits), lastSettledWeek: integer(value.lastSettledWeek, 0),
  };
}

function normalizeProductSettlement(raw: unknown): MobilityProductSettlement | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<MobilityProductSettlement>;
  const productMode = paidMode(value.mode);
  const productId = text(value.productId); const courseId = text(value.courseId); const buildingId = text(value.buildingId);
  if (!productMode || !productId || !courseId || !buildingId) return null;
  const money = (input: unknown) => Math.round(clamp(finite(input, 0), 0, 1_000_000_000) * 100) / 100;
  return {
    productId, courseId, buildingId, mode: productMode,
    rentals: integer(value.rentals, 0, 0, 1_000_000), golfers: integer(value.golfers, 0, 0, 1_000_000),
    utilizedUnits: integer(value.utilizedUnits, 0, 0, 1_000_000), availableUnits: integer(value.availableUnits, 0, 0, BALANCE.mobility.maxFleetUnits),
    stockouts: integer(value.stockouts, 0, 0, 1_000_000), returns: integer(value.returns, 0, 0, 1_000_000),
    damagedReturns: integer(value.damagedReturns, 0, 0, 1_000_000), grossRevenue: money(value.grossRevenue),
    operatingCosts: money(value.operatingCosts), netRevenue: money(value.netRevenue), wear: clamp(finite(value.wear, 0), 0, 1),
    endingCondition: clamp(finite(value.endingCondition, 1), 0, 1),
  };
}

function normalizeDailyLedger(raw: unknown): MobilityDailyLedger | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<MobilityDailyLedger>; const id = text(value.id);
  if (!id || !Number.isInteger(value.week) || !Number.isInteger(value.dayIndex)) return null;
  const products = (Array.isArray(value.products) ? value.products : []).map(normalizeProductSettlement).filter((row): row is MobilityProductSettlement => !!row).slice(0, BALANCE.mobility.maxProducts);
  const grossRevenue = Math.round(products.reduce((sum, row) => sum + row.grossRevenue, 0) * 100) / 100;
  const operatingCosts = Math.round(products.reduce((sum, row) => sum + row.operatingCosts, 0) * 100) / 100;
  return { id, week: integer(value.week, 0), dayIndex: integer(value.dayIndex, 0, 0, 6), products, grossRevenue, operatingCosts, netRevenue: Math.round((grossRevenue - operatingCosts) * 100) / 100 };
}

export function mergeMobilityProductSettlements(rows: MobilityProductSettlement[]): MobilityProductSettlement[] {
  const merged = new Map<string, MobilityProductSettlement>();
  for (const row of rows) {
    const current = merged.get(row.productId) ?? { ...row, rentals: 0, golfers: 0, utilizedUnits: 0, stockouts: 0, returns: 0, damagedReturns: 0, grossRevenue: 0, operatingCosts: 0, netRevenue: 0, wear: 0 };
    current.rentals += row.rentals; current.golfers += row.golfers; current.utilizedUnits += row.utilizedUnits;
    current.availableUnits = Math.max(current.availableUnits, row.availableUnits); current.stockouts += row.stockouts;
    current.returns += row.returns; current.damagedReturns += row.damagedReturns;
    current.grossRevenue = Math.round((current.grossRevenue + row.grossRevenue) * 100) / 100;
    current.operatingCosts = Math.round((current.operatingCosts + row.operatingCosts) * 100) / 100;
    current.netRevenue = Math.round((current.grossRevenue - current.operatingCosts) * 100) / 100;
    current.wear = clamp(current.wear + row.wear, 0, 1); current.endingCondition = row.endingCondition;
    merged.set(row.productId, current);
  }
  return [...merged.values()].sort((a, b) => compare(a.productId, b.productId));
}

function weeklyReport(week: number, ledgers: MobilityDailyLedger[]): MobilityWeeklyReport {
  const products = mergeMobilityProductSettlements(ledgers.flatMap((ledger) => ledger.products));
  const grossRevenue = Math.round(products.reduce((sum, row) => sum + row.grossRevenue, 0) * 100) / 100;
  const operatingCosts = Math.round(products.reduce((sum, row) => sum + row.operatingCosts, 0) * 100) / 100;
  return { id: `m51-week-${week}`, week, days: new Set(ledgers.map((ledger) => ledger.dayIndex)).size, products, grossRevenue, operatingCosts, netRevenue: Math.round((grossRevenue - operatingCosts) * 100) / 100 };
}

/** Accept v1 World records only for the migration bridge; v2 World owns no fleet/products. */
export function normalizeM51MobilityState(raw: unknown): M51MobilityState {
  if (!raw || typeof raw !== "object") return emptyM51MobilityState();
  const value = raw as { version?: unknown; history?: M51MobilityState["history"]; aggregates?: unknown };
  if (value.version !== 1 && value.version !== 2 && value.version !== M51_MOBILITY_VERSION) return emptyM51MobilityState();
  const history = value.history && typeof value.history === "object" ? value.history : undefined;
  const settledTransactions = dedupe(order((Array.isArray(history?.settledTransactions) ? history.settledTransactions : []).map((row) => normalizeTransaction(row, true)).filter((row): row is MobilityTransaction => !!row))).slice(-BALANCE.mobility.maxHistoryTransactions);
  const observedEvidence = dedupe(order((Array.isArray(history?.observedEvidence) ? history.observedEvidence : []).map(normalizeObserved).filter((row): row is MobilityObservedEvidence => !!row))).slice(-BALANCE.mobility.maxObservedEvidence);
  const dailyLedgers = dedupe((Array.isArray(history?.dailyLedgers) ? history.dailyLedgers : []).map(normalizeDailyLedger).filter((row): row is MobilityDailyLedger => !!row).sort((a, b) => a.week - b.week || a.dayIndex - b.dayIndex || compare(a.id, b.id))).slice(-BALANCE.mobility.dailyHistoryDays);
  const weeklyReports = [...new Set(dailyLedgers.map((ledger) => ledger.week))].map((week) => weeklyReport(week, dailyLedgers.filter((ledger) => ledger.week === week))).slice(-BALANCE.mobility.weeklyHistoryWeeks);
  const aggregates: Record<string, MobilityCourseAggregate> = {};
  if (value.version === M51_MOBILITY_VERSION && value.aggregates && typeof value.aggregates === "object") {
    for (const [courseId, aggregate] of Object.entries(value.aggregates).sort(([a], [b]) => compare(a, b)).slice(0, BALANCE.mobility.maxCourseAggregates)) {
      const normalized = normalizeAggregate(text(courseId), aggregate);
      if (normalized) aggregates[normalized.courseId] = normalized;
    }
  }
  return { version: M51_MOBILITY_VERSION, history: { settledTransactions, observedEvidence, dailyLedgers, weeklyReports }, aggregates };
}

function productFor(buildingId: string, courseId: string, productMode: "pushcart" | "riding_cart", raw: unknown, fallbackPrice: number): MobilityProduct {
  const value = raw && typeof raw === "object" ? raw as Partial<MobilityProduct> : {};
  return {
    id: productIdFor(buildingId, productMode), courseId, buildingId, mode: productMode,
    name: text(value.name, productMode === "pushcart" ? "Pushcart" : "Riding Cart"),
    price: clamp(finite(value.price, fallbackPrice), 0, 10_000), enabled: value.enabled !== false,
  };
}

function legacyProducts(raw: unknown): MobilityProduct[] {
  if (!raw || typeof raw !== "object") return [];
  return Object.entries((raw as { products?: unknown }).products ?? {}).flatMap(([id, product]) => {
    if (!product || typeof product !== "object") return [];
    const value = product as Partial<MobilityProduct>;
    const productMode = paidMode(value.mode);
    return productMode && text(value.id) === id ? [{ ...value, id, mode: productMode } as MobilityProduct] : [];
  });
}

/**
 * Course-owned Cart Rental normalization. A legacy cart-rental building price
 * becomes its riding-cart offer; pushcart always comes from the balance table.
 */
export function normalizeM51CourseMobilityState(raw: unknown, course: Course, legacyWorld?: unknown): M51CourseMobilityState {
  const courseId = courseIdFor(course);
  const rawValue = raw && typeof raw === "object" ? raw as Partial<M51CourseMobilityState> : {};
  const rawRentals: Record<string, unknown> = rawValue.cartRentals && typeof rawValue.cartRentals === "object" ? rawValue.cartRentals : {};
  const legacy = legacyProducts(legacyWorld);
  const rentals: Record<string, MobilityCartRentalConfiguration> = {};
  const cartBuildings = (course.buildings ?? []).map(normalizedBuilding).filter((building): building is typeof building & { id: string } => building.type === "cart_rental" && typeof building.id === "string").sort((a, b) => compare(a.id, b.id));
  for (const building of cartBuildings.slice(0, BALANCE.mobility.maxProducts / 2)) {
    const source = rawRentals[building.id] && typeof rawRentals[building.id] === "object" ? rawRentals[building.id] as Partial<MobilityCartRentalConfiguration> : {};
    const sourceProducts: Record<string, unknown> = source.products && typeof source.products === "object" ? source.products : {};
    const legacyRiding = legacy.find((product) => product.courseId === courseId && product.mode === "riding_cart");
    rentals[building.id] = {
      buildingId: building.id,
      tier: building.tier ?? 1,
      products: {
        pushcart: productFor(building.id, courseId, "pushcart", sourceProducts.pushcart, BALANCE.mobility.pushcartDefaultPrice),
        riding_cart: productFor(building.id, courseId, "riding_cart", sourceProducts.riding_cart ?? legacyRiding, building.price ?? 18),
      },
    };
  }
  const fleet: Record<string, MobilityFleetUnit> = {};
  const legacyFleet = legacyWorld && typeof legacyWorld === "object" && (legacyWorld as { fleet?: unknown }).fleet && typeof (legacyWorld as { fleet?: unknown }).fleet === "object"
    ? (legacyWorld as { fleet: Record<string, unknown> }).fleet : {};
  const rawFleet = rawValue.fleet && typeof rawValue.fleet === "object" && Object.keys(rawValue.fleet).length > 0
    ? rawValue.fleet
    : legacyFleet;
  for (const [id, unit] of Object.entries(rawFleet).sort(([a], [b]) => compare(a, b)).slice(0, BALANCE.mobility.maxFleetUnits)) {
    if (!unit || typeof unit !== "object" || !id) continue;
    const value = unit as Partial<MobilityFleetUnit>;
    const unitMode = paidMode(value.mode);
    const buildingId = text(value.buildingId, Object.keys(rentals)[0] ?? "");
    const rental = rentals[buildingId];
    if (!unitMode || !rental || text(value.id) !== id) continue;
    fleet[id] = {
      id, courseId, buildingId, mode: unitMode, productId: rental.products[unitMode].id,
      seats: integer(value.seats, unitMode === "riding_cart" ? 2 : 1, 1, 8),
      state: value.state === "in_use" || value.state === "maintenance" || value.state === "retired" ? value.state : "available",
      condition: clamp(finite(value.condition, 1), 0, 1),
      uses: integer(value.uses, 0, 0, 1_000_000),
      wear: clamp(finite(value.wear, 0), 0, 1),
    };
  }
  const settledAssignmentIds = Array.isArray(rawValue.settledAssignmentIds)
    ? [...new Set(rawValue.settledAssignmentIds.map((id) => text(id)).filter(Boolean))].slice(-BALANCE.mobility.maxHistoryTransactions)
    : [];
  return { version: M51_MOBILITY_VERSION, cartRentals: rentals, fleet, settledAssignmentIds };
}

/** Reject hostile package shapes before they can enter generic course validation. */
export function validateM51CourseMobilityInput(raw: unknown): string[] {
  if (raw == null) return [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return ["course.m51: must be an object"];
  const value = raw as { cartRentals?: unknown; fleet?: unknown };
  const errors: string[] = [];
  if (value.cartRentals != null && (typeof value.cartRentals !== "object" || Array.isArray(value.cartRentals) || Object.keys(value.cartRentals).length > BALANCE.mobility.maxProducts / 2)) errors.push("course.m51: too many Cart Rental configurations");
  if (value.fleet != null && (typeof value.fleet !== "object" || Array.isArray(value.fleet) || Object.keys(value.fleet).length > BALANCE.mobility.maxFleetUnits)) errors.push("course.m51: too many fleet units");
  return errors;
}

export function remapM51CourseMobilityBuildingIds(raw: unknown, buildingIds: Map<string, string>, courseId: string): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const value = raw as { cartRentals?: Record<string, unknown>; fleet?: Record<string, unknown> };
  const cartRentals = Object.fromEntries(Object.entries(value.cartRentals ?? {}).flatMap(([oldId, rental]) => {
    const buildingId = buildingIds.get(oldId);
    if (!buildingId || !rental || typeof rental !== "object") return [];
    const source = rental as Partial<MobilityCartRentalConfiguration>;
    const products = source.products && typeof source.products === "object" ? source.products : {};
    const pushcart = (products as Record<string, unknown>).pushcart;
    const ridingCart = (products as Record<string, unknown>).riding_cart;
    return [[buildingId, { ...source, buildingId, products: {
      pushcart: { ...(pushcart && typeof pushcart === "object" ? pushcart : {}), id: productIdFor(buildingId, "pushcart"), buildingId, courseId, mode: "pushcart" },
      riding_cart: { ...(ridingCart && typeof ridingCart === "object" ? ridingCart : {}), id: productIdFor(buildingId, "riding_cart"), buildingId, courseId, mode: "riding_cart" },
    } }]];
  }));
  const fleet = Object.fromEntries(Object.entries(value.fleet ?? {}).flatMap(([id, unit]) => {
    if (!unit || typeof unit !== "object") return [];
    const source = unit as Partial<MobilityFleetUnit>;
    const buildingId = buildingIds.get(text(source.buildingId));
    const unitMode = paidMode(source.mode);
    return buildingId && unitMode ? [[id, { ...source, id, buildingId, courseId, mode: unitMode, productId: productIdFor(buildingId, unitMode) }]] : [];
  }));
  const settledAssignmentIds = Array.isArray((value as Partial<M51CourseMobilityState>).settledAssignmentIds)
    ? [...new Set((value as Partial<M51CourseMobilityState>).settledAssignmentIds!.map((id) => text(id)).filter(Boolean))].slice(-BALANCE.mobility.maxHistoryTransactions)
    : [];
  return { version: M51_MOBILITY_VERSION, cartRentals, fleet, settledAssignmentIds };
}

function normalizeSelection(raw: unknown): MobilityGroupSelection | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<MobilityGroupSelection>; const mobilityMode = mode(value.mode);
  const id = text(value.id); const groupId = text(value.groupId); const courseId = text(value.courseId);
  if (!id || !groupId || !courseId || !mobilityMode) return null;
  const reason = value.reason === "stockout_fallback" || value.reason === "unaffordable_fallback" || value.reason === "weather_fallback" || value.reason === "policy_fallback" || value.reason === "no_facility" ? value.reason : "preference";
  return {
    id, groupId, courseId, mode: mobilityMode, ...(text(value.productId) ? { productId: text(value.productId) } : {}),
    status: value.status === "confirmed" || value.status === "unavailable" || value.status === "cancelled" ? value.status : "predicted",
    groupSize: integer(value.groupSize, 1, 1, 8), perGolferFee: clamp(finite(value.perGolferFee, 0), 0, 10_000),
    predictedWalkingMinutes: clamp(finite(value.predictedWalkingMinutes, 0), 0, 24 * 60),
    predictedTravelMinutes: clamp(finite(value.predictedTravelMinutes, finite(value.predictedWalkingMinutes, 0)), 0, 24 * 60),
    reason, seed: integer(value.seed, 0, 0, 0xffffffff), decisionOrder: integer(value.decisionOrder, 0),
  };
}

function normalizeAssignment(raw: unknown): MobilityAssignment | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<MobilityAssignment>; const mobilityMode = mode(value.mode);
  const id = text(value.id); const groupId = text(value.groupId); const courseId = text(value.courseId); const selectionId = text(value.selectionId);
  if (!id || !groupId || !courseId || !selectionId || !mobilityMode || !text(value.routeCacheKey)) return null;
  const fleetUnitIds = Array.isArray(value.fleetUnitIds) ? [...new Set(value.fleetUnitIds.map((unitId) => text(unitId)).filter(Boolean))].slice(0, 8).sort(compare) : [];
  const riders = (Array.isArray(value.riders) ? value.riders : []).flatMap((rider) => {
    if (!rider || typeof rider !== "object") return [];
    const candidate = rider as { golferId?: unknown; fleetUnitId?: unknown; seat?: unknown };
    const fleetUnitId = text(candidate.fleetUnitId);
    return Number.isInteger(candidate.golferId) && fleetUnitIds.includes(fleetUnitId)
      ? [{ golferId: candidate.golferId as number, fleetUnitId, seat: integer(candidate.seat, 0, 0, 7) }]
      : [];
  }).sort((a, b) => a.golferId - b.golferId || compare(a.fleetUnitId, b.fleetUnitId) || a.seat - b.seat);
  return {
    id, groupId, courseId, selectionId, mode: mobilityMode, ...(text(value.productId) ? { productId: text(value.productId) } : {}),
    ...(text(value.buildingId) ? { buildingId: text(value.buildingId) } : {}), fleetUnitIds, riders,
    status: value.status === "active" || value.status === "released" || value.status === "cancelled" ? value.status : "reserved",
    routeCacheKey: text(value.routeCacheKey, "", 400), serviceDelayMinutes: clamp(finite(value.serviceDelayMinutes, 0), 0, 180),
    availableUnitsAtSelection: integer(value.availableUnitsAtSelection, fleetUnitIds.length, 0, BALANCE.mobility.maxFleetUnits),
    actualTravelMinutes: clamp(finite(value.actualTravelMinutes, 0), 0, 24 * 60),
    walkingFallbackMinutes: clamp(finite(value.walkingFallbackMinutes, 0), 0, 24 * 60),
    offPathTiles: integer(value.offPathTiles, 0, 0, 1_000_000),
    ...(Number.isFinite(value.returnedCondition) ? { returnedCondition: clamp(value.returnedCondition as number, 0, 1) } : {}),
    seed: integer(value.seed, 0, 0, 0xffffffff), decisionOrder: integer(value.decisionOrder, 0),
  };
}

function normalizePredicted(raw: unknown): MobilityPredictedEvidence | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<MobilityPredictedEvidence>; const mobilityMode = mode(value.mode); const groupId = text(value.groupId); const courseId = text(value.courseId);
  if (value.source !== "predicted" || !groupId || !courseId || !mobilityMode) return null;
  return { source: "predicted", groupId, courseId, mode: mobilityMode, paceMinutes: clamp(finite(value.paceMinutes, 0), 0, 24 * 60), cost: clamp(finite(value.cost, 0), 0, 10_000), confidence: clamp(finite(value.confidence, 0), 0, 1), seed: integer(value.seed, 0, 0, 0xffffffff), decisionOrder: integer(value.decisionOrder, 0) };
}

function orderLive<T extends { id: string; decisionOrder: number }>(rows: T[]): T[] {
  return rows.sort((a, b) => a.decisionOrder - b.decisionOrder || compare(a.id, b.id));
}

/** Live snapshots retain bounded operational state, never routes or unbounded logs. */
export function normalizeM51LiveMobilityState(raw: unknown, fallbackSeed: number): M51LiveMobilityState {
  if (!raw || typeof raw !== "object") return emptyM51LiveMobilityState(fallbackSeed);
  const value = raw as { version?: unknown } & Partial<Omit<M51LiveMobilityState, "version">>;
  if (value.version !== 1 && value.version !== 2 && value.version !== M51_MOBILITY_VERSION) return emptyM51LiveMobilityState(fallbackSeed);
  const bounded = <T extends { id?: string; decisionOrder: number }>(rows: unknown, normalize: (row: unknown) => T | null, max: number): T[] => {
    const normalized = Array.isArray(rows) ? rows.map(normalize).filter((row): row is T => !!row) : [];
    const ordered = "id" in (normalized[0] ?? {}) ? dedupe(orderLive(normalized as Array<T & { id: string }>)) : normalized.sort((a, b) => a.decisionOrder - b.decisionOrder);
    return ordered.slice(-max);
  };
  return {
    version: M51_MOBILITY_VERSION, seed: integer(value.seed, fallbackSeed, 0, 0xffffffff), nextDecisionOrder: integer(value.nextDecisionOrder, 0),
    selections: bounded(value.selections, normalizeSelection, BALANCE.mobility.maxLiveSelections) as MobilityGroupSelection[],
    assignments: bounded(value.assignments, normalizeAssignment, BALANCE.mobility.maxLiveAssignments) as MobilityAssignment[],
    transactions: bounded(value.transactions, (row) => normalizeTransaction(row, false), BALANCE.mobility.maxLiveTransactions) as MobilityTransaction[],
    predictedEvidence: bounded(value.predictedEvidence, normalizePredicted, BALANCE.mobility.maxLiveEvidence) as MobilityPredictedEvidence[],
    observedEvidence: bounded(value.observedEvidence, normalizeObserved, BALANCE.mobility.maxLiveEvidence) as MobilityObservedEvidence[],
    stockouts: (Array.isArray(value.stockouts) ? value.stockouts : []).flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const candidate = row as M51LiveMobilityState["stockouts"][number];
      const stockoutMode = paidMode(candidate.mode); const id = text(candidate.id); const courseId = text(candidate.courseId);
      const groupId = text(candidate.groupId); const buildingId = text(candidate.buildingId); const productId = text(candidate.productId);
      return stockoutMode && id && courseId && groupId && buildingId && productId ? [{
        id, courseId, groupId, buildingId, productId, mode: stockoutMode,
        requiredUnits: integer(candidate.requiredUnits, 0, 0, 8), availableUnits: integer(candidate.availableUnits, 0, 0, 8),
        decisionOrder: integer(candidate.decisionOrder, 0),
      }] : [];
    }).sort((a, b) => a.decisionOrder - b.decisionOrder || compare(a.id, b.id)).slice(-BALANCE.mobility.maxLiveSelections),
  };
}

function aggregateFor(current: M51MobilityState, courseId: string): MobilityCourseAggregate {
  return current.aggregates[courseId] ?? { courseId, walkingRounds: 0, pushcartRounds: 0, ridingCartRounds: 0, observedRounds: 0, observedPaceMinutes: 0, settledRevenue: 0, operatingCosts: 0, stockouts: 0, utilizedUnits: 0, activeRentals: 0, lastSettledWeek: 0 };
}

export function m51MobilityAggregateSummary(liveInput: M51LiveMobilityState): M51MobilityAggregateSummary {
  const live = normalizeM51LiveMobilityState(liveInput, liveInput.seed);
  const courses: Record<string, MobilityCourseAggregate> = {};
  const get = (courseId: string) => courses[courseId] ?? (courses[courseId] = aggregateFor(emptyM51MobilityState(), courseId));
  for (const evidence of live.observedEvidence) {
    const aggregate = get(evidence.courseId);
    aggregate.observedRounds += evidence.completed ? 1 : 0;
    aggregate.observedPaceMinutes += evidence.paceMinutes;
    if (evidence.mode === "walk") aggregate.walkingRounds++;
    else if (evidence.mode === "pushcart") aggregate.pushcartRounds++;
    else aggregate.ridingCartRounds++;
  }
  for (const transaction of live.transactions) if (transaction.status === "settled") get(transaction.courseId).settledRevenue += transaction.amount;
  for (const assignment of live.assignments) if (assignment.status === "active" && assignment.mode !== "walk") get(assignment.courseId).activeRentals++;
  const products = mobilityProductSettlements(live);
  for (const row of products) {
    const aggregate = get(row.courseId);
    aggregate.operatingCosts += row.operatingCosts;
    aggregate.stockouts += row.stockouts;
    aggregate.utilizedUnits += row.utilizedUnits;
  }
  const grossRevenue = Math.round(products.reduce((sum, row) => sum + row.grossRevenue, 0) * 100) / 100;
  const operatingCosts = Math.round(products.reduce((sum, row) => sum + row.operatingCosts, 0) * 100) / 100;
  return {
    version: 1,
    courses: Object.fromEntries(Object.entries(courses).sort(([a], [b]) => compare(a, b)).slice(0, BALANCE.mobility.maxCourseAggregates)),
    products, grossRevenue, operatingCosts, netRevenue: Math.round((grossRevenue - operatingCosts) * 100) / 100,
  };
}

/** Product-level settlement derived from canonical assignments and transactions. */
export function mobilityProductSettlements(liveInput: M51LiveMobilityState): MobilityProductSettlement[] {
  const live = normalizeM51LiveMobilityState(liveInput, liveInput.seed);
  const keys = new Set([
    ...live.assignments.filter((row) => row.mode !== "walk" && row.productId && row.buildingId).map((row) => `${row.courseId}|${row.buildingId}|${row.productId}|${row.mode}`),
    ...live.stockouts.map((row) => `${row.courseId}|${row.buildingId}|${row.productId}|${row.mode}`),
  ]);
  return [...keys].sort(compare).map((key) => {
    const [courseId, buildingId, productId, productMode] = key.split("|") as [string, string, string, "pushcart" | "riding_cart"];
    const assignments = live.assignments.filter((row) => row.courseId === courseId && row.productId === productId && row.status !== "cancelled");
    const transactions = live.transactions.filter((row) => row.courseId === courseId && row.productId === productId && row.status === "settled");
    const stockouts = live.stockouts.filter((row) => row.courseId === courseId && row.productId === productId);
    const units = new Set(assignments.flatMap((row) => row.fleetUnitIds));
    const released = assignments.filter((row) => row.status === "released");
    const returns = released.reduce((sum, row) => sum + row.fleetUnitIds.length, 0);
    const wear = clamp(assignments.reduce((sum, row) => sum + row.fleetUnitIds.length * MOBILITY_BUSINESS.wearPerUse[productMode] + row.offPathTiles * MOBILITY_BUSINESS.offPathWearPerTile, 0), 0, 1);
    const grossRevenue = Math.round(transactions.reduce((sum, row) => sum + row.amount, 0) * 100) / 100;
    const operatingCosts = Math.round(assignments.reduce((sum, row) => sum + row.fleetUnitIds.length * MOBILITY_BUSINESS.perUseCost[productMode], 0) * 100) / 100;
    const conditions = assignments.flatMap((row) => Number.isFinite(row.returnedCondition) ? [row.returnedCondition!] : []);
    return {
      productId, courseId, buildingId, mode: productMode, rentals: assignments.length,
      golfers: new Set(transactions.flatMap((row) => row.golferId == null ? [] : [row.golferId])).size,
      utilizedUnits: units.size, availableUnits: Math.max(0, ...assignments.map((row) => row.availableUnitsAtSelection), ...stockouts.map((row) => row.availableUnits), 0),
      stockouts: stockouts.length, returns, damagedReturns: released.reduce((sum, row) => sum + ((row.returnedCondition ?? 1) < MOBILITY_BUSINESS.damagedReturnCondition ? row.fleetUnitIds.length : 0), 0),
      grossRevenue, operatingCosts, netRevenue: Math.round((grossRevenue - operatingCosts) * 100) / 100,
      wear, endingCondition: conditions.length ? Math.min(...conditions) : Math.max(0, 1 - wear),
    };
  });
}

/** Sole live-to-durable handoff. It does not touch cash or the concession ledger. */
export function settleM51MobilityDay(world: World, input: MobilitySettlementInput): World {
  const current = normalizeM51MobilityState(world.m51);
  const live = normalizeM51LiveMobilityState(input.live, input.live.seed);
  const transactionIds = new Set(current.history.settledTransactions.map((transaction) => transaction.id));
  const evidenceIds = new Set(current.history.observedEvidence.map((evidence) => evidence.id));
  const settled = live.transactions.filter((transaction) => transaction.status === "settled" && !transactionIds.has(transaction.id)).map((transaction) => ({ ...transaction, settledAtWeek: input.week, settledAtDay: input.dayIndex }));
  const observed = live.observedEvidence.filter((evidence) => !evidenceIds.has(evidence.id)).map((evidence) => ({ ...evidence, settledAtWeek: input.week, settledAtDay: input.dayIndex }));
  const productRows = mobilityProductSettlements(live);
  const ledgerId = `m51-day-${input.week}-${input.dayIndex}`;
  const alreadySettledDay = current.history.dailyLedgers.some((ledger) => ledger.id === ledgerId);
  if (!settled.length && !observed.length && alreadySettledDay) return world;
  const aggregates = { ...current.aggregates };
  for (const evidence of observed) {
    const aggregate = aggregateFor(current, evidence.courseId);
    const next = { ...aggregate, observedRounds: aggregate.observedRounds + (evidence.completed ? 1 : 0), observedPaceMinutes: aggregate.observedPaceMinutes + evidence.paceMinutes, lastSettledWeek: input.week };
    if (evidence.mode === "walk") next.walkingRounds++;
    else if (evidence.mode === "pushcart") next.pushcartRounds++;
    else next.ridingCartRounds++;
    aggregates[evidence.courseId] = next;
  }
  for (const transaction of settled) {
    const aggregate = aggregates[transaction.courseId] ?? aggregateFor(current, transaction.courseId);
    aggregates[transaction.courseId] = { ...aggregate, settledRevenue: aggregate.settledRevenue + transaction.amount, lastSettledWeek: input.week };
  }
  if (!alreadySettledDay) for (const row of productRows) {
    const aggregate = aggregates[row.courseId] ?? aggregateFor(current, row.courseId);
    aggregates[row.courseId] = {
      ...aggregate,
      operatingCosts: Math.round((aggregate.operatingCosts + row.operatingCosts) * 100) / 100,
      stockouts: aggregate.stockouts + row.stockouts,
      utilizedUnits: aggregate.utilizedUnits + row.utilizedUnits,
      lastSettledWeek: input.week,
    };
  }
  const grossRevenue = Math.round(productRows.reduce((sum, row) => sum + row.grossRevenue, 0) * 100) / 100;
  const operatingCosts = Math.round(productRows.reduce((sum, row) => sum + row.operatingCosts, 0) * 100) / 100;
  const dailyLedger: MobilityDailyLedger = {
    id: ledgerId, week: input.week, dayIndex: input.dayIndex, products: productRows,
    grossRevenue, operatingCosts, netRevenue: Math.round((grossRevenue - operatingCosts) * 100) / 100,
  };
  return {
    ...world,
    m51: normalizeM51MobilityState({
      ...current,
      history: {
        settledTransactions: [...current.history.settledTransactions, ...settled],
        observedEvidence: [...current.history.observedEvidence, ...observed],
        dailyLedgers: alreadySettledDay ? current.history.dailyLedgers : [...current.history.dailyLedgers, dailyLedger],
        weeklyReports: current.history.weeklyReports,
      },
      aggregates,
    }),
  };
}
