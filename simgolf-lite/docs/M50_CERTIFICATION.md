# M50 Machine-Only Certification

## Scope

Certification issue: ZK-553.

Covered implementation issues: ZK-539, ZK-540, ZK-548, ZK-549, ZK-550,
ZK-551, and ZK-552.

This packet certifies deterministic machine-verifiable behavior only. It does
not perform or claim human visual, accessibility, gameplay-balance, listening,
provider, physical-device, or release-owner acceptance.

## Candidate identity

- Promoted `develop` base:
  `1010f1f0880ba5460573ba198a64e2cbb81011eb`
- Integration commit: `INTEGRATION_COMMIT_REQUIRED`
- Working-tree disposition: uncommitted certification candidate

The release-owner must replace the placeholder with the exact clean integration
commit before using this packet as release evidence.

## Automated evidence

Run from `simgolf-lite/`.

### Focused M50 validation

```sh
npm test -- --run src/game/testing/m50Certification.test.ts
```

Result on 2026-07-30:

- Exit code: `0`
- Test files: `1 passed`, `1 total`
- Tests: `3 passed`, `3 total`
- Duration: `37.66s`
- The repaired `bounded-player-ai-rounds` check passes for the deterministic
  36-hole/100-golfer fixture: all strategic follow-ups begin on playable lies,
  outcomes remain finite and valid, attempts remain bounded, retained outcomes
  remain capped at 240, and repeated runs remain byte-deterministic.

The M50 check matrix passes, including:

- five-case Player Pro preview/commit/direct-execution parity;
- OB, red, and yellow one-stroke rulings and legal automatic relief;
- around/under/over plus trunk/canopy/bush/rock collision fixtures;
- lie/club/flight configuration at recovery 0/50/100;
- Player Pro/live shared-outcome parity;
- v19→v20 and current-v20 save compatibility for active state, three
  historical round kinds, match/tournament/campaign links, Return to Design,
  and architecture evidence;
- six hostile active-round cases while preserving completed history;
- 120 finite/legal hostile shot inputs;
- bounded 36-hole direct, campaign-style match, and tournament auto-finish;
- 220×140 (30,800-cell), 36-hole, 100-golfer live-scale assertions.

### ZK-551 regression and related suites

```sh
npm test -- --run src/game/playerPro/playerPro.test.ts src/game/live/m47.test.ts src/game/live/strategicOptions.test.ts src/game/live/live.test.ts src/game/live/persistence.test.ts src/game/tournaments/tournaments.test.ts src/game/tournaments/m24Qualification.test.ts
```

Result on 2026-07-30:

- Exit code: `0`
- Test files: `7 passed`, `7 total`
- Tests: `73 passed`, `73 total`
- Duration: `36.00s`
- The focused regression proves the rules-classified containing tile is
  authoritative when a fractional rest lies beside water, and proves the next
  strategic shot does not begin from `water`, `wetland`, or `out_of_bounds`.

Root cause: controlled-round ruling and relief geometry use the containing tile
(`floor`), while Player Pro/live lie sampling used nearest-tile rounding.
Fractional legal rests could therefore be relabeled as an adjacent penalty
tile after the ruling was complete. Player Pro outcome lies and live strategic
terrain sampling now use the same containing-tile convention. Ruling,
automatic-relief, score/penalty, ordering, and loop bounds are unchanged.

### Production build and deterministic audits

```sh
npm run build
```

Result on 2026-07-30:

- Exit code: `0`
- TypeScript project build: passed
- Vite production build: passed (`1,322` modules, `2.19s`)
- 40-file audio manifest audit: passed
- Service-worker offline asset injection: passed (`19` assets)
- M35 asset-budget audit: passed
- Parkland 4× contract audit: passed
- Existing informational warnings: mixed static/dynamic `saveStore` import and
  large output chunks.

## Machine acceptance disposition

**PASS**

The packet is ready for integration as machine-only ZK-553 evidence. The
verified ZK-551 blocker is repaired without changing penalty counts or relief
ordering, and all scoped deterministic checks pass. The integration commit
placeholder and the non-machine gates below remain release-owner work; they do
not change this machine-only pass.

## Remaining non-machine gates

- Three-biome visual inspection of boundaries, flight, collision, ruling,
  relief, and next-shot presentation.
- Keyboard, screen-reader, reduced-motion, text-scaling, and
  color-independent-marking accessibility review.
- Human audio/listening review.
- Real-hardware GPU/frame-pacing and physical-device checks.
- Human golf-authenticity and gameplay-balance review.
- Provider-backed packaging/distribution/hosting checks, if required.
- Release-owner assignment of the exact integration commit and release
  disposition.

## Newly discovered distinct work

None. The repaired blocker is within existing ZK-551 acceptance.
