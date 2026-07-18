import type { Course, Point, StaffMember, StaffRole, World } from "../models/types";
import { STAFF_ROLE_COLOR } from "../models/staff";
import { mulberry32 } from "../../utils/rng";
import { entryPoint, type WalkRouter } from "./golfer";
import { LIVE } from "./liveConfig";
import type { GolferArchetypeName, GolferRenderData, Segment } from "./types";

// Staff as live entities (ZKU-121): each rostered employee becomes a person
// on the course during their shift, walking real routes and running a small
// per-role task loop. Advancement reuses the golfer Segment machinery so the
// renderer draws staff with the exact same sprite pipeline.

type StaffTask = "idle" | "move" | "mow" | "watch";

export interface StaffEntity {
  id: number; // roster id (render ids are negated to avoid golfer collisions)
  name: string;
  role: StaffRole;
  color: string;
  shift: { start: number; end: number };
  pos: Point;
  segments: Segment[];
  segIndex: number;
  segElapsed: number;
  onCourse: boolean;
  leaving: boolean;
  task: StaffTask;
  // Index of the first "working" segment of the current task (a marshal only
  // counts as attending its hole once the walk there has finished).
  workStartIndex: number;
  taskCount: number; // rng stream position — one draw sequence per task
  /** Marshal: hole currently attended / being walked to (-1 = none). */
  watchingHole: number;
  thought: string | null;
  seed: number;
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function walkSeg(from: Point, to: Point): Segment {
  return { kind: "walk", from, to, holeIndex: -1, dur: dist(from, to) * LIVE.staff.walkPerTile };
}

function pauseSeg(at: Point, dur: number): Segment {
  return { kind: "pause", from: at, to: at, holeIndex: -1, dur };
}

// Routed walk from -> to (around water); falls back to a straight leg.
function pushWalk(segments: Segment[], route: WalkRouter, from: Point, to: Point): void {
  const path = route(from, to);
  if (path && path.length) {
    let cur = from;
    for (const wp of path) {
      segments.push(walkSeg(cur, wp));
      cur = wp;
    }
    return;
  }
  segments.push(walkSeg(from, to));
}

function clampPoint(course: Course, p: Point): Point {
  return {
    x: Math.max(0, Math.min(course.width - 1, p.x)),
    y: Math.max(0, Math.min(course.height - 1, p.y)),
  };
}

export function shiftWindow(shift: StaffMember["shift"]): { start: number; end: number } {
  return LIVE.staff.shifts[shift];
}

export function createStaffEntities(world: World, course: Course, seed: number): StaffEntity[] {
  const entry = entryPoint(course);
  return (world.staff ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    role: s.role,
    color: STAFF_ROLE_COLOR[s.role],
    shift: shiftWindow(s.shift),
    pos: { ...entry },
    segments: [],
    segIndex: 0,
    segElapsed: 0,
    onCourse: false,
    leaving: false,
    task: "idle" as const,
    workStartIndex: 0,
    taskCount: 0,
    watchingHole: -1,
    thought: null,
    seed: (seed | 0) + s.id * 6271,
  }));
}

/**
 * Reconcile live staff entities against an edited roster mid-day (hire/fire
 * or shift change from the UI, ZKU-124). Existing entities keep their position
 * and task; new hires appear at the entry, fired staff vanish.
 */
export function syncStaffEntities(
  entities: StaffEntity[],
  world: World,
  course: Course,
  seed: number
): StaffEntity[] {
  const fresh = createStaffEntities(world, course, seed);
  const byId = new Map(entities.map((e) => [e.id, e]));
  return fresh.map((f) => {
    const prev = byId.get(f.id);
    if (!prev) return f;
    // Shift may have changed; everything else about the live entity survives.
    return { ...prev, name: f.name, shift: f.shift };
  });
}

/** Anchor point for a hole: midway down the fairway line. */
function holeAnchor(course: Course, holeIndex: number): Point | null {
  const hole = course.holes[holeIndex];
  if (!hole?.tee || !hole?.green) return null;
  return clampPoint(course, lerp(hole.tee, hole.green, 0.5));
}

// Maintenance spots a groundskeeper cares about: greens first (highest maint
// weight), then tees. Cheap on purpose — no hole solving here.
function maintenanceSpots(course: Course): Point[] {
  const spots: Point[] = [];
  for (const h of course.holes) {
    if (h.green) spots.push(h.green);
  }
  for (const h of course.holes) {
    if (h.tee) spots.push(h.tee);
  }
  return spots;
}

// Zigzag mow legs over the 3x3 patch around the target — reads as mowing
// stripes on screen with zero renderer support (ZKU-122).
function mowLegsAround(course: Course, p: Point): Segment[] {
  const { legMinutes, legs, finishPause } = LIVE.staff.mow;
  const segs: Segment[] = [];
  let cur = clampPoint(course, { x: p.x - 1, y: p.y - 1 });
  for (let i = 0; i < legs; i++) {
    const row = Math.floor((i + 1) / 2);
    const rightward = row % 2 === 0;
    const next = clampPoint(course, {
      x: i % 2 === 0 ? p.x + (rightward ? 1 : -1) : cur.x,
      y: i % 2 === 0 ? cur.y : p.y - 1 + row,
    });
    segs.push({ kind: "walk", from: cur, to: next, holeIndex: -1, dur: legMinutes });
    cur = next;
  }
  segs.push(pauseSeg(cur, finishPause));
  return segs;
}

