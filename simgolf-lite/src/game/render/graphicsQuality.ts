export type GraphicsQualityPreference = "auto" | "high" | "medium" | "low";
export type ResolvedGraphicsQuality = Exclude<GraphicsQualityPreference, "auto">;

export interface GraphicsCapability {
  hardwareConcurrency: number;
  deviceMemory?: number;
  devicePixelRatio: number;
}

/** Stable capability seed used before sustained frame telemetry is available. */
export function resolveGraphicsQuality(
  preference: GraphicsQualityPreference,
  capability: GraphicsCapability,
): ResolvedGraphicsQuality {
  if (preference !== "auto") return preference;
  if (
    capability.hardwareConcurrency <= 4 ||
    (capability.deviceMemory != null && capability.deviceMemory <= 4)
  ) return "low";
  if (
    capability.hardwareConcurrency >= 8 &&
    (capability.deviceMemory == null || capability.deviceMemory >= 8) &&
    capability.devicePixelRatio <= 2
  ) return "high";
  return "medium";
}

export function qualityResolutionMultiplier(quality: ResolvedGraphicsQuality): number {
  return quality === "high" ? 1 : quality === "medium" ? 0.85 : 0.65;
}

export interface AdaptiveGraphicsQualityConfig {
  /** Frames summarized into one decision window. */
  evaluationFrames: number;
  /** Consecutive slow windows required before lowering fidelity. */
  downgradeWindows: number;
  /** Consecutive fast windows required before increasing fidelity. */
  upgradeWindows: number;
  /** Frames held after a tier change before another decision is allowed. */
  cooldownFrames: number;
}

export const DEFAULT_ADAPTIVE_GRAPHICS_CONFIG: AdaptiveGraphicsQualityConfig = {
  evaluationFrames: 120,
  downgradeWindows: 2,
  upgradeWindows: 5,
  cooldownFrames: 360,
};

export interface AdaptiveGraphicsDecision {
  quality: ResolvedGraphicsQuality;
  changed: boolean;
  p95Ms?: number;
  direction?: "upgrade" | "downgrade";
}

const QUALITY_ORDER: readonly ResolvedGraphicsQuality[] = ["low", "medium", "high"];

function percentile95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
}

/**
 * Sustained frame-time controller for Auto quality.
 *
 * It evaluates p95 over fixed windows, requires consecutive evidence, and
 * applies a post-change cooldown. A short hitch therefore cannot oscillate
 * subdivision, cover, shadow, animation, or renderer-resolution tiers.
 */
export class AdaptiveGraphicsQualityController {
  private quality: ResolvedGraphicsQuality;
  private readonly config: AdaptiveGraphicsQualityConfig;
  private samples: number[] = [];
  private slowWindows = 0;
  private fastWindows = 0;
  private cooldownRemaining = 0;

  constructor(
    initialQuality: ResolvedGraphicsQuality,
    config: Partial<AdaptiveGraphicsQualityConfig> = {},
  ) {
    this.quality = initialQuality;
    this.config = {
      evaluationFrames: Math.max(30, Math.round(
        config.evaluationFrames ?? DEFAULT_ADAPTIVE_GRAPHICS_CONFIG.evaluationFrames,
      )),
      downgradeWindows: Math.max(1, Math.round(
        config.downgradeWindows ?? DEFAULT_ADAPTIVE_GRAPHICS_CONFIG.downgradeWindows,
      )),
      upgradeWindows: Math.max(1, Math.round(
        config.upgradeWindows ?? DEFAULT_ADAPTIVE_GRAPHICS_CONFIG.upgradeWindows,
      )),
      cooldownFrames: Math.max(0, Math.round(
        config.cooldownFrames ?? DEFAULT_ADAPTIVE_GRAPHICS_CONFIG.cooldownFrames,
      )),
    };
  }

  current(): ResolvedGraphicsQuality {
    return this.quality;
  }

  reset(quality: ResolvedGraphicsQuality): void {
    this.quality = quality;
    this.samples = [];
    this.slowWindows = 0;
    this.fastWindows = 0;
    this.cooldownRemaining = 0;
  }

  pushFrame(frameMs: number): AdaptiveGraphicsDecision {
    if (!Number.isFinite(frameMs) || frameMs <= 0) {
      return { quality: this.quality, changed: false };
    }
    if (this.cooldownRemaining > 0) this.cooldownRemaining--;
    // Cap background-tab stalls. They are not representative of renderer
    // load and otherwise dominate p95 for several evaluation windows.
    this.samples.push(Math.min(frameMs, 100));
    if (this.samples.length < this.config.evaluationFrames) {
      return { quality: this.quality, changed: false };
    }

    const p95Ms = percentile95(this.samples);
    this.samples = [];
    const downgradeThreshold = this.quality === "high" ? 20 : this.quality === "medium" ? 30 : Infinity;
    const upgradeThreshold = this.quality === "low" ? 22 : this.quality === "medium" ? 16 : -Infinity;
    if (p95Ms > downgradeThreshold) {
      this.slowWindows++;
      this.fastWindows = 0;
    } else if (p95Ms < upgradeThreshold) {
      this.fastWindows++;
      this.slowWindows = 0;
    } else {
      this.slowWindows = 0;
      this.fastWindows = 0;
    }

    if (
      this.cooldownRemaining === 0 &&
      this.slowWindows >= this.config.downgradeWindows
    ) {
      const index = QUALITY_ORDER.indexOf(this.quality);
      this.quality = QUALITY_ORDER[Math.max(0, index - 1)];
      this.slowWindows = 0;
      this.fastWindows = 0;
      this.cooldownRemaining = this.config.cooldownFrames;
      return { quality: this.quality, changed: true, p95Ms, direction: "downgrade" };
    }
    if (
      this.cooldownRemaining === 0 &&
      this.fastWindows >= this.config.upgradeWindows
    ) {
      const index = QUALITY_ORDER.indexOf(this.quality);
      this.quality = QUALITY_ORDER[Math.min(QUALITY_ORDER.length - 1, index + 1)];
      this.slowWindows = 0;
      this.fastWindows = 0;
      this.cooldownRemaining = this.config.cooldownFrames;
      return { quality: this.quality, changed: true, p95Ms, direction: "upgrade" };
    }
    return { quality: this.quality, changed: false, p95Ms };
  }
}
