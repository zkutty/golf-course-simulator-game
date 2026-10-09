import { useState } from "react";
import { IconUi, type UiIconName } from "../../assets/icons";
import type { AppProfile } from "../../game/onboarding/profile";
import { ACHIEVEMENTS, achievementProgress, type AchievementContext } from "../../game/retention/achievements";
import { downsampleHistory } from "../../game/retention/records";
import type { CourseRecords, HistoryPoint } from "../../game/retention/types";
import type { MessageKey } from "../../i18n/catalog";
import { formatCurrency, formatNumber } from "../../i18n/format";
import { useI18n } from "../../i18n/useI18n";
import { useFocusTrap } from "../accessibility/useFocusTrap";
import { GameTabs } from "../gameui/GameTabs";
import "./RetentionHub.css";

type Tab = "history" | "records" | "hall" | "achievements";
const TABS: Tab[] = ["history", "records", "hall", "achievements"];
const SERIES: Array<{ index: 1 | 2 | 3 | 4; color: string; key: "retention.cash" | "retention.rating" | "retention.reputation" | "retention.profit" }> = [
  { index: 1, color: "#26734d", key: "retention.cash" },
  { index: 2, color: "#b17b25", key: "retention.rating" },
  { index: 3, color: "#476fa8", key: "retention.reputation" },
  { index: 4, color: "#9a4c72", key: "retention.profit" },
];

// Display only: award IDs, targets, and progress authority remain in the domain.
const ACHIEVEMENT_COPY: Record<string, { title: MessageKey; hint: MessageKey; icon: UiIconName }> = {
  "first-hole": { title: "retention.achievement.first-hole.title", hint: "retention.achievement.first-hole.hint", icon: "courses" },
  "front-nine": { title: "retention.achievement.front-nine.title", hint: "retention.achievement.front-nine.hint", icon: "courses" },
  "full-eighteen": { title: "retention.achievement.full-eighteen.title", hint: "retention.achievement.full-eighteen.hint", icon: "player" },
  "second-course": { title: "retention.achievement.second-course.title", hint: "retention.achievement.second-course.hint", icon: "land" },
  "thirty-six-holes": { title: "retention.achievement.thirty-six-holes.title", hint: "retention.achievement.thirty-six-holes.hint", icon: "property" },
  "first-hill": { title: "retention.achievement.first-hill.title", hint: "retention.achievement.first-hill.hint", icon: "architecture" },
  "arboretum": { title: "retention.achievement.arboretum.title", hint: "retention.achievement.arboretum.hint", icon: "parkland" },
  "first-profit": { title: "retention.achievement.first-profit.title", hint: "retention.achievement.first-profit.hint", icon: "operate" },
  "cash-100k": { title: "retention.achievement.cash-100k.title", hint: "retention.achievement.cash-100k.hint", icon: "property" },
  "loan-repaid": { title: "retention.achievement.loan-repaid.title", hint: "retention.achievement.loan-repaid.hint", icon: "records" },
  "distress-survivor": { title: "retention.achievement.distress-survivor.title", hint: "retention.achievement.distress-survivor.hint", icon: "legacy" },
  "first-ace": { title: "retention.achievement.first-ace.title", hint: "retention.achievement.first-ace.hint", icon: "courses" },
  "under-par": { title: "retention.achievement.under-par.title", hint: "retention.achievement.under-par.hint", icon: "player" },
  "rounds-100": { title: "retention.achievement.rounds-100.title", hint: "retention.achievement.rounds-100.hint", icon: "people" },
  "rounds-1000": { title: "retention.achievement.rounds-1000.title", hint: "retention.achievement.rounds-1000.hint", icon: "people" },
  "rep-50": { title: "retention.achievement.rep-50.title", hint: "retention.achievement.rep-50.hint", icon: "progression" },
  "rep-80": { title: "retention.achievement.rep-80.title", hint: "retention.achievement.rep-80.hint", icon: "progression" },
  "rating-72": { title: "retention.achievement.rating-72.title", hint: "retention.achievement.rating-72.hint", icon: "tournaments" },
  "perfect-mood": { title: "retention.achievement.perfect-mood.title", hint: "retention.achievement.perfect-mood.hint", icon: "people" },
  tutorial: { title: "retention.achievement.tutorial.title", hint: "retention.achievement.tutorial.hint", icon: "campaign" },
  scenario: { title: "retention.achievement.scenario.title", hint: "retention.achievement.scenario.hint", icon: "land" },
  career: { title: "retention.achievement.career.title", hint: "retention.achievement.career.hint", icon: "legacy" },
  "hidden-ace-pair": { title: "retention.achievement.hidden-ace-pair.title", hint: "retention.achievement.hidden-ace-pair.hint", icon: "tournaments" },
  "hidden-profit-ten": { title: "retention.achievement.hidden-profit-ten.title", hint: "retention.achievement.hidden-profit-ten.hint", icon: "operate" },
  "hidden-forest": { title: "retention.achievement.hidden-forest.title", hint: "retention.achievement.hidden-forest.hint", icon: "parkland" },
  "hidden-million": { title: "retention.achievement.hidden-million.title", hint: "retention.achievement.hidden-million.hint", icon: "property" },
  "hidden-rounds": { title: "retention.achievement.hidden-rounds.title", hint: "retention.achievement.hidden-rounds.hint", icon: "people" },
};

