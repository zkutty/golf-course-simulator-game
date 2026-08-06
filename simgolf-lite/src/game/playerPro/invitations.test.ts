import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import type { Course, World } from "../models/types";
import { createDefaultPlayerPro } from "./playerPro";
import {
  acceptInvitation,
  applyInvitationEvidence,
  freezeTeamBuilderAtRoundStart,
  previewTeamBuilder,
  rankInvitationCandidates,
  validateInvitationSchedule,
  type InvitationSchedule,
} from "./invitations";

const schedule: InvitationSchedule = { week: 2, day: 3, courseId: "course-primary", teeSet: "member", pinRotation: "A" };

function course(): Course {
  return {
    ...DEFAULT_COURSE,
    holes: DEFAULT_COURSE.holes.map((hole, index) => ({
      ...hole,
      tee: { x: 2, y: index + 2 },
      green: { x: 12, y: index + 2 },
      teeBoxes: { forward: { x: 1, y: index + 2 }, member: { x: 2, y: index + 2 }, championship: { x: 3, y: index + 2 } },
      pinPositions: { A: { x: 12, y: index + 2 }, B: { x: 13, y: index + 2 }, C: { x: 14, y: index + 2 } },
      holeIndex: index + 1,
    })),
  };
}

function world(): World {
  return {
    ...DEFAULT_WORLD,
    week: 2,
    runSeed: 729_001,
    playerPro: createDefaultPlayerPro({ seed: 729_001, name: "Alex Green" }),
    livingClub: {
      ...DEFAULT_WORLD.livingClub!,
      regulars: [
        {
          id: "mentor-mara",
          kind: "regular" as const,
          name: "Mara Mentor",
          skill: .7,
          loyalty: 70,
          visits: 4,
          rounds: 4,
          bestToPar: -1,
          member: true,
          preferences: { pace: "balanced" as const, challenge: "competitive" as const, hospitality: "club" as const },
          relationship: { score: 3, tier: "new" as const, interactionIds: [] },
          memories: [], recentThoughts: [], history: [],
          backstory: { preferredPartners: ["player-pro-729001"], competitiveTemperament: "fierce" },
        },
        {
          id: "busy-blair",
          kind: "regular" as const,
          name: "Blair Busy",
          skill: .8,
          loyalty: 90,
          visits: 8,
          rounds: 8,
          bestToPar: -2,
          member: true,
          preferences: { pace: "brisk" as const, challenge: "competitive" as const, hospitality: "club" as const },
          relationship: { score: 45, tier: "friend" as const, interactionIds: [] },
          memories: [], recentThoughts: [],
          history: [{ id: "busy-visit", week: 2, day: 3, courseId: "course-primary", courseName: "West Village Municipal", scoreToPar: 0, mood: 70 }],
        },
      ],
    },
  } as unknown as World;
}

