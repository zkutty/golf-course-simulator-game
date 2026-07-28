import { mkdirSync, writeFileSync } from "node:fs";
import {
  M47_REFERENCE_GOLFERS,
  M47_ROUND_LENGTHS,
  buildM47RoundResult,
  buildM47StrategyMatrix,
  hashM47Round,
  runM47SaveHashFixture,
  runM47TournamentFixture,
} from "./m47Certification";

const balanced = M47_REFERENCE_GOLFERS.find((golfer) => golfer.id === "balanced")!;
const rounds = M47_ROUND_LENGTHS.map((holeCount) => {
  const firstResult = buildM47RoundResult(holeCount, balanced);
  const secondResult = buildM47RoundResult(holeCount, balanced);
  const first = hashM47Round(firstResult);
  const second = hashM47Round(secondResult);
  return {
    holeCount,
    deterministic: JSON.stringify(first) === JSON.stringify(second),
    hashes: first,
    planCount: firstResult.plans.length,
    outcomeCount: firstResult.outcomes.length,
    reactionCount: firstResult.reactions.length,
    score: firstResult.holeStrokes.reduce((sum, strokes) => sum + strokes, 0),
  };
});
const matrix = buildM47StrategyMatrix();
const chosenCounts = Object.fromEntries([...new Set(matrix.map((row) => row.chosen))].map((kind) => [kind, matrix.filter((row) => row.chosen === kind).length]));
const saveReload = runM47SaveHashFixture();
const report = {
  ok: rounds.every((round) => round.deterministic) && saveReload.beforeHash === saveReload.afterHash,
  referenceGolfers: M47_REFERENCE_GOLFERS.map(({ id, seed }) => ({ id, seed })),
  rounds,
  strategyMatrix: { rows: matrix, chosenCounts },
  saveReload,
  tournament: runM47TournamentFixture(),
};

const output = new URL("../artifacts/m47/certification.json", import.meta.url);
mkdirSync(new URL("../artifacts/m47", import.meta.url), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
