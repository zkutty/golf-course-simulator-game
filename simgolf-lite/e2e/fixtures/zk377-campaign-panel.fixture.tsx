import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CampaignPanel } from "../../src/ui/CampaignPanel";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../../src/game/models/defaults";
import { acknowledgeLegacyCampaignPhaseRecovery, createCampaignRun } from "../../src/game/campaign/campaign";
import { CAMPAIGN_CHAPTER_BY_ID } from "../../src/game/campaign/content";
import type { CampaignParticipationReceiptV1 } from "../../src/game/campaign/types";
import type { ArchitectureShotEvidence } from "../../src/game/livingClub/types";
import { I18nProvider } from "../../src/i18n/I18nProvider";
import { useI18n } from "../../src/i18n/useI18n";
import "../../src/index.css";

const variant = new URLSearchParams(location.search).get("state") ?? "incomplete";
const course = structuredClone(DEFAULT_COURSE);
course.baseGreenFee = 1234;
const initialWorld = structuredClone(DEFAULT_WORLD);
initialWorld.cash = 123456;
initialWorld.staffLevel = 1234;
initialWorld.experienceProfile = "simulation";
const campaign = createCampaignRun("championship-dream");
campaign.phaseIndex = ["match-idle", "match-active", "match-complete", "completed", "honorable-loss"].includes(variant) ? 2 : 1;
campaign.pendingSceneIds = [];
campaign.relationships.rowan = 1234;
campaign.relationships.mara = -1234;
const phase = CAMPAIGN_CHAPTER_BY_ID.get(campaign.chapterId)!.phases[campaign.phaseIndex];
const evidence: ArchitectureShotEvidence = {
  id: "fixture-design-evidence", source: "playerPro", sourceSegment: "approach", golferId: "player-pro", golferName: "Player Pro",
  roundId: "fixture-round", week: 2, day: 0, courseId: "course-primary", courseName: "Campaign course", holeId: "hole-1", teeSet: "member",
  geometryVersion: "g-1", shotType: "approach", shotNumber: 1, from: { x: 1, y: 1 }, landing: { x: 2, y: 2 }, rest: { x: 2, y: 2 }, scoreToPar: 0, waitMinutes: 0,
};
initialWorld.livingClub!.architecture.evidence = [evidence];
if (["recovery", "acknowledged"].includes(variant)) {
  campaign.participation.legacyEligiblePhaseIds = [phase.id];
  campaign.resolvedSceneIds = [phase.introSceneId];
}
if (["mastery-pending", "mastery-complete", "match-complete", "completed", "honorable-loss"].includes(variant)) {
  const scene = CAMPAIGN_CHAPTER_BY_ID.get(campaign.chapterId)!.scenes.find((candidate) => candidate.id === phase.introSceneId)!;
  const receipt: CampaignParticipationReceiptV1 = {
    id: "fixture-choice", phaseId: phase.id, sceneId: phase.introSceneId, choiceId: scene.defaultChoiceId, week: 1, source: "player-choice",
    baseline: campaign.phaseIndex === 2 ? { kind: "exact-campaign-match", definitionId: phase.match!.id } : { kind: "architecture-evidence", ids: variant === "mastery-pending" ? [evidence.id] : [] },
  };
  campaign.participation.receipts = [receipt];
}
if (["match-active", "match-complete", "completed", "honorable-loss"].includes(variant)) campaign.matches = [{ definitionId: phase.match!.id, roundId: "fixture-match", status: variant === "match-active" ? "active" : "complete", result: variant === "honorable-loss" ? "lost" : "won" }];
if (["completed", "honorable-loss"].includes(variant)) {
  campaign.completed = true; campaign.medal = "gold"; campaign.outcome = variant === "honorable-loss" ? "honorable-loss" : "victory";
  campaign.epilogueFacts = ["A named club promise remains visible", "Long unbroken evidence identifier " + "x".repeat(100)];
}
initialWorld.campaign = campaign;
if (variant === "acknowledged") initialWorld.campaign = acknowledgeLegacyCampaignPhaseRecovery(course, initialWorld).world.campaign;

export function Fixture() {
  const { setLocale, locale } = useI18n();
  const [world, setWorld] = useState(initialWorld);
  const [open, setOpen] = useState(true);
  const [log, setLog] = useState<string[]>([]);
  const [requests, setRequests] = useState(0);
  const record = (value: string) => setLog((current) => [...current, value]);
  return <>
    <div data-testid="fixture-controls"><button onClick={() => setLocale(locale === "en" ? "pseudo" : "en")}>Toggle locale</button><button onClick={() => { document.documentElement.style.fontSize = "130%"; }}>Scale 130%</button></div>
    <output style={{ display: "block", overflowWrap: "anywhere" }} data-testid="callback-log">{log.join(",")}</output><output data-testid="request-count">{requests}</output><output hidden data-testid="campaign-state">{JSON.stringify(world.campaign)}</output>
    {open && <CampaignPanel course={course} world={world} onStartMatch={async () => { record("start"); setRequests((count) => count + 1); await new Promise((resolve) => setTimeout(resolve, 30)); return requests === 0 ? "Fixture match unavailable; recover the published route first." : null; }} onNavigateSystem={(system) => record(`navigate:${system}`)} onAcknowledgeLegacyRecovery={() => { record("recovery"); setWorld(acknowledgeLegacyCampaignPhaseRecovery(course, world).world); }} onContinueSandbox={() => record("sandbox")} onClose={() => { record("close"); setOpen(false); }} />}
  </>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider><Fixture /></I18nProvider>);
