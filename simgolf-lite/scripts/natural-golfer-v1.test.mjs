import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {generateNaturalGolfer,CLIPS,NATIVE} from './gen-natural-golfer-v1.mjs';
import {MODEL,DIRECTIONS,poseFor,skeletonFor,bodyAngle,project} from './lib/natural-golfer-model.mjs';
import * as approved from '../art/golfer-lookdev/prototype.mjs';
let folder,first,second,atlas;
const hash=b=>createHash('sha256').update(b).digest('hex');
const distance=(a,b)=>Math.hypot(...a.map((n,i)=>n-b[i]));
before(async()=>{folder=await mkdtemp(join(tmpdir(),'natural-golfer-v1-'));const canvasModule=process.env.NATURAL_GOLFER_CANVAS_MODULE;first=await generateNaturalGolfer({canvasModule,outDir:join(folder,'one')});second=await generateNaturalGolfer({canvasModule,outDir:join(folder,'two')});atlas=PNG.sync.read(first.artifacts['atlas.png']);});
after(async()=>{if(folder)await rm(folder,{recursive:true,force:true});});

test('generation is byte deterministic and checked-in candidate matches exact current source',async()=>{
  for(const[name,bytes]of Object.entries(first.artifacts)){assert.equal(hash(bytes),hash(second.artifacts[name]),name);const saved=await readFile(new URL(`../art/natural-golfer-v1/${name}`,import.meta.url));assert.equal(hash(saved),hash(bytes),`${name}: regenerate candidate after source changes`);}
});

test('one identity has complete 6/2/8/4/4/4 grids in eight authored views with contact5/2',()=>{
  assert.equal(first.manifest.variantCount,1);assert.equal(first.manifest.frames.length,224);assert.deepEqual(first.manifest.directions.rows,DIRECTIONS);assert.equal(first.manifest.directions.mirrored,0);
  const expected={walk:6,idle:2,swing:8,putt:4,positive:4,negative:4};
  for(const[clip,columns]of Object.entries(expected))for(const direction of DIRECTIONS){const frames=first.manifest.frames.filter(f=>f.clip===clip&&f.direction===direction);assert.deepEqual(frames.map(f=>f.col),Array.from({length:columns},(_,i)=>i));assert.deepEqual(frames.filter(f=>f.contact).map(f=>f.col),clip==='swing'?[5]:clip==='putt'?[2]:[]);}
  assert.equal(CLIPS.swing.samples[5],.63);assert.equal(CLIPS.putt.samples[2],.5);
});

test('approved adult anatomy, actual arm/club rig and contact geometry stay unchanged',()=>{
  assert.deepEqual(MODEL,approved.MODEL);assert.equal(MODEL.crownHeight/MODEL.headHeight,6.409999999999999);
  for(const action of['walk','idle','swing','putt','react'])for(let i=0;i<=100;i++){const pose=poseFor(action,i/100,'pleased'),body=skeletonFor(pose);assert.deepEqual(body,approved.skeletonFor(approved.poseFor(action,i/100,'pleased')));for(const arm of body.arms){assert.ok(Math.abs(distance(arm.shoulder,arm.elbow)-10.5)<1e-8);assert.ok(Math.abs(distance(arm.elbow,arm.hand)-11)<1e-8);}if(body.club)assert.ok(Math.abs(distance(body.club.handR,body.club.tip)-MODEL.shaftLength)<1e-8);}
  for(const frame of first.frames.filter(f=>f.meta.contact)){const {tip}=frame.meta.rig;if(frame.meta.clip==='swing')tip.forEach((n,i)=>assert.ok(Math.abs(n-[7.6,12,1][i])<1e-8));}
});

test('native padding keeps exact world body scale and feet anchor for 13/26/52px reference sizes',()=>{
  assert.deepEqual(NATIVE.feet,[36,83]);assert.deepEqual(NATIVE.sourceOrigin,[-12,-14]);assert.equal(NATIVE.rasterScale,1);
  for(const frame of first.frames){assert.deepEqual(frame.meta.sourceSize,{w:72,h:96});assert.deepEqual(frame.meta.feetRaster,[36,83]);for(const direction of DIRECTIONS){const p=project({s:0,f:0,h:0},bodyAngle(direction,CLIPS[frame.meta.clip].action));assert.equal(p.x-NATIVE.sourceOrigin[0],36);assert.equal(p.y-NATIVE.sourceOrigin[1],83);}}
  for(const zoom of[.5,1,2]){const scale=26/48*zoom;assert.equal(48*scale,26*zoom);assert.ok(Math.abs(MODEL.crownHeight*scale-approved.MODEL.crownHeight*26/48*zoom)<1e-10);}
  assert.equal(first.manifest.validation.perPoseScale,false);
});

