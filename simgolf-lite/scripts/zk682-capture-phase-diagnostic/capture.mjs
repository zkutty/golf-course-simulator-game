import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {openSync,writeFileSync,fsyncSync,closeSync,fstatSync,lstatSync,linkSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {inflateSync} from 'node:zlib';
/* G1 INSERT 1 */// BEGIN G1 LEDGER
const g1Ledgers=new WeakMap();let g1Hooks={};
export function configureG1Observer(hooks={}){g1Hooks=hooks;}
export function createCapturePhaseLedger(timing,hooks=g1Hooks){
  const rows=[],pending=new Set(),reasons=new Set();let closed=false,lastBoundary='initial',lastCross='',firstFailurePhase=null;
  const invalidate=reason=>{if(reasons.size<8)reasons.add(typeof reason==='string'?reason.slice(0,64):'invalid-reason');};
  const phaseNow=()=>pending.size?[...pending].join(',').slice(0,64):lastCross||lastBoundary;
  const record=(phase,stage)=>{if(closed)return;try{const now=timing.now();if(typeof phase!=='string'||phase.length>64||!['start','end','error','timer','monotonic','finish','failure'].includes(stage)||!Number.isFinite(now))throw Error('primitive ledger');if(rows.length>=32){invalidate('row-overflow');return;}const row=Object.freeze({phase,stage,hostMs:now});rows.push(row);if(stage==='start')pending.add(phase);if(stage==='end'||stage==='error'){pending.delete(phase);lastBoundary=phase;}try{hooks.observer?.(Object.freeze({...row}));}catch{invalidate('observer-failed');}}catch{invalidate('record-failed');}};
  const deadline=kind=>record(phaseNow(),kind==='timer'?'timer':'monotonic');
  const failure=phase=>{if(firstFailurePhase===null){firstFailurePhase=phase??phaseNow();record(firstFailurePhase,'failure');}};
  const end=(phase,stage,limit)=>{try{if(limit!==undefined&&timing.now()>=limit)lastCross=phase;}catch{invalidate('clock-failed');}record(phase,stage);};
  const frame=()=>Object.freeze({kind:'g1-capture-phase-v1',valid:reasons.size===0,invalidReasons:Object.freeze([...reasons]),firstFailurePhase,rows:Object.freeze(rows.map(row=>Object.freeze({...row}))),qualification:'Host boundary observations; opaque backend cause unknown, spans overlap and observer perturbs timing. Late-owned cleanup may complete after this closed ledger.'});
  const finish=status=>{if(closed)return;record(status,'finish');closed=true;let encoded;try{const snapshot=frame(),canonical=JSON.stringify(snapshot);encoded=(hooks.serialize??JSON.stringify)(snapshot);if(encoded!==canonical||Buffer.byteLength('G1_CAPTURE_PHASE '+encoded+'\n')>8192)throw Error('ledger serialization/bound');}catch{invalidate('serialization-or-byte-bound');try{encoded=JSON.stringify(frame());if(Buffer.byteLength('G1_CAPTURE_PHASE '+encoded+'\n')>8192)throw Error('fallback bound');}catch{encoded='{"kind":"g1-capture-phase-v1","valid":false,"invalidReasons":["fallback-failed"],"firstFailurePhase":null,"rows":[]}';}}try{(hooks.emit??(text=>process.stdout.write(text)))('G1_CAPTURE_PHASE '+encoded+'\n');}catch{invalidate('stdout-failed');}};
  return {record,end,deadline,failure,finish,invalidate,snapshot:()=>frame()};
}
function g1Async(ledger,phase,operation,deadline){ledger.record(phase,'start');let value;try{value=operation();}catch(error){ledger.end(phase,'error',deadline);throw error;}Promise.resolve(value).then(()=>ledger.end(phase,'end',deadline),()=>ledger.end(phase,'error',deadline));return value;}
function g1Sync(ledger,phase,operation,deadline){ledger.record(phase,'start');try{const value=operation();ledger.end(phase,'end',deadline);return value;}catch(error){ledger.end(phase,'error',deadline);throw error;}}
function g1Finish(page,ledger,status){ledger.finish(status);if(g1Ledgers.get(page)===ledger)g1Ledgers.delete(page);}
// END G1 LEDGER

/* G1 END 1 */export const CAPTURE_MS=10000,MAX_PNG_BYTES=1048576,MAX_PIXELS=16*1024*1024;
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function readCanvas(node){
  const matches=document.querySelectorAll('.cc-pixi-stage canvas'),rect=node.getBoundingClientRect(),style=getComputedStyle(node);
  return {current:matches.length===1&&matches[0]===node,connected:node.isConnected,visible:style.display!=='none'&&style.visibility!=='hidden'&&style.visibility!=='collapse'&&Number(style.opacity)>0,tag:node.tagName,x:rect.x,y:rect.y,width:rect.width,height:rect.height,viewportWidth:innerWidth,viewportHeight:innerHeight,intrinsicWidth:node.width,intrinsicHeight:node.height,dpr:devicePixelRatio,zoom:visualViewport?.scale??1};
}
export function strictBase64(data){
  assert.equal(typeof data,'string','CDP base64 string required');assert.ok(data.length>0&&data.length<=4*Math.ceil(MAX_PNG_BYTES/3)&&data.length%4===0,'base64 preallocation size refused');
  assert.match(data,/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,'strict base64 required');
  const bytes=data.length/4*3-(data.endsWith('==')?2:data.endsWith('=')?1:0);assert.ok(bytes>=33&&bytes<=MAX_PNG_BYTES,'PNG preallocation bound refused');
  const png=Buffer.from(data,'base64');assert.equal(png.length,bytes);assert.equal(png.toString('base64'),data,'noncanonical base64 padding bits');return png;
}
export function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export function decodeStrictPng(png,expected){
  assert.ok(Buffer.isBuffer(png)&&png.length>=33&&png.length<=MAX_PNG_BYTES,'bounded actual PNG required');assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  let offset=8,width,height,channels,header=false,ended=false,idat=false,idatClosed=false;const compressed=[];
  while(offset<png.length){assert.ok(offset+12<=png.length,'truncated PNG chunk');const length=png.readUInt32BE(offset),end=offset+12+length;assert.ok(end<=png.length,'invalid PNG extent');const type=png.subarray(offset+4,offset+8).toString('ascii'),data=png.subarray(offset+8,end-4);assert.match(type,/^[A-Za-z]{4}$/);assert.equal(crc32(png.subarray(offset+4,end-4)),png.readUInt32BE(end-4),'PNG CRC');
    if(type==='IHDR'){assert.ok(!header&&offset===8&&length===13,'unique first IHDR');header=true;width=data.readUInt32BE(0);height=data.readUInt32BE(4);assert.ok(width>0&&height>0&&width*height<=MAX_PIXELS,'PNG pixel allocation bound');assert.equal(data[8],8);assert.ok([2,6].includes(data[9]),'RGB/RGBA only');channels=data[9]===2?3:4;assert.equal(data[10],0);assert.equal(data[11],0);assert.equal(data[12],0,'no interlaced allocation');if(expected){assert.equal(width,expected.width);assert.equal(height,expected.height);}}
    else if(type==='IDAT'){assert.ok(header&&!ended&&!idatClosed,'contiguous IDAT');idat=true;compressed.push(data);}
    else if(type==='IEND'){assert.ok(header&&idat&&!ended&&length===0&&end===png.length,'terminal IEND');ended=true;}
    else {assert.ok(header&&!ended&&type[0]===type[0].toLowerCase(),'unknown critical PNG chunk');if(idat)idatClosed=true;}
    offset=end;
  }
  assert.ok(header&&idat&&ended,'complete PNG chunks');const stride=width*channels,raw=inflateSync(Buffer.concat(compressed),{maxOutputLength:(stride+1)*height});assert.equal(raw.length,(stride+1)*height,'exact inflated length');const pixels=Buffer.alloc(width*height*4);let previous=Buffer.alloc(stride),source=0;
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){const filter=raw[source++];assert.ok(filter<=4,'PNG filter');const row=Buffer.alloc(stride);for(let x=0;x<stride;x++){const left=x>=channels?row[x-channels]:0,up=previous[x],corner=x>=channels?previous[x-channels]:0;row[x]=(raw[source++]+(filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth(left,up,corner)))&255;}for(let x=0;x<width;x++){const from=x*channels,to=(y*width+x)*4;pixels[to]=row[from];pixels[to+1]=row[from+1];pixels[to+2]=row[from+2];pixels[to+3]=channels===4?row[from+3]:255;}previous=row;}
  let visible=false,different=false;const first=pixels.readUInt32BE(0);for(let i=0;i<pixels.length;i+=4){visible ||= pixels[i+3]>0;different ||= pixels.readUInt32BE(i)!==first;}assert.ok(visible&&different,'nonuniform visible pixels required');return {width,height,pixels,pixelSHA256:sha256(pixels)};
}
export async function capturePublicCDPCanvas(page,{canvasClip,timing={now:()=>performance.now(),set:setTimeout,clear:clearTimeout}}){
/* G1 INSERT 2 */  const g1Phase=g1Ledgers.get(page)??createCapturePhaseLedger(timing);
/* G1 END 2 */  assert.equal(typeof canvasClip,'function','pinned baseline canvasClip required');const started=timing.now(),deadline=started+CAPTURE_MS,timeoutError=new Error('Public CDP capture deadline10000ms exceeded');let expired=false,closed=false,session,handle,failed=false,primary,result;
  const cleanupTasks=new Map();
  const cleanup=(object,method/* G1 INSERT 37 */,g1Late=false/* G1 END 37 */)=>{if(!object)return Promise.resolve();if(!cleanupTasks.has(object)){const task=Promise.resolve().then(()=>/* G1 INSERT 21 */g1Async(g1Phase,(g1Late||expired||closed?'late-':'')+(method==='detach'?'session-detach':'handle-dispose'),()=>/* G1 END 21 */object[method]()/* G1 INSERT 22 */,deadline)/* G1 END 22 */);task.catch(()=>{});cleanupTasks.set(object,task);}return cleanupTasks.get(object);};
  let rejectDeadline;const timeout=new Promise((_,reject)=>{rejectDeadline=reject;});timeout.catch(()=>{});const timer=timing.set(()=>{/* G1 INSERT 3 */g1Phase.deadline('timer',deadline);/* G1 END 3 */expired=true;rejectDeadline(timeoutError);},CAPTURE_MS);
  const guard=()=>{if(expired||timing.now()>=deadline){/* G1 INSERT 4 */g1Phase.deadline('monotonic',deadline);/* G1 END 4 */expired=true;throw timeoutError;}};
  const within=async promise=>{guard();const value=await Promise.race([Promise.resolve(promise),timeout]);guard();return value;};
  const owned=async(promise,method)=>{const pending=Promise.resolve(promise);pending.then(object=>{if(expired||closed||timing.now()>=deadline)/* G1 INSERT 38 */{g1Phase.failure(method==='detach'?'session-acquire':'handle-acquire');/* G1 END 38 */cleanup(object,method/* G1 INSERT 39 */,true/* G1 END 39 */);/* G1 INSERT 40 */}/* G1 END 40 */},()=>{});return within(pending);};
  try{
    assert.equal(await within(/* G1 INSERT 5 */g1Async(g1Phase,'canvas-count',()=>/* G1 END 5 */page.locator('.cc-pixi-stage canvas').count()/* G1 INSERT 6 */,deadline)/* G1 END 6 */),1,'exactly one canvas');handle=await owned(/* G1 INSERT 7 */g1Async(g1Phase,'handle-acquire',()=>/* G1 END 7 */page.$('.cc-pixi-stage canvas',{strict:true})/* G1 INSERT 8 */,deadline)/* G1 END 8 */,'dispose');assert.ok(handle,'attached canvas required');/* G1 INSERT 9 */g1Phase.record('pre-geometry','start');/* G1 END 9 */const before=await within(handle.evaluate(readCanvas)),clip=canvasClip(before);/* G1 INSERT 10 */g1Phase.end('pre-geometry','end',deadline);/* G1 END 10 */
    session=await owned(/* G1 INSERT 11 */g1Async(g1Phase,'session-acquire',()=>/* G1 END 11 */page.context().newCDPSession(page)/* G1 INSERT 12 */,deadline)/* G1 END 12 */,'detach');const response=await within(/* G1 INSERT 13 */g1Async(g1Phase,'send-response',()=>/* G1 END 13 */session.send('Page.captureScreenshot',{format:'png',clip:{...clip,scale:1},fromSurface:true,captureBeyondViewport:false,optimizeForSpeed:false})/* G1 INSERT 14 */,deadline)/* G1 END 14 */);
    const png=/* G1 INSERT 15 */g1Sync(g1Phase,'strict-base64',()=>/* G1 END 15 */strictBase64(response?.data)/* G1 INSERT 16 */,deadline)/* G1 END 16 */,decoded=/* G1 INSERT 17 */g1Sync(g1Phase,'png-decode',()=>/* G1 END 17 */decodeStrictPng(png,clip)/* G1 INSERT 18 */,deadline)/* G1 END 18 */;guard();/* G1 INSERT 19 */g1Phase.record('post-geometry','start');/* G1 END 19 */const after=await within(handle.evaluate(readCanvas));canvasClip(after);assert.deepEqual(after,before,'canvas identity/current connection/geometry changed');/* G1 INSERT 20 */g1Phase.end('post-geometry','end',deadline);/* G1 END 20 */
    result={png,receipt:{method:'public-cdp-page-captureScreenshot-canvas-viewport-clip-v1',clip,before,after,bytes:png.length,sha256:sha256(png),pixelSHA256:decoded.pixelSHA256,qualification:'Diagnostic public CDP comparison only; both APIs may share Chromium backend; no canonical receipt enum or causal claim'}};
  }catch(error){/* G1 INSERT 36 */g1Phase.failure();/* G1 END 36 */failed=true;primary=error;}
  // Start both disposals even if one fails or the capture deadline has elapsed.
  const disposal=[cleanup(session,'detach'),cleanup(handle,'dispose')];
  try{const outcomes=await within(Promise.allSettled(disposal));/* G1 INSERT 41 */let g1OutcomeIndex=-1;/* G1 END 41 */for(const outcome of outcomes)/* G1 INSERT 42 */{g1OutcomeIndex++;/* G1 END 42 */if(outcome.status==='rejected'&&!failed){/* G1 INSERT 43 */g1Phase.failure(g1OutcomeIndex===0?'session-detach':'handle-dispose');/* G1 END 43 */failed=true;primary=outcome.reason;}/* G1 INSERT 44 */}/* G1 END 44 */}catch(error){if(!failed){/* G1 INSERT 45 */g1Phase.failure();/* G1 END 45 */failed=true;primary=error;}}
  closed=true;timing.clear(timer);/* G1 INSERT 23 */if(failed)g1Finish(page,g1Phase,'capture-failed');/* G1 END 23 */if(failed)throw primary;/* G1 INSERT 47 */g1Phase.record('core-final-guard','start');try{/* G1 END 47 */guard();/* G1 INSERT 48 */g1Phase.end('core-final-guard','end',deadline);}catch(g1Error){g1Phase.failure('core-final-guard');g1Finish(page,g1Phase,'core-final-guard-failed');throw g1Error;}/* G1 END 48 */result.receipt.elapsedMs=timing.now()-started;result.receipt.deadlineHostMs=deadline;
  // No publisher or file API: late/failed results cannot escape this helper.
  return result;
}

