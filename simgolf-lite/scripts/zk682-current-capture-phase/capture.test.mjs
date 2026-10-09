import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,mkdtempSync,readdirSync,rmSync,writeFileSync,symlinkSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {runInNewContext} from 'node:vm';
import {CAPTURE_MODULE_URL,HELPER_PIN,PHASES,MAX_ROWS,MAX_LEDGER_BYTES,createCaptureObserver,validateLedger,emitLedger,transformCaptureSource,inverseCaptureSource,verifyCaptureTransform,sourceInventory} from './capture.mjs';
const root=process.env.O_CAPTURE_DONOR_ROOT??fileURLToPath(new URL('../../',import.meta.url));
const donor=readFileSync(resolve(root,'scripts/zk682-public-canvas-capture.mjs'),'utf8');
const options={observerImport:CAPTURE_MODULE_URL},generated=transformCaptureSource(donor,options);
const load=source=>import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const actual=await load(generated),baseline=await load(donor);
const hash=value=>createHash('sha256').update(value).digest('hex');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const ticks=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
const geometry=()=>({current:true,connected:true,visible:true,tag:'CANVAS',x:0,y:0,width:2,height:1,viewportWidth:100,viewportHeight:100,intrinsicWidth:2,intrinsicHeight:1,dpr:1,zoom:1});
// Independent two-pixel PNG fixture, including independent CRC generation.
function pngFixture(pixels=[255,0,0,255,0,255,0,255]){
  const crc=bytes=>{let c=0xffffffff;for(const byte of bytes){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
  const chunk=(name,bytes)=>{const type=Buffer.from(name),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(bytes.length);checksum.writeUInt32BE(crc(Buffer.concat([type,bytes])));return Buffer.concat([length,type,bytes,checksum]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(2);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,...pixels]))),chunk('IEND',Buffer.alloc(0))]);
}
const PNG=pngFixture(),PATH='/virtual/current.png';
function fixture(hooks={}){
  const state={now:0,calls:[],files:new Map(),timer:null,cleared:false,rawDisposals:0,detaches:0,conversions:0,geometry:0};
  const record=(name,...args)=>state.calls.push([name,...args]);
  const invoke=(name,fallback,...args)=>Object.hasOwn(hooks,name)?hooks[name](state,...args):fallback;
  const norm=path=>typeof path==='string'?path.replace(/\.cdp-pending-[\w-]+$/,'.cdp-pending-UUID'):path;
  const stat=file=>({dev:file.dev,ino:file.ino,isFile:()=>true,isSymbolicLink:()=>false});
  const handle={evaluate(fn){const name=++state.geometry===1?'pre-geometry':'post-geometry';record(name,fn.toString());return invoke(name,Promise.resolve(geometry()));}};
  const raw={evaluate:handle.evaluate,dispose(){state.rawDisposals++;record('cleanup-raw');return invoke('cleanup-raw',Promise.resolve());}};
  const session={send(method,args){record('screenshot-response',method,args);return invoke('screenshot-response',Promise.resolve({data:PNG.toString('base64')}));},detach(){state.detaches++;record('cleanup-session');return invoke('cleanup-session',Promise.resolve());}};
  const page={evaluateHandle(fn){record('raw-acquire',fn.toString());return invoke('raw-acquire',Promise.resolve(raw),raw);},context(){record('context');return {newCDPSession(value){assert.equal(value,page);record('session-acquire','same-page');return invoke('session-acquire',Promise.resolve(session),session);}};}};
  const timing={now(){invoke('clock',undefined);record('clock',state.now);return state.now;},set(fn,delay){assert.equal(state.timer,null);record('timer-set',delay);state.timer=fn;return 1;},clear(id){record('timer-clear',id);state.cleared=true;}};
  const io={
    openSync(path,flag,mode){record('open',norm(path),flag,mode);invoke('open',undefined,path);if(state.files.has(path))throw new Error('EEXIST');state.files.set(path,{dev:1,ino:1,bytes:Buffer.alloc(0)});state.fdPath=path;return 7;},
    fstatSync(fd){record('fstat',fd);return stat(state.files.get(state.fdPath));},
    writeFileSync(fd,bytes){record('write',fd,hash(bytes));invoke('write',undefined);state.files.get(state.fdPath).bytes=Buffer.from(bytes);},
    fsyncSync(fd){record('fsync',fd);invoke('fsync',undefined);},
    closeSync(fd){record('close',fd);invoke('close',undefined);},
    lstatSync(path,opts){record('lstat',norm(path),opts??null);invoke('lstat',undefined,path);const file=state.files.get(path);if(!file){if(opts?.throwIfNoEntry===false)return undefined;throw new Error('ENOENT');}return stat(file);},
    linkSync(from,to){record('link',norm(from),norm(to));if(state.files.has(to))throw new Error('EEXIST');state.files.set(to,state.files.get(from));invoke('link',undefined,to);},
    unlinkSync(path){record('unlink',norm(path));invoke('unlink',undefined,path);state.files.delete(path);},
  };
  state.fire=()=>{assert.ok(state.timer&&!state.cleared);state.now=10000;state.timer();};
  return {state,page,timing,io,raw,session};
}
function start(module,enabled=true,hooks={},observerOptions={}){
  const f=fixture(hooks),observation=createCaptureObserver({enabled,clock:()=>f.state.now,...observerOptions});
  let outcome;
  const pending=module.captureVisibleCanvas(f.page,PATH,{timing:f.timing,io:f.io,observation}).then(value=>{outcome={failed:false,value};},primary=>{outcome={failed:true,primary};});
  return {...f,observation,pending,get outcome(){return outcome;},snapshot(){assert.ok(outcome);return observation.finish(outcome.failed,outcome.primary);}};
}
function comparable(run){const o=run.outcome;return {failed:o.failed,value:o.value,primary:o.failed?(o.primary instanceof Error?{name:o.primary.name,message:o.primary.message}:o.primary):null,calls:run.state.calls,files:[...run.state.files].map(([path,file])=>[path.replace(/\.cdp-pending-[\w-]+$/,'.cdp-pending-UUID'),{dev:file.dev,ino:file.ino,sha:hash(file.bytes)}])};}
async function pair(hooks={},drive=async()=>{},observerOptions={}){
  const disabled=start(actual,false,hooks),enabled=start(actual,true,hooks,observerOptions);
  await ticks();await drive(disabled);await drive(enabled);await disabled.pending;await enabled.pending;
  assert.deepEqual(comparable(enabled),comparable(disabled),'enabled/disabled same virtual-clock behavior and original call order');
  return {enabled,disabled,snapshot:enabled.snapshot()};
}
const row=(ledger,phase)=>ledger.rows.find(row=>row.phase===phase);

