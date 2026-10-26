# Natural golfer v1 · first production candidate

ZK-378 wave 2A, October 26, 2026. **One additive identity; human PNG review pending; not runtime integrated.** No legacy sprite, atlas, frozen prototype, simulation, renderer or timing authority is replaced. No bulk variants are generated.

Start with [contact-sheet.png](contact-sheet.png) at its native 1080×760 image size. Its three rows show the same body at 50/100/200% gameplay scale; the bottom strip is a separately labeled 300% inspection. The eight direction samples are actual rendered contact PNGs, and the inspection strip uses the actual discrete walk/idle/swing/putt/response samples. These are asset checks, not a simulated or recorded hole.

## Approved model and actual scale

The new offline authoring model is extracted from the immutable approved `aa5933d8e13d61963dc22fd640d1c7d6a52134b3` Study 02 model. Tests compare the actual skeleton against that frozen source throughout walking, swinging, putting and reacting. It retains the 6.41-head adult silhouette, 64.1-unit crown height, 10.5/11-unit arm bones, rigid 30.0243-unit shaft and 1.85-unit ordered grip. The accepted teal/cream palette comes from concept `dafbed52120603c9a2876ba01bf5cc3a827d58f0`: teal polo, cream cap, warm trousers and navy shoes/bag.

The model's original 48×72 reference and feet (24,69) remain the world-size reference. Transparent padding expands the logical canvas to **72×96, feet (36,83)**, source origin (-12,-14). Raster scale is **1×**; there is no per-pose zoom, body shrink, camera adjustment or horizontal mirror. The common world scale remains **26/48**. The padded whole frame therefore displays **39×52px** at 100%, while the original reference-frame width is still **26px** and nominal body height is **34.7px**. At 50/100/200%, reference widths are exactly **13/26/52px** and body heights approximately **17.4/34.7/69.4px**. The visible body is narrower than its reference frame.

Every actual rendered frame has transparent pixels on all four native edges. Trim offsets preserve the same source canvas and feet; consumers must reconstruct both layers with those offsets and apply the common scale. They must not independently fit crops into a fixed display width. The production export's transparent padding resolves the approved prototype's out-of-frame club; it does not change the body.

## Atlas, clip and coverage contract

`manifest.json` is a minified, versioned authoring manifest. It contains 224 logical frames / 448 layer entries across eight authored views `[s,sw,w,nw,n,ne,e,se]`. Exact duplicate cropped pixel buffers share atlas rectangles; there are 272 unique layer textures. `atlas.png` is RGBA8, 1024×632, with two transparent padding pixels around every unique crop. There is no opaque edge extrusion, no texture overlap and no dirty neighboring alpha. A later consumer must honor trim/padding and filter/UV handling; no existing atlas loader is wired by this packet.

| Clip | Columns | Rows | Contact | Direction meaning |
| --- | ---: | ---: | ---: | --- |
| Walk | 6 | 8 | — | Facing |
| Idle | 2 | 8 | — | Facing |
| Swing | 8 | 8 | 5 | Ball target |
| Putt | 4 | 8 | 2 | Ball target |
| Positive | 4 | 8 | — | Facing |
| Negative | 4 | 8 | — | Facing |

Idle's two columns intentionally hold the same restrained pose. Walk samples represent one stride with opposite leg phases. Swing frame 5 is synthetic-model progress .63 and puts the club tip at model (7.6,12,1); putt frame 2 returns to its contact position. Those sample indices are compatibility data, not a body stopwatch. The production projector must select them from the canonical shared cursor and cannot expose terminal contact before actual launch. Settle/watch use the non-gripping idle fallback rather than expanding this packet.

Only **right-handed** target/stance pairs are authored. Left or unknown handedness has no certified strike coverage and must use a **neutral non-gripping idle fallback**. No mirror can turn a known right-handed strike into a left-handed one. Equipment is the original generic legacy club silhouette; driver/iron/putter class accuracy is not certified. Known equipment without a validated pair must follow the integration policy's neutral fallback.

Positive is a small finite pleased cue; negative is a sigh. These source columns do not authorize playing a reaction cycle. Accepted V1 policy permits at most one restrained static, current-owner, evidenced cue inside existing shared rest. Eligibility, motion-off behavior and quiet partner scheduling remain separate integration work. No score, outcome or route is inferred here.

## Visible layers and separate shadow

The base layer contains skin, trousers, fixed cream cap, hair, navy shoes/bag, equipment and cream collar/buttons. The **neutral grayscale tint layer contains polo fabric only**; default multiply color is `#397e82`. Keeping the cap in base deliberately preserves the accepted cream-cap/teal-shirt palette, instead of tinting both pieces teal. This is a new versioned contract, not a promise of drop-in legacy layer semantics.

