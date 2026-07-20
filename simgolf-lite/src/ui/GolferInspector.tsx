import type { SelectedGolferDetail } from "../hooks/useLiveSimulation";
import { formatCurrency } from "../i18n/format";
import { ARCHETYPES } from "../game/live/archetypes";
import type { GolferArchetypeName } from "../game/live/types";
import { recentEmotes } from "../game/render/emoteFeed";
import type { EmoteKind } from "../game/render/emotes";
import { T } from "../i18n/T";
import { translateCurrent } from "../i18n/core";

// Compact glyphs for the recent-thoughts strip (mirrors the on-course
// bubbles, ZKU-155).
const EMOTE_GLYPH: Record<EmoteKind, { char: string; color: string }> = {
  star: { char: "★", color: "#e8c15a" },
  happy: { char: "☺", color: "#ffd75e" },
  angry: { char: "☹", color: "#ef8354" },
  storm: { char: "☁", color: "#9ca3af" },
  zzz: { char: "Zz", color: "#94a3b8" },
  cashGood: { char: "$", color: "#86efac" },
  cashBad: { char: "$", color: "#fca5a5" },
  alert: { char: "!", color: "#fca5a5" },
};

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
  following?: boolean;
  onToggleFollow?: () => void;
}) {
  const { selected, onClose } = props;
  if (!selected) return null;

  const arch = ARCHETYPES[selected.archetype as GolferArchetypeName];
  const moodHue = Math.round(120 * Math.max(0, Math.min(1, selected.mood)));
  const holeText =
    selected.currentHole >= 0 ? `Hole ${selected.currentHole + 1}` : "Clubhouse";
  const played = selected.scoredHoles;

  return (
    <div className="cc-golfer-inspector"
      style={{
        position: "absolute",
        left: 14,
        top: 58,
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
          title={translateCurrent("auto.ui.golferinspector.close")}
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
        <Stat label={translateCurrent("golfer.position")} value={holeText} />
        <Stat label={translateCurrent("golfer.score")} value={toPar(selected.scoreToPar)} accent="#bbf7d0" />
        <Stat label={translateCurrent("golfer.thru")} value={`${played}`} />
        <Stat label={translateCurrent("golfer.spent")} value={formatCurrency(selected.spent)} accent="#bbf7d0" />
        <Stat label={translateCurrent("golfer.wallet")} value={formatCurrency(selected.wallet)} />
      </div>

      {props.onToggleFollow && <button aria-pressed={props.following} aria-label={translateCurrent(props.following ? "live.stopFollowing" : "live.followGolfer")} onClick={props.onToggleFollow} style={{ width: "100%", marginTop: 10, padding: "7px 9px", borderRadius: 8, border: props.following ? "1px solid #86efac" : "1px solid rgba(255,255,255,.25)", background: props.following ? "rgba(134,239,172,.2)" : "rgba(255,255,255,.08)", color: "inherit", fontWeight: 800, cursor: "pointer" }}>{props.following ? `◎ ${translateCurrent("live.following")}` : `◉ ${translateCurrent("live.follow")}`}</button>}

      <div style={{ marginTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, opacity: 0.7 }}>
          <span><T id="auto.ui.golferinspector.mood" /></span>
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

      {recentEmotes(selected.id).length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}><T id="auto.ui.golferinspector.recent.thoughts" /></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {[...recentEmotes(selected.id)].reverse().map((e, i) => (
              <div key={`${e.atMs}-${i}`} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
                <span
                  style={{
                    color: EMOTE_GLYPH[e.kind].color,
                    fontWeight: 800,
                    width: 16,
                    textAlign: "center",
                    flex: "0 0 auto",
                  }}
                >
                  {EMOTE_GLYPH[e.kind].char}
                </span>
                <span style={{ opacity: 0.85 }}>{e.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {played > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}><T id="auto.ui.golferinspector.scorecard" /></div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {selected.holeStrokes.slice(0, played).map((strokes, i) => {
              const d = strokes - selected.holePar[i];
              const bg =
                d < 0 ? "rgba(134,239,172,0.22)" : d > 1 ? "rgba(252,165,165,0.22)" : "rgba(255,255,255,0.08)";
              return (
                <div
                  key={i}
                  title={translateCurrent("golfer.holeScoreTitle", { hole: i + 1, par: selected.holePar[i], score: toPar(d) })}
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
  const help: Record<string, string> = {
    Position: "This golfer's current tile on the course grid.",
    Score: "This golfer's running score relative to par.",
    Thru: "The number of holes this golfer has completed.",
    Spent: "Total green-fee and concession spending during this visit.",
    Wallet: "Cash this golfer still has available for concessions.",
  };
  return (
    <div data-tooltip={help[props.label] ?? `Current ${props.label.toLowerCase()} value.`} style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
      <span style={{ fontWeight: 800, fontSize: 15, color: props.accent ?? "#f5f5f0" }}>
        {props.value}
      </span>
      <span style={{ opacity: 0.65, fontSize: 11 }}>{props.label}</span>
    </div>
  );
}
