import { afterEach, describe, expect, it, vi } from "vitest";
import type { Course, Point, Terrain } from "../models/types";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import type { Golfer, LiveState, Segment } from "../live/types";
import { createLiveState, liveRenderData, stepLive } from "../live/simulation";
import { commitDay } from "../live/commitDay";
import { restoreLiveSimulation, snapshotLiveSimulation } from "../live/persistence";
import { normalizeM51CourseMobilityState, settleM51MobilityDay } from "./mobility";
import {
  reapplyGroupMobility,
  releaseFinishedMobilityGroups,
  reserveGroupMobility,
  settleMobilityFleet,
} from "./operations";
import * as observedRouter from "./travelRouter";
import * as observedAdapter from "../paths/pathMovementAdapter";
import { mobilityRenderUnits } from "./mobilityRender";
import { corridorFeature, translateSurfaceIntent } from "../models/surfaceIntent";
import { findWalkPath } from "../live/walkPath";
import { createPathWalkingRouter } from "../paths/pathMovementAdapter";
import { TimedItineraryBuilder, getOriginalWalkPlan, attachOriginalWalkPlan } from "./timedItinerary";
import { authoredPathFixture } from "../testing/continuousPathFixtures";
import { buildContinuousPathPlan, classifyContinuousPathPoint } from "../paths/continuousPathPlan";

function rentalCourse(options: { carts?: number; pushcarts?: number; paths?: boolean; enabled?: boolean } = {}): Course {
  const width = 60; const height = 24;
  const tiles = new Array<Terrain>(width * height).fill("fairway");
  if (options.paths !== false) for (let x = 1; x < width - 1; x++) tiles[4 * width + x] = "path";
  tiles[12 * width + 4] = "tee"; tiles[12 * width + 50] = "green";
  const buildingId = "rental";
  const fleet = Object.fromEntries([
    ...Array.from({ length: options.carts ?? 2 }, (_, index) => {
      const id = `cart-${index + 1}`;
      return [id, { id, courseId: "course-primary", buildingId, productId: `${buildingId}:riding_cart`, mode: "riding_cart" as const, seats: 2, state: "available" as const, condition: 1, uses: 0, wear: 0 }];
    }),
    ...Array.from({ length: options.pushcarts ?? 4 }, (_, index) => {
      const id = `push-${index + 1}`;
      return [id, { id, courseId: "course-primary", buildingId, productId: `${buildingId}:pushcart`, mode: "pushcart" as const, seats: 1, state: "available" as const, condition: 1, uses: 0, wear: 0 }];
    }),
  ]);
  return {
    ...DEFAULT_COURSE,
    name: "Mobility Links", width, height, tiles, elevations: new Array(width * height).fill(0),
    holes: [{ id: "hole-1", tee: { x: 4, y: 12 }, green: { x: 50, y: 12 }, parMode: "AUTO", name: "Long walk" }],
    // This focused one-hole fixture represents a legacy partial layout. Live
    // arrival planning now correctly rejects incomplete authored courses, so
    // retain the explicit legacy opt-in while exercising M51's full-day
    // assignment/return lifecycle.
    layouts: [{ id: "course-primary", name: "Mobility Links", draftHoleIds: ["hole-1"], publishedHoleIds: ["hole-1"], roundLength: 9, state: "open", greenFee: 65, legacyPartial: true }],
    buildings: [{ id: buildingId, type: "cart_rental", x: 2, y: 2, tier: 2, price: 20 }],
    obstacles: [], decorations: [],
    m51: {
      version: 3,
      cartRentals: {
        rental: {
          buildingId, tier: 2,
          products: {
            pushcart: { id: "rental:pushcart", courseId: "course-primary", buildingId, mode: "pushcart", name: "Pushcart", price: 9, enabled: options.enabled !== false },
            riding_cart: { id: "rental:riding_cart", courseId: "course-primary", buildingId, mode: "riding_cart", name: "Riding cart", price: 20, enabled: options.enabled !== false },
          },
        },
      },
      fleet,
      settledAssignmentIds: [],
    },
  };
}

function golfer(id: number, groupId: string, wallet = 80): Golfer {
  return {
    id, name: `Golfer ${id}`, archetype: "senior", courseId: "course-primary", courseName: "Mobility Links",
    personality: { skill: .55, consistency: .6, patience: .45, spendPropensity: 1, prefs: { difficulty: 0, scenery: 0, price: 1 }, pacePreference: .8 },
    color: "#fff",
    segments: [
      { kind: "pause", from: { x: 2, y: 8 }, to: { x: 2, y: 8 }, holeIndex: -1, dur: 1, concession: { buildingType: "cart_rental", buildingX: 2, buildingY: 2, item: "Legacy cart", amount: 99 } },
      { kind: "walk", from: { x: 2, y: 8 }, to: { x: 56, y: 8 }, holeIndex: 0, dur: 180 },
    ],
    segIndex: 0, segElapsed: 0, pos: { x: 2, y: 8 }, ball: null,
    holePar: [4], holeStrokes: [4], scoredHoles: 0, currentHole: -1, strokes: 0, scoreToPar: 0,
    mood: .7, thought: null, thoughtUntil: 0, finished: false, spent: 65, wallet,
    purchasedSegmentIndexes: [], groupId, groupStartedAt: 20, pacePreference: .8, completionStatus: "completed",
  };
}

function live(course: Course): LiveState {
  const state = createLiveState(course, { ...DEFAULT_WORLD, runSeed: 5151 }, 0);
  state.arrivals = []; state.nextArrivalIdx = 0; state.golfers = []; state.groups = [];
  return state;
}

