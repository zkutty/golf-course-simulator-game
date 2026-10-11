import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { inspectZk682CommandReceipt } from './zk682-command-receipt.mjs';

const require = createRequire(import.meta.url);
const yaml = require(process.env.ZK1262_YAML_MODULE ?? 'js-yaml');
const base = path.resolve(path.dirname(new URL(import.meta.url).pathname),'../..');
const workflowPath = path.join(base,'.github/workflows/zk1262-capture-phase.yml');
const helperPath = process.env.ZK1262_STAGEC_HELPER ?? path.join(base,'simgolf-lite/scripts/zk1262-capture-phase-driver.py');
const text = fs.readFileSync(workflowPath,'utf8');
const workflow = yaml.load(text);
const job = workflow.jobs['capture-phase'];
const CANDIDATE='b7fe6c8be45ef6dbf4793cbd3714f2bc34d91025';
const PY = String.raw`import importlib.util,json,sys,os
from pathlib import Path
spec=importlib.util.spec_from_file_location('driver',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
a=json.load(sys.stdin)
try:
 op=a['op']
 if op=='roles':value=m.roles(a['env'])
 elif op=='guard':value=m.source_guard(Path(a['repo']),a['head'],a['pins'],a.get('owned'),a.get('post',False))
 elif op=='projection':
  owned=m.project_copies(Path(a['driver']),Path(a['target']));value={'owned':owned,'inverse':[len(m.invert_projection(m.file_bytes(Path(a['driver'])/row['target'],65536)[0],row)) for row in m.MAPS]}
 elif op=='receipt':value=m.receipt(a['data'].encode(),Path(a['target']))
 elif op=='strict':value=m.strict_json(a['data'].encode())
 elif op=='inventory':value=m.inventory(Path(a['root']))
 elif op=='failure':
  state={};m.first_failure(state,'first',a['first']);m.first_failure(state,'later','replacement');value=state
 elif op=='wx':m.wx(Path(a['path']),a['value']);value={'written':True}
 elif op=='finalize':
  if a.get('gitFault'):
   def broken(*args,**kwargs):raise m.subprocess.TimeoutExpired('git-source-query',10)
   m.subprocess.run=broken
  value=m.finalize(Path(a['driver']),Path(a['target']),Path(a['root']),a['env'])
 elif op=='admit':
  root=Path(a['root']);value=m.inventory(root);value.update(a['value']);owned=m.wx(root/'inventory.json',value,65536)
  if a.get('change')=='roles':value['publicationRoles']['run_id']+=1
  if a.get('change')=='bytes':(root/'inventory.json').write_text('{}')
  if a.get('change')=='inode':
   p=root/'inventory.json';data=p.read_bytes();p.rename(root/'held-inventory');p.write_bytes(data)
  value=m.admit(root,value,owned,a['env'])
 elif op=='select':value=str(m.select_default_shell(Path(a['public']),a['registry'],a.get('env',{})))
 elif op=='constants':value={'pins':m.PINS,'tools':m.TOOLS,'roles':m.ROLES,'argv':m.RECEIPT_ARGV}
 else:raise ValueError('unknown controlled operation')
 print(json.dumps({'ok':True,'value':value},allow_nan=False))
except Exception as e:print(json.dumps({'ok':False,'kind':type(e).__name__,'message':str(e)}))
`;
function py(args){
  const result=spawnSync('python3',['-c',PY,helperPath],{input:JSON.stringify(args),encoding:'utf8',timeout:20000,maxBuffer:262144});
  assert.equal(result.status,0,result.stderr || String(result.error));
  return JSON.parse(result.stdout);
}
function git(repo,args){
  const result=spawnSync('git',['-C',repo,...args],{encoding:'utf8',timeout:10000,maxBuffer:262144});
  assert.equal(result.status,0,result.stderr || String(result.error));return result.stdout.trim();
}
function temporary(fn){
  const p=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'zk1262-stagec-')));
  try{return fn(p);}finally{fs.rmSync(p,{recursive:true,force:true});}
}
function fixture(root){
  const driver=path.join(root,'driver'),target=path.join(root,'target');fs.mkdirSync(driver);fs.mkdirSync(target);
  const constants=py({op:'constants'}).value;
  for(const rel of Object.keys(constants.tools)){
    const dest=path.join(driver,rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(base,rel),dest);
  }
  for(const rel of Object.keys(constants.pins)){
    const dest=path.join(target,rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(base,rel),dest);
  }
  const receipt=path.join(target,'simgolf-lite/scripts/zk682-command-receipt.mjs');fs.mkdirSync(path.dirname(receipt),{recursive:true});fs.copyFileSync(path.join(base,'simgolf-lite/scripts/zk682-command-receipt.mjs'),receipt);
  git(target,['init','--quiet']);git(target,['config','user.email','fixture@example.invalid']);git(target,['config','user.name','Synthetic Fixture']);git(target,['add','.']);git(target,['commit','--quiet','-m','synthetic source fixture']);
  return {driver,target,head:git(target,['rev-parse','HEAD']),...constants};
}
function roles(){return {CAPTURE_CANDIDATE_SHA:CANDIDATE,CAPTURE_SOURCE_SHA:'2'.repeat(40),GITHUB_SHA:'2'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_NAME:'workflow_dispatch'};}
function receipt(exitCode=0){return {schemaVersion:1,kind:'command-receipt',receiptId:'renderer-resource-growth',candidateCommit:CANDIDATE,capturedAt:'2026-10-10T00:00:00.000Z',command:['npx','playwright','test','e2e/zk1262-capture-phase-diagnostic.e2e.ts','--workers=1','--retries=0'],exitCode,durationMs:10,passed:exitCode===0};}