test('complete current-H inverse, original site inventory, and forbidden insertions',()=>{
  assert.equal(hash(donor),HELPER_PIN);assert.equal(inverseCaptureSource(generated),donor);assert.deepEqual(verifyCaptureTransform(generated,donor,options),sourceInventory(donor));
  for(const injection of ['await page.evaluateHandle(()=>null);','Promise.resolve().then(()=>null);','page.locator("foreign").count();','timing.set(()=>{},1);']){
    const outside=generated.replace('  return result;',injection+'  return result;');
    const inside=generated.replace("observation.end('helper-finalize');",injection+"observation.end('helper-finalize');");
    assert.throws(()=>verifyCaptureTransform(outside,donor,options));assert.throws(()=>verifyCaptureTransform(inside,donor,options));
  }
  assert.throws(()=>transformCaptureSource(donor+'\n'));assert.throws(()=>transformCaptureSource(donor,{observerImport:'./foreign.mjs'}));
});

test('actual transformed enabled/disabled and exact donor publish identical strict PNG/receipt',async()=>{
  const {enabled,snapshot}=await pair();const untouched=start(baseline,false);await untouched.pending;
  assert.deepEqual(comparable(enabled),comparable(untouched));assert.equal(snapshot.valid,true);assert.equal(snapshot.rows.length,16);validateLedger(snapshot);
  assert.equal(enabled.state.conversions,0);assert.equal(enabled.state.rawDisposals,1);assert.equal(enabled.state.detaches,1);assert.equal(enabled.state.geometry,2);
  assert.deepEqual(enabled.state.files.get(PATH).bytes,PNG);assert.equal(snapshot.facts.firstPrimaryPresent,false);assert.equal(snapshot.facts.firstTimerHostMs,null);assert.equal(snapshot.facts.terminalPassed,true);
  assert.equal(row(snapshot,'cleanup-session').status,'join-observed-fulfilled');assert.equal(row(snapshot,'cleanup-raw').status,'join-observed-fulfilled');assert.equal(row(snapshot,'publication').status,'returned');
});

test('each original await held at original timer records its pending operation',async()=>{
  for(const phase of ['raw-acquire','pre-geometry','session-acquire','screenshot-response','post-geometry','cleanup-join']){
    const hooks=phase==='cleanup-join'?{'cleanup-session':()=>new Promise(()=>{})}:{[phase]:()=>new Promise(()=>{})};
    const {enabled,snapshot}=await pair(hooks,async run=>run.state.fire());
    assert.equal(enabled.outcome.failed,true,phase);assert.match(enabled.outcome.primary.message,/deadline10000ms/);assert.equal(snapshot.valid,true,phase);
    assert.equal(snapshot.facts.firstTimerHostMs,10000);assert.equal(snapshot.facts.pendingPhaseAtTimer,phase);assert.equal(snapshot.facts.firstPrimaryPhase,phase);assert.equal(snapshot.facts.primaryKind,'deadline');assert.equal(row(snapshot,'publication').status,'not-entered');
  }
});

