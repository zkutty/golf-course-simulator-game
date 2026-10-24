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
  verifyDigest, GitHub, verifyReceipt, debugBindings, verifySentryLog, sourcePins, PIN_PATHS, m65Binding, initialBuild, verifyExecutionContract, verifyRunIdentity, verifyBuildProofShape, BUILD_SCRIPT, BUILD_COMMAND, QUALIFIER, verifyPromotion, parsedLog, failureDiagnostic, receiptPhase, receiptFailureDiagnostic, verifyCompletedProducerLog,
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
const build = { number: 19, name: 'Build', status: 'completed', conclusion: 'success', started_at: '2026-10-12T19:33:00.000Z', completed_at: '2026-10-12T19:34:00.000Z' };
const jobBase = { run_attempt: 1, started_at: '2026-10-12T19:32:00.000Z', completed_at: '2026-10-12T19:35:00.000Z' };
const jobs = [
  { ...jobBase, html_url: 'https://github.com/owner/game/actions/runs/17/job/31', id: 31, name: 'Typecheck, lint, test, build', run_id: 17, head_sha: ctx.sha, status: 'completed', conclusion: 'success', steps: [build] },
  { ...jobBase, html_url: 'https://github.com/owner/game/actions/runs/17/job/32', id: 32, name: 'Deploy tested artifact to Cloudflare playtest', run_id: 17, head_sha: ctx.sha, status: 'completed', conclusion: 'success', steps: [] },
  { ...jobBase, html_url: 'https://github.com/owner/game/actions/runs/17/job/33', id: 33, name: QUALIFIER, run_id: 17, head_sha: ctx.sha, status: 'completed', conclusion: 'success', steps: [] },
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
  const receipt = { schema: 2, authenticatedBuild: qualifiedProof(), ...ctx, workflow: '.github/workflows/ci.yml', attempt: 1, branch: 'develop', event: 'push', sourcePins: pins, reports, m65, files, artifacts };
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
  assert.match(production, /needs: \[ci, qualify-release\]/); assert.match(workflow, /run: node scripts\/promote-dist.mjs verify-reports/);
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

test('initial receipt requires completed successful producer even with positive Build metadata', () => {
  const j = copy(jobs); j[0].status = 'in_progress'; j[0].conclusion = null; assert.throws(() => initialBuild(j, ctx));
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


test('pre-upload inventory omits exact source-bound policy and retains every published byte', t => {
  const root = temporary(t), policy = readFileSync(new URL('../public/.assetsignore', import.meta.url));
  writeFileSync(join(root, 'index.html'), 'published'); writeFileSync(join(root, '.assetsignore'), policy);
  assert.equal(sha256(policy), '67cf78011982c3b42d96b4eec7e652eb82fa61988a976f05faceda11da576c0a');
  assert.deepEqual(inventory(root, true), [{ path: 'index.html', bytes: 9, sha256: sha256(Buffer.from('published')) }]);
});
test('changed deployment policy is rejected rather than silently omitted', t => {
  const root = temporary(t); writeFileSync(join(root, 'index.html'), 'published');
  writeFileSync(join(root, '.assetsignore'), '**/.DS_Store\n**/.gitX\n**/node_modules\n');
  assert.throws(() => inventory(root, true), /known unpublished deployment policy bytes/);
});
test('dist policy must also equal actual tracked source in an isolated module image', t => {
  const root = temporary(t), scripts = join(root, 'scripts'), assets = join(root, 'dist');
  mkdirSync(scripts); mkdirSync(join(root, 'public')); mkdirSync(assets);
  writeFileSync(join(scripts, 'promote-dist.mjs'), readFileSync(new URL('./promote-dist.mjs', import.meta.url)));
  writeFileSync(join(root, 'public/.assetsignore'), 'changed tracked policy');
  writeFileSync(join(assets, 'index.html'), 'published'); writeFileSync(join(assets, '.assetsignore'), readFileSync(new URL('../public/.assetsignore', import.meta.url)));
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `const { inventory } = await import(${JSON.stringify(new URL('file://' + join(scripts, 'promote-dist.mjs')).href)}); inventory(${JSON.stringify(assets)}, true);`], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(child.status, 1); assert.match(child.stderr, /copied deployment policy matches tracked source/);
});
test('downloaded dist still rejects hidden policy and pre-upload rejects any other hidden input', t => {
  const root = temporary(t); writeFileSync(join(root, 'index.html'), 'published');
  writeFileSync(join(root, '.assetsignore'), readFileSync(new URL('../public/.assetsignore', import.meta.url)));
  assert.throws(() => inventory(root), /unexpected hidden publish file/);
  writeFileSync(join(root, '.unknown'), 'unexpected'); assert.throws(() => inventory(root, true), /unexpected hidden publish file/);
});
test('deployment policy directory and symlink cannot qualify as unpublished metadata', t => {
  const root = temporary(t); writeFileSync(join(root, 'index.html'), 'published'); mkdirSync(join(root, '.assetsignore'));
  assert.throws(() => inventory(root, true), /deployment policy must be regular/); rmSync(join(root, '.assetsignore'), { recursive: true });
  writeFileSync(join(root, 'policy'), readFileSync(new URL('../public/.assetsignore', import.meta.url))); symlinkSync(join(root, 'policy'), join(root, '.assetsignore'));
  assert.throws(() => inventory(root, true), /symlink in dist/);
});


function stalledSteps(missingBuild = false) {
  const names = ['Set up job', 'Run actions/checkout@v4', 'Run actions/setup-node@v4', 'Install dependencies', 'Typecheck', 'Lint (zero errors)', 'Test', 'Install Playwright Chromium', 'Pixi renderer ownership regression', 'Upload Pixi renderer ownership report', 'M65 machine certification', 'Upload verified M65 report', 'Golden-path E2E', 'Upload Golden-path E2E report', 'Vision Player Pro narrative regression', 'Upload Vision Player Pro narrative report', 'Verify exact first-attempt Golden and Vision reports', 'Artifact promotion contract tests', 'Build', 'Upload build artifact'];
  return names.map((name, i) => ({ name, number: i + 1, status: i < 6 ? 'completed' : i === 6 ? 'in_progress' : 'pending', conclusion: i < 6 ? 'success' : null, started_at: i < 7 ? '2026-10-12T19:32:00.000Z' : null, completed_at: i < 6 ? '2026-10-12T19:32:01.000Z' : null })).filter(s => !missingBuild || s.name !== 'Build');
}
function proofFixture(stalled = false, missingBuild = false) {
  const fixtureJobs = copy(jobs);
  if (stalled) fixtureJobs[0].steps = stalledSteps(missingBuild);
  const zipBytes = Buffer.from('independent fixture ZIP bytes'), dist = { id: 41, digest: `sha256:${sha256(zipBytes)}`, size: zipBytes.length };
  const texts = [
    "Current runner version: 'fixture'", `##[group]Run ${BUILD_SCRIPT.split('\n')[0]}`, BUILD_SCRIPT.split('\n')[0], 'npm run build', BUILD_SCRIPT.split('\n')[2], 'shell: /usr/bin/bash -e {0}', '##[endgroup]',
    `ZK1359_BUILD_V1 BEGIN sha=${ctx.sha} run=17 attempt=1 job=ci`, '> simgolf-lite@1.0.0 build', `> ${BUILD_COMMAND}`,
    `> Release: ${release}`, '> Upload type: artifact bundle', 'Source Map Upload Report', '  Scripts', `    ~/one.js (sourcemap at one.js.map, debug id ${debugID})`, '  Source Maps', `    ~/one.js.map (debug id ${debugID})`, '[sentry-vite-plugin] Info: Successfully uploaded source maps to Sentry',
    `ZK1359_BUILD_V1 END sha=${ctx.sha} run=17 attempt=1 job=ci`, '##[group]Run actions/upload-artifact@v4', 'with:', '  name: dist', '  path: simgolf-lite/dist', '  retention-days: 7', '  overwrite: false', '  include-hidden-files: false', '##[endgroup]', 'Finished uploading artifact content to blob storage!', `SHA256 digest of uploaded artifact zip is ${sha256(zipBytes)}`, 'Finalizing artifact upload', 'Artifact dist.zip successfully finalized. Artifact ID 41', `Artifact dist has been successfully uploaded! Final size is ${zipBytes.length} bytes. Artifact ID is 41`, 'Artifact download URL: https://github.com/owner/game/actions/runs/17/artifacts/41', 'Post job cleanup.', 'Cleaning up orphan processes',
  ];
  const logBytes = Buffer.from(texts.map((text, i) => `${new Date(Date.parse('2026-10-12T19:33:01.000Z') + i).toISOString()} ${text}\n`).join(''));
  const options = { direct: copy(fixtureJobs[0]), log: logBytes, repoRoot: fileURLToPath(new URL('../../', import.meta.url)), dist, distZIP: zipBytes, release, bindings: [{ path: 'assets/a.js', debugID }] };
  return { jobs: fixtureJobs, options, dist, zipBytes, logBytes, texts };
}
function qualifiedProof(stalled = false, missingBuild = false) { const f = proofFixture(stalled, missingBuild); return initialBuild(f.jobs, ctx, f.options); }
test('qualification identity permits active enclosing run and requires exact push/source/attempt', () => {
  const active = { ...run, status: 'in_progress', conclusion: null }; assert.equal(verifyRunIdentity(active, { ...ctx, branch: 'develop' }).id, 17);
  assert.throws(() => verifyRun(active, ctx));
  for (const mutate of [r => { r.head_branch = 'main'; }, r => { r.repository.full_name = 'foreign/repo'; }, r => { r.event = 'pull_request'; }, r => { r.run_attempt = 2; }, r => { r.path = '.github/workflows/wrong.yml'; }, r => { r.status = 'completed'; r.conclusion = 'failure'; }]) { const bad = copy(active); mutate(bad); assert.throws(() => verifyRunIdentity(bad, { ...ctx, branch: 'develop' })); }
});
test('Q is after P and before both actual push deployment branches with no dependency cycle', () => {
  const text = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const heads = [...text.matchAll(/^  ([a-z][a-z-]*):\n/gm)], nodes = {};
  for (let i = 0; i < heads.length; i++) { const source = text.slice(heads[i].index, heads[i + 1]?.index ?? text.length), needs = source.match(/^    needs: (.+)$/m)?.[1]; nodes[heads[i][1]] = { source, needs: needs ? needs.replace(/[\[\]]/g, '').split(',').map(n => n.trim()) : [] }; }
  assert.deepEqual(nodes.ci.needs, []); assert.deepEqual(nodes['qualify-release'].needs, ['ci']);
  for (const name of ['deploy-playtest', 'deploy-production']) assert.deepEqual(nodes[name].needs, ['ci', 'qualify-release']);
  const visiting = new Set(), visited = new Set(); function visit(id) { assert(!visiting.has(id), 'acyclic release job graph'); if (visited.has(id)) return; assert(nodes[id]); visiting.add(id); for (const dep of nodes[id].needs) visit(dep); visiting.delete(id); visited.add(id); } Object.keys(nodes).forEach(visit);
  assert.match(nodes['qualify-release'].source, /^    if: github.event_name == 'push'$/m); assert.match(nodes['qualify-release'].source, /ref: \$\{\{ github.sha \}\}/);
  assert(!nodes['qualify-release'].source.includes('npm run build')); assert(!nodes['qualify-release'].source.includes('name: dist'));
  assert(!nodes.ci.source.includes('promote-dist.mjs receipt')); assert(!nodes.ci.source.includes('release-receipt'));
  assert.match(nodes['deploy-playtest'].source, /artifact-ids: \$\{\{ needs.qualify-release.outputs.dist-id \}\}/);
  for (const node of Object.values(nodes)) assert(!node.source.includes('continue-on-error'));
  assert.match(nodes['deploy-production'].source, /github.ref == 'refs\/heads\/main'/); assert.match(nodes['deploy-playtest'].source, /github.ref == 'refs\/heads\/develop'/);
});
test('exact unconditional Build, chain, dist upload and all original workflow limits are source guarded', () => {
  const contract = verifyExecutionContract(fileURLToPath(new URL('../../', import.meta.url))); assert.equal(contract.buildScript, BUILD_SCRIPT); assert.equal(contract.buildCommand, BUILD_COMMAND);
});
for (const [label, mutate] of [
  ['suppressed build', s => s.replace('          npm run build\n', '          npm run build || true\n')], ['conditional Build', s => s.replace('      - name: Build\n', "      - name: Build\n        if: always()\n")], ['continue error', s => s.replace('      - name: Build\n', '      - name: Build\n        continue-on-error: true\n')], ['changed timeout', s => s.replace('timeout-minutes: 60', 'timeout-minutes: 65')], ['changed worker cap', s => s.replace('--workers=1', '--workers=2')], ['changed retry', s => s.replace('--retries=0', '--retries=1')], ['main skipped Q', s => s.replace("if: github.event_name == 'push'\n", "if: github.ref == 'refs/heads/develop'\n")], ['cyclic Q', s => s.replace('    needs: ci\n', '    needs: deploy-playtest\n')], ['artifact overwrite', s => s.replace('          retention-days: 7\n', '          retention-days: 7\n          overwrite: true\n')], ['changed DSN', s => s.replace('vars.VITE_SENTRY_DSN', 'vars.OTHER_DSN')], ['extra dist upload', s => s.replace('  qualify-release:', '      - uses: actions/upload-artifact@v4\n        with:\n          name: dist\n          path: simgolf-lite/dist\n\n  qualify-release:')],
]) test(`execution contract rejects ${label}`, t => {
  const root = temporary(t); mkdirSync(join(root, '.github/workflows'), { recursive: true }); mkdirSync(join(root, 'simgolf-lite'));
  writeFileSync(join(root, '.github/workflows/ci.yml'), mutate(readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')));
  writeFileSync(join(root, 'simgolf-lite/package.json'), readFileSync(new URL('../package.json', import.meta.url)));
  assert.throws(() => verifyExecutionContract(root));
});
test('execution contract rejects changed chained package commands', t => {
  const root = temporary(t); mkdirSync(join(root, '.github/workflows'), { recursive: true }); mkdirSync(join(root, 'simgolf-lite'));
  writeFileSync(join(root, '.github/workflows/ci.yml'), readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url)));
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))); pkg.scripts.build += ' || true'; writeFileSync(join(root, 'simgolf-lite/package.json'), JSON.stringify(pkg)); assert.throws(() => verifyExecutionContract(root));
});
test('preferred genuine API metadata and narrow completed-log routes retain provider records unchanged', () => {
  for (const stalled of [false, true]) {
    const f = proofFixture(stalled), before = copy(f.jobs); const proof = initialBuild(f.jobs, ctx, f.options);
    assert.equal(proof.kind, stalled ? 'completed-producer-log-v1' : 'github-completed-build-step-v1'); assert.deepEqual(f.jobs, before);
    assert.deepEqual(proof.step, before[0].steps.find(s => s.name === 'Build')); assert.deepEqual(proof.apiObservations.attemptSteps, before[0].steps); assert.deepEqual(proof.apiObservations.directSteps, before[0].steps);
    assert.equal(proof.completedLog.rawSHA256, sha256(f.logBytes)); assert.equal(proof.completedLog.upload.artifact.size, f.zipBytes.length); verifyBuildProofShape(proof); assert.equal(verifyJobs(f.jobs, run, proof).id, 31);
  }
  const proof = qualifiedProof(true, true); assert.equal(proof.step, null); assert(!proof.apiObservations.attemptSteps.some(s => s.name === 'Build'));
});
test('pending metadata cannot certify without full log, source and independent dist ZIP', () => {
  const f = proofFixture(true); assert.throws(() => initialBuild(f.jobs, ctx));
  for (const key of ['direct', 'log', 'repoRoot', 'dist', 'distZIP', 'bindings', 'release']) { const options = { ...f.options }; delete options[key]; assert.throws(() => initialBuild(f.jobs, ctx, options)); }
});
for (const [label, mutate] of [
  ['failed producer', f => { f.jobs[0].conclusion = 'failure'; f.options.direct.conclusion = 'failure'; }], ['cancelled producer', f => { f.jobs[0].conclusion = 'cancelled'; f.options.direct.conclusion = 'cancelled'; }], ['skipped producer', f => { f.jobs[0].conclusion = 'skipped'; f.options.direct.conclusion = 'skipped'; }], ['active producer', f => { f.jobs[0].status = 'in_progress'; f.options.direct.status = 'in_progress'; }], ['attempt two', f => { f.jobs[0].run_attempt = 2; f.options.direct.run_attempt = 2; }], ['wrong source', f => { f.jobs[0].head_sha = 'b'.repeat(40); }], ['wrong job URL', f => { f.jobs[0].html_url = 'https://github.com/other/job/31'; }], ['duplicate producer', f => f.jobs.push(copy(f.jobs[0]))], ['direct identity disagreement', f => { f.options.direct.id = 99; }], ['direct steps disagreement', f => { f.options.direct.steps[6].started_at = null; }], ['contradictory failed Build', f => { Object.assign(f.jobs[0].steps[18], { status: 'completed', conclusion: 'failure' }); f.options.direct = copy(f.jobs[0]); }], ['in-progress Build', f => { f.jobs[0].steps[18].status = 'in_progress'; f.options.direct = copy(f.jobs[0]); }], ['unknown missing step frontier', f => { f.jobs[0].steps[6].status = 'pending'; f.options.direct = copy(f.jobs[0]); }], ['duplicate Build', f => { f.jobs[0].steps.push(copy(f.jobs[0].steps[18])); f.options.direct = copy(f.jobs[0]); }], ['fake Build timestamp', f => { f.jobs[0].steps[18].completed_at = '2026-10-12T19:34:00Z'; f.options.direct = copy(f.jobs[0]); }], ['contradictory other failed step', f => { Object.assign(f.jobs[0].steps[8], { status: 'completed', conclusion: 'failure' }); f.options.direct = copy(f.jobs[0]); }],
]) test(`completed producer proof rejects ${label}`, () => { const f = proofFixture(true); mutate(f); assert.throws(() => initialBuild(f.jobs, ctx, f.options)); });
for (const name of [QUALIFIER, 'Deploy tested artifact to Cloudflare playtest']) for (const conclusion of ['failure', 'skipped', 'cancelled', null]) test(`terminal acceptance rejects ${name} ${conclusion}`, () => {
  const f = proofFixture(); f.jobs.find(j => j.name === name).conclusion = conclusion; assert.throws(() => verifyJobs(f.jobs, run, qualifiedProof()));
});
for (const [label, mutate] of [
  ['missing BEGIN', s => s.replace(/ZK1359_BUILD_V1 BEGIN sha=[^\n]+/, 'removed BEGIN')], ['missing END', s => s.replace(/ZK1359_BUILD_V1 END sha=[^\n]+/, 'removed END')], ['duplicate BEGIN', s => s.replace(/(\d[^\n]+ ZK1359_BUILD_V1 BEGIN sha=[^\n]+\n)/, '$1$1')], ['spoof marker', s => s.replace('> simgolf-lite@', 'ZK1359_BUILD_V1 spoof\n2026-10-12T19:33:01.008Z > simgolf-lite@')], ['wrong SHA marker', s => s.replace(`BEGIN sha=${ctx.sha}`, `BEGIN sha=${'b'.repeat(40)}`)], ['wrong run marker', s => s.replace('run=17 attempt=1', 'run=18 attempt=1')], ['wrong attempt marker', s => s.replace('attempt=1 job=ci', 'attempt=2 job=ci')], ['wrong job marker', s => s.replace('job=ci', 'job=other')], ['nested build group', s => s.replace('> simgolf-lite@1.0.0 build', '##[group]Run spoof')], ['suppressed command echo', s => s.replace(' npm run build\n', ' npm run build || true\n')], ['changed actual chain', s => s.replace(`> ${BUILD_COMMAND}`, '> vite build')], ['bad chronology', s => s.replace('2026-10-12T19:33:01.015Z', '2026-10-12T19:32:00.000Z')], ['missing finalized ID', s => s.replace('Artifact dist.zip successfully finalized. Artifact ID 41', 'missing finalization')], ['wrong finalized ID', s => s.replace('Artifact ID 41', 'Artifact ID 42')], ['wrong upload digest', s => s.replace('SHA256 digest of uploaded artifact zip is ', `SHA256 digest of uploaded artifact zip is ${'b'.repeat(64)}`)], ['wrong upload size', s => s.replace(/Final size is \d+ bytes/, 'Final size is 1 bytes')], ['wrong artifact URL', s => s.replace('/artifacts/41', '/artifacts/42')], ['wrong upload path', s => s.replace('path: simgolf-lite/dist', 'path: simgolf-lite/other')], ['overwrite', s => s.replace('overwrite: false', 'overwrite: true')], ['hidden maps upload', s => s.replace('include-hidden-files: false', 'include-hidden-files: true')], ['wrong release', s => s.replace(`> Release: ${release}`, '> Release: other')], ['missing debug ID', s => s.replace(`one.js.map (debug id ${debugID})`, 'one.js.map (debug id other)')], ['missing bundle', s => s.replace('> Upload type: artifact bundle', '> Upload type: other')], ['Sentry success outside Build', s => s.replace('[sentry-vite-plugin] Info: Successfully uploaded source maps to Sentry', 'removed success') + '2026-10-12T19:33:01.040Z [sentry-vite-plugin] Info: Successfully uploaded source maps to Sentry\n'], ['duplicate release', s => s.replace('> Upload type:', `> Release: ${release}\n2026-10-12T19:33:01.011Z > Upload type:`)], ['duplicate debug ID', s => s.replace('  Source Maps', `    ~/extra.js (sourcemap at extra.js.map, debug id ${debugID})\n2026-10-12T19:33:01.015Z   Source Maps`)], ['truncated cleanup', s => s.slice(0, s.indexOf('2026-10-12T19:33:01.034Z'))], ['truncated newline', s => s.slice(0, -1)], ['missing setup prefix', s => s.slice(s.indexOf('\n') + 1)], ['explicit error', s => s.replace('Finished uploading artifact content to blob storage!', '##[error]Build failed')], ['malformed timestamp', s => s.replace('2026-10-12T19:33:01.009Z', 'not-a-time')],
]) test(`authentic completed log rejects ${label}`, () => { const f = proofFixture(true); f.options.log = Buffer.from(mutate(f.logBytes.toString())); assert.throws(() => initialBuild(f.jobs, ctx, f.options)); });
test('strict UTF8, raw size/digest and actual API window inverses reject', () => {
  for (const mutate of [f => { f.options.log = Buffer.from([0xff, 0xfe]); }, f => { f.options.log = Buffer.alloc(32 * 1024 * 1024 + 1); }, f => { f.options.distZIP = Buffer.from('changed ZIP'); }, f => { f.options.dist = { ...f.dist, size: 1 }; }, f => { f.options.dist = { ...f.dist, digest: `sha256:${'b'.repeat(64)}` }; }, f => { f.jobs[0].steps[0].completed_at = '2026-10-12T19:33:00.000Z'; f.options.direct = copy(f.jobs[0]); }]) { const f = proofFixture(); mutate(f); assert.throws(() => initialBuild(f.jobs, ctx, f.options)); }
  const f = proofFixture(); f.options.log = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), f.logBytes]); const proof = initialBuild(f.jobs, ctx, f.options); assert.equal(proof.completedLog.rawSHA256, sha256(f.options.log)); assert(proof.completedLog.build.begin.byteOffset > 3);
});
test('proof schema, discriminator, provider record and raw log mutation are fail closed', () => {
  for (const mutate of [p => { p.schema = 2; }, p => { p.kind = 'fake-api-success'; }, p => { p.step.status = 'completed'; }, p => { p.step.started_at = '2026-10-12T19:33:00Z'; }, p => { p.apiObservations.directSteps = []; }, p => { p.completedLog.rawSHA256 = 'fake'; }, p => { p.producer.conclusion = 'failure'; }, p => { p.execution.workflowSHA256 = 'b'.repeat(64); }]) { const proof = qualifiedProof(true); mutate(proof); assert.throws(() => verifyBuildProofShape(proof)); }
  const f = proofFixture(true), proof = initialBuild(f.jobs, ctx, f.options); assert.throws(() => verifySentryLog(Buffer.concat([f.logBytes, Buffer.from('changed')]), f.jobs[0], release, f.options.bindings, proof));
});
test('native provider second precision stays unchanged and fine log timestamp reordering rejects', () => {
  const f = proofFixture(); f.jobs[0].steps[0].started_at = '2026-10-12T19:33:01Z'; f.jobs[0].steps[0].completed_at = '2026-10-12T19:33:01Z'; f.options.direct = copy(f.jobs[0]);
  const proof = initialBuild(f.jobs, ctx, f.options); assert.equal(proof.step.completed_at, '2026-10-12T19:33:01Z'); assert.equal(proof.kind, 'github-completed-build-step-v1');
  f.options.log = Buffer.from(f.logBytes.toString().replace('19:33:01.014Z', '19:33:01.015999999Z').replace('19:33:01.015Z', '19:33:01.015000001Z'));
  assert.throws(() => initialBuild(f.jobs, ctx, f.options), /ordered log chronology/);
});
test('unauthenticated API error does not fall back to log evidence', async () => {
  const api = new GitHub('owner/game', 'ephemeral', async () => ({ ok: false, status: 503 }));
  await assert.rejects(api.request('/actions/jobs/31')); await assert.rejects(api.pages('/actions/runs/17/attempts/1/jobs', 'jobs'));
});
test('completed job log endpoint authenticates exact job and never forwards credentials to storage', async () => {
  const requests = [], f = proofFixture(), api = new GitHub('owner/game', 'ephemeral-test-token', async (url, options) => { requests.push({ url, options }); return requests.length === 1 ? { status: 302, headers: new Headers({ location: 'https://storage.example/log' }) } : new Response(f.logBytes); });
  assert.equal(sha256(await api.signedBytes('/actions/jobs/31/logs', 32 * 1024 * 1024)), sha256(f.logBytes)); assert.equal(requests[0].url, 'https://api.github.com/repos/owner/game/actions/jobs/31/logs'); assert(requests[0].options.headers.Authorization); assert.equal(requests[1].options.headers, undefined);
});


