import assert from "node:assert/strict";
import { readFileSync/*B@001*/, writeFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, realpathSync, lstatSync, renameSync/*@B001*/ } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { verifyZk682WorkflowReport } from "./zk682-workflow-verdict.mjs";

/*B@002*/import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
/*@B002*/const COMMIT = "a".repeat(40);
const workflowPath = fileURLToPath(new URL("../../.github/workflows/zk682-certification.yml", import.meta.url));
/*B@003*/const currentCaptureWorkflow = readFileSync(workflowPath, "utf8");
function inverseCurrentCaptureWorkflow(source) {
  const marker="\n  current-capture-host-phase-66:\n",input="      mode:\n        description: Canonical certification or registered current66 host capture diagnostic\n        required: true\n        type: choice\n        default: certification\n        options:\n          - certification\n          - current-capture-host-phase-66\n",guard="    if: ${{ !inputs.mode || inputs.mode == 'certification' }}\n";
  assert.equal(source.split(marker).length-1,1);assert.equal(source.split(input).length-1,1);assert.equal(source.split(guard).length-1,3);
  const inverse=source.slice(0,source.indexOf(marker)).replace(input,"").replaceAll(guard,"");assert.equal(createHash('sha256').update(inverse).digest('hex'),'ebf2d12c9944d833315a3bc2058f567f6c937a69f8f6702a4185627476aebb47');return inverse;
}
/*@B003*/const workflow = /*B@004*/inverseCurrentCaptureWorkflow(/*@B004*/readFileSync(workflowPath, "utf8")/*B@005*/)/*@B005*/;
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
  assert.doesNotMatch(workflow, /github\.sha|GITHUB_SHA/);
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

// BEGIN CURRENT66 HOST CAPTURE B TESTS
function embeddedCurrentCapture(marker){const block=currentCaptureWorkflow.split(`# BEGIN CURRENT CAPTURE ${marker}\n`)[1].split(`# END CURRENT CAPTURE ${marker}`)[0],code=block.split("node --input-type=module <<'NODE'\n")[1].split('\n          NODE')[0].split('\n').map(line=>line.slice(10)).join('\n');process.env[marker==='CONTROLLER'?'ZK682_CURRENT_CAPTURE_CONTROLLER_TEST':'ZK682_CURRENT_CAPTURE_BOUNDS_TEST']='1';return import('data:text/javascript,'+encodeURIComponent(code));}
const currentCaptureBlock=currentCaptureWorkflow.slice(currentCaptureWorkflow.indexOf('\n  current-capture-host-phase-66:\n'));

