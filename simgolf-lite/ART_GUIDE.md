# CourseCraft Art Guide (the "look bible")

Target aesthetic: **original clean modern-isometric course builder** — warm,
landscaped, toy-like, and readable, with classic 2.5D composition principles
but no copied palettes, silhouettes, pixels, or traced assets. Every sprite
in the game (hand-painted, AI-generated, or procedural) must follow this
spec; if art matches these rules it will sit correctly in the scene with no
code changes.

## Projection & dimensions

- **2:1 dimetric ("isometric")**: a ground tile is a **64×32 px diamond**
  (`TILE_W`/`TILE_H` in `src/game/render/iso.ts`).
- One elevation step = **8 px** vertical (`ELEVATION_STEP_PX`).
- Terrain source art is authored at **@2× (128×64 px)** and displayed on the
  unchanged 64×32 logical projection. This preserves camera and picking math
  while remaining sharp on high-DPI screens.
- Objects stand on their tile with a **ground anchor at bottom-center**
  (sprites use anchor `(0.5, 1)` placed at the footprint's front corner —
  see `src/game/render/objectPlacement.ts`).
- Standard prop source canvas: **@2× 128×192 px** (1 logical tile wide).
  Legacy 64×96 placeholders remain valid only as development fallbacks.
  Buildings: 64 px per footprint tile of width, height as needed.
- Character canvas (M11): **48×72 px**, feet at bottom-center.

## Light

- Sun is **fixed NW** (upper-left), never rotates with the camera.
- Tops are lit; exposed-face pairs are theme-authored in
  `src/game/models/themes.ts` (parkland soil, links stone, desert sandstone).
- Drop shadows: soft ellipse at the base, offset **SE**, ~20% black.
- No long cast shadows in sprites — the shadow decal is separate.

## Style rules

1. **Chunky silhouettes.** An object must read at 50% zoom. If the outline
   is ambiguous at 32 px wide, simplify.
