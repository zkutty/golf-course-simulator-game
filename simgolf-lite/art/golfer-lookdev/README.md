# Golfer look development · study C / Study 02

Open `index.html` directly in a browser, offline. It is self-contained: no server, network, build, fonts, libraries or production game assets are needed at review time. A local HTTP server also works. This is an original code-native Canvas 2D / projected part-model prototype, not shipping art.

**Study 02 · more natural proportions · human review pending.** This revision follows the user's direction to make people more detailed and less cartoon-like. It replaces the prior large-head silhouette with adult anatomy; it does not add decorative lines to the previous form. The user's explicit direction overrides the current 2.5-head art-guide target for this staged proposal only. The production renderer and frozen activity contract remain unchanged.

The primary identity wears a muted russet fitted polo, warm stone trousers and a small curved-visor cap. Three quieter partners use distinct subdued skin, hair and clothing palettes. The original model now uses a shaped skull, jaw and nose profile, ears and hairline, a narrow neck, sloped shoulders, tapered sleeves, a fitted curved torso, collar/placket, belted waist and small hands. Long thighs and calves meet at articulated knees and narrow ankles; the gait includes restrained heel/toe roll and at most 0.16 source-unit bob. Carry bags have scaled straps, pockets, thin shafts and generic clubheads. The course is an original simplified landscape, not a game fixture. Shadows remain separate ground passes.

## Reviewed dimensions and size tradeoff

The actual rendered skull profile is **10 source units high and at most 6.4 units wide**. Crown height with cap is **64.1 units above the sole**, giving a **6.41-head adult figure**. Shoulder span is 13, waist is at 33, hip at 31, knee at 16 and ankle at 2.2 source units. Hand radius is 0.95; shoe length is 5.1. `MODEL`, `HEAD_PROFILE` and the shared `skeletonFor` geometry make these review dimensions explicit. They are not a claim of medical or biomechanical accuracy.

At the unchanged 26px source-frame width, nominal figure height is about **34.7 CSS px** and skull height about **5.4px**. At 50% those are about 17.4px / 2.7px; at 200% about 69.4px / 10.8px. Fine face, collar, stitching, laces and equipment details therefore belong to the enlarged inspection; silhouette, longer legs, fitted clothing, gesture and grounded weight must do the work at normal scale. This intentionally trades the previous oversized face readability for more natural people. The smaller head and narrower body may need stronger local value separation after a real terrain integration review.

## Review controls

- Play/pause, replay, scrub, and phase buttons control one deterministic **54-second synthetic one-hole group storyboard**. Scrubbing and phase jumps pause the clock for inspection. All positions, trajectories, putting and outcomes are fabricated review samples. There is no simulation, score calculation, retained outcome, or recorded engine round.
- Operating tiers 1× / 2× / 4× are a presentation invariant demonstration only. They do not invoke an operation engine and never change the presentation clock.
- Gameplay zoom changes the displayed source-frame width to **13 / 26 / 52 CSS px** at **50 / 100 / 200%**. Source-frame coordinates follow the existing **48 × 72, feet (24, 69)** convention. Visible body width is smaller than source-frame width. The inspector uses one fixed whole-action camera: **169.6px source-frame display width / 652%** in its 270×350 logical viewport, with a fixed ground anchor and at least 12px padding. Its labels report the actual CSS-displayed width/percentage if the responsive layout scales the viewport down. This fits the complete review rig without animated zoom or camera jumps. The contact sheet uses normal **26px frame width**. Eight angle thumbnails use **40px frame width**, labeled as enlarged review views.
- Direction means facing for walking/idle/reactions, and shot **target** for address/swing/putt/watch. All eight octants rotate the same anatomical model. There is no negative scale / mirrored handedness. Every stroke is right-handed; no left-handed set is claimed.
- The outcome selector previews neutral, pleased, sigh, disappointed and exceptional gestures. They are brief, grounded, finite and return to rest. Partners stay quiet instead of repeating a group cheer.
- Reduced secondary motion follows the system preference initially, freezes gait sway/bounce and makes responses restrained static poses. Strokes and position progression stay visible for inspection. Pause/scrub provides complete still review; this does not certify the future game accessibility behavior.
- Leaving the browser tab pauses the review, preventing skipped unseen actions.

