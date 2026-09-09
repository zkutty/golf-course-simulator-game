# ZK-1108 shot truth and adapter boundary

Base: `origin/develop` at `4ddc7af0a6014ab73cedb6e6dea42c7b026049af`.

## Authority map

| Stage | Authority | Consumer rule |
| --- | --- | --- |
| Club/carry/dispersion defaults | `rules/dispersionRegistry.ts` (ZK-772 Wave 0) | Consume IDs, labels and defaults; retain established modifiers. |
| Golfer intent | `strategicOptions` + frozen capabilities/course snapshot | A candidate's target/expected score is an intention, not a promised result. |
| Candidate preview | Existing fixed-seed planning solve | `previewSeed` is a planning sample. M47 commits using its existing RNG stream; never equate a candidate seed with that committed seed. |
| Committed physical result | `resolvePlayableShot`, adapted by `resolveLiveShot` | Resolve once from the frozen inputs. `previewLiveShot` remains a compatibility alias and is equal only for identical complete inputs/seed. |
| Ground physics | Retained `greenRollout` | Read recorded landing/path/physical rest. Do not rerun rollout against today's course. |
| Rules/relief | Retained `sharedOutcome` | Its ruling and final position take precedence over legacy mirrors. A drop is not ball flight. |
| Score / reaction | `committedShotStrokeCost` + existing `evaluateHoleReaction` | One played stroke + committed penalty + retained automatic putts. Reaction still consumes the actual committed outcomes, plan and condition. |
| Preview receipt | `invitedPreviewShot` | Preserve v1 bytes exactly. `rest` is the clamped/rounded next lie; it does **not** promise physical rest. |
| Telemetry / replay / render contract | `projectCommittedShot` | Frozen detached derived projection, no save schema, clock, course, locale or RNG input. |
| Animation adapter | `committedShotGroundPosition` | Read-only sampling of recorded geometry; stop at physical rest, never roll toward relief. No physical path on legacy traces means `null`, not invented geometry. |
| Accessible labels | `shotTruthCues` | Existing typed English/pseudo catalog; text-equivalent ruling/penalty/position/schematic cues. Locale cannot modify the result. |
| Current selected-golfer channel | `currentShotEvidence` + saved simulation itinerary cursor | Exactly one intent/result/reaction/unavailable channel in inspector and telemetry. No whole-round tail fallback. |

## Position distinctions

`landing` is first ground contact. `physicalRest` is the end of physical travel.
`finalPosition` is the rules result after relief. `nextLiePosition` is the
historical clamped/rounded `trace.rest` used by the next-shot loop. These can
all differ. Legacy invited receipts retain only origin, landing and next lie;
they are adequate for schematic review but cannot reconstruct physical flight.

Automatic putting retains a count, not individual putt trajectories. Neither
the projection nor replay should invent authoritative per-putt paths. Existing
M47 cosmetic putting segments are explicitly presentation-only.

## ZK-772 cross-check and readiness

The registry was introduced by `4001244` and is unchanged between this base
and production ref `f472d6e01143d097bdbdf940bf79c1bc40d77927`. It owns eight
canonical clubs and the reference-plan compatibility adapters. No constants,
sampler, dispersion distribution, rounding or random draw order changed here.

Ready now: non-persisted full-outcome projection, exact legacy invited receipt
adapter, shared score/reaction cost, pure ground-path sampling and localized
text cues. Consumers with a validated current `LiveShotOutcome` or compatible
`PlayerShotTrace` can project it directly; persistence validators remain the
untrusted-input boundary. Returned projections are not accepted as new inputs
to physics or scoring.

Not claimed here: renderer migration, moving existing M47 flight endpoints,
replacing cosmetic `ballFlightPose`, new save fields, or retroactive
reconstruction of old invited-preview receipts. `RenderSnapshot` scene ownership
and revisions remain unchanged; a future renderer adapter must consume the
projection without treating animation progress, camera, effects or locale as
authority. The selected golfer inspector mounts one localized, labelled live
region; telemetry exposes the same discriminated channel. Existing compatibility
ruling/outcome keys are null until an observed result is selected. The opening
schematic legend remains truthful.

## Current-shot compatibility association

Existing saves have an itinerary cursor but no flight-to-outcome ID. The selector
therefore joins the cursor-selected flight using hole identity and exact retained
origin, endpoint, landing and complete rollout-path equality, requiring one unique
match. This is a compatibility association, not a first-class identity link.
Missing, malformed, duplicate or ambiguous evidence is unavailable. No geometry
tolerance, nearest match, RNG replay or last-array-element fallback is used.
Intent takes priority while addressing/in flight; only a crossed identified
flight supplies a result. A reaction requires a scored crossed-hole boundary
and the unique matching reaction. Newer stroke evidence outranks old reactions.
Automatic putt phases without individual evidence remain unavailable; render-only
`Segment.shot` never selects evidence. The future boundary is an explicit
non-persisted observation link supplied by the simulation, with a separate
compatibility decision for historical saves; this packet adds no save field.

Supported flight coverage is normal (straight-intent), standard/high/low;
the existing seeded lateral miss is retained, not rebalanced. Rollout and
obstacle/penalty/relief cues carry retained facts, never reconstructed physics.
The single-channel, null-compatibility, hostile-metadata, JSON legacy/new restart
and actual live-action save/reload assertions cover the adapter boundary.

## Verification

Focused tests cover fixed-input preview/commit equality, JSON replay, immutability,
canonical registry identity, exact invited v1 compatibility, bent roll vs relief,
putt/start/end/clamped progress, unavailable legacy geometry, and pseudo-localized
text without authoritative mutation. Existing M47/M66/M69 suites, TypeScript,
lint, build and browser evidence are recorded in `progress.md`.