test('current66 exclusive routing and complete current canonical workflow/test inverses',()=>{
 const text=currentCaptureWorkflow.split('\njobs:\n')[1],ids=['linux-evidence','native-evidence','aggregate','current-capture-host-phase-66'];
 const active=mode=>ids.filter(id=>{const body=text.slice(text.indexOf(`  ${id}:\n`)),expression=body.match(/if: \$\{\{ (.*?) \}\}/)[1];return Function('inputs',`return (${expression});`)({mode});});
 assert.deepEqual(active(undefined),ids.slice(0,3));assert.deepEqual(active('certification'),ids.slice(0,3));assert.deepEqual(active('current-capture-host-phase-66'),['current-capture-host-phase-66']);assert.deepEqual(active('unknown'),[]);
 assert.equal(Buffer.byteLength(inverseCurrentCaptureWorkflow(currentCaptureWorkflow)),11356);assert.equal(workflow,inverseCurrentCaptureWorkflow(currentCaptureWorkflow));
 let inverse=readFileSync(fileURLToPath(import.meta.url),'utf8');inverse=inverse.slice(0,inverse.indexOf('\n// BEGIN CURRENT66 HOST CAPTURE B TESTS')).replace(/\/\*B@(\d{3})\*\/[\s\S]*?\/\*@B\1\*\//g,'');
 assert.equal(Buffer.byteLength(inverse),4911);assert.equal(createHash('sha256').update(inverse).digest('hex'),'4ff5c79e472800bdd867fd855847b7447055a57db08f3833aad87e8e99e1f48d');
 assert.throws(()=>inverseCurrentCaptureWorkflow(currentCaptureWorkflow+'\n  current-capture-host-phase-66:\n'));assert.throws(()=>inverseCurrentCaptureWorkflow(currentCaptureWorkflow.replace('          - current-capture-host-phase-66\n','')));
});

test('current66 direct command, immutable accepted StageA pins and prerequisite ordering preserve finite original protocol',async()=>{
 const c=await embeddedCurrentCapture('CONTROLLER'),b=await embeddedCurrentCapture('BOUNDS');assert.equal(c.targetCandidate,'66cedcc724308a622045455e8fbfa648afc89b81');assert.equal(Object.keys(c.targetPins).length,21);assert.equal(Object.keys(c.observerPins).length,6);assert.equal(c.appSourceCount,2358);assert.equal(c.appSourceDigest,'e8e431fc48f600b5fa5730a64b3fca00ad4c10dac0f7b3c8e158b742cf1e174a');assert.equal(c.appPin,'e1549f13dc82b9901d9ca23442dbd1ed5bdea285a463e9a1e26c0c3cbc01aa71');assert.deepEqual(c.artifactLimits,b.artifactLimits);
 const identity={targetCommit:c.targetCandidate,driverCommit:'d'.repeat(40),driverRoot:'/driver'};assert.deepEqual(c.diagnosticCommand(identity),['env','GITHUB_SHA='+c.targetCandidate,'VITE_COMMIT_SHA='+c.targetCandidate,'ZK682_EXPECTED_COMMIT='+c.targetCandidate,'python3','/driver/simgolf-lite/scripts/linux-diagnostic-supervisor.py','--out','artifacts/current-capture-host-phase-66/run','--seconds','1850','--parent-seconds','1910','--artifact-cap','1048576','--','npx','playwright','test','--config','playwright.current66-capture-phase.generated.config.ts','e2e/zk682-current-capture-phase.generated.ts','--workers=1','--retries=0']);
 assert.equal(currentCaptureBlock.split('-- npx playwright test ').length-1,1);assert.doesNotMatch(currentCaptureBlock,/-- node scripts\/zk682-run-resource-growth\.mjs|continue-on-error|needs:/);assert.match(currentCaptureBlock,/timeout-minutes: 40/);assert.match(currentCaptureBlock,/source\/generated-provenance\.json/);assert.doesNotMatch(currentCaptureBlock,/renderer-resource-growth-command\.json/);
 const registeredLabels=["Verify current66 target and accepted StageA then stage owned generated files", "Install isolated frozen target dependencies", "Run accepted current66 StageA source controls", "Run unchanged current66 helper controls", "Run unchanged renderer consumer controls", "Run unchanged recording policy controls", "Install target Chromium", "Linux owned supervisor capability smoke", "Discover exactly one derived test without browser", "Run one derived direct Playwright diagnostic with target aliases"];let registeredPrevious=-1;for(const label of registeredLabels){assert.equal(currentCaptureBlock.split('- name: '+label+'\n').length-1,1);const position=currentCaptureBlock.indexOf('- name: '+label+'\n');assert.ok(position>registeredPrevious);registeredPrevious=position;}
 const names=['Run accepted current66 StageA source controls','Run unchanged current66 helper controls','Run unchanged renderer consumer controls','Run unchanged recording policy controls','Install target Chromium','Linux owned supervisor capability smoke','Discover exactly one derived test without browser','Run one derived direct Playwright diagnostic with target aliases','Bound finite partial artifacts','Upload explicit bounded','Retire only owned generated','Require valid current diagnostic'];let previous=-1;for(const name of names){assert.equal(currentCaptureBlock.split(name).length-1,1);const position=currentCaptureBlock.indexOf(name);assert.ok(position>previous);previous=position;}
 for(const key of ['GITHUB_SHA','VITE_COMMIT_SHA','ZK682_EXPECTED_COMMIT'])assert.throws(()=>c.childAliases(identity,{[key]:identity.driverCommit}));assert.deepEqual(c.childAliases(identity,c.childAliases(identity)),c.childAliases(identity));for(const stale of ['4a27e748957925ac476e98e9aaeed4e6a70f095f','0'.repeat(40),undefined])assert.throws(()=>c.assertRegisteredTarget(stale));
});

test('current66 config exact inverse keeps source-root webServer, devices, flags, recording and timeout',async()=>{
 const c=await embeddedCurrentCapture('CONTROLLER'),root=resolve(process.env.ZK682_CANONICAL_SOURCE_ROOT),before=readFileSync(join(root,'playwright.config.ts'),'utf8'),modules=await c.observerModules(resolve(root,'..')),after=modules.prepare.transformConfigSource(before);assert.equal(modules.prepare.inverseConfigSource(after),before);assert.match(after,/testDir: "\.\/e2e"/);assert.match(after,/testMatch: "\*\*\/zk682-current-capture-phase\.generated\.ts"/);assert.match(after,/timeout: 600_000/);assert.match(after,/devices\["Desktop Chrome"\]/);assert.match(after,/trace: "retain-on-failure"/);assert.match(after,/command: "npm run dev -- --configLoader runner --mode e2e --host 127\.0\.0\.1 --port 4174"/);
 assert.doesNotMatch(c.generatedPaths[1],/\.e2e\.ts$/);assert.equal(resolve(root,dirname(c.generatedPaths[1])),resolve(root,'./e2e'));assert.equal(dirname(resolve(root,c.generatedPaths[2])),root);
 assert.deepEqual(modules.prepare.verifyConfigTransform(after,before,readFileSync(join(root,'e2e/zk682-resource-growth.e2e.ts'),'utf8')),{workers:1,retries:0,timeout:600000,slowCalls:1,slowMultiplier:3,effectiveTimeout:1800000,testMatch:'**/zk682-current-capture-phase.generated.ts'});assert.throws(()=>modules.prepare.transformConfigSource(before.replace('timeout: 600_000','timeout: 600_001')));assert.throws(()=>modules.prepare.verifyConfigTransform(after.replace('timeout: 600_000','timeout: 1_800_000'),before,readFileSync(join(root,'e2e/zk682-resource-growth.e2e.ts'),'utf8')));
});

test('current66 actual two Git fixture prepare after driver commit stages and guards correct roots and owned aliases',async()=>{
 const c=await embeddedCurrentCapture('CONTROLLER'),fixtureRoot=realpathSync(mkdtempSync(join(tmpdir(),'zk682-P-prepare-'))),source=resolve(process.env.ZK682_CANONICAL_SOURCE_ROOT),driverApp=resolve(dirname(fileURLToPath(import.meta.url)),'..');
 const init=repo=>{mkdirSync(repo,{recursive:true});const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',timeout:10000,maxBuffer:65536}).trim();git('init');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');return git;};
 const copy=(from,to)=>{mkdirSync(dirname(to),{recursive:true});writeFileSync(to,readFileSync(from));};
 try{for(const nested of [false,true]){
  const driverRoot=join(fixtureRoot,nested?'nested-driver':'separate-driver'),driverGit=init(driverRoot);
  for(const path of Object.keys(c.observerPins))copy(join(driverApp,path),join(driverRoot,'simgolf-lite',path));copy(join(driverApp,'scripts/linux-diagnostic-supervisor.py'),join(driverRoot,'simgolf-lite/scripts/linux-diagnostic-supervisor.py'));copy(workflowPath,join(driverRoot,'.github/workflows/zk682-certification.yml'));driverGit('add','.');driverGit('commit','--quiet','-m','committed exact observer driver');const driverSha=driverGit('rev-parse','HEAD');
  const targetRoot=nested?join(driverRoot,'target'):join(fixtureRoot,'separate-target'),targetGit=init(targetRoot),appRoot=join(targetRoot,'simgolf-lite');for(const path of Object.keys(c.targetPins))copy(join(source,path),join(appRoot,path));const appPaths=execFileSync('git',['-C',resolve(source,'..'),'ls-files','-z','simgolf-lite/src'],{encoding:'utf8',timeout:10000,maxBuffer:1048576}).split('\0').filter(Boolean);assert.equal(appPaths.length,2358);for(const path of appPaths)copy(join(resolve(source,'..'),path),join(targetRoot,path));targetGit('add','.');targetGit('commit','--quiet','-m','source-pinned target fixture');const targetSha=targetGit('rev-parse','HEAD');
  assert.throws(()=>c.assertRegisteredTarget(targetSha));await assert.rejects(c.prepare(driverRoot,targetRoot,targetSha,driverSha));const prepared=await c.prepare(driverRoot,targetRoot,targetSha,driverSha,{fixture:true}),proof=await c.verifyPrepared(driverRoot,targetRoot,targetSha,driverSha,{fixture:true,...prepared});
  assert.deepEqual(proof.provenance.generated.map(row=>row.path),c.generatedPaths);assert.equal(proof.provenance.canonicalCommandReceiptExpected,false);assert.equal(proof.provenance.ledgerBasename,'zk682-current-capture-phase-66-diagnostic.json');assert.equal(proof.provenance.observerImport,new URL('simgolf-lite/scripts/zk682-current-capture-phase/capture.mjs',pathToRootURL(driverRoot)).href);
  const helper=readFileSync(join(appRoot,c.generatedPaths[0]),'utf8');assert.ok(helper.includes(JSON.stringify(proof.provenance.observerImport)));assert.equal(proof.modules.capture.inverseCaptureSource(helper),readFileSync(join(source,'scripts/zk682-public-canvas-capture.mjs'),'utf8'));assert.equal(proof.modules.producer.inverseProducerSource(readFileSync(join(appRoot,c.generatedPaths[1]),'utf8')),readFileSync(join(source,'e2e/zk682-resource-growth.e2e.ts'),'utf8'));assert.equal(proof.modules.prepare.inverseConfigSource(readFileSync(join(appRoot,c.generatedPaths[2]),'utf8')),readFileSync(join(source,'playwright.config.ts'),'utf8'));
  assert.equal(targetGit('diff','--exit-code','HEAD','--'),'');assert.equal(driverGit('diff','--exit-code','HEAD','--'),'');assert.equal(c.verifyPins(appRoot).length,21);assert.equal(c.verifyPins(appRoot,{'src/App.tsx':c.appPin}).length,1);
  const aliases=c.childAliases(prepared),child=JSON.parse(execFileSync(process.execPath,['-e','console.log(JSON.stringify({cwd:process.cwd(),github:process.env.GITHUB_SHA,vite:process.env.VITE_COMMIT_SHA,expected:process.env.ZK682_EXPECTED_COMMIT}))'],{cwd:appRoot,env:{...process.env,...aliases},encoding:'utf8',timeout:10000,maxBuffer:65536}));assert.deepEqual(child,{cwd:appRoot,github:targetSha,vite:targetSha,expected:targetSha});
  assert.throws(()=>c.stage(appRoot,c.generatedPaths[0],helper));await assert.rejects(c.prepare(driverRoot,targetRoot,targetSha,driverSha,{fixture:true}));await assert.rejects(c.verifyPrepared(driverRoot,appRoot,targetSha,driverSha,{fixture:true,...prepared}));await assert.rejects(c.verifyPrepared(driverRoot,targetRoot,targetSha,'0'.repeat(40),{fixture:true,...prepared}));assert.throws(()=>c.verifyCheckouts(driverRoot,driverRoot,driverSha,driverSha));
  const appFile=join(appRoot,'src/App.tsx'),appBytes=readFileSync(appFile);writeFileSync(appFile,Buffer.concat([appBytes,Buffer.from('\n')]));await assert.rejects(c.verifyPrepared(driverRoot,targetRoot,targetSha,driverSha,{fixture:true,...prepared}));writeFileSync(appFile,appBytes);
  const configFile=join(appRoot,c.generatedPaths[2]),configBytes=readFileSync(configFile);writeFileSync(configFile,Buffer.concat([configBytes,Buffer.from('\n')]));await assert.rejects(c.verifyPrepared(driverRoot,targetRoot,targetSha,driverSha,{fixture:true,...prepared}));writeFileSync(configFile,configBytes);
  writeFileSync(join(appRoot,'unowned'),'foreign');await assert.rejects(c.verifyPrepared(driverRoot,targetRoot,targetSha,driverSha,{fixture:true,...prepared}));rmSync(join(appRoot,'unowned'));
  // Synthetic terminal receipt exercises only source-control behavior; no workload is launched.
  const runRoot=join(appRoot,c.namespace,'run'),reporterRoot=join(appRoot,'playwright-report');mkdirSync(runRoot);mkdirSync(reporterRoot);writeFileSync(join(reporterRoot,'index.html'),'control-only original reporter output');
  const synthetic={command:c.directArguments(),workerSeconds:1850,parentSeconds:1910,closureVerified:true,childReaped:true,ownedStillObserved:[],ownedZombiesStillObserved:[]};writeFileSync(join(runRoot,'owned-command-receipt.json'),JSON.stringify(synthetic));
  await assert.rejects(c.verifyPrepared(driverRoot,targetRoot,targetSha,driverSha,{fixture:true,...prepared}));const after=await c.verifyPrepared(driverRoot,targetRoot,targetSha,driverSha,{fixture:true,...prepared,postSettlement:true});assert.match(after.sourceQualification,/no blanket untracked cleanliness claim/);assert.equal(readFileSync(join(reporterRoot,'index.html'),'utf8'),'control-only original reporter output');
  writeFileSync(appFile,Buffer.concat([appBytes,Buffer.from('\n')]));await assert.rejects(c.verifyPrepared(driverRoot,targetRoot,targetSha,driverSha,{fixture:true,...prepared,postSettlement:true}));writeFileSync(appFile,appBytes);
  writeFileSync(join(runRoot,'owned-command-receipt.json'),JSON.stringify({...synthetic,closureVerified:false}));await assert.rejects(c.verifyPrepared(driverRoot,targetRoot,targetSha,driverSha,{fixture:true,...prepared,postSettlement:true}));rmSync(reporterRoot,{recursive:true});rmSync(runRoot,{recursive:true});
  symlinkSync(targetRoot,join(fixtureRoot,nested?'nested-alias':'separate-alias'));assert.throws(()=>c.verifyCheckouts(driverRoot,join(fixtureRoot,nested?'nested-alias':'separate-alias'),targetSha,driverSha));
  const scripts=join(appRoot,'scripts'),scriptsSaved=join(appRoot,'saved-scripts');renameSync(scripts,scriptsSaved);symlinkSync(scriptsSaved,scripts);assert.throws(()=>c.verifyPins(appRoot));rmSync(scripts);renameSync(scriptsSaved,scripts);
  await c.verifyPrepared(driverRoot,targetRoot,targetSha,driverSha,{fixture:true,...prepared});const owned=proof.provenance.generated;
  assert.throws(()=>c.retireGenerated(appRoot,owned,{closureVerified:false}));assert.ok(owned.every(row=>lstatSync(join(appRoot,row.path)).isFile()));
  const ownedFile=join(appRoot,owned[0].path),saved=join(fixtureRoot,nested?'nested-original-helper':'separate-original-helper');renameSync(ownedFile,saved);writeFileSync(ownedFile,'foreign replacement');assert.throws(()=>c.retireGenerated(appRoot,owned,null));assert.equal(readFileSync(ownedFile,'utf8'),'foreign replacement');assert.ok(owned.slice(1).every(row=>lstatSync(join(appRoot,row.path)).isFile()));rmSync(ownedFile);renameSync(saved,ownedFile);
  c.retireGenerated(appRoot,owned,null);for(const row of owned)assert.equal(lstatSync(join(appRoot,row.path),{throwIfNoEntry:false}),undefined);assert.equal(targetGit('diff','--exit-code','HEAD','--'),'');
 }}finally{rmSync(fixtureRoot,{recursive:true,force:true});}
});
function pathToRootURL(root){return new URL('file://'+root+'/');}

