import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, lstatSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const GOLDEN_CASES = [
  ['golden-path.e2e.ts', 'quick start → playable course → live week → save → reload'],
  ['golden-path.e2e.ts', 'Sunday closes one authoritative week, pauses, and resumes explicitly'],
  ['golden-path.e2e.ts', 'screen flow, hard pause, dirty guard, and save acknowledgement'],
  ['golden-path.e2e.ts', 'every checked-in historical save fixture migrates'],
  ['golden-path.e2e.ts', 'options apply live and persist independently across reload'],
  ['golden-path.e2e.ts', 'keyboard-only options, remapping, conflicts, and save/load round-trip'],
  ['golden-path.e2e.ts', 'accessible palettes, patterns, text scaling, and reduced motion apply live'],
  ['vision-page.e2e.ts', 'shareable vision page links from the title screen and tells the full story'],
  ['vision-page.e2e.ts', 'vision page remains readable on a phone-sized viewport'],
  ['vision-page.e2e.ts', 'vision biome catalog stays complete and readable at a tablet breakpoint'],
  ['vision-page.e2e.ts', 'vision gallery serves the branded Parkland and Desert art responsively'],
  ['vision-page.e2e.ts', 'vision gallery keeps a branded fallback when artwork is unavailable'],
].map(([file, title]) => ({ file, title, project: '' }));
export const VISION_CASES = ['en', 'pseudo'].flatMap(locale => [320, 820, 1280, 1680].map(width => ({
  file: 'zk741-player-career-vision.e2e.ts', title: `Player career Vision ${locale} ${width} paired app profile100 and130`, project: '',
})));
const WORKFLOW = '.github/workflows/ci.yml';
const ASSETS_IGNORE_SHA256 = '67cf78011982c3b42d96b4eec7e652eb82fa61988a976f05faceda11da576c0a';
const ARTIFACT_NAMES = ['dist', 'golden-path-e2e-report', 'vision-player-career-e2e-report', 'm65-machine-certification'];
export const PIN_PATHS = [WORKFLOW, 'simgolf-lite/scripts/promote-dist.mjs', 'simgolf-lite/scripts/promote-dist.test.mjs', 'simgolf-lite/public/.assetsignore', 'simgolf-lite/package.json', 'simgolf-lite/package-lock.json', 'simgolf-lite/vite.config.ts', 'simgolf-lite/playwright.config.ts', 'simgolf-lite/e2e/golden-path.e2e.ts', 'simgolf-lite/e2e/vision-page.e2e.ts', 'simgolf-lite/e2e/zk741-player-career-vision.e2e.ts', 'simgolf-lite/scripts/m65-certify.mjs', 'simgolf-lite/scripts/m65-certification-contract.mjs', 'simgolf-lite/release/m65-certification-manifest.json', 'simgolf-lite/src/game/analysis/analysis.worker.ts', 'simgolf-lite/src/game/analysis/benchmark.ts'];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const same = (a, b, label) => assert.deepEqual(a, b, label);
const sorted = values => [...values].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

export function verifyCases(report, cases, expected) {
  const stats = report.stats;
  for (const [key, value] of Object.entries({ expected: expected.length, skipped: 0, unexpected: 0, flaky: 0 })) same(stats[key], value, `report ${key}`);
  if ('total' in stats) same(stats.total, expected.length, 'report total');
  same(report.errors, [], 'global report errors');
  same(sorted(cases.map(c => ({ file: c.file, title: c.title, project: c.project }))), sorted(expected), 'exact report identities');
  for (const c of cases) {
    same(c.outcome, 'expected', 'case outcome');
    same(c.results.length, 1, 'case attempts');
    const result = c.results[0];
    same(result.status, 'passed', 'case status'); same(result.retry, 0, 'case retry'); same(result.errors, [], 'case errors');
  }
  return { cases: expected.length, rawVerdict: 'each-passed-once-retry-zero' };
}