describe("ZK-729 invitations, calendar, and team-builder authority", () => {
  it("ranks available people deterministically and honours an authored override without bypassing availability", () => {
    const current = world();
    const candidates = rankInvitationCandidates({
      world: current,
      schedule,
      override: { source: "campaign", id: "scene-invite", personIds: ["mentor-mara"], title: "Mara's practice invitation" },
    });
    expect(candidates.map((candidate) => candidate.personId)).toEqual(["mentor-mara", "busy-blair"]);
    expect(candidates[0]).toMatchObject({ source: "campaign", overrideId: "scene-invite", available: true });
    expect(candidates[1].available).toBe(false);
    expect(candidates[1].reasons.join(" ")).toContain("recorded visit");
  });

  it("explains date and setup blockers before acceptance", () => {
    const invalidCourse = course();
    invalidCourse.holes[0] = { ...invalidCourse.holes[0], tee: null, teeBoxes: { forward: null, member: null, championship: null } };
    const issues = validateInvitationSchedule({ course: invalidCourse, world: world(), schedule: { ...schedule, week: 1 } });
    expect(issues).toContain("Choose a current or future week.");
    expect(issues.some((issue) => issue.includes("Hole 1 is missing"))).toBe(true);
  });

  it("accepts once and applies social/mentor evidence once without touching property", () => {
    const current = world();
    const candidate = rankInvitationCandidates({ world: current, schedule })[0];
    const accepted = acceptInvitation({ course: course(), world: current, invitationId: "invite-mara", candidate, schedule });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) throw new Error(accepted.reasons.join(", "));
    const enterprise = accepted.world.enterprise;
    const settled = applyInvitationEvidence({
      world: accepted.world,
      invitationId: "invite-mara",
      evidenceId: "round-proof-1",
      kind: "mentor",
      relationshipDelta: 4,
      confidenceDelta: 3,
      mentorSkill: "shortGame",
      storyFact: "mara-mentor-round",
    });
    expect(settled.ok).toBe(true);
    if (!settled.ok) throw new Error(settled.reason);
    expect(settled.world.enterprise).toBe(enterprise);
    expect(settled.world.livingClub?.regulars[0].relationship.score).toBe(7);
    expect(settled.world.playerPro?.confidence.current).toBe(53);
    const repeat = applyInvitationEvidence({ world: settled.world, invitationId: "invite-mara", evidenceId: "round-proof-1", kind: "mentor" });
    expect(repeat.ok).toBe(true);
    if (!repeat.ok) throw new Error(repeat.reason);
    expect(repeat.world).toBe(settled.world);
  });

  it("keeps an evicted detail safely idempotent while its bounded ledger key remains", () => {
    const current = world();
    const candidate = rankInvitationCandidates({ world: current, schedule })[0];
    const accepted = acceptInvitation({ course: course(), world: current, invitationId: "invite-evicted", candidate, schedule });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) throw new Error(accepted.reasons.join(", "));
    const evidenceId = "evicted-proof";
    const ledgerId = `invitation:invite-evicted:${evidenceId}`;
    const legacyBoundedWorld = {
      ...accepted.world,
      playerPro: {
        ...accepted.world.playerPro!,
        invitationCalendar: {
          ...accepted.world.playerPro!.invitationCalendar,
          history: [],
          settlementLedger: [ledgerId],
        },
      },
    };
    const retry = applyInvitationEvidence({ world: legacyBoundedWorld, invitationId: "invite-evicted", evidenceId, kind: "completed" });
    expect(retry.ok).toBe(true);
    if (!retry.ok) throw new Error(retry.reason);
    expect(retry.world).toBe(legacyBoundedWorld);
    expect(retry.history).toMatchObject({ evidenceId, relationshipDelta: 0, confidenceDelta: 0 });
  });

  it("previews current ZK-728 allowances and freezes only the values at round start", () => {
    const draft = {
      id: "team-draft-1",
      format: "alternate-shot" as const,
      scoring: "match" as const,
      teams: [{ id: "a", playerIds: ["a1", "a2"] }, { id: "b", playerIds: ["b1", "b2"] }],
      playerHandicaps: [{ id: "a1", handicapIndex: 4 }, { id: "a2", handicapIndex: 16 }, { id: "b1", handicapIndex: 8 }, { id: "b2", handicapIndex: 10 }],
    };
    const handicapCourse = { courseRating: 72, slopeRating: 113, par: 72 };
    const holes = Array.from({ length: 18 }, (_, index) => ({ id: `h-${index + 1}`, par: 4, strokeIndex: index + 1 }));
    const preview = previewTeamBuilder(draft, handicapCourse, holes);
    const frozen = freezeTeamBuilderAtRoundStart({ draft: { ...draft, playerHandicaps: draft.playerHandicaps.map((player) => player.id === "a2" ? { ...player, handicapIndex: 20 } : player) }, course: handicapCourse, holes, startedWeek: 2, startedDay: 3 });
    expect(preview.frozen).toBe(false);
    expect(frozen.frozen).toBe(true);
    expect(frozen.allowances).not.toEqual(preview.allowances);
    expect(Object.isFrozen(frozen)).toBe(true);
  });
});