test('dedicated YAML event/input/job/roles and finite effective envelopes',()=>{
  assert.deepEqual(Object.keys(workflow.on),['workflow_dispatch']);assert.deepEqual(Object.keys(workflow.on.workflow_dispatch.inputs),['candidate_sha','source_sha']);
  assert.deepEqual(Object.keys(workflow.jobs),['capture-phase']);assert.equal(job['timeout-minutes'],75);assert.equal(job['runs-on'],'ubuntu-latest');
  assert.equal(job.steps.reduce((n,s)=>n+s['timeout-minutes'],0),75);
  assert.equal(job.env.CAPTURE_SOURCE_SHA,'${{ inputs.source_sha }}');assert.equal(job.env.CAPTURE_CANDIDATE_SHA,'${{ inputs.candidate_sha }}');
  const checkouts=job.steps.filter(s=>s.uses==='actions/checkout@v4');assert.equal(checkouts.length,2);assert.notEqual(checkouts[0].with.path,checkouts[1].with.path);assert.equal(checkouts[0].with.ref,'${{ github.sha }}');assert.equal(checkouts[1].with.ref,CANDIDATE);
  assert.equal(job.steps.find(s=>s.id==='producer')['timeout-minutes'],33);
});

test('actual role validator rejects wrong candidate/source/attempt/mode event before producer',()=>{
  assert.equal(py({op:'roles',env:roles()}).ok,true);
  for(const [key,value] of [['CAPTURE_CANDIDATE_SHA','3'.repeat(40)],['CAPTURE_SOURCE_SHA','4'.repeat(40)],['GITHUB_RUN_ATTEMPT','2'],['GITHUB_EVENT_NAME','push'],['GITHUB_RUN_ID','0'],['CAPTURE_SOURCE_SHA','UNRESOLVED']]){
    assert.equal(py({op:'roles',env:{...roles(),[key]:value}}).ok,false,key);
  }
});

test('extracted real producer shell uses exact original runner argv and GNU group qualification',()=>{
  const step=job.steps.find(s=>s.id==='producer');assert.match(step.run,/timeout --signal=TERM --kill-after=60s 1920s node scripts\/zk1262-run-capture-phase-diagnostic\.mjs --expected-commit "\$CAPTURE_CANDIDATE_SHA" --output "\$CAPTURE_ARTIFACT_ROOT\/renderer-resource-growth\.json"/);
  assert.equal(step.env.GITHUB_SHA,CANDIDATE);assert.equal(step.env.VITE_COMMIT_SHA,CANDIDATE);assert.equal(step.env.ZK682_EXPECTED_COMMIT,CANDIDATE);
  assert.match(step.run,/exit "\$code"/);assert.match(step.run,/process group, not universal/);assert.doesNotMatch(step.run,/--grep|--headed|executablePath|--channel|test:stability|original-app-heap/);
  const bash=spawnSync('bash',['-n'],{input:step.run,encoding:'utf8',timeout:5000});assert.equal(bash.status,0,bash.stderr);
});

