# M62 final certification packet (ZK-645)

## Disposition

The deterministic M62 certification contract passes **9/9 automated checks** on
the released dependency baseline `bbafeae`. The machine disposition is **PASS**
for the evidence below and **HOLD** for the five explicitly listed human,
physical-device, and release-owner gates. This packet does not authorize or
claim a production promotion.

The machine-readable source of truth is
[`artifacts/m62/certification-report.json`](../artifacts/m62/certification-report.json).
Its determinism hash is `47e900b8`; component hashes are `ef3d0de1` (fixtures),
`3ec3bd5c` (AI), `272cd549` (putting), `9ef1ccae` (consequences), `0443ab44`
(compatibility), `cc1aec26` (Architecture Review), and `cd1f2294` (full estate).

## Automated evidence

- Fourteen named green fixtures cover level, tiered, false-front, bowl, ridge,
  uphill, downhill, sidehill, wet/slow, dry/fast, worn, recovered, edge-pin,
  and severe-but-legal greens. The report validates deterministic rollout,
  distinct terrain/condition relations, and bounded output.
- One hundred capability/style cohorts choose among three preferred targets
  and three green roles without a universal target. Candidate sets are bounded.
- Automatic putting covers the complete 1–3 putt result domain and expected
  putts increase monotonically from strong/close to weak/long inputs.
- A/B/C pin rotations remain physically legal while producing distinct
  difficulty, rating, pace, satisfaction, complaint, and tournament-readiness
  evidence. Edge and severe legal pins remain warnings, not invalid states.
- Receptive, balanced, and championship maintenance expose increasing costs
  and distinct realized speeds. Neglect causes harm; a seven-day rest/closure
  intervention demonstrates recovery.
- Player preview/commit, automatic scorecard settlement, completed replay,
  Architecture Review, and live/Player paths retain one shared rollout/putting
  contract.
- v23 migration, v24 active-round reconstruction/freezing, malformed-active
  isolation, completed-history preservation, and hostile signed-package
  rejection are covered.
- The production-scale fixture is 220 x 140 cells, 36 holes, and 100 active
  golfers. The course and live snapshot round trips remain below 5 MiB and
  1 MiB respectively.
- Architecture Review sampling is deterministic and bounded to 45 overlay
  items in 152.4 ms on the final run, with text equivalents, reduced-motion-safe static
  patterns, and non-colour contour/arrow geometry. The cold full-estate base
  review completed in 66.1 ms against a 750 ms interactive budget while
  retaining all 36 holes, 108 pin setups, and 8 samples per option.

## Validation record

Run from `simgolf-lite`:

```text
npm run test:cert:m62
  PASS — 14 files, 92 tests; certification 9/9; hash 47e900b8

npx playwright test e2e/zk645-m62-certification.e2e.ts --reporter=line
  PASS — 1 test in 32.1s

npx tsc -b --pretty false
  PASS

npm run lint
  PASS — zero errors; 12 pre-existing React hook warnings

npm run build
  PASS — TypeScript, production Vite bundle, and all asset/delivery audits

git diff --check
  PASS
```

The browser contract asserts every M62 overlay selector, fully exercises
representative preferred-landing and risk overlays, verifies A/B/C/All pin and
golfer-cohort controls, bounded text-state evidence, reduced-motion wording,
responsive containment, and zero console/page errors. Exhaustive computation
of all six overlay kinds remains in the certification/unit contract so the
browser test does not repeat six expensive lazy computations.

Durable visual evidence:

- [`artifacts/m62/screenshots/zk645-m62-desktop.png`](../artifacts/m62/screenshots/zk645-m62-desktop.png)
  (`fb2ce74c62e8f123ec8424cb42fa393ad92d792fbcacd82996ca6cac0b18bff8`)
- [`artifacts/m62/screenshots/zk645-m62-mobile.png`](../artifacts/m62/screenshots/zk645-m62-mobile.png)
  (`2e72509e65ea383ab459abcedd995f22c62214beef6d3bf3aaffcb2bf0ee849e`)