test('promotion and repeated recheck recompute complete frozen synthetic artifact/proof tuple and reject every changed input', async t => {
  const root = temporary(t), repo = join(root, 'repo'), evidence = join(root, 'evidence'); mkdirSync(evidence);
  const sourceRepo = fileURLToPath(new URL('../../', import.meta.url));
  const canonicalM65 = JSON.parse(readFileSync(join(sourceRepo, 'simgolf-lite/artifacts/m65/certification-report.json')));
  for (const path of new Set([...PIN_PATHS, 'simgolf-lite/artifacts/m65/certification-report.json', ...Object.keys(canonicalM65.sourceBindings).map(p => `simgolf-lite/${p}`)])) {
    const destination = join(repo, path); mkdirSync(join(destination, '..'), { recursive: true }); writeFileSync(destination, readFileSync(join(sourceRepo, path)));
  }
  const reportPaths = reports(root);
  const entries = {
    dist: [{ name: 'index.html', data: 'fixture published index' }, { name: 'assets/a.js', data: `sentry-dbid-${debugID}` }],
    'golden-path-e2e-report': [{ name: 'playwright-report/index.html', data: readFileSync(reportPaths.golden, 'utf8') }, { name: 'test-results/.last-run.json', data: '{}' }],
    'vision-player-career-e2e-report': [{ name: 'vision-player-career-report/results.json', data: readFileSync(reportPaths.visionPath, 'utf8') }],
    'm65-machine-certification': [{ name: 'certification-report.json', data: JSON.stringify(canonicalM65) }],
  };
  // Preserve the actual canonical JSON bytes (including its whitespace).
  entries['m65-machine-certification'][0].data = readFileSync(join(repo, 'simgolf-lite/artifacts/m65/certification-report.json'), 'utf8');
  const providerArtifacts = [];
  function install(name, files) {
    const source = zip(root, files, `${name}.zip`), bytes = readFileSync(source), id = 41 + providerArtifacts.length;
    writeFileSync(join(evidence, `${name}.zip`), bytes); safeExtract(source, join(evidence, name));
    providerArtifacts.push({ ...copy(artifact), id, name, digest: `sha256:${sha256(bytes)}`, size_in_bytes: bytes.length });
  }
  for (const [name, files] of Object.entries(entries)) install(name, files);
  const tuple = artifactSet(providerArtifacts, Object.keys(entries), run), f = proofFixture(true);
  const actualRelease = `coursecraft@${JSON.parse(readFileSync(join(repo, 'simgolf-lite/package.json'))).version}+${ctx.sha.slice(0, 12)}`;
  const distBytes = readFileSync(join(evidence, 'dist.zip'));
  f.options.log = Buffer.from(f.logBytes.toString().replaceAll(release, actualRelease).replace(sha256(f.zipBytes), sha256(distBytes)).replace(`Final size is ${f.zipBytes.length} bytes`, `Final size is ${distBytes.length} bytes`));
  Object.assign(f.options, { repoRoot: repo, dist: tuple.dist, distZIP: distBytes, release: actualRelease });
  const proof = initialBuild(f.jobs, ctx, f.options), files = inventory(join(evidence, 'dist'));
  const receipt = { schema: 2, ...ctx, workflow: '.github/workflows/ci.yml', attempt: 1, branch: 'develop', event: 'push', release: actualRelease, sourcePins: sourcePins(repo), authenticatedBuild: proof, reports: verifyReports(join(evidence, 'golden-path-e2e-report/playwright-report/index.html'), join(evidence, 'vision-player-career-e2e-report/vision-player-career-report/results.json')), m65: m65Binding(repo, join(evidence, 'm65-machine-certification/certification-report.json')), files, artifacts: tuple, sentry: { scope: 'qualified-completed-producer-upload; no remote Sentry retrieval', uninstrumentedWorker: { type: 'Vite separate analysis worker', source: 'src/game/analysis/analysis.worker.ts', published: [] }, debugBindings: f.options.bindings, upload: proof.sentry } };
  install('release-receipt', [{ name: 'release-receipt.json', data: `${JSON.stringify(receipt, null, 2)}\n` }]);
  safeExtract(join(evidence, 'dist.zip'), join(repo, 'simgolf-lite/dist'));
  const production = { ...ctx, workflow: '.github/workflows/ci.yml', attempt: 1, branch: 'main', event: 'push' };
  const promotion = { schema: 2, production, selectedRunID: 17, artifacts: artifactSet(providerArtifacts, [...Object.keys(entries), 'release-receipt'], run), receiptSHA256: sha256(readFileSync(join(evidence, 'release-receipt/release-receipt.json'))) };
  const api = {
    pages: async (path, key) => copy(key === 'workflow_runs' ? [run] : key === 'jobs' ? f.jobs : providerArtifacts),
    request: async path => copy(path.includes('/jobs/') ? f.options.direct : run),
    signedBytes: async () => Buffer.from(f.options.log),
  };
  await verifyPromotion(api, production, repo, evidence, promotion);
  await verifyPromotion(api, production, repo, evidence, promotion); // repeated unchanged recheck
  const badSchema = copy(promotion); badSchema.schema = 1; await assert.rejects(verifyPromotion(api, production, repo, evidence, badSchema));
  const originalLog = f.options.log; f.options.log = Buffer.concat([originalLog, Buffer.from('2026-10-12T19:33:01.040Z changed full job log\n')]); await assert.rejects(verifyPromotion(api, production, repo, evidence, promotion)); f.options.log = originalLog;
  const zipPath = join(evidence, 'dist.zip'); writeFileSync(zipPath, Buffer.concat([distBytes, Buffer.from('changed ZIP')])); await assert.rejects(verifyPromotion(api, production, repo, evidence, promotion)); writeFileSync(zipPath, distBytes);
  const receiptPath = join(evidence, 'release-receipt/release-receipt.json'), receiptBytes = readFileSync(receiptPath); writeFileSync(receiptPath, Buffer.concat([receiptBytes, Buffer.from(' ')])); await assert.rejects(verifyPromotion(api, production, repo, evidence, promotion)); writeFileSync(receiptPath, receiptBytes);
  const published = join(repo, 'simgolf-lite/dist/assets/a.js'), originalPublished = readFileSync(published); writeFileSync(published, 'changed deployed file'); await assert.rejects(verifyPromotion(api, production, repo, evidence, promotion)); writeFileSync(published, originalPublished);
  const extra = join(evidence, 'golden-path-e2e-report/test-results/extra'); mkdirSync(extra); await assert.rejects(verifyPromotion(api, production, repo, evidence, promotion)); rmSync(extra, { recursive: true });
  const shaPath = join(repo, '.github/workflows/ci.yml'), originalSource = readFileSync(shaPath); writeFileSync(shaPath, Buffer.concat([originalSource, Buffer.from('\n')])); await assert.rejects(verifyPromotion(api, production, repo, evidence, promotion)); writeFileSync(shaPath, originalSource);
  providerArtifacts[0].digest = `sha256:${'b'.repeat(64)}`; await assert.rejects(verifyPromotion(api, production, repo, evidence, promotion)); providerArtifacts[0].digest = tuple.dist.digest;
  f.jobs.find(j => j.name === QUALIFIER).conclusion = 'skipped'; await assert.rejects(verifyPromotion(api, production, repo, evidence, promotion));
});

