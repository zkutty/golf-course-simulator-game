# ZK-680 delivery evidence

The immutable before-split reference is
`c8383d5748714ca1cda2dc95c97c4db27db96e10`. Its raw web and unsigned
desktop measurements are stored in
`artifacts/zk-680/pre-split-baseline.json`.

`npm run build` runs `audit:delivery`. It verifies that the initial
application JavaScript bundle remains at or below the pre-split size, that the
Vision route remains a bounded deferred chunk, and that M35 critical-transfer,
biome, cold-startup, and 36-hole fixture-load delivery limits hold. The report
prints the exact before/after delta and agreed cap for every metric. The startup
and fixture values come from the same Playwright performance harness used by
`npm run test:perf`; rerun it with
`PERF_OUTPUT_PATH=artifacts/zk-680/current-performance.json` before updating
the committed measurement.

## ZK-332 Parkland habitat delivery accounting

The legacy aggregate dist cap remains `116,976,011 B`. ZK-332 does not remove
or rewrite it: the delivery evidence subtracts exactly three Parkland habitat
atlas PNGs, identified through their three source-addressable Vite manifest
records (high, medium, and low), before applying that historical cap plus a
narrowly named runtime-consumer allowance. Missing, duplicate, or extra
unattributed Parkland habitat PNG manifest records fail the audit. The existing
`parkland-habitat-field-audit` still separately verifies the source manifest,
the three tier files, and its combined atlas contract.

The accepted source manifest's `budgets.totalAtlasBytesMax` is the atlas budget
used by the delivery report (4 MiB); it is not copied into the baseline. The
non-atlas consumer allowance is `192 KiB`: the final accepted I1 candidate
measured `172,486 B` for its runtime consumer, manifest, and generated metadata
after the three atlas PNGs (`362,862 B`) were removed, so the allowance adds
only `24,122 B` of bounded headroom. The excluded-dist cap is therefore
`116,976,011 + 196,608 B`, and the visible total-dist cap is exactly that cap
plus the accepted manifest's atlas maximum.

For traceability, the report also shows the clean pre-I1 dist value
(`116,935,271 B`), atlas actual/budget/headroom, the consumer allowance and
measured delta, excluded and total actual/budget/headroom, and all deltas. The
final accepted candidate was `117,470,619 B`: `535,348 B` above pre-I1,
comprising `362,862 B` atlas bytes and `172,486 B` consumer/metadata bytes.
This accounting policy does not constitute art, visual, or performance
acceptance.

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
