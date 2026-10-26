# ZK-1414 visual review checkpoints

## Study 02 — natural adult proportions, October 26, 2026

The user requested “Make the people more detailed and less cartoon-like.”
Study 01 below was not visually approved. Its exact checkpoint `e6e4814` was
subsequently published to `codex/relaxed-golfers-lookdev` with the user's
explicit approval; remote readback matched. This revision preserves that history.

Study 02 uses a 6.41-head adult figure, smaller hands and shoes, longer articulated
legs, fitted clothing, a shaped face/cap and more detailed equipment. All four
sample identities share the revised anatomy. The gameplay size sheet remains
13/26/52px in source-frame width; fine facial detail is inspection-only at these
sizes. The 54-second synthetic storyboard and frozen activity contract are
unchanged. No production art or gameplay integration is included.

Final focused checks: **34 passed, 0 failed**, manifest valid with 11 clips,
and `git diff --check` clean. An independent review found two real rig defects
in the initial revision: collapsing upper arms and a telescoping club. One
bounded correction replaced those with fixed-length two-bone arms and one rigid
club with an ordered, collinear two-handed grip. A subsequent viewer-only fix
fits every sampled action into one stable inspector scale and anchor, without
changing the ordinary gameplay scale. Conservative bounds include actual
rendered paths, all eight views/actions/responses and both motion settings.
Production frame clipping remains a later export check.
Independent Sol 6.1 xhigh re-review accepted the frozen revision with no
actionable findings and independently reproduced all 34 passing tests.

The coordinator inspected visible playback, putt/phase jumps, operating-tier,
view, response and reduced-motion controls, then checked the complete backswing
and normal-scale group in the rebuilt page. The inspected browser warning/error
log was empty. Revised screenshots are separate from the retained Study 01
image. These checks do not establish human visual acceptance or runtime quality.

**Human review of Study 02 remains pending.** Keep ZK-1414 In Review and the
downstream production packets unstarted until the planned visual decision.

## Study 01 — first review checkpoint

October 26, 2026. Base: `5729faf7a17dcb2c5e12c27422a8b1590d59f4d0`.
Scope: non-shipping look development and a staging presentation contract.
**Human look-and-motion acceptance remains pending.**

## Delivered

- Original projected Canvas character study, eight right-handed views, a
  normal-scale pose sheet and 13/26/52px frame-width comparisons.
- One 54-second synthetic group storyboard with walking, address, swing,
  watching, finite positive/negative responses, putting and walk-off.
- Self-contained interactive HTML with pause, scrub, phase jumps, zoom,
  operating-tier comparison and a secondary-motion control.
- Versioned strict activity/clip manifest and publication/transition guards.
  Legacy contact indices, feet, dimensions and rows remain compatibility inputs.

The picture is a proposed look and rhythm, not a recorded game round. Current
shared pacing is referenced from `c08a5ff`; it was not cherry-picked. Longer
gestures are prospective V2 timing, not proof they fit active V1 rest budgets.
No runtime source, production atlas, save, physics, economy, workflow or budget
was changed. Final art and production integration have not started.

## Verification

From the repository root:

```sh
node simgolf-lite/art/golfer-lookdev/validate-contract.mjs
node --test simgolf-lite/art/golfer-lookdev/prototype.test.mjs simgolf-lite/art/golfer-lookdev/validate-contract.test.mjs
git diff --check
```

Final focused result: **27 passed, 0 failed** (9 prototype, 18 contract).
Manifest validation passes with 11 clips and art approval explicitly pending.
The independent Sol 6.1 xhigh review reports no remaining actionable findings.

Review corrections cover early contact under another phase, separate facing
and target directions, stationary/distance-driven gait, wrapper accessors and
paused pose safety. One post-freeze correction fixed reduced-motion toggles
while paused; regression cases preserve pose, root, clock and owner through
both toggle directions. The earlier draft run had 21/22 passing tests; its
contact-boundary fixture failure was corrected before acceptance. Failures were
not relabeled as passing evidence.

Parent browser checks used the local Codex in-app browser at the default
1280x720 viewport, plus a temporary 390x844 responsive check that was reset.
Verified visible playback/pause, phase jumps that pause, operating-tier and
response selection, and an accessible reduced-motion control with no horizontal
overflow at 390px. No browser warning/error was observed in the inspected log.
The generated contract link resolves within the standalone review directory.
Screenshots retain actual normal-scale and enlarged-inspection labels.

These are review-tool checks. They do not certify actual engine motion,
retained flight integration, a real full hole, atlas export, 100-golfer
performance, a named GPU or human quality acceptance. No full application
build/release suite was run for these unimported staging files.

## Ownership and next gate

- Contract/validator: Sol 6.1 xhigh, bounded packet A.
- Original character/review prototype: Sol 6.1 high, bounded packet B.
- Independent technical review: Sol 6.1 xhigh; one correction after freeze.
- Coordinator: integration, focused checks, browser review and Linear evidence.

Review the actual silhouette, size, stance, gestures and proposed rhythm before
final character production. The prepared Linear plan keeps ZK-1414 in review
and downstream production packets open. A visual choice is not a claim that
the feature is integrated or released. The existing startup repair is excluded.

Rollback is removal/reversion of this scoped staging checkpoint and its Art
Guide link; no gameplay migration or recovery is needed.
