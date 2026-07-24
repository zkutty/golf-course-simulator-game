import { describe, expect, it } from "vitest";
import { CAMPAIGN_CAST, CAMPAIGN_CHAPTERS, validateCampaignContent } from "./content";
import {
  advanceCampaign,
  buildCampaignEpilogue,
  campaignFacts,
  campaignPhaseBlockers,
  campaignScene,
  continueCampaignInSandbox,
  normalizeCampaignRun,
  registerCampaignMatch,
  resolveCampaignChoice,
} from "./campaign";
import { certifyCampaign } from "./certification";
import { createScenarioGame, getScenario } from "../scenarios/scenarios";
import { normalizeLoadedSaveResult } from "../../utils/save";
import type { PlayerCareerRound } from "../models/playerProTypes";

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
    const wonFirst = {
      ...started.world,
      objectives: { ...started.world.objectives!, outcome: "WON" as const, wonWeek: 2 },
    };
    const advanced = advanceCampaign(started.course, wonFirst);
    expect(advanced.campaign?.phaseIndex).toBe(1);
    expect(advanced.campaign?.completedPhaseIds).toEqual(["back-nine-discover"]);
    expect(advanced.objectives?.outcome).toBe("OPEN");
    const complicationPass = advanceCampaign(started.course, advanced);
    expect(complicationPass.campaign?.phaseIndex).toBe(1);
    expect(complicationPass.campaign?.firedComplicationIds).toEqual(["back-nine-pressure"]);
    expect(advanceCampaign(started.course, complicationPass)).toEqual(complicationPass);
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
    const finalState = {
      ...started.world.campaign!,
      phaseIndex: 2 as const,
      completedPhaseIds: ["championship-qualify", "championship-stage"],
      pendingSceneIds: [],
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
    expect(malformed?.version).toBe(2);
    expect(malformed?.phaseIndex).toBe(2);
    expect(malformed?.pendingSceneIds).toEqual([]);
    expect(malformed?.charter).toBe("public-gem");
    expect(malformed?.relationships.beatrice).toBe(100);

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
