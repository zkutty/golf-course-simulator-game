import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ZK771_INPUT_COMMIT, ZK771_INPUT_TREE, ZK771_PRODUCTION_COMMIT, ZK771_VERDICT, reportBytes, sourceBindings, validateEvidenceDescendant, validateManifest, validateReleasedProvenance } from "./zk771-certification-contract.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(new URL("../release/zk771-certification-manifest.json", import.meta.url), "utf8"));
const artifacts = Array.from({ length: 101 }, (_, index) => ({ path: `visual/evidence-${index}`, sha256: "a".repeat(64) }));
const observed = { tests: 1, passed: 1, failed: 0, matrix: 48, atlases: [9, 18], executionSha256: "b".repeat(64) };

test("ZK-771 v2 manifest binds released sources and retains the human hold", () => {
  assert.deepEqual(validateManifest(manifest), []);
  assert.deepEqual(sourceBindings(manifest, root).errors, []);
  assert.equal(manifest.humanValidation[0].machineClaim, false);
  assert.equal(manifest.humanValidation[0].status, "required");
});

test("ZK-771 v2 report bytes are deterministic and reject incomplete evidence", () => {
  const first = reportBytes(manifest, observed, artifacts, "c".repeat(64));
  assert.equal(first, reportBytes(manifest, observed, artifacts, "c".repeat(64)));
  assert.equal(JSON.parse(first).verdict, ZK771_VERDICT);
  assert.throws(() => reportBytes(manifest, { ...observed, matrix: 47 }, artifacts, "c".repeat(64)), /incomplete/);
  assert.throws(() => reportBytes(manifest, observed, artifacts.slice(1), "c".repeat(64)), /incomplete/);
  const hostile = structuredClone(manifest);
  hostile.provenance.network = "allowed";
  assert.match(validateManifest(hostile).join("\n"), /immutable provenance/);
  hostile.provenance.network = "forbidden";
  hostile.humanValidation[0].machineClaim = true;
  assert.match(validateManifest(hostile).join("\n"), /human visual gate/);
});

test("ZK-771 v2 accepts evidence descendants while rejecting immutable source-tree tampering", () => {
  const requested = [];
  const descendant = {
    exists: (ref) => { requested.push(ref); return ref === `${ZK771_INPUT_COMMIT}^{commit}`; },
    resolve: (ref) => {
      requested.push(ref);
      if (ref === `${ZK771_INPUT_COMMIT}^{tree}` || ref === `${ZK771_PRODUCTION_COMMIT}^{tree}`) return ZK771_INPUT_TREE;
      throw new Error(`unexpected ref ${ref}`);
    },
  };
  assert.deepEqual(validateReleasedProvenance(descendant), []);
  assert.equal(requested.some((ref) => ref === "HEAD" || ref.startsWith("HEAD^")), false);
  assert.match(validateReleasedProvenance({ ...descendant, resolve: (ref) => ref === `${ZK771_INPUT_COMMIT}^{tree}` ? "0".repeat(40) : ZK771_INPUT_TREE }).join("\n"), /certified input tree/);
  assert.match(validateReleasedProvenance({ ...descendant, exists: () => false }).join("\n"), /commit object/);
});

test("ZK-1134 permits an evidence-only descendant and rejects source or scope tampering", () => {
  const evidenceHead = { isAncestor: (ancestor, head) => ancestor === ZK771_INPUT_COMMIT && head === "HEAD", changed: () => ["artifacts/zk771/certification-report.json", "scripts/zk771-certify.mjs"] };
  assert.deepEqual(validateEvidenceDescendant(evidenceHead), []);
  assert.match(validateEvidenceDescendant({ ...evidenceHead, changed: (range) => range.includes("..") ? ["src/game/holeIllustration/export.ts"] : [] }).join("\n"), /out-of-scope committed/);
  assert.match(validateEvidenceDescendant({ ...evidenceHead, isAncestor: () => false }).join("\n"), /not an ancestor/);
  assert.match(validateEvidenceDescendant({ ...evidenceHead, changed: (range) => range.includes("..") ? [] : ["src/game/holeIllustration/preview.ts"] }).join("\n"), /out-of-scope working-tree/);
});
