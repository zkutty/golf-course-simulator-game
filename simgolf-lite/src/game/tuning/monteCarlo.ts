import type { Course, Terrain, World } from "../models/types";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import { computeTerrainChangeCost } from "../models/terrainEconomics";
import { scoreCourseHoles } from "../sim/holes";
import { isCoursePlayable } from "../sim/isCoursePlayable";
import { createLoan } from "../sim/loans";
import { tickWeek } from "../sim/tickWeek";
import { mulberry32, randInt } from "../../utils/rng";

export type Archetype = "Builder" | "Optimizer" | "Chaotic";

export interface TuneRunResult {
  archetype: Archetype;
  seed: number;
  bankrupt: boolean;
  weeksSurvived: number;
  peakCash: number;
  peakRep: number;
}

function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}

function bresenhamLine(a: { x: number; y: number }, b: { x: number; y: number }) {
  const pts: Array<{ x: number; y: number }> = [];
  let x0 = a.x | 0;
  let y0 = a.y | 0;
  const x1 = b.x | 0;
  const y1 = b.y | 0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    pts.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return pts;
}

function paintBrush(course: Course, world: World, x: number, y: number, t: Terrain) {
  if (x < 0 || y < 0 || x >= course.width || y >= course.height) return { course, world };
  const idx = y * course.width + x;
  const prev = course.tiles[idx];
  if (prev === t) return { course, world };
  const { net } = computeTerrainChangeCost(prev, t);
  if (net > 0 && world.cash < net) return { course, world };
  const tiles = course.tiles.slice();
  tiles[idx] = t;
  const nextCash = world.cash - net;
  return {
    course: { ...course, tiles },
    world: { ...world, cash: nextCash, isBankrupt: world.isBankrupt || nextCash < -10_000 },
  };
}

function paintCorridor(course: Course, world: World, holeIndex: number, width: number, terrain: Terrain) {
  const h = course.holes[holeIndex];
  if (!h?.tee || !h?.green) return { course, world };
  const line = bresenhamLine(h.tee, h.green);
  for (const p of line) {
    for (let dy = -width; dy <= width; dy++) {
      for (let dx = -width; dx <= width; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > width + 1) continue;
        const r = paintBrush(course, world, p.x + dx, p.y + dy, terrain);
        course = r.course;
        world = r.world;
      }
    }
  }
  return { course, world };
}

function paintGreenPad(course: Course, world: World, holeIndex: number) {
  const h = course.holes[holeIndex];
  if (!h?.green) return { course, world };
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const r = paintBrush(course, world, h.green.x + dx, h.green.y + dy, "green");
      course = r.course;
      world = r.world;
    }
  }
  return { course, world };
}

function maybeTakeBridgeLoan(course: Course, world: World) {
  const holes = scoreCourseHoles(course).holes.filter((h) => h.isComplete && h.isValid).length;
  const repOk = world.reputation >= 15;
  const holesOk = isCoursePlayable(course) || holes >= 6;
  const cooldownOk = world.week - (world.lastBridgeLoanWeek ?? -999) >= 8;
  const hasActiveBridge = (world.loans ?? []).some((l) => l.status === "ACTIVE" && l.kind === "BRIDGE");
  if (!repOk || !holesOk || !cooldownOk || hasActiveBridge) return world;
  const loan = createLoan({ kind: "BRIDGE", principal: 25_000, apr: 0.18, termWeeks: 26, idSeed: world.week });
  return {
    ...world,
    cash: world.cash + loan.principal,
    loans: [...(world.loans ?? []), loan],
    lastBridgeLoanWeek: world.week,
  };
}

function maybeTakeExpansionLoan(course: Course, world: World) {
  const holes = scoreCourseHoles(course).holes.filter((h) => h.isComplete && h.isValid).length;
  const repOk = world.reputation >= 50;
  const holesOk = holes >= 9;
  const cashflowOk = (world.lastWeekProfit ?? 0) > 0;
  const hasActiveExpansion = (world.loans ?? []).some((l) => l.status === "ACTIVE" && l.kind === "EXPANSION");
  if (!repOk || !holesOk || !cashflowOk || hasActiveExpansion) return world;
  const loan = createLoan({ kind: "EXPANSION", principal: 150_000, apr: 0.12, termWeeks: 104, idSeed: world.week });
  return { ...world, cash: world.cash + loan.principal, loans: [...(world.loans ?? []), loan] };
}

