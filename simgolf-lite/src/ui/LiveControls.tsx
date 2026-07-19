import type { SpeedName } from "../game/live/liveConfig";
import type { LiveStatus } from "../hooks/useLiveSimulation";

const SPEEDS: { key: SpeedName; label: string }[] = [
  { key: "paused", label: "❚❚" },
  { key: "1x", label: "▶" },
  { key: "2x", label: "▶▶" },
  { key: "3x", label: "▶▶▶" },
];

function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString()}`;
}

// Floating real-time control bar: game clock, speed controls, and live day
// stats. Overlays the bottom of the course view.
export function LiveControls(props: {
  status: LiveStatus;
  speed: SpeedName;
  onSetSpeed: (s: SpeedName) => void;
  cash: number;
  reputation: number;
}) {
  const { status, speed, onSetSpeed, cash, reputation } = props;
  const last = status.lastDay;

  return (
    <div
      data-tutorial-target="speed-controls"
      style={{
        position: "absolute",
        left: "50%",
        bottom: 14,
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "8px 14px",
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
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{status.clockLabel}</span>
        <span style={{ opacity: 0.7, fontSize: 11 }}>Day {status.dayIndex + 1} / 7</span>
      </div>

      <div style={{ display: "flex", gap: 4 }}>
        {SPEEDS.map((s) => {
          const active = speed === s.key;
          return (
            <button
              key={s.key}
              onClick={() => onSetSpeed(s.key)}
              title={s.key === "paused" ? "Pause" : `Speed ${s.key}`}
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

      <div style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.15)" }} />

      <Stat label="On course" value={`${status.onCourse}`} />
      <Stat label="Rounds today" value={`${status.roundsToday}`} />
      <Stat label="Fees today" value={money(status.greenFeesToday)} accent="#bbf7d0" />
      <Stat label="Shops today" value={money(status.concessionsToday)} accent="#fde68a" />
      <Stat label="Cash" value={money(cash)} accent={cash < 0 ? "#fca5a5" : "#e2e8f0"} />
      <Stat label="Rep" value={`${Math.round(reputation)}`} />

      {last && (
        <>
          <div style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.15)" }} />
          <Stat
            label="Yesterday P&L"
            value={money(last.profit)}
            accent={last.profit >= 0 ? "#bbf7d0" : "#fca5a5"}
          />
        </>
      )}
    </div>
  );
}

function Stat(props: { label: string; value: string; accent?: string }) {
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
    <div data-tooltip={help[props.label] ?? `Current ${props.label.toLowerCase()} value.`} style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
      <span style={{ fontWeight: 700, color: props.accent ?? "#f5f5f0" }}>{props.value}</span>
      <span style={{ opacity: 0.65, fontSize: 11 }}>{props.label}</span>
    </div>
  );
}
