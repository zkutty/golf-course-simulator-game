import { spawnSync } from "node:child_process";

// Invoke npm through Node so cmd.exe and POSIX shells receive the same env.
// No cross-env dependency, alternate build pipeline, or skipped asset audits.
if (!process.env.npm_execpath) throw new Error("Run the desktop build through npm run build:desktop");
const result = spawnSync(process.execPath, [process.env.npm_execpath, "run", "build"], {
  stdio: "inherit",
  env: { ...process.env, VITE_BASE: "./" },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
