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
    concessionLift: 0.03, // a snack/new glove takes the edge off (M4)
    min: 0,
    max: 1,
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
