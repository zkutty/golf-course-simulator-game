import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildM65Report,
  collectM65ObservedResults,
  m65ReportBytes,
  verifyM65SourceBindings,
} from "./m65-certification-contract.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const mode = process.argv[2];
if ((mode !== "--check" && mode !== "--write") || process.argv.length !== 3) {
  throw new Error("Usage: node scripts/m65-certify.mjs --check|--write");
}

const manifestPath = join(root, "release/m65-certification-manifest.json");
const reportPath = join(root, "artifacts/m65/certification-report.json");
const docsPath = join(root, "docs/M65_CERTIFICATION.md");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const bindingErrors = verifyM65SourceBindings(manifest, root).errors;
if (bindingErrors.length > 0) {
  throw new Error(`M65 source contract invalid:\n${bindingErrors.join("\n")}`);
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), "m65-certification-"));
const vitestPath = join(temporaryDirectory, "vitest.json");
const headlessPath = join(temporaryDirectory, "headless.json");
const playwrightPath = join(temporaryDirectory, "playwright.json");
const playwrightOutputPath = join(temporaryDirectory, "playwright-results");

function runGate(label, executable, args, options = {}) {
  process.stdout.write(`M65 gate: ${label}\n`);
  const result = spawnSync(executable, args, {
    cwd: root,
    env: { ...process.env, ...options.env },
    stdio: "inherit",
    timeout: options.timeout,
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${label} terminated by ${result.signal}`);
  if (result.status !== 0) throw new Error(`${label} exited with status ${result.status}`);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} did not produce valid structured JSON: ${error.message}`);
  }
}

function docsWithDigest(docs, digest) {
  const marker = /<!-- m65-report-digest:[0-9a-f]{64} -->/;
  if (!marker.test(docs)) throw new Error("M65 docs digest marker is missing");
  const visible = /The generated report SHA-256 digest is\s+`[0-9a-f]{64}`\./;
  if (!visible.test(docs)) throw new Error("M65 docs visible report digest is missing");
  return docs
    .replace(marker, `<!-- m65-report-digest:${digest} -->`)
    .replace(visible, `The generated report SHA-256 digest is\n\`${digest}\`.`);
}

try {
  runGate(
    "headless semantic certification",
    join(root, "node_modules/.bin/vitest"),
    [
      "run",
      "src/game/testing/zk813ProfileCertification.test.ts",
      "--maxWorkers=1",
      "--testTimeout=120000",
      "--reporter=json",
      `--outputFile=${vitestPath}`,
    ],
    { env: { M65_HEADLESS_RESULT_PATH: headlessPath }, timeout: 180_000 },
  );
  runGate(
    "five-case Chromium browser certification",
    join(root, "node_modules/.bin/playwright"),
    [
      "test",
      "e2e/zk813-profile-certification.e2e.ts",
      "--workers=1",
      "--retries=0",
      "--reporter=json",
      `--output=${playwrightOutputPath}`,
    ],
    {
      env: {
        PLAYWRIGHT_JSON_OUTPUT_FILE: playwrightPath,
        PLAYWRIGHT_OUTPUT_DIR: playwrightOutputPath,
      },
      timeout: 900_000,
    },
  );

  const observed = collectM65ObservedResults(
    manifest,
    readJson(vitestPath, "Vitest"),
    readJson(headlessPath, "headless certification"),
    readJson(playwrightPath, "Playwright"),
  );
  const report = buildM65Report(manifest, observed, root);
  const expectedBytes = m65ReportBytes(report);
  const docs = readFileSync(docsPath, "utf8");
  const expectedDocs = docsWithDigest(docs, report.reportDigest);

  if (mode === "--write") {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, expectedBytes);
    writeFileSync(docsPath, expectedDocs);
  } else {
    const actualBytes = readFileSync(reportPath, "utf8");
    if (actualBytes !== expectedBytes) {
      throw new Error("M65 tracked report byte drift; rerun with --write after reviewing passing gates");
    }
    if (docs !== expectedDocs) {
      throw new Error("M65 docs/report digest drift; rerun with --write after reviewing passing gates");
    }
  }
  process.stdout.write(`${report.verdict} ${report.reportDigest}\n`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