The generator renders ordered surface ownership and color passes, then partitions final visible contributions. Base alpha is corrected for a tint-over-base reconstruction, preserving limbs/club occlusion even where they cross shirt surfaces. Raw RGBA bytes are packed directly and PNG-encoded without another premultiplication round trip. Reconstruction is exact from atlas to source-layer pixels. Compared with a direct composite render, measured errors are at most **1 alpha level / 3 premultiplied RGB levels**; these are explicit raster quantization bounds, not hidden repairs.

`shadow.png` is a separate 40×20 @2× decal with world radii (8,3.4), alpha .18 and offset (1.5,.8). No body frame contains a ground shadow. The contact sheet applies it independently at the stated world size.

## Reproduce and validate

The repository declares pinned dev dependency `@napi-rs/canvas@0.1.100`; `pngjs@7.0.0` is already locked. The authoring path validates those exact versions. No runtime service, credential, network request or npm install occurs in the generator.

After normal root-managed dependency installation:

```sh
node scripts/gen-natural-golfer-v1.mjs
node --test scripts/natural-golfer-v1.test.mjs
```

For this workspace's documented bundled rasterizer, from `simgolf-lite/`:

```sh
node scripts/gen-natural-golfer-v1.mjs --canvas-module /Users/zbkutlow/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas/index.js
NATURAL_GOLFER_CANVAS_MODULE=/Users/zbkutlow/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas/index.js node --test scripts/natural-golfer-v1.test.mjs
```

`--out-dir` may target a disposable comparison directory. Tests generate twice in isolated temporary directories, compare every emitted byte, compare with checked-in outputs, decode/reconstruct all packed layers, verify source-edge transparency and packed padding, preserve approved actual geometry/contact/anchor/world scale, validate all clip grids/directions/coverage and recompute costs from actual PNGs. **9 focused tests pass.** Determinism is established on the pinned rasterizer/platform; contact-sheet text can differ on another font environment. A cross-platform reproducibility claim is not made.

## Bytes, provenance and deferred acceptance

See [cost.json](cost.json) and [provenance.json](provenance.json). Source/generator/frozen-model hashes and atlas/shadow hashes are recorded; no provider-generated images, third-party people or copied character assets are used.

| Measured scope | Bytes on disk | Decoded RGBA bytes |
| --- | ---: | ---: |
| Atlas + separate shadow | 331,620 | 2,591,872 |
| Minified runtime manifest | 110,629 | Not a texture |
| Complete runtime PNG + manifest | **442,249** | **2,591,872** |
| Review contact-sheet PNG only | 123,872 | 3,283,200 |
| All three PNGs, including review | **455,492** | **5,875,072** |
| Runtime + review PNGs + manifest | 566,121 | 5,875,072 |
| Unchanged legacy atlas ceiling | **501,591** | **12,700,960** |

The complete candidate runtime payload and even the combined PNG image bytes are below the unchanged ceilings. The raw authoring/review packet including both runtime metadata and the non-runtime contact sheet is separately reported above; it is not an additional runtime texture load. Human notes, cost/provenance reports and generator source are authoring materials.

An exploratory 2× raster attempt was rejected before writing outputs: **1,002,332 runtime PNG bytes / 12,766,336 decoded bytes**, before exact-image deduplication. That is evidence of the rejected attempt, not proof that every future optimized 2× strategy is impossible. This packet adopts native 1× without changing world-body size; a sharper source requires a separately bounded strategy and unchanged-budget review. No accepted reference was overwritten.

Human acceptance must still inspect actual PNG faces/cap, all eight right-hand stances, line/alpha edges, layer overlap, foot contact and readability at the honest sizes. The native 1× raster sacrifices enlarged detail versus the vector study. There is no runtime integration, actual terrain/lighting certification, full-hole recording, scene/crowd performance evidence, expanded variants, release or deployment in this packet. The integration policy and later serial runtime/full-hole gates remain open.

## Pure resolver handoff (metadata only)

`src/game/render/naturalGolferArt.ts` adds a separate pure boundary after this asset checkpoint. The caller supplies parsed manifest and cost JSON to `parseNaturalGolferArt(manifest, cost)` once; successful output is a deeply frozen, privately registered index. The module imports neither this 110KB JSON nor Node, textures, Pixi, activity policy or a clock. It validates the complete 224-frame/448-layer schema, atomic base/tint pairs, authored directions, contact IDs, finite rigs, padded source/feet, overlap/dedup rules and declared full-runtime costs.

