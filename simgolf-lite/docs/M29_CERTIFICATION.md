# M29 Cloudflare playtest certification

Certification date: 2026-07-24

## Result

The Cloudflare Workers hosting, tested-artifact deployment gate, security/cache policy, PWA behavior, local-save behavior, and rollback path pass. Production telemetry code is privacy-hardened and ready, but Cloudflare Web Analytics and Sentry remain inactive until their dashboard projects and GitHub variables/secrets are configured.

## Deployment evidence

- Production: `https://coursecraft-playtest.zbkutlow.workers.dev`
- Staging: `https://coursecraft-dev.zbkutlow.workers.dev`
- `main` run `30114542510` deployed tested commit `dceb913a77c7559c0879e4b383a4a3f6443ea7f4`.
- Consecutive `main` run `30117048847` deployed tested commit `f4775ba3c28951ff7b0c731c5e87329d8f6c8cc3`.
- `develop` run `30120622623` deployed tested commit `ee957b4db1a6cf0484600a821f0fa2fa7405f7c3` to staging.
- Both GitHub deployment environments contain `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.

Each deployment job depended on the complete CI job, downloaded its `dist` artifact, and deployed without rebuilding it. Pull-request and wrong-branch deploy jobs were skipped.

## Live hosting evidence

- Production and staging root requests returned `200`.
- A production deep route returned the SPA shell with `200`.
- HTML, `sw.js`, and `manifest.webmanifest` returned `Cache-Control: public, max-age=0, must-revalidate`.
- Fingerprinted production assets returned `Cache-Control: public, max-age=31536000, immutable`.
- Live responses included the strict CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, the restrictive permissions policy, and `X-Robots-Tag: noindex, nofollow, noarchive`.
- The published artifact contained no source-map files.

## Browser and PWA evidence

- `npm run test:pwa` passed strict-CSP gameplay rendering, service-worker control, install metadata, offline reload, and local-save persistence.
- `npm run test:release:browsers` passed clean-profile gameplay, save/reload, keyboard input, resize, and accessibility settings in Chrome, Firefox, and WebKit.
- The bundled game client reached an in-game state with a visible rendered course in headed Chromium; the state artifact and inspected capture are in `artifacts/m29-client-headed`.

## Rollback drill

Staging rolled back from version `59a54224-6463-415e-9ea3-b01d0d1698ed` to the previous known-good version `973f325a-cdee-42b9-8a3a-32e2d0a91176`. The deep-route header check and live online/offline/save PWA smoke passed on the rolled-back version. Staging was then restored to `59a54224-6463-415e-9ea3-b01d0d1698ed`, and the restored root returned `200` with the expected headers.

After the stability and rollback gates passed, the temporary GitHub Pages workflow was removed and the repository's Pages site was disabled. A follow-up Pages API read returned `404`, confirming the fallback is no longer active.

## Privacy boundary

Sentry is production-only and disabled without a DSN. Its `beforeSend` sanitizer removes user data, breadcrumbs, arbitrary extras, request bodies/headers/cookies/environment/query strings, URL query/hash, device identifiers, response and gameplay state, arbitrary contexts/tags, spans, measurements, transaction names, SDK processing metadata, and server names. Only allowlisted app/browser/OS fields, React component stacks, error data, app version, and commit SHA remain.

Cloudflare Web Analytics is production-only and disabled without a site token. Its beacon explicitly enables SPA route measurement and records no custom gameplay events.

## Remaining authenticated setup

1. Create or select the Cloudflare Web Analytics site and add `VITE_CF_WEB_ANALYTICS_TOKEN` as a GitHub repository variable.
2. Create or select the Sentry React project and add repository variables `VITE_SENTRY_DSN`, `SENTRY_ORG`, and `SENTRY_PROJECT`, plus repository secret `SENTRY_AUTH_TOKEN`.
3. Deploy, trigger one controlled production exception, and confirm the event has the expected release/commit tags, de-minified stack, and sanitized payload.
4. Confirm a Cloudflare page view and Web Vitals arrive.
