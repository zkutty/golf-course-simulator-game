# Readable shot pacing

## Authority and scope

`src/game/live/shotPacing.ts` supplies a pure presentation clock shared by ordinary
LIVE golfers, Player Pro and ChallengeGroup. Its output samples an existing
`RetainedShotMotionV1`. It never solves a shot, changes a segment, consumes RNG,
reveals a future result, changes a score, or settles money. A presentation plan is
created once from validated retained evidence and retained carry plus roll yards.
Missing historical trajectories and automatic aggregate putt counts remain
unavailable; there is no manufactured path or per-putt identity.

The operating clock remains game minutes. Existing LIVE tiers are 2.8, 5.6 and
11.2 game minutes per real second; ordinary fixed simulation steps remain 0.05
game minutes. Presentation progress uses real milliseconds and receives no speed
tier. A speed change must not restart or resize a shot already being presented.

## Shared interface

| Export | Contract |
| --- | --- |
| `createShotPacingPlan({scopeId, actorId, motion, distanceYards})` | Validates retained evidence and finite nonnegative retained distance; returns an immutable small plan or `null`. |
| `shotPacingDurationMs(kind, distanceYards)` | Full swing: `6000 + min(400, yards) * 10` ms. Putter: `2400 + min(40, yards) * 45` ms. Invalid inputs return `null`. |
| `createShotPacingCursor(plan, saved?)` | Restores a valid cursor for this exact owner; otherwise begins at zero. |
| `isShotPacingCursor(value, plan)` | Strict plain JSON carrier with exactly `{version: 1, key, elapsedMs}`; elapsed time must be finite and within this plan. |
| `advanceShotPacingCursor(plan, cursor, elapsedMs, options?)` | Returns a new cursor, the unchanged cursor when held, or `null` for an owner mismatch/invalid cursor. A positive finite frame delta is capped at 100 ms. |
| `shotPacingFrame(plan, cursor)` | Returns `{key, shotId, progress, motionProgress, phase, addressing, complete}`, or `null` for an invalid cursor. |
| `shotPacingEventProgress(plan, motionTime)` | Maps a finite retained event time in `[0,1]` to total presentation progress; invalid input returns `null`. |

Use only plans returned by the factory. A plan is transient trusted application
state, not a second persisted evidence payload. `motionProgress` is passed to
`sampleRetainedShotMotion`; do not create a separate flight, rebound or rollout.
Retained collisions and first-contact times keep their existing normalized ratios.

The total 6–10 second swing includes 1000 ms address, 200 ms contact animation,
the retained movement, and 900 ms rest. A 2.4–4.2 second putt includes 500 ms
address, 150 ms contact, retained ground movement, and 650 ms rest. The phases
are `address`, `contact`, `flight`, `roll`, `rest`, `complete`. The ball starts
moving after the contact animation. A ground-only putt proceeds directly to
`roll`. Rest holds the physical endpoint; rules relief remains the retained
separate marker. Completion occurs after rest, not at first contact.

## Stable identity, pause, skip and saves

The owner key is a JSON tuple of `scopeId`, `actorId` and every retained identity
field: shot id, hole id, shot number, seed, club, style and model version. Do not
identify shots by the last outcome, actor id alone, nearest point, or shot id
alone. Tuple boundaries also distinguish identifiers containing colons.

For LIVE, use a scope incorporating world/run or session identity, week, day,
live seed, and `reconcileEpoch`, and an actor id from the exact golfer. For a
controlled round, use round identity and participant identity. Before publishing
a frame or handling completion, compare the current owner and retained identity
with the acquired owner again. Day replacement, itinerary reconciliation,
round/participant changes, missing actors or changed motion invalidate the owner.

Pause and hidden-tab frames hold both clocks. `hidden` wins every presentation
request, including skip; discard background wall time and reset the rAF timestamp
on visibility changes. Visible explicit skip completes even while paused. Skip
is a presentation action and must not cancel an unresolved shot or invent an
outcome. Automatic reduced-motion skipping should honor pause. Suppress skipped
and restored historical audio; emit only newly crossed retained events for the
current exact owner. Contact audio maps to retained time zero and rest/hole-out
audio to retained time one.

