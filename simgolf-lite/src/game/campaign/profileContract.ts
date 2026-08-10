import type { EconomicPressure, ExperienceProfile } from "../models/types";
import { ADVANCED_SYSTEM_IDS, type AdvancedSystemId } from "../experience/systemControl";

export const CAMPAIGN_CHAPTER_IDS = [
  "back-nine",
  "muni-rescue",
  "swamp-deal",
  "links-by-the-sea",
  "members-club",
  "championship-dream",
] as const;

export type CampaignChapterId = (typeof CAMPAIGN_CHAPTER_IDS)[number];

export interface CampaignChapterAxes {
  experienceProfile: ExperienceProfile;
  economicPressure: EconomicPressure;
}

/** ZK-690 authored fresh-start and retry axes. Goals and medal targets remain shared. */
export const CAMPAIGN_CHAPTER_AXES: Readonly<Record<CampaignChapterId, CampaignChapterAxes>> = {
  "back-nine": { experienceProfile: "relaxed", economicPressure: "friendly" },
  "muni-rescue": { experienceProfile: "relaxed", economicPressure: "friendly" },
  "swamp-deal": { experienceProfile: "classic", economicPressure: "balanced" },
  "links-by-the-sea": { experienceProfile: "classic", economicPressure: "balanced" },
  "members-club": { experienceProfile: "classic", economicPressure: "balanced" },
  "championship-dream": { experienceProfile: "simulation", economicPressure: "balanced" },
} as const;

/** Exact pre-ZK-690 defaults, used only by the conservative v1/v2 save migration gate. */
export const LEGACY_CAMPAIGN_CHAPTER_AXES: Readonly<Record<CampaignChapterId, CampaignChapterAxes>> = {
  "back-nine": { experienceProfile: "relaxed", economicPressure: "friendly" },
  "muni-rescue": { experienceProfile: "classic", economicPressure: "balanced" },
  "swamp-deal": { experienceProfile: "classic", economicPressure: "balanced" },
  "links-by-the-sea": { experienceProfile: "classic", economicPressure: "balanced" },
  "members-club": { experienceProfile: "simulation", economicPressure: "tight" },
  "championship-dream": { experienceProfile: "simulation", economicPressure: "tight" },
} as const;

export const CAMPAIGN_AXIS_MIGRATION_IDS = CAMPAIGN_CHAPTER_IDS.filter((id) => {
  const legacy = LEGACY_CAMPAIGN_CHAPTER_AXES[id];
  const authored = CAMPAIGN_CHAPTER_AXES[id];
  return legacy.experienceProfile !== authored.experienceProfile
    || legacy.economicPressure !== authored.economicPressure;
});

export const CAMPAIGN_PARTICIPATION_PROVENANCE = [
  "v3-player-choice-receipt",
  "authored-legacy-choice",
  "explicit-legacy-bronze-recovery",
] as const;

export type CampaignDirectEvidenceKind =
  | "architecture-evidence-delta"
  | "player-pro-round-delta"
  | "exact-campaign-match";

/** Shared, profile-independent direct-player proof for each authored phase. */
export const CAMPAIGN_PHASE_EVIDENCE: Readonly<Record<string, CampaignDirectEvidenceKind>> = {
  "back-nine-discover": "architecture-evidence-delta",
  "back-nine-prove": "architecture-evidence-delta",
  "back-nine-open": "exact-campaign-match",
  "muni-stabilize": "player-pro-round-delta",
  "muni-trust": "player-pro-round-delta",
  "muni-match": "exact-campaign-match",
  "swamp-survey": "architecture-evidence-delta",
  "swamp-recover": "architecture-evidence-delta",
  "swamp-rival": "exact-campaign-match",
  "links-read": "architecture-evidence-delta",
  "links-wind": "architecture-evidence-delta",
  "links-rival": "exact-campaign-match",
  "members-listen": "player-pro-round-delta",
  "members-balance": "player-pro-round-delta",
  "members-match": "exact-campaign-match",
  "championship-qualify": "player-pro-round-delta",
  "championship-stage": "architecture-evidence-delta",
  "championship-final": "exact-campaign-match",
} as const;

const CHAMPIONSHIP_PHASE_ONE = [
  "maintenance",
  "localized-turf",
  "irrigation",
  "drainage",
  "staffing",
] as const satisfies readonly AdvancedSystemId[];

const CHAMPIONSHIP_PHASE_TWO = [
  ...CHAMPIONSHIP_PHASE_ONE,
  "pace",
  "memberships",
  "tournaments",
  "property",
  "mobility",
] as const satisfies readonly AdvancedSystemId[];

/** Guidance is cumulative presentation only; the 13-domain registry remains authoritative. */
export const CHAMPIONSHIP_CURRICULUM = [
  CHAMPIONSHIP_PHASE_ONE,
  CHAMPIONSHIP_PHASE_TWO,
  ADVANCED_SYSTEM_IDS,
] as const satisfies readonly (readonly AdvancedSystemId[])[];

export function campaignChapterAxes(chapterId: string): CampaignChapterAxes | undefined {
  return CAMPAIGN_CHAPTER_IDS.includes(chapterId as CampaignChapterId)
    ? CAMPAIGN_CHAPTER_AXES[chapterId as CampaignChapterId]
    : undefined;
}

export function campaignCurriculum(chapterId: string, phaseIndex: number): readonly AdvancedSystemId[] {
  if (chapterId !== "championship-dream") return [];
  return CHAMPIONSHIP_CURRICULUM[Math.max(0, Math.min(2, Math.floor(phaseIndex)))] ?? [];
}