test('real Git source guard clean and tracked dirty before/after, no restoration',()=>temporary(root=>{
  const f=fixture(root);assert.equal(py({op:'guard',repo:f.target,head:f.head,pins:f.pins}).value.ok,true);
  fs.appendFileSync(path.join(f.target,'simgolf-lite/package.json'),'\n');
  for(const post of [false,true]){const result=py({op:'guard',repo:f.target,head:f.head,pins:f.pins,post});assert.equal(result.ok,true);assert.equal(result.value.ok,false);assert.ok(result.value.trackedChanges.some(x=>x.path==='simgolf-lite/package.json'));}
  assert.ok(fs.readFileSync(path.join(f.target,'simgolf-lite/package.json'),'utf8').endsWith('\n\n'));
  assert.equal(py({op:'guard',repo:f.target,head:'3'.repeat(40),pins:f.pins}).value.ok,false);
}));

test('actual four exclusive projections prove full inverses and stable owned identities',()=>temporary(root=>{
  const f=fixture(root),projected=py({op:'projection',driver:f.driver,target:f.target});assert.equal(projected.ok,true);assert.equal(Object.keys(projected.value.owned).length,4);assert.equal(projected.value.inverse.length,4);
  const owned=projected.value.owned;assert.equal(py({op:'guard',repo:f.target,head:f.head,pins:f.pins,owned}).value.ok,true);
  const relative=Object.keys(owned)[0],p=path.join(f.target,relative),data=fs.readFileSync(p);fs.renameSync(p,p+'.held');fs.writeFileSync(p,data);
  const changed=py({op:'guard',repo:f.target,head:f.head,pins:f.pins,owned}).value;assert.equal(changed.ok,false);assert.ok(changed.ownedProjectionErrors.includes(relative));
}));

test('projection alias and existing sentinel refuse without overwriting',()=>temporary(root=>{
  const f=fixture(root);const rel=Object.keys(f.tools)[0],p=path.join(f.target,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'SENTINEL');
  assert.equal(py({op:'projection',driver:f.driver,target:f.target}).ok,false);assert.equal(fs.readFileSync(p,'utf8'),'SENTINEL');
  fs.unlinkSync(p);fs.symlinkSync(path.join(f.driver,rel),p);assert.equal(py({op:'projection',driver:f.driver,target:f.target}).ok,false);
}));

test('untracked before gate is strict; normal post reporter paths recorded without blanket cleanliness',()=>temporary(root=>{
  const f=fixture(root);fs.writeFileSync(path.join(f.target,'untracked-normal-reporter.json'),'{}');
  const before=py({op:'guard',repo:f.target,head:f.head,pins:f.pins});assert.equal(before.value.ok,false);
  const after=py({op:'guard',repo:f.target,head:f.head,pins:f.pins,post:true});assert.equal(after.value.ok,true);assert.deepEqual(after.value.untrackedExtra,['untracked-normal-reporter.json']);assert.equal(after.value.untrackedPostPredicate,false);
}));

test('strict receipt caller preserves canonical zero and nonzero predicates plus exact argv',()=>temporary(root=>{
  const f=fixture(root);
  for(const code of [0,1,124]){const value=receipt(code);const original=inspectZk682CommandReceipt(value,{candidateCommit:CANDIDATE,receiptId:'renderer-resource-growth'});assert.equal(original.valid,true);
    const actual=py({op:'receipt',target:f.target,data:JSON.stringify(value)});assert.equal(actual.ok,true);assert.equal(actual.value.passed,code===0);assert.equal(actual.value.exitCode,code);}
  for(const change of [{passed:true,exitCode:1},{passed:0},{candidateCommit:'3'.repeat(40)},{receiptId:'wrong-id'},{capturedAt:'not-a-date'},{command:['npx','playwright','test','e2e/zk682-stability.e2e.ts']},{durationMs:-1},{exitCode:false}]){assert.equal(py({op:'receipt',target:f.target,data:JSON.stringify({...receipt(),...change})}).ok,false);}
}));