export function canvasClip(state) {
  assert.ok(state && state.current && state.connected && state.visible && state.tag === "CANVAS", "Unique current visible connected canvas required");
  for (const key of ["x", "y", "width", "height", "viewportWidth", "viewportHeight", "intrinsicWidth", "intrinsicHeight", "dpr", "zoom"]) assert.ok(Number.isFinite(state[key]), "Finite canvas geometry required");
  assert.ok(state.width > 0 && state.height > 0 && state.intrinsicWidth > 0 && state.intrinsicHeight > 0, "Nonempty canvas required");
  assert.equal(state.dpr, 1, "Canonical Desktop Chrome DPR1 required");
  assert.equal(state.zoom, 1, "Canonical unzoomed viewport required");
  assert.ok(state.x >= 0 && state.y >= 0 && state.x + state.width <= state.viewportWidth && state.y + state.height <= state.viewportHeight, "Raw canvas rectangle must be fully inside viewport; epsilon overshoots rejected");
  // Match the installed element-capture integer enclosure; do not invoke private APIs.
  const x = Math.floor(state.x + 0.001), y = Math.floor(state.y + 0.001);
  const width = Math.ceil(state.x + state.width - 0.001) - x;
  const height = Math.ceil(state.y + state.height - 0.001) - y;
  assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= state.viewportWidth && y + height <= state.viewportHeight, "Canvas enclosure must be fully inside viewport; partial clips rejected");
  return { x, y, width, height };
}