export interface StaffStepContext {
  course: Course;
  dayMinute: number;
  route: WalkRouter;
  /** Congested holes, most stacked first (ZKU-123). */
  congested: number[];
}

// Plan the entity's next task from wherever it stands. One rng stream draw
// sequence per task keeps behavior deterministic for a given day seed.
function planNextTask(s: StaffEntity, ctx: StaffStepContext, claimedHoles: Set<number>): void {
  const rng = mulberry32(s.seed + s.taskCount * 7919);
  s.taskCount++;
  s.segments = [];
  s.segIndex = 0;
  s.segElapsed = 0;
  s.watchingHole = -1;
  s.thought = null;
  const { course, route } = ctx;

  switch (s.role) {
    case "groundskeeper": {
      const spots = maintenanceSpots(course);
      if (spots.length === 0) {
        s.task = "idle";
        s.segments = [pauseSeg(s.pos, LIVE.staff.stationPause)];
        return;
      }
      const target = spots[Math.floor(rng() * spots.length) % spots.length];
      pushWalk(s.segments, route, s.pos, target);
      s.workStartIndex = s.segments.length;
      s.segments.push(...mowLegsAround(course, target));
      s.task = "mow";
      s.thought = "Keeping the turf tidy";
      return;
    }
    case "marshal": {
      const open = ctx.congested.filter((h) => !claimedHoles.has(h));
      const targetHole =
        open.length > 0
          ? open[0]
          : // Patrol: drift between holes, watching for trouble.
            pickPatrolHole(course, rng);
      const anchor = targetHole >= 0 ? holeAnchor(course, targetHole) : null;
      if (anchor == null) {
        s.task = "idle";
        s.segments = [pauseSeg(s.pos, LIVE.staff.stationPause)];
        return;
      }
      if (open.length > 0) claimedHoles.add(targetHole);
      pushWalk(s.segments, route, s.pos, anchor);
      s.workStartIndex = s.segments.length;
      s.segments.push(pauseSeg(anchor, LIVE.staff.congestion.marshalWatchPause));
      s.task = "watch";
      s.watchingHole = targetHole;
      s.thought = open.length > 0 ? "Keeping play moving" : null;
      return;
    }
    default: {
      // Cart attendants and pro shop staff work out of the clubhouse (or the
      // entrance if none is built): short shuttle walks around the station.
      const clubhouse = course.buildings.find((b) => b.type === "clubhouse");
      const station = clampPoint(
        course,
        clubhouse ? { x: clubhouse.x + 1, y: clubhouse.y + 1 } : entryPoint(course)
      );
      const r = LIVE.staff.shuttleRadius;
      const target = clampPoint(course, {
        x: station.x + (rng() * 2 - 1) * r,
        y: station.y + (rng() * 2 - 1) * r,
      });
      pushWalk(s.segments, route, s.pos, target);
      s.workStartIndex = s.segments.length;
      s.segments.push(pauseSeg(target, LIVE.staff.stationPause));
      s.task = "move";
      return;
    }
  }
}

function pickPatrolHole(course: Course, rng: () => number): number {
  const candidates: number[] = [];
  for (let i = 0; i < course.holes.length; i++) {
    if (course.holes[i]?.tee && course.holes[i]?.green) candidates.push(i);
  }
  if (candidates.length === 0) return -1;
  return candidates[Math.floor(rng() * candidates.length) % candidates.length];
}

// Consume dtMin from the entity's segment queue; returns leftover minutes if
// the queue ran dry (time to plan the next task).
function advanceSegments(s: StaffEntity, dtMin: number): number {
  let remaining = dtMin;
  let guard = 0;
  while (remaining > 0 && s.segIndex < s.segments.length && guard++ < 10_000) {
    const seg = s.segments[s.segIndex];
    const left = seg.dur - s.segElapsed;
    if (remaining < left) {
      s.segElapsed += remaining;
      remaining = 0;
    } else {
      remaining -= left;
      s.segElapsed = 0;
      s.segIndex++;
    }
  }
  const seg = s.segments[s.segIndex];
  if (seg) {
    const t = seg.dur > 0 ? Math.min(1, s.segElapsed / seg.dur) : 1;
    s.pos = seg.kind === "walk" ? lerp(seg.from, seg.to, t) : { ...seg.from };
  } else if (s.segments.length > 0) {
    s.pos = { ...s.segments[s.segments.length - 1].to };
  }
  return remaining;
}

export interface StaffStepResult {
  /** Groundskeeper maintenance tasks completed this step (ZKU-122). */
  mowTasksCompleted: number;
}

