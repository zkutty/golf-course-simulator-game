# Wildlife ecology, welfare, and content bible

ZK-657 documentation packet, 2026-10-08. Status: proposed production direction;
no wildlife assets, runtime feature, ecological approval, cultural approval, or
human art/audio approval is certified by this document. It fixes the roster and
authoring decisions for subsequent implementation packets. The measurable
limits below are **proposed design targets**, not observed performance, animal
measurements, safe real-world approach distances, or completed review results.

## Purpose and authority

Wildlife is world-only, quiet landscape life viewed at wild distance. Golf,
course readability, and ordinary club activity remain primary. Wildlife has no
economy or simulation effects: no effects on money, rating, demand, prestige,
maintenance, turf condition, weather, golfer/staff state, collision, ball flight,
rules, or course availability. No wildlife tools, placement menu, inspector,
journal, notifications, achievements, collection checklist, rewards, unlocks,
or player interaction are permitted. Habitat can inform visual eligibility;
it never becomes a new habitat-management score or operating system.

This document inherits [ART_GUIDE.md](../ART_GUIDE.md),
[M35_ART_CONTRACT.md](M35_ART_CONTRACT.md),
[PARKLAND_4X_ART_CONTRACT.md](PARKLAND_4X_ART_CONTRACT.md),
[M60_VISION_ART_CONTRACT.md](M60_VISION_ART_CONTRACT.md), and
[PIXELLAB_ART_PIPELINE.md](PIXELLAB_ART_PIPELINE.md). The expanded settings retain
the [Tropical](biomes/TROPICAL_COASTAL_RESORT_CONTENT_BIBLE.md),
[Japan](biomes/TEMPERATE_JAPAN_CONTENT_BIBLE.md), and
[Alpine](biomes/ALPINE_MOUNTAIN_CONTENT_BIBLE.md) boundaries. Their existing
project-owner decisions do not constitute approval of this wildlife packet.

The roster below is closed: 35 biome entries, including European rabbits in
both Links and Heathland. No pets, livestock, fantasy animals, mascot poses,
anthropomorphic reactions, costumes, speech, or named collectible individuals.
Broad family labels intentionally stay broad: exact taxon, source locality,
and recording identity must be documented before production approval. A family
label does not authorize mixing incompatible local populations in one setting.

## Welfare and spatial rules

- Prohibit feeding, baiting, handouts, grazing/foraging animations, attacks,
  injury, distress, predation, breeding, mating displays, nests, eggs, young,
  joeys, roadkill, turf damage, wildlife closures, culling, trapping, handling,
  chasing, or animal rescue gameplay. These exclusions apply to sprites,
  audio, prompts, staged screenshots, prose, and animation transitions.
- Ground-nesting birds use quiet flyover, natural perch, or distant call only.
  Never add interactable nests, burrows, chicks, ground-search behavior, nesting
  props, or nest discovery cues. This restricted presentation also applies to
  mallards, oystercatchers, quail, green pheasants, ptarmigan, and nightjars;
  their representation need not show every real behavior. Quail/pheasant/
  ptarmigan perches mean low natural rock or woody cover beyond play, not an
  implausible high-tree pose.
- Proposed exclusion distance: all ground/water anchors and projected landing
  targets remain at least 3 world tiles from maintained tee/fairway/green/bunker,
  paths/roads, buildings, service circulation, and occupied golfer/staff/cart
  positions. Large mammals, mobs, and flocks require 5 tiles. Measure from the
  nearest footprint edge, not its center. These are compositional buffers;
  they are not public wildlife-safety guidance.
- Flight remains beyond the active hole corridor and building footprint plus
  the same buffer in plan view. No flying through roofs/canopies or crossing
  balls, shot lines, cup/flag silhouettes, selection rings, or functional
  accessibility patterns. Perches attach to verified natural branches/rocks;
  wildlife never perches on flags, carts, buildings, benches, or equipment.
- Eligible habitat must support the complete group and its buffer. If it cannot,
  omit the appearance. A sparse or entirely absent wildlife view is valid.
  No concentration at food/service bins, artificial feeders, roads, or players.
