import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createReport, validateRequest, validateObservedRows, parseWindowsMetadata, parseMacMetadata } from './desktop-post-signing-contract.mjs';
import { verifySupplied, hashArtifact, publish, main } from './desktop-post-signing.mjs';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const request = () => ({ schemaVersion: 1, phase: 'POST_SIGNING', domain: 'REAL', platform: 'win32', candidateCommit: 'a'.repeat(40), packageVersion: '1.0.0', artifacts: [{ path: 'input.exe', kind: 'nsis', bytes: 3, sha256: sha('abc') }], payloadRoot: 'payload', expectedPublisherIds: ['B'.repeat(40)] });
function temporary(fn) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'post-signing-fixture-')); try { return fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); } }
test('1 strict domain/schema rejects caller completion and locks absent producers', () => {
  const r = request(); assert.throws(() => validateRequest({ ...r, completed: true })); assert.throws(() => validateRequest({ ...r, phase: 'PRE_SIGNING' }));
  assert.throws(() => createReport(r, { authority: { status: 'PASS', reason: 'CALLER' } }), /REAL_SYNTHETIC_PASS/);
  assert.throws(() => createReport(r, { finalHashIdentity: { status: 'PASS', reason: 'CALLER' } }), /REAL_SYNTHETIC_PASS/);
  const report = createReport(r);
  assert.deepEqual(report.declaredArtifacts, r.artifacts);
  assert.deepEqual(report.observedArtifacts, []);
  assert.equal(report.gates.finalHashIdentity.status, 'NOT_RUN');
  assert.equal(report.overall, 'INCOMPLETE'); assert.equal(report.certificationEligible, false); assert.equal(report.gates.authority.status, 'NOT_RUN');
  assert.equal(createReport({ ...r, domain: 'FIXTURE' }).overall, 'FIXTURE_ONLY');
});
test('2 full artifact bytes, aggregate cap and confinement reject tampering', () => temporary((root) => {
  fs.writeFileSync(path.join(root, 'input.exe'), 'abc');
  const report = verifySupplied(request(), root);
  assert.equal(report.gates.finalHashIdentity.status, 'PASS');
  assert.deepEqual(report.observedArtifacts, request().artifacts);
  for (const rows of [[], [...request().artifacts, ...request().artifacts],
    [{ ...request().artifacts[0], path: 'other.exe' }],
    [{ ...request().artifacts[0], sha256: '0'.repeat(64) }],
    [{ ...request().artifacts[0], extra: true }], [{ path: 'input.exe' }]]) {
    assert.throws(() => validateObservedRows(request(), rows));
  }
  fs.writeFileSync(path.join(root, 'input.exe'), 'abd'); assert.throws(() => verifySupplied(request(), root), /ARTIFACT_IDENTITY/);
  assert.throws(() => validateRequest({ ...request(), artifacts: [{ ...request().artifacts[0], path: '../escape' }] }));
  assert.throws(() => hashArtifact(path.join(root, 'input.exe'), { remaining: 2 }, Date.now() + 1000), /ARTIFACT_CAP/);
}));
test('3 structured signature fixtures reject unsigned, ambiguous and incomplete metadata', () => {
  const valid = { status: 'Valid', signatureType: 'Authenticode', signerThumbprint: 'A'.repeat(40), timestampThumbprint: 'B'.repeat(40) };
  assert.equal(parseWindowsMetadata(JSON.stringify(valid)).status, 'Valid');
  for (const changed of [{ ...valid, status: 'NotSigned' }, { ...valid, timestampThumbprint: '' }, { ...valid, extra: 'claim' }]) assert.throws(() => parseWindowsMetadata(JSON.stringify(changed)));
  const mac = 'TeamIdentifier=ABCDEFGHIJ\nAuthority=Developer ID Application: Fixture\nflags=0x10000(runtime)\nTimestamp=Fixture\n';
  assert.equal(parseMacMetadata(mac).team, 'ABCDEFGHIJ'); assert.throws(() => parseMacMetadata(mac + 'TeamIdentifier=ABCDEFGHIJ\n')); assert.throws(() => parseMacMetadata(mac.replace('runtime', 'adhoc')));
});
test('4 declared payload and positive container hash never establish architecture/native linkage', () => {
  assert.throws(() => createReport(request(), { postSigningArchitecture: { status: 'PASS', reason: 'FIXTURE' } }), /REAL_SYNTHETIC_PASS/);
  const report = createReport({ ...request(), domain: 'FIXTURE' }, { postSigningArchitecture: { status: 'PASS', reason: 'FIXTURE' }, nativeExecution: { status: 'PASS', reason: 'CALLER' }, containerPayloadLinkage: { status: 'PASS', reason: 'CALLER' } });
  assert.equal(report.gates.containerPayloadLinkage.status, 'NOT_RUN'); assert.equal(report.gates.nativeExecution.status, 'NOT_RUN'); assert.equal(report.overall, 'FIXTURE_ONLY');
});
test('5 expired budget, exclusive publication and CLI fixture rejection fail closed', () => temporary((root) => {
  const file = path.join(root, 'input.exe'); fs.writeFileSync(file, 'abc'); assert.throws(() => hashArtifact(file, { remaining: 3 }, 5, () => 5), /GLOBAL_DEADLINE/);
  const out = path.join(root, 'report.json'); publish(createReport(request()), out); const original = fs.readFileSync(out); assert.throws(() => publish(createReport(request()), out)); assert.deepEqual(fs.readFileSync(out), original);
  const input = path.join(root, 'request.json'); fs.writeFileSync(input, JSON.stringify({ ...request(), domain: 'FIXTURE' })); assert.throws(() => main(['--request', input, '--artifact-root', root, '--out', out, '--candidate', 'a'.repeat(40)]), /CLI_FIXTURE_FORBIDDEN/);
}));
