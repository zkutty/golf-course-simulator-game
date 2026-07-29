# M29 current production telemetry/offline smoke

Run completed: 2026-07-29 03:06–03:09 UTC

Target: https://coursecraft-playtest.zbkutlow.workers.dev/

## Deployment under test

- Live root returned HTTP 200 with the expected noindex, strict CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and revalidating shell cache headers.
- Public bundle release: `coursecraft@1.0.0-rc.3+9717dc42d717`
- Public bundle commit tag: `9717dc42d717403e7a5abad34a8a6dd4a0e3df6b`
- Current main CI/deployment run: [30417545211](https://github.com/zkutty/golf-course-simulator-game/actions/runs/30417545211)
- Typecheck, lint, unit tests, golden-path E2E, build, and **Deploy tested artifact to Cloudflare production** all passed.

## Browser smoke

- Clean Chromium reached the in-game screen with a visible Pixi course canvas and structured `render_game_to_text` state.
- Service worker controlled the online page.
- A local persistence marker survived an offline reload; the offline shell loaded with the service worker still controlling the page.
- The controlled exception `M29 production telemetry smoke 20260729` was observed by the browser as the intended test error.

## Telemetry results

### Sentry — not passing

- The production DSN is present and the controlled event was sent to the Sentry envelope endpoint.
- The controlled event response was **HTTP 403**.
- The rejected event payload had the expected release `coursecraft@1.0.0-rc.3+9717dc42d717`, environment `production`, and tags `app_version=1.0.0-rc.3`, `commit_sha=9717dc42d717403e7a5abad34a8a6dd4a0e3df6b`.
- The payload exposed only the request `url` field from request context; no user, breadcrumbs, extra, cookies, query, headers, body, save, or gameplay fields were present.
- Result: the controlled production error is **not received/accepted**. The prior Sentry 403 blocker remains.

### Cloudflare Web Analytics — not passing

- No Cloudflare beacon script was inserted in the clean production page.
- No request to `cloudflareinsights.com` was observed.
- Inspection of the public application bundle shows the beacon configuration reads an empty token (`const e="".trim()`), so `VITE_CF_WEB_ANALYTICS_TOKEN` was not configured in the artifact under test.
- Result: no page-view/Web Vitals beacon evidence is available. The prior Cloudflare blocker remains.

## M29 decision

- ZK-274: **keep In Progress** — Sentry controlled-event receipt and Cloudflare Web Analytics are not passing.
- ZK-271: **keep In Progress** — hosting, CI deployment, and offline smoke pass, but the telemetry exit criterion is still unmet.