test('falsy and opaque first failures preserve exact payload identity without reading properties',async()=>{
  const opaque=new Proxy({}, {get(){throw new Error('must not inspect error');}});
  for(const primary of [undefined,null,false,0,'',Symbol('primary'),opaque]){
    // Compare opaque identity directly: Error instanceof checks are deliberately absent.
    const a=start(actual,false,{'screenshot-response':()=>{throw primary;}}),b=start(actual,true,{'screenshot-response':()=>{throw primary;}});
    await a.pending;await b.pending;assert.equal(a.outcome.failed,true);assert.equal(b.outcome.failed,true);assert.equal(a.outcome.primary,primary);assert.equal(b.outcome.primary,primary);assert.deepEqual(a.state.calls,b.state.calls);
    const ledger=b.snapshot();assert.equal(ledger.valid,true);assert.equal(ledger.facts.firstPrimaryPresent,true);assert.equal(ledger.facts.firstPrimaryPhase,'screenshot-response');assert.equal(ledger.facts.primaryKind,primary===null?'null':typeof primary);assert.equal(ledger.facts.terminalPassed,false);
  }
});

test('generic envelope binding guard and base64 decoding cross monotonic deadline without timer',async()=>{
  for(const [phase,site,hooks]of [
    ['raw-convert','post-conversion',{'clock':state=>{if(state.calls.filter(call=>call[0]==='clock').length===4)state.now=10000;}}],
    ['png-decode','post-decode',{'screenshot-response':state=>Promise.resolve({get data(){state.now=10000;return PNG.toString('base64');}})}],
    ['session-acquire','pre-await',{'pre-geometry':state=>{const value=geometry();Object.defineProperty(value,'x',{get(){state.now=10000;return 0;}});return Promise.resolve(value);}}],
  ]){
    const {snapshot,enabled}=await pair(hooks);assert.equal(enabled.outcome.failed,true);assert.equal(snapshot.valid,true);assert.equal(snapshot.facts.firstTimerHostMs,null);assert.equal(snapshot.facts.firstDeadlineGuardSite,site);assert.equal(snapshot.facts.activePhaseAtGuard,phase);assert.equal(row(snapshot,'publication').status,'not-entered');if(phase==='session-acquire'){assert.equal(row(snapshot,'pre-clip').startHostMs,0);assert.equal(row(snapshot,'pre-clip').returnObservedHostMs,10000);assert.equal(snapshot.facts.lastCompletedAtGuard,'pre-clip');}if(phase==='png-decode'){assert.equal(row(snapshot,'base64-decode').startHostMs,0);assert.equal(row(snapshot,'base64-decode').returnObservedHostMs,10000);}
  }
});

test('strict decode boundary rejection is distinct from timer/monotonic detection',async()=>{
  const corrupt=Buffer.from(PNG);corrupt[corrupt.length-1]^=1;
  for(const [phase,data]of [['base64-decode','='.repeat(64)],['base64-decode','A'.repeat(4*Math.ceil(1048576/3)+4)],['png-decode',corrupt.toString('base64')],['png-decode',pngFixture([255,0,0,255,255,0,0,255]).toString('base64')],['png-decode',pngFixture([255,0,0,0,0,255,0,0]).toString('base64')]]){
    const {snapshot}=await pair({'screenshot-response':()=>Promise.resolve({data})});assert.equal(snapshot.valid,true);assert.equal(snapshot.facts.firstPrimaryPhase,phase);assert.equal(snapshot.facts.firstTimerHostMs,null);assert.equal(snapshot.facts.firstDeadlineGuardSite,null);
  }
});

test('current uniqueness, visibility, DPR, viewport and post-identity stay strict',async()=>{
  for(const hooks of [
    {'raw-acquire':()=>Promise.reject(new Error('Exactly one current document canvas required'))},
    {'pre-geometry':()=>Promise.resolve({...geometry(),current:false})},
    {'pre-geometry':()=>Promise.resolve({...geometry(),visible:false})},
    {'pre-geometry':()=>Promise.resolve({...geometry(),dpr:2})},
    {'pre-geometry':()=>Promise.resolve({...geometry(),x:99})},
    {'post-geometry':()=>Promise.resolve({...geometry(),intrinsicWidth:3})},
  ]){const {snapshot,enabled}=await pair(hooks);assert.equal(enabled.outcome.failed,true);assert.equal(snapshot.valid,true);assert.equal(row(snapshot,'publication').status,'not-entered');}
});

test('cleanup join sees array-order primary, not rejection arrival order',async()=>{
  const first=Symbol('session-array-first'),second=Symbol('raw-arrives-first');
  const runs=[];
  for(const enabled of [false,true]){
    const session=deferred(),raw=deferred();const run=start(actual,enabled,{'cleanup-session':()=>session.promise,'cleanup-raw':()=>raw.promise});
    await ticks();raw.reject(second);await ticks();session.reject(first);await run.pending;runs.push(run);
    assert.equal(run.outcome.primary,first);assert.equal(run.state.detaches,1);assert.equal(run.state.rawDisposals,1);
  }
  assert.deepEqual(runs[0].state.calls,runs[1].state.calls);const ledger=runs[1].snapshot();assert.equal(ledger.valid,true);assert.equal(ledger.facts.firstPrimaryPhase,'cleanup-session');assert.equal(ledger.facts.firstRejectedCleanupPhase,'cleanup-session');assert.equal(row(ledger,'cleanup-session').status,'join-observed-rejected');assert.equal(row(ledger,'cleanup-raw').status,'join-observed-rejected');
});

