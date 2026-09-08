import path from "node:path";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid desktop request.");
  return value;
}

function stringField(value, key, max = 64 * 1024 * 1024) {
  const source = object(value)[key];
  if (typeof source !== "string" || source.length > max) throw new Error(`Invalid ${key}.`);
  return source;
}

async function writeAtomically(target, contents, options, fsOps) {
  const temporary = `${target}.tmp-${randomUUID()}`;
  try {
    await fsOps.writeFile(temporary, contents, options);
    await fsOps.rename(temporary, target);
  } finally {
    await fsOps.unlink(temporary).catch(() => {});
  }
}

/**
 * The only main-process filesystem delivery paths exposed to the typed desktop
 * bridge. Keeping these handlers dependency-injected makes their exact dialog
 * and PNG boundaries executable without starting Electron in a test runner.
 */
export function createDesktopFileDeliveryHandlers({
  dialog,
  app,
  mainWindow,
  fsOps = { mkdir, rename, unlink, writeFile },
}) {
  return {
    export: async (payload) => {
      const name = path.basename(stringField(payload, "name", 180));
      const text = stringField(payload, "text");
      const mimeType = object(payload).mimeType;
      if (mimeType !== undefined && mimeType !== "application/json" && mimeType !== "image/svg+xml") throw new Error("Invalid export MIME type.");
      const filters = mimeType === "image/svg+xml"
        ? [{ name: "SVG images", extensions: ["svg"] }]
        : mimeType === "application/json" ? [{ name: "JSON files", extensions: ["json"] }] : undefined;
      const result = await dialog.showSaveDialog(mainWindow(), { defaultPath: name, ...(filters ? { filters } : {}) });
      if (result.canceled || !result.filePath) return false;
      await writeAtomically(result.filePath, text, { encoding: "utf8", mode: 0o600 }, fsOps);
      return true;
    },
    screenshot: async (payload) => {
      const dataUrl = stringField(payload, "dataUrl", 32 * 1024 * 1024);
      const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
      if (!match) throw new Error("Only PNG screenshots are supported.");
      const suggestedName = path.basename(stringField(payload, "suggestedName", 180)).replace(/[^A-Za-z0-9._-]/g, "-");
      if (!suggestedName || suggestedName === "." || suggestedName === "..") throw new Error("Invalid screenshot name.");
      const bytes = Buffer.from(match[1], "base64");
      if (!bytes.length || bytes.length > 24 * 1024 * 1024) throw new Error("Screenshot is too large.");
      const pictures = app.getPath("pictures");
      await fsOps.mkdir(pictures, { recursive: true });
      const target = path.join(pictures, suggestedName.endsWith(".png") ? suggestedName : `${suggestedName}.png`);
      await writeAtomically(target, bytes, { mode: 0o600 }, fsOps);
      return target;
    },
  };
}
