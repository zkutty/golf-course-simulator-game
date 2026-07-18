import { BALANCE } from "../balance/balanceConfig";
import type { StaffMember, StaffRole, StaffShift, World } from "./types";

// Staff as people (ZKU-121): the persistent roster lives on World and is the
// source of truth. The old aggregate `staffLevel` is kept as a derived cache
// (min(5, headcount)) so the demand/satisfaction formulas keep working.

export const STAFF_ROLES: readonly StaffRole[] = [
  "groundskeeper",
  "cartAttendant",
  "proShop",
  "marshal",
];

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  groundskeeper: "Groundskeeper",
  cartAttendant: "Cart attendant",
  proShop: "Pro shop",
  marshal: "Marshal",
};

export const STAFF_SHIFT_LABEL: Record<StaffShift, string> = {
  full: "Full day",
  morning: "Morning",
  afternoon: "Afternoon",
};

// Uniform colors, shared by the roster UI and the live renderer tint.
export const STAFF_ROLE_COLOR: Record<StaffRole, string> = {
  groundskeeper: "#2e7d32",
  cartAttendant: "#ef6c00",
  proShop: "#283593",
  marshal: "#c62828",
};

/** Total weekly payroll for the roster; falls back to the legacy aggregate
 *  formula for worlds without a roster (hand-built tuner/test worlds). */
export function staffWeeklyWage(world: World): number {
  if (!world.staff) return BALANCE.ops.staffCostPerLevel * world.staffLevel;
  return world.staff.reduce((sum, s) => sum + s.wage, 0);
}

/** Derived aggregate level for the demand/satisfaction formulas. */
export function derivedStaffLevel(staff: readonly StaffMember[]): number {
  return Math.min(5, staff.length);
}

// Roles dealt to migrated rosters, in hire order — a level-1 save gets the
// classic lone groundskeeper.
const MIGRATION_ROLES: readonly StaffRole[] = [
  "groundskeeper",
  "cartAttendant",
  "proShop",
  "marshal",
  "groundskeeper",
];

const MIGRATION_NAMES = ["Sam P.", "Rita M.", "Doug L.", "Ana V.", "Walt K."];

/**
 * Roster equivalent of a legacy `staffLevel`. Every member keeps the old
 * per-level wage, so a migrated save's weekly costs are unchanged to the
 * dollar (ZKU-121 save-compat rule).
 */
export function defaultRosterFor(staffLevel: number): StaffMember[] {
  const n = Math.max(0, Math.min(MIGRATION_ROLES.length, Math.floor(staffLevel)));
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: MIGRATION_NAMES[i],
    role: MIGRATION_ROLES[i],
    shift: "full" as const,
    wage: BALANCE.ops.staffCostPerLevel,
  }));
}

/** Validate an unknown save field into a usable roster, or null to trigger
 *  the staffLevel migration. Malformed entries are dropped, not fatal. */
export function sanitizeStaff(raw: unknown): StaffMember[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<number>();
  const out: StaffMember[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const s = entry as StaffMember;
    if (!Number.isInteger(s.id) || s.id <= 0 || seen.has(s.id)) continue;
    if (!(STAFF_ROLES as readonly string[]).includes(s.role)) continue;
    if (s.shift !== "full" && s.shift !== "morning" && s.shift !== "afternoon") continue;
    if (typeof s.wage !== "number" || !Number.isFinite(s.wage) || s.wage < 0) continue;
    seen.add(s.id);
    out.push({
      id: s.id,
      name: typeof s.name === "string" && s.name.trim() ? s.name : `Staff #${s.id}`,
      role: s.role,
      shift: s.shift,
      wage: s.wage,
    });
  }
  return out;
}
