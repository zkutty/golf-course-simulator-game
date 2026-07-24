export function createSteamAdapter() {
  const available = false;
  return {
    capabilities: {
      steam: available,
      workshop: available,
      cloud: available,
      overlay: available,
    },
    achievements: async (ids) => [...new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [])],
    cloudStatus: async () => available ? "ready" : "unavailable",
    cloudGenerations: async () => [],
    cloudPreserveBoth: async () => false,
    workshopList: async () => [],
    workshopPublish: async () => {
      throw new Error("Steam Workshop is unavailable in this distribution.");
    },
    workshopCancel: async () => undefined,
    workshopCopyLocal: async () => null,
    presence: async () => undefined,
    overlay: async () => false,
  };
}
