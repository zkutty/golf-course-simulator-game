# Relaxed golfer presentation contract

ZK-1414 subpacket A, contract version 2. This is a **staging proposal** for
ordinary LIVE golfers, explicit follow, and controlled rounds. Technical
acceptance of its interface is separate from human acceptance of art. No new
production art, runtime integration, or human art approval is asserted here.

The machine-readable source is
[`activity-contract.json`](../art/golfer-lookdev/activity-contract.json).
[`validate-contract.mjs`](../art/golfer-lookdev/validate-contract.mjs) validates
the manifest and example adapter publications without importing the game. The
independent [lookdev prototype](../art/golfer-lookdev/index.html) is original
vector/canvas exploration. Its synthetic choreography is a **non-shipping
storyboard**: it is not a full-hole simulation, a route, retained shot evidence,
proof of gameplay timing, or approved production art.

## Existing compatibility

The current sources of truth remain `src/game/render/golferSprites.ts`,
`golferGrounding.ts`, `src/ui/renderer/scenes/liveEntitiesScene.ts`, and the
[Art Guide](../ART_GUIDE.md). Contract v2 preserves the following v1 carrier:

| Property | Preserved value |
| --- | --- |
| Frame canvas | 48 × 72 source pixels |
| Feet | (24, 69); sprite anchor `(0.5, 69 / 72)` |
| Display width | 26 world pixels at zoom 1 |
| Layers | base skin/pants/shoes/club; grayscale tint twin for shirt/hat |
| Authored rows | 0–4 = s, sw, w, nw, n |
| Runtime mirrors | se ← sw; e ← w; ne ← nw |
| Walk / idle | 6 / 2 frames; facing octant |
| Swing | 8 frames; target octant; contact frame 5 |
| Putt | 4 frames; target octant; contact frame 2 |
| Cheer / mad | 4 frames each; one south-facing row |

One actor retains one holder and one separate contact shadow child. Feet,
shadow, and depth use the same continuous surface sample at `(x + 0.5, y +
0.5)` through `groundedGolferFrame`; neither a pose nor a clip changes the
actor's root. Walk stride advances from observed authoritative displacement, never time
alone. Stop stride when position stops. No character root motion, invented
walk route, or new world effect is permitted.

Legacy full-swing art bakes a club into the body and authors a right-handed
stance. Mirroring changes its apparent hand. Therefore a legacy frame reports
`renderedEquipmentClass: null`, `renderedHandedness: null`, and `degraded: true`.
It cannot certify an exact club or a consistent handedness.

New optional clips are specifications, currently `not-authored`: settle 4f,
address 2f, watch 2f, positive reaction 4f, negative reaction 4f. Each uses eight
explicit directions `[e, se, s, sw, w, nw, n, ne]` and no mirroring. Future art
must supply an explicit right/left variant and an exact requested equipment
class (`none`, `driver`, `iron`, `wedge`, `putter`). Input facts that authority
does not expose remain `null`. Do not infer Driver from `swing`, infer hand from
camera direction, or assign a guessed bag or club. Missing exact art falls
back to the existing unverified legacy frame. This schema rejects publication
of optional art while it is marked un-authored; introducing reviewed art needs
an explicit manifest/schema change. It does not need a replacement legacy atlas.

## One clock and a finite activity budget

The accepted pacing reference was read from
`git show c08a5ff:simgolf-lite/docs/readable-shot-pacing.md`. That commit's
shared clock is **not present on base 5729faf**. These staging files neither
cherry-pick it nor claim that it is deployed. A future adapter must consume
`shared-shot-pacing-v1`, rather than copy this review calculator into a second
runtime timer.

| Shared phase | Full swing | Putt |
| --- | --- | --- |
| Entire shot | `6000 + min(400, yards) * 10` ms | `2400 + min(40, yards) * 45` ms |
| Address, including settle and backswing | 1000 ms | 500 ms |
| Contact animation | 200 ms | 150 ms |
| Existing retained movement | remainder: 3900–7900 ms | remainder: 1100–2900 ms |
| Endpoint rest | 900 ms | 650 ms |
| Total envelope | 6–10 seconds | 2.4–4.2 seconds |

Distance is retained carry plus roll yards. Body phases only subdivide or
overlap these intervals; they never add gameplay seconds or independent dwell:

1. **Walk** uses the actual walking authority before acquisition.
2. **Settle** occupies the first 250 ms swing / 150 ms putt of address.
3. **Address** quietly holds for 300 ms swing / 200 ms putt.
4. **Backswing** occupies the last 450 ms swing / 150 ms putt of address.
5. **Contact** uses the shared contact animation window. Contact frame 5 / 2
   lands at its end, exactly when retained motion begins. The preceding frame
   stays before contact; a replacement must not move the launch event.
