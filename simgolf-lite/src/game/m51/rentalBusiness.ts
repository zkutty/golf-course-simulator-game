import type { Course, World } from "../models/types";
import { MOBILITY_BUSINESS, type MobilityMode } from "./types";
import { normalizeM51CourseMobilityState } from "./mobility";

export { MOBILITY_BUSINESS } from "./types";

export function mobilityRentalPreview(course: Course, buildingId: string, mode: Exclude<MobilityMode, "walk">) {
  const state = normalizeM51CourseMobilityState(course.m51, course);
  const rental = state.cartRentals[buildingId];
  if (!rental) return null;
  const product = rental.products[mode];
  const owned = Object.values(state.fleet).filter((unit) => unit.buildingId === buildingId && unit.mode === mode).length;
  const capacity = MOBILITY_BUSINESS.capacityByTier[rental.tier];
  const margin = Math.max(0, product.price - MOBILITY_BUSINESS.perUseCost[mode]);
  const demand = product.enabled ? Math.max(0, Math.min(capacity, Math.round(capacity * Math.max(.12, 1 - product.price / 180)))) : 0;
  return { buildingId, mode, enabled: product.enabled, price: product.price, owned, capacity, availableCapacity: capacity - Object.values(state.fleet).filter((unit) => unit.buildingId === buildingId).length, capitalCost: MOBILITY_BUSINESS.fleetUnitCost[mode], perUseCost: MOBILITY_BUSINESS.perUseCost[mode], serviceMinutes: MOBILITY_BUSINESS.serviceMinutes[mode], estimatedDemand: demand, breakEvenUses: margin ? Math.ceil(MOBILITY_BUSINESS.fleetUnitCost[mode] / margin) : null };
}

export function mutateMobilityRental(course: Course, world: World, action: { type: "configure"; buildingId: string; mode: "pushcart" | "riding_cart"; enabled?: boolean; price?: number } | { type: "purchase" | "salvage"; buildingId: string; mode: "pushcart" | "riding_cart"; quantity: number } | { type: "upgrade"; buildingId: string }): { course: Course; world: World } | null {
  const state = normalizeM51CourseMobilityState(course.m51, course); const rental = state.cartRentals[action.buildingId]; if (!rental) return null;
  if (action.type === "configure") {
    const price = action.price == null ? rental.products[action.mode].price : Math.max(0, Math.min(MOBILITY_BUSINESS.maxPrice, Math.round(action.price)));
    const next = { ...state, cartRentals: { ...state.cartRentals, [rental.buildingId]: { ...rental, products: { ...rental.products, [action.mode]: { ...rental.products[action.mode], price, enabled: action.enabled ?? rental.products[action.mode].enabled } } } } };
    return { course: { ...course, m51: next }, world };
  }
  if (action.type === "upgrade") {
    if (rental.tier >= 3) return null;
    const nextTier = (rental.tier + 1) as 2 | 3; const cost = MOBILITY_BUSINESS.tierExpansionCost[nextTier];
    if (world.cash < cost || world.isBankrupt) return null;
    return { course: { ...course, buildings: course.buildings.map((building) => building.id === action.buildingId ? { ...building, tier: nextTier } : building), m51: { ...state, cartRentals: { ...state.cartRentals, [action.buildingId]: { ...rental, tier: nextTier } } } }, world: { ...world, cash: world.cash - cost } };
  }
  if (!Number.isInteger(action.quantity) || action.quantity < 1 || action.quantity > 36) return null;
  const quantity = action.quantity; const units = Object.values(state.fleet).filter((unit) => unit.buildingId === action.buildingId && unit.mode === action.mode);
  if (action.type === "purchase") {
    const allOwned = Object.values(state.fleet).filter((unit) => unit.buildingId === action.buildingId).length; const cost = quantity * MOBILITY_BUSINESS.fleetUnitCost[action.mode];
    if (allOwned + quantity > MOBILITY_BUSINESS.capacityByTier[rental.tier] || world.cash < cost || world.isBankrupt) return null;
    const fleet = { ...state.fleet }; for (let i = 0; i < quantity; i++) { const id = `${action.buildingId}:${action.mode}:${String(Object.keys(fleet).length + i + 1).padStart(3, "0")}`; fleet[id] = { id, courseId: rental.products[action.mode].courseId, buildingId: action.buildingId, productId: rental.products[action.mode].id, mode: action.mode, seats: action.mode === "riding_cart" ? 2 : 1, state: "available", condition: 1, uses: 0, wear: 0 }; }
    return { course: { ...course, m51: { ...state, fleet } }, world: { ...world, cash: world.cash - cost } };
  }
  const removable = units.filter((unit) => unit.state !== "in_use").sort((a, b) => a.id.localeCompare(b.id)); if (removable.length < quantity) return null;
  const fleet = { ...state.fleet }; for (const unit of removable.slice(0, quantity)) delete fleet[unit.id];
  return { course: { ...course, m51: { ...state, fleet } }, world: { ...world, cash: world.cash + Math.round(quantity * MOBILITY_BUSINESS.fleetUnitCost[action.mode] * MOBILITY_BUSINESS.fleetSalvageRate) } };
}
