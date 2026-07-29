# M28 release gate status

Release candidate `1.0.0-rc.4` is **HOLD** until the external gates below have
real evidence from the exact deployed main-branch build. The certification
manifest intentionally rejects a false GO decision or a passed gate without an
evidence reference.

## Automated gates

Run these against the candidate commit and attach the generated artifacts or CI
run to the matching Linear issue:

- ZK-254: `npm run test:pwa && npm run test:e2e:golden`
- ZK-256: `npm run test:release:browsers`
- ZK-257: `npm run test:balance`
- ZK-258: `npx playwright test e2e/m28-release-candidate.e2e.ts`
- Supporting gates: `npm run lint`, `npm run test:ci`, `npm run build`,
  `npm run test:fuzz`, `npm run test:soak`, and `npm run test:perf`

## External gates

- ZK-253: deploy the exact `main` commit and record commit, URL, deployment ID,
  UTC time, base path, cache/PWA check, and rollback target.
- ZK-255: complete 5–10 clean-profile sessions using
  `M28_PLAYTEST_PROTOCOL.md`.
- ZK-256: repeat the clean-profile release path in latest stable Firefox and
  Safari on macOS; Playwright Firefox/WebKit results are comparison coverage.
- ZK-259: complete the two physical-device runs using
  `M28_HARDWARE_PROTOCOL.md`. Headless browser results are not substitutes.
- ZK-260: link every finding, disposition, retest, and remaining blocker after
  ZK-255 and ZK-259.
- ZK-261: change the manifest decision to GO only after every prerequisite has
  passed; otherwise retain HOLD and record owners and the next decision point.

## Current RC4 implementation verification — 2026-07-29

The current working tree for `1.0.0-rc.4` passed the implementation-focused
verification packet: 98 unit files (817 passed, 1 skipped), lint with zero
errors, production build, exact 40-file Suno audio audit, M35 asset audit,
Parkland 4× contract audit, and all three M15 audio browser scenarios. These
results do not replace the external M28 gates below.

## Local automated evidence — 2026-07-24

These results were produced from the working tree for `1.0.0-rc.3`. They
certify implementation behavior, but they are not evidence of an exact
main-branch deployment.

| Gate | Result |
| --- | --- |
| Unit | 70 files; 438 passed, 1 intentionally skipped |
| Build/lint | production build passed; 0 lint errors; 7 accepted existing hook warnings |
| ZK-254 | PWA strict-CSP/install/offline/save smoke passed; golden path 9/9 |
| ZK-256 proxy coverage | installed Chrome, Playwright Firefox, and WebKit 3/3; stable Firefox/Safari sign-off still outstanding |
| ZK-257 | 81 runs × 104 weeks; 0 normal-path bankruptcies; latest first profit week 2 |
| ZK-258 | clean-profile accessible release path passed; keyboard and accessible settings also covered by golden path |
| Fuzz | 3/3 |
| Soak | 30 weeks; 4,638 rounds; 3.01 MB retained-heap growth |
| Headless performance | 0.35 ms renderer work; cold startup 940 ms; frame p95 report-only |
| M30 browser | identity, advisor focus, 7/28-day and multi-course reporting passed |
| Source audit | all content/security/PWA checks passed; clean-source check correctly failed on this uncommitted feature branch |

Run `npm run release:certify:m28` to validate the manifest and emit
`artifacts/m28/certification-report.json`.
