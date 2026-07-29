import test from "node:test";
import assert from "node:assert/strict";
import { cloudGenerationDecision, cloudPathForKey, cloudPolicy, isCloudSyncableKey, preservedConflictKeys } from "./cloudPolicy.mjs";

test("cloud policy syncs only portable save/profile state and shares a namespace safely", () => {
  const policy = cloudPolicy({ edition: "demo", appId: 1234 });
  assert.deepEqual(policy.syncBuckets, ["saves", "profile"]);
  assert.equal(policy.sharing.sharedNamespace, true);
  assert.equal(policy.sharing.fullReads, "demo-or-full");
  assert.equal(cloudPathForKey("coursecraft_save_slot"), "coursecraft/saves/coursecraft_save_slot.json");
  assert.equal(cloudPathForKey("coursecraft_settings_v1"), null);
  assert.equal(isCloudSyncableKey("coursecraft_profile"), true);
  assert.equal(isCloudSyncableKey("coursecraft_content_a"), false);
});

test("divergent generations require explicit preserve-both recovery", () => {
  const local = { id: "local-7", checksum: "aaa" };
  const cloud = { id: "cloud-9", checksum: "bbb" };
  assert.deepEqual(cloudGenerationDecision(local, cloud), {
    kind: "conflict",
    selected: null,
    preserveBoth: true,
    localGeneration: "local-7",
    cloudGeneration: "cloud-9",
  });
  assert.deepEqual(preservedConflictKeys("local-7", "cloud-9"), {
    local: "coursecraft_save_conflict_local_local-7",
    cloud: "coursecraft_save_conflict_cloud_cloud-9",
  });
});