/**
 * Advance every staff entity by dtMin game-minutes: shift starts/ends, task
 * planning, and segment walking. Mutates entities in place.
 */
export function stepStaffEntities(
  staff: StaffEntity[],
  dtMin: number,
  ctx: StaffStepContext
): StaffStepResult {
  let mowTasksCompleted = 0;
  const entry = entryPoint(ctx.course);
  // Marshals coordinate: each congested hole gets one marshal. Holes already
  // being attended or walked to stay claimed across re-plans this step.
  const claimedHoles = new Set<number>();
  for (const s of staff) {
    if (s.role === "marshal" && s.watchingHole >= 0) claimedHoles.add(s.watchingHole);
  }

  for (const s of staff) {
    const onDuty = ctx.dayMinute >= s.shift.start && ctx.dayMinute < s.shift.end;

    if (!s.onCourse) {
      if (onDuty) {
        // Clock in at the entrance and pick up the first task.
        s.onCourse = true;
        s.leaving = false;
        s.pos = { ...entry };
        planNextTask(s, ctx, claimedHoles);
      } else {
        continue;
      }
    } else if (!onDuty && !s.leaving) {
      // Shift over: drop the task and head for the exit.
      s.leaving = true;
      s.task = "move";
      s.watchingHole = -1;
      s.thought = null;
      s.segments = [];
      s.segIndex = 0;
      s.segElapsed = 0;
      pushWalk(s.segments, ctx.route, s.pos, entry);
      s.workStartIndex = s.segments.length;
    }

    let remaining = dtMin;
    let guard = 0;
    while (remaining > 0 && guard++ < 50) {
      remaining = advanceSegments(s, remaining);
      if (s.segIndex < s.segments.length) break; // mid-task, time exhausted
      // Queue ran dry: task finished.
      if (s.leaving) {
        s.onCourse = false;
        s.leaving = false;
        s.task = "idle";
        break;
      }
      if (s.task === "mow") mowTasksCompleted++;
      // A marshal stays put while its hole is still congested.
      if (
        s.task === "watch" &&
        s.watchingHole >= 0 &&
        ctx.congested.includes(s.watchingHole)
      ) {
        s.segments = [pauseSeg(s.pos, LIVE.staff.congestion.marshalWatchPause)];
        s.segIndex = 0;
        s.segElapsed = 0;
        s.workStartIndex = 0;
        continue;
      }
      planNextTask(s, ctx, claimedHoles);
    }
  }
  return { mowTasksCompleted };
}

/** Count of a role currently working (on course, not walking off). */
export function onDutyCount(staff: readonly StaffEntity[], role: StaffRole): number {
  let n = 0;
  for (const s of staff) if (s.role === role && s.onCourse && !s.leaving) n++;
  return n;
}

/** Holes actively attended by a marshal who has finished walking there. */
export function marshaledHoles(staff: readonly StaffEntity[]): Set<number> {
  const out = new Set<number>();
  for (const s of staff) {
    if (s.role !== "marshal" || !s.onCourse || s.leaving) continue;
    if (s.watchingHole >= 0 && s.segIndex >= s.workStartIndex) out.add(s.watchingHole);
  }
  return out;
}

// Sprite variant per role — stable uniforms (see golferVariant mapping).
const ROLE_ARCHETYPE: Record<StaffRole, GolferArchetypeName> = {
  groundskeeper: "senior",
  cartAttendant: "junior",
  proShop: "lowHandicap",
  marshal: "pro",
};

/**
 * Render staff through the golfer sprite pipeline: same render-data shape,
 * negated ids so they never collide with golfer ids, role-colored uniforms,
 * and a steady mood so no reaction animations fire.
 */
export function staffRenderData(staff: readonly StaffEntity[]): GolferRenderData[] {
  const out: GolferRenderData[] = [];
  for (const s of staff) {
    if (!s.onCourse) continue;
    const seg = s.segments[s.segIndex];
    const segKind = seg?.kind ?? null;
    const segT = seg ? (seg.dur > 0 ? Math.max(0, Math.min(1, s.segElapsed / seg.dur)) : 1) : 0;
    let dirX = 0;
    let dirY = 0;
    if (seg?.kind === "walk") {
      const dx = seg.to.x - seg.from.x;
      const dy = seg.to.y - seg.from.y;
      const len = Math.hypot(dx, dy);
      if (len > 1e-6) {
        dirX = dx / len;
        dirY = dy / len;
      }
    }
    out.push({
      id: -s.id,
      x: s.pos.x,
      y: s.pos.y,
      ballX: null,
      ballY: null,
      ballToX: null,
      ballToY: null,
      color: s.color,
      mood: 0.75,
      thought: s.thought,
      archetype: ROLE_ARCHETYPE[s.role],
      segKind,
      segT,
      shot: null,
      dirX,
      dirY,
      scoredHoles: 0,
      lastHoleDelta: 0,
    });
  }
  return out;
}
