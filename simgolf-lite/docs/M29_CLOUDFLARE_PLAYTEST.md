# M29 Cloudflare playtest operations

CourseCraft deploys as a client-only PWA through Cloudflare Workers Static Assets. There is no runtime Worker handler, API, authentication, or server-side save storage. The stable playtest hostname is `coursecraft-playtest.<account-subdomain>.workers.dev`; preview URLs are disabled.

## One-time account setup

1. Create or select a Cloudflare account and configure its `workers.dev` subdomain.
2. Create a least-privilege API token that can deploy Workers in that account.
3. Create the GitHub environment `playtest` and add environment secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.
4. Create a Sentry browser/React project. Add `SENTRY_AUTH_TOKEN` as a repository secret and add `SENTRY_ORG`, `SENTRY_PROJECT`, and the public `VITE_SENTRY_DSN` as repository variables so the CI build job can read them.
5. Create a Cloudflare Web Analytics site and add its public token as the repository variable `VITE_CF_WEB_ANALYTICS_TOKEN`.

The deployment job consumes the `dist` artifact produced by the required CI job. It never rebuilds after testing. Merges to `main` deploy only after typecheck, lint, unit, browser, and production-build gates pass.

## Privacy and access

The playtest hostname is unlisted, not private. `robots.txt`, page metadata, and `X-Robots-Tag` discourage indexing, but anyone with the URL can open it. Enable Cloudflare Access with an explicit tester-email policy if confidentiality becomes necessary.

Sentry receives errors, release/commit tags, browser context, and React component stacks. The client strips users, cookies, headers, request bodies, query strings, breadcrumbs, arbitrary extras, save payloads, and gameplay state. Cloudflare Web Analytics collects traffic and Web Vitals only; there is no gameplay-event analytics.

## Validation and rollback

- Run `npm run build`, `npm run test:pwa`, and `npm run deploy:check` locally.
- Confirm `/`, `/sw.js`, `/manifest.webmanifest`, atlases, audio, and a client-side fallback route load from the Worker hostname.
- Verify `sw.js`, HTML, and the manifest revalidate, while fingerprinted `/assets/*` responses are immutable.
- Confirm a controlled Sentry exception resolves to the original source and contains no player/save data.
- Confirm Cloudflare Web Analytics receives a page view and Web Vitals.
- Roll back from Workers & Pages > Deployments by selecting the last known-good version and promoting it. Re-run online, offline, and save/load smoke checks afterward.

Keep GitHub Pages as a fallback until two consecutive Cloudflare deployments and the cross-browser/PWA checks pass. Then disable `.github/workflows/deploy.yml`; browser storage remains origin-scoped and is not migrated from the Pages hostname.
