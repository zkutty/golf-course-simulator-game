import { describe, expect, it } from "vitest";
import type { Course, Terrain, World } from "../models/types";
import { DEFAULT_WORLD } from "../models/defaults";
import type { TournamentEvent } from "../tournaments/types";
import {
  activatePlayerChallenge,
  autoFinishPlayerRound,
  caddieRecommendation,
  commitPlayerShot,
  completePlayerTraining,
  createDefaultPlayerPro,
  createPlayerChallenge,
  finishPlayerShot,
  normalizePlayerPro,
  playerTechniqueCatalog,
  playerTournamentEligibility,
  playerTrainingOptions,
  previewPlayableShot,
  registerPlayerTournament,
  resolvePlayableShot,
  settlePlayerRound,
  startPlayableRound,
} from "./playerPro";
import { normalizeLoadedSaveResult } from "../../utils/save";
import { starterPropertyCourse } from "../property/property";
import { createRenderPerfCourse } from "../testing/referenceCourse";
import {
  __resetSaveStoreForTests,
  autosave,
  exportSlot,
  importSave,
  loadSlot,
} from "../../utils/saveStore";
import {
  createGreenProgram,
  greenGeometryVersion,
  normalizeGreenLocalState,
  normalizeGreenSurfaceV1,
} from "../greens/greenSurface";

function threeHoleCourse(): Course {
  const width = 64;
  const height = 32;
  const tiles = new Array<Terrain>(width * height).fill("rough");
  const holes: Course["holes"] = [];
  for (let index = 0; index < 3; index++) {
    const y = 7 + index * 8;
    const tee = { x: 5, y };
    const green = { x: 35 + index * 5, y };
    for (let yy = y - 2; yy <= y + 2; yy++) for (let x = tee.x; x <= green.x; x++) {
      tiles[yy * width + x] = "fairway";
    }
    tiles[tee.y * width + tee.x] = "tee";
    for (let yy = y - 1; yy <= y + 1; yy++) for (let x = green.x - 1; x <= green.x + 1; x++) {
      tiles[yy * width + x] = "green";
    }
    holes.push({
      id: `hole-${index + 1}`,
      name: `Slice ${index + 1}`,
      tee,
      green,
      teeBoxes: { member: tee },
      pinPositions: { A: green },
      parMode: "MANUAL",
      parManual: index === 0 ? 4 : 5,
      parByTee: { member: { mode: "MANUAL", par: index === 0 ? 4 : 5 } },
    });
  }
  // A broad deterministic hazard beside the first fairway.
  for (let y = 2; y <= 12; y++) for (let x = 20; x <= 28; x++) tiles[y * width + x] = "water";
  // Preserve a safe lower edge route through the hazard fixture.
  for (let x = 20; x <= 28; x++) tiles[10 * width + x] = "fairway";
  return {
    width,
    height,
    tiles,
    elevations: new Array(width * height).fill(0),
    holes,
    layouts: [{
      id: "slice",
      name: "Three-Hole Slice",
      draftHoleIds: holes.map((hole) => hole.id!),
      publishedHoleIds: holes.map((hole) => hole.id!),
      roundLength: 9,
      state: "open",
      greenFee: 0,
      legacyPartial: true,
    }],
    activeCourseId: "slice",
    activePinRotation: "A",
    obstacles: [],
    buildings: [],
    yardsPerTile: 10,
    name: "Three-Hole Slice",
    baseGreenFee: 0,
    condition: 1,
    theme: "parkland",
  };
}

function world(): World {
  return {
    ...DEFAULT_WORLD,
    runSeed: 360037,
    cash: 10_000,
    playerPro: createDefaultPlayerPro({ seed: 360037, name: "Casey Fairway" }),
  };
}

