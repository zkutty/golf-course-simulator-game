import { describe, expect, it } from "vitest";
import { createNewGame } from "../gen/newGame";
import type { Course, Terrain } from "../models/types";
import {
  applyInvitedPreviewReward,
  canonicalInvitedPreviewEvidenceId,
  createInvitedPreviewEvidence,
  grantInvitedPreviewReward,
  normalizeOnboardingReceipts,
  normalizeInvitedPreviewEvidence,
  publicThreeHoleOperationUnlocked,
  reconcilePublicMilestones,
  type OnboardingReceipts,
} from "./invitedPreview";

function oneHoleCourse(): ReturnType<typeof createNewGame> {
  const game = createNewGame({ mode: "sandbox", courseName: "Preview Links", seed: 686, theme: "parkland", experienceProfile: "relaxed", economicPressure: "friendly" });
  const course = game.course;
  const tiles = course.tiles.slice();
  const tee = { x: 12, y: 12 };
  const green = { x: 30, y: 12 };
  const width = course.width;
  for (let x = tee.x; x <= green.x; x++) tiles[tee.y * width + x] = "fairway";
  tiles[tee.y * width + tee.x] = "tee";
  for (let y = green.y - 1; y <= green.y + 1; y++) for (let x = green.x - 1; x <= green.x + 1; x++) tiles[y * width + x] = "green";
  game.course = { ...course, tiles, holes: [{ ...course.holes[0], id: "preview-hole", tee, green, parMode: "MANUAL", parManual: 3 }] };
  return game;
}

function copy<T>(value: T): T { return structuredClone(value); }