describe("M51 coordinated group mobility operations", () => {
  it("selects, reserves, assigns, and charges a group deterministically in golfer order", () => {
    const course = rentalCourse();
    const firstState = live(course); const firstGolfers = [golfer(4, "g-1"), golfer(1, "g-1"), golfer(3, "g-1"), golfer(2, "g-1")];
    const first = reserveGroupMobility(firstState, course, firstGolfers);
    const second = reserveGroupMobility(live(course), course, [golfer(4, "g-1"), golfer(1, "g-1"), golfer(3, "g-1"), golfer(2, "g-1")]);

    expect(first.selection).toMatchObject({ mode: "riding_cart", groupSize: 4, perGolferFee: 20, status: "confirmed" });
    expect(first.assignment.fleetUnitIds).toEqual(["cart-1", "cart-2"]);
    expect(first.assignment.serviceDelayMinutes).toBeGreaterThan(0);
    expect(first.assignment.riders.map((rider) => [rider.golferId, rider.fleetUnitId, rider.seat])).toEqual([
      [1, "cart-1", 0], [2, "cart-1", 1], [3, "cart-2", 0], [4, "cart-2", 1],
    ]);
    expect(first.concessionTransactions.map((transaction) => transaction.golferId)).toEqual([1, 2, 3, 4]);
    expect(first.cashDelta).toBe(80);
    expect(firstState.m51?.transactions.map((transaction) => transaction.id)).toEqual(second.assignment && second.concessionTransactions.map((transaction) => transaction.id));
    expect(firstGolfers.every((member) => member.wallet === 60 && member.segments.every((segment) => segment.concession?.buildingType !== "cart_rental"))).toBe(true);
    expect(firstGolfers.every((member) => (member.mobilityActualTravelMinutes ?? Infinity) < (member.mobilityPredictedWalkingMinutes ?? 0))).toBe(true);
    expect(firstGolfers[0].segments.reduce((sum, segment) => sum + segment.dur, 0)).toBeLessThan(180);
    expect(reserveGroupMobility(firstState, course, firstGolfers)).toMatchObject({ cashDelta: 0, concessionTransactions: [], assignment: { id: first.assignment.id } });
    expect(firstState.m51?.transactions).toHaveLength(4);
  });

  it("records stockouts and falls back without overbooking; affordability, disabled offers, no facility, and tournaments walk", () => {
    const course = rentalCourse({ carts: 1, pushcarts: 4 });
    const state = live(course);
    const first = reserveGroupMobility(state, course, [golfer(1, "g-1"), golfer(2, "g-1")]);
    const second = reserveGroupMobility(state, course, [golfer(3, "g-2"), golfer(4, "g-2")]);
    expect(first.selection.mode).toBe("riding_cart");
    expect(second.selection.mode).toBe("pushcart");
    expect(state.m51?.stockouts).toMatchObject([{ groupId: "g-2", mode: "riding_cart", requiredUnits: 1, availableUnits: 0 }]);
    expect(new Set(state.m51?.assignments.flatMap((assignment) => assignment.fleetUnitIds)).size).toBe(3);

    const poor = reserveGroupMobility(live(course), course, [golfer(5, "poor", 5), golfer(6, "poor", 5)]);
    expect(poor.selection).toMatchObject({ mode: "walk", reason: "unaffordable_fallback" });
    const disabledCourse = rentalCourse({ enabled: false });
    expect(reserveGroupMobility(live(disabledCourse), disabledCourse, [golfer(7, "disabled")]).selection.mode).toBe("walk");
    const noFacility = { ...rentalCourse(), buildings: [], m51: undefined };
    expect(reserveGroupMobility(live(noFacility), noFacility, [golfer(8, "none")]).selection).toMatchObject({ mode: "walk", reason: "no_facility" });
    const tournamentState = live(course); tournamentState.tournament = { eventId: "event", name: "Open", tier: "local", courseId: "course-primary", teeSet: "member", pinRotation: "A", ordinaryPinRotation: "A", qualificationSnapshot: { eligible: true, teeSet: "member", pinRotation: "A", rating: 72, slope: 113, effectiveYardage: 6000, completeRotations: ["A"], requirements: [], blockingReasons: [] }, standings: [] };
    expect(reserveGroupMobility(tournamentState, course, [golfer(9, "event")]).selection).toMatchObject({ mode: "walk", reason: "policy_fallback" });
  });

  it("uses legal wet-weather walking fallback while preserving selected mode evidence", () => {
    const course = rentalCourse({ paths: false });
    const state = live(course);
    state.weather = { daily: { absoluteDay: 0, kind: "rain", temperatureF: 60, windMph: 8, rainInches: .4, severity: .5, theme: "parkland", season: "spring" }, modifiers: { carryMultiplier: 1, dispersionMultiplier: 1, demandMultiplier: 1, paceMultiplier: 1, turfWearMultiplier: 1, turfRecoveryMultiplier: 1, lodgingMultiplier: 1, eventCancellationRisk: 0 } };
    const member = golfer(1, "wet");
    const reservation = reserveGroupMobility(state, course, [member]);
    expect(reservation.selection.mode).not.toBe("riding_cart");
    expect(member.segments.filter((segment) => segment.kind === "walk").every((segment) => segment.mobility?.resolvedMode === "walk")).toBe(true);
    expect(member.mobilityWalkingFallbackMinutes).toBeGreaterThan(0);
  });

  it("restores an active rental, reapplies edited geometry without charging, and releases/settles fleet once", () => {
    const course = rentalCourse();
    const state = live(course); const members = [golfer(1, "g-1"), golfer(2, "g-1")];
    state.golfers = members;
    const reservation = reserveGroupMobility(state, course, members);
    const transactionIds = state.m51!.transactions.map((transaction) => transaction.id);
    const restored = restoreLiveSimulation(snapshotLiveSimulation({ state, pendingCash: reservation.cashDelta, speed: "paused", selectedGolferId: 1 }))!;
    expect(restored.state.m51?.assignments[0]).toMatchObject({ status: "active", fleetUnitIds: ["cart-1"] });
    expect(mobilityRenderUnits(course, liveRenderData(restored.state)).filter((unit) => unit.id === "cart-1")).toEqual([
      expect.objectContaining({ state: "riding_cart", riderIds: [1, 2] }),
    ]);

    course.tiles[8 * course.width + 20] = "water";
    members[0].segments = [{ kind: "walk", from: { x: 2, y: 8 }, to: { x: 56, y: 8 }, holeIndex: 0, dur: 180 }];
    reapplyGroupMobility(state, course, members[0]);
    expect(state.m51!.transactions.map((transaction) => transaction.id)).toEqual(transactionIds);
    expect(members[0].mobilityMode).toBe("riding_cart");

    members.forEach((member) => { member.finished = true; member.scoredHoles = 1; });
    const moodBeforeReturn = members[0].mood;
    state.golfers = [];
    releaseFinishedMobilityGroups(state, members);
    expect(state.m51?.assignments[0]).toMatchObject({ status: "released" });
    expect(state.m51?.observedEvidence).toHaveLength(1);
    expect(members[0].mood).toBeGreaterThan(moodBeforeReturn);
    const settled = settleMobilityFleet(course, state.m51);
    const repeated = settleMobilityFleet(settled, state.m51);
    expect(normalizeM51CourseMobilityState(settled.m51, settled).fleet["cart-1"].uses).toBe(1);
    expect(repeated.m51).toEqual(settled.m51);
  });

  it("returns fleet after daylight/abandonment and releases every assignment before day rollover", () => {
    const course = rentalCourse({ carts: 1, pushcarts: 2 });
    const interrupted = live(course); const members = [golfer(1, "interrupted"), golfer(2, "interrupted")];
    reserveGroupMobility(interrupted, course, members);
    members[0].completionStatus = "daylight"; members[1].completionStatus = "congestion_abandonment";
    members.forEach((member) => { member.finished = true; });
    interrupted.golfers = [];
    releaseFinishedMobilityGroups(interrupted, members);
    expect(interrupted.m51?.assignments[0].status).toBe("released");
    expect(interrupted.m51?.observedEvidence[0].completed).toBe(false);

    const fullDay = createLiveState(course, { ...DEFAULT_WORLD, runSeed: 8181 }, 0);
    let guard = 0;
    while (!fullDay.dayOver && guard++ < 2_000) stepLive(fullDay, course, 1);
    expect(fullDay.dayOver).toBe(true);
    expect(fullDay.m51?.assignments.length).toBeGreaterThan(0);
    expect(fullDay.m51?.assignments.every((assignment) => assignment.status === "released")).toBe(true);
    expect(new Set(fullDay.m51?.transactions.map((transaction) => transaction.id)).size).toBe(fullDay.m51?.transactions.length);
  });

  it("reuses core revenue once and adds product operating cost once at commit", () => {
    const course = rentalCourse({ carts: 1, pushcarts: 2 });
    const state = live(course); const members = [golfer(1, "g-1"), golfer(2, "g-1")];
    const reservation = reserveGroupMobility(state, course, members);
    members.forEach((member) => { member.finished = true; member.scoredHoles = 1; });
    state.golfers = []; releaseFinishedMobilityGroups(state, members);
    const reactions = { rounds: 2, avgSatisfaction: 70, promoters: 0, detractors: 0, willReturnRate: .5 };
    const common = {
      course, world: { ...DEFAULT_WORLD, cash: 10_040 }, revenue: 40, greenFees: 0,
      concessionRevenue: 40, concessionByType: { cart_rental: 40 } as const,
      transactions: reservation.concessionTransactions, reactions, dayIndex: 0,
    };
    const baseline = commitDay(common);
    const mobility = commitDay({ ...common, mobility: state.m51 });
    expect(mobility.result.revenue).toBe(baseline.result.revenue);
    expect(mobility.result.costs - baseline.result.costs).toBe(8);
    expect(baseline.world.cash - mobility.world.cash).toBe(8);
    expect(mobility.result.m51).toMatchObject({ grossRevenue: 40, operatingCosts: 8, netRevenue: 32 });
    expect(mobility.result.revenueBreakdown.byConcession.cart_rental).toBe(40);
    expect(mobility.result.revenueBreakdown.transactions).toHaveLength(2);
  });

  it("settles product cents, costs, stockouts, bounded daily history, and weekly reports without touching cash", () => {
    const course = rentalCourse({ carts: 1, pushcarts: 2 });
    const state = live(course); const members = [golfer(1, "g-1"), golfer(2, "g-1")];
    reserveGroupMobility(state, course, members);
    members.forEach((member) => { member.finished = true; member.scoredHoles = 1; });
    state.golfers = []; releaseFinishedMobilityGroups(state, members);
    let world = { ...DEFAULT_WORLD, cash: 12_345 };
    for (let day = 0; day < 35; day++) {
      const dayLive = structuredClone(state.m51!);
      dayLive.transactions = dayLive.transactions.map((transaction) => ({ ...transaction, id: `${transaction.id}:${day}` }));
      dayLive.assignments = dayLive.assignments.map((assignment) => ({ ...assignment, id: `${assignment.id}:${day}` }));
      dayLive.observedEvidence = dayLive.observedEvidence.map((evidence) => ({ ...evidence, id: `${evidence.id}:${day}` }));
      world = settleM51MobilityDay(world, { live: dayLive, week: 1 + Math.floor(day / 7), dayIndex: day % 7 });
    }
    expect(world.cash).toBe(12_345);
    expect(world.m51?.history.dailyLedgers).toHaveLength(28);
    expect(world.m51?.history.weeklyReports.at(-1)).toMatchObject({ week: 5, days: 7, grossRevenue: 280, operatingCosts: 56, netRevenue: 224 });
    expect(world.m51?.history.weeklyReports.at(-1)?.products).toHaveLength(1);
    expect(world.m51?.history.dailyLedgers.at(-1)?.products[0]).toMatchObject({ golfers: 2, utilizedUnits: 1, grossRevenue: 40, operatingCosts: 8, netRevenue: 32, returns: 1 });
  });
});


