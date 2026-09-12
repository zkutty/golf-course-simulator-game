/**
 * Frozen, versioned shot-environment authority. A bearing is the direction
 * the wind travels toward: 0° is north (up), 90° east (right), 180° south
 * (down), and 270° west (left). Course-map y increases downward.
 *
 * This Wave 0 carrier is intentionally boundary-only. No resolver consumes
 * its directional components until a separately versioned physics change.
 */
export type ShotEnvironmentV1 =
  | Readonly<{ version: 1; mode: "legacy_scalar"; speedMph: number }>
  | Readonly<{ version: 1; mode: "directional"; speedMph: number; bearingDegrees: number }>;

export interface ShotEnvironmentProjection {
  /** Positive opposes travel; negative is tailwind. */
  headwindMph: number;
  /** Positive pushes toward the shot's right on the down-positive map axis. */
  crosswindMph: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const boundedSpeed = (value: unknown) => clamp(finite(value) ? value : 0, 0, 70);
const validSpeed = (value: unknown): value is number => finite(value) && value >= 0 && value <= 70;
const normalizedBearing = (value: unknown): number | null =>
  finite(value) && value >= 0 && value < 360 ? value : null;

/** Old or malformed payloads deliberately retain scalar behavior and never invent a direction. */
export function normalizeShotEnvironmentV1(value: unknown, legacySpeedMph = 0): ShotEnvironmentV1 {
  const fallback = Object.freeze({ version: 1 as const, mode: "legacy_scalar" as const, speedMph: boundedSpeed(legacySpeedMph) });
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as { version?: unknown; mode?: unknown; speedMph?: unknown; bearingDegrees?: unknown };
  if (candidate.version !== 1) return fallback;
  if (candidate.mode === "legacy_scalar") {
    return validSpeed(candidate.speedMph)
      ? Object.freeze({ version: 1 as const, mode: "legacy_scalar" as const, speedMph: candidate.speedMph })
      : fallback;
  }
  const bearingDegrees = normalizedBearing(candidate.bearingDegrees);
  if (candidate.mode !== "directional" || bearingDegrees == null || !validSpeed(candidate.speedMph)) return fallback;
  return Object.freeze({ version: 1 as const, mode: "directional" as const, speedMph: candidate.speedMph, bearingDegrees });
}

/** The only adapter from deterministic daily weather to directional shot authority. */
export function shotEnvironmentFromWeather(weather: { windMph: number; windBearingDegrees?: number }): ShotEnvironmentV1 {
  return normalizeShotEnvironmentV1({
    version: 1,
    mode: "directional",
    speedMph: weather.windMph,
    bearingDegrees: weather.windBearingDegrees,
  }, weather.windMph);
}

/**
 * Projects frozen wind onto a shot vector without applying any gameplay
 * modifier. Degenerate shots and legacy scalar saves have zero components.
 */
export function projectShotEnvironment(
  environment: ShotEnvironmentV1,
  from: Readonly<{ x: number; y: number }>,
  to: Readonly<{ x: number; y: number }>,
): ShotEnvironmentProjection {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length === 0 || environment.mode === "legacy_scalar" || environment.speedMph === 0) {
    return { headwindMph: 0, crosswindMph: 0 };
  }
  const radians = environment.bearingDegrees * Math.PI / 180;
  const windX = Math.sin(radians) * environment.speedMph;
  const windY = -Math.cos(radians) * environment.speedMph;
  const shotX = dx / length;
  const shotY = dy / length;
  const tailwindMph = windX * shotX + windY * shotY;
  const crosswindMph = windX * -shotY + windY * shotX;
  const signedFinite = (value: number) => !Number.isFinite(value) || Math.abs(value) < 1e-12 ? 0 : value;
  return {
    headwindMph: signedFinite(-tailwindMph),
    crosswindMph: signedFinite(crosswindMph),
  };
}
