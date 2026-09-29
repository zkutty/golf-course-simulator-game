# ZK-682 architecture certification evidence contract

This package is report infrastructure for the ZK-682 architecture-slice exit
gate. It does not itself run the expensive browser, PWA, packaged Electron,
physical-device, or long-session gates. Producers run those gates against one
immutable candidate and write normalized gate-result JSON plus raw artifacts;
the aggregator verifies and summarizes them.

## Fail-closed provenance

The evidence manifest pins a full 40-character candidate commit and the
candidate's `package-lock.json` SHA-256. Every normalized gate result is bound
by SHA-256, names the same candidate commit, and binds at least one raw
artifact by path and SHA-256. The generator rejects unavailable or unexpected
commits, lockfile drift, stale result hashes, missing raw artifacts, raw hash
drift, missing required machine gates, unknown criteria, and incomplete
exception metadata.

Physical results use the same 36-hole/100-golfer heavy biome, season, and
weather scenario and record the device, OS, power mode, and graphics backend.
Midrange evidence must record p95 at or below 20 ms. Low-end evidence must
record p95 at or below 33 ms unless a minimum-spec adjustment is explicitly
approved and includes evidence, player impact, owner, and a follow-up ZK issue.

Headless p95 is always `report-only`. It may be retained in a valid report but
cannot satisfy either physical-device criterion. A complete passing machine
packet with no physical results therefore produces `HOLD`, never `GO`.

## Required normalized gate results

- `provenance`: exact dependency and browser/package artifact identity.
- `core-compatibility`: production build, unit gates, deterministic hashes,
  reducer behavior, save v25, historical migrations, and `PlatformServices`.
- `browser-pwa`: supported browsers, installed PWA, golden E2E, and offline
  launch.
- `packaged-desktop`: macOS and Windows packages plus native persistence.
- `asset-delivery`: initial critical, selected-biome, individual-atlas,
  package-size/asset-audit, and unselected-biome residency budgets.
- `headless-performance`: heavy 36-hole/100-golfer renderer work plus
  startup/fixture-load timing and report-only headless frame timing.
- `stability`: repeated route changes, repeated save loads, long-session
  simulation, representative overlays/editing, sleep/wake, and recovery.

`physical-midrange` and `physical-lowend` results are accepted when available.
Their absence is not replaced with fabricated measurements; it is represented
as a report blocker.

## Commands

Run the focused contract tests:

```sh
npm run test:cert:zk682:contract
```

Aggregate a prepared evidence manifest and require a known candidate when the
release coordinator has one:

```sh
npm run release:certify:zk682 -- \
  --input release/zk682/evidence-manifest.json \
  --output-dir artifacts/zk682/v1 \
  --expected-commit <full-candidate-sha>
```

The output directory receives `certification-report.json` and a human-readable
`CERTIFICATION.md`. `GO` requires every machine criterion and both physical
criteria to pass. Any observed failure or absent physical result yields
`HOLD`. Missing required machine evidence is invalid input and is rejected
instead of being summarized as success.

This packet deliberately does not implement the separate PWA IndexedDB,
packaged native-save, or renderer-leak gates. Those gate producers remain
independent work; this contract only makes their eventual evidence impossible
to silently omit or misattribute.
