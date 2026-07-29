# Sid Meier's SimGolf (2002) — Screenshot Reference Library

**Purpose:** visual + mechanical reference for building `simgolf-lite`. Every image in this
folder has been inspected and annotated below. Feed this file to a coding agent alongside the
specific image(s) named in the task.

**How to use with Codex / Claude Code:**
> "Read `simgolf2002 images/REFERENCE.md`. Look at `<filename>`. Implement <feature> to match."

Filenames encode `category-description-WIDTHxHEIGHT.ext`. Sort by resolution when you need
pixel-accurate detail — anything under 500px wide is a thumbnail and is only good for
composition/vibe, not for reading UI or sampling colors.

**Legal note:** these are copyrighted screenshots from a commercial game. Use them to study
mechanics, layout, and information architecture. Do not trace/copy sprites or art assets
directly into a shipped product.

---

## Highest-value images (read these first)

| Priority | File | Why it matters |
|---|---|---|
| 1 | `char-skill-point-allocation-panel-1024x764.webp` | Complete, legible list of the 10 golfer skill stats. This is the entire player-attribute model. |
| 2 | `shot-type-selector-and-lie-readout-800x600.jpg` | The 5 shot-shape buttons + the `Attitude / Club / Distance / Lie` readout. This is the core shot-input UI. |
| 3 | `shot-analysis-positive-delta-links-castle-640x443.webp` | Shot Analysis panel showing skill→yardage deltas, including a **positive** delta. Defines how skills map to outcomes. |
| 4 | `hole-routing-label-par4-276yds-highres-1024x765.webp` | Highest-res view of hole authoring: tee→green line, auto-computed yardage and par. |
| 5 | `terrain-highres-fairway-stripes-stream-801x601.png` | Best terrain render in the set. Mowing stripes, water edges, tile silhouettes. |
| 6 | `hud-terrain-palette-labeled-highres-1024x640.webp` | Full terrain palette with every tile type legible. Your terrain enum. |

---

## Cross-cutting observations

### Camera & projection
Fixed isometric (2:1 dimetric), no rotation visible in any screenshot. Zoom levels vary —
compare `terrain-wetland-tile-closeup-zoom-640x853.webp` (max zoom, individual tile texture
visible) against `amenities-casino-landmark-and-mood-bar-800x600.jpg` (far zoom, whole course).
The world is a finite tilted slab: you can see the map's edge and its extruded dirt side wall
in most shots. Off-map is black.

### Tile grid — corrected on close inspection
Terrain is painted on large diamond tiles, but **boundaries are not stair-stepped.** Zooming to
4× on `terrain-highres-fairway-stripes-stream-801x601.png` shows fairway and green edges are
*rounded*, with a consistent generous corner fillet — an autotile/marching-squares system with
rounded convex and concave corner pieces. The silhouette reads as a hand-drawn shape while
still snapping to the grid. This is the single biggest reason the original looks like a golf
course and not a tilemap.

Bunkers and water are a *different* system — freeform organic blobs that ignore the tile
silhouette entirely and overlap tile boundaries. So: **mown surfaces autotile with rounded
corners; hazards are freeform.**

### HUD anatomy (consistent across every screenshot)
- **Top-left:** course crest/logo + course name + in-game month/year + a progress strip. At 4×
  zoom the strip resolves as a row of **white golf-ball icons — one per hole built** — followed
  by trophy icons, with a second row of small award/banner icons beneath. It is a build-progress
  and achievement readout, not a star rating.
- **Top-right:** three stacked pill readouts, top to bottom — money (`$`), a face icon
  (golfer happiness/fun), and a magnifier/globe icon (course rating). See
  `hud-annotated-fun-rating-skill-rating-300x225.jpg` and
  `hud-annotated-ratings-desert-course-640x480.webp`, both of which have community labels
  overlaid identifying these as **Fun Rating**, **Skill Rating**, and **Funds**.
- **Bottom-left:** circular radial control cluster — build/terrain mode, buildings mode,
  people mode, plus zoom +/-, info, pause, speed.
- **Bottom-center/right:** context palette (terrain tiles, buildings, or shot controls
  depending on mode).
- **Bottom edge:** a row of tiny smiley faces — one per golfer on the course, colored by mood.
  In `amenities-casino-landmark-and-mood-bar-800x600.jpg` each face has a number under it
  (hole number the golfer is on).

### Golfer sim behavior
Golfers are autonomous agents with emitted speech bubbles that reveal their internal state:
- Course-quality reactions: *"Gee, that's a good scenic bridge"*, *"I love riding over this
  scenic bridge"*, *"I'm just so enthusiastic about these new fairways"*
