# M17 retention and offline architecture

## Save growth

Course history is stored as compact numeric tuples:

`[week, cash, courseRating, reputation, weeklyProfit, attendance]`

The fixed numeric payload is 48 bytes per week before serialization. A representative 100-week JSON sample measured 2,992 bytes (about 30 bytes/week because typical values serialize compactly). The UI downsamples histories over 180 points while the save retains the full series. Hall-of-fame entries are capped at 100; the event feed is session-only and capped at 50. Ace rows are rare, append-only facts.

## Shared events

Round completion and week close update records incrementally and publish to one retention event bus. Achievements and the news UI consume the resulting facts; record screens never scan the full history at runtime.

## Offline/update policy

The build injects the generated JS/CSS and core visual assets into the service worker precache. Audio remains runtime cache-first so installation stays lean. A waiting worker only activates after the player chooses **Save & Reload**, preventing a mid-session code swap. Navigation is network-first, so a hard refresh receives the current deployment when online and falls back to the cached shell offline.