export const PUBLIC_CDP_CAPTURE_METHOD='public-cdp-page-captureScreenshot-canvas-viewport-clip-v1';
const defaultTiming={now:()=>performance.now(),set:setTimeout,clear:clearTimeout};
const defaultIo={openSync,writeFileSync,fsyncSync,closeSync,fstatSync,lstatSync,linkSync,unlinkSync};
export async function captureVisibleCanvas(page,outputPath,{timing=defaultTiming,io=defaultIo}={}){
/* G1 INSERT 24 */  const g1Phase=createCapturePhaseLedger(timing);const existing=g1Ledgers.get(page);if(existing){existing.invalidate('overlap');g1Phase.invalidate('overlap');}g1Ledgers.set(page,g1Phase);
/* G1 END 24 */  const captured=await capturePublicCDPCanvas(page,{canvasClip,timing}),deadline=captured.receipt.deadlineHostMs,temporary=resolve(outputPath)+'.cdp-pending-'+randomUUID();
  const timeout=new Error('Canonical public CDP total capture/publication deadline10000ms exceeded');const guard=()=>{if(timing.now()>=deadline)throw /* G1 INSERT 25 */(g1Phase.deadline('monotonic',deadline),/* G1 END 25 */timeout/* G1 INSERT 26 */)/* G1 END 26 */;};
  let descriptor,owned,promoted=false,failed=false,primary;
  const removeOwned=path=>{if(!owned)return;const current=io.lstatSync(path,{throwIfNoEntry:false});if(current&&current.dev===owned.dev&&current.ino===owned.ino&&!current.isSymbolicLink())io.unlinkSync(path);};
  try{
/* G1 INSERT 27 */    g1Phase.record('publication-stage','start');
/* G1 END 27 */    guard();descriptor=io.openSync(temporary,'wx',0o600);owned=io.fstatSync(descriptor);guard();io.writeFileSync(descriptor,captured.png);guard();io.fsyncSync(descriptor);guard();io.closeSync(descriptor);descriptor=undefined;guard();/* G1 INSERT 28 */g1Phase.end('publication-stage','end',deadline);/* G1 END 28 */
    // Exclusive hard-link publication is atomic and refuses every existing final path.
    const staged=io.lstatSync(temporary);assert.ok(staged.isFile()&&!staged.isSymbolicLink()&&staged.dev===owned.dev&&staged.ino===owned.ino,'staged PNG ownership changed');
    /* G1 INSERT 29 */g1Sync(g1Phase,'publication-promote',()=>/* G1 END 29 */io.linkSync(temporary,outputPath)/* G1 INSERT 30 */,deadline)/* G1 END 30 */;promoted=true;guard();const final=io.lstatSync(outputPath);assert.ok(final.isFile()&&!final.isSymbolicLink()&&final.dev===owned.dev&&final.ino===owned.ino,'published PNG ownership changed');/* G1 INSERT 31 */g1Phase.record('publication-remove','start');/* G1 END 31 */removeOwned(temporary);guard();/* G1 INSERT 32 */g1Phase.end('publication-remove','end',deadline);/* G1 END 32 */
  }catch(error){/* G1 INSERT 46 */g1Phase.failure();/* G1 END 46 */failed=true;primary=error;}
  if(descriptor!==undefined)try{io.closeSync(descriptor);}catch(error){if(!failed){failed=true;primary=error;}}
  if(failed){for(const path of promoted?[outputPath,temporary]:[temporary])try{removeOwned(path);}catch{}/* G1 INSERT 33 */g1Finish(page,g1Phase,'publication-failed');/* G1 END 33 */throw primary;}
  const receipt={method:PUBLIC_CDP_CAPTURE_METHOD,clip:captured.receipt.clip,before:captured.receipt.before,after:captured.receipt.after,bytes:captured.receipt.bytes,sha256:captured.receipt.sha256,qualification:'Current unique visible DPR1 canvas, pre/post geometry and bounded CRC/pixels verified. Node synchronous filesystem calls cannot be preempted: elapsed deadline checked before/after exclusive publication; failure attempts inode-owned rollback and never returns an accepted receipt. Cleanup failure can leave unaccepted bytes; root completeness and visual QA remain required.'};
  // Returning the strict receipt is the acceptance boundary for the unchanged caller.
  /* G1 INSERT 49 */g1Phase.record('receipt-final-guard','start');/* G1 END 49 */try{guard();/* G1 INSERT 50 */g1Phase.end('receipt-final-guard','end',deadline);/* G1 END 50 */}catch(error){/* G1 INSERT 51 */g1Phase.failure('receipt-final-guard');/* G1 END 51 */try{removeOwned(outputPath);}catch{}/* G1 INSERT 34 */g1Finish(page,g1Phase,'receipt-failed');/* G1 END 34 */throw error;}/* G1 INSERT 35 */g1Finish(page,g1Phase,'success');/* G1 END 35 */return receipt;
}
