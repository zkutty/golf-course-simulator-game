import { describe, expect, it } from "vitest";
import { applyAction } from "../../core/reducer";
import { CURRENT_SAVE_SCHEMA_VERSION, parseSaveText, payloadForPersistence } from "../../utils/save";
import { hashGameState } from "../../utils/stateHash";
import { economicPressureForWorld, terrainCostMult } from "../balance/experience";
import { createNewGame } from "../gen/newGame";
import { applyStaffCommand } from "../livingClub/livingClub";
import { greenKeepingOverview } from "../greens/greenMaintenance";
import { emptyPaceDayMetrics, ensureCoursePaceMetrics } from "../live/pace";
import { recordPaceDay } from "../live/paceHistory";
import { createLiveState, stepLive } from "../live/simulation";
import { runLiveDaysHeadless } from "../live/headless";
import { normalizeM51CourseMobilityState } from "../m51/mobility";
import { mobilityRentalPreview } from "../m51/rentalBusiness";
import { DEFAULT_WORLD } from "../models/defaults";
import type { World } from "../models/types";
import { activeWeather, advanceSeasonalDay, createSeasonalState } from "../seasons/seasons";
import { createM26MultiCourseReferenceCourse, createPlayerProReferenceCourse } from "../testing/referenceCourse";
import {
  ADVANCED_SYSTEM_IDS,
  createSystemControlState,
  reconcileSystemControlWorld,
  resolveSystemControlPolicy,
} from "./systemControl";

function simulationWorld(seed = 689_001): World {
  return reconcileSystemControlWorld({
    ...structuredClone(DEFAULT_WORLD),
    runSeed: seed,
    cash: 750_000,
    experienceProfile: "simulation",
    economicPressure: "balanced",
    systemControl: createSystemControlState("simulation"),
  });
}

function state() {
  return {
    course: createPlayerProReferenceCourse(),
    world: simulationWorld(),
    selectedTerrain: "fairway" as const,
    terrainVersion: 0,
    obstaclesVersion: 0,
    markersVersion: 0,
    economyVersion: 0,
  };
}