2. **1 px darker outline** on props and characters (darken the local color
   ~45%, don't use pure black).
3. **Hand-painted texture, subtle dither.** 2–4 value steps per surface;
   no smooth gradients larger than a tile; no lens effects, no bloom.
4. **Saturated but slightly dusty.** Aim for the palette below; avoid neon.
5. **No photorealism.** Proportions are toy-like: trees are lollipops with
   character, golfers are chibi (~2.5 heads tall).

## Palette anchors

Terrain colors are the single source of truth in `PixiStage.COLORS` — art
must harmonize with them (the M13 land themes tint from these anchors):

| name        | hex       | use                          |
|-------------|-----------|------------------------------|
| fairway     | `#4fa64f` | mown grass                   |
| rough       | `#2f7a36` | standard grass               |
| deep rough  | `#1f5f2c` | tall grass                   |
| sand        | `#d7c48a` | bunkers, washes              |
| water       | `#2b7bbb` | lakes, hazards               |
| green       | `#5dbb6a` | putting surfaces             |
| tee         | `#8b6b4f` | tee boxes                    |
| path        | `#8f8f8f` | cart paths                   |
| cliff SW    | `#6b4f33` | exposed earth (shadow side)  |
| cliff SE    | `#8a6844` | exposed earth (lit side)     |

Supporting colors: trunk brown `#5d4330`, canopy greens `#3f8a3f`→`#77c46a`
(3 steps), rock grays `#7d7d78`→`#a8a89f`, blossom/flag accents
`#d9534f` (red), `#e8c15a` (gold), sky/UI parchment `#dfe8d8`.

## Golfer characters (M11 / ZKU-153)

- Character canvas: **48×72 px** per frame, feet on y=69 at bottom-center;
  chibi proportions (~2.5 heads tall), 1 px darkened outline, NW light.
- Frames ship as **grid sheets** in `src/assets/sprites/golfers/`, one file
  per (variant, animation, layer): `golfer{v}_{anim}.grid{COLS}x{ROWS}.png`.
  The atlas packer slices a grid file into frames named
  `{base}_{row}_{col}` inside `public/atlases/golfers.png/json`.
- **Two layers per frame**: the base sheet carries skin/pants/shoes/club in
  real colors; the `_t` twin (`golfer{v}_{anim}_t.grid….png`) carries shirt
  + hat in **grayscale** (~2 value steps around #d2d2d2) and is tinted at
  runtime with the golfer's color — author clothing light enough to tint.
- **Direction rows** (5 authored, 3 mirrored at runtime):
  rows 0..4 = screen octants `[s, sw, w, nw, n]`; se/e/ne are mirrored from
  sw/w/nw. walk/idle rows are the octant the character FACES; swing/putt
  rows are the octant the ball TRAVELS (stance is authored 90° off-target,
  right-handed; mirrored rows read as left-handers).
- **Animations**: walk 6f, idle 2f, swing 8f (0–5 windup→contact, 6–7
  follow-through/finish; contact must be frame 5), putt 4f (0–2
  stroke→contact, 3 hold), cheer 4f + mad 4f (single row, facing s).
  Frame timing lives in `src/game/render/golferSprites.ts` — replacement
  art must keep frame counts and the contact-frame positions.
- Regenerate placeholders: `npm run gen:sprites` (golfer generator is
  `scripts/gen-golfer-sprites.mjs`), then `npm run build:atlas`.

## Asset pipeline

1. Author/generate sprites as individual PNGs in `src/assets/sprites/` or,
   for M21 natural props, `src/assets/props/natural/`
   (transparent background, canvas sizes above). Filename = frame name:
   `tree.png`, `tree2.png`, `bush.png`, `rock.png`, …
2. `npm run gen:sprites` regenerates the **procedural placeholder tier**
   (checked in, deterministic). Replace any placeholder by dropping a
   better PNG with the same name — the code never changes.
3. `npm run build:atlas` packs independent `terrain`, `natural-props`,
   `buildings-decor`, and `golfers` atlases. Terrain metadata records scale 2;
   renderer sprites remain exactly 64×32 world pixels.
   Both outputs are checked in so builds/deploys need no image tooling.
4. The renderer loads atlases through `src/render/atlas.ts` (typed frame
   names, async preload). **Missing frames fall back to the legacy
   procedural/SVG path and warn once** — art can land incrementally.

## Biome identity and natural props (M21)

- The semantic save model remains `tree | bush | rock`. Visual species live
  only in `src/game/render/naturalProps.ts`, keyed by land theme and selected
  from run seed + type + position. Existing saves therefore gain the richer
  art without migration or state-hash changes.
- Each registry entry declares scale, bottom-center anchor, separate shadow,
  sway, density, cluster affinity, terrain/elevation/water constraints,
  cultivated/wild weighting, and selection-occlusion behavior. Missing theme
  art falls back to the matching parkland semantic type.
- Original atlas sources live in `src/assets/props/natural/`; the three
  chroma-key generation sheets and cleaned intermediate sheets are retained
  in sibling `source/` and `processed/` folders for provenance and rebuilding.
  `npm run gen:props` splits/normalizes the sheets, while
  `npm run build:atlas` performs final packing.
- Art was produced with the built-in image generation workflow on 2026-07-20
  using three theme-specific 4×3 raster-sheet prompts. Shared constraints:
  original early-2000s PC tycoon isometric props, fixed NW light, clean
  readable silhouettes, one isolated object per cell, flat `#ff00ff`
  chroma-key background, no text/watermark/floor/baked shadow. Parkland asked
  for deciduous/evergreen/flowering trees, hedges, shrubs, reeds, flowers,
  stump and boulders; links asked for wind-shaped trees, fescue/gorse/heather,
  marram/driftwood and coastal stone; desert asked for cacti, palo verde,
  mesquite, palm, agave/scrub and warm/volcanic formations.
- Theme terrain sources are generated into `src/assets/terrain/materials/`.
  Parkland, links, and desert all use the same typed material/autotile
  contracts; renderer-side theme branches are not permitted.

## Review checklist for new art

- [ ] Correct canvas size & ground anchor at bottom-center
- [ ] Reads clearly at 50% zoom, silhouette-first
- [ ] NW-lit, 1 px darkened outline, ≤4 value steps per surface
- [ ] Colors harmonize with the palette anchors
- [ ] Transparent background, no baked drop shadow

## M22 structures and course decor

- The retained source sheet is `src/assets/props/source/m22-structures-decor-magenta.png`; `npm run gen:m22-art` removes the flat magenta key, trims cells, applies restrained parkland/links/desert grading, and emits building tier variants before atlas packing.
- It was produced with the built-in image-generation workflow on 2026-07-20 as one original 4×4 modern-isometric source sheet: clubhouse, three concessions, nine furniture/ornamental pieces, bridge, boardwalk, and approach. The prompt required fixed NW light, isolated silhouettes, no text/people/copied assets, and a flat `#ff00ff` background.
- Furniture density is intentionally player-authored. Keep maintained corridors, flags, selection outlines, and golfer silhouettes readable; the 320-decoration performance fixture is a stress certification, not a recommended landscaping density.
- Buildings select `theme × type × tier` frames through the registry with parkland tier-one and legacy fallbacks. Normal identity never depends on runtime tinting.

## Parkland vertical-slice target (M19)

The objective fixture is `createParklandVisualReferenceCourse()` with seed
`1900212`, reachable in development at `?m19Fixture=1`. It contains one
landscaped par 4, shaped water and bunkers, a curved path, rolling elevation,
and cultivated/wild tree density. Fixed capture bookmarks are exported as
`PARKLAND_CAMERA_BOOKMARKS`: overview at 50%, full hole at 100%, and green
complex at 200%, all rotation 0. Repeat captures at rotations 1–3 when
reviewing transition directionality.

Objective gates before a raster enters an atlas:

- **Repetition:** no motif is obvious in a 30×30 single-material field at
  default zoom; use at least four base variants with unequal weights.
- **Seams:** cardinal, convex, and concave joins have no transparent cracks
  or raw diamond outlines in any camera rotation.
- **Anchors:** terrain fills 128×64 exactly; prop feet/trunks meet the
  bottom-center ground anchor within two source pixels.
- **Lighting:** NW-facing values are lightest; SE values are darkest; light
  never rotates with the camera.
- **Density:** a maintained hole reads as golf at 50% zoom, yet selection,
  flags, shot plans, and accessibility patterns remain legible at 100%.
- **Originality:** no third-party pixels are present. AI-assisted outputs must
  record prompt/provenance, then receive manual palette, edge, alpha, anchor,
  and silhouette cleanup before packing.

## Surface dressing

- Fairway and green mowing is clipped inside authored tile alpha; contrast is
  capped near 7%. Green fringe, bunker lips, shore banks, and path shoulders
  are material transition frames rather than freehand renderer branches.
- Cups, flags, tee pads, and markers remain high-contrast semantic decals
  above terrain materials. They must read with the course UI hidden.
- Water uses three stepped depth values, sparse reflection marks, and pale
  shore frames. Runtime motion may only modulate those authored layers.
  Reduced motion freezes base tint, reflection, shore alpha, tree sway, and
  looping flag motion.
