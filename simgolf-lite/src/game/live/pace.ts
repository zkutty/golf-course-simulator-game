import type { Course, CourseOperations, StaffMember, StaffRole, World } from "../models/types";
import { activeCourseLayout, layoutById } from "../models/courseLayouts";
import { normalizeOperations } from "../models/courseOperations";
import { normalizeStaffCharacter } from "../livingClub/livingClub";
export { normalizeOperations, PACE_PRESETS } from "../models/courseOperations";

export function courseOperations(course: Course, courseId?: string): CourseOperations {
  return normalizeOperations((layoutById(course, courseId) ?? activeCourseLayout(course)).operations);
}

const STAFF_ROLES: StaffRole[] = ["groundskeeper", "cart_attendant", "pro_shop", "marshal", "tournament_director"];
const STAFF_NAMES = ["Avery", "Morgan", "Sam", "Jordan", "Riley"];
const STAFF_WAGES: Record<StaffRole, number> = {
  groundskeeper: 500, cart_attendant: 420, pro_shop: 480, marshal: 560, tournament_director: 650,
  club_pro: 1_050, food_service: 620, locker_attendant: 440, front_desk: 590, housekeeping: 560, shuttle_driver: 540,
};

export function staffFromLevel(level: number, courseId?: string): StaffMember[] {
  return STAFF_ROLES.slice(0, Math.max(0, Math.min(5, Math.floor(level)))).map((role, index) => normalizeStaffCharacter({
    id: `legacy-staff-${index + 1}`,
    name: STAFF_NAMES[index],
    role,
    courseId,
    shiftStart: 0,
    shiftEnd: 840,
    weeklyWage: STAFF_WAGES[role],
  }, index));
}

export function normalizedStaff(world: World, course?: Course): StaffMember[] {
  const courseId = course ? activeCourseLayout(course).id : undefined;
  if (!world.staffRoster?.length) return staffFromLevel(world.staffLevel, courseId);
  // Fixtures and older constructors often spread DEFAULT_WORLD and then raise
  // staffLevel. Expand an untouched legacy roster so coverage stays in sync.
  if (world.staffRoster.every((member) => member.id.startsWith("legacy-staff-")) && world.staffRoster.length !== world.staffLevel) {
    return staffFromLevel(world.staffLevel, courseId);
  }
  return world.staffRoster.map((member, index) => normalizeStaffCharacter(member, index, world.week));
}

export function hasOnDutyStaff(world: World, role: StaffRole, courseId: string, minute: number, course?: Course): boolean {
  return normalizedStaff(world, course).some((staff) => staff.role === role && (!staff.courseId || staff.courseId === courseId) && minute >= staff.shiftStart && minute <= staff.shiftEnd);
}

export function groupTimeParMinutes(holeCount: number, groupSize: number, operations: CourseOperations): number {
  const perHole = holeCount >= 18 ? 13.3 : 12.5;
  const sizeFactor = 0.7 + Math.max(1, groupSize) * 0.075;
  const styleFactor = operations.timeParStyle === "relaxed" ? 1.1 : operations.timeParStyle === "brisk" ? 0.92 : 1;
  return holeCount * perHole * sizeFactor * styleFactor;
}