test('duplicate/nonfinite receipt JSON rejects before canonical inspector interpretation',()=>temporary(root=>{
  const f=fixture(root),base=JSON.stringify(receipt());
  for(const data of [base.replace('"exitCode":0','"exitCode":0,"exitCode":1'),base.replace('"durationMs":10','"durationMs":NaN'),base.replace('"durationMs":10','"durationMs":1e999')])assert.equal(py({op:'receipt',target:f.target,data}).ok,false);
}));

test('first falsy failure is immutable across later diagnostic failures',()=>{
  for(const first of [false,0,'',null]){const actual=py({op:'failure',first});assert.equal(actual.ok,true);assert.equal(actual.value.firstFailurePresent,true);assert.deepEqual(actual.value.firstFailure,{phase:'first',error:first});}
});

test('bounded role inventory retains missing receipt/ledger and rejects foreign symlink/size/JSON',()=>temporary(root=>{
  const p=path.join(root,'raw');fs.mkdirSync(p);fs.writeFileSync(path.join(p,'source-context.json'),'{}');
  let result=py({op:'inventory',root:p});assert.equal(result.ok,true);assert.equal(result.value.diagnosticReady,false);assert.deepEqual(result.value.missingRequiredDiagnosticRoles,['renderer-resource-growth-command.json','zk682-capture-phase-ledger.json']);
  const foreign=path.join(p,'foreign.json');fs.writeFileSync(foreign,'{}');assert.equal(py({op:'inventory',root:p}).ok,false);fs.unlinkSync(foreign);
  const ledger=path.join(p,'zk682-capture-phase-ledger.json');fs.symlinkSync(path.join(p,'source-context.json'),ledger);assert.equal(py({op:'inventory',root:p}).ok,false);fs.unlinkSync(ledger);
  fs.writeFileSync(ledger,' '.repeat(8193));assert.equal(py({op:'inventory',root:p}).ok,false);fs.writeFileSync(ledger,'{"x":1,"x":2}');assert.equal(py({op:'inventory',root:p}).ok,false);
}));

test('wx publication preserves sentinel and symlink without acceptance masking',()=>temporary(root=>{
  const p=path.join(root,'typed');fs.writeFileSync(p,'SENTINEL');assert.equal(py({op:'wx',path:p,value:{diagnosticReady:false}}).ok,false);assert.equal(fs.readFileSync(p,'utf8'),'SENTINEL');
  const alias=path.join(root,'alias');fs.symlinkSync(p,alias);assert.equal(py({op:'wx',path:alias,value:{}}).ok,false);assert.equal(fs.readFileSync(p,'utf8'),'SENTINEL');
}));

test('strict post-build failure skips producer; always bounded publication and exact role upload',()=>{
  const prep=job.steps.find(s=>s.id==='prepare');assert.match(prep.run,/driver\.py" prepare/);assert.match(prep.run,/--list --reporter=line --workers=1 --retries=0/);assert.match(prep.run,/driver\.py" ready/);
  const producer=job.steps.find(s=>s.id==='producer');assert.equal(producer.if,undefined);assert.equal(producer['continue-on-error'],undefined);
  const pub=job.steps.find(s=>s.id==='publication');assert.equal(pub.if,'always()');assert.match(pub.run,/set \+e/);assert.match(pub.run,/exit "\$code"/);assert.doesNotMatch(pub.run,/inventory_ready=true|test -f .*inventory/);assert.match(pub.run,/DRIVER_CHECKOUT_OR_HELPER_UNAVAILABLE/);
  const upload=job.steps.find(s=>s.uses==='actions/upload-artifact@v4');assert.match(upload.if,/always\(\).*inventory_ready/);assert.equal(upload.with.name,'zk1262-capture-phase-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}');
  const roles=py({op:'constants'}).value.roles;const names=upload.with.path.trim().split('\n').map(x=>x.split('/').at(-1));assert.deepEqual(new Set(names),new Set(Object.keys(roles)));assert.equal(names.length,Object.keys(roles).length);
  assert.doesNotMatch(text,/git restore|git checkout --|test:stability|verification_mode|DEBUG:|LIBGL_ALWAYS_SOFTWARE|continue-on-error/);
});

