import { CAMPAIGN_CAST, CAMPAIGN_CHAPTERS, validateCampaignContent } from "./content";
import type { CampaignChapterDefinition } from "./types";

export interface CampaignCertificationReport {
  ok: boolean;
  chapterCount: number;
  phaseCount: number;
  matchCount: number;
  complicationCount: number;
  estimatedHours: number;
  charterPaths: number;
  proBuilds: number;
  designStyles: number;
  recoveryPaths: number;
  localizationKeys: number;
  errors: string[];
}

export function certifyCampaign(
  chapters: readonly CampaignChapterDefinition[] = CAMPAIGN_CHAPTERS,
): CampaignCertificationReport {
  const errors = validateCampaignContent(chapters);
  const phases = chapters.flatMap((chapter) => [...chapter.phases]);
  const matches = phases.flatMap((phase) => phase.match ? [phase.match] : []);
  const complications = chapters.flatMap((chapter) => [...chapter.complications]);
  const estimatedMinutes = phases.reduce((sum, phase) => sum + phase.estimatedMinutes, 0);
  const charterPaths = chapters.reduce((sum, chapter) => sum + chapter.supportedCharters.length, 0);
  const localizationKeys = new Set([
    ...CAMPAIGN_CAST.map((character) => character.roleKey),
    ...chapters.flatMap((chapter) => [
      chapter.epilogueKey,
      ...chapter.phases.flatMap((phase) => [
        phase.titleKey,
        phase.summaryKey,
        phase.recoveryKey,
        ...(phase.match ? [phase.match.titleKey, phase.match.descriptionKey] : []),
      ]),
      ...chapter.scenes.flatMap((scene) => [
        scene.titleKey,
        scene.bodyKey,
        ...scene.choices.flatMap((choice) => [choice.labelKey, choice.previewKey]),
      ]),
      ...chapter.medals.flatMap((medal) => [medal.labelKey, medal.descriptionKey]),
    ]),
  ]).size;
  if (estimatedMinutes < 12 * 60 || estimatedMinutes > 18 * 60) errors.push(`pacing:${estimatedMinutes}`);
  if (matches.length < 6) errors.push(`matches:${matches.length}`);
  if (complications.length < chapters.length * 2) errors.push(`complications:${complications.length}`);
  if (phases.some((phase) => !phase.recoveryKey)) errors.push("recovery");
  if (charterPaths !== chapters.length * 4) errors.push(`charters:${charterPaths}`);
  return {
    ok: errors.length === 0,
    chapterCount: chapters.length,
    phaseCount: phases.length,
    matchCount: matches.length,
    complicationCount: complications.length,
    estimatedHours: Number((estimatedMinutes / 60).toFixed(1)),
    charterPaths,
    proBuilds: 3,
    designStyles: 3,
    recoveryPaths: phases.length,
    localizationKeys,
    errors,
  };
}