describe("continuous paths preserve logical rental legs", () => {
  it("matches old multi-corner cart costs after dense walking adaptation, maps, and a fresh restored replan", () => {
    const active = rentalCourse();
    const from = { x: 8, y: 4 }, to = { x: 56, y: 8 };
    for (let y = 5; y <= 8; y++) for (let x = 9; x < 56; x++) active.tiles[y * active.width + x] = "water";
    const feature = corridorFeature(active, "path", [{ x: 8.5, y: 4.25 }, { x: 24.5, y: 4.1 }, { x: 40.5, y: 4.4 }, { x: 56.5, y: 4.25 }], 1);
    feature.coverage = active.tiles.flatMap((terrain, index) => terrain === "path" ? [index] : []);
    active.surfaceIntent = { version: 1, nextId: 2, features: [feature] };
    const member = () => golfer(1, "logical-leg");
    const build = (adapted: boolean) => {
      const builder = new TimedItineraryBuilder({ course: active, cursor: from, personality: member().personality, rng: () => .5,
        route: adapted ? createPathWalkingRouter(active, new Map()) : (a, b) => findWalkPath(active, a, b) });
      builder.appendWalk(from, to, 0);
      return builder.segments.map(segment => ({ ...segment, holeId: "hole-1", dur: segment.dur * 1.25 }));
    };
    const baseline = member(), adapted = member(); baseline.pos = adapted.pos = from;
    baseline.segments = build(false); adapted.segments = build(true);
    expect(baseline.segments).toHaveLength(2); expect(adapted.segments.length).toBeGreaterThan(100);
    expect(adapted.segments.every(segment => getOriginalWalkPlan(segment) === getOriginalWalkPlan(adapted.segments[0]))).toBe(true);
    const baselineState = live(active), adaptedState = live(active);
    baselineState.golfers = [baseline]; adaptedState.golfers = [adapted];
    const before = reserveGroupMobility(baselineState, active, [baseline]);
    const after = reserveGroupMobility(adaptedState, active, [adapted]);
    expect(after.selection.mode).toBe("riding_cart"); expect(after.cashDelta).toBe(before.cashDelta);
    expect(after.concessionTransactions).toEqual(before.concessionTransactions);
    expect(after.assignment.actualTravelMinutes).toBeCloseTo(before.assignment.actualTravelMinutes, 12);
    expect(after.assignment.walkingFallbackMinutes).toBeCloseTo(before.assignment.walkingFallbackMinutes, 12);
    expect(after.assignment.offPathTiles).toBe(before.assignment.offPathTiles);
    expect(adapted.mobilityActualTravelMinutes).toBeCloseTo(baseline.mobilityActualTravelMinutes!, 12);
    expect(adapted.segments.filter(segment => segment.kind === "pause")).toHaveLength(1);
    expect(adapted.segments.filter(segment => segment.kind === "walk").some(segment => segment.to.y === 3.75)).toBe(true);

    const snapshot = snapshotLiveSimulation({ state: adaptedState, pendingCash: after.cashDelta, speed: "paused", selectedGolferId: 1 });
    const restored = restoreLiveSimulation(snapshot)!; expect(restored).not.toBeNull();
    const restoredMember = restored.state.golfers[0];
    expect(restoredMember.segments.every(segment => getOriginalWalkPlan(segment) === undefined)).toBe(true);
    const transactionIds = restored.state.m51!.transactions.map(transaction => transaction.id);
    // Editing/replanning rebuilds fresh transient authority; the save schema
    // and restored ordinary segment behavior remain unchanged.
    restoredMember.segments = build(true);
    reapplyGroupMobility(restored.state, active, restoredMember);
    expect(restoredMember.mobilityActualTravelMinutes).toBeCloseTo(baseline.mobilityActualTravelMinutes!, 12);
    expect(restored.state.m51!.transactions.map(transaction => transaction.id)).toEqual(transactionIds);
    expect(restoredMember.segments.filter(segment => segment.kind === "pause")).toHaveLength(0);
  });
});


