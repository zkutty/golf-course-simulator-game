import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import type { PlayerCareerRound, PlayerPlayableRound, PlayerProCareer, PlayerShotTrace } from "../models/playerProTypes";
import { createRenderPerfCourse } from "../testing/referenceCourse";
import { activeCourseLayout } from "../models/courseLayouts";
import { commitPlayerShot, createDefaultPlayerPro, normalizePlayerPro, previewPlayableShot, startPlayableRound } from "../playerPro/playerPro";
import { acceptStakeBundle, createStakeBundle, settleLostStake } from "./inventory";
import type { InventoryItem, LearnedTechnique, MentorTechniqueChallenge } from "./types";
import {
  AUTHORED_EQUIPMENT_EFFECTS,
  MENTOR_TECHNIQUES,
  auditEquipmentMentorContent,
  capturePerformanceLoadout,
  mentorTechniqueEligibility,
  normalizePerformanceLoadoutSnapshot,
  resolvePerformanceModifiers,
  setEquipmentLoadout,
  settleMentorTechniqueChallenge,
  startMentorTechniqueChallenge,
} from "./equipmentMentor";

function equipment(id: string, definitionId = "workshop-flighted-iron", category: InventoryItem["category"] = "club"): InventoryItem {
  return {
    id,
    definitionId,
    name: AUTHORED_EQUIPMENT_EFFECTS.find((definition) => definition.definitionId === definitionId)?.label ?? definitionId,
    category,
    ownerId: "player-pro-730001",
    custodianId: "player-pro-730001",
    authoredValue: 0,
    remainingValue: 0,
    prestige: 20,
    unique: false,
    confirmationRequired: false,
    transferable: true,
    transferHistory: [],
    modifiers: AUTHORED_EQUIPMENT_EFFECTS.find((definition) => definition.definitionId === definitionId)?.modifiers,
  };
}

function started(career: PlayerProCareer) {
  const course = createRenderPerfCourse("parkland");
  const world = { ...DEFAULT_WORLD, runSeed: 730_001, week: 4, playerPro: career };
  const result = startPlayableRound({ course, world, layoutId: activeCourseLayout(course).id, day: 2 });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.round;
}

function trace(overrides: Partial<PlayerShotTrace>): PlayerShotTrace {
  return {
    id: "mentor-shot",
    holeId: "hole-1",
    shotNumber: 1,
    club: "Driver",
    technique: "normal",
    flightProfile: "standard",
    power: 1,
    from: { x: 1, y: 1 },
    aim: { x: 12, y: 1 },
    landing: { x: 10, y: 1 },
    rest: { x: 10, y: 1 },
    carryYards: 250,
    rollYards: 10,
    lieBefore: "tee",
    lieAfter: "fairway",
    penaltyStrokes: 0,
    holed: false,
    seed: 1,
    evidence: [],
    ...overrides,
  };
}

function challenge(id: LearnedTechnique): MentorTechniqueChallenge {
  const definition = MENTOR_TECHNIQUES.find((candidate) => candidate.id === id)!;
  return {
    version: 1,
    id: `challenge-${id}`,
    mentorId: "mentor-1",
    mentorName: "Morgan Mentor",
    techniqueId: id,
    objectiveId: definition.objectiveId,
    objective: definition.objective,
    status: "active",
    startedWeek: 4,
    startedDay: 2,
    attemptRoundIds: [],
  };
}