6. **Follow** overlaps the first 300 ms swing / 150 ms putt of retained movement.
7. **Watch** uses the rest of retained flight/roll, then the first 300 ms swing /
   200 ms putt of endpoint rest. Retained first-contact and collision ratios
   remain unchanged. A ground-only putt goes directly to roll.
8. **Reaction** reserves at most 450 ms swing / 300 ms putt of the same rest.
   This active policy is a quiet static final-pose cue, **not a compressed
   four-frame cheer/mad cycle**. It requires an already revealed authoritative
   outcome signal; otherwise keep watching. A result may never be predicted
   from a partially shown path.
9. **Watch/release** uses the final 150 ms rest. **Walk-on** starts only when
   walking authority actually advances, after the existing owner completes.

The graph is observational, not a scheduler. A cancellation may discard any
node. It never walks an actor through the graph to manufacture missing play.
Optional reaction bypasses to walk-on. `activityWindows` partitions each
accepted total for technical review; it does not resolve or sample a ball.

The current renderer separately uses `REACTION_SEC = 1.6` and lets reactions
override other poses. This packet does not change that implementation. A future
adapter must replace that independent override with the shared budget policy;
adding it after shared rest would violate this contract.

### Expressive reaction proposal requiring review

A relaxed 1.2–2.4 second gesture cannot fit inside the current 900/650 ms rest.
It is inactive in the manifest. A 1.5-second storyboard gesture illustrates this
future proposal, not the active policy. Review may choose either:

- Reallocate the existing total shot budget between retained movement and rest,
  preserving the 6–10 / 2.4–4.2 second totals and normalized retained geometry.
  This changes shared pacing and needs timing and integration review.
- Permit one optional real-time outcome dwell, capped at 2400 ms per acquired
  shot, with **zero gameplay-minute debit**, no pending queue, and the existing
  shared caller retaining sole completion ownership. It must hold the same
  authority, respect pause/hidden/skip, and never stack with an old reaction
  timer. This would explicitly extend total presentation time and requires a
  new reviewed policy version.

Neither alternative is activated here. Active additional presentation dwell
and additional gameplay time are both zero. Human review should judge whether
quiet outcome poses meet the desired feel before selecting a richer gesture.

## Foreground, overview, and fast-forward

Explicit follow or a controlled round may consume the accepted shared shot
clock. Its existing caller owns acquisition, authority hold/drain, cancellation,
and once-only completion. The visual adapter has no completion claim. Merely
selecting a golfer or showing the overview cannot hold the operating day.

Every visible golfer receives an honest pose. Overview may consume an already
available shared frame only for its exact current owner; it never creates a
per-actor timer, backlog, or simulated shot. When the operating clock runs
faster than readable playback, discard expired visual activities and show the
stable pose at the newest authoritative root. In this policy maximum added
visual lag is **0 ms relative to the latest validated authority snapshot**.
That is not a claim about snapshot transport latency or frame rate.

The fallback uses idle frame 0 while stationary, or the legacy walk clip driven
only by current authoritative distance when walking. No stale render actor is
retained to run faster, replay missed shots, invent a route, or teleport along a
fabricated catch-up path. Authority itself may advance between snapshots;
displaying its actual current position is an authority refresh, not a narrated
journey. This explicitly trades omitted transitions at fast-forward for truth.

Hidden frames hold both clocks and discard background wall time, including
skip. Reset the frame timestamp on visibility changes. Pause holds; visible
explicit skip may complete through the existing shared caller. Automatic
reduced-motion skip honors pause. Reduced motion uses stable poses and no
independent reaction cycling. No catch-up debt accumulates on return.

## Ownership, retention, and adapter interface

An owner contains `{scopeId, actorId, shot}`. `shot` is null outside a retained
shot, otherwise it contains exactly `{shotId, holeId, shotNumber, seed, club,
style, modelVersion}`. The key is a JSON tuple in that order after scope and
actor, not concatenated strings. A no-shot key is `[scopeId, actorId, null]`.
Scope includes actual run/session or round, actor/participant, day/round epoch,
and reconciliation epoch. Compare the complete current owner before publishing
a body frame or handling completion. A day/round replacement, changed actor,
changed shot field, missing actor, or reconciliation discards the old record
before any frame, sound, reaction, or completion can escape.

The staging cap is **128 activity records**, one per exact scope/actor, one
retained current shot per record, one foreground shot total, **zero pending
shots**, and 10000 active visible ms maximum retention. Hidden/paused wall time
does not age an acquired presentation. Completion/cancellation removes a record
in the same publication turn; owner invalidation removes it immediately.
Do not retain history, routes, frame queues, or event queues. Overflow actors
still render through the current-authority legacy fallback without an activity
record. This is an activity-memory proposal, not a limit on simulated golfers
or a claim about the current Pixi pool. Body holders and contact shadows stay
one per actor; grounding adds zero world effects.

