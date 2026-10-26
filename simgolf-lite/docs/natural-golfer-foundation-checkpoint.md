# Natural golfer foundation checkpoint

October 26, 2026. ZK-378 first-golfer asset subset and ZK-1416 pure foundation.
Based on approved/published Study 02 `aa5933d8e13d61963dc22fd640d1c7d6a52134b3`.

The user explicitly approved the natural adult visual direction and the exact
Study 02 push. That push completed and remote readback matched. ZK-1414 retains
its separately completed concept-contract evidence and Done status. This packet
consumes the explicit [integration policy](natural-golfer-integration-policy.md),
preserving both immutable concept studies.

## Accepted technical outputs

- One additive adult golfer asset candidate: 224 logical frames, eight authored
  right-hand views, separate base/tint/shadow, padded 72x96 source with feet
  (36,83), unchanged 26/48 world scale and contact indices 5/2. Exact packed
  layer reconstruction, edge transparency, bounds, padding and deterministic
  generation pass. Runtime PNG plus manifest is 442,249 bytes and decoded
  textures are 2,591,872 bytes, below unchanged 501,591/12,700,960 ceilings.
- Pure `golferActivity.ts` projector and bounded admission helper: full owner,
  authority revision, shared plan/cursor/frame coherence, explicit target/hand
  facts, lifecycle transitions, held accessibility changes and actual global
  limits. It advances no clock and emits no gameplay/completion effects.
- Pinned development-only `@napi-rs/canvas@0.1.100` with generated lock entries.
  Rasterization has no runtime import or service dependency.

Asset tests: **9/9 pass**. Activity/sprite/grounding tests: **73/73 pass**
(51 activity, 22 existing). Full app typecheck, scoped lint and diff check pass.
Independent Sol 6.1 xhigh review accepted both packets. One activity correction
fixed failed replacement admission retaining an obsolete same-actor shot/revision;
nine regressions cover replacement/current-record preservation at all three caps.
The initial 64-test pass did not cover that defect and is not final evidence.

Reproduce from `simgolf-lite/` after normal dependency installation:

```sh
node --test scripts/natural-golfer-v1.test.mjs
npx vitest run src/game/render/golferActivity.test.ts src/game/render/golferSprites.test.ts src/game/render/golferGrounding.test.ts --configLoader runner --maxWorkers=1
npx tsc --noEmit --incremental false -p tsconfig.app.json
npx eslint src/game/render/golferActivity.ts src/game/render/golferActivity.test.ts
```

This local workspace used the documented bundled canvas-module override in the
asset README. Vitest's runner config loader avoids writes into shared read-only
dependencies; its initial default-loader EPERM was an environment limitation.

## Remaining integration boundary

Neither output is runtime wired. The canonical pacing integration baseline is
`a6bf460e19fe9eb8418f04315c5069e876be66f7` (5729faf plus c08a5ff), inspected in a
separate clean checkout. Source/authority reconciliation and all later serial
carrier/loader/scene checks are still required. The existing startup gate remains
separate and red; this packet does not repair or certify it.

The asset is one identity, not a replacement of the three legacy appearances.
Generic club geometry is not class-specific driver/iron/putter certification.
Known unsupported hand/equipment pairs retain a neutral fallback under policy v1.
Any generic-motion compatibility policy must explicitly keep handedness/target/
role matching and nullable rendered-equipment truth, separately from pixel-class
certification. Human PNG/in-world/full-hole acceptance remains pending, as do
bulk variants and release. ZK-378 and ZK-1416 remain In Progress.

No legacy atlas, frozen study, existing renderer, simulation, physics, rules,
score, economy, save, workflow, budget or golden changed. Rollback removes only
these additive source/assets/docs and the development dependency.
