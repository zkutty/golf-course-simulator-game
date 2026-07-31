# M53 / ZK-571 certification

Certification contract: `m53-zk571-v1`

Automated disposition: **automated-evidence-passed-final-gates-deferred**

## Machine gate manifest

| Gate | Execution | Outcome | Coverage |
| --- | --- | --- | --- |
| certification-runner-contract | executed | pass | pinned performance environment, performance evidence schema, hostile inherited environment |
| deterministic-core-report | executed | pass | living seasons, all weather kinds, ZK-646 economics, adaptive quality, risk register |
| authoritative-focused-units | executed | pass | multi-year transitions, ZK-647 persistence/performance, historical/current saves, direct golf, live operations |
| broad-unit-suite | executed | pass | regression surface |
| deterministic-soak | executed | pass | long-horizon simulation, save/reload determinism |
| production-build-payload | executed | pass | bundle, payload, audio assets, service-worker assets, biome assets |
| audio-asset-unit-audit | executed | pass | audio assets, fallback |
| browser-screenshot-matrix | executed | pass | ZK-648 dock, screenshot matrix, adaptive quality, surface care, audio, responsive, accessibility semantics |
| pwa-smoke | executed | pass | PWA, offline shell |
| desktop-unit | executed | pass | desktop bridge, window/security behavior |
| performance-parkland | executed | pass | renderer work, cold startup, adaptive quality, parkland |
| performance-links | executed | pass | renderer work, cold startup, adaptive quality, links |
| performance-desert | executed | pass | renderer work, cold startup, adaptive quality, desert |
| linear-prerequisite-reconciliation | deferred | not-run | ZK-379 and supporting M53 issue/milestone statuses remain pending final human validation and Linear reconciliation; do not close ZK-571. |
| human-visual-matrix | deferred | not-run | Review the retained 12 fixed-camera, High-quality desktop captures (3 biomes × 4 seasons) plus the single narrow responsive sample; separately review all four rotations and Low/Medium/High adaptive-quality transitions interactively. |
| human-listening-matrix | deferred | not-run | No subjective listening is permitted in this machine-only pass. |
| physical-gpu-frame-pacing | deferred | not-run | Headless software rendering reports raw frame spacing but does not assert it. |
| signed-distribution | not-applicable | not-run | No signing, storefront, provider, or deployment target is in scope. |

## Deterministic core

Core checks: 12/12 passed. Determinism hash: `b3647ff8`.

The report reuses the existing authoritative save, surface-care, seasonal, renderer, startup, and bundle/payload budgets. Local elapsed timings are recorded separately and do not change pass/fail.

## Unresolved-risk register

- **ZK571-R1 (open, medium)** — The combined legacy browser audio suite has a known timing-sensitive flake when many audio scenarios share one long run. Mitigation: Keep ZK-570 audio certification isolated and deterministic; do not treat a legacy combined-suite retry as listening evidence.
- **ZK571-R2 (deferred, high)** — Machine pixel/state assertions cannot establish visual quality, legibility, golf authenticity, or absence of subtle compositing artifacts. Mitigation: Review the retained 12 fixed-camera, High-quality desktop captures (3 biomes × 4 seasons) plus the single narrow responsive sample. Separately perform an interactive review of all four rotations and Low/Medium/High adaptive-quality transitions; these are not represented as 144 retained screenshots.
- **ZK571-R3 (deferred, high)** — Automated audio state and asset checks cannot establish mix quality, clipping perception, fatigue, or transition musicality. Mitigation: Human listening review of design, management, and golf music plus biome ambience, weather overlays, transitions, mute, and fallback behavior.
- **ZK571-R4 (deferred, high)** — Headless software rendering reports frame spacing but does not assert physical-GPU frame pacing. Mitigation: Real-hardware GPU frame pacing and thermal/load review for each biome and adaptive-quality path.
- **ZK571-R5 (deferred, medium)** — Automated roles, names, state, and focus checks do not replace assistive-technology and human accessibility review. Mitigation: Keyboard-only, screen-reader, reduced-motion, text-scaling, contrast, and color-independent-marking review.
- **ZK571-R6 (deferred, medium)** — Provider signing, storefront distribution, and hosted release state are outside the local repository certification boundary. Mitigation: Signed desktop package, provider-backed distribution, and hosted-release verification if required by release operations.
- **ZK571-R7 (deferred, high)** — ZK-379 and supporting M53 issue/milestone statuses remain pending final human validation and Linear reconciliation. Mitigation: Reconcile the prerequisite and supporting Linear statuses only after final human validation; do not close ZK-571 from machine evidence alone.

## Human verification matrix (deferred)

- Review the retained 12 fixed-camera, High-quality desktop captures (3 biomes × 4 seasons) plus the single narrow responsive sample.
- Separately perform an interactive review of all four rotations and Low/Medium/High adaptive-quality transitions; these are not represented as 144 retained screenshots.
- Human listening review of design, management, and golf music plus biome ambience, weather overlays, transitions, mute, and fallback behavior.
- Keyboard-only, screen-reader, reduced-motion, text-scaling, contrast, and color-independent-marking review.
- Real-hardware GPU frame pacing and thermal/load review for each biome and adaptive-quality path.
- Golf-authenticity and long-horizon balance playtesting for climate strategy, direct golf, live operations, wear, recovery, and repair.
- Signed desktop package, provider-backed distribution, and hosted-release verification if required by release operations.

No subjective screenshot inspection or listening was performed by this certification command.

Retained screenshot evidence consists of 12 fixed-camera, High-quality desktop captures (3 biomes × 4 seasons), one narrow responsive sample, and their machine manifest. Rotation and Low/Medium/High adaptive-quality behavior require a separate interactive review; Playwright traces, videos, retries, and attachment copies are ephemeral.
