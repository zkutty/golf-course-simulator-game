import { CAMPAIGN_CHAPTER_BY_ID } from "../game/campaign/content";
import {
  activeCampaignMatch,
  campaignFacts,
  campaignMatchComplete,
  campaignPhaseBlockers,
  predicateMet,
} from "../game/campaign/campaign";
import type { Course, World } from "../game/models/types";
import { useI18n } from "../i18n/useI18n";
import { useState } from "react";

const FACT_LABELS = {
  cash: "Cash",
  reputation: "Reputation",
  condition: "Condition",
  week: "Week",
  greenFee: "Green fee",
  accessCapacity: "Access capacity",
  staffLevel: "Staff level",
  totalRounds: "Rounds",
  regularCount: "Named regulars",
  architectureEvidence: "Design evidence",
  playerCareerPoints: "Pro points",
  playerCareerRounds: "Pro rounds",
  playerMatchWins: "Match wins",
  playerSkillAverage: "Pro skill",
  scheduledTournaments: "Scheduled events",
  completedTournaments: "Completed events",
  severeForecastDays: "Severe forecast days",
  drainageLevel: "Drainage tier",
  legacyYears: "Yearbooks",
} as const;

export function CampaignPanel(props: {
  course: Course;
  world: World;
  onStartMatch: () => Promise<string | null>;
  onContinueSandbox: () => void;
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
              {FACT_LABELS[key]}: {key === "cash" || key === "greenFee" ? `$${facts[key].toLocaleString()}` : facts[key]}
            </span>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 14 }}>
        <strong>{t("campaign.panel.phaseGoals")}</strong>
        {phase.goals.map((goal) => <p key={goal.id} style={{ margin: "7px 0" }}>• {goal.label}: {goal.description}</p>)}
        {phase.requirements.map((requirement) => (
          <p key={`${requirement.fact}:${requirement.op}:${requirement.value}`} style={{ margin: "7px 0" }}>
            {predicateMet(requirement, facts) ? "✓" : "○"} {FACT_LABELS[requirement.fact]} {requirement.op} {requirement.value} ({facts[requirement.fact]})
          </p>
        ))}
      </section>

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
              ? medal.predicates.map((predicate) => `${FACT_LABELS[predicate.fact]} ${predicate.op} ${predicate.value}`).join(", ")
              : t(medal.descriptionKey)}
          </p>
        ))}
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
