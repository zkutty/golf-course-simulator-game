# Golfer look development · study B

Open `index.html` directly in a browser, offline. It is self-contained: no server, network, build, fonts, libraries or production game assets are needed at review time. A local HTTP server also works. This is an original code-native Canvas 2D / projected part-model prototype, not shipping art.

The primary identity wears a cream cap, terracotta polo, cream trousers and low shoes. Three quieter partners use distinct skin, hair and clothing palettes. Broad shaped clothing, collar, cap brim, ears, cheek volume, a carry bag and two-handed equipment aim to read as small toy-like people. The course is an original simplified landscape, not a game fixture. Shadows are separate ground passes.

## Review controls

- Play/pause, replay, scrub, and phase buttons control one deterministic **54-second synthetic one-hole group storyboard**. Scrubbing and phase jumps pause the clock for inspection. All positions, trajectories, putting and outcomes are fabricated review samples. There is no simulation, score calculation, retained outcome, or recorded engine round.
- Operating tiers 1× / 2× / 4× are a presentation invariant demonstration only. They do not invoke an operation engine and never change the presentation clock.
- Gameplay zoom changes the displayed source-frame width to **13 / 26 / 52 CSS px** at **50 / 100 / 200%**. Source-frame coordinates follow the existing **48 × 72, feet (24, 69)** convention. Visible body width is smaller than source-frame width. The 210px inspector is explicitly **808%** of normal gameplay width. The contact sheet uses normal **26px frame width**. Eight angle thumbnails use **40px frame width**, labeled as enlarged review views.
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
node --test simgolf-lite/art/golfer-lookdev/prototype.test.mjs
```

`prototype.mjs` contains a deterministic pure model, the renderer and a guarded DOM entry point. `prototype.css` styles the review. `prototype.build.mjs` creates the self-contained `index.html` by embedding those sources and its static HTML. Rebuild after source changes. Tests verify clock boundaries, pause/replay, tier invariance, invalid input, projection/handedness, finite/reduced motion responses, path continuity, finite drawing across all views, absence of negative mirror transforms, and source synchronization with offline output. These are model/geometry tests, not visual acceptance.

## What this does not prove

- Continuous projected geometry explores richer silhouettes; it is **not a packed atlas**. It does not prove frame clipping, alpha cleanup, edge quality, layered tint, texture loading, camera rotation integration, visibility behind production props, performance with real crowds, or gameplay animation timing.
- The compatibility baseline remains **6 walk / 8 swing / 4 putt**, contact at swing frame 5 and putt frame 2. This study interpolates poses and does not replace or certify those source frames. Equipment may reach the conceptual frame edge; a production export must check every clipped frame, anchor and alpha before packing.
- Eight views are geometrically consistent explorations, not eight manually reviewed production rows. World projection is 2:1 dimetric and global highlights are placed upper-left, but each view still needs human lighting/occlusion/stance review.
- Only one primary new identity is developed. The three partner palettes demonstrate group legibility; they are not approved variants or coverage of all archetypes. Downstream production work must apply approved rendering and activity behavior to every golfer.
- No production code, textures or atlases are changed. No third-party characters, traced assets or generated raster images are used.

Human review must judge the **13/26/52px size sheet first**, then stance and club grip in all eight target views, foot planting, limb overlap, face/cap reading, quiet gesture tone, warm NW lighting and fit with real terrain. After look/timing approval, the next packet must make compatible production assets/integration and record a real full-hole group capture at all operating tiers. This synthetic study is not that acceptance evidence.
