# ZK-682 exact-candidate certification packet

The packet builder is fail-closed and accepts one immutable candidate only.

```sh
ZK682_EXPECTED_COMMIT=<full-40-character-sha> npm run release:build:zk682 -- \
  --candidate "$ZK682_EXPECTED_COMMIT" \
  --evidence-root artifacts/zk682/raw
```

The evidence root is fixed. The command rejects a short or different SHA, a
checkout whose `HEAD` differs from the candidate, a working `package-lock.json`
that differs from the candidate blob, missing or unbound raw files, stale
hashes, relaxed thresholds, candidate drift, and reports whose declared result
differs from recomputation.

The builder writes normalized gates to `release/zk682/gates/`, writes
`release/zk682/evidence-manifest.json`, and invokes
`npm run release:certify:zk682`. A passing machine packet without physical
evidence produces `HOLD` whose only blockers are `midrange-physical-p95` and
`low-end-physical-p95`. A structurally valid failed machine report is retained
as a failed criterion and HOLD, not misclassified as malformed evidence.

## Required raw evidence

- `pwa-indexeddb.json`
- `desktop-darwin-arm64/` and `desktop-win32-x64/`, each containing
  `persistence.json`, `package-manifest.json`, package `app.asar`, and executable
- `renderer-resource-growth.json`
- `save-load-resource-stability.json`
- `long-session-resource-stability.json`
- `editing-overlay-sleep-recovery.json`
- `zk682-stability-final.png` when emitted by the stability producer
- `asset-delivery.json`, `m35-asset-audit.json`, and
  `browser-build-manifest.json`
- `headless-performance.json` and `headless-performance-source.json`
- every command receipt named by `ZK682_PACKET_RECEIPTS`

Run `node scripts/zk682-collect-linux-evidence.mjs` after the production build
and pinned M27 performance run. The headless contract fixes renderer work at 8
ms, cold startup at 5000 ms, and fixture load at 6000 ms. Headless frame p95 is
report-only.

Optional physical reports are `physical-midrange.json` and
`physical-lowend.json`. Their `hardwareClass` must match the gate and their
36-hole/100-golfer biome/season/weather scenario must exactly equal the
headless scenario.

## Command receipts

Use `scripts/zk682-run-command-receipt.mjs` to execute each command. It records
the actual exit code and derives `passed`; callers cannot supply a manual pass
flag. Core, browser, asset, and headless gate values are derived from those
receipts plus typed measurement reports.

## Hosted exact-SHA workflow

`.github/workflows/zk682-certification.yml` is manual-only and requires a full
`candidate_sha`. Every job checks out and verifies that exact commit, and binds
`ZK682_EXPECTED_COMMIT` to the input rather than the workflow file's ref. The
Linux, native, and aggregate jobs exchange only exact-name artifacts created by
the same workflow run.

Same-run artifact destinations:

- `zk682-linux-evidence-<full-sha>` — raw Linux evidence, 90 days
- `zk682-native-evidence-darwin-arm64-<full-sha>` — native evidence, 90 days
- `zk682-native-evidence-win32-x64-<full-sha>` — native evidence, 90 days
- `zk682-certification-packet-<full-sha>` — complete raw/normalized packet, 90 days
- `coursecraft-<platform>-<arch>-unsigned-<full-sha>` — unsigned package, 30 days

Aggregation must download only exact SHA-suffixed artifacts from that run, run
`release:build:zk682`, retain the packet even on HOLD, and fail unless all
machine criteria pass and any HOLD blockers are physical-only.

Dispatch only after the candidate exists on the remote:

```sh
gh workflow run zk682-certification.yml \
  --ref develop \
  -f candidate_sha=<full-40-character-sha>
```

The dispatch ref selects the workflow definition only. Evidence identity is
always the required `candidate_sha`. The workflow never substitutes
`github.sha` or `GITHUB_SHA` for the candidate.