describe("ZK-689 Simulation operational responsibility", () => {
  it("keeps all thirteen domains full/manual from sparse profile defaults at every economic pressure", () => {
    const policies = (["friendly", "balanced", "tight"] as const).map((economicPressure) => {
      const run = createNewGame({ mode: "sandbox", courseName: economicPressure, seed: 689, theme: "parkland", experienceProfile: "simulation", economicPressure });
      return {
        policy: resolveSystemControlPolicy(run.world).systems.map(({ id, visibility, mode, source }) => ({ id, visibility, mode, source })),
        overrides: run.world.systemControl?.overrides,
        terrainCost: terrainCostMult(economicPressure),
      };
    });
    for (const entry of policies) {
      expect(entry.policy.map((system) => system.id)).toEqual(ADVANCED_SYSTEM_IDS);
      expect(entry.policy.every((system) => system.visibility === "full" && system.mode === "manual" && system.source === "profile-default")).toBe(true);
      expect(entry.overrides).toEqual({});
    }
    expect(policies.map((entry) => entry.terrainCost)).toEqual([0.85, 1, 1.15]);
  });

  it("commits one existing mobility reducer action and rejects constraints without state or control mutation", () => {
    const initial = state();
    const rentalId = Object.keys(normalizeM51CourseMobilityState(initial.course.m51, initial.course).cartRentals)[0];
    const preview = mobilityRentalPreview(initial.course, rentalId, "pushcart")!;
    const purchased = applyAction(initial, { type: "PURCHASE_MOBILITY_FLEET", buildingId: rentalId, mode: "pushcart", quantity: 1 });
    expect(purchased.world.cash).toBe(initial.world.cash - preview.capitalCost);
    expect(purchased.economyVersion).toBe(initial.economyVersion + 1);
    expect(mobilityRentalPreview(purchased.course, rentalId, "pushcart")?.owned).toBe(preview.owned + 1);
    expect(purchased.world.systemControl?.overrides).toEqual({});

    const constrained = { ...initial, world: { ...initial.world, cash: preview.capitalCost - 1 } };
    const rejected = applyAction(constrained, { type: "PURCHASE_MOBILITY_FLEET", buildingId: rentalId, mode: "pushcart", quantity: 1 });
    expect(rejected).toEqual(constrained);
    expect(rejected.world).toBe(constrained.world);
    expect(rejected.world.systemControl?.overrides).toEqual({});
  });

  it("round-trips staff shifts and mobility authority without adding save schema or default overrides", () => {
    const initial = state();
    const staffId = initial.world.staffRoster![0].id;
    const scheduled = applyStaffCommand(initial.world, { type: "schedule", staffId, shiftStart: 150, shiftEnd: 660 });
    expect(scheduled.ok).toBe(true);
    const rentalId = Object.keys(normalizeM51CourseMobilityState(initial.course.m51, initial.course).cartRentals)[0];
    const configured = applyAction({ ...initial, world: scheduled.world }, { type: "CONFIGURE_MOBILITY_PRODUCT", buildingId: rentalId, mode: "riding_cart", enabled: true, price: 41 });
    const payload = payloadForPersistence({ course: configured.course, world: configured.world });
    const loaded = parseSaveText(JSON.stringify({ schemaVersion: CURRENT_SAVE_SCHEMA_VERSION, savedAt: 689, ...payload }));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.payload.world.staffRoster?.find((member) => member.id === staffId)).toMatchObject({ shiftStart: 150, shiftEnd: 660 });
    expect(mobilityRentalPreview(loaded.payload.course, rentalId, "riding_cart")?.price).toBe(41);
    expect(loaded.payload.world.systemControl?.overrides).toEqual({});
    expect(resolveSystemControlPolicy(loaded.payload.world).systems.every((system) => system.mode === "manual")).toBe(true);
    const canonical = payloadForPersistence(loaded.payload);
    const reloaded = parseSaveText(JSON.stringify({ schemaVersion: CURRENT_SAVE_SCHEMA_VERSION, savedAt: 690, ...canonical }));
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) expect(hashGameState(reloaded.payload)).toBe(hashGameState(canonical));
  });

  it("makes scheduled shifts authoritative for live service, greenkeeping delivery, and pace history", () => {
    const course = createPlayerProReferenceCourse();
    const courseId = course.activeCourseId!;
    const fullDay = {
      ...simulationWorld(689_150),
      maintenanceBudget: 5_000,
      staffLevel: 3,
      staffRoster: [
        { id: "grounds", name: "Grounds", role: "groundskeeper" as const, courseId, shiftStart: 0, shiftEnd: 840, weeklyWage: 500, proficiency: .58 },
        { id: "service", name: "Service", role: "cart_attendant" as const, courseId, shiftStart: 150, shiftEnd: 300, weeklyWage: 420 },
        { id: "marshal", name: "Marshal", role: "marshal" as const, courseId, shiftStart: 150, shiftEnd: 300, weeklyWage: 560 },
      ],
    };
    const live = createLiveState(course, fullDay, 0);
    expect(live.marshalCoverageByCourse?.[courseId] ?? 0).toBe(0);
    expect(live.beverageCoverageByCourse?.[courseId] ?? 0).toBe(0);
    stepLive(live, course, 149, fullDay);
    expect(live.marshalCoverageByCourse?.[courseId] ?? 0).toBe(0);
    stepLive(live, course, 1, fullDay);
    expect(live.marshalCoverageByCourse?.[courseId]).toBe(1);
    expect(live.beverageCoverageByCourse?.[courseId]).toBe(1);
    stepLive(live, course, 151, fullDay);
    expect(live.marshalCoverageByCourse?.[courseId] ?? 0).toBe(0);
    expect(live.beverageCoverageByCourse?.[courseId] ?? 0).toBe(0);

    const shortenedGrounds = {
      ...fullDay,
      staffRoster: fullDay.staffRoster.map((member) => member.id === "grounds" ? { ...member, shiftStart: 150, shiftEnd: 300 } : member),
    };
    expect(greenKeepingOverview(course, shortenedGrounds).staffCoverage)
      .toBeLessThan(greenKeepingOverview(course, fullDay).staffCoverage);

    const pace = emptyPaceDayMetrics([courseId]);
    ensureCoursePaceMetrics(pace, courseId).roundsCompleted = 1;
    const recorded = recordPaceDay(shortenedGrounds, course, 0, pace);
    const staffing = recorded.paceOperations!.courses[courseId].samples[0].staffing;
    expect(staffing).toContain("groundskeeper@150-300");
    expect(staffing).toContain("marshal@150-300");
    expect(staffing).not.toContain("groundskeeper@0-840");
  });

  it("is byte-deterministic through multi-course weather transitions and a long session", () => {
    const simulate = () => {
      let course = structuredClone(createM26MultiCourseReferenceCourse());
      let world = simulationWorld(689_084);
      world = {
        ...world,
        seasonal: createSeasonalState({ runSeed: world.runSeed, theme: course.theme, week: 1, day: 0 }),
      };
      const weather: string[] = [];
      for (let absoluteDay = 0; absoluteDay < 84; absoluteDay++) {
        const day = absoluteDay % 7;
        world = { ...world, week: Math.floor(absoluteDay / 7) + 1 };
        weather.push(activeWeather(world, course, day).kind);
        const advanced = advanceSeasonalDay(course, world, day);
        course = advanced.course;
        world = advanced.world;
      }
      return { hash: hashGameState({ course, world }), weather, course, world };
    };
    const left = simulate();
    const right = simulate();
    expect(left.course.layouts?.length).toBeGreaterThan(1);
    expect(new Set(left.weather).size).toBeGreaterThan(1);
    expect(right.weather).toEqual(left.weather);
    expect(right.hash).toBe(left.hash);
    expect(economicPressureForWorld(left.world)).toBe("balanced");
    expect(left.world.systemControl?.overrides).toEqual({});
  });

  it("resumes a mutated multi-course live operation byte-identically across weekly close and weather", () => {
    const courseId = "m26-rental";
    const baseCourse = createM26MultiCourseReferenceCourse();
    const course = {
      ...baseCourse,
      buildings: [...baseCourse.buildings, { id: courseId, type: "cart_rental" as const, x: 1, y: 1, tier: 2 as const, price: 30 }],
    };
    let world: World = {
      ...simulationWorld(689_214),
      staffRoster: [
        { id: "north-grounds", name: "North grounds", role: "groundskeeper", courseId: "north", shiftStart: 0, shiftEnd: 840, weeklyWage: 520, proficiency: .62 },
        { id: "north-marshal", name: "North marshal", role: "marshal", courseId: "north", shiftStart: 150, shiftEnd: 660, weeklyWage: 560 },
        { id: "south-service", name: "South service", role: "cart_attendant", courseId: "south", shiftStart: 180, shiftEnd: 720, weeklyWage: 440 },
      ],
      seasonal: createSeasonalState({ runSeed: 689_214, theme: course.theme, week: 1, day: 0 }),
    };
    const initial = { ...state(), course, world };
    const configured = applyAction(initial, { type: "CONFIGURE_MOBILITY_PRODUCT", buildingId: courseId, mode: "riding_cart", enabled: true, price: 42 });
    const stocked = applyAction(configured, { type: "PURCHASE_MOBILITY_FLEET", buildingId: courseId, mode: "riding_cart", quantity: 8 });
    world = stocked.world;
    const canonicalInitial = parseSaveText(JSON.stringify({
      schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
      savedAt: 689_200,
      ...payloadForPersistence({ course: stocked.course, world }),
    }));
    expect(canonicalInitial.ok).toBe(true);
    if (!canonicalInitial.ok) return;

    const uninterrupted = runLiveDaysHeadless({ course: canonicalInitial.payload.course, world: canonicalInitial.payload.world, days: 14, stepMinutes: 10 });
    const firstWeek = runLiveDaysHeadless({ course: canonicalInitial.payload.course, world: canonicalInitial.payload.world, days: 7, stepMinutes: 10 });
    const saved = payloadForPersistence({ course: firstWeek.course, world: firstWeek.world });
    const loaded = parseSaveText(JSON.stringify({ schemaVersion: CURRENT_SAVE_SCHEMA_VERSION, savedAt: 689_214, ...saved }));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const resumed = runLiveDaysHeadless({ course: loaded.payload.course, world: loaded.payload.world, days: 7, stepMinutes: 10 });

    expect(hashGameState({ course: resumed.course, world: resumed.world })).toBe(hashGameState({ course: uninterrupted.course, world: uninterrupted.world }));
    expect([...firstWeek.days, ...resumed.days].map((day) => day.weather?.kind)).toEqual(uninterrupted.days.map((day) => day.weather?.kind));
    expect(new Set(uninterrupted.days.map((day) => day.weather?.kind)).size).toBeGreaterThan(1);
    expect(uninterrupted.days.every((day) => day.perCourse?.map((entry) => entry.courseId).sort().join(",") === "north,south")).toBe(true);
    expect(uninterrupted.world.week).toBe(3);
    expect(uninterrupted.world.paceOperations?.courses.north.samples).toHaveLength(14);
    expect(uninterrupted.world.paceOperations?.courses.north.samples.every((sample) => sample.staffing.includes("marshal@150-660"))).toBe(true);
    expect(uninterrupted.world.m51?.history.dailyLedgers).toHaveLength(14);
    expect(uninterrupted.world.m51?.history.weeklyReports).toHaveLength(2);
    expect(mobilityRentalPreview(uninterrupted.course, courseId, "riding_cart")).toMatchObject({ enabled: true, price: 42, owned: 8 });
    expect(uninterrupted.world.systemControl?.overrides).toEqual({});
  }, 60_000);
});
