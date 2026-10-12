import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  GOLDEN_CASES, VISION_CASES, sha256, verifyCases, verifyReports, safeExtract,
  inventory, verifyInventory, verifyRun, selectRun, verifyJobs, artifactSet,
  verifyDigest, GitHub, verifyReceipt, debugBindings, verifySentryLog, sourcePins, PIN_PATHS, m65Binding, initialBuild,
} from './promote-dist.mjs';
const copy = value => structuredClone(value);
const ctx = { sha: 'a'.repeat(40), repository: 'owner/game', runID: 17 };
const run = { id: 17, head_sha: ctx.sha, repository: { full_name: ctx.repository }, head_repository: { full_name: ctx.repository }, path: '.github/workflows/ci.yml', head_branch: 'develop', event: 'push', run_attempt: 1, status: 'completed', conclusion: 'success' };
const goodReport = count => ({ stats: { total: count, expected: count, skipped: 0, unexpected: 0, flaky: 0 }, errors: [] });
const goodCases = expected => expected.map(c => ({ ...c, outcome: 'expected', results: [{ status: 'passed', retry: 0, errors: [] }] }));
function temporary(t) { const root = mkdtempSync(join(tmpdir(), 'promote-dist-test-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }
function zip(root, entries, name = 'fixture.zip') {
  const output = join(root, name);
  execFileSync('python3', ['-c', `import json,sys,zipfile,stat\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n for entry in json.loads(sys.argv[2]):\n  i=zipfile.ZipInfo(entry['name']);i.external_attr=(stat.S_IFLNK|0o777)<<16 if entry.get('symlink') else 0\n  z.writestr(i,entry['data'])`, output, JSON.stringify(entries)], { timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] });
  return output;
}
function reports(root) {
  const goldenCases = goodCases(GOLDEN_CASES);
  const report = { ...goodReport(12), files: [{ fileId: 'golden' }] };
  const htmlZIP = zip(root, [{ name: 'report.json', data: JSON.stringify(report) }, { name: 'golden.json', data: JSON.stringify({ tests: goldenCases.map(c => ({ ...c, location: { file: c.file }, projectName: c.project })) }) }]);
  const golden = join(root, 'golden.html'); writeFileSync(golden, `<script>data:application/zip;base64,${readFileSync(htmlZIP).toString('base64')}</script>`);
  const vision = { ...goodReport(8), suites: [{ specs: goodCases(VISION_CASES).map(c => ({ file: c.file, title: c.title, ok: true, tests: [{ projectName: '', expectedStatus: 'passed', status: 'expected', timeout: 60000, results: c.results }] })) }] };
  const visionPath = join(root, 'vision.json'); writeFileSync(visionPath, JSON.stringify(vision)); return { golden, visionPath, vision };
}
test('exact 12 and 8 identities each passed once are accepted', () => {
  for (const expected of [GOLDEN_CASES, VISION_CASES]) assert.equal(verifyCases(goodReport(expected.length), goodCases(expected), expected).cases, expected.length);
});
for (const [label, mutate] of [
  ['retry', c => { c.results[0].retry = 1; }], ['flaky', c => { c.outcome = 'flaky'; }],
  ['skipped', c => { c.results[0].status = 'skipped'; }], ['failed', c => { c.results[0].status = 'failed'; }],
  ['multiple attempts', c => { c.results.push(copy(c.results[0])); }], ['error', c => { c.results[0].errors.push({ message: 'failure' }); }],
  ['wrong file', c => { c.file = 'replacement.e2e.ts'; }], ['wrong title', c => { c.title = 'replacement'; }],
  ['wrong project', c => { c.project = 'replacement'; }],
]) test(`report rejects ${label}`, () => { const cases = goodCases(GOLDEN_CASES); mutate(cases[0]); assert.throws(() => verifyCases(goodReport(12), cases, GOLDEN_CASES)); });
for (const key of ['skipped', 'unexpected', 'flaky', 'expected', 'total']) test(`report rejects incorrect aggregate ${key}`, () => {
  const r = goodReport(12); r.stats[key]++; assert.throws(() => verifyCases(r, goodCases(GOLDEN_CASES), GOLDEN_CASES));
});
test('report rejects global errors, missing and duplicate cases', () => {
  const r = goodReport(12); r.errors.push({ message: 'global' }); assert.throws(() => verifyCases(r, goodCases(GOLDEN_CASES), GOLDEN_CASES));
  const cases = goodCases(GOLDEN_CASES); assert.throws(() => verifyCases(goodReport(12), cases.slice(1), GOLDEN_CASES));
  cases[0] = copy(cases[1]); assert.throws(() => verifyCases(goodReport(12), cases, GOLDEN_CASES));
});
test('real HTML embedded ZIP and narrative JSON parser recomputes verdicts', t => {
  const paths = reports(temporary(t)); assert.equal(verifyReports(paths.golden, paths.visionPath).golden.cases, 12);
  paths.vision.suites[0].specs[0].tests[0].results[0].retry = 1;
  writeFileSync(paths.visionPath, JSON.stringify(paths.vision)); assert.throws(() => verifyReports(paths.golden, paths.visionPath));
});
for (const [label, mutate] of [
  ['wrong SHA', r => { r.head_sha = 'b'.repeat(40); }], ['attempt two', r => { r.run_attempt = 2; }],
  ['foreign repository', r => { r.repository.full_name = 'other/game'; }], ['foreign head repository', r => { r.head_repository.full_name = 'other/game'; }],
  ['wrong workflow', r => { r.path = '.github/workflows/other.yml'; }], ['wrong branch', r => { r.head_branch = 'main'; }],
  ['pull request', r => { r.event = 'pull_request'; }], ['unfinished', r => { r.status = 'in_progress'; }],
  ['unsuccessful', r => { r.conclusion = 'failure'; }], ['invalid ID', r => { r.id = -1; }],
]) test(`run rejects ${label}`, () => { const r = copy(run); mutate(r); assert.throws(() => verifyRun(r, ctx)); });
test('selection has no latest or stale fallback and rejects ambiguity', () => {
  assert.equal(selectRun([run], ctx).id, run.id);
  for (const runs of [[], [run, { ...run, id: 18 }], [{ ...run, head_sha: 'b'.repeat(40) }], [{ ...run, run_attempt: 2 }], [{ ...run, status: 'in_progress' }]]) assert.throws(() => selectRun(runs, ctx));
});
const build = { name: 'Build', status: 'completed', conclusion: 'success', started_at: '2026-10-12T19:33:00.000Z', completed_at: '2026-10-12T19:34:00.000Z' };
const jobs = [
  { id: 31, name: 'Typecheck, lint, test, build', run_id: 17, head_sha: ctx.sha, status: 'completed', conclusion: 'success', steps: [build] },
  { id: 32, name: 'Deploy tested artifact to Cloudflare playtest', run_id: 17, head_sha: ctx.sha, status: 'completed', conclusion: 'success', steps: [] },
];
test('CI and completed development deployment plus Build step are mandatory', () => {
  assert.equal(verifyJobs(jobs, run).id, 31);
  for (const mutate of [j => j.pop(), j => { j[1].conclusion = 'failure'; }, j => { j[0].run_id = 18; }, j => { j[0].steps[0].conclusion = 'failure'; }, j => j.push(copy(j[0]))]) {
    const j = copy(jobs); mutate(j); assert.throws(() => verifyJobs(j, run));
  }
});
const artifact = { id: 41, name: 'dist', expired: false, expires_at: '2099-01-01T00:00:00Z', digest: `sha256:${'a'.repeat(64)}`, size_in_bytes: 30, workflow_run: { id: 17, head_sha: ctx.sha, head_branch: 'develop' } };
for (const [label, mutate] of [
  ['expiry', a => { a.expires_at = '2000-01-01'; }], ['expired flag', a => { a.expired = true; }],
  ['missing digest', a => { delete a.digest; }], ['bad digest', a => { a.digest = 'md5:x'; }], ['wrong run', a => { a.workflow_run.id = 18; }],
  ['wrong artifact SHA', a => { a.workflow_run.head_sha = 'b'.repeat(40); }], ['wrong branch', a => { a.workflow_run.head_branch = 'main'; }],
  ['invalid ID', a => { a.id = 0; }], ['empty archive', a => { a.size_in_bytes = 0; }],
]) test(`artifact rejects ${label}`, () => { const a = copy(artifact); mutate(a); assert.throws(() => artifactSet([a], ['dist'], run)); });
test('artifacts require exact unique names and distinct IDs', () => {
  assert.equal(artifactSet([artifact], ['dist'], run).dist.id, 41);
  for (const list of [[], [artifact, copy(artifact)]]) assert.throws(() => artifactSet(list, ['dist'], run));
  assert.throws(() => artifactSet([artifact, { ...artifact, name: 'receipt' }], ['dist', 'receipt'], run));
});
test('download SHA256 must exactly match immutable GitHub ZIP digest', () => {
  const bytes = Buffer.from('archive'); verifyDigest(bytes, `sha256:${sha256(bytes)}`);
  assert.throws(() => verifyDigest(Buffer.from('changed'), `sha256:${sha256(bytes)}`));
});
for (const [label, entries] of [
  ['traversal', [{ name: '../outside', data: 'x' }]], ['absolute path', [{ name: '/outside', data: 'x' }]],
  ['Windows absolute', [{ name: 'C:/outside', data: 'x' }]], ['backslash path', [{ name: 'dir\\outside', data: 'x' }]],
  ['duplicate path', [{ name: 'same', data: 'a' }, { name: 'same', data: 'b' }]],
  ['symlink', [{ name: 'link', data: '../outside', symlink: true }]],
]) test(`ZIP rejects ${label} before extraction`, t => {
  const root = temporary(t); const archive = zip(root, entries); assert.throws(() => safeExtract(archive, join(root, 'output')));
  assert.throws(() => readFileSync(join(root, 'output', 'same')));
});
test('safe ZIP extraction preserves raw bytes', t => {
  const root = temporary(t); safeExtract(zip(root, [{ name: 'assets/a.js', data: 'raw\n' }]), join(root, 'output'));
  assert.equal(readFileSync(join(root, 'output/assets/a.js'), 'utf8'), 'raw\n');
});
for (const mutation of ['changed', 'missing', 'extra', 'hidden', 'symlink']) test(`published inventory rejects ${mutation} files`, t => {
  const root = temporary(t); writeFileSync(join(root, 'index.html'), 'original'); const expected = inventory(root);
  if (mutation === 'changed') writeFileSync(join(root, 'index.html'), 'different');
  if (mutation === 'missing') rmSync(join(root, 'index.html'));
  if (mutation === 'extra') writeFileSync(join(root, 'extra.js'), 'extra');
  if (mutation === 'hidden') writeFileSync(join(root, '.hidden'), 'extra');
  if (mutation === 'symlink') symlinkSync('index.html', join(root, 'link'));
  assert.throws(() => verifyInventory(root, expected));
});
test('only known Vite audit manifest may be unpublished', t => {
  const root = temporary(t); writeFileSync(join(root, 'index.html'), 'original'); mkdirSync(join(root, '.vite'));
  writeFileSync(join(root, '.vite/manifest.json'), '{}'); assert.equal(inventory(root, true).length, 1);
  assert.throws(() => inventory(root)); writeFileSync(join(root, '.vite/other'), 'x'); assert.throws(() => inventory(root, true));
});
test('receipt recomputes source, M65, reports, raw files and artifact IDs instead of trusting booleans', () => {
  const pins = { source: 'a'.repeat(64) }, reports = { passed: true, hash: 'b'.repeat(64) }, m65 = { rawSHA256: 'c'.repeat(64) }, files = [{ path: 'index.html', bytes: 1, sha256: 'd'.repeat(64) }], artifacts = { dist: { id: 41, digest: artifact.digest } };
  const receipt = { schema: 1, ...ctx, workflow: '.github/workflows/ci.yml', attempt: 1, branch: 'develop', event: 'push', sourcePins: pins, reports, m65, files, artifacts };
  verifyReceipt(receipt, ctx, pins, reports, m65, files, artifacts);
  for (const key of ['sha', 'runID', 'attempt', 'sourcePins', 'reports', 'm65', 'files', 'artifacts']) {
    const r = copy(receipt); r[key] = null; assert.throws(() => verifyReceipt(r, ctx, pins, reports, m65, files, artifacts));
  }
  const r = copy(receipt); r.artifacts.dist.id = 42; assert.throws(() => verifyReceipt(r, ctx, pins, reports, m65, files, artifacts));
});
test('API pagination exhausts all pages and accounts for every ID', async () => {
  const responses = [{ total_count: 101, items: Array.from({ length: 100 }, (_, i) => ({ id: i + 1 })) }, { total_count: 101, items: [{ id: 101 }] }];
  const api = new GitHub('owner/game', 'ephemeral', async () => ({ ok: true, json: async () => responses.shift() }));
  assert.equal((await api.pages('/items', 'items')).length, 101);
});
for (const data of [{ total_count: 1000, items: [] }, { total_count: 3, items: [{ id: 1 }] }, { total_count: 2, items: [{ id: 1 }, { id: 1 }] }]) test('API pagination rejects truncated, capped or duplicate evidence', async () => {
  const api = new GitHub('owner/game', 'ephemeral', async () => ({ ok: true, json: async () => data }));
  await assert.rejects(api.pages('/items', 'items'));
});
test('artifact download pins ID, validates digest and never sends token to storage', async t => {
  const root = temporary(t), bytes = readFileSync(zip(root, [{ name: 'index.html', data: 'raw' }], 'download.zip'));
  const requests = [];
  const api = new GitHub('owner/game', 'sensitive-test-token', async (url, options) => {
    requests.push({ url, options });
    if (requests.length === 1) return { status: 302, headers: new Headers({ location: 'https://storage.example/signed' }) };
    return new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
  });
  await api.download(41, `sha256:${sha256(bytes)}`, join(root, 'fetched.zip'), join(root, 'output'));
  assert.equal(requests[0].url, 'https://api.github.com/repos/owner/game/actions/artifacts/41/zip');
  assert.equal(requests[0].options.redirect, 'manual'); assert.match(requests[0].options.headers.Authorization, /sensitive-test-token/);
  assert.equal(requests[1].options.headers, undefined); assert.equal(requests[1].options.redirect, 'error');
  assert.equal(readFileSync(join(root, 'output/index.html'), 'utf8'), 'raw');
});
test('incorrect download digest blocks before extracting deployment assets', async t => {
  const root = temporary(t), bytes = readFileSync(zip(root, [{ name: 'index.html', data: 'raw' }])); let count = 0;
  const api = new GitHub('owner/game', 'ephemeral', async () => ++count === 1 ? { status: 302, headers: new Headers({ location: 'https://storage.example/signed' }) } : new Response(bytes, { headers: { 'content-length': String(bytes.length) } }));
  await assert.rejects(api.download(41, artifact.digest, join(root, 'download.zip'), join(root, 'deploy')));
  assert.throws(() => readFileSync(join(root, 'deploy/index.html')));
});
const debugID = '11111111-2222-3333-4444-555555555555';
const release = `coursecraft@1.0.0+${ctx.sha.slice(0, 12)}`;
const log = Buffer.from(`2026-10-12T19:33:30.000Z > Upload type: artifact bundle\n2026-10-12T19:33:30.000Z > Release: ${release}\n2026-10-12T19:33:30.000Z ~/x.js.map (debug id ${debugID})\n2026-10-12T19:33:30.000Z [sentry-vite-plugin] Info: Successfully uploaded source maps to Sentry\n`);
test('Sentry provenance binds masked log digest, Build window, release and uploaded debug UUID', () => {
  const bindings = [{ path: 'assets/a.js', debugID }]; assert.equal(verifySentryLog(log, jobs[0], release, bindings).rawLogSHA256, sha256(log));
  for (const bad of [log.toString().replace('Successfully uploaded', 'Upload failed'), log.toString().replace(debugID, 'other'), log.toString().replaceAll('19:33:30', '20:00:00'), log.toString().replace(release, 'other-release')]) assert.throws(() => verifySentryLog(Buffer.from(bad), jobs[0], release, bindings));
});
test('Sentry debug IDs required in every main bundle, maps cannot publish', t => {
  const root = temporary(t); mkdirSync(join(root, 'assets')); writeFileSync(join(root, 'assets/a.js'), `sentry-dbid-${debugID}`);
  assert.equal(debugBindings(root)[0].debugID, debugID); writeFileSync(join(root, 'assets/a.js'), 'missing'); assert.throws(() => debugBindings(root));
  writeFileSync(join(root, 'assets/a.js'), `sentry-dbid-${debugID}`); writeFileSync(join(root, 'assets/a.js.map'), '{}'); assert.throws(() => debugBindings(root));
});
test('mandatory report CLI fails before the workflow deploy gate on retried results', t => {
  const root = temporary(t); const paths = reports(root); mkdirSync(join(root, 'playwright-report')); mkdirSync(join(root, 'vision-player-career-report'));
  writeFileSync(join(root, 'playwright-report/index.html'), readFileSync(paths.golden));
  paths.vision.suites[0].specs[0].tests[0].results[0].retry = 1; writeFileSync(join(root, 'vision-player-career-report/results.json'), JSON.stringify(paths.vision));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./promote-dist.mjs', import.meta.url)), 'verify-reports'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /deployment is blocked/);
  const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const production = workflow.slice(workflow.indexOf('  deploy-production:'));
  assert.match(production, /needs: ci/); assert.match(workflow, /run: node scripts\/promote-dist.mjs verify-reports/);
  assert(production.indexOf('promote-dist.mjs recheck') < production.indexOf('uses: cloudflare/wrangler-action'));
  assert(!production.includes('continue-on-error')); assert(!production.includes('if: always()'));
});

test('source pins recompute physical source hashes and M65 rejects changed source bindings', t => {
  const root = temporary(t);
  for (const path of PIN_PATHS) {
    const target = join(root, path); mkdirSync(join(target, '..'), { recursive: true }); writeFileSync(target, 'source');
  }
  const tracked = join(root, 'simgolf-lite/artifacts/m65/certification-report.json'); mkdirSync(join(tracked, '..'), { recursive: true });
  const source = 'src/game/example.ts', sourceFile = join(root, 'simgolf-lite', source); mkdirSync(join(sourceFile, '..'), { recursive: true }); writeFileSync(sourceFile, 'canonical');
  const report = { reportDigest: 'd'.repeat(64), sourceBindings: { [source]: sha256(Buffer.from('canonical')) } }; writeFileSync(tracked, JSON.stringify(report));
  const downloaded = join(root, 'downloaded.json'); writeFileSync(downloaded, readFileSync(tracked));
  const before = sourcePins(root); m65Binding(root, downloaded);
  writeFileSync(sourceFile, 'changed'); assert.notDeepEqual(sourcePins(root), before); assert.throws(() => m65Binding(root, downloaded));
  writeFileSync(sourceFile, 'canonical'); writeFileSync(downloaded, JSON.stringify({ ...report, reportDigest: 'e'.repeat(64) })); assert.throws(() => m65Binding(root, downloaded));
});
test('only one narrowly named analysis worker may omit instrumentation', t => {
  const root = temporary(t); mkdirSync(join(root, 'assets')); writeFileSync(join(root, 'assets/a.js'), `sentry-dbid-${debugID}`);
  writeFileSync(join(root, 'assets/analysis.worker-known.js'), 'separate Vite worker'); assert.equal(debugBindings(root).length, 1);
  writeFileSync(join(root, 'assets/other.worker.js'), 'unknown'); assert.throws(() => debugBindings(root)); rmSync(join(root, 'assets/other.worker.js'));
  writeFileSync(join(root, 'assets/analysis.worker-second.js'), 'duplicate worker'); assert.throws(() => debugBindings(root));
});
test('changing pagination totals cannot silently choose one eligible run', async () => {
  let count = 0;
  const api = new GitHub('owner/game', 'ephemeral', async () => ({ ok: true, json: async () => ++count === 1 ? { total_count: 101, items: Array.from({ length: 100 }, (_, i) => ({ id: i + 1 })) } : { total_count: 100, items: [] } }));
  await assert.rejects(api.pages('/items', 'items'));
});

test('initial receipt binds authenticated successful Build metadata even while CI job is running', () => {
  const j = copy(jobs); j[0].status = 'in_progress'; j[0].conclusion = null; assert.equal(initialBuild(j, ctx).jobID, 31);
  j[0].steps[0].conclusion = 'failure'; assert.throws(() => initialBuild(j, ctx));
});


test('real receipt CLI remains red and reports only context enum on invalid context', () => {
  const secret = 'SECRET-do-not-print-signed-url-token';
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./promote-dist.mjs', import.meta.url)), 'receipt'], { env: { ...process.env, GITHUB_SHA: secret, GH_TOKEN: secret }, encoding: 'utf8', timeout: 10_000 });
  assert.equal(child.status, 1); assert.equal(child.stdout, '');
  assert.equal(child.stderr, 'Artifact promotion verification failed; deployment is blocked. phase=context error=assertion\n');
  assert(!child.stderr.includes(secret));
});
test('known diagnostic phase never serializes assertion actual expected or stack', async () => {
  const { failureDiagnostic } = await import('./promote-dist.mjs');
  const secret = 'SECRET-CREDENTIAL';
  const error = Object.assign(new Error(secret), { code: 'ERR_ASSERTION', actual: secret, expected: secret, stack: secret, headers: { Authorization: secret } });
  for (const phase of ['receipt-artifacts', 'receipt-release-identity']) assert.equal(failureDiagnostic(phase, error), `Artifact promotion verification failed; deployment is blocked. phase=${phase} error=assertion\n`);
});
test('unknown phase containing signed URL is mapped to static unknown', async () => {
  const { failureDiagnostic } = await import('./promote-dist.mjs');
  assert.equal(failureDiagnostic('https://signed.invalid/?token=SECRET', new Error('SECRET')), 'Artifact promotion verification failed; deployment is blocked. phase=unknown error=verification\n');
});
test('malformed phase and error names cannot inject diagnostic output', async () => {
  const { failureDiagnostic } = await import('./promote-dist.mjs');
  assert.equal(failureDiagnostic('receipt-run\nSECRET', { name: 'TypeError\nSECRET', code: 'ERR_ASSERTION\nSECRET' }), 'Artifact promotion verification failed; deployment is blocked. phase=unknown error=verification\n');
});
test('diagnostic property getter failure cannot expose thrown credentials', async () => {
  const { failureDiagnostic } = await import('./promote-dist.mjs');
  assert.equal(failureDiagnostic('receipt-run', { get code() { throw new Error('SECRET'); } }), 'Artifact promotion verification failed; deployment is blocked. phase=receipt-run error=verification\n');
});
test('timeout and type categories expose no raw message or request metadata', async () => {
  const { failureDiagnostic } = await import('./promote-dist.mjs');
  for (const [name, category] of [['TimeoutError', 'timeout'], ['AbortError', 'timeout'], ['TypeError', 'type']]) {
    assert.equal(failureDiagnostic('receipt-run', { name, message: 'SECRET', request: { signedURL: 'SECRET' } }), `Artifact promotion verification failed; deployment is blocked. phase=receipt-run error=${category}\n`);
  }
});
