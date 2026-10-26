# ZK-1414: one golfer / one bounded hole, review v1

Status: **concrete review package; human art, rhythm and group decisions pending**.
Open `review.html` directly in a browser. It contains its own image data and code,
starts paused, and needs no server, credentials or game build. Press Play to see
the 51.64-second full-hole timed storyboard. Scrub or use the nine beat buttons
for details. Motion off stops playback. A saved review cursor restores paused;
it is independent of game saves. Respect OS reduced motion and browser 100% zoom
when judging actual-size samples.

This is one original teal/cream golfer and two quiet partners, using discrete
raster key poses. The playing golfer completes a tee shot, bunker shot, chip,
putt and walk onward. Partners wait/watch or walk; their strokes and scores are
not shown. They are muted copies for blocking, not distinct approved variants. The animatic's terrain, legal-looking blocking routes, ball paths and
outcome labels are synthetic screenplay inputs. They illustrate the contract;
they are not live routing, retained physics, gameplay captures, proof of smooth
motion, or a substitute for an exact-build production full-hole recording.

The three look cards compare the current layered golfer and candidate using the
same foot line, camera, separate shadow and exact logical scale. A source
48×72 frame displays at **13×19.5 / 26×39 / 52×78 CSS pixels** for 50/100/200%
gameplay zoom, including transparent margins. Detail inspection is separately
enlarged and labeled. The generated raster keeps the original character and
outfit consistent but does not yet supply production-ready directional frames,
continuous motion, strict pixel alpha or anatomically certified grips.

## Source and allowed changes

Release input: `5729faf7a17dcb2c5e12c27422a8b1590d59f4d0`.
Published pacing input: `c08a5ff358dcbe874796b76cdaeae96a8fa94748`, specifically
`docs/readable-shot-pacing.md` and `src/game/live/shotPacing.ts`.
Current `src/game/render/golferSprites.ts`, `golferGrounding.ts`,
`src/ui/renderer/scenes/liveEntitiesScene.ts` and `ART_GUIDE.md` were read.
The published pacing contract is a consumed compatibility input. No runtime
code is cherry-picked. Startup, Nightly, simulation, RNG, economy, clocks,
routing, production atlases, budgets, and rendering code are outside this patch.

Only this review directory and an additive golfer section in `ART_GUIDE.md`
change. The package adds zero production frames and zero production bytes.
No app code imports this directory. No atlas packing or bulk variant generation
has been performed. Revert the single packet commit to roll it back.

## What is normative for the next bounded packet

`activity-manifest.v1.json` is the machine-readable proposal and
`activity-contract.v1.d.ts` the compact proposed input/output shape. They are
outside `src`; they implement no adapter. `storyboard.v1.json` is explicitly
non-shipping example data. `review-player.mjs` is pure review math shared by
validation and the embedded HTML. `build-review.mjs` rebuilds the self-contained
HTML from its template, two unchanged legacy PNGs and the generated source PNG.
`provenance.v1.json` and `imagegen-prompts.txt` retain source provenance.

**Single clock.** Use the published shotPacing cursor, phase and retained sample
without a body stopwatch. Swing / chip / bunker use
`6000 + min(400, retained carry+roll yards)×10` ms; putt uses
`2400 + min(40, retained yards)×45` ms. Day speeds 1×/2×/4× do not rescale these.

| Body beat | Swing / chip / bunker | Putt |
| --- | ---: | ---: |
| Settle, inside address | 0–600ms | 0–300ms |
| Address hold | 600–800ms | 300–400ms |
| Backswing | 800–1000ms | 400–500ms |
| Contact animation | 1000–1200ms | 500–650ms |
| Terminal contact / first retained motion | 1200ms | 650ms |
| Follow, then watch | first 350ms of retained motion, then watch | short hold, then watch |
| Retained endpoint / canonical rest | final 900ms | final 650ms |
| Optional evidenced reaction | last 600ms of rest | last 600ms of rest |

The earlier 0.6–1.2s settle and 1.2–2.4s reaction figures were initial tuning
proposals. This v1 chooses the finite table above so it fits the already
published 1000/500ms address and 900/650ms rest. Human feedback may request
another bounded design; it cannot silently add a hold. Reactions start only
after the current owned endpoint has been observed. Unknown, neutral, legacy
aggregate putts and missing per-shot evidence stay neutral. A good shot gets a
small nod, a bad one a sigh, confirmed hole-out a short restrained fist. No
club throws, jumping wall, score guess from distance or old hole-score reaction.
One reaction per shot, 8s per-actor cooldown, no historical replay. Priority is
confirmed hole-out → exceptional → good → bad → neutral → unknown. A partner may
watch; their result is never inferred from the current player's shot.

**Identity and authority.** The key is the shared JSON tuple of scope, actor,
shot id, hole id, shot number, seed, club, style and string model version.
Revalidate it and current authority revision before every publication and
completion. Route revision additionally invalidates walk staging. No retained
queue: one current shot owner per actor, zero pending. Outcomes require an
explicit observed result classification/evidence id for that same key; classify
upstream, never by visual proximity. Consumed retained events are bounded at 16.
Event/completion delivery stays with existing authority. Body output cannot
alter shot, score, route, clock, ownership, settlement or save truth.

