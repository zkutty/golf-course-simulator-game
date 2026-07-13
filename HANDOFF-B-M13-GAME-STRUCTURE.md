# Handoff B — M13: Game Structure — Modes, Scenarios & Difficulty

You are Agent B. Your mission is Linear milestone **M13** in project `golf-sim`
(team Zkutty): turn the sandbox into a *game* — a new-game setup flow, an
objective engine with win/lose, difficulty levels, land themes, and the start
of career mode. Another agent (Agent A) is concurrently doing the M11 visual
work inside the Pixi renderer. **Stay inside your file territory** (below) and
you will never conflict with them.

Read the repo-root `HANDOFF.md` first — its Hard Rules and orientation apply to
you. This document adds what changed since it was written and your specific
scope.

## State of the world (July 13)

Everything below is DONE and merged to `main` (PRs #6–#11, CI green):

- The game renders isometric by default (M8–M10 complete): elevation,
  sculpting, autotiling, water FX, props, buildings with a starter clubhouse.
- **ZKU-174 — real save system**: `src/utils/saveStore.ts` is the slot
  repository (IndexedDB → localStorage → memory), rotating autosaves fire on
  every committed game day from App's `onDayCommitted`, export/import as
  `.coursecraft` files, and ALL load paths go through `normalizeLoadedSave()`
  in `src/utils/save.ts`. **Any schema field you add (mode, objectives, theme,
  difficulty) must get a default there** so old saves keep loading — there is
  a unit-test pattern for this in `src/utils/saveStore.test.ts`.
- **ZKU-184 — CI** on every PR: typecheck/lint/test/build. Red CI does not merge.
- 76 unit tests passing; ESLint at 0 errors (9 pre-existing warnings).

## Your issues (read each in Linear before starting — full scope lives there)

Recommended order; ZKU-163 is the load-bearing one:

1. **ZKU-163 — Objective engine**: goal definitions, progress tracking,
   win/lose evaluation. This creates the condition vocabulary that scenarios
   (ZKU-164), the tutorial (M14), and achievements (ZKU-180) will all reuse —
   design it as data (`{ metric, comparator, target, deadline? }`), not code
   per goal (HANDOFF.md rule 6). Evaluate on committed game days / week ends
   inside the sim, surface via World state.
2. **ZKU-162 — New-game setup flow**: mode select (Sandbox / Challenge /
   Career-stub), course naming, land theme pick, difficulty pick. Replaces the
   bare "New Game" button path in the start menu.
3. **ZKU-165 — Difficulty levels** wired through `balanceConfig.ts` (Easy /
   Normal / Hard multiplier sets). If your change shifts balance, run
   `npm run tune` and report before/after in the PR.
4. **ZKU-166 — Land themes**: parkland / links / desert generation + palette
   variants. Coordinate the palette part carefully: terrain colors live in
   renderer-side lookups — expose the theme as data on `Course` and keep any
   PixiStage edits to a minimal, flagged diff (see boundary rules).
5. **ZKU-164 — Career mode ladder** (authored scenarios + unlocks) — only
   after 162/163 land; it composes them.

## Your file territory (hard boundary)

Yours:
- `simgolf-lite/src/App.tsx`, `src/ui/StartMenu.tsx`, `src/ui/HUD.tsx`,
  new screens under `src/ui/` (setup wizard, objectives panel)
- `src/core/reducer.ts` + `actions.ts`
- `src/game/models/*` (types, defaults, generation), `src/game/balance/*`,
  `src/game/sim/*`
- New module `src/game/objectives/` (engine + tests)
- `src/utils/save.ts` / `saveStore.ts` (schema defaults for your new fields)

Off-limits (Agent A's):
- `src/ui/PixiStage.tsx`, `src/render/*`, `src/game/render/*`,
  `simgolf-lite/scripts/*`, `public/atlases/*`, `ART_GUIDE.md`
- Exception for ZKU-166 palettes: if a theme genuinely requires a PixiStage
  tint-table change, keep it to the smallest possible diff in one commit and
  call it out in the PR description so A can rebase trivially. Prefer putting
  theme data in `game/models` and having the renderer read it.
- `CHANGELOG.md`: append your entries at the BOTTOM of the Unreleased→Added
  list; A prepends at the top. Keeps rebases conflict-free.

## Process rails (proven over PRs #6–#11 — follow exactly)

- Branch **`claude/m13-game-structure`** off latest `origin/main`. Never push
  to main. One issue per commit, issue ID first in the message
  (`ZKU-163: objective engine — goals, progress, win/lose`).
- Gates before every commit, run from `simgolf-lite/`: `npx tsc -b`,
  `npm run lint` (0 errors; ~9 pre-existing warnings tolerated),
  `npm run test` (76 passing today — your objective engine and migrations need
  real tests), `npm run build`.
- **Verify in a real browser** before calling an issue done: Playwright with
  `chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })` against
  `npm run dev` (localhost:5173), init script
  `localStorage.setItem("coursecraft_renderer","pixi")`, screenshot and look.
  Drive the actual flow (start menu → your wizard → in game → objective HUD).
- Linear: In Progress when you start, Done when merged, comment on the issue
  for ANY deviation/deferral. (Linear's GitHub automation bounces statuses
  around PR open/merge — normal.)
- PR when a coherent chunk is done; CI green before merge. After merging,
  restart your branch from main
  (`git fetch origin main && git checkout -B claude/m13-game-structure origin/main`).
- Update `CHANGELOG.md` with each issue.

## Landmines specific to your area

- **Save compatibility is forever.** Every field you add to `Course`/`World`
  gets a default in `normalizeLoadedSave()` + a test that a pre-M13 save still
  loads. The migration pattern (elevations, buildings) is right there to copy.
- ESLint runs react-hooks v7 STRICT: no synchronous `setState` inside effects
  — use render-adjustment (compare-prev-prop state); async setState after
  `await` is fine. App.tsx already uses these patterns; copy them.
- `App.tsx` is a ~1,600-line monolith. Add screens as separate components
  (`SaveLoadModal.tsx` is the fresh template for modal flow + styling); don't
  grow the monolith further, and don't rewrite it either.
- Determinism: generation for themes must run through `utils/rng.ts` seeded
  from the run seed. Never `Math.random()` in sim/model code.
- The weekly sim commits days through `onDayCommitted` in App — that hook is
  where autosave fires; your objective evaluation likely wants the same
  commit points (inside the sim, not in the UI callback).