test('unobserved fulfillment and observed rejection remain distinct when delayed join times out',async()=>{
  for(const rejecting of [false,true]){
    const hooks={'cleanup-session':()=>rejecting?Promise.reject(false):Promise.resolve(),'cleanup-raw':()=>new Promise(()=>{})};
    const {snapshot,enabled}=await pair(hooks,async run=>run.state.fire());
    assert.equal(enabled.outcome.failed,true);assert.equal(snapshot.valid,true);assert.equal(snapshot.facts.firstPrimaryPhase,'cleanup-join');assert.equal(snapshot.facts.pendingPhaseAtTimer,'cleanup-join');
    assert.equal(row(snapshot,'cleanup-session').status,rejecting?'rejected':'started-settlement-unobserved');assert.equal(row(snapshot,'cleanup-raw').status,'started-settlement-unobserved');assert.equal(snapshot.facts.firstRejectedCleanupPhase,null);
  }
});

test('earlier falsy capture primary wins delayed cleanup timer and secondary failure',async()=>{
  const {snapshot,enabled}=await pair({'screenshot-response':()=>{throw false;},'cleanup-session':()=>Promise.reject(Symbol('secondary')),'cleanup-raw':()=>new Promise(()=>{})},async run=>run.state.fire());
  assert.equal(enabled.outcome.primary,false);assert.equal(snapshot.valid,true);assert.equal(snapshot.facts.firstPrimaryPhase,'screenshot-response');assert.equal(snapshot.facts.primaryKind,'boolean');assert.equal(snapshot.facts.pendingPhaseAtTimer,'cleanup-join');assert.equal(snapshot.facts.firstTimerHostMs,10000);
});

test('late raw and session ownership clean exactly once while terminal ledger stays frozen',async()=>{
  for(const phase of ['raw-acquire','session-acquire']){
    const runs=[];
    for(const enabled of [false,true]){
      const late=deferred();const run=start(actual,enabled,{[phase]:()=>late.promise});await ticks();run.state.fire();await run.pending;
      const ledger=run.snapshot(),serialized=JSON.stringify(ledger);late.resolve(phase==='raw-acquire'?run.raw:run.session);await ticks();
      runs.push(run);assert.equal(run.state.rawDisposals,1);assert.equal(run.state.detaches,phase==='raw-acquire'?0:1);assert.equal(run.state.conversions,0);assert.equal(run.state.files.size,0);assert.equal(JSON.stringify(run.observation.finish(false)),serialized);assert.ok(Object.isFrozen(ledger)&&Object.isFrozen(ledger.rows)&&ledger.rows.every(Object.isFrozen));if(enabled)assert.equal(ledger.valid,true);
    }
    assert.deepEqual(runs[0].state.calls,runs[1].state.calls);
  }
});

test('late screenshot cannot publish and cannot update frozen snapshot',async()=>{
  const runs=[];
  for(const enabled of [false,true]){
    const response=deferred(),run=start(actual,enabled,{'screenshot-response':()=>response.promise});await ticks();run.state.fire();await run.pending;
    const ledger=run.snapshot(),serialized=JSON.stringify(ledger);response.resolve({data:PNG.toString('base64')});await ticks();assert.equal(run.state.files.size,0);assert.equal(run.state.rawDisposals,1);assert.equal(run.state.detaches,1);assert.equal(JSON.stringify(run.snapshot()),serialized);if(enabled)assert.equal(ledger.valid,true);runs.push(run);
  }
  assert.deepEqual(comparable(runs[0]),comparable(runs[1]));
});

test('publication monotonic checks, falsy primary and foreign inode rollback remain original',async()=>{
  for(const [hooks,guard,foreign]of [
    [{'write':state=>{state.now=10000;}},'publication-fsync',false],
    [{'link':(state,path)=>{state.now=10000;state.files.set(path,{dev:2,ino:99,bytes:Buffer.from('foreign')});}},'publication-link',true],
    [{'fsync':()=>{throw undefined;}},null,false],
  ]){
    const {snapshot,enabled}=await pair(hooks);assert.equal(enabled.outcome.failed,true);assert.equal(snapshot.valid,true);assert.equal(snapshot.facts.firstTimerHostMs,null);assert.equal(snapshot.facts.firstDeadlineGuardSite,guard);
    if(guard===null){assert.equal(enabled.outcome.primary,undefined);assert.equal(snapshot.facts.firstPrimaryPresent,true);assert.equal(snapshot.facts.primaryKind,'undefined');}
    assert.equal(enabled.state.files.has(PATH),foreign);if(foreign)assert.equal(enabled.state.files.get(PATH).bytes.toString(),'foreign');
    assert.equal([...enabled.state.files.keys()].some(path=>path.includes('.cdp-pending-')),false);
  }
});

