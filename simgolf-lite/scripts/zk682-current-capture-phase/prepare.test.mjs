import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {transformConfigSource,inverseConfigSource,verifyConfigTransform,configuredTimeout,verifyEffectiveTimeout} from './prepare.mjs';
const root=process.env.O_CAPTURE_DONOR_ROOT??fileURLToPath(new URL('../../',import.meta.url));
const config=readFileSync(resolve(root,'playwright.config.ts'),'utf8'),producer=readFileSync(resolve(root,'e2e/zk682-resource-growth.e2e.ts'),'utf8');
test('full canonical config inverse retains base600000 with exclusive generated one-worker zero-retry namespace',()=>{
  const generated=transformConfigSource(config);assert.equal(inverseConfigSource(generated),config);
  assert.equal(configuredTimeout(generated),configuredTimeout(config));assert.equal(configuredTimeout(generated),600000);
  assert.deepEqual(verifyConfigTransform(generated,config,producer),{workers:1,retries:0,timeout:600000,slowCalls:1,slowMultiplier:3,effectiveTimeout:1800000,testMatch:'**/zk682-current-capture-phase.generated.ts'});
  for(const mutation of [generated+'\n',generated.replace('workers: 1','workers: 2'),generated.replace('retries: 0','retries: 1'),generated.replace('testMatch: "**/zk682-current-capture-phase.generated.ts"','testMatch: "**/*.e2e.ts"')])assert.throws(()=>verifyConfigTransform(mutation,config,producer));
  assert.throws(()=>transformConfigSource(config+'\n'));
});
test('one canonical test.slow yields effective1800000 and base1800000 mutation fails meaningfully',()=>{
  const generated=transformConfigSource(config);
  assert.equal((producer.match(/\btest\.slow\(\)/g)??[]).length,1);
  assert.deepEqual(verifyEffectiveTimeout(generated,producer),{timeout:600000,slowCalls:1,slowMultiplier:3,effectiveTimeout:1800000});
  const excessive=generated.replace('  timeout: 600_000,','  timeout: 1_800_000,');assert.notEqual(excessive,generated);
  assert.equal(configuredTimeout(excessive),1800000);assert.equal(configuredTimeout(excessive)*3,5400000);
  assert.throws(()=>verifyEffectiveTimeout(excessive,producer),/canonical base timeout/);
  assert.throws(()=>verifyConfigTransform(excessive,config,producer));assert.throws(()=>inverseConfigSource(excessive));
  assert.throws(()=>verifyEffectiveTimeout(generated,producer.replace('test.slow();','')),/one canonical test.slow/);
  assert.throws(()=>verifyEffectiveTimeout(generated,producer+'\ntest.slow();'),/one canonical test.slow/);
});


test('portable colocated prepare imports actualroot sources and discovers one full canonical generated test without launching',async()=>{
  const fixture=mkdtempSync(resolve(tmpdir(),'capture040-portable-')),app=resolve(fixture,'simgolf-lite'),scripts=resolve(app,'scripts'),modules=resolve(scripts,'zk682-current-capture-phase');
  const source=dirname(fileURLToPath(import.meta.url)),deps=process.env.O_CAPTURE_DEPENDENCY_ROOT??resolve(root,'node_modules');
  mkdirSync(modules,{recursive:true});mkdirSync(resolve(app,'e2e'));symlinkSync(deps,resolve(app,'node_modules'),'dir');
  try{
    for(const name of ['capture.mjs','producer-transform.mjs','prepare.mjs']){const bytes=readFileSync(resolve(source,name));assert.doesNotMatch(bytes.toString(),/golf-66-current-capture-host-phase-source/);writeFileSync(resolve(modules,name),bytes,{flag:'wx'});}
    const packageBytes=readFileSync(resolve(root,'package.json'));assert.equal(packageBytes.length,11046);assert.equal(createHash('sha256').update(packageBytes).digest('hex'),'fb50a3ac5421a40fdedd3e89da7d37869c077d1ec99628af2e5a0eeb0e21adf1');assert.equal(JSON.parse(packageBytes).type,'module');writeFileSync(resolve(app,'package.json'),packageBytes,{flag:'wx'});
    const portable=await import(pathToFileURL(resolve(modules,'prepare.mjs')).href);
    const helper=readFileSync(resolve(root,'scripts/zk682-public-canvas-capture.mjs'),'utf8'),prepared=portable.prepareDiagnosticSources({helper,producer,config});
    const portableCapture=await import(pathToFileURL(resolve(modules,'capture.mjs')).href),portableProducer=await import(pathToFileURL(resolve(modules,'producer-transform.mjs')).href);
    assert.equal(portableCapture.inverseCaptureSource(prepared.helper),helper);assert.equal(portableProducer.inverseProducerSource(prepared.producer),producer);assert.equal(portable.inverseConfigSource(prepared.config),config);
    writeFileSync(resolve(modules,'generated-helper.mjs'),prepared.helper,{flag:'wx'});writeFileSync(resolve(app,'e2e',portableProducer.GENERATED_SPEC_BASENAME),prepared.producer,{flag:'wx'});writeFileSync(resolve(app,portable.GENERATED_CONFIG_BASENAME),prepared.config,{flag:'wx'});
    const currentHelper=await import(pathToFileURL(resolve(modules,'generated-helper.mjs')).href);assert.equal(typeof currentHelper.captureVisibleCanvas,'function');
    for(const [name,sha] of [['react-component-timing-cleanup.mjs','f61a7d4218c736b0fff536a0f875a69dfa82edb56c5d2993c3d4bc56273760c2'],['zk682-resource-growth-contract.mjs','9c9ad1d355bfe724c567c39e79abc370c256d36d101a4398e53f9dc21b99df27']]){
      const bytes=readFileSync(resolve(root,'scripts',name));assert.equal(createHash('sha256').update(bytes).digest('hex'),sha);writeFileSync(resolve(scripts,name),bytes,{flag:'wx'});
    }
    const env={...process.env};delete env.NODE_TEST_CONTEXT;
    const listing=execFileSync(process.execPath,[resolve(deps,'@playwright/test/cli.js'),'test','--config',resolve(app,portable.GENERATED_CONFIG_BASENAME),'--list','--reporter=line'],{cwd:app,env,encoding:'utf8',timeout:30000,maxBuffer:65536});
    assert.match(listing,/Total: 1 test in 1 file/);assert.equal(listing.split('\n').filter(line=>line.includes(portableProducer.GENERATED_SPEC_BASENAME)&&line.includes('›')).length,1);
    assert.equal(portable.configuredTimeout(prepared.config),600000);assert.equal(portable.verifyEffectiveTimeout(prepared.config,producer).effectiveTimeout,1800000);
  }finally{rmSync(fixture,{recursive:true,force:true});}
});
