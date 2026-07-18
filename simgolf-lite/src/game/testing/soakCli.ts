/// <reference types="node" />
import { DEFAULT_WORLD } from "../models/defaults";
import { runLiveDaysHeadless } from "../live/headless";
import { createReferenceCourse } from "./referenceCourse";
import { hashGameState } from "../../utils/stateHash";

const WEEKS = 30;
const startHeap = process.memoryUsage().heapUsed;
const startedAt = performance.now();
const result = runLiveDaysHeadless({
  course: createReferenceCourse(),
  world: { ...DEFAULT_WORLD, cash: 10_000_000, runSeed: 185185 },
  days: WEEKS * 7,
  stepMinutes: 3,
});
const elapsedMs = performance.now() - startedAt;
const endHeap = process.memoryUsage().heapUsed;
const heapGrowthMb = (endHeap - startHeap) / 1024 / 1024;

if (result.world.week !== WEEKS + 1) throw new Error(`Expected week ${WEEKS + 1}, got ${result.world.week}`);
if (result.rounds <= 0) throw new Error("Soak completed without simulating any rounds");
if (!Number.isFinite(result.world.cash) || !Number.isFinite(result.world.reputation)) {
  throw new Error("Soak produced non-finite world state");
}
if (heapGrowthMb > 128) throw new Error(`Heap grew by ${heapGrowthMb.toFixed(1)} MB`);

console.log(JSON.stringify({
  ok: true,
  weeks: WEEKS,
  rounds: result.rounds,
  finalCash: Math.round(result.world.cash),
  finalReputation: Number(result.world.reputation.toFixed(2)),
  heapGrowthMb: Number(heapGrowthMb.toFixed(2)),
  elapsedMs: Math.round(elapsedMs),
  stateHash: hashGameState({ course: result.course, world: result.world }),
}, null, 2));
