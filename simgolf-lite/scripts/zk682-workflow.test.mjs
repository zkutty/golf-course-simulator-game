import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, realpathSync } from "node:fs";
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
 const prior=workflow.split('\n  renderer-recording-ablation:\n')[0].replace('          - renderer-recording-ablation\n','').replace('          - canonical-renderer-verification\n','').replace('          - public-capture-discriminator\n','');assert.equal(createHash('sha256').update(prior).digest('hex'),'2aa9cdb774c254bc9ed68dc13a8eb294eec8df9e34831d34bbe7566bf258fe43');
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

function embeddedCanonical(marker,flag){const block=workflow.split(`# BEGIN CANONICAL ${marker}\n`)[1].split(`# END CANONICAL ${marker}`)[0];const code=block.split("node --input-type=module <<'NODE'\n")[1].split('\n          NODE')[0].split('\n').map(line=>line.slice(10)).join('\n');process.env[flag]='1';return import('data:text/javascript,'+encodeURIComponent(code));}
const canonicalBlock=jobBlock('canonical-renderer-verification','public-capture-discriminator');
test('canonical mode exclusively routes and removes to byte-exact af0 workflow',()=>{
 const ids=['linux-evidence','native-evidence','aggregate','renderer-diagnostic','startup-diagnostic','renderer-recording-ablation','canonical-renderer-verification'];
 const active=mode=>ids.filter(id=>Function('inputs',`return (${jobBlock(id,null).match(/if: \$\{\{ (.*?) \}\}/)[1]});`)({mode}));
 assert.deepEqual(active(undefined),['linux-evidence','native-evidence','aggregate']);assert.deepEqual(active('certification'),['linux-evidence','native-evidence','aggregate']);for(const mode of ids.slice(3))assert.deepEqual(active(mode),[mode]);assert.deepEqual(active('unknown'),[]);
 const inverse=workflow.slice(0,workflow.indexOf('\n  canonical-renderer-verification:\n')).replace('          - canonical-renderer-verification\n','').replace('          - public-capture-discriminator\n','');assert.equal(createHash('sha256').update(inverse).digest('hex'),'10c76ebbd93ce73b19c4492a99c4852509b98094b18bc71e2a77329fba44b96e');
 for(const [id,pin]of Object.entries({"linux-evidence":"59f7db79571e57fe62acc8f668d2ff50a2b749b6ba4e1fc3f84a05bdfdc2eed2","native-evidence":"8be9df6e5109641a3924517652d24aa83c92df6ef55b916740c0df817c0c5ca6","aggregate":"8687a84e4c357ec170ce7c8cfba9ead432146ef24f1341fad2c408c3f601b7fd","renderer-diagnostic":"7cad87dc22e2a2cb798d5dea4d96fdb4d03df338a628cb100351e05d17218d4e","startup-diagnostic":"0e87b8112911b0698402db67dd2abd7e4d57317e2753bf4735e1fa7ef7bec0d7","renderer-recording-ablation":"29f1bab5a4a38fd4dcaa37dcbbc3dab5a0c59c9f98f44c2b17bf639627fec3c5"})){const text=inverse.split('\njobs:\n')[1],start=text.indexOf(`  ${id}:\n`),tail=text.slice(start),next=tail.slice(4).search(/\n  [a-z][a-z-]*:\n/);assert.equal(createHash('sha256').update(next<0?tail:tail.slice(0,4+next+1)).digest('hex'),pin,'old job inverse '+id);}
 assert.doesNotMatch(canonicalBlock,/continue-on-error|needs:|deploy|release:build|generated\.config|phase\.json|diagnostic\.ts/);
});
test('canonical actual command scope preserves one original wrapper and finite budgets',async()=>{
 const c=await embeddedCanonical('CONTROLLER','ZK682_CANONICAL_CONTROLLER_TEST');const identity={targetCommit:c.targetCandidate,driverCommit:'d'.repeat(40),driverRoot:'/driver'};
 assert.deepEqual(c.canonicalCommand(identity),['env','GITHUB_SHA='+c.targetCandidate,'VITE_COMMIT_SHA='+c.targetCandidate,'ZK682_EXPECTED_COMMIT='+c.targetCandidate,'python3','/driver/simgolf-lite/scripts/linux-diagnostic-supervisor.py','--out','artifacts/canonical-renderer-verification/run','--seconds','1850','--parent-seconds','1910','--artifact-cap','1048576','--','node','scripts/zk682-run-resource-growth.mjs','--expected-commit',c.targetCandidate]);
 assert.match(canonicalBlock,/timeout-minutes: 40/);assert.match(canonicalBlock,/ref: \$\{\{ github\.sha \}\}/);assert.match(canonicalBlock,/path: target/);assert.match(canonicalBlock,/cache-dependency-path: target\/simgolf-lite\/package-lock\.json/);
 const steps=canonicalBlock.split(/\n      - /).slice(1);for(const step of steps.filter(s=>/run:/.test(s)&&!s.startsWith('name: Verify registered'))){assert.match(step,/working-directory: target\/simgolf-lite/);}
 assert.equal(canonicalBlock.split('-- node scripts/zk682-run-resource-growth.mjs').length-1,1);assert.match(canonicalBlock,/e2e\/zk682-resource-growth\.e2e\.ts --workers=1 --retries=0 --list/);assert.ok(canonicalBlock.indexOf('Linux supervisor capability smoke')<canonicalBlock.indexOf('Discover exactly one'));assert.ok(canonicalBlock.indexOf('Upload explicit bounded')<canonicalBlock.indexOf('Require actual exit zero'));
 const source=canonicalBlock.split('# BEGIN CANONICAL CONTROLLER')[1].split('# END CANONICAL CONTROLLER')[0];assert.doesNotMatch(source,/GITHUB_ENV[^\n]*GITHUB_SHA|GITHUB_SHA[^\n]*GITHUB_ENV/);assert.match(source,/VERIFIED_TARGET_SHA=/);assert.match(canonicalBlock,/env GITHUB_SHA="\$VERIFIED_TARGET_SHA" VITE_COMMIT_SHA="\$VERIFIED_TARGET_SHA" ZK682_EXPECTED_COMMIT="\$VERIFIED_TARGET_SHA" python3 "\$DRIVER_SUPERVISOR"/);
});
test('extracted canonical identity controller executes separate real Git fixtures and owned aliases',async()=>{
 const c=await embeddedCanonical('CONTROLLER','ZK682_CANONICAL_CONTROLLER_TEST'),root=mkdtempSync(join(tmpdir(),'zk682-canonical-git-'));
 const make=name=>{const repo=join(root,name);mkdirSync(repo);const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',timeout:10000,maxBuffer:65536}).trim();git('init');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');writeFileSync(join(repo,'identity'),name);git('add','.');git('commit','-m',name);return {repo,git,sha:git('rev-parse','HEAD')};};
 try{const driver=make('driver'),target=make('target'),identity=c.verifyCheckouts(driver.repo,target.repo,target.sha,driver.sha);assert.equal(identity.targetCommit,target.sha);assert.equal(identity.driverCommit,driver.sha);
 const aliases=c.childAliases(identity);const child=JSON.parse(execFileSync(process.execPath,['-e','console.log(JSON.stringify([process.env.GITHUB_SHA,process.env.VITE_COMMIT_SHA,process.env.ZK682_EXPECTED_COMMIT]))'],{cwd:target.repo,env:{...process.env,...aliases},encoding:'utf8',timeout:10000,maxBuffer:65536}));assert.deepEqual(child,[target.sha,target.sha,target.sha]);
 for(const invalid of [undefined,'HEAD',target.sha.slice(0,8),'0'.repeat(40)])assert.throws(()=>c.verifyCheckouts(driver.repo,target.repo,invalid,driver.sha));assert.throws(()=>c.verifyCheckouts(driver.repo,target.repo,target.sha,'0'.repeat(40)));assert.throws(()=>c.verifyCheckouts(driver.repo,driver.repo,driver.sha,driver.sha));assert.throws(()=>c.verifyCheckouts(driver.repo,join(target.repo,'missing'),target.sha,driver.sha));
 for(const key of Object.keys(aliases))assert.throws(()=>c.childAliases(identity,{[key]:driver.sha}));assert.deepEqual(c.childAliases(identity,aliases),aliases);
 writeFileSync(join(target.repo,'untracked'),'dirty');assert.throws(()=>c.verifyCheckouts(driver.repo,target.repo,target.sha,driver.sha));rmSync(join(target.repo,'untracked'));symlinkSync(target.repo,join(root,'alias'));assert.throws(()=>c.verifyCheckouts(target.repo,join(root,'alias'),target.sha,target.sha));
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('canonical pins prove actual registered producer/helper/package/config parity without execution',async()=>{
 const c=await embeddedCanonical('CONTROLLER','ZK682_CANONICAL_CONTROLLER_TEST');const root=process.env.ZK682_CANONICAL_SOURCE_ROOT;assert.ok(root,'root controls must supply immutable target app-root ZK682_CANONICAL_SOURCE_ROOT');const rows=c.verifyPins(resolve(root));assert.equal(rows.length,Object.keys(c.targetPins).length);assert.equal(c.targetPins['e2e/zk682-resource-growth.e2e.ts'],'69cf83d45ab294d018e142b15834353105aaf456875f2320a0bce4d7fdc057f7');
 const wrapper=readFileSync(join(root,'scripts/zk682-run-resource-growth.mjs'),'utf8');assert.match(wrapper,/"e2e\/zk682-resource-growth\.e2e\.ts",\n    "--workers=1",\n    "--retries=0"/);assert.match(wrapper,/candidateCommit !== gitHead\.stdout\.trim\(\)/);assert.match(readFileSync(join(root,'e2e/zk682-resource-growth.e2e.ts'),'utf8'),/test\.slow\(\)/);assert.match(readFileSync(join(root,'playwright.config.ts'),'utf8'),/timeout: 600_000/);
 const fixture=realpathSync(mkdtempSync(join(tmpdir(),'zk682-canonical-pin-')));try{writeFileSync(join(fixture,'sample'),'base');const pins={sample:c.hash(Buffer.from('base'))};c.verifyPins(fixture,pins);writeFileSync(join(fixture,'sample'),'changed');assert.throws(()=>c.verifyPins(fixture,pins));rmSync(join(fixture,'sample'));symlinkSync(join(root,'package.json'),join(fixture,'sample'));assert.throws(()=>c.verifyPins(fixture,pins));}finally{rmSync(fixture,{recursive:true,force:true});}
});
test('extracted canonical artifact controller rejects empty completeness, missing, duplicate, symlink, oversize and unknown artifacts',async()=>{
 const c=await embeddedCanonical('BOUNDS','ZK682_CANONICAL_BOUNDS_TEST'),root=realpathSync(mkdtempSync(join(tmpdir(),'zk682-canonical-art-')));try{
 assert.equal(c.validateBounds(root),0);assert.throws(()=>c.validateBounds(root,Object.keys(c.artifactLimits),true));for(const name of ['unknown.json','__proto__','constructor'])assert.throws(()=>c.boundedArtifact(root,name));assert.throws(()=>c.validateBounds(root,['run/stdout.log','run/stdout.log']));
 mkdirSync(join(root,'run'));writeFileSync(join(root,'run/renderer-resource-growth.json'),'{}');assert.equal(c.boundedArtifact(root,'run/renderer-resource-growth.json'),2);writeFileSync(join(root,'run/renderer-resource-growth.json'),Buffer.alloc(65537));assert.throws(()=>c.validateBounds(root));rmSync(join(root,'run/renderer-resource-growth.json'));
 symlinkSync('/tmp',join(root,'run/stdout.log'));assert.throws(()=>c.validateBounds(root));rmSync(join(root,'run/stdout.log'));writeFileSync(join(root,'run/unexpected.json'),'{}');assert.throws(()=>c.validateBounds(root));rmSync(join(root,'run/unexpected.json'));
 writeFileSync(join(root,'run/stdout.log'),Buffer.alloc(262144));writeFileSync(join(root,'run/stderr.log'),'x');assert.throws(()=>c.validateBounds(root));rmSync(join(root,'run/stdout.log'));rmSync(join(root,'run/stderr.log'));
 writeFileSync(join(root,'run/zk682-resource-growth-final.png'),Buffer.alloc(1048577));assert.throws(()=>c.validateBounds(root));writeFileSync(join(root,'run/zk682-resource-growth-final.png'),Buffer.alloc(1048500));writeFileSync(join(root,'run/renderer-resource-growth.json'),Buffer.alloc(100));assert.throws(()=>c.validateBounds(root));assert.throws(()=>c.verifyInventory({artifacts:[]},root));
 assert.equal(c.artifactLimits['run/owned-command-receipt.json'],65536);assert.ok(c.required.includes('run/renderer-resource-growth-command.json'));assert.ok(c.required.includes('run/zk682-canvas-capture-receipt.json'));const upload=canonicalBlock.split('          path: |\n')[1].split('          if-no-files-found:')[0].trim().split('\n').map(l=>l.trim());assert.deepEqual(upload,Object.keys(c.artifactLimits).map(name=>'target/simgolf-lite/artifacts/canonical-renderer-verification/'+name));
 }finally{rmSync(root,{recursive:true,force:true});}
});

function embeddedCapture(marker,flag){const block=workflow.split(`# BEGIN CAPTURE ${marker}\n`)[1].split(`# END CAPTURE ${marker}`)[0],code=block.split("node --input-type=module <<'NODE'\n")[1].split('\n          NODE')[0].split('\n').map(line=>line.slice(10)).join('\n');process.env[flag]='1';return import('data:text/javascript,'+encodeURIComponent(code));}
const captureBlock=jobBlock('public-capture-discriminator',null);
test('capture routing is exclusive and e201 workflow prefix inverse is exact',()=>{
 const inverse=workflow.slice(0,workflow.indexOf('\n  public-capture-discriminator:\n')).replace('          - public-capture-discriminator\n','');assert.equal(createHash('sha256').update(inverse).digest('hex'),'9cc0995eaa76d03da80b4ba6c130c764ef28a5cf072af481be35cd25b79b5bb1');const ids=['linux-evidence','native-evidence','aggregate','renderer-diagnostic','startup-diagnostic','renderer-recording-ablation','canonical-renderer-verification','public-capture-discriminator'];const active=mode=>ids.filter(id=>Function('inputs',`return (${jobBlock(id,null).match(/if: \$\{\{ (.*?) \}\}/)[1]});`)({mode}));assert.deepEqual(active(undefined),ids.slice(0,3));for(const mode of ids.slice(3))assert.deepEqual(active(mode),[mode]);assert.deepEqual(active('unknown'),[]);
 assert.match(captureBlock,/timeout-minutes: 11/);assert.match(captureBlock,/--seconds 115 --parent-seconds 120 --artifact-cap 1048576 -- node "\$C1_REAL_CONTROL"/);assert.match(captureBlock,/node-version: 22/);assert.match(captureBlock,/version,'1\.61\.1'/);assert.doesNotMatch(captureBlock,/continue-on-error|warmup|generated\.config|release:build|deploy/);
 const executableRuns=block=>{const commands=[];let multiline=false,heredoc=false;for(const line of block.split('\n')){const match=line.match(/^        run: (.*)$/);if(match){multiline=match[1]==='|';heredoc=false;if(!multiline)commands.push(match[1]);continue;}if(!multiline)continue;if(line&&!line.startsWith('          ')){multiline=false;continue;}const command=line.trim();if(heredoc){if(command==='NODE')heredoc=false;continue;}commands.push(command);if(command.includes("<<'NODE'"))heredoc=true;}return commands.join('\n');};
 const requireCaptureOnly=block=>assert.doesNotMatch(executableRuns(block),/\b(?:node\s+(?:[^\n]*\s+)?scripts\/zk682-run-resource-growth\.mjs|npm\s+run\s+test:resource-growth|npx\s+playwright\s+test\s+e2e\/zk682-resource-growth\.e2e\.ts)(?:\s|$)/m);
 requireCaptureOnly(captureBlock);for(const forbidden of ['node scripts/zk682-run-resource-growth.mjs --expected-commit "$C1_TARGET_SHA"','env GITHUB_SHA="$C1_TARGET_SHA" python3 "$C1_SUPERVISOR" --out forbidden --seconds 115 --parent-seconds 120 -- node scripts/zk682-run-resource-growth.mjs','npm run test:resource-growth','npx playwright test e2e/zk682-resource-growth.e2e.ts --workers=1 --retries=0'])assert.throws(()=>requireCaptureOnly(captureBlock+'\n      - name: Forbidden control\n        run: '+forbidden+'\n'));assert.ok(captureBlock.indexOf('Run eight frozen')<captureBlock.indexOf('Owned Linux capability smoke'));assert.ok(captureBlock.indexOf('Owned Linux capability smoke')<captureBlock.indexOf('Run one frozen'));assert.ok(captureBlock.indexOf('Upload bounded')<captureBlock.indexOf('Require actual exit'));assert.equal(captureBlock.split('-- node "$C1_REAL_CONTROL"').length-1,1);
});
test('capture extracted identity controller executes separate Git fixtures and rejects drift aliases and source mutation',async()=>{
 const c=await embeddedCapture('CONTROLLER','ZK682_CAPTURE_CONTROLLER_TEST'),root=realpathSync(mkdtempSync(join(tmpdir(),'zk682-capture-git-')));const make=name=>{const repo=join(root,name);mkdirSync(repo);const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',timeout:10000,maxBuffer:65536}).trim();git('init');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');writeFileSync(join(repo,'source'),name);git('add','.');git('commit','-m',name);return {repo,sha:git('rev-parse','HEAD')};};
 try{const d=make('driver'),t=make('target'),identity=c.verifyCheckouts(d.repo,t.repo,t.sha,d.sha),aliases=c.childAliases(identity);const child=JSON.parse(execFileSync(process.execPath,['-e','console.log(JSON.stringify([process.env.GITHUB_SHA,process.env.VITE_COMMIT_SHA,process.env.ZK682_EXPECTED_COMMIT]))'],{cwd:t.repo,env:{...process.env,...aliases},encoding:'utf8',timeout:10000}));assert.deepEqual(child,[t.sha,t.sha,t.sha]);for(const wrong of ['HEAD',t.sha.slice(0,8),'0'.repeat(40)])assert.throws(()=>c.verifyCheckouts(d.repo,t.repo,wrong,d.sha));assert.throws(()=>c.verifyCheckouts(d.repo,t.repo,t.sha,'0'.repeat(40)));assert.throws(()=>c.verifyCheckouts(d.repo,d.repo,d.sha,d.sha));for(const key of Object.keys(aliases))assert.throws(()=>c.childAliases(identity,{[key]:d.sha}));const pins={source:c.hash(Buffer.from('target'))};c.verifyPins(t.repo,pins);writeFileSync(join(t.repo,'source'),'changed');assert.throws(()=>c.verifyPins(t.repo,pins));assert.throws(()=>c.verifyCheckouts(d.repo,t.repo,t.sha,d.sha));rmSync(join(t.repo,'source'));symlinkSync(join(d.repo,'source'),join(t.repo,'source'));assert.throws(()=>c.verifyPins(t.repo,pins));assert.equal(Object.keys(c.targetPins).length,20);assert.equal(c.targetPins['src/App.tsx'],'6ba5256282315022e45e1fba5f3b1377c27e95f152fbb3ea0c3414bb5ddc88b0');const source=captureBlock.split('# BEGIN CAPTURE CONTROLLER')[1].split('# END CAPTURE CONTROLLER')[0];assert.match(source,/C2_SOURCE_IDENTITY /);assert.doesNotMatch(source,/GITHUB_ENV[^\n]*GITHUB_SHA|GITHUB_SHA[^\n]*GITHUB_ENV/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('capture strict allowlist admits bounded partials and rejects empty complete missing duplicate symlink oversize and unknown paths',async()=>{
 const c=await embeddedCapture('BOUNDS','ZK682_CAPTURE_BOUNDS_TEST'),root=realpathSync(mkdtempSync(join(tmpdir(),'zk682-capture-art-')));try{assert.equal(c.validateBounds(root),0);assert.throws(()=>c.validateBounds(root,c.names,true));for(const name of ['unknown','__proto__','constructor'])assert.throws(()=>c.validateBounds(root,[name]));assert.throws(()=>c.validateBounds(root,['stdout.log','stdout.log']));writeFileSync(join(root,'stdout.log'),'partial');assert.equal(c.validateBounds(root),7);writeFileSync(join(root,'stdout.log'),Buffer.alloc(262145));assert.throws(()=>c.validateBounds(root));rmSync(join(root,'stdout.log'));symlinkSync('/tmp',join(root,'stderr.log'));assert.throws(()=>c.validateBounds(root));rmSync(join(root,'stderr.log'));writeFileSync(join(root,'unknown.json'),'{}');assert.throws(()=>c.validateBounds(root));rmSync(join(root,'unknown.json'));mkdirSync(join(root,'comparison'));writeFileSync(join(root,'comparison/identity.json'),Buffer.alloc(65537));assert.throws(()=>c.validateBounds(root));rmSync(join(root,'comparison/identity.json'));writeFileSync(join(root,'comparison/static-page.png'),Buffer.alloc(1048570));writeFileSync(join(root,'stderr.log'),Buffer.alloc(10));assert.throws(()=>c.validateBounds(root));const upload=captureBlock.split('          path: |\n')[1].split('          if-no-files-found:')[0].trim().split('\n').map(l=>l.trim());assert.equal(c.names.length,14);assert.equal(c.names.filter(n=>n.endsWith('.png')).length,4);assert.deepEqual(upload,c.names.map(n=>'target/simgolf-lite/artifacts/public-capture-discriminator/'+n));assert.equal(c.limits['owned-command-receipt.json'],65536);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('capture installed driver files match accepted entry-readiness pins',async()=>{const c=await embeddedCapture('CONTROLLER','ZK682_CAPTURE_CONTROLLER_TEST'),root=fileURLToPath(new URL('../../',import.meta.url));c.verifyPins(root,c.driverPins);assert.equal(c.driverPins['simgolf-lite/scripts/zk682-public-capture-discriminator/real-control.mjs'],'e7f0df54073bc6359b70f7c4d5bcdae5dfd71078546dbe5b7c3c7979628a29f6');assert.equal(Object.keys(c.driverPins).length,4);const actual=process.env.ZK682_CANONICAL_SOURCE_ROOT;assert.ok(actual);c.verifyPins(resolve(actual),c.targetPins);});

function extractedDEntry(){const source=readFileSync(fileURLToPath(new URL('./zk682-public-capture-discriminator/real-control.mjs',import.meta.url)),'utf8');assert.equal(source.split('// BEGIN D QUICK START ENTRY').length-1,1);assert.equal(source.split('// END D QUICK START ENTRY').length-1,1);const body=source.split('// BEGIN D QUICK START ENTRY\n')[1].split('// END D QUICK START ENTRY')[0].trim();return Function('assert','return ('+body+');')(assert);}
function dEntryFixture({visible=false,duplicate=false,waitError}={}){let clicks=0,counts=0,waits=0,release;const gate=new Promise(resolve=>{release=resolve;}),calls=[];const locator={waitFor:async options=>{waits++;calls.push('wait');assert.deepEqual(options,{state:'visible',timeout:10000});if(waitError!==undefined)throw waitError;if(!visible)await gate;},count:async()=>{counts++;calls.push('count');return visible?(duplicate?2:1):0;},click:async()=>{assert.equal(visible,true);assert.equal(duplicate,false);clicks++;calls.push('click');}};return {page:{getByRole:(role,options)=>{assert.equal(role,'button');assert.deepEqual(options,{name:'Quick Start'});return locator;}},locator,appear:()=>{visible=true;release();},stats:()=>({clicks,counts,waits,calls})};}
test('D entry delayed appearance fails old immediate count then waits before one unchanged click',async()=>{const enter=extractedDEntry(),f=dEntryFixture();await assert.rejects(async()=>assert.equal(await f.locator.count(),1));assert.equal(f.stats().clicks,0);const pending=enter(f.page);await Promise.resolve();assert.deepEqual(f.stats().calls,['count','wait']);assert.equal(f.stats().clicks,0);f.appear();await pending;assert.deepEqual(f.stats(),{clicks:1,counts:2,waits:1,calls:['count','wait','count','click']});});
test('D entry missing visible button preserves wait error and never counts or clicks',async()=>{const primary=new Error('visible wait timed out at10000ms'),f=dEntryFixture({waitError:primary});await assert.rejects(extractedDEntry()(f.page),error=>error===primary);assert.deepEqual(f.stats(),{clicks:0,counts:0,waits:1,calls:['wait']});});
test('D entry duplicate visible buttons fail unique count and never click',async()=>{const f=dEntryFixture({visible:true,duplicate:true});await assert.rejects(extractedDEntry()(f.page));assert.deepEqual(f.stats(),{clicks:0,counts:1,waits:1,calls:['wait','count']});});
test('D entry already visible one button waits with exact finite timeout then clicks once',async()=>{const f=dEntryFixture({visible:true});await extractedDEntry()(f.page);assert.deepEqual(f.stats(),{clicks:1,counts:1,waits:1,calls:['wait','count','click']});});