test('actual finalize before failure publishes neutral context and missing roles with whole failure',()=>temporary(root=>{
  const f=fixture(root),raw=path.join(root,'raw');const result=py({op:'finalize',driver:f.driver,target:f.target,root:raw,env:{...roles(),OUTCOME_INITIAL:'failure',OUTCOME_PRODUCER:'skipped'}});
  assert.equal(result.ok,true);assert.equal(result.value,false);const context=JSON.parse(fs.readFileSync(path.join(raw,'source-context.json')));assert.equal(context.firstFailurePresent,true);assert.equal(context.capturePASS,false);assert.equal(context.trustedStageBContextReady,false);assert.equal(context.ledgerPin,null);
  const inventory=JSON.parse(fs.readFileSync(path.join(raw,'inventory.json')));assert.equal(inventory.wholeRunFailed,true);assert.equal(inventory.diagnosticReady,false);assert.ok(inventory.missingRequiredDiagnosticRoles.includes('zk682-capture-phase-ledger.json'));
}));


test('source-bound SDK selector chooses headless shell, rejects wrong revision/override/path/alias',()=>temporary(root=>{
  const publicPath=path.join(root,'chromium-1228/chrome-linux64/chrome');fs.mkdirSync(path.dirname(publicPath),{recursive:true});fs.writeFileSync(publicPath,'synthetic fullChrome');
  const shell=path.join(root,'chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell');fs.mkdirSync(path.dirname(shell),{recursive:true});fs.writeFileSync(shell,'synthetic headless shell');
  const registry={browsers:['chromium','chromium-headless-shell'].map(name=>({name,revision:'1228',browserVersion:'149.0.7827.55'}))};
  const positive=py({op:'select',public:publicPath,registry});assert.equal(positive.ok,true);assert.equal(positive.value,shell);assert.notEqual(positive.value,publicPath);
  for(const mutation of [{revision:'1243'},{revisionOverrides:{}},{browserVersion:'other'}]){const bad=structuredClone(registry);Object.assign(bad.browsers[1],mutation);assert.equal(py({op:'select',public:publicPath,registry:bad}).ok,false);}
  assert.equal(py({op:'select',public:publicPath,registry,env:{PWDEBUG:'1'}}).ok,false);
  const wrong=path.join(root,'chromium-1243/chrome-linux64/chrome');fs.mkdirSync(path.dirname(wrong),{recursive:true});fs.writeFileSync(wrong,'synthetic');assert.equal(py({op:'select',public:wrong,registry}).ok,false);
  fs.renameSync(shell,shell+'.held');fs.symlinkSync(shell+'.held',shell);assert.equal(py({op:'select',public:publicPath,registry}).ok,false);
}));


test('publication correction: actual source-query timeout publishes current bound neutral failure',()=>temporary(root=>{
  const f=fixture(root),raw=path.join(root,'raw'),output=path.join(root,'action-output');fs.writeFileSync(output,'');
  fs.mkdirSync(raw);fs.writeFileSync(path.join(raw,'phase-intent.json'),JSON.stringify({roles:py({op:'roles',env:roles()}).value,firstFailurePresent:true,firstFailure:{phase:'original',error:false},sourceQualified:false}));
  const result=py({op:'finalize',driver:f.driver,target:f.target,root:raw,env:{...roles(),GITHUB_OUTPUT:output},gitFault:true});assert.equal(result.ok,true);assert.equal(result.value,false);
  for(const name of ['source-after.json','source-context.json','setup-status.json','producer-status.json','inventory.json'])assert.ok(fs.statSync(path.join(raw,name)).isFile());
  const context=JSON.parse(fs.readFileSync(path.join(raw,'source-context.json'))),inventory=JSON.parse(fs.readFileSync(path.join(raw,'inventory.json')));
  assert.equal(context.sourceAfterQualified,false);assert.equal(context.firstFailurePresent,true);assert.deepEqual(context.firstFailure,{phase:'original',error:false});assert.equal(context.capturePASS,false);assert.equal(inventory.wholeRunFailed,true);
  const after=JSON.parse(fs.readFileSync(path.join(raw,'source-after.json')));assert.equal(after.error,'TimeoutExpired');assert.equal(after.ok,false);
  const fields=Object.fromEntries(fs.readFileSync(output,'utf8').trim().split('\n').map(line=>line.split('=')));
  assert.equal(fields.inventory_ready,'true');assert.equal(fields.inventory_driver,roles().GITHUB_SHA);assert.equal(fields.inventory_run,roles().GITHUB_RUN_ID);assert.equal(fields.inventory_attempt,'1');
  assert.equal(Number(fields.inventory_bytes),fs.statSync(path.join(raw,'inventory.json')).size);assert.match(fields.inventory_sha256,/^[0-9a-f]{64}$/);assert.equal(Number(fields.inventory_ino),fs.statSync(path.join(raw,'inventory.json')).ino);
}));

