# M39 Seasons, Club Identity & Annual Legacy certification

## Scope

M39 adds a four-season, 32-week club year on top of the authoritative seven-day
live clock. Every date is represented by a timezone-independent absolute day.
Weather, tournaments, reservations, outings, year boundaries, and story-facing
history use that shared calendar.

Daily weather is generated from the run seed, biome, season, and absolute day.
Published seven-day forecasts are therefore stable across reloads. Wind, rain,
heat, drought, frost, and storms feed one documented modifier contract consumed
by ordinary live golfers, Player Pro shot snapshots, demand, pace, turf,
hospitality, and weekly reporting. Storm generation is bounded and includes a
two-day severe-weather cooldown.

The four club charters are Public Gem, Championship Venue, Destination Retreat,
and Member Institution. Each exposes its promise, tradeoff, event pool, mastery
goals, and bounded economic/audience modifiers. An annual review ledger makes a
change atomic, costly after the initial selection, and non-repeatable within a
club year.

Enterprise policy presets automate hours, upkeep, pricing, maintenance, and
forecast reserves from stable captured baselines. Advanced Operations and
per-system manual overrides preserve all existing M30–M33 controls and are the
migration default for pre-M39 saves.

Forecast responses include turf and water priorities, tiered drainage projects,
course/hole closures, and tournament rescheduling. The pure command reducer
previews cost, construction time, capacity, risk reduction, and blockers before
settlement. Course closures re-date scheduled tournaments, outings, and
unredeemed package golf exactly once and refuse to invalidate an active Player
Pro round.

At the final authoritative day of each year, one immutable yearbook captures
the charter, finances, condition, Pro and regular rounds, tournament champions,
people, facilities, incidents, stories, awards, and a seeded club ranking.
Rewards settle once; dismissal only clears the presentation flag. Yearbooks,
timeline facts, response history, and Hall of Fame entries are bounded.

## Automated evidence

- Calendar boundary, migration, timezone-independent, scheduling, and rollover
  tests.
- Ten seeded years across all three biomes and all four charters, repeated for
  deterministic equality.
- Forecast stability, biome distribution, severe-weather cooldown, playable-day
  ratio, and save-size budgets.
- Shared Player Pro weather snapshot, live demand, weekly reporting, automation
  stability, manual override, closure cascade, charter settlement, and annual
  reward idempotence tests.
- Focused browser acceptance covers the seven-day forecast, charter and
  automation disclosure, a paid drainage response, annual ranking and awards,
  yearbook acknowledgement, text-state parity, and console cleanliness.

## Balance ranges

- Severe storms are limited to isolated days; normal play remains available on
  more than 90% of sampled days in every biome.
- Weather demand multipliers are bounded from 0.20 to 1.00, while charter demand
  multipliers remain between 0.92 and 1.08.
- Shot carry never falls below 76% after combined wind/storm effects, and
  dispersion remains bounded below 1.75×.
- Each drainage tier removes 11% of rain-related wear/cancellation exposure.
- Annual ranking rewards are $1,000–$5,000 and settle once.
- Seasonal state remains below the 180 KB ten-year test budget.

## External content needs

Final seasonal terrain art and the licensed weather/annual-legacy audio library
remain owned by M41 and the soundtrack milestone. M39 uses the existing biome
renderer and audio boundary without introducing unapproved media.
