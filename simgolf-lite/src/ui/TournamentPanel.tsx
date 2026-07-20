import { useMemo, useState } from "react";
import { formatCurrency, formatDayLabel } from "../i18n/format";
import { useI18n } from "../i18n/useI18n";
import { absoluteGameDay, TOURNAMENT_TIERS, tournamentCalendar } from "../game/tournaments/tournaments";
import type { TournamentStanding, TournamentTier } from "../game/tournaments/types";
import type { World } from "../game/models/types";
import type { LiveStatus } from "../hooks/useLiveSimulation";

function score(value: number): string {
  return value > 0 ? `+${value}` : value === 0 ? "E" : `${value}`;
}

function Leaderboard(props: { rows: TournamentStanding[] }) {
  return (
    <ol data-testid="tournament-leaderboard" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
      {props.rows.map((row, index) => (
        <li key={row.entrantId} style={{ display: "grid", gridTemplateColumns: "24px minmax(0,1fr) 52px 44px", gap: 8, alignItems: "center", padding: "7px 8px", borderRadius: 7, background: index < 3 ? "rgba(190,145,45,.13)" : "rgba(44,58,44,.055)" }}>
          <strong>{index + 1}</strong>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>
          <small>{row.finished ? "F" : `${row.holesCompleted} thru`}</small>
          <strong style={{ textAlign: "right", color: row.scoreToPar < 0 ? "#1d6b3a" : row.scoreToPar > 0 ? "#a23a2b" : undefined }}>{score(row.scoreToPar)}</strong>
        </li>
      ))}
    </ol>
  );
}

