import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "node:path";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf-8")
) as { version: string };
const commitSha = process.env.GITHUB_SHA ?? process.env.VITE_COMMIT_SHA ?? "local";
const appRelease = process.env.SENTRY_RELEASE ?? `coursecraft@${pkg.version}+${commitSha.slice(0, 12)}`;
const sentryBuildEnabled = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
);

// https://vite.dev/config/
export default defineConfig({
  // Deploy target base path (e.g. /repo-name/ on GitHub Pages); defaults to root.
  base: process.env.VITE_BASE ?? "/",
  plugins: [
    react(),
    ...(sentryBuildEnabled ? [sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      telemetry: false,
      release: { name: appRelease },
      sourcemaps: {
        assets: "./dist/**",
        filesToDeleteAfterUpload: "./dist/**/*.map",
      },
    })] : []),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_RELEASE__: JSON.stringify(appRelease),
    __COMMIT_SHA__: JSON.stringify(commitSha),
  },
  build: {
    // Maps are generated only for authenticated Sentry CI builds and deleted
    // after upload by the plugin, so they never ship with the game.
    sourcemap: sentryBuildEnabled ? "hidden" : false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
