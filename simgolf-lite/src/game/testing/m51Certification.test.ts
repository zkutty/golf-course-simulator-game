import { describe, expect, it } from "vitest";
import type { Course, Terrain } from "../models/types";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import { buildM49DemandPlan } from "../m49/demand";
import { m49CurrentMobilitySupport } from "../m49/mobility";
import { runM47SaveHashFixture } from "./m47Certification";
import { createRenderPerfLiveState, liveRenderData, stepLive } from "../live/simulation";
import { mobilityRenderUnits } from "../m51/mobilityRender";
import { planTimedMobilityLeg, TimedMobilityLegCache } from "../m51/travelRouter";
import { snapshotLiveSimulation, restoreLiveSimulation } from "../live/persistence";
import { hashCanonicalValue, hashGameState } from "../../utils/stateHash";
import { CURRENT_SAVE_SCHEMA_VERSION, parseSaveText } from "../../utils/save";
import type { M51CourseMobilityState, MobilityAssignment } from "../m51/types";

const SEED = 515_558;

function balanceCourse(mode: "walk" | "pushcart" | "riding_cart"): Course {
  const width = 64; const height = 28;
  const tiles = new Array<Terrain>(width * height).fill("fairway");
  for (let x = 2; x < width - 2; x++) tiles[8 * width + x] = "path";
  const long = mode !== "walk";
  const holes = Array.from({ length: 9 }, (_, index) => ({
    id: `m51-balance-${index + 1}`,
    tee: { x: 5, y: 10 + index },
    green: { x: long ? 56 : 24, y: 10 + index },
    parMode: "MANUAL" as const, parManual: 4 as const, name: `M51 balance ${index + 1}`,
  }));
  const course: Course = {
    ...DEFAULT_COURSE, width, height, tiles, elevations: new Array(width * height).fill(0), holes,
    layouts: [{ id: "course-primary", name: "M51 balance", draftHoleIds: holes.map((hole) => hole.id), publishedHoleIds: holes.map((hole) => hole.id), roundLength: 9, state: "open", greenFee: 65 }],
    activeCourseId: "course-primary", obstacles: [], decorations: [], buildings: [],
    name: `M51 ${mode} balance`, baseGreenFee: 65, condition: .9,
  };
  if (mode === "walk") return course;
  const buildingId = "m51-rental";
  const productId = `${buildingId}:${mode}`;
  return {
    ...course,
    buildings: [{ id: buildingId, type: "cart_rental", x: 2, y: 7, tier: 2, price: mode === "pushcart" ? 8 : 20 }],
    m51: {
      version: 3,
      cartRentals: {
        [buildingId]: {
          buildingId, tier: 2,
          products: {
            pushcart: { id: `${buildingId}:pushcart`, courseId: "course-primary", buildingId, mode: "pushcart", name: "Pushcart", price: 8, enabled: mode === "pushcart" },
            riding_cart: { id: `${buildingId}:riding_cart`, courseId: "course-primary", buildingId, mode: "riding_cart", name: "Riding cart", price: 20, enabled: mode === "riding_cart" },
          },
        },
      },
      fleet: {
        [`${mode}-1`]: { id: `${mode}-1`, courseId: "course-primary", buildingId, productId, mode, seats: mode === "riding_cart" ? 2 : 1, state: "available", condition: 1, uses: 0, wear: 0 },
      },
      settledAssignmentIds: [],
    },
  };
}

function scaleCourse(): Course {
  const width = 220; const height = 140;
  const tiles = new Array<Terrain>(width * height).fill("fairway");
  const holes = Array.from({ length: 36 }, (_, index) => {
    const x = 8 + (index % 6) * 34; const y = 8 + Math.floor(index / 6) * 21;
    for (let pathX = x; pathX <= x + 22; pathX++) tiles[(y + 1) * width + pathX] = "path";
    tiles[y * width + x] = "tee";
    tiles[y * width + x + 22] = "green";
    return { id: `m51-scale-${index + 1}`, tee: { x, y }, green: { x: x + 22, y }, parMode: "MANUAL" as const, parManual: 4 as const, name: `M51 scale ${index + 1}` };
  });
  const buildingId = "m51-scale-rental";
  const fleet: M51CourseMobilityState["fleet"] = {};
  for (let index = 0; index < 50; index++) {
    const id = `scale-cart-${String(index + 1).padStart(2, "0")}`;
    fleet[id] = { id, courseId: "course-primary", buildingId, productId: `${buildingId}:riding_cart`, mode: "riding_cart", seats: 2, state: "available", condition: 1, uses: 0, wear: 0 };
  }
  return {
    ...DEFAULT_COURSE, width, height, tiles, elevations: new Array(width * height).fill(0), holes,
    layouts: [{ id: "course-primary", name: "M51 scale", draftHoleIds: holes.map((hole) => hole.id), publishedHoleIds: holes.map((hole) => hole.id), roundLength: 18, state: "open", greenFee: 70 }],
    activeCourseId: "course-primary", name: "M51 36-hole scale", obstacles: [], decorations: [],
    buildings: [{ id: buildingId, type: "cart_rental", x: 3, y: 3, tier: 3, price: 20 }],
    m51: {
      version: 3,
      cartRentals: { [buildingId]: { buildingId, tier: 3, products: {
        pushcart: { id: `${buildingId}:pushcart`, courseId: "course-primary", buildingId, mode: "pushcart", name: "Pushcart", price: 8, enabled: true },
        riding_cart: { id: `${buildingId}:riding_cart`, courseId: "course-primary", buildingId, mode: "riding_cart", name: "Riding cart", price: 20, enabled: true },
      } } },
      fleet, settledAssignmentIds: [],
    },
  };
}