// Exact nonsecret action-echo bytes from the retained authenticated failed log.
// These parser fixtures do not assert successful producer or release status.
const capturedSourceEchoes = [
  {
    "name": "pixi",
    "startLine": 1230,
    "endLine": 1241,
    "fullLogByteOffset": 130976,
    "sha256": "39faf856dd72302b022fa6afc72f3a30c45c1a02d3eb8ac06dfb08b94753523f",
    "bytes": 604,
    "text": "2026-10-13T21:23:16.2028827Z ##[group]Run actions/upload-artifact@v4\n2026-10-13T21:23:16.2029148Z with:\n2026-10-13T21:23:16.2029379Z   name: pixi-peer-ownership-e2e-report\n2026-10-13T21:23:16.2029889Z   path: simgolf-lite/pixi-peer-ownership-report\nsimgolf-lite/pixi-peer-ownership-test-results\n\n2026-10-13T21:23:16.2030406Z   if-no-files-found: ignore\n2026-10-13T21:23:16.2030647Z   retention-days: 14\n2026-10-13T21:23:16.2030865Z   compression-level: 6\n2026-10-13T21:23:16.2031088Z   overwrite: false\n2026-10-13T21:23:16.2031309Z   include-hidden-files: false\n2026-10-13T21:23:16.2031755Z ##[endgroup]\n"
  },
  {
    "name": "golden",
    "startLine": 1347,
    "endLine": 1358,
    "fullLogByteOffset": 139466,
    "sha256": "785bacd824d5d2db845d5ba1306813219b0ffe291fe5c37c0115c21dd22ab8a0",
    "bytes": 567,
    "text": "2026-10-13T21:34:17.5536222Z ##[group]Run actions/upload-artifact@v4\n2026-10-13T21:34:17.5536548Z with:\n2026-10-13T21:34:17.5536772Z   name: golden-path-e2e-report\n2026-10-13T21:34:17.5537437Z   path: simgolf-lite/playwright-report\nsimgolf-lite/test-results\n\n2026-10-13T21:34:17.5538075Z   if-no-files-found: ignore\n2026-10-13T21:34:17.5538341Z   retention-days: 14\n2026-10-13T21:34:17.5538580Z   compression-level: 6\n2026-10-13T21:34:17.5538817Z   overwrite: false\n2026-10-13T21:34:17.5539051Z   include-hidden-files: false\n2026-10-13T21:34:17.5539305Z ##[endgroup]\n"
  },
  {
    "name": "vision",
    "startLine": 1388,
    "endLine": 1400,
    "fullLogByteOffset": 142904,
    "sha256": "dacacf89edb63632264668738b6ab11a3c83851a45ad772efcb87b374d2446cd",
    "bytes": 650,
    "text": "2026-10-13T21:35:39.2671172Z ##[group]Run actions/upload-artifact@v4\n2026-10-13T21:35:39.2671505Z with:\n2026-10-13T21:35:39.2671747Z   name: vision-player-career-e2e-report\n2026-10-13T21:35:39.2672452Z   path: simgolf-lite/vision-player-career-report\nsimgolf-lite/vision-player-career-test-results\nsimgolf-lite/vision-player-career-evidence\n\n2026-10-13T21:35:39.2673150Z   if-no-files-found: ignore\n2026-10-13T21:35:39.2673409Z   retention-days: 14\n2026-10-13T21:35:39.2673649Z   compression-level: 6\n2026-10-13T21:35:39.2673889Z   overwrite: false\n2026-10-13T21:35:39.2674124Z   include-hidden-files: false\n2026-10-13T21:35:39.2674394Z ##[endgroup]\n"
  }
];