The caller owns completion delivery and must claim it once for the exact owner.
A restored complete cursor is still complete: finish any pending authoritative
transition once, without replaying audio. A malformed or mismatched optional
presentation cursor or optional action-time ledger is dropped without rejecting
otherwise valid legacy authority; a valid ledger retains its pending steps exactly.
A malformed week-report acknowledgement marker rejects the snapshot, because it
must not become an implicit acknowledgement.
Checkpoint the cursor on coarse progress, pause/visibility change, pagehide and
save; do not persist a queue of presentation frames or events.

Player Pro's existing `{version: 1, shotId, progress}` carrier remains unchanged.
Its adapter can validate the legacy carrier and map `progress * plan.durationMs`
to the in-memory shared cursor, then checkpoint `frame.progress` back to the same
three fields. Round identity and the current retained motion validate ownership
outside that legacy carrier. Existing completed rounds and saved physics truth
must not be rewritten to add pacing evidence.

## Ordinary LIVE follow policy

Only explicit camera follow acquires a paced shot. Merely selecting a golfer for
the HUD or overview must not hold the operating day. The live hook receives the
follow state explicitly; it must not infer follow from selected id.

1. Run ordinary fixed steps until the followed actor enters a valid retained
   flight segment. Check for acquisition after each fixed step, so a fast rAF
   batch cannot pass several shots before the renderer notices. A restored or
   newly followed current flight may be acquired at its current saved simulation
   cursor. Present its retained path from the start unless a matching saved
   presentation cursor exists.
2. Capture the exact golfer, segment index, segment identity, owning scope and
   remaining authoritative flight duration. Own at most one shot. Stop ordinary
   global `stepLive` while that presentation is active, including its rest phase.
   Render the acquired golfer from retained evidence and the presentation frame;
   keep all other actors at their current authoritative positions. Do not mutate
   a saved itinerary cursor to make a visual pose.
3. Discard real wall time during the hold. Do not accumulate fixed-step debt,
   shot/event queues, or accelerated catch-up after playback. The currently held
   simulation remainder must not absorb time from the presentation.
4. On visible completion or explicit skip, consume only the captured remaining
   flight duration through ordinary fixed-step simulation and normal cash,
   completed-round and other event callbacks. A final fixed quantum may cross
   the segment boundary; do not acquire another shot during that drain or carry
   unused rAF work into the next shot. Clear the old presentation owner before
   any `finishDay`/day replacement.
5. If follow ends, the selected/followed actor changes, the actor disappears, or
   day/reconcile identity changes, cancel presentation immediately. Resume normal
   authority from its actual saved simulation cursor. Cancellation does not
   consume the remaining flight, award scores, or settle skipped game minutes.

This holds authority instead of retaining stale render actors while the operating
clock races beyond them. Queue size is one active presentation, zero pending
presentations. The speed tier remains the user's chosen operating tier; a follow
hold is temporary presentation state, not a forced change to the speed setting.

## Controlled action time and accelerated days

Player Pro and ChallengeGroup retain their current shot/outcome/round authority.
Both use the shared presentation duration and phase mapping. Aim time, menus,
pause, hidden-tab time and shot playback must not advance the operating day.
Advancing a controlled round uses a finite deterministic game-minute action
debit derived from the already committed shot and its frozen course geometry.
Shot address/motion and walking/inter-hole time must each be charged once; no
wall-time estimate, rerolled outcome or score-derived fabricated revenue is
allowed. Use one accounting owner per round and shot/transition, including all
participants when ChallengeGroup auto-resolves a turn. Reload, skip, reduced
motion, auto-finish and repeated completion callbacks must not debit twice.

`controlledTime.ts` uses the existing LIVE swing pause, clamped flight duration,
and distance-to-rest walking rate. A putt costs 0.7 game minutes; retained automatic
putt counts add that cost for each putt. An inter-hole walk uses the frozen course
geometry and existing walk cap, charged with the first committed shot on the next
hole. Aiming or advancing to the next hole alone costs no time. Each action is
rounded up to existing 0.05-minute quanta. Concurrent ChallengeGroup participants
use the maximum accumulated participant cost, rather than summing four rounds.