`resolveNaturalGolferArt(index, request)` requires an **explicit family and asset identity selection** plus exact clip, direction, column and handedness. It returns both layer rectangles and trim offsets together, source 72×96 / feet (36,83), and body-unit scale 26/48. A legacy family selection remains with its caller; another identity is never silently replaced. Unsupported hands, incomplete/unvalidated indexes or invalid exact requests return an explicit neutral non-gripping fallback reason.

Its coverage output separates generic right-hand motion from **zero certified specific club classes**. It creates no `ActivityClipPair`, equipment compatibility permission, loader action, family assignment rule, variant replacement or runtime integration. The parser checks metadata declarations and receipt arithmetic; it does not verify PNG bytes/alpha/hash authenticity or certify a GPU upload. Those asset and later integration gates remain separate.

## Optional owned loader and exact runtime staging handoff

`src/render/naturalGolferAtlas.ts` is an **unwired optional loader**, not a family activation or scene change. `createDefaultNaturalGolferAtlas()` creates a lazy browser/Pixi service; `createNaturalGolferAtlas(adapters)` accepts injected bounded-fetch and private-resource adapters for deterministic tests. Create one service per intended renderer ownership scope, not one service per actor or frame. Construction and lookup perform no IO. Only an explicit `load()` requests the four fixed, same-origin versioned URLs. There is no import-time 110KB JSON import, metadata-provided URL, global `Assets` cache, legacy texture reference, actor assignment, activity-policy grant or renderer integration.

`load()` coalesces requests and validates bounded manifest/cost JSON through the accepted pure resolver. It checks actual metadata/PNG byte receipts, total runtime bytes including the cost receipt, PNG headers/hashes and decoded dimensions before publishing. All 224 atomic base/tint pairs and the separate shadow must succeed together. Partial failure leaves lookup unavailable with a neutral reason; it cannot activate half a pair. A failed attempt stays latched until explicit `reset()`, so repeated frame lookups/load calls cannot cause repeated network retries.

The atlas owns one private `ImageSource` at resolution 1 and the shadow owns one at resolution 2. Actual installed Pixi 8.14.3 `Texture`, `Rectangle` and `ImageSource` signatures were used. Body textures have `orig=(0,0,72,96)`, exact packed `frame`, native `trim` and `defaultAnchor=(36/72,83/96)`. Lookup supplies **26/48 body-unit scale**; consumers must not set the padded/cropped texture width to 26px. Full geometry, including trim, keys a bounded cache of at most 448 atlas textures; exact duplicates reuse textures. The shadow's logical texture is 20×10, unit scale 1, world offset (1.5,.8), and its .18 alpha is already baked. Do not apply the body's scale or alpha again to the shadow.

`snapshot()` exposes readiness, generation, resource/cache counts, runtime bytes and any cleanup errors. `artIndex()` exposes the same frozen branded metadata index only while the current generation is ready; it returns null during loading, failure, reset or disposal. This is the readonly seam for pure clip/stance helpers; it exposes no mutable frame map or private source. `lookup(request)` returns borrowed atomic textures only when ready, with their generation and validated geometry/coverage metadata. Borrowed handles cease to be valid after `reset()` or terminal `dispose()`. Both release owned texture views with `destroy(false)` before destroying the two private sources/bitmaps; they never destroy shared/core/legacy assets. Abort plus generation guards prevent stale publication, including sources that decode late and reentrant resets during texture creation. Cleanup continues if an adapter's destroy operation throws; the snapshot records those errors rather than claiming complete cleanup.

`node scripts/stage-natural-golfer-v1.mjs` explicitly stages exactly four byte-identical files into `public/atlases/natural-golfer-v1/`: `atlas.png`, `shadow.png`, `manifest.json`, and `cost.json`. It never stages the contact sheet, provenance or authoring README. The complete actual runtime payload is now **443,107 bytes**, including the 858-byte cost receipt, with **2,591,872 decoded RGBA bytes**—below the unchanged 501,591 / 12,700,960 ceilings. This addendum supersedes the earlier 442,249 runtime calculation only for the additional cost-receipt delivery requirement; immutable source files and their receipt remain unchanged.

Focused checks for this node:

```sh
node --test scripts/stage-natural-golfer-v1.test.mjs
npx vitest run --configLoader runner src/render/naturalGolferAtlas.test.ts src/game/render/naturalGolferArt.test.ts --maxWorkers=1
```

The staging tests check exact file lists/source bytes/SHA-256, cost-receipt-inclusive budgets, rejected drift and preservation of unrelated files. Loader tests inject fetch/private resources and exercise lazy/coalesced loading, all frame geometry, bounded dedup, failures, reset/stale/dispose cleanup and the default adapter's Pixi arguments. No heavy browser, GPU upload, blended in-scene render, actual full hole, crowd residency/performance or activation certification is claimed. Those later serial gates remain open.
