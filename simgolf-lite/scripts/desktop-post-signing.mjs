import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { LIMITS, EvidenceError, requireEvidence, safeRelative, validateRequest, createReport, validateObservedRows, validateReport } from './desktop-post-signing-contract.mjs';

export function confined(root, relative) {
  requireEvidence(safeRelative(relative), 'PATH_INVALID');
  const base = fs.realpathSync(root);
  const target = fs.realpathSync(path.join(base, relative));
  requireEvidence(target.startsWith(base + path.sep), 'PATH_ESCAPE');
  requireEvidence(fs.statSync(target).isFile(), 'ARTIFACT_NOT_FILE');
  return target;
}
export function hashArtifact(file, budget, deadline, now = Date.now) {
  const fd = fs.openSync(file, 'r');
  let primary;
  let failed = false;
  try {
    const before = fs.fstatSync(fd);
    requireEvidence(before.isFile(), 'ARTIFACT_NOT_FILE');
    requireEvidence(before.size > 0 && before.size <= budget.remaining, 'ARTIFACT_CAP');
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.alloc(LIMITS.chunkBytes);
    let bytes = 0;
    for (;;) {
      requireEvidence(now() < deadline, 'GLOBAL_DEADLINE');
      const count = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!count) break;
      bytes += count;
      requireEvidence(bytes <= before.size && bytes <= budget.remaining, 'ARTIFACT_CHANGED');
      hash.update(buffer.subarray(0, count));
    }
    const after = fs.fstatSync(fd);
    requireEvidence(bytes === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs, 'ARTIFACT_CHANGED');
    budget.remaining -= bytes;
    return { bytes, sha256: hash.digest('hex') };
  } catch (error) { failed = true; primary = error; }
  finally { try { fs.closeSync(fd); } catch (error) { if (!failed) { failed = true; primary = error; } } }
  if (failed) throw primary;
}
export function verifySupplied(request, root, { now = Date.now } = {}) {
  validateRequest(request);
  const deadline = now() + LIMITS.seconds * 1000;
  const budget = { remaining: LIMITS.artifactBytes };
  const observed = [];
  for (const artifact of request.artifacts) {
    const actual = hashArtifact(confined(root, artifact.path), budget, deadline, now);
    requireEvidence(actual.bytes === artifact.bytes && actual.sha256 === artifact.sha256, 'ARTIFACT_IDENTITY');
    observed.push({ path: artifact.path, kind: artifact.kind, bytes: actual.bytes, sha256: actual.sha256 });
  }
  // Staged roots, caller claims and fixture tool output cannot authenticate extraction or execution.
  const report = createReport(request);
  report.observedArtifacts = validateObservedRows(request, observed);
  report.gates.finalHashIdentity = { status: 'PASS', reason: 'FULL_CONTAINER_BYTES_MATCH_DECLARATION' };
  validateReport(report);
  return report;
}
export function publish(report, output) {
  validateReport(report);
  const encoded = JSON.stringify(report) + '\n';
  requireEvidence(Buffer.byteLength(encoded) < LIMITS.reportBytes, 'REPORT_CAP');
  const fd = fs.openSync(output, 'wx', 0o600);
  let failed = false;
  let primary;
  try { fs.writeFileSync(fd, encoded); fs.fsyncSync(fd); }
  catch (error) { failed = true; primary = error; }
  finally { try { fs.closeSync(fd); } catch (error) { if (!failed) { failed = true; primary = error; } } }
  if (failed) throw primary;
}
export function main(argv) {
  requireEvidence(argv.length === 8 && argv[0] === '--request' && argv[2] === '--artifact-root' && argv[4] === '--out' && argv[6] === '--candidate', 'CLI_ARGUMENTS');
  const requestFile = argv[1];
  requireEvidence(!/\.(part|heapsnapshot)$/i.test(requestFile), 'PATH_INVALID');
  requireEvidence(fs.statSync(requestFile).size <= LIMITS.reportBytes, 'REQUEST_CAP');
  const request = validateRequest(JSON.parse(fs.readFileSync(requestFile, 'utf8')));
  requireEvidence(request.domain === 'REAL', 'CLI_FIXTURE_FORBIDDEN');
  requireEvidence(request.candidateCommit === argv[7] && process.env.GITHUB_SHA === argv[7] && process.env.VITE_COMMIT_SHA === argv[7], 'CANDIDATE_BINDING');
  publish(verifySupplied(request, argv[3]), argv[5]);
  return 2; // Preparatory evidence can never complete ZK388.
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(JSON.stringify({ status: 'INCOMPLETE', code: error instanceof EvidenceError ? error.code : 'VERIFIER_FAILURE' }) + '\n'); process.exitCode = 2; }
}