// Separate M4-P proof: the accepted M3 component tests do not certify this
// downstream logical-leg -> per-corner rental application boundary.
describe("M4-P live rental whole-logical-leg saved S proof", () => {
  afterEach(() => vi.restoreAllMocks());
  let sharedPlan: ReturnType<typeof buildContinuousPathPlan> | undefined;
  it.each([
    { mode: "walk", reverse: false }, { mode: "pushcart", reverse: false },
    { mode: "riding_cart", reverse: false }, { mode: "riding_cart", reverse: true },
  ] as const)("preserves $mode economics and interior G alignment, reverse=$reverse", ({ mode, reverse }) => {
    const active = rentalCourse({ enabled: mode !== "walk" }), shared = authoredPathFixture(), offset = { x: 12, y: 6 };
    active.tiles.fill("water");
    active.surfaceIntent = translateSurfaceIntent(shared.surfaceIntent, shared.width, shared.height, active.width, active.height, offset);
    const feature = active.surfaceIntent!.features[0], originalFeature = shared.surfaceIntent!.features[0];
    if (feature.geometry.kind !== "corridor" || originalFeature.geometry.kind !== "corridor") throw new Error("saved S fixture must remain authored corridor");
    expect(feature.geometry.width).toBe(1.5);
    expect(feature.geometry.knots).toEqual(originalFeature.geometry.knots.map(p => ({ x: p.x + offset.x, y: p.y + offset.y })));
    expect(feature.coverage.length).toBe(originalFeature.coverage.length);
    for (const cell of feature.coverage) active.tiles[cell] = "path";
    expect(active.tiles.every(tile => tile === "water" || tile === "path")).toBe(true);
    const ends = [{ x: 2 + offset.x, y: 3 + offset.y }, { x: 13 + offset.x, y: 5 + offset.y }];
    const [from, to] = reverse ? ends.reverse() : ends;
    if (mode === "pushcart") active.m51!.cartRentals.rental.products.riding_cart.enabled = false;
    active.holes = [{ ...active.holes[0], tee: from, green: to }];
    // One explicit plan reused for all proof phases. The two true logical-leg
    // endpoints already lie on G, so there are no exempt off-G connectors.
    const plan = sharedPlan ??= buildContinuousPathPlan(active);
    const centreline = plan.edges.flatMap(edge => edge.points.slice(1).map((b, i) => ({ a: edge.points[i], b })));
    expect(plan.edges).toHaveLength(1); expect(plan.edges[0].source).toBe("intent");
    const nearest = (p: Point) => Math.min(...centreline.map(({ a, b }) => {
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
    }));
    expect(nearest({ x: from.x + .5, y: from.y + .5 })).toBeLessThan(1e-8);
    expect(nearest({ x: to.x + .5, y: to.y + .5 })).toBeLessThan(1e-8);
    const defects = (segments: Golfer["segments"]) => segments.flatMap((segment, segmentIndex) => {
      if (segment.kind !== "walk") return [];
      const a = { x: segment.from.x + .5, y: segment.from.y + .5 }, b = { x: segment.to.x + .5, y: segment.to.y + .5 };
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy), denominator = dx * dx + dy * dy;
      if (length < 1e-10) return [];
      const intervals: [number, number][] = [], cuts = [0, 1];
      // Exact collinear interval union proves every positive segment portion
      // lies on G; isolated crossings cannot masquerade as a continuous arc.
      for (const line of centreline) {
        if ([line.a, line.b].some(p => Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) / length > 1e-7)) continue;
        const values = [line.a, line.b].map(p => ((p.x - a.x) * dx + (p.y - a.y) * dy) / denominator);
        const lo = Math.max(0, Math.min(...values)), hi = Math.min(1, Math.max(...values));
        if (hi > lo + 1e-10) { intervals.push([lo, hi]); cuts.push(lo, hi); }
      }
      // Partition at every final triangle edge too. Footprint membership is
      // constant on each open partition, including intermediate old corners.
      for (const layer of plan.layers) for (let i = 0; i < layer.indices.length; i += 3) {
        const tri = layer.indices.slice(i, i + 3), p = layer.positions;
        for (let side = 0; side < 3; side++) {
          const u = tri[side] * 2, v = tri[(side + 1) % 3] * 2;
          const ex = p[v] - p[u], ey = p[v + 1] - p[u + 1], cross = dx * ey - dy * ex;
          if (Math.abs(cross) < 1e-12) continue;
          const t = ((p[u] - a.x) * ey - (p[u + 1] - a.y) * ex) / cross;
          const q = ((p[u] - a.x) * dy - (p[u + 1] - a.y) * dx) / cross;
          if (t > 0 && t < 1 && q >= -1e-9 && q <= 1 + 1e-9) cuts.push(t);
        }
      }
      cuts.sort((x, y) => x - y);
      for (let i = 1; i < cuts.length; i++) {
        if (cuts[i] - cuts[i - 1] <= 1e-9) continue;
        const t = (cuts[i - 1] + cuts[i]) / 2, world = { x: a.x + dx * t, y: a.y + dy * t };
        const onCentreline = intervals.some(([lo, hi]) => t >= lo - 1e-9 && t <= hi + 1e-9), footprint = classifyContinuousPathPoint(plan, world);
        if (!onCentreline || footprint === null) return [{ segmentIndex, from: segment.from, to: segment.to, t, world,
          legacy: { x: world.x - .5, y: world.y - .5 }, distanceToG: nearest(world), footprint, onCentreline, mobility: segment.mobility }];
      }
      return [];
    });
    const makeMember = () => { const value = golfer(1, "saved-S-logical-leg"); value.pos = { ...from }; return value; };
    const build = (adapted: boolean) => {
      const builder = new TimedItineraryBuilder({ course: active, cursor: from, personality: makeMember().personality, rng: () => .5,
        route: adapted ? createPathWalkingRouter(active, new Map()) : (a, b) => findWalkPath(active, a, b) });
      builder.appendWalk(from, to, 0);
      return builder.segments.map(segment => ({ ...segment, holeId: "hole-1" }));
    };
    const baseline = makeMember(), adapted = makeMember(); baseline.segments = build(false); adapted.segments = build(true);
    expect(baseline.segments.length).toBeGreaterThan(2);
    expect(adapted.segments.length).toBeGreaterThan(baseline.segments.length);
    expect(adapted.segments.every(s => getOriginalWalkPlan(s) === getOriginalWalkPlan(adapted.segments[0]))).toBe(true);
    expect(getOriginalWalkPlan(adapted.segments[0])).toBeDefined();
    expect(defects(adapted.segments), "whole logical walking leg must be on G before rental application").toEqual([]);
    const oldState = live(active), newState = live(active); oldState.weather = newState.weather = undefined;
    oldState.golfers = [baseline]; newState.golfers = [adapted];
    const originalCorners = baseline.segments.map(segment => ({ from: { ...segment.from }, to: { ...segment.to } }));
    let phase = "baseline";
    const actualRoute = observedRouter.planTimedMobilityLeg, actualAdapter = observedAdapter.adaptPathMovementRoute;
    const routeCalls: { phase: string; request: { from: Point; to: Point; mode: string }; value: ReturnType<typeof actualRoute>; snapshot: string }[] = [];
    const adapterCalls: { phase: string; from: Point; to: Point; cells: Point[]; result: ReturnType<typeof actualAdapter> }[] = [];
    vi.spyOn(observedRouter, "planTimedMobilityLeg").mockImplementation((request, cache) => {
      const value = actualRoute(request, cache);
      routeCalls.push({ phase, request: { from: { ...request.from }, to: { ...request.to }, mode: request.mode }, value, snapshot: JSON.stringify(value) });
      return value;
    });
    vi.spyOn(observedAdapter, "adaptPathMovementRoute").mockImplementation(options => {
      const result = actualAdapter(options);
      adapterCalls.push({ phase, from: { ...options.from }, to: { ...options.to }, cells: options.cells.map(p => ({ ...p })), result });
      return result;
    });
    const before = reserveGroupMobility(oldState, active, [baseline]); phase = "reserve";
    const after = reserveGroupMobility(newState, active, [adapted]);
    const fee = mode === "walk" ? 0 : mode === "pushcart" ? 9 : 20;
    expect(before.selection).toMatchObject({ mode, status: "confirmed", perGolferFee: fee });
    expect(after.selection).toMatchObject({ mode, status: "confirmed", perGolferFee: fee });
    expect(after.assignment.fleetUnitIds).toEqual(mode === "walk" ? [] : [mode === "pushcart" ? "push-1" : "cart-1"]);
    expect(adapted.mobilityMode).toBe(mode);
    expect(after.cashDelta).toBe(before.cashDelta); expect(after.cashDelta).toBe(fee);
    expect(after.concessionTransactions).toEqual(before.concessionTransactions);
    const economics = () => ({ actual: adapted.mobilityActualTravelMinutes, oldActual: baseline.mobilityActualTravelMinutes,
      fallback: adapted.mobilityWalkingFallbackMinutes, oldFallback: baseline.mobilityWalkingFallbackMinutes,
      offpath: adapted.mobilityOffPathTiles, oldOffpath: baseline.mobilityOffPathTiles });
    const assertEconomics = () => {
      if (mode === "walk") expect(adapted.mobilityActualTravelMinutes).toBeCloseTo(baseline.mobilityActualTravelMinutes!, 12);
      else expect(adapted.mobilityActualTravelMinutes).toBe(baseline.mobilityActualTravelMinutes);
      expect(adapted.mobilityWalkingFallbackMinutes).toBe(baseline.mobilityWalkingFallbackMinutes);
      expect(adapted.mobilityOffPathTiles).toBe(baseline.mobilityOffPathTiles);
      if (mode === "walk") expect(after.assignment.actualTravelMinutes).toBeCloseTo(before.assignment.actualTravelMinutes, 12);
      else expect(after.assignment.actualTravelMinutes).toBe(before.assignment.actualTravelMinutes);
      expect(after.assignment.walkingFallbackMinutes).toBe(before.assignment.walkingFallbackMinutes);
      expect(after.assignment.offPathTiles).toBe(before.assignment.offPathTiles);
      expect(adapted.wallet).toBe(baseline.wallet); expect(adapted.spent).toBe(baseline.spent);
    };
    assertEconomics();
    const reserveRoutes = routeCalls.filter(call => call.phase === "reserve");
    const expectedCells: Point[] = [];
    for (const call of reserveRoutes) call.value!.cells.forEach((cell, index) => {
      const previous = expectedCells.at(-1);
      if (!index && previous && previous.x === cell.x && previous.y === cell.y) return;
      expectedCells.push({ ...cell });
    });
    const combined = adapterCalls.filter(call => call.phase === "reserve" && call.from.x === from.x && call.from.y === from.y && call.to.x === to.x && call.to.y === to.y);
    console.info("M4 consumedS gate", JSON.stringify({ originalCorners, requests: reserveRoutes.map(call => call.request),
      cornerEvidence: reserveRoutes.map(call => call.value && ({ cells: call.value.cells, cost: call.value.cost, minutes: call.value.minutes, expansions: call.value.expansions, resolvedMode: call.value.resolvedMode, fallback: call.value.fallback })),
      expectedCells, combined: combined.map(call => ({ cells: call.cells, alignment: { ...call.result, waypoints: undefined } })) }));
    if (mode === "walk") { expect(reserveRoutes).toEqual([]); expect(combined).toEqual([]); }
    else {
      expect(reserveRoutes.map(call => ({ from: call.request.from, to: call.request.to }))).toEqual(originalCorners);
      expect(combined).toHaveLength(1); expect(combined[0].cells).toEqual(expectedCells);
      expect(combined[0].result, JSON.stringify(combined[0].result)).toMatchObject({ alignedRuns: 1, fallbackRuns: 0 });
      expect(defects(adapted.segments)).toEqual([]);
      const walks = adapted.segments.filter(segment => segment.kind === "walk"), descriptor = getOriginalWalkPlan(walks[0])!;
      expect(walks.every(segment => getOriginalWalkPlan(segment) === descriptor)).toBe(true);
      expect(descriptor.segments.map(segment => ({ from: segment.from, to: segment.to }))).toEqual(originalCorners);
      expect(descriptor.segments.map(segment => segment.dur)).toEqual(reserveRoutes.map(call => Math.max(.01, call.value!.minutes)));
      expect(JSON.stringify(walks)).not.toContain("original-walk-plan");
      for (let repeat = 0; repeat < 2; repeat++) {
        phase = `baseline-repeat-${repeat}`; reapplyGroupMobility(oldState, active, baseline);
        phase = `repeat-${repeat}`; reapplyGroupMobility(newState, active, adapted);
        assertEconomics(); expect(defects(adapted.segments)).toEqual([]);
        expect(routeCalls.filter(call => call.phase === phase).map(call => ({ from: call.request.from, to: call.request.to }))).toEqual(originalCorners);
        expect(getOriginalWalkPlan(adapted.segments.find(segment => segment.kind === "walk")!)!.segments.map(segment => segment.dur)).toEqual(reserveRoutes.map(call => Math.max(.01, call.value!.minutes)));
      }
    }
    expect(routeCalls.every(call => JSON.stringify(call.value) === call.snapshot)).toBe(true);
    expect(adapted.segments.filter(s => s.kind === "walk").every(s => s.mobility?.resolvedMode === mode)).toBe(true);
    const reservedEconomics = economics(), reservedDefects = defects(adapted.segments);
    const transactions = newState.m51!.transactions.map(t => t.id), wallet = adapted.wallet;
    baseline.segments = build(false); adapted.segments = build(true);
    phase = "baseline-fresh-reapply"; reapplyGroupMobility(oldState, active, baseline);
    phase = "fresh-reapply"; reapplyGroupMobility(newState, active, adapted);
    assertEconomics();
    expect(newState.m51!.transactions.map(t => t.id)).toEqual(transactions); expect(adapted.wallet).toBe(wallet);
    expect(adapted.segments.filter(s => s.kind === "pause")).toHaveLength(0);
    const reappliedDefects = defects(adapted.segments);
    const evidence = { translatedSharedS: offset, trueWholeEndpoints: { from, to }, selectedMode: after.selection.mode, cashDelta: after.cashDelta,
      transactions: transactions.length, reservedEconomics, reappliedEconomics: economics(),
      reservedDefectCount: reservedDefects.length, firstReservedDefect: reservedDefects[0],
      reappliedDefectCount: reappliedDefects.length, firstReappliedDefect: reappliedDefects[0] };
    const restored = restoreLiveSimulation(snapshotLiveSimulation({ state: newState, pendingCash: after.cashDelta, speed: "paused", selectedGolferId: 1 }))!;
    const restoredMember = restored.state.golfers[0];
    expect(restoredMember.segments.every(segment => getOriginalWalkPlan(segment) === undefined)).toBe(true);
    restoredMember.segments = build(true); phase = "restored-fresh-reapply";
    reapplyGroupMobility(restored.state, active, restoredMember);
    expect(defects(restoredMember.segments)).toEqual([]);
    expect(restored.state.m51!.transactions.map(t => t.id)).toEqual(transactions);
    expect(routeCalls.every(call => JSON.stringify(call.value) === call.snapshot)).toBe(true);
    const receiptRuntime = (globalThis as unknown as { process?: { env: Record<string, string | undefined>; stderr: { write(text: string): void } } }).process;
    if (receiptRuntime?.env.M4_RECEIPTS) receiptRuntime.stderr.write("M4-RECEIPT " + JSON.stringify({ mode, reverse, evidence, originalCorners,
      routeCalls: routeCalls.map(call => ({ phase: call.phase, request: call.request, value: JSON.parse(call.snapshot) })),
      adapterCalls: adapterCalls.map(call => ({ ...call, result: { ...call.result, waypoints: undefined } })) }) + "\n");
    console.info("M4-P evidence", JSON.stringify(evidence));
    expect({ reservedDefects, reappliedDefects }, JSON.stringify(evidence)).toEqual({ reservedDefects: [], reappliedDefects: [] });
  });
});


