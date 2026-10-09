import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";

// Authoring-only SSR bundle. No public assets copied, directory inputs scanned,
// candidate output written, or browser/runtime entry points changed.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), "coursecraft-wildlife-byte-audit-"));
try {
  await build({
    root, configFile: join(root, "vite.biome-audit.config.ts"), logLevel: "silent",
    build: {
      ssr: join(root, "src/game/testing/wildlifeCandidateByteAuditCli.ts"),
      outDir: temporary, emptyOutDir: true, minify: false,
      rollupOptions: { output: { entryFileNames: "audit.mjs" } },
    },
  });
  const { runWildlifeByteAuditCli } = await import(pathToFileURL(join(temporary, "audit.mjs")).href);
  process.exitCode = await runWildlifeByteAuditCli(process.argv.slice(2));
} finally { await rm(temporary, { recursive: true, force: true }); }
