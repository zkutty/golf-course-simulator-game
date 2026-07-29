import { mkdir, open, readFile, readdir, rename, copyFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const SAFE_KEY = /^[A-Za-z0-9_.@-]{1,180}$/;

function assertSafeKey(key) {
  if (typeof key !== "string" || !SAFE_KEY.test(key) || key.includes("..")) {
    throw new Error("Invalid storage key.");
  }
  return key;
}

function assertSafePrefix(prefix) {
  if (typeof prefix !== "string" || prefix.length > 180 || prefix.includes("..") || !/^[A-Za-z0-9_.@-]*$/.test(prefix)) {
    throw new Error("Invalid storage prefix.");
  }
  return prefix;
}

function validJson(value) {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
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
    this.lastRecovery = null;
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
    const candidates = [target, ...Array.from({ length: this.backups }, (_, index) => `${target}.bak${index + 1}`)];
    const invalid = [];
    for (const candidate of candidates) {
      try {
        const value = await readFile(candidate, "utf8");
        if (!validJson(value)) {
          invalid.push(path.basename(candidate));
          continue;
        }
        this.lastRecovery = {
          key,
          selected: path.basename(candidate),
          recovered: candidate !== target,
          invalid,
        };
        return value;
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
    }
    this.lastRecovery = { key, selected: null, recovered: false, invalid };
    return null;
  }

  async recoveryStatus(key) {
    await this.readText(key);
    return this.lastRecovery;
  }

  async writeTextAtomic(key, value) {
    if (typeof value !== "string" || value.length > 64 * 1024 * 1024) throw new Error("Storage value is invalid or too large.");
    if (!validJson(value)) throw new Error("Storage value must be valid JSON.");
    const target = this.filePath(key);
    await mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.tmp-${process.pid}-${Date.now().toString(36)}`;
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(value, "utf8");
      await handle.sync();
      if (this.fault === "after-temp") throw new Error("Injected interrupted write.");
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(temp).catch(() => undefined);
      throw error;
    } finally {
      await handle.close();
    }
    try {
      for (let index = this.backups; index >= 2; index -= 1) {
        await copyFile(`${target}.bak${index - 1}`, `${target}.bak${index}`).catch(() => undefined);
      }
      await copyFile(target, `${target}.bak1`).catch(() => undefined);
      await rename(temp, target);
      await this.syncDirectory(path.dirname(target));
    } finally {
      await unlink(temp).catch(() => undefined);
    }
  }

  async delete(key) {
    const target = this.filePath(key);
    const candidates = [target, ...Array.from({ length: this.backups }, (_, index) => `${target}.bak${index + 1}`)];
    for (const candidate of candidates) {
      await unlink(candidate).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    }
  }

  async list(prefix) {
    assertSafePrefix(prefix);
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

  async syncDirectory(directory) {
    try {
      const handle = await open(directory, "r");
      await handle.sync();
      await handle.close();
    } catch {
      // Some platforms do not allow opening a directory. The file was still
      // flushed and atomically renamed, so durability falls back to the OS.
    }
  }
}
