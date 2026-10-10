import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { SelectedGolferDetail } from "../../src/hooks/useLiveSimulation";
import { I18nProvider } from "../../src/i18n/I18nProvider";
import { GolferInspector } from "../../src/ui/GolferInspector";
import { recordEmote } from "../../src/game/render/emoteFeed";
import type { LiveShotOutcome } from "../../src/game/live/m47Types";
import { projectCommittedShot } from "../../src/game/rules/shotTruth";
import "../../src/index.css";

const params = new URLSearchParams(location.search);
const outcome: LiveShotOutcome = {
  version: 1, id: "shot-2", holeId: "hole-36", shotNumber: 2, intentId: "approach-2", intent: "approach",
  club: "7 Iron", technique: "normal", flightProfile: "high", seed: 382,
  from: { x: 2, y: 4 }, aim: { x: 12.5, y: 33.25 }, landing: { x: 11, y: 32 }, rest: { x: 13, y: 34 },
  lieBefore: "fairway", lieAfter: "green", carryYards: 147, rollYards: 5, penaltyStrokes: 1, holed: false, facts: [],
};
const selected: SelectedGolferDetail = {
  id: 382,
  name: "Alexandria María de los Ángeles Montgomery-Worthington Championship Guest",
  archetype: params.get("archetype") ?? "lowHandicap",
  color: "#38bdf8",
  currentHole: Number(params.get("hole") ?? 35),
  strokes: 2,
  scoreToPar: Number(params.get("score") ?? -3),
  mood: Number(params.get("mood") ?? 0.8),
  thought: null,
  holePar: Array.from({ length: 36 }, (_, i) => 3 + i % 3),
  holeStrokes: Array.from({ length: 36 }, (_, i) => 3 + i % 3 + [-1, 0, 1, 2][i % 4]),
  scoredHoles: Number(params.get("played") ?? 36),
  spent: 123456.75,
  wallet: 987654.25,
  teeSet: params.get("tee") === "forward" ? "forward" : params.get("tee") === "member" ? "member" : "championship",
  pinRotation: "C",
  mobilityMode: params.get("mobility") === "walk" ? "walk" : params.get("mobility") === "pushcart" ? "pushcart" : "riding_cart",
  mobilityPredictedWalkingMinutes: 47.6,
  mobilityActualTravelMinutes: params.has("pending") ? undefined : 32.4,
  mobilityWalkingFallbackMinutes: params.has("pending") ? undefined : 5.6,
  mobilityOffPathTiles: params.has("pending") ? undefined : 17,
  capabilities: params.has("minimal") ? undefined : {
    version: 1, seed: 382, power: 82.4, accuracy: 93.7, irons: 74.3, shortGame: 61.6,
    recovery: 55.4, consistency: 72, riskTolerance: 0.6, challengeSeeking: 0.5,
    sceneryAffinity: 0.7, valueSensitivity: 0.4, riskStyle: "conservative",
    strengths: params.has("empty-strengths") ? [] : ["Long approaches", "Precision around difficult protected greens"], weaknesses: ["Sand"],
  },
  currentShotEvidence: params.get("phase") === "intent" ? {
    phase: "intent", holeId: "hole-36", shotId: "shot-2", shotNumber: 2,
    club: "7 Iron", intent: "approach", flightProfile: "high", aim: { x: 12.5, y: 33.25 },
  } : params.get("phase") === "reaction" ? {
    phase: "reaction", holeId: "hole-35", reaction: {
      version: 1, holeId: "hole-35", actualScore: 5, expectedScore: 4.2,
      satisfaction: 0.37, outcome: "frustrated", thought: "Tough finish", facts: [],
    },
  } : params.get("phase") === "result" ? {
    phase: "result", holeId: "hole-36", outcome, truth: projectCommittedShot(outcome),
  } : undefined,
};
if (params.has("minimal")) selected.mobilityMode = undefined;
function freeze(value: unknown): void {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
}
freeze(selected);
const original = JSON.stringify(selected);
if (!params.has("no-emotes")) for (const [index, kind] of (["star", "happy", "angry", "alert"] as const).entries()) recordEmote(selected.id, kind, index);

export function Fixture() {
  const [following, setFollowing] = useState(false);
  const [calls, setCalls] = useState<string[]>([]);
  const note = (name: string) => setCalls((current) => [...current, name]);
  return <I18nProvider>
    <button type="button">Before inspector</button>
    <GolferInspector selected={params.has("null") ? null : selected} setupDifficulty={1.25}
      following={following} onClose={() => note("close")}
      onToggleFollow={params.has("no-follow") ? undefined : () => { setFollowing((value) => !value); note("follow"); }} />
    <button type="button">After inspector</button>
    <output data-testid="callback-log" style={{ position: "absolute", right: 0, top: 32 }}>{calls.join(",")}</output>
    <output data-testid="immutable-input" hidden>{String(original === JSON.stringify(selected))}</output>
  </I18nProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
