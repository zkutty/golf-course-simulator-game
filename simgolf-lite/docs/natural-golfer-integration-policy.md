# Natural golfer integration policy v1

October 26, 2026. ZK-378 first-golfer assets and ZK-1416 foundation.
This is an explicit implementation reconciliation, not a replacement of either
immutable concept study or evidence of runtime certification.

## Consumed references

- User-approved adult anatomy and detail: `aa5933d8e13d61963dc22fd640d1c7d6a52134b3`,
  `art/golfer-lookdev/prototype.mjs`, 6.41-head proportions and rigid arm/club rig.
- Accepted quiet group/palette and activity contract: `dafbed52120603c9a2876ba01bf5cc3a827d58f0`,
  `art/review/zk-1414-v1/activity-manifest.v1.json` and its typed interface.
- Canonical shared pacing: `c08a5ff358dcbe874796b76cdaeae96a8fa94748`,
  `src/game/live/shotPacing.ts`. It is not integrated on base `5729faf`.
- The staged v2 contract contributes full JSON-tuple identity, hard retention
  limits and zero-added-lag overview behavior. Its different timing subdivisions
  and degraded known-hand strike fallback do not govern this policy.

Neither synthetic 51.64/54-second storyboard is a runtime clock. The user
approved the detailed adult direction and exact Study 02 checkpoint push; no
production atlas, full-hole runtime motion or release is certified by that choice.

## One clock and explicit subdivisions

Use the existing shared plan/cursor/frame. Never create a second body timer or
advance a cursor in the activity projector. Accepted v1 subdivisions apply:

| Kind | Settle | Address hold | Backswing | Contact window | Shared rest |
| --- | ---: | ---: | ---: | ---: | ---: |
| Swing | 600ms | 200ms | 200ms | 200ms | 900ms |
| Putt | 300ms | 100ms | 100ms | 150ms | 650ms |

Launch remains exactly at `addressMs + contactMs`; the terminal contact frame
must not appear before that boundary. Follow-through uses the first 300ms of
shared swing movement or 150ms of putt movement, then watch. A classified,
current-owner endpoint observation can permit one restrained static reaction
cue in the last 600ms of shared rest (after 300ms swing / 50ms putt). It cannot
add dwell, replay on reload/skip, or compress a long celebratory cycle. Reaction
eligibility/cooldown and group scheduling remain ZK-1419/1420 work. Longer V2
gestures remain inactive. Total presentation and gameplay time are unchanged.

## Authority, fallback and bounds

Full owner tuple: scope, actor, shot, hole, shot number, seed, club, style and
model version. Validate plan/cursor/frame/evidence against that same owner and
the current authority revision before publication. Keep facing separate from
shot target. Unknown hand/equipment/outcome stays null. A known hand without
a validated target/hand clip pair gets a neutral, non-gripping fallback;
never mirror a strike to change handedness. Legacy mirrored strikes are only
compatible with unspecified handedness and must be labeled unverified.

The pure boundary consumes authoritative root and legal current movement,
never reconstructs routes or ball trajectories, never writes gameplay/RNG,
and never emits settlement, hold, completion, audio or economy effects. Current
overview authority is immediate: zero extra lag, zero independent clocks and
zero pending shots. Selection alone does not acquire follow. Hidden/culled,
owner loss, epoch replacement and explicit skip discard stale choreography.
Paused valid output stays held, including during accessibility changes; owner
loss still invalidates before publication.

Limits: 128 activity records, one activity/retained shot per actor, one global
foreground shot, zero pending shots, maximum 10-second activity retention.
Quality choreography caps are high 16 / medium 8 / low 4, with reaction caps
2 / 1 / 0. Motion-off uses static current poses and no secondary motion or
reaction. Overflow uses current-authority fallback without an activity record.
No full-course hold, historical animation debt or invented walk is permitted.

## First production asset boundary

Produce one additive, versioned golfer atlas from the approved adult model;
preserve the legacy atlas and all three variant identities. Existing 6/2/8/4
walk/idle/swing/putt columns and contact indices 5/2 remain compatibility inputs.
Declare actual source size, feet, display scale, layers, target/facing semantics,
eight authored anatomical views, right-hand coverage and unsupported-hand
fallback. Transparent padding or trimming must preserve normal body size and
ground anchor; never shrink the person or change scale per pose to fit a club.
Record clipping, alpha, layered occlusion, packed/decoded bytes and provenance.
Do not load an atlas or expand variants before its own integration gate.

## Execution boundary

The first ZK-1416 subpacket is a pure projector and bounded presentation state
with deterministic tests. Runtime wiring remains open until the canonical
pacing/hold/drain/controlled-time baseline is reconciled; do not recreate that
authority in the projector. Shared scene, App, RenderSnapshot and atlas-loader
integration have one later serial owner. ZK-378 remains open for its wider art
scope. Bulk variants wait for the first real full-hole review under ZK-1421.
