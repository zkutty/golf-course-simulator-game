import { useState } from "react";
import type { AppProfile } from "../../game/onboarding/profile";
import { ACHIEVEMENTS, achievementProgress, type AchievementContext } from "../../game/retention/achievements";
import { downsampleHistory } from "../../game/retention/records";
import type { CourseRecords, HistoryPoint } from "../../game/retention/types";
import { useI18n } from "../../i18n/useI18n";

type Tab = "history" | "records" | "hall" | "achievements";
const SERIES: Array<{ index: 1 | 2 | 3 | 4; color: string; key: "retention.cash" | "retention.rating" | "retention.reputation" | "retention.profit" }> = [
  { index: 1, color: "#26734d", key: "retention.cash" },
  { index: 2, color: "#b17b25", key: "retention.rating" },
  { index: 3, color: "#476fa8", key: "retention.reputation" },
  { index: 4, color: "#9a4c72", key: "retention.profit" },
];

function Sparkline({ rows, index, color }: { rows: HistoryPoint[]; index: 1 | 2 | 3 | 4; color: string }) {
  const values = downsampleHistory(rows, 180);
  if (values.length < 2) return <div style={{ minHeight: 90, display: "grid", placeItems: "center", opacity: .65 }}>—</div>;
  const min = Math.min(...values.map((row) => row[index]));
  const max = Math.max(...values.map((row) => row[index]));
  const range = Math.max(1, max - min);
  const points = values.map((row, i) => `${(i / (values.length - 1)) * 560},${82 - ((row[index] - min) / range) * 70}`).join(" ");
  return <svg viewBox="0 0 560 92" role="img" style={{ width: "100%", height: 92 }}><path d="M0 82H560" stroke="#b9aa91"/><polyline points={points} fill="none" stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke"/></svg>;
}

