import { describe, expect, it } from "vitest";
import { applyAction } from "../../core/reducer";
import { CURRENT_SAVE_SCHEMA_VERSION, parseSaveText, payloadForPersistence } from "../../utils/save";
import { hashGameState } from "../../utils/stateHash";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import { createNewGame } from "../gen/newGame";
import { applyManualOperationsCommand, applyOperationsCommand } from "../operations/commands";
import { normalizePropertyCourse } from "../property/property";
import { advanceSeasonalDay } from "../seasons/seasons";
import type { ExperienceProfile, World } from "../models/types";
import {
  ADVANCED_SYSTEM_IDS,
  applySystemControlCommand,
  createSystemControlState,
  normalizeSystemControlState,
  reconcileSystemControlWorld,
  resolveSystemControlPolicy,
  systemControlEnvelope,
} from "./systemControl";

function world(profile: ExperienceProfile): World {
  return reconcileSystemControlWorld({
    ...DEFAULT_WORLD,
    experienceProfile: profile,
    systemControl: createSystemControlState(profile),
    seasonal: structuredClone(DEFAULT_WORLD.seasonal),
  });
}

describe("ZK-685 advanced-system registry and profile matrix", () => {
  it("publishes exactly thirteen stable, unique domain ids", () => {
    expect(ADVANCED_SYSTEM_IDS).toEqual([
      "maintenance", "localized-turf", "irrigation", "drainage", "staffing", "pace",
      "financing", "memberships", "tournaments", "property", "resort", "mobility", "community",
    ]);
    expect(new Set(ADVANCED_SYSTEM_IDS).size).toBe(13);
  });

  it("resolves the exact Relaxed, Classic, and Simulation visibility/control matrix without persisting defaults", () => {
    const relaxed = resolveSystemControlPolicy(world("relaxed"));
    const classic = resolveSystemControlPolicy(world("classic"));
    const simulation = resolveSystemControlPolicy(world("simulation"));
    const relaxedHidden = ["localized-turf", "irrigation", "drainage", "resort", "mobility"];
    const relaxedSummary = ADVANCED_SYSTEM_IDS.filter((id) => !relaxedHidden.includes(id));
    const classicHidden = ["localized-turf", "irrigation", "drainage", "pace", "mobility", "community"];
    const classicSummary = ADVANCED_SYSTEM_IDS.filter((id) => !classicHidden.includes(id));

    expect(relaxed.systems.filter((system) => system.visibility === "hidden").map((system) => system.id)).toEqual(relaxedHidden);
    expect(relaxed.systems.filter((system) => system.visibility === "summary").map((system) => system.id)).toEqual(relaxedSummary);
    expect(relaxed.systems.filter((system) => system.visibility === "full")).toEqual([]);
    expect(classic.systems.filter((system) => system.visibility === "hidden").map((system) => system.id)).toEqual(classicHidden);
    expect(classic.systems.filter((system) => system.visibility === "summary").map((system) => system.id)).toEqual(classicSummary);
    expect(classic.systems.filter((system) => system.visibility === "full")).toEqual([]);
    expect(simulation.systems.map((system) => system.visibility)).toEqual(Array(13).fill("full"));
    expect(relaxed.systems.map((system) => system.mode)).toEqual(Array(13).fill("automated"));
    expect(classic.systems.map((system) => system.mode)).toEqual(Array(13).fill("automated"));
    expect(simulation.systems.map((system) => system.mode)).toEqual(Array(13).fill("manual"));
    for (const profile of ["relaxed", "classic", "simulation"] as const) {
      const current = world(profile);
      expect(current.systemControl?.overrides).toEqual({});
      expect(resolveSystemControlPolicy(current).systems.map((system) => system.source)).toEqual(Array(13).fill("profile-default"));
    }
  });

  it("persists explicit takeover, deletes it on return, and changes source immediately", () => {
    const initial = world("classic");
    const taken = applySystemControlCommand(initial, { type: "TAKE_SYSTEM_CONTROL", system: "drainage" });
    expect(taken.ok).toBe(true);
    expect(taken.world.systemControl?.overrides).toEqual({ drainage: "manual" });
    expect(resolveSystemControlPolicy(taken.world).systems.find((system) => system.id === "drainage"))
      .toMatchObject({ visibility: "full", mode: "manual", source: "save-override", directControl: true });

    const returned = applySystemControlCommand(taken.world, { type: "RETURN_SYSTEM_TO_PROFILE", system: "drainage" });
    expect(returned.world.systemControl?.overrides).toEqual({});
    expect(resolveSystemControlPolicy(returned.world).systems.find((system) => system.id === "drainage"))
      .toMatchObject({ visibility: "hidden", mode: "automated", source: "profile-default", directControl: false });
  });

  it("graduates atomically one way, preserves state/overrides, and rejects skips or downgrades", () => {
    const initial = { ...world("relaxed"), cash: 12_345, maintenanceBudget: 777 };
    const taken = applySystemControlCommand(initial, { type: "TAKE_SYSTEM_CONTROL", system: "irrigation" }).world;
    const classic = applySystemControlCommand(taken, { type: "GRADUATE_EXPERIENCE_PROFILE", target: "classic" });
    expect(classic.ok).toBe(true);
    expect(classic.world).toMatchObject({ experienceProfile: "classic", cash: 12_345, maintenanceBudget: 777 });
    expect(classic.world.systemControl?.overrides).toEqual({ irrigation: "manual" });
    const simulation = applySystemControlCommand(classic.world, { type: "GRADUATE_EXPERIENCE_PROFILE", target: "simulation" });
    expect(simulation.ok).toBe(true);
    expect(simulation.world.systemControl?.graduations.map((entry) => entry.to)).toEqual(["classic", "simulation"]);
    expect(applySystemControlCommand(simulation.world, { type: "GRADUATE_EXPERIENCE_PROFILE", target: "classic" })).toMatchObject({ ok: false });
    expect(applySystemControlCommand(initial, { type: "GRADUATE_EXPERIENCE_PROFILE", target: "simulation" })).toMatchObject({ ok: false });
    expect(simulation.world.tournaments).toEqual(initial.tournaments);
    expect(simulation.world.enterprise).toEqual(initial.enterprise);
  });

  it("sanitizes malformed evidence without allowing a downgrade and reconciles idempotently", () => {
    const malformed = {
      version: 1,
      highestProfile: "relaxed",
      overrides: { maintenance: "broken", drainage: "manual", unknown: "manual" },
      graduations: [
        { from: "simulation", to: "classic", week: 2 },
        { from: "relaxed", to: "classic", week: -1 },
      ],
    };
    const normalized = normalizeSystemControlState(malformed, "classic");
    expect(normalized).toEqual({ version: 1, highestProfile: "classic", overrides: { drainage: "manual" }, graduations: [] });
    const first = reconcileSystemControlWorld({ ...world("classic"), systemControl: malformed as never });
    const second = reconcileSystemControlWorld(first);
    expect(second).toEqual(first);
    expect(second.experienceProfile).toBe("classic");
  });
});

