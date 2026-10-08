import { useEffect, useRef } from "react";
import { IconUi } from "../assets/icons";
import {
  nextReputationTier,
  REPUTATION_TIERS,
  reputationProgress,
  reputationTier,
} from "../game/progression/progression";
import { useI18n } from "../i18n/useI18n";
import "./progressionPanel.css";

export function ProgressionPanel(props: {
  reputation: number;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);
  const current = reputationTier(props.reputation);
  const next = nextReputationTier(props.reputation);
  const progress = reputationProgress(props.reputation);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <aside
      className="cc-progression-panel"
      data-testid="progression-panel"
      aria-labelledby="progression-panel-title"
    >
      <header className="cc-progression-panel__header">
        <div className="cc-progression-panel__identity">
          <small>{t("progression.eyebrow")}</small>
          <h2 id="progression-panel-title">
            <IconUi name="progression" />
            <span>{current.name}</span>
          </h2>
          <div className="cc-progression-panel__reputation">
            {t("progression.current", { reputation: Math.round(props.reputation) })}
          </div>
        </div>
        <button
          ref={closeRef}
          className="cc-progression-panel__close"
          type="button"
          aria-label={t("progression.close")}
          onClick={props.onClose}
        >
          <IconUi name="close" />
        </button>
      </header>

      <section className="cc-progression-panel__summary" aria-label={t("progression.eyebrow")}>
        <div className="cc-progression-panel__summary-labels">
          <span>{current.name}</span>
          <span>
            {next
              ? t("progression.next", { name: next.name, reputation: next.minReputation })
              : t("progression.max")}
          </span>
        </div>
        <div
          className="cc-progression-panel__progress-track"
          role="progressbar"
          aria-label={t("progression.eyebrow")}
          aria-valuemin={current.minReputation}
          aria-valuemax={next?.minReputation ?? 100}
          aria-valuenow={Math.round(props.reputation)}
        >
          <div
            className="cc-progression-panel__progress-value"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      </section>

      <div className="cc-progression-panel__tiers">
        {REPUTATION_TIERS.map((tier) => {
          const unlocked = props.reputation >= tier.minReputation;
          const isCurrent = tier.id === current.id;
          return (
            <section
              key={tier.id}
              className={`cc-progression-panel__tier ${unlocked ? "is-unlocked" : "is-locked"}${isCurrent ? " is-current" : ""}`}
              data-testid={`progression-tier-${tier.id}`}
              data-unlocked={unlocked}
            >
              <div className="cc-progression-panel__tier-heading">
                <strong className="cc-progression-panel__tier-name">
                  <IconUi name={unlocked ? "completed" : "locked"} />
                  <span>{tier.name}</span>
                </strong>
                <span className="cc-progression-panel__threshold">
                  {tier.minReputation} {t("stat.reputationShort")}
                </span>
              </div>
              <div
                className="cc-progression-panel__status"
                data-testid={`progression-status-${tier.id}`}
              >
                {isCurrent
                  ? t("progression.status.current")
                  : unlocked
                    ? t("progression.status.unlocked")
                    : t("progression.status.locked", { reputation: tier.minReputation })}
              </div>
              <div className="cc-progression-panel__unlocks">
                {tier.headlineUnlocks.join(", ")}
              </div>
              <div className="cc-progression-panel__staff">
                {t("progression.staff", {
                  role: tier.staffRole,
                  level: tier.staffCap,
                  building: tier.buildingTierCap,
                })}
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
