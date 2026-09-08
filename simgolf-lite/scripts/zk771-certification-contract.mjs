import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const ZK771_CERTIFICATION_ID = "zk771-hole-illustration-machine-certification-v2";
export const ZK771_VERDICT = "machine-pass/HOLD_FOR_HUMAN_VISUAL_SIGN_OFF";
export const ZK771_INPUT_COMMIT = "c3eb15b0caee5ea548b076c1553993795bd70505";
export const ZK771_PRODUCTION_COMMIT = "94683b";
export const ZK771_INPUT_TREE = "f9cfc17e19f43f3afbf5e3712df37c6c00c28d88";
export const ZK1134_ALLOWED_PATHS = [
  "artifacts/zk771/",
  "docs/ZK771_CERTIFICATION.md",
  "release/zk771-certification-manifest.json",
  "scripts/zk771-certify.mjs",
  "scripts/zk771-certification-contract.mjs",
  "scripts/zk771-certification-contract.test.mjs",
];
export const ZK771_SOURCES = [
  "scripts/zk771-certification-contract.mjs",
  "scripts/zk771-certify.mjs",
  "src/game/testing/zk771HoleIllustrationFixtures.ts",
  "src/game/testing/zk771HoleIllustrationCertification.test.ts",
  "src/game/holeIllustration/export.ts",
  "package-lock.json",
];

export const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, stable(nested)])) : value;
export const stableJson = (value) => JSON.stringify(stable(value));
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function exactKeys(value, keys, label, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value) || stableJson(Object.keys(value).sort()) !== stableJson([...keys].sort())) errors.push(`${label} keys do not match the contract`);
}

export function validateManifest(manifest) {
  const errors = [];
  exactKeys(manifest, ["schemaVersion", "certificationId", "issue", "provenance", "toolchain", "sources", "humanValidation", "limitations", "retainedArtifacts", "documentation"], "manifest", errors);
  if (manifest?.schemaVersion !== 2 || manifest?.certificationId !== ZK771_CERTIFICATION_ID || manifest?.issue !== "ZK-771") errors.push("manifest identity is invalid");
  exactKeys(manifest?.provenance, ["inputCommit", "productionCommit", "inputTree", "network", "generation"], "provenance", errors);
  if (manifest?.provenance?.inputCommit !== ZK771_INPUT_COMMIT || manifest?.provenance?.productionCommit !== ZK771_PRODUCTION_COMMIT || manifest?.provenance?.inputTree !== ZK771_INPUT_TREE || manifest?.provenance?.network !== "forbidden" || manifest?.provenance?.generation !== "local-deterministic") errors.push("immutable provenance is invalid");
  exactKeys(manifest?.toolchain, ["rasterizer", "sharpVersion", "hash", "svg", "png"], "toolchain", errors);
  if (manifest?.toolchain?.rasterizer !== "sharp-local" || manifest?.toolchain?.sharpVersion !== "0.35.2" || manifest?.toolchain?.hash !== "sha256" || manifest?.toolchain?.svg !== "renderer-final-svg" || manifest?.toolchain?.png !== "sharp-rasterized-final-svg") errors.push("toolchain contract is invalid");
  if (!Array.isArray(manifest?.sources) || stableJson(manifest.sources.map((entry) => entry.path).sort()) !== stableJson([...ZK771_SOURCES].sort()) || !manifest.sources.every((entry) => typeof entry.path === "string" && /^[0-9a-f]{64}$/.test(entry.sha256 ?? ""))) errors.push("source bindings are invalid");
  if (!Array.isArray(manifest?.humanValidation) || manifest.humanValidation.length !== 1 || stableJson(manifest.humanValidation[0]) !== stableJson({ gate: "human-visual-sign-off", machineClaim: false, status: "required" })) errors.push("human visual gate must remain pending");
  if (!Array.isArray(manifest?.limitations) || !manifest.limitations.includes("No human originality, visual hierarchy, or biome-cohesion judgment is claimed by this machine packet.")) errors.push("human visual limitation is missing");
  if (!Array.isArray(manifest?.retainedArtifacts) || !manifest.retainedArtifacts.every((entry) => typeof entry.path === "string" && /^[0-9a-f]{64}$/.test(entry.sha256 ?? ""))) errors.push("retained artifact bindings are invalid");
  if (manifest?.documentation?.path !== "docs/ZK771_CERTIFICATION.md") errors.push("documentation binding is invalid");
  return errors;
}

export function sourceBindings(manifest, root) {
  const errors = validateManifest(manifest);
  const actual = [];
  for (const path of ZK771_SOURCES) {
    const expected = manifest.sources?.find((entry) => entry.path === path)?.sha256;
    const file = resolve(root, path);
    if (!existsSync(file)) { errors.push(`missing source: ${path}`); continue; }
    const digest = sha256(readFileSync(file));
    actual.push({ path, sha256: digest });
    if (expected !== digest) errors.push(`source SHA-256 mismatch: ${path}`);
  }
  return { errors, actual };
}

/** Validates immutable released objects without constraining the current checkout to that historical commit. */
export function validateReleasedProvenance(git) {
  const errors = [];
  if (!git.exists(`${ZK771_INPUT_COMMIT}^{commit}`)) errors.push("certified input commit object is unavailable");
  if (git.resolve(`${ZK771_INPUT_COMMIT}^{tree}`) !== ZK771_INPUT_TREE) errors.push("certified input tree drifted");
  if (git.resolve(`${ZK771_PRODUCTION_COMMIT}^{tree}`) !== ZK771_INPUT_TREE) errors.push("production tree is not identical to the certified input tree");
  return errors;
}

const allowedZk1134Path = (path) => ZK1134_ALLOWED_PATHS.some((allowed) => allowed.endsWith("/") ? path.startsWith(allowed) : path === allowed);

/** A committed evidence descendant is valid; any product/input-tree mutation is not. */
export function validateEvidenceDescendant(git) {
  const errors = [];
  if (!git.isAncestor(ZK771_INPUT_COMMIT, "HEAD")) errors.push("certified input commit is not an ancestor of HEAD");
  for (const path of git.changed(`${ZK771_INPUT_COMMIT}..HEAD`)) if (!allowedZk1134Path(path)) errors.push(`out-of-scope committed change: ${path}`);
  for (const path of git.changed(ZK771_INPUT_COMMIT)) if (!allowedZk1134Path(path)) errors.push(`out-of-scope working-tree change: ${path}`);
  return errors;
}

export function reportBytes(manifest, observed, artifacts, visualManifestSha256) {
  if (observed?.tests !== 1 || observed?.passed !== 1 || observed?.failed !== 0 || observed?.matrix !== 48 || stableJson(observed?.atlases) !== stableJson([9, 18])) throw new Error("observed certification evidence is incomplete");
  if (!Array.isArray(artifacts) || artifacts.length !== 101 || !artifacts.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256 ?? ""))) throw new Error("retained artifact evidence is incomplete");
  if (!/^[0-9a-f]{64}$/.test(visualManifestSha256 ?? "")) throw new Error("visual artifact index is incomplete");
  const report = {
    schemaVersion: 2,
    certificationId: ZK771_CERTIFICATION_ID,
    issue: "ZK-771",
    verdict: ZK771_VERDICT,
    provenance: manifest.provenance,
    toolchain: manifest.toolchain,
    observed,
    retainedArtifacts: artifacts,
    visualManifestSha256,
    humanValidation: manifest.humanValidation,
    limitations: manifest.limitations,
  };
  return `${stableJson({ ...report, reportDigest: sha256(`${stableJson(report)}\n`) })}\n`;
}
