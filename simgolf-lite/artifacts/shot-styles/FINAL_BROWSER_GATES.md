# Final browser acceptance gates

Verified on 2026-10-21 against the feature working tree after the source freeze. These are working-tree acceptance results, including the integrated feature edits; they are not a claim that an earlier commit alone contains those edits.

All runs used the existing `playwright.config.ts`, `--workers=1 --retries=0`, default test timeouts and unchanged assertions. They ran sequentially against the local Vite server on port 4174. No performance benchmark ran during this packet.

| Gate | Result | Total duration | Evidence |
| --- | --- | --- | --- |
| Existing M36–M37 Player Pro UI flow | 1 passed | 10.1 s | `final-m36/`; `/private/tmp/coursecraft-shot-existing-m36.log` |
| Ordinary selected AI, three canonical airborne positions | 1 passed | 24.6 s | `final-ai/`; `/private/tmp/coursecraft-shot-final-ai.log` |
| Full M69 architecture browser certification | 13 passed | 1.2 min | `final-m69/`; `/private/tmp/coursecraft-shot-final-m69.log` |

The ordinary AI evidence records three 1440×960 captures, retained motion and projection facts, visible-ball pixel checks, and no browser errors. The M69 run includes all twelve biome/rotation visual fixtures and the authored tee/pin selection case; no visual slice or fixture-ID filters were applied.

Commands, from `simgolf-lite`:

```sh
./node_modules/.bin/playwright test e2e/m36-player-pro.e2e.ts --workers=1 --retries=0 --output=artifacts/shot-styles/final-m36
./node_modules/.bin/playwright test e2e/shot-styles-flight.e2e.ts --grep 'ordinary selected AI golfer displays three canonical airborne positions' --workers=1 --retries=0 --output=artifacts/shot-styles/final-ai
./node_modules/.bin/playwright test e2e/zk765-m69-certification.e2e.ts --workers=1 --retries=0 --output=artifacts/shot-styles/final-m69
```

Existing shot-style evidence was preserved. Prior hardcoded M36 screenshots were copied to `prior-m36-20261021/` before the legacy test wrote its new captures. No source changes or test weakening were needed for this verification packet. The Playwright process exited successfully and released port 4174 before the queued M65 run.
