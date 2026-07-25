# M35 certification status

**Milestone:** M35 — Continuous Landscape & Visual Polish
**Tracking issues:** ZK-332 (certification), ZK-327 (parent), ZK-466 (human visual gate), ZK-473 (agent parity gate)
**Baseline commit for this report:** `3e65380` (`claude/linear-handoff-completion-phzqf2`,
`main` + `develop` reconciled). Gate results in §3 were measured on `9981588` (`main` alone)
and re-measured on the merged tree where noted.
**Report date:** 2026-07-25

---

## 1. Headline: the previous certification candidate is not in the repository

The 2026-07-25 handoff comments on ZK-332, ZK-473, and ZK-466 describe a certification
candidate that was explicitly recorded as **an uncommitted dirty working tree on base
`6944abe`**. That working tree lived in an ephemeral session container which has since
been reclaimed. The tree was never committed, stashed, or pushed.

Verified against every ref in this repository:

| Expected artifact | Present in git? |
| --- | --- |
| `docs/M35_CERTIFICATION.md` (the prior handoff file) | No — never committed on any ref |
| `e2e/m35-landscape-details.e2e.ts` | No |
| `e2e/m35-surface-authoring.e2e.ts` | No |
| `e2e/m35-water-grading.e2e.ts` | No |
| Shared-vertex visual heightfield (ZK-470) | No — no `heightfield` symbol on any ref |
| World-anchored material field (ZK-469) | No — no `materialField` symbol on any ref |
| Rounded component silhouettes (ZK-468) | No — no component-silhouette derivation on any ref |
| 4× Parkland art vertical slice (ZK-472) | No |
| Renderer resize-instead-of-teardown fix | No — `PixiStage.tsx:1129` still destroys the app on `resolutionScale` change |

Corroborating signal — suite sizes shrink by exactly the missing work:

| Gate | Handoff claim (lost tree) | `main` @ `9981588` | Merged @ `3e65380` |
| --- | --- | --- | --- |
| Vitest files | 88 | 69 | 80 |
| Vitest passed | 552 | 432 | 502 |
| ESLint warnings | 11 | 7 | 7 |

Reconciling `main` and `develop` recovers 11 files and 70 tests, which confirms part of the
earlier gap was simply the branch divergence. The remaining shortfall against the handoff's
claim — 8 files and 50 tests — is the lost M35 work itself.

`git stash list`, `git reflog`, and `git status --porcelain --ignored` are all empty in a
fresh clone. Nothing is recoverable from this checkout.

### Consequence for the Linear board

ZK-468, ZK-469, ZK-470, ZK-471, and ZK-472 are marked **Done** (completed between 15:19
and 19:00 UTC on 2026-07-25), but their implementations are **not merged and not present
in git**. `develop` tips at `6944abe` (2026-07-25 01:12), which predates all five
completions. Their acceptance evidence has to be treated as unverifiable until the work is
re-landed.

ZK-473 therefore cannot produce a meaningful `READY`/`NOT READY` verdict: there is no
committed higher-definition Parkland build to review. ZK-466 correctly remains blocked.

---

## 2. Branch topology — reconciled

Before this session:

- `main` @ `9981588` — the release lane (M36–M40, premium systems, Sentry, CI, deploy).
- `develop` @ `6944abe` — the M35 terrain lane (M28/M30, M45, coastlines, terrain relief).
- Merge base `a155ea0`; `develop` 12 ahead, `main` 5 ahead. Neither branch alone could be
  certified, because each was missing half the product.

`3e65380` merges `develop` into the release lane. Conflict resolutions:

| File | Resolution |
| --- | --- |
| `src/monitoring.ts` | Both sides added a function at the same position and both are still called below — keep `resolveSentryEnvironment` (main) and `cloudflareBeaconConfiguration` (develop). |
| `AudioManager.ts`, `m15-audio.e2e.ts`, `CREDITS.md` | main's `cf4136b` is a cherry-pick of develop's `0dcd96c`, but develop then refined it with `2aaa4ff` (`authoredAmbienceAllowed`, `stopMusicSlots`, single-stream enforcement, 350 ms fades) which main never received. Took develop's strictly-newer side. |
| `progress.md` | Both conflict hunks are pure additions from develop; taking them is a union and drops nothing from main. |

The reconciled tree is the correct base for re-landing ZK-468–472.

---

## 3. Gate results on the committed baseline (`9981588`)

Run in the session container: Linux, Node v22.22.2, headless Chromium 141 (build 1194),
no discrete GPU.

