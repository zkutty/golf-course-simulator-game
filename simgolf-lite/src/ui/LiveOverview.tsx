import { useState } from "react";
import type { LiveStatus } from "../hooks/useLiveSimulation";
import { unlockedStaffRoles } from "../game/progression/progression";
import { translateCurrent } from "../i18n/core";

type Tab = "golfers" | "leaderboard" | "staff";
const TAB_LABELS = { golfers: "live.tab.golfers", leaderboard: "live.tab.leaderboard", staff: "live.tab.staff" } as const;

function score(value: number) { return value === 0 ? "E" : value > 0 ? `+${value}` : `${value}`; }

export function LiveOverview(props: { status: LiveStatus; reputation: number; staffLevel: number; onSelectGolfer: (id: number) => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("golfers");
  const golfers = [...props.status.golfers];
  const leaderboard = props.status.tournament
    ? props.status.tournament.standings.map((row) => ({ id: row.entrantId, name: row.name, scoreToPar: row.scoreToPar, thru: row.holesCompleted }))
    : [...golfers].sort((a, b) => a.scoreToPar - b.scoreToPar || b.currentHole - a.currentHole).map((row) => ({ id: String(row.id), name: row.name, scoreToPar: row.scoreToPar, thru: Math.max(0, row.currentHole) }));
  const roles = unlockedStaffRoles(props.reputation);
  return <aside className="cc-live-overview" data-testid="live-overview" style={{ position: "absolute", right: 14, top: 14, zIndex: 125, width: "min(360px,calc(100% - 28px))", maxHeight: "calc(100% - 110px)", overflow: "auto", padding: 13, borderRadius: 12, background: "rgba(24,33,26,.94)", color: "#f6f4e8", boxShadow: "0 10px 30px rgba(0,0,0,.4)" }}>
    <header style={{ display: "flex", gap: 8, alignItems: "center" }}><div style={{ flex: 1 }}><strong style={{ fontSize: 16 }}>{translateCurrent("live.overview")}</strong><div style={{ fontSize: 11, opacity: .7 }}>{translateCurrent("live.arrivals", { count: props.status.arrivalsRemaining })}</div></div><button aria-label={translateCurrent("live.closeOverview")} onClick={props.onClose}>✕</button></header>
    <div role="tablist" aria-label={translateCurrent("live.overviewTabs")} style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 4, margin: "11px 0" }}>
      {(["golfers", "leaderboard", "staff"] as Tab[]).map((name) => <button role="tab" aria-selected={tab === name} key={name} onClick={() => setTab(name)} style={{ padding: 7, borderRadius: 7, border: tab === name ? "1px solid #9bd18a" : "1px solid rgba(255,255,255,.18)", background: tab === name ? "rgba(112,171,91,.28)" : "rgba(255,255,255,.06)", color: "inherit" }}>{translateCurrent(TAB_LABELS[name])}</button>)}
    </div>
    {tab === "golfers" && <div style={{ display: "grid", gap: 5 }}>{golfers.length === 0 ? <small>{translateCurrent("live.noGolfers")}</small> : golfers.slice(0, 24).map((golfer) => <button key={golfer.id} onClick={() => props.onSelectGolfer(golfer.id)} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, textAlign: "left", alignItems: "center", padding: 8, borderRadius: 8, border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.06)", color: "inherit" }}><span><b>{golfer.name}</b><br /><small style={{ opacity: .65 }}>{golfer.currentHole >= 0 ? translateCurrent("live.hole", { hole: golfer.currentHole + 1 }) : translateCurrent("live.clubhouse")}</small></span><span>{score(golfer.scoreToPar)}</span><span title={translateCurrent("live.mood")}>{golfer.mood >= .65 ? "☺" : golfer.mood < .35 ? "☹" : "•"}</span></button>)}</div>}
    {tab === "leaderboard" && <ol style={{ margin: 0, paddingLeft: 24 }}>{leaderboard.slice(0, 12).map((row) => <li key={row.id} style={{ padding: "5px 0" }}><span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b>{row.name}</b><span>{score(row.scoreToPar)} · {row.thru} {translateCurrent("golfer.thru")}</span></span></li>)}</ol>}
    {tab === "staff" && <div><div style={{ padding: 9, borderRadius: 8, background: "rgba(255,255,255,.07)" }}><strong>{translateCurrent("live.staffCoverage", { active: props.staffLevel, available: roles.length })}</strong><div style={{ fontSize: 12, opacity: .72 }}>{translateCurrent("live.staffHint")}</div></div><ul style={{ marginBottom: 0 }}>{roles.map((role, index) => <li key={role} style={{ opacity: index < props.staffLevel ? 1 : .55, padding: "3px 0" }}>{index < props.staffLevel ? "●" : "○"} {role} — {index < props.staffLevel ? translateCurrent("live.onDuty") : translateCurrent("live.available")}</li>)}</ul></div>}
  </aside>;
}