function checkEdges(data,w,h){for(let x=0;x<w;x++){assert.equal(data[x*4+3],0);assert.equal(data[((h-1)*w+x)*4+3],0);}for(let y=0;y<h;y++){assert.equal(data[y*w*4+3],0);assert.equal(data[(y*w+w-1)*4+3],0);}}
function reconstruct(meta,layer){const def=meta.layers[layer],out=new Uint8ClampedArray(72*96*4);for(let y=0;y<def.texture.h;y++)for(let x=0;x<def.texture.w;x++){const source=((def.texture.y+y)*atlas.width+def.texture.x+x)*4,target=((def.trim.y+y)*72+def.trim.x+x)*4;out.set(atlas.data.subarray(source,source+4),target);}return out;}

test('all actual rendered frames and reconstructed trimmed layers retain transparent native edges',()=>{
  for(const frame of first.frames){checkEdges(frame.composite,72,96);for(const layer of['base','tint']){const rebuilt=reconstruct(frame.meta,layer);assert.deepEqual(rebuilt,frame.pixels[layer],`${frame.meta.id}/${layer}`);checkEdges(rebuilt,72,96);}}
  assert.equal(first.manifest.validation.alphaClippedFrames,0);
});

test('packed unique textures do not overlap and have two clean alpha padding pixels',()=>{
  const unique=new Map();for(const frame of first.manifest.frames)for(const layer of Object.values(frame.layers)){const r=layer.texture;assert.ok(r.x>=2&&r.y>=2&&r.x+r.w+2<=atlas.width&&r.y+r.h+2<=atlas.height);unique.set(JSON.stringify(r),r);}
  const rectangles=[...unique.values()];assert.equal(rectangles.length,first.cost.uniqueLayerTextures);
  for(let i=0;i<rectangles.length;i++){const r=rectangles[i];for(let j=i+1;j<rectangles.length;j++){const q=rectangles[j];assert.ok(r.x+r.w<=q.x||q.x+q.w<=r.x||r.y+r.h<=q.y||q.y+q.h<=r.y,'packed texture overlap');}for(let y=r.y-2;y<r.y+r.h+2;y++)for(let x=r.x-2;x<r.x+r.w+2;x++)if(x<r.x||x>=r.x+r.w||y<r.y||y>=r.y+r.h)assert.equal(atlas.data[(y*atlas.width+x)*4+3],0,'dirty extrusion/padding');}
});

test('visible base/tint partition preserves occlusion, grayscale clothing and separate shadow',()=>{
  assert.ok(first.manifest.validation.maxCompositeAlphaError<=1);assert.ok(first.manifest.validation.maxCompositePremultipliedRGBError<=3);
  for(const frame of first.frames){const tint=frame.pixels.tint;for(let i=0;i<tint.length;i+=4)if(tint[i+3]){assert.equal(tint[i],tint[i+1]);assert.equal(tint[i],tint[i+2]);}}
  const shadow=PNG.sync.read(first.artifacts['shadow.png']);assert.equal(shadow.width,40);assert.equal(shadow.height,20);assert.ok(Math.max(...Array.from({length:shadow.width*shadow.height},(_,i)=>shadow.data[i*4+3]))<=46);assert.equal(first.manifest.shadow.separate,true);
});

test('known-right coverage is explicit, unsupported hands cannot acquire falsely mirrored strikes',()=>{
  assert.deepEqual(first.manifest.coverage.handedness,['right']);assert.match(first.manifest.coverage.leftHand,/neutral non-gripping idle fallback/);assert.match(first.manifest.coverage.unknownHand,/neutral non-gripping idle fallback/);assert.equal(first.manifest.directions.mirrored,0);assert.ok(first.manifest.frames.filter(f=>f.clip==='idle').every(f=>f.rig===null));assert.deepEqual(first.manifest.coverage.optionalClips,{settle:'idle',watch:'idle'});
});

test('actual compressed, decoded and full review PNG bytes stay under unchanged legacy ceilings',()=>{
  const production=['atlas.png','shadow.png'],all=[...production,'contact-sheet.png'];
  const measure=names=>names.reduce((out,name)=>{const decoded=PNG.sync.read(first.artifacts[name]);out.compressed+=first.artifacts[name].length;out.decoded+=decoded.width*decoded.height*4;return out;},{compressed:0,decoded:0});
  const runtime=measure(production),packet=measure(all);assert.equal(runtime.compressed,first.cost.runtimeTextures.compressedPNGBytes);assert.equal(runtime.decoded,first.cost.runtimeTextures.decodedRGBABytes);assert.equal(packet.compressed,first.cost.allPNGs.compressedPNGBytes);assert.equal(runtime.compressed+first.artifacts['manifest.json'].length,first.cost.runtimePNGPlusManifestBytes);assert.ok(first.cost.runtimePNGPlusManifestBytes<=501591);assert.equal(packet.decoded,first.cost.allPNGs.decodedRGBABytes);assert.ok(packet.compressed<=501591&&packet.decoded<=12700960);assert.equal(first.manifest.texture.sha256,hash(first.artifacts['atlas.png']));
});
