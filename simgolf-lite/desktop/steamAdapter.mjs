import { isAllowedOverlayUrl, sanitizeAchievementIds, sanitizePresence } from "./desktopPolicy.mjs";

const STATUS_VALUES = new Set(["unavailable", "offline", "ready", "full"]);

function safeErrorLog(logger, operation) {
  try {
    logger(`[steam] ${operation} unavailable`);
  } catch {
    // Logging is best effort and must never affect play.
  }
}

function distributionEnabled(env) {
  return env?.COURSECRAFT_STEAM === "1";
}

async function loadSteamApi(env) {
  if (!distributionEnabled(env)) return null;
  const appId = Number(env?.STEAM_APP_ID ?? 0);
  if (!Number.isInteger(appId) || appId <= 0) return null;
  try {
    const module = await import("steamworks.js");
    const init = module.init ?? module.default?.init;
    return typeof init === "function" ? await init(appId) : null;
  } catch {
    return null;
  }
}

function apiMethod(api, paths) {
  for (const path of paths) {
    let target = api;
    for (const key of path) target = target?.[key];
    if (typeof target === "function") return target.bind(path.slice(0, -1).reduce((value, key) => value?.[key], api));
  }
  return null;
}

function validStatus(value, fallback) {
  return STATUS_VALUES.has(value) ? value : fallback;
}

/**
 * Steam is deliberately an optional provider. The desktop distribution is
 * fully functional without Steamworks.js, while tests and a future Steam
 * bootstrap can inject an API with the same small capability surface.
 */
export function createSteamAdapter(options = {}) {
  const env = options.env ?? process.env;
  const distribution = options.distribution ?? distributionEnabled(env);
  const logger = options.logger ?? (() => undefined);
  let api = options.api ?? null;
  let initializationAttempted = Boolean(api) || !distribution;
  const earned = new Set();

  const adapter = {
    capabilities: Object.freeze({
      steam: distribution,
      workshop: distribution,
      cloud: distribution,
      overlay: distribution,
    }),

    async initialize() {
      if (initializationAttempted) return Boolean(api);
      initializationAttempted = true;
      api = await loadSteamApi(env);
      if (!api) safeErrorLog(logger, "client or Steamworks API");
      return Boolean(api);
    },

    async achievements(ids) {
      const requested = sanitizeAchievementIds(ids).filter((id) => !earned.has(id));
      if (!requested.length || !(await adapter.initialize())) return [];
      const activate = apiMethod(api, [["achievement", "activate"], ["userStats", "setAchievement"], ["setAchievement"]]);
      if (!activate) return [];
      const activated = [];
      for (const id of requested) {
        try {
          const result = await activate(id);
          if (result !== false) {
            earned.add(id);
            activated.push(id);
          }
        } catch {
          safeErrorLog(logger, "achievement reconciliation");
        }
      }
      return activated;
    },

    async cloudStatus() {
      if (!distribution) return "unavailable";
      if (!(await adapter.initialize())) return "offline";
      const status = apiMethod(api, [["cloud", "status"], ["cloudStatus"]]);
      if (status) {
        try {
          return validStatus(await status(), "offline");
        } catch {
          safeErrorLog(logger, "cloud status");
          return "offline";
        }
      }
      const enabled = apiMethod(api, [["cloud", "isEnabledForAccount"], ["cloud", "isEnabledForApp"]]);
      if (enabled) {
        try {
          return (await enabled()) ? "ready" : "offline";
        } catch {
          safeErrorLog(logger, "cloud availability");
        }
      }
      return "unavailable";
    },

    async cloudGenerations() {
      if (!(await adapter.initialize())) return [];
      const list = apiMethod(api, [["cloud", "generations"], ["cloudGenerations"]]);
      if (!list) return [];
      try {
        const generations = await list();
        return Array.isArray(generations) ? generations.filter((item) => item && typeof item.id === "string").slice(0, 64) : [];
      } catch {
        safeErrorLog(logger, "cloud generations");
        return [];
      }
    },

    async cloudPreserveBoth(localGeneration, cloudGeneration) {
      if (typeof localGeneration !== "string" || typeof cloudGeneration !== "string") return false;
      if (!(await adapter.initialize())) return false;
      const preserve = apiMethod(api, [["cloud", "preserveBoth"], ["cloudPreserveBoth"]]);
      if (!preserve) return false;
      try {
        return (await preserve(localGeneration, cloudGeneration)) === true;
      } catch {
        safeErrorLog(logger, "cloud conflict preservation");
        return false;
      }
    },

    async workshopList() {
      if (!(await adapter.initialize())) return [];
      const list = apiMethod(api, [["workshop", "list"]]);
      if (!list) return [];
      try {
        const items = await list();
        return Array.isArray(items) ? items.slice(0, 100) : [];
      } catch {
        safeErrorLog(logger, "Workshop listing");
        return [];
      }
    },

    async workshopPublish(input) {
      if (!(await adapter.initialize())) throw new Error("Steam Workshop is unavailable in this distribution.");
      const publish = apiMethod(api, [["workshop", "publish"]]);
      if (!publish) throw new Error("Steam Workshop is unavailable in this distribution.");
      try {
        const result = await publish(input);
        if (!result || typeof result.publishedId !== "string") throw new Error("Steam Workshop returned no item id.");
        return { publishedId: result.publishedId, needsLegalAgreement: result.needsLegalAgreement === true };
      } catch (error) {
        safeErrorLog(logger, "Workshop publish");
        throw error instanceof Error && /legal|unavailable|item id/i.test(error.message)
          ? error
          : new Error("Steam Workshop publish failed.");
      }
    },

    async workshopCancel(operationId) {
      if (typeof operationId !== "string" || !(await adapter.initialize())) return;
      const cancel = apiMethod(api, [["workshop", "cancel"]]);
      if (!cancel) return;
      try { await cancel(operationId); } catch { safeErrorLog(logger, "Workshop cancellation"); }
    },

    async workshopCopyLocal(itemId) {
      if (typeof itemId !== "string" || !(await adapter.initialize())) return null;
      const copy = apiMethod(api, [["workshop", "copyLocal"]]);
      if (!copy) return null;
      try {
        const value = await copy(itemId);
        return typeof value === "string" ? value : null;
      } catch {
        safeErrorLog(logger, "Workshop cache copy");
        return null;
      }
    },

    async presence(value) {
      const safeValue = sanitizePresence(value);
      if (!safeValue || !(await adapter.initialize())) return;
      const set = apiMethod(api, [["friends", "setRichPresence"], ["presence", "set"]]);
      if (!set) return;
      try { await set("status", safeValue); } catch { safeErrorLog(logger, "Rich Presence"); }
    },

    async overlay(url) {
      if (!isAllowedOverlayUrl(url) || !(await adapter.initialize())) return false;
      const open = apiMethod(api, [["overlay", "activateToWebPage"], ["overlay", "open"]]);
      if (!open) return false;
      try { return (await open(url)) !== false; } catch { safeErrorLog(logger, "overlay"); return false; }
    },
  };
  return adapter;
}
