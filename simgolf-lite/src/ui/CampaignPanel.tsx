import { CAMPAIGN_CHAPTER_BY_ID } from "../game/campaign/content";
import {
  activeCampaignMatch,
  campaignFacts,
  campaignMatchComplete,
  campaignPhaseBlockers,
  campaignPhaseEvidenceKind,
  canAcknowledgeLegacyCampaignPhaseRecovery,
  hasCampaignParticipationForPhase,
  hasCampaignMasteryForPhase,
  predicateMet,
} from "../game/campaign/campaign";
import type { Course, World } from "../game/models/types";
import type { AdvancedSystemId } from "../game/experience/systemControl";
import { useI18n } from "../i18n/useI18n";
import { useState } from "react";
import { systemControlLabel } from "./systemControlPresentation";
import type { MessageKey } from "../i18n/catalog";

export function CampaignPanel(props: {
  course: Course;
  world: World;
  onStartMatch: () => Promise<string | null>;
  onContinueSandbox: () => void;
  onNavigateSystem: (system: AdvancedSystemId) => void;
  onAcknowledgeLegacyRecovery: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [matchError, setMatchError] = useState<string | null>(null);
  const state = props.world.campaign;
  const chapter = state ? CAMPAIGN_CHAPTER_BY_ID.get(state.chapterId) : undefined;
  if (!state || !chapter) return null;
  const phase = chapter.phases[state.phaseIndex];
  const facts = campaignFacts(props.course, props.world);
  const match = activeCampaignMatch(state);
  const blockers = campaignPhaseBlockers(props.course, props.world);
  const relationshipRows = Object.entries(state.relationships).sort((a, b) => b[1] - a[1]);
  const matchRecord = match ? state.matches.find((record) => record.definitionId === match.id) : undefined;
  const experienceProfile = props.world.experienceProfile ?? "classic";
  const economicPressure = props.world.economicPressure ?? "balanced";
  const profileLabel = t(`newGame.experience.profile.${experienceProfile}.label` as MessageKey);
  const pressureLabel = t(`newGame.pressure.${economicPressure}.label` as MessageKey);
  const participationComplete = hasCampaignParticipationForPhase(state, state.phaseIndex);
  const masteryComplete = hasCampaignMasteryForPhase(state, state.phaseIndex, props.course, props.world);
  const evidenceKind = campaignPhaseEvidenceKind(state, state.phaseIndex);
  const legacyRecoveryAvailable = canAcknowledgeLegacyCampaignPhaseRecovery(state);
  const legacyRecoveryAcknowledged = state.participation.receipts.some((receipt) =>
    receipt.phaseId === phase.id && receipt.source === "legacy-recovery");
  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby="campaign-panel-title"
      data-testid="campaign-panel"
      className="cc-tycoon-panel"
      style={{ position: "absolute", zIndex: 190, top: 52, right: 12, width: "min(440px, calc(100vw - 24px))", maxHeight: "calc(100vh - 70px)", overflowY: "auto", padding: 16 }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <small style={{ fontWeight: 800, color: "#6c624e" }}>{t("campaign.panel.eyebrow")}</small>
          <h2 id="campaign-panel-title" style={{ margin: "3px 0" }}>{t("campaign.panel.title")}</h2>
          <p style={{ margin: 0 }}>{t(phase.titleKey)} · {t("campaign.scene.phase", { current: state.phaseIndex + 1, total: 3, phase: t(phase.titleKey) })}</p>
          <p data-testid="campaign-active-axes" style={{ margin: "4px 0 0", fontSize: 12, fontWeight: 800 }}>
            {t("campaign.axes.active", { profile: profileLabel, pressure: pressureLabel })}
          </p>
        </div>
        <button onClick={props.onClose} aria-label={t("campaign.panel.close")}>×</button>
      </header>

      <section style={{ marginTop: 14 }}>
        <strong>{t("campaign.panel.currentFacts")}</strong>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 }}>
          <span style={{ padding: "5px 7px", borderRadius: 7, background: "rgba(255,255,255,.72)", fontSize: 12 }}>
            {t("campaign.fact.charter")}: {props.world.seasonal?.charter ?? state.charter}
          </span>
          {(["cash", "reputation", "condition", "greenFee", "staffLevel", "playerCareerPoints", "architectureEvidence"] as const).map((key) => (
            <span key={key} style={{ padding: "5px 7px", borderRadius: 7, background: "rgba(255,255,255,.72)", fontSize: 12 }}>
              {t(`campaign.fact.${key}` as MessageKey)}: {key === "cash" || key === "greenFee" ? `$${facts[key].toLocaleString()}` : facts[key]}
            </span>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 14 }}>
        <strong>{t("campaign.panel.phaseGoals")}</strong>
        {phase.goals.map((goal) => <p key={goal.id} style={{ margin: "7px 0" }}>• {goal.label}: {goal.description}</p>)}
        {phase.requirements.map((requirement) => (
          <p key={`${requirement.fact}:${requirement.op}:${requirement.value}`} style={{ margin: "7px 0" }}>
            {predicateMet(requirement, facts) ? "✓" : "○"} {t(`campaign.fact.${requirement.fact}` as MessageKey)} {requirement.op} {requirement.value} ({facts[requirement.fact]})
          </p>
        ))}
      </section>

      <section data-testid="campaign-participation" style={{ marginTop: 14 }}>
        <strong>{t("campaign.participation.title")}</strong>
        <p style={{ margin: "5px 0" }}>
          {participationComplete ? "✓" : "○"} {t(legacyRecoveryAcknowledged
            ? "campaign.participation.legacyAcknowledged"
            : participationComplete
              ? "campaign.participation.complete"
              : "campaign.participation.required")}
        </p>
        {participationComplete && !legacyRecoveryAcknowledged && evidenceKind && (
          <p data-testid="campaign-direct-evidence" style={{ margin: "5px 0" }}>
            {masteryComplete ? "✓" : "○"} {masteryComplete
              ? t("campaign.participation.directEvidenceComplete")
              : t("campaign.participation.directEvidenceRequired", {
                evidence: t(`campaign.participation.directEvidence.${evidenceKind}` as MessageKey),
              })}
          </p>
        )}
        {legacyRecoveryAvailable && (
          <div data-testid="campaign-legacy-recovery" style={{ padding: 8, borderRadius: 8, background: "rgba(255,255,255,.72)" }}>
            <p style={{ margin: "0 0 7px" }}>{t("campaign.participation.legacyRecovery")}</p>
            <button type="button" onClick={props.onAcknowledgeLegacyRecovery}>
              {t("campaign.participation.legacyRecoveryAction")}
            </button>
          </div>
        )}
      </section>

      {phase.curriculumSystems.length > 0 && (
        <section data-testid="campaign-curriculum" style={{ marginTop: 14 }}>
          <strong>{t("campaign.curriculum.title")}</strong>
          <p style={{ margin: "5px 0 8px", fontSize: 12 }}>{t("campaign.curriculum.guidance")}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {phase.curriculumSystems.map((system) => (
              <button
                key={system}
                type="button"
                data-campaign-system={system}
                onClick={() => props.onNavigateSystem(system)}
                aria-label={t("campaign.curriculum.navigate", { system: systemControlLabel(system) })}
              >
                {systemControlLabel(system)}
              </button>
            ))}
          </div>
        </section>
      )}

      {match && (
        <section data-testid="campaign-match" style={{ marginTop: 14, padding: 10, borderRadius: 10, background: "rgba(255,255,255,.74)" }}>
          <strong>{t(match.titleKey)}</strong>
          <p style={{ margin: "5px 0 8px" }}>{t(match.descriptionKey)}</p>
          <small>{t("campaign.match.readiness", { points: match.minCareerPoints })}</small>
          <div style={{ marginTop: 8 }}>
            <button
              disabled={matchRecord?.status === "active" || campaignMatchComplete(state, match)}
              onClick={() => { void props.onStartMatch().then(setMatchError); }}
            >
              {campaignMatchComplete(state, match)
                ? t("campaign.match.complete")
                : matchRecord?.status === "active"
                  ? t("campaign.match.active")
                  : t("campaign.match.start")}
            </button>
          </div>
          {matchError && <p role="alert" style={{ color: "#8a2c23", marginBottom: 0 }}>{matchError}</p>}
        </section>
      )}

      <section style={{ marginTop: 14 }}>
        <strong>{t("campaign.panel.recovery")}</strong>
        <p style={{ margin: "5px 0" }}>{t(phase.recoveryKey)}</p>
        {blockers.length > 0 && <small>{t("campaign.panel.blockers", { count: blockers.length })}</small>}
      </section>

      <section style={{ marginTop: 14 }}>
        <strong>{t("campaign.panel.relationships")}</strong>
        <p style={{ margin: "5px 0" }}>{relationshipRows.map(([id, value]) => `${id} ${value >= 0 ? "+" : ""}${value}`).join(" · ")}</p>
      </section>

      <section style={{ marginTop: 14 }}>
        <strong>{t("campaign.panel.mastery")}</strong>
        {chapter.medals.map((medal) => (
          <p key={medal.medal} style={{ margin: "5px 0" }}>
            {t(medal.labelKey)} · {medal.predicates.length
              ? medal.predicates.map((predicate) => `${t(`campaign.fact.${predicate.fact}` as MessageKey)} ${predicate.op} ${predicate.value}`).join(", ")
              : t(medal.descriptionKey)}
          </p>
        ))}
        <small>{t("campaign.participation.mastery")}</small>
      </section>

      {state.completed && (
        <section data-testid="campaign-epilogue" style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #9b8a68" }}>
          <strong>{t("campaign.epilogue.title")}: {state.medal ? t(`campaign.medal.${state.medal}`) : ""}</strong>
          <p>{t(state.outcome === "honorable-loss" ? "campaign.epilogue.honorableLoss" : "campaign.epilogue.victory")}</p>
          <ul>{state.epilogueFacts.slice(-8).map((fact) => <li key={fact}>{fact}</li>)}</ul>
          <button onClick={props.onContinueSandbox}>{t("campaign.epilogue.continue")}</button>
        </section>
      )}
    </aside>
  );
}
