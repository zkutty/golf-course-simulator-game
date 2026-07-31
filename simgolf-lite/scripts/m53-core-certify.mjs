import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { resolveZk571ArtifactDirectory } from "./zk571-certification-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const bundleDirectory = resolve(root, "m53-cert-dist");
const artifactDirectory = resolveZk571ArtifactDirectory(
  Object.prototype.hasOwnProperty.call(process.env, "ZK571_ARTIFACT_DIRECTORY")
    ? process.env.ZK571_ARTIFACT_DIRECTORY
    : undefined,
  { appRoot: root },
);
const timeout = 120_000;

rmSync(bundleDirectory, { recursive: true, force: true });
rmSync(resolve(artifactDirectory, "core-certification.json"), { force: true });
rmSync(resolve(artifactDirectory, "risk-register.json"), { force: true });
mkdirSync(artifactDirectory, { recursive: true });

let exitCode = 1;
try {
  const build = spawnSync(process.execPath, [
    "node_modules/vite/bin/vite.js",
    "build",
    "--config",
    "vite.biome-audit.config.ts",
    "--ssr",
    "src/game/testing/m53CertificationCli.ts",
    "--outDir",
    "m53-cert-dist",
    "--emptyOutDir",
    "--minify",
    "false",
  ], {
    cwd: root,
    stdio: "inherit",
    timeout,
    killSignal: "SIGTERM",
  });
  if (build.status !== 0 || build.signal || build.error) {
    console.error("[M53 core] bundle failed", {
      status: build.status,
      signal: build.signal,
      error: build.error?.code ?? null,
    });
    exitCode = build.status ?? 1;
  } else {
    const execute = spawnSync(process.execPath, [
      "m53-cert-dist/m53CertificationCli.js",
    ], {
      cwd: root,
      env: {
        ...process.env,
        ZK571_ARTIFACT_DIRECTORY: artifactDirectory,
      },
      stdio: "inherit",
      timeout,
      killSignal: "SIGTERM",
    });
    if (execute.status !== 0 || execute.signal || execute.error) {
      console.error("[M53 core] execution failed", {
        status: execute.status,
        signal: execute.signal,
        error: execute.error?.code ?? null,
      });
      exitCode = execute.status ?? 1;
    } else {
      exitCode = 0;
    }
  }
} finally {
  // The SSR bundle is an execution detail. In particular, Vite's normal
  // public asset copy must never become certification evidence.
  rmSync(bundleDirectory, { recursive: true, force: true });
}

process.exitCode = exitCode;