// Python standard library handles the existing Playwright HTML ZIP and artifact ZIPs.
// Validate the complete archive before writing anything, including directory entries.
const ZIP_PYTHON = String.raw`
import base64,io,json,pathlib,re,stat,sys,zipfile
mode,source,target=sys.argv[1:]
if mode=='golden':
 text=pathlib.Path(source).read_text()
 matches=re.findall(r'data:application/zip;base64,([A-Za-z0-9+/=]+)',text)
 if len(matches)!=1: raise ValueError('one HTML report ZIP required')
 data=base64.b64decode(matches[0],validate=True)
else: data=pathlib.Path(source).read_bytes()
if len(data)>512*1024*1024: raise ValueError('archive too large')
with zipfile.ZipFile(io.BytesIO(data)) as z:
 seen=set();total=0
 for info in z.infolist():
  name=info.filename; p=pathlib.PurePosixPath(name)
  if not name or name.startswith('/') or '\\' in name or ':' in name or any(x in ('','..','.') for x in name.rstrip('/').split('/')): raise ValueError('unsafe ZIP path')
  canonical=str(p)
  if canonical in seen: raise ValueError('duplicate ZIP path')
  seen.add(canonical)
  kind=stat.S_IFMT(info.external_attr>>16)
  if kind not in (0,stat.S_IFREG,stat.S_IFDIR): raise ValueError('nonregular ZIP entry')
  if info.flag_bits & 1: raise ValueError('encrypted ZIP entry')
  total+=info.file_size
  if total>1024*1024*1024: raise ValueError('expanded archive too large')
 if mode=='golden':
  report=json.loads(z.read('report.json'));cases=[]
  for f in report['files']:
   if not re.fullmatch(r'[A-Za-z0-9_-]+',f['fileId']): raise ValueError('unsafe report file ID')
   for t in json.loads(z.read(f['fileId']+'.json'))['tests']:
    cases.append(dict(file=t['location']['file'],title=t['title'],project=t['projectName'],outcome=t['outcome'],results=t['results']))
  print(json.dumps(dict(report=report,cases=cases)))
 else:
  dest=pathlib.Path(target);dest.mkdir(parents=True,exist_ok=False)
  for info in z.infolist():
   out=dest/info.filename
   if info.is_dir(): out.mkdir(parents=True,exist_ok=True)
   else:
    out.parent.mkdir(parents=True,exist_ok=True)
    with out.open('xb') as f: f.write(z.read(info))
`;
export function safeExtract(zip, destination) {
  execFileSync('python3', ['-c', ZIP_PYTHON, 'extract', zip, destination], { timeout: 60_000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
export function readGolden(path) {
  return JSON.parse(execFileSync('python3', ['-c', ZIP_PYTHON, 'golden', path, '-'], { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 }));
}
function visionCases(suites) {
  return suites.flatMap(s => [...(s.specs ?? []).flatMap(spec => {
    same(spec.ok, true, 'vision spec ok'); same(spec.tests.length, 1, 'vision projects');
    const t = spec.tests[0]; same(t.expectedStatus, 'passed', 'vision expected status'); same(t.timeout, 60000, 'vision timeout');
    return [{ file: spec.file, title: spec.title, project: t.projectName, outcome: t.status, results: t.results }];
  }), ...visionCases(s.suites ?? [])]);
}
export function verifyReports(goldenPath, visionPath) {
  const golden = readGolden(goldenPath), vision = json(visionPath);
  return {
    golden: { ...verifyCases(golden.report, golden.cases, GOLDEN_CASES), sha256: sha256(readFileSync(goldenPath)) },
    vision: { ...verifyCases(vision, visionCases(vision.suites), VISION_CASES), sha256: sha256(readFileSync(visionPath)) },
  };
}
export function inventory(directory, omitAudit = false) {
  const files = [];
  function walk(relative = '') {
    for (const name of readdirSync(join(directory, relative)).sort()) {
      const path = relative ? `${relative}/${name}` : name;
      const info = lstatSync(join(directory, path));
      assert(!info.isSymbolicLink(), 'symlink in dist');
      if (path === '.assetsignore' && omitAudit) {
        assert(info.isFile(), 'deployment policy must be regular');
        const policy = readFileSync(join(directory, path));
        same(sha256(policy), ASSETS_IGNORE_SHA256, 'known unpublished deployment policy bytes');
        same(policy, readFileSync(new URL('../public/.assetsignore', import.meta.url)), 'copied deployment policy matches tracked source');
        continue;
      }
      if (path === '.vite' && omitAudit) {
        same(readdirSync(join(directory, path)), ['manifest.json'], 'only known unpublished audit input');
        assert(lstatSync(join(directory, path, 'manifest.json')).isFile(), 'audit input must be regular');
        continue;
      }
      assert(!path.split('/').some(part => part.startsWith('.')), 'unexpected hidden publish file');
      if (info.isDirectory()) walk(path);
      else {
        assert(info.isFile(), 'nonregular dist file');
        files.push({ path, bytes: info.size, sha256: sha256(readFileSync(join(directory, path))) });
      }
    }
  }
  walk(); assert(files.length > 0, 'empty dist'); return files;
}
export function verifyInventory(directory, expected, omitAudit = false) { same(inventory(directory, omitAudit), expected, 'exact raw published inventory'); }
export function sourcePins(repoRoot) {
  const m65 = json(join(repoRoot, 'simgolf-lite/artifacts/m65/certification-report.json'));
  const paths = [...new Set([...PIN_PATHS, ...Object.keys(m65.sourceBindings).map(p => `simgolf-lite/${p}`)])].sort();
  return Object.fromEntries(paths.map(p => [p, sha256(readFileSync(join(repoRoot, p)))]));
}
export function m65Binding(repoRoot, path) {
  const report = json(path), tracked = join(repoRoot, 'simgolf-lite/artifacts/m65/certification-report.json');
  same(readFileSync(path), readFileSync(tracked), 'canonical M65 report bytes');
  for (const [source, digest] of Object.entries(report.sourceBindings)) same(sha256(readFileSync(join(repoRoot, 'simgolf-lite', source))), digest, 'M65 source binding');
  return { rawSHA256: sha256(readFileSync(path)), reportDigest: report.reportDigest, sourceBindings: report.sourceBindings };
}
export function verifyRun(run, context, branch = 'develop') {
  assert(Number.isSafeInteger(run.id) && run.id > 0, 'run ID');
  same(run.head_sha, context.sha, 'full SHA'); same(run.repository.full_name, context.repository, 'run repository');
  same(run.head_repository.full_name, context.repository, 'head repository'); same(run.path.split('@')[0], WORKFLOW, 'workflow path');
  same(run.head_branch, branch, 'branch'); same(run.event, 'push', 'event'); same(run.run_attempt, 1, 'attempt');
  same(run.status, 'completed', 'completed run'); same(run.conclusion, 'success', 'successful run');
  return run;
}
export function selectRun(runs, context) {
  const candidates = runs.filter(r => r.head_sha === context.sha && r.head_branch === 'develop' && r.event === 'push');
  same(candidates.length, 1, 'exactly one develop run, no ambiguous or unfinished candidates');
  return verifyRun(candidates[0], context);
}
export function verifyJobs(jobs, run) {
  let ciJob;
  for (const name of ['Typecheck, lint, test, build', 'Deploy tested artifact to Cloudflare playtest']) {
    const matches = jobs.filter(j => j.name === name); same(matches.length, 1, 'unique required job');
    const job = matches[0]; same(job.run_id, run.id, 'job run'); same(job.head_sha, run.head_sha, 'job SHA');
    same(job.status, 'completed', 'job completion'); same(job.conclusion, 'success', 'job success');
    if (name === 'Typecheck, lint, test, build') {
      const build = job.steps.filter(s => s.name === 'Build'); same(build.length, 1, 'unique Build step');
      same(build[0].status, 'completed', 'Build completion'); same(build[0].conclusion, 'success', 'Build success');
      ciJob = job;
    }
  }
  return ciJob;
}
export function initialBuild(jobs, ctx) {
  const matches = jobs.filter(j => j.name === 'Typecheck, lint, test, build'); same(matches.length, 1, 'unique receipt CI job');
  const job = matches[0]; same(job.run_id, ctx.runID, 'receipt Build run'); same(job.head_sha, ctx.sha, 'receipt Build SHA');
  const builds = job.steps.filter(s => s.name === 'Build'); same(builds.length, 1, 'receipt Build step');
  const build = builds[0]; same(build.status, 'completed', 'receipt Build complete'); same(build.conclusion, 'success', 'receipt Build success');
  assert(Number.isSafeInteger(job.id) && job.id > 0, 'Build job ID');
  return { jobID: job.id, runID: job.run_id, attempt: 1, step: build };
}
export function artifactSet(artifacts, names, run, now = Date.now()) {
  const result = {};
  for (const name of names) {
    const matches = artifacts.filter(a => a.name === name); same(matches.length, 1, `unique artifact ${name}`);
    const a = matches[0]; assert(Number.isSafeInteger(a.id) && a.id > 0, 'artifact ID');
    same(a.expired, false, 'artifact not expired'); assert(Date.parse(a.expires_at) > now, 'artifact expiry');
    assert(/^sha256:[0-9a-f]{64}$/.test(a.digest), 'artifact SHA256 digest');
    same(a.workflow_run.id, run.id, 'artifact run'); same(a.workflow_run.head_sha, run.head_sha, 'artifact SHA');
    same(a.workflow_run.head_branch, run.head_branch, 'artifact branch');
    assert(a.size_in_bytes > 0, 'nonempty artifact');
    result[name] = { id: a.id, digest: a.digest };
  }
  same(new Set(Object.values(result).map(a => a.id)).size, names.length, 'distinct artifact IDs');
  return result;
}
export function verifyDigest(bytes, digest) { same(`sha256:${sha256(bytes)}`, digest, 'artifact ZIP digest'); }

export function debugBindings(directory) {
  const bindings = []; let workerCount = 0;
  for (const file of inventory(directory, true)) {
    assert(!file.path.endsWith('.map'), 'source map must never publish');
    if (!file.path.startsWith('assets/') || !file.path.endsWith('.js')) continue;
    const text = readFileSync(join(directory, file.path), 'utf8');
    const ids = [...text.matchAll(/sentry-dbid-([0-9a-f-]{36})/g)].map(m => m[1]);
    if (ids.length === 0 && /^assets\/analysis\.worker-[\w-]+\.js$/.test(file.path)) {
      workerCount++; same(workerCount, 1, 'only one known uninstrumented analysis worker'); continue;
    }
    same(ids.length, 1, 'one Sentry debug ID per main bundled JavaScript');
    assert(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(ids[0]), 'valid Sentry debug UUID');
    bindings.push({ path: file.path, debugID: ids[0] });
  }
  assert(bindings.length > 0, 'Sentry debug bindings required');
  same(new Set(bindings.map(b => b.debugID)).size, bindings.length, 'unique Sentry debug UUIDs'); return bindings;
}
export function verifySentryLog(bytes, job, release, bindings) {
  const build = job.steps.find(s => s.name === 'Build');
  assert(build && build.conclusion === 'success', 'successful Build step');
  const start = Date.parse(build.started_at), end = Date.parse(build.completed_at);
  assert(Number.isFinite(start) && Number.isFinite(end) && end >= start, 'Build timestamps');
  // Use only lines within the completed Build step's server-provided time window.
  const lines = bytes.toString('utf8').split('\n').filter(line => {
    const timestamp = line.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z/);
    return timestamp && Date.parse(timestamp[0]) >= start && Date.parse(timestamp[0]) <= end;
  }).join('\n');
  assert(lines.includes('[sentry-vite-plugin] Info: Successfully uploaded source maps to Sentry'), 'successful Sentry upload message');
  assert(lines.includes('> Upload type: artifact bundle'), 'Sentry artifact bundle');
  assert(lines.includes(`> Release: ${release}`), 'Sentry release');
  for (const { debugID } of bindings) assert(lines.includes(`(debug id ${debugID})`), 'uploaded debug ID');
  return { scope: 'masked-GitHub-completed-job-log-upload-provenance; no remote Sentry retrieval', jobID: job.id, runID: job.run_id, attempt: 1, rawLogSHA256: sha256(bytes), release, debugBindings: bindings };
}

export class GitHub {
  constructor(repository, token, fetcher = fetch) {
    assert(/^[\w.-]+\/[\w.-]+$/.test(repository), 'repository name'); assert(token, 'ephemeral GitHub token required');
    this.base = `https://api.github.com/repos/${repository}`; this.token = token; this.fetcher = fetcher;
  }
  async request(path, raw = false) {
    const response = await this.fetcher(this.base + path, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      redirect: 'manual', signal: AbortSignal.timeout(30_000),
    });
    if (raw) { same(response.status, 302, 'artifact download redirect'); return response; }
    assert(response.ok, `GitHub request failed (${response.status})`); return response.json();
  }
  async pages(path, key) {
    const items = []; let total;
    for (let page = 1; page <= 10; page++) {
      const data = await this.request(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      assert(Number.isSafeInteger(data.total_count) && data.total_count >= 0 && data.total_count < 1000, 'pagination uncertainty or API cap');
      if (total === undefined) total = data.total_count;
      same(data.total_count, total, 'pagination changed'); assert(Array.isArray(data[key]), 'page items');
      items.push(...data[key]);
      if (items.length === total) { same(new Set(items.map(i => i.id)).size, items.length, 'duplicate paginated ID'); return items; }
      assert(data[key].length === 100 && items.length < total, 'incomplete pagination');
    }
    throw new Error('pagination not exhausted');
  }
  async signedBytes(path, maxBytes) {
    const redirect = await this.request(path, true);
    const url = new URL(redirect.headers.get('location'));
    assert(url.protocol === 'https:' && !url.username && !url.password, 'unsafe signed download URL');
    const response = await this.fetcher(url.href, { redirect: 'error', signal: AbortSignal.timeout(60_000) });
    assert(response.ok, `signed storage request failed (${response.status})`);
    const chunks = []; let received = 0;
    for await (const chunk of response.body) { received += chunk.length; assert(received <= maxBytes, 'bounded storage response'); chunks.push(chunk); }
    assert(received > 0, 'nonempty storage response'); return Buffer.concat(chunks);
  }
  async download(id, digest, zipPath, destination) {
    assert(Number.isSafeInteger(id) && id > 0, 'download artifact ID');
    const redirect = await this.request(`/actions/artifacts/${id}/zip`, true);
    const url = new URL(redirect.headers.get('location'));
    assert(url.protocol === 'https:' && !url.username && !url.password, 'unsafe signed download URL');
    // Never forward the GitHub Authorization header to signed storage URLs.
    const response = await this.fetcher(url.href, { redirect: 'error', signal: AbortSignal.timeout(60_000) });
    assert(response.ok, `artifact storage request failed (${response.status})`);
    const size = Number(response.headers.get('content-length'));
    assert(Number.isSafeInteger(size) && size > 0 && size <= 512 * 1024 * 1024, 'bounded artifact length');
    const chunks = []; let received = 0;
    for await (const chunk of response.body) { received += chunk.length; assert(received <= size, 'artifact exceeds advertised size'); chunks.push(chunk); }
    same(received, size, 'complete download');
    const bytes = Buffer.concat(chunks); verifyDigest(bytes, digest); writeFileSync(zipPath, bytes); safeExtract(zipPath, destination);
  }
}
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
function context(env = process.env) {
  assert(/^[0-9a-f]{40}$/.test(env.GITHUB_SHA), 'full commit SHA required'); same(env.GITHUB_RUN_ATTEMPT, '1', 'current attempt');
  const result = { sha: env.GITHUB_SHA, repository: env.GITHUB_REPOSITORY, workflow: WORKFLOW, runID: Number(env.GITHUB_RUN_ID), attempt: 1, branch: env.GITHUB_REF_NAME, event: env.GITHUB_EVENT_NAME };
  assert(Number.isSafeInteger(result.runID) && result.runID > 0, 'current run ID');
  assert(['main', 'develop'].includes(result.branch) && result.event === 'push', 'release push context');
  same(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), result.sha, 'checkout SHA'); return result;
}
function releaseIdentity(repoRoot, sha) { return `coursecraft@${json(join(repoRoot, 'simgolf-lite/package.json')).version}+${sha.slice(0, 12)}`; }
export function verifyReceipt(receipt, ctx, pins, reports, m65, files, artifacts) {
  same(receipt.schema, 1, 'receipt schema'); same(receipt.sha, ctx.sha, 'receipt SHA'); same(receipt.repository, ctx.repository, 'receipt repository');
  same(receipt.workflow, WORKFLOW, 'receipt workflow'); same(receipt.attempt, 1, 'receipt attempt'); same(receipt.branch, 'develop', 'receipt branch');
  same(receipt.event, 'push', 'receipt event'); same(receipt.runID, ctx.runID, 'receipt run ID');
  same(receipt.sourcePins, pins, 'source pins'); same(receipt.reports, reports, 'recomputed reports'); same(receipt.m65, m65, 'M65 binding');
  same(receipt.files, files, 'raw file inventory'); same(receipt.artifacts, artifacts, 'immutable artifact metadata');
}
async function selected(api, ctx) {
  const run = selectRun(await api.pages(`/actions/workflows/ci.yml/runs?branch=develop&event=push&head_sha=${ctx.sha}`, 'workflow_runs'), ctx);
  const fresh = verifyRun(await api.request(`/actions/runs/${run.id}`), ctx); same(fresh.id, run.id, 'fresh run ID');
  verifyJobs(await api.pages(`/actions/runs/${run.id}/attempts/1/jobs`, 'jobs'), run); return run;
}
function downloadedEvidence(root) {
  return verifyReports(join(root, 'golden-path-e2e-report/playwright-report/index.html'), join(root, 'vision-player-career-e2e-report/vision-player-career-report/results.json'));
}
async function verifyPromotion(api, ctx, repoRoot, root, promotion) {
  same(promotion.production, ctx, 'production receipt context');
  const run = await selected(api, ctx); same(run.id, promotion.selectedRunID, 'selected run changed');
  const all = artifactSet(await api.pages(`/actions/runs/${run.id}/artifacts`, 'artifacts'), [...ARTIFACT_NAMES, 'release-receipt'], run);
  same(all, promotion.artifacts, 'selected artifact metadata changed');
  const receipt = json(join(root, 'release-receipt/release-receipt.json'));
  same(sha256(readFileSync(join(root, 'release-receipt/release-receipt.json'))), promotion.receiptSHA256, 'receipt raw bytes changed');
  const reports = downloadedEvidence(root), files = inventory(join(root, 'dist'));
  const m65 = m65Binding(repoRoot, join(root, 'm65-machine-certification/certification-report.json'));
  verifyReceipt(receipt, { ...ctx, runID: run.id }, sourcePins(repoRoot), reports, m65, files, Object.fromEntries(ARTIFACT_NAMES.map(n => [n, all[n]])));
  same(receipt.release, releaseIdentity(repoRoot, ctx.sha), 'release identity');
  verifyInventory(join(repoRoot, 'simgolf-lite/dist'), files);
  const bindings = debugBindings(join(root, 'dist')); same(receipt.sentry.debugBindings, bindings, 'Sentry debug binding receipt');
  same(receipt.sentry.scope, 'authenticated-build-debug-bindings; upload-log-verification-required-at-promotion', 'honest initial Sentry scope');
  same(receipt.sentry.uninstrumentedWorker, { type: 'Vite separate analysis worker', source: 'src/game/analysis/analysis.worker.ts', published: files.filter(f => /^assets\/analysis\.worker-[\w-]+\.js$/.test(f.path)) }, 'known worker source/type/raw file binding');
  const selectedJobs = await api.pages(`/actions/runs/${run.id}/attempts/1/jobs`, 'jobs');
  same(receipt.authenticatedBuild, initialBuild(selectedJobs, { ...ctx, runID: run.id }), 'authenticated successful initial Build metadata');
  const job = verifyJobs(selectedJobs, run);
  const log = await api.signedBytes(`/actions/jobs/${job.id}/logs`, 32 * 1024 * 1024);
  const sentry = verifySentryLog(log, job, receipt.release, bindings);
  if (promotion.sentry) same(promotion.sentry, sentry, 'Sentry provenance recheck'); else promotion.sentry = sentry;
  return receipt;
}
const DIAGNOSTIC_PHASES = new Set(['context', 'verify-reports', 'receipt-run', 'receipt-artifacts', 'receipt-release-identity', 'receipt-source-pins', 'receipt-build-metadata', 'receipt-reports', 'receipt-m65', 'receipt-inventory', 'receipt-worker-binding', 'receipt-debug-bindings', 'receipt-write', 'promotion']);
let diagnosticPhase = 'context';
function receiptPhase(phase, operation) { diagnosticPhase = phase; return operation(); }
export function failureDiagnostic(phase, error) {
  const safePhase = DIAGNOSTIC_PHASES.has(phase) ? phase : 'unknown';
  let category = 'verification';
  try {
    if (error?.code === 'ERR_ASSERTION') category = 'assertion';
    else if (error?.name === 'AbortError' || error?.name === 'TimeoutError') category = 'timeout';
    else if (error?.name === 'TypeError') category = 'type';
  } catch { /* Diagnostic property reads cannot expose a thrown value. */ }
  return `Artifact promotion verification failed; deployment is blocked. phase=${safePhase} error=${category}\n`;
}
async function main(mode) {
  const project = process.cwd(), repoRoot = resolve(project, '..');
  if (mode === 'verify-reports') {
    diagnosticPhase = 'verify-reports';
    verifyReports(join(project, 'playwright-report/index.html'), join(project, 'vision-player-career-report/results.json')); return;
  }
  const ctx = context(), api = new GitHub(ctx.repository, process.env.GH_TOKEN);
  if (mode === 'receipt') {
    const run = await receiptPhase('receipt-run', () => api.request(`/actions/runs/${ctx.runID}`));
    same(run.id, ctx.runID, 'current run ID'); same(run.head_sha, ctx.sha, 'current run SHA'); same(run.run_attempt, 1, 'current run attempt');
    const artifacts = await receiptPhase('receipt-artifacts', async () => artifactSet(await api.pages(`/actions/runs/${ctx.runID}/artifacts`, 'artifacts'), ARTIFACT_NAMES, run));
    const receipt = {
      schema: 1, ...ctx, release: receiptPhase('receipt-release-identity', () => releaseIdentity(repoRoot, ctx.sha)), sourcePins: receiptPhase('receipt-source-pins', () => sourcePins(repoRoot)),
      authenticatedBuild: await receiptPhase('receipt-build-metadata', async () => initialBuild(await api.pages(`/actions/runs/${ctx.runID}/attempts/1/jobs`, 'jobs'), ctx)),
      reports: receiptPhase('receipt-reports', () => verifyReports(join(project, 'playwright-report/index.html'), join(project, 'vision-player-career-report/results.json'))),
      m65: receiptPhase('receipt-m65', () => m65Binding(repoRoot, join(project, 'artifacts/m65/certification-report.json'))), artifacts, files: receiptPhase('receipt-inventory', () => inventory(join(project, 'dist'), true)),
      sentry: { scope: 'authenticated-build-debug-bindings; upload-log-verification-required-at-promotion', uninstrumentedWorker: { type: 'Vite separate analysis worker', source: 'src/game/analysis/analysis.worker.ts', published: receiptPhase('receipt-worker-binding', () => inventory(join(project, 'dist'), true).filter(f => /^assets\/analysis\.worker-[\w-]+\.js$/.test(f.path))) }, debugBindings: receiptPhase('receipt-debug-bindings', () => debugBindings(join(project, 'dist'))) },
    };
    diagnosticPhase = 'receipt-write';
    mkdirSync(join(project, 'release-evidence'), { recursive: true }); writeJson(join(project, 'release-evidence/release-receipt.json'), receipt); return;
  }
  diagnosticPhase = 'promotion';
  same(ctx.branch, 'main', 'production branch');
  const root = join(project, 'promotion-evidence');
  if (mode === 'promote') {
    const run = await selected(api, ctx);
    const artifacts = artifactSet(await api.pages(`/actions/runs/${run.id}/artifacts`, 'artifacts'), [...ARTIFACT_NAMES, 'release-receipt'], run);
    rmSync(root, { recursive: true, force: true }); mkdirSync(root);
    for (const [name, artifact] of Object.entries(artifacts)) await api.download(artifact.id, artifact.digest, join(root, `${name}.zip`), join(root, name));
    const promotion = { schema: 1, production: ctx, selectedRunID: run.id, artifacts, receiptSHA256: sha256(readFileSync(join(root, 'release-receipt/release-receipt.json'))) };
    // Install only the downloaded archive, then revalidate against its receipt.
    rmSync(join(project, 'dist'), { recursive: true, force: true });
    safeExtract(join(root, 'dist.zip'), join(project, 'dist'));
    await verifyPromotion(api, ctx, repoRoot, root, promotion);
    writeJson(join(root, 'promotion-receipt.json'), promotion); return;
  }
  same(mode, 'recheck', 'known promotion mode');
  await verifyPromotion(api, ctx, repoRoot, root, json(join(root, 'promotion-receipt.json')));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv[2]).catch(error => { process.stderr.write(failureDiagnostic(diagnosticPhase, error)); process.exitCode = 1; });
}