function completeCornerGroup(sources: Segment[]): Segment[] {
  const plan = { from: { ...sources[0].from }, to: { ...sources.at(-1)!.to }, segments: sources.map(s => ({ ...s, from: { ...s.from }, to: { ...s.to } })) };
  return sources.map(s => attachOriginalWalkPlan({ ...s, from: { ...s.from }, to: { ...s.to } }, plan));
}
function cornerChain(xs: number[], y = 8, durations?: number[]): Segment[] {
  return xs.slice(1).map((x, i) => ({ kind: "walk", from: { x: xs[i], y }, to: { x, y }, dur: durations?.[i] ?? 1, holeIndex: 0, holeId: "hole-1" }));
}

describe("M4 original-corner composition boundaries", () => {
  afterEach(() => vi.restoreAllMocks());
  it("retains real cart -> protected-surface walking fallback -> cart boundaries and distinct predicates", () => {
    const active = rentalCourse(), sources = cornerChain([8, 12, 16, 20, 24]); active.tiles[8 * 60 + 16] = "green";
    const baseline = golfer(1, "mixed"), member = golfer(1, "mixed");
    baseline.segments = sources.map(s => ({ ...s })); member.segments = completeCornerGroup(sources);
    const oldState = live(active), state = live(active); oldState.weather = state.weather = undefined; oldState.golfers = [baseline]; state.golfers = [member];
    reserveGroupMobility(oldState, active, [baseline]);
    const route = vi.spyOn(observedRouter, "planTimedMobilityLeg"), adapter = vi.spyOn(observedAdapter, "adaptPathMovementRoute");
    const result = reserveGroupMobility(state, active, [member]); expect(result.selection.mode).toBe("riding_cart");
    expect(route.mock.results.map(r => r.value?.resolvedMode)).toEqual(["riding_cart", "walk", "walk", "riding_cart"]);
    const composed = adapter.mock.calls.slice(sources.length).map(([input]) => input);
    expect(composed.map(input => [input.from.x, input.to.x])).toEqual([[8, 12], [12, 20], [20, 24]]);
    expect(composed.map(input => typeof input.canStep)).toEqual(["function", "undefined", "function"]);
    const descriptor = getOriginalWalkPlan(member.segments.find(s => s.kind === "walk")!)!;
    expect(descriptor.segments.map(s => s.mobility!.resolvedMode)).toEqual(["riding_cart", "walk", "walk", "riding_cart"]);
    expect(member.mobilityActualTravelMinutes).toBe(baseline.mobilityActualTravelMinutes);
    expect(member.mobilityWalkingFallbackMinutes).toBe(baseline.mobilityWalkingFallbackMinutes);
    expect(member.mobilityOffPathTiles).toBe(baseline.mobilityOffPathTiles);
    for (const x of [12, 20]) expect(member.segments.some(s => s.to.x === x && s.to.y === 8)).toBe(true);
  });

  it.each(["head", "tail", "start", "pause", "flight", "concession", "holeIndex", "holeId"] as const)("does not recover a missing/semantic group across %s", barrier => {
    const active = rentalCourse(), originals = cornerChain([8, 12, 16]);
    const plan = { from: originals[0].from, to: originals[1].to, segments: originals };
    let chunks = cornerChain([8, 10, 12, 14, 16]).map(s => attachOriginalWalkPlan(s, plan));
    if (barrier === "head") chunks = chunks.slice(1);
    if (barrier === "tail") chunks = chunks.slice(0, -1);
    if (barrier === "start") chunks[0] = { ...chunks[0], from: { x: 9, y: 8 } };
    if (barrier === "pause" || barrier === "flight") chunks.splice(2, 0, { kind: barrier, from: { x: 12, y: 8 }, to: { x: 12, y: 8 }, holeIndex: 0, dur: .2 });
    if (barrier === "concession") chunks[1] = { ...chunks[1], concession: { buildingType: "snack_bar", buildingX: 20, buildingY: 2, item: "Snack", amount: 1 } };
    if (barrier === "holeIndex") chunks[1] = { ...chunks[1], holeIndex: 1 };
    if (barrier === "holeId") chunks[1] = { ...chunks[1], holeId: "different" };
    const expected = chunks.filter(s => s.kind === "walk").map(s => ({ from: s.from, to: s.to }));
    const member = golfer(1, `barrier-${barrier}`); member.segments = chunks;
    const state = live(active); state.weather = undefined;
    const route = vi.spyOn(observedRouter, "planTimedMobilityLeg"), adapter = vi.spyOn(observedAdapter, "adaptPathMovementRoute");
    reserveGroupMobility(state, active, [member]);
    expect(route.mock.calls.map(([request]) => ({ from: request.from, to: request.to }))).toEqual(expected);
    expect(adapter.mock.calls).toHaveLength(expected.length); // no combined group pass
  });

  it("keeps touching coordinate-equal but distinct descriptors separate", () => {
    const active = rentalCourse(), member = golfer(1, "two-identities");
    member.segments = [...completeCornerGroup(cornerChain([8, 10, 12])), ...completeCornerGroup(cornerChain([12, 14, 16]))];
    const state = live(active); state.weather = undefined;
    const adapter = vi.spyOn(observedAdapter, "adaptPathMovementRoute"); reserveGroupMobility(state, active, [member]);
    const calls = adapter.mock.calls.map(([input]) => [input.from.x, input.to.x]);
    expect(calls).toEqual([[8, 10], [10, 12], [8, 12], [12, 14], [14, 16], [12, 16]]);
    const descriptors = [...new Set(member.segments.filter(s => s.kind === "walk").map(getOriginalWalkPlan))];
    expect(descriptors).toHaveLength(2); expect(descriptors.map(d => [d!.from.x, d!.to.x])).toEqual([[8, 12], [12, 16]]);
  });

  it("preserves every real nonadjacent revisit and exact old chunks when M3 rejects the backtrack", () => {
    const active = rentalCourse(), sources = cornerChain([8, 12, 8], 4), baseline = golfer(1, "revisit"), member = golfer(1, "revisit");
    baseline.segments = sources.map(s => ({ ...s })); member.segments = completeCornerGroup(sources);
    const oldState = live(active), state = live(active); oldState.weather = state.weather = undefined;
    reserveGroupMobility(oldState, active, [baseline]);
    const route = vi.spyOn(observedRouter, "planTimedMobilityLeg"), adapter = vi.spyOn(observedAdapter, "adaptPathMovementRoute");
    reserveGroupMobility(state, active, [member]);
    expect(route.mock.calls).toHaveLength(2);
    const combined = adapter.mock.calls.at(-1)![0]; expect(combined.cells.map(p => p.x)).toEqual([8, 9, 10, 11, 12, 11, 10, 9, 8]);
    expect(adapter.mock.results.at(-1)!.value).toMatchObject({ alignedRuns: 0, fallbackRuns: 1 });
    expect(JSON.parse(JSON.stringify(member.segments))).toEqual(JSON.parse(JSON.stringify(baseline.segments)));
    expect(member.mobilityActualTravelMinutes).toBe(baseline.mobilityActualTravelMinutes);
    const walks = member.segments.filter(s => s.kind === "walk"), descriptor = getOriginalWalkPlan(walks[0])!;
    expect(walks.every(s => getOriginalWalkPlan(s) === descriptor)).toBe(true);
    expect(descriptor.segments.map(s => [s.from.x, s.to.x])).toEqual([[8, 12], [12, 8]]);
  });
});