The required bundled browser client also emitted coherent fixture state with
24 current evidence shots, 48 bounded traces, and no console/page error
artifact at
[`artifacts/m62/bundled-client/state-0.json`](../artifacts/m62/bundled-client/state-0.json).
Its canvas-only capture was black under SwiftShader and was discarded rather
than presented as visual evidence; the two inspected full-page Playwright
captures above are the visual record.

## Explicitly unproven gates

1. Human golf-authenticity playtest across all fourteen fixtures, including
   funnel-green and universal-target judgment.
2. Assistive-technology and physical text-scaling review of overlays/reports.
3. Physical supported-browser, installed-PWA, and packaged-desktop review.
4. Physical GPU/thermal soak on representative low- and high-tier hardware.
5. Release-owner sign-off on the exact integrated commit after development and
   production monitoring.

## Remaining full release commands

The release owner must run these against the exact integrated candidate. They
are intentionally not represented by this focused packet unless separately
recorded by the release workflow:

```bash
npm run test:ci
npm run test:fuzz
npm run test:soak
npm run test:balance
npm run test:perf
npm run test:pwa
npm run test:release:browsers
npm run test:desktop
npm run desktop:pack:dir
```

Then promote the unchanged tested artifact through the normal development to
production workflow and monitor the production deployment. Record the exact
candidate SHA, CI run, artifact identity, production URL, and monitoring result
in the release issue; the baseline SHA alone is not sufficient.

## ZK-698 Architecture Review performance closure

The original cold `buildArchitectureReview` path took 52.39 seconds on the
synthetic 220 x 140 / 36-hole / 100-golfer release fixture. It repeated the
same analytic cohort plan once for each of five option kinds, recomputed route
facts per cohort, and resolved full physical previews whose fields were
discarded before the M48 portfolio was returned.

ZK-698 shares each analytic cohort plan and route-fact projection and explicitly
skips only the discarded physical preview in the Architecture Review consumer.
The fixed-fixture findings hash remains `f7ff4b96` before and after. A focused
Node 22 cold run measured 87.6 ms; the bundled certification run measured 66.1 ms,
both below the enforced 750 ms interactive budget. The regression retains all
36 holes, 108 pin setups, 8 deterministic samples per option, recommendations,
rules findings, and the existing lazy green-overlay boundary. No prediction,
sampling, or deferred-result state was introduced, so the existing text state
and accessibility loading/text-equivalent contracts require no new qualifier.

## ZK-699 release balance runtime and coverage closure

The pre-fix `npm run test:balance` process remained CPU-bound without terminal
output after 72 minutes. A V8 profile isolated the recurring cost in
`scoreHoleUncached` / `solveShotsToGreen`: recreated release properties defeated
the exact dependency cache, while open or mildly degraded holes expanded many
equal-cost shot states after a globally optimal direct result was already known.

ZK-699 reuses immutable release-property geometry across management paths,
allows cross-biome hole-cache reuse only when the exact tracked terrain contains
no theme-sensitive deep rough, and applies two exact shortest-path bounds. A
best direct shot below two strokes is globally optimal because every indirect
route costs at least two strokes; otherwise Dijkstra stops when its known goal
is no greater than the smallest unsettled cost. Strict comparison preserves the
existing club and predecessor tie order. Focused coverage proves neutral-biome
reuse and deep-rough invalidation.

The same work exposed that the old harness's bankruptcy early exit executed
only 8,218 of its claimed 8,424 weeks. Every one of the 81 rows now executes all
104 weeks. The runner retains an exact first-bankruptcy projection of the old
8,218-week behavior, verifies bankruptcy remains finite and sticky through the
206 newly covered weeks, pins canonical hash `38b861f9`, and pins legacy
projection hash `6dc8d6f2`. Two complete local runs finished in 234,612 ms and
237,481 ms against an enforced 720,000 ms budget.