- Hazard anxiety: *"Eeek, I gotta stay away from the pine trees"*, *"Eeek, I gotta stay out
  for the water"*, *"Eeek, I gotta stay short of the cactus"*, *"I see a ton of water"*
- Scoring reactions: *"Double Bogey, yet this is a most interesting course"*, *"A screamer!"*,
  *"On yeah, nothin' but green!"*
- Pace-of-play complaints: *"Keep it moving buddy"*
- Off-topic personality flavor: *"I should be studying for finals"*
- Purchase intent: *"Ahhh, cool foamy beverage"*, *"Are those new clubs?"*

**Implementation takeaway:** each golfer needs a per-shot evaluation that produces (a) a
hazard-avoidance intent, (b) an aesthetic reaction to nearby scenery, (c) a score reaction, and
(d) a needs-driven amenity reaction. Bubbles are the *primary* feedback channel — the game
teaches you what's wrong with your course by having customers complain about it.

Named recurring NPCs: Gary Golf, Paula Putter, AA Slicer, Joe Pro, Steady Eddie, Ivana Richman,
Randy Ranger, Joe Groundskeeper. Staff (groundskeepers, vendors) are also agents with visible
name labels.

### Vertical staff/amenity ecosystem
Soda vendors, hot dog stands, benches, restrooms, pro shop, driving range, tennis courts,
pools, carnival rides, casino. Amenities are placed on non-playable land between holes and
appear to serve golfer "needs" while also generating revenue and raising course prestige.

---

## Per-image annotations

### Category: `char-` — player character & skills

#### `char-skill-point-allocation-panel-1024x764.webp`
**Tags:** `ui-modal` `player-skills` `progression` `high-res` `mechanics-critical`

Modal titled **"Gary Golf — Add 0 skill points."** with 10 rows, each a labeled bar with an
increment arrow, plus a character portrait and full-body avatar. Skills, in order:

1. Power Hitter — `+50%`
2. Long Driver — `+40%`
3. Accurate Driver — `+10%`
4. Accurate Irons — (0)
5. Accurate Putter — (0)
6. Draw Shot (R to L) — (0)
7. Fade Shot (L to R) — (0)
8. High Backspin Shot — (0)
9. Recovery Skills — (0)
10. Luck — (0)

Rows with 0 points are greyed out; allocated rows show a percentage. Tutorial text below:
*"Before you play your course you may customize your character by improving his or her golf
skills. You can also win additional skill points for each accomplishment added to your
trophy."*

**Engineering notes:** this is a percentage-modifier model, not raw stats. Skills are earned
through achievements, not leveling. Draw/Fade are separate skills — lateral shot shaping is
a purchasable capability, not a universal one. "Luck" as an explicit stat means the outcome
model has a random component the player can bias.

---

### Category: `shot-` — shot mechanics, physics, trajectory

#### `shot-type-selector-and-lie-readout-800x600.jpg`
**Tags:** `ui-shot-input` `trajectory` `club-selection` `lie` `mechanics-critical` `800x600`

Bottom bar shows **5 trajectory-shape buttons** rendered as side-profile arc diagrams:
a low riser, a mid arc, a high lofted arc, a steep drop, and a near-flat runner. To their
left a text readout:

```
Attitude: calm
Club:     Lob Wedge
Distance: 79 yds
Lie:      tees
```

A white trajectory preview line is drawn on the course from ball to target.

**Engineering notes:** four inputs define a shot — golfer emotional state (`Attitude`), club,
target distance, and current lie. Shot *shape* is a discrete choice of 5, not a continuous
slider. Also visible: tournament leaderboard panel top-left (6 players, all at `E`).

#### `shot-readout-maxed-skills-driver-528yds-376x211.jpg`
**Tags:** `ui-shot-input` `trajectory` `skills-panel` `extreme-values` `low-res`

Same shot bar, but with the skills panel expanded alongside it showing every skill at
`+100%`. Readout: `Attitude: invincible / Club: Driver / Distance: 528 yds / Lie: tees`.
A very long trajectory line crosses most of the map.

**Engineering notes:** two things fall out of this. (1) `Attitude` is an enum with at least
`calm` and `invincible` — a confidence/momentum state that modifies output. (2) With all
skills maxed, drive distance reaches **528 yards**, roughly 1.8× a realistic tour drive.
That's your upper bound for tuning the distance curve.

#### `shot-analysis-positive-delta-links-castle-640x443.webp`
**Tags:** `ui-overlay` `shot-analysis` `skill-deltas` `hole-tuning` `mechanics-critical`

**Shot Analysis** overlay for "Golfers playing hole 1...":

