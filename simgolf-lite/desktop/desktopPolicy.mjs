const MODES = new Set(["windowed", "borderless", "fullscreen"]);
const PRESENCE_VALUES = new Set(["title", "designing", "operating", "playing", "tournament", "campaign"]);
const OVERLAY_HOSTS = new Set(["store.steampowered.com", "steamcommunity.com"]);
const RESERVED_SHORTCUTS = new Set([
  "Alt+F4", "Ctrl+W", "Ctrl+R", "Ctrl+Shift+R", "Ctrl+L", "Ctrl+Shift+I",
  "Ctrl+Tab", "Ctrl+Shift+Tab", "Meta+Q", "Meta+W", "Meta+R", "Meta+L",
]);

function finite(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizeWindowMode(value, fallback = "windowed") {
  return MODES.has(value) ? value : fallback;
}

export function restoreWindowBounds(value, display) {
  const area = display?.workArea ?? display;
  if (!area || !["x", "y", "width", "height"].every((key) => Number.isFinite(area[key]))) {
    throw new Error("A display work area is required.");
  }
  const maxWidth = Math.max(1, area.width);
  const maxHeight = Math.max(1, area.height);
  const width = Math.max(Math.min(1024, maxWidth), Math.min(finite(value?.width, 1440), maxWidth));
  const height = Math.max(Math.min(720, maxHeight), Math.min(finite(value?.height, 900), maxHeight));
  const right = area.x + area.width - width;
  const bottom = area.y + area.height - height;
  return {
    x: Math.max(area.x, Math.min(finite(value?.x, area.x), right)),
    y: Math.max(area.y, Math.min(finite(value?.y, area.y), bottom)),
    width,
    height,
  };
}

export function windowStateFromWindow(window, displayId, mode = "windowed") {
  const bounds = window.getNormalBounds?.() ?? window.getBounds?.();
  if (!bounds) throw new Error("Window bounds are unavailable.");
  return {
    ...bounds,
    displayId: Number.isFinite(displayId) ? displayId : undefined,
    mode: normalizeWindowMode(mode),
  };
}

export function isAllowedOverlayUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && OVERLAY_HOSTS.has(url.hostname) && url.pathname.startsWith("/");
  } catch {
    return false;
  }
}

export function sanitizePresence(value) {
  return PRESENCE_VALUES.has(value) ? value : null;
}

export function sanitizeAchievementIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id) => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)))];
}

export function isReservedShortcut(binding) {
  return typeof binding === "string" && RESERVED_SHORTCUTS.has(binding);
}

export const DESKTOP_WINDOW_MODES = Object.freeze([...MODES]);
export const DESKTOP_PRESENCE_VALUES = Object.freeze([...PRESENCE_VALUES]);
