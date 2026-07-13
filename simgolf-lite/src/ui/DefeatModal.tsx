import { useState } from "react";
import type { DefeatReason, ObjectiveState } from "../game/models/objectives";

// Defeat screen (ZKU-163): one screen for every way a run ends — bankruptcy
// or a missed objective deadline — offering retry-same-seed / load / new game.

export function DefeatModal(props: {
  reason: DefeatReason;
  objectives?: ObjectiveState | null;
  weeksSurvived: number;
  peakCash: number;
  peakRep: number;
  courseRating: number;
  slope: number;
  seed: number;
  onRetrySeed: (seed: number) => void;
  onNewGame: () => void;
  onLoad: () => void;
}) {
  const [seed, setSeed] = useState(props.seed);
  const missed =
    props.reason === "DEADLINE" && props.objectives
      ? props.objectives.goals.filter(
          (g, i) =>
            g.deadlineWeek != null &&
            !props.objectives!.progress[i]?.met
        )
      : [];

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
      <div style={{ width: "min(560px, 100%)", background: "#fff", borderRadius: 14, padding: 18 }}>
        <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 6 }}>
          {props.reason === "BANKRUPT" ? "Run ended: Bankruptcy" : "Run ended: Time ran out"}
        </div>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
          {props.reason === "BANKRUPT"
            ? "The bank called it. Retry the same land with a new plan, load a save, or start fresh."
            : "The deadline passed with objectives unfinished. Same seed gives a comparable retry."}
        </div>

        {missed.length > 0 && (
          <div
            style={{
              marginBottom: 12,
              padding: 10,
              borderRadius: 10,
              border: "1px solid #f0b4b4",
              background: "#fff5f5",
              fontSize: 12,
            }}
          >
            {missed.map((g) => (
              <div key={g.id}>
                ❌ <b>{g.label}</b> — needed by week {g.deadlineWeek}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
          <Row label="Weeks survived" value={`${props.weeksSurvived}`} />
          <Row label="Peak reputation" value={`${props.peakRep}`} />
          <Row label="Peak cash" value={`$${Math.round(props.peakCash).toLocaleString()}`} />
          <Row
            label="Course rating / slope"
            value={`${props.courseRating.toFixed(1)} / ${Math.round(props.slope)}`}
          />
        </div>

        <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <label style={{ flex: 1, fontSize: 12, color: "#374151" }}>
              Seed
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value))}
                style={{
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                }}
              />
            </label>
            <button
              onClick={() => props.onRetrySeed(seed | 0)}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid #000",
                background: "#000",
                color: "#fff",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Retry this run
            </button>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={props.onLoad}
              style={{
                flex: 1,
                padding: 11,
                borderRadius: 12,
                border: "1px solid #ddd",
                background: "#fff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Load a save
            </button>
            <button
              onClick={props.onNewGame}
              style={{
                flex: 1,
                padding: 11,
                borderRadius: 12,
                border: "1px solid #ddd",
                background: "#fff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              New game
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