test('actual helper survives observer clock, serializer, hostile mutation and option faults',async()=>{
  const faults=[{clock:()=>{throw false;}},{clock:()=>NaN},{clock:(()=>{let i=100;return ()=>i--;})()},{serialize:()=>{throw undefined;}},{serialize:snapshot=>{snapshot.rows[0].status='forged';return JSON.stringify(snapshot);}},{serialize:()=>'{"untrusted":true}'},{serialize:()=> 'x'.repeat(8193)}];
  for(const fault of faults){const {enabled,snapshot}=await pair({},async()=>{},fault);assert.equal(enabled.outcome.failed,false);assert.equal(snapshot.valid,false);validateLedger(snapshot);}
  const hostile={get clock(){throw false;}};const observer=createCaptureObserver(hostile);observer.enter('raw-acquire');observer.end('raw-acquire');assert.equal(observer.finish(false).valid,false);
});

test('fixed 16 records, maximum32 and exact8192 byte bound refuse invalid enums/time/object retention',()=>{
  const observer=createCaptureObserver({clock:()=>1});observer.enter('raw-acquire');observer.end('raw-acquire');const good=observer.finish(false),text=JSON.stringify(good);
  assert.equal(MAX_ROWS,32);assert.equal(MAX_LEDGER_BYTES,8192);assert.equal(good.rows.length,16);assert.ok(Buffer.byteLength(text)<8192);
  validateLedger(good,text+' '.repeat(8192-Buffer.byteLength(text)));assert.throws(()=>validateLedger(good,text+' '.repeat(8193-Buffer.byteLength(text))));
  for(const mutate of [x=>x.rows.push(...Array.from({length:15},()=>({...x.rows[0]}))),x=>x.rows.push(...Array.from({length:16},()=>({...x.rows[0]}))),x=>x.rows[0].status='success',x=>x.rows[0].startHostMs=Infinity,x=>x.rows[0].startHostMs=-1,x=>x.rows[0].startHostMs=2,x=>x.rows[0].handle={},x=>x.facts.primaryKind={},x=>x.facts.firstPrimaryPresent='false']){const bad=structuredClone(good);mutate(bad);assert.throws(()=>validateLedger(bad));}
  assert.throws(()=>{good.rows[0].status='forged';});observer.enter('raw-convert');assert.equal(observer.finish(true,false),good);assert.equal(row(good,'raw-convert').status,'not-entered');
  let written;const result=emitLedger('/ledger',good,{write:(path,data,options)=>{written={path,data,options};}});assert.equal(result.written,true);assert.ok(Buffer.byteLength(written.data)<=8192);assert.equal(written.options.flag,'wx');assert.equal(emitLedger('/ledger',good,{write:()=>{throw false;}}).written,false);
  assert.equal(emitLedger('/ledger',good,{get write(){throw false;}}).written,false);
});


test('actual synchronous PNG decoder crosses deadline before original post-decode guard',async()=>{
  const original=Buffer.prototype.readUInt32BE,runs=[];
  try{
    for(const enabled of [false,true]){
      let run;
      Buffer.prototype.readUInt32BE=function(offset,...args){const value=Reflect.apply(original,this,[offset,...args]);if(offset===8&&this.subarray(0,8).toString('hex')==='89504e470d0a1a0a')run.state.now=10000;return value;};
      run=start(actual,enabled);await run.pending;runs.push(run);assert.equal(run.outcome.failed,true);assert.match(run.outcome.primary.message,/deadline10000ms/);
    }
  }finally{Buffer.prototype.readUInt32BE=original;}
  assert.deepEqual(comparable(runs[0]),comparable(runs[1]));const ledger=runs[1].snapshot();assert.equal(ledger.valid,true);assert.equal(ledger.facts.firstTimerHostMs,null);assert.equal(ledger.facts.activePhaseAtGuard,'png-decode');assert.equal(ledger.facts.firstDeadlineGuardSite,'post-decode');assert.equal(row(ledger,'png-decode').startHostMs,0);assert.equal(row(ledger,'png-decode').returnObservedHostMs,10000);
});

test('post-identity validation span and original cleanup detecting guard stay separate',async()=>{
  const hooks={'post-geometry':state=>{const value=geometry();Object.defineProperty(value,'x',{enumerable:true,get(){state.now=10000;return 0;}});return Promise.resolve(value);}};
  const {snapshot,enabled}=await pair(hooks);assert.equal(enabled.outcome.failed,true);assert.equal(snapshot.valid,true);assert.equal(snapshot.facts.firstTimerHostMs,null);assert.equal(snapshot.facts.firstDeadlineGuardSite,'pre-await');assert.equal(snapshot.facts.activePhaseAtGuard,'cleanup-join');assert.equal(row(snapshot,'post-identity').startHostMs,0);assert.equal(row(snapshot,'post-identity').returnObservedHostMs,10000);assert.equal(snapshot.facts.lastCompletedAtGuard,'result-construction');
});

