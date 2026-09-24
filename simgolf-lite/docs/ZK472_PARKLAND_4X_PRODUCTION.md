# ZK-472 Parkland 4× production terrain

This slice adopts a deterministic CourseCraft-authored 4× Parkland source for
the runtime terrain atlas. It changes presentation assets only: terrain
topology, simulation rules, and the save schema remain owned by the existing
course model and world-space contour/heightfield renderers.

## Reproduce and inspect

From `simgolf-lite/`:

```sh
npm run gen:terrain:parkland-4x
npm run build:atlas
npm run audit:terrain:parkland-4x
npm run test:terrain:parkland-4x
```

The generator recreates all 180 frames at 256×128, writes a SHA-256 for every
frame, and produces the review surface at
`src/assets/terrain/parkland-4x/evidence/contact-sheet.png`. The adjacent
`manifest.json` records the contact-sheet layout and hash. No source-game
pixels or external-provider output are used.

The atlas builder copies the full source into the high/detail tier, creates the
medium/normal tier with a deterministic 2× premultiplied-alpha box mip, and
creates the low/overview tier with the corresponding 4× mip. The stable biome
manifest records the source-manifest SHA-256, frame-set SHA-256, LOD mapping,
and immutable content-hashed atlas filenames.

## Art contract

- Logical tile footprint: 64×32; source footprint: 256×128 at 4×.
- Fixed north-west light; bounded Parkland material palette; 2–6 px clusters.
- Six bases plus north/east/south/west edges and inner/outer corners for all
  four diagonal rotations, for each of the ten simulation terrain materials.
- Multi-band edge pixels complement, but never replace, the pair-owned fringe,
  bunker lip, shoreline, path shoulder, and heightfield contracts in
  `src/game/render/materialFields.ts` and `landscapeGeometry.ts`.
- Fescue is the presentation of `deep_rough`; its distinct silhouette and
  deterministic fescue/tall-grass cluster sheets do not add a save-format enum.
- Parkland detail clusters cover short/tall grass, fescue, flowers, leaf litter,
  reeds, shore stones, pebbles, bunker tufts, scrub, and worn turf.
- Standard, deuteranopia, protanopia, and tritanopia modes continue to use the
  runtime palette and non-colour pattern contracts. The asset audit checks all
  materials in every mode.

## Delivery, budgets, and offline behavior

The production atlas stays under the source, atlas, selected-biome transfer,
and critical-startup ceilings declared in
`src/assets/terrain/contracts/parkland-4x.json`. Only the selected biome and
quality bundle is requested. Content-hashed atlas files remain cache-first;
the stable manifest is part of the app shell, so a previously loaded Parkland
bundle remains available after an offline reload.

`scripts/parkland-4x-asset-audit.mjs` fails on missing rotations/materials,
wrong frame or atlas dimensions, stale hashes/byte counts, duplicate frame
hashes, insufficient transparency, broken gutters, incomplete quality or
accessibility coverage, unbudgeted transfer growth, missing offline tokens, or
loss of the rollback switch.

## Explicit rollback

The prior 128×64 2× sources remain unchanged in
`src/assets/terrain/materials`. To build the verified rollback without editing
source or changing runtime state:

```sh
COURSECRAFT_PARKLAND_TERRAIN_MODE=legacy-2x npm run build:atlas
```

Omitting the variable restores the production 4× default. The selected mode is
written to `public/atlases/biomes/manifest.json`, making a rollback artifact
auditable rather than implicit.
