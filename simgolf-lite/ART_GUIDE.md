# CourseCraft Art Guide (the "look bible")

Target aesthetic: **Maxis-era 2.5D tycoon** — Sid Meier's SimGolf (2002),
RollerCoaster Tycoon 2, Zoo Tycoon. Charming, chunky, readable. Every sprite
in the game (hand-painted, AI-generated, or procedural) must follow this
spec; if art matches these rules it will sit correctly in the scene with no
code changes.

## Projection & dimensions

- **2:1 dimetric ("isometric")**: a ground tile is a **64×32 px diamond**
  (`TILE_W`/`TILE_H` in `src/game/render/iso.ts`).
- One elevation step = **8 px** vertical (`ELEVATION_STEP_PX`).
- Sprites are authored at 1x for a 64 px tile; the renderer scales.
- Objects stand on their tile with a **ground anchor at bottom-center**
  (sprites use anchor `(0.5, 1)` placed at the footprint's front corner —
  see `src/game/render/objectPlacement.ts`).
- Standard prop canvas: **64×96 px** (1 tile wide, 3 half-tiles tall).
  Buildings: 64 px per footprint tile of width, height as needed.
- Character canvas (M11): **48×72 px**, feet at bottom-center.

## Light

- Sun is **fixed NW** (upper-left), never rotates with the camera.
- Tops are lit; SE faces darkest, SW faces mid-shadow
  (see `CLIFF_SW`/`CLIFF_SE` in PixiStage: `#6b4f33` / `#8a6844`).
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

## Asset pipeline

1. Author/generate sprites as individual PNGs in `src/assets/sprites/`
   (transparent background, canvas sizes above). Filename = frame name:
   `tree.png`, `tree2.png`, `bush.png`, `rock.png`, …
2. `npm run gen:sprites` regenerates the **procedural placeholder tier**
   (checked in, deterministic). Replace any placeholder by dropping a
   better PNG with the same name — the code never changes.
3. `npm run build:atlas` packs `src/assets/sprites/**` into
   `public/atlases/props.png` + `props.json` (Pixi spritesheet format).
   Both outputs are checked in so builds/deploys need no image tooling.
4. The renderer loads atlases through `src/render/atlas.ts` (typed frame
   names, async preload). **Missing frames fall back to the legacy
   procedural/SVG path and warn once** — art can land incrementally.

## Review checklist for new art

- [ ] Correct canvas size & ground anchor at bottom-center
- [ ] Reads clearly at 50% zoom, silhouette-first
- [ ] NW-lit, 1 px darkened outline, ≤4 value steps per surface
- [ ] Colors harmonize with the palette anchors
- [ ] Transparent background, no baked drop shadow
