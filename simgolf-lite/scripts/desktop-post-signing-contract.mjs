import fs from 'node:fs';

export const LIMITS = Object.freeze({ seconds: 600, parentSeconds: 660, commandMs: 60000,
  artifactBytes: 1073741824, outputBytes: 262144, reportBytes: 1048576, entries: 20000, chunkBytes: 65536 });
export class EvidenceError extends Error {
  constructor(code) { super(code); this.name = 'EvidenceError'; this.code = code; }
}
export function requireEvidence(value, code) { if (!value) throw new EvidenceError(code); }
export function safeRelative(value) {
  return typeof value === 'string' && value.length <= 512 && !/[\\\0:]/.test(value)
    && !value.startsWith('/') && value.split('/').every((p) => p && p !== '.' && p !== '..')
    && !/(?:\.part|\.heapsnapshot)$/i.test(value);
}
const schema = JSON.parse(fs.readFileSync(new URL('./desktop-post-signing.schema.json', import.meta.url), 'utf8'));
// Small explicit schema subset; unsupported schema keywords are not silently ignored.
export function validateSchema(value, rule) {
  if (rule.$ref) return validateSchema(value, schema.$defs[rule.$ref.split('/').at(-1)]);
  const allowed = ['$ref', 'type', 'properties', 'required', 'additionalProperties', 'enum', 'const', 'pattern', 'minLength', 'maxLength', 'items', 'minItems', 'maxItems', 'minimum', 'maximum'];
  requireEvidence(Object.keys(rule).every((k) => allowed.includes(k)), 'SCHEMA_UNSUPPORTED');
  if (rule.const !== undefined) requireEvidence(value === rule.const, 'SCHEMA_CONST');
  if (rule.enum) requireEvidence(rule.enum.includes(value), 'SCHEMA_ENUM');
  if (rule.type === 'object') {
    requireEvidence(value !== null && typeof value === 'object' && !Array.isArray(value), 'SCHEMA_OBJECT');
    requireEvidence(rule.required.every((k) => Object.hasOwn(value, k)), 'SCHEMA_REQUIRED');
    requireEvidence(Object.keys(value).every((k) => Object.hasOwn(rule.properties, k)), 'SCHEMA_UNKNOWN');
    for (const [k, v] of Object.entries(value)) validateSchema(v, rule.properties[k]);
  } else if (rule.type === 'array') {
    requireEvidence(Array.isArray(value) && value.length >= rule.minItems && value.length <= rule.maxItems, 'SCHEMA_ARRAY');
    for (const item of value) validateSchema(item, rule.items);
  } else if (rule.type === 'string') {
    requireEvidence(typeof value === 'string' && value.length >= (rule.minLength ?? 0) && value.length <= (rule.maxLength ?? 4096), 'SCHEMA_STRING');
    if (rule.pattern) requireEvidence(new RegExp(rule.pattern).test(value), 'SCHEMA_PATTERN');
  } else if (rule.type === 'integer') {
    requireEvidence(Number.isSafeInteger(value) && value >= rule.minimum && value <= rule.maximum, 'SCHEMA_INTEGER');
  } else if (rule.type === 'boolean') requireEvidence(typeof value === 'boolean', 'SCHEMA_BOOLEAN');
}
export function validateRequest(value) {
  validateSchema(value, schema.$defs.request);
  requireEvidence(value.artifacts.every((a) => safeRelative(a.path)) && safeRelative(value.payloadRoot), 'PATH_INVALID');
  requireEvidence(new Set(value.artifacts.map((a) => a.path)).size === value.artifacts.length, 'ARTIFACT_DUPLICATE');
  requireEvidence(value.artifacts.every((a) => value.platform === 'darwin' ? ['dmg', 'zip'].includes(a.kind) : a.kind === 'nsis'), 'ARTIFACT_PLATFORM');
  return value;
}
export const GATE_NAMES = Object.freeze(['finalHashIdentity', 'payloadMetadataIdentity', 'postSigningArchitecture',
  'platformSignature', 'publisherIdentity', 'timestampPolicy', 'notarization', 'staple', 'containerPayloadLinkage', 'nativeExecution', 'authority']);