describe("M4 isolated economic-block allocation policy", () => {
  afterEach(() => vi.restoreAllMocks());
  it.each(["null", "short"] as const)("retains unequal/clamped/offpath budgets and opaque %s source over repeated reapply", opaque => {
    // Controlled returned records isolate accounting/partition policy only;
    // actual routing and G geometry are certified by the real S tests above.
    const active = rentalCourse(), member = golfer(1, `budgets-${opaque}`), sources = cornerChain([8, 9, 10, 11, 12, 13], 8, [1, 3, 2, 4, 5]);
    member.segments = completeCornerGroup(sources); member.pos = { x: 8, y: 8 };
    const state = live(active); state.weather = undefined; state.golfers = [member];
    const rawMinutes = [.002, .006, .035, 0, .07], expectedBudgets = [.01, .01, .035, 4, .07];
    vi.spyOn(observedRouter, "planTimedMobilityLeg").mockImplementation(request => {
      const i = request.from.x - 8;
      if (i === 3 && opaque === "null") return null;
      return { requestedMode: request.mode, resolvedMode: request.mode, cacheKey: `controlled-${i}`,
        cells: i === 3 ? [{ ...request.from }] : [{ ...request.from }, { ...request.to }],
        waypoints: [{ ...request.to }], cost: rawMinutes[i], minutes: rawMinutes[i], expansions: 2, fallback: null };
    });
    const adapter = vi.spyOn(observedAdapter, "adaptPathMovementRoute").mockImplementation(options => ({
      alignedRuns: 1, fallbackRuns: 0, reasons: [], presentationClearanceCells: [], waypoints: [
        { x: options.from.x + .2, y: options.from.y + .15 }, { x: options.from.x + .55, y: options.from.y - .1 }, { ...options.to },
      ],
    }));
    const reservation = reserveGroupMobility(state, active, [member]); expect(reservation.selection.mode).toBe("riding_cart");
    expect(adapter.mock.calls.map(([input]) => [input.from.x, input.to.x])).toEqual([[8, 11], [12, 13]]);
    const expectedTotal = expectedBudgets.reduce((sum, value) => sum + value, 0);
    let expectedSaved = sources.map((source, i) => i === 3 ? 0 : source.dur - expectedBudgets[i]);
    const verify = () => {
      expect(member.mobilityActualTravelMinutes).toBe(expectedTotal); expect(member.mobilityWalkingFallbackMinutes).toBe(4); expect(member.mobilityOffPathTiles).toBe(8);
      const walks = member.segments.filter(s => s.kind === "walk"), descriptor = getOriginalWalkPlan(walks[0])!;
      expect(walks.every(s => getOriginalWalkPlan(s) === descriptor)).toBe(true);
      expect(descriptor.segments.map(s => s.dur)).toEqual(expectedBudgets);
      expect(descriptor.segments.map(s => [s.from.x, s.to.x])).toEqual(sources.map(s => [s.from.x, s.to.x]));
      expect(descriptor.segments.map(s => s.mobility!.offPathTiles)).toEqual([2, 2, 2, 0, 2]);
      descriptor.segments.forEach((source, i) => expect(source.mobility!.minutesSaved).toBeCloseTo(expectedSaved[i], 12));
      let cursor = 0;
      for (let i = 0; i < sources.length; i++) {
        const block: Segment[] = []; let duration = 0;
        do { const chunk = walks[cursor++]; expect(chunk).toBeDefined(); block.push(chunk); duration += chunk.dur; } while (duration < expectedBudgets[i] - 1e-10);
        expect(duration).toBeCloseTo(expectedBudgets[i], 12);
        if (i === 3) { expect(block).toHaveLength(1); expect(block[0]).toMatchObject({ from: sources[i].from, to: sources[i].to, dur: 4, mobility: { resolvedMode: "walk", minutesSaved: 0, offPathTiles: 0 } }); continue; }
        const distances = block.map(s => Math.max(.0001, Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y))), total = distances.reduce((sum, value) => sum + value, 0);
        block.forEach((chunk, j) => {
          expect(chunk.dur).toBeCloseTo(expectedBudgets[i] * distances[j] / total, 12);
          expect(chunk.mobility!.minutesSaved).toBeCloseTo(expectedSaved[i] * distances[j] / total, 12);
          expect(chunk.mobility!.offPathTiles).toBe(Math.round(2 * distances[j] / total));
        });
      }
      expect(cursor).toBe(walks.length);
    };
    verify(); const ids = state.m51!.transactions.map(t => t.id), wallet = member.wallet;
    for (let repeat = 0; repeat < 2; repeat++) { expectedSaved = expectedBudgets.map(() => 0); reapplyGroupMobility(state, active, member); verify(); }
    expect(state.m51!.transactions.map(t => t.id)).toEqual(ids); expect(member.wallet).toBe(wallet);
  });
});


