import type { Course, LandTheme, Point, Terrain } from "../models/types";
import { COURSE_WIDTH, COURSE_HEIGHT } from "../models/constants";
import { DEFAULT_COURSE } from "../models/defaults";
import { findClubhouseSpot } from "../models/buildings";
import { generateWildLand, generateObstacles } from "../gen/generateWildLand";
import { createEstate, starterParcelOffset } from "../estate/estate";
import type { FixtureKey } from "./types";

// Authored prebuilt-course fixtures (ZKU-164). Deterministic: land from the
// scenario seed, then holes carved programmatically. Elevations are kept
// flat so authored routes are guaranteed walkable regardless of the seed's
// noise field.

interface HoleSpec {
  tee: Point;
  green: Point;
}

/** Nine varied-length holes zig-zagging down the parcel. */
function nineHoleLayout(): HoleSpec[] {
  const offset = starterParcelOffset();
  const rows = [8, 15, 22, 29, 36, 43, 50, 57, 64];
  const lengths = [22, 13, 28, 17, 32, 12, 25, 15, 30]; // tiles ≈ yards/10
  return rows.map((y, i) => {
    const leftToRight = i % 2 === 0;
    const x0 = 14;
    const x1 = x0 + lengths[i];
    return leftToRight
      ? { tee: { x: x0 + offset.x, y: y + offset.y }, green: { x: x1 + offset.x, y: y + offset.y } }
      : { tee: { x: x1 + offset.x, y: y + offset.y }, green: { x: x0 + offset.x, y: y + offset.y } };
  });
}

function paintCourse(args: {
  seed: number;
  theme: LandTheme;
  name: string;
  corridorHalfWidth: number;
  condition: number;
  baseGreenFee: number;
}): Course {
  const { seed, theme } = args;
  const width = COURSE_WIDTH;
  const height = COURSE_HEIGHT;
  const tiles = generateWildLand(width, height, seed, theme);
  const set = (x: number, y: number, t: Terrain) => {
    if (x >= 0 && y >= 0 && x < width && y < height) tiles[y * width + x] = t;
  };

  const specs = nineHoleLayout();
  for (const { tee, green } of specs) {
    // Straight corridor: fairway band (overwrites water — the architect
    // drained it), then tee tile and a 3x3 green pad.
    const minX = Math.min(tee.x, green.x);
    const maxX = Math.max(tee.x, green.x);
    for (let x = minX; x <= maxX; x++) {
      for (let dy = -args.corridorHalfWidth; dy <= args.corridorHalfWidth; dy++) {
        set(x, tee.y + dy, "fairway");
      }
    }
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) set(green.x + dx, green.y + dy, "green");
    set(tee.x, tee.y, "tee");
  }

  // Obstacles avoid tee/green zones, then anything standing on playing
  // surfaces is cleared.
  const reserved = specs.flatMap((s) => [s.tee, s.green]);
  const obstacles = generateObstacles(width, height, tiles, seed, reserved, theme).filter((o) => {
    const t = tiles[o.y * width + o.x];
    return t !== "fairway" && t !== "green" && t !== "tee" && t !== "path";
  });

  const course: Course = {
    ...DEFAULT_COURSE,
    name: args.name,
    theme,
    width,
    height,
    tiles,
    elevations: new Array(width * height).fill(0),
    holes: specs.map((s, i) => ({
      tee: s.tee,
      green: s.green,
      parMode: "AUTO" as const,
      name: `Hole ${i + 1}`,
    })),
    obstacles,
    buildings: [],
    condition: args.condition,
    baseGreenFee: args.baseGreenFee,
  };
  const clubhouseSpot = findClubhouseSpot(course);
  course.buildings = clubhouseSpot ? [{ type: "clubhouse" as const, ...clubhouseSpot }] : [];
  course.estate = createEstate(course, seed);
  return course;
}

/** Run-down municipal 9-holer: narrow scruffy corridors, tired turf. */
function buildMuni(seed: number): Course {
  return paintCourse({
    seed,
    theme: "parkland",
    name: "Crickle Creek Municipal",
    corridorHalfWidth: 1,
    condition: 0.35,
    baseGreenFee: 30,
  });
}

/** Manicured members' club: wide fairways, pristine turf, premium fee. */
function buildMembers(seed: number): Course {
  return paintCourse({
    seed,
    theme: "parkland",
    name: "Fairhaven Members Club",
    corridorHalfWidth: 2,
    condition: 0.92,
    baseGreenFee: 110,
  });
}

export function buildFixtureCourse(key: FixtureKey, seed: number): Course {
  return key === "muni" ? buildMuni(seed) : buildMembers(seed);
}
