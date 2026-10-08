import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, unlinkSync, symlinkSync } from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {spawnSync} from "node:child_process";
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
  assert.doesNotMatch(workflow.split("\n  startup-verification:\n")[0], /github\.sha|GITHUB_SHA/);
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

const startupBlock=jobBlock('startup-verification',null);
function extractedController(){const start=startupBlock.indexOf('// STARTUP_VERIFICATION_CONTROLLER_BEGIN'),end=startupBlock.indexOf('// STARTUP_VERIFICATION_CONTROLLER_END');assert(start>=0&&end>start);return startupBlock.slice(start,end).split('\n').map(line=>line.replace(/^          /,'')).join('\n');}
async function controller(){const previous=process.env.ZK682_STARTUP_CONTROLLER_EXECUTE;delete process.env.ZK682_STARTUP_CONTROLLER_EXECUTE;try{return await import('data:text/javascript;base64,'+Buffer.from(extractedController()).toString('base64'));}finally{if(previous!==undefined)process.env.ZK682_STARTUP_CONTROLLER_EXECUTE=previous;}}
function passingReport(){return {fixture:'m27Fixture',theme:'parkland',fixtureLoadMs:6000,coldStartupMs:5000,renderer:{workMs:8,golfers:100},effective:{fixture:'m27Fixture',theme:'parkland',warmupSeconds:8,measureSeconds:20,browserMode:'headless',frameAssertion:false,budgets:{fixtureLoadMilliseconds:6000,coldStartupMilliseconds:5000,rendererWorkMilliseconds:8}},physicalRun:{browser:{userAgent:'actual Chromium',renderer:'actual software driver',viewport:{width:1440,height:900,devicePixelRatio:1}}}};}
const passingOwnership={exitCode:0,cause:null,closureVerified:true,passed:true};

test('startup verification executes independent typed gates including fixture gate',async()=>{const c=await controller();assert.equal(c.typedVerdict(passingReport(),passingOwnership,0).passed,true);for(const value of [undefined,null,NaN,Infinity,-1,6001]){const report=passingReport();report.fixtureLoadMs=value;report.gateValidation={passed:true};assert.equal(c.typedVerdict(report,passingOwnership,0).passed,false);}for(const [field,value] of [['coldStartupMs',5001],['renderer', {workMs:8.01,golfers:100}],['fixture','perfFixture'],['effective',{}]]){const report=passingReport();report[field]=value;assert.equal(c.typedVerdict(report,passingOwnership,0).passed,false);}assert.equal(c.typedVerdict(passingReport(),passingOwnership,1).passed,false);assert.equal(c.typedVerdict(passingReport(),{...passingOwnership,closureVerified:false},0).passed,false);const wrong=passingReport();wrong.sourceCommit='wrong';assert.equal(c.typedVerdict(wrong,passingOwnership,0).passed,false);});

