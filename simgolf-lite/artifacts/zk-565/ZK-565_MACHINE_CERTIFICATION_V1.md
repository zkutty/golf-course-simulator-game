# ZK-565 machine certification v1

Candidate: `a26e1346a6af451d1f42f7d1face459f3971327b`

Machine result: **PASS**

Final release/human acceptance: **DEFERRED**

All required automated M52 checks passed on the immutable candidate. This
report does not claim the physical-GPU frame-pacing judgment or human art,
gameplay, accessibility, and aesthetic approvals that the work plan reserves
for the final validation phase.

## Candidate and repair provenance

The original implementation candidate, `6097cf866ad28e2ef6f3e50340cee81e8a3f72ce`,
failed the golden save/reload test: schema v23 persisted canonical biome
compatibility metadata, while the certification state hash did not normalize
that optional evidence. The before hash was `29e9c4e3`; the reloaded hash was
`a8b1f502`.

The repair canonicalizes and validates biome identity in both the main course
and an active Player Pro round before hashing. Independent review found the
active-round edge case, and the expanded repair was re-reviewed before being
committed as this candidate. The same golden path now passes.

## Fresh exact-candidate evidence

| Gate | Result |
|---|---|
| Full Vitest | PASS — 125 files; 980 passed; 1 intentional skip |
| Production build | PASS — 1,334 modules; audio/asset/offline injection audits green |
| Lint + i18n | PASS — 0 errors; 12 existing hook advisories; 56 UI and 4 authored-content files checked |
| Biome consumer audit | PASS — all 3 registered biomes |
| Authoring/provenance audit | PASS — 0 required findings; 45 optional omissions; 3 explicit fallbacks; 0 over-budget |
| Focused save/package/atlas suite | PASS — 9 files; 71 tests |
| Playwright matrix | PASS — 13 tests in 6.4 minutes, including all 48 biome/view/rotation states |
| PWA smoke | PASS — strict CSP, selected-biome cache isolation, scoped install, offline reload, local save |
| Performance smoke | PASS — 847 ms cold start; 3,913 ms fixture load; 0.369 ms renderer JS work; 100 golfers |
| Bundled client | PASS — populated, biome-distinct small minimap/canvas captures; interaction semantics in structured state; no error artifact |

The exact browser command covered the repaired save/reload path, checked-in
historical migration, keyboard/accessibility options, M35 authoring timings,
all registered new-game biomes, seasonal-overlay fallback, all 48 ZK-564
reference states, the stable UI shell, and reduced motion.

## Determinism and compatibility

- Generation SHA-256:
  `c3d46b2f50fbdf5b49a5d5532160501e1816dbe0ccb719609697a9144d96748b`
- Four-year weather SHA-256:
  `57fde66c427db1bf4bb494a03d96e59103deed8630d16f648c0af0de5ba88cd7`
- Climate/phenology projection is deterministic for seed, biome, and day;
  all 14-day boundary blends stay bounded; long-year projection and reload do
  not mutate saved history.
- Schema v23 accepts supported historical labels, persists canonical evidence,
  rejects unknown/contradictory course and active-round evidence, and keeps
  hostile imports atomic.
- Lazy atlas tests cover selected base + current season, base-only fallback,
  overlay retry, and late previous-season race protection.

## ZK-329 payload and offline contract

| Budget | Observed | Limit | Result |
|---|---:|---:|---|
| Largest atlas pair | 1,183,165 B | 8,388,608 B | PASS |
| Largest selected biome tier | 3,506,327 B | 6,291,456 B | PASS |
| Initial non-audio critical | 3,755,987 B / 3.582 MiB | 8,388,608 B | PASS |

All nine biome/quality payloads are between 2,172,874 and 3,506,327 bytes.
The rebuilt v2 manifest is content-hashed and fail-closed. PWA smoke confirmed
that Parkland demand loading did not cache Links or Desert, every requested
asset was cached, and the requested set remained available offline.

## ZK-332 quality and timing contract

Fresh unit coverage verifies explicit High/Medium/Low behavior, Auto
low-memory protection, visual density scaling, spike rejection, sustained
downgrade, the longer upgrade path, cooldown, and invalid samples. The
controller uses 120-frame windows, two slow windows to downgrade, five fast
windows to upgrade, and a 360-frame cooldown.

The M35 authoring browser test passed its assertions for curve preview
`<=50 ms`, ordinary commit `<=100 ms`, and chunk/connected rebuild
`<=100 ms`. The fresh Parkland performance smoke passed the `<=5 s` cold
start and `<=8 ms` renderer-JS budgets.

Headless software GL reported a 100 ms frame p95 near its fixed 10 fps
throttle. The harness deliberately did not assert that value. It is not
evidence for the physical mid-range `<=20 ms` target or low-end `<=33 ms`
floor. Those measurements remain deferred.

The checked-in Links and Desert performance fixtures are inherited context
only, not fresh gates for this exact SHA: Links records 861 ms startup and
0.292 ms renderer work; Desert records 967 ms startup and 0.294 ms renderer
work.

## Artifacts and hashes

- Machine report: `artifacts/zk-565/machine-certification-v1.json`
- Links direct-play:
  `artifacts/zk-565/bundled-client/{state-1.json,shot-1.png}`
- Desert golfer-follow:
  `artifacts/zk-565/bundled-client-stable/{state-1.json,shot-1.png}`
- Authoring audit file SHA-256:
  `e6bf04cf76a199c505899e2b7272d69e71b52871aa3b30f6453eb662aaf07664`
- Reference fixtures file SHA-256:
  `3a69d43c67a275bd2eacca1af721e56412290a153d7d2c33f653e267a3e0a003`
- Logical authoring report SHA-256:
  `009f7acf540f7ba1d2f3e7e38cd6964070fe9fe53b896468478480bb13fcdf4e`
- Logical fixture report SHA-256:
  `12ae3d207c058174e15c11faf183004538fbb7755c4bebc4f6a29beabfb88ad9`
- Atlas manifest file SHA-256:
  `9ad33795b4ebb819b5d4b3d324bb10273bc3c73e861e44d747743c6dae603361`

The two bundled PNGs are small minimap/canvas captures. They prove populated,
biome-distinct renderer output but are not readable full direct-play or
golfer-follow scenes. Their `state-1.json` files prove the shot/follow
interaction semantics. Full-scene visual evidence comes from the approved
ZK-564 matrix.

## Deferred final gates

- Physical mid-range and low-end GPU p95 measurements.
- Human art direction and aesthetic approval.
- Human gameplay, golf-authenticity, and balance validation.
- Human accessibility, input-device, browser, and display validation.

These deferred items do not change the **PASS** result for ZK-565's machine
certification. They keep final release acceptance deferred, matching the
approved plan to perform human testing and validation at the end.
