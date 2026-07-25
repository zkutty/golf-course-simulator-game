# Implementation Handoff — CourseCraft (simgolf-lite)

You are picking up implementation work on a SimGolf-style tycoon game. All planning is done
and lives in Linear. Your job is to execute issues, one at a time, to the quality bar of a
boxed early-2000s sim game.

## The one-paragraph brief

`simgolf-lite/` is a Vite + React 19 + TypeScript + PixiJS 8 course-builder/tycoon prototype
with a deep, deterministic simulation core and a flat, prototype-grade presentation layer.
Two parallel roadmaps take it to "store-bought" quality: a **visual overhaul** (isometric
2.5D renderer, elevation, art pass — milestones M8–M12) and an **engine/product overhaul**
(game modes, tutorial, audio, saves, release rails — milestones M13–M17). Milestones M1–M7
(live simulation, personalities, concessions, staff, tournaments) predate this plan; some are
done, some in flight.

## Where everything lives

- **Linear project:** `golf-sim` (team Zkutty / ZKU) — https://linear.app/zkutty/project/golf-sim-ff64f2ca68e7
- **Plan documents (read both before your first issue):**
  - *Visual Overhaul Plan: The SimGolf 3D Feel (M8–M12)* — in the project's Documents
  - *Ship-It Plan: From Side Project to Boxed Sim (M13–M17)* — in the project's Documents
- **Issue ranges:** M8–M12 = ZKU-137…161 (visuals), M13–M17 = ZKU-162…185 (engine/product).
  Every issue has Context / Scope / Acceptance criteria with real file paths, and
  `blockedBy` relations encode the true dependency order — trust them.

## What to work on, in order

1. **Unblock everything:** ZKU-184 (CI pipeline — no `.github/` exists today), ZKU-80
   (fix the 26 standing ESLint errors; CI gates on it), ZKU-174 (real save system).
2. **Visual track entry point:** ZKU-137 (iso math module) → ZKU-138 (production PixiStage)
   → ZKU-139 (isometric rendering). Strictly sequential.
3. **Game-ness track entry point:** ZKU-162 (new-game wizard) and ZKU-163 (objective
   engine) — highest "feels like a real game" return.
4. After those, M9/M10/M14/M15/M16 fan out and are largely independent tracks.
5. Last: ZKU-161 (delete legacy renderer) and ZKU-185 (E2E/fuzz/soak QA).

When an issue is blocked by unfinished work, do the blocker first or pick a different issue —
don't stub around a dependency.

## Codebase orientation (2 minutes)

```
simgolf-lite/src/
  core/          reducer.ts + actions.ts — ALL state mutations go through here
  game/models/   types.ts (Course/World/Hole/Terrain), terrainEconomics.ts, defaults.ts
  game/sim/      pure simulation: tickWeek, pathfind, courseRating, shots/solveShotsToGreen
  game/live/     real-time entity layer (golfers, clock, spawning) — mutable store outside React
  game/balance/  balanceConfig.ts — every tunable constant; tuned via `npm run tune` (Monte Carlo)
  game/render/   camera.ts (CameraState; rotation currently disabled)
  ui/            App.tsx (1,500-line monolith — improve opportunistically, don't rewrite),
                 CanvasCourse.tsx (legacy 2D renderer, dies in ZKU-161), PixiStage.tsx (future),
                 gameui/ (component kit), HUD, StartMenu, SettingsModal
  audio/         AudioManager.ts (music/ambience) + utils/sound.ts (3 procedural SFX)
  utils/         save.ts (single localStorage slot — replaced by ZKU-174), rng.ts (seeded RNG)
```

Commands (run from `simgolf-lite/`): `npm run dev` / `npm run build` (runs `tsc -b` first) /
`npm run test` (Vitest) / `npm run lint` / `npm run tune`.

## Hard rules

