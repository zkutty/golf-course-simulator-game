# Local legacy audio quarantine

This ignored directory is the only permitted output location for archived
audio experiments. It is intentionally empty apart from this notice after the
superseded pre-Suno MP3s were removed on 2026-07-29.

`scripts/gen-audio.mjs` may regenerate deterministic M15 Ogg/M4A experiments
here for documentation or comparison only. They are not release assets, are
not referenced by the application, and must never be copied into `public/`,
`dist/`, or a deployment artifact. The release audio audit rejects any
file-backed runtime recording that is not one of the 40 manifest-owned Suno
MP3s.