**Position and walking.** Sample the existing continuous surface at the exact
feet/holder point and use one separate `(1.5,.8)`, radii `(8,3.4)`, alpha `.18`
contact shadow. Stride comes only from distance along the actual legal route;
stationary feet do not walk. The activity input may expose at most 64 points
from the current route window; do not truncate and connect nonadjacent points.
If the route is unavailable, stand at the current authoritative location. No
new straight-line path, hazard crossing, historical teleport replay or backwards
walk is permitted. Review crop feet are normalized to `(24,69)` in 48×72;
hand/contact anchors are explicit visual candidates, awaiting pixel cleanup.
Production contact must meet the retained launch point within one source pixel
under rotation and handedness, and the ball cannot depart before contact.

**Direction and handedness.** Preserve the legacy five rows `[s,sw,w,nw,n]`,
three mirrored octants and 6/2/8/4/4/4 walk/idle/swing/putt/cheer/mad frames.
Contact remains swing index 5, putt index 2. Walk/idle rows mean facing; strike
rows mean target. This candidate is one right-handed screen-east study at camera
rotation 0. It is not an eight-direction atlas. Resolve world target through
current camera rotation before choosing a clip. Mirroring a known strike into
a different handedness is forbidden. Unsupported known hand/target pairs use a
neutral non-gripping body, retained ball and explicit fallback reason; do not
mislabel a mirrored legacy stance as that player's hand. Legacy mirrored clips
remain compatible only for unspecified-handed identities. Asymmetric bag and
outfit details need a mirror audit even on walk/neutral clips. New clip ids are
additive; missing new clips fall back to existing clips only when that target/
hand pair is valid, otherwise neutral. No fixed NW light rotation.

## Bounds and fast-forward tradeoff

| Policy | Finite bound / behavior |
| --- | --- |
| Current actor | Exact current owner/revision only; disappeared/replaced actors invalidate immediately |
| Per-actor shot backlog | One active, zero pending; no historical reaction replay |
| Overview lag | At most 250ms and 16 logical pixels behind current authority |
| Natural walk | At most 32 logical pixels/s; distance-driven stride |
| Cannot meet both bounds | Drop old staging, show current authority position with ≤120ms Time advanced marker; no fabricated intervening walk or fade with motion off |
| Overview / HUD selection | No authority hold; no replay of every fast-forwarded shot |
| Explicit follow | Consume only existing one-shot hold, max 6–10s swing / 2.4–4.2s putt; no new walk/rest/reaction hold |
| Group | Up to four; one shot actor, others current legal wait/watch positions |
| Choreography quality | High 16 / medium 8 / low 4 actors; excess actors stay visible at current position with neutral pose |
| Concurrent reactions | High 2 / medium 1 / low 0, oldest eligibility dropped rather than queued |
| Allocation | Existing one holder + one shadow per actor; no new per-tick world effects |
| Culling | Drop offscreen visual staging and reactions; do not delete authority or replay on reveal |

This deliberately lets fast operating days omit intermediate visual actions.
Calm presentation of every historical action while the day races ahead would
require stale actors, unbounded queues or extra authority holds. Those are not
admitted. Follow preserves one watched shot using its already published hold;
ordinary overview stays current and may transition discretely.

Pause freezes cursor/body/stride/ball. Hidden wins even explicit skip, discards
wall-time debt and resets the frame timestamp. Visible explicit skip can finish
a current shot while paused, but only the existing completion owner may perform
any authoritative transition. Reduced motion does not unpause a paused game;
when visible and unpaused the existing policy may complete a presentation
without animation. No bob, reaction loop, stride, camera easing or fade in
motion-off mode. Reload accepts only the existing `{version,key,elapsedMs}`
optional shared cursor, exact owner and finite bounds; suppress already passed
contact/reaction/audio. Do not persist a new body queue. Complete restores stay
complete and deliver pending authority completion at most once. Follow off,
selection/actor change, day replacement or reconcile cancels without draining
or inventing an outcome; no catch-up debt. No force-follow, camera recenter,
zoom change or new global hold is introduced.

## Cost, checks and remaining human decision

Legacy compatibility: 108 frame slots per variant × two layers × three variants
×48×72×RGBA4 = **8,957,952 uncompressed source bytes**, before packing. Proposed
additive slots (2 settle +2 watch +4 nod +4 sigh +8 chip +8 bunker) total 28 for
one target/hand subset: **774,144 bytes** for one variant/two layers, or
**2,322,432 bytes** for three. This is a cost projection, not an approved atlas;
compressed transfer, packing overhead and GPU allocation have not been measured.
Existing source resolution stays 48×72. Actual non-shipping file sizes are in
`cost-inventory.json`, generated by the validator. Production delivery budgets
and existing renderer readiness/resource ceilings remain unchanged.

Run from this directory:

```sh
node build-review.mjs
node validate.mjs
```

Validation checks source grid dimensions, exact legacy counts/contact indices,
pose rectangles/finite anchors, source hash, required phases/lie roles, exact
shot formulas and boundaries, walk speed, reaction eligibility, caps, cursor
pause/hidden/skip/reload cases, source immutability and additive guide scope.
Browser evidence must additionally show the media renders, stays paused on
load, responds to controls, plays through one full hole without page errors,
and honors motion off and reload. Those checks do not certify production
performance, smoothness or human preference.

The user's actual decisions remain null in the manifest: **golfer look,
full-hole rhythm, group treatment**. The coordinator must show this concrete
media and ask for acceptance or specific revisions. Do not advance production
art/adapters or mark the issue Done until that decision is recorded. Even an
accepted concept does not close later exact-build animation certification.
