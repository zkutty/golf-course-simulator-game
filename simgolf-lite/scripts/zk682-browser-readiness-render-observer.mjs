// Diagnostic browser-only recorder. This function is serialized into the existing initScript.
// No GL query/readback, renderer additions, public protocol call or host timer is introduced.
export function installBrowserReadinessRenderObserver(options) {
  'use strict';
  options = options ?? {};
  try {
  const KEY = '__zk682ReadinessRender66', METHODS = ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'];
  const ROWS = ['installed','attached','visible','nonzero','nonzero-predicate','draw-invoked','draw-returned','canvas-duplicate','canvas-replaced','canvas-disconnected','first-rAF-after-draw','snapshot'];
  const LIMITS = {callbacks:512,rows:12,longtasks:256,contexts:8,draws:1000000,snapshotBytes:65536};
  if (options.enabled === false || Object.getOwnPropertyDescriptor(window, KEY)) return null;
  const targetCommit=options.targetCommit,driverCommit=options.driverCommit;
  let stopped=false,busy=false,incomplete=false,errorPresent=false,errorKind=null,stopReason=null,frozen=null;
  let origin=null,timeOrigin=null,last=0,callbacks=0,raf=null,mutation=null,tasks=null,current=null,nextCanvas=1,nextContext=1;
  let routeEligible=false,gl2Supported=false,longtaskSupported=false,foreignDraws=0,canvasGetter=null;
  const records=[],longtasks=[],contexts=[],owners=[],seen=new Set(),canvasIds=new WeakMap(),contextIds=new WeakMap();
  const flags={duplicate:false,replaced:false,disconnected:false,unsupportedVisibility:false,opaqueDrawArguments:false};
  const error = value => {incomplete=true;if(!errorPresent){errorPresent=true;errorKind=value===null?'null':typeof value;}};
  const sameDescriptor=(a,b)=>a&&b&&a.value===b.value&&a.writable===b.writable&&a.enumerable===b.enumerable&&a.configurable===b.configurable;
  const stop = reason => {
    if(stopped)return;stopped=true;stopReason=reason;
    for(const object of [mutation,tasks])try{object?.disconnect();}catch(value){error(value);}
    try{if(raf!==null)cancelAnimationFrame(raf);}catch(value){error(value);}
    try{window.removeEventListener('pagehide',pagehide);}catch(value){error(value);}
    for(const owner of owners)try{if(sameDescriptor(Object.getOwnPropertyDescriptor(owner.prototype,owner.method),owner.installed))Object.defineProperty(owner.prototype,owner.method,owner.original);}catch(value){error(value);}
    current=null;canvasGetter=null;owners.length=0;
  };
  const protect = fn => {
    if(stopped)return;
    if(busy){error('reentrant-observer');stop('observer-error');return;}
    busy=true;try{fn();}catch(value){error(value);stop('observer-error');}finally{busy=false;}
  };
  const now=()=>{const value=performance.now();if(!Number.isFinite(value)||origin===null||value<last)throw new Error('browser clock');last=value;return value;};
  const row=(name,canvasId=null,contextId=null)=>{if(seen.has(name))return;if(!ROWS.includes(name)||records.length>=LIMITS.rows){incomplete=true;stop('row-cap');return;}const timeMs=now();seen.add(name);records.push({name,timeMs,canvasId,contextId});};
  const idForCanvas=node=>{if(!canvasIds.has(node))canvasIds.set(node,nextCanvas++);return canvasIds.get(node);};
  // Equivalent to installed Playwright1.61.1 Chromium computeBox/isElementVisible.
  // Bounded traversal marks unsupported coverage rather than substituting opacity/capture rules.
  const visible = node => {
    let visited=0;
    const walk=element=>{
      if(++visited>128){flags.unsupportedVisibility=true;incomplete=true;throw new Error('visibility traversal cap');}
      const style=window.getComputedStyle(element);if(!style)return true;
      if(style.display==='contents'){
        for(let child=element.firstChild;child;child=child.nextSibling){
          if(child.nodeType===1&&walk(child))return true;
          if(child.nodeType===3){const range=child.ownerDocument.createRange();range.selectNode(child);const rect=range.getBoundingClientRect();if(rect.width>0&&rect.height>0)return true;}
        }
        return false;
      }
      if(typeof Element!=='undefined'&&Element.prototype.checkVisibility){if(!element.checkVisibility())return false;}
      else{const details=element.closest('details,summary');if(details!==element&&details?.nodeName==='DETAILS'&&!details.open)return false;}
      if(style.visibility!=='visible')return false;
      const rect=element.getBoundingClientRect();return rect.width>0&&rect.height>0;
    };
    return walk(node);
  };
  const course = () => {
    const matches=document.querySelectorAll('.cc-pixi-stage canvas');
    if(matches.length>1){flags.duplicate=true;incomplete=true;row('canvas-duplicate');return null;}
    if(matches.length!==1||!matches[0].isConnected){if(current){flags.disconnected=true;incomplete=true;row('canvas-disconnected',idForCanvas(current));}return null;}
    const node=matches[0];if(node.ownerDocument!==document||!(node instanceof HTMLCanvasElement)){incomplete=true;throw new Error('course canvas identity');}
    if(current&&node!==current){flags.replaced=true;incomplete=true;row('canvas-replaced',idForCanvas(node));}
    current=node;return node;
  };
  const sample = () => {
    if(!routeEligible)return;
    const node=course();if(!node)return;const id=idForCanvas(node);row('attached',id);
    if(visible(node))row('visible',id);
    if((node.width||node.clientWidth)>0&&(node.height||node.clientHeight)>0)row('nonzero',id);
  };
  const callback = fn => {protect(()=>{if(callbacks>=LIMITS.callbacks){incomplete=true;stop('callback-cap');return;}callbacks++;fn();if(callbacks>=LIMITS.callbacks){incomplete=true;stop('callback-cap');}});};
  const frame=()=>{raf=null;callback(()=>{sample();if(seen.has('draw-returned')){const node=course();if(node)row('first-rAF-after-draw',idForCanvas(node));}});if(!stopped&&!['visible','nonzero-predicate','first-rAF-after-draw'].every(name=>seen.has(name)))try{raf=requestAnimationFrame(frame);}catch(value){error(value);stop('observer-error');}};
  const contextRow=(receiver,method,kind,value,args)=>{
    if(!routeEligible)return;
    const node=course();if(!node||!canvasGetter||Reflect.apply(canvasGetter,receiver,[])!==node){if(foreignDraws>=LIMITS.draws){incomplete=true;stop('draw-cap');}else foreignDraws++;return;}
    let record=contextIds.get(receiver);
    if(!record){if(contexts.length>=LIMITS.contexts){incomplete=true;stop('context-cap');return;}record={contextId:nextContext++,canvasId:idForCanvas(node),methods:METHODS.map(name=>({name,invocations:0,returns:0,throws:0,positiveCountInvocations:0,positiveCountReturns:0,opaqueCountInvocations:0,firstThrownPresent:false,firstThrownKind:null}))};contextIds.set(receiver,record);contexts.push(record);}
    const count=record.methods.find(x=>x.name===method);const field=kind==='invoke'?'invocations':kind==='return'?'returns':'throws';
    if(count[field]>=LIMITS.draws){incomplete=true;stop('draw-cap');return;}count[field]++;
    const inputs=method==='drawArrays'?[args[2]]:method==='drawElements'?[args[1]]:method==='drawArraysInstanced'?[args[2],args[3]]:[args[1],args[4]];
    const opaque=inputs.some(x=>typeof x!=='number'||!Number.isFinite(x));
    const positive=!opaque&&inputs.every(x=>Number.isSafeInteger(x)&&x>0&&x<=2147483647);
    if(kind==='invoke'&&opaque){count.opaqueCountInvocations++;flags.opaqueDrawArguments=true;incomplete=true;}
    if(kind==='invoke'&&positive)count.positiveCountInvocations++;
    if(kind==='return'&&positive)count.positiveCountReturns++;
    if(kind==='throw'&&!count.firstThrownPresent){count.firstThrownPresent=true;count.firstThrownKind=value===null?'null':typeof value;}
    if(kind==='invoke'&&positive)row('draw-invoked',record.canvasId,record.contextId);else if(kind==='return'&&positive)row('draw-returned',record.canvasId,record.contextId);
  };
  function pagehide(){incomplete=true;stop('navigation');}
  const snapshot = () => {
    if(frozen)return frozen;
    protect(()=>{sample();row('snapshot');});stop('snapshot');
    try{
      const data={version:1,unit:'browser-readiness-draw-longtask-v1',targetCommit:targetCommit,driverCommit:driverCommit,clockDomain:'browser-document-performance',timeOriginMs:timeOrigin,originMs:origin,routeEligible,limits:{...LIMITS},callbacks,records:records.map(x=>({...x})),longtasks:longtasks.map(x=>({...x})),contexts:contexts.map(x=>({...x,methods:x.methods.map(y=>({...y}))})),foreignDraws,flags:{...flags},gl2Supported,longtaskSupported,observerIncomplete:incomplete||!gl2Supported||!longtaskSupported||!routeEligible,observerErrorPresent:errorPresent,observerErrorKind:errorKind,stopReason,qualification:'Draw invocation/normal return and primitive positive-count arguments only; opaque arguments unsupported; silent GL validation, GPU submission, framebuffer/offscreen/fullcourse/presentation UNKNOWN. Observer perturbs timing; no host/browser crossclock or exclusive longtask attribution.'};
      const text=JSON.stringify(data);if(new TextEncoder().encode(text).length>LIMITS.snapshotBytes)return null;
      const deepFreeze=value=>{if(value&&typeof value==='object'){for(const x of Object.values(value))deepFreeze(x);Object.freeze(value);}return value;};
      frozen=deepFreeze(data);return frozen;
    }catch{return null;}
  };
  const api=Object.freeze({kind:'zk682-readiness-render-owned-v1',targetCommit:targetCommit,driverCommit:driverCommit,markNonzero(value){if(value)protect(()=>{sample();const node=course();if(node)row('nonzero-predicate',idForCanvas(node));});return value;},snapshot});
  try{
    if(!/^[0-9a-f]{40}$/.test(targetCommit)||!/^[0-9a-f]{40}$/.test(driverCommit))throw new Error('diagnostic source roles');
    origin=performance.now();timeOrigin=performance.timeOrigin;if(!Number.isFinite(origin)||origin<0||!Number.isFinite(timeOrigin)||timeOrigin<0)throw new Error('document clock');last=origin;
    const route=new URL(location.href);routeEligible=route.searchParams.get('m27Fixture')==='1'&&route.searchParams.get('perfTheme')==='parkland';
    Object.defineProperty(window,KEY,{value:api,writable:false,configurable:false,enumerable:false});row('installed');if(!routeEligible){incomplete=true;stop('route-ineligible');return api;}
    gl2Supported=typeof WebGL2RenderingContext==='function';
    if(gl2Supported){let prototype=WebGL2RenderingContext.prototype;for(let depth=0;prototype&&depth<8;depth++,prototype=Object.getPrototypeOf(prototype)){const descriptor=Object.getOwnPropertyDescriptor(prototype,'canvas');if(descriptor){canvasGetter=typeof descriptor.get==='function'?descriptor.get:null;break;}}if(!canvasGetter){gl2Supported=false;incomplete=true;}}
    if(gl2Supported)for(const method of METHODS){
      const prototype=WebGL2RenderingContext.prototype,original=Object.getOwnPropertyDescriptor(prototype,method);
      if(!original||typeof original.value!=='function'||(!original.configurable&&!original.writable)){gl2Supported=false;incomplete=true;break;}
      const callable=original.value;
      const wrapper=function(...args){protect(()=>contextRow(this,method,'invoke',undefined,args));let result;try{result=Reflect.apply(callable,this,args);}catch(value){protect(()=>contextRow(this,method,'throw',value,args));throw value;}protect(()=>contextRow(this,method,'return',undefined,args));return result;};
      const installed={...original,value:wrapper};Object.defineProperty(prototype,method,installed);owners.push({prototype,method,original,installed});
    }
    longtaskSupported=typeof PerformanceObserver==='function'&&Array.isArray(PerformanceObserver.supportedEntryTypes)&&PerformanceObserver.supportedEntryTypes.includes('longtask');
    if(longtaskSupported){tasks=new PerformanceObserver(list=>protect(()=>{for(const item of list.getEntries()){if(longtasks.length>=LIMITS.longtasks){incomplete=true;stop('longtask-cap');break;}const startTimeMs=item.startTime,durationMs=item.duration;if(!Number.isFinite(startTimeMs)||startTimeMs<0||!Number.isFinite(durationMs)||durationMs<0)throw new Error('longtask clock');longtasks.push({startTimeMs,durationMs});}}));tasks.observe({type:'longtask',buffered:true});}
    else incomplete=true;
    if(typeof MutationObserver!=='function'||typeof requestAnimationFrame!=='function'||typeof cancelAnimationFrame!=='function')throw new Error('sampling unsupported');
    mutation=new MutationObserver(()=>callback(sample));mutation.observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','width','height','hidden']});
    window.addEventListener('pagehide',pagehide);protect(sample);if(!stopped)raf=requestAnimationFrame(frame);if(!gl2Supported||!longtaskSupported){incomplete=true;stop('unsupported-capability');}
  }catch(value){error(value);stop('observer-error');}
  return api;
  } catch { return null; }
}