function certifiedCourse(holeCount: 9 | 18): Course {
  const base = createRenderPerfCourse("parkland");
  const holes = base.holes.slice(0, holeCount).map((hole, index) => ({
    ...hole,
    id: `cert-hole-${index + 1}`,
    teeBoxes: { member: hole.tee },
    pinPositions: { A: hole.green },
    parByTee: { member: { mode: "MANUAL" as const, par: hole.parManual ?? 5 } },
  }));
  const ids = holes.map((hole) => hole.id);
  return {
    ...base,
    holes,
    layouts: [{
      id: `cert-${holeCount}`,
      name: `${holeCount}-Hole Certification`,
      draftHoleIds: ids,
      publishedHoleIds: ids,
      roundLength: holeCount,
      state: "open",
      greenFee: 0,
    }],
    activeCourseId: `cert-${holeCount}`,
    activePinRotation: "A",
  };
}

function started() {
  const course = threeHoleCourse();
  const currentWorld = world();
  const result = startPlayableRound({ course, world: currentWorld, layoutId: "slice", teeSet: "member", pinRotation: "A" });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return { course, world: currentWorld, career: currentWorld.playerPro!, round: result.round };
}

describe("M36 deterministic Player Pro play", () => {
  it("automatically completes a green arrival and preserves the resolved putt count", () => {
    const { career, round } = started();
    const committed = commitPlayerShot(round, career.skills, { club: "Pitching Wedge", aim: { x: 34, y: 7 }, power: .25, technique: "normal" });
    expect(committed.pendingShot).not.toBeNull();
    if (!committed.pendingShot) throw new Error("Expected a pending shot");
    const automatic = {
      ...committed,
      pendingShot: {
        ...committed.pendingShot,
        holed: false,
        lieAfter: "green",
        greenPutting: { version: 1 as const, seed: 640, putts: 2 as const, leaveDistanceYards: 12, breakTiles: .4, pinDifficulty: .2, realizedSpeedFeet: 10, effectiveMoisture: .5, wear: .1, puttingSkill: .7, consistency: .7 },
      },
    };
    const finished = finishPlayerShot(automatic);
    expect(finished.phase).toBe("hole_complete");
    expect(finished.strokes).toBe(round.strokes + 3);
    expect(finished.scorecard[0].strokes).toBe(3);
    expect(finished.shots[0].greenPutting?.putts).toBe(2);
    const resumed = normalizePlayerPro({ ...career, activeRound: finished }, { seed: 71 });
    expect(resumed.activeRound?.shots[0].greenPutting).toEqual(finished.shots[0].greenPutting);
  });
  it("freezes canonical biome and climate compatibility evidence in active rounds", () => {
    const { round } = started();
    expect(round.course.biomeCompatibility).toMatchObject({
      version: 1,
      biome: round.course.theme,
      contentVersion: 1,
      climate: {
        phenologyRegime: "temperate-four-season",
        exposure: "moderate",
      },
    });
  });

  it("freezes fine contours, program, and local condition for the active round", () => {
    const course = threeHoleCourse();
    const target = course.holes[0].green!;
    course.greenSurface = normalizeGreenSurfaceV1({ tiles: [{
      x: target.x,
      y: target.y,
      offsets: Array.from({ length: 16 }, (_, index) => index - 8),
    }] }, course);
    course.greenProgram = createGreenProgram("championship");
    course.greenLocalState = normalizeGreenLocalState({ holes: [{
      holeId: "hole-1",
      health: 0.82,
      moisture: 0.43,
      compaction: 0.31,
      wear: 0.24,
    }] }, course);
    const result = startPlayableRound({ course, world: world(), layoutId: "slice" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const frozen = structuredClone(result.round.course.greenSnapshot!);
    expect(frozen.geometryVersion).toBe(greenGeometryVersion(course));
    expect(frozen.program.preset).toBe("championship");
    expect(frozen.localState.holes.find((hole) => hole.holeId === "hole-1")).toMatchObject({
      health: 0.82,
      moisture: 0.43,
      compaction: 0.31,
      wear: 0.24,
    });

    course.greenSurface.tiles[0].offsets[0] = 777;
    course.greenProgram.targetSpeedFeet = 6;
    course.greenLocalState.holes[0].health = 0;
    expect(result.round.course.greenSnapshot).toEqual(frozen);
  });

  it("restores active-round biome evidence through autosave and exported-file import", async () => {
    const { course, world: currentWorld, career, round } = started();
    const sourceWorld = {
      ...currentWorld,
      playerPro: { ...career, activeRound: round },
    };
    __resetSaveStoreForTests();
    const saved = await autosave({ course, world: sourceWorld });
    const text = await exportSlot(saved.id);
    expect(text).not.toBeNull();

    __resetSaveStoreForTests();
    const imported = await importSave(text!, "Active round import");
    expect(imported).not.toBeNull();
    const restored = await loadSlot(imported!.id);
    expect(restored?.world.playerPro?.activeRound?.course).toMatchObject({
      theme: round.course.theme,
      biomeCompatibility: round.course.biomeCompatibility,
      greenSnapshot: round.course.greenSnapshot,
    });
    expect(restored?.world.playerPro?.activeRound?.rngSeed).toBe(round.rngSeed);
    expect(restored?.world.playerPro?.activeRound?.rngCursor).toBe(round.rngCursor);
  });

  it("resolves identical selections and seeds byte-equivalently without replacing the target", () => {
    const { career, round } = started();
    const args = {
      snapshot: round.course,
      holeId: round.course.holes[0].id,
      shotNumber: 1,
      from: round.ball,
      lie: round.lie,
      skills: career.skills,
      selection: { club: "Driver", aim: { x: 34, y: 10 }, power: 0.86, technique: "normal" as const },
      seed: 99177,
    };
    const first = resolvePlayableShot(args);
    const second = resolvePlayableShot(args);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.aim).toEqual({ x: 34, y: 10 });
    expect(first.carryYards).toBeGreaterThan(0);
    expect(first.lieAfter).toBeTruthy();
    expect(first.evidence.some((item) => item.skill === "driving")).toBe(true);
  });

  it("forwards the frozen course obstacle context into the shared outcome", () => {
    const { career, round } = started();
    const args = {
      snapshot: round.course,
      holeId: round.course.holes[0].id,
      shotNumber: 1,
      from: round.ball,
      lie: round.lie,
      skills: career.skills,
      selection: { club: "Driver", aim: { x: 34, y: 10 }, power: 0.86, technique: "normal" as const },
      seed: 99177,
    };
    const clear = resolvePlayableShot(args);
    const obstructed = resolvePlayableShot({
      ...args,
      snapshot: {
        ...round.course,
        obstacles: [{ type: "rock", x: Math.round(clear.landing.x), y: Math.round(clear.landing.y) }],
      },
    });

    expect(obstructed.sharedOutcome?.collision).toMatchObject({ kind: "obstacle", obstacleType: "rock" });
    expect(obstructed.sharedOutcome?.flight.clearance[0]).toMatchObject({ obstacleType: "rock" });
  });

  it("uses one preview contract for continuous power, lie blockers, hazards, and committed shots", () => {
    const { career, round } = started();
    const low = previewPlayableShot(round, career.skills, { club: "Driver", aim: { x: 34, y: 10 }, power: 0.45, technique: "normal" });
    const high = previewPlayableShot(round, career.skills, { club: "Driver", aim: { x: 34, y: 10 }, power: 1, technique: "normal" });
    expect(low.carryYards).toBeLessThan(high.carryYards);
    expect(low.targetYards).toBe(high.targetYards);
    const committed = commitPlayerShot(round, career.skills, { club: "Driver", aim: { x: 34, y: 10 }, power: 0.86, technique: "normal" });
    expect(committed.phase).toBe("flight");
    expect(committed.pendingShot?.aim).toEqual({ x: 34, y: 10 });
    const landed = finishPlayerShot(committed);
    expect(landed.strokes).toBe(1);
    expect(landed.shots).toHaveLength(1);

    const bunkerRound = { ...round, lie: "sand", ball: { x: 15, y: 7 } };
    expect(previewPlayableShot(bunkerRound, career.skills, { club: "Driver", aim: { x: 35, y: 7 }, power: 1, technique: "normal" }).blocker).toBe("lie:sand");
    expect(previewPlayableShot(round, career.skills, { club: "Driver", aim: { x: 24, y: 5 }, power: 0.7, technique: "normal" }).expectedPenalty).toBeGreaterThan(0);

    const obstructedRound = {
      ...round,
      course: {
        ...round.course,
        obstacles: [{ type: "tree", x: round.ball.x + 1, y: round.ball.y }],
      },
    };
    const obstructed = previewPlayableShot(obstructedRound, career.skills, { club: "Driver", aim: { x: 35, y: 7 }, power: 1, technique: "normal" });
    expect(obstructed.available).toBe(true);
    expect(obstructed.risk).toBe("high");
    expect(obstructed.dispersionTiles).toBeGreaterThan(high.dispersionTiles);
    expect(commitPlayerShot(obstructedRound, career.skills, { club: "Driver", aim: { x: 35, y: 7 }, power: 1, technique: "normal" }).phase).toBe("flight");
  });

  it("keeps preview and execution on one deterministic flight-profile/effects contract", () => {
    const { career, round } = started();
    const selection = { club: "Driver", aim: { x: 34, y: 10 }, power: 0.86, technique: "normal" as const };
    const preview = previewPlayableShot(round, career.skills, selection);
    const committed = commitPlayerShot(round, career.skills, selection);
    expect(preview.flightProfile).toBe("standard");
    expect(committed.pendingShot?.flightProfile).toBe("standard");
    expect(committed.pendingShot?.sharedOutcome?.requestedCarryYards).toBeCloseTo(preview.carryYards, 5);
    expect(committed.pendingShot?.sharedOutcome?.ruling).toMatchObject({ status: "penalty", penaltyStrokes: 1 });
    expect(preview.sharedOutcome).toEqual(committed.pendingShot?.sharedOutcome);
    expect(preview.greenRollout).toEqual(committed.pendingShot?.greenRollout);
    expect(preview.sharedOutcome).toMatchObject({
      lieEffect: { sourceLie: "tee", effectiveLie: "tee" },
      flight: { profile: "standard", apexHeightYards: expect.any(Number), clearance: expect.any(Array) },
      collision: { kind: expect.stringMatching(/^(none|terrain|obstacle)$/) },
      ruling: { status: expect.stringMatching(/^(in_play|holed|penalty)$/) },
      relief: { type: expect.any(String) },
      finalPosition: expect.any(Object),
    });

    const punch = previewPlayableShot(round, { ...career.skills, recovery: 70 }, {
      club: "Driver", aim: { x: 34, y: 10 }, power: 0.86, technique: "punch",
    });
    expect(punch.flightProfile).toBe("low");
    const blockedPunch = previewPlayableShot(round, { ...career.skills, recovery: 70 }, {
      club: "Driver", aim: { x: 34, y: 10 }, power: 0.86, technique: "punch", flightProfile: "high",
    });
    expect(blockedPunch).toMatchObject({ available: false, blocker: "technique_requires_low_flight", sharedOutcome: null });
    const flop = previewPlayableShot(round, { ...career.skills, shortGame: 70 }, {
      club: "Pitching Wedge", aim: { x: 34, y: 10 }, power: 0.7, technique: "flop",
    });
    expect(flop.flightProfile).toBe("high");
    const blockedFlop = previewPlayableShot(round, { ...career.skills, shortGame: 70 }, {
      club: "Pitching Wedge", aim: { x: 34, y: 10 }, power: 0.7, technique: "flop", flightProfile: "low",
    });
    expect(blockedFlop).toMatchObject({ available: false, blocker: "technique_requires_high_flight", sharedOutcome: null });
  });

  it("snapshots routing, resumes through schema v14, and drops only malformed optional rounds", () => {
    const { course, world: currentWorld, career, round } = started();
    const original = JSON.stringify(round.course);
    course.tiles.fill("water");
    course.holes.reverse();
    expect(JSON.stringify(round.course)).toBe(original);

    const save = normalizeLoadedSaveResult({
      schemaVersion: 14,
      savedAt: 1,
      course: threeHoleCourse(),
      world: { ...currentWorld, playerPro: { ...career, activeRound: round } },
    });
    expect(save.ok).toBe(true);
    if (!save.ok) return;
    expect(save.payload.world.playerPro?.identity.id).toBe(career.identity.id);
    expect(JSON.stringify(save.payload.world.playerPro?.activeRound)).toBe(JSON.stringify(round));

    const malformed = normalizeLoadedSaveResult({
      schemaVersion: 14,
      savedAt: 1,
      course: threeHoleCourse(),
      world: { ...currentWorld, playerPro: { ...career, activeRound: { version: 99, id: "future" } } },
    });
    expect(malformed.ok).toBe(true);
    if (malformed.ok) {
      expect(malformed.payload.world.playerPro?.identity.id).toBe(career.identity.id);
      expect(malformed.payload.world.playerPro?.activeRound).toBeNull();
    }

    const committed = commitPlayerShot(round, career.skills, {
      club: "Driver",
      aim: { x: 34, y: 10 },
      power: 0.86,
      technique: "normal",
    });
    const hostileOutcome = {
      ...committed,
      pendingShot: committed.pendingShot && {
        ...committed.pendingShot,
        sharedOutcome: committed.pendingShot.sharedOutcome && {
          ...committed.pendingShot.sharedOutcome,
          flight: {
            ...committed.pendingShot.sharedOutcome.flight,
            apexHeightYards: Number.NaN,
          },
        },
      },
    };
    const historicalRound = {
      id: "historical",
      kind: "casual" as const,
      courseId: "course-primary",
      courseName: "History",
      week: 1,
      strokes: 4,
      penalties: 0,
      par: 4,
      scoreToPar: 0,
      result: "complete" as const,
      earnings: 0,
      scorecard: [],
      shots: [{ id: "legacy-history", seed: 9 }],
      evidence: [],
      skillGains: {},
    };
    const hostileNormalized = normalizePlayerPro({
      ...career,
      activeRound: hostileOutcome,
      rounds: [historicalRound],
    }, { seed: 1 });
    expect(hostileNormalized.activeRound).toBeNull();
    expect(hostileNormalized.rounds[0].shots).toEqual(historicalRound.shots);

    expect(normalizePlayerPro({
      ...career,
      activeRound: { ...round, course: { ...round.course, holes: "hostile" } },
    }, { seed: 1 }).activeRound).toBeNull();
  });

  it("auto-finishes with the same shot resolver and settles progression exactly once", () => {
    const { career, round } = started();
    const completed = autoFinishPlayerRound(round, career.skills);
    expect(completed.phase).toBe("round_complete");
    expect(completed.scorecard.every((hole) => hole.complete)).toBe(true);
    expect(completed.shots.length).toBeGreaterThan(completed.scorecard.length);
    const settled = settlePlayerRound(career, completed);
    expect(settled.round?.evidence.length).toBeGreaterThan(0);
    expect(settled.career.rounds).toHaveLength(1);
    expect(settled.career.careerPoints).toBeGreaterThan(0);
    const duplicate = settlePlayerRound(settled.career, completed);
    expect(duplicate.round).toBeNull();
    expect(duplicate.cashDelta).toBe(0);
    expect(duplicate.career.rounds).toHaveLength(1);
  });

  it("uses one frozen elevation adjustment for Player Pro preview and committed physical carry", () => {
    const { career, round } = started();
    const selection = { club: "Driver", aim: { x: 60, y: round.ball.y }, power: 0.9, technique: "normal" as const };
    const variant = (rise: number) => {
      const elevations = round.course.elevations.slice();
      if (rise > 0) elevations[Math.round(selection.aim.y) * round.course.width + Math.round(selection.aim.x)] = rise;
      if (rise < 0) elevations[Math.round(round.ball.y) * round.course.width + Math.round(round.ball.x)] = -rise;
      return { ...round.course, elevations };
    };
    const args = {
      holeId: round.course.holes[0].id,
      shotNumber: 1,
      from: round.ball,
      lie: round.lie,
      skills: career.skills,
      selection,
      seed: 632_001,
    };
    const uphill = resolvePlayableShot({ ...args, snapshot: variant(8) });
    const flat = resolvePlayableShot({ ...args, snapshot: variant(0) });
    const downhill = resolvePlayableShot({ ...args, snapshot: variant(-8) });

    expect(uphill.shotSlope).toMatchObject({ targetElevationDelta: 8, playsLikeDistanceYards: 570 });
    expect(flat.shotSlope).toMatchObject({ targetElevationDelta: 0, playsLikeDistanceYards: 550 });
    expect(downhill.shotSlope).toMatchObject({ targetElevationDelta: -8, playsLikeDistanceYards: 530 });
    expect(uphill.landing.x).toBeCloseTo(flat.landing.x - 2, 3);
    expect(downhill.landing.x).toBeCloseTo(flat.landing.x + 2, 3);
    expect(uphill.carryYards).toBeLessThan(flat.carryYards);
    expect(flat.carryYards).toBeLessThan(downhill.carryYards);
    expect(uphill.sharedOutcome?.requestedCarryYards).toBe(flat.sharedOutcome?.requestedCarryYards);
    expect(downhill.sharedOutcome?.requestedCarryYards).toBe(flat.sharedOutcome?.requestedCarryYards);
    expect(uphill.sharedOutcome?.effectiveCarryYards).not.toBe(uphill.sharedOutcome?.requestedCarryYards);

    const uphillRound = { ...round, course: variant(8) };
    const preview = previewPlayableShot(uphillRound, career.skills, selection);
    const committed = commitPlayerShot(uphillRound, career.skills, selection);
    expect(preview.targetYards).toBe(570);
    expect(preview.sharedOutcome).toEqual(committed.pendingShot?.sharedOutcome);
    expect(committed.pendingShot?.shotSlope).toEqual(uphill.shotSlope);
  });

  it("uses plays-like distance for caddie club/power and autoplay selection", () => {
    const { career, round } = started();
    const ball = { x: 18, y: round.ball.y };
    const pin = round.course.holes[0].pin;
    const variant = (rise: number) => {
      const elevations = round.course.elevations.slice();
      if (rise > 0) elevations[pin.y * round.course.width + pin.x] = rise;
      if (rise < 0) elevations[ball.y * round.course.width + ball.x] = -rise;
      return { ...round, ball, lie: "fairway", course: { ...round.course, elevations } };
    };
    const downhillRound = variant(-12);
    const flatRound = variant(0);
    const uphillRound = variant(12);
    const downhill = caddieRecommendation(downhillRound, career.skills);
    const flat = caddieRecommendation(flatRound, career.skills);
    const uphill = caddieRecommendation(uphillRound, career.skills);
    const nominal = new Map([
      ["Driver", 270], ["3 Wood", 235], ["5 Iron", 185], ["7 Iron", 155],
      ["Pitching Wedge", 115], ["Sand Wedge", 78], ["Chip", 38], ["Putter", 28],
    ]);

    expect(nominal.get(uphill.club)).toBeGreaterThan(nominal.get(flat.club)!);
    expect(nominal.get(flat.club)).toBeGreaterThan(nominal.get(downhill.club)!);
    expect(new Set([
      `${downhill.club}:${downhill.power}`,
      `${flat.club}:${flat.power}`,
      `${uphill.club}:${uphill.power}`,
    ]).size).toBe(3);
    expect(uphill.power).not.toBe(downhill.power);

    const completed = autoFinishPlayerRound(uphillRound, career.skills);
    expect(completed.shots[0]).toMatchObject({
      club: uphill.club,
      power: uphill.power,
      aim: uphill.aim,
    });
  });

  it.each([9, 18] as const)("completes and resumes the %i-hole certification route without duplicated settlement", (holeCount) => {
    const course = certifiedCourse(holeCount);
    const currentWorld = world();
    const startedRound = startPlayableRound({
      course,
      world: currentWorld,
      layoutId: `cert-${holeCount}`,
      teeSet: "member",
      pinRotation: "A",
    });
    expect(startedRound.ok).toBe(true);
    if (!startedRound.ok) return;
    const completed = autoFinishPlayerRound(startedRound.round, currentWorld.playerPro!.skills);
    expect(completed.phase).toBe("round_complete");
    expect(completed.scorecard).toHaveLength(holeCount);
    expect(completed.scorecard.every((hole) => hole.complete)).toBe(true);
    expect(new Set(completed.shots.map((shot) => shot.id)).size).toBe(completed.shots.length);
    const settlement = settlePlayerRound(currentWorld.playerPro!, completed);
    expect(settlement.career.rounds).toHaveLength(1);
    const saved = normalizeLoadedSaveResult({
      schemaVersion: 14,
      savedAt: 1,
      course,
      world: { ...currentWorld, playerPro: settlement.career },
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.payload.world.playerPro?.rounds[0]?.scorecard).toHaveLength(holeCount);
    expect(settlePlayerRound(saved.payload.world.playerPro!, completed).round).toBeNull();
  });
});

describe("M37 growth, training, matches, and tournaments", () => {
  it("shows exact technique gates and unlocks shapes only from earned skills", () => {
    const career = createDefaultPlayerPro({ seed: 1 });
    const locked = playerTechniqueCatalog(career.skills);
    expect(locked.find((item) => item.technique === "flop")).toMatchObject({ unlocked: false, requirement: "shortGame:55" });
    const skilled = { ...career, skills: { ...career.skills, driving: 60, irons: 70, shortGame: 70, recovery: 60 } };
    expect(playerTechniqueCatalog(skilled.skills).every((item) => item.unlocked)).toBe(true);
  });

  it("requires an open facility and coach, consumes cash, caps sessions, and awards bounded evidence", () => {
    const course = { ...threeHoleCourse(), property: starterPropertyCourse() };
    course.property!.assets.push({
      id: "range",
      kind: "driving_range",
      name: "Learning Range",
      category: "practice",
      tier: 1,
      x: 2,
      y: 2,
      width: 12,
      height: 5,
      capacity: 20,
      condition: 1,
      price: 20,
      enabled: true,
      openHour: 7,
      closeHour: 20,
    });
    const currentWorld = world();
    let options = playerTrainingOptions(course, currentWorld, 0, 600);
    expect(options.every((option) => option.blocker === "coach")).toBe(true);
    currentWorld.staffRoster = [{ id: "coach", name: "Morgan", role: "club_pro", shiftStart: 0, shiftEnd: 840, weeklyWage: 500 }];
    options = playerTrainingOptions(course, currentWorld, 0, 600);
    const driving = options.find((option) => option.skill === "driving")!;
    expect(driving.available).toBe(true);
    const first = completePlayerTraining(currentWorld.playerPro!, currentWorld, driving, 0);
    expect(first.cost).toBeGreaterThan(0);
    expect(first.career.training).toHaveLength(1);
    expect(first.career.skillXp.driving).toBe(4);
    const trainedWorld = { ...currentWorld, playerPro: first.career };
    const secondOption = playerTrainingOptions(course, trainedWorld, 0, 600).find((option) => option.skill === "irons")!;
    const second = completePlayerTraining(first.career, trainedWorld, secondOption, 0);
    const cappedWorld = { ...trainedWorld, playerPro: second.career };
    expect(playerTrainingOptions(course, cappedWorld, 0, 600).every((option) => option.blocker === "daily_cap")).toBe(true);
  });

  it("settles friendly/wager matches and tournament prizes atomically", () => {
    const { course, world: currentWorld, career, round } = started();
    const opponent = { id: "regular-1", name: "Jamie Park", skill: 0.45, relationship: 10 };
    const challenge = createPlayerChallenge(career, opponent, "wager", 100);
    const matchRound = {
      ...round,
      kind: "wager" as const,
      opponent: { id: opponent.id, name: opponent.name, skill: opponent.skill, relationshipDelta: 0, wager: 100, projectedStrokes: 999 },
    };
    const completedMatch = autoFinishPlayerRound(matchRound, challenge.career.skills);
    const activeCareer = activatePlayerChallenge(challenge.career, challenge.challenge.id, completedMatch.id);
    const matchSettlement = settlePlayerRound(activeCareer, completedMatch);
    expect(matchSettlement.cashDelta).toBe(100);
    expect(matchSettlement.career.challenges[0]).toMatchObject({ status: "complete", result: "won", settled: true });
    expect(settlePlayerRound(matchSettlement.career, completedMatch).cashDelta).toBe(0);

    const event: TournamentEvent = {
      id: "event-1",
      name: "Slice Open",
      tier: "local",
      courseId: "slice",
      scheduledWeek: 1,
      scheduledDay: 0,
      status: "scheduled",
      bookingCost: 0,
      revenueAward: 6_000,
      reputationAward: 2,
      field: [
        { id: "a", name: "A", archetype: "casual", skill: 0.2 },
        { id: "b", name: "B", archetype: "casual", skill: 0.25 },
      ],
      teeSet: "member",
      pinRotation: "A",
    };
    expect(playerTournamentEligibility(career, event).eligible).toBe(true);
    const registered = registerPlayerTournament(career, event);
    expect(registered.tournaments[0].status).toBe("registered");
    const tournamentRound = autoFinishPlayerRound({ ...round, kind: "tournament", tournamentId: event.id, tournamentName: event.name }, registered.skills);
    const tournamentSettlement = settlePlayerRound(registered, tournamentRound, event);
    expect(tournamentSettlement.career.tournaments[0]).toMatchObject({ status: "complete", settled: true });
    expect(tournamentSettlement.tournamentEvent).toMatchObject({
      status: "completed",
      field: expect.arrayContaining([expect.objectContaining({ id: career.identity.id, name: career.identity.name, archetype: "pro" })]),
      results: expect.arrayContaining([expect.objectContaining({ entrantId: career.identity.id, name: career.identity.name, finished: true })]),
    });
    expect(tournamentSettlement.tournamentEvent?.winnerName).toBe(tournamentSettlement.tournamentEvent?.results?.[0]?.name);
    expect(tournamentSettlement.cashDelta).toBeGreaterThanOrEqual(0);
    expect(tournamentSettlement.career.settlementLedger).toContain(`round:${tournamentRound.id}`);
    expect(currentWorld.cash).toBe(10_000);
    expect(course.layouts?.[0].publishedHoleIds).toHaveLength(3);
  });

  it("normalizes one stable neutral identity for every legacy game", () => {
    const legacy = normalizePlayerPro(null, { seed: 77 });
    const again = normalizePlayerPro(null, { seed: 77 });
    expect(legacy.identity).toEqual(again.identity);
    expect(legacy.identity.id).toBe("player-pro-77");
    expect(Object.values(legacy.skills).every((value) => value >= 40 && value <= 44)).toBe(true);
  });
});
