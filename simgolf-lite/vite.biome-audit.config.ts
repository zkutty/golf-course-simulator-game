import { defineConfig } from "vite";

/** ZK-564's SSR audit reads public assets in place; copying them wastes 130+ MiB. */
export default defineConfig({
  publicDir: false,
});
