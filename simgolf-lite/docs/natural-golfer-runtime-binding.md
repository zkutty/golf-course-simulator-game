# Natural golfer runtime binding v1

October 26, 2026. Implementation decisions for ZK-1416/1417/1418. This adds
explicit rendering bindings to the accepted foundation; it does not alter the
canonical shot clock, immutable art, gameplay position or release gates.

## Generic motion and equipment truth

The first asset certifies one right-handed anatomical full-swing/putt motion
in eight views. Its club silhouette is generic; it certifies no driver, iron,
wedge or putter pixel class. A future validated generic-motion pair may match
the exact hand, target view and stroke role, with an explicit list of compatible
retained equipment classes. It must publish `renderedEquipmentClass: null`.
Classified art still requires an exact class match. Missing hand, unsupported
target/role, missing compatibility or mismatched identity stays neutral.

This distinguishes body-motion compatibility from a claim about the pictured
club. It does not grant current metadata an activity permission automatically.
The binding factory and projector extension require their own tests/review;
existing unsupported-pair tests must remain. Full swing versus putt comes from
the actual retained club and shared plan. Pitch/bunker-specific coverage remains
explicitly generic until separately authored; no physical path is regenerated.

## Stable stance and a named contact datum

Use the immutable first-asset contact model point `(side=7.6, forward=12,
height=1)`, body scale `k=26/48`, contact indices 5/2 and its pinned model version.
Transparent trim/padding never enters this calculation.

Quantize the target's WORLD bearing once to the nearest 45-degree authored
basis, with a deterministic boundary rule. Derive the camera view by cardinal
rotation of that same basis. Do not independently quantize the dimetric
screen direction on every camera rotation: that can change the world stance
for off-octant aims. Unsupported handedness gets no gripping binding.

For retained launch point `B`, compute the projected GROUND-PLANE contact delta
from the selected model basis at height zero. Invert that delta with the shared
`isoToWorld` and derive the visual stance foot point `F = B.xy - deltaWorld`.
Bind F to the full shot owner, authority and surface revision. It remains fixed
through the planted address/strike/watch interval, across camera rotations.
The outer holder remains at authoritative B. Base, tint and separate contact
shadow use the same derived local stance; visual depth uses grounded F.

The ball glyph remains unchanged: both surfaces use center `(0,-2)` relative
to their retained ball anchor; LIVE radius is 2.2px and controlled radius 2.8px.
The named first-asset contact datum is `(0,-k)` relative to that anchor, inside
both glyphs. Do not equate glyph center, physical anchor and club tip. On flat
supported ground the authored tip reaches this datum without moving the ball
or floating the feet. Maximum binding residual is 0.5 logical pixels, and the
actual rendered tip must also lie within the unchanged ball fill at launch.

Sample F using the SAME ground authority as B (frozen round surface for
controlled play, current shared ground for LIVE). Require finite heights,
in-bounds supported footprint, matching revision and a stance radius <=0.35
tiles. Existing walking-support checks must reject water, buildings and blocked
decoration footprints. If support/contact residual fails, use a neutral pose;
do not vertically move feet, move the ball or invent a route to force contact.

## Arriving, planting and releasing

The simulation's walking destination is the ball/address anchor B, not a new
stance route. A small, supported visual foot-placement adjustment from current
arrival to F is permitted within the EXISTING pre-backswing settle/address
window: at most 800ms swing / 400ms putt, with no additional clock or dwell.
This is a local stance footprint, not a change to simulation movement/accounting.
Every intermediate footprint must remain supported; maximum logical motion is
32px/s. The body/gait must express the adjustment rather than slide planted
feet. Until compatible arrival or the validated adjustment is available, retain
the neutral fallback. ZK-1417 owns that transition; a contact helper alone must
not pretend it solved walking continuity.

Once planted, hold F through watch. Release using current observed walking
authority only. Pause/hidden holds valid planted output; owner/scope/surface
replacement discards it before publication. Reload/late acquisition may use a
validated settled initial pose without replaying a foot adjustment or reaction.

## Required checks before enabling gripping art

The shared activity admission timestamp may keep advancing while only LIVE or
only controlled play is paused. A valid paused actor keeps its exact body pose,
root, shared cursor and movement distance. Only its transient retention start
is shifted by the observed held interval. This permits a common monotonic
admission timestamp without adding an actor clock or freezing another domain.
Ownership, surface and route invalidation still precede any held publication.

Eight views and four rotations, off-octant/boundary bearings, exact shared
launch samples, stable world feet/shadow/depth, unchanged retained ball samples,
named glyph/contact overlap, native trim geometry, safe/blocked/sloped support,
owner/revision/reload/hidden invalidation, and walk/settle/watch/release continuity.
All motion uses the existing shared cursor or authoritative walking distance.
The helper must not publish routes, change completion/hold ownership or mutate
gameplay. Real PNG/in-world/full-hole human acceptance remains a later gate.