```
golfers with ALL skills
no Imagination skill   +12 yds.
no Accuracy skill      -23 yds.
no Length skill        -43 yds.
```

Note **Imagination is positive here** — a golfer *without* imagination ends up 12 yards
further along. Fanned trajectory lines with ring markers show the spread of simulated
outcomes. A tooltip near the ball reads *"...affect the bounce and roll of the ball."*
Terrain is a treeless links/moorland with a stone castle keep.

**Engineering notes:** this is the hole-design feedback tool and the most important mechanic
in the game. It simulates the hole against four archetype golfers and reports how far each
gets. A well-designed hole rewards *all three* skill types differently. The positive
imagination delta proves the analysis measures **progress toward the hole**, not raw
distance — a creative-but-risky line can leave you worse off. Ball bounce and roll are
explicitly terrain-dependent.

#### `shot-analysis-overlay-island-par3-tee-selector-640x480.webp`
**Tags:** `ui-overlay` `shot-analysis` `tee-selector` `water-hazard` `island-green`

Shot Analysis on a dramatic island hole with a lighthouse:
```
no Imagination skill  -27 yds.
no Accuracy skill     -21 yds.
no Length skill       -79 yds.
```
Game is **Paused** (label at top center) while the overlay is open. Bottom bar shows **three
tee-position options** as small hole diagrams with 1/2/3 flame icons (difficulty rating), plus
a fourth green-flag button. Trajectory fan crosses open water.

**Engineering notes:** opening Shot Analysis pauses the sim. Tees are authored as multiple
discrete positions per hole with an explicit difficulty score, and the flame count is the
game's own legibility device for "how hard is this tee."

#### `shot-analysis-overlay-forest-tee-selector-516x387.jpg`
**Tags:** `ui-overlay` `shot-analysis` `tee-selector` `forest-terrain`

Third Shot Analysis instance, hole 5, forest/rock terrain:
```
no Imagination skill  -177 yds.
no Accuracy skill     -2 yds.
no Length skill       -114 yds.
```
**Engineering notes:** the `-177` imagination penalty is the largest in the set — this hole is
gated on creative shot-making. Compare against the other two analysis shots to see how the
three deltas shift with hole design. Together these three images give you a small calibration
dataset for the analysis function.

---

### Category: `hole-` — hole routing & authoring

#### `hole-routing-label-par4-276yds-highres-1024x765.webp`
**Tags:** `ui-hole-authoring` `par-calculation` `high-res` `mechanics-critical`

Floating white label over the fairway reads **"Hole 1 / 276 yards / Par 4"** with a thin white
tee→green centerline drawn across the terrain. Prompt bottom-right: *"Press 'h' to open hole."*
Terrain palette at bottom with `Firm fairway` tooltip on the hovered tile. Terrain is a dense
palm grove with rock outcrops.

**Engineering notes:** yardage and par are **derived live** from tee/green placement while
editing — not authored by hand. Holes have an explicit open/closed state; you build it, then
open it. The routing line is the design affordance.

#### `hole-routing-label-par3-200yds-516x387.jpg`
**Tags:** `ui-hole-authoring` `par-calculation` `par-3` `guidance-text`

**"Hole 1 / 200 yards / Par 3"** on a mostly-blank green field beside a lagoon. Golfer bubble:
*"We might add some fairway or sand traps."* Prompt: *"Press 'h' to open hole."* Full terrain
palette visible.

**Engineering notes:** confirms the par threshold — 200 yds = Par 3, 276 yds = Par 4. Two data
points bracket the Par 3/4 boundary somewhere in 200–276. The NPC line is a *hint system*: the
game nudges you toward adding hazards to under-designed holes.

---

### Category: `build-` — construction mode & terrain palette

#### `build-terrain-palette-sand-trap-selected-750x430.webp`
**Tags:** `ui-build-mode` `terrain-palette` `hover-state` `bunker`

Terrain palette with the **Sand Trap** tile hovered/selected — the tile is highlighted with a
yellow outline and a floating "Sand trap" tooltip. Above, a completed hole with two bunkers,
mown fairway, and a routing line. Note the leftmost palette slot is an up-arrow (elevation
raise tool).

**Engineering notes:** palette has a distinct selected state with tooltip-on-hover. There is a
terrain *elevation* tool separate from surface painting.

#### `build-blank-course-driving-range-early-686x386.jpg`
**Tags:** `ui-build-mode` `empty-course` `driving-range` `starting-state` `game-start`

Christmas Pines MC, June 2001, `$22,900`, happiness `0`, rating `0.00`. Almost entirely blank
green terrain with one small clubhouse, a pond, a driving range (green rectangle with white
tee markers), and a single fairway strip with a green. Golfer: *"Are those new clubs?"*