export function TournamentPanel(props: {
  world: World;
  currentDay: number;
  liveTournament: LiveStatus["tournament"];
  onSchedule: (tier: TournamentTier, daysAhead: number) => string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [tier, setTier] = useState<TournamentTier>("local");
  const [daysAhead, setDaysAhead] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const events = tournamentCalendar(props.world).events;
  const now = absoluteGameDay(props.world.week, props.currentDay);
  const upcoming = useMemo(() => events.filter((event) => event.status === "scheduled" && event.id !== props.liveTournament?.eventId).sort((a, b) => absoluteGameDay(a.scheduledWeek, a.scheduledDay) - absoluteGameDay(b.scheduledWeek, b.scheduledDay)), [events, props.liveTournament?.eventId]);
  const completed = useMemo(() => events.filter((event) => event.status === "completed").slice(-4).reverse(), [events]);
  const spec = TOURNAMENT_TIERS[tier];

  return (
    <section role="dialog" aria-modal="false" aria-labelledby="tournament-title" data-testid="tournament-panel" style={{ position: "absolute", top: 54, left: 10, zIndex: 180, width: "min(420px, calc(100% - 20px))", maxHeight: "calc(100% - 126px)", overflow: "auto", borderRadius: 14, border: "2px solid #8a6826", background: "#fbf4df", color: "#253126", boxShadow: "0 14px 38px rgba(0,0,0,.36)" }}>
      <header style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: "12px 14px", background: "#334f38", color: "#fff8dc", borderBottom: "2px solid #c39a43" }}>
        <div><small style={{ opacity: .72 }}>{t("tournament.eyebrow")}</small><h2 id="tournament-title" style={{ margin: 0, fontSize: 20 }}>{t("tournament.title")}</h2></div>
        <button aria-label={t("tournament.close")} onClick={props.onClose} style={{ border: "1px solid rgba(255,255,255,.35)", borderRadius: 7, background: "rgba(255,255,255,.1)", color: "white", padding: "6px 9px", cursor: "pointer" }}>✕</button>
      </header>

      <div style={{ padding: 14, display: "grid", gap: 16 }}>
        {props.liveTournament && (
          <section data-testid="active-tournament">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", marginBottom: 8 }}><div><small style={{ color: "#8a2e20", fontWeight: 900 }}>{t("tournament.live")}</small><h3 style={{ margin: 0 }}>{props.liveTournament.name}</h3></div><span>{props.liveTournament.standings.filter((row) => row.finished).length}/{props.liveTournament.standings.length}</span></div>
            <Leaderboard rows={props.liveTournament.standings} />
          </section>
        )}

        {!props.liveTournament && (
          <section style={{ display: "grid", gap: 9 }}>
            <h3 style={{ margin: 0 }}>{t("tournament.schedule")}</h3>
            <label style={{ display: "grid", gap: 4 }}>{t("tournament.tier")}
              <select data-testid="tournament-tier" value={tier} onChange={(event) => setTier(event.target.value as TournamentTier)} style={{ padding: 9, borderRadius: 7, border: "1px solid #9e8a60", background: "#fffdf6" }}>
                {(Object.keys(TOURNAMENT_TIERS) as TournamentTier[]).map((key) => <option key={key} value={key}>{TOURNAMENT_TIERS[key].label}</option>)}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>{t("tournament.date")}
              <select data-testid="tournament-date" value={daysAhead} onChange={(event) => setDaysAhead(Number(event.target.value))} style={{ padding: 9, borderRadius: 7, border: "1px solid #9e8a60", background: "#fffdf6" }}>
                <option value={1}>{t("tournament.tomorrow")}</option><option value={3}>{t("tournament.threeDays")}</option><option value={7}>{t("tournament.nextWeek")}</option>
              </select>
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, padding: 9, borderRadius: 8, background: "rgba(66,91,62,.08)", fontSize: 12 }}><span><strong>{spec.fieldSize}</strong><br />{t("tournament.players")}</span><span><strong>{formatCurrency(spec.bookingCost)}</strong><br />{t("tournament.deposit")}</span><span><strong>+{spec.reputationAward}</strong><br />{t("tournament.reputation")}</span></div>
            <small>{t("tournament.payout", { amount: formatCurrency(spec.revenueAward), reputation: spec.minReputation })}</small>
            <button data-testid="schedule-tournament" onClick={() => setNotice(props.onSchedule(tier, daysAhead) ?? t("tournament.booked"))} style={{ border: "1px solid #426143", borderRadius: 8, background: "#426143", color: "white", padding: "10px 12px", fontWeight: 900, cursor: "pointer" }}>{t("tournament.book")}</button>
            {notice && <div role="status" style={{ padding: 8, borderRadius: 7, background: notice === t("tournament.booked") ? "#e2f2df" : "#f8e2dc", color: "#432" }}>{notice}</div>}
          </section>
        )}

        {upcoming.length > 0 && <section><h3 style={{ margin: "0 0 7px" }}>{t("tournament.upcoming")}</h3>{upcoming.map((event) => { const days = absoluteGameDay(event.scheduledWeek, event.scheduledDay) - now; return <div key={event.id} style={{ padding: "8px 0", borderTop: "1px solid rgba(60,70,55,.16)" }}><strong>{event.name}</strong><div><small>{formatDayLabel(event.scheduledDay + 1)}, {t("tournament.week", { week: event.scheduledWeek })} · {days === 1 ? t("tournament.inOneDay") : t("tournament.inDays", { days })}</small></div></div>; })}</section>}

        {completed.length > 0 && <section><h3 style={{ margin: "0 0 7px" }}>{t("tournament.results")}</h3>{completed.map((event) => <details key={event.id} style={{ padding: "8px 0", borderTop: "1px solid rgba(60,70,55,.16)" }}><summary style={{ cursor: "pointer" }}><strong>{event.name}</strong><br /><small>{t("tournament.wonBy", { winner: event.winnerName ?? "—" })} · +{formatCurrency(event.revenueAward)} · +{event.reputationAward} {t("tournament.repShort")}</small></summary>{event.results && <div style={{ marginTop: 7 }}><Leaderboard rows={event.results} /></div>}</details>)}</section>}
      </div>
    </section>
  );
}
