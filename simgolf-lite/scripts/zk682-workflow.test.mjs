import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { verifyZk682WorkflowReport } from "./zk682-workflow-verdict.mjs";

const COMMIT = "a".repeat(40);
const workflowPath = fileURLToPath(new URL("../../.github/workflows/zk682-certification.yml", import.meta.url));
const workflow = readFileSync(workflowPath, "utf8");
const jobsText = workflow.split("\njobs:\n")[1];

function jobBlock(jobId, nextJobId) {
  const start = jobsText.indexOf(`  ${jobId}:\n`);
  assert.notEqual(start, -1, `missing ${jobId} job`);
  const end = nextJobId ? jobsText.indexOf(`  ${nextJobId}:\n`, start + 1) : jobsText.length;
  assert.notEqual(end, -1, `missing ${nextJobId} job boundary`);
  return jobsText.slice(start, end);
}

test("workflow is manual-only and requires one full candidate input", () => {
  const triggers = workflow.slice(0, workflow.indexOf("\npermissions:"));
  assert.match(triggers, /workflow_dispatch:\n    inputs:\n      candidate_sha:/);
  assert.match(triggers, /candidate_sha:[\s\S]*?required: true[\s\S]*?type: string/);
  assert.doesNotMatch(triggers, /^  (?:push|pull_request|schedule):/m);
  assert.doesNotMatch(workflow.split("\n  renderer-recording-ablation:\n")[0], /github\.sha|GITHUB_SHA/);
});

test("every job checks out, verifies, and binds the requested full SHA", () => {
  const jobs = [["linux-evidence", "native-evidence"], ["native-evidence", "aggregate"], ["aggregate", null]];
  for (const [jobId, nextJobId] of jobs) {
    const block = jobBlock(jobId, nextJobId);
    assert.match(block, /ZK682_EXPECTED_COMMIT: \$\{\{ inputs\.candidate_sha \}\}/);
    assert.match(block, /uses: actions\/checkout@v4[\s\S]*?ref: \$\{\{ inputs\.candidate_sha \}\}/);
    assert.match(block, /Verify exact candidate checkout[\s\S]*?\^\[0-9a-f\]\{40\}\$[\s\S]*?git rev-parse HEAD/);
  }
});

test("Windows disables checkout newline conversion before the native checkout", () => {
  const native = jobBlock("native-evidence", "aggregate");
  const normalization = native.indexOf("- name: Disable Windows checkout newline conversion");
  const checkout = native.indexOf("- name: Checkout exact candidate");
  assert.notEqual(normalization, -1);
  assert.notEqual(checkout, -1);
  assert(normalization < checkout, "Windows newline normalization must run before checkout");
  assert.match(native.slice(normalization, checkout), /if: runner\.os == 'Windows'[\s\S]*?working-directory: \$\{\{ github\.workspace \}\}[\s\S]*?git config --global core\.autocrlf false/);
});

test("same-run aggregation names and retention are exact", () => {
  const linux = jobBlock("linux-evidence", "native-evidence");
  const native = jobBlock("native-evidence", "aggregate");
  const aggregate = jobBlock("aggregate", null);
  assert.match(linux, /name: zk682-linux-evidence-\$\{\{ inputs\.candidate_sha \}\}[\s\S]*?retention-days: 90/);
  assert.match(native, /name: zk682-native-evidence-\$\{\{ matrix\.platform \}\}-\$\{\{ matrix\.architecture \}\}-\$\{\{ inputs\.candidate_sha \}\}[\s\S]*?retention-days: 90/);
  assert.match(native, /name: coursecraft-\$\{\{ matrix\.platform \}\}-\$\{\{ matrix\.architecture \}\}-unsigned-\$\{\{ inputs\.candidate_sha \}\}[\s\S]*?retention-days: 30/);
  for (const name of [
    "zk682-linux-evidence-${{ inputs.candidate_sha }}",
    "zk682-native-evidence-darwin-arm64-${{ inputs.candidate_sha }}",
    "zk682-native-evidence-win32-x64-${{ inputs.candidate_sha }}",
  ]) assert.ok(aggregate.includes(`name: ${name}`));
  assert.match(aggregate, /npm run release:build:zk682/);
  assert.match(aggregate, /name: zk682-certification-packet-\$\{\{ inputs\.candidate_sha \}\}[\s\S]*?retention-days: 90/);
  assert.match(aggregate, /if: always\(\)[\s\S]*?Require passing machine gates and physical-only blockers/);
});

