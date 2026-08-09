import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import type { Terrain, WeekResult } from "../models/types";
import { advisorMessages, allowsMessage } from "../advisor/advisor";
import {
  TUTORIAL_STEPS,
  advanceTutorialProgress,
  claimTutorialPreviewReward,
  createTutorialProgress,
  normalizeTutorialProgress,
  reconcileTutorialProgress,
  reconcileTutorialRewardTransaction,
  reconcileTutorialSession,
  restartTutorialProgress,
  resumeTutorialProgress,
  skipTutorialModule,
  tutorialCanAdvance,
  tutorialPublicThreeHoleOperation,
} from "./tutorial";
import { GOLFOPEDIA_ENTRIES } from "../../ui/help/golfopediaData";
import {
  terrainConstructionUnitCost,
  terrainSalvageUnitValue,
} from "../models/terrainEconomics";
import { CURRENT_SAVE_SCHEMA_VERSION, normalizeLoadedSave, normalizeLoadedSaveResult } from "../../utils/save";
import { REPORT_HELP, tooltipForControl } from "../../ui/help/tooltipContent";
import { canonicalInvitedPreviewEvidenceId } from "./invitedPreview";
import { hashCanonicalValue } from "../../utils/canonical";

const terrains: Terrain[] = ["fairway", "rough", "deep_rough", "sand", "waste_area", "water", "wetland", "green", "tee", "path"];

function week(profit: number): WeekResult {
  return {
    visitors: 40,
    revenue: 5_000,
    costs: 5_000 - profit,
    profit,
    avgSatisfaction: 70,
    reputationDelta: 0,
    visitorNoise: 0,
  };
}

function previewEvidence(key = "preview:1") {
  const evidence = {
    version: 1 as const,
    runSeed: DEFAULT_WORLD.runSeed >>> 0,
    holeFingerprint: hashCanonicalValue(key),
    holeId: "hole-1",
    holeIndex: 0,
    courseName: "Preview course",
    group: [{
      id: "preview-golfer:1",
      name: "Alex Fairway",
      archetype: "casual" as const,
      par: 4,
      strokes: 5,
      expectedScore: 5,
      satisfaction: 72,
      reaction: "pleased" as const,
      thought: "That route gave me a clear choice.",
      shots: [],
    }],
  };
  return { ...evidence, id: canonicalInvitedPreviewEvidenceId(evidence) };
}

function twoHolePreviewCourse() {
  const course = structuredClone(DEFAULT_COURSE);
  for (const y of [12, 22]) {
    for (let x = 12; x <= 30; x++) course.tiles[y * course.width + x] = "fairway";
    course.tiles[y * course.width + 12] = "tee";
    for (let greenY = y - 1; greenY <= y + 1; greenY++) {
      for (let greenX = 29; greenX <= 31; greenX++) course.tiles[greenY * course.width + greenX] = "green";
    }
  }
  course.holes[0] = { ...course.holes[0], tee: { x: 12, y: 12 }, green: { x: 30, y: 12 }, parMode: "MANUAL", parManual: 3 };
  course.holes[1] = { ...course.holes[1], tee: { x: 12, y: 22 }, green: { x: 30, y: 22 }, parMode: "MANUAL", parManual: 3 };
  return course;
}

