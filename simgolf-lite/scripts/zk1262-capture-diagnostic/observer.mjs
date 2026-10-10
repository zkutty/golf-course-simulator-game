import { performance } from 'node:perf_hooks';
import { Buffer } from 'node:buffer';
import { constants, openSync, writeFileSync, closeSync, fstatSync, lstatSync, realpathSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
export const PHASES=Object.freeze(['SESSION','FRAME_TREE','RUNTIME_ENABLE','CONTEXT_READY','ACQUIRE_A','BEFORE_B','SCREENSHOT','PNG_VALIDATE','AFTER_D','CLEANUP_BARRIER','RELEASE','DETACH','CLEANUP_WAIT','HELPER_FINAL','PUB_OPEN','PUB_WRITE','PUB_FSYNC','PUB_CLOSE','PUB_STAGE','PUB_LINK','PUB_FINAL','PUB_REMOVE','PUB_FINAL_GUARD','TERMINAL']);
export const LIMITS=Object.freeze({rows:32,bytes:8192});
const stringify=JSON.stringify.bind(JSON), parse=JSON.parse.bind(JSON);
const own=(object,key)=>{const d=Object.getOwnPropertyDescriptor(object,key);if(d&&!Object.hasOwn(d,'value'))throw new Error('observer option DATA required');return d?.value;};
const kind=value=>value===null?'null':typeof value;
const blank=()=>Object.create(null);
export function createObserver(){
 let enabled=true,frozen=false,clock=()=>performance.now(),serializer=stringify,last=-Infinity,active='SESSION',site='helper-unknown',rows,meta,snapshot,text;
 const safe=action=>{try{return action();}catch{return undefined;}};
 const invalid=flag=>{meta.valid=false;meta[flag]=true;};
 const now=()=>{try{const v=clock();if(typeof v!=='number'||!Number.isFinite(v)||v<last){invalid('clockInvalid');return null;}last=v;return v;}catch{invalid('clockInvalid');return null;}};
 const row=phase=>{if(!PHASES.includes(phase)){invalid('overflow');return null;}return rows[PHASES.indexOf(phase)];};
 const bump=(r,k)=>{if(r[k]>=1000000){invalid('overflow');return;}r[k]++;};
 const act=fn=>safe(()=>{if(enabled&&!frozen)fn();});
 const copy=()=>{const m=Object.assign(blank(),meta,{activePhase:active,lateFactsQualification:'Unobserved late settlements/cleanup UNKNOWN; no native closure proof'});const rs=rows.map(r=>Object.freeze(Object.assign(blank(),r)));return Object.freeze(Object.assign(blank(),{schemaVersion:1,kind:'capture-host-phase-ledger',limits:LIMITS,meta:Object.freeze(m),rows:Object.freeze(rs)}));};
 const api={
  reset(options={}){return safe(()=>{enabled=true;frozen=false;clock=()=>performance.now();serializer=stringify;last=-Infinity;active='SESSION';site='helper-unknown';snapshot=undefined;text=undefined;rows=PHASES.map(phase=>Object.assign(blank(),{phase,startCount:0,fulfilledCount:0,rejectedCount:0,validatedCount:0,caughtCount:0,pending:false,enterMs:null,startMs:null,settleMs:null,validationMs:null}));meta=Object.assign(blank(),{valid:true,overflow:false,clockInvalid:false,serializationInvalid:false,firstPrimaryPresent:false,firstPrimaryKind:null,firstPrimaryPhase:null,firstDeadlineGuardSite:null,activePhaseAtGuard:null,deadlineTimerFired:false,pendingOperationCount:0,pendingSession:false,pendingRelease:false,pendingDetach:false,pendingCleanup:false,ownedObjectCount:0,releaseFailures:0,closeDuringOwnDetach:false,foreignCloseObserved:false,firstInvalidationKind:null,terminalOutcome:'UNKNOWN',terminalKind:null,lastCaughtKind:null});try{const e=own(options,'enabled'),c=own(options,'clock'),s=own(options,'serializer');if(e!==undefined){if(typeof e!=='boolean')throw new Error();enabled=e;}if(c!==undefined){if(typeof c!=='function')throw new Error();clock=c;}if(s!==undefined){if(typeof s!=='function')throw new Error();serializer=s;}}catch{invalid('serializationInvalid');}return api;});},
  phase(phase){act(()=>{const r=row(phase);if(r){active=phase;if(r.enterMs===null)r.enterMs=now();}});},
  start(phase=active){act(()=>{const r=row(phase);if(!r)return;bump(r,'startCount');r.pending=true;r.startMs=now();if(phase==='SESSION')meta.pendingSession=true;if(phase==='RELEASE')meta.pendingRelease=true;if(phase==='DETACH')meta.pendingDetach=true;});return phase;},
  fulfilled(phase){act(()=>{const r=row(phase);if(r){bump(r,'fulfilledCount');r.settleMs=now();}});},
  finished(phase,rejected=false,transportFulfilled=false){act(()=>{const r=row(phase);if(r){if(rejected&&!transportFulfilled)bump(r,'rejectedCount');r.pending=false;}if(phase==='SESSION')meta.pendingSession=false;if(phase==='RELEASE')meta.pendingRelease=false;if(phase==='DETACH')meta.pendingDetach=false;});},
  validated(phase=active){act(()=>{const r=row(phase);if(r){bump(r,'validatedCount');r.validationMs=now();}});},
  caught(error,phase=active){act(()=>{const r=row(phase);if(r)bump(r,'caughtCount');meta.lastCaughtKind=kind(error);});},
  primary(error){act(()=>{if(!meta.firstPrimaryPresent){meta.firstPrimaryPresent=true;meta.firstPrimaryKind=kind(error);meta.firstPrimaryPhase=active;}});},
  pending(count){act(()=>{if(Number.isSafeInteger(count)&&count>=0)meta.pendingOperationCount=count;else invalid('overflow');});},
  owned(count){act(()=>{if(Number.isSafeInteger(count)&&count>=0)meta.ownedObjectCount=count;else invalid('overflow');});},
  timer(){act(()=>{meta.deadlineTimerFired=true;});},
  site(value){act(()=>{if(typeof value==='string'&&value.length<=64)site=value;else invalid('overflow');});},
  guard(scope){act(()=>{if(meta.firstDeadlineGuardSite===null){meta.firstDeadlineGuardSite=scope==='helper-guard'?site:scope;meta.activePhaseAtGuard=active;}});},
  invalidation(error){act(()=>{if(meta.firstInvalidationKind===null)meta.firstInvalidationKind=kind(error);});},
  close(detaching){act(()=>{if(detaching)meta.closeDuringOwnDetach=true;else meta.foreignCloseObserved=true;});},
  cleanup(begin){act(()=>{meta.pendingCleanup=begin;});},
  releaseFailure(){act(()=>{meta.releaseFailures++;});},
  terminal(ok,error){act(()=>{meta.terminalOutcome=ok?'RETURNED':'THREW';meta.terminalKind=ok?null:kind(error);});},
  freeze(){return safe(()=>{if(frozen)return snapshot;frozen=true;snapshot=copy();try{text=serializer(snapshot);if(typeof text==='string'&&Buffer.byteLength(text,'utf8')+1>LIMITS.bytes)invalid('overflow');if(typeof text!=='string'||text!==stringify(snapshot)){invalid('serializationInvalid');snapshot=copy();text=stringify(snapshot);}if(Buffer.byteLength(text,'utf8')+1>LIMITS.bytes){invalid('overflow');snapshot=copy();text=stringify(snapshot);}}catch{invalid('serializationInvalid');snapshot=copy();text=stringify(snapshot);}if(Buffer.byteLength(text,'utf8')+1>LIMITS.bytes){invalid('overflow');snapshot=Object.freeze(Object.assign(blank(),{schemaVersion:1,kind:'capture-host-phase-ledger',meta:Object.freeze(Object.assign(blank(),{valid:false,overflow:true,serializationInvalid:meta.serializationInvalid,terminalOutcome:meta.terminalOutcome,terminalKind:meta.terminalKind})),rows:Object.freeze([])}));text=stringify(snapshot);}return snapshot;});},
  frozenText(){return safe(()=>{api.freeze();return text;});},
  freezeAndWriteWx(path){return safe(()=>{api.freeze();if(typeof text!=='string')return false;let fd,owned;const target=resolve(path),parent=dirname(target);try{if(target!==path||realpathSync(parent)!==parent)throw new Error('canonical ledger parent required');const before=lstatSync(parent);if(!before.isDirectory()||before.isSymbolicLink())throw new Error('ledger parent type');fd=openSync(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);owned=fstatSync(fd);if(!owned.isFile())throw new Error('ledger regular file');const after=lstatSync(parent);if(before.dev!==after.dev||before.ino!==after.ino)throw new Error('ledger parent changed');writeFileSync(fd,text+'\n');closeSync(fd);fd=undefined;const final=lstatSync(target);if(!final.isFile()||final.isSymbolicLink()||final.dev!==owned.dev||final.ino!==owned.ino)throw new Error('ledger ownership changed');return true;}catch{if(fd!==undefined)try{closeSync(fd);}catch{}if(owned)try{const current=lstatSync(target);if(!current.isSymbolicLink()&&current.dev===owned.dev&&current.ino===owned.ino)unlinkSync(target);}catch{}return false;}});}
 };
 api.reset();return Object.freeze(api);
}
export const observer=createObserver();