test("workflow verdict accepts GO or a physical-only HOLD", () => {
  const hold = verifyZk682WorkflowReport({ candidateCommit: COMMIT, machinePassed: true, decision: "HOLD", blockers: [
    { criterionId: "midrange-physical-p95" },
    { criterionId: "low-end-physical-p95" },
  ] }, COMMIT);
  assert.deepEqual(hold, { valid: true, errors: [] });
  assert.equal(verifyZk682WorkflowReport({ candidateCommit: COMMIT, machinePassed: true, decision: "GO", blockers: [] }, COMMIT).valid, true);
});

test("workflow verdict rejects candidate drift, machine failures, and non-physical blockers", () => {
  assert.equal(verifyZk682WorkflowReport({ candidateCommit: "b".repeat(40), machinePassed: true, decision: "GO", blockers: [] }, COMMIT).valid, false);
  assert.equal(verifyZk682WorkflowReport({ candidateCommit: COMMIT, machinePassed: false, decision: "HOLD", blockers: [{ criterionId: "core-build" }] }, COMMIT).valid, false);
  assert.equal(verifyZk682WorkflowReport({ candidateCommit: COMMIT, machinePassed: true, decision: "HOLD", blockers: [{ criterionId: "core-build" }] }, COMMIT).valid, false);
});


test("diagnostic modes cannot launch certification batch and preserve missing-mode default", () => {
  for (const id of ["linux-evidence", "native-evidence", "aggregate"]) {
    const start=jobsText.indexOf(`  ${id}:\n`);
    assert.match(jobsText.slice(start,start+150), /!inputs\.mode \|\| inputs\.mode == 'certification'/);
  }
  for (const id of ["renderer", "startup"]) {
    const start=jobsText.indexOf(`  ${id}-diagnostic:\n`);
    assert.notEqual(start,-1);
    const next=jobsText.slice(start+4).search(/\n  [a-z][a-z-]*:\n/);
    const end=next<0?-1:start+4+next;
    const block=jobsText.slice(start,end<0?undefined:end);
    assert.match(block,new RegExp(`inputs\\.mode == '${id}-diagnostic'`));
  }
  assert.match(workflow,/git -C \.\. diff --exit-code ab8f4e2/);
  assert.match(workflow,/default: certification/);
  assert.match(workflow,/--seconds 1850 --parent-seconds 1910/);
  assert.match(workflow,/--seconds 600 --parent-seconds 660/);
  assert.doesNotMatch(workflow,/artifacts\/linux-[^\n]*\/\*\.(?:png|zip|webm)/);
});

