import { describe, expect, it } from "vitest";
import type { Course, Terrain } from "../models/types";
import { DEFAULT_WORLD } from "../models/defaults";
import { buildM49DemandPlan } from "./demand";
import { m49CourseHistory, m49ReputationDelta, normalizeM49State, recordM49Observations } from "./history";
import { launchM49Marketing, strategicIdentity } from "./identity";
import { buildM49CourseReport } from "./report";
import type { M49ObservedRound } from "./types";
import { m49ObservedMobilityValue } from "./mobility";
import { CURRENT_SAVE_SCHEMA_VERSION, parseSaveText } from "../../utils/save";
import { hashGameState } from "../../utils/stateHash";

function fixtureCourse(hazard = false): Course {
  const width = 64;
  const height = 28;
  const tiles = Array.from({ length: width * height }, () => "fairway" as Terrain);
  for (let y = 12; y <= 16; y++) for (let x = 55; x < 59; x++) tiles[y * width + x] = "green";
  if (hazard) for (let y = 0; y < height; y++) for (let x = 28; x <= 34; x++) tiles[y * width + x] = "water";
  const holes = Array.from({ length: 9 }, (_, index) => ({
    id: `m49-hole-${index + 1}`,
    tee: { x: 5, y: 10 + index },
    green: { x: 56, y: 12 + Math.min(index, 4) },
    parMode: "MANUAL" as const,
    parManual: 4 as const,
    name: `M49 hole ${index + 1}`,
  }));
  return {
    width,
    height,
    tiles,
    elevations: new Array(width * height).fill(0),
    holes,
    layouts: [{ id: "m49-course", name: "M49 test", draftHoleIds: holes.map((hole) => hole.id), publishedHoleIds: holes.map((hole) => hole.id), roundLength: 9, state: "open", greenFee: 65 }],
    activeCourseId: "m49-course",
    obstacles: [],
    buildings: [],
    yardsPerTile: 10,
    name: "M49 test",
    baseGreenFee: 65,
    condition: .85,
    theme: "parkland",
  };
}

function observation(overrides: Partial<M49ObservedRound> = {}): M49ObservedRound {
  return {
    version: 1,
    id: "m49-observation",
    courseId: "m49-course",
    segment: "casual",
    completed: true,
    holesPlayed: 9,
    holesTotal: 9,
    expectedScore: 36,
    actualScore: 35,
    satisfaction: 88,
    condition: .85,
    greenFee: 65,
    strategicFit: .78,
    valueReceived: .82,
    willingnessToPay: 74,
    priceElasticity: 1.1,
    returnIntent: true,
    recommend: true,
    churnRisk: .1,
    paceDelayMinutes: 2,
    hospitalityDelayMinutes: 0,
    holeEvidence: [],
    causes: [],
    ...overrides,
  };
}

function mobilityCourse(kind: "walking" | "pushcart" | "riding"): Course {
  const course = fixtureCourse();
  const tiles = [...course.tiles];
  for (let x = 2; x < course.width - 2; x++) tiles[8 * course.width + x] = "path";
  const buildingId = "mobility-rental";
  const push = kind === "pushcart";
  const riding = kind === "riding";
  return {
    ...course,
    tiles,
    buildings: kind === "walking" ? [] : [{ id: buildingId, type: "cart_rental", x: 2, y: 7, tier: 2, price: 22 }],
    ...(kind === "walking" ? {} : {
      m51: {
        version: 3,
        cartRentals: {
          [buildingId]: {
            buildingId,
            tier: 2,
            products: {
              pushcart: { id: `${buildingId}:pushcart`, courseId: "m49-course", buildingId, mode: "pushcart", name: "Pushcart", price: push ? 8 : 999, enabled: push },
              riding_cart: { id: `${buildingId}:riding_cart`, courseId: "m49-course", buildingId, mode: "riding_cart", name: "Riding cart", price: riding ? 20 : 999, enabled: riding },
            },
          },
        },
        fleet: kind === "pushcart"
          ? { "push-1": { id: "push-1", courseId: "m49-course", buildingId, productId: `${buildingId}:pushcart`, mode: "pushcart", seats: 1, state: "available", condition: 1, uses: 0, wear: 0 } }
          : { "cart-1": { id: "cart-1", courseId: "m49-course", buildingId, productId: `${buildingId}:riding_cart`, mode: "riding_cart", seats: 2, state: "available", condition: 1, uses: 0, wear: 0 } },
        settledAssignmentIds: [],
      },
    }),
  };
}

