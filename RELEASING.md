# Releasing

A release should take about ten minutes.

1. **Verify green:** CI on `main` is passing (typecheck, lint, tests, build).
2. **Bump the version:** edit `simgolf-lite/package.json` `version` (SemVer:
   patch for fixes, minor for features, major for save-breaking changes —
   which should be never; saves migrate).
3. **Update `CHANGELOG.md`:** move items from `[Unreleased]` into a new
   `[x.y.z] - YYYY-MM-DD` section.
4. **Commit and tag:**
   ```bash
   git commit -am "Release vX.Y.Z"
   git tag vX.Y.Z
   git push origin main --tags
   ```
5. **Deploy:** pushing to `main` deploys automatically via the
   `deploy-production` job in `.github/workflows/ci.yml`, which promotes the
   exact artifact CI already tested to the `coursecraft-playtest` Cloudflare
   Worker. Verify the deployed title screen shows the new version string.
6. **Smoke test the deployment:**
   - New Game → paint terrain → place a hole via the wizard
   - Run the live sim at 1x and 3x for a game day
   - Save, reload the page, Load Game
   - Open Settings; toggle renderer canvas ↔ pixi

## One-time repo setup (owner)

- Settings → Pages → Source: **GitHub Actions** (enables the deploy workflow).
- Settings → Branches → protect `main`: require the **CI** check to pass
  before merging.