function embeddedAblation(marker,flag){const block=workflow.split(`# BEGIN RECORDING ${marker}\n`)[1].split(`# END RECORDING ${marker}`)[0];const code=block.split("node --input-type=module <<'NODE'\n")[1].split('\n          NODE')[0].split('\n').map(line=>line.slice(10)).join('\n');process.env[flag]='1';return import('data:text/javascript,'+encodeURIComponent(code));}
test("recording ablation transform has exact inverse and app-root location",async()=>{
 const c=await embeddedAblation('CONTROLLER','ZK682_RECORDING_CONTROLLER_TEST');const path=fileURLToPath(new URL('../playwright.zk682-linux-diagnostic.config.ts',import.meta.url));const before=readFileSync(path,'utf8'),after=c.transformConfig(before);let inverse=after;for(const [from,to]of [...c.edits].reverse())inverse=inverse.replace(to,from);assert.equal(inverse,before);
 for(const [literal]of c.edits){assert.throws(()=>c.transformConfig(before.replace(literal,'')));assert.throws(()=>c.transformConfig(before+literal));}
 assert.throws(()=>c.transformConfig(before.replace('trace: "retain-on-failure"','trace: "on"')));
 assert.match(after,/testDir: "\.\/diagnostics"/);assert.match(after,/testMatch: "zk682-linux-renderer\.diagnostic\.ts"/);assert.match(after,/timeout: 600_000/);assert.match(after,/workers: 1/);assert.match(after,/retries: 0/);
 assert.equal(resolve(dirname(path),'./diagnostics'),fileURLToPath(new URL('../diagnostics',import.meta.url)));
 const code=workflow.split('# BEGIN RECORDING CONTROLLER')[1].split('# END RECORDING CONTROLLER')[0];assert.match(code,/flag:'wx'/);assert.match(code,/resolve\(cwd,'playwright\.zk682-recording-off\.generated\.config\.ts'\)/);assert.doesNotMatch(code,/Object\.entries\(aliases\)\.map/);assert.match(code,/Object\.entries\(\{DIAG_APP_BASELINE:/);
});
test("recording ablation routing evaluates exclusively and old workflow prefix is exact",()=>{
 const ids=['linux-evidence','native-evidence','aggregate','renderer-diagnostic','startup-diagnostic','renderer-recording-ablation'];
 const active=mode=>ids.filter(id=>{const body=jobsText.slice(jobsText.indexOf(`  ${id}:\n`));const expression=body.match(/if: \$\{\{ (.*?) \}\}/)[1];return Function('inputs',`return (${expression});`)({mode});});
 assert.deepEqual(active(undefined),['linux-evidence','native-evidence','aggregate']);assert.deepEqual(active('certification'),['linux-evidence','native-evidence','aggregate']);assert.deepEqual(active('renderer-recording-ablation'),['renderer-recording-ablation']);assert.deepEqual(active('renderer-diagnostic'),['renderer-diagnostic']);assert.deepEqual(active('startup-diagnostic'),['startup-diagnostic']);
 const prior=workflow.split('\n  renderer-recording-ablation:\n')[0].replace('          - renderer-recording-ablation\n','');assert.equal(createHash('sha256').update(prior).digest('hex'),'2aa9cdb774c254bc9ed68dc13a8eb294eec8df9e34831d34bbe7566bf258fe43');
 const block=jobBlock('renderer-recording-ablation',null);assert.match(block,/fetch-depth: 3/);assert.match(block,/--seconds 1850 --parent-seconds 1910/);assert.match(block,/env GITHUB_SHA="\$DIAG_APP_BASELINE" VITE_COMMIT_SHA="\$DIAG_APP_BASELINE" ZK682_EXPECTED_COMMIT="\$DIAG_APP_BASELINE" python3/);assert.match(block,/steps\.recording_artifact_bounds\.conclusion == 'success'/);
});
test("recording ablation real Git fixture catches changed App from simcwd and aliases actual child",async()=>{
 const c=await embeddedAblation('CONTROLLER','ZK682_RECORDING_CONTROLLER_TEST');const repo=mkdtempSync(join(tmpdir(),'zk682-ablation-git-'));const cwd=join(repo,'simgolf-lite');const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',timeout:10000,maxBuffer:65536}).trim();
 try {mkdirSync(join(cwd,'src'),{recursive:true});writeFileSync(join(cwd,'src/app.ts'),'base\n');git('init');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');git('add','.');git('commit','-m','App baseline');const app=git('rev-parse','HEAD');writeFileSync(join(repo,'diagnostic'),'donor');git('add','.');git('commit','-m','d7 fixture');const parent=git('rev-parse','HEAD');writeFileSync(join(repo,'ablation'),'driver');git('add','.');git('commit','-m','new driver');const driver=git('rev-parse','HEAD');const identity=c.verifyApp(cwd,driver,app,parent);const aliases=c.childAliases(identity);const child=JSON.parse(execFileSync(process.execPath,['-e','console.log(JSON.stringify({driver:process.env.DIAG_DRIVER_SHA,app:process.env.ZK682_EXPECTED_COMMIT,github:process.env.GITHUB_SHA,vite:process.env.VITE_COMMIT_SHA}))'],{env:{...process.env,...aliases},encoding:'utf8',timeout:10000,maxBuffer:65536}));assert.deepEqual(child,{driver,app,github:app,vite:app});
 assert.throws(()=>c.verifyApp(cwd,driver,'f'.repeat(40),parent));assert.throws(()=>c.verifyApp(cwd,'0'.repeat(40),app,parent));assert.throws(()=>c.verifyApp(cwd,driver,app,'0'.repeat(40)));
 writeFileSync(join(cwd,'src/app.ts'),'changed\n');git('add','.');git('commit','--amend','--no-edit');assert.throws(()=>c.verifyApp(cwd,git('rev-parse','HEAD'),app,parent));
 }finally{rmSync(repo,{recursive:true,force:true});}
});
test("recording ablation artifact helper rejects unknown/prototype/symlink/oversize inputs",async()=>{
 const c=await embeddedAblation('BOUNDS','ZK682_RECORDING_BOUNDS_TEST');const root=mkdtempSync(join(tmpdir(),'zk682-ablation-art-'));try{
 for(const name of ['unknown.json','__proto__','constructor','toString'])assert.throws(()=>c.boundedArtifact(root,name));assert.equal(c.boundedArtifact(root,'phase.json'),0);writeFileSync(join(root,'phase.json'),'{}');assert.equal(c.boundedArtifact(root,'phase.json'),2);
 writeFileSync(join(root,'phase.json'),Buffer.alloc(65537));assert.throws(()=>c.boundedArtifact(root,'phase.json'));rmSync(join(root,'phase.json'));symlinkSync('/tmp',join(root,'stdout.log'));assert.throws(()=>c.boundedArtifact(root,'stdout.log'));rmSync(join(root,'stdout.log'));assert.equal(c.validateBounds(root,[]),0);
 }finally{rmSync(root,{recursive:true,force:true});}
});
