export type GraphicsQualityPreference = "auto" | "high" | "medium" | "low";
export type ResolvedGraphicsQuality = Exclude<GraphicsQualityPreference, "auto">;

export interface GraphicsCapability {
  hardwareConcurrency: number;
  deviceMemory?: number;
  devicePixelRatio: number;
}

/** A stable startup decision; avoids frame-rate-driven React/render churn. */
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
