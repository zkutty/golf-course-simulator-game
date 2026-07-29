# PixelLab art pipeline pilot

This pipeline evaluates PixelLab as a **specialist** inside CourseCraft's
polished-hybrid art direction. It does not make PixelLab a runtime dependency,
replace deterministic terrain generation, or allow generated output to enter
production without review.

## Security boundary

The credential pasted during planning is considered compromised and must be
revoked. Create a replacement in PixelLab, then export it in the parent shell:

```sh
export PIXELLAB_AUTH_HEADER='Bearer <rotated-token>'
npm run art:pixellab:doctor -- --require-auth
```

Never put the value in Codex config, a committed `.env`, prompts, manifests,
screenshots, or issue comments. `.env.example` documents the variable name
only; `.env*` is ignored except for that template.

Use this reviewed MCP shape in the user-level Codex configuration after the
environment variable is present:

```toml
[mcp_servers.pixellab]
command = "npx"
args = [
  "-y",
  "mcp-remote@0.1.38",
  "https://api.pixellab.ai/mcp",
  "--transport",
  "http-only",
  "--header",
  "Authorization:${PIXELLAB_AUTH_HEADER}",
  "--silent"
]
```

The package version is pinned; do not replace it with a floating release tag
without a reviewed upgrade. Restart Codex after changing MCP configuration.
The doctor never prints the credential.

## Stages and promotion

Generated files live under the ignored `art/pixellab/staging/` tree:

```text
staging/
  raw/        provider output, unchanged
  candidate/  selected output
  cleaned/    alpha/palette/anchor/frame cleanup
  approved/   human-approved candidate for isolated atlas certification
```

The tracked `manifest.json` is the audit trail. Each record carries the
provider/tool, model or endpoint, generation time, prompt/reference IDs and
hashes, cleanup history, reviewer decision, license notes, promotion path, and
optional measured payload/texture-memory deltas. Allowed states are `planned`,
`raw`, `candidate`, `cleaned`, `approved`, `rejected`, `reference`, and
`production`. The only forward promotion path is
`planned → raw → candidate → cleaned → approved → production`; rejection can
only return to `candidate`. A file may not be promoted to `approved` without
an existing PNG, a passing mechanical contract, a reviewer, and an approved
decision. Production builds never call PixelLab or read the staging tree.

## Commands

```sh
npm run art:pixellab:doctor
npm run art:pixellab:validate
npm run art:pixellab:certify
node scripts/pixellab-pilot.mjs normalize --input <png> --output <png> --width 192 --height 160
node scripts/pixellab-pilot.mjs preview-atlas --candidate <png> --frame parkland_cart_rental_t1 --output test-results/pixellab-preview-atlas
```

- `doctor` checks Node/npm, the pinned MCP bridge, the staging boundary, and
  whether a credential exists without displaying it.
- `validate` verifies the tracked manifest, hashes, filename conventions,
  dimensions, transparency/alpha bounds, transparent padding, grid contracts,
  anchors, duplicate content, prompt references, promotion paths, staged
  measurements, atlas/runtime boundaries, and secret hygiene.
- `certify` additionally rebuilds every atlas into a temporary directory,
  proves byte-for-byte determinism, requires approved PixelLab static and
  animated candidates, and requires a completed benchmark.
- `normalize` trims, premultiplies, resamples, and bottom-centers a reviewed
  candidate on an exact transparent canvas.
- `preview-atlas` swaps one named frame in an isolated source copy and writes
  an isolated atlas. It cannot overwrite production sprite sources or atlases.

CI should run `validate`; `certify` is the milestone completion gate.

## Generation procedure

1. Run `doctor --require-auth`.
2. Generate one target at a time from `art/pixellab/prompts.md`.
3. Save untouched provider output under `staging/raw/`.
4. Add provider/model/timestamp/reference information to the manifest.
5. Select and clean candidates without overwriting raw output.
6. Record every cleanup operation and the final SHA-256.
7. Set the state to `approved` only after visual review.
8. Run validation and isolated atlas/browser certification.
9. Copy to a production source directory only in the M35/M41 issue that owns
   the final asset, preserving provenance.

The pilot E2E test intercepts the atlas requests with the isolated preview and
captures both overview and close-up evidence from the real M22 renderer. This
is the required inspection path before any production promotion.

## Review contract

All pilot output inherits `ART_GUIDE.md`. Review at overview, normal, and
close zoom; all four rotations; parkland, links, and desert; standard and
color-vision-safe palettes; reduced motion; desktop/mobile layouts; and
production resolution scales.

Golfer review must cover idle, pathing, windup, exact contact, ball launch,
follow-through, and return to idle. A visually attractive sheet that violates
frame dimensions, feet alignment, direction rows, or contact timing fails.

## Benchmark and decision

`art/pixellab/benchmark.json` gives every provider the same weighted rubric and
records generation time, candidate count, cleanup time, rejection rate,
integration time, cost, and review notes. The final result updates
`ADOPTION_MATRIX.md` category by category and is handed to:

- ZK-329 — asset delivery and biome materials;
- ZK-378 — Player Pro, recurring cast, staff, and golfer art;
- ZK-379 — biome architecture and seasonal assets;
- ZK-383 — premium presentation and renderer certification;
- ZK-407 — licensing and provenance audit.
