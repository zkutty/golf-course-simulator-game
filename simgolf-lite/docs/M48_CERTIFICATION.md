# M48 Strategic Hole Architecture & Design Feedback

M48 replaces universal difficulty-as-quality with deterministic, cohort-aware design evidence. The analysis sits on top of the M46/M47 geometry and shared shot contracts, so it can explain safe routes, optional carries, skill-specific advantages, and recovery rather than inventing a second physics model.

## Delivered contracts

| Area | Implementation |
| --- | --- |
| Cohort evaluation | `src/game/architecture/strategic.ts` evaluates power, accuracy, short-game, recovery, and casual cohorts for each published tee/pin setup. |
| Structured evidence | Each hole returns option geometry, safe-surface viability, carry burden, bailout quality, hero reward, expected strokes, variance, recovery burden, and cohort deltas. |
| Portfolio scoring | `src/game/architecture/portfolio.ts` scores fairness, genuine choice, spectacle-with-mercy, opportunity rotation, and penalties for funnel greens, fake choices, mandatory carries, hazard spam, repetition, and one-cohort dominance. |
| Feedback | `src/game/architecture/recommendations.ts` ranks causal, location-anchored checks with cost, upkeep, confidence, affected cohorts, and sample status. |
| Architecture Review | Existing evidence overlays now include strategic options, advantage, bailouts, carry gates, and recovery zones, plus a per-hole cohort matrix. |
| Design loop | `src/game/architecture/comparison.ts` persists a no-economy design-test session, retains the before geometry version, refreshes after edits, and reports excluded cohorts and metric deltas. |
| Compatibility | M27 report components and older saves remain valid. M48 state is optional and normalized from malformed or absent save data. |

## Verification

- `npx tsc -p tsconfig.app.json --noEmit` — pass
- `npm test -- --run src/game/architecture/m48.test.ts` — pass
- `npm test -- --run src/game/architecture/architecture.test.ts src/game/livingClub/m38LivingClub.test.ts src/game/live/m47.test.ts src/utils/save.test.ts` — pass
- `npm test -- --run` — pass

The canonical M48 test fixture covers a safe bailout versus an unavoidable carry, deterministic cache reuse, incomplete editor states, differentiated cohort opportunities, portfolio/recommendation output, geometry-versioned before/after evidence, and no-economy design-test context.