function mobilityEvidence(overrides: Partial<NonNullable<M49ObservedRound["mobility"]>> = {}): NonNullable<M49ObservedRound["mobility"]> {
  return {
    source: "observed", mode: "riding_cart", rentalProvided: true,
    walkingBurdenMinutes: 155, actualTravelMinutes: 86, paceMinutes: 238, price: 20,
    serviceDelayMinutes: 3, walkingFallbackMinutes: 0, stockoutFallback: false,
    restricted: false, tournamentPolicy: false, value: .78,
    ...overrides,
  };
}

describe("M49 segment economics", () => {
  it("exposes predicted segment fit and different price elasticity before play evidence exists", () => {
    const plan = buildM49DemandPlan(fixtureCourse(), DEFAULT_WORLD);
    expect(Object.keys(plan.segments)).toHaveLength(6);
    expect(plan.segments.casual.evidenceLabel).toBe("predicted");
    expect(plan.segments.casual.priceElasticity).toBeGreaterThan(plan.segments.pro.priceElasticity);
    expect(plan.totalIndex).toBeGreaterThan(0);
  });

  it("moves the affected cohort when a shared hole becomes a forced hazard", () => {
    const open = buildM49DemandPlan(fixtureCourse(), DEFAULT_WORLD);
    const hazard = buildM49DemandPlan(fixtureCourse(true), DEFAULT_WORLD);
    expect(hazard.segments.casual.bookingAppeal).toBeLessThan(open.segments.casual.bookingAppeal);
    expect(hazard.segments.casual.willingnessToPay).toBeLessThanOrEqual(open.segments.casual.willingnessToPay);
  });

  it("learns from observed rounds but cannot create reputation from no play", () => {
    const unchanged = recordM49Observations(DEFAULT_WORLD, [], DEFAULT_WORLD.week);
    expect(unchanged).toBe(DEFAULT_WORLD);
    expect(m49ReputationDelta([])).toEqual({ delta: 0, observedRounds: 0 });
    expect(m49ReputationDelta([observation({ completed: false, holesPlayed: 0, satisfaction: 20, returnIntent: false, recommend: false })])).toEqual({ delta: 0, observedRounds: 0 });

    const nextWorld = recordM49Observations(DEFAULT_WORLD, [observation()], DEFAULT_WORLD.week);
    const history = m49CourseHistory(nextWorld, "m49-course");
    expect(history?.completedRounds).toBe(1);
    expect(history?.segments.casual?.observedRounds).toBe(1);
    expect(m49ReputationDelta([observation()]).delta).toBeGreaterThan(0);
  });

  it("keeps niche identity and unsupported marketing costed and evidence-bound", () => {
    const course = fixtureCourse();
    const identity = strategicIdentity(course, DEFAULT_WORLD);
    expect(identity.courseId).toBe("m49-course");
    expect(identity.tags.length).toBeGreaterThan(0);
    expect(identity.amenities.tourist.score).toBe(0);

    const launch = launchM49Marketing({ course, world: { ...DEFAULT_WORLD, cash: 10_000, marketingLevel: 5 }, segment: "casual", strength: "championship" });
    expect(launch.ok).toBe(true);
    if (!launch.ok) return;
    expect(launch.world.cash).toBeLessThan(10_000);
    expect(launch.promise.credibility).toBeLessThan(.7);
    const disappointed = recordM49Observations(launch.world, [observation({ valueReceived: .25, satisfaction: 32, returnIntent: false, recommend: false })], DEFAULT_WORLD.week);
    expect(disappointed.m49?.marketingPromises?.[0].disappointedRounds).toBe(1);
    expect(buildM49DemandPlan(course, launch.world).segments.casual.causes).toContain("marketing:promise-disappointment");
  });

  it("reports demand, observed causes, maintenance pressure, and a balanced ledger", () => {
    const course = fixtureCourse();
    const world = recordM49Observations(DEFAULT_WORLD, [observation({
      holeEvidence: [{
        holeId: "m49-hole-1",
        expectedScore: 4,
        actualScore: 8,
        satisfaction: 38,
        outcome: "frustrated",
        causes: ["difficulty:unfair", "pace:delay"],
      }],
      causes: ["difficulty:unfair", "pace:delay"],
    })], DEFAULT_WORLD.week);
    const report = buildM49CourseReport({ course, world, generatedAtWeek: 7 });
    expect(report.generatedAtWeek).toBe(7);
    expect(report.demand.segments.casual.evidenceLabel).toBe("mixed");
    expect(report.observedRounds).toBe(1);
    expect(report.reconciliation.ledgerBalanced).toBe(true);
    expect(report.reconciliation.authoritativeCondition).toBe(course.condition);
    expect(report.topCauses.map((cause) => cause.cause)).toContain("difficulty:unfair");
    expect(new Set(report.alerts.map((alert) => alert.id)).size).toBe(report.alerts.length);
  });

  it("keeps walking-first, pushcart-oriented, and riding-cart-oriented viable courses deterministic without treating fleet size as value", () => {
    const world = { ...DEFAULT_WORLD, runSeed: 557004 };
    const walking = buildM49DemandPlan(mobilityCourse("walking"), world);
    const pushcart = buildM49DemandPlan(mobilityCourse("pushcart"), world);
    const riding = buildM49DemandPlan(mobilityCourse("riding"), world);
    expect(walking.totalIndex).toBeGreaterThan(.2);
    expect(pushcart.totalIndex).toBeGreaterThan(.2);
    expect(riding.totalIndex).toBeGreaterThan(.2);
    expect(pushcart.segments.casual.mobility.currentSupport).toBeGreaterThan(walking.segments.casual.mobility.currentSupport);
    expect(riding.segments.senior.mobility.currentSupport).toBeGreaterThan(pushcart.segments.senior.mobility.currentSupport);
    const extraUnusedFleet = mobilityCourse("riding");
    extraUnusedFleet.m51 = { ...extraUnusedFleet.m51!, fleet: {
      ...extraUnusedFleet.m51!.fleet,
      "cart-2": { ...extraUnusedFleet.m51!.fleet["cart-1"], id: "cart-2" },
      "cart-3": { ...extraUnusedFleet.m51!.fleet["cart-1"], id: "cart-3" },
    } };
    expect(buildM49DemandPlan(extraUnusedFleet, world).segments.senior.mobility.currentSupport).toBe(riding.segments.senior.mobility.currentSupport);
    expect(strategicIdentity(extraUnusedFleet, world).tournamentFieldFit).toEqual(strategicIdentity(mobilityCourse("riding"), world).tournamentFieldFit);
    expect(buildM49DemandPlan(mobilityCourse("riding"), world)).toEqual(riding);
  });

  it("uses fixed-seed observed mobility outcomes for segment demand, identity, reports, and honest marketing", () => {
    const course = mobilityCourse("riding");
    const seedWorld = { ...DEFAULT_WORLD, runSeed: 557005, week: 9, cash: 10_000, marketingLevel: 5 };
    const observed = [
      observation({ id: "senior-cart", segment: "senior", mobility: mobilityEvidence({ value: .91 }), satisfaction: 90 }),
      observation({ id: "tourist-cart", segment: "tourist", mobility: mobilityEvidence({ value: .84 }), satisfaction: 87 }),
      observation({ id: "casual-stockout", segment: "casual", returnIntent: false, recommend: false, mobility: mobilityEvidence({ mode: "walk", rentalProvided: false, stockoutFallback: true, walkingFallbackMinutes: 155, price: 0, actualTravelMinutes: 155, paceMinutes: 322, value: .16 }) }),
      observation({ id: "junior-price", segment: "junior", returnIntent: false, recommend: false, mobility: mobilityEvidence({ price: 48, value: .26 }) }),
      observation({ id: "pro-policy", segment: "pro", tournamentId: "event-1", mobility: mobilityEvidence({ mode: "walk", rentalProvided: false, restricted: true, tournamentPolicy: true, price: 0, actualTravelMinutes: 155, value: .38 }) }),
      observation({ id: "skilled-cart", segment: "lowHandicap", mobility: mobilityEvidence({ value: .72 }) }),
    ];
    const world = recordM49Observations(seedWorld, observed, seedWorld.week);
    const plan = buildM49DemandPlan(course, world);
    const identity = strategicIdentity(course, world);
    const report = buildM49CourseReport({ course, world, generatedAtWeek: seedWorld.week });
    expect(plan.segments.senior.mobility).toMatchObject({ evidenceLabel: "mixed", observedRounds: 1 });
    expect(plan.segments.casual.mobility.disappointmentRisk).toBeGreaterThan(.55);
    expect(plan.segments.junior.willingnessToPay).toBeLessThan(plan.segments.tourist.willingnessToPay);
    expect(identity.mobility).toMatchObject({ tournamentPolicy: "walking_only", observedRounds: 6 });
    expect(identity.tournamentFieldFit.championship).toBeLessThanOrEqual(1);
    expect(report.topCauses.map((cause) => cause.cause)).toContain("mobility:stockout-fallback");
    expect(report.alerts.map((alert) => alert.id)).toContain("mobility-disappointment-casual");
    const campaign = launchM49Marketing({ course, world, segment: "casual", strength: "riding-cart mobility" });
    expect(campaign.ok).toBe(true);
    if (campaign.ok) expect(campaign.promise.disappointmentRisk).toBeGreaterThan(.5);

    const values = ["pro", "lowHandicap", "casual", "senior", "junior", "tourist"] as const;
    const bySegment = values.map((segment) => m49ObservedMobilityValue(segment, mobilityEvidence()));
    expect(new Set(bySegment).size).toBeGreaterThan(4);
    expect(m49ObservedMobilityValue("senior", mobilityEvidence())).toBeGreaterThan(m49ObservedMobilityValue("junior", mobilityEvidence({ price: 48 })));
  });

  it("migrates old M49 histories without inventing rental evidence and preserves mobility save/hash state", () => {
    const legacy = normalizeM49State({ version: 1, courses: { "m49-course": { version: 1, observedRounds: 3, completedRounds: 3, lastObservedWeek: 2, segments: { senior: { observedRounds: 3, completedRounds: 3, evidenceWeight: 3, averageValue: .7, averageSatisfaction: 75, returnRate: .7, recommendationRate: .7, churnRate: .2, willingnessToPay: 72, priceElasticity: 1, lastObservedWeek: 2, holeEvidence: {} } } } } });
    expect(legacy.courses["m49-course"].segments.senior?.mobility).toBeUndefined();
    const course = mobilityCourse("riding");
    const world = recordM49Observations({ ...DEFAULT_WORLD, runSeed: 557006 }, [observation({ id: "save-mobility", mobility: mobilityEvidence() })], 3);
    const saved = { schemaVersion: CURRENT_SAVE_SCHEMA_VERSION, savedAt: 557006, course, world, history: [] };
    const loaded = parseSaveText(JSON.stringify(saved));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const reloaded = parseSaveText(JSON.stringify({ ...saved, course: loaded.payload.course, world: loaded.payload.world }));
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(hashGameState({ course: loaded.payload.course, world: loaded.payload.world })).toBe(hashGameState({ course: reloaded.payload.course, world: reloaded.payload.world }));
    expect(loaded.payload.world.m49?.courses["m49-course"].segments.casual?.mobility?.observedRounds).toBe(1);
  });
});
