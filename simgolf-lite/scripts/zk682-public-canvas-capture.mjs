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
  assert.equal(typeof canvasClip,'function','pinned baseline canvasClip required');const started=timing.now(),deadline=started+CAPTURE_MS,timeoutError=new Error('Public CDP capture deadline10000ms exceeded');let expired=false,closed=false,session,handle,rawHandle,failed=false,primary,result;
  const cleanupTasks=new Map();
  const cleanup=(object,method)=>{if(!object)return Promise.resolve();if(!cleanupTasks.has(object)){const task=Promise.resolve().then(()=>object[method]());task.catch(()=>{});cleanupTasks.set(object,task);}return cleanupTasks.get(object);};
  let rejectDeadline;const timeout=new Promise((_,reject)=>{rejectDeadline=reject;});timeout.catch(()=>{});const timer=timing.set(()=>{expired=true;rejectDeadline(timeoutError);},CAPTURE_MS);
  const guard=()=>{if(expired||timing.now()>=deadline){expired=true;throw timeoutError;}};
  const within=async promise=>{guard();const value=await Promise.race([Promise.resolve(promise),timeout]);guard();return value;};
  const owned=async(promise,method)=>{const pending=Promise.resolve(promise);pending.then(object=>{if(expired||closed||timing.now()>=deadline)cleanup(object,method);},()=>{});return within(pending);};
  try{
    assert.equal(await within(page.locator('.cc-pixi-stage canvas').count()),1,'exactly one canvas');rawHandle=await owned(page.evaluateHandle(() => {
      const matches=document.querySelectorAll('.cc-pixi-stage canvas');
      if(matches.length!==1)throw new Error('Exactly one current document canvas required');
      const node=matches[0];
      if(!(node instanceof HTMLCanvasElement)||node.ownerDocument!==document||!node.isConnected)throw new Error('Current document connected HTMLCanvasElement required');
      return node;
    }),'dispose');assert.ok(rawHandle,'attached raw canvas handle required');handle=rawHandle.asElement();assert.ok(handle,'attached canvas element required');guard();const before=await within(handle.evaluate(readCanvas)),clip=canvasClip(before);
    session=await owned(page.context().newCDPSession(page),'detach');const response=await within(session.send('Page.captureScreenshot',{format:'png',clip:{...clip,scale:1},fromSurface:true,captureBeyondViewport:false,optimizeForSpeed:false}));
    const png=strictBase64(response?.data),decoded=decodeStrictPng(png,clip);guard();const after=await within(handle.evaluate(readCanvas));canvasClip(after);assert.deepEqual(after,before,'canvas identity/current connection/geometry changed');
    result={png,receipt:{method:'public-cdp-page-captureScreenshot-canvas-viewport-clip-v1',clip,before,after,bytes:png.length,sha256:sha256(png),pixelSHA256:decoded.pixelSHA256,qualification:'Diagnostic public CDP comparison only; both APIs may share Chromium backend; no canonical receipt enum or causal claim'}};
  }catch(error){failed=true;primary=error;}
  // Start both disposals even if one fails or the capture deadline has elapsed.
  const disposal=[cleanup(session,'detach'),cleanup(rawHandle,'dispose')];
  try{const outcomes=await within(Promise.allSettled(disposal));for(const outcome of outcomes)if(outcome.status==='rejected'&&!failed){failed=true;primary=outcome.reason;}}catch(error){if(!failed){failed=true;primary=error;}}
  closed=true;timing.clear(timer);if(failed)throw primary;guard();result.receipt.elapsedMs=timing.now()-started;result.receipt.deadlineHostMs=deadline;
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
  const captured=await capturePublicCDPCanvas(page,{canvasClip,timing}),deadline=captured.receipt.deadlineHostMs,temporary=resolve(outputPath)+'.cdp-pending-'+randomUUID();
  const timeout=new Error('Canonical public CDP total capture/publication deadline10000ms exceeded');const guard=()=>{if(timing.now()>=deadline)throw timeout;};
  let descriptor,owned,promoted=false,failed=false,primary;
  const removeOwned=path=>{if(!owned)return;const current=io.lstatSync(path,{throwIfNoEntry:false});if(current&&current.dev===owned.dev&&current.ino===owned.ino&&!current.isSymbolicLink())io.unlinkSync(path);};
  try{
    guard();descriptor=io.openSync(temporary,'wx',0o600);owned=io.fstatSync(descriptor);guard();io.writeFileSync(descriptor,captured.png);guard();io.fsyncSync(descriptor);guard();io.closeSync(descriptor);descriptor=undefined;guard();
    // Exclusive hard-link publication is atomic and refuses every existing final path.
    const staged=io.lstatSync(temporary);assert.ok(staged.isFile()&&!staged.isSymbolicLink()&&staged.dev===owned.dev&&staged.ino===owned.ino,'staged PNG ownership changed');
    io.linkSync(temporary,outputPath);promoted=true;guard();const final=io.lstatSync(outputPath);assert.ok(final.isFile()&&!final.isSymbolicLink()&&final.dev===owned.dev&&final.ino===owned.ino,'published PNG ownership changed');removeOwned(temporary);guard();
  }catch(error){failed=true;primary=error;}
  if(descriptor!==undefined)try{io.closeSync(descriptor);}catch(error){if(!failed){failed=true;primary=error;}}
  if(failed){for(const path of promoted?[outputPath,temporary]:[temporary])try{removeOwned(path);}catch{}throw primary;}
  const receipt={method:PUBLIC_CDP_CAPTURE_METHOD,clip:captured.receipt.clip,before:captured.receipt.before,after:captured.receipt.after,bytes:captured.receipt.bytes,sha256:captured.receipt.sha256,qualification:'Current unique visible DPR1 canvas, pre/post geometry and bounded CRC/pixels verified. Node synchronous filesystem calls cannot be preempted: elapsed deadline checked before/after exclusive publication; failure attempts inode-owned rollback and never returns an accepted receipt. Cleanup failure can leave unaccepted bytes; root completeness and visual QA remain required.'};
  // Returning the strict receipt is the acceptance boundary for the unchanged caller.
  try{guard();}catch(error){try{removeOwned(outputPath);}catch{}throw error;}return receipt;
}