describe("invited first-hole preview authority", () => {
  it("reuses shot and reaction evidence without mutating public state", () => {
    const game = oneHoleCourse();
    const beforeCourse = copy(game.course);
    const beforeWorld = copy(game.world);
    const first = createInvitedPreviewEvidence(game.course, game.world);
    const second = createInvitedPreviewEvidence(game.course, game.world);

    expect(first).toEqual(second);
    expect(first?.group).toHaveLength(2);
    expect(first?.group.every((golfer) => golfer.shots.length > 0 && golfer.thought.length > 0)).toBe(true);
    expect(game.course).toEqual(beforeCourse);
    expect(game.world).toEqual(beforeWorld);
    expect(game.world.week).toBe(beforeWorld.week);
    expect(game.world.tournaments).toEqual(beforeWorld.tournaments);
    expect(game.world.objectives).toEqual(beforeWorld.objectives);
  });

  it("binds the canonical identity to the selected-hole surface geometry", () => {
    const game = oneHoleCourse();
    const original = createInvitedPreviewEvidence(game.course, game.world)!;
    const tiles = game.course.tiles.slice();
    tiles[12 * game.course.width + 20] = "rough";
    const changed = createInvitedPreviewEvidence({ ...game.course, tiles }, game.world)!;

    expect(changed.holeFingerprint).not.toBe(original.holeFingerprint);
    expect(changed.id).not.toBe(original.id);
  });

  it("canonicalizes deterministic building defaults without dropping building authority", () => {
    const game = oneHoleCourse();
    game.course.buildings = [{ type: "clubhouse", x: 7, y: 9 }];
    const beforeNormalization = createInvitedPreviewEvidence(game.course, game.world)!;
    const normalized = createInvitedPreviewEvidence({
      ...game.course,
      buildings: [{ id: "building-clubhouse-7-9", type: "clubhouse", x: 7, y: 9 }],
    }, game.world)!;
    const moved = createInvitedPreviewEvidence({
      ...game.course,
      buildings: [{ id: "building-clubhouse-8-9", type: "clubhouse", x: 8, y: 9 }],
    }, game.world)!;

    expect(normalized.id).toBe(beforeNormalization.id);
    expect(moved.id).not.toBe(beforeNormalization.id);
  });

  it("grants one deterministic receipt across retry and rerun", () => {
    const game = oneHoleCourse();
    const evidence = createInvitedPreviewEvidence(game.course, game.world)!;
    const initial = { status: "observed", evidence, rewardReceipt: null } as const;
    const rewarded = grantInvitedPreviewReward(initial);
    expect(grantInvitedPreviewReward(rewarded)).toBe(rewarded);
    expect(rewarded.rewardReceipt).toEqual({ id: "founders-preview-pennant", previewId: evidence.id, cash: 750, reputation: 1 });
  });

  it("applies the bounded world benefit atomically and exactly once", () => {
    const game = oneHoleCourse();
    const evidence = createInvitedPreviewEvidence(game.course, game.world)!;
    const initial = { status: "observed", evidence, rewardReceipt: null } as const;
    const before = copy(game.world);
    const first = applyInvitedPreviewReward(game.world, initial, game.course);
    expect(first.applied).toBe(true);
    expect(first.world.cash).toBe(before.cash + 750);
    expect(first.world.reputation).toBe(before.reputation + 1);
    expect(first.world.objectives).toEqual(before.objectives);
    expect(first.world.tournaments).toEqual(before.tournaments);
    expect(first.world.week).toBe(before.week);
    const second = applyInvitedPreviewReward(first.world, initial, game.course);
    expect(second.applied).toBe(false);
    expect(second.world).toBe(first.world);
    expect(second.preview.rewardReceipt).toEqual(first.preview.rewardReceipt);
    const rerunBody = { ...evidence, holeFingerprint: "deadbeef" };
    const { id: _oldId, ...rerunWithoutId } = rerunBody;
    const rerunEvidence = { ...rerunWithoutId, id: canonicalInvitedPreviewEvidenceId(rerunWithoutId) };
    const rerun = applyInvitedPreviewReward(first.world, { status: "observed", evidence: rerunEvidence, rewardReceipt: null }, game.course);
    expect(rerun.applied).toBe(false);
    expect(rerun.world).toBe(first.world);
  });

  it("rejects a self-consistent forged digest at the live claim boundary", () => {
    const game = oneHoleCourse();
    const evidence = createInvitedPreviewEvidence(game.course, game.world)!;
    const { id: _id, ...forgedBody } = { ...evidence, group: evidence.group.map((golfer, index) => index === 0 ? { ...golfer, satisfaction: 100 } : golfer) };
    const forged = { ...forgedBody, id: canonicalInvitedPreviewEvidenceId(forgedBody) };
    expect(normalizeInvitedPreviewEvidence(forged)).toEqual(forged);
    const result = applyInvitedPreviewReward(game.world, { status: "observed", evidence: forged, rewardReceipt: null }, game.course);
    expect(result).toEqual({ world: game.world, preview: { status: "observed", evidence: forged, rewardReceipt: null }, applied: false });
  });

  it("unlocks public operation only after reward and receipts 3/6/9 once", () => {
    const game = oneHoleCourse();
    const evidence = createInvitedPreviewEvidence(game.course, game.world)!;
    let receipts: OnboardingReceipts = {
      preview: grantInvitedPreviewReward({ status: "observed", evidence, rewardReceipt: null }),
      milestones: [],
    };
    expect(publicThreeHoleOperationUnlocked(game.world)).toBe(false);
    const grantedWorld = applyInvitedPreviewReward(game.world, receipts.preview, game.course).world;
    expect(publicThreeHoleOperationUnlocked(grantedWorld)).toBe(true);
    const source = game.course.holes[0];
    const holes = Array.from({ length: 9 }, (_, index) => ({ ...source, id: `hole-${index + 1}` }));
    for (const count of [1, 3, 3, 6, 9, 9]) {
      const course: Course = { ...game.course, holes: holes.slice(0, count) };
      receipts = reconcilePublicMilestones(receipts, course);
    }
    expect(receipts.milestones.map((receipt) => receipt.holes)).toEqual([3, 6, 9]);
    expect(new Set(receipts.milestones.map((receipt) => receipt.id)).size).toBe(3);
  });

  it("rejects a reward and milestones whose preview ID does not match the evidence", () => {
    const game = oneHoleCourse();
    const evidence = createInvitedPreviewEvidence(game.course, game.world)!;
    const forgedPreviewId = `${evidence.id}:forged`;
    const receipts = normalizeOnboardingReceipts({
      preview: {
        evidence,
        rewardReceipt: { id: "founders-preview-pennant", previewId: forgedPreviewId, cash: 750, reputation: 1 },
      },
      milestones: [
        { id: `public-operation:${forgedPreviewId}:3`, holes: 3, previewId: forgedPreviewId },
        { id: `public-operation:${evidence.id}:6`, holes: 6, previewId: forgedPreviewId },
      ],
    });

    expect(receipts.preview).toMatchObject({ status: "observed", evidence, rewardReceipt: null });
    expect(receipts.milestones).toEqual([]);
    expect(publicThreeHoleOperationUnlocked(game.world)).toBe(false);
    expect(reconcilePublicMilestones(receipts, game.course)).toBe(receipts);
  });

  it("does not create evidence for an invalid hole", () => {
    const game = oneHoleCourse();
    const invalid: Course = { ...game.course, tiles: game.course.tiles.map(() => "water" as Terrain) };
    expect(createInvitedPreviewEvidence(invalid, game.world)).toBeNull();
  });
});