**Engineering notes:** this is the **new-game state**. Starting cash ~$23k. Rating starts at
zero. Useful for designing your onboarding/first-session experience.

#### `build-early-tee-green-placement-forest-514x389.jpg`
**Tags:** `ui-build-mode` `tee-placement` `driving-range` `sparse`

Ocean's Edge MC, May 2001, `$18k`, 18 golfers, rating `0.10`. A striped driving range with
white alignment lines, one green with flag, a routing line, and a reduced bottom palette
(icons only — appears to be a sub-mode, possibly "course objects" rather than terrain).

#### `build-desert-hole-in-progress-open-hole-prompt-480x300.jpg`
**Tags:** `ui-build-mode` `desert-biome` `hole-incomplete` `low-res`

Sangria Bay MC, arid biome with cacti and scrub. A small isolated green sits in raw desert
with the prompt *"Press h to open hole"* — the hole is routed but not yet opened. Blimp
overhead. `$1,165,700`, 352 golfers.

**Engineering notes:** best example of a hole existing in an unfinished, unopened state. Also
shows that the desert biome uses sand as the *default* ground, so bunkers lose contrast — a
real design constraint.

#### `build-clubhouse-building-palette-480x300.jpg`
**Tags:** `ui-build-mode` `building-palette` `low-res`

Thistle Runes MC, June 2003. Bottom palette switched to **buildings** — thumbnails of
clubhouse/lodge structures rather than terrain tiles. Mature wooded course behind.

---

### Category: `terrain-` — rendering, biomes, tile detail

#### `terrain-highres-fairway-stripes-stream-801x601.png`
**Tags:** `render-reference` `mowing-stripes` `water` `high-res` `best-quality`

**Best rendering reference in the collection.** aa-classic GC, May 2013, PNG so no JPEG
artifacts. Clearly shows:
- Alternating light/dark **mowing stripes** on fairways and greens, oriented per-tile
- A meandering stream with lighter shallow edges and a distinct shoreline band
- Organic-blob bunkers overlaid on tile-shaped fairway
- Stone cart paths that route around hazards
- A wooden bridge, water mill, and red barn as scenery
- Ploughed brown farmland tiles outside the course boundary
- Deciduous, conifer, and flowering (pink/white) tree sprite variants
- A full mood-face bar along the bottom edge

**Use this image for:** color palette sampling, mowing stripe frequency and angle, water edge
treatment, tree sprite variety targets.

#### `terrain-wetland-tile-closeup-zoom-640x853.webp`
**Tags:** `render-reference` `wetland` `max-zoom` `tile-texture` `portrait`

Maximum zoom, portrait crop (photo of a screen). A **wetland/marsh** tile type — mottled
cyan-and-green organic texture, clearly distinct from open water. Adjacent: mown fairway with
visible stripes, a bunker, a pale cart path, palms, a pink pin flag, and a blimp.

