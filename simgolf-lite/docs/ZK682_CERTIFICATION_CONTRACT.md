# ZK-682 architecture certification evidence contract v2

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

Three release-critical producers have stricter typed evidence. The aggregator
parses their raw JSON, recomputes their result where possible, and rejects
arbitrary text or a generic passing wrapper:

- `offline-indexeddb-pwa`: full candidate SHA plus the online/offline IndexedDB
  records and game projections. The aggregator reruns the round-trip contract.
- `packaged-desktop-persistence`: separate `darwin` and `win32` reports, each
  bound to platform/architecture, package manifest, packaged `app.asar`, and
  executable digests. The aggregator reruns the three-phase persistence and
  recovery contract and checks the package manifest's candidate identity.
- `renderer-resource-growth`: full candidate SHA, immutable thresholds, raw
  Pixi/CDP samples, browser identity, and recomputed growth summaries.

`local`, abbreviated, stale, or mismatched producer commit identities are
invalid. The aggregator CLI also requires `--expected-commit`; selecting an old
but locally available commit is not sufficient.

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
  launch, including typed IndexedDB save evidence.
- `packaged-desktop`: macOS and Windows packages plus native persistence.
- `asset-delivery`: initial critical, selected-biome, individual-atlas,
  package-size/asset-audit, and unselected-biome residency budgets.
- `headless-performance`: heavy 36-hole/100-golfer renderer work plus
  startup/fixture-load timing and report-only headless frame timing.
- `stability`: repeated route changes, repeated save loads, long-session
  simulation, representative overlays/editing, sleep/wake, and recovery.

Renderer resource-growth evidence satisfies only the route/resource criterion.
It cannot stand in for save-load, long-session, or interaction recovery. Those
three observations each require their own typed, candidate-bound evidence; an
omitted, failed, or malformed producer result is invalid machine evidence and
cannot be promoted as passing.

`physical-midrange` and `physical-lowend` results are accepted when available.
Their absence is not replaced with fabricated measurements; it is represented
as a report blocker.

## Commands

Run the focused contract tests:

```sh
npm run test:cert:zk682:contract
```

Generate the typed machine reports on one frozen candidate checkout. Each
command accepts `--expected-commit <full-sha>`; the convenience scripts default
to the checkout's exact `HEAD` and reject a different requested SHA.

```sh
npm run test:pwa:certification -- --expected-commit <full-sha>
npm run desktop:package:persistence -- --expected-commit <full-sha>
npm run test:resource-growth -- --expected-commit <full-sha>
```

The PWA and resource commands write under `artifacts/zk682/raw/`. Desktop writes
`desktop-<platform>-<arch>.json`; macOS and Windows must run on their native
packaged outputs and both reports plus their referenced package files must be
collected without renaming paths inside the evidence. These are long machine
gates and are intentionally not run by the contract-only command.

Aggregate a prepared evidence manifest and require a known candidate when the
release coordinator has one:

```sh
npm run release:certify:zk682 -- \
  --input release/zk682/evidence-manifest.json \
  --output-dir artifacts/zk682/v2 \
  --expected-commit <full-candidate-sha>
```

The output directory receives `certification-report.json` and a human-readable
`CERTIFICATION.md`. `GO` requires every machine criterion and both physical
criteria to pass. Any observed failure or absent physical result yields
`HOLD`. Missing required machine evidence is invalid input and is rejected
instead of being summarized as success. A passing normalized result cannot be
backed by failed, wrong-schema, cross-candidate, one-platform, or unbound raw
evidence.

The repository does not fabricate Windows, physical-device, long-session,
save-load, or interaction-recovery evidence. Until those reports are captured
against the frozen candidate, certification remains incomplete.
