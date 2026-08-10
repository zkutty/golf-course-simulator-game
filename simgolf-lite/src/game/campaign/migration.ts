import type { World } from "../models/types";
import {
  createSystemControlState,
  isValidSystemControlStateV1,
  reconcileSystemControlWorld,
} from "../experience/systemControl";
import {
  CAMPAIGN_CHAPTER_AXES,
  CAMPAIGN_CHAPTER_IDS,
  LEGACY_CAMPAIGN_CHAPTER_AXES,
  type CampaignChapterId,
} from "./profileContract";

export interface CampaignAxesMigrationResult {
  world: World;
  migrated: boolean;
}

function rawCampaignVersion(raw: unknown): 1 | 2 | null {
  if (!raw || typeof raw !== "object") return null;
  const version = (raw as { version?: unknown }).version;
  return version === 1 || version === 2 ? version : null;
}

/**
 * Conservatively realigns only untouched v1/v2 authored campaign defaults.
 * Any player graduation, override, recovery receipt, ambiguous identity, or
 * completed/history world preserves its exact axes and control state.
 */
export function migrateLegacyCampaignAxes(
  world: World,
  rawCampaign: unknown,
): CampaignAxesMigrationResult {
  if (rawCampaignVersion(rawCampaign) == null || world.mode !== "career" || !world.campaign || world.campaign.completed) {
    return { world, migrated: false };
  }
  const chapterId = world.campaign.chapterId;
  if (world.scenarioId !== chapterId || !CAMPAIGN_CHAPTER_IDS.includes(chapterId as CampaignChapterId)) {
    return { world, migrated: false };
  }
  const id = chapterId as CampaignChapterId;
  const legacy = LEGACY_CAMPAIGN_CHAPTER_AXES[id];
  const authored = CAMPAIGN_CHAPTER_AXES[id];
  if (legacy.experienceProfile === authored.experienceProfile
    && legacy.economicPressure === authored.economicPressure) {
    return { world, migrated: false };
  }
  if (world.experienceProfile !== legacy.experienceProfile
    || world.economicPressure !== legacy.economicPressure
    || !isValidSystemControlStateV1(world.systemControl)
    || world.systemControl.highestProfile !== legacy.experienceProfile
    || Object.keys(world.systemControl.overrides).length > 0
    || world.systemControl.graduations.length > 0
    || world.systemControl.recovery != null) {
    return { world, migrated: false };
  }
  return {
    migrated: true,
    world: reconcileSystemControlWorld({
      ...world,
      ...authored,
      systemControl: createSystemControlState(authored.experienceProfile),
    }),
  };
}
