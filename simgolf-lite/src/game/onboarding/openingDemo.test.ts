import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import { createInvitedPreviewEvidence } from "./invitedPreview";
import { hasOpeningEdit, newOpeningDemo, normalizeOpeningDemo, openingShots, openingTargetCells, retestOpening } from "./openingDemo";
import { advanceTutorialProgress, claimTutorialPreviewReward, createTutorialProgress, normalizeTutorialProgress, restartTutorialProgress, tutorialCanAdvance } from "./tutorial";
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
    expect(progress.opening!.targetCells.length).toBeGreaterThan(0);
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
    const edited = { ...context, course: revised, world: reward.world };
    const economy = JSON.stringify(reward.world);
    progress = advanceTutorialProgress(progress, edited);
    expect(progress.stage).toBe("retest-play");
    expect(progress.receipts).toEqual(reward.progress.receipts);
    expect(progress.opening!.candidate!.holeFingerprint).not.toBe(baseline.holeFingerprint);
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

  it("undo/canceled edits do not unlock retest, and targets never replace tee/green/hazards", () => {
    const { course, world } = fixture();
    const evidence = createInvitedPreviewEvidence(course, world)!;
    const opening = { ...newOpeningDemo(), targetCells: openingTargetCells(course, evidence) };
    expect(opening.targetCells.length).toBeGreaterThan(0);
    expect(opening.targetCells.every((i) => ["rough", "deep_rough"].includes(course.tiles[i]))).toBe(true);
    expect(hasOpeningEdit(course, opening)).toBe(false);
    const edited = structuredClone(course);
    edited.tiles[opening.targetCells[0]] = "fairway";
    expect(hasOpeningEdit(edited, opening)).toBe(true);
    expect(hasOpeningEdit(course, opening)).toBe(false);
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
    expect(normalizeOpeningDemo({ version: 1, cursor: Infinity, targetCells: [-1, "bad", 4, 4], candidate: {} })).toEqual({ version: 1, cursor: 0, targetCells: [4], candidate: null });
  });
});