describe("M4 degenerate presentation conservatism", () => {
  afterEach(() => vi.restoreAllMocks());
  it("does not join mismatched actual cell seams or change old rejected chunks", () => {
    const active = rentalCourse(), sources = cornerChain([8, 9, 10]), plain = golfer(1, "mismatch"), member = golfer(1, "mismatch");
    plain.segments = sources; member.segments = completeCornerGroup(sources);
    vi.spyOn(observedRouter, "planTimedMobilityLeg").mockImplementation(request => ({ requestedMode: request.mode, resolvedMode: request.mode,
      cells: request.from.x === 8 ? [{ x: 8, y: 8 }, { x: 9, y: 8 }] : [{ x: 10, y: 8 }, { x: 11, y: 8 }],
      waypoints: [{ ...request.to }], cost: .02, minutes: .02, cacheKey: "mismatch", expansions: 2, fallback: null }));
    const adapter = vi.spyOn(observedAdapter, "adaptPathMovementRoute").mockImplementation(options => ({
      waypoints: options.waypoints.map(p => ({ ...p })), alignedRuns: 0, fallbackRuns: 1, reasons: ["controlled-rejection"], presentationClearanceCells: [],
    }));
    const oldState = live(active), state = live(active); oldState.weather = state.weather = undefined;
    reserveGroupMobility(oldState, active, [plain]); reserveGroupMobility(state, active, [member]);
    expect(adapter.mock.calls.map(([input]) => [input.from.x, input.to.x])).toEqual([[8, 9], [9, 10]]);
    expect(JSON.parse(JSON.stringify(member.segments))).toEqual(JSON.parse(JSON.stringify(plain.segments)));
    expect(member.mobilityActualTravelMinutes).toBe(plain.mobilityActualTravelMinutes);
  });
  it("retains a zero-length old chunk and its clamped budget when composition has no positive geometry", () => {
    const active = rentalCourse(), member = golfer(1, "zero-geometry"), source = cornerChain([8, 8], 8, [2]); member.segments = completeCornerGroup(source);
    vi.spyOn(observedRouter, "planTimedMobilityLeg").mockImplementation(request => ({ requestedMode: request.mode, resolvedMode: request.mode,
      cells: [{ x: 8, y: 8 }, { x: 9, y: 8 }, { x: 8, y: 8 }], waypoints: [{ x: 8, y: 8 }], cost: .005, minutes: .005, cacheKey: "zero", expansions: 3, fallback: null }));
    vi.spyOn(observedAdapter, "adaptPathMovementRoute").mockReturnValue({ waypoints: [{ x: 8, y: 8 }], alignedRuns: 1, fallbackRuns: 0, reasons: [], presentationClearanceCells: [] });
    const state = live(active); state.weather = undefined; reserveGroupMobility(state, active, [member]);
    const walks = member.segments.filter(s => s.kind === "walk");
    expect(walks).toHaveLength(1); expect(walks[0]).toMatchObject({ from: { x: 8, y: 8 }, to: { x: 8, y: 8 }, dur: .01 * .0001 / .0001,
      mobility: { resolvedMode: "riding_cart", minutesSaved: 1.99, offPathTiles: 3 } });
    expect(getOriginalWalkPlan(walks[0])!.segments[0].dur).toBe(.01);
    expect(member.mobilityActualTravelMinutes).toBe(.01);
  });
});