- A changed course layout or passing actor must not create an approach/chase
  loop. Suppress the appearance or retire it beyond view with no alarm, panic,
  forced rerouting of play, or repeated respawn at the same boundary. A proposed
  60-second minimum appearance cooldown prevents boundary flicker.
- Paused scenes stop wildlife animation/progression. Reduced motion uses a
  static valid natural pose or omits flyovers and traveling groups; no looping
  wingbeats, hopping, blinking flashes, surprise motion, or camera follow.
  No meaning, progress, or gameplay information depends on wildlife or its sound.

## Art, scale, silhouette, and anchors

Retain the existing 64×32 logical 2:1 dimetric world tile, fixed NW light,
transparent RGBA sprites, locally darkened outline, restrained palette, and
2–4 value steps per surface. Separate the soft SE shadow from the animal; do
not bake terrain diamonds, long cast shadows, motion streaks, text, or glow.
Author at 2× logical size and atlas-pack with the existing two-pixel gutter.
These wildlife canvases are proposed additions to the art vocabulary, not
changes to the golfer's 48×72 frame contract or existing prop canvases.

| Scale class | Proposed logical occupied bounds (width × height) | Source canvas at 2× | Anchor contract |
| --- | --- | --- | --- |
| XS | 8–14 × 4–10 px | 32×32 px | Ground contact G |
| S | 14–22 × 10–18 px | 48×48 px | G; water W for mallards |
| M | 22–34 × 16–30 px | 80×80 px | G or natural perch P |
| L | 30–44 × 28–44 px | 96×112 px | G; no overlap with a golfer |
| Flight | 18–42 × 8–24 px wingspan/body silhouette | 96×64 px | Flight F |

G is bottom-center `(0.5, 1)` at foot/tail support contact after transparent
padding normalization; visible contact must lie within two source pixels of
the declared point. W is the bottom-center hull/waterline contact with no feet
or terrestrial shadow on water. P is bottom-center foot contact with a declared
natural support point; perched tails can extend below the contact, so the
metadata pivot, not trimmed-image bottom, is authoritative. F is a declared
body-center pivot and height over a projected world point, with no ground
contact/baked shadow. All frames in an animation cycle use the same declared
canvas and pivot; metadata declares the ground/water/perch-to-flight pivot
change explicitly between cycles. Feet/perch/water contact may drift at most
two source pixels across a cycle. Body motion is allowed without moving that
attachment accidentally.

At 50%, 100%, and 200% zoom, all four camera rotations must preserve attachment,
lighting, and a distinctive outline. At overview, small wildlife may disappear
cleanly rather than be enlarged into a ball/marker lookalike. At 100% each
retained entry must retain its stated shape cue without color. Do not make
identification depend on tiny eyes, antlers, a blue tongue, red bill, or crest
color. Standard and all three color-vision transforms retain outline/pattern
identity. Avoid white circle, glowing speck, flag-like triangle, or aim-line
shapes that could be read as functional golf graphics.

## Closed animation families

These are authoring families, not a runtime schema. Share timing structure and
cleanup methods while retaining each animal's outline and suitable locomotion.
Use five authored direction rows plus mirrored alternatives only when anatomy
and fixed-NW lighting survive the mirror; otherwise author the additional rows.
No animation needs player input or contact/reaction frames.

| Family | Proposed loops / frames | Timing target and constraint |
| --- | --- | --- |
| A: hoofed | idle 2, slow walk 6 | 2 fps idle / 6 fps walk; no grazing or antler combat |
| B: long-ear | idle 2, gentle hop 6 | 2 / 6 fps; distinct hare/rabbit ear and leg proportions |
| C: arboreal | perch 2, branch walk 6 | 2 / 6 fps; no food, nest, or acrobatic jumps |
| D: waterbird | still 2, glide 4, quiet flight 6 | 2 / 4 / 6 fps; no splash or diving/feeding |
| E: long-leg bird | perch/stand 2, quiet flight 6 | 2 / 6 fps; no fish capture, stalk, or strike |
| F: small/medium bird | natural perch 2, quiet flight 6 | 2 / 6 fps; no courtship or ground foraging |
| G: reptile | rest 2, slow crawl 4 | 2 / 4 fps; no threat display or prey |
| H: crab | still 2, lateral scuttle 4 | 2 / 4 fps; no burrow, eggs, debris feeding |
| I: marmot | rest 2, slow walk 6 | 2 / 6 fps; no alarm/sentinel escape or burrow |
| J: macropod | rest 2, calm hop 6 | 2 / 6 fps; adult silhouettes only, no boxing/joey |

