import { surfaceCareTopology } from "../conditions/surfaceCare";
import type { Course, SurfaceCareRecordV1 } from "../models/types";

function baseline(
  zone: ReturnType<typeof surfaceCareTopology>["zones"][number],
): SurfaceCareRecordV1 {
  return {
    key: zone.key,
    surfaceId: zone.surfaceId,
    cellX: zone.cellX,
    cellY: zone.cellY,
    intendedTerrain: zone.intendedTerrain,
    area: zone.cells.length,
    mowingQuality: 0.95,
    moisture: 0.58,
    turfHealth: 0.96,
    wear: 0.04,
    dormancy: 0,
    drainageStress: 0.03,
    failureDurationDays: 0,
    missedMowingDays: 0,
    insufficientWaterDays: 0,
    saturatedDays: 0,
    repairRequired: false,
    repairProgress: 0,
    lastDemand: 12,
    lastAllocated: 12,
    lastTraffic: 0,
    lastIrrigationDemand: 0,
    lastIrrigationApplied: 0,
    lastElevatedWaterDemand: 0,
    lastElevatedWaterApplied: 0,
    lastRepairProgressed: false,
    lastRepairServiceRatio: 0,
    lastObservedAbsoluteDay: 53,
  };
}

/**
 * Browser-only deterministic evidence matrix. It still uses valid persisted
 * care records and the production renderer projection; no command/decal is
 * injected directly.
 */
export function createM53SurfaceCarePresentationFixture(course: Course): Course {
  const topology = surfaceCareTopology(course);
  const records = Object.fromEntries(topology.zones.map((zone, index) => {
    const record = baseline(zone);
    const scenario = index % 7;
    if (scenario === 0) {
      Object.assign(record, {
        wear: 0.82,
        lastTraffic: Math.max(80, zone.cells.length * 5),
        turfHealth: 0.62,
      });
    } else if (scenario === 1) {
      Object.assign(record, {
        moisture: 0.93,
        drainageStress: 0.72,
        saturatedDays: 9,
        turfHealth: 0.58,
      });
    } else if (scenario === 2) {
      Object.assign(record, {
        moisture: 0.2,
        insufficientWaterDays: 9,
        turfHealth: 0.52,
      });
    } else if (scenario === 3) {
      Object.assign(record, {
        mowingQuality: 0.08,
        missedMowingDays: 20,
        turfHealth: 0.46,
      });
    } else if (scenario === 4) {
      Object.assign(record, {
        turfHealth: 0.1,
        failureDurationDays: 9,
        repairRequired: true,
      });
    } else if (scenario === 5) {
      Object.assign(record, {
        turfHealth: 0.48,
        repairRequired: true,
        repairProgress: 0.4,
        lastDemand: 20,
        lastAllocated: 16,
        lastRepairProgressed: true,
        lastRepairServiceRatio: 0.8,
        repair: {
          kind: "reseed",
          cost: 600,
          requiredDays: 20,
          progressDays: 8,
          startedAbsoluteDay: 45,
          elevatedWaterDaysRemaining: 0,
        },
      });
    } else {
      Object.assign(record, {
        turfHealth: 0.44,
        repairRequired: true,
        repairProgress: 0.5,
        lastDemand: 20,
        lastAllocated: 15,
        lastRepairProgressed: true,
        lastRepairServiceRatio: 0.75,
        repair: {
          kind: "resod",
          cost: 900,
          requiredDays: 8,
          progressDays: 4,
          startedAbsoluteDay: 49,
          elevatedWaterDaysRemaining: 4,
        },
      });
    }
    return [zone.key, record];
  }));
  return {
    ...course,
    surfaceCare: {
      version: 1,
      cellSize: 8,
      lastAdvancedAbsoluteDay: 53,
      records,
    },
  };
}

export function resolveM53SurfaceCarePresentationFixture(course: Course): Course {
  if (!course.surfaceCare) return course;
  return {
    ...course,
    surfaceCare: {
      ...course.surfaceCare,
      lastAdvancedAbsoluteDay: course.surfaceCare.lastAdvancedAbsoluteDay + 1,
      records: Object.fromEntries(Object.entries(course.surfaceCare.records).map(
        ([key, record]) => [key, {
          ...record,
          mowingQuality: 0.95,
          moisture: 0.58,
          turfHealth: 0.96,
          wear: 0.04,
          drainageStress: 0.03,
          failureDurationDays: 0,
          missedMowingDays: 0,
          insufficientWaterDays: 0,
          saturatedDays: 0,
          repairRequired: false,
          repairProgress: 1,
          repair: undefined,
          lastDemand: 12,
          lastAllocated: 12,
          lastTraffic: 0,
          lastRepairProgressed: false,
          lastRepairServiceRatio: 0,
          lastObservedAbsoluteDay: record.lastObservedAbsoluteDay + 1,
        }],
      )),
    },
  };
}

export function createM53SurfaceCareRoutineFixture(
  course: Course,
  mode: "healthy" | "cue-only" | "mowing",
): Course {
  const topology = surfaceCareTopology(course);
  const day = mode === "healthy" ? 60 : mode === "cue-only" ? 61 : 62;
  const records = Object.fromEntries(topology.zones.map((zone, index) => {
    const record = {
      ...baseline(zone),
      lastObservedAbsoluteDay: day,
    };
    if (index === 0 && mode === "cue-only") {
      // Enough observed traffic/wear for bounded care cues, but below the
      // effective-treatment threshold and with unchanged mowing stripes.
      record.wear = 0.32;
      record.lastTraffic = Math.max(80, zone.cells.length * 5);
    } else if (index === 0 && mode === "mowing") {
      // Same effective terrain/treatment; terrain chunks still own mowing.
      record.mowingQuality = 0.91;
    }
    return [zone.key, record];
  }));
  return {
    ...course,
    surfaceCare: {
      version: 1,
      cellSize: 8,
      lastAdvancedAbsoluteDay: day,
      records,
    },
  };
}
