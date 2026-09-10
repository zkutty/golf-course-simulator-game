import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import { createInvitedPreviewEvidence } from "./invitedPreview";
import { compareOpening, diagnoseOpening, freezeOpeningContext, hasOpeningEdit, newOpeningDemo, normalizeOpeningDemo, openingPenaltyTotal, openingPlaybackFrame, openingRiskLeave, openingShots, openingTargetCells, openingTargetTiles, retestOpening } from "./openingDemo";
import { validHoleCount } from "./invitedPreview";
import { advanceTutorialProgress, claimTutorialPreviewReward, createTutorialProgress, normalizeTutorialProgress, restartTutorialProgress, tutorialCanAdvance, tutorialStep } from "./tutorial";
import { CURRENT_SAVE_SCHEMA_VERSION, normalizeLoadedSave } from "../../utils/save";

function fixture() {
  const course = structuredClone(DEFAULT_COURSE);
  for (let x = 12; x <= 30; x++) course.tiles[12 * course.width + x] = "fairway";
  course.tiles[12 * course.width + 12] = "tee";
  for (let y = 11; y <= 13; y++) for (let x = 29; x <= 31; x++) course.tiles[y * course.width + x] = "green";
  course.holes[0] = { ...course.holes[0], tee: { x: 12, y: 12 }, green: { x: 30, y: 12 }, parMode: "MANUAL", parManual: 3 };
  const world = structuredClone(DEFAULT_WORLD);
  return { course, world, onCourse: 0 };
}