export function row(status, reason) {
  requireEvidence(['PASS', 'FAIL', 'NOT_RUN', 'NOT_APPLICABLE'].includes(status) && /^[A-Z0-9_]{1,64}$/.test(reason), 'GATE_ROW');
  return { status, reason };
}
export function createReport(request, observations = {}) {
  validateRequest(request);
  requireEvidence(Object.keys(observations).every((k) => GATE_NAMES.includes(k)), 'OBSERVATION_UNKNOWN');
  const gates = Object.fromEntries(GATE_NAMES.map((k) => [k, row('NOT_RUN', 'UNOBSERVED')]));
  for (const [k, v] of Object.entries(observations)) {
    requireEvidence(v && Object.keys(v).length === 2 && Object.hasOwn(v, 'status') && Object.hasOwn(v, 'reason'), 'GATE_ROW');
    requireEvidence(request.domain === 'FIXTURE' || v.status !== 'PASS', 'REAL_SYNTHETIC_PASS');
    gates[k] = row(v.status, v.reason);
  }
  if (request.platform === 'win32') {
    gates.notarization = row('NOT_APPLICABLE', 'WINDOWS_POLICY'); gates.staple = row('NOT_APPLICABLE', 'WINDOWS_POLICY');
  }
  // No input path, boolean, fixture or tool output can authenticate these absent producers.
  gates.containerPayloadLinkage = row('NOT_RUN', 'AUTHENTICATED_CONTAINER_PRODUCER_ABSENT');
  gates.nativeExecution = row('NOT_RUN', 'AUTHENTICATED_DEVICE_PRODUCER_ABSENT');
  gates.authority = row('NOT_RUN', 'AUTHORITY_PRODUCER_ABSENT');
  const report = { schemaVersion: 1, phase: 'POST_SIGNING', domain: request.domain,
    platform: request.platform, candidateCommit: request.candidateCommit, packageVersion: request.packageVersion,
    overall: request.domain === 'FIXTURE' ? 'FIXTURE_ONLY' : 'INCOMPLETE', certificationEligible: false,
    policyQualification: 'DECLARED_EXPECTATIONS_NOT_AUTHENTICATED_AUTHORITY',
    declaredArtifacts: request.artifacts.map((a) => ({ ...a })), observedArtifacts: [], gates };
  validateSchema(report, schema.$defs.report);
  return report;
}
export function parseWindowsMetadata(raw) {
  let value;
  try { value = JSON.parse(raw); } catch { throw new EvidenceError('VERIFIER_JSON'); }
  requireEvidence(value && Object.keys(value).sort().join(',') === 'signatureType,signerThumbprint,status,timestampThumbprint', 'VERIFIER_SHAPE');
  requireEvidence(value.status === 'Valid' && value.signatureType === 'Authenticode', 'AUTHENTICODE_INVALID');
  requireEvidence(/^[A-F0-9]{40}$/.test(value.signerThumbprint) && /^[A-F0-9]{40}$/.test(value.timestampThumbprint), 'AUTHENTICODE_IDENTITY');
  return value;
}
export function parseMacMetadata(raw) {
  const one = (key) => {
    const values = raw.split(/\r?\n/).filter((l) => l.startsWith(key + '=')).map((l) => l.slice(key.length + 1));
    requireEvidence(values.length === 1, 'MAC_METADATA_AMBIGUOUS'); return values[0];
  };
  const team = one('TeamIdentifier');
  requireEvidence(/^[A-Z0-9]{10}$/.test(team) && /(?:^|\n)Authority=Developer ID Application:/.test(raw), 'MAC_IDENTITY');
  requireEvidence(/flags=0x[0-9a-f]+\([^\n)]*runtime[^\n)]*\)/i.test(raw), 'MAC_RUNTIME');
  requireEvidence(one('Timestamp').length > 0, 'MAC_TIMESTAMP');
  return { team };
}
export function assertDispatch(env) {
  requireEvidence(env.EVENT_NAME === 'workflow_dispatch' && env.ENABLED === 'true', 'WORKFLOW_DISABLED');
  requireEvidence(/^[0-9a-f]{40}$/.test(env.CANDIDATE ?? '') && env.CANDIDATE === env.EXPECTED_COMMIT, 'WORKFLOW_CANDIDATE');
  requireEvidence(/^[1-9][0-9]{0,19}$/.test(env.ARTIFACT_RUN_ID ?? ''), 'WORKFLOW_ARTIFACT_RUN');
  // Environment settings still need external root verification; this is not authority.
}

export function validateObservedRows(request, rows) {
  validateRequest(request);
  validateSchema(rows, schema.$defs.report.properties.observedArtifacts);
  requireEvidence(rows.length === request.artifacts.length, 'OBSERVED_COUNT');
  requireEvidence(new Set(rows.map((a) => a.path)).size === rows.length, 'OBSERVED_DUPLICATE');
  for (const actual of rows) {
    const declared = request.artifacts.find((a) => a.path === actual.path);
    requireEvidence(declared && ['path', 'kind', 'bytes', 'sha256'].every((key) => actual[key] === declared[key]), 'OBSERVED_IDENTITY');
  }
  return rows.map((a) => ({ ...a }));
}
export function validateReport(report) { validateSchema(report, schema.$defs.report); }
