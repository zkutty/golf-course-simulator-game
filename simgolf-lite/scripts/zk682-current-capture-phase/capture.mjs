import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
export const HELPER_PIN='6fef03d6a061172e7eb9d8da3c5a096c4448d26eb62794ad4984be1bad53a7eb';
export const CAPTURE_MODULE_URL=import.meta.url;
export const MAX_ROWS=32,MAX_LEDGER_BYTES=8192;
export const PHASES=Object.freeze(['raw-acquire','raw-convert','pre-geometry','pre-clip','session-acquire','screenshot-response','base64-decode','png-decode','post-geometry','post-identity','result-construction','cleanup-session','cleanup-raw','cleanup-join','helper-finalize','publication']);
const STATUSES=Object.freeze(['not-entered','entered','returned','rejected','join-observed-fulfilled','join-observed-rejected','started-settlement-unobserved']);
const REASONS=Object.freeze(['observer-disabled','observer-options','observer-clock','nonfinite-clock','time-order','row-order','serialization-fault','ledger-cap','ledger-shape']);
const GUARDS=Object.freeze(['pre-await','post-await','post-conversion','post-decode','helper-final','publication-open','publication-write','publication-fsync','publication-close','publication-stage','publication-link','publication-unlink','receipt-final']);
const KINDS=Object.freeze(['deadline','undefined','null','boolean','number','string','bigint','symbol','function','object']);
const stringify=JSON.stringify,parse=JSON.parse;
const hash=source=>createHash('sha256').update(source).digest('hex');
const keys=(object,wanted)=>assert.deepEqual(Object.keys(object).sort(),[...wanted].sort());
const time=value=>assert.ok(value===null||(typeof value==='number'&&Number.isFinite(value)&&value>=0));
const phase=value=>assert.ok(value===null||PHASES.includes(value));
const kind=value=>value===null?'null':typeof value;
const frozen=value=>{for(const row of value.rows)Object.freeze(row);Object.freeze(value.rows);Object.freeze(value.facts);Object.freeze(value.limits);Object.freeze(value.invalidReasons);return Object.freeze(value);};
export function validateLedger(ledger,serialized=stringify(ledger)){
  assert.equal(typeof serialized,'string');assert.ok(Buffer.byteLength(serialized,'utf8')<=MAX_LEDGER_BYTES,'ledger-cap');
  keys(ledger,['schemaVersion','candidate','helperPin','qualification','limits','rows','facts','valid','invalidReasons']);
  assert.equal(ledger.schemaVersion,1);assert.equal(ledger.candidate,'66cedcc724308a622045455e8fbfa648afc89b81');assert.equal(ledger.helperPin,HELPER_PIN);
  assert.equal(ledger.qualification,'Diagnostic host boundary observations only; nonexclusive, observer perturbs timing; cleanup join is not branch settlement time; late facts UNKNOWN after original terminal boundary; no backend or original endpoint credit.');
  keys(ledger.limits,['maxRows','maxUtf8Bytes']);assert.deepEqual(ledger.limits,{maxRows:MAX_ROWS,maxUtf8Bytes:MAX_LEDGER_BYTES});
  assert.ok(Array.isArray(ledger.rows)&&ledger.rows.length<=MAX_ROWS,'row-cap');assert.equal(ledger.rows.length,PHASES.length);
  ledger.rows.forEach((row,index)=>{keys(row,['phase','startHostMs','returnObservedHostMs','status']);assert.equal(row.phase,PHASES[index]);assert.ok(STATUSES.includes(row.status));time(row.startHostMs);time(row.returnObservedHostMs);if(row.startHostMs!==null&&row.returnObservedHostMs!==null)assert.ok(row.returnObservedHostMs>=row.startHostMs,'time-order');if(row.status==='not-entered')assert.ok(row.startHostMs===null&&row.returnObservedHostMs===null);if(ledger.valid&&row.status!=='not-entered')assert.notEqual(row.startHostMs,null);if(ledger.valid&&['returned','rejected','join-observed-fulfilled','join-observed-rejected'].includes(row.status))assert.notEqual(row.returnObservedHostMs,null);});
  keys(ledger.facts,['activePhase','lastCompletedPhase','firstPrimaryPresent','firstPrimaryPhase','primaryKind','firstTimerHostMs','pendingPhaseAtTimer','firstDeadlineGuardSite','firstDeadlineGuardHostMs','activePhaseAtGuard','lastCompletedAtGuard','firstRejectedCleanupPhase','terminalOutcomePresent','terminalPassed','terminalPrimaryKind']);
  const f=ledger.facts;for(const name of ['activePhase','lastCompletedPhase','firstPrimaryPhase','pendingPhaseAtTimer','activePhaseAtGuard','lastCompletedAtGuard','firstRejectedCleanupPhase'])phase(f[name]);for(const name of ['firstTimerHostMs','firstDeadlineGuardHostMs'])time(f[name]);
  for(const name of ['firstPrimaryPresent','terminalOutcomePresent','terminalPassed'])assert.equal(typeof f[name],'boolean');for(const name of ['primaryKind','terminalPrimaryKind'])assert.ok(f[name]===null||KINDS.includes(f[name]));assert.ok(f.firstDeadlineGuardSite===null||GUARDS.includes(f.firstDeadlineGuardSite));if(!f.firstPrimaryPresent)assert.ok(f.firstPrimaryPhase===null&&f.primaryKind===null);
  assert.equal(typeof ledger.valid,'boolean');assert.ok(Array.isArray(ledger.invalidReasons)&&ledger.invalidReasons.length<=REASONS.length);assert.equal(new Set(ledger.invalidReasons).size,ledger.invalidReasons.length);for(const reason of ledger.invalidReasons)assert.ok(REASONS.includes(reason));assert.equal(ledger.valid,ledger.invalidReasons.length===0);return ledger;
}
export function createCaptureObserver(options={}){
  let clock=()=>performance.now(),serialize=stringify,enabled=true;
  const reasons=new Set(),rows=PHASES.map(phase=>({phase,startHostMs:null,returnObservedHostMs:null,status:'not-entered'}));
  const facts={activePhase:null,lastCompletedPhase:null,firstPrimaryPresent:false,firstPrimaryPhase:null,primaryKind:null,firstTimerHostMs:null,pendingPhaseAtTimer:null,firstDeadlineGuardSite:null,firstDeadlineGuardHostMs:null,activePhaseAtGuard:null,lastCompletedAtGuard:null,firstRejectedCleanupPhase:null,terminalOutcomePresent:false,terminalPassed:false,terminalPrimaryKind:null};
  let snapshot,lastClock=null;
  const invalidate=reason=>reasons.add(reason);
  try{if(options.enabled===false){enabled=false;invalidate('observer-disabled');}if(options.clock!==undefined){if(typeof options.clock!=='function')invalidate('observer-options');else clock=options.clock;}if(options.serialize!==undefined){if(typeof options.serialize!=='function')invalidate('observer-options');else serialize=options.serialize;}}catch{invalidate('observer-options');}
  const now=()=>{let value;try{value=clock();}catch{invalidate('observer-clock');return null;}if(typeof value!=='number'||!Number.isFinite(value)||value<0){invalidate('nonfinite-clock');return null;}if(lastClock!==null&&value<lastClock){invalidate('time-order');return null;}lastClock=value;return value;};
  const safe=fn=>(...args)=>{if(!enabled||snapshot)return;try{fn(...args);}catch{invalidate('ledger-shape');}};
  const row=phase=>{const index=PHASES.indexOf(phase);if(index<0)throw new Error('phase');return rows[index];};
  const enter=(phase,background=false)=>{const r=row(phase);if(r.status!=='not-entered'){invalidate('row-order');return;}r.startHostMs=now();r.status=background?'started-settlement-unobserved':'entered';if(!background)facts.activePhase=phase;};
  const end=phase=>{const r=row(phase);if(r.status!=='entered'){invalidate('row-order');return;}r.returnObservedHostMs=now();r.status='returned';facts.lastCompletedPhase=phase;};
  const rejected=phase=>{const r=row(phase);if(r.status==='not-entered'){invalidate('row-order');return;}r.returnObservedHostMs=now();r.status='rejected';};
  const operation=method=>method==='detach'?'cleanup-session':method==='dispose'?'cleanup-raw':null;
  const api={
    enter:safe(enter),end:safe(end),rejected:safe(rejected),rejectedActive:safe(()=>rejected(facts.activePhase)),
    timer:safe(()=>{if(facts.firstTimerHostMs===null){facts.firstTimerHostMs=now();facts.pendingPhaseAtTimer=facts.activePhase;}}),
    deadline:safe(site=>{if(!GUARDS.includes(site)){invalidate('ledger-shape');return;}if(facts.firstDeadlineGuardSite===null){facts.firstDeadlineGuardSite=site;facts.firstDeadlineGuardHostMs=now();facts.activePhaseAtGuard=facts.activePhase;facts.lastCompletedAtGuard=facts.lastCompletedPhase;}rejected(facts.activePhase);}),
    primary:safe((value,timeoutError,phase=facts.activePhase)=>{if(!facts.firstPrimaryPresent){if(!PHASES.includes(phase)){invalidate('ledger-shape');return;}facts.firstPrimaryPresent=true;facts.firstPrimaryPhase=phase;facts.primaryKind=value===timeoutError?'deadline':kind(value);}}),
    cleanupStart:safe(method=>{const name=operation(method);if(!name){invalidate('ledger-shape');return;}enter(name,true);}),
    cleanupRejected:safe(method=>{const name=operation(method);if(!name){invalidate('ledger-shape');return;}rejected(name);}),
    join:safe(outcomes=>{end('cleanup-join');for(let index=0;index<outcomes.length;index++){if(index>=2){invalidate('ledger-shape');break;}const name=index===0?'cleanup-session':'cleanup-raw',r=row(name),status=outcomes[index].status;if(!['fulfilled','rejected'].includes(status)){invalidate('ledger-shape');continue;}if(status==='rejected'&&facts.firstRejectedCleanupPhase===null)facts.firstRejectedCleanupPhase=name;if(r.status!=='not-entered'){r.status=status==='fulfilled'?'join-observed-fulfilled':'join-observed-rejected';r.returnObservedHostMs=now();}}}),
    firstRejectedCleanupPhase:()=>facts.firstRejectedCleanupPhase,
    finish:(failed,primary)=>{if(snapshot)return snapshot;try{facts.terminalOutcomePresent=true;facts.terminalPassed=!failed;facts.terminalPrimaryKind=failed?kind(primary):null;}catch{invalidate('ledger-shape');}
      const make=()=>frozen({schemaVersion:1,candidate:'66cedcc724308a622045455e8fbfa648afc89b81',helperPin:HELPER_PIN,qualification:'Diagnostic host boundary observations only; nonexclusive, observer perturbs timing; cleanup join is not branch settlement time; late facts UNKNOWN after original terminal boundary; no backend or original endpoint credit.',limits:{maxRows:MAX_ROWS,maxUtf8Bytes:MAX_LEDGER_BYTES},rows:rows.map(value=>({...value})),facts:{...facts},valid:reasons.size===0,invalidReasons:[...reasons]});
      let candidate=make();try{const text=serialize(candidate);if(typeof text!=='string')invalidate('serialization-fault');else if(Buffer.byteLength(text,'utf8')>MAX_LEDGER_BYTES)invalidate('ledger-cap');else{validateLedger(parse(text),text);assert.deepEqual(parse(text),candidate);}}catch{invalidate('serialization-fault');}
      snapshot=reasons.size===candidate.invalidReasons.length?candidate:make();return snapshot;
    },
  };
  return Object.freeze(api);
}
export function emitLedger(path,snapshot,options={}){
  try{const text=stringify(snapshot);validateLedger(snapshot,text+'\n');const write=options.write??writeFileSync;write(path,text+'\n',{encoding:'utf8',flag:'wx'});return Object.freeze({written:true,valid:snapshot.valid,reason:null});}catch{return Object.freeze({written:false,valid:false,reason:'writer-fault'});}
}
export function inverseCaptureSource(source){const inverse=source.replace(/\/\*O@(\d{3})\*\/[\s\S]*?\/\*@O\1\*\//g,'');assert.doesNotMatch(inverse,/\/\*[@]?O/);assert.equal(hash(inverse),HELPER_PIN,'complete pinned H inverse required');return inverse;}
export function transformCaptureSource(source,{observerImport='./capture.mjs'}={}){
  assert.equal(hash(source),HELPER_PIN,'exact current H donor required');assert.ok(observerImport==='./capture.mjs'||observerImport===CAPTURE_MODULE_URL,'fixed observer import required');let result=source;
  for(const [before,after]of HELPER_EDITS){assert.equal(result.split(before).length-1,1,'single helper anchor');result=result.replace(before,after);}
  result=result.replace("'__O_OBSERVER_IMPORT__'",JSON.stringify(observerImport));assert.equal(inverseCaptureSource(result),source);return result;
}
export function verifyCaptureTransform(source,donor,options={}){assert.equal(source,transformCaptureSource(donor,options),'observation-only template required');assert.equal(inverseCaptureSource(source),donor);const before=sourceInventory(donor),after=sourceInventory(source);assert.deepEqual(after,before,'original cardinality required');return before;}
export function sourceInventory(source){const patterns={await:/\bawait\s+/g,promiseRace:/Promise\.race\(/g,allSettled:/Promise\.allSettled\(/g,then:/\.then\(/g,catch:/\.catch\(/g,guard:/\bguard\(/g,clock:/timing\.now\(/g,timerSet:/timing\.set\(/g,timerClear:/timing\.clear\(/g,count:/page\.locator\(/g,raw:/page\.evaluateHandle\(/g,convert:/rawHandle\.asElement\(/g,geometry:/handle\.evaluate\(/g,session:/page\.context\(\)\.newCDPSession\(/g,screenshot:/session\.send\(/g};return Object.fromEntries(Object.entries(patterns).map(([name,pattern])=>[name,[...source.matchAll(pattern)].length]));}
const HELPER_EDITS=[
  [
    "import assert from 'node:assert/strict';",
    "/*O@001*/import {createCaptureObserver,emitLedger} from '__O_OBSERVER_IMPORT__';\nlet currentCaptureObservation;\nexport {emitLedger};\nexport function finalizeCaptureObservation(failed,primary){return (currentCaptureObservation??createCaptureObserver()).finish(failed,primary);}\n/*@O001*/import assert from 'node:assert/strict';"
  ],
  [
    "timing={now:()=>performance.now(),set:setTimeout,clear:clearTimeout}}){",
    "timing={now:()=>performance.now(),set:setTimeout,clear:clearTimeout}/*O@002*/,observation=createCaptureObserver()/*@O002*/}){"
  ],
  [
    "Promise.resolve().then(()=>object[method]());task.catch(()=>{});",
    "Promise.resolve().then(()=>/*O@003*/{observation.cleanupStart(method);return /*@O003*/object[method]()/*O@004*/;}/*@O004*/);task.catch(()=>{/*O@005*/observation.cleanupRejected(method);/*@O005*/});"
  ],
  [
    "()=>{expired=true;rejectDeadline(timeoutError);}",
    "()=>{expired=true;/*O@006*/observation.timer();/*@O006*/rejectDeadline(timeoutError);}"
  ],
  [
    "const guard=()=>{if(expired||timing.now()>=deadline){expired=true;throw timeoutError;}};",
    "const guard=(/*O@007*/site/*@O007*/)=>{if(expired||timing.now()>=deadline){expired=true;/*O@008*/observation.deadline(site);/*@O008*/throw timeoutError;}};"
  ],
  [
    "const within=async promise=>{guard();const value=await Promise.race([Promise.resolve(promise),timeout]);guard();return value;};",
    "const within=async promise=>{guard(/*O@009*/'pre-await'/*@O009*/);const value=await Promise.race([Promise.resolve(promise),timeout]);guard(/*O@010*/'post-await'/*@O010*/);return value;};"
  ],
  [
    "    rawHandle=await",
    "/*O@011*/    observation.enter('raw-acquire');/*@O011*/    rawHandle=await"
  ],
  [
    "}),'dispose');assert.ok(rawHandle,'attached raw canvas handle required');",
    "}),'dispose');/*O@013*/observation.end('raw-acquire');observation.enter('raw-convert');/*@O013*/assert.ok(rawHandle,'attached raw canvas handle required');"
  ],
  [
    "assert.ok(handle,'attached canvas element required');guard();const before=",
    "assert.ok(handle,'attached canvas element required');/*O@014*/observation.end('raw-convert');/*@O014*/guard(/*O@015*/'post-conversion'/*@O015*/);/*O@016*/observation.enter('pre-geometry');/*@O016*/const before="
  ],
  [
    "before=await within(handle.evaluate(readCanvas)),clip=canvasClip(before);",
    "before=await within(handle.evaluate(readCanvas)),/*O@017*/oPre=(observation.end('pre-geometry'),observation.enter('pre-clip')),/*@O017*/clip=canvasClip(before);/*O@018*/observation.end('pre-clip');/*@O018*/"
  ],
  [
    "    session=await owned(page.context().newCDPSession(page),'detach');const response=",
    "/*O@019*/    observation.enter('session-acquire');/*@O019*/    session=await owned(page.context().newCDPSession(page),'detach');/*O@020*/observation.end('session-acquire');observation.enter('screenshot-response');/*@O020*/const response="
  ],
  [
    "const response=await within(session.send('Page.captureScreenshot',{format:'png',clip:{...clip,scale:1},fromSurface:true,captureBeyondViewport:false,optimizeForSpeed:false}));",
    "const response=await within(session.send('Page.captureScreenshot',{format:'png',clip:{...clip,scale:1},fromSurface:true,captureBeyondViewport:false,optimizeForSpeed:false}));/*O@021*/observation.end('screenshot-response');/*@O021*/"
  ],
  [
    "    const png=strictBase64(response?.data),decoded=decodeStrictPng(png,clip);guard();const after=await within(handle.evaluate(readCanvas));canvasClip(after);assert.deepEqual(after,before,'canvas identity/current connection/geometry changed');",
    "/*O@022*/    observation.enter('base64-decode');/*@O022*/    const png=strictBase64(response?.data),/*O@023*/oBase64=(observation.end('base64-decode'),observation.enter('png-decode')),/*@O023*/decoded=decodeStrictPng(png,clip);/*O@024*/observation.end('png-decode');/*@O024*/guard(/*O@025*/'post-decode'/*@O025*/);/*O@026*/observation.enter('post-geometry');/*@O026*/const after=await within(handle.evaluate(readCanvas));/*O@027*/observation.end('post-geometry');observation.enter('post-identity');/*@O027*/canvasClip(after);assert.deepEqual(after,before,'canvas identity/current connection/geometry changed');/*O@028*/observation.end('post-identity');/*@O028*/"
  ],
  [
    "    result={png,receipt:{method:'public-cdp-page-captureScreenshot-canvas-viewport-clip-v1',clip,before,after,bytes:png.length,sha256:sha256(png),pixelSHA256:decoded.pixelSHA256,qualification:'Diagnostic public CDP comparison only; both APIs may share Chromium backend; no canonical receipt enum or causal claim'}};",
    "/*O@029*/    observation.enter('result-construction');/*@O029*/    result={png,receipt:{method:'public-cdp-page-captureScreenshot-canvas-viewport-clip-v1',clip,before,after,bytes:png.length,sha256:sha256(png),pixelSHA256:decoded.pixelSHA256,qualification:'Diagnostic public CDP comparison only; both APIs may share Chromium backend; no canonical receipt enum or causal claim'}};/*O@030*/observation.end('result-construction');/*@O030*/"
  ],
  [
    "  }catch(error){failed=true;primary=error;}\n  // Start both disposals",
    "  }catch(error){/*O@031*/observation.rejectedActive();/*@O031*/failed=true;primary=error;/*O@032*/observation.primary(error,timeoutError);/*@O032*/}\n  // Start both disposals"
  ],
  [
    "  try{const outcomes=await within(Promise.allSettled(disposal));for(const outcome of outcomes)if(outcome.status==='rejected'&&!failed){failed=true;primary=outcome.reason;}}catch(error){if(!failed){failed=true;primary=error;}}",
    "/*O@033*/  observation.enter('cleanup-join');/*@O033*/  try{const outcomes=await within(Promise.allSettled(disposal));/*O@034*/observation.join(outcomes);/*@O034*/for(const outcome of outcomes)if(outcome.status==='rejected'&&!failed){failed=true;primary=outcome.reason;/*O@035*/observation.primary(outcome.reason,timeoutError,observation.firstRejectedCleanupPhase());/*@O035*/}}catch(error){/*O@036*/observation.rejected('cleanup-join');/*@O036*/if(!failed){failed=true;primary=error;/*O@037*/observation.primary(error,timeoutError);/*@O037*/}}"
  ],
  [
    "  closed=true;timing.clear(timer);if(failed)throw primary;guard();result.receipt.elapsedMs=timing.now()-started;result.receipt.deadlineHostMs=deadline;",
    "/*O@038*/  observation.enter('helper-finalize');/*@O038*/  closed=true;timing.clear(timer);if(failed)throw /*O@039*/(observation.rejected('helper-finalize'),/*@O039*/primary/*O@040*/)/*@O040*/;guard(/*O@041*/'helper-final'/*@O041*/);result.receipt.elapsedMs=timing.now()-started;result.receipt.deadlineHostMs=deadline;"
  ],
  [
    "  return result;\n}",
    "/*O@042*/  observation.end('helper-finalize');/*@O042*/  return result;\n}"
  ],
  [
    "export async function captureVisibleCanvas(page,outputPath,{timing=defaultTiming,io=defaultIo}={}){",
    "export async function captureVisibleCanvas(page,outputPath,{timing=defaultTiming,io=defaultIo/*O@043*/,observation=createCaptureObserver()/*@O043*/}={}){/*O@044*/currentCaptureObservation=observation;/*@O044*/"
  ],
  [
    "const captured=await capturePublicCDPCanvas(page,{canvasClip,timing}),deadline=",
    "const captured=await capturePublicCDPCanvas(page,{canvasClip,timing/*O@045*/,observation/*@O045*/}),/*O@046*/oPublication=observation.enter('publication'),/*@O046*/deadline="
  ],
  [
    "const timeout=new Error('Canonical public CDP total capture/publication deadline10000ms exceeded');const guard=()=>{if(timing.now()>=deadline)throw timeout;};",
    "const timeout=new Error('Canonical public CDP total capture/publication deadline10000ms exceeded');const guard=(/*O@047*/site/*@O047*/)=>{if(timing.now()>=deadline)throw /*O@048*/(observation.deadline(site),/*@O048*/timeout/*O@049*/)/*@O049*/;};"
  ],
  [
    "export async function captureVisibleCanvas(page,outputPath,{timing=defaultTiming,io=defaultIo/*O@043*/,observation=createCaptureObserver()/*@O043*/}={}){/*O@044*/currentCaptureObservation=observation;/*@O044*/\n  const captured=await capturePublicCDPCanvas(page,{canvasClip,timing/*O@045*/,observation/*@O045*/}),/*O@046*/oPublication=observation.enter('publication'),/*@O046*/deadline=captured.receipt.deadlineHostMs,temporary=resolve(outputPath)+'.cdp-pending-'+randomUUID();\n  const timeout=new Error('Canonical public CDP total capture/publication deadline10000ms exceeded');const guard=(/*O@047*/site/*@O047*/)=>{if(timing.now()>=deadline)throw /*O@048*/(observation.deadline(site),/*@O048*/timeout/*O@049*/)/*@O049*/;};\n  let descriptor,owned,promoted=false,failed=false,primary;\n  const removeOwned=path=>{if(!owned)return;const current=io.lstatSync(path,{throwIfNoEntry:false});if(current&&current.dev===owned.dev&&current.ino===owned.ino&&!current.isSymbolicLink())io.unlinkSync(path);};\n  try{\n    guard();descriptor=io.openSync(temporary,'wx',0o600);owned=io.fstatSync(descriptor);guard();io.writeFileSync(descriptor,captured.png);guard();io.fsyncSync(descriptor);guard();io.closeSync(descriptor);descriptor=undefined;guard();\n    // Exclusive hard-link publication is atomic and refuses every existing final path.\n    const staged=io.lstatSync(temporary);assert.ok(staged.isFile()&&!staged.isSymbolicLink()&&staged.dev===owned.dev&&staged.ino===owned.ino,'staged PNG ownership changed');\n    io.linkSync(temporary,outputPath);promoted=true;guard();const final=io.lstatSync(outputPath);assert.ok(final.isFile()&&!final.isSymbolicLink()&&final.dev===owned.dev&&final.ino===owned.ino,'published PNG ownership changed');removeOwned(temporary);guard();\n  }catch(error){failed=true;primary=error;}\n  if(descriptor!==undefined)try{io.closeSync(descriptor);}catch(error){if(!failed){failed=true;primary=error;}}\n  if(failed){for(const path of promoted?[outputPath,temporary]:[temporary])try{removeOwned(path);}catch{}throw primary;}\n  const receipt={method:PUBLIC_CDP_CAPTURE_METHOD,clip:captured.receipt.clip,before:captured.receipt.before,after:captured.receipt.after,bytes:captured.receipt.bytes,sha256:captured.receipt.sha256,qualification:'Current unique visible DPR1 canvas, pre/post geometry and bounded CRC/pixels verified. Node synchronous filesystem calls cannot be preempted: elapsed deadline checked before/after exclusive publication; failure attempts inode-owned rollback and never returns an accepted receipt. Cleanup failure can leave unaccepted bytes; root completeness and visual QA remain required.'};\n  // Returning the strict receipt is the acceptance boundary for the unchanged caller.\n  try{guard();}catch(error){try{removeOwned(outputPath);}catch{}throw error;}return receipt;\n}\n",
    "export async function captureVisibleCanvas(page,outputPath,{timing=defaultTiming,io=defaultIo/*O@043*/,observation=createCaptureObserver()/*@O043*/}={}){/*O@044*/currentCaptureObservation=observation;/*@O044*/\n  const captured=await capturePublicCDPCanvas(page,{canvasClip,timing/*O@045*/,observation/*@O045*/}),/*O@046*/oPublication=observation.enter('publication'),/*@O046*/deadline=captured.receipt.deadlineHostMs,temporary=resolve(outputPath)+'.cdp-pending-'+randomUUID();\n  const timeout=new Error('Canonical public CDP total capture/publication deadline10000ms exceeded');const guard=(/*O@047*/site/*@O047*/)=>{if(timing.now()>=deadline)throw /*O@048*/(observation.deadline(site),/*@O048*/timeout/*O@049*/)/*@O049*/;};\n  let descriptor,owned,promoted=false,failed=false,primary;\n  const removeOwned=path=>{if(!owned)return;const current=io.lstatSync(path,{throwIfNoEntry:false});if(current&&current.dev===owned.dev&&current.ino===owned.ino&&!current.isSymbolicLink())io.unlinkSync(path);};\n  try{\n    guard(/*O@050*/'publication-open'/*@O050*/);descriptor=io.openSync(temporary,'wx',0o600);owned=io.fstatSync(descriptor);guard(/*O@051*/'publication-write'/*@O051*/);io.writeFileSync(descriptor,captured.png);guard(/*O@052*/'publication-fsync'/*@O052*/);io.fsyncSync(descriptor);guard(/*O@053*/'publication-close'/*@O053*/);io.closeSync(descriptor);descriptor=undefined;guard(/*O@054*/'publication-stage'/*@O054*/);\n    // Exclusive hard-link publication is atomic and refuses every existing final path.\n    const staged=io.lstatSync(temporary);assert.ok(staged.isFile()&&!staged.isSymbolicLink()&&staged.dev===owned.dev&&staged.ino===owned.ino,'staged PNG ownership changed');\n    io.linkSync(temporary,outputPath);promoted=true;guard(/*O@055*/'publication-link'/*@O055*/);const final=io.lstatSync(outputPath);assert.ok(final.isFile()&&!final.isSymbolicLink()&&final.dev===owned.dev&&final.ino===owned.ino,'published PNG ownership changed');removeOwned(temporary);guard(/*O@056*/'publication-unlink'/*@O056*/);\n  }catch(error){failed=true;primary=error;}\n  if(descriptor!==undefined)try{io.closeSync(descriptor);}catch(error){if(!failed){failed=true;primary=error;}}\n  if(failed){for(const path of promoted?[outputPath,temporary]:[temporary])try{removeOwned(path);}catch{}throw primary;}\n  const receipt={method:PUBLIC_CDP_CAPTURE_METHOD,clip:captured.receipt.clip,before:captured.receipt.before,after:captured.receipt.after,bytes:captured.receipt.bytes,sha256:captured.receipt.sha256,qualification:'Current unique visible DPR1 canvas, pre/post geometry and bounded CRC/pixels verified. Node synchronous filesystem calls cannot be preempted: elapsed deadline checked before/after exclusive publication; failure attempts inode-owned rollback and never returns an accepted receipt. Cleanup failure can leave unaccepted bytes; root completeness and visual QA remain required.'};\n  // Returning the strict receipt is the acceptance boundary for the unchanged caller.\n  try{guard(/*O@057*/'receipt-final'/*@O057*/);}catch(error){try{removeOwned(outputPath);}catch{}throw error;}return receipt;\n}\n"
  ],
  [
    "  }catch(error){failed=true;primary=error;}\n  if(descriptor",
    "  }catch(error){/*O@058*/observation.rejected('publication');/*@O058*/failed=true;primary=error;/*O@059*/observation.primary(error,timeout);/*@O059*/}\n  if(descriptor"
  ],
  [
    "catch(error){if(!failed){failed=true;primary=error;}}\n  if(failed)",
    "catch(error){if(!failed){failed=true;primary=error;/*O@060*/observation.primary(error,timeout);/*@O060*/}}\n  if(failed)"
  ],
  [
    "}catch(error){try{removeOwned(outputPath);}catch{}throw error;}return receipt;",
    "}catch(error){/*O@061*/observation.rejected('publication');/*@O061*/try{removeOwned(outputPath);}catch{}throw error;}/*O@062*/observation.end('publication');/*@O062*/return receipt;"
  ],
  [
    "  closed=true;timing.clear(timer);",
    "/*O@063*/  try{/*@O063*/  closed=true;timing.clear(timer);"
  ],
  [
    "result.receipt.deadlineHostMs=deadline;",
    "result.receipt.deadlineHostMs=deadline;/*O@064*/}catch(error){observation.finish(true,error);throw error;}/*@O064*/"
  ],
  [
    "currentCaptureObservation=observation;/*@O044*/",
    "currentCaptureObservation=observation;/*@O044*//*O@065*/try{/*@O065*/"
  ],
  [
    "observation.end('publication');/*@O062*/return receipt;\n}",
    "observation.end('publication');observation.finish(false);/*@O062*/return receipt;\n/*O@066*/}catch(error){observation.finish(true,error);throw error;}/*@O066*/}"
  ]
];