test('receipt-final guard preserves original no-primary-assignment distinction and rollback',async()=>{
  const hooks={clock:state=>{if(state.files.has(PATH)&&![...state.files.keys()].some(path=>path.includes('.cdp-pending-'))){state.finalReads=(state.finalReads??0)+1;if(state.finalReads===2)state.now=10000;}}};
  const {snapshot,enabled}=await pair(hooks);assert.equal(enabled.outcome.failed,true);assert.equal(snapshot.valid,true);assert.equal(snapshot.facts.firstTimerHostMs,null);assert.equal(snapshot.facts.firstDeadlineGuardSite,'receipt-final');assert.equal(snapshot.facts.firstPrimaryPresent,false);assert.equal(snapshot.facts.terminalOutcomePresent,true);assert.equal(snapshot.facts.terminalPassed,false);assert.equal(enabled.state.files.size,0);
});


test('actual publication preserves all falsy primaries through secondary rollback failure',async()=>{
  for(const primary of [undefined,null,false,0,'']){
    const {enabled,disabled,snapshot}=await pair({'fsync':()=>{throw primary;},'unlink':()=>{throw Symbol('secondary rollback failure');}});
    assert.equal(enabled.outcome.failed,true);assert.equal(enabled.outcome.primary,primary);assert.equal(disabled.outcome.primary,primary);assert.equal(snapshot.valid,true);assert.equal(snapshot.facts.firstPrimaryPresent,true);assert.equal(snapshot.facts.firstPrimaryPhase,'publication');assert.equal(snapshot.facts.primaryKind,primary===null?'null':typeof primary);assert.equal(snapshot.facts.terminalPassed,false);
  }
});


// This exercises the real helper's Promise methods, original timer, and browser call
// traces. Native await sites are counted across the COMPLETE generated public wrapper
// and canonical body, rather than only an extracted generated-body regex.
async function reactionTrace(module,enabled,phase='success'){
  const originals={then:Promise.prototype.then,catch:Promise.prototype.catch,resolve:Promise.resolve,race:Promise.race,allSettled:Promise.allSettled};
  const reactions=[];
  for(const name of ['then','catch'])Promise.prototype[name]=function(...args){reactions.push([name,args.map(value=>typeof value)]);return Reflect.apply(originals[name],this,args);};
  for(const name of ['resolve','race','allSettled'])Promise[name]=function(...args){reactions.push([name,args.length]);return Reflect.apply(originals[name],this,args);};
  try{
    const late=deferred();
    const hooks=phase==='late-raw'?{'raw-acquire':()=>late.promise}:phase==='timeout'?{'screenshot-response':()=>late.promise}:phase==='falsy'?{'screenshot-response':()=>{throw false;}}:{};
    const run=start(module,enabled,hooks);await ticks();
    if(phase==='late-raw'||phase==='timeout')run.state.fire();
    await run.pending;
    if(phase==='late-raw'){late.resolve(run.raw);await ticks();}
    return {reactions,calls:run.state.calls,inventory:sourceInventory(module===baseline?donor:generated)};
  }finally{
    Promise.prototype.then=originals.then;Promise.prototype.catch=originals.catch;
    for(const name of ['resolve','race','allSettled'])Promise[name]=originals[name];
  }
}
test('actual enabled/disabled/baseline Promise method order, arities, timer and entire-wrapper await cardinality',async()=>{
  for(const phase of ['success','timeout','falsy','late-raw']){
    const canonical=await reactionTrace(baseline,false,phase),disabled=await reactionTrace(actual,false,phase),enabled=await reactionTrace(actual,true,phase);
    assert.deepEqual(disabled,canonical,phase+' disabled');assert.deepEqual(enabled,canonical,phase+' enabled');
    assert.equal(enabled.calls.filter(call=>call[0]==='timer-set').length,1);
    assert.equal(enabled.calls.filter(call=>call[0]==='timer-clear').length,1);
    assert.equal(enabled.calls.filter(call=>call[0]==='canvas-count'||call[0]==='selector').length,0);
  }
  assert.equal(sourceInventory(donor).await,8);assert.equal(sourceInventory(generated).await,8);
  for(const mutation of ["await Promise.resolve();","await page.evaluateHandle(()=>null);","await page.locator('canvas').count();"]){
    const wrapper=generated.replace('/*O@065*/try{','/*O@065*/try{'+mutation);
    assert.throws(()=>verifyCaptureTransform(wrapper,donor,options));
    assert.notDeepEqual(sourceInventory(wrapper),sourceInventory(donor));
  }
});

test('atomic raw callback retains exact count and connected-document guards inside the sole evaluateHandle',()=>{
  const original=donor.match(/page\.evaluateHandle\(([\s\S]*?)\),'dispose'\)/)[1];
  const observed=generated.match(/page\.evaluateHandle\(([\s\S]*?)\),'dispose'\)/)[1];assert.equal(observed,original);
  const acquire=new Function('document','HTMLCanvasElement','return ('+original+')();');
  class Canvas{}
  const document={querySelectorAll(selector){assert.equal(selector,'.cc-pixi-stage canvas');return document.matches;}};
  const node=new Canvas();node.ownerDocument=document;node.isConnected=true;document.matches=[node];const envelope=acquire(document,Canvas);assert.equal(Object.getPrototypeOf(envelope),null);assert.deepEqual(Reflect.ownKeys(envelope),['node']);assert.deepEqual(Object.getOwnPropertyDescriptor(envelope,'node'),{value:node,enumerable:true,writable:false,configurable:false});
  for(const matches of [[],[node,node],[{}]]){document.matches=matches;assert.throws(()=>acquire(document,Canvas));}
  document.matches=[node];node.ownerDocument={};assert.throws(()=>acquire(document,Canvas));node.ownerDocument=document;node.isConnected=false;assert.throws(()=>acquire(document,Canvas));
});

