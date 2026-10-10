import { useState } from "react";
import { createRoot } from "react-dom/client";
import { setActiveLocale } from "../../src/i18n/core";
import type { Course, Hole, TeeSet, PinRotation } from "../../src/game/models/types";
import type { HoleEvaluation } from "../../src/game/eval/evaluateHole";
import { HoleInspector } from "../../src/ui/HoleInspector";
import "../../src/index.css";

setActiveLocale(localStorage.getItem("coursecraft_locale") === "pseudo" ? "pseudo" : "en");
const variant = new URLSearchParams(location.search).get("variant");
const hole: Hole = {
  id: "immutable-hole-7", name: "Willow Creek", tee: { x: 3, y: 5 }, green: { x: 23, y: 5 },
  teeBoxes: { forward: { x: 6, y: 5 }, member: { x: 3, y: 5 }, championship: null },
  pinPositions: { A: { x: 23, y: 5 }, B: { x: 13, y: 5 }, C: null },
  parMode: "MANUAL", parManual: 4, parByTee: { member: { mode: "MANUAL", par: 4 } }, holeIndex: 7,
};
if (variant === "missing") { hole.tee = null; hole.green = null; hole.teeBoxes = {}; hole.pinPositions = {}; }
const course: Course = {
  width: 28, height: 12, yardsPerTile: 20, holes: [hole], elevations: Array(336).fill(0),
  tiles: Array.from({ length: 336 }, (_, i) => {
    const x = i % 28; const y = Math.floor(i / 28);
    if (x >= 20 && x <= 26 && y >= 2 && y <= 8) return "green";
    if (y === 5 && x >= 3 && x <= 6) return "tee";
    if (y >= 4 && y <= 6 && x >= 7 && x < 20) return "fairway";
    return "rough";
  }), obstacles: [], buildings: [], name: "Immutable accessibility course", baseGreenFee: 25, condition: .9, activePinRotation: "B",
};
const evaluation: HoleEvaluation = {
  scratchShotsToGreen: variant === "missing" ? Infinity : 2.1,
  bogeyShotsToGreen: variant === "missing" ? Infinity : 3.4,
  autoPar: variant === "noissues" ? 4 : 5, reachableInTwo: variant !== "blocked", effectiveDistanceYards: 520.4,
  issues: variant === "noissues" ? [] : [
    { severity: "warn", code: "FAIRWAY_CONTINUITY", title: "Fairway route needs attention", detail: "The landing corridor contains rough. Preserve this domain-generated recommendation.", suggestedFixes: ["Widen fairway +5y", "Widen fairway +10y", "Paint fairway along centerline"], metadata: { currentValue: .25, targetValue: .85, costEstimate: 1250, failingSegments: [{ x: 12, y: 5 }] } },
    { severity: "info", code: "STRATEGY", title: "Consider the landing area", detail: "A longer approach offers a different route.", suggestedFixes: ["Keep the existing course geometry"] },
    ...(variant === "blocked" || variant === "missing" ? [{ severity: "bad" as const, code: "BLOCKED_ROUTE", title: "Blocked route", detail: "This hole cannot currently be played.", suggestedFixes: [] }] : []),
  ],
};
function freezeDeep(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freezeDeep(child);
  Object.freeze(value);
}
freezeDeep(course); freezeDeep(evaluation);
const initial = JSON.stringify({ course, evaluation });
const calls: unknown[][] = [];
function note(...values: unknown[]) {
  calls.push(values);
  document.querySelector<HTMLOutputElement>("[data-testid=callback-log]")!.value = JSON.stringify(calls);
  document.querySelector<HTMLOutputElement>("[data-testid=immutable-inputs]")!.value = String(initial === JSON.stringify({ course, evaluation }));
}
export function Fixture() {
  const [selected, setSelected] = useState<TeeSet>("member");
  const [pin, setPin] = useState<PinRotation>("B");
  const [showFix, setShowFix] = useState(false);
  return <>
    <output hidden data-testid="callback-log">[]</output><output hidden data-testid="immutable-inputs">true</output>
    <div className="fixture-shell">
      <HoleInspector course={Object.freeze({ ...course, activePinRotation: pin })} hole={hole} holeIndex={0} evaluation={evaluation} selectedTeeSet={selected}
        showFixOverlay={showFix} setShowFixOverlay={(value) => { note("fix", value); setShowFix(value); }}
        onSelectTeeSet={(value) => { note("select", value); setSelected(value); }} onSetTeePar={(tee, value) => note("par", tee, value)}
        onFitHole={(value) => note("fit", value)} onFlyover={() => note("flyover")}
        onBeginTeePlacement={(value) => note("place-tee", value)} onRemoveTeeBox={(value) => note("remove-tee", value)}
        onBeginPinPlacement={(value) => note("place-pin", value)} onRemovePinPosition={(value) => note("remove-pin", value)}
        onSetActivePinRotation={(value) => { note("pin", value); setPin(value); }} onSetHoleIndex={(value) => note("stroke-index", value)}
        onSmartPaintFairway={(value) => note("fairway", value)} />
    </div>
    <button className="fixture-exit">Outside inspector</button>
  </>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
