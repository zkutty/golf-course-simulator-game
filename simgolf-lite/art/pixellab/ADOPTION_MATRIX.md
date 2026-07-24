# CourseCraft art-tool adoption matrix

Status: **provisional — live PixelLab generation is blocked until a rotated
credential is connected**.

| category | provisional PixelLab status | primary workflow | fallback | human review |
|---|---|---|---|---|
| Terrain/autotile transitions | Reject | Deterministic CourseCraft generators and authored cleanup | Manual raster authoring | Full seam/rotation certification |
| Natural props | Conditional | PixelLab style-matched map objects | High-resolution generation plus paint-over | Alpha, anchor, silhouette, biome and zoom review |
| Facilities | Conditional | Compare PixelLab against Layer/Scenario on the same footprint | Blender or high-resolution generation plus paint-over | Projection, tier/theme identity and rotation review |
| Golfers and small animated objects | Conditional | PixelLab only if frame contracts pass | CourseCraft procedural sheets plus manual animation | Frame-by-frame identity, feet and contact timing review |
| Portraits and recurring cast | Reject as primary | High-resolution illustration workflow | Manual illustration/paint-over | Identity, expression and narrative continuity review |
| UI icons | Ideation only | Authored SVG/vector system | Raster sketch followed by vector redraw | Accessibility and multi-scale review |
| Editorial/vision renders | Reject as primary | High-resolution image generation | Illustration/3D composition | Brand, composition and disclosure/provenance review |

## Finalization gate

Replace every provisional status with `adopt`, `conditional`,
`ideation-only`, or `reject` only after:

1. the manifest contains approved PixelLab static and animation candidates;
2. `benchmark.json` contains measured scores and human time;
3. atlas, browser, accessibility, and performance certification passes; and
4. conclusions are handed to ZK-329, ZK-378, ZK-379, and ZK-383.