describe("ZK-685 command authority, constraints, and deterministic automation", () => {
  it("uses the shared operation result and one atomic reducer takeover", () => {
    const baseState = {
      course: DEFAULT_COURSE,
      world: world("classic"),
      selectedTerrain: "fairway" as const,
      terrainVersion: 0,
      obstaclesVersion: 0,
      markersVersion: 0,
      economyVersion: 0,
    };
    const command = { type: "SET_MAINTENANCE_BUDGET" as const, amount: 1_250 };
    const shared = applyOperationsCommand(baseState.course, baseState.world, command);
    const manual = applyManualOperationsCommand(baseState.course, baseState.world, command);
    const reduced = applyAction(baseState, { type: "MANUAL_OPERATIONS_COMMAND", operation: command });
    expect(manual.course).toEqual(shared.course);
    expect(manual.world.maintenanceBudget).toBe(shared.world.maintenanceBudget);
    expect(reduced.course).toEqual(manual.course);
    expect(reduced.world).toEqual(manual.world);
    expect(reduced.world.systemControl?.overrides).toEqual({ maintenance: "manual" });

    const propertyCommand = { type: "PROPERTY_COMMAND" as const, command: { type: "SET_HOURS" as const, assetId: "property-parking-starter", openHour: 8, closeHour: 18 } };
    const manualProperty = applyManualOperationsCommand(baseState.course, baseState.world, propertyCommand);
    const reducedProperty = applyAction(baseState, { type: "MANUAL_OPERATIONS_COMMAND", operation: propertyCommand });
    expect(reducedProperty.course).toEqual(manualProperty.course);
    expect(reducedProperty.world).toEqual(manualProperty.world);
    expect(reducedProperty.world.systemControl?.overrides).toEqual({ property: "manual" });
  });

  it("rejects the operation and takeover together, then preserves accepted property, resort, and maintenance choices through automation", () => {
    const baseState = {
      course: structuredClone(DEFAULT_COURSE),
      world: world("classic"),
      selectedTerrain: "fairway" as const,
      terrainVersion: 0,
      obstaclesVersion: 0,
      markersVersion: 0,
      economyVersion: 0,
    };
    const rejected = applyAction(baseState, {
      type: "MANUAL_OPERATIONS_COMMAND",
      operation: { type: "PROPERTY_COMMAND", command: { type: "SET_HOURS", assetId: "missing", openHour: 8, closeHour: 18 } },
    });
    expect(rejected).toEqual(baseState);
    expect(rejected.world.systemControl?.overrides).toEqual({});
    const fixedFeeState = { ...baseState, world: { ...baseState.world, constraints: { fixedGreenFee: baseState.course.baseGreenFee } } };
    const rejectedFee = applyAction(fixedFeeState, {
      type: "MANUAL_OPERATIONS_COMMAND",
      operation: { type: "SET_COURSE_GREEN_FEE", courseId: fixedFeeState.course.activeCourseId!, greenFee: baseState.course.baseGreenFee + 10 },
    });
    expect(rejectedFee).toEqual(fixedFeeState);
    expect(rejectedFee.world.systemControl?.overrides).toEqual({});

    const property = normalizePropertyCourse(baseState.course.property);
    const resortAsset = {
      ...property.assets[0],
      id: "zk685-resort",
      kind: "lodge" as const,
      name: "Policy Lodge",
      category: "resort" as const,
      price: 120,
      openHour: 7,
      closeHour: 20,
    };
    let current: Parameters<typeof applyAction>[0] = {
      ...baseState,
      course: { ...baseState.course, property: { ...property, assets: [...property.assets, resortAsset] } },
    };
    const run = (operation: Parameters<typeof applyManualOperationsCommand>[2]) => {
      current = applyAction(current, { type: "MANUAL_OPERATIONS_COMMAND", operation });
    };
    run({ type: "SET_COURSE_GREEN_FEE", courseId: current.course.activeCourseId!, greenFee: 123 });
    run({ type: "SET_MAINTENANCE_BUDGET", amount: 1_333 });
    run({ type: "PROPERTY_COMMAND", command: { type: "SET_HOURS", assetId: "property-parking-starter", openHour: 9, closeHour: 19 } });
    run({ type: "PROPERTY_COMMAND", command: { type: "SET_PRICE", assetId: resortAsset.id, price: 222 } });
    run({ type: "PROPERTY_COMMAND", command: { type: "SET_UPKEEP", assetId: resortAsset.id, policy: "premium" } });
    expect(current.world.systemControl?.overrides).toEqual({ property: "manual", maintenance: "manual", resort: "manual" });

    const next = advanceSeasonalDay(current.course, { ...current.world, week: current.world.week + 1 }, 0);
    const nextProperty = normalizePropertyCourse(next.course.property);
    expect(next.course.baseGreenFee).toBe(123);
    expect(next.world.maintenanceBudget).toBe(1_333);
    expect(nextProperty.assets.find((asset) => asset.id === "property-parking-starter")).toMatchObject({ openHour: 9, closeHour: 19 });
    expect(nextProperty.assets.find((asset) => asset.id === resortAsset.id)).toMatchObject({ price: 222, upkeepPolicy: "premium" });
  });

  it("does not let automatic pricing bypass a fixed-fee scenario or settle twice", () => {
    const constrained = {
      ...world("classic"),
      constraints: { fixedGreenFee: DEFAULT_COURSE.baseGreenFee },
      cash: 50_000,
    };
    const first = advanceSeasonalDay(DEFAULT_COURSE, constrained, 0);
    const duplicate = advanceSeasonalDay(first.course, first.world, 0);
    expect(first.course.baseGreenFee).toBe(DEFAULT_COURSE.baseGreenFee);
    expect(duplicate.course.baseGreenFee).toBe(first.course.baseGreenFee);
    expect(duplicate.world.cash).toBe(first.world.cash);
    expect(duplicate.world.seasonal?.operations.responses).toEqual(first.world.seasonal?.operations.responses);
    expect(duplicate.world.seasonal?.yearbooks).toEqual(first.world.seasonal?.yearbooks);
  });

  it("keeps no-command domains authoritative and preserves a manual property decision", () => {
    const currentWorld = world("classic");
    const first = advanceSeasonalDay(DEFAULT_COURSE, currentWorld, 0);
    expect(first.world.seasonal?.automation.decisions).toContain("system-control|noop|8");
    expect(systemControlEnvelope(first.world).systems.find((system) => system.id === "pace"))
      .toMatchObject({ automation: "authoritative-noop", mode: "automated" });

    const manualFee = applyManualOperationsCommand(first.course, currentWorld, {
      type: "SET_COURSE_GREEN_FEE",
      courseId: first.course.activeCourseId!,
      greenFee: 123,
    });
    const next = advanceSeasonalDay(manualFee.course, { ...manualFee.world, week: 2 }, 0);
    expect(next.course.baseGreenFee).toBe(123);
    expect(next.world.cash).toBe(currentWorld.cash);
  });

  it("remains bounded and deterministic through a multi-season session", () => {
    const run = createNewGame({ mode: "sandbox", courseName: "Policy soak", seed: 685, theme: "parkland", experienceProfile: "relaxed", economicPressure: "balanced" });
    const simulate = () => {
      let course = structuredClone(run.course);
      let currentWorld = structuredClone(run.world);
      for (let day = 0; day < 70; day++) {
        currentWorld = { ...currentWorld, week: Math.floor(day / 7) + 1 };
        const next = advanceSeasonalDay(course, currentWorld, day % 7);
        course = next.course;
        currentWorld = next.world;
      }
      return { course, world: currentWorld };
    };
    const left = simulate();
    const right = simulate();
    expect(hashGameState(left)).toBe(hashGameState(right));
    expect(left.world.systemControl?.overrides).toEqual({});
    expect(left.world.seasonal?.automation.decisions.length).toBeLessThanOrEqual(16);
  });
});

