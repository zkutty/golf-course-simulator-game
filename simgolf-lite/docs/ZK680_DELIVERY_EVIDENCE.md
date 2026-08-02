# ZK-680 delivery evidence

The immutable before-split reference is
`c8383d5748714ca1cda2dc95c97c4db27db96e10`. Its raw web and unsigned
desktop measurements are stored in
`artifacts/zk-680/pre-split-baseline.json`.

`npm run build` runs `audit:delivery`. It verifies that the initial
application JavaScript bundle remains at or below the pre-split size, that the
Vision route remains a bounded deferred chunk, and that M35 critical-transfer,
biome, total-dist, cold-startup, and 36-hole fixture-load delivery limits hold.
The report prints the exact before/after delta and the agreed cap for every
metric. The startup and fixture values come from the same Playwright performance
harness used by `npm run test:perf`; rerun it with
`PERF_OUTPUT_PATH=artifacts/zk-680/current-performance.json` before updating
the committed measurement.

`npm run desktop:pack:dir` additionally feeds the Electron directory output
through the same contract. The package manifest records raw package and ASAR
bytes plus SHA-256 evidence for every ASAR. Desktop package and ASAR budgets
allow only the documented bounded release overhead above the baseline.

Desktop builds set Vite's base to `./`, so the packaged `file:` renderer resolves
its JavaScript, assets, and service-worker resources relative to `index.html`
rather than from the filesystem root. The package smoke then launches the
packaged renderer's ZK-681 fixture, which verifies that those relative assets
load in the unsigned app as well as checking the ASAR and size contract.

This is automated delivery evidence only. Signing, notarization, and physical
device certification remain separate release gates.
