import { app, BrowserWindow, dialog, ipcMain, screen, shell } from "electron";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStore } from "./nativeStore.mjs";
import { createSteamAdapter } from "./steamAdapter.mjs";
import {
  isAllowedOverlayUrl,
  normalizeWindowMode,
  restoreWindowBounds,
  sanitizeAchievementIds,
  sanitizePresence,
  windowStateFromWindow,
} from "./desktopPolicy.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const WINDOW_STATE_KEY = "coursecraft_window_state_v1";
let mainWindow = null;
let store = null;
let safeMode = process.argv.includes("--safe-mode");
const analysisWorkerBenchmark = process.argv.includes("--analysis-worker-benchmark");
if (analysisWorkerBenchmark) app.commandLine.appendSwitch("allow-file-access-from-files");
let quitApproved = false;
let quitRequestInFlight = false;
let windowMode = "windowed";
const steam = createSteamAdapter({ logger: (message) => console.warn(message) });

function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid desktop request.");
  return value;
}

function stringField(value, key, max = 64 * 1024 * 1024) {
  const source = object(value)[key];
  if (typeof source !== "string" || source.length > max) throw new Error(`Invalid ${key}.`);
  return source;
}

function readWindowState(raw) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function displayForState(value) {
  return screen.getAllDisplays().find((candidate) => candidate.id === value?.displayId) ?? screen.getPrimaryDisplay();
}

function restoreBounds(value) {
  return restoreWindowBounds(value, displayForState(value));
}

function logStorageFailure(operation) {
  console.warn(`[desktop] ${operation} failed; local play continues`);
}

async function persistWindowState() {
  if (!mainWindow || !store || mainWindow.isDestroyed()) return;
  try {
    const bounds = windowStateFromWindow(mainWindow, screen.getDisplayMatching(mainWindow.getNormalBounds()).id, windowMode);
    await store.writeTextAtomic(WINDOW_STATE_KEY, JSON.stringify(bounds));
  } catch {
    logStorageFailure("window state persistence");
  }
}

function requestRendererQuit() {
  if (quitApproved || quitRequestInFlight) return;
  quitRequestInFlight = true;
  if (!mainWindow || mainWindow.isDestroyed()) {
    quitApproved = true;
    app.quit();
    return;
  }
  mainWindow.webContents.send("app:quitRequested");
}

