import { describe, expect, it } from "vitest";
import { buildArchitectureReview, defaultArchitectureFilters } from "../architecture/review";
import { DEFAULT_WORLD } from "../models/defaults";
import type { Course, World } from "../models/types";
import { createDefaultPlayerPro, autoFinishPlayerRound, startPlayableRound } from "../playerPro/playerPro";
import { settlePlayerRound } from "../playerPro/playerProSettlement";
import type { CompletedRound } from "../retention/types";
import { createPlayerProReferenceCourse } from "../testing/referenceCourse";
import { hasOnDutyStaff } from "../live/pace";
import { normalizeLoadedSaveResult } from "../../utils/save";
import { STORY_DEFINITION_BY_ID, SYSTEMIC_EVENT_DEFINITIONS, validateStoryDefinitions } from "./content";
import {
  acknowledgeStoryEvent,
  advanceLivingClubDay,
  applyStaffCommand,
  courseGeometryVersion,
  normalizeLivingClub,
  normalizeStaffCharacter,
  recordLivingClubRound,
  recordPlayerRoundArchitecture,
  resolveStoryChoice,
  setReturnToDesignContext,
} from "./livingClub";

function completedRound(course: Course, visit: number, shots = 6): CompletedRound {
  const holes = course.holes.filter((hole) => hole.id && hole.tee && hole.green);
  return {
    golferId: 38,
    golferName: "Morgan Links",
    archetype: "lowHandicap",
    score: 36 + visit,
    scoreToPar: visit - 2,
    holePar: holes.map(() => 4),
    holeStrokes: holes.map(() => 4),
    mood: 0.88,
    courseId: course.activeCourseId,
    courseName: course.name,
    holeIds: holes.map((hole) => hole.id!),
    teeSet: "member",
    waitMinutes: 7,
    shots: Array.from({ length: shots }, (_, index) => {
      const hole = holes[index % holes.length];
      const from = hole.tee!;
      const green = hole.green!;
      const amount = (index % 3 + 1) / 4;
      return {
        id: `shot-${visit}-${index}`,
        holeId: hole.id!,
        shotNumber: index % 3 + 1,
        shotType: index % 3 === 0 ? "drive" as const : index % 3 === 1 ? "approach" as const : "recovery" as const,
        from: { x: from.x + index % 2, y: from.y },
        landing: { x: from.x + (green.x - from.x) * amount, y: from.y + (green.y - from.y) * amount },
        rest: { x: from.x + (green.x - from.x) * amount + 0.4, y: from.y + (green.y - from.y) * amount },
        lieBefore: index % 3 === 2 ? "rough" : "fairway",
        lieAfter: index % 3 === 2 ? "sand" : "fairway",
      };
    }),
  };
}

function promotedWorld(course: Course): World {
  const base: World = {
    ...DEFAULT_WORLD,
    runSeed: 380038,
    staffRoster: DEFAULT_WORLD.staffRoster?.map((member) => ({ ...member })),
  };
  const once = recordLivingClubRound(base, course, completedRound(course, 1), 1);
  return recordLivingClubRound(once, course, completedRound(course, 2), 4);
}

