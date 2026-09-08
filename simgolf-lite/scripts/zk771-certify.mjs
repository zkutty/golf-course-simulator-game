import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePackageGitPath, reportBytes, sha256, sourceBindings, stableJson, validateEvidenceDescendant, validateReleasedProvenance } from "./zk771-certification-contract.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const mode = process.argv[2];
if ((mode !== "--write" && mode !== "--check") || process.argv.length !== 3) throw new Error("Usage: node scripts/zk771-certify.mjs --write|--check");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const hashFile = (path) => sha256(readFileSync(path));
const manifestPath = join(root, "release/zk771-certification-manifest.json");
const docsPath = join(root, "docs/ZK771_CERTIFICATION.md");
const tracked = join(root, "artifacts/zk771");
const git = (args) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed`);
  return result.stdout.trim();
};
const files = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
const documentation = (source, digest) => {
  if (!/<!-- zk771-report-digest:[0-9a-f]{64} -->/.test(source)) throw new Error("documentation digest marker is missing");
  return source.replace(/<!-- zk771-report-digest:[0-9a-f]{64} -->/, `<!-- zk771-report-digest:${digest} -->`);
};

async function generated(temp, manifest) {
  const visual = join(temp, "visual");
  const vitest = join(temp, "vitest.json");
  const execution = join(temp, "execution.json");
  const result = spawnSync(join(root, "node_modules/.bin/vitest"), ["run", "src/game/testing/zk771HoleIllustrationCertification.test.ts", "--maxWorkers=1", "--testTimeout=120000", "--reporter=json", `--outputFile=${vitest}`], {
    cwd: root,
    env: { ...process.env, ZK771_CERT_RESULT_PATH: execution, ZK771_CERT_ARTIFACT_DIR: visual },
    stdio: "inherit",
    timeout: 180000,
  });
  if (result.error || result.status !== 0) throw new Error("focused ZK-771 evidence test failed");
  const observedTest = readJson(vitest);
  if (observedTest.success !== true || observedTest.numTotalTests !== 1 || observedTest.numPassedTests !== 1 || observedTest.numFailedTests !== 0) throw new Error("focused test observation is incomplete");
  const executionJson = readJson(execution);
  if (executionJson.matrix?.length !== 48 || !executionJson.atlases?.some((entry) => entry.holes === 9) || !executionJson.atlases?.some((entry) => entry.holes === 18)) throw new Error("matrix or atlas observation is incomplete");
  const sharp = (await import("sharp")).default;
  if (sharp.versions?.sharp !== manifest.toolchain.sharpVersion) throw new Error("Sharp version does not match the frozen toolchain");
  const visualSource = readJson(join(visual, "visual-manifest.json"));
  if (visualSource.matrix?.length !== 48) throw new Error("expected 48 matrix SVGs");
  const output = join(temp, "tracked");
  mkdirSync(join(output, "visual"), { recursive: true });
  const artifactRows = [];
  const matrixPng = [];
  for (const row of visualSource.matrix) {
    const svgName = row.file;
    const pngName = svgName.replace(/\.svg$/, ".png");
    const svg = readFileSync(join(visual, svgName));
    const png = await sharp(svg).resize(480, 320, { fit: "fill" }).png().toBuffer();
    await sharp(png).metadata().then((metadata) => { if (!metadata.width || !metadata.height) throw new Error(`invalid raster ${pngName}`); });
    writeFileSync(join(output, "visual", svgName), svg);
    writeFileSync(join(output, "visual", pngName), png);
    matrixPng.push({ input: await sharp(png).resize(240, 160, { fit: "fill" }).png().toBuffer(), left: (matrixPng.length % 4) * 240, top: Math.floor(matrixPng.length / 4) * 160 });
    artifactRows.push({ path: `visual/${svgName}`, sha256: sha256(svg) }, { path: `visual/${pngName}`, sha256: sha256(png) });
  }
  for (const holes of [9, 18]) {
    const svgName = `atlas-${holes}-map.svg`;
    const pngName = `atlas-${holes}.png`;
    const svg = readFileSync(join(visual, svgName));
    const png = await sharp(svg).png().toBuffer();
    const metadata = await sharp(png).metadata();
    const expected = executionJson.atlases.find((entry) => entry.holes === holes);
    if (metadata.width !== expected.width || metadata.height !== expected.height) throw new Error(`atlas ${holes} raster dimensions drifted`);
    writeFileSync(join(output, "visual", svgName), svg);
    writeFileSync(join(output, "visual", pngName), png);
    artifactRows.push({ path: `visual/${svgName}`, sha256: sha256(svg) }, { path: `visual/${pngName}`, sha256: sha256(png) });
  }
  const contact = await sharp({ create: { width: 960, height: 1920, channels: 4, background: "#f4ead3" } }).composite(matrixPng.map((entry) => ({ ...entry, input: entry.input, blend: "over" }))).png().toBuffer();
  writeFileSync(join(output, "visual/contact-sheet.png"), contact);
  artifactRows.push({ path: "visual/contact-sheet.png", sha256: sha256(contact) });
  artifactRows.sort((left, right) => left.path.localeCompare(right.path));
  const artifactIndex = {
    schemaVersion: 2,
    purpose: "self-contained human-reviewable local SVG/PNG evidence; human visual sign-off remains required",
    contactSheet: "contact-sheet.png",
    matrix: visualSource.matrix.map((row) => ({ label: row.label, svg: row.file, png: row.file.replace(/\.svg$/, ".png") })),
    atlases: [9, 18].map((holes) => ({ holes, svg: `atlas-${holes}-map.svg`, png: `atlas-${holes}.png` })),
    artifacts: artifactRows,
  };
  const indexBytes = `${stableJson(artifactIndex)}\n`;
  writeFileSync(join(output, "visual/visual-manifest.json"), indexBytes);
  const observed = { tests: 1, passed: 1, failed: 0, matrix: 48, atlases: [9, 18], executionSha256: sha256(stableJson(executionJson)) };
  const report = reportBytes(manifest, observed, artifactRows, sha256(indexBytes));
  writeFileSync(join(output, "certification-report.json"), report);
  return { output, artifactRows, report, indexBytes };
}

const manifest = readJson(manifestPath);
const bindings = sourceBindings(manifest, root);
if (bindings.errors.length) {
  const sourceOnly = bindings.errors.every((error) => error.startsWith("source SHA-256 mismatch:"));
  if (mode !== "--write" || !sourceOnly) throw new Error(bindings.errors.join("\n"));
  manifest.sources = bindings.actual;
}
const provenanceErrors = validateReleasedProvenance({
  exists: (ref) => spawnSync("git", ["cat-file", "-e", ref], { cwd: root }).status === 0,
  resolve: (ref) => git(["rev-parse", ref]),
});
if (provenanceErrors.length) throw new Error(provenanceErrors.join("\n"));
const repositoryRoot = git(["rev-parse", "--show-toplevel"]);
const packagePrefix = relative(repositoryRoot, root).split(sep).join("/");
const changed = (range) => git(["diff", "--name-only", range]).split("\n").filter(Boolean).map((path) => normalizePackageGitPath(path, packagePrefix));
const descendantErrors = validateEvidenceDescendant({
  isAncestor: (ancestor, descendant) => spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd: root }).status === 0,
  changed,
});
if (descendantErrors.length) throw new Error(descendantErrors.join("\n"));
const temporary = mkdtempSync(join(tmpdir(), "zk771-certification-"));
try {
  const result = await generated(temporary, manifest);
  const expectedManifest = { ...manifest, retainedArtifacts: result.artifactRows };
  const expectedManifestBytes = `${stableJson(expectedManifest)}\n`;
  const expectedDocs = documentation(readFileSync(docsPath, "utf8"), JSON.parse(result.report).reportDigest);
  const expectedPaths = new Set(["certification-report.json", "visual/visual-manifest.json", ...result.artifactRows.map((entry) => entry.path)]);
  if (mode === "--write") {
    rmSync(tracked, { recursive: true, force: true });
    mkdirSync(tracked, { recursive: true });
    for (const source of files(result.output)) {
      const destination = join(tracked, relative(result.output, source));
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, readFileSync(source));
    }
    writeFileSync(manifestPath, expectedManifestBytes);
    writeFileSync(docsPath, expectedDocs);
  } else {
    const actualPaths = new Set(files(tracked).map((file) => relative(tracked, file)));
    if (stableJson([...actualPaths].sort()) !== stableJson([...expectedPaths].sort())) throw new Error("retained artifact set has missing or extra files");
    for (const path of expectedPaths) if (readFileSync(join(tracked, path)).compare(readFileSync(join(result.output, path))) !== 0) throw new Error(`retained artifact byte drift: ${path}`);
    if (readFileSync(manifestPath, "utf8") !== expectedManifestBytes) throw new Error("manifest byte drift");
    if (readFileSync(docsPath, "utf8") !== expectedDocs) throw new Error("documentation marker drift");
  }
  process.stdout.write(`machine-pass/HOLD_FOR_HUMAN_VISUAL_SIGN_OFF ${JSON.parse(result.report).reportDigest}\n`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