| Gate | Command | Result |
| --- | --- | --- |
| Unit | `npx vitest run --reporter=dot` | **Pass** — 69 files, 432 passed, 1 skipped on `9981588`; **80 files, 502 passed, 1 skipped** on merged `3e65380` |
| Fuzz | `npm run test:fuzz` | **Pass** — 3 properties |
| Types | `npx tsc -b --pretty false` | **Pass** |
| Lint + i18n | `npm run lint` | **Pass** — 0 errors, 7 React Hook warnings |
| Production build | `npm run build` | **Pass** — 40-file audio audit, 23 offline assets injected |
| PWA | `npm run test:pwa` | **Pass** — strict-CSP render, scoped install, offline reload, save persistence |
| Performance | `npm run test:perf` | **Fail on cold start** — see below |
| Browser (M17/M27/M6/M7) | see §4 | see §4 |

### Performance detail

```
renderer work        0.90 ms   (budget 8 ms)      PASS
p95 frame            100 ms    report-only        fixed 10 FPS harness, not a real p95
cold startup       13942 ms    (budget 5000 ms)   FAIL
36-hole fixture    26526 ms    load time
```

Renderer work is comfortably inside budget. The cold-start failure is measured on a
shared, GPU-less CI-class container and should be re-measured on target hardware before
being treated as a product regression — but it is a **failing gate as recorded here** and
must not be reported as green.

### Bundle sizes (gzip)

```
index   335.32 KB      pixi   150.39 KB      react   60.34 KB      vendor   5.30 KB
```

The handoff's "251 KB gzip game entry" describes the lost tree, not this baseline.

---

## 4. Browser gate reruns

The handoff's pending item #1 was an isolated rerun of four specs:

```
npx playwright test --config playwright.sandbox.config.ts \
  e2e/m17-retention.e2e.ts:3 e2e/m27-architecture-release.e2e.ts:3 \
  e2e/m6-tournaments.e2e.ts:3 e2e/m7-progression-live.e2e.ts:3 --workers=1
```

**Status: still unresolved.** The first attempt failed to launch (sandbox browser
mismatch, fixed below). The second attempt was interrupted by a container restart while
running, and a third attempt was still executing `m17-retention` when this report was
committed. No verdict has been produced for these four specs in this session, and the
handoff's "61 passed / 8 failed" repository-wide snapshot therefore remains the last known
state. **Do not record these four as green.**

The handoff's pending item #2 named `m35-landscape-details`, `m35-surface-authoring`, and
`m35-water-grading`. Those specs do not exist in this repository (§1). The surviving M35
browser gate is `e2e/m35-continuous-landscape.e2e.ts`.

### Sandbox browser note

This container ships Playwright browser build 1194 at `/opt/pw-browsers`, while
`@playwright/test` 1.61 resolves build 1228, so the default headless-shell launch fails.
`scripts/perf-smoke.mjs` already resolved `CHROMIUM_PATH` / `/opt/pw-browsers/chromium`;
`scripts/pwa-smoke.mjs` did not and has been given the same resolution. For the Playwright
specs, `playwright.sandbox.config.ts` extends the committed config with an
`executablePath` override. Neither change alters test behaviour on a normally provisioned
machine.

---

## 5. Gates that cannot be closed from this environment

| Gate | Why | Owner |
| --- | --- | --- |
| Mid-range and low-end **physical-GPU** frame p95 | Container is headless with no discrete GPU; software rasterization cannot produce a valid p95 | Human, on target hardware |
| ZK-473 `READY`/`NOT READY` parity verdict | No committed higher-definition Parkland build exists to capture (§1) | Blocked until ZK-468–472 are re-landed |
| ZK-466 human visual approval | Explicitly a human decision; last recorded verdict (2026-07-25) was **not approved** — corners too sharp, detail resolution far from source | Human |

---

## 6. Required next steps, in order

1. **Decide the recovery path for ZK-468–472.** Their specs are fully written in Linear;
   the code is gone. Either re-implement against those specs or reopen them.
2. **Reconcile `main` and `develop`** so the M35 terrain baseline and the release lane sit
   on one branch before any certification capture.
3. Re-land the work with **committed** evidence — one deliberate commit per issue, no
   dirty-tree handoffs.
4. Re-measure cold start and physical-GPU frame p95 on target hardware.
5. Only then run ZK-473 in a fresh context against an exact commit, using the four
   SimGolf references attached to ZK-327.
6. Only on a `READY` verdict, request human visual approval on ZK-466.

**Do not mark ZK-332 or the M35 milestone Done before steps 1–6 complete.**
