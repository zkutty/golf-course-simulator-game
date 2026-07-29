# M35 Continuous Landscape certification

Certification date: 2026-07-25

## Decision

`HOLD`

The implementation candidate now covers the M35 terrain-authoring, connected
rendering, elevation, biome-art, world-dressing, adaptive-quality, persistence,
PWA, and performance scope. It is not release-certified yet:

1. the evidence was produced from an uncommitted working tree, so it does not
   identify the exact immutable build required by ZK-473;
2. the independent fresh-context visual parity review in ZK-473 has not run;
3. the physical-GPU frame-time targets have not been measured on the specified
   mid-range and low-end hardware; and
4. the explicit human visual approval required by ZK-466 has not been recorded.

Passing implementation tests must not be treated as either the independent
visual verdict or the human approval.

## Handoff checkpoint — 2026-07-25

The implementation is intentionally still an uncommitted working-tree
candidate. The repository base is `6944abe` (`Add biome terrain relief and
detail atlas`); do not treat the current dirty tree as the immutable ZK-473
candidate until the next agent reviews and commits the intended M35 files.

The latest verification state is:

- `npx vitest run --reporter=dot`: **88 files, 552 passed, 1 skipped**.
- `npx tsc -b --pretty false`: passed.
- `npm run lint`: passed with no errors; 11 existing React Hook warnings.
- `npm run build`: passed TypeScript, Vite, exact 40-file audio audit, service-worker injection, and M35 asset budgets.
- `npm run test:pwa`: passed strict-CSP render, scoped install, offline reload, and local-save persistence.
- `npm run test:perf`: passed with **1.08 ms** renderer work against the 8 ms budget; headless frame p95 was 100 ms and is report-only under the fixed 10 FPS harness.
- `git diff --check`: passed.
- `e2e/m14-onboarding.e2e.ts:411` (reload/resume/rerun): passed in 11.5 minutes. This covers semantic tile projection, continuous paint strokes, nine valid holes, reload checkpoints, settled tutorial autosave, adaptive renderer changes, and late rerun/skip behavior.
- `e2e/golden-path.e2e.ts:145`: passed in isolation (16.1 seconds).
- The earlier repository-wide Playwright snapshot was 61 passed / 8 failed. A follow-up isolated batch was started; the keyboard case passed, but the remaining M17/M27/M6/M7 cases were interrupted when the session was stopped. Their result is **pending**, not green.

Two regressions found during the onboarding rerun are now fixed: Pixi
resolution-quality changes resize the existing renderer instead of tearing down
the canvas, and tutorial autosave coalesces around course/tutorial changes so
live simulation ticks cannot keep the status at “Saving progress…”.

## Implemented landscape contract

- Whole cells remain authoritative for terrain ownership, pricing, gameplay,
  picking, saves, hashes, undo, and redo. Connected components derive
  deterministic render-only silhouettes and shared pair boundaries.
- Curve, Spline, Area, and node editing share accepted coverage between
  preview and commit. Invalid, unowned, locked, and unaffordable cells remain
  explicit and cannot mutate the course.
- World-anchored material fields, mowing, macro variation, and edge detail do
  not reset per tile. Pair-aware single ownership prevents cracks and doubled
  fringes, lips, banks, or shoulders.
- Shared visual height sampling produces continuous biome-scaled undulation.
  Water components are graded flat and recessed; wetland is shallower; bunker
  floors are depressed beneath profile-specific rims. Gameplay elevation and
  saved integer heights remain authoritative.
- Sand classifies automatically as a compact one-cell pot bunker, a steeper
  greenside bunker, or a shallower fairway bunker. Single and connected sand
  use stable asymmetric, scalloped silhouettes over rough underlays rather
  than exposed square sand cells.
- Water painting clears ordinary dry-land props atomically. New obstacles are
  rejected on wet cells. Protected trees clip explicit dry islands from the
  wet mask.
- Fairways and bunkers receive rough collars, greens receive fringe plus rough,
  water receives layered rocky banks, and tree species receive restrained
  pine-straw, leaf-litter, or dry-soil habitat beds.
- Parkland, Links, and Desert ship as hashed, biome- and quality-tiered
  bundles. Auto/High/Medium/Low alter presentation only; simulation remains
  deterministic.

The reproducible art and asset rules are in `docs/M35_ART_CONTRACT.md`.

## Acceptance map

