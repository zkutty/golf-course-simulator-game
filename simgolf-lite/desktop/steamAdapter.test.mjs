import test from "node:test";
import assert from "node:assert/strict";
import { createSteamAdapter } from "./steamAdapter.mjs";

test("direct desktop builds expose safe unavailable Steam fallbacks", async () => {
  const adapter = createSteamAdapter({ env: {}, logger: () => { throw new Error("logger must not escape"); } });
  assert.deepEqual(adapter.capabilities, { steam: false, workshop: false, cloud: false, overlay: false });
  assert.deepEqual(await adapter.achievements(["first-hole", "first-hole", "bad id"]), []);
  assert.equal(await adapter.cloudStatus(), "unavailable");
  assert.deepEqual(await adapter.cloudGenerations(), []);
  assert.equal(await adapter.overlay("https://example.com"), false);
  await assert.rejects(() => adapter.workshopPublish({}), /unavailable/);
});

test("Steam provider calls are allowlisted, idempotent, and failure-tolerant", async () => {
  const calls = [];
  const adapter = createSteamAdapter({
    distribution: true,
    api: {
      achievement: { activate: async (id) => { calls.push(["achievement", id]); } },
      cloud: {
        status: async () => "ready",
        generations: async () => [{ id: "local", checksum: "a" }],
        preserveBoth: async (...args) => { calls.push(["preserve", ...args]); return true; },
      },
      overlay: { activateToWebPage: async (url) => { calls.push(["overlay", url]); } },
      friends: { setRichPresence: async (...args) => { calls.push(["presence", ...args]); } },
    },
    logger: () => {},
  });
  assert.deepEqual(await adapter.achievements(["first-hole", "first-hole"]), ["first-hole"]);
  assert.deepEqual(await adapter.achievements(["first-hole"]), []);
  assert.equal(await adapter.cloudStatus(), "ready");
  assert.deepEqual(await adapter.cloudGenerations(), [{ id: "local", checksum: "a" }]);
  assert.equal(await adapter.cloudPreserveBoth("local", "cloud"), true);
  await adapter.presence("playing");
  assert.equal(await adapter.overlay("https://steamcommunity.com/sharedfiles/filedetails?id=1"), true);
  assert.equal(await adapter.overlay("https://evil.example/steal"), false);
  assert.deepEqual(calls, [
    ["achievement", "first-hole"],
    ["preserve", "local", "cloud"],
    ["presence", "status", "playing"],
    ["overlay", "https://steamcommunity.com/sharedfiles/filedetails?id=1"],
  ]);
});
