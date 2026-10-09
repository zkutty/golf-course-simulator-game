import { formatCurrency, formatNumber, formatWeekLabel } from "../i18n/format";
import type { Locale } from "../i18n/core";
import type { ConditionProgress, GoalProgress, ObjectiveState } from "../game/models/objectives";
import { GameCard } from "./gameui/GameCard";
import { IconUi } from "../assets/icons/IconUi";
import { useFocusTrap } from "./accessibility/useFocusTrap";
import { useI18n } from "../i18n/useI18n";
import "./ObjectivesPanel.css";

const METRIC_LABEL_KEYS = {
  cash: "objectives.metric.cash",
  reputation: "objectives.metric.reputation",
  courseRating: "objectives.metric.courseRating",
  holesBuilt: "objectives.metric.holesBuilt",
  publishedHoles: "objectives.metric.publishedHoles",
  publishedCourses: "objectives.metric.publishedCourses",
  weeklyProfit: "objectives.metric.weeklyProfit",
  profitStreak: "objectives.metric.profitStreak",
  totalRounds: "objectives.metric.totalRounds",
  condition: "objectives.metric.condition",
  tournamentPlacement: "objectives.metric.tournamentPlacement",
} as const satisfies Record<ConditionProgress["metric"], string>;

function formatMetricValue(metric: ConditionProgress["metric"], value: number, locale: Locale): string {
  switch (metric) {
    case "cash":
    case "weeklyProfit":
      return formatCurrency(value, locale);
    case "condition":
      return formatNumber(Math.round(value) / 100, locale, { style: "percent", maximumFractionDigits: 0 });
    case "courseRating":
      return formatNumber(value, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    case "tournamentPlacement":
      return value >= Number.MAX_SAFE_INTEGER ? "—" : formatNumber(Math.round(value), locale);
    default:
      return formatNumber(Math.round(value), locale);
  }
}

function conditionFraction(c: ConditionProgress): number {
  if (c.met) return 1;
  if (c.comparator === ">=") {
    if (c.target <= 0) return 1;
    return Math.max(0, Math.min(1, c.value / c.target));
  }
  // "<=" goals don't have a natural fill direction — show met/unmet.
  return 0;
}

function goalFraction(p: GoalProgress): number {
  if (p.met) return 1;
  if (p.conditions.length === 0) return 0;
  return p.conditions.reduce((acc, c) => acc + conditionFraction(c), 0) / p.conditions.length;
}

function ProgressBar({ fraction, met, label, valueText }: { fraction: number; met: boolean; label: string; valueText: string }) {
  return <div className="cc-objective-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} aria-valuetext={valueText}>
    <div className="cc-objective-progress-fill" style={{ width: `${Math.round(fraction * 100)}%`, background: met ? "var(--cc-grass)" : "var(--cc-water)" }} />
  </div>;
}

export function ObjectiveMiniTracker(props: {
  objectives: ObjectiveState | null | undefined;
  onOpen: () => void;
}) {
  const { t, locale } = useI18n();
  const { objectives } = props;
  if (!objectives) {
    return <div className="cc-objectives-mini cc-objectives-mini-free" title={t("auto.ui.objectivespanel.no.goals.build.freely")}>
      <IconUi name="land" />
      <b>{t("auto.ui.objectivespanel.free.play")}</b>
      <span>{t("auto.ui.objectivespanel.no.goals.build.at.your.own.pace")}</span>
    </div>;
  }

  const done = objectives.progress.filter((p) => p.met).length;
  const total = objectives.progress.length;
  const nextIdx = objectives.progress.findIndex((p) => !p.met);
  const nextGoal = nextIdx >= 0 ? objectives.goals[nextIdx] : null;
  const nextProgress = nextIdx >= 0 ? objectives.progress[nextIdx] : null;
  const label = objectives.outcome === "WON"
    ? t("objectives.allComplete")
    : nextGoal
      ? nextGoal.labelKey ? t(nextGoal.labelKey) : nextGoal.label
      : t("auto.ui.objectivespanel.objectives");
  const counts = { done: formatNumber(done, locale), total: formatNumber(total, locale) };
  return <button className="cc-objectives-mini" type="button" onClick={props.onOpen} title={t("auto.ui.objectivespanel.open.objectives")}>
    <IconUi name={objectives.outcome === "WON" ? "completed" : "progression"} />
    <div className="cc-objectives-mini-content">
      <div className="cc-objectives-mini-heading"><b>{label}</b><span aria-label={t("objectives.completedCount", counts)}>{t("objectives.count", counts)}</span></div>
      {nextProgress && <ProgressBar fraction={goalFraction(nextProgress)} met={false} label={label} valueText={t("objectives.progressPercent", { percent: formatNumber(Math.round(goalFraction(nextProgress) * 100), locale) })} />}
    </div>
  </button>;
}

export function ObjectivesPanel(props: {
  open: boolean;
  onClose: () => void;
  objectives: ObjectiveState | null | undefined;
  week: number;
}) {
  const { t, locale } = useI18n();
  const { open, onClose, objectives, week } = props;
  const trapRef = useFocusTrap<HTMLDivElement>(open, onClose);
  if (!open) return null;

  return <div className="cc-objectives-overlay" role="dialog" aria-modal="true" aria-label={t("auto.ui.objectivespanel.objectives")} onClick={onClose}>
    <div ref={trapRef} className="cc-objectives-panel" onClick={(event) => event.stopPropagation()}>
      <GameCard title={t("auto.ui.objectivespanel.objectives")} icon={<IconUi name="progression" />} variant="results">
        <div className="cc-objectives-body" tabIndex={0}>
          {!objectives && <div className="cc-objectives-empty">{t("auto.ui.objectivespanel.free.play.no.goals.enjoy.the.course")}</div>}
          {objectives && objectives.goals.length === 0 && <div className="cc-objectives-empty">{t("objectives.empty")}</div>}
          {objectives && <div className="cc-objectives-goals">
            {objectives.goals.map((goal, i) => {
              const p = objectives.progress[i];
              const weeksLeft = goal.deadlineWeek != null ? goal.deadlineWeek - week + 1 : null;
              const label = goal.labelKey ? t(goal.labelKey) : goal.label;
              return <div className="cc-objective-goal" data-objective-id={goal.id} data-met={p?.met === true} key={goal.id}>
                <div className="cc-objective-heading">
                  <div className="cc-objective-title">{label}</div>
                  <span className="cc-objective-state"><IconUi name={p?.met ? "completed" : "progression"} />{t(p?.met ? "objectives.met" : "objectives.pending")}</span>
                  {goal.deadlineWeek != null && !p?.met && <div className="cc-objective-deadline" data-urgent={weeksLeft != null && weeksLeft <= 3}>
                    {t("objectives.byWeek", { week: formatWeekLabel(goal.deadlineWeek!, locale, "week") })}
                    {weeksLeft != null && weeksLeft >= 0 && <span> ({t("objectives.weeksLeft", { count: weeksLeft })})</span>}
                  </div>}
                  {p?.met && p.completedWeek != null && <div className="cc-objective-deadline cc-objective-completed">{t("objectives.completedWeek", { week: formatWeekLabel(p.completedWeek!, locale, "week") })}</div>}
                </div>
                {goal.description && <div className="cc-objective-description">{goal.descriptionKey ? t(goal.descriptionKey) : goal.description}</div>}
                <div className="cc-objective-conditions">
                  {p?.conditions.map((c, ci) => {
                    const metric = t(METRIC_LABEL_KEYS[c.metric]);
                    const valueText = t("objectives.progressValue", { value: formatMetricValue(c.metric, c.value, locale), comparator: c.comparator === "<=" ? "≤ " : "", target: formatMetricValue(c.metric, c.target, locale) });
                    return <div key={ci} className="cc-objective-condition" data-metric={c.metric}>
                      <div className="cc-objective-metric-row"><span className="cc-objective-metric">{metric}</span><span className="cc-objective-value">{valueText}</span><span className="cc-objective-state">{t(c.met ? "objectives.met" : "objectives.pending")}</span></div>
                      <ProgressBar fraction={conditionFraction(c)} met={c.met} label={t("objectives.conditionProgress", { goal: label, metric })} valueText={valueText} />
                    </div>;
                  })}
                </div>
              </div>;
            })}
          </div>}
        </div>
        <div className="cc-objectives-footer"><button type="button" onClick={onClose}><IconUi name="close" />{t("auto.ui.objectivespanel.close")}</button></div>
      </GameCard>
    </div>
  </div>;
}
