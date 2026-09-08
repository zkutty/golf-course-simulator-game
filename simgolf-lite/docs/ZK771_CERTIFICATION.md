# ZK-771 machine certification boundary

The machine disposition is exactly `machine-pass/HOLD_FOR_HUMAN_VISUAL_SIGN_OFF`.
This local, deterministic packet freezes the released development input commit
`c3eb15b0caee5ea548b076c1553993795bd70505` and tree
`f9cfc17e19f43f3afbf5e3712df37c6c00c28d88`, which is tree-identical to
production `94683b`. It retains 48 final-style SVG/PNG pairs (480×320 PNG
review rasters), actual
Sharp-rasterized 9-hole and 18-hole SVG/PNG atlases, and one self-contained
PNG contact sheet for external human review.

No human originality, visual hierarchy, or biome-cohesion judgment is claimed.
`human-visual-sign-off` remains required and is not machine-passed.

Run from `simgolf-lite`:

```text
node --test scripts/zk771-certification-contract.test.mjs
node scripts/zk771-certify.mjs --write
node scripts/zk771-certify.mjs --check
```

`--check` regenerates only into a temporary directory and rejects input source,
provenance, artifact-set, artifact-byte, report, manifest, or documentation
marker drift. Generation is fully local and makes no network, cloud, or
generative request.

<!-- zk771-report-digest:b5e3ba8dce209e74d75494dc781f350d1ba6bdc8ea7ac18b2c925327e360f23e -->
