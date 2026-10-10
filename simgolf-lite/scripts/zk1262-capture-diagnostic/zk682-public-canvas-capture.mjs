import {observer} from './observer.mjs';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {openSync,writeFileSync,fsyncSync,closeSync,fstatSync,lstatSync,linkSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {inflateSync} from 'node:zlib';
export const CAPTURE_MS=10000,MAX_PNG_BYTES=1048576,MAX_PIXELS=16*1024*1024;
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function readCanvas(node){
  const matches=document.querySelectorAll('.cc-pixi-stage canvas'),rect=node.getBoundingClientRect(),style=getComputedStyle(node);
  return {current:matches.length===1&&matches[0]===node,connected:node.isConnected,visible:style.display!=='none'&&style.visibility!=='hidden'&&style.visibility!=='collapse'&&Number(style.opacity)>0,tag:node.tagName,x:rect.x,y:rect.y,width:rect.width,height:rect.height,viewportWidth:innerWidth,viewportHeight:innerHeight,intrinsicWidth:node.width,intrinsicHeight:node.height,dpr:devicePixelRatio,zoom:visualViewport?.scale??1};
}
function readOwnedCanvas(envelope){
  if(!envelope||typeof envelope!=='object'||Object.getPrototypeOf(envelope)!==null)throw new Error('Private null-prototype canvas envelope required');
  const keys=Reflect.ownKeys(envelope),descriptor=Object.getOwnPropertyDescriptor(envelope,'node');
  if(keys.length!==1||keys[0]!=='node'||!descriptor||!Object.prototype.hasOwnProperty.call(descriptor,'value')||descriptor.enumerable!==true||descriptor.writable!==false||descriptor.configurable!==false)throw new Error('Private single own immutable canvas DATA property required');
  const node=descriptor.value;
  if(!(node instanceof HTMLCanvasElement)||node.ownerDocument!==document)throw new Error('Private current document HTMLCanvasElement required');
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
// Public Runtime transport owns a private envelope; user callbacks remain distinct A/B/D.
function acquireCanvasEnvelope(){
  const matches=document.querySelectorAll('.cc-pixi-stage canvas');
  if(matches.length!==1)throw new Error('Exactly one current document canvas required');
  const node=matches[0];
  if(!(node instanceof HTMLCanvasElement)||node.ownerDocument!==document||!node.isConnected)throw new Error('Current document connected HTMLCanvasElement required');
  return Object.defineProperty(Object.create(null),'node',{value:node,enumerable:true,writable:false,configurable:false});
}
function taggedOwnedCanvas(){
  const envelope=this;
  if(!envelope||typeof envelope!=='object'||Object.getPrototypeOf(envelope)!==null)throw new Error('Private null-prototype canvas envelope required');
  const keys=Reflect.ownKeys(envelope),descriptor=Object.getOwnPropertyDescriptor(envelope,'node');
  if(keys.length!==1||keys[0]!=='node'||!descriptor||!Object.prototype.hasOwnProperty.call(descriptor,'value')||descriptor.enumerable!==true||descriptor.writable!==false||descriptor.configurable!==false)throw new Error('Private single own immutable canvas DATA property required');
  const node=descriptor.value;
  if(!(node instanceof HTMLCanvasElement)||node.ownerDocument!==document)throw new Error('Private current document HTMLCanvasElement required');
  const matches=document.querySelectorAll('.cc-pixi-stage canvas'),rect=node.getBoundingClientRect(),style=getComputedStyle(node);
  const state={current:matches.length===1&&matches[0]===node,connected:node.isConnected,visible:style.display!=='none'&&style.visibility!=='hidden'&&style.visibility!=='collapse'&&Number(style.opacity)>0,tag:node.tagName,x:rect.x,y:rect.y,width:rect.width,height:rect.height,viewportWidth:innerWidth,viewportHeight:innerHeight,intrinsicWidth:node.width,intrinsicHeight:node.height,dpr:devicePixelRatio,zoom:visualViewport?.scale??1};
  const fields=['current','connected','visible','tag','x','y','width','height','viewportWidth','viewportHeight','intrinsicWidth','intrinsicHeight','dpr','zoom'];
  return ['zk682-canvas-state-tags-v1',...fields.map((key,index)=>{
    const value=state[key];
    if(index<3){if(typeof value!=='boolean')throw new Error('Boolean canvas state required');return ['b',value];}
    if(index===3){if(typeof value!=='string')throw new Error('String canvas tag required');return ['s',value];}
    if(typeof value!=='number')throw new Error('Numeric canvas state required');
    return Object.is(value,-0)?['z']:Number.isNaN(value)?['nan']:value===Infinity?['pinf']:value===-Infinity?['ninf']:['n',value];
  })];
}
function ownData(object,key,required=false){
  assert.ok(object!==null&&typeof object==='object','Public CDP own DATA record required');
  const descriptor=Object.getOwnPropertyDescriptor(object,key);
  if(!descriptor){assert.ok(!required,'Public CDP own DATA property required: '+key);return undefined;}
  assert.ok(Object.prototype.hasOwnProperty.call(descriptor,'value'),'Public CDP accessor refused: '+key);
  return descriptor.value;
}
function denseArray(array,length){
  assert.ok(Array.isArray(array)&&ownData(array,'length',true)===length,'Exact dense canvas wire array required');
  const keys=Reflect.ownKeys(array);assert.equal(keys.length,length+1,'Canvas wire extra properties refused');
  for(let index=0;index<length;index++)ownData(array,String(index),true);
  assert.ok(keys.includes('length'),'Canvas wire length required');return array;
}
function decodeCanvasState(response){
  const remote=ownData(response,'result',true);assert.equal(ownData(remote,'type',true),'object');const subtype=Object.getOwnPropertyDescriptor(remote,'subtype');if(subtype!==undefined){assert.ok(Object.prototype.hasOwnProperty.call(subtype,'value'),'Public CDP accessor refused: subtype');assert.equal(subtype.value,'array');}
  assert.equal(ownData(remote,'objectId'),undefined,'By-value canvas state required');assert.equal(ownData(remote,'unserializableValue'),undefined);
  const wire=denseArray(ownData(remote,'value',true),15);assert.equal(ownData(wire,'0',true),'zk682-canvas-state-tags-v1');
  const fields=['current','connected','visible','tag','x','y','width','height','viewportWidth','viewportHeight','intrinsicWidth','intrinsicHeight','dpr','zoom'],state={};
  for(let index=0;index<fields.length;index++){
    const item=ownData(wire,String(index+1),true);assert.ok(Array.isArray(item),'Canvas scalar tag required');const tag=ownData(item,'0',true);let value;
    if(index<3||index===3){denseArray(item,2);assert.equal(tag,index<3?'b':'s');value=ownData(item,'1',true);assert.equal(typeof value,index<3?'boolean':'string');}
    else if(tag==='n'){denseArray(item,2);value=ownData(item,'1',true);assert.ok(typeof value==='number'&&Number.isFinite(value)&&!Object.is(value,-0),'Finite nonnegative-zero numeric wire required');}
    else {denseArray(item,1);assert.ok(['z','nan','pinf','ninf'].includes(tag),'Unknown canvas numeric tag');value=tag==='z'?-0:tag==='nan'?NaN:tag==='pinf'?Infinity:-Infinity;}
    state[fields[index]]=value;
  }
  return state;
}
function evaluationError(details){
  const exception=ownData(details,'exception');
  if(exception)return new Error(ownData(exception,'description')||String(ownData(exception,'value')));
  let message=ownData(details,'text',true);assert.equal(typeof message,'string');const stack=ownData(details,'stackTrace');
  if(stack)for(const frame of ownData(stack,'callFrames',true))message+='\n    at '+(ownData(frame,'functionName')||'<anonymous>')+' ('+ownData(frame,'url',true)+':'+ownData(frame,'lineNumber',true)+':'+ownData(frame,'columnNumber',true)+')';
  return new Error(message);
}
export async function capturePublicCDPCanvas(page,{canvasClip,timing={now:()=>performance.now(),set:setTimeout,clear:clearTimeout}}){
  assert.equal(typeof canvasClip,'function','pinned baseline canvasClip required');const started=timing.now(),deadline=started+CAPTURE_MS,timeoutError=new Error('Public CDP capture deadline10000ms exceeded');
  let expired=false,closed=false,session,sessionPending,failed=false,primary,result,selected,rootFrame,invalidated=false,invalidation,stopping=false,detaching=false,foreignClosed=false,cleanupPromise;
  const pending=new Set(),objectIds=new Set(),contexts=new Map(),listeners=[];
  const fail=error=>{if(!failed){failed=true;primary=error;observer.primary(error);}};
  let rejectDeadline,rejectInvalid,resolveReady;const timeout=new Promise((_,reject)=>{rejectDeadline=reject;});timeout.catch(()=>{});
  const invalid=new Promise((_,reject)=>{rejectInvalid=reject;});invalid.catch(()=>{});
  const ready=new Promise(resolve=>{resolveReady=resolve;});
  const timer=timing.set(()=>{expired=true;observer.timer();rejectDeadline(timeoutError);},CAPTURE_MS);
  const invalidate=error=>{if(!invalidated){invalidated=true;invalidation=error;observer.invalidation(error);rejectInvalid(error);}};
  const guard=()=>{if(expired||timing.now()>=deadline){expired=true;observer.guard('helper-guard');throw timeoutError;}if(invalidated)throw invalidation;};
  const within=async promise=>{observer.site('within-before');guard();const value=await Promise.race([Promise.resolve(promise),timeout,invalid]);observer.site('within-after');guard();return value;};
  const register=response=>{
    let rejected=false,first;const inspect=action=>{try{action();}catch(error){if(!rejected){rejected=true;first=error;}}};
    const collect=remote=>{if(remote===undefined)return;const id=ownData(remote,'objectId');if(id!==undefined){assert.ok(typeof id==='string'&&id.length>0,'Exact remote objectId required');objectIds.add(id);observer.owned(objectIds.size);}};
    // Independent inspections own every safely exposed ID before the first malformed field is rejected.
    inspect(()=>collect(ownData(response,'result')));
    inspect(()=>{const details=ownData(response,'exceptionDetails');if(details!==undefined)collect(ownData(details,'exception'));});
    if(rejected)throw first;return response;
  };
  const invoke=(method,args)=>{
    observer.site('invoke-before');guard();assert.ok(!stopping&&session&&!foreignClosed,'Live owned public session required');
    const observedPhase=observer.start();let transportFulfilled=false;
    let original;try{original=session.send(method,args);}catch(error){observer.caught(error,observedPhase);original=Promise.reject(error);}
    const tracked=Promise.resolve(original).then(response=>{transportFulfilled=true;observer.fulfilled(observedPhase);return register(response);});pending.add(tracked);observer.pending(pending.size);tracked.then(()=>{pending.delete(tracked);observer.finished(observedPhase);observer.pending(pending.size);},error=>{pending.delete(tracked);observer.finished(observedPhase,true,transportFulfilled);observer.caught(error,observedPhase);observer.pending(pending.size);});return tracked;
  };
  const checkEvaluation=response=>{const details=ownData(response,'exceptionDetails');if(details!==undefined)throw evaluationError(details);return response;};
  const onCreated=event=>{try{
    const context=ownData(event,'context',true),id=ownData(context,'id',true),unique=ownData(context,'uniqueId',true),aux=ownData(context,'auxData');
    assert.ok(Number.isInteger(id)&&id>0&&typeof unique==='string'&&unique.length>0,'Observed unique execution context required');
    if(!aux)return;const isDefault=ownData(aux,'isDefault');if(isDefault!==undefined)assert.equal(typeof isDefault,'boolean','Default-world boolean required');
    if(!isDefault)return;const frame=ownData(aux,'frameId',true);assert.equal(typeof frame,'string');if(frame!==rootFrame)return;
    assert.ok(!contexts.has(unique),'Reused execution context refused');contexts.set(unique,{id,unique});
    assert.equal(contexts.size,1,'Exactly one root main execution context required');
    if(selected&&selected.unique!==unique)throw new Error('Owned main execution context replaced');observer.validated('CONTEXT_READY');resolveReady();observer.fulfilled('CONTEXT_READY');
  }catch(error){invalidate(error);}};
  const onDestroyed=event=>{try{const unique=ownData(event,'executionContextUniqueId',true),id=ownData(event,'executionContextId',true);assert.ok(typeof unique==='string'&&unique.length>0&&Number.isInteger(id),'Exact destroyed execution context required');const context=contexts.get(unique);if(context){assert.equal(context.id,id,'Destroyed context binding mismatch');contexts.delete(unique);throw new Error('Owned main execution context destroyed');}}catch(error){invalidate(error);}};
  const onCleared=()=>invalidate(new Error('Owned execution contexts cleared'));
  // A close during our detach is provisional until detach succeeds; the public event has no origin tag.
  const onClose=()=>{observer.close(detaching);if(!detaching){foreignClosed=true;invalidate(new Error('Owned public CDP session closed externally'));}};
  const cleanup=()=>{if(!cleanupPromise){stopping=true;observer.cleanup(true);observer.phase('CLEANUP_BARRIER');cleanupPromise=(async()=>{
    if(sessionPending)await Promise.allSettled([sessionPending]);
    while(pending.size)await Promise.allSettled([...pending]);
    if(session&&!foreignClosed){
      for(const objectId of objectIds){if(foreignClosed)break;observer.phase('RELEASE');observer.start('RELEASE');let releaseFulfilled=false;try{const response=await session.send('Runtime.releaseObject',{objectId});releaseFulfilled=true;observer.fulfilled('RELEASE');register(response);assert.equal(Reflect.ownKeys(response).length,0,'Release response must be empty');observer.validated('RELEASE');observer.finished('RELEASE');}catch(error){observer.finished('RELEASE',true,releaseFulfilled);observer.caught(error,'RELEASE');observer.releaseFailure();fail(error);}}
      if(!foreignClosed){detaching=true;observer.phase('DETACH');observer.start('DETACH');try{await session.detach();observer.fulfilled('DETACH');observer.finished('DETACH');}catch(error){observer.finished('DETACH',true);observer.caught(error,'DETACH');fail(error);}finally{detaching=false;}}
    }
  })().catch(fail).finally(()=>{for(const [name,listener]of listeners)try{session.off(name,listener);}catch(error){fail(error);}observer.cleanup(false);});}return cleanupPromise;};
  try{
    observer.phase('SESSION');observer.start('SESSION');sessionPending=Promise.resolve(page.context().newCDPSession(page)).then(value=>{session=value;observer.fulfilled('SESSION');observer.finished('SESSION');return value;});
    session=await within(sessionPending);assert.ok(session,'Attached public CDP session required');
    for(const [name,listener]of [['Runtime.executionContextCreated',onCreated],['Runtime.executionContextDestroyed',onDestroyed],['Runtime.executionContextsCleared',onCleared],['close',onClose]]){session.on(name,listener);listeners.push([name,listener]);}
    observer.phase('FRAME_TREE');const tree=await within(invoke('Page.getFrameTree',{})),frame=ownData(ownData(tree,'frameTree',true),'frame',true);rootFrame=ownData(frame,'id',true);assert.ok(typeof rootFrame==='string'&&rootFrame.length>0,'Root frame required');assert.equal(Object.getOwnPropertyDescriptor(frame,'parentId'),undefined,'Root frame parentId must be absent');
    observer.validated('FRAME_TREE');observer.phase('RUNTIME_ENABLE');const enabled=await within(invoke('Runtime.enable',{}));assert.equal(Reflect.ownKeys(enabled).length,0,'Runtime.enable response must be empty');observer.validated('RUNTIME_ENABLE');if(!contexts.size){observer.phase('CONTEXT_READY');observer.start('CONTEXT_READY');await within(ready);observer.finished('CONTEXT_READY');}observer.site('context-ready');guard();assert.equal(contexts.size,1);selected=[...contexts.values()][0];
    observer.phase('ACQUIRE_A');const acquired=checkEvaluation(await within(invoke('Runtime.evaluate',{expression:'('+acquireCanvasEnvelope.toString()+')()',uniqueContextId:selected.unique,returnByValue:false,generatePreview:false,awaitPromise:true,userGesture:true}))),remote=ownData(acquired,'result',true);
    assert.equal(ownData(remote,'type',true),'object','Attached raw canvas envelope required');assert.equal(ownData(remote,'subtype'),undefined,'Private ordinary canvas envelope required');const envelopeId=ownData(remote,'objectId',true);assert.ok(typeof envelopeId==='string'&&envelopeId.length>0,'Exact owned envelope objectId required');
    observer.validated('ACQUIRE_A');const stateArgs={objectId:envelopeId,functionDeclaration:taggedOwnedCanvas.toString(),arguments:[],returnByValue:true,generatePreview:false,awaitPromise:true,userGesture:true};
    observer.phase('BEFORE_B');const before=decodeCanvasState(checkEvaluation(await within(invoke('Runtime.callFunctionOn',stateArgs)))),clip=canvasClip(before);observer.validated('BEFORE_B');
    observer.phase('SCREENSHOT');const response=await within(invoke('Page.captureScreenshot',{format:'png',clip:{...clip,scale:1},fromSurface:true,captureBeyondViewport:false,optimizeForSpeed:false}));
    observer.phase('PNG_VALIDATE');const png=strictBase64(ownData(response,'data',true)),decoded=decodeStrictPng(png,clip);observer.validated('PNG_VALIDATE');observer.site('png-after');guard();observer.phase('AFTER_D');const after=decodeCanvasState(checkEvaluation(await within(invoke('Runtime.callFunctionOn',stateArgs))));canvasClip(after);assert.deepEqual(after,before,'canvas identity/current connection/geometry changed');observer.validated('AFTER_D');
    result={png,receipt:{method:'public-cdp-page-captureScreenshot-canvas-viewport-clip-v1',clip,before,after,bytes:png.length,sha256:sha256(png),pixelSHA256:decoded.pixelSHA256,qualification:'Diagnostic public CDP comparison only; both APIs may share Chromium backend; no canonical receipt enum or causal claim'}};
  }catch(error){observer.caught(error);fail(error);}
  // Cleanup can finish after a failed deadline, but cannot accept a result or publish bytes.
  const disposal=cleanup();observer.phase('CLEANUP_WAIT');try{await within(disposal);}catch(error){observer.caught(error);fail(error);}
  closed=true;timing.clear(timer);if(failed)throw primary;observer.phase('HELPER_FINAL');observer.site('helper-final');guard();result.receipt.elapsedMs=timing.now()-started;result.receipt.deadlineHostMs=deadline;
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
  const captured=await capturePublicCDPCanvas(page,{canvasClip,timing}),deadline=captured.receipt.deadlineHostMs,temporary=resolve(outputPath)+'.cdp-pending-'+randomUUID();
  const timeout=new Error('Canonical public CDP total capture/publication deadline10000ms exceeded');const guard=()=>{if(timing.now()>=deadline){observer.guard('publication-guard');throw timeout;}};
  let descriptor,owned,promoted=false,failed=false,primary;
  const removeOwned=path=>{if(!owned)return;const current=io.lstatSync(path,{throwIfNoEntry:false});if(current&&current.dev===owned.dev&&current.ino===owned.ino&&!current.isSymbolicLink())io.unlinkSync(path);};
  try{
    observer.phase('PUB_OPEN');guard();descriptor=io.openSync(temporary,'wx',0o600);owned=io.fstatSync(descriptor);observer.validated();observer.phase('PUB_WRITE');guard();io.writeFileSync(descriptor,captured.png);observer.validated();observer.phase('PUB_FSYNC');guard();io.fsyncSync(descriptor);observer.validated();observer.phase('PUB_CLOSE');guard();io.closeSync(descriptor);descriptor=undefined;observer.validated();guard();
    // Exclusive hard-link publication is atomic and refuses every existing final path.
    observer.phase('PUB_STAGE');const staged=io.lstatSync(temporary);assert.ok(staged.isFile()&&!staged.isSymbolicLink()&&staged.dev===owned.dev&&staged.ino===owned.ino,'staged PNG ownership changed');
    observer.phase('PUB_LINK');io.linkSync(temporary,outputPath);promoted=true;observer.validated();guard();observer.phase('PUB_FINAL');const final=io.lstatSync(outputPath);assert.ok(final.isFile()&&!final.isSymbolicLink()&&final.dev===owned.dev&&final.ino===owned.ino,'published PNG ownership changed');observer.phase('PUB_REMOVE');removeOwned(temporary);observer.validated();guard();
  }catch(error){failed=true;primary=error;observer.primary(error);observer.caught(error);}
  if(descriptor!==undefined)try{io.closeSync(descriptor);}catch(error){if(!failed){failed=true;primary=error;observer.primary(error);}}
  if(failed){for(const path of promoted?[outputPath,temporary]:[temporary])try{removeOwned(path);}catch{}throw primary;}
  const receipt={method:PUBLIC_CDP_CAPTURE_METHOD,clip:captured.receipt.clip,before:captured.receipt.before,after:captured.receipt.after,bytes:captured.receipt.bytes,sha256:captured.receipt.sha256,qualification:'Current unique visible DPR1 canvas, pre/post geometry and bounded CRC/pixels verified. Node synchronous filesystem calls cannot be preempted: elapsed deadline checked before/after exclusive publication; failure attempts inode-owned rollback and never returns an accepted receipt. Cleanup failure can leave unaccepted bytes; root completeness and visual QA remain required.'};
  // Returning the strict receipt is the acceptance boundary for the unchanged caller.
  observer.phase('PUB_FINAL_GUARD');try{guard();}catch(error){observer.caught(error);try{removeOwned(outputPath);}catch{}throw error;}return receipt;
}
