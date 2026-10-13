# Daily pin setup and history contract (ZK-1142)

The course daily selector is the requested A/B/C setup. Coordinates remain owned by `resolveCourseSetup`: a missing alternate uses the existing fallback. The HUD discloses the number of affected holes without implying raw array indexes are published routing numbers; each hole inspector names the fallback. The minimap and thumbnail emphasize the resolved marker.

Ordinary live golfers consume a daily-pin change through the existing course-edit reconciliation policy: completed score/shot/plan/reaction prefixes stay frozen; the current unscored hole and unplayed tail restart from the golfer's current position with the existing seeded replanner. Geometry-only callers retain their existing behavior. Tournament and entrant overrides keep their frozen requested setup. Player Pro/manual frozen-round code is unchanged.

`Golfer.pinRotation` describes the requested setup for the remaining itinerary. Optional `pinRotationsByHole` records requested rotations by stable booked hole ID so a mixed day cannot relabel historical shots. A mixed completed round omits singular `CompletedRound.pinRotation`; architecture evidence reads each shot's own booked-hole entry before legacy fallback. A requested B with a resolved A fallback remains recorded as requested B, while shot coordinates retain their actual physical result.

No save or live-snapshot version changes. Entirely absent legacy maps remain accepted and initialize from the golfer's frozen legacy setup on its first daily change. Present maps must cover exactly the booked hole keyset, at most the existing 36 planned holes, using own A/B/C entries. Extra, sparse, malformed, `__proto__`, `constructor` and `prototype` keys are rejected. Rejection does not mutate input state. New generated maps are complete; the render-performance fixture re-keys only this metadata to its existing overridden booking IDs.

## Repeatable focused validation

- `npx vitest run src/ui/zk1142PinFallback.test.tsx src/game/m23CourseSetup.test.ts src/ui/HoleInspector.test.tsx src/ui/renderer/scenes/holeMarkersScene.test.ts`
- `npx vitest run src/game/live/zk1142MiddayPin.test.ts src/game/live/persistence.test.ts src/game/live/live.test.ts src/game/livingClub/m38LivingClub.test.ts src/game/testing/renderPerfFixture.test.ts`
- `npx playwright test e2e/zk1142-daily-pin.e2e.ts` using the existing e2e Vite mode.

The native fixture uses real Pixi WebGL graphics and the production marker scene, revision tracker and host. It checks nine full/partial A/B/C setups, four rotations, zoom 0.15/0.5/1/2/8, DPR 1/2, marker visibility, and repeated-revision invalidation. The browser regression drives the actual HUD and inspector.

Additional private integration evidence records actual Design/Operate/Review, flyover, minimap/thumbnail drawing, real quick-save/page-reload, and actual ordinary live A→B→reload→C with immutable scored canonical bytes. This matrix samples continuous zoom/DPR ranges rather than claiming every fractional value or native Firefox/Safari certification. Broad release gates remain integration-owned.

Rollback is the inverse scoped patch. Existing legacy saves do not require migration; old binaries ignore the optional field, although old reconciliation cannot preserve mixed-setup labeling after a future daily switch.
