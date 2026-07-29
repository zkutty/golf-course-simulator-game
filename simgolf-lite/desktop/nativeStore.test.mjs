import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NativeStore } from "./nativeStore.mjs";

test("atomic native store preserves the previous valid revision on interruption", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "coursecraft-native-"));
  const store = new NativeStore(root);
  await store.writeTextAtomic("coursecraft_save_slot", '{"generation":1}');
  const failing = new NativeStore(root, { fault: "after-temp" });
  await assert.rejects(() => failing.writeTextAtomic("coursecraft_save_slot", '{"generation":2}'));
  assert.equal(await store.readText("coursecraft_save_slot"), '{"generation":1}');
});

test("corrupt active files recover the newest valid backup without overwriting it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "coursecraft-native-"));
  const store = new NativeStore(root);
  await store.writeTextAtomic("coursecraft_save_slot", '{"generation":1}');
  await store.writeTextAtomic("coursecraft_save_slot", '{"generation":2}');
  const target = store.filePath("coursecraft_save_slot");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(target, "{broken", "utf8");
  assert.equal(await store.readText("coursecraft_save_slot"), '{"generation":1}');
  assert.deepEqual(await store.recoveryStatus("coursecraft_save_slot"), {
    key: "coursecraft_save_slot",
    selected: "coursecraft_save_slot.json.bak1",
    recovered: true,
    invalid: ["coursecraft_save_slot.json"],
  });
});

test("explicit deletion removes backups so deleted data is not resurrected", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "coursecraft-native-"));
  const store = new NativeStore(root);
  await store.writeTextAtomic("coursecraft_save_slot", '{"generation":1}');
  await store.writeTextAtomic("coursecraft_save_slot", '{"generation":2}');
  await store.delete("coursecraft_save_slot");
  assert.equal(await store.readText("coursecraft_save_slot"), null);
});

test("backup recovery, key validation, and support privacy are deterministic", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "coursecraft-native-"));
  const store = new NativeStore(root);
  await store.writeTextAtomic("coursecraft_save_slot", '{"generation":1}');
  await store.writeTextAtomic("coursecraft_save_slot", '{"generation":2}');
  const target = store.filePath("coursecraft_save_slot");
  const { unlink } = await import("node:fs/promises");
  await unlink(target);
  assert.equal(await store.readText("coursecraft_save_slot"), '{"generation":1}');
  assert.throws(() => store.filePath("../escape"));
  const support = JSON.parse(await store.supportBundle("1.0.0", true));
  assert.equal(support.safeMode, true);
  assert.equal(JSON.stringify(support).includes("process.env"), false);
  assert.equal((await readFile(`${target}.bak1`, "utf8")), '{"generation":1}');
});