The persisted ledger keeps the actual completed-shot counter, cumulative observed
cost and finite unconsumed steps. Retained history is capped at 240 shots, so new
costs are read from a bounded recent window without treating its changing sum as
lifetime cost. Auto-finish collects newly completed costs synchronously while each
predecessor remains available, before committing the new round and saving. A gap
that cannot be established from retained evidence is rejected rather than guessed.
New concessions persist the exact completed-shot count separately from the RNG
attempt cursor, so a discarded pending shot cannot charge the preceding shot
again. Uncapped legacy concessions can use their complete trace history; capped
legacy history with no terminal evidence adds no guessed observation and keeps
existing debt. Legacy rounds establish a baseline without retroactive charges.
Presentation milliseconds never become economy minutes. Do not expose day advancement during
an active controlled round or start a new round while earlier debt remains.

An action debit or accelerated-day request calls `stepLive` with existing fixed
quanta and preserves all ordinary event callbacks. The day helper must have a
finite target/step budget and report progress or the reason it stopped. Yield
between bounded batches; cancellation stops future batches. Never set dayMinute,
dayOver, revenue, rounds or golfer completion directly to make an advancement
finish. Commit each completed day only through existing `finishDay`, once.
Pause at a completed-week report until the user acknowledges it. Persist both the
finite unconsumed debit and a strict `weekReportPending` marker at that boundary.
Reload restores the report from matching saved history; if history is missing,
show explicit acknowledgement recovery without invented financial figures. Reject
a marker/world week mismatch before mutating the loaded session. Only Continue
clears the marker and resumes the remaining debit.

`dayOver` is authoritative: ordinary days can continue after dusk until remaining
golfers leave, and tournament days can finish early. A held followed actor cannot
depart until authority resumes. If a controlled debit crosses `dayOver`, clear
presentation ownership before day replacement and carry only its finite remaining
game-minute debit through the next ordinary day. Settle a final-shot competition
result before its time debit, using the current day captured before that debit.
Existing ChallengeGroup frozen completion-day policy remains unchanged. Hold the
ledger while playback or durable settlement is pending. Frozen course/weather
evidence remains the round's shot authority across operating-day settlement.

## First use and delivery

The title renders without requesting the live simulation controller. Game
activation or a validated queued restore loads it through a deferred boundary.
The lightweight facade validates saves synchronously, retains the most recent
restore and subsequent speed/selection changes, and exposes the queued focus,
debt and report marker while loading. Its first controller render is disabled;
the layout handoff restores authority before enabling ordinary animation frames.
The actual screen flow remains loading until preparation succeeds, then enters
gameplay with its tutorial and input layers mounted. A new loading/title/setup
transition aborts stale entry callbacks. A disabled development remount also
retains speed and selection before the first live snapshot exists. Gameplay,
Player Pro completion and settlement wait for that handoff. Missing or
failed code cannot advance a day, discard pending time or settle a round. Import
failure uses the existing reload recovery surface. Once loaded, the controller
stays mounted across screen changes and its existing enabled policy controls RAF.

The renderer reads a stable reference into the current driver buffer on every
frame. React publication remains coarse; it must not become the source of exact
ball poses or hide buffer swaps between status updates. Existing entry, critical
asset and offline delivery budgets remain release gates.

## Ownership and acceptance

The foundation packet owns this module, its focused tests and this contract.
The LIVE packet owns hook acquisition, authority hold/drain, optional saved
cursor, renderer projection and explicit follow plumbing. The day packet owns
bounded pure advancement and later serial hook integration. The controlled
packet owns shared playback adaptation, once-only action time, App/HUD wiring
and ChallengeGroup transitions. Serialize edits to shared integration files.

Focused unit checks cover finite duration at all speed tiers, frame rates,
retained phase boundaries, pause/hidden/skip, complete restores, every identity
field, malformed saved cursors and input immutability. Integration acceptance
also needs followed versus selected behavior, acquisition inside a multi-step
frame, cancel/reconcile/day replacement, saved active follow, no background
catch-up, once-only controlled action time, and ordinary simulation/economy
equivalence for bounded advancement. Keep legacy saved rounds and physics/score
goldens unchanged. Reverting the foundation's three new files removes the pure
contract; runtime integrations must be reverted with their imports if present.