Calls are separate ambience events, never lip-synchronized prompts or rewards.
Ground-nesting restrictions override a family's otherwise available movement.
Greater roadrunners use F with an additional proposed 6-frame calm travel cycle
only in remote scrub; no stalking, pursuit, or predation. Ravens/gulls use a
slow glide hold between flight beats; no menacing circles around play.

## Exact biome roster

Every row fixes proposed scale, distinctive silhouette, animation, group cap,
habitat, activity window, and audio treatment. Numbers are visible adult counts
per group, not ecological population estimates. Each row inherits the spatial,
global density, quiet-call, and quality-tier limits. Time windows are proposed
staging preferences, not a claim that every member of a broad family shares
one schedule. Out-of-window wildlife is absent, not replaced by new species.

### Parkland

Use generic wooded inland golf with remote woodland/meadow and pond edges.
It must remain distinct from inland British Heathland. Broad woodland-deer,
cottontail, tree-squirrel, and shoreline-heron identities require one coherent
locality review before species-specific art is adopted.

| Entry | Scale; silhouette; anchor | Family; adult group | Habitat / proposed activity | Audio |
| --- | --- | --- | --- | --- |
| Woodland deer | L; four-legged narrow body, upright ears; G | A; 1–2 | Remote woodland edge; dawn/dusk | Silent |
| Cottontail rabbits | S; rounded body, short tail, upright ears; G | B; 1–2 | Shrubby meadow margin; dawn/dusk | Silent |
| Tree squirrels | S; curved bushy tail, compact body; P/G | C; 1–2 | Woodland branch/floor beyond play; day | Silent |
| Mallards | S; low broad waterbird hull; W/F | D; 2–4 | Sheltered pond outside golf carry/corridor; day | Sparse distant quack, no feeding calls |
| Shoreline heron | M; long legs, long bill, folded-neck profile; P/F | E; 1 | Remote natural wet-shore perch; day | Silent |

### Links

