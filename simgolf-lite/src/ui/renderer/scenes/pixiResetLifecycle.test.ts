import {beforeEach,afterEach,it,expect,vi} from "vitest";
import * as PIXI from "pixi.js";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {dirname,resolve} from "node:path";
const pixiRoot = resolve(dirname(createRequire(import.meta.url).resolve("pixi.js")), "..");
const installedVersion = (JSON.parse(readFileSync(resolve(pixiRoot,"package.json"),"utf8")) as {version: string}).version;
let uid=5000;
beforeEach(()=>{
 if(installedVersion!=="8.21.0") throw Error("Pixi reset lifecycle requires installed pinned 8.21.0");
 const resetSource=PIXI.BatchableGraphics.prototype.reset.toString();
 const fourNull=["texture","geometryData","_batcher","_batch"].every(field=>new RegExp("this\\."+field+"\\s*=\\s*null").test(resetSource));
 if(!fourNull) throw Error("Actual loaded Pixi reset does not match arm's four-null contract");
 vi.spyOn(PIXI.DOMAdapter.get(),"createCanvas").mockReturnValue({getContext:()=>null} as unknown as ReturnType<ReturnType<typeof PIXI.DOMAdapter.get>["createCanvas"]>);
});
afterEach(()=>vi.restoreAllMocks());
interface Host {
 readonly uid: number;
 readonly graphicsContext: PIXI.GraphicsContextSystem;
 readonly renderPipes: {batch: PIXI.BatcherPipe; graphics: PIXI.GraphicsPipe};
}
interface ReadonlyGraphicsData {
 readonly _gpuData: Readonly<Record<number, {readonly batches: readonly PIXI.BatchableGraphics[]}>>;
}
interface ReturnObservation {readonly id: PIXI.BatchableGraphics; readonly cleared: boolean;}
function host(): Host {
 const renderPipes: Partial<Host["renderPipes"]> = {};
 const renderer = {uid: ++uid, limits: {maxBatchableTextures: 4}, _roundPixels: 0,
  gc: {now: 0, addResourceHash: vi.fn()}, runners: {contextChange: {add: vi.fn()}}, renderPipes,
  graphicsContext: undefined as PIXI.GraphicsContextSystem | undefined};
 const graphicsContext = new PIXI.GraphicsContextSystem(renderer as unknown as ConstructorParameters<typeof PIXI.GraphicsContextSystem>[0]);
 renderer.graphicsContext = graphicsContext;
 const batch = new PIXI.BatcherPipe(renderer as unknown as ConstructorParameters<typeof PIXI.BatcherPipe>[0],
  {start: vi.fn(), execute: vi.fn()} as unknown as ConstructorParameters<typeof PIXI.BatcherPipe>[1]);
 const graphics = new PIXI.GraphicsPipe(renderer as unknown as ConstructorParameters<typeof PIXI.GraphicsPipe>[0],
  {destroy: vi.fn()} as unknown as ConstructorParameters<typeof PIXI.GraphicsPipe>[1]);
 renderPipes.batch = batch; renderPipes.graphics = graphics;
 return {uid: renderer.uid, graphicsContext, renderPipes: {batch, graphics}};
}
function fixture(texture:PIXI.Texture){const c=new PIXI.GraphicsContext();c.batchMode="batch";c.texture(texture,0xc9e6ee,2,3,12,8);for(let i=0;i<200;i++)c.rect(i*3,10+(i%7),2,4).fill({color:0x345678,alpha:.26,texture});c.moveTo(0,0).lineTo(90,30).stroke({width:1.25,color:0xc9e6ee,alpha:.26});return c;}
function build(h:Host,g:PIXI.Graphics,ownedSets?: PIXI.InstructionSet[]){const set=new PIXI.InstructionSet();ownedSets?.push(set);set.renderPipes=h.renderPipes;h.renderPipes.batch.buildStart(set);h.renderPipes.graphics.addRenderable(g,set);h.renderPipes.batch.buildEnd(set);h.renderPipes.graphics.updateRenderable(g);const gpu=h.graphicsContext.getGpuContext(g.context);const payload={vertices:[...gpu.geometryData.vertices],uvs:[...gpu.geometryData.uvs],indices:[...gpu.geometryData.indices],styles:gpu.batches.map((b)=>[b.baseColor,b.alpha,b.topology,b.indexOffset,b.indexSize,b.attributeOffset,b.attributeSize,b.texture===PIXI.Texture.WHITE?"white":"fixture"])};expect(payload.vertices.length).toBeGreaterThan(400);expect(set.instructionSize).toBeGreaterThan(0);return {set,payload,clones:[...(g as unknown as ReadonlyGraphicsData)._gpuData[h.uid].batches]};}
function completeCleanup(disposers: readonly (() => void)[]): void {
 let failed = false;
 let firstError: unknown;
 for (const dispose of disposers) {
  try {dispose();} catch (error) {if(!failed){failed=true;firstError=error;}}
 }
 if(failed) throw firstError;
}
function destroyTrackedSets(sets: PIXI.InstructionSet[]): void {
 const owned = sets.splice(0);
 completeCleanup(owned.map(set => () => set.destroy()));
}
it("image/shape/clone return, reuse, dirty rebuild, owned retirement and shared survivor",()=>{
 const h=host(),texture=new PIXI.Texture({source:new PIXI.TextureSource({width:16,height:16})});const textureDestroy=vi.spyOn(texture,"destroy");const sourceDestroy=vi.spyOn(texture.source,"destroy");
 const shared=fixture(texture),current=new PIXI.Graphics({context:shared}),retiring=new PIXI.Graphics({context:shared});const sharedDestroy=vi.spyOn(shared,"destroy");
 const observations: ReturnObservation[]=[];const originalReturn=PIXI.BigPool.return.bind(PIXI.BigPool);const returnSpy=vi.spyOn(PIXI.BigPool,"return").mockImplementation((item)=>{originalReturn(item);if(item instanceof PIXI.BatchableGraphics){observations.push({id:item,cleared:[item.texture,item.geometryData,item._batcher,item._batch].every(x=>x===null)});expect([item.texture,item.geometryData,item._batcher,item._batch].every(x=>x===null)).toBe(true);}});
 const firstSets: PIXI.InstructionSet[] = [], nextSets: PIXI.InstructionSet[] = [];
 let replacement: PIXI.Graphics | undefined;
 let ownedContext: PIXI.GraphicsContext | undefined;
 const retiredPorts = new Set<string>();
 const retireFirstHost = () => {
  completeCleanup([
   () => {if(!retiredPorts.has("graphics")){retiredPorts.add("graphics");h.renderPipes.graphics.destroy();}},
   () => {if(!retiredPorts.has("contexts")){retiredPorts.add("contexts");h.graphicsContext.destroy();}},
   () => {if(!retiredPorts.has("batch")){retiredPorts.add("batch");h.renderPipes.batch.destroy();}},
  ]);
 };
 let nextHost: Host | undefined;
 let owned: PIXI.Graphics | undefined;
 try{
  const first=build(h,retiring,firstSets),live=build(h,current,firstSets);expect(first.payload).toEqual(live.payload);const liveCloneRefs=live.clones.map((b)=>[b.texture,b.geometryData,b._batcher,b._batch]);
  retiring.destroy();expect(sharedDestroy).not.toHaveBeenCalled();expect(shared.destroyed).toBe(false);expect(textureDestroy).not.toHaveBeenCalled();expect(sourceDestroy).not.toHaveBeenCalled();
  expect(observations.length).toBeGreaterThan(0);
  for(let i=0;i<live.clones.length;i++)expect([live.clones[i].texture,live.clones[i].geometryData,live.clones[i]._batcher,live.clones[i]._batch].every((ref,j)=>ref===liveCloneRefs[i][j])).toBe(true);
  replacement=new PIXI.Graphics({context:shared});const reused=build(h,replacement,firstSets);expect(reused.payload).toEqual(first.payload);expect(reused.clones.some((b)=>first.clones.includes(b))).toBe(true);
  shared.rect(700,0,3,3).fill({texture,color:0x456789,alpha:.5});const rebuilt=build(h,current,firstSets);expect(rebuilt.payload.vertices.length).toBeGreaterThan(live.payload.vertices.length);expect(current.destroyed).toBe(false);expect(shared.destroyed).toBe(false);replacement.destroy();current.destroy();shared.destroy();expect(sharedDestroy).toHaveBeenCalledTimes(1);
  destroyTrackedSets(firstSets);retireFirstHost();
  nextHost=host();ownedContext=fixture(texture);owned=new PIXI.Graphics({context:ownedContext});const next=build(nextHost,owned,nextSets);expect(next.payload).toEqual(first.payload);owned.destroy();expect(ownedContext.destroyed).toBe(false);ownedContext.destroy();expect(texture.destroyed).toBe(false);expect(texture.source.destroyed).toBe(false);
  expect(observations.length).toBeGreaterThan(0);
 }finally{
  returnSpy.mockRestore();
  completeCleanup([
   () => retiring.destroy(), () => current.destroy(), () => replacement?.destroy(),
   () => shared.destroy(), () => owned?.destroy(), () => ownedContext?.destroy(),
   () => destroyTrackedSets(firstSets), () => retireFirstHost(),
   () => destroyTrackedSets(nextSets),
   () => nextHost?.renderPipes.graphics.destroy(), () => nextHost?.graphicsContext.destroy(),
   () => nextHost?.renderPipes.batch.destroy(), () => texture.destroy(true),
  ]);
 }
});


