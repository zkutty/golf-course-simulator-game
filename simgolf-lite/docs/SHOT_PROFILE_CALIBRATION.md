# Shot profile calibration version 1

`profileCalibration.ts` provides a bounded CourseCraft distance template. New rounds can capture `freezeProfileCalibration(roundStartSkills)` and retain its complete club map. The template is derived from a public driver **total** regression and explicit game assumptions. Its carry outputs are model values, not measured public carry observations.

## Source and limits

[USGA, *Quantitative Analysis of Recreational Golfer Club Hitting Distances: Measured versus Perception*, December 1, 2023](https://www.usga.org/content/dam/usga/images/course-care/GolferExperience/DI_Golfer_Performance_Measurement%202023%20Update.pdf), page 3, Figure 2, reports the male-sample relationship `total driver yards = 265.32 − 3.02 × Handicap Index`, with R² .57. “Ability” is the median of seven shots. The study covered 2021–2023; 627 participants included 548 males and 79 females. Its separate regressions and demographic composition do not support applying the male relationship equally to all genders or ages. This implementation uses the male regression as a disclosed amplitude reference for a neutral game scenario. Identity names and appearance never select a cohort.

The first-party indexed PDF text and Figure 2 annotation were checked on October 21, 2026; direct PDF retrieval returned HTTP 403. The [public benchmark corpus](SHOT_DISTANCE_SOURCES.md) retains its original observations separately. Arccos median and Shot Scope performance-average distances have unspecified carry status. They are not imported as carry, combined with the USGA regression, or substituted for its metric.

## Separate strength and control

Power is a strength trait on a bounded 0–100 axis. The explicit CourseCraft population assumption maps `power = 100 × (1 − h/28)` for `h` between 0 and 28. This is a conservative projection domain chosen for the game, not a statement about the source sample range. Along the neutral calibration population, all six traits share the same value; it creates reviewable synthetic cases and does not establish a scoring or demographic population fit.

Actual players retain independent traits. Carry uses power only. The diagnostic `abilityHandicapAnchor` uses `28 × (1 − control/100)`, where control is 25% driving, 30% irons, 20% short game, 20% putting, and 5% recovery. These weights are game assumptions. The diagnostic is independent of mutable official handicap state and never updates it. Power 20/control 95 therefore permits a shorter, accurate player; power 90/control 20 permits a longer, inconsistent player. Existing accuracy, strike, consistency, lie and confidence authorities remain separate. Confidence cannot rewrite this carry map.

Callers may explicitly supply `driverTotalOffsetYards` between −40 and +40 to define another scenario. This shifts the distance axis before the declared club ratios; it is not a measured demographic adjustment. Zero is the version 1 default. Establishing a different population fit requires direct evidence and a new documented calibration, rather than assigning an offset from a name, age or gender.

## Reference physics and frozen output

The offline harness in `profileCalibration.test.ts` inverts `target total = candidate carry + resolveGreenRollout(candidate landing).rollYards` by 20 bounded bisection steps. It supplies the complete `ClubImpactV1` exactly once. The runtime module imports neither the ground solver nor the benchmark corpus; it interpolates a frozen four-point carry curve. No solver runs per shot or frame.

The fixed reference course is 128 × 16 fairway tiles, 10 yards per tile, zero elevation and slope, and a balanced green program. The hole identifier is `profile-reference`, its nominal green point is (126, 8), and all tiles remain fairway. Landing is `(2 + candidateCarry/10, 8)` with direction (1, 0). Reference state has health 1, moisture .58, compaction/wear/traffic 0, clear weather, zero rain, drainage 1 and seed 1396. There is no wind or elevation adjustment. Shot selection uses driver from tee, straight/run, standard flight, full effort 1, strike quality 1, equipment spin multiplier 1, and short-game/recovery 50.

For this particular reference, `ClubImpactV1` yields forward roll potential 24.285 yards and the actual fairway solver yields 24.3 yards, with 40 integration steps and no workload cap. This is a conditional solver result. It is not a universal roll allowance: the test separately verifies different roll for a wedge and a partial driver. Surface, slope, club, effort and impact still determine live rollout. Real play can therefore finish at a different total than the calibration reference.

| Reference coordinate h | Source regression total yd | Derived driver carry yd |
| --- | ---: | ---: |
| 0 | 265.32 | 241.02 |
| 10 | 235.12 | 210.82 |
| 20 | 204.92 | 180.62 |
| 28 | 180.76 | 156.46 |

The existing registry's full carry values are not used as public measurements or calibration targets. Non-driver full carries use these explicit loft/gapping assumptions relative to derived driver carry: 3-wood .86, 5-iron .70, 7-iron .61, pitching wedge .47, sand wedge .34, chip .14. These are provisional design ratios, not source-extracted iron or wedge carry fits. Putter airborne carry is zero; its existing stroke-distance budget and putting resolver must bypass this carry API.

Use the frozen full carry as the new-model base, then apply selected effort, style, lie, equipment, weather and performance once through their existing owners. Do not multiply by legacy `.82 + power/500` again. The resulting impact goes once to the ground solver. A round snapshot without `distanceProfile` keeps its historical model; profile capture does not migrate previous rounds or retained shot facts.

## Acceptance tolerances and unsupported fields

Tolerances were declared before final verification: source equation anchors ≤.01 yard error; carry plus real reference rollout ≤.15 yard total error; persisted carry rounding ≤.000001 yard; unspecified-distance cross-check ≤35 yards. The last is deliberately a coarse magnitude check, not a carry-fit acceptance criterion.

The four driver reference points pass the .15-yard total check with zero error at reported precision. Six Arccos observations at scratch/10/20 are checked only against model reference totals for broad magnitude; their distance status remains `unspecified`. No claim of regression confidence intervals, per-cohort variance, or individual predictive accuracy follows from these checks. R² .57 is a source correlation statistic, not a guarantee for a golfer or a game shot.

Version 1 does **not** calibrate universal demographic carry, individual carry prediction, measured non-driver carry, dispersion, mishit tails, rollback, or official handicap prediction. Direct carry measurements and population-specific uncertainty are insufficient here; those claims remain on hold. The implementation is acceptable only as the bounded, explicitly assumed template described above.

`isProfileCalibrationV1` requires the exact version/model, exact six finite 0–100 skills, bounded explicit offset, exact eight-club mapping, finite nonnegative carries and reproducible values matching the frozen inputs. Unknown/missing fields, unsupported versions, NaN, infinity, changed carries and mismatched diagnostics fail validation without repairing persisted facts. Runtime finite skills outside the supported range clamp to the endpoints; nonfinite inputs throw. Captured objects and their nested skill/carry maps are frozen and JSON-safe.

## Planning consumers and preserved standards

Actual modern golfers share the frozen distance profile in Player Pro, live AI and participant/team adapters. `plannerClubProjection.ts` projects that same map into actual-golfer AI evaluation profiles, green reachability, club/effort selection, recovery range and green candidate carry utilization. Projection preserves existing dispersion and risk multipliers and does not apply another power trait scale. Putting keeps its separately owned stroke-distance budget. An absent shot-model carrier retains historical planning.

Architecture's tee-based neutral reference population is a separate established design standard (`ARCHITECTURE_REFERENCE_CAPABILITIES`), not an actual golfer's calibrated carry prediction. Its existing reference route, runout conventions, rating profiles, and Auto-par policies remain unchanged. Static Scratch/Bogey solver profiles continue to own rating and Auto-par; this release does not re-fit those standards or claim that their historical carry tables are public measured carry. Any future reference-standard replacement requires its own explicit policy/version decision and architecture certification.
