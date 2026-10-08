# Wildlife registry authoring foundation

ZK-660 bounded foundation, 2026-10-08. This implements declarative authoring
metadata and audit gates. It does not implement wildlife rendering, population
simulation, audio, asset loading, spatial eligibility or production approval.
The [ZK-657 bible](WILDLIFE_CONTENT_BIBLE.md) remains the content authority.

## Ownership and staging

`BiomeDefinition.content.wildlife` requires a same-biome profile and bundle
owner for Parkland, Links and Desert, with `delivery: planned` and `fallback:
omit`. This addition is authoring metadata, not a serialized save or atlas
schema change. `BIOME_KEYS`, save compatibility and content versions stay
unchanged. Missing ownership fails typecheck or the authoring audit.

The separate authoring registry contains eight settings and exactly 35 entries
(5/4/4/4/4/4/5/5). Tropical Coastal Resort, Temperate Japan, Alpine Mountain,
Heathland and Australian Sandbelt stay staged. Registering a wildlife profile
does not register a playable biome. Future settings cannot be admitted through
the current playable ownership audit.

Every profile has pending ecology, welfare, cultural, visual, audio and
provenance reviews, an empty asset-reference list and omission fallback. An
invented approval, asset URL, cross-biome owner or production delivery marker
fails the audit. Informational ecology links grant no image or recording rights.

## Closed definitions

The pure `src/game/wildlife/contracts.ts` module defines scale/canvas, attachment,
habitat, activity/season, adult-group, family/clip, candidate atlas metadata and
candidate provenance interfaces. Families A–J carry proposed frame/fps targets.
The registry retains each bible row's silhouette and audio description.

Proposed tier, delivery and quiet-audio limits are authoring targets only. They
do not add to or change existing M35 ceilings and are not measured performance.
Low/unapproved/missing content is omitted; future delivery must remain selected
biome/quality only with no shell precache requirement. No asset loader or
runtime scheduling consumes these definitions in this packet.

The newer bible excludes feeding, grazing and foraging. Older ZK-660 wording
that listed `forage` does not authorize a clip: unknown/prohibited clips fail.
Ground-nesting restrictions override family movement. Mallard wording in the
bible is internally conservative: its row permits water/flight anchors and D
defines glide, while the overriding restriction allows only perch/flyover/call.
This foundation preserves the row's family and anchors but stages only quiet
flight for mallards until review resolves water animation. Other restricted
birds permit natural perch/quiet flight only. The remote-travel cycle is an
explicit exception solely for Desert's greater roadrunner.

Groups above two adults use the more conservative five-tile buffer, as do
large silhouettes; all other groups use three. The mob/flock minimum remains
three, never a solitary fallback. Nightjars are summer-only. Silent roster
entries remain silent. All these are future staging requirements, not runtime
or real-world safety certification.

## Audit and remaining gates

`auditWildlifeRegistry` independently checks closed enums, setting and ownership
identity, family/clip/attachment compatibility, nesting restrictions, ranges,
unique IDs, season constraints and pending approval/assets. Exact canonical
pins additionally prevent accidental roster alteration. Independent tests read
the bible's table rows to verify all 35 labels, silhouettes, scales, anchors,
families and adult ranges. A bad canonical forbidden clip fails semantic checks
even when the canonical registry itself is the audit input.

The existing biome authoring report exposes these errors as required findings;
its report version, categories, manifest and payload calculations are unchanged.
Negative controls cover missing ownership, cross-biome/future ownership,
forbidden/incompatible clips, malformed content and fabricated approval. A
fresh module import with a throwing fetch spy proves the definitions issue no
asset requests. Source inspection must also confirm that only authoring/testing
code imports the runtime registry and the biome model imports contract types.

ZK-660 remains open. Renderer/audio/fixture consumer integration, scenic
metadata migration, approved assets, selected-biome loading, manifest ownership,
measured payload/residency/performance, spatial/welfare certification and human
reviews remain later packets. None is inferred passing from this foundation.
