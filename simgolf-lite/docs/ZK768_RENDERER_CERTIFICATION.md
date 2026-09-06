# ZK-768 Renderer Certification

## Scope

This certification covers the DOM-free hole-illustration adapters released at `340af9c59f3751ea2e7b27cdc293333ec27650f0`, plus deterministic budget reporting and palette contrast evidence in this packet. It does not add product UI, save/export state, PNG encoding, or network behavior.

The certified render matrix is exhaustive for the registered product surface:

- 3 biomes: parkland, links, desert
- 4 seasons: spring, summer, autumn, winter
- 2 contrast modes: standard, high-contrast
- 2 frames: north-up, tee-to-green
- 48 total combinations

Every combination is built twice from the released snapshot builder and must retain the same plan hash. SVG and RGBA are each rendered twice and compared exactly. The complex fixture requires non-empty terrain, elevation/contours, path, vegetation/obstacles, surroundings, route, tee, and pin layers. The aggregate matrix evidence hash is `5747a09b`.

The declared stable order is terrain, elevation/contours, paths, vegetation/obstacles, surroundings, route, tee, then pin. The route contains a white halo that is two logical pixels wider in total than the authored route core. Tee and pin render after both route strokes, so their endpoint centers cannot be overpainted. Each endpoint ellipse retains its authoritative projected center and has a minimum three-logical-pixel fill-only inner diameter after subtracting its centered stroke. Larger natural marker geometry is preserved.

## Public deterministic preflight

`preflightHoleIllustrationRender(plan, { pixelRatio })` validates the canonical producer plan and reports, without allocating the final SVG or raster buffers:

- the exact SVG character count and configured character limit;
- physical raster width and height;
- exact pixel, RGBA-byte, coverage-byte, and combined allocation counts;
- the bounded raster pixel-visit estimate and whether it is exact; and
- whether SVG and raster limits are satisfied.

For admitted raster work, the visit estimate is exact. Once the work limit is exceeded, the report returns the deterministic `limit + 1` sentinel and `pixelVisitEstimateExact: false`; render then fails closed. Rendering and preflight share the same calculations.

Public limits:

| Resource | Limit |
| --- | ---: |
| SVG output | 33,554,432 characters |
| Raster pixel ratio | integer 1–4 |
| Raster pixels | 16,777,216 |
| RGBA + coverage allocation | 67,108,864 bytes |
| Raster pixel visits | 100,000,000 |

SVG output is counted in JavaScript characters, not claimed as a universal in-memory byte count. RGBA uses four output bytes and one temporary coverage byte per pixel. Preflight, validation, SVG serialization, and rasterization are deterministically bounded by the released plan collection/point limits and the table above. Their wall-clock duration depends on hardware and runtime; this certification makes no hardware-independent timing claim.

Hostile tests cover invalid/tampered plans, schemas, geometry, paint, Unicode, source budgets, dimensions, pixel ratios, allocation excess, and work excess. Over-budget inputs return a typed failure before final output-buffer allocation.

The released producer permits viewport axes from 1 through 8,192. At a one-pixel short axis, its exact normalized extrema are a route-halo stroke width of 3 and an endpoint radius of 2. Generic admission is limited to those maxima, while producer validation still reconstructs the exact semantic, geometry, stroke, and radius expected for every primitive. A 14-case matrix covering 1×1, 1×100, 100×1, 2×2, 2×100, 100×2, and 3×3 in both frames succeeds through preflight, SVG, and RGBA at pixel ratio 1; its deterministic aggregate hash is `c1dedb55`. Resealed values above either maximum fail closed.

## Palette contrast

