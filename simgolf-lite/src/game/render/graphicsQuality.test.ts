import { describe, expect, it } from "vitest";
import { qualityResolutionMultiplier, resolveGraphicsQuality } from "./graphicsQuality";

describe("graphics quality ladder", () => {
  it("honors an explicit preference", () => {
    expect(resolveGraphicsQuality("medium", {
      hardwareConcurrency: 16,
      deviceMemory: 16,
      devicePixelRatio: 1,
    })).toBe("medium");
  });

  it("protects low-memory devices in auto mode", () => {
    expect(resolveGraphicsQuality("auto", {
      hardwareConcurrency: 8,
      deviceMemory: 4,
      devicePixelRatio: 2,
    })).toBe("low");
  });

  it("scales renderer density without changing simulation data", () => {
    expect(qualityResolutionMultiplier("high")).toBe(1);
    expect(qualityResolutionMultiplier("medium")).toBeLessThan(1);
    expect(qualityResolutionMultiplier("low")).toBeLessThan(qualityResolutionMultiplier("medium"));
  });
});
