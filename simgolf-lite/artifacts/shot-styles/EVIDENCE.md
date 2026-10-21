# ZK1400 browser evidence — October 21, 2026

Six browser cases passed after the production-main rebase. Tests use the existing Chromium Playwright harness at `127.0.0.1:4174`, one worker, zero retries, and the existing budgets/timeouts. This evidence uses actual round start, native club/style/power input, pointer aim, commit, pause, skip, save and load controls. The only Player Pro fixture mutation is initial course/career setup; no pending shot, result or completion is injected.

## Passed cases and stable evidence

| Case | Result | Evidence |
| --- | --- | --- |
| Actual nine-style commits, legal/blocked selections, keyboard native style input, three straight airborne captures, four style airborne captures, Chip/Putt rollout captures and final rest | Pass | [shot-style-evidence.json](shot-style-evidence.json), [airborne 0](airborne-0.png), [airborne 1](airborne-1.png), [airborne 2](airborne-2.png), [rest](first-shot-rest.png), [High Spin](airborne-3.png), [Pitch](airborne-4.png), [Draw](airborne-5.png), [Fade](airborne-6.png), [Chip rollout](rollout-7.png), [Putt rollout](rollout-8.png) |
| Default career explains learned technique/skill gates | Pass | [locked style requirements](locked-style-requirements.png) |
| Narrow touch commit, pseudo text, muted audio, reduced motion and 200% root text | Pass | [accessibility-evidence.json](accessibility-evidence.json), [touch screenshot](touch-pseudo-muted-reduced-200pct.png) |
| Ordinary selected live golfer follows retained current-segment motion | Pass | [selected-live-evidence.json](selected-live-evidence.json), [selected live screenshot](selected-live-retained-flight.png) |
| Real midflight autosave reload resumes same shot/motion and adds one stroke on completion | Pass | [reload-evidence.json](reload-evidence.json), [reloaded rest](midflight-reloaded-rest.png) |
| Same ordinary selected AI actor displays three canonical airborne positions | Pass | [ai-airborne-evidence.json](ai-airborne-evidence.json), [AI airborne 0](ai-airborne-0.png), [AI airborne 1](ai-airborne-1.png), [AI airborne 2](ai-airborne-2.png) |

The selected live actor was captured during actual retained rollout (normalized progress approximately 0.981), not claimed as an airborne capture. Its compact telemetry pose/identity and ball position match the full retained current segment read from an actual quick-save; telemetry does not include full motion arrays. The Player Pro captures separately prove airborne height/pixel placement.

## Reproduction and recorded context

- Setup-only Player Pro career seed: `360037`; first committed shot seed: `331899`; model: `club_styles_v1`; first shot: `7 Iron/straight_run`, power 25%.
- Desktop: `1600×1000`, English, standard motion/audio defaults. Three airborne captures use rotation `0`, observed zoom `0.8452502451181945`, camera center approximately `(16.06579, 11.63585)`. Exact camera transforms, normalized progress, heights, retained geometry and image hashes are in the JSON. Each passed the canonical position/absolute-height/isometric comparison and seven or eight visible ball pixels at the retained projected position beneath the actual pause backdrop.
- Touch: `390×844`, touch/mobile enabled, pseudo locale, profile text scale 130%, root font size 200%, master audio muted, reduced motion enabled; actual Pitch commit. Profile settings and the no-error list are recorded in the JSON.
- Ordinary live fixture run seed: `12160`; retained shot seed: `1158731082`; `Driver/straight_run`; `1440×960`. Actor identity and sampled pose are in the JSON.
- Reload: autosaved presentation progress approximately `.305`, paused approximately `.414`, resumed approximately `.631`. The exact same full retained motion survives actual Load Game and completion; final strokes = 1.
- Device pixel ratio is configured as `1` by the inherited Playwright Desktop Chrome device profile; a separate runtime DPR measurement was not added. PNGs are the actual captured browser canvas/page pixels.
- Every passing case recorded zero `console.error` and `pageerror` events. Scoped ESLint reports zero errors and three existing App hook dependency warnings. TypeScript `--noEmit` passed.

## All-player source confirmation

