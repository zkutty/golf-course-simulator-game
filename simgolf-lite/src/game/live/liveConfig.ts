// Tuning constants for the real-time "living course" simulation layer.
// All durations are in GAME-MINUTES; the clock converts real seconds into
// game-minutes based on the selected speed.

export type SpeedName = "paused" | "1x" | "2x" | "3x";

export const LIVE = {
  // How many game-minutes elapse per real second at each speed.
  speed: {
    paused: 0,
    "1x": 3,
    "2x": 9,
    "3x": 24,
  } as Record<SpeedName, number>,

  day: {
    openMinute: 0, // 0 == 6:00 AM (display offset applied in UI)
    displayStartHour: 6, // 6 AM
    closeMinute: 840, // 14 hours of daylight -> 8:00 PM
    lastArrivalMinute: 660, // no new golfers after 5 PM (late 9 still finishes near close)
    firstArrivalMinute: 20,
    // Arrivals skew toward the morning (rng^bias): 1 = uniform, >1 = earlier.
    arrivalMorningBias: 1.35,
  },

  // Entry/exit is a point on the left edge of the course where golfers walk in.
  entry: { xFrac: 0.02, yFrac: 0.5 },

  // Segment pacing (game-minutes).
  pace: {
    swingPause: 0.4,
    flightPerTile: 0.05,
    flightMin: 0.3,
    flightMax: 1.0,
    walkPerTile: 0.15,
    interHoleWalkCap: 6,
    puttPause: 0.3,
    puttFlight: 0.2,
    puttWalk: 0.2,
  },

  scoring: {
    basePutts: 2,
    puttVarianceScratch: 0.15, // chance of a 1-putt / 3-putt swing
    puttVarianceBogey: 0.35,
  },

  // Golfers actually simulated & drawn per day. Driven by the demand index so
  // reputation/quality/price visibly change how busy the course looks, then
  // clamped into a watchable range (you see every golfer on the course).
  volume: {
    minGolfers: 3,
    maxGolfers: 42,
    // demandIndex (0..1.2) is normalized into [demandFloor, demandCeil] and
    // shaped by demandGamma before scaling min..max golfers. The floor sits
    // near the model's practical minimum so a bad course actually feels dead.
    demandFloor: 0.45,
    demandCeil: 1.1,
    demandGamma: 1.5,
    // A tiny course can't host a crowd: cap daily golfers per valid hole.
    perValidHole: 4,
  },

  mood: {
    start: 0.7, // neutral-happy on arrival
    perStrokeOverPar: -0.06, // each stroke over par nudges mood down
    perStrokeUnderPar: 0.05,
    conditionWeight: 0.25, // course condition contribution
    min: 0,
    max: 1,
  },
} as const;
