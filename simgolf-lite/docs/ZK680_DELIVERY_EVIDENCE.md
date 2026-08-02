# ZK-680 delivery evidence

The immutable before-split reference is
`c8383d5748714ca1cda2dc95c97c4db27db96e10`. Its raw web and unsigned
desktop measurements are stored in
`artifacts/zk-680/pre-split-baseline.json`.

`npm run build` runs `audit:delivery`. It verifies that the initial
application JavaScript bundle remains at or below the pre-split size, that the
Vision route remains a bounded deferred chunk, and that M35 critical-transfer,
biome, and total-dist delivery limits hold. The report prints the exact
before/after delta and the agreed cap for every metric.

`npm run desktop:pack:dir` additionally feeds the Electron directory output
through the same contract. The package manifest records raw package and ASAR
bytes plus SHA-256 evidence for every ASAR. Desktop package and ASAR budgets
allow only the documented bounded release overhead above the baseline.

This is automated delivery evidence only. Signing, notarization, and physical
device certification remain separate release gates.