describe("M51 final machine-only certification", () => {
  it("keeps three fixed-seed mobility strategies viable, deterministic, and non-universal", () => {
    const world = { ...DEFAULT_WORLD, runSeed: SEED };
    const courses = {
      walk: balanceCourse("walk"),
      pushcart: balanceCourse("pushcart"),
      riding_cart: balanceCourse("riding_cart"),
    };
    const first = Object.fromEntries(Object.entries(courses).map(([mode, course]) => [mode, buildM49DemandPlan(course, world)]));
    const second = Object.fromEntries(Object.entries(courses).map(([mode, course]) => [mode, buildM49DemandPlan(course, world)]));
    expect(hashCanonicalValue(first)).toBe(hashCanonicalValue(second));
    expect(Object.values(first).every((plan) => plan.totalIndex > .2)).toBe(true);
    expect(m49CurrentMobilitySupport(courses.pushcart, "casual").score).toBeGreaterThan(m49CurrentMobilitySupport(courses.walk, "casual").score);
    expect(m49CurrentMobilitySupport(courses.riding_cart, "senior").score).toBeGreaterThan(m49CurrentMobilitySupport(courses.pushcart, "senior").score);
    expect(m49CurrentMobilitySupport(courses.walk, "junior").score).toBeGreaterThan(.2);
  });

  it("preserves M47/M49/M50, save/live hashes, and bounded 36-hole/100-golfer route/live/render state", () => {
    const m47 = runM47SaveHashFixture();
    expect(m47.afterHash).toBe(m47.beforeHash);

    const course = scaleCourse();
    const world = { ...DEFAULT_WORLD, runSeed: SEED, cash: 1_000_000 };
    const cache = new TimedMobilityLegCache();
    const routeStarted = performance.now();
    let routeCells = 0;
    for (const hole of course.holes) for (const mode of ["walk", "pushcart", "riding_cart"] as const) {
      const leg = planTimedMobilityLeg({
        course, courseId: "course-primary", layoutId: "course-primary", mode,
        from: { x: hole.tee!.x, y: hole.tee!.y + 1 }, to: { x: hole.green!.x, y: hole.green!.y + 1 },
        allowWalkFallback: false,
      }, cache);
      expect(leg).not.toBeNull();
      expect(leg!.expansions).toBeLessThanOrEqual(18_000);
      routeCells += leg!.cells.length;
    }
    const routeMs = performance.now() - routeStarted;

    const live = createRenderPerfLiveState(course, world);
    const assignments: MobilityAssignment[] = Array.from({ length: 50 }, (_, index) => ({
      id: `scale-assignment-${index}`, groupId: `scale-group-${index}`, courseId: "course-primary",
      selectionId: `scale-selection-${index}`, mode: "riding_cart", buildingId: "m51-scale-rental",
      productId: "m51-scale-rental:riding_cart", fleetUnitIds: [`scale-cart-${String(index + 1).padStart(2, "0")}`],
      riders: [{ golferId: index * 2 + 1, fleetUnitId: `scale-cart-${String(index + 1).padStart(2, "0")}`, seat: 0 }, { golferId: index * 2 + 2, fleetUnitId: `scale-cart-${String(index + 1).padStart(2, "0")}`, seat: 1 }],
      status: "active", routeCacheKey: `scale-${index}`, serviceDelayMinutes: 0, availableUnitsAtSelection: 50,
      actualTravelMinutes: 1, walkingFallbackMinutes: 0, offPathTiles: 0, seed: SEED, decisionOrder: index,
    }));
    live.m51!.assignments = assignments;
    for (let index = 0; index < 120; index++) stepLive(live, course, .25);
    const renderStarted = performance.now();
    const rendered = liveRenderData(live);
    const units = mobilityRenderUnits(course, rendered);
    const renderMs = performance.now() - renderStarted;
    expect(rendered).toHaveLength(100);
    expect(units).toHaveLength(50);
    expect(new Set(units.map((unit) => unit.id)).size).toBe(50);
    expect(routeCells).toBeLessThan(10_000);
    expect(routeMs).toBeLessThan(15_000);
    expect(renderMs).toBeLessThan(50);

    const snapshot = snapshotLiveSimulation({ state: live, pendingCash: 0, speed: "4x", selectedGolferId: 1 });
    const restored = restoreLiveSimulation(snapshot);
    expect(restored).not.toBeNull();
    expect(hashCanonicalValue(snapshot)).toBe(hashCanonicalValue(snapshotLiveSimulation({ state: restored!.state, pendingCash: restored!.pendingCash, speed: restored!.speed, selectedGolferId: restored!.selectedGolferId, clockRemainderMinutes: restored!.clockRemainderMinutes, weekLedger: restored!.weekLedger })));
    const saved = { schemaVersion: CURRENT_SAVE_SCHEMA_VERSION, savedAt: SEED, course, world, history: [], live: snapshot };
    const imported = parseSaveText(JSON.stringify(saved));
    if (!imported.ok) throw new Error(`${imported.error.code}: ${imported.error.message}`);
    expect(hashGameState({ course: imported.payload.course, world: imported.payload.world, live: imported.payload.live })).toBe(hashGameState({ course: imported.payload.course, world: imported.payload.world, live: imported.payload.live }));
  }, 120_000);
});
