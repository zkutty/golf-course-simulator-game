# M66 Career Handicap & Scorecard Certification (ZK-721)

## Certification basis

- Source: local verified ZK-720 commit `b8d6ee7efa1751fde0f69f1ddf1e29e71581ad69`.
- Certification branch: `codex/zk721-m66-certification`.
- Scope: verification fixtures, automated and browser evidence, and two directly evidenced ZK-720 release defects. No scoring formula, eligibility rule, reward/escrow policy, or unrelated UI behavior changed.

## Acceptance evidence

| Acceptance area | Certified evidence |
| --- | --- |
| Individual formulas | Course and playing handicap, half-away-from-zero boundaries, plus and mixed-sign strokes, strokes-off-low, gross/net stroke play, every Stableford band, net-double-bogey adjusted gross, differential rounding, and provisional/established per-hole maximums. |
| Handicap history | Every latest-20 best-count band, first/second provisional blends, score-only establishment, upward/downward movement limits, and unambiguous plus-index display. |
| Team formulas | Frozen four-ball match 90%, four-ball stroke 85%, alternate-shot 50% combined, and scramble 35% low + 15% high fixtures, including plus/mixed-sign members, strokes-off-low, individual gross evidence, and stable team snapshots. |
| Stroke-index authoring | Automatic 9-hole ranking, automatic 18-hole odd/even allocation, manual indexes, missing/duplicate/out-of-range diagnosis, publish/re-publish stability, and immutable round-start index values. |
| Posting eligibility | Casual, challenge, team, and tournament sources are eligible on complete 9- and 18-hole cards. Practice, conceded, withdrawn, partial legacy, and incomplete cards are retained with explicit ineligibility evidence and no differential. |
| Persistence | Fresh one-time seed, legacy migration, JSON reload, immutable snapshot, duplicate completion/post protection, duplicate identity rejection, posting-ledger consistency, and actionable corrupt-index rejection. |
| Confidence interaction | Deterministic daily decay, bounded practice gains, completed-score feedback, concession penalty, frozen round confidence, and dispersion-only 1.04/1.00/0.96 multipliers. |
| Browser/text state | Deterministic `advanceTime(1000)` replay after fixture reset, live `render_game_to_text` handicap/snapshot/card evidence, desktop and compact individual cards, 18-hole group net card, console/page-error collection, and bundled-client renderer/text capture. |

The consolidated fixture is `src/game/testing/m66Certification.test.ts` and runs through `npm run test:cert:m66`.

## Defects found and repaired

1. The ZK-720 round preview memo depended on a newly allocated `playable` array. React Compiler rejected the memo under the repository lint gate. The preview now calls the already-authoritative `startPlayableRound` inside a stable primitive/prop dependency set; invalid layouts still return no preview and the existing Start button eligibility remains unchanged.
2. The ZK-720 text-state projection manually copied each score-record field and put production initial JavaScript 38 bytes over the hard delivery limit. It now exposes the same immutable profile and latest 20 records directly, including the posting ledger/version, leaving initial JavaScript at 1,608,466 bytes (253 bytes under the 1,608,719-byte limit).

## Automated results

- `npm run test:cert:m66`: 8 files, 106 tests passed.
- `npm run test:ci`: 170 files, 1,338 passed, 1 intentional skip; audio audit 5/5 passed.
- `npx tsc -b --pretty false`: passed.
- `npm run lint`: passed with zero errors and 12 pre-existing React Hook warnings; i18n extraction/content guards passed.
- `npm run build`: passed TypeScript, Vite, biome consumer, audio, offline injection, M35 assets, Parkland 4x, surface-residency, and delivery audits. Initial JavaScript is 253 bytes under budget; all reported budgets are green.
- `npm audit --omit=dev`: zero production vulnerabilities.
- `git diff --check`: passed.
- `npx playwright test e2e/zk720-career-handicap-scorecards.e2e.ts --workers=1`: 2/2 passed in 1.1 minutes. The group-card screenshot rerun passed 1/1.
- Bundled web-game client: two iterations on `?m47Fixture=1`, no `errors-*.json`, valid in-game text state, and inspected final renderer capture.

## Visual artifacts

- `artifacts/zk720-desktop-scorecard.png`: inspected at 1440x900; the individual preview card is readable and explicitly explains why the three-hole fixture is not postable.
- `artifacts/zk720-compact-scorecard.png`: inspected; all three rows, frozen setup, formula values, and the 9/18 exclusion remain visible without clipping.
- `artifacts/zk721-group-scorecard.png`: inspected; all 18 rows, plus-handicap strokes, format, concessions/withdrawals, and four expandable golfers are readable.
- `artifacts/zk721-web-game-client/shot-1.png`: inspected; the 18-hole certification course renders coherently in the bundled-client canvas.
- `artifacts/zk721-web-game-client/state-1.json`: retained machine-readable text state. No console-error artifact was produced.

## Release readiness and exception

M66 acceptance is release-ready on the verified local integration base: all scoped logic, persistence, text-state, browser, full regression, build, asset, delivery, i18n, and production-dependency gates pass.

The legacy `npm run release:audit` command is not green on this branch for three independently identifiable reasons: `package.json` is `1.0.0-rc.5` while `release/rc-config.json` remains `1.0.0-rc.4`; the pre-existing `src/app/DeferredSurface.tsx` console call is outside that script's allowlist; and the script requires a clean source tree while certification changes are intentionally uncommitted. These are release-process follow-ups outside ZK-721 and were not silently changed. The audit's secret, cache, manifest, deployment-base, source-map, audio, and no-index checks passed.