Use an exposed temperate Atlantic coast, dune grass, rock, and remote shore.
Oystercatchers are a recognized ground-nesting coastal bird; RSPB's field
guidance is the reason to omit nests and keep presentations distant.
[RSPB ground-nesting guidance](https://www.rspb.org.uk/birds-and-wildlife/ground-nesting-birds).

| Entry | Scale; silhouette; anchor | Family; adult group | Habitat / proposed activity | Audio |
| --- | --- | --- | --- | --- |
| Brown hares | M; longer legs/ears than rabbits; G | B; 1–2 | Remote dune-grass margin; dawn/dusk | Silent |
| European rabbits | S; compact round haunches, shorter ears; G | B; 1–3 | Remote grassy dune edge; dawn/dusk | Silent |
| Oystercatchers | S; stout straight bill and contrasting body blocks; P/F | F; 1–2 | Remote coastal rock perch or flyover; day | Single distant call |
| Herring gull flocks | Flight/M; broad tapered wings, substantial bill; F/P | F; 3–5 | Outer coastal flyover/remote rock; day | Sparse distant gull call, no food-seeking chorus |

### Desert

Use a Sonoran-inspired scrub/wash palette. NPS documents black-tailed
jackrabbits, Gambel's quail, roadrunners, and desert spiny lizards at Saguaro.
Quail's topknot and the roadrunner's long tail/crest are useful silhouette cues;
their feeding and predation behaviors are excluded here.
[NPS rabbits](https://www.nps.gov/sagu/learn/nature/rabbits-of-saguaro-national-park.htm),
[NPS signs of life](https://www.nps.gov/sagu/learn/nature/signs-of-life.htm).

| Entry | Scale; silhouette; anchor | Family; adult group | Habitat / proposed activity | Audio |
| --- | --- | --- | --- | --- |
| Black-tailed jackrabbits | M; very long ears/legs, narrow dark tail tip; G | B; 1–2 | Remote scrub/wash edge; dawn/dusk | Silent |
| Gambel's quail | S; compact body, curved topknot; P/F | F; 2–4 | Low natural rock/scrub perch or quiet flyover; dawn/dusk | Sparse distant contact call |
| Greater roadrunners | M; long tail, crest, low horizontal body; G/P/F | F + remote travel; 1 | Remote open scrub away from lizards; morning/late day | Silent |
| Desert spiny lizards | XS; low pointed body, long tapering tail; G | G; 1–2 | Remote sunlit natural rock; mild daylight | Silent |

### Tropical Coastal Resort

Keep the existing one-ocean-edge, volcanic-coastal resort direction. This is a
generic composition, not a claim that any gecko, fruit dove, egret, and crab
can share any island. Exact regional taxa must pass the ecological gate;
retain the four roster labels while withholding incompatible candidate art.
NPS describes beach ghost crabs' sand-colored bodies and dusk/night activity;
that Atlantic example supports the restrained beach/dusk vocabulary, not an
automatic species selection for this generic resort.
[NPS ghost crabs](https://www.nps.gov/foma/learn/nature/ghost-crabs.htm).

| Entry | Scale; silhouette; anchor | Family; adult group | Habitat / proposed activity | Audio |
| --- | --- | --- | --- | --- |
| Geckos | XS; flattened body, splayed toes, tapering tail; G/P | G; 1–2 | Remote volcanic rock/natural bark; dusk | Silent |
| Ghost crabs | XS; broad low carapace, sideways leg spread; G | H; 1–3 | Remote ocean beach above waterline; dusk/night | Silent |
| White egrets | M; long legs/neck and narrow bill; P/F | E; 1–2 | Remote lagoon/wet-edge natural perch; day | Silent |
| Fruit doves | S; rounded dove body, small head, short bill; P/F | F; 1–2 | Remote broad-leaf canopy; day | Sparse soft distant dove call |

### Temperate Japan

Contemporary woodland golf remains primary. Sika deer and Japanese hares are
quiet wild fauna, not shrine/temple companions or feeding-park interactions.
Japan's environment ministry documents sika deer and woodland green pheasants;
this does not approve a real-course or culturally symbolic recreation.
[Ministry wildlife reference](https://www.env.go.jp/nature/kisho/pamphlet/pdf/wildlife_en.pdf),
[Ministry Karuizawa sanctuary guide](https://chubu.env.go.jp/shinetsu/content/000060536.pdf).

| Entry | Scale; silhouette; anchor | Family; adult group | Habitat / proposed activity | Audio |
| --- | --- | --- | --- | --- |
| Sika deer | L; compact deer body, upright ears, restrained coat pattern; G | A; 1–2 | Remote woodland edge; dawn/dusk | Silent |
| Japanese hares | M; long-ear/long-leg outline, quiet neutral coat; G | B; 1–2 | Remote woodland clearing margin; dawn/dusk | Silent |
| Green pheasants | M; long tapering tail and small head; P/F | F; 1–2 | Low natural woodland-edge perch or flyover; morning | Sparse distant call |
| Grey herons | M; long legs/bill, folded neck; P/F | E; 1 | Remote stream/pond natural perch; day | Silent |

### Alpine Mountain

Place wildlife in remote meadow, rock, and conifer edges below the distant
ridge spectacle. Swiss National Park lists marmots, mountain hares, and
ptarmigan in its high-country fauna; the game's reserved groups are a visual
abstraction, not wildlife population simulation.
[Swiss National Park animals](https://nationalpark.ch/en/nature/animals/).

| Entry | Scale; silhouette; anchor | Family; adult group | Habitat / proposed activity | Audio |
| --- | --- | --- | --- | --- |
| Alpine marmots | M; squat body, short ears, heavy low tail; G | I; 1–3 | Remote meadow beside natural rock; mild day | Silent; no alarm whistle |
| Mountain hares | M; long ears/hind legs, seasonal coat with persistent outline; G | B; 1–2 | Remote meadow/conifer margin; dawn/dusk | Silent |
| Rock ptarmigan | S; rounded body, short bill/tail; P/F | F; 1–2 | Remote high natural rock or quiet flyover; mild day | Sparse distant call |
| Ravens | M/Flight; heavy bill, wedge-like tail, broad wing profile; P/F | F; 1–2 | Remote rock/conifer perch or ridge flyover; day | Single soft distant call |

### Heathland

Use inland sandy heather/gorse/pine; no coastal gull scene or ocean audio.
RSPB associates stonechats and nightjars with heathland and describes nightjars
as dusk-active, seasonal visitors. Adopt quiet dusk flight/call without
courtship, hunting, or nest imagery; do not stage winter nightjars.
[RSPB heathland](https://www.rspb.org.uk/birds-and-wildlife/habitats/heathland),
[RSPB nightjars](https://www.rspb.org.uk/birds-and-wildlife/identifying-birds/all-about-nightjars).

| Entry | Scale; silhouette; anchor | Family; adult group | Habitat / proposed activity | Audio |
| --- | --- | --- | --- | --- |
| European rabbits | S; round haunches, shorter ears; G | B; 1–3 | Remote grass/heather edge; dawn/dusk | Silent |
| Roe deer | L; slim deer body, prominent upright ears; G | A; 1–2 | Remote woodland/heather margin; dawn/dusk | Silent |
| Stonechats | S; small upright bird, compact head and tail; P/F | F; 1–2 | Remote gorse natural perch; day | Sparse distant short call |
| Nightjars | Flight/S; pointed wings, long tail, low profile; F/P | F; 1 | Remote clearing flight/branch; summer dusk | Brief distant non-courtship call; omit if recording context is uncertain |
| Sand lizards | XS; low long body with stripe/block pattern; G | G; 1–2 | Remote sandy/heather edge natural rock; mild daylight | Silent |

### Australian Sandbelt

Use south-eastern woodland/tea-tree/eucalyptus framing beside strategic firm
golf. Eastern grey kangaroos have characteristic hind legs and balancing tails;
kookaburras and sulphur-crested cockatoos have recognizable natural silhouettes.
Actual mob sizes and loud calls do not set game density or mix levels. Museum
descriptions support these cues; no feeding, attack, predation, branch damage,
mascot behavior, or Indigenous cultural motifs are transferred to the game.
[Australian Museum kangaroo](https://australian.museum/learn/animals/mammals/eastern-grey-kangaroo/),
[kookaburra](https://australian.museum/learn/animals/birds/laughing-kookaburra/),
[cockatoo](https://australian.museum/learn/animals/birds/sulphur-crested-cockatoo/),
[blue-tongue lizard](https://australian.museum/learn/animals/reptiles/eastern-blue-tongue-lizard/).

| Entry | Scale; silhouette; anchor | Family; adult group | Habitat / proposed activity | Audio |
| --- | --- | --- | --- | --- |
| Eastern grey kangaroo mobs | L; long hind feet, small forearms, heavy balancing tail; G | J; 3–5 | Remote woodland/meadow edge; dawn/dusk | Silent |
| Laughing kookaburras | M; large blocky head/bill, broad tail; P/F | F; 1–2 | Remote eucalyptus branch; morning/late day | Brief distant natural call, no comic laugh or territorial scene |
| Sulphur-crested cockatoos | M; curved bill and upright crest outline; P/F | F; 2–4 | Remote woodland perch/flyover; day | Softened sparse distant call, no sustained screech |
| Australian magpies | M; long straight bill, sturdy body, contrasting shape blocks; P/F | F; 1–3 | Remote open-woodland natural perch; day | Sparse distant warble; no swooping/alarm |
| Blue-tongue lizards | S; thick low body, short legs, tapering tail; G | G; 1–2 | Remote warm rock/woodland floor; mild daylight | Silent; no tongue threat display |

## Proposed density, delivery, and quality limits

| Tier | Visible group/individual cap per viewport | Motion and detail | Wildlife payload target |
| --- | --- | --- | --- |
| High | 4 groups / 12 individuals | At most 2 traveling groups; at most 1 flight group; full approved cycles | ≤512 KiB compressed art per selected biome; ≤4 MiB decoded RGBA |
| Medium | 2 groups / 6 individuals | At most 1 traveling group; no multi-bird flight group; simplified approved cycles | ≤256 KiB compressed art per selected biome; ≤2 MiB decoded RGBA |
| Low | 0 / 0 | Omit wildlife sprites/detail and dedicated wildlife audio | 0 additional wildlife payload/residency |

Group limits and individual limits both apply. Medium may show three members
of a kangaroo mob or gull flock; if the minimum group cannot fit, omit it. Other
group counts may reduce to their roster minimum. No solitary version of a
roster-designated mob/flock is substituted to meet a budget. Offscreen groups
consume no frame updates; no extra wildlife per hole, tile, or building. These
targets must be profiled in a later runtime packet before they become certified.

Only selected biome/quality wildlife is eligible for loading, through the
existing lazy, hashed, biome-owned asset boundary. No unselected-biome prefetch,
provider calls, credentials, new shell precache requirement, or offline network
dependency. Missing/unapproved assets omit the appearance. Low remains M35's
detail-free fallback. Wildlife is an allocation inside, not an addition to,
M35's existing 8 MiB individual atlas, 6 MiB selected-biome bundle, and 8 MiB
compressed critical-load caps. A proposed dedicated call bank is capped at
128 KiB compressed per selected biome, counted in delivery totals; reused beds
must not be credited as new licensed species recordings.

## Proposed quiet-audio contract

Wildlife is optional ambience through the existing master/ambience controls
and seasonal/weather priority. It never introduces a notification/SFX reward,
autoplay before audio unlock, independent volume preference, or second bird
bed. Current procedural bird synthesis has unmeasured loudness and is not a
verified species recording ([seasonalAmbience.ts](../src/audio/seasonalAmbience.ts)).
Numeric limits here are proposed mastering targets for future authored calls.

- At most one foreground wildlife call at a time; at most 3 short call events
  in any rolling 60 seconds; at least 20 seconds between events and 60 seconds
  before repeating the same clip. Each event lasts ≤3 seconds including fades.
  No repeated chorus loop or permanent species chatter. Medium caps at 2 events
  per minute; low adds none. Silent roster entries stay silent.
- Authored call clips target true peak ≤−6 dBTP. In the reference full-volume
  clear-weather mix, wildlife calls target at least 12 dB lower RMS than the
  standard club-impact reference over equal-duration active windows. Record
  clip hashes, window durations, reference identity, meter, and results; these
  values do not claim current loudness measurement or a hearing-safety limit.
- Use ≥150 ms gain ramps at call boundaries and transitions. Calls may be
  omitted under weather/music priority instead of raised to compete. Storms
  add no wildlife calls; no alarm, distress, territorial confrontation,
  courtship, or prey sounds. Where behavior/context is uncertain, omit audio.
- Master mute, ambience zero, applicable hidden-tab mute, and non-game surfaces
  produce zero wildlife output. Pausing schedules no new wildlife events and
  fades an active event to silence within 250 ms. Reduced motion never adds
  audible events to compensate for fewer sprites. No species-specific audio
  implies an absent visible animal is discoverable or collectible.
- Stereo separation stays subtle; audition mono, headphones, speakers, and
  small-device output. Calls cannot mask club contact, rules/UI feedback, or
  assistive output. No cultural music, stereotyped cues, or cartoon foley.

## Production gates and required evidence

Every gate is fail-closed. Unreviewed/rejected candidates remain outside
production sources and atlases. A mechanically passing candidate still needs
the named human review; no approval is inferred from this document or an
automated report. Review records contain reviewer, role, date, exact asset/
recording hash, approved/rejected decision, evidence links, and resolved notes.

| Gate | Passing evidence / failure condition |
| --- | --- |
| Roster and boundary | Exact 8 biomes / 35 entries above, family A–J coverage, no extra animal; all forbidden mechanics absent from packet diff and later asset/runtime contracts. Any new tool, score, reward, simulation state, or player interaction fails. |
| Ecology review — human required, pending | Qualified ecological reviewer records exact taxa and locality for every candidate; source-backed habitat, season, activity, silhouette, grouping, and call context; no incompatible regional assemblage. Broad labels remain unchanged but no species-specific candidate ships without this record. All remote-habitat eligibility cases and cold/heat/storm omission are reviewed. |
| Welfare review — human required, pending | Reviewer inspects every frame, loop transition, prompt, recording, and staging fixture against every prohibited behavior; 0 nests/eggs/young/feeding/predation/distress depictions. Ground-nesting entries use only permitted perch/flyover/call vocabulary. Any violation fails. |
| Cultural and setting review — human required, pending | Regional/context reviewer signs each biome's setting fit, with particular attention to contemporary Japan, generic Tropical locality, and south-eastern Sandbelt. 0 sacred, costume, stereotype, mascot, branded, or protected real-course cues. No stock cultural soundtrack. |
| Mechanical art | Exact declared canvases/pivots; ≤2 source-pixel contact drift; transparent padding; separate shadow; 2-pixel atlas gutters; hashes and frame ownership valid; ≤4 value steps. Missing metadata or out-of-bounds frames fail. |
| Visual and accessibility review — human required, pending | Capture 50/100/200% zoom × 4 rotations × supported tiers × standard/deuteranopia/protanopia/tritanopia; masked-color silhouettes retain row cues at 100%; overview retains golf/flags/shot/selection legibility. Reduced-motion/paused captures show static valid poses or omission. Any marker confusion, overlap, light/anchor mismatch, or obscured golf information fails. |
| Spatial/welfare runtime certification — future packet | Seeded fixtures with roads, buildings, active holes, shoreline, moving actors, editing, pause, and save/reload report 0 buffer violations, 0 flight/functional-overlay intersections, 0 approaches or chase loops; insufficient habitat yields 0 appearances. Wildlife on/off produces identical authoritative simulation hashes and outcomes. No claim of implementation in this packet. |
| Audio review — human required, pending | Per-clip provenance and behavior context approved; meter reports meet peak/relative RMS targets; rolling-window audit meets tier event/concurrency/spacing caps; mute/pause/hidden/menu tests meet zero-output rules; listening review passes mono/device/feedback-masking cases. Missing measurements or species/call mismatch fail. |
| Delivery/performance — future packet | Hash/dimension/ownership and M35 audits pass existing total caps plus proposed wildlife tier art/audio/residency caps; low and unselected-biome wildlife requests/residency equal 0; viewport counts/travel/flight caps pass; deterministic replay and offline revisit succeed. Report actual target-device frame time against that packet's renderer budget; this document supplies no measured FPS claim. |
| Provenance — human required, pending | Each image/recording has rights source, license/terms, author or provider/model, date, full prompt/reference IDs and hashes, raw source hash, cleanup lineage, exact production hash, reviewer decision, and permitted redistribution scope. 0 secrets, copied/traced protected pixels, unlicensed field recordings, or artist imitation. Public informational source links below grant no image/audio rights. |

Candidate lifecycle follows `planned → raw → candidate → cleaned → approved →
production`, with rejected candidates returning only to candidate work. Preserve
raw originals and cleanup history; generated or externally supplied candidates
require the M35 human adoption review before entering production source trees.
Deterministic/source-original assets still require wildlife ecological, welfare,
cultural, visual, and listening review. Silence or omitted wildlife is the
fallback when suitable approved art/audio is unavailable.

## Documentation verification and handoff

For this documentation packet, verify the exact roster rows and counts per
biome (5, 4, 4, 4, 4, 4, 5, 5), ten closed families A–J, defined scale/anchor/
group/habitat/activity/audio/tier limits, all world-only non-goals and welfare
exclusions, actual primary-source links, and explicit pending human gates.
`git diff --check` must pass. The packet's changed-file allowlist is this new
Markdown file only; no catalog, assets, renderer, runtime, workflow, or code
changes are authorized here. Existing unrelated changes belong to other work.

Rollback: remove this new documentation file. There are no asset, save-format,
runtime, or deployment changes to reverse. Subsequent art/audio and runtime
packets consume this bible and certify their own gates; documentation completion
alone must not close their human review requirements or imply release readiness.
