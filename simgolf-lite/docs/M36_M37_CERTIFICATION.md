# M36–M37 Player Pro Certification

Date: 2026-07-23

Decision: **CONTINUE**

## Delivered

- A persistent Player Pro identity with appearance, handedness, background bonuses, six skills, XP, techniques, earnings, reputation, trophies, and bounded career history.
- A pure deterministic shot resolver shared by preview, direct input, caddie recommendations, and automatic completion. It handles continuous power, club/lie constraints, hazards, recovery obstructions, rolling, putting, penalties, and skill evidence without DOM or Pixi dependencies.
- Immutable course, routing, tee, pin, and geometry snapshots for controlled rounds. Course editing is locked during the decision loop and returns to the relevant design context afterward.
- A controlled round state machine with one-shot submission, visible flight/rest traces, scorecard, autosave boundaries, save/resume support, concede, automatic completion, and one-time settlement.
- Player Pro creation in new-game setup plus career, play, training, match, and tournament surfaces in the in-game UI.
- Training tied to open practice facilities, a club professional, cash, authoritative live time, and a two-session daily cap.
- Friendly and wager matches against persistent named golfers with atomic relationship and cash settlement.
- Hosted tournament entry with skill gates, a stable field, ordered world leaderboard, prize/reputation settlement, and trophies.
- Historical round records now retain bounded scorecards and shot traces. Legacy schema data remains readable; malformed future active-round data is dropped without losing the career profile.

## Acceptance coverage

| Milestone | Evidence |
| --- | --- |
| M36 deterministic golf | `playerPro.test.ts` repeats identical seeded shots byte-for-byte and verifies shared preview/commit behavior, continuous power, hazards, lies, obstruction risk, and direct shot evidence. |
| M36 authoritative play loop | `m36-player-pro.e2e.ts` covers route setup, canvas aim, caddie aim, commit, retained shot trace, editor lock, score settlement, and Return to Design. |
| M36 save/resume | Schema v14 normalization preserves the active routing snapshot; malformed optional round state is safely removed. Autosave runs at non-flight round boundaries. |
| M36 3-hole certification | The dedicated Player Pro reference routing completes through the browser with no console errors. |
| M37 progression | Tests cover exact technique gates, bounded/diminishing round XP, training prerequisites/cost/time/caps, and stable legacy identity. |
| M37 competition | Tests cover friendly/wager settlement and hosted tournament field, leaderboard, payout, winner, and duplicate-settlement protection. |
| M37 9/18 certification | Deterministic 9- and 18-hole routes complete, persist full scorecards/shot history, and reject duplicate rewards. |

## Verification

- `npm run build` — pass.
- `npm run lint` — pass with seven pre-existing React Hook warnings and no errors; localization guards pass.
- `npm test` — 62 files passed; 385 tests passed and 1 skipped.
- `npx playwright test e2e/m36-player-pro.e2e.ts e2e/golden-path.e2e.ts --workers=1 --timeout=120000` — 8 tests passed.
- Focused Player Pro E2E rerun after final competition integration — pass.
- `git diff --check` — pass.
- Bundled web-game client loaded Quick Start, emitted structured Player Pro state, and reported no console-error artifact.
- Visual inspection passed for the first-shot HUD/trace and completed-round/return-to-design state:
  - `artifacts/m36-player-pro-shot.png`
  - `artifacts/m36-player-pro-complete.png`

## Remaining observations

- The production build retains the existing Vite warning for large Pixi/application chunks.
- The bundled canvas-only smoke capture renders black under its headless SwiftShader path on this machine; full-page Playwright captures render correctly and were used for visual certification.