`inspectHoleIllustrationGraphicContrast(biome, season, contrast)` reports actual functional graphic-boundary pairs for every registered palette: 20 for standard and 31 for high contrast. Ratios use WCAG relative luminance and the [WCAG 2.2 non-text graphics threshold](https://www.w3.org/WAI/WCAG22/understanding/non-text-contrast.html) of 3:1. The report distinguishes required certification pairs from supplementary measured adjacencies. It includes:

- every high-contrast terrain fill against its rendered outline ink; standard terrain-outline pairs are omitted because standard terrain has no outline;
- the 0.88-opacity route core composited over its white halo;
- the route halo against every terrain fill it may cross, plus the high-contrast terrain outline;
- the authored path against path terrain;
- green contours against green terrain;
- every vegetation/obstacle fill against outline ink; and
- surroundings, tee, and pin fills against their outlines.

The route core/halo pair and high-contrast halo/outline pair are required to pass. Halo/terrain measurements are reported but are supplementary because the contrasting core/halo treatment provides the route boundary. All 12 high-contrast biome/season styles pass. The certified minimum is `3.681979343743816:1`, set by the red pin against its black outline. Standard palettes are fully measured and reported but are not represented as the accessibility mode. The aggregate 24-report evidence hash is `338f2913`.

## Compatibility decision

The render-plan version remains 1. The primitive union and serialized field schema are unchanged, and repository search found no persisted or external render-plan consumer. This correction changes only producer content and declared ordering: the route layer adds a second legal polyline and moves below tee/pin. Canonical hashes therefore intentionally change, and the existing renderer hash validation rejects stale or altered plans rather than interpreting them silently.

## Representative bounded outputs

The representative complex course is links/autumn, tee-to-green, 96×72 logical pixels. It includes paths, fixed-point contours, vegetation, rocks, a decoration, a clubhouse surrounding, route, tee, and pin. Its snapshot hash is `8f58aa7bb07eda543859d389a40449636c66d2e44473ebc8651703ba6a963bd3`.

| Output | Plan hash | Dimensions | Allocation / characters | Pixel visits | SHA-256 |
| --- | --- | ---: | ---: | ---: | --- |
| Standard SVG | `ee9eaad8` | 96×72 | 46,617 characters | n/a | `81e4f39a7652ce56bb567774e8e7c574020ca01d283b222b94c9b83e3a376dab` |
| Standard PNG, 1× | `ee9eaad8` | 96×72 | 34,560 working bytes | 33,775 | `db569f2ffb05f1a1e1f445636109fb020463ea7930083bd8d12e5cbd69defe10` |
| Standard PNG, 2× | `ee9eaad8` | 192×144 | 138,240 working bytes | 108,178 | `e51ab9d23e8d5d37cfa86d86ba7af76b175157b3da72186c47b4c99322d74ff0` |
| Standard PNG, 3× | `ee9eaad8` | 288×216 | 311,040 working bytes | 225,852 | `89bd6c965e7712d934f0e1c0252f57b65b01ef67bfe89ac371840e075d53d69a` |
| Standard PNG, 4× | `ee9eaad8` | 384×288 | 552,960 working bytes | 386,056 | `20be416a696e9d8becdf5021d8ab2e6f7ee8238b94d162465656df848179912a` |
| High-contrast SVG | `212a5760` | 96×72 | 55,203 characters | n/a | `12d4cfc47ca83adde999c3407c02f672feb4e186a8e6a41bb9643ebb28aa4f3a` |
| High-contrast PNG, 1× | `212a5760` | 96×72 | 34,560 working bytes | 48,277 | `1600e4c5b5e3c6a44595315eca32227941080b69fbc133a212d34310bb484726` |
| High-contrast PNG, 2× | `212a5760` | 192×144 | 138,240 working bytes | 148,300 | `e7ac0df31e466eec160da25cfe9f68b3d165428a2e7d275dd0203c10cc6ac9f1` |
| High-contrast PNG, 3× | `212a5760` | 288×216 | 311,040 working bytes | 304,639 | `d7e24591ffa4eecdc2647bfedd3f0d71eac83b303920c2eacc5d94c54ccbaa49` |
| High-contrast PNG, 4× | `212a5760` | 384×288 | 552,960 working bytes | 516,122 | `09ddfb0261266dffa62812ccf6931478d8c43d46b8686b68a712c9f72dd73b5b` |

PNG files are temporary inspection encodings of the certified raw RGBA output; PNG encoding is not part of the product implementation. The committed complex-course test evidence for pixel ratios 1–4 has aggregate hash `69917a72`.

Temporary evidence is generated by `/tmp/zk768-wave2-generate-samples.ts` into `/tmp/zk768-wave2-evidence/`:

- `standard.svg` and `high-contrast.svg`
- `standard-1x.png` through `standard-4x.png`
- `high-contrast-1x.png` through `high-contrast-4x.png`
- `manifest.json`

For visual inspection, compare each SVG with its 1× and 4× PNG. Confirm the white route halo separates its dark core from terrain and black high-contrast grid lines; the route remains continuous; and both endpoint marker centers retain their authored fill at every scale. Also confirm the path, contour samples, tree, rock, bench, and clubhouse footprint remain visible. The manifest contains the exact budgets and SHA-256 hashes above. These temporary files are deliberately not repository artifacts.

Native SVG raster evidence was generated with Sharp 0.35.2 and librsvg 2.62.3 by running `node /tmp/zk768-svg-endpoint-evidence.cjs`. At 96×72, both endpoint ellipses serialize with 2px radii and a 1px centered stroke. The floor-coordinate center samples are exact authored fills in both modes: standard tee `[248,243,223,255]`, standard pin `[217,73,63,255]`, high-contrast tee `[255,255,255,255]`, and high-contrast pin `[208,0,0,255]`. The geometry threshold is also enforced independently of color by the committed focused test.

## Deterministic gates

Run from `simgolf-lite/`:

```sh
npx vitest run src/game/holeIllustration/renderPlan.test.ts src/game/holeIllustration/renderer.test.ts
npx tsc -b
npx eslint src/game/holeIllustration/style.ts src/game/holeIllustration/renderPlan.ts src/game/holeIllustration/renderPlan.test.ts src/game/holeIllustration/renderer.ts src/game/holeIllustration/renderer.test.ts
```

The focused test suite certifies exact aggregate hashes, all 48 style/frame combinations, all 14 tiny-axis/frame combinations, all 24 palette reports, pixel ratios 1–4, representative pixels, and fail-closed hostile limits. Full serial unit and production-build gates are recorded in the packet handoff.
