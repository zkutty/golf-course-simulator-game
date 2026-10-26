/** Offline-only additive authoring. Never imports/writes runtime or legacy atlases. */
import { PNG } from 'pngjs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { drawGolfer, poseFor, skeletonFor, bodyAngle, project, MODEL, MODEL_VERSION, DIRECTIONS } from './lib/natural-golfer-model.mjs';
export const NATIVE = Object.freeze({ logicalWidth:72,logicalHeight:96,feet:[36,83],sourceOrigin:[-12,-14],rasterScale:1,referenceWidth:48,referenceHeight:72,referenceFeet:[24,69],referenceDisplayWidth:26,nativeDisplaySizeAt100:[39,52] });
export const CLIPS = Object.freeze({
  walk:{action:'walk',samples:[0,1/36,2/36,3/36,4/36,5/36],contact:null,semantics:'facing'},
  idle:{action:'idle',samples:[0,.5],contact:null,semantics:'facing'},
  swing:{action:'swing',samples:[0,.12,.28,.42,.54,.63,.85,1],contact:5,semantics:'target'},
  putt:{action:'putt',samples:[0,.25,.5,.75],contact:2,semantics:'target'},
  positive:{action:'react',outcome:'pleased',samples:[0,1/3,2/3,1],contact:null,semantics:'facing'},
  negative:{action:'react',outcome:'sigh',samples:[0,1/3,2/3,1],contact:null,semantics:'facing'},
});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const here=dirname(fileURLToPath(import.meta.url)),projectRoot=resolve(here,'..');
export async function loadRasterizer(modulePath){
  const require=createRequire(import.meta.url);
  const packagePath=modulePath?resolve(dirname(modulePath),'package.json'):require.resolve('@napi-rs/canvas/package.json');
  const metadata=JSON.parse(await readFile(packagePath,'utf8'));
  if(metadata.name!=='@napi-rs/canvas'||metadata.version!=='0.1.100')throw new Error('Use pinned @napi-rs/canvas@0.1.100');
  const pngMetadata=require('pngjs/package.json');if(pngMetadata.version!=='7.0.0')throw new Error('Use locked pngjs@7.0.0');
  return import(modulePath?pathToFileURL(resolve(modulePath)).href:'@napi-rs/canvas');
}
export function cropRGBA(data,width,height){let minX=width,minY=height,maxX=-1,maxY=-1;for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}if(maxX<0)return{x:0,y:0,w:1,h:1,data:new Uint8ClampedArray(4),empty:true};const w=maxX-minX+1,h=maxY-minY+1,out=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)out.set(data.subarray(((y+minY)*width+minX)*4,((y+minY)*width+minX+w)*4),y*w*4);return{x:minX,y:minY,w,h,data:out,empty:false};}
export function splitVisibleLayers(baseColor,tintColor,ownership){const base=new Uint8ClampedArray(baseColor.length),tint=new Uint8ClampedArray(baseColor.length);for(let i=0;i<base.length;i+=4){const a=ownership[i+3]/255;if(!a)continue;const t=ownership[i]/255*a,b=Math.max(0,a-t);tint[i+3]=Math.round(t*255);base[i+3]=Math.round((t<1?b/(1-t):0)*255);for(let c=0;c<3;c++){base[i+c]=b>0?Math.min(255,Math.round(baseColor[i+c]*a/b)):0;tint[i+c]=t>0?Math.min(255,Math.round(tintColor[i+c]*a/t)):0;}if(!base[i+3])base.fill(0,i,i+4);if(!tint[i+3])tint.fill(0,i,i+4);}return{base,tint};}
const transparentEdge=(data,w,h)=>{for(let x=0;x<w;x++)if(data[x*4+3]||data[((h-1)*w+x)*4+3])return false;for(let y=0;y<h;y++)if(data[(y*w)*4+3]||data[(y*w+w-1)*4+3])return false;return true;};
function pack(items){const width=1024,pad=2;let x=pad,y=pad,rowH=0;for(const item of items){if(x+item.crop.w+pad>width){x=pad;y+=rowH+pad;rowH=0;}item.rect={x,y,w:item.crop.w,h:item.crop.h};x+=item.crop.w+pad;rowH=Math.max(rowH,item.crop.h);}return{width,height:Math.ceil((y+rowH+pad)/4)*4};}
function putPixels(ctx,data,w,h,x=0,y=0){const image=ctx.createImageData(w,h);image.data.set(data);ctx.putImageData(image,x,y);}
function compositeBytes(base,tint,color=[0x39,0x7e,0x82]){const out=new Uint8ClampedArray(base.length);for(let i=0;i<out.length;i+=4){const b=base[i+3]/255,t=tint[i+3]/255,a=t+b*(1-t);if(!a)continue;out[i+3]=Math.round(a*255);for(let c=0;c<3;c++)out[i+c]=Math.round((tint[i+c]*color[c]/255*t+base[i+c]*b*(1-t))/a);}return out;}
export async function generateNaturalGolfer({canvasModule,outDir=resolve(projectRoot,'art/natural-golfer-v1')}={}){
  const {createCanvas}=await loadRasterizer(canvasModule),w=NATIVE.logicalWidth*NATIVE.rasterScale,h=NATIVE.logicalHeight*NATIVE.rasterScale;
  const frames=[],items=[],passes=['base-color','tint-color','ownership','composite'],canvases=passes.map(()=>createCanvas(w,h));
  let maxCompositeAlphaError=0,maxCompositeRGBError=0,alphaClips=0;
  for(const[clip,def]of Object.entries(CLIPS))for(const direction of DIRECTIONS)for(let col=0;col<def.samples.length;col++){
    const opts={action:def.action,progress:def.samples[col],outcome:def.outcome??'neutral',direction,x:NATIVE.feet[0]*NATIVE.rasterScale,y:NATIVE.feet[1]*NATIVE.rasterScale,width:48*NATIVE.rasterScale,shadow:false};
    const rendered=passes.map((renderPass,i)=>{const c=canvases[i].getContext('2d');c.clearRect(0,0,w,h);drawGolfer(c,{...opts,renderPass});return c.getImageData(0,0,w,h).data;});
    const layers=splitVisibleLayers(...rendered);if(!transparentEdge(rendered[2],w,h))alphaClips++;
    // Validate partitioned visible-layer alpha against actual painted geometry.
    const composite=compositeBytes(layers.base,layers.tint);for(let i=0;i<composite.length;i+=4){maxCompositeAlphaError=Math.max(maxCompositeAlphaError,Math.abs(composite[i+3]-rendered[2][i+3]));for(let channel=0;channel<3;channel++)maxCompositeRGBError=Math.max(maxCompositeRGBError,Math.abs(composite[i+channel]*composite[i+3]/255-rendered[3][i+channel]*rendered[3][i+3]/255));}
    const body=skeletonFor(poseFor(def.action,opts.progress,opts.outcome));
    const frame={id:`primary.${clip}.${direction}.${col}`,clip,direction,col,modelProgress:opts.progress,contact:def.contact===col,sourceSize:{w,h},feetRaster:NATIVE.feet.map(n=>n*NATIVE.rasterScale),layers:{},rig:body.club?{hand:'right',handL:body.club.handL,handR:body.club.handR,tip:body.club.tip,headEnd:body.club.headEnd}:null};
    for(const layer of ['base','tint']){const crop=cropRGBA(layers[layer],w,h);const item={frame,layer,crop};items.push(item);frame.layers[layer]={};}
    frames.push({meta:frame,pixels:layers,composite});
  }
  if(alphaClips)throw new Error(`${alphaClips} frames touch the native source edge`);
  const unique=[],seen=new Map();for(const item of items){const key=`${item.crop.w}x${item.crop.h}:${sha(item.crop.data)}`;if(seen.has(key))item.shared=seen.get(key);else{seen.set(key,item);unique.push(item);}}
  const packed=pack(unique),atlasRGBA=Buffer.alloc(packed.width*packed.height*4);
  for(const item of unique)for(let y=0;y<item.crop.h;y++)atlasRGBA.set(item.crop.data.subarray(y*item.crop.w*4,(y+1)*item.crop.w*4),((item.rect.y+y)*packed.width+item.rect.x)*4);
  for(const item of items){const rect=item.shared?item.shared.rect:item.rect;item.frame.layers[item.layer]={texture:rect,trim:{x:item.crop.x,y:item.crop.y,w:item.crop.w,h:item.crop.h},empty:item.crop.empty};}
  const atlasPNG=PNG.sync.write({width:packed.width,height:packed.height,data:atlasRGBA},{deflateLevel:9,deflateStrategy:0,filterType:-1});
  const shadow=createCanvas(40,20),sc=shadow.getContext('2d');sc.scale(2,2);sc.fillStyle='rgba(34,55,43,0.18)';sc.beginPath();sc.ellipse(10,5,8,3.4,0,0,Math.PI*2);sc.fill();const shadowPNG=shadow.toBuffer('image/png');
  // Offline review sheet. Its raster text is non-runtime and environment-local.
  const sheet=createCanvas(1080,760),cc=sheet.getContext('2d');cc.fillStyle='#f4f1e7';cc.fillRect(0,0,1080,760);cc.fillStyle='#314d46';cc.font='22px sans-serif';cc.fillText('Natural golfer v1 · one production candidate identity',28,36);cc.font='12px sans-serif';cc.fillText('8 authored right-hand views · teal/cream · normal body scale retained · human PNG review pending',28,59);
  function sample(frame,x,y,scale){const c=createCanvas(w,h);putPixels(c.getContext('2d'),frame.composite,w,h);const zoom=scale/(26/48);cc.drawImage(shadow,x-10*zoom+1.5*zoom,y-5*zoom+.8*zoom,20*zoom,10*zoom);cc.drawImage(c,x-NATIVE.feet[0]*scale,y-NATIVE.feet[1]*scale,NATIVE.logicalWidth*scale,NATIVE.logicalHeight*scale);}
  for(let row=0;row<3;row++){const zoom=[.5,1,2][row],scale=26/48*zoom;cc.font='12px sans-serif';cc.fillText(`${[50,100,200][row]}% · reference frame ${[13,26,52][row]}px / body ${(MODEL.crownHeight*scale).toFixed(1)}px`,28,91+row*116);DIRECTIONS.forEach((direction,i)=>{const f=frames.find(f=>f.meta.clip==='swing'&&f.meta.direction===direction&&f.meta.col===5);sample(f,330+i*91,151+row*116,scale);cc.fillStyle='#586c60';cc.fillText(direction.toUpperCase(),320+i*91,170+row*116);});}
  cc.fillStyle='#314d46';cc.font='16px sans-serif';cc.fillText('Enlarged inspection · 300% body scale · no per-pose resizing',28,455);
  [['walk',2],['idle',0],['swing',3],['swing',5],['swing',7],['putt',2],['positive',1],['negative',1]].forEach(([clip,col],i)=>{const f=frames.find(f=>f.meta.clip===clip&&f.meta.direction==='se'&&f.meta.col===col);sample(f,74+i*133,644,26/48*3);cc.fillStyle='#586c60';cc.font='11px sans-serif';cc.fillText(`${clip} / ${col}`,35+i*133,681);});
  cc.font='11px sans-serif';cc.fillText('Padding/trim preserve the same 26/48 world scale. Settle/watch use idle fallback. Left/unknown hands are unsupported.',28,724);
  const sheetPNG=sheet.toBuffer('image/png');
  const modelBytes=await readFile(resolve(here,'lib/natural-golfer-model.mjs')),generatorBytes=await readFile(fileURLToPath(import.meta.url));
  const manifest={schema:'coursecraft.natural-golfer-atlas',version:1,modelVersion:MODEL_VERSION,status:'production-candidate-human-review-pending',runtimeIntegrated:false,identity:'primary-teal-cream-01',variantCount:1,legacyPreserved:true,
    native:NATIVE,body:{headRatio:MODEL.crownHeight/MODEL.headHeight,height:MODEL.crownHeight,displayHeightAt100:MODEL.crownHeight*26/48},
    texture:{file:'atlas.png',width:packed.width,height:packed.height,format:'rgba8',padding:2,sha256:sha(atlasPNG)},
    layers:{order:['base','tint'],tint:{scope:'polo fabric only',neutral:'grayscale',defaultColor:'#397e82'},base:{scope:'skin, trousers, cream cap, hair, shoes, bag, equipment, collar/buttons'},occlusion:'visible-surface partition; base alpha corrected for tint-over-base reconstruction'},
    shadow:{file:'shadow.png',width:40,height:20,rasterScale:2,logicalAnchor:[10,5],worldOffset:[1.5,.8],worldRadii:[8,3.4],alpha:.18,separate:true,sha256:sha(shadowPNG)},
    directions:{rows:DIRECTIONS,authored:8,mirrored:0,walkIdleReaction:'facing',swingPutt:'target'},
    coverage:{handedness:['right'],unknownHand:'neutral non-gripping idle fallback; no strike coverage claimed',leftHand:'neutral non-gripping idle fallback; no strike coverage claimed',equipment:'generic legacy club silhouette; no driver/iron/putter class certification',optionalClips:{settle:'idle',watch:'idle'},reactionPolicy:'candidate frames only; runtime may use one static evidenced cue inside shared rest, no added dwell or automatic loop'},
    clips:Object.fromEntries(Object.entries(CLIPS).map(([name,def])=>[name,{columns:def.samples.length,rows:8,contact:def.contact,semantics:def.semantics,modelSamples:def.samples}])),
    frames:frames.map(f=>f.meta),validation:{alphaClippedFrames:alphaClips,maxCompositeAlphaError,maxCompositePremultipliedRGBError:maxCompositeRGBError,perPoseScale:false,worldScale:26/48,rasterToWorldScale:26/(48*NATIVE.rasterScale)},
    provenance:{approvedAnatomyCommit:'aa5933d8e13d61963dc22fd640d1c7d6a52134b3',approvedModel:'art/golfer-lookdev/prototype.mjs',approvedModelSha256:sha(await readFile(resolve(projectRoot,'art/golfer-lookdev/prototype.mjs'))),paletteConceptCommit:'dafbed52120603c9a2876ba01bf5cc3a827d58f0',modelSha256:sha(modelBytes),generatorSha256:sha(generatorBytes),sourceType:'original code-native procedural geometry; no provider or external image assets',rasterizer:'@napi-rs/canvas@0.1.100',pngEncoder:'pngjs@7.0.0; RGBA8; zlib level9/strategy0; adaptive PNG filter',reproducibility:'PNG bytes deterministic for pinned rasterizer/platform; review text can vary across font environments',licensing:'Original CourseCraft authoring code; rasterizer MIT; no third-party character artwork',reviewer:null,approval:'pending PNG/alpha/anchor/occlusion/normal-scale human review'}};
  const manifestBytes=Buffer.from(JSON.stringify(manifest)+'\n');
  const runtimeBytes=atlasPNG.length+shadowPNG.length,runtimeDecoded=(packed.width*packed.height+40*20)*4;
  const allPNGBytes=runtimeBytes+sheetPNG.length,allDecoded=runtimeDecoded+1080*760*4;
  const cost={manifestBytes:manifestBytes.length,runtimePNGPlusManifestBytes:runtimeBytes+manifestBytes.length,allPNGPlusManifestBytes:allPNGBytes+manifestBytes.length,baseline:{compressedPNGBytes:501591,decodedRGBABytes:12700960},runtimeTextures:{compressedPNGBytes:runtimeBytes,decodedRGBABytes:runtimeDecoded,files:[{file:'atlas.png',bytes:atlasPNG.length,width:packed.width,height:packed.height},{file:'shadow.png',bytes:shadowPNG.length,width:40,height:20}]},reviewOnly:{compressedPNGBytes:sheetPNG.length,decodedRGBABytes:1080*760*4},allPNGs:{compressedPNGBytes:allPNGBytes,decodedRGBABytes:allDecoded},withinBaseline:{runtime:runtimeBytes<=501591&&runtimeDecoded<=12700960,includingReview:allPNGBytes<=501591&&allDecoded<=12700960},frames:frames.length,layerFrames:items.length,uniqueLayerTextures:unique.length};
  if(!cost.withinBaseline.runtime||!cost.withinBaseline.includingReview||cost.runtimePNGPlusManifestBytes>501591)throw new Error(`Candidate exceeds baseline: ${JSON.stringify(cost)}`);
  await mkdir(outDir,{recursive:true});const artifacts={'atlas.png':atlasPNG,'shadow.png':shadowPNG,'contact-sheet.png':sheetPNG,'manifest.json':manifestBytes,'cost.json':Buffer.from(JSON.stringify(cost,null,2)+'\n'),'provenance.json':Buffer.from(JSON.stringify(manifest.provenance,null,2)+'\n')};
  for(const[name,bytes]of Object.entries(artifacts))await writeFile(resolve(outDir,name),bytes);
  return{manifest,cost,artifacts,frames,packed};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const args=process.argv.slice(2),value=key=>{const i=args.indexOf(key);return i<0?undefined:args[i+1];};const result=await generateNaturalGolfer({canvasModule:value('--canvas-module'),outDir:value('--out-dir')});console.log(JSON.stringify({frames:result.cost.frames,texture:result.manifest.texture,cost:result.cost},null,2));}
