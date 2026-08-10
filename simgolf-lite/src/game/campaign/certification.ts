import { CAMPAIGN_CAST, CAMPAIGN_CHAPTERS, validateCampaignContent } from "./content";
import type { CampaignChapterDefinition } from "./types";
import {
  CAMPAIGN_AXIS_MIGRATION_IDS,
  CAMPAIGN_CHAPTER_AXES,
  CAMPAIGN_CHAPTER_IDS,
  CAMPAIGN_PHASE_EVIDENCE,
  CAMPAIGN_PARTICIPATION_PROVENANCE,
  CHAMPIONSHIP_CURRICULUM,
} from "./profileContract";

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
  profileRows: number;
  structuralPhases: number;
  curriculumSystems: number;
  participationProvenance: number;
  participationPhaseMaps: number;
  migrationMaps: number;
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
  const exactAxes = [
    "back-nine:relaxed:friendly",
    "muni-rescue:relaxed:friendly",
    "swamp-deal:classic:balanced",
    "links-by-the-sea:classic:balanced",
    "members-club:classic:balanced",
    "championship-dream:simulation:balanced",
  ];
  const actualAxes = CAMPAIGN_CHAPTER_IDS.map((id) => {
    const axes = CAMPAIGN_CHAPTER_AXES[id];
    return `${id}:${axes.experienceProfile}:${axes.economicPressure}`;
  });
  if (actualAxes.join("|") !== exactAxes.join("|")) errors.push(`profile-map:${actualAxes.join("|")}`);
  const structuralPhases = phases.filter((phase) => phase.goals.length > 0 && phase.introSceneId).length;
  if (structuralPhases !== 18) errors.push(`phase-structure:${structuralPhases}`);
  if (CHAMPIONSHIP_CURRICULUM.map((systems) => systems.length).join(",") !== "5,10,13") errors.push("curriculum");
  if (CAMPAIGN_AXIS_MIGRATION_IDS.join(",") !== "muni-rescue,members-club,championship-dream") {
    errors.push(`migration-map:${CAMPAIGN_AXIS_MIGRATION_IDS.join(",")}`);
  }
  const participationPhaseMaps = Object.keys(CAMPAIGN_PHASE_EVIDENCE).length;
  if (participationPhaseMaps !== 18 || phases.some((phase) => !CAMPAIGN_PHASE_EVIDENCE[phase.id])) {
    errors.push(`participation-map:${participationPhaseMaps}`);
  }
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
    profileRows: actualAxes.length,
    structuralPhases,
    curriculumSystems: CHAMPIONSHIP_CURRICULUM[2].length,
    participationProvenance: CAMPAIGN_PARTICIPATION_PROVENANCE.length,
    participationPhaseMaps,
    migrationMaps: CAMPAIGN_AXIS_MIGRATION_IDS.length,
    errors,
  };
}
