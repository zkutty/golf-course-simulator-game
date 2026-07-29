# M35 Continuous Landscape Art Contract

This is the shipping contract for CourseCraft’s continuous Parkland, Links,
and Desert material fields. The checked-in art is generated deterministically
from repository code; a generated concept study was used only to compare
material vocabulary and was not copied into production.

## Source and provenance

- Generator: `scripts/gen-m35-landscape-fields.mjs`
- Source output: `src/assets/terrain/fields/{theme}/{quality}/{terrain}.png`
- Release packer: `scripts/build-atlas.mjs`
- Release manifest: `public/atlases/biomes/manifest.json`
- Rebuild commands:

  ```sh
  npm run gen:m35-art
  npm run build:atlas
  npm run audit:m35-assets
  ```

The generator contains the palette, seed, material rules, and sampling
algorithm. It has no network inputs and uses no time, machine, or locale data.
Given the same source revision and PNG library it produces the same pixels.
Every release filename carries the first 12 hexadecimal characters of its
SHA-256 content hash.

## Raster contract

| Tier | Output | Authoring samples per output pixel | Runtime |
| --- | ---: | ---: | --- |
| High | 512 × 512 | 4 × 4 | Connected mesh with authored field |
| Medium | 256 × 256 | 2 × 2 | Connected mesh with authored field |
| Low | 128 × 128 | 1 × 1 | Procedural/color fallback; field is not shipped |

Each square is a seamless periodic field spanning eight by eight unrotated
world tiles. The renderer anchors UV phase to authoritative course
coordinates, so the field does not restart at chunk, component, save/load, or
camera-rotation boundaries. Camera projection supplies the isometric
compression; source art stays square and directionally neutral except for
material cues such as mowing, rake, and water lines.

All pixels are opaque sRGB RGBA. Periodic sampling supplies the bleed contract:
opposite edges meet without a transparent seam. Packed sprite atlases use a
two-pixel gutter. Connected-region masks, shore/bunker bands, height, and
clipping remain renderer-owned geometry rather than baked alpha.

## Visual vocabulary

- Light is consistently from the north-west. Broad material color is restrained
  so geometry, not a stamped tile border, carries depth.
- Fairway, green, and tee use coherent low-contrast mowing bands with sparse
  wear. Rough uses irregular blade clusters; deep rough is darker and denser.
- Water uses a calm base with sparse coherent highlights. Wetland combines that
  field with reed-colored clusters.
- Sand uses warm value variation, sparse rake lines, and occasional aggregate.
  Waste and paths use irregular gravel rather than a flat wash.
- Runtime contours add at least three visual bands to water and bunkers. Turf
  fringes, natural feathers, path shoulders, recessed hazard beds, and shared
  height anchors are geometry-driven and remain stable at all four rotations.

Parkland establishes the reference contrast and density. Links translates it
to wind-dried turf and cooler water; Desert translates it to warm mineral
ground and irrigated maintained surfaces. Translation changes palette and
material frequency, not topology or interaction.

## Naming and bundle ownership

Terrain names are `fairway`, `rough`, `deep_rough`, `sand`, `waste_area`,
`water`, `wetland`, `green`, `tee`, and `path`. Release files use
`field-{theme}-{quality}-{terrain}.{hash}.png`. Atlas JSON/PNG pairs use
`{kind}-{theme}-{quality}.{hash}.{json|png}`.

Only the selected biome and quality bundle is loaded. Golfers form the small
shared core; buildings/decor, terrain, details, props, and fields are
biome-owned. The service worker precaches the manifest and shell, then
runtime-caches only bundles a player actually visits. Low intentionally omits
field, detail, and natural-prop payloads.

`scripts/m35-asset-audit.mjs` verifies hashes, dimensions, frame ownership,
complete terrain coverage, the 8 MiB per-atlas cap, the 6 MiB selected-bundle
cap, and the 8 MiB compressed default critical-load cap in both `public/` and
the production `dist/`.

## Candidate-art adoption gate

Any future generated or externally supplied candidate must be reviewed by a
human before it enters the source tree. Review must confirm provenance,
originality, palette/light consistency, seamless edges, material readability,
and parity across all required rotations and zooms. Until that review passes,
the deterministic generator above is the authoritative production fallback.