1. **Determinism is sacred.** All randomness goes through `utils/rng.ts` seeded from
   `World.runSeed`. Never call `Math.random()` in sim code. Same seed + same actions must
   produce identical state (ZKU-185 will enforce this with a test).
2. **The sim core stays pure.** No DOM, no PIXI, no React imports under `game/sim/` or
   `game/models/`. Renderers consume sim output; they never feed back into it except through
   reducer actions.
3. **State changes go through the reducer** (`core/reducer.ts`) so undo and cash accounting
   stay correct. Don't mutate `Course`/`World` from components (ZKU-82 exists because this
   was violated once).
4. **Balance lives in `balanceConfig.ts`.** New tunables go there, never inline. If your
   change could shift game balance, run `npm run tune` and report the before/after in the PR.
5. **Save compatibility is forever.** Any schema change (elevations, buildings, goals,
   records…) adds a versioned migration step (ZKU-79 chain). An old save must always load.
6. **Don't duplicate the seams.** One shared event bus serves advisor/ticker/records/
   achievements/SFX (first of ZKU-168/179 to land creates it, the rest reuse it). The
   objective-condition vocabulary (ZKU-163) is reused by scenarios, tutorial, achievements.
   The app-profile store (ZKU-176) holds all non-save persistence. Check whether the seam
   exists before building it.
7. **Definition of done, every issue:** acceptance criteria met, `npm run build` and
   `npm run test` green, no new lint errors, no console spam in production builds
   (dev-flag gating — ZKU-85 convention), work **committed and pushed**, and the issue's
   Linear status updated with the commit SHA.
8. **Nothing is Done until it is pushed.** An issue moves to Done only when a pushed commit
   SHA is recorded on it. Work that exists only in a working tree does not count as
   complete, no matter how thoroughly it was tested — sessions run in ephemeral containers
   and an uncommitted tree is one restart away from gone.
9. **Never hand off an uncommitted tree.** A handoff comment must name a commit, never a
   dirty working directory. If you are out of time, commit the work in progress to your
   branch and push it; a messy pushed commit is infinitely more valuable than a clean tree
   that no longer exists. Do not describe results measured against a tree you did not push —
   the next agent cannot reproduce them and will not know the difference.

## Known landmines

- `PixiStage.tsx` has `DEBUG_PIXI = true` (red debug square) and rebuilds every tile sprite
  on any change — both fixed by ZKU-138/142; don't build on top of the current behavior.
- Editor input in PixiStage ignores the camera transform (`e.global / tileSize`) — breaks the
  moment a camera exists. ZKU-138 fixes it; anything touching input should go through there.
- `CanvasCourse.tsx` (legacy renderer) and PixiStage must not drift further apart. New visual
  features target the Pixi/iso path only; legacy gets bugfixes only until ZKU-161 removes it.
- Production build broke once from dead code (`tsc -b` is strict — ZKU-74). Delete unused
  exports as you go.
- History in saves is capped at 20 weeks (`save.ts slice(-20)`) — ZKU-179 lifts this; don't
  build stats features against the capped array.
- Browser autoplay policy: no audio before first user gesture. AudioManager already probes;
  keep new audio behind that gate.

## Workflow

- Branch per issue using Linear's suggested branch name (each issue has `gitBranchName`).
- Small PRs, one issue per PR, issue ID in the title (e.g. `ZKU-137: iso projection core`).
- Update the Linear issue as you go (In Progress → Done); note any scope deviations on the
  issue itself so the plan stays truthful. Push before you mark anything Done, and put the
  SHA on the issue — see hard rules 8 and 9. On 2026-07-25 five rendering issues
  (ZK-468–472) were marked Done from an uncommitted tree that was then lost with its
  container; the specs survived only because they lived in Linear.
- Commit as you go rather than accumulating one large tree. If a session is interrupted
  mid-issue, the pushed prefix is what the next agent inherits.
- If an issue's assumptions turn out wrong against the current code (things move fast here),
  fix the plan in Linear first, then implement — don't silently diverge.