| Linear issue | Implementation evidence | Certification state |
| --- | --- | --- |
| ZK-326 authoring | Curve/Area/Spline/node tools; exact accepted coverage; atomic economics; bounded undo/redo; save/load and rotation browser coverage | Implementation candidate complete |
| ZK-327 connected terrain | Authoritative cell components; derived rounded silhouettes; world-space materials; shared pair boundaries; preview/commit parity | Implementation candidate complete; visual approval remains gated |
| ZK-328 elevation/integration | Shared surface sampler, compatible-land smoothing, flat recessed water, depressed bunker floors, anchored objects, four-rotation fixtures | Implementation candidate complete |
| ZK-329 biome pipeline | Deterministic 4× sources, hashed tier bundles, lazy cache-on-demand loading, offline retention, asset budgets | Implementation candidate complete |
| ZK-330 world polish | Bounded terrain dressing/effects, grounded habitat, water motion, quality/reduced-motion density controls | Implementation candidate complete |
| ZK-331 editing feedback | Context-only hover/coverage/nodes; no ordinary full-map grid | Done in Linear |
| ZK-332 technical certification | Unit/fuzz/build/lint, scoped browser/PWA, renderer-work, asset, save, and bundled-client gates below | Partial: physical GPU and final visual gates remain |
| ZK-468 silhouettes | Deterministic component tracing, topology-preserving rounded rendering, shared boundaries | Done in Linear |
| ZK-469 material/contours | World-anchored fields and mowing; table-driven, multi-band, single-owner terrain-pair contours | Done in Linear; final visual gates remain |
| ZK-470 heightfield | Shared component-aware height sampling, biome undulation, flat water, bunker profiles, mesh/object agreement | Done in Linear; final visual gates remain |
| ZK-471 camera/dressing | Closer COZY play scale, overview retained, zoom-aware bounded clusters and controls | Done in Linear; final visual gates remain |
| ZK-472 Parkland art slice | Reproducible 4× generator, art contract, provenance/fallback boundary, atlas and transfer validation | Done in Linear; final visual gates remain |
| ZK-473 independent parity review | Requires a fresh reviewer, all four references, exact committed build, aligned contact sheets, scored rubric, and `READY`/`NOT READY` verdict | Not run |
| ZK-466 human approval | Requires ZK-473 `READY` evidence followed by explicit human approval | Not started |

## Automated evidence

### Model, rendering, and persistence

- Complete Vitest run: 88 files, 552 passed, one intentional skip.
- Focused landscape geometry repeat: 22 passed.
- Reducer fuzz: passed.
- TypeScript: passed.
- ESLint/i18n: no errors; 11 existing React Hook warnings.
- Production build, audio allowlist, service-worker injection, and M35 asset
  audit: passed.
- `git diff --check`: passed.

### Browser, PWA, and compatibility

- M35 authoring, landscape-detail, water-grading, three-theme relief, material
  composition, connected-fill, and camera suites pass.
- Parkland, Links, and Desert captures pass at all four rotations and the
  required detail views.
- Golden save/load path passes in a serial run.
- Chrome, Firefox, and WebKit release checks pass 3/3.
- Strict-CSP PWA install, service-worker control, offline reload, loaded-biome
  retention, and local-save persistence pass.
- The required bundled web-game client reached structured gameplay state,
  selected High from Auto, and reported no captured error.

The repository-wide Playwright snapshot remains historical evidence only: 61
passes and eight failures outside the M35 browser scenarios. Repaired issues
include rapid tee/green clicks (synchronous wizard refs), the advisor action
being beneath the bug-report launcher, Pixi adaptive-resolution teardown, and
tutorial autosave churn. Focused post-fix verification is complete for the
full M14 B path and the keyboard/save-load case; the four remaining isolated
domain tests still need a clean result.

### Performance and payload

- Latest performance smoke: cold startup 2,687 ms and 36-hole/100-golfer
  fixture load 8,915 ms; both remain within the 5 s startup / bounded fixture
  budget used by the smoke harness.
- Renderer JavaScript work: 1.08 ms against the 8 ms gate.
- Exact landscape rebuild: below 100 ms in the browser fixture.
- High/Medium landscape mesh subdivision: 4×/2×; Low uses the bounded fallback.
- Compressed non-audio initial critical payload: 3.522 MiB against the 8 MiB
  gate.
- Largest selected biome bundle: 3.344 MiB against the 6 MiB gate.
- Every atlas remains below 8 MiB.

Headless Chromium runs with a fixed approximately 10 FPS throttle in this
environment, so its observed 100 ms frame p95 is report-only and is not evidence
for the physical-GPU 20 ms/33 ms gates.

## Visual evidence

- `artifacts/m35-landscape-details.png` — full Parkland landscape fixture.
- `artifacts/m35-bunker-variants.png` — compact pot and connected fairway
  bunker comparison.
- `artifacts/m35-pot-bunker-detail.png` — one-cell asymmetric pot silhouette.
- `artifacts/m35-water-basin.png` — graded flat water component.
- `artifacts/m35-water-bank-close.png` — layered rocky bank detail.
- `artifacts/m35-surface-node-editor.png` — editable surface nodes and accepted
  coverage.
- `artifacts/zk467-{parkland,links,desert}-relief.png` — biome relief fixtures.
- `artifacts/m20-{parkland,links,desert}-{0,90,180,270}.png` — rotation matrix.

These captures were inspected for implementation regressions. They do not
replace the independent ZK-473 contact sheet and scored comparison.

## Remaining release actions

1. Run the pending isolated M17/M27/M6/M7 command from the handoff comment and
   record clean results or reproducible blockers.
2. Rerun the three M35 browser suites after the latest renderer/autosave fixes:
   `npx playwright test e2e/m35-landscape-details.e2e.ts e2e/m35-surface-authoring.e2e.ts e2e/m35-water-grading.e2e.ts --workers=1`.
3. Commit the intended M35 source and evidence as one exact candidate.
4. Measure frame p95 on the specified physical mid-range and low-end GPUs.
5. Run ZK-473 in a fresh context against all four attached references and the
   exact candidate commit.
6. If and only if ZK-473 returns `READY`, present the complete evidence bundle
   for explicit human approval in ZK-466.
7. Mark ZK-332 and the M35 milestone Done only after those gates pass.
