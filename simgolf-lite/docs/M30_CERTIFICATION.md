# M30 pace identity and advisor certification

M30 turns pace from a same-day operational readout into a course-specific,
rolling management system.

## Player-facing behavior

- Each course stores at most 28 settled operating days. Old saves migrate to an
  empty versioned history and malformed imported history is bounded and
  normalized.
- Pace identity changes gradually from measured duration, wait, incomplete
  rounds, and cohort perception. Skilled/impatient and novice/social golfers
  can perceive the same operation differently; the identity affects segment
  demand and a bounded pace-preference match in repeat-visit intent.
- The Pace view exposes 7-day and 28-day course filters, average and p90 round
  duration, waits, pickups, incomplete rounds, incidents, refunds, overtime,
  beverage revenue, net revenue, and gross/net revenue per occupied tee hour.
- Hole advice ranks measured local peaks, suppresses downstream spillback, and
  always states evidence, action, and tradeoff. Map rings add radial tick
  patterns and severity text so color is not the only encoding.
- Last-tee, finish-started versus strict-sunset, and refund/credit/goodwill
  policies settle per course. Overtime and recovery costs reconcile directly
  through day and week ledgers.
- Tournament entrants retain identity while sharing deterministic 2–4 player
  group tee times. Multi-course histories, economics, controls, and reports
  remain isolated by course ID.

## Tunable and performance boundaries

All M30 thresholds and rates live under `BALANCE.paceOperations`. History is
bounded to 28 days, per-day duration samples are bounded, and the selector
budget test executes 1,000 mixed 28-day report/advisor queries in under 500 ms.

## Verification

- Unit/integration: `npx vitest run src/game/live/m30Pace.test.ts`
- Browser workflow: `npx playwright test e2e/m30-pace-history.e2e.ts e2e/m29-pace-operations.e2e.ts`
- Full gates: `npm run lint && npm run test:ci && npm run build`
- Long-running gates: `npm run test:balance`, `npm run test:soak`,
  `npm run test:perf`, and `npm run test:pwa`

The browser fixture contains two courses and ten deterministic history samples
so identity, bottleneck focus, period selection, and course switching can be
reviewed without relying on timing-sensitive simulation playback.