test('startup verification binds actual Git driver and target fixtures and subprocess aliases',async()=>{const c=await controller();const root=mkdtempSync(join(tmpdir(),'zk682-startup-routing-'));try{const driver=join(root,'driver'),target=join(root,'target');for(const dir of [driver,target]){mkdirSync(dir);const run=(args)=>{const result=spawnSync('git',args,{cwd:dir,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};run(['init','--quiet']);run(['config','user.email','fixture@example.invalid']);run(['config','user.name','Fixture']);writeFileSync(join(dir,'identity.txt'),dir);run(['add','identity.txt']);run(['commit','--quiet','-m','fixture']);}const driverSha=c.git(driver,['rev-parse','HEAD']),targetSha=c.git(target,['rev-parse','HEAD']);assert.notEqual(driverSha,targetSha);const ids=c.bindCheckouts(driver,target,driverSha,targetSha);assert.equal(ids.driverCommit,driverSha);assert.equal(ids.targetAppCommit,targetSha);assert.throws(()=>c.bindCheckouts(driver,target,targetSha,targetSha));assert.throws(()=>c.bindCheckouts(driver,target,driverSha));const env=c.childEnvironment({...process.env,GITHUB_SHA:driverSha,VITE_COMMIT_SHA:'conflicting-driver'},targetSha,targetSha);const child=spawnSync(process.execPath,['-e','console.log(JSON.stringify({a:process.env.GITHUB_SHA,b:process.env.VITE_COMMIT_SHA,fixture:process.env.PERF_FIXTURE}))'],{cwd:target,env,encoding:'utf8'});assert.equal(child.status,0);assert.deepEqual(JSON.parse(child.stdout),{a:targetSha,b:targetSha,fixture:'m27'});assert.throws(()=>c.childEnvironment({},driverSha,targetSha));writeFileSync(join(target,'identity.txt'),'dirty');assert.throws(()=>c.bindCheckouts(driver,target,driverSha,targetSha));}finally{rmSync(root,{recursive:true,force:true});}});

test('startup verification actual artifact bounds reject unknown symlinks raw and aggregate capacity',async()=>{const c=await controller();const root=mkdtempSync(join(tmpdir(),'zk682-startup-artifacts-'));try{writeFileSync(join(root,'performance.json'),'{}');assert.equal(c.artifactBounds(root),2);writeFileSync(join(root,'unknown.raw'),'x');assert.throws(()=>c.artifactBounds(root));unlinkSync(join(root,'unknown.raw'));writeFileSync(join(root,'performance.json'),'x'.repeat(65537));assert.throws(()=>c.artifactBounds(root));unlinkSync(join(root,'performance.json'));symlinkSync('missing',join(root,'performance.json'));assert.throws(()=>c.artifactBounds(root));unlinkSync(join(root,'performance.json'));writeFileSync(join(root,'owned-command-receipt.json'),'x'.repeat(1048576));writeFileSync(join(root,'stdout.log'),'x');assert.throws(()=>c.artifactBounds(root));}finally{rmSync(root,{recursive:true,force:true});}});

test('startup verification routing evaluates exclusivity and default certification',()=>{const ids=['linux-evidence','native-evidence','aggregate','renderer-diagnostic','startup-diagnostic','startup-verification'];function selected(mode){return ids.filter(id=>{const block=jobsText.slice(jobsText.indexOf(`  ${id}:\n`));const expression=block.match(/^    if: \$\{\{ (.*?) \}\}/m)?.[1];assert(expression);return new Function('mode','return '+expression.replaceAll('inputs.mode','mode'))(mode);});}assert.deepEqual(selected(undefined),ids.slice(0,3));assert.deepEqual(selected('certification'),ids.slice(0,3));for(const mode of ids.slice(3))assert.deepEqual(selected(mode),[mode]);assert(startupBlock.includes('path: driver'));assert(startupBlock.includes('path: target'));assert(startupBlock.includes('working-directory: target/simgolf-lite'));assert(startupBlock.includes("steps.original_startup.outputs.artifact_bounds == 'true'"));});


test('startup verification own-property allowlist rejects prototype filenames',async()=>{const c=await controller();const root=mkdtempSync(join(tmpdir(),'zk682-startup-prototype-'));try{for(const name of ['toString','__proto__']){writeFileSync(join(root,name),'x');assert.throws(()=>c.artifactBounds(root));unlinkSync(join(root,name));}}finally{rmSync(root,{recursive:true,force:true});}});

test('startup verification actual smoke helper requires bounded successful owned capability before producer',async()=>{const c=await controller();const root=mkdtempSync(join(tmpdir(),'zk682-startup-smoke-'));try{let calls=0;const runner=(command,args,options)=>{calls++;assert.equal(command,'python3');assert.deepEqual(args.slice(2,10),[root,'--seconds','30','--parent-seconds','60','--artifact-cap','1048576','--']);assert.equal(options.cwd,root);assert.equal(options.timeout,60000);writeFileSync(join(root,'owned-command-receipt.json'),JSON.stringify(passingOwnership));return {status:0};};const result=c.runSmoke('/driver/supervisor.py',root,{GITHUB_SHA:c.TARGET},root,runner);assert.equal(calls,1);assert.equal(result.closureVerified,true);assert.equal(result.receiptSha256.length,64);for(const receipt of [{...passingOwnership,closureVerified:false},{...passingOwnership,cause:'timeout'},{...passingOwnership,exitCode:1}])assert.throws(()=>c.requireSmokeResult(receipt,{status:0}));assert.throws(()=>c.requireSmokeResult(passingOwnership,{status:1}));assert.throws(()=>c.requireSmokeResult(passingOwnership,{status:0,error:Error('timeout')}));}finally{rmSync(root,{recursive:true,force:true});}});


test('startup verification bounded source-list subprocess exceeds64KiB but rejects1MiB overflow',async()=>{const c=await controller();let observed=[];const runner=(command,args,options)=>{assert.equal(command,'git');assert.deepEqual(args,['-C','/fixture','ls-files','simgolf-lite/src']);observed.push(options.maxBuffer);return spawnSync(process.execPath,['-e',"process.stdout.write(Array.from({length:2356},(_,i)=>'simgolf-lite/src/'+i+'-'+ 'x'.repeat(64)+'.ts').join('\\n'))"],options);};const listing=c.git('/fixture',['ls-files','simgolf-lite/src'],1048576,runner);assert(Buffer.byteLength(listing)>65536);assert(Buffer.byteLength(listing)<=1048576);assert.equal(listing.split('\n').length,2356);assert.deepEqual(observed,[1048576]);assert.throws(()=>c.git('/fixture',['ls-files','simgolf-lite/src'],65536,runner));const overflow=(command,args,options)=>{assert.equal(options.maxBuffer,1048576);const result=spawnSync(process.execPath,['-e',"process.stdout.write('x'.repeat(1048577))"],options);assert(result.error,'Actual child output overflow must reject');return result;};assert.throws(()=>c.git('/fixture',['ls-files','simgolf-lite/src'],1048576,overflow));assert.throws(()=>c.git('/fixture',['rev-parse','HEAD'],1048576,()=>{throw Error('Must not spawn');}));assert.throws(()=>c.git('/fixture',['ls-files','simgolf-lite/src'],Infinity,()=>{throw Error('Must not spawn');}));});


// Q_STARTUP_DEMAND_VERIFICATION_TESTS_BEGIN
test('Q startup verification actual demand pin guard accepts complete files and rejects stale missing symlink oversized sources',async()=>{
  const c=await controller();const root=mkdtempSync(join(tmpdir(),'zk682-Q-demand-pins-'));
  const keys=Object.keys(c.DEMAND_PINS),contents=Object.fromEntries(keys.map((key,i)=>[key,'source-fixture-'+i])),expected=Object.fromEntries(keys.map(key=>[key,createHash('sha256').update(contents[key]).digest('hex')]));
  const restore=()=>{for(const key of keys){const file=join(root,key);mkdirSync(join(file,'..'),{recursive:true});rmSync(file,{force:true});writeFileSync(file,contents[key]);}};
  try{
    assert.equal(c.TARGET,'0d4307addd412c9653b0ec50af142cead8cac955');assert.equal(keys.length,3);restore();
    const rows=c.verifyDemandPins(root,expected);assert.deepEqual(rows.map(x=>[x.path,x.sha256]),keys.map(key=>[key,expected[key]]));
    assert.throws(()=>c.verifyDemandPins(root),/Demand source pin mismatch/);
    for(const key of keys){writeFileSync(join(root,key),'stale');assert.throws(()=>c.verifyDemandPins(root,expected));restore();unlinkSync(join(root,key));assert.throws(()=>c.verifyDemandPins(root,expected));restore();}
    const file=join(root,keys[1]);unlinkSync(file);symlinkSync(join(root,keys[0]),file);assert.throws(()=>c.verifyDemandPins(root,expected),/ownership/);restore();
    writeFileSync(file,'x'.repeat(1048577));assert.throws(()=>c.verifyDemandPins(root,expected),/size/);restore();
    for(const invalid of [{},{...expected,extra:'a'.repeat(64)},{...expected,[keys[0]]:'not-a-hash'}])assert.throws(()=>c.verifyDemandPins(root,invalid),/pin set/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('Q startup verification exact full workflow inverse preserves accepted routing producer budgets and source-list guard',()=>{
  const restored=workflow
    .replace('          ref: 0d4307addd412c9653b0ec50af142cead8cac955\n          path: target','          ref: ab8f4e2cde4d54666db6406ca5aeee598d207768\n          path: target')
    .replace('          test "$(git rev-parse HEAD)" = 0d4307addd412c9653b0ec50af142cead8cac955','          test "$(git rev-parse HEAD)" = ab8f4e2cde4d54666db6406ca5aeee598d207768')
    .replace("          export const TARGET='0d4307addd412c9653b0ec50af142cead8cac955';","          export const TARGET='ab8f4e2cde4d54666db6406ca5aeee598d207768';")
    .replace(new RegExp('^          // Q_DEMAND_PIN_GUARD_BEGIN\n[\\s\\S]*?^          // Q_DEMAND_PIN_GUARD_END\n','m'),'')
    .replace("const demandSourcePins=verifyDemandPins(target);const names=[","const names=[")
    .replace('supervisorSha256:SUPERVISOR,demandSourcePins,pins,','supervisorSha256:SUPERVISOR,pins,');
  assert.equal(createHash('sha256').update(restored).digest('hex'),'122cb645cda1b1e5b54378f5a5b9fcd85ceb0ba9cde0f162023810516ceb7978');
  assert.notEqual(createHash('sha256').update(restored.replace("PERF_WARMUP_S:'8'","PERF_WARMUP_S:'9'")).digest('hex'),'122cb645cda1b1e5b54378f5a5b9fcd85ceb0ba9cde0f162023810516ceb7978');
  assert(startupBlock.indexOf('verifyDemandPins(target)')<startupBlock.indexOf('const smoke=runSmoke'));assert(startupBlock.includes('appSourceFileCount:sourceRows.length'));assert(startupBlock.includes("git(target,['ls-files','simgolf-lite/src'],1048576)"));
});
// Q_STARTUP_DEMAND_VERIFICATION_TESTS_END
