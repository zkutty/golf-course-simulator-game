import type { CSSProperties } from "react";
import type { ObjectiveState, GoalProgress, ConditionProgress } from "../game/models/objectives";
import { GameCard } from "./gameui";

// Objectives UI (ZKU-163): a pinned mini-tracker for the HUD header and the
// full goals panel with per-condition progress bars.

const METRIC_LABEL: Record<ConditionProgress["metric"], string> = {
  cash: "Cash",
  reputation: "Reputation",
  courseRating: "Course rating",
  holesBuilt: "Holes built",
  weeklyProfit: "Weekly profit",
  profitStreak: "Profitable weeks in a row",
  totalRounds: "Total rounds played",
  condition: "Course condition",
  tournamentPlacement: "Tournament placement",
};

function formatMetricValue(metric: ConditionProgress["metric"], value: number): string {
  switch (metric) {
    case "cash":
    case "weeklyProfit":
      return `$${Math.round(value).toLocaleString()}`;
    case "condition":
      return `${Math.round(value)}%`;
    case "courseRating":
      return value.toFixed(1);
    case "tournamentPlacement":
      return value >= Number.MAX_SAFE_INTEGER ? "—" : `${Math.round(value)}`;
    default:
      return `${Math.round(value)}`;
  }
}

function conditionFraction(c: ConditionProgress): number {
  if (c.met) return 1;
  if (c.comparator === ">=") {
    if (c.target <= 0) return 1;
    return Math.max(0, Math.min(1, c.value / c.target));
  }
  // "<=" goals don't have a natural fill direction — show met/unmet.
  return 0;
}

function goalFraction(p: GoalProgress): number {
  if (p.met) return 1;
  if (p.conditions.length === 0) return 0;
  return p.conditions.reduce((acc, c) => acc + conditionFraction(c), 0) / p.conditions.length;
}

function ProgressBar({ fraction, met }: { fraction: number; met: boolean }) {
  return (
    <div
      style={{
        height: 8,
        borderRadius: 999,
        background: "rgba(0,0,0,0.08)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${Math.round(fraction * 100)}%`,
          height: "100%",
          borderRadius: 999,
          background: met ? "var(--cc-grass)" : "var(--cc-water)",
          transition: "width 300ms ease",
        }}
      />
    </div>
  );
}

export function ObjectiveMiniTracker(props: {
  objectives: ObjectiveState | null | undefined;
  onOpen: () => void;
}) {
  const { objectives } = props;
  const baseStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.1)",
    background: "rgba(255,255,255,0.75)",
    fontSize: 12,
    cursor: "pointer",
    width: "100%",
    textAlign: "left",
  };

  if (!objectives) {
    return (
      <div style={{ ...baseStyle, cursor: "default", color: "#6b7280" }} title="No goals — build freely">
        <span aria-hidden>🌿</span>
        <b style={{ letterSpacing: "0.06em" }}>FREE PLAY</b>
        <span>— no goals, build at your own pace</span>
      </div>
    );
  }

  const done = objectives.progress.filter((p) => p.met).length;
  const total = objectives.progress.length;
  const nextIdx = objectives.progress.findIndex((p) => !p.met);
  const nextGoal = nextIdx >= 0 ? objectives.goals[nextIdx] : null;
  const nextProgress = nextIdx >= 0 ? objectives.progress[nextIdx] : null;

  return (
    <button style={baseStyle} onClick={props.onOpen} title="Open objectives">
      <span aria-hidden>{objectives.outcome === "WON" ? "🏆" : "🎯"}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <b
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {objectives.outcome === "WON"
              ? "All objectives complete!"
              : nextGoal
                ? nextGoal.label
                : "Objectives"}
          </b>
          <span style={{ color: "#6b7280", flexShrink: 0 }}>
            {done}/{total}
          </span>
        </div>
        {nextProgress && (
          <div style={{ marginTop: 4 }}>
            <ProgressBar fraction={goalFraction(nextProgress)} met={false} />
          </div>
        )}
      </div>
    </button>
  );
}

export function ObjectivesPanel(props: {
  open: boolean;
  onClose: () => void;
  objectives: ObjectiveState | null | undefined;
  week: number;
}) {
  const { open, onClose, objectives, week } = props;
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        style={{ width: "min(560px, 100%)", maxHeight: "85vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <GameCard title="Objectives" icon={<span style={{ fontSize: 18 }}>🎯</span>} variant="results">
          {!objectives && (
            <div style={{ fontSize: 13, color: "#6b7280" }}>
              Free play — no goals. Enjoy the course.
            </div>
          )}
          {objectives && (
            <div style={{ display: "grid", gap: 14 }}>
              {objectives.goals.map((goal, i) => {
                const p = objectives.progress[i];
                const weeksLeft = goal.deadlineWeek != null ? goal.deadlineWeek - week + 1 : null;
                return (
                  <div
                    key={goal.id}
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      border: "1px solid rgba(0,0,0,0.08)",
                      background: p?.met ? "rgba(122,184,109,0.12)" : "rgba(255,255,255,0.7)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ fontWeight: 800, fontSize: 14 }}>
                        {p?.met ? "✅" : "⬜"} {goal.label}
                      </div>
                      {goal.deadlineWeek != null && !p?.met && (
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: weeksLeft != null && weeksLeft <= 3 ? "#b91c1c" : "#6b7280",
                            flexShrink: 0,
                          }}
                        >
                          by week {goal.deadlineWeek}
                          {weeksLeft != null && weeksLeft >= 0 ? ` (${weeksLeft} left)` : ""}
                        </div>
                      )}
                      {p?.met && p.completedWeek != null && (
                        <div style={{ fontSize: 11, color: "#2f6b33", flexShrink: 0 }}>
                          week {p.completedWeek}
                        </div>
                      )}
                    </div>
                    {goal.description && (
                      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{goal.description}</div>
                    )}
                    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                      {p?.conditions.map((c, ci) => (
                        <div key={ci}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              fontSize: 12,
                              marginBottom: 3,
                            }}
                          >
                            <span>{METRIC_LABEL[c.metric]}</span>
                            <span style={{ fontWeight: 700 }}>
                              {formatMetricValue(c.metric, c.value)} / {c.comparator === "<=" ? "≤ " : ""}
                              {formatMetricValue(c.metric, c.target)}
                            </span>
                          </div>
                          <ProgressBar fraction={conditionFraction(c)} met={c.met} />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <button
              onClick={onClose}
              style={{
                padding: "8px 16px",
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,0.18)",
                background: "#3d4a3e",
                color: "#fff",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        </GameCard>
      </div>
    </div>
  );
}
