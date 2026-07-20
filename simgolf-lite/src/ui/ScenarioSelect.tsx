import { useMemo } from "react";
import { formatCurrency } from "../i18n/format";
import { SCENARIOS } from "../game/scenarios/scenarios";
import type { ScenarioDefinition } from "../game/scenarios/types";
import { isScenarioUnlocked, loadCareer } from "../utils/careerStore";
import { getLandTheme } from "../game/models/themes";
import { getDifficultyProfile } from "../game/balance/difficulty";
import { T } from "../i18n/T";
import { useI18n } from "../i18n/useI18n";

// Career scenario ladder (ZKU-164): card list with medal states —
// locked / unlocked / completed (+ best-result stats), sequential unlock.

const THEME_ICON: Record<string, string> = { parkland: "🌳", links: "🌾", desert: "🌵" };

export function ScenarioSelect(props: { onStart: (scenario: ScenarioDefinition) => void }) {
  const { t } = useI18n();
  const career = useMemo(() => loadCareer(), []);
  const ladder = useMemo(() => [...SCENARIOS].sort((a, b) => a.order - b.order), []);

  return (
    <div style={{ display: "grid", gap: 10, maxHeight: "56vh", overflowY: "auto", padding: 2 }}>
      {ladder.map((s) => {
        const unlocked = isScenarioUnlocked(career, ladder, s.id);
        const rec = career.scenarios[s.id];
        const completed = rec?.completed === true;
        return (
          <button
            key={s.id}
            disabled={!unlocked}
            onClick={() => props.onStart(s)}
            style={{
              textAlign: "left",
              display: "flex",
              gap: 12,
              alignItems: "center",
              padding: "12px 14px",
              borderRadius: 14,
              border: completed
                ? "3px solid #F2C14E"
                : "3px solid rgba(255,255,255,0.25)",
              background: unlocked ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.55)",
              cursor: unlocked ? "pointer" : "not-allowed",
              opacity: unlocked ? 1 : 0.6,
            }}
          >
            <div style={{ fontSize: 26, width: 34, textAlign: "center" }}>
              {completed ? "🏅" : unlocked ? THEME_ICON[s.theme] ?? "⛳" : "🔒"}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <span
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontWeight: 800,
                    fontSize: 15,
                    color: "#3d4a3e",
                  }}
                >
                  {s.order}. {t(s.nameKey)}
                </span>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", color: "#6b7280" }}>
                  {getLandTheme(s.theme).label.toUpperCase()} • {getDifficultyProfile(s.difficulty).label.toUpperCase()}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#4b5563", marginTop: 2 }}>
                {unlocked ? t(s.blurbKey) : t("scenario.locked")}
              </div>
              {completed && (
                <div style={{ fontSize: 11, fontWeight: 700, color: "#8a6d1a", marginTop: 4 }}>
                  <T id="auto.ui.scenarioselect.completed" />{rec?.bestWeek != null ? ` — best: week ${rec.bestWeek}` : ""}
                  {rec?.bestCash != null ? `, ${formatCurrency(rec.bestCash)}` : ""}
                  {t("scenario.replayable")}
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
