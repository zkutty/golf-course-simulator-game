import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ObjectivesPanel, ObjectiveMiniTracker } from "../../src/ui/ObjectivesPanel";
import type { ConditionProgress, ObjectiveState } from "../../src/game/models/objectives";
import { I18nContext } from "../../src/i18n/context";
import { loadLocale, setActiveLocale, translate } from "../../src/i18n/core";
import "../../src/index.css";

const locale = loadLocale();
setActiveLocale(locale);
document.documentElement.dataset.locale = locale;
const metricValues: [ConditionProgress["metric"], number, number][] = [
  ["cash", 2500, 5000], ["reputation", 30, 60], ["courseRating", 34.2, 68.4],
  ["holesBuilt", 3, 6], ["publishedHoles", 9, 18], ["publishedCourses", 1, 2],
  ["weeklyProfit", 1234, 2468], ["profitStreak", 2, 4], ["totalRounds", 500, 1000],
  ["condition", 40, 80], ["tournamentPlacement", Number.MAX_SAFE_INTEGER, 3],
];
const active: ObjectiveState = {
  goals: [
    { id: "metrics", label: "An authored goal with a long descriptive title that must remain completely readable on a narrow screen", description: "Raw authored descriptions remain intact and wrap without clipping.", deadlineWeek: 12, conditions: metricValues.map(([metric, , target]) => ({ metric, comparator: metric === "tournamentPlacement" ? "<=" : ">=", target })) },
    { id: "keyed", label: "Raw fallback title", labelKey: "scenario.goal.threeHoles.label", description: "Raw fallback description", descriptionKey: "scenario.goal.threeHoles.description", deadlineWeek: 9, conditions: [{ metric: "holesBuilt", comparator: ">=", target: 3 }] },
    { id: "nonpositive", label: "Nonpositive target", conditions: [{ metric: "cash", comparator: ">=", target: 0 }] },
    { id: "completed", label: "Completed authored goal", conditions: [{ metric: "reputation", comparator: ">=", target: 60 }] },
    { id: "missing", label: "Goal without progress", conditions: [] },
    { id: "empty", label: "Goal without conditions", conditions: [] },
  ],
  progress: [
    { goalId: "metrics", met: false, conditions: metricValues.map(([metric, value, target]) => ({ metric, value, target, comparator: metric === "tournamentPlacement" ? "<=" : ">=", met: false })) },
    { goalId: "keyed", met: false, conditions: [{ metric: "holesBuilt", value: 2, target: 3, comparator: ">=", met: false }] },
    { goalId: "nonpositive", met: false, conditions: [{ metric: "cash", value: -5, target: 0, comparator: ">=", met: false }] },
    { goalId: "completed", met: true, completedWeek: 8, conditions: [{ metric: "reputation", value: 60, target: 60, comparator: ">=", met: true }] },
  ], outcome: "OPEN", totalRounds: 0, profitStreak: 0, weekProfitAccum: 0,
};
const empty: ObjectiveState = { ...active, goals: [], progress: [] };
const keyed: ObjectiveState = { ...active, goals: [active.goals[1]], progress: [active.progress[1]] };
const emptyConditions: ObjectiveState = { ...active, goals: [active.goals[5]], progress: [{ goalId: "empty", met: false, conditions: [] }] };
const lessEqualMet: ObjectiveState = { ...active, goals: [{ id: "placement", label: "Top-three finish", conditions: [{ metric: "tournamentPlacement", comparator: "<=", target: 3 }] }], progress: [{ goalId: "placement", met: true, completedWeek: 11, conditions: [{ metric: "tournamentPlacement", comparator: "<=", target: 3, value: 2, met: true }] }] };
const negativeTarget: ObjectiveState = { ...active, goals: [{ id: "negative", label: "Negative target", conditions: [{ metric: "cash", comparator: ">=", target: -100 }] }], progress: [{ goalId: "negative", met: false, conditions: [{ metric: "cash", comparator: ">=", target: -100, value: -500, met: false }] }] };
const won: ObjectiveState = { ...active, outcome: "WON", goals: [active.goals[3]], progress: [active.progress[3]], wonWeek: 8 };

export function Fixture() {
  const scenario = new URLSearchParams(location.search).get("scenario") ?? "active";
  const objectives = scenario === "freeplay" ? null : scenario === "empty" ? empty : scenario === "won" ? won : scenario === "keyed" ? keyed : scenario === "emptyconditions" ? emptyConditions : scenario === "lessEqualMet" ? lessEqualMet : scenario === "negativeTarget" ? negativeTarget : active;
  Object.assign(window, { objectivesFixture: objectives });
  const [open, setOpen] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const [closeCount, setCloseCount] = useState(0);
  const show = () => { setOpenCount((count) => count + 1); setOpen(true); };
  return <I18nContext.Provider value={{ locale, setLocale: () => {}, t: (key, params) => translate(locale, key, params) }}>
    <div style={{ padding: 8, maxWidth: 600, boxSizing: "border-box" }}>
      <button data-testid="open-objectives" onClick={show}>Open objectives</button>
      <div data-testid="mini"><ObjectiveMiniTracker objectives={objectives} onOpen={show} /></div>
      <output data-testid="open-count">{openCount}</output><output data-testid="close-count">{closeCount}</output>
      <output data-testid="input-state" style={{ display: "none" }}>{JSON.stringify(objectives)}</output>
    </div>
    <div data-testid="modal-harness"><ObjectivesPanel open={open} onClose={() => { setCloseCount((count) => count + 1); setOpen(false); }} objectives={objectives} week={11} /></div>
  </I18nContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