Read-only review confirms `src/game/live/intentStyles.test.ts` exercises all nine explicit styles through ordinary-live shared impact and retained motion. Its test `applies pitch's effort conversion once and keeps actor capability carry` checks two capability profiles (power 20 and 90): each frozen profile stores that actor's skills, and Driver requested carry equals that actor's frozen carry map.

`src/game/competition/challengeGroupProfileCalibration.test.ts` independently checks actor power 10 versus 90, preserves the host's shared geometry/calibration carrier, and checks participant-owned carry for both alternate-shot and scramble. These tests already cover the requested two-profile source/calibration behavior; no duplicate test was added here.

## Bounded correction history

The first authoring packet found harness issues with disabled native option assertions and headless macOS Chromium arrow selection; assertions now read the actual disabled attribute, and native keyboard typeahead selects High Spin. It also exposed that modern midflight autosave was skipped; the coordinator fixed that production persistence gap.

A separately approved authority-read packet used real quick-save for canonical motion. Exact pose/height/isometric checks passed, but the whole-course pause screenshot reduced the dimmed ball to about one antialiased pixel, so an undimmed/bright-pixel threshold was invalid. Its third attempt observed a wheel event's deliberate zoom clamp rather than the assumed zoom target; that packet stopped at its cap.

The approved camera packet had two attempts. The first reached usable zoom but read pointer projection before camera easing completed. The second observed camera target/current convergence and passed all three canonical pixel captures and all nine actual commits. The reload case first used compact telemetry where full motion is intentionally absent, then raced asynchronous quick-save completion; it passed after reading the actual saved canonical snapshot and observing completion. No budgets or timeouts were weakened. Failed traces remain in their original local diagnostic folders and are not copied into this stable evidence bundle.

Final passing runs before the additive shape-visibility packet: `shot-styles-matrix-v1` (3 cases), `shot-styles-camera-reload-v2` (2 cases). Product files were frozen; the additional shape-visibility packet changes only the new E2E test.


## Additive style-visibility acceptance packet

The expanded main case passed on its first attempt in `shot-styles-visible-matrix-v1` (18 seconds), with no production edits or result injection. It uses actual middle-button camera pans before committing later shots so the ball remains visible beside the pause dialog. The existing four independent passing cases are unchanged.

| Style | Captured phase | Motion progress | Height yards | Frozen shape | Screenshot |
| --- | --- | --- | --- | --- | --- |
| High Spin | airborne | .336 | 20.835 | apex20.925, launch24.5°, backspin | [airborne 3](airborne-3.png) |
| Pitch | airborne | .335 | 11.443 | apex11.5, launch25°, neutral spin | [airborne 4](airborne-4.png) |
| Draw | airborne | .331 | 14.407 | lateral curve +.11517 tiles | [airborne 5](airborne-5.png) |
| Fade | airborne | .334 | 13.429 | lateral curve −.10038 tiles | [airborne 6](airborne-6.png) |
| Chip | rollout | .787 | 0 | low retained flight apex1.56 followed by ground path | [rollout 7](rollout-7.png) |
| Putt | rollout | .187 | 0 | no retained flight, ground path only | [rollout 8](rollout-8.png) |

Each new capture matches canonical retained position, absolute height and isometric ball/shadow coordinates, with seven or eight visible ball pixels at that projection. High Spin's apex/launch exceed the comparable straight 7 Iron; Draw/Fade curve signs are opposite. Full exact parameters and per-capture camera state are retained in `styledCaptures` in [shot-style-evidence.json](shot-style-evidence.json). The same retained contract and sampler are used by the selected ordinary live actor; actor source/profile differences do not introduce a separate visual grammar.


## Ordinary selected AI airborne acceptance

A sixth independent case, `ordinary selected AI golfer displays three canonical airborne positions`, passed on its first attempt in `shot-styles-ai-airborne-v1` (22.8 seconds). The previous five cases remain unchanged. It uses the actual m47 live fixture, pauses the simulation clock, advances actual simulation time in 20ms steps at 1x, selects the real actor through the live overview and enables actual Follow. No geometry, pending result or outcome is forced.

