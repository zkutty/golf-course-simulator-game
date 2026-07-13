# Handoff A — M11: Characters, Ball Flight & Living-World FX

You are Agent A. Your mission is Linear milestone **M11** in project `golf-sim`
(team Zkutty): make the world feel *inhabited* — real golfer characters, a real
ball flight, SimGolf-style emotes, ambient life. Another agent (Agent B) is
concurrently building game structure (modes/objectives/difficulty) in a
different part of the codebase. **Stay inside your file territory** (below) and
you will never conflict with them.

Read the repo-root `HANDOFF.md` first — its Hard Rules and orientation apply to
you. This document adds what changed since it was written and your specific
scope.

## State of the world (July 13)

Everything below is DONE and merged to `main` (PRs #6–#11, CI green):

- **M8 (6/6)** — isometric renderer is real and is the DEFAULT. `PixiStage.tsx`
  (~1,300 lines) renders a 2:1 dimetric world: layered scene graph (`world` →
  terrain / terrainDecals / objects / fx), free camera (wheel zoom-to-cursor,
  drag pan, Q/E 90° rotation), chunked terrain with dirty-diff invalidation and
  frustum culling, footprint-based depth sorting (`game/render/objectPlacement.ts`).
- **M9 (4/4)** — per-tile elevation: `Course.elevations`, sculpt tools, slope
  shading, cliff faces, elevation-aware gameplay.
- **M10 (6/6)** — art pipeline (`scripts/gen-placeholder-sprites.mjs` +
  `scripts/build-atlas.mjs` → `public/atlases/props.png/json`, typed loader in
  `src/render/atlas.ts`), autotiled terrain transitions, mow stripes, tee pads,
  pin flags with flutter, animated water (shimmer/foam/splash ripples), prop
  shadows + wind sway, buildings (clubhouse, footprint pathing).
- **ZKU-174** — real save system (IndexedDB slots, rotating autosaves,
  export/import). **ZKU-184** — CI on every PR (typecheck/lint/test/build); a
  PR with red CI does not merge.
- Live golfers/balls already render in PixiStage as pooled colored dots with
  depth sorting — that pool (`golferPoolRef` in the ticker) is your starting
  point for ZKU-153.

## Your issues (read each in Linear before starting — full scope lives there)

Work them in this order; each is one PR:

1. **ZKU-153 — Golfer character sprites**: directional walk cycles, swing,
   putt, reactions. Extend the placeholder-sprite generator + atlas the same
   way M10 props work (see `ART_GUIDE.md` for the look bible). Replace the
   dot-golfers in PixiStage's ticker with animated sprites; keep the pooling.
2. **ZKU-154 — Ball flight 2.0**: parabolic arc with ground shadow,
   bounce/roll, surface-specific landing FX. The ball already tracks
   `lastBall` per golfer in the pool; splash ripples on water landings exist —
   generalize the pattern.
3. **ZKU-155 — Emote bubbles**: wire to the existing golfer reaction system
   (`game/live/` moods — read-only for you; do not change sim logic).
4. **ZKU-156 — Ambient world life**: cloud shadows, birds, grass shimmer,
   time-of-day tint.

If you finish M11, continue into M12 with ZKU-157 (hole flyover) and ZKU-160
(render perf budget) — same territory. Do NOT take ZKU-161 (retire legacy
renderer) while Agent B is active; it touches App.tsx.

## Your file territory (hard boundary)

Yours:
- `simgolf-lite/src/ui/PixiStage.tsx` — you own it outright
- `simgolf-lite/src/render/*` (atlas loader, new animation helpers)
- `simgolf-lite/src/game/render/*` (iso math, objectPlacement — extend with tests)
- `simgolf-lite/scripts/*` (sprite generation + atlas packing), `public/atlases/*`
- `simgolf-lite/ART_GUIDE.md`

Off-limits (Agent B's or shared):
- `src/App.tsx`, `src/ui/StartMenu.tsx`, `src/ui/HUD.tsx`, `src/core/*`,
  `src/game/models/*`, `src/game/balance/*`, `src/utils/save*.ts`
- If you genuinely need a new prop threaded through App.tsx → PixiStage, make
  it a single added line and flag it in the PR description so B can rebase
  trivially.
- `src/game/live/*`: read anything, but only add *render-facing* fields (e.g.
  arc height on a ball) — never change spawn/scoring/economy logic. Keep sim
  determinism sacred (HANDOFF.md rule 1).
- `CHANGELOG.md`: append your entries at the TOP of the Unreleased→Added list;
  B appends at the bottom. Keeps rebases conflict-free.

## Process rails (proven over PRs #6–#11 — follow exactly)

- Branch **`claude/m11-characters-fx`** off latest `origin/main`. Never push to
  main. One issue per commit, issue ID first in the message
  (`ZKU-153: golfer character sprites — directional walk cycles`).
- Gates before every commit, run from `simgolf-lite/`: `npx tsc -b`,
  `npm run lint` (0 errors; ~9 pre-existing warnings are tolerated),
  `npm run test` (76 passing today — keep them green, add tests for new
  math/logic), `npm run build`.
- **Verify in a real browser** before calling an issue done. Pattern that
  works headless: Playwright with
  `chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })` against
  `npm run dev` (localhost:5173), init script
  `localStorage.setItem("coursecraft_renderer","pixi")`, take screenshots and
  actually look at them. Placing a valid hole needs tee/green far enough apart
  (~150+ yd) and clicks retried if a random seed puts water under them.
- Linear: set the issue In Progress when you start, Done when merged, and post
  a comment on the issue for ANY deviation/deferral — the plan must stay
  truthful. (Note: Linear's GitHub automation will bounce statuses to
  In Progress when a PR opens and back to Done on merge — that's normal.)
- PR per milestone chunk or per issue (your call), CI must be green before
  merge. After your PR merges, restart your branch from main
  (`git fetch origin main && git checkout -B claude/m11-characters-fx origin/main`).
- Update `CHANGELOG.md` with each issue.

## Landmines specific to your area

- ESLint runs react-hooks v7 STRICT: no `setState` synchronously inside
  effects. Use render-adjustment (compare-prev-prop state) instead; async
  setState after `await` in an effect is fine.
- `cacheAsTexture` on terrain chunks was deliberately deferred (rebuild-cost
  regressions) — don't re-enable casually; measure first (ZKU-160 is where
  that work belongs).
- Camera rotation is a world-axis remap; anything you draw that has a facing
  (golfer sprites!) must resolve direction *through the current rotation*
  (see `edgeFrameFor` in PixiStage for the established pattern).
- Depth sorting: entity zIndex must come from `entityDepth`/`frontCorner`
  (objectPlacement.ts). The painters' invariant is tested — depth order must
  match ground-anchor screen-y order.
- The atlas loader falls back gracefully on missing frames (warns once). Add
  frame types to the unions in `src/render/atlas.ts` when you add sprites.