test('freeze at original core failure before public await resumes excludes owned late cleanup facts',async()=>{
  // Fire and then resolve in the same turn. Ownership cleanup remains original;
  // terminal rows freeze inside the original core throw, before a caller reaction.
  for(const phase of ['raw-acquire','session-acquire']){
    const late=deferred(),run=start(actual,true,{[phase]:()=>late.promise});await ticks();run.state.fire();
    await run.pending;const snapshot=run.observation.finish(true,run.outcome.primary),before=JSON.stringify(snapshot);
    late.resolve(phase==='raw-acquire'?run.raw:run.session);await ticks();
    assert.equal(JSON.stringify(run.observation.finish(false)),before);
    const cleanup=phase==='raw-acquire'?'cleanup-raw':'cleanup-session';assert.equal(row(snapshot,cleanup).status,'not-entered');
    assert.equal(run.state.rawDisposals,1);assert.equal(run.state.detaches,phase==='raw-acquire'?0:1);
  }
});

test('UTF8 rather than code-unit ledger cap, sticky fault and fixed-row overflow remain fail closed',()=>{
  const observer=createCaptureObserver({clock:()=>0,serialize:value=>JSON.stringify(value)+'😀'.repeat(2049)});
  observer.enter('raw-acquire');observer.end('raw-acquire');const bad=observer.finish(false);assert.equal(bad.valid,false);assert.ok(bad.invalidReasons.includes('ledger-cap'));
  assert.equal(observer.finish(false),bad);validateLedger(bad);
  const valid=createCaptureObserver({clock:()=>0}).finish(false),overflow=structuredClone(valid);overflow.rows.push(...Array.from({length:17},()=>({...overflow.rows[0]})));assert.equal(overflow.rows.length,33);assert.throws(()=>validateLedger(overflow));
  const ordering=createCaptureObserver({clock:()=>0});ordering.enter('raw-acquire');ordering.enter('raw-acquire');ordering.end('raw-acquire');const sticky=ordering.finish(false);assert.equal(sticky.valid,false);assert.ok(sticky.invalidReasons.includes('row-order'));assert.equal(ordering.finish(false),sticky);
});

