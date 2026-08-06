# M60 Vision page art contract

## Purpose

The Vision page is an editorial promise, not a roadmap. New material must feel
like the existing CourseCraft page: warm, hand-crafted, specific about golf,
and generous with quiet space. It must never become a generic game-marketing
template or a list of delivery status.

## Shared visual language

- Keep the existing forest, cream, gold, and rust palette; use the existing
  heading and body typefaces, paper surfaces, cinematic panels, shadows, and
  restrained hover motion.
- Use an elevated oblique viewpoint with readable fairways, greens, bunkers,
  golfers, staff, and course operations. A landscape is not acceptable if golf
  is merely scenery.
- Favor warm natural light, textured planting, believable scale, and a lived-in
  course. Images must have a calm caption-safe area and retain a legible story
  when cropped to a narrow device.
- Do not use embedded words, logos, celebrity/artist imitation, protected
  course likenesses, or caricatured cultural detail.

## Biome gallery requirements

All eight gallery cards receive the same footprint and editorial weight. The
three foundational CourseCraft landscapes are presented as a distinct first
collection, followed by five expanded landscapes; neither collection is a
roadmap or a lower-quality treatment. The first source is 1536px wide or
smaller and must stay at or below 300 KiB; the 768px mobile source should stay
at or below 120 KiB. JPEG is the universal fallback and `picture` selects the
mobile source below 680px.

| Biome | Required read | Exclusions |
| --- | --- | --- |
| Parkland | Traditional wooded inland golf, mature trees, ponds/streams, maintained turf | Generic flat lawn, scenery without golf |
| Links | Exposed coast, dunes/fescue, wind-shaped ground, firm running golf | Inland heathland treatment, resort beach shorthand |
| Desert | Rock/washes, sparse native planting, oasis contrast, deliberately irrigated golf | Unirrigated fairways, empty sandscape, outback cliché |
| Tropical Coastal Resort | Ocean edge, volcanic stone, palms, resort activity, strategic golf | Island-ring/ferry fantasy, tiki shorthand |
| Temperate Japan | Wooded elevation, quiet water, contemporary clubhouse, restrained seasonal cues | Temples, shrines, torii, caricature, copied course identity |
| Alpine Mountain | Conifers, rock, stream, partial high snow, working lodge course | Ski resort, avalanche, buried course |
| Heathland | Inland sandy ground, heather/gorse, pine, firm strategic golf | Sea/coastal links treatment |
| Australian Sandbelt | Pale sculpted bunker work, tea tree/eucalyptus, firm turf | Desert oasis, outback cliché, mascot wildlife |

## Provenance and review

The expanded panoramas and the Parkland/Desert editorial views are original
project assets generated with the built-in image generator. Each of the two
foundational views has a preserved 1672×941 PNG source in
`artifacts/zk-756/source/`, with a 1536×864 desktop JPEG and 768×432 mobile
JPEG shipped from `public/vision/`. Links uses the existing project-owned
coastal-routing panorama and a mobile crop. No third-party imagery is
permitted. All sources require a generic setting, no real-course likeness, no
branding/text, and no artist imitation. Before release, a human reviewer must
confirm golf credibility, crop quality, cultural/ecological appropriateness
where applicable, and that no artifact or unintended likeness remains.

## Content rules

- Never expose issue IDs, milestone numbers, delivery status, or promises of a
  release date to players.
- Describe the enduring experience—design, watch, play, understand, redesign,
  operate, evolve, and remember—not an internal implementation plan.
- Every claim must be grounded in shipped behavior or the approved product
  direction; copy stays concise and remains localized through the catalog.

## Validation gate

Validate desktop, tablet, and phone layout; keyboard focus; reduced motion;
images disabled or failed; share/close behavior; image payloads; offline/PWA
revisit; and an editorial visual review against the three existing Vision
images. The Vision audio mix must also be rechecked with ZK-443 before M60 is
certified.
