import { mkdir, open, readFile, readdir, rename, copyFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const SAFE_KEY = /^[A-Za-z0-9_.@-]{1,180}$/;

function assertSafeKey(key) {
  if (typeof key !== "string" || !SAFE_KEY.test(key) || key.includes("..")) {
    throw new Error("Invalid storage key.");
  }
  return key;
}

function bucketFor(key) {
  if (key.startsWith("coursecraft_save_") || key.startsWith("coursecraft_saves_")) return "saves";
  if (key.startsWith("coursecraft_profile")) return "profile";
  if (key.startsWith("coursecraft_settings")) return "settings";
  if (key.startsWith("coursecraft_content_")) return "content";
  return "state";
}

export class NativeStore {
  constructor(rootDirectory, options = {}) {
    this.rootDirectory = path.resolve(rootDirectory);
    this.backups = Math.max(1, Math.min(5, Number(options.backups) || 3));
    this.fault = options.fault ?? null;
  }

  filePath(key) {
    const safe = assertSafeKey(key);
    const bucket = bucketFor(safe);
    const directory = path.join(this.rootDirectory, bucket);
    const target = path.join(directory, `${safe}.json`);
    if (!target.startsWith(`${this.rootDirectory}${path.sep}`)) throw new Error("Storage path escaped app data.");
    return target;
  }

  async readText(key) {
    const target = this.filePath(key);
    for (const candidate of [target, ...Array.from({ length: this.backups }, (_, index) => `${target}.bak${index + 1}`)]) {
      try {
        return await readFile(candidate, "utf8");
      } catch (error) {
        if (error?.code !== "ENOENT") continue;
      }
    }
    return null;
  }

  async writeTextAtomic(key, value) {
    if (typeof value !== "string" || value.length > 64 * 1024 * 1024) throw new Error("Storage value is invalid or too large.");
    const target = this.filePath(key);
    await mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.tmp-${process.pid}-${Date.now().toString(36)}`;
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(value, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (this.fault === "after-temp") throw new Error("Injected interrupted write.");
    for (let index = this.backups; index >= 2; index -= 1) {
      await copyFile(`${target}.bak${index - 1}`, `${target}.bak${index}`).catch(() => undefined);
    }
    await copyFile(target, `${target}.bak1`).catch(() => undefined);
    await rename(temp, target);
  }

  async delete(key) {
    const target = this.filePath(key);
    await unlink(target).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }

  async list(prefix) {
    assertSafeKey(prefix);
    const buckets = ["saves", "profile", "settings", "content", "state"];
    const results = [];
    for (const bucket of buckets) {
      const directory = path.join(this.rootDirectory, bucket);
      const names = await readdir(directory).catch(() => []);
      for (const name of names) {
        if (!name.endsWith(".json") || name.includes(".bak") || name.includes(".tmp-")) continue;
        const key = name.slice(0, -5);
        if (key.startsWith(prefix)) results.push(key);
      }
    }
    return results.sort();
  }

  async crashState() {
    const marker = path.join(this.rootDirectory, "state", "unclean-exit.marker");
    const crashed = await readFile(marker, "utf8").then(() => true, () => false);
    await mkdir(path.dirname(marker), { recursive: true });
    await writeFile(marker, String(Date.now()), { mode: 0o600 });
    return crashed;
  }

  async markCleanExit() {
    await unlink(path.join(this.rootDirectory, "state", "unclean-exit.marker")).catch(() => undefined);
  }

  async supportBundle(appVersion, safeMode) {
    const payload = {
      format: "coursecraft-support-v1",
      generatedAt: new Date().toISOString(),
      appVersion,
      safeMode,
      platform: process.platform,
      architecture: process.arch,
      node: process.versions.node,
      electron: process.versions.electron ?? "unknown",
      exclusions: ["save contents", "profile contents", "tokens", "credentials", "environment variables", "authorization headers"],
    };
    return JSON.stringify(payload, null, 2);
  }
}