for (const captured of capturedSourceEchoes) test(`source-bound continuation accepts exact captured ${captured.name} echo with truthful physical rows`, () => {
  const bytes = Buffer.from(captured.text); assert.equal(sha256(bytes), captured.sha256);
  const physical = captured.text.slice(0, -1).split('\n'), lines = parsedLog(bytes), echoes = lines.filter(l => l.sourceEcho);
  assert.equal(echoes.length, 1); const echo = echoes[0], continuations = echo.continuations;
  assert.equal(continuations.length, captured.name === 'vision' ? 3 : 2); assert.equal(lines.length + continuations.length, physical.length);
  assert.equal(echo.sourceEcho.completed.line, physical.length); assert.equal(echo.sourceEcho.workflow, '.github/workflows/ci.yml');
  for (const row of continuations) {
    assert.equal(row.timestamp, null); assert.equal(bytes.subarray(row.byteOffset, row.byteOffset + row.byteLength).toString(), `${row.text}\n`);
    assert.equal(row.line, physical.findIndex((s, i) => i > 3 && s === row.text) + 1); assert.equal(row.source.pathLine, echo.line); assert.equal(row.source.groupLine, 1);
    assert.equal(row.source.artifact, echo.sourceEcho.artifact);
  }
  for (const row of lines) {
    assert.equal(row.timestamp, physical[row.line - 1].split(' ')[0]); assert.equal(row.byteOffset, Buffer.byteLength(physical.slice(0, row.line - 1).join('\n') + (row.line > 1 ? '\n' : '')));
  }
  const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert(workflow.includes(`          path: |\n${echo.sourceEcho.paths.map(p => `            ${p}`).join('\n')}`), 'continuation paths match frozen source declaration');
});
const capturedPixiEcho = capturedSourceEchoes[0].text;
for (const [label, mutate] of [
  ['untimed BEGIN', s => s.replace('simgolf-lite/pixi-peer-ownership-test-results', `ZK1359_BUILD_V1 BEGIN sha=${ctx.sha} run=17 attempt=1 job=ci`)],
  ['untimed END', s => s.replace('simgolf-lite/pixi-peer-ownership-test-results', `ZK1359_BUILD_V1 END sha=${ctx.sha} run=17 attempt=1 job=ci`)],
  ['untimed Sentry success', s => s.replace('simgolf-lite/pixi-peer-ownership-test-results', '[sentry-vite-plugin] Info: Successfully uploaded source maps to Sentry')],
  ['untimed release', s => s.replace('simgolf-lite/pixi-peer-ownership-test-results', `> Release: ${release}`)],
  ['untimed bundle', s => s.replace('simgolf-lite/pixi-peer-ownership-test-results', '> Upload type: artifact bundle')],
  ['untimed debug ID', s => s.replace('simgolf-lite/pixi-peer-ownership-test-results', `    ~/fake.js.map (debug id ${debugID})`)],
  ['untimed finalization', s => s.replace('simgolf-lite/pixi-peer-ownership-test-results', 'Artifact dist.zip successfully finalized. Artifact ID 41')],
  ['untimed digest', s => s.replace('simgolf-lite/pixi-peer-ownership-test-results', `SHA256 digest of uploaded artifact zip is ${'a'.repeat(64)}`)],
  ['untimed artifact URL', s => s.replace('simgolf-lite/pixi-peer-ownership-test-results', 'Artifact download URL: https://github.com/owner/game/actions/runs/17/artifacts/41')],
  ['untimed error', s => s.replace('simgolf-lite/pixi-peer-ownership-test-results', '##[error]failure')],
  ['arbitrary untimed output', s => s.replace('simgolf-lite/pixi-peer-ownership-test-results', 'unknown ordinary output')],
  ['malformed timestamp', s => s.replace('simgolf-lite/pixi-peer-ownership-test-results', '2026-10-13T21:23:16.203 malformed')],
  ['wrong continuation path', s => s.replace('simgolf-lite/pixi-peer-ownership-test-results', 'simgolf-lite/other-test-results')],
  ['ANSI continuation path', s => s.replace('simgolf-lite/pixi-peer-ownership-test-results', '\x1b[36msimgolf-lite/pixi-peer-ownership-test-results\x1b[0m')],
  ['wrong action context', s => s.replace('Run actions/upload-artifact@v4', 'Run npm run build')],
  ['missing action context', s => s.slice(s.indexOf('\n') + 1)],
  ['wrong with context', s => s.replace(' with:\n', ' other:\n')],
  ['wrong artifact name', s => s.replace('name: pixi-peer-ownership-e2e-report', 'name: dist')],
  ['wrong first path', s => s.replace('path: simgolf-lite/pixi-peer-ownership-report', 'path: simgolf-lite/other-report')],
  ['missing continuation', s => s.replace('simgolf-lite/pixi-peer-ownership-test-results\n', '')],
  ['missing blank terminator', s => s.replace('test-results\n\n', 'test-results\n')],
  ['extra blank', s => s.replace('test-results\n\n', 'test-results\n\n\n')],
  ['duplicate continuation', s => s.replace('test-results\n', 'test-results\nsimgolf-lite/pixi-peer-ownership-test-results\n')],
  ['truncated following input', s => s.slice(0, s.indexOf('2026-10-13T21:23:16.2030406Z'))],
  ['truncated action completion', s => s.slice(0, s.indexOf('2026-10-13T21:23:16.2031755Z'))],
  ['wrong following input', s => s.replace('if-no-files-found: ignore', 'if-no-files-found: error')],
  ['wrong tail source retention', s => s.replace('retention-days: 14', 'retention-days: 7')],
  ['wrong tail overwrite', s => s.replace('overwrite: false', 'overwrite: true')],
  ['wrong tail hidden publication', s => s.replace('include-hidden-files: false', 'include-hidden-files: true')],
  ['missing echo group closure', s => s.replace('##[endgroup]', 'not closed')],
  ['chronology after untimed rows', s => s.replace('21:23:16.2030406Z', '21:23:16.2020000Z')],
  ['extra untimed content after closure', s => s + 'simgolf-lite/pixi-peer-ownership-test-results\n'],
]) test(`source-bound continuation rejects ${label}`, () => assert.throws(() => parsedLog(Buffer.from(mutate(capturedPixiEcho)))));
test('source-bound continuation rejects reordered Vision paths, timed path substitution and bad raw encoding', () => {
  const vision = capturedSourceEchoes[2].text;
  assert.throws(() => parsedLog(Buffer.from(vision.replace('simgolf-lite/vision-player-career-test-results\nsimgolf-lite/vision-player-career-evidence', 'simgolf-lite/vision-player-career-evidence\nsimgolf-lite/vision-player-career-test-results'))));
  assert.throws(() => parsedLog(Buffer.from(capturedPixiEcho.replace('\nsimgolf-lite/pixi-peer-ownership-test-results', '\n2026-10-13T21:23:16.2030000Z simgolf-lite/pixi-peer-ownership-test-results'))));
  for (const bytes of [Buffer.concat([Buffer.from(capturedPixiEcho), Buffer.from([0xff])]), Buffer.from(capturedPixiEcho.replace('test-results\n', 'test-results\r\n')), Buffer.from(capturedPixiEcho.slice(0, -1))]) assert.throws(() => parsedLog(bytes));
});
function sourceBoundEchoProofFixture(stalled) {
  const f = proofFixture(stalled), rows = [{ text: f.texts[0], timed: true }];
  for (const captured of capturedSourceEchoes) for (const raw of captured.text.slice(0, -1).split('\n')) { const match = raw.match(/^\d{4}-\d{2}-\d{2}T\S+ (.*)$/); rows.push({ text: match?.[1] ?? raw, timed: Boolean(match) }); }
  rows.push(...f.texts.slice(1).map(text => ({ text, timed: true })));
  f.options.log = Buffer.from(rows.map((row, i) => `${row.timed ? new Date(Date.parse('2026-10-12T19:33:01.000Z') + i).toISOString() + ' ' : ''}${row.text}\n`).join(''));
  return f;
}
test('source-bound continuation keeps both typed proof routes and terminal upload physical bound correct', () => {
  for (const stalled of [false, true]) {
    const f = sourceBoundEchoProofFixture(stalled), rows = parsedLog(f.options.log), proof = initialBuild(f.jobs, ctx, f.options);
    assert.equal(proof.kind, stalled ? 'completed-producer-log-v1' : 'github-completed-build-step-v1'); assert.equal(proof.completedLog.rawSHA256, sha256(f.options.log));
    assert.equal(rows.flatMap(l => l.continuations ?? []).length, 7);
    assert(proof.completedLog.upload.end.line >= rows.length + 1, 'old timed-entry-count fallback would incorrectly exclude actual finalization evidence');
    assert(proof.completedLog.upload.end.line < rows.at(-1).line + 1, 'new bound uses actual terminal physical row');
    const rawBuild = f.options.log.subarray(proof.completedLog.build.begin.byteOffset).toString().split('\n')[0];
    assert.equal(rawBuild, `${proof.completedLog.build.begin.timestamp} ZK1359_BUILD_V1 BEGIN sha=${ctx.sha} run=17 attempt=1 job=ci`);
    assert.deepEqual(proof.step, f.jobs[0].steps.find(s => s.name === 'Build')); verifyBuildProofShape(proof);
  }
});