test('publication correction: old malformed oversize symlink inventory never admits upload',()=>temporary(root=>{
  const f=fixture(root);
  for(const kind of ['old','malformed','oversize','symlink']){
    const raw=path.join(root,kind),output=path.join(root,kind+'-output');fs.mkdirSync(raw);fs.writeFileSync(output,'');
    const p=path.join(raw,'inventory.json');
    if(kind==='symlink'){const sentinel=path.join(root,'sentinel');fs.writeFileSync(sentinel,'FOREIGN');fs.symlinkSync(sentinel,p);}
    else fs.writeFileSync(p,kind==='oversize'?' '.repeat(65537):kind==='malformed'?'{broken':JSON.stringify({publicationRoles:{run_id:1},entries:[]}));
    const before=fs.readFileSync(p);const result=py({op:'finalize',driver:f.driver,target:f.target,root:raw,env:{...roles(),GITHUB_OUTPUT:output},gitFault:true});
    assert.equal(result.ok,false);assert.equal(fs.readFileSync(output,'utf8'),'');assert.deepEqual(fs.readFileSync(p),before);
    assert.ok(fs.existsSync(path.join(raw,'source-context.json')));assert.ok(fs.existsSync(path.join(raw,'producer-status.json')));
  }
}));

test('publication correction: admission rejects stale roles swapped inode modified bytes and output collision',()=>temporary(root=>{
  const expected=py({op:'roles',env:roles()}).value;
  for(const kind of ['positive','stale','roles','bytes','inode','output-collision','bad-run','malformed-schema']){
    const raw=path.join(root,kind),output=path.join(root,kind+'-output');fs.mkdirSync(raw);fs.writeFileSync(output,kind==='output-collision'?'FOREIGN':'');
    const value={publicationRoles:structuredClone(expected),wholeRunFailed:true,diagnosticReady:false,entries:[]};if(kind==='stale')value.publicationRoles.driver_sha='3'.repeat(40);if(kind==='malformed-schema')value.kind='foreign';
    const actual=py({op:'admit',root:raw,value,env:{...roles(),GITHUB_OUTPUT:output,...(kind==='bad-run'?{GITHUB_RUN_ATTEMPT:'2'}:{})},change:kind});
    assert.equal(actual.ok,kind==='positive',kind);
    if(kind==='positive'){assert.match(fs.readFileSync(output,'utf8'),/inventory_ready=true/);assert.equal(actual.value.inventory_run,expected.run_id);}
    else assert.equal(fs.readFileSync(output,'utf8'),kind==='output-collision'?'FOREIGN':'');
  }
}));

test('publication correction: workflow admission is current output bound and fallback cannot fake readiness',()=>{
  const pub=job.steps.find(x=>x.id==='publication'),upload=job.steps.find(x=>x.uses==='actions/upload-artifact@v4');
  assert.doesNotMatch(pub.run,/inventory_ready=true|test -f .*inventory\.json/);
  for(const key of ['inventory_ready','inventory_driver','inventory_run','inventory_attempt','inventory_sha256','inventory_bytes','inventory_dev','inventory_ino'])assert.ok(upload.if.includes('steps.publication.outputs.'+key));
  assert.ok(upload.if.includes('github.sha'));assert.ok(upload.if.includes('github.run_id'));assert.ok(upload.if.includes("inventory_attempt == '1'"));
  assert.match(pub.run,/exit "\$code"/);assert.match(pub.run,/DRIVER_CHECKOUT_OR_HELPER_UNAVAILABLE/);
});