Deterministic capture links support `?t=13.26&direction=se&outcome=pleased&zoom=100` or `?phase=swing`. The bounded review hook `window.golferLookdev.snapshot()` returns the current review state; `window.golferLookdev.seek(13.26)` pauses at that sample. Neither hook touches game state.

## Timing distinction: proposed V2 rhythm, active V1 contract

The 54-second storyboard deliberately spends 4s in each set-up, 2s in the full-swing study, and 1.5s in each response. These are **prospective rhythm choices for human review**, not a demonstration of compliance with any engine segment budget.

Active V1 keeps responses as brief static cues inside its existing **900ms swing / 650ms putt rest** budgets. Address remains its existing 1000ms swing / 500ms putt budget; any settle or backswing subdivision must fit inside it. The longer visible gestures here require a separately approved V2. The study does not assert that its 54-second group story maps onto a valid production full hole or that the displayed sample flight is retained movement.

See the staged [presentation contract](../../docs/relaxed-golfer-presentation.md) and [manifest](activity-contract.json) for the separate contract packet. The prototype does not load or mutate those files.

## Source, build and validation

From the repository root:

```sh
node simgolf-lite/art/golfer-lookdev/prototype.build.mjs
node --test simgolf-lite/art/golfer-lookdev/prototype.test.mjs simgolf-lite/art/golfer-lookdev/validate-contract.test.mjs
```

`prototype.mjs` contains a deterministic pure model, the renderer and a guarded DOM entry point. `prototype.css` styles the review. `prototype.build.mjs` creates the self-contained `index.html` by embedding those sources and its static HTML. Rebuild after source changes. The focused command above passes **34 tests**: all 27 existing checks, two natural-proportion/gait checks, four arm/club regressions and one whole-action inspector-bounds check. Tests verify clocks, pause/replay, tiers, invalid input, handedness, reduced motion, path continuity, finite drawing, source synchronization, skull mesh dimensions, leg proportions and planted feet. The contract tests and contract files are unchanged. These are model/geometry tests, not visual acceptance.

The shared skeleton now solves actual **10.5-unit upper arms / 11-unit forearms** analytically, with continuous outward/anterior elbow choices along the reviewed paths. A single rigid club has a **30.0243-unit right-hand-to-head shaft** and **1.85-unit ordered grip spacing**; both hands derive from its axis. Any reach correction translates the entire grip/club together. The current reviewed motion samples need no such correction. Arm/club tests measure the returned and rendered joint/endpoints over whole motions, check fixed lengths and grip collinearity, exercise near-collinear/reach-limit inputs, and guard elbow continuity. Contact stays at synthetic swing progress 0.63 and source-space tip (7.6, 12, 1). These are kinematic consistency checks, not a biomechanics or production frame-clipping certification; the rigid club may extend beyond the conceptual source frame in inspection poses. The viewer now fits conservative bounds measured from the actual renderer paths (including stroke radii and curve control-point hulls), sampled across all eight views/actions/responses and both motion settings. The framing test checks actual projected rig endpoints, full drawn bounds and finite viewport coordinates; it does not certify a production 48×72 clipped export.

## What this does not prove

- Continuous projected geometry explores richer silhouettes; it is **not a packed atlas**. It does not prove frame clipping, alpha cleanup, edge quality, layered tint, texture loading, camera rotation integration, visibility behind production props, performance with real crowds, or gameplay animation timing.
- The compatibility baseline remains **6 walk / 8 swing / 4 putt**, contact at swing frame 5 and putt frame 2. This study interpolates poses and does not replace or certify those source frames. Equipment may reach the conceptual frame edge; a production export must check every clipped frame, anchor and alpha before packing.
- Eight views are geometrically consistent explorations, not eight manually reviewed production rows. World projection is 2:1 dimetric and global highlights are placed upper-left, but each view still needs human lighting/occlusion/stance review.
- Only one primary new identity is developed. The three partner palettes demonstrate group legibility; they are not approved variants or coverage of all archetypes. Downstream production work must apply approved rendering and activity behavior to every golfer.
- No production code, textures or atlases are changed. No third-party characters, traced assets or generated raster images are used.

Human review must judge the **13/26/52px size sheet first**, then stance and club grip in all eight target views, foot planting, limb overlap, face/cap reading, quiet gesture tone, warm NW lighting and fit with real terrain. After look/timing approval, the next packet must make compatible production assets/integration and record a real full-hole group capture at all operating tiers. This synthetic study is not that acceptance evidence.