All carriers require exact keys and plain finite JSON. The validator exports:

| Export | Purpose |
| --- | --- |
| `validateContract(value)` | Manifest shape, clip compatibility/fallbacks, graph reachability, timings, caps, ownership policy; returns error strings. |
| `activityOwnerKey(owner)` | Validated full tuple key, or null. |
| `activityWindows(contract, kind, yards)` | Pure proposed subdivisions, or null; no clock advancement. |
| `validateActivityFrame(contract, input, output)` | Validates a proposed publication as a pair; returns error strings. |
| `validateActivityTransition(contract, previous, next, request)` | Checks same-owner hold/skip, 100 ms frame-delta cap, and immutable shared plan. |
| `validateActivityRetention(contract, records)` | Checks bounded records, exact actor uniqueness, age, and foreground cap. |

Input requires `{version:2, mode, owner, currentOwner, authority, clock,
visibility}`. Authority contains root `{x,y,elevation}`, segment
`walk|pause|flight|null`, segment progress `[0,1]`, distinct facing and nullable
target octants `0..7`, walking evidence or null, shot kind
`swing|putt|null`, equipment class/handedness or null, and revealed reaction
`positive|negative|null`. It is not a ball position or a second route.

Facing and target are separate: `facingOctant` is the actual body/walk direction;
`targetOctant` is the retained shot's target direction or null. Swing/putt and
target-keyed optional clips use the target, never the facing octant. If the target
is unknown, publish stable idle frame 0 facing the known body direction, even
while the shared clock proceeds. Do not fabricate a correct-looking stance.

Walking evidence is `walk: {segmentId, distanceTiles}` or null. The segment id
must identify the actual observed walking segment. Distance starts at zero on
first observation, then accumulates horizontal displacement between consecutive
authoritative roots for that same segment. The frame is exactly
`floor(distanceTiles * 1.35 * 6) % 6`. A new segment resets to zero; unchanged
roots cannot advance stride. Missing segment evidence uses stable idle frame 0.
This accumulator is presentation-only, not a route or a simulation write.
While advancing, reduced motion publishes stable idle frame 0. Pause/hidden
frames retain the previous body pose, including when reduced motion is toggled
in either direction. A held backswing may therefore remain frozen; a held idle
fallback remains idle until playback resumes. Transition validation rejects
animation, root movement, or clock advancement while held.

Clock is null for overview fallback; otherwise it is a sample supplied by the
shared caller with exactly `{provider, key, kind, distanceYards, elapsedMs,
durationMs, phase, motionProgress, firstContactT, held}`. `firstContactT` comes
from the validated retained plan. Visibility contains hidden/paused/reducedMotion
booleans. A transition request has exactly `{deltaMs, explicitSkip,
reducedMotionSkip}`; previous and next packets each contain `{input, output}`.
Changed owners represent external acquisition/cancellation, so the transition
guard does not manufacture elapsed time between them. `held` reports a held
sample, including a completed sample held after a visible explicit skip.

Output requires `{version:2, ownerKey, activity, clipId, frame, root, feetPx,
renderedEquipmentClass, renderedHandedness, source, degraded,
completionClaim:false}`. Frame is `{row,col,mirror}`. Root must equal the exact
input authority root, feet must equal `(24,69)`, and source is `shared-clock` or
`current-authority`. No ball coordinate, gameplay mutation, effect allocation,
RNG request, score, economy debit, or alternate completion owner is an output.
Invalid input/output is rejected as a whole without publication. These guards
cannot certify the provenance of a caller's authority; the adapter must receive
validated retained evidence and trusted current snapshots.

## Verification, acceptance, and rollback

From `simgolf-lite`, run:

```sh
node art/golfer-lookdev/validate-contract.mjs
node --test art/golfer-lookdev/validate-contract.test.mjs
```

Focused tests exercise both timing extremes and all phase boundaries, invalid
JSON, changed contacts/anchors, incompatible fallback and graph mutations,
each owner field, tuple collisions, stale roots, unrevealed outcomes, false
handedness/equipment claims, hidden/pause/skip and frame-cap transitions, and
retention overflow. They are technical contract checks, not visual acceptance.

Later runtime acceptance still needs existing shared-clock integration,
foreground versus selected/overview behavior, exact body/ball ownership,
same-frame cancellation, hidden-tab resets, cap overflow, all camera rotations,
normal/reduced motion, and all LIVE speed tiers. Verify simulation RNG, saved
physics/score goldens, operating-day and economy results remain unchanged. Human
art review remains pending for silhouette, grounded feet, palette, club contact,
handedness, cadence, and normal-scale legibility before bulk production.

This packet changes documentation and staging files only. Roll back its scoped
files and the additive Art Guide link; no save migration, production source,
physics, renderer, atlas, package, workflow, budget, or golden needs reverting.
