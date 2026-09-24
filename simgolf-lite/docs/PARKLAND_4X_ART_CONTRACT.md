# Parkland 4× art contract

The production Parkland terrain contract remains the authority for playable
surface pixels. The habitat-field source in
`src/assets/terrain/parkland-habitat-4x` is a renderer-neutral, source-only
vocabulary. It adds no runtime import, collision, obstacle, simulation, save,
or picking behavior.

## Habitat-field vocabulary

`ParklandHabitatFieldManifestV1` defines five semantic families: woodland
floor, understory edge, meadow/deep-rough margin, wet shore, and rock/leaf
transition. Each family supplies interior, boundary, convex, concave, and
termination topology in High, Medium, and Low tiers. Boundary and termination
frames declare one edge anchor; corner frames declare two. A downstream
consumer must select frames from connected habitat occupancy and preserve those
anchors. It must not place one arbitrary stamp per terrain cell.

The frames are transparent pixel clusters, not opaque diamonds or whole-grove
pads. The family patterns deliberately cross cell boundaries when their
topology anchors agree. Trees are excluded: real Parkland tree sprites remain
the canopy and obstacle authority, so these assets cannot imply collision.

## Provenance and accessibility

All pixels are deterministic, project-original CourseCraft work. No SimGolf or
other reference pixels are copied or traced. The manifest records the source,
each frame region, atlas, and manifest hashes. Standard, deuteranopia,
protanopia, and tritanopia transforms each map every RGB source color used by
every family. A future consumer can apply the declared transforms without
guessing or recoloring transparent pixels. Every family also retains a
distinct non-color pattern identity in all modes.

## Runtime boundary and rollback

This packet is an asset foundation only. The current Parkland 4× atlas and the
legacy 2× rollback remain unchanged. Runtime adoption requires a separate
reviewed consumer packet. Rollback is deletion of the habitat sidecar source,
generator, validator/tests, and package scripts; it does not modify runtime
state or persisted data.
