# ZK-565 machine certification v2

Candidate: `c69316ae8133b6fe484aadc2006fd9a3bfaf4552`

Machine result: **PASS**

Final release/human acceptance: **DEFERRED**

This report supersedes, but does not remove or rewrite, V1. The V1 candidate
passed its local automated gates, but descendant `b895812` was rejected by CI
because seeded generation was not portable across JavaScript runtimes. V2
certifies the repaired exact candidate and keeps every human and physical-GPU
gate open.

## Rejection, root cause, and repair

GitHub run `30559567366` rejected `b895812981df39cf0cf01044bd9223b8511026db`.
The generation test expected
`c3d46b2f50fbdf5b49a5d5532160501e1816dbe0ccb719609697a9144d96748b`
but received
`e09728b79e84686060ff687861a9af73d3ce294140bdb24d100c841c6a051349`.

Two terrain shuffles called the seeded RNG from an `Array.sort` comparator.
Comparator invocation order and count are runtime implementation details, so
different V8 versions consumed different amounts of RNG state. Terrain
differences then propagated into obstacles and elevations. Neither former
hash was a portable semantic baseline.

Candidate `c69316a` replaces those operations with Fisher-Yates, which consumes
exactly `n - 1` draws, and reuses the same helper for the pre-existing
shoreline shuffle. A focused helper regression fixes the permutation and draw
count. Node 24.11.1 and Node 25.8.2 now produce the same generation SHA-256:

`df29422e3bf81b077c22191d563ce1d84d1fd6396c5da80adc62c8b7cc9e65f5`

The four-year weather SHA-256 is unchanged:

`57fde66c427db1bf4bb494a03d96e59103deed8630d16f648c0af0de5ba88cd7`

Exact-SHA GitHub CI run
[`30560782249`](https://github.com/zkutty/golf-course-simulator-game/actions/runs/30560782249)
also passed typecheck, lint, tests, golden browser coverage, build, and the
playtest deployment for `c69316a`. The checked-in workflow declares Node 22;
that successful run is additional runtime coverage rather than a substitute
for the separately executed Node 24.11.1 validation.

## Compatibility judgment

Existing saves remain compatible because course terrain, elevations, and
obstacles are persisted and loaded rather than regenerated. The focused
save/import/package/atlas suite passes all 71 tests. Historical grid-size
migrations still preserve the complete old property, while only the newly
exposed exterior now follows the portable sequence.

This repair intentionally changes same-seed new-course generation. Newly
created Parkland and Desert estates can differ from both former
runtime-specific outputs. Links defines zero inland water bodies, so its
sampled fixtures did not enter the defective shuffle and remained unchanged.
The portable hash is the canonical behavior going forward.

## Fresh exact-candidate gates

| Gate | Result |
|---|---|
| Full Vitest | PASS — 125 files; 981 passed; 1 skipped; 35.05 s |
| TypeScript | PASS — `npx tsc -b` |
| Lint + i18n | PASS — 0 errors; 12 existing hook warnings; 56 UI and 4 authored-content files |
| Production build | PASS — 1,334 modules; 2.69 s; audio, SW injection, M35 asset, and Parkland 4x audits green |
| Biome audits | PASS — 0 required, 45 optional, 3 explicit fallbacks, 0 over-budget |
| Save/package/atlas focus | PASS — 9 files; 71 tests |
| Browser matrix | PASS — 13 tests in 6.3 minutes; all 48 biome/view/rotation states |
| PWA smoke | PASS — strict CSP, selected-biome cache isolation, scoped install, offline reload, local save |
| Performance smoke | PASS — 1,033 ms cold start; 3,874 ms fixture load; 0.434 ms renderer work; 100 golfers |
| Bundled client | PASS — Links direct-play shot and Desert golfer-follow state; populated/distinct captures; no error artifact |

The exact commands and structured results are recorded in
`machine-certification-v2.json`.

## Budgets and hashes

| Budget | Observed | Limit | Result |
|---|---:|---:|---|
| Largest atlas pair | 1,183,165 B | 8,388,608 B | PASS |
| Largest selected biome tier | 3,506,327 B | 6,291,456 B | PASS |
| Initial non-audio critical | 3,755,841 B / 3.582 MiB | 8,388,608 B | PASS |
| Renderer JS work | 0.434 ms | 8 ms | PASS |

- Authoring audit file SHA-256:
  `c23dd203780a5342ba54a10bcd7c6840d6a3f8be76d5de612fe274cfb8feb21e`
- Reference fixtures file SHA-256:
  `2be06c9f1d1e49f23eaaf7b3128e43cf953b9d7af414597bb566031f95c66e64`
- Logical authoring report SHA-256:
  `0b4ad65c162d8c396f84ee675fcfb940eca736d623f58fda8a94aeb5b57ea2c2`
- Logical fixture report SHA-256:
  `076abe030daf55b67ce64fed2e8bec9cde17742d3b7bc25b87651a0a2ed0631d`
- Atlas manifest SHA-256:
  `9ad33795b4ebb819b5d4b3d324bb10273bc3c73e861e44d747743c6dae603361`

Fresh bundled-client evidence is stored separately from V1 in
`artifacts/zk-565/{bundled-client-v2,bundled-client-stable-v2}`. The captures
were checked only for populated, biome-distinct implementation output.
That machine inspection is not human art or aesthetic approval.

## Explicitly deferred final gates

- Human playtesting, balance, golf-authenticity, and gameplay validation.
- Human art direction and aesthetic review.
- Human accessibility, input-device, browser, display, and UX validation.
- Physical mid-range and low-end GPU p95 measurement (`<=20 ms` target and
  `<=33 ms` floor).

Headless software GL again reported a throttled 100 ms frame p95. The harness
correctly treats it as report-only, so V2 does not claim physical-GPU
acceptance.
