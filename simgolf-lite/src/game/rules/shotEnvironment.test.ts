import { describe, expect, it } from "vitest";
import { normalizeShotEnvironmentV1, projectShotEnvironment, shotEnvironmentFromWeather } from "./shotEnvironment";

describe("ZK-1152 frozen directional shot environment", () => {
  it("projects cardinal bearings on the down-positive course map", () => {
    const east = { x: 10, y: 0 };
    expect(projectShotEnvironment(shotEnvironmentFromWeather({ windMph: 12, windBearingDegrees: 90 }), { x: 0, y: 0 }, east)).toEqual({ headwindMph: -12, crosswindMph: 0 });
    expect(projectShotEnvironment(shotEnvironmentFromWeather({ windMph: 12, windBearingDegrees: 270 }), { x: 0, y: 0 }, east)).toEqual({ headwindMph: 12, crosswindMph: 0 });
    expect(projectShotEnvironment(shotEnvironmentFromWeather({ windMph: 12, windBearingDegrees: 180 }), { x: 0, y: 0 }, east)).toEqual({ headwindMph: 0, crosswindMph: 12 });
  });

  it("keeps zero, degenerate, malformed, and extreme payloads finite and legacy-safe", () => {
    const from = { x: 3, y: 4 };
    expect(projectShotEnvironment(shotEnvironmentFromWeather({ windMph: 0, windBearingDegrees: 0 }), from, { x: 8, y: 4 })).toEqual({ headwindMph: 0, crosswindMph: 0 });
    expect(projectShotEnvironment(shotEnvironmentFromWeather({ windMph: 25, windBearingDegrees: 45 }), from, from)).toEqual({ headwindMph: 0, crosswindMph: 0 });
    expect(normalizeShotEnvironmentV1({ version: 1, mode: "directional", speedMph: Infinity, bearingDegrees: 90 }, 17)).toEqual({ version: 1, mode: "legacy_scalar", speedMph: 17 });
    expect(normalizeShotEnvironmentV1({ version: 1, mode: "directional", speedMph: 20, bearingDegrees: 720 }, 17)).toEqual({ version: 1, mode: "legacy_scalar", speedMph: 17 });
    expect(normalizeShotEnvironmentV1({ version: 1, mode: "directional", speedMph: 999, bearingDegrees: 90 }, 17)).toEqual({ version: 1, mode: "legacy_scalar", speedMph: 17 });
    expect(normalizeShotEnvironmentV1({ version: 1, mode: "directional", speedMph: -1, bearingDegrees: 90 }, 17)).toEqual({ version: 1, mode: "legacy_scalar", speedMph: 17 });
    expect(normalizeShotEnvironmentV1({ version: 1, mode: "legacy_scalar", speedMph: 13 }, 17)).toEqual({ version: 1, mode: "legacy_scalar", speedMph: 13 });
  });

  it("negates both signed components for opposite bearings and bounds magnitude by speed", () => {
    const a = projectShotEnvironment(shotEnvironmentFromWeather({ windMph: 24, windBearingDegrees: 37 }), { x: 1, y: 2 }, { x: 9, y: 7 });
    const b = projectShotEnvironment(shotEnvironmentFromWeather({ windMph: 24, windBearingDegrees: 217 }), { x: 1, y: 2 }, { x: 9, y: 7 });
    expect(b.headwindMph).toBeCloseTo(-a.headwindMph);
    expect(b.crosswindMph).toBeCloseTo(-a.crosswindMph);
    expect(Math.abs(a.headwindMph)).toBeLessThanOrEqual(24);
    expect(Math.abs(a.crosswindMph)).toBeLessThanOrEqual(24);
  });
});
