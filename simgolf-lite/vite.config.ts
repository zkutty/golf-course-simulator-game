import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "node:path";
import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf-8")
) as { version: string };
const commitSha = process.env.GITHUB_SHA ?? process.env.VITE_COMMIT_SHA ?? "local";
const appRelease = process.env.SENTRY_RELEASE ?? `coursecraft@${pkg.version}+${commitSha.slice(0, 12)}`;
const sentryBuildEnabled = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
);
const rootAudioPattern = /\.(?:aac|flac|m4a|mp3|ogg|wav)$/i;

function pruneRootAudioFromBuild() {
  let outDir = "";
  return {
    name: "coursecraft-prune-root-audio",
    apply: "build" as const,
    configResolved(config: { build: { outDir: string } }) {
      outDir = config.build.outDir;
    },
    writeBundle() {
      const audioDir = path.resolve(outDir, "audio");
      if (!existsSync(audioDir)) return;
      for (const entry of readdirSync(audioDir, { withFileTypes: true })) {
        if (entry.isFile() && rootAudioPattern.test(entry.name)) {
          unlinkSync(path.join(audioDir, entry.name));
        }
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  // Deploy target base path (e.g. /repo-name/ on GitHub Pages); defaults to root.
  base: process.env.VITE_BASE ?? "/",
  plugins: [
    pruneRootAudioFromBuild(),
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
  test: {
    // Desktop shell tests use Node's built-in test runner so they can verify
    // fsync/rename behavior without Vitest transforming the Electron modules.
    exclude: [
      ...configDefaults.exclude,
      "desktop/**",
      "scripts/**/*.test.mjs",
      "worker/**/*.integration.test.ts",
    ],
    alias: {
      "cloudflare:workers": path.resolve(__dirname, "worker/cloudflare-workers-test.ts"),
    },
  },
  build: {
    // Maps are generated only for authenticated Sentry CI builds and deleted
    // after upload by the plugin, so they never ship with the game.
    sourcemap: sentryBuildEnabled ? "hidden" : false,
    rollupOptions: {
      output: {
        // Stable framework/renderer chunks stay browser-cacheable while game
        // systems and visual tuning iterate. Keep Pixi isolated because its
        // renderer backends already fan out into their own lazy chunks.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/pixi.js/") || id.includes("/@pixi/")) return "pixi";
          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) return "react";
          if (sentryBuildEnabled && id.includes("/@sentry/")) return "telemetry";
          return "vendor";
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
