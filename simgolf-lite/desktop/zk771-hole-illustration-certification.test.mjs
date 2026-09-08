import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NativeStore } from "./nativeStore.mjs";
import { createDesktopFileDeliveryHandlers } from "./fileDelivery.mjs";

const deliveryReceipt = Object.freeze({
  version: 1,
  delivery: "hole-illustration",
  name: "north-hole-1-member-a.svg",
  mimeType: "image/svg+xml",
  width: 3840,
  height: 2560,
});

test("ZK-771 desktop filesystem delivery is bucketed, JSON-only, and atomic on interruption", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "coursecraft-zk771-"));
  const store = new NativeStore(root);
  const key = "coursecraft_export_receipt";
  const first = JSON.stringify(deliveryReceipt);
  await store.writeTextAtomic(key, first);
  assert.equal(await store.readText(key), first);
  assert.match(store.filePath(key), /\/state\/coursecraft_export_receipt\.json$/);
  assert.throws(() => store.filePath("../outside"), /Invalid storage key/);
  await assert.rejects(() => store.writeTextAtomic(key, "not-json"), /valid JSON/);

  const interrupted = new NativeStore(root, { fault: "after-temp" });
  const next = JSON.stringify({ ...deliveryReceipt, name: "north-hole-1-member-a.png", mimeType: "image/png" });
  await assert.rejects(() => interrupted.writeTextAtomic(key, next), /interrupted write/);
  assert.equal(await store.readText(key), first);
  const names = await readdir(path.dirname(store.filePath(key)));
  assert.equal(names.some((name) => name.includes(".tmp-")), false);
});

test("ZK-771 desktop bridge handlers atomically write typed SVG and PNG payloads, and fail without partial files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "coursecraft-zk771-delivery-"));
  const svgPath = path.join(root, "hole.svg");
  const pictureRoot = path.join(root, "pictures");
  const dialog = {
    showSaveDialog: async (_window, options) => {
      assert.deepEqual(options, { defaultPath: "hole.svg", filters: [{ name: "SVG images", extensions: ["svg"] }] });
      return { canceled: false, filePath: svgPath };
    },
  };
  const handlers = createDesktopFileDeliveryHandlers({ dialog, app: { getPath: () => pictureRoot }, mainWindow: () => ({ id: 1 }) });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="3840" height="2560"></svg>';
  assert.equal(await handlers.export({ name: "../hole.svg", text: svg, mimeType: "image/svg+xml" }), true);
  assert.equal(await readFile(svgPath, "utf8"), svg);
  assert.equal((await stat(svgPath)).mode & 0o777, 0o600);

  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const savedPng = await handlers.screenshot({ dataUrl: `data:image/png;base64,${png.toString("base64")}`, suggestedName: "../hole illustration" });
  assert.equal(savedPng, path.join(pictureRoot, "hole-illustration.png"));
  assert.deepEqual(await readFile(savedPng), png);
  assert.equal((await stat(savedPng)).mode & 0o777, 0o600);

  await writeFile(savedPng, "previous PNG", { mode: 0o600 });
  const interruptedScreenshot = createDesktopFileDeliveryHandlers({
    dialog,
    app: { getPath: () => pictureRoot },
    mainWindow: () => ({ id: 1 }),
    fsOps: {
      mkdir,
      writeFile,
      rename: async () => { throw new Error("interrupted screenshot delivery"); },
      unlink,
    },
  });
  await assert.rejects(
    () => interruptedScreenshot.screenshot({ dataUrl: `data:image/png;base64,${png.toString("base64")}`, suggestedName: "hole illustration" }),
    /interrupted screenshot delivery/,
  );
  assert.equal(await readFile(savedPng, "utf8"), "previous PNG");
  assert.equal((await readdir(pictureRoot)).some((name) => name.includes(".tmp-")), false);

  await writeFile(svgPath, "previous SVG", { mode: 0o600 });
  const interrupted = createDesktopFileDeliveryHandlers({
    dialog,
    app: { getPath: () => pictureRoot },
    mainWindow: () => ({ id: 1 }),
    fsOps: {
      mkdir,
      writeFile,
      rename: async () => { throw new Error("interrupted atomic delivery"); },
      unlink,
    },
  });
  await assert.rejects(() => interrupted.export({ name: "hole.svg", text: svg, mimeType: "image/svg+xml" }), /interrupted atomic delivery/);
  assert.equal(await readFile(svgPath, "utf8"), "previous SVG");
  assert.equal((await readdir(root)).some((name) => name.includes(".tmp-")), false);

  const canceled = createDesktopFileDeliveryHandlers({
    dialog: { showSaveDialog: async () => ({ canceled: true }) },
    app: { getPath: () => pictureRoot },
    mainWindow: () => ({ id: 1 }),
  });
  assert.equal(await canceled.export({ name: "canceled.svg", text: svg, mimeType: "image/svg+xml" }), false);
  assert.equal((await readdir(root)).includes("canceled.svg"), false);

  await assert.rejects(() => handlers.export({ name: "bad.png", text: "png", mimeType: "image/png" }), /Invalid export MIME type/);
  await assert.rejects(() => handlers.screenshot({ dataUrl: "data:image/jpeg;base64,AA==", suggestedName: "bad" }), /Only PNG/);
  assert.equal((await readdir(pictureRoot)).some((name) => name.includes("bad")), false);
  assert.equal(await new NativeStore(root).readText("coursecraft_export_receipt"), null);
});