test('native inode publication refuses existing files and symlinks with wx staging and owned rollback',async()=>{
  const directory=mkdtempSync(resolve(tmpdir(),'current040-publication-'));
  try{
    for(const mode of ['existing','symlink','success']){
      const output=resolve(directory,mode+'.png'),target=resolve(directory,mode+'.target');writeFileSync(target,'foreign');
      if(mode==='existing')writeFileSync(output,'existing');if(mode==='symlink')symlinkSync(target,output);
      const f=fixture(),observation=createCaptureObserver({clock:()=>f.state.now});let failed=false;
      try{await actual.captureVisibleCanvas(f.page,output,{timing:f.timing,observation});}catch{failed=true;}
      assert.equal(failed,mode!=='success');assert.equal(readFileSync(target,'utf8'),'foreign');
      if(mode==='existing')assert.equal(readFileSync(output,'utf8'),'existing');if(mode==='symlink')assert.equal(lstatSync(output).isSymbolicLink(),true);
      if(mode==='success')assert.deepEqual(readFileSync(output),PNG);
      assert.equal(readdirSync(directory).some(name=>name.includes('.cdp-pending-')),false);
    }
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('canonical late hard-link deadline and first-error close/rollback behavior are unchanged',async()=>{
  for(const hooks of [
    {link:state=>{state.now=10000;}},
    {open:()=>{throw false;}},
    {fsync:()=>{throw 0;},close:()=>{throw Symbol('secondary-close');},unlink:()=>{throw Symbol('secondary-unlink');}},
  ]){
    const {enabled,disabled,snapshot}=await pair(hooks);const untouched=start(baseline,false,hooks);await untouched.pending;
    assert.deepEqual(comparable(enabled),comparable(untouched));assert.deepEqual(comparable(disabled),comparable(untouched));assert.equal(snapshot.valid,true);
    if(Object.hasOwn(hooks,'link'))assert.equal(enabled.state.files.size,0);
    if(Object.hasOwn(hooks,'open'))assert.equal(enabled.outcome.primary,false);
    if(Object.hasOwn(hooks,'fsync'))assert.equal(enabled.outcome.primary,0);
  }
});


test('entire executed observer API and added public wrapper contain zero added async await reaction timer or browser sites',()=>{
  const observerRuntime=readFileSync(fileURLToPath(CAPTURE_MODULE_URL),'utf8').split('const HELPER_EDITS=')[0];
  // Declarative edit strings are source data; all executed observer API methods above
  // that table are inspected. The actual transformed wrapper is separately compared
  // to the entire canonical helper, including captureVisibleCanvas's original await.
  const check=source=>{
    assert.doesNotMatch(source,/\basync\s|\bawait\s|\bnew Promise\s*\(|Promise\.(?:resolve|race|allSettled)\s*\(|\.then\s*\(|\.catch\s*\(|\bsetTimeout\s*\(|\bsetInterval\s*\(|page\.(?:evaluate|evaluateHandle|locator|context)\s*\(/);
  };
  check(observerRuntime);
  for(const injection of ['async function extra(){await 1;}','Promise.resolve().then(()=>{});','setTimeout(()=>{},1);','page.evaluate(()=>{});'])assert.throws(()=>check(observerRuntime+injection));
  assert.deepEqual(sourceInventory(generated),sourceInventory(donor));
  const canonicalWrapper=donor.slice(donor.indexOf('export async function captureVisibleCanvas'));
  const observedWrapper=generated.slice(generated.indexOf('export async function captureVisibleCanvas'));
  assert.equal(sourceInventory(canonicalWrapper).await,1);assert.deepEqual(sourceInventory(observedWrapper),sourceInventory(canonicalWrapper));
});


test('current040 real generic envelope A B D callbacks preserve owned node shape geometry and signed zero',()=>{
  const acquisition=donor.match(/page\.evaluateHandle\(([\s\S]*?)\),'dispose'\)/)[1];
  const owned=donor.slice(donor.indexOf('function readOwnedCanvas('),donor.indexOf('export function strictBase64'));
  const observed=generated.slice(generated.indexOf('function readOwnedCanvas('),generated.indexOf('export function strictBase64'));
  assert.equal(observed,owned);assert.equal(generated.match(/page\.evaluateHandle\(([\s\S]*?)\),'dispose'\)/)[1],acquisition);
  class Canvas{getBoundingClientRect(){return this.rect;}}
  const document={matches:[],querySelectorAll(selector){assert.equal(selector,'.cc-pixi-stage canvas');return this.matches;}};
  const node=new Canvas();Object.assign(node,{ownerDocument:document,isConnected:true,tagName:'CANVAS',width:2,height:1,rect:{x:-0,y:0,width:2,height:1}});document.matches=[node];
  const context={document,HTMLCanvasElement:Canvas,getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),innerWidth:100,innerHeight:100,devicePixelRatio:1,visualViewport:{scale:1}};
  const envelope=runInNewContext('('+acquisition+')()',context),reader=runInNewContext('('+owned+')',context);
  assert.equal(Object.getPrototypeOf(envelope),null);assert.equal(Object.getOwnPropertyDescriptor(envelope,'node').value,node);
  const before=reader(envelope);assert.equal(Object.is(before.x,-0),true);assert.deepEqual({...before},{...geometry(),x:-0});
  assert.deepEqual({...reader(envelope)},{...before});
  node.rect.x=0;assert.throws(()=>assert.deepEqual({...reader(envelope)},{...before}));node.rect.x=-0;
  document.matches=[new Canvas()];assert.equal(reader(envelope).current,false);assert.throws(()=>baseline.canvasClip(reader(envelope)));document.matches=[node];
  node.isConnected=false;assert.equal(reader(envelope).connected,false);assert.throws(()=>baseline.canvasClip(reader(envelope)));node.isConnected=true;
  node.ownerDocument={};assert.throws(()=>reader(envelope),/current document/);node.ownerDocument=document;
  for(const bad of [null,false,{},Object.create({node}),Object.create(null),Object.defineProperty(Object.create(null),'node',{get(){throw new Error('getter must not run');},enumerable:true}),Object.defineProperty(Object.create(null),'node',{value:node,enumerable:true,writable:true}),Object.defineProperties(Object.create(null),{node:{value:node,enumerable:true},extra:{value:1}})]){
    assert.throws(()=>reader(bad),/Private/);
  }
  node.rect.width=NaN;assert.throws(()=>baseline.canvasClip(reader(envelope)),/Finite/);
});

test('current040 transformed and baseline signed-zero and generic null/falsy acquire remain strict',async()=>{
  for(const hooks of [
    {'pre-geometry':()=>Promise.resolve({...geometry(),x:-0}),'post-geometry':()=>Promise.resolve({...geometry(),x:0})},
    {'raw-acquire':()=>Promise.resolve(null)},
    {'raw-acquire':()=>Promise.resolve(false)},
    {'pre-geometry':()=>Promise.resolve({...geometry(),connected:false})},
    {'pre-geometry':()=>Promise.resolve({...geometry(),width:Infinity})},
  ]){
    const {enabled,disabled,snapshot}=await pair(hooks);const untouched=start(baseline,false,hooks);await untouched.pending;
    assert.equal(enabled.outcome.failed,true);assert.deepEqual(comparable(enabled),comparable(untouched));assert.deepEqual(comparable(disabled),comparable(untouched));assert.equal(snapshot.valid,true);assert.equal(enabled.state.files.size,0);assert.equal(enabled.state.conversions,0);
  }
});
