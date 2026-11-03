# Wildlife population and presentation contract

ZK-658 acceptance reconciliation, 2026-11-03. This document defines a proposed
runtime contract for a later habitat/runtime packet. It adds no runtime
behavior, approved limit, asset, production permission, or human review result.

## Authority and conflicting limits

The original [ZK-658 issue](https://linear.app/zkutty/issue/ZK-658/derive-deterministic-habitat-maps-and-bounded-daily-populations)
requires visible actor caps of High/Full 24, Medium/Full 16, and Low/Full 8;
Reduced halves each cap; Off yields zero. It also requires logical populations
to remain invariant under camera pan, zoom, rotation, culling, and render quality.
These are the runtime issue's acceptance inputs.

The released [ZK-657 content bible](WILDLIFE_CONTENT_BIBLE.md#proposed-density-delivery-and-quality-limits)
proposes per-viewport caps of High 4 groups / 12 individuals, Medium 2 / 6,
and Low 0 / 0. It allows at most 2 / 1 traveling groups at High / Medium and
at most 1 flight group at either tier. Low omits wildlife sprites, detail, and
dedicated wildlife audio. The [ZK-660 registry contract](WILDLIFE_REGISTRY_CONTRACT.md#closed-definitions)
marks these limits as proposed authoring targets, not a runtime consumer or
measured performance. `src/game/wildlife/contracts.ts` encodes those same
High 4/12, Medium 2/6, Low 0/0 targets; it has no Reduced or Off population
semantics. Its registry tests verify the declarations, not runtime population
behavior (`src/game/wildlife/registry.test.ts`).

The conservative reconciliation proposed here is to use the lower applicable
individual cap where both documents specify one: Full High 12, Full Medium 6,
and Full Low 0. This preserves ZK-658's ceiling while honoring the stricter
released authoring targets. Low remains an unresolved intended-behavior decision:
0/0 satisfies ZK-658's maximum of 8, but may not satisfy the intended Low-tier
support if its intended behavior requires visible wildlife. Resolve whether Low
permits omission or expects a nonzero population before runtime acceptance. The
12/6/0 reconciliation is a proposal for discussion, not an approval or change
to either source.

| Setting | Proposed maximum visible groups | Proposed maximum visible individuals | Additional proposed constraints |
| --- | ---: | ---: | --- |
| High / Full | 4 | 12 | ≤2 traveling groups; ≤1 flight group |
| Medium / Full | 2 | 6 | ≤1 traveling group; ≤1 flight group; no multi-bird flight group |
| Low / Full | 0 | 0 | No wildlife sprites, dedicated wildlife audio, or wildlife payload/residency |
| High / Reduced | 2 | 6 | Apply whole-group admission; no partial group |
| Medium / Reduced | 1 | 3 | Apply whole-group admission; no partial group |
| Low / Reduced | 0 | 0 | Same omission as Low / Full |
| Any tier / Off | 0 | 0 | No presentation actors, wildlife audio, or wildlife asset requests |

For Reduced, this proposal halves each reconciled Full cap independently; all
values are even, so no fractional rounding is needed. A selected group is
admitted atomically: it must fit both remaining caps and retain its registry
minimum. If it does not fit, omit that group rather than truncate it below its
minimum or substitute a solitary animal for a designated mob/flock. Thus the
caps are maxima, not a promise to fill the viewport. Existing registry ranges,
including the minimum of three for herring-gull flocks and eastern-grey-kangaroo
mobs, remain controlling (`src/game/wildlife/registry.ts`).

## Logical population and presentation

Derive a deterministic logical set of eligible group records from the course /
estate seed, week, day, time bucket, climate phase, weather, biome, habitat,
season, and disturbance inputs. A record carries stable identity, species,
selected habitat, group size, and deterministic activity phase. The same
population inputs must yield identical records across reload and across camera,
quality, Reduced, and Off settings. This preserves ZK-658's camera/quality
invariance; camera culling and render budgets never select, delete, or reseed
logical groups.

Treat view selection and rendering as a separate projection over those records.
Apply the selected quality / motion / Off cap, camera visibility, and approved
asset availability to decide which group presentation may be instantiated.
Quality changes can alter which eligible groups are presented, their detail, and
whether animation is static, but never the logical set or its identities. Use a
stable deterministic priority over eligible records when presentation caps bind,
so camera movement does not change which groups exist. Culling suppresses drawing
and per-frame presentation work only; it does not mutate population state.

Off is a presentation and resource gate over the same deterministic logical
population: expose zero wildlife actors or audio, do not load/request wildlife
assets, and do not schedule wildlife animation work. If a later implementation
needs to avoid even deriving logical records while Off is selected, it must
preserve an equivalent deterministic source so toggling Off cannot change the
subsequent population. This specific Off behavior remains a runtime acceptance
decision, not an existing ZK-660 capability.

## Eligibility, omission, and remaining decisions

Habitat selection remains deterministic and bounded for the 220×140 estate,
using the ZK-658 inputs and avoiding buildings, roads, maintained play, active
shot corridors, unsuitable water, and recent disturbance. Strong storms and
incompatible season/weather suppress activity declaratively. Where a complete
group and its applicable spatial buffer do not fit, produce no presentation.
Do not create approach/chase behavior. These are future runtime acceptance
gates; ZK-660 currently supplies authoring metadata and audits only.

`WILDLIFE_DELIVERY_CONTRACT` specifies selected-biome-and-quality-only loading,
zero unselected requests and shell precache assets, and `missingOrUnapproved:
"omit"` (`src/game/wildlife/contracts.ts`). ZK-660 records planned ownership,
`fallback: "omit"`, empty asset references, and pending ecology, welfare,
cultural, visual, audio, and provenance reviews (`src/game/wildlife/registry.ts`).
Accordingly, a missing or unapproved group asset omits its presentation while
preserving its logical candidate identity; it does not trigger a replacement
species, a cross-biome request, or a guessed asset. If every candidate is
missing/unapproved, the view is empty. An authoring profile or target value does
not certify an asset or any approval.

Before ZK-658 runtime acceptance can be claimed, a later packet must resolve:

- Whether the original Low/Full allowance of 8 actors is intentionally replaced
  by Low's released 0/0 omission target, or whether a nonzero Low target should
  be proposed in a recorded content-contract revision.
- Whether Full/Reduced caps are viewport-wide as proposed above and how ties in
  stable presentation priority are keyed. The logical population itself remains
  camera-invariant either way.
- Whether Off retains derivable/cached logical records as proposed, while
  guaranteeing zero actor instances, audio, asset requests, and animation work.
- Whether the chosen habitat cache invalidation inputs include every geometry,
  biome, season, weather, and disturbance dependency in ZK-658.

## Future testable acceptance cases

The runtime packet should add deterministic fixtures that prove:

1. Identical population inputs produce byte-for-byte identical group identities,
   species, habitat, sizes, and phases after reload.
2. Changing only camera pan, zoom, rotation, viewport, culling, or render quality
   leaves the logical population identical; only the projected presentation
   changes.
3. High/Full, Medium/Full, Reduced, Low, and Off never exceed the reviewed
   group/individual caps; groups are admitted whole and roster minima are kept.
4. Off presents zero actors, emits zero wildlife audio, requests/loads no
   wildlife assets, and schedules no animation. A toggle back on restores the
   same logical identities.
5. Low omission and missing/unapproved assets yield no wildlife presentation;
   unselected biomes issue zero requests; no substitute or cross-biome asset is
   selected.
6. Building, road, maintained-surface, unsuitable-water, active-corridor,
   disturbance, insufficient-habitat, storm, and invalid-season fixtures
   suppress ineligible groups and produce no approach/chase loop.
7. Habitat work remains bounded at 220×140 and is not recomputed per frame; the
   chosen cache invalidates when each relevant input changes.
8. Wildlife on/off and every quality/camera setting leave authoritative game
   state, course state, package state, simulation outcomes, and authoritative
   hashes unchanged.

Passing documentation review or authoring audits cannot pass these runtime
cases. No production asset, ecological/welfare/cultural/art/audio approval,
performance result, or runtime activation is inferred here.
