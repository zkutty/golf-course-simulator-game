# M65 profile certification packet (ZK-813)

## Disposition

The M65 machine disposition is **`machine-pass/HOLD_FOR_HUMAN_VALIDATION`**.
This packet certifies deterministic structural, headless, browser, and
native-shaped save-carrier evidence. It does not claim that M65 is released,
that a human gate passed, or that production promotion is authorized.

The versioned source manifest is
[`release/m65-certification-manifest.json`](../release/m65-certification-manifest.json).
`npm run test:cert:m65` validates the manifest and its bound source hashes,
executes the bounded headless and five-case Chromium certifications, consumes
their structured zero-retry results, and checks the tracked bytes of
[`artifacts/m65/certification-report.json`](../artifacts/m65/certification-report.json).
The report intentionally has no wall-clock timestamp, machine path, branch, or
dirty-worktree field, so identical inputs produce identical bytes and digest.

## Machine evidence boundaries

| Evidence class | Certified scope | Explicit boundary |
| --- | --- | --- |
| Structural | All 9 experience-profile/economic-pressure pairs are selected with keyboard controls and preserved in created-run text state. | Structural selection is not a long-form player journey or subjective preference result. |
| Headless | 9 deterministic rows and 7 checks cover current, browser JSON, native-shaped, and legacy normalization; authority; campaign receipts; and multi-week save/resume. | Receipt creation is not real campaign mastery or finale completion. |
| Browser | 5 cases cover the 9-axis matrix, 6 campaign assignments, Classic takeover save/reload, keyboard tutorial launch, pointer first-hole authoring, pseudo-localized content, and 390 × 640 overlay containment. | This bounded workflow is not proof of a fully keyboard-accessible design, nor is automated Chromium a human accessibility, authenticity, device, or packaged-desktop review. |
| Native-save | The native-shaped in-memory carrier hashes identically to current and browser carriers. | No physical desktop file picker, filesystem, packaged application, operating system, or device was exercised by this evidence. |

The headless determinism hash is `c8da3467`. Certification code remains under
`src/game/testing/` and is not imported by the production runtime.
The generated report SHA-256 digest is
`51f2579b9cd43e5ed45b44a08c66f7025d5b3b5f831c62a5db86beca16b8c79a`.
<!-- m65-report-digest:51f2579b9cd43e5ed45b44a08c66f7025d5b3b5f831c62a5db86beca16b8c79a -->

## Deferred human gates

These issues remain required and are recorded with `machineClaim: false`:

1. [ZK-255](https://linear.app/zkutty/issue/ZK-255)
2. [ZK-374](https://linear.app/zkutty/issue/ZK-374)
3. [ZK-403](https://linear.app/zkutty/issue/ZK-403)
4. [ZK-404](https://linear.app/zkutty/issue/ZK-404)

Moderated play, subjective golf authenticity, human accessibility review,
physical-browser/device/GPU behavior, packaged-desktop save behavior, and
release-owner sign-off are not represented as machine-passed.

## Validation commands

Run from `simgolf-lite`:

```text
npm run test:cert:m65
  PASS — contract 4/4, observed headless 1/1, and Chromium browser 5/5 in 5.2m;
  fails on source tamper, invalid structured results, report-byte drift, or docs-digest drift

node scripts/m65-certify.mjs --write
  Regenerates the versioned report and docs digest only after both observed gates pass

npx tsc -b --pretty false
  PASS — 7.32s

npx eslint <M65 and compatibility files>
  PASS — zero findings in 1.51s

npx playwright test e2e/zk813-profile-certification.e2e.ts --workers=1 --reporter=line
  PASS — Chromium 5/5 in 5.2m with zero retries

npx playwright test --config playwright.release.config.ts --grep ZK-813 --project=firefox --project=webkit-safari-proxy --workers=1 --retries=0
  PASS — Firefox 5/5 plus WebKit 5/5 in 3.5m; combined cross-engine file 15/15

npx playwright test e2e/m24-tournament-standards.e2e.ts --workers=1 --reporter=line
  PASS — 3/3 in 110.17s on the same server

npx playwright test e2e/m31-property-enterprise.e2e.ts --workers=1 --reporter=line
  PASS — 1/1 in 91.81s on the same server

npm run build
  PASS — 19.77s; initial JavaScript 1,606,881 bytes
```

The final production build contains 246 files and is byte-identical to the
exact released-base build: both have whole-dist SHA-256 digest
`df3a9b4a6669ff0b7628205d432b56d880631201403528daf5854a14ba8dab22`.
Initial-JavaScript growth is exactly zero bytes.

The bundled web-game client completed two iterations on a meaningful Classic /
Balanced live fixture with no console/page-error artifact. Its inspected canvas
captures show the one-hole fairway corridor, white tee, red pin/green endpoint,
and selection outline. The inspected Playwright captures show the authored
desktop first-hole route and a readable, contained 390 × 640 pseudo-locale
tutorial card. Full release gates and human validation remain separate from
this local packet.

The final closure client rerun also completed two Relaxed/Friendly gameplay
iterations. Its inspected Parkland canvas capture and text state agree on the
active game/editor state, and it produced no console/page-error artifact.

The cross-engine portability repair does not filter console messages. After a
deliberate reset settles at the visible title, it closes the prior document's
teardown boundary; each of the nine profile/pressure setup-and-run iterations
then requires its own clean console/page-error array before the next reset.
