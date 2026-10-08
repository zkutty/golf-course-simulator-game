import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {CAPTURE_BLOCK,ORIGINAL_CAPTURE,ORIGINAL_IMPORT,PRODUCER_PIN,GENERATED_SPEC_BASENAME,LEDGER_BASENAME,transformProducerSource,inverseProducerSource,verifyProducerTransform,producerInventory} from './producer-transform.mjs';
const root=process.env.O_CAPTURE_DONOR_ROOT??fileURLToPath(new URL('../../',import.meta.url));
const donor=readFileSync(resolve(root,'e2e/zk682-resource-growth.e2e.ts'),'utf8'),generated=transformProducerSource(donor);
const hash=source=>createHash('sha256').update(source).digest('hex');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const compile=source=>new AsyncFunction('captureVisibleCanvas','finalizeCaptureObservation','emitLedger','resolve','dirname','page','finalCapturePath','outputPath',source+'\nreturn captureReceipt;');
const transformed=compile(CAPTURE_BLOCK),original=compile(ORIGINAL_CAPTURE);

test('full exact-current producer inverse, one final capture, unchanged workload and discovery namespace',()=>{
  assert.equal(hash(donor),PRODUCER_PIN);assert.equal(inverseProducerSource(generated),donor);assert.deepEqual(verifyProducerTransform(generated,donor),producerInventory(donor));
  assert.equal(producerInventory(generated).capture,1);assert.equal(producerInventory(generated).await,producerInventory(donor).await);assert.doesNotMatch(GENERATED_SPEC_BASENAME,/\.e2e\.ts$/);
  const prefix=donor.slice(0,donor.indexOf(ORIGINAL_CAPTURE)),suffix=donor.slice(donor.indexOf(ORIGINAL_CAPTURE)+ORIGINAL_CAPTURE.length);
  assert.ok(generated.includes(prefix.replace(ORIGINAL_IMPORT,generated.match(/\/\*P@002\*\/[\s\S]*?\/\*@P002\*\//)[0])));assert.ok(generated.endsWith(suffix));
  assert.ok(generated.indexOf('await writeFile(timingCleanupPath')<generated.indexOf('try { captureReceipt = await captureVisibleCanvas'));
  assert.ok(generated.indexOf('try { emitLedger(')>generated.indexOf('catch (error) { captureFailed = true; capturePrimary = error; }'));
});

test('missing/duplicate import or capture, foreign donor and forbidden calls/await/reactions fail',()=>{
  for(const bad of [donor.replace(ORIGINAL_IMPORT,''),donor+ORIGINAL_IMPORT,donor.replace(ORIGINAL_CAPTURE,''),donor+ORIGINAL_CAPTURE,donor+'\n'])assert.throws(()=>transformProducerSource(bad));
  for(const insertion of ['await captureVisibleCanvas(page, finalCapturePath);','await Promise.resolve();','Promise.resolve().then(()=>null);','page.evaluate(()=>null);','setTimeout(()=>{},1);']){
    const bad=generated.replace('// Synchronous diagnostic emission',insertion+'\n  // Synchronous diagnostic emission');assert.throws(()=>verifyProducerTransform(bad,donor));assert.throws(()=>inverseProducerSource(bad));
  }
  assert.throws(()=>inverseProducerSource(generated+generated.match(/\/\*P@003\*\/[\s\S]*?\/\*@P003\*\//)[0]));
  assert.throws(()=>verifyProducerTransform(generated.replace('captureFailed = true','captureFailed = false'),donor));
});

async function execute(fn,{failed=false,primary,writerFault=false,finalizerFault=false}={}){
  const events=[],receipt={method:'strict-current-receipt'},page={},capturePath='/diagnostic/current.png',outputPath='/diagnostic/report.json';let closed=false,captureCount=0;
  const capture=(actualPage,actualPath)=>{assert.equal(actualPage,page);assert.equal(actualPath,capturePath);captureCount++;events.push('capture');closed=true;events.push('capture-rollback-completed');return failed?Promise.reject(primary):Promise.resolve(receipt);};
  const finalize=(actualFailed,actualPrimary)=>{assert.equal(closed,true);assert.equal(actualFailed,failed);assert.equal(actualPrimary,primary);events.push('snapshot');if(finalizerFault)throw false;return {diagnostic:true};};
  const emit=(path,snapshot)=>{assert.equal(closed,true);assert.equal(path,resolve(dirname(outputPath),LEDGER_BASENAME));assert.deepEqual(snapshot,{diagnostic:true});events.push('ledger-write');if(writerFault)throw undefined;return {written:true};};
  let outcome;try{outcome={failed:false,value:await fn(capture,finalize,emit,resolve,dirname,page,capturePath,outputPath)};}catch(value){outcome={failed:true,primary:value};}
  return {outcome,events,captureCount,receipt};
}

test('actual extracted transformed producer writes only after settlement, preserving strict returned receipt',async()=>{
  for(const fault of [{},{writerFault:true},{finalizerFault:true}]){
    const a=await execute(original,fault),b=await execute(transformed,fault);assert.equal(a.captureCount,1);assert.equal(b.captureCount,1);assert.equal(a.outcome.failed,false);assert.equal(b.outcome.failed,false);assert.equal(b.outcome.value,b.receipt);assert.deepEqual(b.outcome.value,a.outcome.value);
    assert.deepEqual(b.events,fault.finalizerFault?['capture','capture-rollback-completed','snapshot']:['capture','capture-rollback-completed','snapshot','ledger-write']);
  }
});

test('actual extracted producer preserves every first/falsy payload when observer or writer fails',async()=>{
  const opaque=new Proxy({}, {get(){throw new Error('must not inspect primary');}});
  for(const primary of [undefined,null,false,0,'',Symbol('first'),opaque])for(const fault of [{},{writerFault:true},{finalizerFault:true}]){
    const a=await execute(original,{failed:true,primary,...fault}),b=await execute(transformed,{failed:true,primary,...fault});assert.equal(a.captureCount,1);assert.equal(b.captureCount,1);assert.equal(a.outcome.failed,true);assert.equal(b.outcome.failed,true);assert.equal(a.outcome.primary,primary);assert.equal(b.outcome.primary,primary);
    assert.deepEqual(b.events,fault.finalizerFault?['capture','capture-rollback-completed','snapshot']:['capture','capture-rollback-completed','snapshot','ledger-write']);
  }
});

test('producer cannot emit while original capture is unresolved or before rollback returns',async()=>{
  let reject;const waiting=new Promise((_,b)=>{reject=b;});const events=[],primary=false;let closed=false;
  const promise=transformed(()=>{events.push('capture');return waiting;},(failed,value)=>{assert.equal(closed,true);assert.equal(failed,true);assert.equal(value,primary);events.push('snapshot');return {};},()=>{assert.equal(closed,true);events.push('ledger-write');},resolve,dirname,{},'/diagnostic/current.png','/diagnostic/report.json');
  for(let i=0;i<4;i++)await Promise.resolve();assert.deepEqual(events,['capture']);closed=true;events.push('rollback-completed');reject(primary);
  let failed=false,caught;try{await promise;}catch(value){failed=true;caught=value;}assert.equal(failed,true);assert.equal(caught,primary);assert.deepEqual(events,['capture','rollback-completed','snapshot','ledger-write']);
});


test('full current66 producer preserves canonical warm/cycle/GC/resource workload outside exact import and capture block',()=>{
  assert.match(generated,/Exact current66 diagnostic only/);assert.match(LEDGER_BASENAME,/66-diagnostic\.json$/);
  const current=producerInventory(donor),derived=producerInventory(generated);assert.deepEqual(derived,current);assert.equal(current.capture,1);
  // Exact full inverse is stronger than selected workload tokens: all 15054 bytes,
  // including nine warm states, six cycles, seven GC and final high endpoint survive.
  assert.equal(Buffer.byteLength(inverseProducerSource(generated)),15054);
  assert.equal(hash(inverseProducerSource(generated)),PRODUCER_PIN);
  assert.equal((CAPTURE_BLOCK.match(/\bawait\s+/g)??[]).length,1);
  assert.doesNotMatch(CAPTURE_BLOCK,/async\s|\.then\(|\.catch\(|Promise\.|setTimeout|page\.evaluate/);
});