describe("ZK-685 persistence and hash certification", () => {
  it("migrates schema 29 global-manual saves to all thirteen explicit overrides", () => {
    const legacyWorld = structuredClone(DEFAULT_WORLD) as World;
    delete legacyWorld.systemControl;
    legacyWorld.experienceProfile = "classic";
    legacyWorld.seasonal = {
      ...legacyWorld.seasonal!,
      automation: { ...legacyWorld.seasonal!.automation, advancedOperations: true },
    };
    const loaded = parseSaveText(JSON.stringify({ schemaVersion: 29, savedAt: 1, course: DEFAULT_COURSE, world: legacyWorld }));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.migratedFrom).toBe(29);
    expect(Object.keys(loaded.payload.world.systemControl?.overrides ?? {})).toHaveLength(13);
    expect(resolveSystemControlPolicy(loaded.payload.world).systems.every((system) => system.mode === "manual")).toBe(true);
  });

  it.each([
    ["empty object", {}],
    ["unknown version", { version: 2, overrides: {}, highestProfile: "classic", graduations: [] }],
    ["malformed override", { version: 1, overrides: { pace: "broken" }, highestProfile: "classic", graduations: [] }],
  ])("falls back from a schema-29 %s carrier to the legacy global-manual policy", (_label, systemControl) => {
    const legacyWorld = structuredClone(DEFAULT_WORLD) as World;
    legacyWorld.experienceProfile = "classic";
    legacyWorld.systemControl = systemControl as never;
    legacyWorld.seasonal = {
      ...legacyWorld.seasonal!,
      automation: { ...legacyWorld.seasonal!.automation, advancedOperations: true, overrides: [] },
    };
    const loaded = parseSaveText(JSON.stringify({ schemaVersion: 29, savedAt: 1, course: DEFAULT_COURSE, world: legacyWorld }));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(Object.keys(loaded.payload.world.systemControl?.overrides ?? {})).toHaveLength(13);
    expect(loaded.payload.world.seasonal?.automation.advancedOperations).toBe(true);
    expect(loaded.payload.world.seasonal?.automation.overrides).toHaveLength(8);
  });

  it("keeps the M39 global switch canonical through return/take, idempotence, and hashing", () => {
    const globalManual = {
      ...world("classic"),
      systemControl: {
        version: 1 as const,
        highestProfile: "classic" as const,
        overrides: Object.fromEntries(ADVANCED_SYSTEM_IDS.map((id) => [id, "manual" as const])),
        graduations: [],
      },
    };
    const canonical = reconcileSystemControlWorld(globalManual);
    expect(canonical.seasonal?.automation).toMatchObject({ advancedOperations: true });
    expect(canonical.seasonal?.automation.overrides).toHaveLength(8);

    const returned = applySystemControlCommand(canonical, { type: "RETURN_SYSTEM_TO_PROFILE", system: "property" }).world;
    expect(returned.seasonal?.automation.advancedOperations).toBe(false);
    expect(returned.seasonal?.automation.overrides).not.toContain("hours");
    expect(returned.seasonal?.automation.overrides).not.toContain("pricing");
    const retaken = applySystemControlCommand(returned, { type: "TAKE_SYSTEM_CONTROL", system: "property" }).world;
    expect(retaken.seasonal?.automation.advancedOperations).toBe(true);
    expect(retaken.seasonal?.automation.overrides).toHaveLength(8);
    expect(reconcileSystemControlWorld(retaken)).toEqual(retaken);

    const staleCompatibility = {
      ...retaken,
      seasonal: {
        ...retaken.seasonal!,
        automation: { ...retaken.seasonal!.automation, advancedOperations: false, overrides: [] },
      },
    };
    expect(hashGameState({ course: DEFAULT_COURSE, world: staleCompatibility }))
      .toBe(hashGameState({ course: DEFAULT_COURSE, world: retaken }));
  });

  it("round-trips sparse overrides, sanitizes malformed current carriers, and hashes reversibly", () => {
    const run = createNewGame({ mode: "sandbox", courseName: "Round trip", seed: 686, theme: "parkland", experienceProfile: "classic", economicPressure: "balanced" });
    const initial = run.world;
    const course = run.course;
    const taken = applySystemControlCommand(initial, { type: "TAKE_SYSTEM_CONTROL", system: "pace" }).world;
    const persisted = payloadForPersistence({ course, world: taken });
    const loaded = parseSaveText(JSON.stringify({ schemaVersion: CURRENT_SAVE_SCHEMA_VERSION, savedAt: 2, ...persisted }));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.payload.world.systemControl?.overrides).toEqual({ pace: "manual" });
    expect(resolveSystemControlPolicy(loaded.payload.world).systems.find((system) => system.id === "pace"))
      .toMatchObject({ visibility: "full", mode: "manual", source: "save-override" });
    expect(hashGameState(loaded.payload)).toBe(hashGameState(persisted));

    const returned = applySystemControlCommand(taken, { type: "RETURN_SYSTEM_TO_PROFILE", system: "pace" }).world;
    expect(hashGameState({ course, world: returned }))
      .toBe(hashGameState({ course, world: initial }));

    const malformed = parseSaveText(JSON.stringify({
      schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
      savedAt: 3,
      course,
      world: {
        ...initial,
        systemControl: { version: 1, highestProfile: "relaxed", overrides: { pace: "manual", drainage: "invalid" }, graduations: [] },
      },
    }));
    expect(malformed.ok).toBe(true);
    if (malformed.ok) {
      expect(malformed.payload.world.experienceProfile).toBe("classic");
      expect(malformed.payload.world.systemControl?.overrides).toEqual({ pace: "manual" });
    }
  });
});