export function RetentionHub(props: { records: CourseRecords; profile: AppProfile; context: AchievementContext; onClose: () => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("history");
  const earned = new Map(props.profile.achievements.earned.map((entry) => [entry.id, entry]));
  const hardest = props.records.holes.map((hole, index) => ({ index, delta: hole.rounds ? (hole.strokes - hole.par) / hole.rounds : 0, rounds: hole.rounds })).filter((hole) => hole.rounds).sort((a, b) => b.delta - a.delta);
  return <div role="dialog" aria-modal="true" aria-labelledby="retention-title" data-testid="retention-hub" style={{ position: "fixed", inset: 0, zIndex: 100040, background: "rgba(16,24,18,.72)", padding: 18, display: "grid", placeItems: "center" }} onClick={props.onClose}>
    <section className="cc-tycoon-panel" style={{ width: "min(980px,100%)", maxHeight: "92vh", overflow: "hidden", background: "#f7f0df", border: "3px solid #8d806c", borderRadius: 18, display: "grid", gridTemplateRows: "auto auto minmax(0,1fr)" }} onClick={(event) => event.stopPropagation()}>
      <header style={{ padding: 18, display: "flex", justifyContent: "space-between", alignItems: "center", background: "#3d4a3e", color: "white" }}><div><div id="retention-title" style={{ fontSize: 24, fontWeight: 900 }}>{t("retention.title")}</div><div style={{ opacity: .8 }}>{t("retention.subtitle")}</div></div><button aria-label={t("common.close")} onClick={props.onClose}>✕</button></header>
      <nav aria-label={t("retention.tabs")} style={{ display: "flex", gap: 6, padding: 10, overflowX: "auto", borderBottom: "1px solid #b9aa91" }}>{(["history", "records", "hall", "achievements"] as Tab[]).map((item) => <button key={item} onClick={() => setTab(item)} aria-pressed={tab === item} style={{ padding: "9px 14px", borderRadius: 8, border: "1px solid #8d806c", background: tab === item ? "#5c8a4e" : "#fffdf6", color: tab === item ? "white" : "#26362d", fontWeight: 800 }}>{t(`retention.tab.${item}`)}</button>)}</nav>
      <div style={{ overflow: "auto", padding: 18 }}>
        {tab === "history" && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(330px,1fr))", gap: 14 }}>{SERIES.map((series) => <article key={series.key} style={{ background: "#fffdf6", border: "1px solid #b9aa91", borderRadius: 12, padding: 12 }}><strong>{t(series.key)}</strong><Sparkline rows={props.records.history} index={series.index} color={series.color}/></article>)}</div>}
        {tab === "records" && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 14 }}>
          <RecordCard icon="🏆" label={t("retention.bestRound")} value={props.records.bestRound ? `${props.records.bestRound.golferName} · ${props.records.bestRound.scoreToPar > 0 ? "+" : ""}${props.records.bestRound.scoreToPar}` : "—"}/>
          <RecordCard icon="🎯" label={t("retention.aces")} value={String(props.records.aces.length)}/>
          <RecordCard icon="💵" label={t("retention.revenueRecord")} value={props.records.recordRevenue ? `$${Math.round(props.records.recordRevenue.amount).toLocaleString()}` : "—"}/>
          <RecordCard icon="👥" label={t("retention.attendanceRecord")} value={String(props.records.attendanceRecord?.rounds ?? 0)}/>
          <RecordCard icon="🔥" label={t("retention.profitStreak")} value={String(props.records.longestProfitStreak)}/>
          <RecordCard icon="⛳" label={t("retention.hardestHole")} value={hardest[0] ? `${hardest[0].index + 1} · ${hardest[0].delta.toFixed(2)}` : "—"}/>
        </div>}
        {tab === "hall" && <div style={{ display: "grid", gap: 9 }}>{props.records.hall.length ? props.records.hall.map((entry, index) => <div key={`${entry.golferName}-${index}`} style={{ display: "grid", gridTemplateColumns: "44px 1fr auto auto", gap: 12, alignItems: "center", background: "#fffdf6", border: "1px solid #b9aa91", borderRadius: 10, padding: 11 }}><span style={{ fontSize: 24 }}>{index === 0 ? "🏆" : "🏌️"}</span><span><strong>{entry.golferName}</strong><small style={{ display: "block", opacity: .65 }}>{entry.archetype}</small></span><span>{t("retention.roundCount", { count: entry.rounds })}</span><span>{t("retention.aceCount", { count: entry.aces })}</span></div>) : <div>{t("retention.emptyHall")}</div>}</div>}
        {tab === "achievements" && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>{ACHIEVEMENTS.map((definition) => { const award = earned.get(definition.id); const progress = achievementProgress(definition, props.context); const concealed = definition.hidden && !award; return <article key={definition.id} data-earned={Boolean(award)} style={{ minHeight: 148, padding: 14, borderRadius: 12, border: `2px solid ${award ? "#c99a32" : "#a69c89"}`, background: award ? "linear-gradient(145deg,#fff8d8,#f3df9f)" : "#ded8ca", filter: award ? undefined : "grayscale(.7)" }}><div style={{ fontSize: 30 }}>{concealed ? "❓" : definition.icon}</div><strong>{concealed ? "???" : definition.title}</strong><p style={{ margin: "6px 0", fontSize: 13 }}>{concealed ? t("retention.hiddenHint") : definition.hint}</p><progress max={definition.target} value={Math.min(definition.target, progress)} style={{ width: "100%" }}/><small>{Math.min(definition.target, Math.floor(progress))} / {definition.target}</small></article>; })}</div>}
      </div>
    </section>
  </div>;
}

function RecordCard({ icon, label, value }: { icon: string; label: string; value: string }) { return <article style={{ background: "linear-gradient(145deg,#fffdf6,#eadfca)", border: "2px solid #b3945a", borderRadius: 12, padding: 16, minHeight: 120 }}><div style={{ fontSize: 30 }}>{icon}</div><small>{label}</small><div style={{ fontWeight: 900, fontSize: 19, marginTop: 6 }}>{value}</div></article>; }