function stepBot(archetype: Archetype, course: Course, world: World, rng: () => number) {
  if (world.isBankrupt) return { course, world };

  // Distress behavior: take bridge loan if possible
  if ((world.distressWeeks ?? 0) > 0) {
    if (archetype !== "Chaotic") world = maybeTakeBridgeLoan(course, world);
    else if (rng() < 0.35) world = maybeTakeBridgeLoan(course, world);
  }

  // Expansion loan: more likely for Builder
  if (archetype === "Builder" && rng() < 0.8) world = maybeTakeExpansionLoan(course, world);
  if (archetype === "Optimizer" && rng() < 0.3) world = maybeTakeExpansionLoan(course, world);
  if (archetype === "Chaotic" && rng() < 0.1) world = maybeTakeExpansionLoan(course, world);

  const playable = isCoursePlayable(course);
  const summary = scoreCourseHoles(course);
  const avgPlay = (() => {
    const v = summary.holes.filter((h) => h.isComplete && h.isValid);
    return v.length === 0 ? 0 : v.reduce((a, h) => a + h.playabilityScore, 0) / v.length;
  })();

  // Price heuristics
  if (archetype === "Optimizer" && playable) {
    if ((world.lastWeekProfit ?? 0) < 0) course = { ...course, baseGreenFee: clamp(course.baseGreenFee + 5, 40, 95) };
    else if ((world.lastWeekProfit ?? 0) > 1500) course = { ...course, baseGreenFee: clamp(course.baseGreenFee + 2, 40, 110) };
    else if (course.baseGreenFee > 80 && rng() < 0.2) course = { ...course, baseGreenFee: course.baseGreenFee - 2 };
  }
  if (archetype === "Chaotic" && rng() < 0.25) {
    course = { ...course, baseGreenFee: clamp(course.baseGreenFee + randInt(rng, -15, 15), 20, 150) };
  }

  // Build heuristics
  if (archetype === "Optimizer") {
    // First: reach playable by painting narrow fairways
    if (!playable || avgPlay < 45) {
      // prioritize worst hole
      const worst = summary.holes
        .slice(0, 9)
        .filter((h) => h.isComplete)
        .sort((a, b) => a.playabilityScore - b.playabilityScore)[0];
      const hi = worst ? worst.holeIndex : 0;
      ({ course, world } = paintCorridor(course, world, hi, 1, "fairway"));
      if (rng() < 0.25) ({ course, world } = paintGreenPad(course, world, hi));
    }
  } else if (archetype === "Builder") {
    // Aggressive early course build: wide fairways + greens, some sand for shape
    for (let hi = 0; hi < 9; hi++) {
      ({ course, world } = paintCorridor(course, world, hi, 2, "fairway"));
      ({ course, world } = paintGreenPad(course, world, hi));
      if (rng() < 0.12) ({ course, world } = paintCorridor(course, world, hi, 1, "sand"));
      if (world.cash < 2000) break;
    }
  } else {
    // Chaotic: random paint
    const tries = 40;
    for (let k = 0; k < tries; k++) {
      const x = randInt(rng, 0, course.width - 1);
      const y = randInt(rng, 0, course.height - 1);
      const t: Terrain =
        rng() < 0.45 ? "fairway" : rng() < 0.65 ? "sand" : rng() < 0.78 ? "water" : rng() < 0.9 ? "deep_rough" : "rough";
      ({ course, world } = paintBrush(course, world, x, y, t));
      if (world.cash < -10_000) break;
      if (rng() < 0.05) break;
    }
  }

  return { course, world };
}

export function simulateRun(archetype: Archetype, seed: number, maxWeeks = 260): TuneRunResult {
  let course: Course = { ...DEFAULT_COURSE, tiles: DEFAULT_COURSE.tiles.slice() };
  let world: World = {
    ...DEFAULT_WORLD,
    runSeed: seed,
    isBankrupt: false,
    distressWeeks: 0,
    loans: [],
    lastBridgeLoanWeek: -999,
    lastWeekProfit: 0,
  };

  const rng = mulberry32(seed);
  let peakCash = world.cash;
  let peakRep = world.reputation;

  while (!world.isBankrupt && world.week <= maxWeeks) {
    ({ course, world } = stepBot(archetype, course, world, rng));
    peakCash = Math.max(peakCash, world.cash);
    peakRep = Math.max(peakRep, world.reputation);
    if (world.isBankrupt) break;
    const out = tickWeek(course, world, seed);
    course = out.course;
    world = out.world;
    peakCash = Math.max(peakCash, world.cash);
    peakRep = Math.max(peakRep, world.reputation);
  }

  return {
    archetype,
    seed,
    bankrupt: world.isBankrupt,
    weeksSurvived: Math.max(0, world.week - 1),
    peakCash,
    peakRep,
  };
}

export function runMonteCarlo(args: { nPerArchetype: number; seed0: number }) {
  const archetypes: Archetype[] = ["Optimizer", "Builder", "Chaotic"];
  const results: TuneRunResult[] = [];
  for (const a of archetypes) {
    for (let i = 0; i < args.nPerArchetype; i++) {
      results.push(simulateRun(a, args.seed0 + i * 101 + a.length * 1000));
    }
  }

  function summarize(a: Archetype | "ALL") {
    const rows = a === "ALL" ? results : results.filter((r) => r.archetype === a);
    const n = rows.length || 1;
    const bankruptRate = rows.filter((r) => r.bankrupt).length / n;
    const avgWeeks = rows.reduce((s, r) => s + r.weeksSurvived, 0) / n;
    const avgPeakCash = rows.reduce((s, r) => s + r.peakCash, 0) / n;
    const avgPeakRep = rows.reduce((s, r) => s + r.peakRep, 0) / n;
    return { bankruptRate, avgWeeks, avgPeakCash, avgPeakRep, n };
  }

  return {
    results,
    summary: {
      ALL: summarize("ALL"),
      Optimizer: summarize("Optimizer"),
      Builder: summarize("Builder"),
      Chaotic: summarize("Chaotic"),
    },
  };
}