describe("M38 living club and architecture certification", () => {
  it("ships a valid 20+ event pack and six deterministic multi-stage chains", () => {
    expect(validateStoryDefinitions()).toEqual([]);
    expect(SYSTEMIC_EVENT_DEFINITIONS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(SYSTEMIC_EVENT_DEFINITIONS.map((event) => event.category)).size).toBeGreaterThanOrEqual(8);
    const chains = new Map<string, Set<number>>();
    for (const event of SYSTEMIC_EVENT_DEFINITIONS) {
      if (!event.chainId) continue;
      const stages = chains.get(event.chainId) ?? new Set<number>();
      stages.add(event.stage ?? 1);
      chains.set(event.chainId, stages);
    }
    expect(chains.size).toBeGreaterThanOrEqual(6);
    expect([...chains.values()].every((stages) => stages.size >= 2)).toBe(true);
  });

  it("promotes returning golfers once, preserves their identity, and captures factual shot evidence", () => {
    const course = createPlayerProReferenceCourse();
    const once = recordLivingClubRound(DEFAULT_WORLD, course, completedRound(course, 1), 1);
    expect(normalizeLivingClub(once.livingClub).regulars).toHaveLength(0);
    const twice = recordLivingClubRound(once, course, completedRound(course, 2), 4);
    const living = normalizeLivingClub(twice.livingClub);
    expect(living.regulars).toHaveLength(1);
    expect(living.regulars[0]).toMatchObject({ name: "Morgan Links", visits: 2, rounds: 2 });
    expect(living.architecture.evidence.length).toBe(12);
    const third = recordLivingClubRound(twice, course, completedRound(course, 3), 5);
    expect(normalizeLivingClub(third.livingClub).regulars[0].id).toBe(living.regulars[0].id);
    expect(new Set(normalizeLivingClub(third.livingClub).regulars.map((regular) => regular.id)).size).toBe(1);
  });

  it("separates current and historical geometry without relabeling stale evidence", () => {
    const course = createPlayerProReferenceCourse();
    const world = promotedWorld(course);
    const filters = { ...defaultArchitectureFilters(course), recency: "all" as const };
    const current = buildArchitectureReview(course, world, filters);
    expect(current.currentEvidence).toBeGreaterThan(0);
    expect(current.overlay.traces.length).toBeGreaterThan(0);

    const edited = { ...course, tiles: [...course.tiles] };
    edited.tiles[0] = edited.tiles[0] === "water" ? "rough" : "water";
    expect(courseGeometryVersion(edited)).not.toBe(courseGeometryVersion(course));
    const stale = buildArchitectureReview(edited, world, { ...filters, recency: "current" });
    expect(stale.status).toBe("stale-only");
    expect(stale.currentEvidence).toBe(0);
    const historical = buildArchitectureReview(edited, world, filters);
    expect(historical.historicalEvidence).toBeGreaterThan(0);
    expect(historical.overlay.traces.every((trace) => !trace.current)).toBe(true);
  });

  it("snapshots Player Pro architecture and restores an exact Return to Design context", () => {
    const course = createPlayerProReferenceCourse();
    const world: World = {
      ...DEFAULT_WORLD,
      runSeed: 383838,
      playerPro: createDefaultPlayerPro({ seed: 383838, name: "Alex Architect" }),
    };
    const started = startPlayableRound({ course, world, layoutId: "player-pro-slice", teeSet: "member", pinRotation: "A", day: 2 });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const completed = autoFinishPlayerRound(started.round, world.playerPro!.skills);
    const settlement = settlePlayerRound(world.playerPro!, completed);
    expect(settlement.round).toBeTruthy();
    const recorded = recordPlayerRoundArchitecture(world, completed, settlement.round!);
    expect(recorded.careerRound.geometryVersion).toBeTruthy();
    expect(recorded.careerRound.holeSnapshots).toEqual(completed.course.holes);
    expect(normalizeLivingClub(recorded.world.livingClub).architecture.evidence.length).toBe(completed.shots.length);
    const review = buildArchitectureReview(course, recorded.world, {
      ...defaultArchitectureFilters(course),
      sourceSegment: "player-pro",
    });
    expect(review.currentEvidence).toBe(completed.shots.length);
    expect(review.historicalEvidence).toBe(0);
    expect(review.evidence.every((item) => item.shotSlope && item.slopeExplanation)).toBe(true);
    expect(review.evidence.every((item) => item.physicalRest)).toBe(true);
    expect(review.overlay.traces.some((trace) => trace.label?.includes("plays-like:"))).toBe(true);

    const lastShot = completed.shots.at(-1)!;
    const returned = setReturnToDesignContext(recorded.world, completed, lastShot.id);
    expect(normalizeLivingClub(returned.livingClub).architecture.returnContext).toMatchObject({
      roundId: completed.id,
      shotId: lastShot.id,
      holeId: lastShot.holeId,
      point: lastShot.rest,
    });
  });

  it("resolves deterministic choices and callbacks exactly once from immutable fact snapshots", () => {
    const course = createPlayerProReferenceCourse();
    const world = promotedWorld(course);
    const first = advanceLivingClubDay(course, world, 6);
    const second = advanceLivingClubDay(course, world, 6);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    const pending = normalizeLivingClub(first.world.livingClub).story.instances.find((instance) => instance.status === "pending");
    expect(pending).toBeTruthy();
    const definition = STORY_DEFINITION_BY_ID.get(pending!.definitionId)!;
    const choice = definition.choices[0];
    const beforeCash = first.world.cash;
    const resolved = resolveStoryChoice(first.course, first.world, pending!.id, choice.id);
    expect(resolved.ok).toBe(true);
    const settled = normalizeLivingClub(resolved.world.livingClub);
    expect(settled.story.journal).toHaveLength(1);
    expect(settled.story.journal[0].facts).toEqual(pending!.facts);
    const duplicate = resolveStoryChoice(resolved.course, resolved.world, pending!.id, choice.id);
    expect(duplicate.ok).toBe(false);
    expect(duplicate.world.cash).toBe(resolved.world.cash);
    expect(resolved.world.cash - beforeCash).toBe(choice.effects.filter((effect) => effect.type === "cash").reduce((sum, effect) => sum + effect.amount, 0));
  });

  it("enriches legacy staff without payroll drift and applies staff commands atomically", () => {
    const legacy = DEFAULT_WORLD.staffRoster![0];
    const normalized = normalizeStaffCharacter(legacy, 0, 8);
    expect(normalized.weeklyWage).toBe(legacy.weeklyWage);
    expect(normalized.traits?.length).toBeGreaterThan(0);
    expect(normalized.proficiency).toBeGreaterThan(0);
    expect(applyStaffCommand({ ...DEFAULT_WORLD, staffRoster: [legacy] }, { type: "dismiss", staffId: legacy.id })).toMatchObject({ ok: false, reason: "minimum" });
    const hired = applyStaffCommand(DEFAULT_WORLD, { type: "hire", role: "marshal", courseId: "course-primary" });
    expect(hired.ok).toBe(true);
    expect(hired.world.cash).toBe(DEFAULT_WORLD.cash - 900);
    const marshal = hired.world.staffRoster!.find((member) => member.role === "marshal")!;
    expect(applyStaffCommand(hired.world, { type: "dismiss", staffId: legacy.id })).toMatchObject({ ok: false, reason: "minimum" });
    const trained = applyStaffCommand(hired.world, { type: "train", staffId: marshal.id });
    expect(trained.ok).toBe(true);
    expect(trained.world.staffRoster!.find((member) => member.id === marshal.id)!.proficiency).toBeGreaterThan(marshal.proficiency!);
  });

  it("commits a valid same-day shift once and rejects invalid coverage without mutation", () => {
    const course = createPlayerProReferenceCourse();
    const member = DEFAULT_WORLD.staffRoster![0];
    const base = { ...DEFAULT_WORLD, staffRoster: [{ ...member }] };
    const invalid = applyStaffCommand(base, { type: "schedule", staffId: member.id, shiftStart: 600, shiftEnd: 630 });
    expect(invalid).toMatchObject({ ok: false, reason: "shift", world: base });
    expect(invalid.world).toBe(base);

    const scheduled = applyStaffCommand(base, { type: "schedule", staffId: member.id, shiftStart: 150, shiftEnd: 660 });
    expect(scheduled.ok).toBe(true);
    expect(scheduled.world.staffRoster![0]).toMatchObject({ shiftStart: 150, shiftEnd: 660 });
    expect(scheduled.world.cash).toBe(base.cash);
    expect(hasOnDutyStaff(scheduled.world, member.role, member.courseId!, 149, course)).toBe(false);
    expect(hasOnDutyStaff(scheduled.world, member.role, member.courseId!, 150, course)).toBe(true);
    expect(hasOnDutyStaff(scheduled.world, member.role, member.courseId!, 661, course)).toBe(false);
    expect(applyStaffCommand(scheduled.world, { type: "schedule", staffId: member.id, shiftStart: 150, shiftEnd: 660 }).world).toBe(scheduled.world);
  });

  it("migrates schema 14 and keeps ten simulated years bounded and duplicate-free", () => {
    const course = createPlayerProReferenceCourse();
    let world = promotedWorld(course);
    let evolvingCourse = course;
    for (let week = 1; week <= 520; week++) {
      world = { ...world, week };
      for (let day = 0; day < 7; day++) {
        const advanced = advanceLivingClubDay(evolvingCourse, world, day);
        evolvingCourse = advanced.course;
        world = advanced.world;
        const pending = normalizeLivingClub(world.livingClub).story.instances.find((instance) => ["pending", "presented", "deferred"].includes(instance.status));
        if (!pending) continue;
        const definition = STORY_DEFINITION_BY_ID.get(pending.definitionId)!;
        const resolved = resolveStoryChoice(evolvingCourse, world, pending.id, definition.defaultChoiceId);
        evolvingCourse = resolved.course;
        world = resolved.world;
      }
    }
    const living = normalizeLivingClub(world.livingClub);
    expect(living.regulars.length).toBeLessThanOrEqual(24);
    expect(living.architecture.evidence.length).toBeLessThanOrEqual(480);
    expect(living.story.instances.length).toBeLessThanOrEqual(80);
    expect(living.story.instances.length).toBeGreaterThanOrEqual(6);
    expect(living.story.instances.length / 520).toBeLessThan(0.1);
    expect(living.story.journal.length).toBeLessThanOrEqual(120);
    expect(living.story.callbacks.length).toBeLessThanOrEqual(24);
    expect(new Set(living.story.instances.map((instance) => instance.id)).size).toBe(living.story.instances.length);
    expect(new Set(living.story.journal.map((entry) => entry.eventInstanceId)).size).toBe(living.story.journal.length);
    expect(JSON.stringify(living).length).toBeLessThan(700_000);

    const migrated = normalizeLoadedSaveResult({
      schemaVersion: 14,
      savedAt: 1,
      course,
      world: { ...DEFAULT_WORLD, livingClub: undefined },
    });
    expect(migrated.ok).toBe(true);
    if (migrated.ok) {
      expect(migrated.migratedFrom).toBe(14);
      expect(normalizeLivingClub(migrated.payload.world.livingClub).version).toBe(1);
    }
  });

  it("persists presentation state without changing story facts", () => {
    const course = createPlayerProReferenceCourse();
    const advanced = advanceLivingClubDay(course, promotedWorld(course), 2);
    const pending = normalizeLivingClub(advanced.world.livingClub).story.instances[0];
    const presented = acknowledgeStoryEvent(advanced.world, pending.id);
    const deferred = acknowledgeStoryEvent(presented, pending.id, true);
    const instance = normalizeLivingClub(deferred.livingClub).story.instances[0];
    expect(instance.status).toBe("deferred");
    expect(instance.facts).toEqual(pending.facts);
  });

  it("drops malformed optional history instead of invalidating a save", () => {
    const normalized = normalizeLivingClub({
      version: 99,
      regulars: [{ id: "", name: "" }],
      story: { instances: [{ id: "bad", definitionId: "unknown" }], callbacks: [{ id: "bad" }], journal: [{ id: "bad" }] },
      architecture: {
        evidence: [{ id: "bad", courseId: "course", holeId: "hole", geometryVersion: "g-x", from: {}, landing: {}, rest: {} }],
        revisions: [{ id: "bad" }],
        returnContext: { roundId: "round", holeId: "hole", courseId: "course", point: null },
      },
    });
    expect(normalized).toMatchObject({
      version: 1,
      regulars: [],
      story: { instances: [], callbacks: [], journal: [] },
      architecture: { evidence: [], revisions: [], returnContext: null },
    });
  });
});
