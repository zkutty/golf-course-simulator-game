import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
function normalizeE2EModifiers(args) {
  const valueOptions = new Set(["--workers", "--retries", "--timeout", "--global-timeout", "--reporter", "--output", "--grep", "--grep-invert", "--config", "--project", "-g"]);
  const flags = new Set(["--headed", "--quiet", "--forbid-only", "--list", "--ui", "--debug"]);
  const normalized = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith("-")) { normalized.push(arg); continue; }
    const equal = arg.indexOf("=");
    const name = equal < 0 ? arg : arg.slice(0, equal);
    if (valueOptions.has(name)) {
      const value = equal < 0 ? args[++index] : arg.slice(equal + 1);
      if (!value || value.startsWith("--")) throw new Error(`Missing E2E option value: ${name}`);
      normalized.push(`${name}=${value}`);
    } else if (flags.has(arg)) normalized.push(arg);
    else throw new Error(`Unsupported E2E option: ${name}; use a focused Playwright command or the dedicated test:stability producer`);
  }
  return normalized;
}
function broadE2EArguments(normalized) {
  const selection = normalized.filter(arg => !/^--(?:workers|retries|timeout|global-timeout|reporter|output)=.+$/.test(arg) && !["--headed", "--quiet", "--forbid-only"].includes(arg));
  if (selection.length === 0) return true;
  if (selection.some(arg => !arg.startsWith("-") || /^(?:--grep|--grep-invert|--config|--project|-g)(?:=|$)|^(?:--list|--ui|--debug)$/.test(arg))) return false;
  throw new Error("Unsupported broad E2E options; use a focused selection or the dedicated test:stability producer");
}

export function e2eCommands(node, appRoot, args) {
  const stability = [node, resolve(appRoot, "scripts/zk682-run-stability.mjs")];
  const standard = [node, resolve(appRoot, "node_modules/@playwright/test/cli.js"), "test", ...args];
  const normalized = normalizeE2EModifiers(args);
  const stabilityTarget = normalized.find(arg => /(?:^|[/\\])zk682-stability\.e2e\.ts$/.test(arg));
  if (stabilityTarget) {
    if (normalized.some(arg => arg !== stabilityTarget && !["--workers=1", "--retries=0"].includes(arg))) throw new Error("Use test:stability for the dedicated stability producer; mixed selection or producer overrides are not supported");
    return [stability];
  }
  // A bare/full run retains this gate through its dedicated production path.
  // Focused file/grep/list/debug invocations keep their ordinary selection.
  const broad = broadE2EArguments(normalized);
  return broad ? [stability, standard] : [standard];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const command of e2eCommands(process.execPath, root, process.argv.slice(2))) {
    const result = spawnSync(command[0], command.slice(1), { cwd: root, stdio: "inherit", env: process.env });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
