import type { SelectedGolferDetail } from "../hooks/useLiveSimulation";
import { ARCHETYPES } from "../game/live/archetypes";
import type { GolferArchetypeName } from "../game/live/types";

function toPar(n: number): string {
  if (n === 0) return "E";
  return n > 0 ? `+${n}` : `${n}`;
}

function moodLabel(m: number): string {
  if (m >= 0.8) return "Delighted";
  if (m >= 0.6) return "Happy";
  if (m >= 0.4) return "Okay";
  if (m >= 0.2) return "Frustrated";
  return "Fed up";
}

// Overlay panel showing the currently selected golfer: who they are, where they
// are in their round, and a live hole-by-hole scorecard. Reads the throttled
// `selected` detail from useLiveSimulation — no per-frame work here.
export function GolferInspector(props: {
  selected: SelectedGolferDetail | null;
  onClose: () => void;
}) {
  const { selected, onClose } = props;
  if (!selected) return null;

  const arch = ARCHETYPES[selected.archetype as GolferArchetypeName];
  const moodHue = Math.round(120 * Math.max(0, Math.min(1, selected.mood)));
  const holeText =
    selected.currentHole >= 0 ? `Hole ${selected.currentHole + 1}` : "Clubhouse";
  const played = selected.scoredHoles;

  return (
    <div
      style={{
        position: "absolute",
        left: 14,
        top: 14,
        width: 232,
        padding: "12px 14px",
        borderRadius: 12,
        background: "rgba(24, 33, 26, 0.9)",
        color: "#f5f5f0",
        boxShadow: "0 6px 22px rgba(0,0,0,0.35)",
        backdropFilter: "blur(4px)",
        fontFamily: "Nunito, system-ui, sans-serif",
        fontSize: 13,
        zIndex: 45,
        userSelect: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: selected.color,
            border: "1px solid rgba(0,0,0,0.4)",
            flex: "0 0 auto",
          }}
        />
        <div style={{ lineHeight: 1.15, flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{selected.name}</div>
          <div style={{ opacity: 0.7, fontSize: 11 }}>{arch?.label ?? selected.archetype}</div>
        </div>
        <button
          onClick={onClose}
          title="Close"
          style={{
            border: "none",
            background: "rgba(255,255,255,0.1)",
            color: "#e5e7eb",
            borderRadius: 6,
            width: 22,
            height: 22,
            cursor: "pointer",
            fontSize: 13,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ display: "flex", gap: 14, marginTop: 10 }}>
        <Stat label="Position" value={holeText} />
        <Stat label="Score" value={toPar(selected.scoreToPar)} accent="#bbf7d0" />
        <Stat label="Thru" value={`${played}`} />
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, opacity: 0.7 }}>
          <span>Mood</span>
          <span>{moodLabel(selected.mood)}</span>
        </div>
        <div
          style={{
            height: 7,
            borderRadius: 4,
            background: "rgba(255,255,255,0.14)",
            marginTop: 3,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${Math.round(selected.mood * 100)}%`,
              height: "100%",
              background: `hsl(${moodHue}, 75%, 50%)`,
            }}
          />
        </div>
      </div>

      {played > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>Scorecard</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {selected.holeStrokes.slice(0, played).map((strokes, i) => {
              const d = strokes - selected.holePar[i];
              const bg =
                d < 0 ? "rgba(134,239,172,0.22)" : d > 1 ? "rgba(252,165,165,0.22)" : "rgba(255,255,255,0.08)";
              return (
                <div
                  key={i}
                  title={`Hole ${i + 1} · par ${selected.holePar[i]} · ${toPar(d)}`}
                  style={{
                    width: 34,
                    padding: "3px 0",
                    borderRadius: 6,
                    background: bg,
                    textAlign: "center",
                    lineHeight: 1.1,
                  }}
                >
                  <div style={{ fontSize: 9, opacity: 0.6 }}>{i + 1}</div>
                  <div style={{ fontWeight: 700 }}>{strokes}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat(props: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
      <span style={{ fontWeight: 800, fontSize: 15, color: props.accent ?? "#f5f5f0" }}>
        {props.value}
      </span>
      <span style={{ opacity: 0.65, fontSize: 11 }}>{props.label}</span>
    </div>
  );
}