describe("ZK-1106 optional private operator opening", () => {
  it("plays the whole state-machine spine without reawarding or changing private simulation state", () => {
    const context = fixture();
    const unchanged = JSON.stringify(context);
    const fresh = { ...createTutorialProgress(context.course, context.world), opening: newOpeningDemo() };
    let progress = advanceTutorialProgress({ ...fresh, stage: "invite-group" }, context);
    const baseline = progress.receipts.preview.evidence!;
    expect(baseline.group).toHaveLength(2);
    expect(openingPenaltyTotal(baseline)).toBe(baseline.group.flatMap((golfer) => golfer.shots).reduce((total, shot) => total + shot.penaltyStrokes, 0));
    expect(progress.opening!.targetCells.length).toBeGreaterThan(0);
    expect(progress.opening!.targetCells.length).toBeLessThanOrEqual(4);
    expect(tutorialCanAdvance(progress, context)).toBe(false);
    progress = { ...progress, opening: { ...progress.opening!, cursor: openingShots(baseline).length } };
    progress = advanceTutorialProgress(progress, context);
    expect(progress.stage).toBe("review-reaction");
    const reward = claimTutorialPreviewReward(progress, context.course, context.world);
    expect(reward.applied).toBe(true);
    expect(JSON.stringify(context)).toBe(unchanged);
    progress = advanceTutorialProgress(reward.progress, { ...context, world: reward.world });
    expect(progress.stage).toBe("improve-hole");
    expect(tutorialCanAdvance(progress, context)).toBe(false);
    const revised = structuredClone(context.course);
    revised.tiles[progress.opening!.targetCells[0]] = "fairway";
    const edited = { ...context, course: revised, world: { ...reward.world, cash: reward.world.cash - 125 } };
    const economy = JSON.stringify(reward.world);
    progress = advanceTutorialProgress(progress, edited);
    expect(progress.stage).toBe("retest-play");
    expect(progress.receipts).toEqual(reward.progress.receipts);
    expect(progress.opening!.candidate!.holeFingerprint).not.toBe(baseline.holeFingerprint);
    expect(progress.opening!.comparison).toMatchObject({ terrainCost: 125, beforeFingerprint: baseline.holeFingerprint, afterFingerprint: progress.opening!.candidate!.holeFingerprint });
    expect(validHoleCount(context.course)).toBe(1);
    expect(validHoleCount(revised)).toBe(1);
    expect(progress.opening!.comparison!.measures.some((row) => row.riskBefore !== row.riskAfter || row.riskyLeavesBefore !== row.riskyLeavesAfter)).toBe(true);
    const widened = structuredClone(context.course);
    for (const cell of progress.opening!.targetCells) widened.tiles[cell] = "fairway";
    const widenedCandidate = retestOpening(widened, reward.world, baseline);
    expect(validHoleCount(widened)).toBe(1);
    expect(widenedCandidate).not.toBeNull();
    const beforeCohort = baseline.group.map(openingRiskLeave);
    const widenedCohort = widenedCandidate!.group.map(openingRiskLeave);
    expect(widenedCohort).not.toEqual(beforeCohort);
    progress = { ...progress, opening: { ...progress.opening!, cursor: 24 } };
    progress = advanceTutorialProgress(progress, edited);
    expect(progress.stage).toBe("compare-preview");
    expect(advanceTutorialProgress(progress, edited)).toMatchObject({ active: false, completion: "creative" });
    expect(JSON.stringify(reward.world)).toBe(economy);
    expect(claimTutorialPreviewReward({ ...progress, stage: "review-reaction" }, revised, reward.world).applied).toBe(false);
  });

  it("retests deterministically, keeps identities, and rejects a different seed or hole", () => {
    const { course, world } = fixture();
    const baseline = createInvitedPreviewEvidence(course, world)!;
    expect(retestOpening(course, world, baseline)).toEqual(baseline);
    const edited = structuredClone(course);
    const cells = openingTargetCells(course, baseline);
    edited.tiles[cells[0]] = "fairway";
    const a = retestOpening(edited, world, baseline)!;
    expect(retestOpening(edited, world, baseline)).toEqual(a);
    expect(a.group.map((golfer) => golfer.name)).toEqual(baseline.group.map((golfer) => golfer.name));
    expect(retestOpening(edited, { ...world, runSeed: world.runSeed + 1 }, baseline)).toBeNull();
    expect(retestOpening(edited, world, { ...baseline, holeId: "another-hole" })).toBeNull();
  });

  it("projects bounded moving frames from exact retained shot IDs and endpoints", () => {
    const { course, world } = fixture();
    const evidence = createInvitedPreviewEvidence(course, world)!;
    const shots = openingShots(evidence);
    expect(shots.length).toBeGreaterThan(1);
    expect(shots.every((marker) => marker.shotId === marker.shot.id && marker.previewId === evidence.id)).toBe(true);
    const start = openingPlaybackFrame(evidence, 0, 0)!;
    const flight = openingPlaybackFrame(evidence, 0, 0.4)!;
    const end = openingPlaybackFrame(evidence, 0, 1)!;
    expect(start.ball).toEqual(start.shot.from);
    expect(flight.ball).not.toEqual(start.ball);
    expect(end.ball).toEqual(end.shot.rest);
    expect(end.golfer).toEqual(end.shot.rest);
    expect([start.shot.from, start.landing, start.rest]).toEqual([start.shot.from, start.shot.landing, start.shot.rest]);
    expect(openingPlaybackFrame(evidence, shots.length, 0)).toMatchObject({ complete: true, index: shots.length - 1, progress: 1 });
  });

  it("diagnoses only a retained shot and region, then classifies truthful frozen comparisons", () => {
    const { course, world } = fixture();
    const baseline = createInvitedPreviewEvidence(course, world)!;
    const diagnosis = diagnoseOpening(course, baseline);
    expect(diagnosis).toMatchObject({ kind: "supported", previewId: baseline.id, shotId: expect.any(String), regionId: expect.stringContaining(baseline.holeId) });
    const context = freezeOpeningContext(baseline);
    const changed = { ...baseline, id: `${baseline.id}:candidate`, holeFingerprint: "1234abcd" };
    expect(compareOpening(baseline, changed, context, 140)).toMatchObject({ status: "neutral", terrainCost: 140, contextHash: context.hash });
    const positive = { ...changed, group: changed.group.map((golfer, index) => index === 0 ? { ...golfer, strokes: golfer.strokes - 1 } : golfer) };
    const negative = { ...changed, group: changed.group.map((golfer, index) => index === 0 ? { ...golfer, satisfaction: golfer.satisfaction - 1 } : golfer) };
    expect(compareOpening(baseline, positive, context, 140).status).toBe("positive");
    expect(compareOpening(baseline, negative, context, 140).status).toBe("negative");
    expect(compareOpening(baseline, baseline, context, null)).toMatchObject({ status: "no-meaningful-change", terrainCost: null });
    expect(compareOpening(baseline, { ...changed, runSeed: changed.runSeed + 1 }, context, 140).status).toBe("unsupported");
    expect(openingRiskLeave(baseline.group[0])).toMatchObject({ risk: expect.any(Number), riskyLeaves: expect.any(Number) });
    const generous = { ...course, tiles: course.tiles.map((terrain) => terrain === "rough" || terrain === "deep_rough" ? "fairway" as const : terrain) };
    expect(diagnoseOpening(generous, baseline)).toEqual({ kind: "none", previewId: baseline.id, reason: "no-supported-region" });
  });

  it("undo/canceled edits do not unlock retest, and targets never replace tee/green/hazards", () => {
    const { course, world } = fixture();
    const evidence = createInvitedPreviewEvidence(course, world)!;
    const opening = { ...newOpeningDemo(), targetCells: openingTargetCells(course, evidence) };
    expect(opening.targetCells.length).toBeGreaterThan(0);
    expect(opening.targetCells.every((i) => ["rough", "deep_rough"].includes(course.tiles[i]))).toBe(true);
    const diagnosis = diagnoseOpening(course, evidence);
    if (diagnosis.kind === "supported") expect(opening.targetCells[0]).toBe(Math.floor(diagnosis.anchor.y) * course.width + Math.floor(diagnosis.anchor.x));
    expect(hasOpeningEdit(course, opening)).toBe(false);
    const edited = structuredClone(course);
    edited.tiles[opening.targetCells[0]] = "fairway";
    expect(hasOpeningEdit(edited, opening)).toBe(true);
    expect(hasOpeningEdit(course, opening)).toBe(false);
  });

  it("keeps outlined target ids equal to the persisted paint authority", () => {
    const { course, world } = fixture();
    const evidence = createInvitedPreviewEvidence(course, world)!;
    const targetCells = openingTargetCells(course, evidence);
    const targets = openingTargetTiles(course, { ...newOpeningDemo(), targetCells });
    expect(targets.map((target) => target.id)).toEqual(targetCells);
    expect(targets.map((target) => target.y * course.width + target.x)).toEqual(targetCells);
    expect(targets.every((target) => course.tiles[target.id] === "rough" || course.tiles[target.id] === "deep_rough")).toBe(true);
    expect(tutorialStep({ ...createTutorialProgress(course, world), stage: "improve-hole", opening: { ...newOpeningDemo(), targetCells } }).allowedTargets).toEqual([
      "design-dock", "terrain-category", "fairway-card", "terrain-tool", "terrain-history", "course",
    ]);
  });

  it("round-trips observation and comparison separately from the original receipt", () => {
    const { course, world } = fixture();
    const evidence = createInvitedPreviewEvidence(course, world)!;
    const progress = { ...createTutorialProgress(course, world), stage: "retest-play" as const, opening: { ...newOpeningDemo(), cursor: 3, candidate: evidence, targetCells: openingTargetCells(course, evidence) } };
    const loaded = normalizeLoadedSave({ schemaVersion: CURRENT_SAVE_SCHEMA_VERSION, savedAt: Date.now(), course, world, tutorial: progress });
    expect(loaded?.tutorial).toEqual(progress);
    expect(restartTutorialProgress(progress, course, world)).toMatchObject({ opening: { cursor: 0, candidate: evidence }, receipts: progress.receipts });
    const legacy = createTutorialProgress(course, world);
    expect(normalizeTutorialProgress(legacy)).toEqual(legacy);
    expect(normalizeTutorialProgress({ ...legacy, stage: "improve-hole" })?.stage).toBe("welcome");
    expect(normalizeOpeningDemo({ version: 1, cursor: Infinity, targetCells: [-1, "bad", 4, 4, 5, 6, 7, 8], candidate: {} })).toEqual({ version: 1, cursor: 0, targetCells: [4, 5, 6, 7], candidate: null });
  });

  it("keeps legacy saved comparisons honest while round-tripping current receipt-derived measures", () => {
    const { course, world } = fixture();
    const baseline = createInvitedPreviewEvidence(course, world)!;
    const context = freezeOpeningContext(baseline);
    const candidate = { ...baseline, id: `${baseline.id}:candidate`, holeFingerprint: "1234abcd" };
    const current = compareOpening(baseline, candidate, context, 120);
    const currentLoaded = normalizeOpeningDemo({ version: 1, cursor: 2, targetCells: [4], comparison: current });
    expect(currentLoaded?.comparison).toEqual(current);
    expect(currentLoaded?.comparison?.measures.every((row) => Number.isFinite(row.riskBefore) && Number.isFinite(row.riskyLeavesAfter))).toBe(true);

    const { riskBefore: _riskBefore, riskAfter: _riskAfter, riskyLeavesBefore: _riskyLeavesBefore, riskyLeavesAfter: _riskyLeavesAfter, ...legacyMeasure } = current.measures[0];
    const legacyLoaded = normalizeOpeningDemo({
      version: 1,
      cursor: 2,
      targetCells: [4],
      comparison: { ...current, measures: [legacyMeasure] },
    });
    expect(legacyLoaded?.comparison?.measures).toEqual([legacyMeasure]);
    expect(legacyLoaded?.comparison?.measures[0]).not.toHaveProperty("riskBefore");
    expect(legacyLoaded?.comparison?.measures[0]).not.toHaveProperty("riskyLeavesAfter");
  });
});
