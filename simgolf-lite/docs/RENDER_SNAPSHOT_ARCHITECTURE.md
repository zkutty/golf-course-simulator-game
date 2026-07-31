# Render snapshot architecture

`RenderSnapshot` is the first boundary in the ZK-679 PixiStage migration. It
keeps the existing PixiJS app, atlas registry, projection, and adaptive-quality
behavior intact while giving future scene systems a typed, measurable update
contract.

The snapshot owns six independent revisions:

- `terrain-materials` — tile, elevation, terrain treatment, and material work.
- `structures-props` — authored holes, markers, obstacles, buildings, and props.
- `mobile-entities` — live golfers, vehicles, wildlife, balls, and transient FX.
- `overlays-diagnostics` — editor selection and explicitly host-owned overlays.
- `atmosphere` — season and day-driven weather/presentation changes.
- `viewport-input` — camera, pane, and input state.

`changedRenderSystems` is intentionally pure. A later scene host must call a
system's update only when its revision changes, and must create/destroy each
system explicitly. A cash-only GameSession update therefore has no renderer
invalidation; editor, terrain, live, atmosphere, and viewport changes each
invalidate their own declared system only.
