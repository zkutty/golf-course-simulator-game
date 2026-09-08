# ZK-1107 — opening composition review

Base: `4ddc7af0a6014ab73cedb6e6dea42c7b026049af` (exact `origin/develop`).
This is a presentation review candidate, **not human visual approval** or authorization to promote.

## Annotated before / target evidence

The `before/` and `target/` directories use matching stage and viewport filenames.
The existing ZK-1106 real-authoring certification produces these images from actual
course painting, tee/green placement, private-shot playback, a paid fairway edit,
retest and comparison. Each stage is resized to 1440×900, 1280×720 and 390×844;
these are responsive composition captures, not three independent mobile playthroughs.

| Annotation | Before | Target / acceptance |
| --- | --- | --- |
| A — guide width | 124px portrait competes with instructions on 390px screen; narrow text column and long card | Smaller responsive portrait; guide content stays within card width, readable body and retained actions |
| B — active shot | Current golfer/shot, immutable context and playback controls have similar weight | Current shot gets a neutral raised readout and stronger type; context stays present at lower emphasis, with wrapping for long IDs |
| C — comparison | Narrow table competes with portrait; columns wrap unevenly | Mobile portrait footprint reduced; table retains real header/row semantics and distinct row separators |
| D — control states | Shared buttons use separate translucent disabled colours and mouse-only transforms | Reuse existing brand action/disabled/danger tokens; keyboard and pointer share CSS pressed treatment; no biome-driven control palette |
| E — course authority | Existing COZY/Architect and opening focus camera, terrain atlas and markers | Same renderer/camera/atlas; no nearest-filter changes, invented artwork, simulation changes or hidden authoring controls |
| F — mobile live toolbar | Absolute `left:50%` plus automatic width creates a narrow 269px-tall column over the course | Explicit width uses the course pane; wrapping retains time, speed, pause, overview and every metric |

### Review links (A–F refer to the annotations above)

| Stage / viewport | Before | Target |
| --- | --- | --- |
| Welcome 1440×900 | [A/E](before/01-new-private-course-1440x900.png) | [A/E](target/01-new-private-course-1440x900.png) |
| Welcome 1280×720 | [A/E](before/01-new-private-course-1280x720.png) | [A/E](target/01-new-private-course-1280x720.png) |
| Welcome 390×844 | [A/F](before/01-new-private-course-390x844.png) | [A/F](target/01-new-private-course-390x844.png) |
| Invite 1440×900 | [E](before/02-built-and-ready-to-invite-1440x900.png) | [E](target/02-built-and-ready-to-invite-1440x900.png) |
| Invite 1280×720 | [E](before/02-built-and-ready-to-invite-1280x720.png) | [E](target/02-built-and-ready-to-invite-1280x720.png) |
| Invite 390×844 | [A/F](before/02-built-and-ready-to-invite-390x844.png) | [A/F](target/02-built-and-ready-to-invite-390x844.png) |
| Shot 1440×900 | [B/E](before/03-recorded-shot-on-course-1440x900.png) | [B/E](target/03-recorded-shot-on-course-1440x900.png) |
| Shot 1280×720 | [B/E](before/03-recorded-shot-on-course-1280x720.png) | [B/E](target/03-recorded-shot-on-course-1280x720.png) |
| Shot 390×844 | [A/B/F](before/03-recorded-shot-on-course-390x844.png) | [A/B/F](target/03-recorded-shot-on-course-390x844.png) |

Later target stages are available at the same three dimensions:
`03b-intermediate-baseline-shot`, `04-evidence-backed-opportunity`,
`05-real-fairway-edit`, `05b-intermediate-retest-shot`, and
`06-honest-comparison-with-penalties`. The final comparison uses the existing
automatic graphics-quality system; terrain/prop fidelity visibly changes during
the long headless run. This is not a new atlas or a claimed art-quality lock.
Use a fixed graphics tier for a subsequent human art-fidelity approval session.

The baseline run stopped at the inherited 15-second camera-settle guard after
reload, so it has three stages (nine screenshots), not a complete seven-beat
baseline certification. The target run is reported independently below.
Mobile evidence is deliberately scrollable; dense shot receipts and comparison
remain available, but not every line is simultaneously visible on a phone.
The 390px stage captures retain the prior desktop camera while resizing: hole
endpoints may be cropped. They certify responsive chrome/readout composition,
not fresh mobile focus framing or a complete touch-only playthrough. Review that
boundary explicitly; this packet does not claim to repair the existing camera.

## Token and state table

| Surface / state | Existing token or rule | Contract |
| --- | --- | --- |
| Primary / selected | `--ui-action-selected`, `--ui-action-selected-text` | Brand forest / white; biome never changes action meaning |
| Secondary / default | `--ui-action-surface`, `--ui-action-text` | Paper / dark ink |
| Hover | `--ui-action-hover`, `--ui-state-border` | Visible neutral feedback without layout movement |
| Keyboard focus | `--ui-focus` (`#0b67a3`) | Existing 3px focus indicator retained |
| Disabled | `--ui-disabled-surface`, `--ui-disabled-text` | Opaque readable disabled state; native disabled semantics |
| Danger | `--ui-danger-surface`, `--ui-danger-text`, `--ui-danger-border` | Reserved for destructive action, not biography/biome |
| Current shot | `--ui-surface-raised`, `--ui-text`, `--ui-state-border` | Emphasis does not imply a better score or change recorded truth |
| Context frame | Existing `--biome-*` contextual tokens | ZK-623 allowlist unchanged; no second global palette |
| Reduced motion | `prefers-reduced-motion: reduce` | Shared button transitions disabled; no new animation |

## Human signoff required

Review originality/cohesion, pixel-art scale, portrait/terrain relationship,
shot-marker readability and overall hierarchy in all three viewport columns.
The machine gate cannot approve aesthetic polish. Physical touch/GPU devices
and production release remain outside this packet.
