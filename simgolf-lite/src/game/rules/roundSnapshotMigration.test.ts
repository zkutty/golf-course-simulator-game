import { describe, expect, it } from "vitest";
import { createEstate, decodeParcelMap } from "../estate/estate";
import type { Course, Terrain } from "../models/types";
import { decodeControlledRoundSnapshotV2 } from "./roundSnapshot";
import { migratePlayerProActiveRoundSnapshotV20 } from "./roundSnapshotMigration";

function fixture() {
  const width = 6;
  const height = 4;
  const cells = width * height;
  const tiles = new Array<Terrain>(cells).fill("rough");
  tiles[7] = "water";
  tiles[8] = "wetland";
  tiles[21] = "water";
  const holes = [{
    id: "hole-1",
    name: "First",
    tee: { x: 0, y: 0 },
    green: { x: 5, y: 3 },
    teeBoxes: { member: { x: 0, y: 0 } },
    pinPositions: { A: { x: 5, y: 3 } },
    parMode: "AUTO" as const,
  }];
  const course: Course = {
    width,
    height,
    tiles,
    elevations: new Array(cells).fill(0),
    holes,
    layouts: [{
      id: "course-a",
      name: "Course A",
      draftHoleIds: ["hole-1"],
      publishedHoleIds: ["hole-1"],
      roundLength: 9,
      state: "open",
      greenFee: 20,
      legacyPartial: true,
    }],
    activeCourseId: "course-a",
    obstacles: [],
    buildings: [],
    yardsPerTile: 10,
    name: "Course A",
    baseGreenFee: 20,
    condition: 0.75,
    theme: "parkland",
  };
  course.estate = createEstate(course, 31);
  const playerPro = {
    version: 1,
    rounds: [{
      id: "complete-1",
      shots: [{ id: "historical-shot", seed: 42 }],
    }],
    activeRound: {
      version: 1,
      id: "active-1",
      course: {
        courseId: "course-a",
        courseName: "Course A",
        theme: "parkland",
        width,
        height,
        yardsPerTile: 10,
        tiles: [...tiles],
        elevations: new Array(cells).fill(0),
        obstacles: [],
        holes: [{
          id: "hole-1",
          name: "First",
          par: 4,
          tee: { x: 0, y: 0 },
          pin: { x: 5, y: 3 },
          waypoints: [],
        }],
      },
    },
  };
  return { course, playerPro };
}

describe("v20 active-round snapshot migration", () => {
  it("derives deterministic bounds and penalty components from saved ownership and terrain", () => {
    const first = fixture();
    const second = fixture();
    const migrated = migratePlayerProActiveRoundSnapshotV20(first.playerPro, first.course);
    const repeated = migratePlayerProActiveRoundSnapshotV20(second.playerPro, second.course);
    expect(migrated.status).toBe("migrated");
    expect(repeated.status).toBe("migrated");
    expect(JSON.stringify(migrated.playerPro)).toBe(JSON.stringify(repeated.playerPro));

    const playerPro = migrated.playerPro as typeof first.playerPro & {
      activeRound: { rulesSnapshot: unknown };
    };
    const decoded = decodeControlledRoundSnapshotV2(playerPro.activeRound.rulesSnapshot);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    const parcelMap = decodeParcelMap(first.course.estate!, first.course.width * first.course.height)!;
    const owned = new Set(first.course.estate!.ownedParcelIds);
    const expectedBounds = parcelMap.map((parcelIndex) =>
      owned.has(first.course.estate!.parcels[parcelIndex].id)
    );
    expect(decoded.value.inBounds).toEqual(expectedBounds);
    expect(decoded.value.penaltyComponents.map((component, index) =>
      component > 0 ? first.course.tiles[index] : null
    ).filter(Boolean)).toEqual(
      first.course.tiles.filter((terrain, index) =>
        expectedBounds[index] && (terrain === "water" || terrain === "wetland")
      ),
    );
    expect(decoded.value.snapshot.holeClassifications).toEqual([
      { holeId: "hole-1", red: [], yellow: [] },
    ]);
  });

  it("preserves completed rounds and validates an existing equivalent snapshot", () => {
    const { course, playerPro } = fixture();
    const history = JSON.stringify(playerPro.rounds);
    const migrated = migratePlayerProActiveRoundSnapshotV20(playerPro, course);
    const value = migrated.playerPro as typeof playerPro & {
      activeRound: typeof playerPro.activeRound & { rulesSnapshot: unknown };
    };
    const validated = migratePlayerProActiveRoundSnapshotV20(value, course);
    expect(validated.status).toBe("validated");
    expect(JSON.stringify((validated.playerPro as typeof playerPro).rounds)).toBe(history);
    expect(
      (validated.playerPro as typeof value).activeRound.rulesSnapshot,
    ).toEqual(value.activeRound.rulesSnapshot);
  });

  it("invalidates only the active round for course, grid, terrain, or hostile snapshot mismatches", () => {
    const cases = [
      (value: ReturnType<typeof fixture>) => {
        value.playerPro.activeRound.course.courseId = "missing";
      },
      (value: ReturnType<typeof fixture>) => {
        value.playerPro.activeRound.course.width += 1;
      },
      (value: ReturnType<typeof fixture>) => {
        value.playerPro.activeRound.course.tiles[0] = "water";
      },
      (value: ReturnType<typeof fixture>) => {
        (value.playerPro.activeRound as Record<string, unknown>).rulesSnapshot = {
          version: 2,
          width: 6,
          height: 4,
          inBoundsRle: "1:!",
          penaltyComponentsRle: "0:o",
          penaltyComponentCount: 0,
          holeClassifications: [],
        };
      },
    ];
    for (const mutate of cases) {
      const value = fixture();
      const history = JSON.stringify(value.playerPro.rounds);
      mutate(value);
      const result = migratePlayerProActiveRoundSnapshotV20(value.playerPro, value.course);
      expect(result.status).toBe("invalidated");
      expect((result.playerPro as { activeRound: unknown }).activeRound).toBeNull();
      expect(JSON.stringify((result.playerPro as typeof value.playerPro).rounds)).toBe(history);
    }
  });

  it("handles hostile Player Pro values without throwing", () => {
    const { course } = fixture();
    expect(migratePlayerProActiveRoundSnapshotV20(null, course)).toEqual({
      playerPro: null,
      status: "unchanged",
    });
    const malformed = migratePlayerProActiveRoundSnapshotV20({
      rounds: [{ shots: [{ id: "keep" }] }],
      activeRound: { version: 1, id: "bad", course: { width: Number.MAX_SAFE_INTEGER } },
    }, course);
    expect(malformed.status).toBe("invalidated");
    expect((malformed.playerPro as { activeRound: unknown }).activeRound).toBeNull();
  });
});
