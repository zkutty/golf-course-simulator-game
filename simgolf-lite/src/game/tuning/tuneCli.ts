import { runMonteCarlo } from "./monteCarlo";

function fmtPct(x: number) {
  return `${(x * 100).toFixed(1)}%`;
}

function fmtMoney(x: number) {
  return `$${Math.round(x).toLocaleString()}`;
}

const n = Number(process.env.TUNE_N ?? "50");
const seed0 = Number(process.env.TUNE_SEED ?? "12345");

const out = runMonteCarlo({ nPerArchetype: n, seed0 });
const s = out.summary;

console.log("SimGolf-lite tuning (dev):");
console.log(`- N per archetype: ${n}`);
console.log(`- Seed0: ${seed0}`);
console.log("");
for (const k of ["ALL", "Optimizer", "Builder", "Chaotic"] as const) {
  const r = (s as any)[k];
  console.log(
    `${k.padEnd(10)} bankrupt ${fmtPct(r.bankruptRate)}  avgWeeks ${r.avgWeeks.toFixed(
      1
    )}  avgPeakCash ${fmtMoney(r.avgPeakCash)}  avgPeakRep ${r.avgPeakRep.toFixed(1)}`
  );
}




