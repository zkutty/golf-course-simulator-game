import { describe, expect, it } from "vitest";
import { CAMPAIGN_CAST, CAMPAIGN_CHAPTERS, validateCampaignContent } from "./content";
import {
  advanceCampaign,
  acknowledgeLegacyCampaignPhaseRecovery,
  buildCampaignEpilogue,
  campaignFacts,
  campaignPhaseBlockers,
  campaignScene,
  continueCampaignInSandbox,
  createCampaignRun,
  hasCampaignParticipationForPhase,
  hasCampaignMasteryForPhase,
  canAcknowledgeLegacyCampaignPhaseRecovery,
  normalizeCampaignRun,
  registerCampaignMatch,
  resolveCampaignChoice,
} from "./campaign";
import { certifyCampaign } from "./certification";
import { createScenarioGame, getScenario } from "../scenarios/scenarios";
import { normalizeLoadedSaveResult } from "../../utils/save";
import type { PlayerCareerRound } from "../models/playerProTypes";
import type { World } from "../models/types";
import type { ArchitectureShotEvidence } from "../livingClub/types";
import type { CampaignChoiceRecord, CampaignParticipationReceiptV1 } from "./types";
import { CAMPAIGN_CHAPTER_AXES, CAMPAIGN_PHASE_EVIDENCE, CHAMPIONSHIP_CURRICULUM } from "./profileContract";
import { systemControlEnvelope } from "../experience/systemControl";
import { __resetCareerForTests, loadCareer, recordScenarioCompleted } from "../../utils/careerStore";
import { createRenderPerfCourse } from "../testing/referenceCourse";
import { startPlayerCampaignMatch } from "../competition/equipmentMentor";

function authoredPhaseChoices(chapterId: string): CampaignChoiceRecord[] {
  const chapter = CAMPAIGN_CHAPTERS.find((candidate) => candidate.id === chapterId)!;
  return chapter.phases.map((phase, index) => ({
    chapterId,
    sceneId: phase.introSceneId,
    choiceId: chapter.scenes.find((scene) => scene.id === phase.introSceneId)!.choices[0].id,
    week: index + 1,
    facts: {},
  }));
}

function completedRound(id: string, opponentId?: string, tournamentId?: string, result: PlayerCareerRound["result"] = "won"): PlayerCareerRound {
  return {
    id,
    kind: tournamentId ? "tournament" : "friendly",
    courseId: "course-1",
    courseName: "Test Course",
    week: 4,
    strokes: 12,
    penalties: 0,
    par: 12,
    scoreToPar: 0,
    result,
    ...(opponentId ? { opponentId, opponentName: opponentId } : {}),
    ...(tournamentId ? { tournamentId, tournamentName: "Final" } : {}),
    earnings: 0,
    scorecard: [],
    shots: [],
    evidence: [],
    skillGains: {},
  };
}

function architectureEvidence(id: string, source: ArchitectureShotEvidence["source"] = "playerPro"): ArchitectureShotEvidence {
  return {
    id,
    source,
    sourceSegment: "approach",
    golferId: "player-pro",
    golferName: "Player Pro",
    roundId: `round-${id}`,
    week: 2,
    day: 0,
    courseId: "course-primary",
    courseName: "Campaign course",
    holeId: "hole-1",
    teeSet: "member",
    geometryVersion: "g-1",
    shotType: "approach",
    shotNumber: 1,
    from: { x: 1, y: 1 },
    landing: { x: 2, y: 2 },
    rest: { x: 2, y: 2 },
    scoreToPar: 0,
    waitMinutes: 0,
  };
}

function withArchitectureEvidence(world: World, count = 1): World {
  return {
    ...world,
    livingClub: {
      ...world.livingClub!,
      architecture: {
        ...world.livingClub!.architecture,
        evidence: [
          ...world.livingClub!.architecture.evidence,
          ...Array.from({ length: count }, (_, index) => architectureEvidence(`zk690-${world.week}-${index}`)),
        ],
      },
    },
  };
}

function phaseReceipt(chapterId: string, phaseIndex: number): CampaignParticipationReceiptV1 {
  const chapter = CAMPAIGN_CHAPTERS.find((candidate) => candidate.id === chapterId)!;
  const phase = chapter.phases[phaseIndex];
  const scene = chapter.scenes.find((candidate) => candidate.id === phase.introSceneId)!;
  const evidence = CAMPAIGN_PHASE_EVIDENCE[phase.id];
  const baseline: CampaignParticipationReceiptV1["baseline"] = evidence === "architecture-evidence-delta"
    ? { kind: "architecture-evidence", ids: [] }
    : evidence === "player-pro-round-delta"
      ? { kind: "player-pro-round", ids: [] }
      : { kind: "exact-campaign-match", definitionId: phase.match!.id };
  return {
    id: `phase-scene:${chapterId}:${phase.id}:${scene.id}`,
    phaseId: phase.id,
    sceneId: scene.id,
    choiceId: scene.defaultChoiceId,
    week: 1,
    source: "player-choice",
    baseline,
  };
}

