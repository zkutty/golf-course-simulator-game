import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectDesktopPackageEvidence } from "./desktop-package-evidence.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const baselinePath = join(root, "artifacts/zk-680/pre-split-baseline.json");
const performancePath = join(root, "artifacts/zk-680/current-performance.json");

export const DELIVERY_BUDGETS = {
  // The initial game graph may never exceed the pre-split bundle.
  initialJavaScriptBytes: 1608719,
  // This independently protects the deferred Vision route.
  visionPageJavaScriptBytes: 32 * 1024,
  // Existing M35 limits still protect assets; these keep the delivery view explicit.
  initialCriticalTransferBytes: 4 * 1024 * 1024,
  maxSelectedBiomeBytes: 6 * 1024 * 1024,
  // Package totals include platform metadata and are allowed a bounded release overhead.
  distBytes: 114878859 + 2 * 1024 * 1024,
  desktopPackageBytes: 495074219 + 4 * 1024 * 1024,
  desktopAsarBytes: 206569606 + 2 * 1024 * 1024,
  coldStartupMs: 5000,
  fixtureLoadMs: 6000,
};

function walkBytes(directory) {
  return readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const file = join(directory, entry.name);
    return total + (entry.isDirectory() ? walkBytes(file) : entry.isFile() ? statSync(file).size : 0);
  }, 0);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function applicationEntry(manifest) {
  return Object.entries(manifest).find(([, entry]) => entry.isEntry)?.[0] ?? null;
}

function routeJavascriptBytes(manifest, directory, source) {
  const entry = Object.values(manifest).find((value) => value.src === source);
  if (!entry?.file?.endsWith(".js")) {
    throw new Error(`Missing JavaScript output for deferred route ${source}`);
  }
  return statSync(join(directory, entry.file)).size;
}

function maxSelectedBiomeBytes(assetAudit) {
  const bundles = Object.values(assetAudit?.dist?.bundles ?? {});
  const values = bundles.flatMap((bundle) => Object.values(bundle));
  return Math.max(0, ...values.map((entry) => Number(entry.bytes) || 0));
}

function comparison(name, value, baseline, budget) {
  return {
    baseline,
    value,
    deltaBytes: value - baseline,
    budget,
    ok: value <= budget,
    error: value <= budget ? null : `${name} is ${value} B; budget is ${budget} B`,
  };
}

export function collectWebDeliveryEvidence(distDirectory = join(root, "dist")) {
  const manifestPath = join(distDirectory, ".vite", "manifest.json");
  const auditPath = join(root, "artifacts/m35/asset-audit.json");
  if (!existsSync(manifestPath)) throw new Error(`Missing ${manifestPath}; run the production build first.`);
  if (!existsSync(auditPath)) throw new Error(`Missing ${auditPath}; run the M35 asset audit first.`);

  const manifest = readJson(manifestPath);
  const entry = applicationEntry(manifest);
  if (!entry) throw new Error("Vite manifest has no application entry.");
  const initialEntry = manifest[entry];
  if (!initialEntry.file.endsWith(".js")) throw new Error("Application entry has no JavaScript output.");
  const audit = readJson(auditPath);
  const performance = readJson(performancePath);
  return {
    initialJavaScriptBytes: statSync(join(distDirectory, initialEntry.file)).size,
    visionPageJavaScriptBytes: routeJavascriptBytes(manifest, distDirectory, "src/ui/VisionPage.tsx"),
    initialCriticalTransferBytes: Number(audit?.initialCritical?.bytes),
    maxSelectedBiomeBytes: maxSelectedBiomeBytes(audit),
    distBytes: walkBytes(distDirectory),
    coldStartupMs: Number(performance.coldStartupMs),
    fixtureLoadMs: Number(performance.fixtureLoadMs),
  };
}

export async function collectDeliveryEvidence({ distDirectory = join(root, "dist"), desktopDirectory } = {}) {
  const web = collectWebDeliveryEvidence(distDirectory);
  if (!desktopDirectory) return web;
  const desktop = await collectDesktopPackageEvidence(desktopDirectory);
  return {
    ...web,
    desktopPackageBytes: desktop.packageBytes,
    desktopAsarBytes: desktop.asarBytes,
  };
}

export function evaluateDeliveryBudgets(evidence, baseline = readJson(baselinePath)) {
  const measurements = baseline.measurements;
  const checks = Object.fromEntries(
    Object.entries(evidence).map(([name, value]) => [
      name,
      comparison(name, value, measurements[name], DELIVERY_BUDGETS[name]),
    ]),
  );
  const errors = Object.values(checks).flatMap((check) => check.error ? [check.error] : []);
  return {
    schemaVersion: 1,
    reference: baseline.reference,
    budgets: DELIVERY_BUDGETS,
    checks,
    ok: errors.length === 0,
    errors,
  };
}

export async function assertDeliveryBudgets(options) {
  const evidence = await collectDeliveryEvidence(options);
  const report = evaluateDeliveryBudgets(evidence);
  if (!report.ok) throw new Error(`ZK-680 delivery budget failed: ${report.errors.join("; ")}`);
  return report;
}

async function run() {
  const desktopFlag = process.argv.indexOf("--desktop");
  const desktopDirectory = desktopFlag === -1 ? undefined : process.argv[desktopFlag + 1];
  if (desktopFlag !== -1 && !desktopDirectory) throw new Error("--desktop requires an Electron output directory.");
  const report = await assertDeliveryBudgets({ desktopDirectory });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
