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

## Candidate metadata audit appendix (P3)

`auditWildlifeCandidate(atlas, provenance)` in
`src/game/wildlife/candidateAudit.ts` consumes the existing candidate interfaces
as untrusted input. It returns `structuralErrors`, `productionBlockers` and a
literal `productionEligible: false`. Complete synthetic metadata may have zero
structural errors; no declared license, permitted redistribution, named reviewer
or approved decision establishes actual rights or human approval. Private-only
redistribution and rejected decisions add explicit production blockers. All
results still require authoritative external rights, exact-byte provenance and
human adoption/review proof, which this packet does not implement or certify.

Pivot coordinates are normalized to the declared source canvas, using the
bible's explicit G `(0.5, 1)` convention. G and W require `[0.5, 1]`; P retains
an in-bounds declared foot pivot and nonempty natural-support declaration so a
tail may extend below contact; F declares an interior body pivot and no natural
support. The audit cannot identify a foot/body/support in pixels. Quiet-flight
uses F and the Flight `96×64` source canvas, including S/M birds; other cycles
use the species' non-Flight source canvases. Perch/branch-walk require P,
remote-travel requires G, and W is reserved for waterbird still/glide. Registry
clip restrictions still override family availability, including flight-only
mallards and the sole Desert roadrunner travel exception. Canvas dimensions,
two-pixel gutter and declared two-pixel drift ceiling use source pixels at 2×;
pivot coordinates do not. At least five authored direction rows are required;
mirror/anatomy/light suitability requires later visual review.

The audit checks owned roster identity, family/clip/frame/fps compatibility,
canvas/anchor/pivot declarations, required own fields, SHA-256 syntax and
cross-record identity, reference IDs/hashes, cleanup descriptions/terminal hash,
calendar-valid ISO dates or UTC timestamps, and all six review records. The
atlas source hash denotes the exact candidate image bytes and must match the
provenance production hash; every review must reference that hash. Empty cleanup
lineage is permitted only when raw and production hashes match; otherwise the
last cleanup hash must match production. Intermediate parent relationships are
not present in the existing interface and cannot be proved. Date-only records
compare calendar days; timestamps compare instants when both have that precision.
No hashes are computed, evidence links fetched, dates authenticated, reviewers
verified or approval service enforced.

The interfaces have no per-frame rectangles/contact measurements, per-cycle
transition pivot pairs, support geometry or flight height field. Structural
completeness therefore does not certify atlas packing/ownership of every frame,
visible-contact drift, cross-cycle attachment transitions, natural support,
flight height, transparent padding, lighting, silhouettes, welfare, locality,
accessibility, delivery or runtime spatial safety. Those remain future measured
and human gates. There are no asset references, runtime consumers or activation
changes here. Negative tests cover malformed and incompatible metadata, exact
hash/date/lineage/review mismatches, private-only/rejected declarations and a
fresh import/audit with a throwing fetch spy and zero requests. Rollback removes
the two candidate audit files and this appendix; no save or asset migration is
required.
