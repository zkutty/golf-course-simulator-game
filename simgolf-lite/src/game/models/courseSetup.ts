import type { Course, Hole, ParSetting, PinRotation, Point, TeeSet } from "./types";
import { PIN_ROTATIONS, TEE_SETS } from "./types";

export { PIN_ROTATIONS, TEE_SETS };

export interface ResolvedCourseSetup {
  requestedTeeSet: TeeSet;
  teeSet: TeeSet;
  requestedPinRotation: PinRotation;
  pinRotation: PinRotation;
  tee: Point | null;
  pin: Point | null;
  usedTeeFallback: boolean;
  usedPinFallback: boolean;
}

export function samePoint(a: Point | null | undefined, b: Point | null | undefined): boolean {
  return !!a && !!b && a.x === b.x && a.y === b.y;
}

export function getTeeBox(hole: Hole, set: TeeSet = "member"): Point | null {
  return hole.teeBoxes?.[set] ?? (set === "member" ? hole.tee : null) ?? null;
}

export function getPinPosition(hole: Hole, rotation: PinRotation = "A"): Point | null {
  return hole.pinPositions?.[rotation] ?? (rotation === "A" ? hole.green : null) ?? null;
}

export function getParSetting(hole: Hole, set: TeeSet = "member"): ParSetting {
  const configured = hole.parByTee?.[set];
  if (configured?.mode === "MANUAL") return { mode: "MANUAL", par: configured.par };
  if (configured?.mode === "AUTO") return { mode: "AUTO" };
  if (set === "member" && hole.parMode === "MANUAL") return { mode: "MANUAL", par: hole.parManual ?? 4 };
  return { mode: "AUTO" };
}

export function holeForCourseSetup(hole: Hole, teeSet: TeeSet, pinRotation: PinRotation): Hole {
  const par = getParSetting(hole, teeSet);
  return {
    ...hole,
    tee: getTeeBox(hole, teeSet),
    green: getPinPosition(hole, pinRotation),
    parMode: par.mode,
    parManual: par.mode === "MANUAL" ? par.par : undefined,
  };
}

export function courseForCourseSetup(course: Course, teeSet: TeeSet, pinRotation: PinRotation): Course {
  return { ...course, holes: course.holes.map((hole) => holeForCourseSetup(hole, teeSet, pinRotation)) };
}

export function withNormalizedHoleSetup(hole: Hole): Hole {
  const member = getTeeBox(hole, "member");
  const pinA = getPinPosition(hole, "A");
  const memberPar = getParSetting(hole, "member");
  return {
    ...hole,
    tee: member,
    green: pinA,
    teeBoxes: {
      forward: getTeeBox(hole, "forward"),
      member,
      championship: getTeeBox(hole, "championship"),
    },
    pinPositions: {
      A: pinA,
      B: getPinPosition(hole, "B"),
      C: getPinPosition(hole, "C"),
    },
    parByTee: {
      forward: getParSetting(hole, "forward"),
      member: memberPar,
      championship: getParSetting(hole, "championship"),
    },
    parMode: memberPar.mode,
    parManual: memberPar.mode === "MANUAL" ? memberPar.par : undefined,
  };
}

export function resolveCourseSetup(
  hole: Hole,
  requestedTeeSet: TeeSet = "member",
  requestedPinRotation: PinRotation = "A",
): ResolvedCourseSetup {
  const requestedTee = getTeeBox(hole, requestedTeeSet);
  const member = getTeeBox(hole, "member");
  const firstTee = TEE_SETS.map((set) => ({ set, point: getTeeBox(hole, set) })).find((entry) => entry.point);
  const tee = requestedTee ?? member ?? firstTee?.point ?? null;
  const teeSet = requestedTee ? requestedTeeSet : member ? "member" : firstTee?.set ?? requestedTeeSet;

  const requestedPin = getPinPosition(hole, requestedPinRotation);
  const pinA = getPinPosition(hole, "A");
  const firstPin = PIN_ROTATIONS.map((rotation) => ({ rotation, point: getPinPosition(hole, rotation) })).find((entry) => entry.point);
  const pin = requestedPin ?? pinA ?? firstPin?.point ?? null;
  const pinRotation = requestedPin ? requestedPinRotation : pinA ? "A" : firstPin?.rotation ?? requestedPinRotation;

  return {
    requestedTeeSet,
    teeSet,
    requestedPinRotation,
    pinRotation,
    tee,
    pin,
    usedTeeFallback: teeSet !== requestedTeeSet,
    usedPinFallback: pinRotation !== requestedPinRotation,
  };
}

export function preferredTeeForArchetype(archetype: string): TeeSet {
  if (archetype === "pro") return "championship";
  if (archetype === "casual" || archetype === "senior" || archetype === "junior" || archetype === "tourist") return "forward";
  return "member";
}

export interface CourseSetupIssue {
  code: "OUT_OF_BOUNDS" | "DUPLICATE" | "PIN_NOT_ON_GREEN" | "TEE_ORDER";
  message: string;
}

export function validateHoleCourseSetup(course: Course, hole: Hole): CourseSetupIssue[] {
  const issues: CourseSetupIssue[] = [];
  const inBounds = (point: Point) => point.x >= 0 && point.y >= 0 && point.x < course.width && point.y < course.height;
  const markers = [
    ...TEE_SETS.map((key) => ({ label: `${key} tee`, point: getTeeBox(hole, key) })),
    ...PIN_ROTATIONS.map((key) => ({ label: `Pin ${key}`, point: getPinPosition(hole, key) })),
  ];
  for (const marker of markers) {
    if (marker.point && !inBounds(marker.point)) issues.push({ code: "OUT_OF_BOUNDS", message: `${marker.label} is out of bounds.` });
  }
  for (const entries of [
    TEE_SETS.map((key) => ({ label: `${key} tee`, point: getTeeBox(hole, key) })),
    PIN_ROTATIONS.map((key) => ({ label: `Pin ${key}`, point: getPinPosition(hole, key) })),
  ]) {
    for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
      if (samePoint(entries[i].point, entries[j].point)) issues.push({ code: "DUPLICATE", message: `${entries[i].label} and ${entries[j].label} overlap.` });
    }
  }
  for (const rotation of PIN_ROTATIONS) {
    const pin = getPinPosition(hole, rotation);
    if (pin && inBounds(pin) && course.tiles[pin.y * course.width + pin.x] !== "green") {
      issues.push({ code: "PIN_NOT_ON_GREEN", message: `Pin ${rotation} must sit on green terrain.` });
    }
  }
  const pin = getPinPosition(hole, "A") ?? PIN_ROTATIONS.map((key) => getPinPosition(hole, key)).find(Boolean) ?? null;
  if (pin) {
    const distances = TEE_SETS.map((set) => ({ set, tee: getTeeBox(hole, set) }))
      .filter((entry): entry is { set: TeeSet; tee: Point } => !!entry.tee)
      .map((entry) => ({ set: entry.set, distance: Math.hypot(entry.tee.x - pin.x, entry.tee.y - pin.y) }));
    for (let i = 1; i < distances.length; i++) {
      if (distances[i - 1].distance > distances[i].distance + 0.001) {
        issues.push({ code: "TEE_ORDER", message: "Tee order must be Forward ≤ Member ≤ Championship by playing distance." });
        break;
      }
    }
  }
  return issues;
}

export function isSetupPointUsedByAnotherTee(hole: Hole, set: TeeSet, point: Point): boolean {
  return TEE_SETS.some((candidate) => candidate !== set && samePoint(getTeeBox(hole, candidate), point));
}