for (const mode of ["no-batch", "auto"] as const) it(`standalone ${mode}: real render-data packing, public unload, borrowed survivor and next checkout`,()=>{
 const h=host(), texture=new PIXI.Texture({source:new PIXI.TextureSource({width:16,height:16})});
 const shared=fixture(texture);shared.batchMode="batch";
 const survivor=new PIXI.Graphics({context:shared});const live=build(h,survivor);
 const liveArrays=h.graphicsContext.getGpuContext(shared).geometryData;
 const liveSnapshot={vertices:[...liveArrays.vertices],uvs:[...liveArrays.uvs],indices:[...liveArrays.indices]};
 const context=fixture(texture);context.batchMode=mode;
 const owned=new PIXI.Graphics({context});const destroyContext=vi.spyOn(context,"destroy");
 const textureDestroy=vi.spyOn(texture,"destroy"),sourceDestroy=vi.spyOn(texture.source,"destroy");
 const observations: ReturnObservation[]=[];const originalReturn=PIXI.BigPool.return.bind(PIXI.BigPool);
 const returnSpy=vi.spyOn(PIXI.BigPool,"return").mockImplementation((item)=>{originalReturn(item);if(item instanceof PIXI.BatchableGraphics){observations.push({id:item,cleared:[item.texture,item.geometryData,item._batcher,item._batch].every(x=>x===null)});expect([item.texture,item.geometryData,item._batcher,item._batch].every(x=>x===null)).toBe(true);}});
 let nextContext: PIXI.GraphicsContext | undefined;
 const payload=(gpu: ReturnType<PIXI.GraphicsContextSystem["getGpuContext"]>)=>({vertices:[...gpu.geometryData.vertices],uvs:[...gpu.geometryData.uvs],indices:[...gpu.geometryData.indices],styles:gpu.batches.map((b)=>[b.baseColor,b.alpha,b.topology,b.indexOffset,b.indexSize,b.attributeOffset,b.attributeSize,b.texture===PIXI.Texture.WHITE?"white":"fixture"])});
 try{
  const gpu=h.graphicsContext.updateGpuContext(context);expect(gpu.geometryData.vertices.length).toBeGreaterThan(400);expect(gpu.isBatchable).toBe(false);
  const before=payload(gpu);const aliases=[...gpu.batches];
  const data=h.graphicsContext.getContextRenderData(context);
  expect(data.instructions.instructionSize).toBeGreaterThan(0);expect(data.batcher.attributeSize).toBeGreaterThan(0);expect(data.batcher.indexSize).toBeGreaterThan(0);
  expect(data.batcher.geometry.buffers[0].data.byteLength).toBeGreaterThan(0);expect(data.batcher.geometry.indexBuffer.data.byteLength).toBeGreaterThan(0);
  context.unload();expect(context.destroyed).toBe(false);expect(destroyContext).not.toHaveBeenCalled();expect(observations.length).toBeGreaterThan(0);
  expect(gpu.geometryData).toBeNull();expect(textureDestroy).not.toHaveBeenCalled();expect(sourceDestroy).not.toHaveBeenCalled();
  expect(survivor.destroyed).toBe(false);expect(shared.destroyed).toBe(false);expect(payload(h.graphicsContext.getGpuContext(shared))).toEqual(live.payload);
  expect(liveArrays.vertices).toEqual(liveSnapshot.vertices);expect(liveArrays.uvs).toEqual(liveSnapshot.uvs);expect(liveArrays.indices).toEqual(liveSnapshot.indices);
  nextContext=fixture(texture);nextContext.batchMode=mode;const nextGpu=h.graphicsContext.updateGpuContext(nextContext);
  expect(payload(nextGpu)).toEqual(before);expect(nextGpu.batches.some((b)=>aliases.includes(b))).toBe(true);
  const nextData=h.graphicsContext.getContextRenderData(nextContext);expect(nextData).toBe(data);
  expect(nextData.batcher.attributeSize).toBeGreaterThan(0);expect(nextData.instructions.instructionSize).toBeGreaterThan(0);
  const reloaded=h.graphicsContext.updateGpuContext(context);expect(payload(reloaded)).toEqual(before);expect(reloaded.isBatchable).toBe(false);
  h.graphicsContext.getContextRenderData(context);context.destroy();expect(destroyContext).toHaveBeenCalledTimes(1);
  expect(survivor.context).toBe(shared);shared.rect(900,0,3,3).fill({color:0x567890,texture});expect(h.graphicsContext.updateGpuContext(shared).geometryData.vertices.length).toBeGreaterThan(liveSnapshot.vertices.length);
  expect(observations.length).toBeGreaterThan(0);
 }finally{
  returnSpy.mockRestore();
  owned.destroy();context.destroy();nextContext?.destroy();survivor.destroy();shared.destroy();live.set.destroy();
  h.renderPipes.graphics.destroy();h.graphicsContext.destroy();h.renderPipes.batch.destroy();texture.destroy(true);
 }
});

it("installed ESM/CJS bytes match the committed pinned reset metadata",()=>{
 const metadata = JSON.parse(readFileSync(new URL("../../../../scripts/pixi-reset-patch.json", import.meta.url),"utf8")) as {version: string; files: readonly {relativePath: string; patchedSha256: string}[]};
 expect(installedVersion).toBe(metadata.version);
 for (const f of metadata.files) {
  const raw=readFileSync(resolve(pixiRoot,f.relativePath));
  // This file-level guard checks applied installer bytes, not a runtime prototype replacement.
  expect(createHash("sha256").update(raw).digest("hex")).toBe(f.patchedSha256);
 }
});
