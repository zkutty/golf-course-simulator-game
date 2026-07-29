import path from "node:path";

export const CLOUD_POLICY_VERSION = 1;
export const CLOUD_QUOTA_BYTES = 100 * 1024 * 1024;
export const CLOUD_SYNC_BUCKETS = Object.freeze(["saves", "profile"]);
export const CLOUD_EXCLUDED_BUCKETS = Object.freeze(["settings", "content", "state", "screenshots", "logs", "cache"]);

function safePart(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.@-]{1,180}$/.test(value) || value.includes("..")) {
    throw new Error(`Invalid cloud ${label}.`);
  }
  return value;
}

export function cloudPolicy({ edition = "full", appId = null, rootOverride = null } = {}) {
  const normalizedEdition = edition === "demo" ? "demo" : "full";
  return {
    version: CLOUD_POLICY_VERSION,
    appId: appId == null ? null : safePart(String(appId), "app id"),
    root: rootOverride ? path.resolve(rootOverride) : null,
    namespace: "coursecraft",
    edition: normalizedEdition,
    quotaBytes: CLOUD_QUOTA_BYTES,
    syncBuckets: [...CLOUD_SYNC_BUCKETS],
    excludedBuckets: [...CLOUD_EXCLUDED_BUCKETS],
    sharing: {
      demoReads: "compatible-only",
      demoWrites: "demo-marked",
      fullReads: "demo-or-full",
      sharedNamespace: true,
    },
  };
}

export function cloudPathForKey(key, { namespace = "coursecraft" } = {}) {
  const safeKey = safePart(key, "key");
  const bucket = safeKey.startsWith("coursecraft_save_") || safeKey.startsWith("coursecraft_saves_")
    ? "saves"
    : safeKey.startsWith("coursecraft_profile")
      ? "profile"
      : null;
  if (!bucket) return null;
  return `${safePart(namespace, "namespace")}/${bucket}/${safeKey}.json`;
}

export function isCloudSyncableKey(key) {
  return cloudPathForKey(key) !== null;
}

export function cloudGenerationDecision(local, cloud) {
  if (!local && !cloud) return { kind: "empty", preserveBoth: false };
  if (!local) return { kind: "cloud-only", selected: "cloud", preserveBoth: false };
  if (!cloud) return { kind: "local-only", selected: "local", preserveBoth: false };
  if (local.checksum && cloud.checksum && local.checksum === cloud.checksum) {
    return { kind: "same", selected: "either", preserveBoth: false };
  }
  return {
    kind: "conflict",
    selected: null,
    preserveBoth: true,
    localGeneration: local.id,
    cloudGeneration: cloud.id,
  };
}

export function preservedConflictKeys(localGeneration, cloudGeneration) {
  return {
    local: `coursecraft_save_conflict_local_${safePart(localGeneration, "local generation")}`,
    cloud: `coursecraft_save_conflict_cloud_${safePart(cloudGeneration, "cloud generation")}`,
  };
}