describe("M40 campaign contracts", () => {
  it("defines six validated chapters, three phases each, recurring cast, matches, and recovery", () => {
    expect(validateCampaignContent()).toEqual([]);
    const report = certifyCampaign();
    expect(report).toMatchObject({
      ok: true,
      chapterCount: 6,
      phaseCount: 18,
      matchCount: 6,
      complicationCount: 12,
      charterPaths: 24,
      proBuilds: 3,
      designStyles: 3,
      recoveryPaths: 18,
      profileRows: 6,
      structuralPhases: 18,
      curriculumSystems: 13,
      participationProvenance: 3,
      participationPhaseMaps: 18,
      migrationMaps: 3,
    });
    expect(report.estimatedHours).toBeGreaterThanOrEqual(12);
    expect(report.estimatedHours).toBeLessThanOrEqual(18);
    expect(CAMPAIGN_CAST).toHaveLength(6);
    expect(CAMPAIGN_CAST.every((character) =>
      Object.keys(character.portrait.expressions).sort().join(",") === "celebrating,concerned,neutral,warm"
    )).toBe(true);
  });

  it("advances an authored phase exactly once and does not celebrate an intermediate objective win", () => {
    const started = createScenarioGame(getScenario("back-nine")!);
    const opening = campaignScene(started.world.campaign)!;
    const chosen = resolveCampaignChoice(started.course, started.world, opening.id, opening.choices[0].id);
    expect(chosen.ok).toBe(true);
    const wonFirst = {
      ...withArchitectureEvidence(chosen.world),
      objectives: { ...chosen.world.objectives!, outcome: "WON" as const, wonWeek: 2 },
    };
    const advanced = advanceCampaign(chosen.course, wonFirst);
    expect(advanced.campaign?.phaseIndex).toBe(1);
    expect(advanced.campaign?.completedPhaseIds).toEqual(["back-nine-discover"]);
    expect(advanced.objectives?.outcome).toBe("OPEN");
    const complicationPass = advanceCampaign(started.course, advanced);
    expect(complicationPass.campaign?.phaseIndex).toBe(1);
    expect(complicationPass.campaign?.firedComplicationIds).toEqual(["back-nine-pressure"]);
    expect(advanceCampaign(started.course, complicationPass)).toEqual(complicationPass);
  });

  it("records exact-once direct participation and blocks automation-only phase advancement", () => {
    const started = createScenarioGame(getScenario("back-nine")!);
    const scene = campaignScene(started.world.campaign)!;
    const automatedWin = {
      ...started.world,
      objectives: { ...started.world.objectives!, outcome: "WON" as const },
    };
    expect(campaignPhaseBlockers(started.course, automatedWin)).toContain("campaign.blocker.participation:back-nine-discover");
    expect(advanceCampaign(started.course, automatedWin).campaign?.phaseIndex).toBe(0);
    expect(automatedWin.campaign?.participation.receipts).toEqual([]);

    const rejected = resolveCampaignChoice(started.course, automatedWin, scene.id, "not-authored");
    expect(rejected.ok).toBe(false);
    expect(rejected.world).toBe(automatedWin);
    expect(rejected.world.campaign?.participation.receipts).toEqual([]);

    const direct = resolveCampaignChoice(started.course, automatedWin, scene.id, scene.choices[0].id);
    expect(direct.ok).toBe(true);
    expect(direct.world.campaign?.participation.receipts).toEqual([expect.objectContaining({
      id: "phase-scene:back-nine:back-nine-discover:back-nine-discover-intro",
      phaseId: "back-nine-discover",
      sceneId: "back-nine-discover-intro",
      source: "player-choice",
      baseline: { kind: "architecture-evidence", ids: [] },
    })]);
    expect(hasCampaignParticipationForPhase(direct.world.campaign!, 0)).toBe(true);
    const duplicate = resolveCampaignChoice(direct.course, direct.world, scene.id, scene.choices[0].id);
    expect(duplicate.ok).toBe(false);
    expect(duplicate.world).toBe(direct.world);
    expect(duplicate.world.campaign?.participation.receipts).toHaveLength(1);
  });

  it("requires the direct Pro evidence loop and exposes a recovery path instead of a hidden gate", () => {
    const started = createScenarioGame(getScenario("back-nine")!);
    const campaign = { ...started.world.campaign!, phaseIndex: 1 as const, pendingSceneIds: [] };
    const blocked = {
      ...started.world,
      campaign,
      objectives: { ...started.world.objectives!, outcome: "WON" as const },
    };
    expect(campaignPhaseBlockers(started.course, blocked)).toEqual(expect.arrayContaining([
      expect.stringContaining("playerCareerRounds"),
      expect.stringContaining("architectureEvidence"),
    ]));
    expect(advanceCampaign(started.course, blocked).campaign?.phaseIndex).toBe(1);
  });

  it("settles choices once, stores exact facts, changes relationships, and schedules callbacks", () => {
    const started = createScenarioGame(getScenario("swamp-deal")!);
    const chapter = CAMPAIGN_CHAPTERS.find((item) => item.id === "swamp-deal")!;
    const rivalScene = chapter.scenes.find((item) => item.choices.some((choice) => choice.id === "accept"))!;
    const world = {
      ...started.world,
      campaign: { ...started.world.campaign!, pendingSceneIds: [rivalScene.id] },
    };
    const first = resolveCampaignChoice(started.course, world, rivalScene.id, "accept");
    expect(first.ok).toBe(true);
    expect(first.world.campaign?.choices[0]).toMatchObject({
      chapterId: "swamp-deal",
      sceneId: rivalScene.id,
      choiceId: "accept",
      callbackFact: "rival-accepted",
    });
    expect(first.world.campaign!.choices[0].facts.cash).toBe(first.world.cash);
    expect(first.world.campaign!.relationships[rivalScene.speaker]).toBeGreaterThan(0);
    expect(first.world.campaign!.eventPool).toContain("rival-accepted");
    expect(first.world.campaign!.scheduledScenes).toHaveLength(1);
    expect(resolveCampaignChoice(first.course, first.world, rivalScene.id, "accept").ok).toBe(false);
  });

  it("registers a playable match, derives its result, and supports honorable-loss finale handoff", () => {
    const started = createScenarioGame(getScenario("championship-dream")!);
    const receipts = [0, 1, 2].map((phaseIndex) => phaseReceipt("championship-dream", phaseIndex));
    const finalState = {
      ...started.world.campaign!,
      phaseIndex: 2 as const,
      completedPhaseIds: ["championship-qualify", "championship-stage"],
      pendingSceneIds: [],
      choices: receipts.map((receipt) => ({
        chapterId: "championship-dream",
        sceneId: receipt.sceneId,
        choiceId: receipt.choiceId,
        week: receipt.week,
        facts: {},
        participationBaseline: receipt.baseline,
      })),
      participation: { version: 1 as const, receipts, legacyEligiblePhaseIds: [] },
    };
    const world = {
      ...started.world,
      cash: 200_000,
      reputation: 90,
      campaign: finalState,
      objectives: { ...started.world.objectives!, outcome: "WON" as const },
      playerPro: {
        ...started.world.playerPro!,
        careerPoints: 20,
        rounds: [completedRound("final-round", undefined, "event-final", "complete")],
      },
      livingClub: {
        ...started.world.livingClub!,
        architecture: {
          ...started.world.livingClub!.architecture,
          evidence: [architectureEvidence("championship-stage-player-design")],
        },
      },
    };
    const registered = registerCampaignMatch(world, "championship-final", "final-round", "event-final");
    const withSettledRound = {
      ...registered,
      campaign: {
        ...registered.campaign!,
        matches: registered.campaign!.matches.map((match) => ({ ...match, status: "active" as const })),
      },
    };
    const complete = advanceCampaign(started.course, withSettledRound);
    expect(complete.campaign).toMatchObject({
      completed: true,
      outcome: "honorable-loss",
      medal: expect.stringMatching(/bronze|silver|gold/),
    });
    expect(complete.campaign?.epilogueFacts).toEqual(expect.arrayContaining([
      expect.stringContaining("charter:"),
      expect.stringContaining("championship-final:complete"),
    ]));
    const sandbox = continueCampaignInSandbox(complete);
    expect(sandbox.mode).toBe("sandbox");
    expect(sandbox.scenarioId).toBeUndefined();
    expect(sandbox.campaign?.continuedInSandbox).toBe(true);
    expect(sandbox.playerPro?.rounds[0].id).toBe("final-round");
  });

  it("normalizes hostile v1 campaign data and persists M39 plus M40 through save migration", () => {
    const started = createScenarioGame(getScenario("members-club")!);
    const malformed = normalizeCampaignRun({
      version: 1,
      chapterId: "members-club",
      phaseIndex: 99,
      pendingSceneIds: ["missing"],
      resolvedSceneIds: ["missing"],
      choices: [{ sceneId: 7 }],
      charter: "impossible",
      relationships: { beatrice: 900 },
    });
    expect(malformed?.version).toBe(3);
    expect(malformed?.phaseIndex).toBe(2);
    expect(malformed?.pendingSceneIds).toEqual([]);
    expect(malformed?.charter).toBe("public-gem");
    expect(malformed?.relationships.beatrice).toBe(100);
    expect(malformed?.participation).toEqual({
      version: 1,
      receipts: [],
      legacyEligiblePhaseIds: ["members-listen", "members-balance", "members-match"],
    });

    const result = normalizeLoadedSaveResult({
      schemaVersion: 1,
      savedAt: 1,
      course: started.course,
      world: started.world,
    });
    if (!result.ok) throw new Error(`${result.error.code}:${result.error.message}`);
    expect(result.payload.world.seasonal?.version).toBe(1);
    expect(result.payload.world.campaign?.chapterId).toBe("members-club");
    expect(result.payload.world.campaign?.pendingSceneIds.length).toBe(1);
  });

  it("recognizes authored legacy choices without fabricating v3 receipts", () => {
    const legacy = normalizeCampaignRun({
      ...createCampaignRun("back-nine"),
      version: 2,
      phaseIndex: 2,
      choices: authoredPhaseChoices("back-nine"),
      participation: undefined,
    });
    expect(legacy?.version).toBe(3);
    expect(legacy?.participation.receipts).toEqual([]);
    expect(legacy?.participation.legacyEligiblePhaseIds).toEqual(["back-nine-discover", "back-nine-prove", "back-nine-open"]);
    expect(hasCampaignParticipationForPhase(legacy!, 0)).toBe(true);
    expect(hasCampaignParticipationForPhase(legacy!, 1)).toBe(true);
    expect(hasCampaignParticipationForPhase(legacy!, 2)).toBe(true);
  });

  it("requires true post-choice architecture evidence and ignores automated economic progress", () => {
    const started = createScenarioGame(getScenario("back-nine")!);
    const scene = campaignScene(started.world.campaign)!;
    const choice = resolveCampaignChoice(started.course, started.world, scene.id, scene.defaultChoiceId);
    const automated = {
      ...choice.world,
      cash: choice.world.cash + 100_000,
      reputation: 100,
      objectives: { ...choice.world.objectives!, outcome: "WON" as const },
    };
    expect(hasCampaignMasteryForPhase(automated.campaign!, 0, choice.course, automated)).toBe(false);
    expect(advanceCampaign(choice.course, automated).campaign?.phaseIndex).toBe(0);
    const guestEvidence = {
      ...automated,
      livingClub: {
        ...automated.livingClub!,
        architecture: {
          ...automated.livingClub!.architecture,
          evidence: [...automated.livingClub!.architecture.evidence, architectureEvidence("automated-guest", "regular")],
        },
      },
    };
    expect(hasCampaignMasteryForPhase(guestEvidence.campaign!, 0, choice.course, guestEvidence)).toBe(false);
    expect(advanceCampaign(choice.course, guestEvidence).campaign?.phaseIndex).toBe(0);
    const direct = withArchitectureEvidence(automated);
    expect(hasCampaignMasteryForPhase(direct.campaign!, 0, choice.course, direct)).toBe(true);
    expect(advanceCampaign(choice.course, direct).campaign?.phaseIndex).toBe(1);
  });

  it("requires a post-choice Player Pro round even after automated turf and reputation recovery", () => {
    const started = createScenarioGame(getScenario("muni-rescue")!);
    const scene = campaignScene(started.world.campaign)!;
    const choice = resolveCampaignChoice(started.course, started.world, scene.id, scene.defaultChoiceId);
    const recoveredCourse = { ...choice.course, condition: 1 };
    const automated = {
      ...choice.world,
      reputation: 100,
      objectives: { ...choice.world.objectives!, outcome: "WON" as const },
    };
    expect(advanceCampaign(recoveredCourse, automated).campaign?.phaseIndex).toBe(0);
    const direct = {
      ...automated,
      playerPro: { ...automated.playerPro!, rounds: [...automated.playerPro!.rounds, completedRound("zk690-muni-proof")] },
    };
    expect(hasCampaignMasteryForPhase(direct.campaign!, 0, recoveredCourse, direct)).toBe(true);
    expect(advanceCampaign(recoveredCourse, direct).campaign?.phaseIndex).toBe(1);
  });

  it("requires the exact authored phase match after the phase choice", () => {
    const started = createScenarioGame(getScenario("back-nine")!);
    const chapter = CAMPAIGN_CHAPTERS.find((candidate) => candidate.id === "back-nine")!;
    const phase = chapter.phases[2];
    const prepared = {
      ...started.world,
      campaign: {
        ...started.world.campaign!,
        phaseIndex: 2 as const,
        pendingSceneIds: [phase.introSceneId],
        completedPhaseIds: chapter.phases.slice(0, 2).map((candidate) => candidate.id),
      },
      objectives: { ...started.world.objectives!, outcome: "WON" as const },
    };
    const scene = chapter.scenes.find((candidate) => candidate.id === phase.introSceneId)!;
    const choice = resolveCampaignChoice(started.course, prepared, scene.id, scene.defaultChoiceId);
    const wrongMatch = {
      ...choice.world,
      campaign: {
        ...choice.world.campaign!,
        matches: [{ definitionId: "not-the-authored-match", roundId: "wrong", status: "complete" as const, result: "won" as const }],
      },
    };
    expect(hasCampaignMasteryForPhase(wrongMatch.campaign, 2, choice.course, wrongMatch)).toBe(false);
    expect(advanceCampaign(choice.course, wrongMatch).campaign?.completed).toBe(false);
    const exact = {
      ...choice.world,
      campaign: {
        ...choice.world.campaign!,
        matches: [{ definitionId: phase.match!.id, roundId: "exact", status: "complete" as const, result: "won" as const }],
      },
    };
    expect(hasCampaignMasteryForPhase(exact.campaign, 2, choice.course, exact)).toBe(true);
    expect(advanceCampaign(choice.course, exact).campaign?.completed).toBe(true);
  });

  it("starts the current authored match after choice readiness, then advances only after exact completion", () => {
    const started = createScenarioGame(getScenario("back-nine")!);
    const course = createRenderPerfCourse("parkland");
    const chapter = CAMPAIGN_CHAPTERS.find((candidate) => candidate.id === "back-nine")!;
    const finalPhase = chapter.phases[2];
    const finalScene = chapter.scenes.find((scene) => scene.id === finalPhase.introSceneId)!;
    const readyWorld: World = {
      ...started.world,
      objectives: { ...started.world.objectives!, outcome: "WON" },
      playerPro: { ...started.world.playerPro!, careerPoints: finalPhase.match!.minCareerPoints },
      campaign: {
        ...started.world.campaign!,
        phaseIndex: 2,
        completedPhaseIds: chapter.phases.slice(0, 2).map((phase) => phase.id),
        pendingSceneIds: [finalScene.id],
      },
    };
    expect(startPlayerCampaignMatch({ course, world: readyWorld, day: 0, championshipName: "Final" })).toMatchObject({
      ok: false,
      reason: "objectives",
    });

    const chosen = resolveCampaignChoice(course, readyWorld, finalScene.id, finalScene.defaultChoiceId);
    expect(chosen.ok).toBe(true);
    expect(campaignPhaseBlockers(course, chosen.world)).toEqual(expect.arrayContaining([
      `campaign.blocker.direct-evidence:${finalPhase.id}:exact-campaign-match`,
      `campaign.blocker.match:start:${finalPhase.match!.id}`,
    ]));
    const matchStarted = startPlayerCampaignMatch({ course, world: chosen.world, day: 0, championshipName: "Final" });
    expect(matchStarted.ok).toBe(true);
    if (!matchStarted.ok) throw new Error(matchStarted.reason);
    expect(matchStarted.world.campaign?.matches).toEqual([
      expect.objectContaining({ definitionId: finalPhase.match!.id, status: "active" }),
    ]);

    const completedMatch = {
      ...matchStarted.world,
      campaign: {
        ...matchStarted.world.campaign!,
        matches: matchStarted.world.campaign!.matches.map((match) => ({ ...match, status: "complete" as const, result: "won" as const })),
      },
    };
    const advanced = advanceCampaign(course, completedMatch);
    expect(advanced.campaign).toMatchObject({ completed: true, medal: "bronze", outcome: "victory" });
  });

  it("offers an explicit idempotent Bronze recovery for a resolved legacy intro with no choice", () => {
    const started = createScenarioGame(getScenario("back-nine")!);
    const intro = CAMPAIGN_CHAPTERS.find((chapter) => chapter.id === "back-nine")!.phases[0].introSceneId;
    const legacy = normalizeCampaignRun({
      ...started.world.campaign!,
      version: 2,
      pendingSceneIds: [],
      resolvedSceneIds: [intro],
      choices: [],
      participation: undefined,
    })!;
    const world = {
      ...started.world,
      campaign: legacy,
      objectives: { ...started.world.objectives!, outcome: "WON" as const },
    };
    expect(canAcknowledgeLegacyCampaignPhaseRecovery(legacy)).toBe(true);
    expect(advanceCampaign(started.course, world).campaign?.phaseIndex).toBe(0);
    const acknowledged = acknowledgeLegacyCampaignPhaseRecovery(started.course, world);
    expect(acknowledged.ok).toBe(true);
    expect(acknowledged.world.campaign?.participation.receipts).toEqual([expect.objectContaining({ source: "legacy-recovery" })]);
    expect(hasCampaignMasteryForPhase(acknowledged.world.campaign!, 0, started.course, acknowledged.world)).toBe(false);
    expect(acknowledgeLegacyCampaignPhaseRecovery(started.course, acknowledged.world)).toMatchObject({ ok: false, world: acknowledged.world });
    const reloaded = normalizeCampaignRun(acknowledged.world.campaign)!;
    expect(reloaded.participation).toEqual(acknowledged.world.campaign?.participation);
    expect(advanceCampaign(started.course, { ...acknowledged.world, campaign: reloaded }).campaign?.phaseIndex).toBe(1);
  });

  it("rejects v3 participation resets and receipt tampering while preserving exact v1/v2 provenance", () => {
    const started = createScenarioGame(getScenario("back-nine")!);
    const worldWithBaseline = withArchitectureEvidence(started.world);
    const scene = campaignScene(worldWithBaseline.campaign)!;
    const direct = resolveCampaignChoice(started.course, worldWithBaseline, scene.id, scene.defaultChoiceId);
    const valid = normalizeCampaignRun(direct.world.campaign)!;
    expect(valid.participation.receipts).toHaveLength(1);
    expect(normalizeCampaignRun(valid)).toEqual(valid);

    const receipt = valid.participation.receipts[0];
    const tampered = [
      { ...receipt, baseline: { kind: "architecture-evidence" as const, ids: [] } },
      { ...receipt, week: receipt.week + 1 },
      { ...receipt, choiceId: scene.choices.find((choice) => choice.id !== receipt.choiceId)!.id },
      { ...receipt, sceneId: "back-nine-prove-intro" },
    ];
    for (const candidate of tampered) {
      const normalized = normalizeCampaignRun({
        ...valid,
        participation: { ...valid.participation, receipts: [candidate] },
      })!;
      expect(normalized.participation.receipts, candidate.id).toEqual([]);
    }

    const reset = normalizeCampaignRun({
      ...valid,
      participation: { version: 1, receipts: [], legacyEligiblePhaseIds: [] },
    })!;
    expect(hasCampaignParticipationForPhase(reset, 0)).toBe(false);
    expect(canAcknowledgeLegacyCampaignPhaseRecovery(reset)).toBe(false);
    const omitted = normalizeCampaignRun({ ...valid, participation: undefined })!;
    expect(hasCampaignParticipationForPhase(omitted, 0)).toBe(false);
    expect(canAcknowledgeLegacyCampaignPhaseRecovery(omitted)).toBe(false);

    const legacy = normalizeCampaignRun({ ...valid, version: 2, participation: undefined })!;
    expect(legacy.participation.legacyEligiblePhaseIds).toEqual(["back-nine-discover"]);
    expect(hasCampaignParticipationForPhase(legacy, 0)).toBe(true);

    const hostileLegacy = normalizeCampaignRun({
      ...valid,
      version: 2,
      participation: valid.participation,
    })!;
    expect(hostileLegacy.participation.receipts).toEqual([]);
    expect(hostileLegacy.choices[0]?.participationBaseline).toBeUndefined();
    expect(hasCampaignMasteryForPhase(hostileLegacy, 0, started.course, direct.world)).toBe(false);
    expect(normalizeCampaignRun(hostileLegacy)).toEqual(hostileLegacy);
  });

  it("recognizes genuinely new player-owned IDs at the 480-evidence and 40-round caps, never reorder/reset", () => {
    const back = createScenarioGame(getScenario("back-nine")!);
    const cappedEvidenceWorld = withArchitectureEvidence(back.world, 480);
    const backScene = campaignScene(cappedEvidenceWorld.campaign)!;
    const backChoice = resolveCampaignChoice(back.course, cappedEvidenceWorld, backScene.id, backScene.defaultChoiceId);
    const reorderedEvidence = {
      ...backChoice.world,
      livingClub: {
        ...backChoice.world.livingClub!,
        architecture: {
          ...backChoice.world.livingClub!.architecture,
          evidence: [...backChoice.world.livingClub!.architecture.evidence].reverse(),
        },
      },
    };
    expect(hasCampaignMasteryForPhase(reorderedEvidence.campaign!, 0, back.course, reorderedEvidence)).toBe(false);
    const appendedEvidence = {
      ...backChoice.world,
      livingClub: {
        ...backChoice.world.livingClub!,
        architecture: {
          ...backChoice.world.livingClub!.architecture,
          evidence: [...backChoice.world.livingClub!.architecture.evidence, architectureEvidence("cap-new-player")].slice(-480),
        },
      },
    };
    expect(appendedEvidence.livingClub!.architecture.evidence).toHaveLength(480);
    expect(hasCampaignMasteryForPhase(appendedEvidence.campaign!, 0, back.course, appendedEvidence)).toBe(true);

    const muni = createScenarioGame(getScenario("muni-rescue")!);
    const cappedRounds = Array.from({ length: 40 }, (_, index) => completedRound(`cap-round-${index}`));
    const cappedRoundWorld = { ...muni.world, playerPro: { ...muni.world.playerPro!, rounds: cappedRounds } };
    const muniScene = campaignScene(cappedRoundWorld.campaign)!;
    const muniChoice = resolveCampaignChoice(muni.course, cappedRoundWorld, muniScene.id, muniScene.defaultChoiceId);
    const reorderedRounds = {
      ...muniChoice.world,
      playerPro: { ...muniChoice.world.playerPro!, rounds: [...muniChoice.world.playerPro!.rounds].reverse() },
    };
    expect(hasCampaignMasteryForPhase(reorderedRounds.campaign!, 0, muni.course, reorderedRounds)).toBe(false);
    const appendedRounds = {
      ...muniChoice.world,
      playerPro: { ...muniChoice.world.playerPro!, rounds: [...muniChoice.world.playerPro!.rounds, completedRound("cap-round-new")].slice(-40) },
    };
    expect(appendedRounds.playerPro!.rounds).toHaveLength(40);
    expect(hasCampaignMasteryForPhase(appendedRounds.campaign!, 0, muni.course, appendedRounds)).toBe(true);
  });

  it("normalizes completed v1/v2 runs to active-run Bronze without downgrading career bests", () => {
    __resetCareerForTests();
    recordScenarioCompleted("back-nine", { week: 8, cash: 50_000, medal: "gold" });
    const started = createScenarioGame(getScenario("back-nine")!);
    for (const staleMedal of [undefined, "silver", "gold"] as const) {
      const normalized = normalizeCampaignRun({
        ...started.world.campaign!,
        version: 2,
        completed: true,
        ...(staleMedal ? { medal: staleMedal } : {}),
      })!;
      expect(normalized.medal).toBe("bronze");
      expect(normalizeCampaignRun(normalized)).toEqual(normalized);
    }
    expect(loadCareer().scenarios["back-nine"].bestMedal).toBe("gold");
  });

  it("structurally reduces all 18 phase contracts under their assigned profile with mapped direct-evidence fixtures", () => {
    for (const chapter of CAMPAIGN_CHAPTERS) {
      const started = createScenarioGame(getScenario(chapter.id)!);
      const playerPro = started.world.playerPro!;
      for (const [phaseIndex, phase] of chapter.phases.entries()) {
        const rounds = Array.from({ length: 20 }, (_, index) => completedRound(`reach-${chapter.id}-${phaseIndex}-${index}`));
        const world: World = {
          ...started.world,
          cash: 1_000_000,
          reputation: 100,
          staffLevel: 5,
          playerPro: {
            ...playerPro,
            careerPoints: 100,
            rounds,
            skills: Object.fromEntries(Object.keys(playerPro.skills).map((key) => [key, 100])) as typeof playerPro.skills,
          },
          campaign: {
            ...started.world.campaign!,
            phaseIndex: phaseIndex as 0 | 1 | 2,
            pendingSceneIds: [],
            completedPhaseIds: chapter.phases.slice(0, phaseIndex).map((candidate) => candidate.id),
            matches: phase.match ? [{ definitionId: phase.match.id, roundId: "reach-match", status: "complete", result: "won" }] : [],
            choices: [{
              chapterId: chapter.id,
              sceneId: phase.introSceneId,
              choiceId: chapter.scenes.find((scene) => scene.id === phase.introSceneId)!.defaultChoiceId,
              week: 1,
              facts: {},
              participationBaseline: phaseReceipt(chapter.id, phaseIndex).baseline,
            }],
            participation: { version: 1, receipts: [phaseReceipt(chapter.id, phaseIndex)], legacyEligiblePhaseIds: [] },
          },
          objectives: { ...started.world.objectives!, outcome: "WON" },
        };
        const evidencedWorld = withArchitectureEvidence(world, 20);
        const course = { ...started.course, condition: 1 };
        expect(systemControlEnvelope(evidencedWorld).systems).toHaveLength(13);
        expect(hasCampaignMasteryForPhase(evidencedWorld.campaign!, phaseIndex, course, evidencedWorld), `${chapter.id}:${phase.id}`).toBe(true);
        const advanced = advanceCampaign(course, evidencedWorld);
        expect(advanced.campaign?.completedPhaseIds, `${chapter.id}:${phase.id}`).toContain(phase.id);
      }
    }
  });

  it("certifies the exact six profile rows and cumulative 5/10/13 Simulation curriculum", () => {
    expect(CAMPAIGN_CHAPTERS.map((chapter) => ({ id: chapter.id, ...CAMPAIGN_CHAPTER_AXES[chapter.id as keyof typeof CAMPAIGN_CHAPTER_AXES] }))).toEqual([
      { id: "back-nine", experienceProfile: "relaxed", economicPressure: "friendly" },
      { id: "muni-rescue", experienceProfile: "relaxed", economicPressure: "friendly" },
      { id: "swamp-deal", experienceProfile: "classic", economicPressure: "balanced" },
      { id: "links-by-the-sea", experienceProfile: "classic", economicPressure: "balanced" },
      { id: "members-club", experienceProfile: "classic", economicPressure: "balanced" },
      { id: "championship-dream", experienceProfile: "simulation", economicPressure: "balanced" },
    ]);
    expect(CHAMPIONSHIP_CURRICULUM.map((systems) => systems.length)).toEqual([5, 10, 13]);
    expect(CHAMPIONSHIP_CURRICULUM[2]).toEqual(expect.arrayContaining([...CHAMPIONSHIP_CURRICULUM[1]]));
    const championship = createScenarioGame(getScenario("championship-dream")!);
    expect(systemControlEnvelope(championship.world).systems).toHaveLength(13);
    expect(systemControlEnvelope(championship.world).systems.every((system) =>
      system.visibility === "full" && system.mode === "manual"
    )).toBe(true);
  });

  it("builds deterministic fact-based epilogues across every charter", () => {
    for (const charter of ["public-gem", "championship-venue", "destination-retreat", "member-institution"] as const) {
      const started = createScenarioGame(getScenario("muni-rescue")!);
      const world = {
        ...started.world,
        seasonal: { ...started.world.seasonal!, charter },
        campaign: { ...started.world.campaign!, charter },
      };
      const facts = campaignFacts(started.course, world);
      const first = buildCampaignEpilogue(started.course, world, world.campaign!);
      const second = buildCampaignEpilogue(started.course, world, world.campaign!);
      expect(second).toEqual(first);
      expect(first).toContain(`charter:${charter}`);
      expect(facts.greenFee).toBe(started.course.baseGreenFee);
    }
  });

  it("opens every chapter on localized, fact-grounded dialogue", () => {
    for (const chapter of CAMPAIGN_CHAPTERS) {
      const started = createScenarioGame(getScenario(chapter.id)!);
      const opening = campaignScene(started.world.campaign);
      expect(opening?.factKeys.length).toBeGreaterThanOrEqual(4);
      expect(opening?.choices.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("seeds Jamie as the Muni's stable named regular and retains that identity across normalization", () => {
    const started = createScenarioGame(getScenario("muni-rescue")!);
    const jamie = started.world.livingClub?.regulars.find((regular) => regular.id === "campaign-jamie");
    expect(jamie).toMatchObject({ name: "Jamie Chen", archetype: "junior" });
    const result = normalizeLoadedSaveResult({
      schemaVersion: 1,
      savedAt: 1,
      course: started.course,
      world: started.world,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.payload.world.livingClub?.regulars.find((regular) => regular.id === "campaign-jamie")?.name).toBe("Jamie Chen");
  });
});
