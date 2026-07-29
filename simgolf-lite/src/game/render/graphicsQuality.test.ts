import { describe, expect, it } from "vitest";
import {
  AdaptiveGraphicsQualityController,
  qualityResolutionMultiplier,
  resolveGraphicsQuality,
} from "./graphicsQuality";

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

  it("ignores a short frame-time spike", () => {
    const controller = new AdaptiveGraphicsQualityController("high", {
      evaluationFrames: 30,
      downgradeWindows: 2,
      upgradeWindows: 2,
      cooldownFrames: 30,
    });
    for (let frame = 0; frame < 29; frame++) controller.pushFrame(12);
    controller.pushFrame(95);
    expect(controller.current()).toBe("high");
    for (let frame = 0; frame < 30; frame++) controller.pushFrame(12);
    expect(controller.current()).toBe("high");
  });

  it("downgrades only after sustained slow p95 windows", () => {
    const controller = new AdaptiveGraphicsQualityController("high", {
      evaluationFrames: 30,
      downgradeWindows: 2,
      upgradeWindows: 2,
      cooldownFrames: 30,
    });
    for (let frame = 0; frame < 30; frame++) controller.pushFrame(26);
    expect(controller.current()).toBe("high");
    let decision;
    for (let frame = 0; frame < 30; frame++) decision = controller.pushFrame(26);
    expect(controller.current()).toBe("medium");
    expect(decision).toMatchObject({ changed: true, direction: "downgrade", quality: "medium" });
  });

  it("uses a longer fast-path and cooldown before restoring fidelity", () => {
    const controller = new AdaptiveGraphicsQualityController("medium", {
      evaluationFrames: 30,
      downgradeWindows: 1,
      upgradeWindows: 2,
      cooldownFrames: 60,
    });
    for (let frame = 0; frame < 60; frame++) controller.pushFrame(12);
    expect(controller.current()).toBe("high");
    for (let frame = 0; frame < 30; frame++) controller.pushFrame(40);
    expect(controller.current()).toBe("high");
    for (let frame = 0; frame < 30; frame++) controller.pushFrame(40);
    expect(controller.current()).toBe("medium");
  });

  it("rejects invalid samples without changing the tier", () => {
    const controller = new AdaptiveGraphicsQualityController("medium", {
      evaluationFrames: 30,
      downgradeWindows: 1,
    });
    controller.pushFrame(Number.NaN);
    controller.pushFrame(0);
    expect(controller.current()).toBe("medium");
  });
});
