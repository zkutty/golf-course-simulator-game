import type { GolferSnapshot } from "../game/live/types";
import { ARCHETYPES } from "../game/live/archetypes";

function moodFace(mood: number): string {
  if (mood >= 0.8) return "😄";
  if (mood >= 0.6) return "🙂";
  if (mood >= 0.4) return "😐";
  if (mood >= 0.2) return "🙁";
  return "😠";
}

function scoreLabel(toPar: number): string {
  if (toPar === 0) return "E";
  return toPar > 0 ? `+${toPar}` : `${toPar}`;
}

function strokeColor(strokes: number, par: number): string {
  const d = strokes - par;
  if (d <= -2) return "#fcd34d"; // eagle+
  if (d === -1) return "#6ee7b7"; // birdie
  if (d === 0) return "#e5e7eb"; // par
  if (d === 1) return "#fda4af"; // bogey
  return "#f87171"; // double+
}

// Floating inspector for the selected on-course golfer: identity, live status,
// and a per-hole scorecard revealed as they play (ZKU-134 / ZKU-109).
export function GolferInspector(props: {
  golfer: GolferSnapshot;
  onClose: () => void;
}) {
  const { golfer, onClose } = props;
  const arch = ARCHETYPES[golfer.archetype];
  const played = golfer.holes.filter((h) => h.strokes != null);
  const status = golfer.finished
    ? golfer.leftEarly
      ? "Left early 😠"
      : "Finished — heading home"
    : golfer.leftEarly
      ? "Storming off…"
      : golfer.waiting && golfer.currentHole >= 0
        ? `Waiting at hole ${golfer.currentHole + 1} tee`
        : golfer.currentHole >= 0
          ? `On hole ${golfer.currentHole + 1}`
          : "Walking the grounds";

  return (
    <div
      style={{
        position: "absolute",
        top: 14,
        right: 14,
        width: 232,
        maxHeight: "72%",
        overflowY: "auto",
        padding: "12px 14px",
        borderRadius: 12,
        background: "rgba(24, 33, 26, 0.92)",
        color: "#f5f5f0",
        boxShadow: "0 6px 22px rgba(0,0,0,0.35)",
        backdropFilter: "blur(4px)",
        fontFamily: "Nunito, system-ui, sans-serif",
        fontSize: 13,
        zIndex: 41,
        userSelect: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: arch?.color ?? "#fff",
            border: "2px solid rgba(255,255,255,0.5)",
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, lineHeight: 1.15 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{golfer.name}</div>
          <div style={{ opacity: 0.7, fontSize: 11 }}>{arch?.label ?? golfer.archetype}</div>
        </div>
        <button
          onClick={onClose}
          title="Close"
          style={{
            border: "none",
            background: "rgba(255,255,255,0.08)",
            color: "#e5e7eb",
            borderRadius: 8,
            width: 24,
            height: 24,
            cursor: "pointer",
            fontSize: 13,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 10, lineHeight: 1.15 }}>
        <div>
          <div style={{ fontWeight: 700 }}>{status}</div>
          <div style={{ opacity: 0.65, fontSize: 11 }}>Status</div>
        </div>
        <div>
          <div style={{ fontWeight: 700 }}>
            {golfer.strokes} ({scoreLabel(golfer.scoreToPar)})
          </div>
          <div style={{ opacity: 0.65, fontSize: 11 }}>Strokes</div>
        </div>
        <div>
          <div style={{ fontWeight: 700 }}>{moodFace(golfer.mood)}</div>
          <div style={{ opacity: 0.65, fontSize: 11 }}>Mood</div>
        </div>
      </div>

      {/* mood bar */}
      <div
        style={{
          marginTop: 8,
          height: 5,
          borderRadius: 3,
          background: "rgba(255,255,255,0.12)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.round(golfer.mood * 100)}%`,
            height: "100%",
            borderRadius: 3,
            background: `hsl(${Math.round(120 * Math.max(0, Math.min(1, golfer.mood)))}, 75%, 50%)`,
            transition: "width 0.3s ease",
          }}
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ opacity: 0.65, fontSize: 11, marginBottom: 4 }}>
          Scorecard ({played.length}/{golfer.holes.length} holes)
        </div>
        {played.length === 0 ? (
          <div style={{ opacity: 0.55, fontSize: 12 }}>No holes completed yet.</div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(6, 1fr)",
              gap: 4,
            }}
          >
            {golfer.holes.map((h) => (
              <div
                key={h.holeNumber}
                title={`Hole ${h.holeNumber + 1} — par ${h.par}`}
                style={{
                  textAlign: "center",
                  padding: "3px 0",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.06)",
                  opacity: h.strokes == null ? 0.4 : 1,
                  lineHeight: 1.1,
                }}
              >
                <div style={{ fontSize: 9, opacity: 0.6 }}>H{h.holeNumber + 1}</div>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: 12,
                    color: h.strokes == null ? "#9ca3af" : strokeColor(h.strokes, h.par),
                  }}
                >
                  {h.strokes ?? "·"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 10, opacity: 0.7, fontSize: 11 }}>
        Spent today: ${Math.round(golfer.spent).toLocaleString()}
      </div>
    </div>
  );
}