Three distinct airborne positions of the same actor and shot are sampled from actual quick-saves. Telemetry point, absolute height, current segment ball position, and canonical retained motion agree. Every capture occurs strictly before retained flight end, and the actual visible ball pixels occupy its isometric projection with the retained absolute height converted using 2.5 yards per elevation step. Runtime camera transforms, seeds, actor identity, full canonical source, pixel counts and image hashes are in [ai-airborne-evidence.json](ai-airborne-evidence.json).

Screenshots: [AI airborne 0](ai-airborne-0.png), [AI airborne 1](ai-airborne-1.png), [AI airborne 2](ai-airborne-2.png). Unlike the separate ordinary-live rollout screenshot above, these three are explicitly airborne. The same shared retained path, absolute-height convention and camera transform used for Player Pro are proven visible for an ordinary AI actor.

AI capture details: actor `1` (Avery C.), run seed `12160`, retained shot seed `1158731082`, Driver/straight_run, viewport `1440×960`, rotation `0`, observed zoom approximately `.78055`. Airborne normalized times `.181/.381/.581` are all below flight end `.72`; absolute heights are `27.368/34.596/23.492` yards. Bright visible ball pixel counts are `2/2/1`, and the three screenshots were visually inspected. No corrections or failed traces were needed for this packet.


## Selected-shot playback with 100 background golfers

The independent performance case `selected retained shot stays within renderer work budget with 100 background golfers` passed on its first attempt in the coordinator's quiet window after full CI, production build and other benchmarks had exited. It uses the ordinary App `?perfFixture=1&perfMeasure=1`, `1440×900`, perf HUD enabled, and the existing eight-second warmup. Actual Operate → Player Pro → Play → Start round → Driver/Straight → Commit input starts the retained shot; power is read from the default UI and is not altered for measurement. No pending shot, result, course geometry or performance gate is injected.

Exact per-sample renderer work, phase/progress, golfer counts, profile settings and headless frame statistics: [selected-shot-performance.json](selected-shot-performance.json). Final actual rest screenshot: [100-golfer rest](selected-shot-100-golfers-rest.png).

Mean reported renderer work was **0.604ms**, maximum reported rolling work **0.619ms**, against the unchanged **8ms** ceiling. All 66 samples reported **100 golfers**. Airborne/rollout/rest samples: **32/12/12**; at least three distinct airborne progresses; one stroke added; zero console/page errors. Default selected power was 100%. The live clock can pause for Player Pro while all background golfer sprites remain in the renderer workload.

Raw headless frame spacing/FPS is recorded only; it is not treated as hardware smoothness certification or an additional frame-time gate. The browser harness has exited; no concurrent heavy process was started by this packet.

## Final conditions and calibrated club labels

Source checkpoint `c39ac227b1ed5aa33dd28c985b782798c80c9e7b` adds setup-only hazard/slope fixtures, the conditions/performance browser tests, and HUD labels projected from the same frozen actor carry profile used by physics and AI planning. Legacy rounds retain historical labels. Physics, retained motion and actor ownership are unchanged from the full regression checkpoint `46ede085e43506972996ed605b7236e8a3ceccb3` (301 files / 2,556 tests passed, one skip, plus five audio tests).

The eight condition shot cases and two independent native camera prerequisites passed; see [conditions/CONDITIONS.md](conditions/CONDITIONS.md) for exact commands, captures and bounded correction history. The final UI change passed 17 focused tests in three files, full lint/i18n (zero errors, four existing warnings), production build/typecheck/delivery audits, and the existing actual-input nine-style browser matrix. The new browser label test verifies all five tee clubs against the actual quick-saved profile and captures [calibrated-club-labels.png](calibrated-club-labels.png). Its initial test incorrectly expected sand wedge/chip on a tee; the next attempt asserted exactly the five eligible clubs and passed. No product availability or timeout changed.

Production remains unchanged. The repository requires an exact-SHA accepted develop artifact, while develop includes four other unreleased commits. A user scope choice is pending before that broader batch can be assembled. Hosted CI/deployment and physical-device/human authenticity remain Not Run; no milestone completion is claimed.