test('current66 strict finite artifact/ledger bounds and forward reverse actual inventory refuse unsafe partial inputs',async()=>{
 const c=await embeddedCurrentCapture('CONTROLLER'),b=await embeddedCurrentCapture('BOUNDS'),root=realpathSync(mkdtempSync(join(tmpdir(),'zk682-P-art-')));
 try{
  assert.equal(b.validateBounds(root),0);assert.deepEqual(await b.assessPresent(root,'/unused',c,{}),{diagnosticReady:false,phase:'UNKNOWN',qualification:'Ledger file absent; not reached or unknown, no fabricated stdout payload'});
  for(const name of ['unknown','__proto__','run/renderer-resource-growth-command.json','run/../source/identity.json'])assert.throws(()=>b.boundedArtifact(root,name));assert.equal(b.artifactLimits['run/zk682-current-capture-phase-66-diagnostic.json'],8192);assert.equal(b.artifactLimits['source/generated-provenance.json'],65536);
  mkdirSync(join(root,'run'));const ledger=join(root,'run/zk682-current-capture-phase-66-diagnostic.json');writeFileSync(ledger,Buffer.alloc(8193));assert.throws(()=>b.validateBounds(root));rmSync(ledger);symlinkSync('/tmp',ledger);assert.throws(()=>b.validateBounds(root));rmSync(ledger);
  writeFileSync(join(root,'run/stdout.log'),'\u001b[31mPlaywright prefix\u001b[0m\n');writeFileSync(join(root,'run/stderr.log'),'');const rows=['stdout.log','stderr.log'].map(path=>{const bytes=readFileSync(join(root,'run',path));return {path,bytes:bytes.length,sha256:b.hash(bytes)};});b.verifyInventory({artifacts:rows},root,'run');assert.throws(()=>b.verifyInventory({artifacts:[rows[0],rows[0]]},root,'run'));assert.throws(()=>b.verifyInventory({artifacts:rows.slice(0,1)},root,'run'));assert.throws(()=>b.verifyInventory({artifacts:[{...rows[0],sha256:'0'.repeat(64)},rows[1]]},root,'run'));
  writeFileSync(join(root,'run/unknown.json'),'{}');assert.throws(()=>b.validateBounds(root));rmSync(join(root,'run/unknown.json'));writeFileSync(join(root,'run/stdout.log'),Buffer.alloc(262144));writeFileSync(join(root,'run/stderr.log'),'x');assert.throws(()=>b.validateBounds(root));rmSync(join(root,'run/stdout.log'));rmSync(join(root,'run/stderr.log'));
  writeFileSync(join(root,'run/zk682-resource-growth-final.png'),Buffer.alloc(1048577));assert.throws(()=>b.validateBounds(root));writeFileSync(join(root,'run/zk682-resource-growth-final.png'),Buffer.alloc(1048500));writeFileSync(join(root,'run/renderer-resource-growth.json'),Buffer.alloc(100));assert.throws(()=>b.validateBounds(root));rmSync(join(root,'run/zk682-resource-growth-final.png'));rmSync(join(root,'run/renderer-resource-growth.json'));
  const modules=await c.observerModules(resolve(dirname(fileURLToPath(import.meta.url)),'../..')),observer=modules.capture.createCaptureObserver({clock:()=>1});observer.enter('raw-acquire');observer.end('raw-acquire');const snapshot=observer.finish(false);writeFileSync(ledger,JSON.stringify(snapshot)+'\n');assert.ok(b.validateBounds(root)>0);const bad=structuredClone(snapshot);bad.rows[0].status='forged';writeFileSync(ledger,JSON.stringify(bad));await assert.rejects(b.assessPresent(root,'/unused',c,{modules}));
  const upload=currentCaptureBlock.split('          path: |\n')[1].split('          if-no-files-found:')[0].trim().split('\n').map(line=>line.trim());assert.deepEqual(upload,Object.keys(b.artifactLimits).map(name=>'target/simgolf-lite/artifacts/current-capture-host-phase-66/'+name));assert.match(currentCaptureBlock,/always\(\) && steps\.current_capture_artifact_bounds\.conclusion == 'success'/);
 }finally{rmSync(root,{recursive:true,force:true});}
});