function parsedDiagnostic(text) {
  assert(Buffer.byteLength(text) <= 4096, 'bounded diagnostic output');
  const lines = text.trimEnd().split('\n');
  assert.equal(lines.length, 2);
  assert(lines[1].startsWith('diagnostic-observations='));
  return JSON.parse(lines[1].slice('diagnostic-observations='.length));
}
test('failure summary distinguishes safe producer observations and binds exact log bytes', () => {
  const f = proofFixture(), observations = { jobs: f.jobs, direct: f.options.direct, log: f.logBytes, artifacts: { dist: f.dist } };
  const error = { code: 'ERR_ASSERTION', message: 'SECRET', actual: 'SECRET', expected: 'SECRET', stack: 'SECRET' };
  const first = failureDiagnostic('receipt-producer-agreement', error, observations), summary = parsedDiagnostic(first);
  assert.equal(summary.attemptJobs.producer.id, 31); assert.equal(summary.direct.attempt, 1);
  assert.equal(summary.attemptJobs.producer.status, 'completed'); assert.equal(summary.direct.steps.build.status, 'completed');
  assert.equal(summary.direct.startedAt, Date.parse(f.options.direct.started_at));
  assert.deepEqual(summary.log, { bytes: f.logBytes.length, sha256: sha256(f.logBytes) });
  assert.deepEqual(summary.dist, { id: f.dist.id, bytes: f.dist.size, digest: f.dist.digest });
  assert(!first.includes('SECRET') && !first.includes('https:') && !first.includes(ctx.sha));
  f.options.direct.steps[0].status = 'pending';
  const changed = parsedDiagnostic(failureDiagnostic('receipt-producer-agreement', error, observations));
  assert.equal(changed.direct.steps.build.status, 'pending');
  assert.notEqual(changed.direct.projectionSHA256, summary.direct.projectionSHA256);
  assert.equal(changed.attemptJobs.projectionSHA256, summary.attemptJobs.projectionSHA256);
});
test('summary intentionally collapses unrelated step names while agreement still rejects', () => {
  const f = proofFixture(); f.jobs[0].steps.push({ ...build, name: 'ordinary first', number: 20 }); f.options.direct = copy(f.jobs[0]);
  const observations = { jobs: f.jobs, direct: f.options.direct };
  const before = parsedDiagnostic(failureDiagnostic('receipt-producer-agreement', {}, observations));
  f.options.direct.steps[1].name = 'SECRET-ordinary-second';
  const after = parsedDiagnostic(failureDiagnostic('receipt-producer-agreement', {}, observations));
  assert.equal(before.direct.projectionSHA256, after.direct.projectionSHA256);
  assert.throws(() => receiptPhase('receipt-build-metadata', () => initialBuild(f.jobs, ctx, f.options)));
  assert.match(receiptFailureDiagnostic({ code: 'ERR_ASSERTION' }), /phase=receipt-producer-agreement error=assertion/);
  assert(!JSON.stringify(after).includes('SECRET'));
});
test('failure observations never invoke accessor or toJSON properties', () => {
  let reads = 0;
  const accessor = () => { reads++; throw new Error('SECRET-GETTER'); };
  const hostile = Object.create(null);
  for (const key of ['jobs', 'direct', 'log', 'artifacts', 'toJSON']) Object.defineProperty(hostile, key, { enumerable: true, get: accessor });
  parsedDiagnostic(failureDiagnostic('receipt-jobs-fetch', { code: 'ERR_ASSERTION' }, hostile));
  const nested = Object.create(null);
  for (const key of ['name', 'id', 'run_id', 'run_attempt', 'head_sha', 'status', 'conclusion', 'started_at', 'completed_at', 'steps', 'toJSON']) Object.defineProperty(nested, key, { enumerable: true, get: accessor });
  const text = failureDiagnostic('receipt-producer-direct', {}, { jobs: [nested], direct: nested, artifacts: { get dist() { return accessor(); } } });
  parsedDiagnostic(text); assert.equal(reads, 0); assert(!text.includes('SECRET'));
});
test('Buffer summary uses intrinsic byte length and never calls user conversion hooks', () => {
  const bytes = Buffer.from('SECRET-log-byte-content'), expected = sha256(bytes); let reads = 0;
  const fail = () => { reads++; throw new Error('SECRET-CONVERSION'); };
  Object.defineProperty(bytes, 'length', { get: fail }); Object.defineProperty(bytes, 'toJSON', { value: fail }); Object.defineProperty(bytes, Symbol.toPrimitive, { value: fail });
  const text = failureDiagnostic('receipt-log-parser', {}, { log: bytes }), summary = parsedDiagnostic(text);
  assert.deepEqual(summary.log, { bytes: 23, sha256: expected }); assert.equal(reads, 0); assert(!text.includes('SECRET'));
});
test('cycles revoked proxies huge arrays and arbitrary credential fields remain bounded and redacted', () => {
  const secret = 'https://signed.invalid/?token=SECRET-CREDENTIAL';
  const f = proofFixture(); const raw = f.options.direct;
  raw.name = secret; raw.status = secret; raw.started_at = secret; raw.headers = { Authorization: secret }; raw.message = secret; raw[secret] = secret; raw.toJSON = () => { throw new Error(secret); };
  raw.steps = new Array(1_000_000); raw.steps[0] = { name: secret, status: secret, conclusion: secret, number: secret, started_at: secret, completed_at: secret, toJSON() { throw new Error(secret); } }; raw.steps[1] = raw;
  const huge = new Array(1_000_000); huge[0] = raw; huge[1] = huge;
  const revocable = Proxy.revocable({}, {}); revocable.revoke();
  for (const value of [{ jobs: huge, direct: raw, log: { get length() { throw new Error(secret); }, toJSON() { throw new Error(secret); } } }, revocable.proxy, new Proxy({}, { getOwnPropertyDescriptor() { throw new Error(secret); } })]) {
    const text = failureDiagnostic(secret, { code: 'ERR_ASSERTION', name: secret, stack: secret, actual: secret, expected: secret }, value);
    parsedDiagnostic(text); assert.match(text, /phase=unknown error=assertion/); assert(!text.includes(secret) && !text.includes('SECRET') && !text.includes('Authorization'));
  }
});
test('diagnostic error-property failures and summary failures preserve the original throw', () => {
  const original = new Error('SECRET-original'); let codeReads = 0;
  Object.defineProperty(original, 'code', { get() { codeReads++; throw new Error('SECRET-secondary'); } });
  assert.throws(() => receiptPhase('receipt-log-parser', () => { throw original; }), error => error === original);
  const observations = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('SECRET-summary'); } });
  const text = failureDiagnostic('receipt-log-parser', original, observations); parsedDiagnostic(text);
  assert.equal(codeReads, 1); assert.match(text, /error=verification/); assert(!text.includes('SECRET'));
});
for (const [phase, mutate] of [
  ['receipt-producer-selection', f => { f.jobs = []; }],
  ['receipt-producer-direct', f => { f.options.direct.status = 'in_progress'; f.options.direct.conclusion = null; }],
  ['receipt-producer-agreement', f => { f.options.direct.id = 99; f.options.direct.html_url = 'https://github.com/owner/game/actions/runs/17/job/99'; }],
  ['receipt-build-state', f => { f.jobs[0].steps[0].started_at = '2026-10-12T19:35:00Z'; f.options.direct = copy(f.jobs[0]); }],
  ['receipt-execution-contract', f => { f.options.repoRoot = '/not-a-valid-contract-root'; }],
  ['receipt-log-parser', f => { f.options.log = Buffer.from([0xff]); }],
  ['receipt-log-window', f => { f.options.log = Buffer.from(f.logBytes.toString().replace("Current runner version: 'fixture'", 'not a full producer log')); }],
  ['receipt-build-markers', f => { f.options.log = Buffer.from(f.logBytes.toString().replace('ZK1359_BUILD_V1 BEGIN sha=', 'ZK1359_BUILD_V1 MISSING sha=')); }],
  ['receipt-upload-boundaries', f => { f.options.log = Buffer.from(f.logBytes.toString().replace('##[group]Run actions/upload-artifact@v4', '##[group]Run another command')); }],
  ['receipt-upload-zip', f => { f.options.distZIP = Buffer.from('changed ZIP'); }],
  ['receipt-upload-finalization', f => { f.options.log = Buffer.from(f.logBytes.toString().replace('Artifact dist.zip successfully finalized. Artifact ID 41', 'Artifact dist.zip successfully finalized. Artifact ID 99')); }],
  ['receipt-build-window', f => { f.jobs[0].steps[0].started_at = '2026-10-12T19:33:01.005Z'; f.jobs[0].steps[0].completed_at = '2026-10-12T19:33:01.010Z'; f.options.direct = copy(f.jobs[0]); }],
  ['receipt-sentry', f => { f.options.release = 'SECRET-wrong-release'; }],
]) test(`existing rejection retains the static ${phase} failure location`, () => {
  const f = proofFixture(); mutate(f); let original;
  assert.throws(() => receiptPhase('receipt-build-metadata', () => initialBuild(f.jobs, ctx, f.options)), error => { original = error; return true; });
  assert(original); assert.match(receiptFailureDiagnostic(original), new RegExp(`phase=${phase} error=`));
  assert(!receiptFailureDiagnostic(original).includes('SECRET'));
});
test('direct log identity and typed-proof rejection retain their own static phases', () => {
  const f = proofFixture(), execution = verifyExecutionContract(f.options.repoRoot);
  assert.throws(() => receiptPhase('receipt-build-metadata', () => verifyCompletedProducerLog(f.logBytes, { ...f.jobs[0], run_id: 99 }, ctx, execution, f.dist, f.zipBytes)));
  assert.match(receiptFailureDiagnostic({ code: 'ERR_ASSERTION' }), /phase=receipt-log-identity error=assertion/);
  assert.throws(() => receiptPhase('receipt-build-metadata', () => verifyBuildProofShape({ schema: 99 })));
  assert.match(receiptFailureDiagnostic({ code: 'ERR_ASSERTION' }), /phase=receipt-proof-shape error=assertion/);
});
for (const phase of ['receipt-jobs-fetch', 'receipt-direct-fetch']) test(`failed ${phase} makes one request and never retries`, async () => {
  let requests = 0;
  const api = new GitHub('owner/game', 'SECRET-token', async () => { requests++; return { ok: false, status: 503 }; });
  await assert.rejects(receiptPhase(phase, () => phase === 'receipt-jobs-fetch' ? api.pages('/jobs', 'jobs') : api.request('/job')));
  assert.equal(requests, 1); assert.match(receiptFailureDiagnostic({ code: 'ERR_ASSERTION' }), new RegExp(`phase=${phase} error=assertion`));
});
for (const [phase, responses, expectedCalls] of [
  ['receipt-log-redirect', [{ status: 200 }], 1],
  ['receipt-log-location', [{ status: 302, headers: new Headers({ location: 'http://signed.invalid/?token=SECRET' }) }], 1],
  ['receipt-log-storage', [{ status: 302, headers: new Headers({ location: 'https://signed.invalid/?token=SECRET' }) }, { ok: false, status: 503 }], 2],
  ['receipt-log-body', [{ status: 302, headers: new Headers({ location: 'https://signed.invalid/?token=SECRET' }) }, { ok: true, status: 200, body: (async function* () { throw new Error('SECRET-body'); })() }], 2],
]) test(`failed ${phase} keeps original fetch count and redacts signed locations`, async () => {
  let requests = 0;
  const api = new GitHub('owner/game', 'SECRET-token', async () => responses[requests++]);
  await assert.rejects(receiptPhase('receipt-log-fetch', () => api.signedBytes('/logs', 100)));
  assert.equal(requests, expectedCalls);
  const text = receiptFailureDiagnostic({ code: 'ERR_ASSERTION' }); assert.match(text, new RegExp(`phase=${phase} error=assertion`)); assert(!text.includes('SECRET') && !text.includes('signed.invalid'));
});
test('receipt-only phase markers preserve successful and failing verifier read order and proof bytes', () => {
  function observed(phase, bad = false) {
    const f = proofFixture(); if (bad) f.options.direct.head_sha = 'b'.repeat(40);
    const trace = [], seen = new WeakMap();
    function track(value, path) {
      if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) return value;
      if (seen.has(value)) return seen.get(value);
      const proxy = new Proxy(value, { get(target, key, receiver) { trace.push(`${path}.${String(key)}`); return track(Reflect.get(target, key, receiver), `${path}.${String(key)}`); } }); seen.set(value, proxy); return proxy;
    }
    let result, error;
    try { result = receiptPhase(phase, () => initialBuild(track(f.jobs, 'jobs'), track(ctx, 'ctx'), track(f.options, 'options'))); } catch (failure) { error = failure; }
    return { trace: [...trace], proof: result && JSON.stringify(result), failure: error && { code: error.code, message: error.message } };
  }
  for (const bad of [false, true]) assert.deepEqual(observed('receipt-build-metadata', bad), observed('promotion', bad));
  receiptPhase('promotion', () => parsedLog(proofFixture().logBytes));
  assert.equal(receiptFailureDiagnostic({ code: 'ERR_ASSERTION' }), 'Artifact promotion verification failed; deployment is blocked. phase=promotion error=assertion\n');
});
test('successful diagnostic phase wiring emits no output and returns the identical proof', () => {
  const f = proofFixture(), expected = JSON.stringify(initialBuild(f.jobs, ctx, f.options)), output = [];
  const original = process.stderr.write;
  process.stderr.write = function (chunk) { output.push(chunk); return true; };
  try { assert.equal(JSON.stringify(receiptPhase('receipt-build-metadata', () => initialBuild(f.jobs, ctx, f.options))), expected); }
  finally { process.stderr.write = original; }
  assert.deepEqual(output, []);
});
test('real receipt CLI retains only safe returned observations and remains failed without retries', t => {
  const root = temporary(t), count = join(root, 'count.json'), preload = join(root, 'fetch.mjs');
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url)), project = join(repoRoot, 'simgolf-lite');
  const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  const activeRun = { ...run, head_sha: source, status: 'in_progress', conclusion: null };
  const failedProducer = { ...jobs[0], head_sha: source, status: 'in_progress', conclusion: null };
  writeFileSync(preload, `import { writeFileSync } from 'node:fs';let calls=0;process.on('exit',()=>writeFileSync(${JSON.stringify(count)},JSON.stringify(calls)));globalThis.fetch=async url=>{calls++;if(String(url).endsWith('/actions/runs/17'))return {ok:true,json:async()=>(${JSON.stringify(activeRun)})};if(String(url).includes('/attempts/1/jobs?'))return {ok:true,json:async()=>({total_count:1,jobs:[${JSON.stringify(failedProducer)}]})};throw new Error('SECRET-unexpected-network');};`);
  const child = spawnSync(process.execPath, ['--import', preload, fileURLToPath(new URL('./promote-dist.mjs', import.meta.url)), 'receipt'], { cwd: project, env: { ...process.env, GITHUB_SHA: source, GITHUB_RUN_ID: '17', GITHUB_RUN_ATTEMPT: '1', GITHUB_REPOSITORY: 'owner/game', GITHUB_REF_NAME: 'develop', GITHUB_EVENT_NAME: 'push', GH_TOKEN: 'SECRET-token' }, encoding: 'utf8', timeout: 10_000 });
  assert.equal(child.status, 1); assert.equal(child.stdout, ''); assert.equal(JSON.parse(readFileSync(count)), 2);
  assert.match(child.stderr, /phase=receipt-producer-selection error=assertion/);
  const summary = parsedDiagnostic(child.stderr); assert.equal(summary.attemptJobs.producer.status, 'in_progress'); assert(!child.stderr.includes('SECRET') && !child.stderr.includes('github.com'));
});
