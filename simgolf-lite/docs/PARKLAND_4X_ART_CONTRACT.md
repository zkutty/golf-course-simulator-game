# Parkland 4× art contract

The production Parkland terrain contract remains the authority for playable
surface pixels. The habitat-field source in
`src/assets/terrain/parkland-habitat-4x` is a renderer-neutral source
vocabulary. The generated asset bundle itself adds no collision, obstacle,
simulation, save, or picking behavior. Its ZK-1240 runtime consumer is a
separately reviewed integration and remains visual-only.

## Habitat-field vocabulary

`ParklandHabitatFieldManifestV1` defines five semantic families: woodland
floor, understory edge, meadow/deep-rough margin, wet shore, and rock/leaf
transition. Woodland floor and understory edge use the revision-2 dense mask
vocabulary: all 47 normalized blob masks resolve through 14 canonical D4
symmetry classes, with two additional interior variants. The renderer applies
the declared world-space D4 transform through the isometric projection; a
naive screen-space quarter-turn is not equivalent. Meadow, wet-shore, and
rock/leaf families keep the reduced interior, boundary, convex, concave, and
termination vocabulary. All tiers preserve canonical-mask metadata and
projected world-edge anchors. A consumer must derive masks from connected
occupancy and preserve the exact occupancy-to-placement bijection. It must not
place one arbitrary stamp per terrain cell.

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

The asset-generation portion is independently rollbackable and does not modify
the existing Parkland 4× terrain atlas or the legacy 2× rollback. Runtime
adoption is reviewed as a separate ZK-1240 consumer packet. Asset rollback is
deletion of the habitat sidecar source, generator, validator/tests, and package
scripts; consumer rollback removes its imports and composition node. Neither
path changes persisted data.
