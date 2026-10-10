# Inspector accessibility delivery — batch 10

This bounded delivery advances ZK-382 and ZK-377. It covers HoleInspector,
GolferInspector, and LiveOverview; both issues and M41 remain open because their
acceptance includes additional product surfaces and release review.

## Behavior and ownership

Each inspector has a named, nonmodal region and native scrolling. Typography
uses rem units so the existing profile text-scale setting changes actual text
size. Panel-local styles wrap long names, pseudo-localized labels, and controls
without horizontal clipping. Focus remains visible and Tab can leave each
panel. Tee selection, mood, scorecard outcomes, and selected tabs carry text or
structural cues in addition to color. Close controls use owned SVG geometry.

Hole calculations, issue/fix strings, IDs, marker actions, callbacks, and
command payloads retain their existing semantics. Golfer statistics, mood
thresholds, capability values, scorecard ordering, shot evidence, and emote
ordering are unchanged. LiveOverview retains its internal tab IDs, profile
visibility rules, operations-focus nonce handling, pace presets, staff commands,
mobility policy normalization, purchase/salvage confirmation, and reservation
guards. Shared GameTabs, IconUi, global CSS, App, hooks, renderer, domain logic,
and persistence are outside this change.

## Verification contracts

The three `zk382-*-accessibility.e2e.ts` suites mount typed component fixtures
through the real i18n provider. They cover English and pseudo locales at
320×640, 768×800, and 1280×800. Root font size changes from 16px to 20.8px;
all scoped text and form-control font sizes must grow by 1.3 ± 0.01. The suites
check complete text/control reachability, native scrolling, no horizontal
overflow, focus visibility and contrast, noncolor state cues, exact callbacks,
immutable inputs, and absence of Canvas/Pixi requests and page errors.

- HoleInspector: 8 cases, including native Enter/Space tee selection, exact
  5/10/30 fairway payloads, par/stroke-index actions, terrain/fairness values,
  and legal/invalid/missing pin variants. Painted text contrast is at least 4.5
  and focus contrast at least 3 against conservatively composited surfaces.
- GolferInspector: 10 cases, including mood boundaries, 36 complete scorecard
  entries, signed/even scores, all four shot-evidence phases, recent thoughts,
  null/minimal states, follow/close actions, and native focus/scroll behavior.
- LiveOverview: 11 cases, including roving tabs and panel associations, locale
  changes preserving the selected internal tab, 24/12 list caps and ordering,
  7/28-day reports, hidden/summary/full profile boundaries, staff assignment
  and valid/invalid/unchanged shifts, repeated operations focus, and mobility
  configure/purchase/salvage cancel/confirm/reserved/cash guards.

`zk382-inspector-gameplay.e2e.ts` adds two real gameplay cases using the M23
and M47 fixtures. It measures every panel against its actual parent at 320px
and 768px with 130% text, in both locales. Every enabled control must remain
reachable through focus; geometric containment allows 1px for fractional
browser scroll rounding. This complements the component fixtures and existing
M23/M24/M47/M51, live progression, pace history, shot-truth, Classic/Simulation/
Campaign profile, golden-path, and vision-page regressions.

The M23 final pin-placement test now passes the reference green's actual
elevation 3 to its projection helper. The prior default elevation 1 places the
click on an elevation-aware tile corner; the same exact assertion failed on
the unchanged batch-9 baseline and batch-10 layout. The expected pin remains
exactly `{ x: 42, y: 20 }`; no renderer or selection rule changed.

Required release gates remain application/fixture TypeScript, lint and i18n,
full unit/audio audit, build and asset/delivery budgets, source-bound M65
certification, golden/vision E2E, and exact-commit PWA smoke. The measured local
initial JavaScript is 1,582,215 bytes against the unchanged 1,608,719-byte budget.
Development CI/deployment/health must pass before the same commit is promoted
to production. Final commit, CI, deployment, and post-deploy evidence belong in
the existing batch-10 Linear evidence comments.

## Scope and rollback

The implementation consists of the three UI components and their local CSS,
33 additive catalog keys, three isolated fixtures/suites, the actual-gameplay
suite, the M23 fixture-input correction, and this evidence document. Revert
these scoped files together to roll back the delivery. Unrelated local
artifacts are preserved. Heap, startup, canvas, and certification investigations
remain separate work.
