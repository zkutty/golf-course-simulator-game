# M29 final production telemetry/offline smoke

Run completed: 2026-07-29 03:21 UTC

## Production origin

Target: https://coursecraftgame.com/

This is the app’s explicit `production` hostname mapping. The Workers
playtest hostname was separately checked for hosting, PWA control, offline
reload, and local persistence.

- Root returned HTTP 200.
- Current release: `coursecraft@1.0.0-rc.3+9717dc42d717`.
- Current commit: `9717dc42d717403e7a5abad34a8a6dd4a0e3df6b`.
- Root response carried the strict CSP, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `X-Robots-Tag: noindex, nofollow, noarchive`, and revalidating shell cache
  headers.
- The apparent `.js.map` URL returned the HTML fallback, not a source-map
  artifact; no published source-map content was present.

## Clean-browser results

- Quick Start reached the in-game screen with a visible Pixi course canvas.
- The service worker controlled the online page.
- Offline reload loaded the CourseCraft shell with the service worker still in
  control, and the local persistence marker `offline-save-20260729` survived.
- The controlled exception `M29 canonical production smoke final 20260729`
  was observed by the browser as the intended test error.

## Telemetry results

### Cloudflare Web Analytics

- The Cloudflare beacon script was present.
- A request to `cloudflareinsights.com` returned HTTP 200.
- This confirms the production beacon is active for the canonical production
  origin.

### Sentry

- The controlled event was accepted by the Sentry envelope endpoint with HTTP
  200.
- Event ID: `11ea212ea129446cb976fafa60687f0c`.
- The event carried environment `production`, release
  `coursecraft@1.0.0-rc.3+9717dc42d717`, app version `1.0.0-rc.3`, and the full
  commit tag `9717dc42d717403e7a5abad34a8a6dd4a0e3df6b`.
- The captured payload exposed only the request `url` key; `user`,
  `breadcrumbs`, and `extra` were absent.
- Sentry search independently found the event in `zachbot/coursecraft` at
  2026-07-29 03:21:04 UTC with the same release and production environment:
  https://zachbot.sentry.io/explore/discover/homepage/?dataset=errors&queryDataset=error-events&query=message%3A%22M29+canonical+production+smoke+final+20260729%22&project=4511794028740608&field=timestamp&field=message&field=release&field=environment&sort=-timestamp&statsPeriod=24h&yAxis=count%28%29

## Deployment gate

- Current main CI and Cloudflare production deployment passed in
  [run 30417545211](https://github.com/zkutty/golf-course-simulator-game/actions/runs/30417545211).
- The immediately preceding main CI and Cloudflare production deployment also
  passed in
  [run 30415720800](https://github.com/zkutty/golf-course-simulator-game/actions/runs/30415720800).

## Decision

- ZK-274 acceptance is verified on the canonical production origin.
- ZK-271 hosting, security, deployment, telemetry, offline, persistence, and
  consecutive-main-deployment gates are verified. Keep the Workers URL as the
  unlisted playtest entry point; the canonical production origin is the
  telemetry receipt origin used for this smoke.
