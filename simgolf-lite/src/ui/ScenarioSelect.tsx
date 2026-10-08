import { useMemo } from "react";
import { formatCurrency, formatWeekLabel } from "../i18n/format";
import { SCENARIOS } from "../game/scenarios/scenarios";
import type { ScenarioDefinition } from "../game/scenarios/types";
import { isScenarioUnlocked, loadCareer } from "../utils/careerStore";
import { getBiomeDefinition } from "../game/models/biomes";
import { IconUi } from "../assets/icons/IconUi";
import { useI18n } from "../i18n/useI18n";
import { IS_DEMO, scenarioAvailableInEdition } from "../config/edition";
import type { MessageKey } from "../i18n/catalog";
import "./ScenarioSelect.css";

// Career scenario ladder (ZKU-164): card list with medal states —
// locked / unlocked / completed (+ best-result stats), sequential unlock.

export function ScenarioSelect(props: { onStart: (scenario: ScenarioDefinition) => void }) {
  const { t, locale } = useI18n();
  const career = useMemo(() => loadCareer(), []);
  const ladder = useMemo(() => [...SCENARIOS]
    .filter((scenario) => scenarioAvailableInEdition(scenario.id))
    .sort((a, b) => a.order - b.order), []);

  return (
    <div className="campaign-scenario-list">
      {IS_DEMO && <p className="campaign-scenario-notice">{t("demo.chapterNotice")}</p>}
      {ladder.map((s) => {
        const unlocked = isScenarioUnlocked(career, ladder, s.id);
        const rec = career.scenarios[s.id];
        const completed = rec?.completed === true;
        const medalType = rec?.bestMedal;
        const medal = medalType === "gold"
          ? t("campaign.medal.gold")
          : medalType === "silver"
            ? t("campaign.medal.silver")
            : medalType === "bronze"
              ? t("campaign.medal.bronze")
              : null;
        const profileLabel = t(`newGame.experience.profile.${s.experienceProfile}.label` as MessageKey);
        const pressureLabel = t(`newGame.pressure.${s.economicPressure}.label` as MessageKey);
        const responsibility = t(`campaign.responsibility.${s.experienceProfile}` as MessageKey);
        const statusKey = completed ? "campaign.card.status.completed" : unlocked ? "campaign.card.status.unlocked" : "campaign.card.status.locked";
        const statusLabel = t(statusKey);
        const statusIcon = completed ? "completed" : !unlocked ? "locked" : getBiomeDefinition(s.theme).key;
        const resultParts = [
          rec?.bestWeek != null ? formatWeekLabel(rec.bestWeek, locale, "week") : null,
          rec?.bestCash != null ? formatCurrency(rec.bestCash, locale) : null,
        ].filter((part): part is string => part != null);
        const resultLabel = resultParts.length > 0 ? t("campaign.card.bestResult", { result: resultParts.join(" · ") }) : "";
        const medalLabel = medalType ? t(`campaign.card.medal.${medalType}` as MessageKey) : "";
        const accessibleName = [
          `${s.order}. ${t(s.nameKey)}`,
          t("campaign.card.aria", { chapter: s.order, profile: profileLabel, pressure: pressureLabel, responsibility }),
          statusLabel,
          medalLabel,
          resultLabel,
          completed ? t("scenario.replayable") : "",
        ].filter(Boolean).join(". ");
        return (
          <button
            key={s.id}
            type="button"
            className={`campaign-scenario-card${completed ? " is-completed" : ""}`}
            data-testid={`campaign-card-${s.id}`}
            disabled={!unlocked}
            aria-label={accessibleName}
            aria-describedby={`campaign-card-blurb-${s.id} campaign-card-responsibility-${s.id}`}
            onClick={() => props.onStart(s)}
          >
            <span className={`campaign-scenario-icon is-${statusIcon}`} aria-hidden="true"><IconUi name={statusIcon} size={24} /></span>
            <span className="campaign-scenario-copy">
              <span className="campaign-scenario-heading">
                <span className="campaign-scenario-title">
                  {s.order}. {t(s.nameKey)}
                </span>
                <span className="campaign-scenario-meta">
                  {t(`designDock.biome.${s.theme}` as MessageKey).toUpperCase()} • {t("campaign.card.axes", { profile: profileLabel, pressure: pressureLabel }).toUpperCase()}
                </span>
                <span className="campaign-scenario-status">{statusLabel}</span>
              </span>
              <span id={`campaign-card-blurb-${s.id}`} className="campaign-scenario-blurb">
                {unlocked ? t(s.blurbKey) : t("scenario.locked")}
              </span>
              <span id={`campaign-card-responsibility-${s.id}`} data-testid={`campaign-card-responsibility-${s.id}`} className="campaign-scenario-responsibility">
                {t("campaign.card.responsibility", { responsibility })}
              </span>
              {completed && (
                <span className="campaign-scenario-result">
                  {medal ? `${medal} · ` : ""}{resultLabel || statusLabel}
                  {` · ${t("scenario.replayable")}`}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
