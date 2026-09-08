# ZK-1107 validation record

Run from `/private/tmp/golf-sim-zk1107/simgolf-lite`.
Base `4ddc7af0a6014ab73cedb6e6dea42c7b026049af`.

## Passed

- `node /Users/zbkutlow/.codex/skills/develop-web-game/scripts/web_game_playwright_client.js --url 'http://127.0.0.1:4177/?m20Fixture=1' --actions-json '{"steps":[{"buttons":[],"frames":60},{"buttons":["right"],"frames":2},{"buttons":[],"frames":4}]}' --iterations 2 --pause-ms 500 --screenshot-dir artifacts/zk-1107/game-client-final` — exit 0, two screenshots and two structured states, no error artifact. Both states report `screen: game`, M20 Parkland Terrain Laboratory, Pixi/COZY, high graphics and high atlas. The client selects the largest intrinsic canvas (the minimap here); its final capture was opened and visually inspected. Full-course/guide proof comes from the separately inspected opening screenshots, not this minimap.

- `npx playwright test --config playwright.zk1107.config.ts e2e/zk623-biome-ui-contract.e2e.ts e2e/zk470-471-visual-foundation.e2e.ts` — **3/3 passed in 1.1m**. COZY/Architect/overview reversibility, the three-biome CourseCraft shell/focus contract and reduced contextual motion all pass. Generated legacy capture files were restored to their base bytes after the run; only ZK-1107 evidence is retained in this packet.

- `ZK1107_EVIDENCE=target npx playwright test --config playwright.zk1107.config.ts e2e/m14-onboarding.e2e.ts e2e/zk1107-opening-composition.e2e.ts -g 'real UI builds|ZK-1107'` — final **4/4 passed in 9.1m**. Real opening alone passed in 7.6m: authored hole, all recorded baseline/retest shots, real edit debit, reward exactly once, undo/redo, comparison penalties, retained receipts, reload and completion. Fresh keyboard/reduced-motion/layout tests passed at 1440×900, 1280×720 and 390×844 with clean console/page-error arrays.

Frozen implementation/test commit: `01f287cff9a3730f56a13fdcfada71511baed528`.
Evidence includes 9 baseline captures and 27 final target captures (8 full-loop
stages × 3 viewports plus 3 independently loaded authoring views).

- `npx vitest run src/ui/gameui/GameButtons.test.tsx src/game/onboarding/openingDemo.test.ts src/ui/biomeUiTheme.test.ts src/ui/renderer/scenes/openingPreviewScene.test.ts src/render/atlas.test.ts src/render/atlasManifest.test.ts --maxWorkers=1` — 6 files, 31 tests passed (6.49s).
- `npx tsc -b` — passed, both implementation and final refinement.
- `npm run lint` — passed; zero errors and nine inherited Hook warnings, both i18n guards passed.
- `npm run build` — passed after final refinement, including biome consumers, audio manifest, offline injection, M35 assets, Parkland-4x, surface residency and delivery budgets.
- `git diff --check` — passed.

Final main artifact: `index-CDxwRdIo.js`, 1,585,715 bytes, SHA-256
`b05db61763082f2b75e681f64e69448752fba6393d7eef726045bcbc2eaee7a6`.
Fixed initial-JS budget: 1,608,719 bytes (23,004 bytes headroom).
Initial critical transfer: 3,799,836 bytes; total dist: 116,608,603 bytes.
The build's cold-start / fixture-load fields reuse its established audit inputs;
they are not claimed as a new standalone performance measurement.

Final presentation source hashes:

- `src/ui/cozyLayout.css`: `56302b65baa9add8bc485023eaa0f0318a7f6918fd3f4a423c3f6bdea87adc6d`
- `src/ui/gameui/GameButtons.tsx`: `6292ef6f333ca494de915c41998d2be67646c0a790e5679a9ddd5dc0be4121c5`

## Earlier attempts, retained honestly

- Baseline `ZK1107_EVIDENCE=before npx playwright test --config playwright.zk1107.config.ts e2e/m14-onboarding.e2e.ts -g 'real UI builds'` — failed after 3.3m at unchanged camera-settle guard after reload. Captured nine before images across welcome, invite and current shot.
- Initial parallel browser pass: same target command plus `e2e/zk1107-opening-composition.e2e.ts` — screenshot timeout while waiting for fonts; focused tests incorrectly demanded `:focus-visible` immediately after pointer entry. Corrected the test to establish keyboard modality and serialized workers.
- `npx playwright test --config playwright.zk1107.config.ts e2e/zk1107-opening-composition.e2e.ts` — 3/3 passed (42.1s) before the final toolbar refinement. Early authoring screenshots exposed incomplete canvas readiness, so final evidence explicitly waits for the existing canvas/Pixi hook and two frames.
- First bundled client attempt at the title menu returned exit 0, but its 5-second entry selector timed out and text state remained `screen: menu`. This is **not gameplay proof**. The retained `game-client/` files document that failed attempt.

## Scope and acceptance boundary

Two bounded repair rounds were used after initial implementation. No renderer,
atlas, simulation, economic, save, deployment or dependency files changed.
The shared guide CSS also applies to the existing non-operator tutorial; shared
button state styling applies to all consumers of GameButton/IconButton.
No path overlap with shot-authority work; integration should recheck existing
`opening-current-shot`, `opening-evidence-context` and `opening-comparison`
presentation hooks if another packet changes their markup.
Human visual signoff and physical-device/GPU approval remain required.

## Handoff

Review-ready as a bounded UI implementation with green automated gates, **not**
approved production polish. The phone-resize camera crop, dense mobile scrolling,
automatic tier change in late long-run screenshots and missing independent
touch-only completion are explicit visual-acceptance caveats in README.md.
All owned Playwright/browser-client runs completed and closed their browsers;
the packet's localhost Vite process (PID 56162, port 4177) was stopped. No push,
merge, deploy, promotion or Linear mutation occurred. The main checkout was not
used for source edits; dependency packages were reused through a local symlink.
