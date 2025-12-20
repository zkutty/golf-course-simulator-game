import type { Course, Hole, Point, Terrain } from "../models/types";

export interface HoleScore {
  holeIndex: number;
  isComplete: boolean;
  isValid: boolean;
  par: number;
  distance: number; // tiles (euclidean)
  corridor: {
    samples: number;
    fairway: number;
    rough: number;
    sand: number;
    water: number;
    green: number;
    tee: number;
    path: number;
  };
  score: number; // 0..100
  issues: string[];
}

export interface CourseHoleSummary {
  holes: HoleScore[];
  holeQualityAvg: number; // 0..100
  variety: number; // 0..100
  globalBonus: number; // -10..+10-ish
  courseQuality: number; // 0..100
}

function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}

function dist(a: Point, b: Point) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function derivePar(distanceTiles: number) {
  // Very rough tile-distance par mapping for MVP.
  if (distanceTiles < 12) return 3;
  if (distanceTiles < 20) return 4;
  return 5;
}

function inBounds(course: Course, p: Point) {
  return p.x >= 0 && p.y >= 0 && p.x < course.width && p.y < course.height;
}

export function tileAt(course: Course, p: Point): Terrain {
  return course.tiles[p.y * course.width + p.x];
}

export function sampleLine(a: Point, b: Point, samples = 13): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < samples; i++) {
    const t = samples === 1 ? 0 : i / (samples - 1);
    pts.push({
      x: Math.round(a.x + (b.x - a.x) * t),
      y: Math.round(a.y + (b.y - a.y) * t),
    });
  }
  // Deduplicate
  const seen = new Set<string>();
  return pts.filter((p) => {
    const k = `${p.x},${p.y}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function scoreHole(course: Course, hole: Hole, holeIndex: number): HoleScore {
  const issues: string[] = [];
  if (!hole.tee || !hole.green) {
    return {
      holeIndex,
      isComplete: false,
      isValid: false,
      par: hole.par ?? 4,
      distance: 0,
      corridor: {
        samples: 0,
        fairway: 0,
        rough: 0,
        sand: 0,
        water: 0,
        green: 0,
        tee: 0,
        path: 0,
      },
      score: 0,
      issues: ["Missing tee/green placement"],
    };
  }

  const tee = hole.tee;
  const green = hole.green;

  if (!inBounds(course, tee)) issues.push("Tee is out of bounds");
  if (!inBounds(course, green)) issues.push("Green is out of bounds");
  if (tee.x === green.x && tee.y === green.y) issues.push("Tee and green overlap");

  const distance = dist(tee, green);
  const par = hole.par ?? derivePar(distance);

  const teeTile = inBounds(course, tee) ? tileAt(course, tee) : "rough";
  const greenTile = inBounds(course, green) ? tileAt(course, green) : "rough";
  if (teeTile === "water" || teeTile === "sand") issues.push("Tee on hazard");
  if (greenTile === "water" || greenTile === "sand") issues.push("Green on hazard");

  const pts = inBounds(course, tee) && inBounds(course, green) ? sampleLine(tee, green, 17) : [];
  const corridorCounts = pts.reduce(
    (acc, p) => {
      const t = tileAt(course, p);
      acc[t] += 1;
      acc.samples += 1;
      return acc;
    },
    {
      samples: 0,
      fairway: 0,
      rough: 0,
      sand: 0,
      water: 0,
      green: 0,
      tee: 0,
      path: 0,
    }
  );

  const s = corridorCounts.samples || 1;
  const waterFrac = corridorCounts.water / s;
  const sandFrac = corridorCounts.sand / s;
  const fairwayFrac = corridorCounts.fairway / s;
  const roughFrac = corridorCounts.rough / s;
  const pathFrac = corridorCounts.path / s;

  if (waterFrac > 0.25) issues.push("Lots of water on main line");
  if (roughFrac > 0.7) issues.push("Mostly rough on main line");

  // Quality scoring (0..100)
  // - reward fairway/path, mild reward for "some" hazards, heavy penalty for excessive water/sand
  // - reward reasonable distances / variety handled at course level
  let score = 70;
  score += 30 * fairwayFrac;
  score += 10 * pathFrac;
  score -= 80 * waterFrac;
  score -= 35 * sandFrac;
  score -= (teeTile === "water" || teeTile === "sand") ? 20 : 0;
  score -= (greenTile === "water" || greenTile === "sand") ? 20 : 0;
  score = clamp(score, 0, 100);

  const isValid = issues.length === 0;

  return {
    holeIndex,
    isComplete: true,
    isValid,
    par,
    distance,
    corridor: corridorCounts,
    score,
    issues,
  };
}

export function scoreCourseHoles(course: Course): CourseHoleSummary {
  const holes = course.holes.map((h, i) => scoreHole(course, h, i));
  const scored = holes.filter((h) => h.isComplete);
  const holeQualityAvg =
    scored.length === 0 ? 0 : scored.reduce((acc, h) => acc + h.score, 0) / scored.length;

  // Variety: reward mix of par 3/4/5 (or derived lengths if par missing)
  const parCounts = new Map<number, number>();
  for (const h of holes) parCounts.set(h.par, (parCounts.get(h.par) ?? 0) + 1);
  const distinctPars = parCounts.size; // 1..3 in MVP
  const variety = clamp(20 + 40 * distinctPars, 0, 100); // 60 for 1 par, 100 for 2+, simple MVP

  // Small global bonuses for some pathing + tasteful water usage
  const total = course.tiles.length || 1;
  const pathFrac = course.tiles.filter((t) => t === "path").length / total;
  const waterFrac = course.tiles.filter((t) => t === "water").length / total;
  const globalBonus = clamp(8 * pathFrac - 6 * Math.max(0, waterFrac - 0.08), -10, 10);

  const courseQuality = clamp(holeQualityAvg + globalBonus + 0.15 * (variety - 70), 0, 100);

  return { holes, holeQualityAvg, variety, globalBonus, courseQuality };
}


