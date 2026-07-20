import { LIVE, type SpeedName } from "../game/live/liveConfig";
import { formatCurrency, formatDayLabel } from "../i18n/format";
import type { LiveStatus } from "../hooks/useLiveSimulation";
import { translateCurrent } from "../i18n/core";

const SPEEDS: { key: SpeedName; label: string }[] = [
  { key: "paused", label: "❚❚" },
  { key: "1x", label: "1×" },
  { key: "2x", label: "2×" },
  { key: "3x", label: "3×" },
];

function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}${formatCurrency(Math.abs(n))}`;
}

// Floating real-time control bar: game clock, speed controls, and live day
// stats. Overlays the bottom of the course view.
export function LiveControls(props: {
  status: LiveStatus;
  speed: SpeedName;
  onSetSpeed: (s: SpeedName) => void;
  cash: number;
  reputation: number;
  onOpenPauseMenu?: () => void;
  onOpenOverview?: () => void;
  overviewOpen?: boolean;
}) {
  const { status, speed, onSetSpeed, cash, reputation } = props;
  const last = status.lastDay;

  return (
    <div
      className="cc-live-controls"
      data-tutorial-target="speed-controls"
      style={{
        position: "absolute",
        left: "50%",
        bottom: 14,
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 12,
        background: "rgba(24, 33, 26, 0.86)",
        color: "#f5f5f0",
        boxShadow: "0 6px 22px rgba(0,0,0,0.35)",
        backdropFilter: "blur(4px)",
        fontFamily: "Nunito, system-ui, sans-serif",
        fontSize: 13,
        zIndex: 40,
        userSelect: "none",
        maxWidth: "94%",
        flexWrap: "wrap",
        justifyContent: "center",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1, minWidth: 88 }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{status.clockLabel}</span>
        <span style={{ opacity: 0.7, fontSize: 11 }}>{formatDayLabel(status.dayIndex + 1)}</span>
        <div aria-hidden="true" style={{ height: 3, borderRadius: 3, background: "rgba(255,255,255,.14)", marginTop: 4, overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.min(100, Math.max(0, status.dayMinute / LIVE.day.closeMinute * 100))}%`, background: "#86efac" }} /></div>
      </div>

      <div style={{ display: "flex", gap: 4 }}>
        {SPEEDS.map((s) => {
          const active = speed === s.key;
          return (
            <button
              key={s.key}
              onClick={() => onSetSpeed(s.key)}
              title={s.key === "paused" ? "Pause" : `Speed ${s.key}`}
              aria-pressed={active}
              data-testid={`speed-${s.key}`}
              style={{
                minWidth: 34,
                padding: "5px 8px",
                borderRadius: 8,
                border: active ? "1px solid #86efac" : "1px solid rgba(255,255,255,0.18)",
                background: active ? "rgba(134,239,172,0.22)" : "rgba(255,255,255,0.06)",
                color: active ? "#bbf7d0" : "#e5e7eb",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {props.onOpenPauseMenu && (
        <button onClick={props.onOpenPauseMenu} title={translateCurrent("auto.ui.livecontrols.pause.menu")} aria-label={translateCurrent("auto.ui.livecontrols.open.pause.menu")} style={{ minWidth: 34, padding: "5px 8px", borderRadius: 8, border: "1px solid rgba(255,255,255,.3)", background: "rgba(255,255,255,.1)", color: "white", cursor: "pointer", fontWeight: 800 }}>☰</button>
      )}

      {props.onOpenOverview && (
        <button onClick={props.onOpenOverview} aria-pressed={props.overviewOpen} aria-label={translateCurrent("live.openOverview")} style={{ minWidth: 42, padding: "5px 8px", borderRadius: 8, border: props.overviewOpen ? "1px solid #86efac" : "1px solid rgba(255,255,255,.3)", background: props.overviewOpen ? "rgba(134,239,172,.2)" : "rgba(255,255,255,.1)", color: "white", cursor: "pointer", fontWeight: 800 }}>👥 {status.onCourse}</button>
      )}

      <div style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.15)" }} />

      <Stat label={translateCurrent("live.onCourse")} value={`${status.onCourse}`} testId="live-stat-on-course" />
      <Stat label={translateCurrent("live.roundsToday")} value={`${status.roundsToday}`} />
      <Stat label={translateCurrent("live.feesToday")} value={money(status.greenFeesToday)} accent="#bbf7d0" />
      <Stat label={translateCurrent("live.shopsToday")} value={money(status.concessionsToday)} accent="#fde68a" />
      <Stat label={translateCurrent("stat.cash")} value={money(cash)} accent={cash < 0 ? "#fca5a5" : "#e2e8f0"} />
      <Stat label={translateCurrent("stat.reputationShort")} value={`${Math.round(reputation)}`} />

      {last && (
        <>
          <div style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.15)" }} />
          <Stat
            label={translateCurrent("live.yesterdayProfitLoss")}
            value={money(last.profit)}
            accent={last.profit >= 0 ? "#bbf7d0" : "#fca5a5"}
          />
        </>
      )}
    </div>
  );
}

function Stat(props: { label: string; value: string; accent?: string; testId?: string }) {
  const help: Record<string, string> = {
    "On course": "Golfers currently playing or moving through the course.",
    "Rounds today": "Rounds completed since the current in-game day began.",
    "Fees today": "Green-fee revenue collected during the current in-game day.",
    "Shops today": "Concession revenue collected during the current in-game day.",
    Cash: "Available operating cash after live income and expenses.",
    Rep: "Current course reputation, which supports future golfer demand.",
    "Yesterday P&L": "The previous in-game day's revenue minus expenses.",
  };
  return (
    <div data-testid={props.testId} data-tooltip={help[props.label] ?? `Current ${props.label.toLowerCase()} value.`} style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
      <span style={{ fontWeight: 700, color: props.accent ?? "#f5f5f0" }}>{props.value}</span>
      <span style={{ opacity: 0.65, fontSize: 11 }}>{props.label}</span>
    </div>
  );
}
