import { describe, expect, it } from "vitest";
import type { Course, Terrain } from "../models/types";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import type { Golfer, LiveState } from "../live/types";
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
import { mobilityRenderUnits } from "./mobilityRender";

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
    layouts: [{ id: "course-primary", name: "Mobility Links", draftHoleIds: ["hole-1"], publishedHoleIds: ["hole-1"], roundLength: 9, state: "open", greenFee: 65 }],
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