describe("M14 onboarding data", () => {
  it("authors the complete profile-aware first-hole guide as data", () => {
    expect(TUTORIAL_STEPS).toHaveLength(15);
    expect(new Set(TUTORIAL_STEPS.map((step) => step.id)).size).toBe(15);
    expect(TUTORIAL_STEPS[0]?.id).toBe("welcome");
    expect(TUTORIAL_STEPS.at(-1)?.id).toBe("graduation");
  });

  it("keeps Design reachable while the three-hole lesson awaits another hole", () => {
    const openCourse = TUTORIAL_STEPS.find((step) => step.id === "public-three")!;
    expect(openCourse.allowedTargets).toContain("editor-tools");
  });

  it("captures a run baseline and accepts threshold-based painting", () => {
    const progress = createTutorialProgress(DEFAULT_COURSE, DEFAULT_WORLD);
    const course = { ...DEFAULT_COURSE, tiles: [...DEFAULT_COURSE.tiles] };
    let changed = 0;
    for (let i = 0; i < course.tiles.length && changed < 4; i++) {
      if (course.tiles[i] !== "fairway") {
        course.tiles[i] = "fairway";
        changed++;
      }
    }
    expect(tutorialCanAdvance({ ...progress, stage: "paint-fairway" }, { course, world: DEFAULT_WORLD, onCourse: 0 })).toBe(true);
  });

  it("ends after the creative loop for Relaxed and queues advanced JIT for Simulation", () => {
    const context = { course: DEFAULT_COURSE, world: DEFAULT_WORLD, onCourse: 0 };
    const relaxed = { ...createTutorialProgress(DEFAULT_COURSE, { ...DEFAULT_WORLD, experienceProfile: "relaxed" }), stage: "creative-reward" as const };
    const simulation = { ...createTutorialProgress(DEFAULT_COURSE, { ...DEFAULT_WORLD, experienceProfile: "simulation" }), stage: "creative-reward" as const };
    expect(advanceTutorialProgress(relaxed, context)).toMatchObject({ active: false, completion: "creative", jitQueue: [] });
    expect(advanceTutorialProgress(simulation, context)).toMatchObject({ active: false, completion: "creative", jitQueue: ["advanced-design", "enterprise", "legacy"] });
  });

  it("continues Classic into pricing, staff, maintenance, and results", () => {
    const context = { course: DEFAULT_COURSE, world: DEFAULT_WORLD, onCourse: 0 };
    const classic = { ...createTutorialProgress(DEFAULT_COURSE, DEFAULT_WORLD), stage: "creative-reward" as const };
    expect(advanceTutorialProgress(classic, context).stage).toBe("public-three");
  });

  it("lets Classic skip the operations module without losing creative completion", () => {
    const base = createTutorialProgress(DEFAULT_COURSE, DEFAULT_WORLD);
    const progress = {
      ...base,
      stage: "public-three" as const,
      receipts: {
        ...base.receipts,
        preview: {
          ...base.receipts.preview,
          rewardReceipt: { id: "founders-preview-pennant" as const, previewId: "preview", cash: 750 as const, reputation: 1 as const },
        },
      },
    };
    const skipped = skipTutorialModule(progress);
    expect(skipped).toMatchObject({ active: false, completion: "creative" });
    expect(resumeTutorialProgress(skipped, DEFAULT_COURSE, DEFAULT_WORLD)).toMatchObject({ active: true, stage: "public-three", completion: "none" });
  });

  it("normalizes legacy tutorial baselines without observed-round evidence", () => {
    const progress = createTutorialProgress(DEFAULT_COURSE, DEFAULT_WORLD);
    const { observedCompletedRounds: _legacyMissing, ...legacyBaseline } = progress.baseline;
    expect(normalizeTutorialProgress({ ...progress, baseline: legacyBaseline })?.baseline.observedCompletedRounds).toBe(0);
  });

  it("round-trips the current tutorial step with a game save", () => {
    const progress = { ...createTutorialProgress(DEFAULT_COURSE, DEFAULT_WORLD), stage: "observe-play" as const };
    const loaded = normalizeLoadedSave({
      schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
      savedAt: Date.now(),
      course: DEFAULT_COURSE,
      world: DEFAULT_WORLD,
      tutorial: progress,
    });
    expect(loaded?.tutorial).toEqual(progress);
  });

  it("reconciles 3/6/9 milestone receipts exactly once without changing camera mode", () => {
    const base = createTutorialProgress(DEFAULT_COURSE, DEFAULT_WORLD);
    const progress = {
      ...base,
      stage: "public-three" as const,
      receipts: {
        ...base.receipts,
        preview: {
          ...base.receipts.preview,
          status: "rewarded" as const,
          rewardReceipt: { id: "founders-preview-pennant" as const, previewId: "legacy-preview", cash: 750 as const, reputation: 1 as const },
        },
      },
    };
    const width = 60;
    const height = 40;
    const tiles: Terrain[] = Array.from({ length: width * height }, () => "fairway");
    const holes = Array.from({ length: 9 }, (_, index) => ({
      tee: { x: 4, y: 2 + index * 4 },
      green: { x: 50, y: 2 + index * 4 },
      parMode: "AUTO" as const,
    }));
    for (const hole of holes) {
      tiles[hole.tee.y * width + hole.tee.x] = "tee";
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) tiles[(hole.green.y + dy) * width + hole.green.x + dx] = "green";
    }
    const course = { ...DEFAULT_COURSE, width, height, tiles, elevations: new Array(width * height).fill(0), holes };
    const reconciled = reconcileTutorialProgress(progress, course);
    expect(reconciled.receipts.milestones.map((receipt) => receipt.holes)).toEqual([3, 6, 9]);
    expect(reconcileTutorialProgress(reconciled, course)).toBe(reconciled);
    for (const viewMode of ["COZY", "ARCHITECT"] as const) {
      const session = reconcileTutorialSession(progress, course, viewMode);
      expect(session.progress).toEqual(reconciled);
      expect(session.viewMode).toBe(viewMode);
    }
  });

  it("migrates old open saves safely and preserves completed-player public operation", () => {
    const open = normalizeTutorialProgress({ stepIndex: 0, baseline: {} });
    const legacy = normalizeTutorialProgress({ stepIndex: 11, baseline: {} });
    expect(open).toMatchObject({ version: 2, active: true, stage: "welcome", migratedLegacyStep: 0 });
    expect(legacy).toMatchObject({ version: 2, active: true, stage: "graduation", migratedLegacyStep: 11 });
    expect(normalizeTutorialProgress(null)).toBeNull();
    expect(tutorialPublicThreeHoleOperation(null, true)).toBe(true);
    expect(tutorialPublicThreeHoleOperation(null, false)).toBe(false);
  });

  it("loads legacy-open and legacy-null tutorial saves without relocking completed credit", () => {
    const baseSave = { schemaVersion: CURRENT_SAVE_SCHEMA_VERSION, savedAt: Date.now(), course: DEFAULT_COURSE, world: DEFAULT_WORLD } as const;
    const open = normalizeLoadedSave({ ...baseSave, tutorial: { stepIndex: 6, baseline: {} } });
    const empty = normalizeLoadedSave({ ...baseSave, tutorial: null });
    expect(open?.tutorial).toMatchObject({ version: 2, active: true, stage: "invite-group", migratedLegacyStep: 6 });
    expect(empty?.tutorial).toBeNull();
    expect(tutorialPublicThreeHoleOperation(empty?.tutorial, true)).toBe(true);
  });

  it("sanitizes the world-owned reward ledger on load", () => {
    const progress = createTutorialProgress(DEFAULT_COURSE, DEFAULT_WORLD);
    const evidence = previewEvidence();
    const loaded = normalizeLoadedSave({
      schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
      savedAt: Date.now(),
      course: DEFAULT_COURSE,
      world: {
        ...DEFAULT_WORLD,
        onboardingRewards: {
          version: 1,
          receipts: [
            { id: "founders-preview-pennant", previewId: evidence.id, cash: 999_999, reputation: 99 },
            { id: "founders-preview-pennant", previewId: evidence.id, cash: 1, reputation: 0 },
          ],
        },
      },
      tutorial: {
        ...progress,
        stage: "review-reaction",
        receipts: { preview: { status: "observed", evidence, rewardReceipt: null }, milestones: [] },
      },
    });
    expect(loaded?.world.onboardingRewards?.receipts).toEqual([{ id: "founders-preview-pennant", previewId: evidence.id, cash: 750, reputation: 1 }]);
    const settled = claimTutorialPreviewReward(loaded!.tutorial!, loaded!.course, loaded!.world);
    expect(settled.applied).toBe(false);
    expect(settled.world.cash).toBe(loaded?.world.cash);
    expect(settled.progress.receipts.preview.rewardReceipt?.previewId).toBe(evidence.id);
  });

  it("rejects cross-ID tutorial and world receipts before unlock, milestones, or settlement", () => {
    const progress = createTutorialProgress(DEFAULT_COURSE, DEFAULT_WORLD);
    const evidence = previewEvidence("preview:legitimate");
    const forgedPreviewId = "preview:forged";
    const loaded = normalizeLoadedSave({
      schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
      savedAt: Date.now(),
      course: DEFAULT_COURSE,
      world: {
        ...DEFAULT_WORLD,
        onboardingRewards: {
          version: 1,
          receipts: [{ id: "founders-preview-pennant", previewId: forgedPreviewId, cash: 750, reputation: 1 }],
        },
      },
      tutorial: {
        ...progress,
        stage: "review-reaction",
        receipts: {
          preview: {
            status: "rewarded",
            evidence,
            rewardReceipt: { id: "founders-preview-pennant", previewId: forgedPreviewId, cash: 750, reputation: 1 },
          },
          milestones: [{ id: `public-operation:${forgedPreviewId}:3`, holes: 3, previewId: forgedPreviewId }],
        },
      },
    });

    expect(loaded?.tutorial?.receipts.preview).toMatchObject({ status: "observed", evidence, rewardReceipt: null });
    expect(loaded?.tutorial?.receipts.milestones).toEqual([]);
    expect(loaded?.world.onboardingRewards?.receipts).toEqual([]);
    expect(tutorialPublicThreeHoleOperation(loaded?.tutorial)).toBe(false);

    const settled = claimTutorialPreviewReward(loaded!.tutorial!, loaded!.course, loaded!.world);
    expect(settled.applied).toBe(false);
    expect(settled.world).toBe(loaded!.world);
  });

  it("keeps the globally spent preview immutable across invalidation, restart, reload, and rerun", () => {
    const course = twoHolePreviewCourse();
    const initial = { ...createTutorialProgress(course, DEFAULT_WORLD), stage: "invite-group" as const };
    const observed = advanceTutorialProgress(initial, { course, world: DEFAULT_WORLD, onCourse: 0 });
    const claimed = claimTutorialPreviewReward({ ...observed, stage: "review-reaction" }, course, DEFAULT_WORLD);
    expect(claimed.applied).toBe(true);
    const spentId = claimed.progress.receipts.preview.evidence!.id;
    const spentCash = claimed.world.cash;
    expect(claimed.world.onboardingRewards?.receipts[0]?.previewId).toBe(spentId);

    const changedCourse = structuredClone(course);
    changedCourse.holes[0] = { ...changedCourse.holes[0], tee: null, green: null };
    const restarted = restartTutorialProgress(claimed.progress, changedCourse, claimed.world);
    const rerunObserved = advanceTutorialProgress(
      { ...restarted, stage: "invite-group" },
      { course: changedCourse, world: claimed.world, onCourse: 0 },
    );
    expect(rerunObserved.receipts.preview.evidence?.id).toBe(spentId);

    const serialized = JSON.parse(JSON.stringify({
      schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
      savedAt: Date.now(),
      course: changedCourse,
      world: claimed.world,
      tutorial: { ...rerunObserved, stage: "review-reaction" },
    }));
    const loadedResult = normalizeLoadedSaveResult(serialized);
    if (!loadedResult.ok) throw new Error(`${loadedResult.error.code}: ${loadedResult.error.message}`);
    const loaded = normalizeLoadedSave(serialized);
    expect(loaded?.world.onboardingRewards?.receipts[0]?.previewId).toBe(spentId);
    expect(loaded?.tutorial?.receipts.preview.evidence?.id).toBe(spentId);
    const rerunClaim = claimTutorialPreviewReward(loaded!.tutorial!, loaded!.course, loaded!.world);
    expect(rerunClaim.applied).toBe(false);
    expect(rerunClaim.world.cash).toBe(spentCash);
    expect(rerunClaim.world.onboardingRewards?.receipts).toHaveLength(1);
  });

  it("normalizes malformed current carriers to bounded defaults", () => {
    const normalized = normalizeTutorialProgress({ version: 2, active: "yes", stage: "bogus", profile: "bogus", receipts: { milestones: new Array(100).fill({}) }, jitQueue: ["advanced-design", "advanced-design", 7] });
    expect(normalized).toMatchObject({ active: false, stage: "welcome", profile: "classic", completion: "none", jitQueue: ["advanced-design"] });
    expect(normalized?.receipts.milestones).toEqual([]);
  });

  it("does not invent a reward during recovery without a durable receipt", () => {
    const progress = createTutorialProgress(DEFAULT_COURSE, DEFAULT_WORLD);
    const recovered = reconcileTutorialRewardTransaction(progress, DEFAULT_COURSE, DEFAULT_WORLD);
    expect(recovered).toEqual({ progress, world: DEFAULT_WORLD, applied: false });
  });

  it("rolls a validated progress-first reward commit forward exactly once", () => {
    const course = twoHolePreviewCourse();
    const initial = { ...createTutorialProgress(course, DEFAULT_WORLD), stage: "invite-group" as const };
    const observed = advanceTutorialProgress(initial, { course, world: DEFAULT_WORLD, onCourse: 0 });
    const claimed = claimTutorialPreviewReward({ ...observed, stage: "review-reaction" }, course, DEFAULT_WORLD);

    const recovered = reconcileTutorialRewardTransaction(claimed.progress, course, DEFAULT_WORLD);
    expect(recovered.applied).toBe(true);
    expect(recovered.progress).toEqual(claimed.progress);
    expect(recovered.world).toEqual(claimed.world);
    expect(reconcileTutorialRewardTransaction(recovered.progress, course, recovered.world)).toEqual({
      progress: recovered.progress,
      world: recovered.world,
      applied: false,
    });
  });
});

