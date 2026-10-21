# PlayerPro conditions evidence — 2026-10-21

All eight shot cases and two independent camera prerequisite cases passed with native UI inputs, one worker and zero retries. This directory contains only the accepted canonical JSON and named PNG captures: 10 JSON files and 27 PNGs. Failed-run traces/videos remain in the original attempt directories.

| Accepted case | Source run | Evidence |
| --- | --- | --- |
| Tree collision, airborne contact, vertical drop, zero roll and settled rest | `conditions-attempt1` | `obstacle-evidence.json`, `obstacle-*.png` |
| Water physical rest, separate legal relief, exactly one penalty | `conditions-attempt2` | `water-evidence.json`, `water-*.png` |
| Uphill 0° and 90°, downhill 0°, sidehill 0° | `conditions-attempt3` | matching `*-evidence.json`, `*-airborne-*.png`, `*-rest.png` |
| Native camera prerequisites at 180° and 270°, zero committed shots | `camera-preflight-attempt3` | `camera-preflight-*-evidence.json`, `camera-preflight-*.png` |
| Uphill 180° and 270°, unchanged shot assertions | `conditions-camera-final` | `uphill-r2-*`, `uphill-r3-*` |

The setup-only scene uses a tree at (4.5,8), a first-hole water strip x=8…54/y=5…11, or supported integer elevations `clamp(4+floor((x-4)/4)+floor((y-8)/4),0,15)`. Launch height is 10 yards, independently checked against the saved frozen-course surface sampler. Uphill target elevation delta is +3 steps, downhill −1, and sidehill 0 with a nonzero cross-line gradient. Rotation suffixes r0/r1/r2/r3 mean 0°/90°/180°/270°.

Shots use the actual round-start, club/style/power/aim, commit, pause, skip and quick-save controls. Canonical motion is read from that real quick-save. Each airborne capture compares actual retained progress, point, absolute height and renderer projection against the committed motion and verifies visible pixels at that projection. Static penalty rest is red; the separate legal-relief marker is orange. No pending shot, outcome, aim, result or playback cursor is injected.

The independent camera helper applies only to 180°/270°. It verifies `document.elementFromPoint` returns the native canvas, clicks exposed canvas before key input, reads exact committed rotation and completed tween through `viewportInputState()`, pans the launch point onto exposed canvas before wheel zoom, and waits for actual easing. App text camera telemetry can lag a completed rotation because its view report is throttled; native pan/wheel updates it before the unchanged shot-body camera assertions. No camera state setter is used by this helper.

Commands, from `simgolf-lite` (each used `--workers=1 --retries=0`):

```sh
./node_modules/.bin/playwright test e2e/shot-styles-conditions.e2e.ts --workers=1 --retries=0 --output=artifacts/shot-styles/conditions-attempt1
./node_modules/.bin/playwright test e2e/shot-styles-conditions.e2e.ts --grep 'water|uphill|downhill' --workers=1 --retries=0 --output=artifacts/shot-styles/conditions-attempt2
./node_modules/.bin/playwright test e2e/shot-styles-conditions.e2e.ts --grep 'raised plane' --workers=1 --retries=0 --output=artifacts/shot-styles/conditions-attempt3
./node_modules/.bin/playwright test e2e/shot-styles-conditions.e2e.ts --grep 'camera preflight only' --workers=1 --retries=0 --output=artifacts/shot-styles/camera-preflight-attempt3
./node_modules/.bin/playwright test e2e/shot-styles-conditions.e2e.ts --grep 'raised plane.*uphill-r[23]' --workers=1 --retries=0 --output=artifacts/shot-styles/conditions-camera-final
```

The first three runs retained bounded setup failures: unsupported fractional terrain picking, degree/step confusion, HUD-intercepted wheel input and stale text camera telemetry. At the slope-node cap, the remaining two cases were decomposed into an independent camera prerequisite node. Its attempt 1 exposed stale text rotation; attempt 2 completed native camera inputs but its extra no-shot check read an omitted summary field; attempt 3 checked the actual quick-save and passed 2/2 in 19.6 seconds. The subsequent unchanged shot bodies passed 2/2 in 23.9 seconds. The six already accepted shot cases were not rerun.

No physics edits, production camera changes, assertion thresholds, test timeouts or budgets changed. Product edits are limited to the setup-only scenario fixture and its test type. ESLint for the final test file passed with zero warnings/errors. Logs are `/private/tmp/coursecraft-shot-conditions-attempt{1,2,3}.log`, `/private/tmp/coursecraft-shot-camera-preflight-attempt{1,2,3}.log`, and `/private/tmp/coursecraft-shot-conditions-camera-final.log`.
