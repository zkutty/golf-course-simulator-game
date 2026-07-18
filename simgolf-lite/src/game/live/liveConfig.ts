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
    lastArrivalMinute: 600, // no new golfers after this
    firstArrivalMinute: 20,
    // Minimum game-minutes between successive tee-offs, so arriving golfers
    // queue at the first tee instead of all starting at once (ZKU-110).
    teeGapMinutes: 7,
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

  // Golfers actually simulated & drawn per day. Derived from the blended demand
  // index, then clamped into a watchable range (you see every golfer on-course).
  volume: {
    minGolfers: 3,
    maxGolfers: 42,
    // Demand index treated as a "full house" — days at or above this fill the
    // course to maxGolfers. The blended index tops out around 1.2.
    demandFullHouse: 1.0,
  },

  mood: {
    start: 0.7, // neutral-happy on arrival
    perStrokeOverPar: -0.06, // each stroke over par nudges mood down
    perStrokeUnderPar: 0.05,
    conditionWeight: 0.25, // course condition contribution
    min: 0,
    max: 1,
  },

  // Staff as people (ZKU-121/122/123): on-course staff entity behavior.
  staff: {
    walkPerTile: 0.12, // staff stride a touch quicker than golfers
    // Shift windows in day game-minutes (day runs 0..closeMinute).
    shifts: {
      full: { start: 0, end: 840 },
      morning: { start: 0, end: 420 },
      afternoon: { start: 420, end: 840 },
    },
    // Groundskeeper maintenance task (ZKU-122): mow legs zigzag over the
    // target patch, then a raking pause before moving on.
    mow: {
      legMinutes: 2.5,
      legs: 6,
      finishPause: 3,
    },
    // Live condition lift while groundskeeper work accumulates during the
    // day; the durable recovery is credited at day commit (balance config).
    liveConditionPerTask: 0.005,
    liveConditionCap: 0.05,
    // Idle stationing pause for desk roles between shuttle walks.
    stationPause: 8,
    shuttleRadius: 4,
    // Pace of play (ZKU-123): a hole with this many groups stacked on it is
    // congested; golfers stuck there bleed mood unless a marshal attends.
    congestion: {
      golfersPerHole: 4,
      moodDrainPerMin: 0.0012,
      thoughtAfterMin: 10,
      marshalPaceBoost: 1.35, // walk-speed multiplier on marshaled holes
      marshalWatchPause: 6,
    },
    // Cart attendants shave walking time course-wide; pro shop staff send
    // finishers off happier (visible in reactions, ZKU-121 scope).
    cartPacePerAttendant: 0.06,
    cartPaceCap: 0.15,
    proShopFinishMoodBonus: 0.03,
    proShopFinishMoodCap: 0.06,
  },

  // Thresholds that turn a finished golfer's mood into a discrete reaction,
  // aggregated into reputation (ZKU-116).
  reactions: {
    promoterMood: 0.8, // at/above this they'd recommend the course
    detractorMood: 0.45, // at/below this they leave disappointed
    returnMood: 0.55, // at/above this (after a patience nudge) they'd return
    returnPatienceNudge: 0.1, // patient golfers forgive a so-so round
  },
} as const;
