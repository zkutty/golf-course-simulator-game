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
// The execution contract is deliberately exact: changing release commands,
// suppression, permissions or artifact semantics requires a reviewed update.
export const PRODUCER = 'Typecheck, lint, test, build';
export const QUALIFIER = 'Qualify completed producer artifacts';
export const BUILD_COMMAND = 'node scripts/biome-consumer-audit.mjs && tsc -b && vite build && node scripts/audit-audio-assets.mjs && node scripts/inject-sw-assets.mjs && node scripts/m35-asset-audit.mjs && node scripts/parkland-4x-asset-audit.mjs && node scripts/parkland-habitat-field-audit.mjs && node scripts/zk680-surface-budget.mjs && node scripts/zk680-delivery-evidence.mjs';
export const MARKER_COMMAND = String.raw`printf 'ZK1359_BUILD_V1 %s sha=%s run=%s attempt=%s job=%s\n'`;
const MARKER_ARGS = '"$GITHUB_SHA" "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" "$GITHUB_JOB"';
export const BUILD_SCRIPT = `${MARKER_COMMAND} BEGIN ${MARKER_ARGS}\nnpm run build\n${MARKER_COMMAND} END ${MARKER_ARGS}`;
const WORKFLOW_CONTRACT_SHA256 = '4e7c9454bb144f1caf54da49c9540441345f1b76e18612b79b1b138a8f0d6889';
const PACKAGE_CONTRACT_SHA256 = '1cf56ace41bc7610c24f6b375fa5909f5aee1e0ae6e68eb16f19ee1469e690d0';
export function verifyExecutionContract(repoRoot) {
  const workflow = readFileSync(join(repoRoot, WORKFLOW)), packageBytes = readFileSync(join(repoRoot, 'simgolf-lite/package.json'));
  same(sha256(workflow), WORKFLOW_CONTRACT_SHA256, 'reviewed unconditional producer/qualification/deployment workflow');
  same(sha256(packageBytes), PACKAGE_CONTRACT_SHA256, 'reviewed chained package build command');
  same(JSON.parse(packageBytes).scripts.build, BUILD_COMMAND, 'normal chained build execution');
  return { schema: 1, workflowSHA256: sha256(workflow), packageSHA256: sha256(packageBytes), buildScript: BUILD_SCRIPT, buildCommand: BUILD_COMMAND, producerJobKey: 'ci' };
}
export function verifyRunIdentity(run, context, branch = context.branch) {
  assert(Number.isSafeInteger(run.id) && run.id > 0, 'run ID');
  same(run.head_sha, context.sha, 'full SHA'); same(run.repository.full_name, context.repository, 'run repository');
  same(run.head_repository.full_name, context.repository, 'head repository'); same(run.path.split('@')[0], WORKFLOW, 'workflow path');
  same(run.head_branch, branch, 'branch'); same(run.event, 'push', 'event'); same(run.run_attempt, 1, 'attempt');
  assert(['queued', 'in_progress', 'completed'].includes(run.status), 'known run state');
  if (run.status === 'completed') same(run.conclusion, 'success', 'successful terminal qualification run');
  else same(run.conclusion, null, 'nonterminal run conclusion');
  return run;
}
function successfulJob(job, ctx, name) {
  same(job.name, name, 'job name'); same(job.run_id, ctx.runID, 'job run'); same(job.head_sha, ctx.sha, 'job SHA');
  same(job.run_attempt, 1, 'job attempt'); same(job.status, 'completed', 'job completion'); same(job.conclusion, 'success', 'job success');
  assert(Number.isSafeInteger(job.id) && job.id > 0, 'job ID');
  const start = Date.parse(job.started_at), end = Date.parse(job.completed_at);
  assert(Number.isFinite(start) && Number.isFinite(end) && end >= start, 'completed job timestamps');
  same(job.html_url, `https://github.com/${ctx.repository}/actions/runs/${ctx.runID}/job/${job.id}`, 'exact job URL');
  assert(Array.isArray(job.steps), 'observed job steps');
  same(new Set(job.steps.map(s => s.name)).size, job.steps.length, 'unique observed step names');
  same(new Set(job.steps.map(s => s.number)).size, job.steps.length, 'unique observed step numbers');
  assert(job.steps.every(s => typeof s.name === 'string' && Number.isSafeInteger(s.number) && s.number > 0), 'observed step identity');
  for (const step of job.steps) {
    assert(['completed', 'pending', 'in_progress'].includes(step.status), 'known step state');
    if (step.status === 'completed') same(step.conclusion, 'success', 'contradictory terminal step');
    else same(step.conclusion, null, 'incomplete step conclusion');
  }
  return job;
}
function uniqueJob(jobs, ctx, name) {
  const matches = jobs.filter(j => j.name === name); same(matches.length, 1, 'unique required job');
  return successfulJob(matches[0], ctx, name);
}
function producerObservation(jobs, ctx, direct) {
  const job = uniqueJob(jobs, ctx, PRODUCER);
  if (direct !== undefined) {
    successfulJob(direct, ctx, PRODUCER);
    for (const key of ['id', 'run_id', 'run_attempt', 'head_sha', 'name', 'status', 'conclusion', 'started_at', 'completed_at', 'html_url', 'steps']) same(direct[key], job[key], 'direct/attempt producer agreement');
  }
  const builds = job.steps.filter(s => s.name === 'Build'); assert(builds.length <= 1, 'unique Build step');
  const step = builds[0] ?? null;
  let kind;
  if (step?.status === 'completed') {
    same(step.conclusion, 'success', 'Build success');
    const start = Date.parse(step.started_at), end = Date.parse(step.completed_at);
    assert(Number.isFinite(start) && Number.isFinite(end) && end >= start, 'Build timestamps');
    assert(start >= Date.parse(job.started_at) && end <= Date.parse(job.completed_at), 'Build within producer timestamps');
    kind = 'github-completed-build-step-v1';
  } else {
    // Only the observed stalled Test frontier with a pending/null (or absent)
    // Build is eligible. Missing endpoints, arbitrary API errors and other
    // incomplete states never enter this route.
    assert(direct !== undefined, 'direct authenticated producer observation required');
    if (step) same(step, { name: 'Build', status: 'pending', conclusion: null, number: 19, started_at: null, completed_at: null }, 'allowlisted pending Build record');
    const names = ['Set up job', 'Run actions/checkout@v4', 'Run actions/setup-node@v4', 'Install dependencies', 'Typecheck', 'Lint (zero errors)', 'Test', 'Install Playwright Chromium', 'Pixi renderer ownership regression', 'Upload Pixi renderer ownership report', 'M65 machine certification', 'Upload verified M65 report', 'Golden-path E2E', 'Upload Golden-path E2E report', 'Vision Player Pro narrative regression', 'Upload Vision Player Pro narrative report', 'Verify exact first-attempt Golden and Vision reports', 'Artifact promotion contract tests', 'Build', 'Upload build artifact'];
    const numbered = job.steps.filter(s => s.number <= 20);
    same(numbered.length, step ? 20 : 19, 'known incomplete producer step inventory');
    for (let i = 0; i < names.length; i++) {
      if (i === 18 && !step) continue;
      const matches = numbered.filter(s => s.number === i + 1); same(matches.length, 1, 'unique observed step number');
      const observed = matches[0]; same(observed.name, names[i], 'known producer step identity');
      if (i < 6) {
        same(observed.status, 'completed', 'completed pre-Test frontier'); same(observed.conclusion, 'success', 'successful pre-Test frontier');
        assert(Number.isFinite(Date.parse(observed.started_at)) && Date.parse(observed.completed_at) >= Date.parse(observed.started_at), 'observed frontier timestamps');
      } else if (i === 6) {
        same(observed.status, 'in_progress', 'known stalled Test frontier'); same(observed.conclusion, null, 'stalled Test conclusion');
        assert(Number.isFinite(Date.parse(observed.started_at)), 'observed Test start'); same(observed.completed_at, null, 'stalled Test end');
      } else same(observed, { name: names[i], status: 'pending', conclusion: null, number: i + 1, started_at: null, completed_at: null }, 'known pending tail');
    }
    for (const tail of job.steps.filter(s => s.number > 20)) {
      assert(['Post Run actions/setup-node@v4', 'Post Run actions/checkout@v4', 'Complete job'].includes(tail.name), 'known producer cleanup step');
      same(tail.status, 'pending', 'stalled cleanup'); same(tail.conclusion, null, 'stalled cleanup conclusion');
      same(tail.started_at, null, 'stalled cleanup start'); same(tail.completed_at, null, 'stalled cleanup end');
    }
    kind = 'completed-producer-log-v1';
  }
  return { schema: 1, kind, producer: Object.fromEntries(['id', 'run_id', 'run_attempt', 'head_sha', 'name', 'status', 'conclusion', 'started_at', 'completed_at', 'html_url'].map(k => [k, job[k]])), apiObservations: { attemptSteps: job.steps, directSteps: direct?.steps ?? null }, step };
}
function terminalJobs(jobs, run, repository) {
  const ctx = { sha: run.head_sha, runID: run.id, repository };
  const job = uniqueJob(jobs, ctx, PRODUCER);
  uniqueJob(jobs, ctx, QUALIFIER); uniqueJob(jobs, ctx, 'Deploy tested artifact to Cloudflare playtest');
  return job;
}
export function verifyJobs(jobs, run, proof) {
  verifyRun(run, { sha: run.head_sha, repository: run.repository.full_name });
  const job = terminalJobs(jobs, run, run.repository.full_name);
  const ctx = { sha: run.head_sha, runID: run.id, repository: run.repository.full_name };
  if (proof) {
    verifyBuildProofShape(proof); same(proof.producer, Object.fromEntries(Object.keys(proof.producer).map(k => [k, job[k]])), 'proof exact producer observation');
    same(proof.apiObservations.attemptSteps, job.steps, 'proof unchanged attempt observation');
  } else initialBuild(jobs, ctx);
  return job;
}
export function initialBuild(jobs, ctx, options = {}) {
  const observed = producerObservation(jobs, ctx, options.direct);
  if (!options.log) { same(observed.kind, 'github-completed-build-step-v1', 'completed API Build required without log proof'); return observed; }
  const execution = verifyExecutionContract(options.repoRoot);
  const completedLog = verifyCompletedProducerLog(options.log, observed.producer, ctx, execution, options.dist, options.distZIP);
  if (observed.kind === 'github-completed-build-step-v1') {
    assert(Date.parse(completedLog.build.begin.timestamp) >= Date.parse(observed.step.started_at) && Date.parse(completedLog.build.end.timestamp) < providerEndExclusive(observed.step.completed_at), 'markers within actual API Build window');
  }
  const proof = { ...observed, execution, completedLog };
  proof.sentry = verifySentryLog(options.log, { ...observed.producer, steps: observed.apiObservations.attemptSteps }, options.release, options.bindings, proof);
  verifyBuildProofShape(proof); return proof;
}
export function verifyBuildProofShape(proof) {
  same(Object.keys(proof).sort(), ['schema', 'kind', 'producer', 'apiObservations', 'step', 'execution', 'completedLog', 'sentry'].sort(), 'exact typed proof fields');
  same(proof.schema, 1, 'build proof schema'); assert(['github-completed-build-step-v1', 'completed-producer-log-v1'].includes(proof.kind), 'typed build proof kind');
  same(proof.producer.status, 'completed', 'proof completed producer'); same(proof.producer.conclusion, 'success', 'proof successful producer');
  same(proof.producer.run_attempt, 1, 'proof producer attempt');
  same(proof.producer.name, PRODUCER, 'proof producer identity'); assert(/^[0-9a-f]{40}$/.test(proof.producer.head_sha), 'proof full source SHA');
  assert(Number.isSafeInteger(proof.producer.id) && proof.producer.id > 0 && Number.isSafeInteger(proof.producer.run_id) && proof.producer.run_id > 0, 'proof run/job identity');
  assert(Array.isArray(proof.apiObservations.attemptSteps) && Array.isArray(proof.apiObservations.directSteps), 'retained authentic dual API observations');
  same(proof.apiObservations.attemptSteps, proof.apiObservations.directSteps, 'unchanged dual API observations');
  if (proof.kind === 'github-completed-build-step-v1') {
    same(proof.step.status, 'completed', 'real completed Build record'); same(proof.step.conclusion, 'success', 'real successful Build record');
    assert(Number.isFinite(Date.parse(proof.step.started_at)) && Date.parse(proof.step.completed_at) >= Date.parse(proof.step.started_at), 'real ordered Build timestamps');
  } else {
    assert(proof.step === null || (proof.step.status === 'pending' && proof.step.conclusion === null && proof.step.started_at === null && proof.step.completed_at === null), 'truthful incomplete Build record');
  }
  same(proof.step, proof.apiObservations.attemptSteps.find(s => s.name === 'Build') ?? null, 'provider Build record retained verbatim');
  same(proof.execution.schema, 1, 'execution contract schema'); same(proof.execution.workflowSHA256, WORKFLOW_CONTRACT_SHA256, 'proof workflow contract');
  same(proof.execution.packageSHA256, PACKAGE_CONTRACT_SHA256, 'proof package contract');
  same(proof.execution.buildScript, BUILD_SCRIPT, 'proof unchanged shell execution'); same(proof.execution.buildCommand, BUILD_COMMAND, 'proof unchanged build chain'); same(proof.execution.producerJobKey, 'ci', 'proof marker job key');
  same(proof.completedLog.schema, 1, 'completed log proof schema'); assert(/^[0-9a-f]{64}$/.test(proof.completedLog.rawSHA256), 'raw completed log digest');
  assert(Number.isSafeInteger(proof.completedLog.bytes) && proof.completedLog.bytes > 0 && proof.completedLog.bytes <= 32 * 1024 * 1024, 'proof bounded full log');
  same(proof.completedLog.endpoint, `/actions/jobs/${proof.producer.id}/logs`, 'proof exact job log endpoint');
  const points = [proof.completedLog.build.group, proof.completedLog.build.begin, proof.completedLog.build.end, proof.completedLog.upload.begin, proof.completedLog.upload.finalized, proof.completedLog.upload.end, proof.completedLog.cleanup];
  for (const [i, point] of points.entries()) {
    assert(Number.isSafeInteger(point.line) && point.line > 0 && Number.isSafeInteger(point.byteOffset) && point.byteOffset >= 0 && point.byteOffset < proof.completedLog.bytes && Number.isFinite(Date.parse(point.timestamp)), 'observed log point');
    if (i) assert(point.line > points[i - 1].line && point.byteOffset > points[i - 1].byteOffset, 'ordered observed log offsets');
  }
  same(proof.completedLog.upload.artifact.name, 'dist', 'proof original artifact name'); same(proof.completedLog.upload.artifact.path, 'simgolf-lite/dist', 'proof original artifact path');
  assert(/^sha256:[0-9a-f]{64}$/.test(proof.completedLog.upload.artifact.digest), 'proof immutable artifact digest');
  same(proof.sentry.schema, 1, 'Sentry proof schema'); same(proof.sentry.proofKind, proof.kind, 'Sentry typed proof route');
  same(proof.sentry.jobID, proof.producer.id, 'Sentry producer identity'); same(proof.sentry.runID, proof.producer.run_id, 'Sentry run identity'); same(proof.sentry.attempt, 1, 'Sentry attempt');
  same(proof.sentry.rawLogSHA256, proof.completedLog.rawSHA256, 'Sentry raw log binding');
}
// A provider timestamp with whole seconds reports that second at its native
// resolution. Preserve the real timestamp; this exclusive bound only compares
// the finer log timestamps and does not invent a provider completion time.
function providerEndExclusive(timestamp) {
  const fraction = timestamp.match(/\.(\d+)Z$/)?.[1];
  return Date.parse(timestamp) + (fraction ? Math.max(1, 1000 / 10 ** fraction.length) : 1000);
}
export function parsedLog(bytes) {
  assert(bytes.length > 0 && bytes.length <= 32 * 1024 * 1024, 'bounded nonempty completed log');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assert(text.endsWith('\n') && !text.includes('\0') && !text.includes('\r'), 'complete strict log encoding');
  // These are the unchanged workflow's three multiline upload inputs. Only
  // their ordinary action-input echo may contain untimestamped physical rows.
  // Keep those rows on the timestamped path record, with a null timestamp and
  // exact raw offsets; they can never serve as temporal/provenance evidence.
  const sourcePaths = {
    'pixi-peer-ownership-e2e-report': ['simgolf-lite/pixi-peer-ownership-report', 'simgolf-lite/pixi-peer-ownership-test-results'],
    'golden-path-e2e-report': ['simgolf-lite/playwright-report', 'simgolf-lite/test-results'],
    'vision-player-career-e2e-report': ['simgolf-lite/vision-player-career-report', 'simgolf-lite/vision-player-career-test-results', 'simgolf-lite/vision-player-career-evidence'],
  };
  const inputTail = ['  if-no-files-found: ignore', '  retention-days: 14', '  compression-level: 6', '  overwrite: false', '  include-hidden-files: false', '##[endgroup]'];
  let offset = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0, prior = '', echo = null, pending = null;
  const lines = [], point = line => ({ line: line.line, byteOffset: line.byteOffset, timestamp: line.timestamp });
  for (const [index, raw] of text.slice(0, -1).split('\n').entries()) {
    const physicalLine = index + 1, byteOffset = offset, byteLength = Buffer.byteLength(raw) + 1; offset += byteLength;
    const match = raw.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,9}Z) (.*)$/);
    if (!match) {
      assert(pending && pending.continuationIndex < pending.continuations.length, 'source-bound untimed path continuation required');
      same(raw, pending.continuations[pending.continuationIndex], 'exact source-bound upload path continuation');
      pending.parent.continuations.push({ line: physicalLine, byteOffset, byteLength, timestamp: null, text: raw, source: { workflow: WORKFLOW, action: 'actions/upload-artifact@v4', artifact: pending.artifact, groupLine: pending.group.line, pathLine: pending.parent.line, kind: raw === '' ? 'input-terminator' : 'path', pathIndex: raw === '' ? null : pending.continuationIndex + 1 } });
      pending.continuationIndex++; continue;
    }
    const time = Date.parse(match[1]);
    const chronology = match[1].replace(/\.(\d+)Z$/, (_, digits) => `.${digits.padEnd(9, '0')}Z`);
    assert(Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === match[1].slice(0, 19) && chronology >= prior, 'ordered log chronology'); prior = chronology;
    const line = { line: physicalLine, byteOffset, timestamp: match[1], text: match[2].replace(/\x1b\[[0-9;]*m/g, '') };
    assert(!/[\x00-\x08\x0b-\x1f\x7f]/.test(line.text), 'log control characters'); lines.push(line);
    if (pending) {
      same(pending.continuationIndex, pending.continuations.length, 'complete source-bound path continuation sequence');
      same(line.text, inputTail[pending.tailIndex], 'complete normal upload input echo');
      pending.tailIndex++;
      if (pending.tailIndex === inputTail.length) { pending.parent.sourceEcho.completed = point(line); pending = null; }
      continue;
    }
    if (echo?.phase === 'with' && line.text === 'with:') { echo.phase = 'name'; echo.with = point(line); continue; }
    if (echo?.phase === 'name') {
      const name = line.text.match(/^  name: (.+)$/)?.[1];
      if (Object.hasOwn(sourcePaths, name)) { echo.phase = 'path'; echo.artifact = name; echo.name = point(line); continue; }
    }
    if (echo?.phase === 'path' && line.text === `  path: ${sourcePaths[echo.artifact][0]}`) {
      line.continuations = [];
      line.sourceEcho = { workflow: WORKFLOW, action: 'actions/upload-artifact@v4', artifact: echo.artifact, paths: sourcePaths[echo.artifact], group: echo.group, with: echo.with, name: echo.name };
      pending = { parent: line, artifact: echo.artifact, group: echo.group, continuations: [...sourcePaths[echo.artifact].slice(1), ''], continuationIndex: 0, tailIndex: 0 }; echo = null; continue;
    }
    echo = line.text === '##[group]Run actions/upload-artifact@v4' ? { phase: 'with', group: point(line) } : null;
  }
  assert(!pending, 'nontruncated source-bound upload input echo');
  return lines;
}
export function verifyCompletedProducerLog(bytes, producer, ctx, execution, dist, distZIP) {
  same(producer.status, 'completed', 'completed log producer'); same(producer.conclusion, 'success', 'successful log producer');
  same(producer.head_sha, ctx.sha, 'log producer SHA'); same(producer.run_id, ctx.runID, 'log producer run'); same(producer.run_attempt, 1, 'log producer attempt');
  same(execution.buildScript, BUILD_SCRIPT, 'reviewed marker command'); same(execution.buildCommand, BUILD_COMMAND, 'reviewed build command');
  same(execution.workflowSHA256, WORKFLOW_CONTRACT_SHA256, 'reviewed log workflow'); same(execution.packageSHA256, PACKAGE_CONTRACT_SHA256, 'reviewed log package');
  const lines = parsedLog(bytes);
  assert(/^Current runner version: /.test(lines[0].text), 'full producer log starts with runner setup');
  assert(lines.every(l => Date.parse(l.timestamp) >= Date.parse(producer.started_at) && Date.parse(l.timestamp) < providerEndExclusive(producer.completed_at)), 'log within genuine producer window');
  assert(!lines.some(l => /##\[error\]|Process completed with exit code [1-9]|The operation was canceled/.test(l.text)), 'no contradictory completed job errors');
  const exact = text => { const matches = lines.filter(l => l.text === text); same(matches.length, 1, 'unique log evidence'); return matches[0]; };
  const marker = edge => `ZK1359_BUILD_V1 ${edge} sha=${ctx.sha} run=${ctx.runID} attempt=1 job=ci`;
  const begin = exact(marker('BEGIN')), end = exact(marker('END')); assert(begin.line < end.line, 'ordered build markers');
  const groupText = `##[group]Run ${BUILD_SCRIPT.split('\n')[0]}`;
  const group = exact(groupText);
  assert(group.line < begin.line, 'actual build command before begin marker');
  const echoBegin = exact(BUILD_SCRIPT.split('\n')[0]), echoBuild = exact('npm run build'), echoEnd = exact(BUILD_SCRIPT.split('\n')[2]);
  assert(group.line < echoBegin.line && echoBegin.line < echoBuild.line && echoBuild.line < echoEnd.line && echoEnd.line < begin.line, 'unique unchanged normal build command echo');
  const close = lines.filter(l => l.line > echoEnd.line && l.line < begin.line && l.text === '##[endgroup]'); same(close.length, 1, 'build command echo group closure');
  assert(!lines.some(l => l.line > begin.line && l.line < end.line && /^##\[(?:group|endgroup)\]/.test(l.text)), 'no nested or spoofed build boundary');
  const permitted = new Set([group.line, echoBegin.line, echoEnd.line, begin.line, end.line]);
  assert(!lines.some(l => l.text.includes('ZK1359_BUILD_V1') && !permitted.has(l.line)), 'no duplicate or spoofed markers');
  const command = exact(`> ${BUILD_COMMAND}`); assert(command.line > begin.line && command.line < end.line, 'actual package build execution within markers');
  const uploadGroups = lines.filter(l => l.line > end.line && l.text.startsWith('##[group]'));
  assert(uploadGroups.length > 0, 'following upload action'); const upload = uploadGroups[0]; same(upload.text, '##[group]Run actions/upload-artifact@v4', 'immediately following normal upload');
  assert(lines.filter(l => l.line > end.line && l.line < upload.line).every(l => !l.text.trim()), 'no post-build artifact mutation command');
  const next = uploadGroups[1]?.line ?? lines.at(-1).line + 1;
  const uploadLines = lines.filter(l => l.line >= upload.line && l.line < next);
  const uploadExact = text => { const matches = uploadLines.filter(l => l.text === text); same(matches.length, 1, 'unique dist upload evidence'); return matches[0]; };
  const uploadClose = uploadExact('##[endgroup]');
  for (const text of ['  name: dist', '  path: simgolf-lite/dist', '  retention-days: 7', '  overwrite: false', '  include-hidden-files: false']) assert(uploadExact(text).line < uploadClose.line, 'normal immutable upload inputs');
  assert(!uploadLines.some(l => l.text === '  overwrite: true' || l.text === '  include-hidden-files: true'), 'unmutated dist upload settings');
  assert(Number.isSafeInteger(dist.size) && dist.size > 0, 'API artifact ZIP size');
  same(distZIP.length, dist.size, 'independent raw ZIP size'); verifyDigest(distZIP, dist.digest);
  const digest = uploadExact(`SHA256 digest of uploaded artifact zip is ${dist.digest.slice(7)}`);
  const finalization = uploadExact(`Artifact dist.zip successfully finalized. Artifact ID ${dist.id}`);
  const success = uploadExact(`Artifact dist has been successfully uploaded! Final size is ${dist.size} bytes. Artifact ID is ${dist.id}`);
  const url = uploadExact(`Artifact download URL: https://github.com/${ctx.repository}/actions/runs/${ctx.runID}/artifacts/${dist.id}`);
  assert(uploadClose.line < digest.line && digest.line < finalization.line && finalization.line < success.line && success.line < url.line, 'ordered actual artifact finalization');
  const cleanup = exact('Cleaning up orphan processes'); assert(cleanup.line > url.line, 'full completed producer cleanup tail');
  assert(!lines.filter(l => l.line >= next).some(l => /name: dist|Artifact dist(?:\.zip)? |npm run build|ZK1359_BUILD_V1/.test(l.text)), 'no later producer build or dist upload');
  const point = l => ({ line: l.line, byteOffset: l.byteOffset, timestamp: l.timestamp });
  return { schema: 1, scope: 'authenticated-full-completed-producer-job-log; markers are execution evidence, not provider step metadata', rawSHA256: sha256(bytes), bytes: bytes.length, endpoint: `/actions/jobs/${producer.id}/logs`, build: { group: point(group), begin: point(begin), end: point(end) }, upload: { begin: point(upload), finalized: point(finalization), end: point(url), artifact: { name: 'dist', path: 'simgolf-lite/dist', ...dist } }, cleanup: point(cleanup) };
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
    assert(Number.isSafeInteger(a.size_in_bytes), 'artifact size integer');
    result[name] = { id: a.id, digest: a.digest, size: a.size_in_bytes };
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
export function verifySentryLog(bytes, job, release, bindings, proof) {
  let lines;
  if (proof) {
    same(sha256(bytes), proof.completedLog.rawSHA256, 'full Sentry log digest');
    const allLines = parsedLog(bytes);
    lines = allLines.filter(l => l.line > proof.completedLog.build.begin.line && l.line < proof.completedLog.build.end.line);
    const buildLines = new Set(lines.map(l => l.line));
    assert(!allLines.some(l => /^(?:> Release:|> Upload type:|Source Map Upload Report|\[sentry-vite-plugin\] Info: Successfully uploaded source maps to Sentry)/.test(l.text) && !buildLines.has(l.line)), 'Sentry upload evidence only within actual Build');
    assert(!allLines.some(l => l.text.includes('debug id ') && !buildLines.has(l.line)), 'debug upload evidence only within actual Build');
    if (proof.kind === 'github-completed-build-step-v1') {
      const start = Date.parse(proof.step.started_at), end = providerEndExclusive(proof.step.completed_at);
      assert(lines.every(l => Date.parse(l.timestamp) >= start && Date.parse(l.timestamp) < end), 'actual API Build timestamps');
    } else same(proof.kind, 'completed-producer-log-v1', 'Sentry proof route');
  } else {
    // Kept for the real API-step verifier and its original negative controls.
    const build = job.steps.find(s => s.name === 'Build');
    assert(build && build.conclusion === 'success', 'successful Build step');
    const start = Date.parse(build.started_at), end = Date.parse(build.completed_at);
    assert(Number.isFinite(start) && Number.isFinite(end) && end >= start, 'Build timestamps');
    lines = parsedLog(bytes).filter(l => Date.parse(l.timestamp) >= start && Date.parse(l.timestamp) <= end);
  }
  const exact = text => { const found = lines.filter(l => l.text === text); same(found.length, 1, 'unique Sentry build evidence'); return found[0]; };
  const uploaded = exact('[sentry-vite-plugin] Info: Successfully uploaded source maps to Sentry');
  const bundle = exact('> Upload type: artifact bundle'), releaseLine = exact(`> Release: ${release}`);
  same(lines.filter(l => l.text.startsWith('> Release:')).length, 1, 'unique actual release');
  same(lines.filter(l => l.text.startsWith('> Upload type:')).length, 1, 'unique actual bundle');
  const debugLines = lines.filter(l => /debug id /.test(l.text));
  for (const { debugID } of bindings) assert(debugLines.some(l => l.text.endsWith(`debug id ${debugID})`)), 'uploaded debug ID');
  if (proof) {
    const report = exact('Source Map Upload Report'), scripts = exact('  Scripts'), maps = exact('  Source Maps');
    assert(releaseLine.line < report.line && bundle.line < report.line && report.line < scripts.line && scripts.line < maps.line && maps.line < uploaded.line, 'ordered Sentry upload report');
    const expected = bindings.map(b => b.debugID).sort();
    const actualIDs = (from, to, kind) => lines.filter(l => l.line > from && l.line < to && l.text.includes('debug id ')).map(l => {
      const pattern = kind === 'script' ? /^    ~\/[^\s]+\.js \(sourcemap at [^\s]+\.js\.map, debug id ([0-9a-f-]{36})\)$/ : /^    ~\/[^\s]+\.js\.map \(debug id ([0-9a-f-]{36})\)$/;
      const match = l.text.match(pattern); assert(match, 'actual uploaded script/map debug record'); return match[1];
    }).sort();
    same(actualIDs(scripts.line, maps.line, 'script'), expected, 'exact uploaded script debug IDs');
    same(actualIDs(maps.line, uploaded.line, 'map'), expected, 'exact uploaded map debug IDs');
    same(debugLines.length, bindings.length * 2, 'no duplicate or outside uploaded debug records');
  }
  return { schema: 1, scope: 'authenticated-completed-producer-build-upload-provenance; no remote Sentry retrieval', proofKind: proof?.kind ?? 'github-completed-build-step-v1', jobID: job.id, runID: job.run_id, attempt: 1, rawLogSHA256: sha256(bytes), release, debugBindings: bindings };
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
  async download(id, digest, zipPath, destination, expectedSize) {
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
    if (expectedSize !== undefined) same(size, expectedSize, 'API/download raw ZIP size');
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
  same(receipt.schema, 2, 'receipt schema'); same(receipt.sha, ctx.sha, 'receipt SHA'); same(receipt.repository, ctx.repository, 'receipt repository');
  same(receipt.workflow, WORKFLOW, 'receipt workflow'); same(receipt.attempt, 1, 'receipt attempt'); same(receipt.branch, 'develop', 'receipt branch');
  same(receipt.event, 'push', 'receipt event'); same(receipt.runID, ctx.runID, 'receipt run ID');
  same(receipt.sourcePins, pins, 'source pins'); same(receipt.reports, reports, 'recomputed reports'); same(receipt.m65, m65, 'M65 binding');
  same(receipt.files, files, 'raw file inventory'); same(receipt.artifacts, artifacts, 'immutable artifact metadata');
  verifyBuildProofShape(receipt.authenticatedBuild);
}
async function selected(api, ctx) {
  const run = selectRun(await api.pages(`/actions/workflows/ci.yml/runs?branch=develop&event=push&head_sha=${ctx.sha}`, 'workflow_runs'), ctx);
  const fresh = verifyRun(await api.request(`/actions/runs/${run.id}`), ctx); same(fresh.id, run.id, 'fresh run ID');
  terminalJobs(await api.pages(`/actions/runs/${run.id}/attempts/1/jobs`, 'jobs'), run, ctx.repository); return run;
}
function downloadedEvidence(root) {
  return verifyReports(join(root, 'golden-path-e2e-report/playwright-report/index.html'), join(root, 'vision-player-career-e2e-report/vision-player-career-report/results.json'));
}
// Artifact reports contain legitimate hidden Playwright files. Only the dist
// publication inventory applies the stricter hidden-file policy above.
function artifactTree(directory) {
  const files = [];
  function walk(relative = '') {
    for (const name of readdirSync(join(directory, relative)).sort()) {
      const path = relative ? `${relative}/${name}` : name, info = lstatSync(join(directory, path));
      assert(!info.isSymbolicLink(), 'symlink in retained artifact');
      if (info.isDirectory()) { files.push({ path, kind: 'directory' }); walk(path); }
      else { assert(info.isFile(), 'regular retained artifact'); files.push({ path, bytes: info.size, sha256: sha256(readFileSync(join(directory, path))) }); }
    }
  }
  walk(); return files;
}

export async function verifyPromotion(api, ctx, repoRoot, root, promotion) {
  same(promotion.schema, 2, 'promotion schema');
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
  same(receipt.sentry.scope, 'qualified-completed-producer-upload; no remote Sentry retrieval', 'honest qualified Sentry scope');
  same(receipt.sentry.uninstrumentedWorker, { type: 'Vite separate analysis worker', source: 'src/game/analysis/analysis.worker.ts', published: files.filter(f => /^assets\/analysis\.worker-[\w-]+\.js$/.test(f.path)) }, 'known worker source/type/raw file binding');
  // Recheck every retained ZIP independently, including reports and receipt.
  for (const [name, artifact] of Object.entries(all)) {
    const bytes = readFileSync(join(root, `${name}.zip`)); same(bytes.length, artifact.size, 'retained raw ZIP size'); verifyDigest(bytes, artifact.digest);
    const freshRoot = join(root, `recheck-${name}`); rmSync(freshRoot, { recursive: true, force: true });
    safeExtract(join(root, `${name}.zip`), freshRoot);
    same(artifactTree(freshRoot), artifactTree(join(root, name)), 'raw extracted artifact bytes unchanged');
    rmSync(freshRoot, { recursive: true, force: true });
  }
  const selectedJobs = await api.pages(`/actions/runs/${run.id}/attempts/1/jobs`, 'jobs');
  const job = terminalJobs(selectedJobs, run, ctx.repository);
  const direct = await api.request(`/actions/jobs/${job.id}`);
  const log = await api.signedBytes(`/actions/jobs/${job.id}/logs`, 32 * 1024 * 1024);
  const proof = initialBuild(selectedJobs, { ...ctx, runID: run.id }, { direct, log, repoRoot, dist: all.dist, distZIP: readFileSync(join(root, 'dist.zip')), release: receipt.release, bindings });
  same(receipt.authenticatedBuild, proof, 'recomputed truthful producer proof');
  verifyJobs(selectedJobs, run, proof);
  same(receipt.sentry.upload, proof.sentry, 'qualified Sentry upload proof');
  if (promotion.sentry) same(promotion.sentry, proof.sentry, 'Sentry provenance recheck'); else promotion.sentry = proof.sentry;
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
    // Q consumes a completed-success P; the enclosing run and D may still be
    // active. No producer rebuild, report regeneration or artifact re-upload.
    const run = verifyRunIdentity(await receiptPhase('receipt-run', () => api.request(`/actions/runs/${ctx.runID}`)), ctx);
    same(run.id, ctx.runID, 'current qualification run ID');
    const jobs = await receiptPhase('receipt-build-metadata', () => api.pages(`/actions/runs/${ctx.runID}/attempts/1/jobs`, 'jobs'));
    const producer = uniqueJob(jobs, ctx, PRODUCER);
    const direct = await receiptPhase('receipt-build-metadata', () => api.request(`/actions/jobs/${producer.id}`));
    const artifacts = await receiptPhase('receipt-artifacts', async () => artifactSet(await api.pages(`/actions/runs/${ctx.runID}/artifacts`, 'artifacts'), ARTIFACT_NAMES, run));
    const root = join(project, 'release-evidence'); rmSync(root, { recursive: true, force: true }); mkdirSync(root);
    for (const [name, artifact] of Object.entries(artifacts)) await receiptPhase('receipt-artifacts', () => api.download(artifact.id, artifact.digest, join(root, `${name}.zip`), join(root, name), artifact.size));
    const files = receiptPhase('receipt-inventory', () => inventory(join(root, 'dist')));
    const bindings = receiptPhase('receipt-debug-bindings', () => debugBindings(join(root, 'dist')));
    const release = receiptPhase('receipt-release-identity', () => releaseIdentity(repoRoot, ctx.sha));
    const log = await receiptPhase('receipt-build-metadata', () => api.signedBytes(`/actions/jobs/${producer.id}/logs`, 32 * 1024 * 1024));
    const authenticatedBuild = receiptPhase('receipt-build-metadata', () => initialBuild(jobs, ctx, { direct, log, repoRoot, dist: artifacts.dist, distZIP: readFileSync(join(root, 'dist.zip')), release, bindings }));
    const receipt = {
      schema: 2, ...ctx, release, sourcePins: receiptPhase('receipt-source-pins', () => sourcePins(repoRoot)), authenticatedBuild,
      reports: receiptPhase('receipt-reports', () => downloadedEvidence(root)),
      m65: receiptPhase('receipt-m65', () => m65Binding(repoRoot, join(root, 'm65-machine-certification/certification-report.json'))), artifacts, files,
      sentry: { scope: 'qualified-completed-producer-upload; no remote Sentry retrieval', uninstrumentedWorker: { type: 'Vite separate analysis worker', source: 'src/game/analysis/analysis.worker.ts', published: receiptPhase('receipt-worker-binding', () => files.filter(f => /^assets\/analysis\.worker-[\w-]+\.js$/.test(f.path))) }, debugBindings: bindings, upload: authenticatedBuild.sentry },
    };
    // Reauthenticate identity/artifact bindings before emitting the Q result.
    const freshRun = verifyRunIdentity(await api.request(`/actions/runs/${ctx.runID}`), ctx); same(freshRun.id, run.id, 'qualification run unchanged');
    same(artifactSet(await api.pages(`/actions/runs/${ctx.runID}/artifacts`, 'artifacts'), ARTIFACT_NAMES, freshRun), artifacts, 'qualification artifacts unchanged');
    diagnosticPhase = 'receipt-write'; writeJson(join(root, 'release-receipt.json'), receipt);
    assert(process.env.GITHUB_OUTPUT, 'qualification output file');
    writeFileSync(process.env.GITHUB_OUTPUT, `dist-id=${artifacts.dist.id}\n`, { flag: 'a' }); return;
  }
  diagnosticPhase = 'promotion';
  same(ctx.branch, 'main', 'production branch');
  const root = join(project, 'promotion-evidence');
  if (mode === 'promote') {
    const run = await selected(api, ctx);
    const artifacts = artifactSet(await api.pages(`/actions/runs/${run.id}/artifacts`, 'artifacts'), [...ARTIFACT_NAMES, 'release-receipt'], run);
    rmSync(root, { recursive: true, force: true }); mkdirSync(root);
    for (const [name, artifact] of Object.entries(artifacts)) await api.download(artifact.id, artifact.digest, join(root, `${name}.zip`), join(root, name), artifact.size);
    const promotion = { schema: 2, production: ctx, selectedRunID: run.id, artifacts, receiptSHA256: sha256(readFileSync(join(root, 'release-receipt/release-receipt.json'))) };
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