function registerIpcHandlers() {
  if (!store) throw new Error("Desktop storage is not initialized.");
  ipcMain.handle("files:read", (_event, payload) => store.readText(stringField(payload, "key", 180)));
  ipcMain.handle("files:recovery", (_event, payload) => store.recoveryStatus(stringField(payload, "key", 180)));
  ipcMain.handle("files:write", (_event, payload) => store.writeTextAtomic(stringField(payload, "key", 180), stringField(payload, "value")));
  ipcMain.handle("files:delete", (_event, payload) => store.delete(stringField(payload, "key", 180)));
  ipcMain.handle("files:list", (_event, payload) => store.list(stringField(payload, "prefix", 180)));
  ipcMain.handle("dialogs:import", async (_event, payload) => {
    const extensions = Array.isArray(object(payload).extensions)
      ? object(payload).extensions
        .filter((item) => typeof item === "string")
        .map((item) => item.replace(/^\./, ""))
        .filter((item) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(item))
        .slice(0, 8)
      : [];
    const options = { properties: ["openFile"] };
    if (extensions.length) options.filters = [{ name: "CourseCraft files", extensions }];
    const result = await dialog.showOpenDialog(mainWindow, options);
    if (result.canceled || !result.filePaths[0]) return null;
    const selected = result.filePaths[0];
    const details = await stat(selected);
    if (!details.isFile() || details.size > 64 * 1024 * 1024) throw new Error("The selected file is too large.");
    return { name: path.basename(selected), text: await readFile(selected, "utf8") };
  });
  ipcMain.handle("dialogs:export", async (_event, payload) => {
    const name = path.basename(stringField(payload, "name", 180));
    const text = stringField(payload, "text");
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: name });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, text, { encoding: "utf8", mode: 0o600 });
    return true;
  });
  ipcMain.handle("support:export", async () => {
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: "coursecraft-support.json" });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, await store.supportBundle(app.getVersion(), safeMode), { encoding: "utf8", mode: 0o600 });
    return true;
  });
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:safeMode", () => safeMode);
  ipcMain.handle("app:markCleanExit", () => store.markCleanExit());
  ipcMain.handle("app:requestQuit", async (_event, payload) => {
    const request = object(payload);
    const dirty = request.dirty === true;
    const resumableBoundary = request.resumableBoundary === true;
    if (!dirty || resumableBoundary) {
      quitApproved = true;
      quitRequestInFlight = false;
      await store.markCleanExit();
      app.quit();
      return "quit";
    }
    await dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["Keep playing"],
      defaultId: 0,
      cancelId: 0,
      message: "CourseCraft has unsaved changes.",
      detail: "Save or return to a safe autosave boundary before quitting. Your current progress was not discarded.",
    });
    quitRequestInFlight = false;
    return "cancel";
  });
  ipcMain.handle("window:setMode", async (_event, payload) => {
    const mode = normalizeWindowMode(stringField(payload, "mode", 20), null);
    if (!mode) throw new Error("Invalid window mode.");
    if (mode === "fullscreen") {
      mainWindow.setSimpleFullScreen?.(false);
      mainWindow.setFullScreen(true);
    } else if (mode === "borderless") {
      mainWindow.setFullScreen(false);
      mainWindow.setSimpleFullScreen?.(true);
    } else {
      mainWindow.setFullScreen(false);
      mainWindow.setSimpleFullScreen?.(false);
    }
    windowMode = mode;
    await persistWindowState();
  });
  ipcMain.handle("screenshots:save", async (_event, payload) => {
    const dataUrl = stringField(payload, "dataUrl", 32 * 1024 * 1024);
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) throw new Error("Only PNG screenshots are supported.");
    const suggestedName = path.basename(stringField(payload, "suggestedName", 180)).replace(/[^A-Za-z0-9._-]/g, "-");
    if (!suggestedName || suggestedName === "." || suggestedName === "..") throw new Error("Invalid screenshot name.");
    const bytes = Buffer.from(match[1], "base64");
    if (!bytes.length || bytes.length > 24 * 1024 * 1024) throw new Error("Screenshot is too large.");
    const pictures = app.getPath("pictures");
    await mkdir(pictures, { recursive: true });
    const target = path.join(pictures, suggestedName.endsWith(".png") ? suggestedName : `${suggestedName}.png`);
    await writeFile(target, bytes, { mode: 0o600 });
    return target;
  });
  ipcMain.handle("steam:capabilities", () => steam.capabilities);
  ipcMain.handle("steam:achievements", (_event, payload) => steam.achievements(sanitizeAchievementIds(object(payload).ids)));
  ipcMain.handle("steam:cloudStatus", () => steam.cloudStatus());
  ipcMain.handle("steam:cloudGenerations", () => steam.cloudGenerations());
  ipcMain.handle("steam:cloudPreserveBoth", (_event, payload) => {
    const request = object(payload);
    return steam.cloudPreserveBoth(request.localGeneration, request.cloudGeneration);
  });
  ipcMain.handle("steam:workshopList", () => steam.workshopList());
  ipcMain.handle("steam:workshopPublish", (_event, payload) => steam.workshopPublish(object(payload)));
  ipcMain.handle("steam:workshopCancel", (_event, payload) => steam.workshopCancel(stringField(payload, "operationId", 180)));
  ipcMain.handle("steam:workshopCopyLocal", (_event, payload) => steam.workshopCopyLocal(stringField(payload, "itemId", 180)));
  ipcMain.handle("steam:presence", (_event, payload) => {
    const value = sanitizePresence(stringField(payload, "value", 40));
    if (!value) throw new Error("Invalid presence value.");
    return steam.presence(value);
  });
  ipcMain.handle("steam:overlay", (_event, payload) => {
    const url = stringField(payload, "url", 500);
    if (!isAllowedOverlayUrl(url)) throw new Error("Overlay URL is not approved.");
    return steam.overlay(url);
  });
}

