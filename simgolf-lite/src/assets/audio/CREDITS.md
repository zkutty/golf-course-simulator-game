# CourseCraft audio credits

## M15 original soundtrack

The following instrumental loops were generated specifically for CourseCraft by
`scripts/gen-audio.mjs`. The generator, compositions, and rendered audio are
original project assets and are released under CC0-1.0 for redistribution with
the game:

- Clubhouse Morning
- Porch Swing
- Drafting Table
- Breezy Nine
- Fairway Stroll
- Golden Green
- Last Light

Each track ships as Ogg Vorbis and AAC/M4A. The playlist loads only after the
first audio-unlocking user gesture; no soundtrack file is part of initial page
loading.

## Sound effects and ambience

Golf, interface, crowd, and ambient sounds are synthesized at runtime by
`src/audio/AudioManager.ts`. They contain no third-party samples. The generated
sound designs are released under CC0-1.0 with the game.

## Legacy files

The older MP3 files directly under `public/audio/` predate M15 and are no longer
referenced by the application. They are intentionally excluded from the M15
soundtrack and should be removed once their historical provenance is confirmed.

## Mixer path audit

- Music uses two lazy `HTMLAudioElement` slots for overlap crossfades. Their
  volume is always computed from master × music × visibility/pause/sting duck.
- Runtime golf, interface, crowd, and sting voices connect only to the WebAudio
  SFX gain bus, capped at eight voices.
- Wind, water, birds, crickets, and crowd beds connect only to the WebAudio
  ambience gain bus. Pausing retains a quiet 12% idle bed rather than fully
  stopping the course atmosphere.
- The SFX and ambience buses connect directly to the destination; there are no
  source nodes connected around them. The compatibility sound facade delegates
  back to the same SFX bus.
- Master mute sets both music slots and both WebAudio buses to zero immediately.
  Other gain changes use short ramps to avoid clicks and pops.