describe("ZK-730 equipment and mentor technique authority", () => {
  it("audits every authored sidegrade and clamps combined gear plus technique per channel", () => {
    expect(auditEquipmentMentorContent()).toEqual([]);
    expect(MENTOR_TECHNIQUES.map((definition) => definition.name)).toEqual([
      "Fairway Finder", "Knockdown Approach", "Soft Hands", "Splash Specialist", "Lag Putt",
    ]);
    const normalized = normalizePerformanceLoadoutSnapshot({
      version: 1,
      frozenWeek: 4,
      frozenDay: 2,
      itemIds: ["iron"],
      techniqueId: "knockdown-approach",
      modifiers: [
        { sourceKind: "equipment", sourceId: "iron", channel: "dispersion", multiplier: .1, context: "iron-low-fairway" },
        { sourceKind: "technique", sourceId: "knockdown-approach", channel: "dispersion", multiplier: .1, context: "iron-low-fairway" },
        { sourceKind: "equipment", sourceId: "iron", channel: "carry", multiplier: 99, context: "iron-low-fairway" },
        { sourceKind: "technique", sourceId: "knockdown-approach", channel: "carry", multiplier: 99, context: "iron-low-fairway" },
      ],
    });
    expect(normalized?.modifiers.map((modifier) => modifier.multiplier)).toEqual([.88, .88, 1.12, 1.12]);
    const resolved = resolvePerformanceModifiers(normalized, { clubId: "seven_iron", lie: "fairway", flightProfile: "low" });
    expect(resolved.dispersion).toBe(.8);
    expect(resolved.carry).toBe(1.2);
    expect(resolvePerformanceModifiers(normalized, { clubId: "driver", lie: "tee", flightProfile: "standard" })).toMatchObject({ carry: 1, dispersion: 1 });
  });

  it("freezes owned authored equipment and learned technique at round start and restores it byte-identically", () => {
    const base = createDefaultPlayerPro({ seed: 730_001 });
    const iron = equipment("iron-1");
    const career: PlayerProCareer = {
      ...base,
      inventory: { ...base.inventory, items: [iron] },
      equipmentLoadout: { clubItemIds: [iron.id], techniqueId: "knockdown-approach" },
      learnedTechniques: ["knockdown-approach"],
    };
    const round = started(career);
    expect(round.performanceLoadout).toMatchObject({ itemIds: [iron.id], techniqueId: "knockdown-approach", frozenWeek: 4, frozenDay: 2 });
    expect(Object.isFrozen(round.performanceLoadout)).toBe(true);
    const fairwayRound = { ...round, lie: "fairway" };
    const selection = { club: "7 Iron", aim: { x: fairwayRound.ball.x + 10, y: fairwayRound.ball.y }, power: .8, technique: "normal" as const, flightProfile: "low" as const };
    const neutral = previewPlayableShot({ ...fairwayRound, performanceLoadout: undefined }, career.skills, selection);
    const equipped = previewPlayableShot(fairwayRound, career.skills, selection);
    expect(equipped.carryYards / neutral.carryYards).toBeCloseTo(.8836, 4);
    expect(equipped.dispersionTiles / neutral.dispersionTiles).toBeCloseTo(.81, 4);
    const committed = commitPlayerShot(fairwayRound, career.skills, selection);
    expect(committed.pendingShot?.sharedOutcome?.requestedCarryYards).toBeCloseTo(equipped.carryYards, 5);
    expect(committed.pendingShot?.sharedOutcome?.requestedDispersionTiles).toBeCloseTo(equipped.dispersionTiles, 5);
    const active = { ...career, activeRound: round };
    expect(setEquipmentLoadout(active, { clubItemIds: [] })).toEqual({ ok: false, reason: expect.stringContaining("frozen") });
    const restored = normalizePlayerPro(JSON.parse(JSON.stringify(active)), { seed: 730_001 });
    expect(JSON.stringify(restored.activeRound?.performanceLoadout)).toBe(JSON.stringify(round.performanceLoadout));
    expect(restored.handicapProfile).toEqual(career.handicapProfile);
  });

  it("keeps accepted stakes equipped until settlement, then falls back without changing the frozen round", () => {
    const base = createDefaultPlayerPro({ seed: 730_001 });
    const iron = equipment("iron-stake");
    const career = { ...base, inventory: { ...base.inventory, items: [iron] }, equipmentLoadout: { clubItemIds: [iron.id] } };
    const round = started(career);
    const stake = acceptStakeBundle(createStakeBundle({ inventory: career.inventory, itemIds: [iron.id], week: 4, day: 2 }), [], 4, 2);
    expect(career.equipmentLoadout.clubItemIds).toEqual([iron.id]);
    const lost = settleLostStake({
      assets: { cash: 0, inventory: career.inventory, loadout: career.equipmentLoadout, rivalCustody: [], settlementLedger: [] },
      stake,
      settlementId: "settlement-730",
      challengeId: "custody-730",
      rivalId: "rival-730",
      rivalName: "Rival",
      week: 5,
      day: 1,
    });
    expect(lost.loadout.clubItemIds).toEqual([]);
    expect(round.performanceLoadout?.itemIds).toEqual([iron.id]);
  });

  it("requires two completed matches, relationship, and reveal evidence before an authored objective", () => {
    const base = createDefaultPlayerPro({ seed: 730_001 });
    const completed = (id: string): PlayerCareerRound => ({ id, opponentId: "mentor-1", result: "won" } as PlayerCareerRound);
    const world = {
      ...DEFAULT_WORLD,
      week: 4,
      runSeed: 730_001,
      playerPro: { ...base, rounds: [completed("match-1"), completed("match-2")] },
      livingClub: {
        ...DEFAULT_WORLD.livingClub!,
        regulars: [{
          id: "mentor-1", kind: "regular", name: "Morgan Mentor", skill: .7, loyalty: 70, visits: 5, rounds: 5, bestToPar: -1, member: true,
          archetype: "lowHandicap", appearance: { portrait: "cap", palette: 1, accent: 1 },
          preferences: { pace: "balanced", challenge: "competitive", hospitality: "club" },
          relationship: { score: 25, tier: "friend", interactionIds: [] }, memories: [], recentThoughts: [], history: [],
          backstory: { revealedHistory: [{ id: "mentor-1:origin", text: "Shared after a round.", allowedTriggers: ["completed-round"], revealedBy: { kind: "completed-round", week: 3 } }] },
          rivalProfile: { version: 1, riskTolerance: 40, preferredFormats: [], preferredTees: ["member"], preferredStakeCategories: [], preferredPartnerIds: [], signatureTechnique: "fairway-finder", knownHoldingIds: [], mentorMatchesRequired: 2 },
        }],
      },
    } as unknown as typeof DEFAULT_WORLD;
    expect(mentorTechniqueEligibility({ ...world, playerPro: { ...world.playerPro!, rounds: [completed("match-1")] } }, "mentor-1").blockers.join(" ")).toContain("Complete 2 matches");
    const startedChallenge = startMentorTechniqueChallenge({ world, mentorId: "mentor-1", challengeId: "mentor-challenge", day: 2 });
    expect(startedChallenge.ok).toBe(true);
    if (!startedChallenge.ok) throw new Error(startedChallenge.reasons.join(" "));
    expect(startMentorTechniqueChallenge({ world: startedChallenge.world, mentorId: "mentor-1", challengeId: "mentor-challenge", day: 2 })).toMatchObject({ ok: true, challenge: { id: "mentor-challenge" } });
  });

  it("settles all five authored shot objectives idempotently as non-transferable knowledge", () => {
    const traces: Record<LearnedTechnique, PlayerShotTrace> = {
      "fairway-finder": trace({ lieBefore: "tee", club: "Driver", lieAfter: "fairway" }),
      "knockdown-approach": trace({ lieBefore: "fairway", club: "7 Iron", flightProfile: "low", lieAfter: "green" }),
      "soft-hands": trace({ lieBefore: "rough", club: "Chip", lieAfter: "green" }),
      "splash-specialist": trace({ lieBefore: "sand", club: "Sand Wedge", lieAfter: "green" }),
      "lag-putt": trace({ lieAfter: "green", greenPutting: { version: 1, seed: 4, putts: 2, leaveDistanceYards: 14, breakTiles: 1, pinDifficulty: .4, realizedSpeedFeet: 10, effectiveMoisture: .4, wear: .1, puttingSkill: .6, consistency: .6 } }),
    };
    for (const technique of MENTOR_TECHNIQUES.map((definition) => definition.id)) {
      const base = createDefaultPlayerPro({ seed: 730_001 });
      const active = challenge(technique);
      const career = { ...base, activeMentorTechniqueChallenge: active, mentorTechniqueChallenges: [active] };
      const round = { id: `round-${technique}`, phase: "round_complete", opponent: { id: "mentor-1" }, shots: [traces[technique]] } as PlayerPlayableRound;
      const handicapBefore = JSON.stringify(career.handicapProfile);
      const settled = settleMentorTechniqueChallenge(career, round);
      expect(settled.learnedTechniques).toEqual([technique]);
      expect(settled.activeMentorTechniqueChallenge).toBeNull();
      expect(JSON.stringify(settled.handicapProfile)).toBe(handicapBefore);
      expect(settleMentorTechniqueChallenge(settled, round)).toBe(settled);
    }
  });

  it("captures only items still in player custody and never invents a learned technique", () => {
    const held = { ...equipment("held"), custodianId: "rival" };
    const frozen = capturePerformanceLoadout({
      ownerId: "player-pro-730001",
      inventoryItems: [held],
      loadout: { clubItemIds: [held.id], techniqueId: "soft-hands" },
      learnedTechniques: [],
      week: 1,
      day: 0,
    });
    expect(frozen).toMatchObject({ itemIds: [], modifiers: [] });
    expect(frozen.techniqueId).toBeUndefined();
  });
});
