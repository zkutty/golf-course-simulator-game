# First in-course adult golfer preview

October 26, 2026. Current local LIVE contact checkpoint `5e65ce8`, following
the reaction consumer `54b80b2` and pure physical-ball/visual-feet contract
`fc21698`. The approved Study 02 source checkpoint `aa5933d` is published.
The later implementation is local and is not deployed.

## Current supported shot and observed motion

The runtime now keeps retained physical ball B unchanged while independently
sampling supported visual ground G and stance feet F. A complete native G
frame must be presented, the existing bounded G-to-F adjustment must run, and
a subsequent actual F presentation must be acknowledged before gripping.
Body, tint and shadow share F minus G. No extra clock, route, hold or stroke
is introduced. M47 shot 1 remains neutral because its fixed-pose contact
residual exceeds the unchanged 0.5 logical pixel tolerance; shots 2 and 3 are
eligible under the actual current ground certificate.

Native Load restored the same 6:27 AM Avery Shot 3. A readonly browser trace
then observed settle, address, backswing, pre-launch contact phase,
follow-through and watch on the real shared cursor. Feet reached
(38.5598908333, 6.825971, 2.3552678593 yards) and stayed there through watch.
Pause held the final native watch frame at cursor 1700 ms. Physical ball
origin height stayed 2.5 yards; G stayed 2.4921190313 yards. The trace did not
sample the exact terminal impact instant, so its pre-launch contact-phase
screenshots are not exact-impact proof. Automated launch-minus/exact/plus
tests provide that separate timing check.

The capture used the restored wide camera; a separate close paused watch PNG
and an earlier close address PNG make the adult body readable. These sampled
stills and diagnostics do not constitute a continuous full-hole recording or
human motion acceptance. Browser console errors were empty. Atlas counts
remained 224 pairs, 272 cropped textures and two sources.

This three-file adapter passed eight suites / 489 tests in the coordinator
run, an independent four-suite / 340-test review with no P1/P2 findings, app
typecheck, scoped lint and staged whitespace checks. These overlapping sets
must not be summed. LIVE reaction consumption separately passed its final
102 runtime/scene tests after one correction; actual reaction motion still
needs review. Controlled bodies/reactions remain the next integration surface.

## Earlier first-idle checkpoint

The following first-preview evidence describes `8ac5bb1`, before the accepted
B/G/F runtime successor. It is preserved as checkpoint history.

## Verified slice

Development opt-in: `?m47Fixture=1&workspace=operate&naturalGolfers=1`.
Production activation remains off. One stable, known-right-handed LIVE pilot
uses the approved teal/cream adult model. Other actors keep their existing
appearance while consuming the bounded current activity policy.

The stage owns one lazy optional atlas. Complete base/tint/shadow pairs switch
atomically; the scene releases borrowers before disposal. Native source size
is 72×96, feet are (36,83), and body scale is 26/48. The atlas has 224 pairs,
272 unique cropped textures and two owned sources. Actual browser rendering
confirms the new model draws; these counts are not GPU memory telemetry.

Physical ball authority and current visual foot support remain distinct. An
unsupported physical stance can display native idle at independently supported
visual ground, with zero XY offset and no contact or plant proof. That neutral
presentation never becomes arrival evidence. Expiring the ten-second activity
record renews current native presentation without a one-frame legacy flash.

The existing ball/FX section is unchanged. This slice creates no route, shared
cursor, hold, score operation, RNG draw, audio event or gameplay settlement.

## Browser evidence

M47 Parkland, seed 12160, Avery C. actor 1, paused 6:27 AM, actual Shot 3 Driver.
Viewport: 1280×720 CSS pixels, DPR 2. Rotation: initial 0°.

A separate local slot, **Natural golfer visual checkpoint — M47 6:27**, was
created through the native Save interface and restored through native Load.
The same current golfer/shot returns with `primary.idle.nw.0`,
`footDomain: visual-neutral`, zero XY offset and no contact. Physical launch
height is 2.5 yards; visual ground is 2.492119031274844 yards.

Before/after screenshots at a visually matched close camera and diagnostic
JSON are preserved in the task's `relaxed-golfers/live-preview-01` artifact.
They demonstrate the adult appearance and neutral fallback. They do not certify
a continuous full hole, exact numeric camera settings, contact, motion quality,
device frame pacing or production readiness.

The DEV-only hidden `output[data-natural-golfer-diagnostics="v1"]` exposes
whitelisted readonly verification values. It updates imperatively, creates no
React frame state, and is removed on teardown.

## Automated checks

- Initial LIVE integration: nine suites, 224 tests passed.
- First bounded correction: runtime/scene, 45 tests passed independently and
  in the coordinator run.
- Final bounded correction: runtime/scene, 56 tests passed independently and
  in the coordinator run.
- Readonly reaction publication: initial eleven suites/150 tests; after its
  correction, 74 affected tests passed independently and in the coordinator
  run, including 48 source tests.
- App typecheck and staged whitespace checks pass. Scoped lint has no errors;
  App retains three pre-existing hook-dependency warnings.

These are overlapping runs, not an additive test total. Use Vitest's
`--configLoader runner --maxWorkers=1` with the readonly shared dependency
installation. Typecheck uses `--noEmit --incremental false -p tsconfig.app.json`.

## Remaining acceptance

Controlled bodies and reaction consumption, broader unsupported-lie coverage,
actual reaction motion review, group/camera staging and full-hole human review
remain separate gates. Bulk variants wait for that review.

The actual M47 geometry diagnosis finds shot 1 outside the unchanged 0.5-pixel
contact tolerance; shots 2 and 3 are geometrically eligible with independently
grounded feet. The pure successor was accepted in `fc21698` and its LIVE
adapter in `5e65ce8`. Unsupported shots must stay neutral.

At 1×, base travel is about 18.67 tiles/second, at least 422 logical pixels per
second, versus the 32-pixel readable gait cap. Current zero-lag overview policy
therefore uses current-authority fast-forward poses. Continuous watched walking
needs a separate pacing decision. No day-clock change is part of this slice.

Automatic putting retains a 1–3 count without individual physical putt paths.
ZK-1453 records the design gap while preserving the accepted quick/no-input
scoring flow. No individual-putt or physical hole-out evidence is fabricated.

Legacy plus candidate atlas coexistence exceeds the unchanged production family
budget. The optional DEV pilot is not a production budget pass. Full family
replacement/deduplication and release measurements remain open, including the
separately owned startup gate. No hosted CI, PR, upload or deployment is claimed.