describe("M14 advisor", () => {
  it("prioritizes a low-cash warning and can silence it", () => {
    const messages = advisorMessages(DEFAULT_COURSE, { ...DEFAULT_WORLD, cash: 100 }, week(-500), undefined);
    expect(messages[0].priority).toBe("warning");
    expect(allowsMessage("important", messages[0])).toBe(true);
    expect(allowsMessage("off", messages[0])).toBe(false);
  });

  it("celebrates the first profitable week without requiring an exact value", () => {
    const messages = advisorMessages(DEFAULT_COURSE, DEFAULT_WORLD, week(1), week(-1));
    expect(messages.some((message) => message.priority === "celebration")).toBe(true);
  });

  it("offers a chatty hint before the course is complete", () => {
    const messages = advisorMessages(DEFAULT_COURSE, DEFAULT_WORLD, undefined, undefined);
    const hint = messages.find((message) => message.priority === "hint");
    expect(hint && allowsMessage("chatty", hint)).toBe(true);
  });
});

describe("M14 Golfopedia", () => {
  it("generates one live-economics entry for every terrain", () => {
    for (const terrain of terrains) {
      const entry = GOLFOPEDIA_ENTRIES.find((candidate) => candidate.id === `terrain-${terrain}`);
      expect(entry).toBeDefined();
      expect(entry?.facts).toContainEqual({ label: "Build", value: `$${terrainConstructionUnitCost(terrain).toLocaleString()} / tile` });
      expect(entry?.facts).toContainEqual({ label: "Salvage", value: `$${terrainSalvageUnitValue(terrain).toLocaleString()} / tile` });
    }
  });

  it("generates all six golfer archetype pages", () => {
    expect(GOLFOPEDIA_ENTRIES.filter((entry) => entry.section === "Golfers")).toHaveLength(6);
  });
});

describe("M14 shared tooltip content", () => {
  it("provides meaningful help for representative control types", () => {
    expect(tooltipForControl("Help")).toMatch(/Golfopedia/);
    expect(tooltipForControl("Green fee", "input")).toMatch(/Adjust/);
    expect(tooltipForControl("Speed 4x")).toMatch(/speed/i);
    expect(tooltipForControl("Editor")).toMatch(/terrain/);
    expect(tooltipForControl("Results")).toMatch(/revenue/);
    expect(tooltipForControl("Quick Start")).toMatch(/sandbox/);
    expect(tooltipForControl("Skip tutorial")).toMatch(/normal play/);
  });

  it("documents every weekly demand factor", () => {
    expect(Object.keys(REPORT_HELP)).toEqual(expect.arrayContaining([
      "Course quality", "Condition", "Reputation", "Price", "Marketing", "Staff",
    ]));
  });
});
