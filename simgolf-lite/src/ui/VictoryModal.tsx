import { useMemo } from "react";
import type { ObjectiveState } from "../game/models/objectives";

// Victory celebration (ZKU-163): confetti + summary; never force-quits the
// session — "Keep playing" just closes the modal.

const CONFETTI_COLORS = ["#D84848", "#F2C14E", "#7AB86D", "#5BA4CF", "#B36BD4", "#F28C6B"];

function ConfettiField() {
  // Purely decorative; a fixed pseudo-random layout keyed by index is plenty
  // (and keeps render deterministic).
  const pieces = useMemo(
    () =>
      Array.from({ length: 60 }, (_, i) => {
        const h = (i * 2654435761) % 1000;
        return {
          left: (h % 100) + "%",
          delay: `${((h >> 3) % 24) / 10}s`,
          duration: `${2.6 + ((h >> 5) % 18) / 10}s`,
          size: 6 + ((h >> 7) % 7),
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          rotate: (h % 360) + "deg",
        };
      }),
    []
  );
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      <style>
        {`@keyframes cc-confetti-fall {
            0% { transform: translateY(-40px) rotate(0deg); opacity: 1; }
            100% { transform: translateY(105vh) rotate(720deg); opacity: 0.7; }
          }`}
      </style>
      {pieces.map((p, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: -20,
            left: p.left,
            width: p.size,
            height: p.size * 0.5,
            background: p.color,
            borderRadius: 2,
            transform: `rotate(${p.rotate})`,
            animation: `cc-confetti-fall ${p.duration} linear ${p.delay} infinite`,
          }}
        />
      ))}
    </div>
  );
}

export function VictoryModal(props: {
  objectives: ObjectiveState;
  courseName: string;
  week: number;
  cash: number;
  reputation: number;
  courseRating: number;
  onContinue: () => void;
}) {
  const { objectives } = props;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 99999,
        padding: 16,
      }}
    >
      <ConfettiField />
      <div
        style={{
          width: "min(560px, 100%)",
          background: "#fffdf7",
          borderRadius: 18,
          padding: 24,
          border: "3px solid var(--cc-grass, #7AB86D)",
          boxShadow: "0 28px 60px rgba(0,0,0,0.35)",
          position: "relative",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 44, lineHeight: 1 }}>🏆</div>
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 28,
            fontWeight: 900,
            color: "#3d4a3e",
            marginTop: 6,
          }}
        >
          Objectives complete!
        </div>
        <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
          {props.courseName} met every goal
          {objectives.wonWeek != null ? ` by week ${objectives.wonWeek}` : ""}.
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            marginTop: 16,
            textAlign: "left",
            fontSize: 13,
          }}
        >
          <SummaryStat label="Week" value={`${props.week}`} />
          <SummaryStat label="Cash" value={`$${Math.round(props.cash).toLocaleString()}`} />
          <SummaryStat label="Reputation" value={`${props.reputation}/100`} />
          <SummaryStat label="Course rating" value={props.courseRating.toFixed(1)} />
        </div>

        <div style={{ display: "grid", gap: 6, marginTop: 14, textAlign: "left" }}>
          {objectives.goals.map((g, i) => (
            <div key={g.id} style={{ fontSize: 13 }}>
              ✅ <b>{g.label}</b>
              {objectives.progress[i]?.completedWeek != null && (
                <span style={{ color: "#6b7280" }}> — week {objectives.progress[i].completedWeek}</span>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={props.onContinue}
          style={{
            marginTop: 18,
            width: "100%",
            padding: 12,
            borderRadius: 12,
            border: "1px solid #3d4a3e",
            background: "#3d4a3e",
            color: "#fff",
            fontWeight: 800,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Keep playing
        </button>
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "8px 10px",
        borderRadius: 10,
        background: "rgba(122,184,109,0.12)",
        border: "1px solid rgba(0,0,0,0.06)",
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "#6b7280" }}>{label.toUpperCase()}</div>
      <div style={{ fontWeight: 800 }}>{value}</div>
    </div>
  );
}