async function createWindow({ benchmark = false } = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) return;
  if (!store) {
    store = new NativeStore(app.getPath("userData"));
    safeMode = safeMode || await store.crashState();
    registerIpcHandlers();
  }
  const savedState = readWindowState(await store.readText(WINDOW_STATE_KEY));
  windowMode = normalizeWindowMode(savedState?.mode, "windowed");
  mainWindow = new BrowserWindow({
    ...restoreBounds(savedState),
    minWidth: 1024,
    minHeight: 720,
    show: false,
    backgroundColor: "#28382f",
    webPreferences: {
      ...(benchmark ? {} : { preload: path.join(root, "preload.mjs") }),
      contextIsolation: true,
      sandbox: !benchmark,
      nodeIntegration: false,
      webSecurity: !benchmark,
      devTools: !app.isPackaged,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedOverlayUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = app.isPackaged ? url.startsWith("file:") : url.startsWith("http://127.0.0.1:");
    if (!allowed) event.preventDefault();
  });
  mainWindow.on("close", (event) => {
    if (quitApproved) return;
    event.preventDefault();
    requestRendererQuit();
  });
  for (const eventName of ["move", "resize", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) {
    mainWindow.on(eventName, () => void persistWindowState());
  }
  if (!benchmark) mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = null; quitRequestInFlight = false; });
  const developmentUrl = process.env.COURSECRAFT_DEV_SERVER_URL;
  if (developmentUrl && /^http:\/\/127\.0\.0\.1:\d+$/.test(developmentUrl)) {
    const fixture = benchmark ? "?fixture=zk681-analysis-worker" : "";
    await mainWindow.loadURL(`${developmentUrl}/${fixture}`);
  } else {
    await mainWindow.loadFile(path.join(root, "..", "dist", "index.html"), benchmark
      ? { query: { fixture: "zk681-analysis-worker" } }
      : undefined);
  }
  await steam.initialize();
}

app.on("before-quit", (event) => {
  if (quitApproved || !mainWindow || mainWindow.isDestroyed()) return;
  event.preventDefault();
  requestRendererQuit();
});
function handleDisplayMetricsChanged() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (windowMode !== "fullscreen") {
    const bounds = restoreBounds(windowStateFromWindow(mainWindow, screen.getDisplayMatching(mainWindow.getNormalBounds()).id, windowMode));
    mainWindow.setBounds(bounds);
  }
  void persistWindowState();
}

async function runPackagedAnalysisWorkerBenchmark() {
  await createWindow({ benchmark: true });
  const report = await mainWindow.webContents.executeJavaScript(`(async () => {
    for (let attempt = 0; attempt < 240; attempt += 1) {
      if (window.__coursecraftAnalysisWorkerBenchmark) {
        return await window.__coursecraftAnalysisWorkerBenchmark;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("Analysis Worker benchmark fixture did not install.");
  })()`, true);
  console.log(`COURSECRAFT_ANALYSIS_WORKER_BENCHMARK=${JSON.stringify(report)}`);
  quitApproved = true;
  app.quit();
}

app.whenReady().then(async () => {
  screen.on("display-metrics-changed", handleDisplayMetricsChanged);
  if (analysisWorkerBenchmark) {
    try {
      await runPackagedAnalysisWorkerBenchmark();
    } catch (error) {
      console.error("COURSECRAFT_ANALYSIS_WORKER_BENCHMARK_ERROR=", error);
      quitApproved = true;
      app.exit(1);
    }
    return;
  }
  await createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") requestRendererQuit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
