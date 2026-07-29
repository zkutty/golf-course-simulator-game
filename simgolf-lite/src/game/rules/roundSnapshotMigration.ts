import { isOwnedTile } from "../estate/estate";
import type { Course } from "../models/types";
import {
  createControlledRoundSnapshotV2,
  decodeControlledRoundSnapshotV2,
  type ControlledRoundSnapshotV2,
} from "./roundSnapshot";

type JsonRecord = Record<string, unknown>;

export type ActiveRoundSnapshotMigrationStatus =
  | "unchanged"
  | "migrated"
  | "validated"
  | "invalidated";

export interface ActiveRoundSnapshotMigrationResult {
  playerPro: unknown;
  status: ActiveRoundSnapshotMigrationStatus;
}

function isRecord(value: unknown): value is JsonRecord {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function sameArray<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function invalidate(playerPro: JsonRecord): ActiveRoundSnapshotMigrationResult {
  return {
    playerPro: { ...playerPro, activeRound: null },
    status: "invalidated",
  };
}

function roundCourseMatchesSavedCourse(
  roundCourse: JsonRecord,
  savedCourse: Course,
): roundCourse is JsonRecord & {
  courseId: string;
  width: number;
  height: number;
  tiles: string[];
  elevations: number[];
  holes: Array<JsonRecord & { id: string }>;
} {
  const { courseId, width, height, tiles, elevations, holes } = roundCourse;
  if (
    typeof courseId !== "string"
    || !courseId
    || !Number.isInteger(width)
    || !Number.isInteger(height)
    || width !== savedCourse.width
    || height !== savedCourse.height
  ) {
    return false;
  }
  const cells = width * height;
  if (
    !Number.isSafeInteger(cells)
    || cells < 1
    || !Array.isArray(tiles)
    || !Array.isArray(elevations)
    || tiles.length !== cells
    || elevations.length !== cells
    || savedCourse.tiles.length !== cells
    || savedCourse.elevations.length !== cells
    || !sameArray(tiles, savedCourse.tiles)
    || !sameArray(elevations, savedCourse.elevations)
    || !Array.isArray(holes)
    || holes.length < 1
    || holes.length > 36
    || holes.some((hole) => !isRecord(hole) || typeof hole.id !== "string" || !hole.id)
  ) {
    return false;
  }
  const layout = savedCourse.layouts?.find((candidate) => candidate.id === courseId);
  const holeIds = holes.map((hole) => (hole as JsonRecord).id as string);
  return !!layout
    && new Set(holeIds).size === holeIds.length
    && sameArray(holeIds, layout.publishedHoleIds);
}

function expectedSnapshot(
  roundCourse: JsonRecord & {
    width: number;
    height: number;
    tiles: string[];
    holes: Array<JsonRecord & { id: string }>;
  },
  savedCourse: Course,
): ControlledRoundSnapshotV2 | null {
  const cells = roundCourse.width * roundCourse.height;
  const inBounds = new Array<boolean>(cells);
  const penaltyMask = new Array<boolean>(cells);
  for (let index = 0; index < cells; index++) {
    const x = index % roundCourse.width;
    const y = Math.floor(index / roundCourse.width);
    const owned = isOwnedTile(savedCourse, x, y);
    const terrain = roundCourse.tiles[index];
    inBounds[index] = owned;
    penaltyMask[index] = owned && (terrain === "water" || terrain === "wetland");
  }
  const created = createControlledRoundSnapshotV2({
    width: roundCourse.width,
    height: roundCourse.height,
    inBounds,
    penaltyMask,
    holeClassifications: roundCourse.holes.map((hole) => ({
      holeId: hole.id,
      red: [],
      yellow: [],
    })),
  });
  return created.ok ? created.value : null;
}

function existingSnapshotMatches(
  value: unknown,
  expected: ControlledRoundSnapshotV2,
  holeIds: ReadonlySet<string>,
): value is ControlledRoundSnapshotV2 {
  const decoded = decodeControlledRoundSnapshotV2(value);
  const expectedDecoded = decodeControlledRoundSnapshotV2(expected);
  return decoded.ok
    && expectedDecoded.ok
    && decoded.value.snapshot.width === expected.width
    && decoded.value.snapshot.height === expected.height
    && sameArray(decoded.value.inBounds, expectedDecoded.value.inBounds)
    && sameArray(decoded.value.penaltyComponents, expectedDecoded.value.penaltyComponents)
    && decoded.value.snapshot.holeClassifications.every((classification) =>
      holeIds.has(classification.holeId)
    );
}

/**
 * Normalize the v20 controlled-round foundation without touching career
 * history. A mismatch invalidates only the optional resumable round so a good
 * course save and all completed shots remain loadable.
 */
export function migratePlayerProActiveRoundSnapshotV20(
  rawPlayerPro: unknown,
  savedCourse: Course,
): ActiveRoundSnapshotMigrationResult {
  if (!isRecord(rawPlayerPro) || rawPlayerPro.activeRound == null) {
    return { playerPro: rawPlayerPro, status: "unchanged" };
  }
  const activeRound = rawPlayerPro.activeRound;
  if (
    !isRecord(activeRound)
    || activeRound.version !== 1
    || typeof activeRound.id !== "string"
    || !activeRound.id
    || !isRecord(activeRound.course)
    || !roundCourseMatchesSavedCourse(activeRound.course, savedCourse)
  ) {
    return invalidate(rawPlayerPro);
  }

  try {
    const snapshot = expectedSnapshot(activeRound.course, savedCourse);
    if (!snapshot) return invalidate(rawPlayerPro);
    if (activeRound.rulesSnapshot != null) {
      const holeIds = new Set(activeRound.course.holes.map((hole) => hole.id));
      if (!existingSnapshotMatches(activeRound.rulesSnapshot, snapshot, holeIds)) {
        return invalidate(rawPlayerPro);
      }
      return {
        playerPro: {
          ...rawPlayerPro,
          activeRound: { ...activeRound, rulesSnapshot: activeRound.rulesSnapshot },
        },
        status: "validated",
      };
    }
    return {
      playerPro: {
        ...rawPlayerPro,
        activeRound: { ...activeRound, rulesSnapshot: snapshot },
      },
      status: "migrated",
    };
  } catch {
    return invalidate(rawPlayerPro);
  }
}