test('current66 projected accepted preparation executes the two portable config controls at real driver placement',()=>{
 const app=resolve(dirname(fileURLToPath(import.meta.url)),'..'),file=join(app,'scripts/zk682-current-capture-phase/prepare.mjs'),source=readFileSync(file,'utf8');
 assert.equal(createHash('sha256').update(source).digest('hex'),'18e58370cad556ea80b10dce238e45c9991188e70ef84b8d5c617db3922ced7b');assert.doesNotMatch(source,/private\/tmp|golf-66-current-capture-host-phase-source-1/);
 const env={...process.env,O_CAPTURE_DONOR_ROOT:resolve(process.env.ZK682_CANONICAL_SOURCE_ROOT)};delete env.NODE_TEST_CONTEXT;
 const portable=execFileSync(process.execPath,['--test','--test-reporter=tap',join(app,'scripts/zk682-current-capture-phase/prepare.test.mjs')],{cwd:app,env,encoding:'utf8',timeout:45000,maxBuffer:262144});
 assert.match(portable,/# tests 2\r?\n/);assert.match(portable,/# pass 2\r?\n/);assert.match(portable,/# fail 0\r?\n/);
});

test('current66 actual main prepare rejects committed wrong source pin, full app digest and driver module before staging',async()=>{
 const c=await embeddedCurrentCapture('CONTROLLER'),root=realpathSync(mkdtempSync(join(tmpdir(),'zk682-current66-mutants-'))),source=resolve(process.env.ZK682_CANONICAL_SOURCE_ROOT),driverApp=resolve(dirname(fileURLToPath(import.meta.url)),'..');
 const init=repo=>{mkdirSync(repo,{recursive:true});const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',timeout:10000,maxBuffer:65536}).trim();git('init');git('config','user.email','fixture@example.invalid');git('config','user.name','Explicit synthetic fixture');return git;};
 const copy=(from,to)=>{mkdirSync(dirname(to),{recursive:true});writeFileSync(to,readFileSync(from));};
 try{
  const driver=join(root,'driver'),target=join(driver,'target'),app=join(target,'simgolf-lite'),dg=init(driver);
  for(const path of Object.keys(c.observerPins))copy(join(driverApp,path),join(driver,'simgolf-lite',path));copy(join(driverApp,'scripts/linux-diagnostic-supervisor.py'),join(driver,'simgolf-lite/scripts/linux-diagnostic-supervisor.py'));copy(workflowPath,join(driver,'.github/workflows/zk682-certification.yml'));dg('add','.');dg('commit','--quiet','-m','explicit synthetic source-pinned driver');let driverSha=dg('rev-parse','HEAD');
  const tg=init(target);for(const path of Object.keys(c.targetPins))copy(join(source,path),join(app,path));const names=execFileSync('git',['-C',resolve(source,'..'),'ls-files','-z','simgolf-lite/src'],{encoding:'utf8',timeout:10000,maxBuffer:1048576}).split('\0').filter(Boolean);for(const path of names)copy(join(resolve(source,'..'),path),join(target,path));tg('add','.');tg('commit','--quiet','-m','explicit synthetic complete target');let targetSha=tg('rev-parse','HEAD');
  assert.deepEqual(c.verifyAppSources(target),{count:2358,digest:c.appSourceDigest});
  await assert.rejects(c.prepare(driver,target,targetSha,'0'.repeat(40),{fixture:true}));
  const helper=join(app,'scripts/zk682-public-canvas-capture.mjs'),original=readFileSync(helper);writeFileSync(helper,Buffer.concat([original,Buffer.from('\n')]));tg('add','.');tg('commit','--quiet','-m','synthetic wrong canonical helper source');targetSha=tg('rev-parse','HEAD');
  await assert.rejects(c.prepare(driver,target,targetSha,driverSha,{fixture:true}),/source mismatch scripts\/zk682-public-canvas-capture/);assert.equal(lstatSync(join(app,c.namespace),{throwIfNoEntry:false}),undefined);
  writeFileSync(helper,original);tg('add','.');tg('commit','--quiet','-m','restore exact helper source');
  const extra=names.find(path=>path!=='simgolf-lite/src/App.tsx'),extraFile=join(target,extra),extraOriginal=readFileSync(extraFile);writeFileSync(extraFile,Buffer.concat([extraOriginal,Buffer.from('\n')]));tg('add','.');tg('commit','--quiet','-m','synthetic full app digest mutant');targetSha=tg('rev-parse','HEAD');
  await assert.rejects(c.prepare(driver,target,targetSha,driverSha,{fixture:true}),/full app source digest/);assert.equal(lstatSync(join(app,c.namespace),{throwIfNoEntry:false}),undefined);
  writeFileSync(extraFile,extraOriginal);tg('add','.');tg('commit','--quiet','-m','restore exact full app source');targetSha=tg('rev-parse','HEAD');
  const moduleFile=join(driver,'simgolf-lite/scripts/zk682-current-capture-phase/prepare.mjs'),moduleOriginal=readFileSync(moduleFile);writeFileSync(moduleFile,Buffer.concat([moduleOriginal,Buffer.from('\n')]));dg('add','simgolf-lite/scripts/zk682-current-capture-phase/prepare.mjs');dg('commit','--quiet','-m','synthetic unaccepted prepare module');driverSha=dg('rev-parse','HEAD');
  await assert.rejects(c.prepare(driver,target,targetSha,driverSha,{fixture:true}),/source mismatch scripts\/zk682-current-capture-phase\/prepare/);assert.equal(lstatSync(join(app,c.namespace),{throwIfNoEntry:false}),undefined);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('current66 stage preserves falsy first errors, rolls back only created inode and refuses aliases',async()=>{
 const c=await embeddedCurrentCapture('CONTROLLER'),fs=await import('node:fs'),{syncBuiltinESMExports}=await import('node:module'),root=realpathSync(mkdtempSync(join(tmpdir(),'zk682-current66-stage-'))),originalWrite=fs.default.writeFileSync,originalClose=fs.default.closeSync;
 try{
  const app=join(root,'app');mkdirSync(app);const output=join(app,c.generatedPaths[0]);
  for(const primary of [undefined,null,false,0,'']){
   fs.default.writeFileSync=(fd,...args)=>{if(typeof fd==='number')throw primary;return originalWrite(fd,...args);};
   fs.default.closeSync=fd=>{originalClose(fd);throw Symbol('secondary close failure');};syncBuiltinESMExports();
   let failed=false,actual;try{c.stage(app,c.generatedPaths[0],'owned');}catch(error){failed=true;actual=error;}assert.equal(failed,true);assert.equal(actual,primary);assert.equal(lstatSync(output,{throwIfNoEntry:false}),undefined);
   fs.default.writeFileSync=originalWrite;fs.default.closeSync=originalClose;syncBuiltinESMExports();
  }
  mkdirSync(dirname(output),{recursive:true});symlinkSync(join(root,'foreign'),output);assert.throws(()=>c.stage(app,c.generatedPaths[0],'owned'));assert.equal(lstatSync(output).isSymbolicLink(),true);rmSync(output);
  const owner=c.stage(app,c.generatedPaths[0],'owned');assert.throws(()=>c.stage(app,c.generatedPaths[0],'replacement'));assert.equal(readFileSync(output,'utf8'),'owned');c.verifyOwned(output,owner);
 }finally{fs.default.writeFileSync=originalWrite;fs.default.closeSync=originalClose;syncBuiltinESMExports();rmSync(root,{recursive:true,force:true});}
});

// END CURRENT66 HOST CAPTURE B TESTS
