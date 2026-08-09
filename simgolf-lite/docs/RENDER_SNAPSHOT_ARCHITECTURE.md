# Render snapshot architecture

`src/game/render/renderSnapshot.ts` is the canonical snapshot and revision
authority for the ZK-679 PixiStage migration. It keeps the existing PixiJS app,
atlas registry, projection, and adaptive-quality behavior intact while giving
scene systems a typed, measurable update contract. The former UI module is a
compatibility re-export; it does not define another renderer contract.

The snapshot owns six independent revisions:

- `terrain-materials` — tile, elevation, terrain treatment, and material work.
- `structures-props` — authored holes, markers, obstacles, buildings, and props.
- `mobile-entities` — live golfers, vehicles, wildlife, balls, and transient FX.
- `overlays-diagnostics` — editor selection and explicitly host-owned overlays.
- `atmosphere` — season and day-driven weather/presentation changes.
- `viewport-input` — camera, pane, and input state.

`changedRenderSystems` remains the intentionally pure, coarse GameSession
migration helper through `RenderSubsystemSnapshot`. The concrete
`RenderSnapshot` and `RenderRevisionTracker` refine that boundary for the
systems already hosted by PixiStage without duplicating its authority.

`SceneSystemHost` calls a lifecycle scene's `create`, `update`, and `destroy`
explicitly. The atmosphere system owns seasonal weather decals, time-of-day
grading, cloud shadows, shimmer, birds, and the shoreline heron. Its static
inputs have one declared revision; frame-only clock motion does not rebuild
the seasonal scene. A cash-only or unrelated scene revision therefore remains
a no-op, while declared season, weather, quality, geometry, or rotation inputs
update the atmosphere owner.