**Engineering notes:** wetland is a distinct playable-ish hazard surface, visually between
rough and water. The community question this came from ("are they only found naturally or can
you make them?") suggests some terrain types are **map-generation-only** and not player-
paintable — a scarcity mechanic worth considering.

#### `terrain-dense-palm-tropical-lighthouse-516x387.jpg`
**Tags:** `biome-tropical` `dense-vegetation` `landmark` `visual-density`

Scorpion Cove MC, June 2054. Extremely dense palm coverage — the fairway corridors are carved
narrow channels through solid tree cover. Striped lighthouse landmark. Shows what a fully
"grown-in" course looks like at end-game density.

---

### Category: `hud-` — HUD, chrome, and annotated readouts

#### `hud-terrain-palette-labeled-highres-1024x640.webp`
**Tags:** `terrain-palette` `labels-legible` `high-res` `mechanics-critical`

Ocean's Edge MC. The terrain palette is legible at this resolution — **the full tile enum**:

Row 1: `Tees` · `Green` · `Sand trap` · `Rough` · `Pot bunker` · `Stream` · `Water` · `Tree` · `Palm tree`
Row 2: `Fairway` · `Firm fairway` · `Deep rough` · `Waste bunker` · `Brush` · `Rocks` · `Pine tree`

Also shows golfer **portrait speech bubbles** (circular face + text) used for important
dialogue, distinct from the plain text bubbles used for ambient chatter.

**Engineering notes:** copy this list directly into your terrain enum. Note the pairs —
fairway/firm fairway, rough/deep rough, sand trap/pot bunker/waste bunker — implying each
family has graded severity affecting lie and roll.

#### `hud-terrain-palette-labeled-full-800x600.jpg`
**Tags:** `terrain-palette` `award-popup` `economy` `golfer-behavior` `800x600`

Paterson Playfield MC, August 2002. Palette labels differ slightly from the above —
here `Burn` and `Gorse` appear (Scottish terminology) alongside `Maple tree` and `Scots pine`,
suggesting **the palette is biome/theme-dependent**.

Award popup: *"Hole #2 (henceforth known as 'Dogwood'), has been rated as one of the best 100
holes in the country by Golf Enquirer magazine! Increase greens fees by $100."*

Rich golfer activity: named golfers with bubbles, a groundskeeper, deer grazing on the rough,
a stone bridge over a stream, park benches, a picnic/gazebo area.

**Engineering notes:** individual holes get **named** when they earn awards, and awards
directly unlock pricing power. That's a clean loop: design quality → recognition → revenue.

#### `hud-annotated-fun-rating-skill-rating-300x225.jpg`
**Tags:** `hud-semantics` `community-annotated` `low-res` `decoder-ring`

Small but valuable: someone has overlaid text labels identifying the HUD readouts —
**"Fun Rating: 287"** (left), **"Funds: $99,860"** (center, under course name), **"Skill
Rating: 1.24"** (right). Wales GC, May 2001.

**Engineering notes:** this is the decoder ring for the top-right pills. Two separate quality
axes: **Fun** (how much golfers enjoy it, integer, hundreds) and **Skill** (how demanding it
is, small decimal). Optimizing one at the expense of the other is presumably the central
design tension.

#### `hud-annotated-ratings-desert-course-640x480.webp`
**Tags:** `hud-semantics` `community-annotated` `biome-mixed` `vendors`

Same annotation scheme at higher resolution — **Fun Rating: 307**, **Skill Rating: 7.99**,
**Funds: 266,100**. Phoenix GC, April 2002. Mixed desert/oasis biome: sand, palms, cacti, rock
spires, water, a hot-spring structure, a taco vendor, and a historic lighthouse landmark
(*"Never mind, historic lighthouse!"*).

**Engineering notes:** Skill Rating 7.99 here vs 1.24 in the previous image, with similar Fun
Ratings — confirms the two metrics move independently.

---

### Category: `tournament-` / `event-` — competition & economy

#### `tournament-leaderboard-and-scorecard-686x386.jpg`
**Tags:** `ui-leaderboard` `ui-scorecard` `tournament` `pro-golfers`

**"LEADER BOARD of the SGA Qualifying School at Flamingo Shores"** — a ~35-entry list with
names and scores relative to par, e.g. `1. Yabuk Yamashi (-7)`, `2. Rif Nickelsworth (-3)`,
`3. Sinus Pak (-5)`, ranging down to `Jay Waller Pro (+48)`. Bottom shows a **Professional
Tournament** scorecard grid: hole-by-hole numbers for `Gary Golf` vs `Paula Putter` with
per-hole pars in a header row.

**Engineering notes:** full field size is large (35+). Scores are displayed relative to par.
The scorecard is a persistent bottom-docked panel during play.

#### `tournament-exhibition-scorecard-desert-640x480.jpg`
**Tags:** `ui-scorecard` `exhibition` `desert-biome` `prize-money`

**"Exhibition — $4,000/hole"** with a `Jason vs. AA Slicer` scorecard. Per-hole scores are
color-coded (red/blue/black) — almost certainly over/under/at par. Sangria Bay CC, July 2025.

**Engineering notes:** exhibitions are priced **per hole**, not per event. Color-coded score
cells are a cheap, high-value legibility win.

#### `lowres-tournament-scorecard-lighthouse-480x300.jpg`
**Tags:** `ui-scorecard` `low-res` `video-still`

Blurry video still. Only useful for confirming the scorecard's docked position and the
existence of a lighthouse landmark on a water hole.

#### `event-tournament-offer-popup-515x388.jpg`
**Tags:** `ui-modal` `event-system` `economy` `prize-money`

Popup: *"The SGA is interested in holding a tournament at your course. We'd like to schedule
the Paterson Playfield MC Open Golf Tournament here as soon as possible. We can offer a top
prize of $110,000! Click the tournament button in the James Paterson panel to begin the
tournaments."*

**Engineering notes:** tournaments arrive as **offers triggered by course quality**, not as a
menu the player opens freely. Prize scales with reputation.

#### `event-hole-award-greens-fee-popup-516x387.jpg`
**Tags:** `ui-modal` `award` `economy` `pricing`

*"Dogwood has been rated as one of the Top 18 holes in the country by Great Golf Holes
magazine! Increase greens fees by $100."* Note the same hole ("Dogwood") appears in
`hud-terrain-palette-labeled-full-800x600.jpg` with a *different* award from a *different*
magazine — awards stack over time. Sheep grazing on the rough in this shot.

#### `tutorial-hole-type-creative-imagination-515x388.jpg`
**Tags:** `ui-modal` `tutorial` `hole-classification` `mechanics-critical`

Popup: *"Golf holes fall into various categories depending on the skills they require. Hole 1
has been recognized as your first CREATIVE type hole. Creative holes require the player to use
imagination to create unexpected shots, length and accuracy are less important here."*

**Engineering notes:** holes are **auto-classified** into types based on which skill they
stress — this is the consumer-facing output of the Shot Analysis math. `CREATIVE` maps to
imagination; by symmetry expect `LENGTH` and `ACCURACY` types. A well-rounded course probably
needs a spread of types. This single popup explains the entire design-quality system.

---

### Category: `amenities-` — buildings, vendors, decor

#### `amenities-casino-landmark-and-mood-bar-800x600.jpg`
**Tags:** `landmark` `end-game` `mood-bar` `800x600` `theming`

Sangria Bay CC, May 2055, `$2,110,300`, 2395 golfers, rating 43.78. An enormous **roulette-
wheel casino** landmark dominates the frame, surrounded by formal gardens, a lighthouse,
player homes labeled *"Mel Clifford's Home"* / *"Claudia Chiffre's Home"*, and dense
pathing. Top-left HUD shows trophy counters: `x21 ⭐ x15 🏆 x26 ❤️ x14 🏛 x52`.

**Engineering notes:** (1) End-game courses accumulate huge decorative landmarks — worth
having as an aspirational build target. (2) Star golfers **build homes on your course** — a
retention/prestige mechanic. (3) The top-left strip is a multi-category achievement counter,
not just stars. (4) The bottom mood bar shows a number under each face = hole number.

#### `amenities-vendors-bridges-dense-course-640x480.webp`
**Tags:** `vendors` `bridges` `dense-buildup` `staff`

Ocean's Edge MC, June 2009. Very dense: multiple **Soda Vendor** stalls with name labels,
`Randy Ranger` and `Joe Groundskeeper` staff, several bridge styles over ponds, a windmill,
sheds, and a lighthouse. Small greens tucked between structures.

#### `amenities-pool-tiki-driving-range-640x480.jpg`
**Tags:** `resort-amenities` `pool` `driving-range` `amenity-category-bar`

Flamingo Shores MC, April 2001. Swimming pool with deck, tiki/thatched-roof structures, a
striped driving range with three golfers hitting, a large lodge. Bottom bar shows an **amenity
category row** (5 round icons: bench/seating, water?, pin, tree/landscaping, sign) — the
sub-category navigation for build mode.

#### `amenities-clubhouse-tennis-carnival-ride-516x387.jpg`
**Tags:** `resort-amenities` `tennis` `carnival` `mature-course`

Hunt Valley, August 2014. Colonial clubhouse, red-surface **tennis courts** inside a building,
a purple **carnival/parasol ride**, formal gardens, and several bunkers. Non-golf amenities
are a major build category.

#### `amenities-tennis-court-building-palette-480x300.jpg`
**Tags:** `building-palette` `tennis` `low-res`

Dolphin Coast MC, September 2018. Building palette open at bottom. Tennis court, large manor
clubhouse, fountain in a pond, pink flowering trees.

#### `amenities-clubhouse-hotel-decor-516x387.jpg`
**Tags:** `buildings` `hotel` `decor` `terrain-palette`

Jurassic Springs GC, July 2001. Two large multi-story buildings (clubhouse + what reads as a
hotel/lodge), a radio/observation tower, benches lining paths, ornamental plantings. Golfer:
*"Eeek, I gotta stay away from the pine trees."*

---

### Category: `lowres-` — thumbnails (composition reference only)

These are all under 350px wide. Use for silhouette, color mood, and layout density only —
do not attempt to read UI text or sample precise colors.

- **`lowres-themed-resort-buildings-vegas-300x225.jpg`** — "Las Vegas GC", May 2001. Heavily
  themed white-and-gold resort architecture with a pool, plus a purple carnival ride. Shows
  the game supports strong per-course visual themes.
- **`lowres-tropical-beach-course-overview-259x194.jpg`** — Sangria Bay CC. Beach/lagoon
  course; sand-to-water gradient and small island greens.
- **`lowres-island-course-blimp-sailboat-300x225.jpg`** — Island Palms MC, June 2002. Blimp
  overhead and a **sailboat on the water** — ambient world detail beyond the course boundary.
- **`lowres-wooded-riverside-course-258x195.jpg`** — Clearwater Ridge MC. Temperate forest
  and river, small clubhouse. Sparse early-game density.

---

## Mechanics backlog — superseded

An earlier draft of this file carried a 10-item implementation backlog derived from these
screenshots. It has been removed: the CourseCraft roadmap in Linear (milestones M46–M49) is
substantially further along than anything these 2002 screenshots demonstrate, and the list was
duplicative.

Mechanics extracted from these images now live in Linear:

- **Doc:** SimGolf 2002 Screenshot Reference Library (golf-sim project)
- **ZK-498** — Capture higher-resolution reference screenshots to close documented gaps
- **ZK-499** — Reconcile shot and par tuning against extracted SimGolf reference values
- **ZK-500** — Audit terrain palette and rendering signatures against SimGolf reference

**Use this file for what screenshots are actually good for: look, feel, and asset inventory.**
That's the section below.

---

# Art direction & asset inventory

Everything below is observed directly in the images, with the source file named. Measurements
are given at the native resolution of the source, so scale accordingly.

## The core visual trick

Three things, in order of impact, are what make the original read as a real golf course rather
than a strategy-game tilemap:

1. **Rounded autotile silhouettes on mown surfaces.** Fairway and green shapes have a generous,
   consistent corner fillet — convex *and* concave. No visible stair-stepping.
2. **Mowing stripes**, at two different frequencies (green vs fairway) and with direction
   varying between adjacent regions.
3. **A graded collar** between every mown surface and whatever is next to it. Nothing ever
   butts directly against anything else.

If you build only these three, the terrain will already feel right. Everything else is dressing.

## Surface treatment, in detail

Source for all of this: `terrain-highres-fairway-stripes-stream-801x601.png` at 4× zoom.

**Green.** Brightest, most yellow-shifted green. Very fine mowing stripes — roughly half the
pitch of the fairway's. Rounded-rectangle silhouette with a large corner radius. Ringed by a
mid-green collar band ~2–3px native.

**Fairway.** Slightly darker and less saturated than green. Mowing stripes at roughly 5px
native pitch, low contrast — on the order of 8–10% luminance difference between bands, not more.
Stripe *direction differs between adjacent fairway regions*, which is what sells the
hand-mown look. Same rounded silhouette system as the green.

**Rough.** Darker, desaturated green with fine mottled noise. **No stripes.** This absence is
what makes the striped areas read as deliberately maintained.

**Collar / fringe.** A thin mid-tone band between mown surface and rough, and again around every
bunker. Small detail, large payoff.

**Bunkers.** Freeform organic blobs — kidney, peanut, amoeba. Cream/off-white with fine noise
speckle, no outline. They sit *on top of* fairway and freely overlap tile boundaries. Each has
a subtle darker green collar. Sizes vary widely; small ones read as pot bunkers.

**Water.** Mid-blue base with irregular darker mottling. Three-part edge treatment, and all
three matter:
1. a **rocky bank band** of grey-brown cobble stipple, ~8px native, following the shoreline
2. a **darker blue shadow band** just inside the water on the light-facing bank
3. open water beyond

**Wetland.** Mottled cyan-and-green organic texture, clearly distinct from both rough and open
water. See `terrain-wetland-tile-closeup-zoom-640x853.webp`.

**Cart paths.** Narrow (~3px native) light grey cobble with a slightly darker edge. They run
along tile diagonals and route *around* hazards rather than through them.

## Lighting

Single fixed light from the upper-left. Consistent across every screenshot — no time-of-day
variation observed.

**Objects cast soft shadows onto terrain.** Clearly visible: the pin casts a blurred elliptical
shadow on the green, the golf ball casts a small one, trees cast shadows onto grass, and the
stream's bank casts onto the water. Ambient occlusion appears where terrain meets vertical
objects. This is cheap to fake and does a lot of work.

The map is a finite tilted slab with an extruded dirt side wall visible at the edges. Off-map
is pure black.

## Asset inventory

What you'd actually need to build. Grouped by class, with observed variant counts.

### Terrain surfaces (17)
`Tees` · `Green` · `Fairway` · `Firm fairway` · `Rough` · `Deep rough` · `Sand trap` ·
`Pot bunker` · `Waste bunker` · `Stream` · `Water` · `Wetland` · `Brush` · `Rocks` ·
plus tree placements

Each mown surface needs a full rounded autotile set (straights, convex corners, concave
corners) plus its collar variant.

### Vegetation
- **Deciduous** — at least 4 canopy colors observed: standard green, autumn red/orange,
  purple/maroon, and a pale spring green
- **Conifer** — dark spire silhouette, distinct from deciduous
- **Palm** — multiple sizes; used in dense clusters in tropical biomes
- **Flowering trees** — pink blossom and white blossom variants
- **Flowering shrubs / ground planting** — magenta, purple, orange, white
- **Scrub / brush clumps** — dark olive, irregular, clustered
- **Cacti and desert scrub** — desert biome only
- **Dandelions** — called out by name in golfer dialogue ("We hate dandelions"), so they are a
  distinct maintenance-state asset, not decoration

**Important detail:** trees and shrubs sit on a **brown dirt base patch**. Vegetation is never
placed directly on grass without it.

### Rock and ground detail
- Individual rounded grey-brown rock sprites, scattered semi-randomly on rough
- Larger rock outcrops and standing stones (`hole-routing-label-par4-276yds-highres-1024x765.webp`)
- Rock spires — desert biome
- Small scattered dark marks on fairways, reading as birds or divots

### Water features
- Streams (narrow, winding) and ponds/lakes (broad)
- **Bridges** — at least 3 styles observed: pale stone arch, orange/red wooden arch with
  railings, and a plain plank crossing. Bridges have vegetation dressed at both ends.
- Fountains and water jets
- Waterfalls / rapids at map edges
- Hot spring — desert biome

### Structures — golf
Clubhouse (several scales, from a small starter shack to a multi-wing manor), pro shop, halfway
house, sheds, starter hut, driving range (striped bay with white alignment lines and tee
markers), windmill, water mill with an animated wheel and splash particles, lighthouse (striped,
recurring as a landmark), gazebo, observation/radio tower.

### Structures — resort amenities
Swimming pool with deck, tennis courts (indoor and outdoor, red surface), hotel/lodge, tiki and
thatched-roof buildings, carnival ride (rotating parasol), a full casino with an animated
roulette-wheel roof, formal gardens and parterres, fountains, statuary.

### Small placeables
Park benches, picnic tables, trash bins, signage, flower beds, ornamental planters, pin flags
(red, numbered, on white poles), tee markers, ball washers.

### Vendors and staff
Soda vendor stall, hot dog/food stall, taco stand — each a small kiosk with a name label.
Staff: groundskeeper, ranger, vendor — all named, all pathing agents.

### Characters
Golfers in varied shirt colors, carrying bags or riding carts. Golf carts as a distinct moving
asset. Character portraits (head-and-shoulders illustrations) for dialogue. Full-body avatars
for the skill panel.

### Ambient world detail
Blimp with course livery drifting overhead, sailboats on open water, grazing sheep and deer on
rough, birds. These sit *outside* the playable area and cost nothing mechanically but do a
disproportionate amount of the "this is a real place" work.

### Biome sets
Each biome re-skins the palette rather than adding mechanics — see
`hud-terrain-palette-labeled-full-800x600.jpg` (Scottish: `Burn`, `Gorse`, `Scots pine`,
`Maple tree`) against `hud-terrain-palette-labeled-highres-1024x640.webp` (temperate: `Stream`,
`Brush`, `Pine tree`, `Palm tree`). Biomes observed: temperate parkland, Scottish links/moorland,
tropical/island, desert/arid, and a mixed desert-oasis.

## Feel notes

**Density is the progression curve.** Compare `build-blank-course-driving-range-early-686x386.jpg`
(new game: bare green field, one shack, one hole) with
`amenities-casino-landmark-and-mood-bar-800x600.jpg` (May 2055: casino, formal gardens, player
homes, dense pathing) and `terrain-dense-palm-tropical-lighthouse-516x387.jpg` (fairway corridors
carved through solid palm cover). The visual reward for progression is *stuff accumulating*.
Worth designing the asset set so density scales convincingly.

**The course is populated, not empty.** Even mid-game screenshots have dozens of golfers, staff,
vendors, animals, and speech bubbles on screen simultaneously. An empty-looking course reads as
a failed course — which is both an aesthetic and a feedback mechanism.

**Speech bubbles are ambient decoration as much as UI.** Plain text bubbles for chatter,
portrait bubbles for important dialogue. They're constant, overlapping, and cheerful.

**Landmarks anchor identity.** Nearly every course has one oversized signature structure — a
lighthouse, castle keep, casino, windmill. It's what makes a course memorable in a screenshot.

---

## Gaps in this reference set

Things you'll need to research elsewhere or design from scratch — no screenshot here covers:

- The finance/pricing panel (greens fees, staff salaries, expenses breakdown)
- Any elevation/topography editing UI beyond the single up-arrow palette button
- Putting mechanics or the on-green view
- Weather, wind, or seasonal effects
- The main menu, scenario select, or save/load flow
- Multiplayer / course sharing
- Staff hiring and management UI
- The "James Paterson panel" referenced in the tournament popup
