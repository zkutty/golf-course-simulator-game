import { describe, expect, it } from "vitest";
import { createSystemControlState } from "../experience/systemControl";
import { createScenarioGame, getScenario } from "../scenarios/scenarios";
import { normalizeLoadedSaveResult, payloadForPersistence } from "../../utils/save";
import { normalizeCourseLayouts } from "../models/courseLayouts";
import { normalizeCampaignRun } from "./campaign";
import { migrateLegacyCampaignAxes } from "./migration";
import {
  CAMPAIGN_AXIS_MIGRATION_IDS,
  CAMPAIGN_CHAPTER_AXES,
  LEGACY_CAMPAIGN_CHAPTER_AXES,
  type CampaignChapterId,
} from "./profileContract";

function legacyV2Run(id: CampaignChapterId) {
  const started = createScenarioGame(getScenario(id)!);
  const legacy = LEGACY_CAMPAIGN_CHAPTER_AXES[id];
  const rawCampaign = { ...started.world.campaign!, version: 2 } as Record<string, unknown>;
  delete rawCampaign.participation;
  return {
    course: started.course,
    rawCampaign,
    world: {
      ...started.world,
      ...legacy,
      systemControl: createSystemControlState(legacy.experienceProfile),
      campaign: normalizeCampaignRun(rawCampaign, id, started.world.seasonal?.charter)!,
    },
  };
}

describe("ZK-690 campaign profiles and guarded migration", () => {
  it("maps only the three changed v1/v2 authored defaults and preserves campaign progress", () => {
    expect(CAMPAIGN_AXIS_MIGRATION_IDS).toEqual([
      "muni-rescue",
      "members-club",
      "championship-dream",
    ]);
    for (const id of CAMPAIGN_AXIS_MIGRATION_IDS) {
      const input = legacyV2Run(id);
      const campaign = input.world.campaign;
      const objectives = input.world.objectives;
      const result = migrateLegacyCampaignAxes(input.world, input.rawCampaign);
      expect(result.migrated).toBe(true);
      expect(result.world).toMatchObject(CAMPAIGN_CHAPTER_AXES[id]);
      expect(result.world.systemControl).toEqual(createSystemControlState(CAMPAIGN_CHAPTER_AXES[id].experienceProfile));
      expect(result.world.campaign).toBe(campaign);
      expect(result.world.objectives).toBe(objectives);
    }
  });

  it("preserves v3, completed, overridden, graduated, recovery, and ambiguous axes", () => {
    const input = legacyV2Run("members-club");
    const cases = [
      { world: input.world, raw: { ...input.rawCampaign, version: 3 } },
      { world: { ...input.world, campaign: { ...input.world.campaign, completed: true } }, raw: input.rawCampaign },
      { world: { ...input.world, systemControl: { ...input.world.systemControl!, overrides: { pace: "manual" as const } } }, raw: input.rawCampaign },
      { world: { ...input.world, systemControl: { ...input.world.systemControl!, graduations: [{ from: "classic" as const, to: "simulation" as const, week: 8 }], highestProfile: "simulation" as const } }, raw: input.rawCampaign },
      { world: { ...input.world, systemControl: { ...input.world.systemControl!, recovery: { version: 1 as const, outstandingAdvance: 0, totalRelief: 0, totalRepaid: 0, receipts: [], lastSettled: { liveAbsoluteDay: -1, weeklyWeek: -1 } } } }, raw: input.rawCampaign },
      { world: { ...input.world, scenarioId: "swamp-deal" }, raw: input.rawCampaign },
      { world: { ...input.world, mode: "sandbox" as const }, raw: input.rawCampaign },
    ];
    for (const candidate of cases) {
      const result = migrateLegacyCampaignAxes(candidate.world, candidate.raw);
      expect(result.migrated).toBe(false);
      expect(result.world).toBe(candidate.world);
    }
  });

  it("normalizes schema-31 v2 once, keeps evidence and objectives, and is idempotent", () => {
    const input = legacyV2Run("muni-rescue");
    const intro = input.world.campaign!.choices[0];
    const rawCampaign = {
      ...input.rawCampaign,
      choices: intro ? [intro] : [],
      resolvedSceneIds: intro ? [intro.sceneId] : [],
    };
    const persisted = payloadForPersistence({
      course: normalizeCourseLayouts(input.course),
      world: input.world,
    });
    const first = normalizeLoadedSaveResult({
      schemaVersion: 31,
      savedAt: 1,
      course: persisted.course,
      world: { ...persisted.world, ...LEGACY_CAMPAIGN_CHAPTER_AXES["muni-rescue"], campaign: rawCampaign },
    });
    if (!first.ok) throw new Error(`${first.error.code}:${first.error.message}`);
    expect(first.payload.world).toMatchObject({
      experienceProfile: "relaxed",
      economicPressure: "friendly",
      campaign: { version: 3, chapterId: "muni-rescue", participation: { version: 1, receipts: [], legacyEligiblePhaseIds: ["muni-stabilize"] } },
    });
    expect(first.payload.world.objectives).toEqual(input.world.objectives);
    expect(first.payload.world.campaign?.choices).toEqual(rawCampaign.choices);

    const second = normalizeLoadedSaveResult({
      schemaVersion: 31,
      savedAt: 2,
      course: first.payload.course,
      world: first.payload.world,
    });
    if (!second.ok) throw new Error(`${second.error.code}:${second.error.message}`);
    expect(second.payload.world.experienceProfile).toBe("relaxed");
    expect(second.payload.world.economicPressure).toBe("friendly");
    expect(second.payload.world.campaign).toEqual(first.payload.world.campaign);
  });
});
