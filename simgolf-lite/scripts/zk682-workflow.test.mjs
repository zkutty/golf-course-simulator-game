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
 const prior=workflow.split('\n  renderer-recording-ablation:\n')[0].replace('          - renderer-recording-ablation\n','').replace('          - canonical-renderer-verification\n','');assert.equal(createHash('sha256').update(prior).digest('hex'),'2aa9cdb774c254bc9ed68dc13a8eb294eec8df9e34831d34bbe7566bf258fe43');
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
const canonicalBlock=jobBlock('canonical-renderer-verification',null);
test('canonical mode exclusively routes and removes to byte-exact af0 workflow',()=>{
 const ids=['linux-evidence','native-evidence','aggregate','renderer-diagnostic','startup-diagnostic','renderer-recording-ablation','canonical-renderer-verification'];
 const active=mode=>ids.filter(id=>Function('inputs',`return (${jobBlock(id,null).match(/if: \$\{\{ (.*?) \}\}/)[1]});`)({mode}));
 assert.deepEqual(active(undefined),['linux-evidence','native-evidence','aggregate']);assert.deepEqual(active('certification'),['linux-evidence','native-evidence','aggregate']);for(const mode of ids.slice(3))assert.deepEqual(active(mode),[mode]);assert.deepEqual(active('unknown'),[]);
 const inverse=workflow.slice(0,workflow.indexOf('\n  canonical-renderer-verification:\n')).replace('          - canonical-renderer-verification\n','');assert.equal(createHash('sha256').update(inverse).digest('hex'),'10c76ebbd93ce73b19c4492a99c4852509b98094b18bc71e2a77329fba44b96e');
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

test('N canonical exacteebb controller rejects stale target and H or consumer pins missing source',async()=>{const c=await embeddedCanonical('CONTROLLER','ZK682_CANONICAL_CONTROLLER_TEST'),b=await embeddedCanonical('BOUNDS','ZK682_CANONICAL_BOUNDS_TEST'),actual=resolve(process.env.ZK682_CANONICAL_SOURCE_ROOT);assert.equal(c.targetCandidate,'eebb5a388a153078046021a64aa897a3886bc9f4');assert.equal(Object.keys(c.targetPins).length,21);assert.deepEqual(c.targetPins,b.expectedTargetPins);assert.equal(c.targetPins['scripts/zk682-public-canvas-capture.mjs'],'4e187ebcb7cd889e843aa1a994be0d5deeaa9e2aad5bed710b15da981bc665fc');assert.equal(c.targetPins['scripts/zk682-public-canvas-capture.test.mjs'],'33c5aa2092503116cf00f831d4c21d425f60db6b8b75cc24fac449ede5b591a4');assert.equal(c.targetPins['scripts/zk682-certification-contract.test.mjs'],'9d0fa57d16b887a77ea27ba67b5f1d6cc1a07c55b12ba2a0ca17eaf43cbc7ce8');c.verifyPins(actual);for(const target of ['4a27e748957925ac476e98e9aaeed4e6a70f095f','85787941a8bc2726cf57e02be86009d366c8bf26','f822040144de80314f1eb61a7de26f2bac7f3764'])assert.throws(()=>c.prepare('/unused-driver','/unused-target',target,'d'.repeat(40)));for(const [name,pin]of [['scripts/zk682-public-canvas-capture.mjs','d5895ff55f30850b0efa4f7c0b5d249cd03ae984361a2c366429ff6691f0717e'],['scripts/zk682-public-canvas-capture.test.mjs','471ce6fe836a3bae6af35bee3ef308e3465a9a23f261ce54dce666cf2d748737'],['scripts/zk682-certification-contract.test.mjs','c12e23188eaa50868f2fb36373885c2efc0e07a50ff3ec0d6527ceb2de411a52']])assert.throws(()=>c.verifyPins(actual,{...c.targetPins,[name]:pin}));const root=realpathSync(mkdtempSync(join(tmpdir(),'zk682-N-pins-')));try{for(const name of Object.keys(c.targetPins)){mkdirSync(dirname(join(root,name)),{recursive:true});writeFileSync(join(root,name),readFileSync(join(actual,name)));}c.verifyPins(root);for(const name of ['scripts/zk682-public-canvas-capture.mjs','scripts/zk682-public-canvas-capture.test.mjs','scripts/zk682-certification-contract.test.mjs']){const file=join(root,name),bytes=readFileSync(file);rmSync(file);assert.throws(()=>c.verifyPins(root));writeFileSync(file,Buffer.concat([bytes,Buffer.from('\n')]));assert.throws(()=>c.verifyPins(root));rmSync(file);symlinkSync(join(actual,name),file);assert.throws(()=>c.verifyPins(root));rmSync(file);writeFileSync(file,bytes);}c.verifyPins(root);}finally{rmSync(root,{recursive:true,force:true});}});
test('N canonical helper16 consumer6 policy6 and Chromium precede smoke discovery and sole wrapper',()=>{const commands=['node --test scripts/zk682-public-canvas-capture.test.mjs',"node --test --test-name-pattern='renderer completeness|renderer PNG|renderer public CDP|renderer consumer' scripts/zk682-certification-contract.test.mjs",'node --test scripts/zk682-resource-growth-recording-policy.test.mjs','npx playwright install --with-deps chromium','Linux supervisor capability smoke','Discover exactly one original canonical test without browser','-- node scripts/zk682-run-resource-growth.mjs --expected-commit'];const validate=block=>{let previous=-1;for(const command of commands){assert.equal(block.split(command).length-1,1,'one required control '+command);const position=block.indexOf(command);assert.ok(position>previous,'required control order');previous=position;}};validate(canonicalBlock);for(const command of commands.slice(0,4)){assert.throws(()=>validate(canonicalBlock.replace(command,'removed control')));assert.throws(()=>validate(canonicalBlock+'\n'+command));}const [helper,consumer]=commands;assert.throws(()=>validate(canonicalBlock.replace(helper,'F_SWAP').replace(consumer,helper).replace('F_SWAP',consumer)));const consumerSource=readFileSync(resolve(process.env.ZK682_CANONICAL_SOURCE_ROOT,'scripts/zk682-certification-contract.test.mjs'),'utf8');const selected=[...consumerSource.matchAll(/^test\(["']([^"']+)["']/gm)].map(match=>match[1]).filter(name=>/renderer completeness|renderer PNG|renderer public CDP|renderer consumer/.test(name));assert.equal(selected.length,6);assert.equal(readFileSync(resolve(process.env.ZK682_CANONICAL_SOURCE_ROOT,'scripts/zk682-public-canvas-capture.test.mjs'),'utf8').match(/^test\(/gm).length,16);assert.equal(readFileSync(resolve(process.env.ZK682_CANONICAL_SOURCE_ROOT,'scripts/zk682-resource-growth-recording-policy.test.mjs'),'utf8').match(/^test\(/gm).length,6);});

test('N full d144 workflow inverse preserves I and35f7 routing artifacts aliases and budgets byteexact',()=>{let inverse=workflow;const retargetEdits=[["4a27e748957925ac476e98e9aaeed4e6a70f095f","eebb5a388a153078046021a64aa897a3886bc9f4",2],["c12e23188eaa50868f2fb36373885c2efc0e07a50ff3ec0d6527ceb2de411a52","9d0fa57d16b887a77ea27ba67b5f1d6cc1a07c55b12ba2a0ca17eaf43cbc7ce8",2]];for(const [before,after,count]of [...retargetEdits].reverse()){assert.equal(inverse.split(after).length-1,count);inverse=inverse.split(after).join(before);}assert.equal(createHash('sha256').update(inverse).digest('hex'),'e09dd1788412ee78e1d709d992abcfcea227feb8e43e2798a54103037c2d9231');if(process.env.ZK682_N_DONOR_WORKFLOW)assert.equal(inverse,readFileSync(process.env.ZK682_N_DONOR_WORKFLOW,'utf8'));const edits=[["85787941a8bc2726cf57e02be86009d366c8bf26","4a27e748957925ac476e98e9aaeed4e6a70f095f",2],["d5895ff55f30850b0efa4f7c0b5d249cd03ae984361a2c366429ff6691f0717e","4e187ebcb7cd889e843aa1a994be0d5deeaa9e2aad5bed710b15da981bc665fc",2],["471ce6fe836a3bae6af35bee3ef308e3465a9a23f261ce54dce666cf2d748737","33c5aa2092503116cf00f831d4c21d425f60db6b8b75cc24fac449ede5b591a4",2],["Run ten canonical public CDP helper controls","Run sixteen canonical main-world public CDP helper controls",1]];for(const [before,after,count]of [...edits].reverse()){assert.equal(inverse.split(after).length-1,count);inverse=inverse.split(after).join(before);}assert.equal(createHash('sha256').update(inverse).digest('hex'),'2d99227441791631c68978d5db50b5e62a0aa2ec889f99fa307d188abd2c7492');assert.equal(workflow.slice(0,workflow.indexOf('\n  canonical-renderer-verification:\n')),inverse.slice(0,inverse.indexOf('\n  canonical-renderer-verification:\n')));assert.match(canonicalBlock,/Run sixteen canonical main-world public CDP helper controls/);assert.equal(canonicalBlock.split('node --test scripts\/zk682-public-canvas-capture.test.mjs').length-1,1);});
