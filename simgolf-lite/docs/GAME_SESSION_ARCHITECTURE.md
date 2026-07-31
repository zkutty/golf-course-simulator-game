# GameSession application boundary

`GameSession` is the application-owned boundary around the existing pure core
reducer. It is intentionally not a replacement for simulation authorities:

- `applyAction` remains the deterministic command reducer.
- `useLiveSimulation` and the live clock remain their existing authorities.
- save schema v25, normalization, and historical migrations remain in
  `utils/save.ts` and `utils/saveStore.ts`.
- `PlatformServices` remains the platform contract; a session consumes an
  injected implementation and owns only the quit/save coordination lifecycle.

## Consumers

- React reads state with `useGameSessionSelector`. Selector results retain
  their previous identity under `Object.is` or caller-provided equality, so a
  panel can ignore unrelated session updates.
- Pixi and other non-React systems can call `getState`, `subscribe`, or
  `subscribeSelector` directly.
- Commands use `dispatch`, while long-running integrations use the versioned
  `updateCourse` and `updateWorld` methods.
- Persistence code uses `createSavePayload`, `save`, `load`, and `restore`.
  Save attachments keep live snapshots, history, tutorial, and records on
  their existing authorities during the incremental migration.

## Selector scope instrumentation

`GameSessionRenderInstrumentation` measures selector invalidations for three
representative surfaces: `live-hud`, `editor-inspector`, and
`management-report`. It is deliberately headless and counts only changes to a
surface's selector projection—the same condition that causes a mounted
`useGameSessionSelector` consumer to rerender. Use it in tests or a host
diagnostic harness to prevent unrelated economy, editor, and live-game changes
from widening a panel's update scope.

## Migration rule

New application-level game-state access should enter through `GameSession`.
UI-only view state can remain local to React. Existing subsystems should move
to narrow selectors one panel at a time; they must not duplicate course/world
state or introduce a second clock, reducer, save schema, or platform facade.
