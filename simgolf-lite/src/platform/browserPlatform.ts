import type { PlatformServices } from "./types";

const memory = new Map<string, string>();
const STORAGE_PREFIX = "coursecraft_platform_";

function stored(key: string): string | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage.getItem(`${STORAGE_PREFIX}${key}`);
  } catch {
    // Memory fallback is intentional for blocked/private storage.
  }
  return memory.get(key) ?? null;
}

function store(key: string, value: string): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(`${STORAGE_PREFIX}${key}`, value);
      return;
    }
  } catch {
    // Memory fallback is intentional for blocked/private storage.
  }
  memory.set(key, value);
}

function remove(key: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
  } catch {
    // Memory fallback is intentional for blocked/private storage.
  }
  memory.delete(key);
}

function keys(prefix: string): string[] {
  const found = new Set([...memory.keys()].filter((key) => key.startsWith(prefix)));
  try {
    if (typeof localStorage !== "undefined") for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(`${STORAGE_PREFIX}${prefix}`)) found.add(key.slice(STORAGE_PREFIX.length));
    }
  } catch {
    // Memory-only listing.
  }
  return [...found].sort();
}

async function chooseImport(extensions: string[]): Promise<{ name: string; text: string } | null> {
  if (typeof document === "undefined") return null;
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = extensions.map((extension) => extension.startsWith(".") ? extension : `.${extension}`).join(",");
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? { name: file.name, text: await file.text() } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

async function chooseExport(name: string, text: string): Promise<boolean> {
  if (typeof document === "undefined") return false;
  const link = document.createElement("a");
  link.download = name;
  link.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  return true;
}

export const browserPlatform: PlatformServices = {
  version: 1,
  capabilities: {
    kind: "browser",
    nativeFiles: false,
    steam: false,
    workshop: false,
    cloud: false,
    overlay: false,
    screenshots: true,
  },
  files: {
    readText: async (key) => stored(key),
    recovery: async () => null,
    writeTextAtomic: async (key, value) => store(key, value),
    delete: async (key) => remove(key),
    list: async (prefix) => keys(prefix),
    chooseImport,
    chooseExport,
    exportSupportBundle: async () => chooseExport("coursecraft-support.json", JSON.stringify({
      platform: "browser",
      userAgent: typeof navigator === "undefined" ? "unknown" : navigator.userAgent,
      generatedAt: new Date().toISOString(),
      note: "Save contents, local storage, tokens, and environment values are intentionally excluded.",
    }, null, 2)),
  },
  app: {
    version: async () => "browser",
    safeMode: async () => false,
    markCleanExit: async () => undefined,
    requestQuit: async () => "cancel",
    onQuitRequested: () => () => undefined,
    setWindowMode: async (mode) => {
      if (typeof document === "undefined") return;
      if (mode === "fullscreen") await document.documentElement.requestFullscreen?.();
      else if (document.fullscreenElement) await document.exitFullscreen?.();
    },
  },
  achievements: { unlock: async (ids) => [...new Set(ids)] },
  cloud: {
    status: async () => "unavailable",
    generations: async () => [],
    preserveBoth: async () => false,
  },
  workshop: {
    legalAgreementUrl: null,
    list: async () => [],
    publish: async () => { throw new Error("Steam Workshop is unavailable in this build."); },
    cancel: async () => undefined,
    copyLocal: async () => null,
  },
  presence: { set: async () => undefined },
  overlay: { open: async () => false },
  screenshots: {
    save: async (dataUrl, suggestedName) => {
      if (typeof document === "undefined") return null;
      const link = document.createElement("a");
      link.download = suggestedName;
      link.href = dataUrl;
      link.click();
      return suggestedName;
    },
  },
};
