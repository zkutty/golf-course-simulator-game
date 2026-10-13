# ZK-1159 Decor asset repair

The retained M22 illustration is a composition, not a regular 4×4 tile sheet.
Its building bases, lamp base, tee-sign base, and fountain tip cross the grid
boundaries assumed by the former generator. Fixed-cell extraction included
neighboring artwork and cut off parts of intended objects. The current Parkland
M22 composition reproduces these fragments at normal zoom with the old atlas.

`scripts/m22-decor-regions.mjs` documents reviewed source rectangles for all 11
Decor kinds. The generator preserves every keyed pixel within those regions,
adds eight source pixels of transparent padding, and uses alpha-weighted area
filtering to preserve thin contours during reduction. It does not prune connected
components or erase silhouette islands. Buildings and the unused companion
`bridge_approach` preserve their original extraction and sampling behavior.

The source sheet remains unchanged. Production placement, rotations, seasonal
presentation, shadows, loader behavior, schemas, and gameplay code remain
unchanged. Each frame continues to use untrimmed Pixi metadata, with a source
size equal to its frame and spriteSourceSize origin `(0,0)`. Its production
sprite anchor remains `(0.5,1)`; clean-art bounds now determine aspect ratios,
restoring complete objects instead of preserving heights inflated by fragments.

Run from `simgolf-lite`:

```sh
npm run gen:m22-art
COURSECRAFT_ATLAS_OUT_DIR=/private/tmp/zk1159-regeneration npm run build:atlas
node scripts/zk1159-decor-audit.mjs
node --test scripts/zk1159-decor-audit.test.mjs
npx playwright test e2e/zk1159-decor-gallery.e2e.ts --workers=1 --retries=0
npx vitest run src/game/models/m22Decorations.test.ts src/ui/renderer/scenes/structuresPropsScene.test.ts src/render/atlas.test.ts src/render/atlasManifest.test.ts --maxWorkers=1
```

Install only the regenerated `buildings-decor*` aggregate and biome files and
update the matching `base.buildings` manifest entries. Keep all other manifest
entries and atlas files unchanged. A complete historical re-encode can change
Parkland terrain compression aliases while retaining identical decoded pixels;
those unrelated output changes are excluded from this packet.

The asset audit verifies every aggregate and selected-biome Decor frame against
its checked-in source pixels, frame rectangle, untrimmed source contract, two
transparent frame-edge pixels, and immediate atlas gutter. It rejects detached
alpha components beyond a three-source-pixel fringe around the main authored
silhouette. This fringe preserves legitimate antialias contours and thin detail;
all pixels within reviewed source regions remain in the generated image.
The negative guard introduces a detached pixel into a real generated sprite and
proves the padding and silhouette checks fail.

The gallery uses the actual production `createStructuresPropsSceneSystem`,
`loadAtlases`, Pixi WebGL renderer, and authoritative seasonal presentation.
It checks all 11 kinds, four rotations, three tiers, three representative biomes,
four seasons, and resolutions 1 and 2. It also checks Parkland at zooms 0.15,
0.5, 2, and 8, including all four rotations. Every native GPU alpha extraction is
compared against the independently decoded source mask with a two-device-pixel
filter/raster-rounding allowance. Every update proves the prior native sprite
and shadow are destroyed and detached, verifies exactly one of each survives,
and checks the sprite anchor and production shadow offset. No renderer is mocked.

The matrix tests save receipts and 24 screenshots under
`/private/tmp/zk1159-evidence/native` by default; set `ZK1159_EVIDENCE_ROOT` to
choose another evidence destination. The normal-zoom live-game before/after
Parkland captures and full original issue screenshot are retained separately in
the packet evidence. The original screenshot does not provide saved course
coordinates; the live-game comparison uses the deterministic M22 Parkland
asset composition and unchanged authority hashes, rather than asserting exact
historical camera/placement coordinates.

All 31 building frames have identical decoded pixels and unchanged source-size
contracts after repacking. Loader, hosted scene, decoration models, PixiStage,
reducer, and schema files have unchanged SHA-256 hashes. Biome manifest changes
are confined to buildings/Decor bundle references. Each selected bundle shares
one content-addressed atlas across all graphics tiers. Transfer size decreases
by 122,656–125,204 bytes per selected bundle, and decoded texture size decreases
by 180,608 bytes. Original tracked audit artifacts remain untouched.

Rollback: restore the scoped generator, region/audit/gallery files, 33 Decor
source PNGs, aggregate atlas, three selected-biome atlases and manifest references
from the preceding commit. Deterministic regeneration with the prior generator
restores the prior atlas. Full integration typecheck, lint, build and delivery
certification remain coordinator-owned gates before release.
