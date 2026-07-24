import { app, BrowserWindow, dialog, ipcMain, screen, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStore } from "./nativeStore.mjs";
import { createSteamAdapter } from "./steamAdapter.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
let mainWindow = null;
let safeMode = process.argv.includes("--safe-mode");
let quitApproved = false;
const steam = createSteamAdapter();

function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid desktop request.");
  return value;
}

function stringField(value, key, max = 64 * 1024 * 1024) {
  const source = object(value)[key];
  if (typeof source !== "string" || source.length > max) throw new Error(`Invalid ${key}.`);
  return source;
}

function restoreBounds(value) {
  const display = screen.getAllDisplays().find((candidate) => candidate.id === value?.displayId) ?? screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = Math.max(1024, Math.min(Number(value?.width) || 1440, area.width));
  const height = Math.max(720, Math.min(Number(value?.height) || 900, area.height));
  return {
    x: Math.max(area.x, Math.min(Number(value?.x) || area.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(Number(value?.y) || area.y, area.y + area.height - height)),
    width,
    height,
  };
}

async function createWindow() {
  const store = new NativeStore(app.getPath("userData"));
  safeMode = safeMode || await store.crashState();
  const bounds = restoreBounds(null);
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    backgroundColor: "#28382f",
    webPreferences: {
      preload: path.join(root, "preload.mjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(store\.steampowered\.com|steamcommunity\.com)\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = app.isPackaged ? url.startsWith("file:") : url.startsWith("http://127.0.0.1:");
    if (!allowed) event.preventDefault();
  });
  mainWindow.on("close", (event) => {
    if (!quitApproved) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  const developmentUrl = process.env.COURSECRAFT_DEV_SERVER_URL;
  if (developmentUrl && /^http:\/\/127\.0\.0\.1:\d+$/.test(developmentUrl)) await mainWindow.loadURL(developmentUrl);
  else await mainWindow.loadFile(path.join(root, "..", "dist", "index.html"));

  ipcMain.handle("files:read", (_event, payload) => store.readText(stringField(payload, "key", 180)));
  ipcMain.handle("files:write", (_event, payload) => store.writeTextAtomic(stringField(payload, "key", 180), stringField(payload, "value")));
  ipcMain.handle("files:delete", (_event, payload) => store.delete(stringField(payload, "key", 180)));
  ipcMain.handle("files:list", (_event, payload) => store.list(stringField(payload, "prefix", 180)));
  ipcMain.handle("dialogs:import", async (_event, payload) => {
    const extensions = Array.isArray(object(payload).extensions)
      ? object(payload).extensions.filter((item) => typeof item === "string" && /^[A-Za-z0-9]+$/.test(item)).slice(0, 8)
      : [];
    const result = await dialog.showOpenDialog(mainWindow, { properties: ["openFile"], filters: [{ name: "CourseCraft files", extensions }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const { readFile } = await import("node:fs/promises");
    return { name: path.basename(result.filePaths[0]), text: await readFile(result.filePaths[0], "utf8") };
  });
  ipcMain.handle("dialogs:export", async (_event, payload) => {
    const name = path.basename(stringField(payload, "name", 180));
    const text = stringField(payload, "text");
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: name });
    if (result.canceled || !result.filePath) return false;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(result.filePath, text, { encoding: "utf8", mode: 0o600 });
    return true;
  });
  ipcMain.handle("support:export", async () => {
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: "coursecraft-support.json" });
    if (result.canceled || !result.filePath) return false;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(result.filePath, await store.supportBundle(app.getVersion(), safeMode), { encoding: "utf8", mode: 0o600 });
    return true;
  });
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:safeMode", () => safeMode);
  ipcMain.handle("app:markCleanExit", () => store.markCleanExit());
  ipcMain.handle("app:requestQuit", async (_event, payload) => {
    const request = object(payload);
    if (!request.dirty || request.resumableBoundary) {
      quitApproved = true;
      app.quit();
      return "quit";
    }
    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["Cancel", "Quit after autosave"],
      defaultId: 0,
      cancelId: 0,
      message: "CourseCraft has unsaved changes.",
      detail: "Return to a safe save boundary before quitting.",
    });
    if (result.response !== 1) return "cancel";
    return "cancel";
  });
  ipcMain.handle("window:setMode", (_event, payload) => {
    const mode = stringField(payload, "mode", 20);
    if (!["windowed", "borderless", "fullscreen"].includes(mode)) throw new Error("Invalid window mode.");
    mainWindow.setFullScreen(mode === "fullscreen");
    mainWindow.setSimpleFullScreen?.(mode === "borderless");
  });
  ipcMain.handle("screenshots:save", async (_event, payload) => {
    const dataUrl = stringField(payload, "dataUrl", 32 * 1024 * 1024);
    if (!/^data:image\/png;base64,/.test(dataUrl)) throw new Error("Only PNG screenshots are supported.");
    const suggestedName = path.basename(stringField(payload, "suggestedName", 180));
    const target = path.join(app.getPath("pictures"), suggestedName);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(target, Buffer.from(dataUrl.split(",", 2)[1], "base64"), { mode: 0o600 });
    return target;
  });
  ipcMain.handle("steam:achievements", (_event, payload) => steam.achievements(object(payload).ids));
  ipcMain.handle("steam:cloudStatus", () => steam.cloudStatus());
  ipcMain.handle("steam:cloudGenerations", () => steam.cloudGenerations());
  ipcMain.handle("steam:cloudPreserveBoth", () => steam.cloudPreserveBoth());
  ipcMain.handle("steam:workshopList", () => steam.workshopList());
  ipcMain.handle("steam:workshopPublish", (_event, payload) => steam.workshopPublish(object(payload)));
  ipcMain.handle("steam:workshopCancel", (_event, payload) => steam.workshopCancel(stringField(payload, "operationId", 180)));
  ipcMain.handle("steam:workshopCopyLocal", (_event, payload) => steam.workshopCopyLocal(stringField(payload, "itemId", 180)));
  ipcMain.handle("steam:presence", (_event, payload) => steam.presence(stringField(payload, "value", 40)));
  ipcMain.handle("steam:overlay", (_event, payload) => steam.overlay(stringField(payload, "url", 500)));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
