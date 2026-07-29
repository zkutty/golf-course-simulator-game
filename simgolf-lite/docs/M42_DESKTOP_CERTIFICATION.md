# M42 desktop implementation and certification boundary

The desktop CI contract is intentionally split between deterministic agent
checks and provider/device gates.

## Agent-verifiable checks

- `npm run test:desktop` covers native atomic writes, backup recovery, window
  policy, cloud conflict semantics, and offline Steam fallbacks.
- `npm run test -- src/platform/platform.test.ts` covers browser fallbacks,
  bridge mapping, and quit event plumbing.
- `npm run desktop:pack:dir` builds the production renderer and unsigned
  Electron directory package. `npm run desktop:package:smoke` verifies the
  packaged `app.asar` and writes `coursecraft-desktop-manifest.json` with
  SHA-256 checksums into the ignored package output.
- Portable cloud state is limited to `saves/` and `profile/`. Settings,
  content caches, logs, screenshots, and machine-specific window state never
  enter the cloud namespace. Demo and full builds share a namespace, with
  compatibility checks preventing a demo from loading a full-only save.

## Deferred gates

The unsigned package manifest is evidence of packaging only. Code signing,
notarization, Steam App ID/client/API verification, Windows/macOS display and
sleep/wake matrices, minimum-spec packaged performance, update/clean-install
validation, and release certification remain human/provider-owned gates.
They must not be marked passed from this document or from CI on a developer
machine.