function HistoryChart({ rows, index, color, label }: { rows: HistoryPoint[]; index: 1 | 2 | 3 | 4; color: string; label: string }) {
  const { t, locale } = useI18n();
  const values = downsampleHistory(rows, 180);
  const min = values.length ? Math.min(...values.map(row => row[index])) : 0;
  const max = values.length ? Math.max(...values.map(row => row[index])) : 0;
  const range = Math.max(1, max - min);
  const points = values.map((row, i) => `${(i / (values.length - 1)) * 560},${82 - ((row[index] - min) / range) * 70}`).join(" ");
  const valueLabel = (value: number) => index === 1 || index === 4 ? formatCurrency(value, locale, { minimumFractionDigits: 0, maximumFractionDigits: 20 }) : formatNumber(value, locale, { maximumFractionDigits: 20 });
  return <article className="cc-retention__chart" data-testid={`history-${index}`} aria-labelledby={`retention-history-${index}-title`}>
    <h3 id={`retention-history-${index}-title`}>{label}</h3>
    {values.length > 1 && <svg viewBox="0 0 560 92" role="img" aria-label={t("retention.history.chartName", { series: label })} aria-describedby={`retention-history-${index}-summary`}><path d="M0 82H560" stroke="#b9aa91" /><polyline points={points} fill="none" stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke" /></svg>}
    <p className="cc-retention__chart-summary" id={`retention-history-${index}-summary`}>{values.length ? t("retention.history.summary", { count: formatNumber(values.length, locale), first: valueLabel(values[0][index]), latest: valueLabel(values[values.length - 1][index]), low: valueLabel(min), high: valueLabel(max) }) : t("retention.history.empty")}</p>
    {values.length > 0 && <details><summary tabIndex={0}>{t("retention.history.samples", { count: formatNumber(values.length, locale) })}</summary><ol className="cc-retention__samples">{values.map((row, i) => <li key={`${row[0]}-${i}`} data-week={row[0]} data-value={row[index]}>{t("retention.history.sample", { week: formatNumber(row[0], locale), value: valueLabel(row[index]) })}</li>)}</ol></details>}
  </article>;
}

export function RetentionHub(props: { records: CourseRecords; profile: AppProfile; context: AchievementContext; onClose: () => void }) {
  const { t, locale } = useI18n();
  const trapRef = useFocusTrap<HTMLDivElement>(true, props.onClose);
  const [tab, setTab] = useState<Tab>("history");
  const [courseFilter, setCourseFilter] = useState("all");
  const earned = new Map(props.profile.achievements.earned.map(entry => [entry.id, entry]));
  const scoped = courseFilter === "all" ? undefined : props.records.byCourse?.[courseFilter];
  const hardest = scoped
    ? Object.entries(scoped.holes).map(([id, hole]) => ({ id, delta: hole.rounds ? (hole.strokes - hole.par) / hole.rounds : 0, rounds: hole.rounds })).filter(hole => hole.rounds).sort((a, b) => b.delta - a.delta)
    : props.records.holes.map((hole, index) => ({ id: String(index + 1), delta: hole.rounds ? (hole.strokes - hole.par) / hole.rounds : 0, rounds: hole.rounds })).filter(hole => hole.rounds).sort((a, b) => b.delta - a.delta);
  const bestRound = scoped?.bestRound ?? props.records.bestRound;
  const aceCount = courseFilter === "all" ? props.records.aces.length : props.records.aces.filter(ace => ace.courseId === courseFilter).length;
  const labels = TABS.map(item => t(`retention.tab.${item}`));
  return <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="retention-title" data-testid="retention-hub" className="cc-retention" onClick={props.onClose}>
    <section className="cc-tycoon-panel cc-retention__panel" onClick={event => event.stopPropagation()}>
      <header className="cc-retention__header"><div className="cc-retention__identity"><h2 id="retention-title">{t("retention.title")}</h2><p>{t("retention.subtitle")}</p></div><button className="cc-retention__close" type="button" aria-label={t("common.close")} onClick={props.onClose}><IconUi name="close" /></button></header>
      <nav className="cc-retention__tabs" aria-label={t("retention.tabs")}><GameTabs id="retention-tabs" panelId={`retention-panel-${tab}`} tabs={labels} activeTab={t(`retention.tab.${tab}`)} onTabChange={label => setTab(TABS[labels.indexOf(label)])} /></nav>
      <div className="cc-retention__body" id={`retention-panel-${tab}`} role="tabpanel" aria-labelledby={`retention-tabs-tab-${TABS.indexOf(tab)}`} tabIndex={0}>
        {tab === "records" && Object.keys(props.records.byCourse ?? {}).length > 1 && <label className="cc-retention__filter">{t("retention.courseFilter")}<select data-testid="records-course-filter" value={courseFilter} onChange={event => setCourseFilter(event.target.value)}><option value="all">{t("retention.allCourses")}</option>{Object.entries(props.records.byCourse ?? {}).map(([id, record]) => <option key={id} value={id}>{record.courseName}</option>)}</select></label>}
        {tab === "history" && <div className="cc-retention__charts">{SERIES.map(series => <HistoryChart key={series.key} rows={props.records.history} index={series.index} color={series.color} label={t(series.key)} />)}</div>}
        {tab === "records" && <div className="cc-retention__records">
          <RecordCard icon="tournaments" label={t("retention.bestRound")} value={bestRound ? `${bestRound.golferName} · ${bestRound.scoreToPar > 0 ? "+" : ""}${formatNumber(bestRound.scoreToPar, locale)}` : "—"} />
          <RecordCard icon="courses" label={t("retention.aces")} value={formatNumber(aceCount, locale)} />
          <RecordCard icon="operate" label={t("retention.revenueRecord")} value={props.records.recordRevenue ? formatCurrency(props.records.recordRevenue.amount, locale) : "—"} />
          <RecordCard icon="people" label={t("retention.attendanceRecord")} value={formatNumber(props.records.attendanceRecord?.rounds ?? 0, locale)} />
          <RecordCard icon="progression" label={t("retention.profitStreak")} value={formatNumber(props.records.longestProfitStreak, locale)} />
          <RecordCard icon="courses" label={t("retention.hardestHole")} value={hardest[0] ? `${hardest[0].id} · ${formatNumber(hardest[0].delta, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"} />
        </div>}
        {tab === "hall" && <div className="cc-retention__hall">{props.records.hall.length ? props.records.hall.map((entry, index) => <article className="cc-retention__hall-entry" key={`${entry.golferName}-${index}`}><IconUi name={index === 0 ? "tournaments" : "player"} size={24} /><div className="cc-retention__hall-person"><strong>{entry.golferName}</strong><small>{t(`livingClub.archetype.${entry.archetype}`)}</small></div><span>{t("retention.roundCount", { count: formatNumber(entry.rounds, locale) })}</span><span>{t("retention.aceCount", { count: formatNumber(entry.aces, locale) })}</span></article>) : <p>{t("retention.emptyHall")}</p>}</div>}
        {tab === "achievements" && <div className="cc-retention__achievements">{ACHIEVEMENTS.map(definition => {
          const award = earned.get(definition.id);
          const progress = achievementProgress(definition, props.context);
          const concealed = definition.hidden && !award;
          const copy = ACHIEVEMENT_COPY[definition.id];
          const title = concealed ? t("retention.hiddenTitle") : t(copy.title);
          const state = award ? "earned" : concealed ? "hidden" : "locked";
          return <article className="cc-retention__achievement" key={definition.id} data-achievement-id={definition.id} data-earned={Boolean(award)}>
            <IconUi name={concealed ? "locked" : copy.icon} size={30} />
            <h3 id={`retention-achievement-${definition.id}`}>{title}</h3>
            <span className="cc-retention__state"><IconUi name={award ? "completed" : "locked"} />{t(`retention.state.${state}`)}</span>
            <p>{concealed ? t("retention.hiddenHint") : t(copy.hint)}</p>
            <progress aria-labelledby={`retention-achievement-${definition.id}`} max={definition.target} value={Math.min(definition.target, progress)} />
            <small>{t("retention.progress", { value: formatNumber(Math.min(definition.target, Math.floor(progress)), locale), target: formatNumber(definition.target, locale) })}</small>
          </article>;
        })}</div>}
      </div>
    </section>
  </div>;
}

function RecordCard({ icon, label, value }: { icon: UiIconName; label: string; value: string }) {
  return <article className="cc-retention__record"><IconUi name={icon} size={30} /><h3>{label}</h3><strong>{value}</strong></article>;
}
