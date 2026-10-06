import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import * as PIXI from 'pixi.js';

type ResetData = PIXI.GraphicsContextRenderData & {reset(): void};
let rendererUid=8100;
function cleanup(...actions: (()=>void)[]){
 vi.restoreAllMocks();
 let first: unknown;let failed=false;
 for(const action of actions)try{action();}catch(error){if(!failed){first=error;failed=true;}}
 if(failed)throw first;
}
function system(maxTextures=16){
 const renderer={uid:++rendererUid,limits:{maxBatchableTextures:maxTextures},gc:{now:0,addResourceHash:vi.fn()}};
 return new PIXI.GraphicsContextSystem(renderer as unknown as ConstructorParameters<typeof PIXI.GraphicsContextSystem>[0]);
}
function draw(texture:PIXI.Texture){
 const context=new PIXI.GraphicsContext();context.batchMode='no-batch';
 context.texture(texture,0xabcdef,2,3,12,8);
 for(let i=0;i<200;i++)context.rect(i*3,i%7,2,4).fill({texture,color:0x345678,alpha:.26});
 context.moveTo(0,0).lineTo(90,30).stroke({width:1.25,color:0xc9e6ee,alpha:.26});
 return context;
}
function materialize(sys:ReturnType<typeof system>,context:PIXI.GraphicsContext){
 const gpu=sys.updateGpuContext(context);
 expect(gpu.isBatchable).toBe(false);expect(gpu.geometryData.vertices.length).toBeGreaterThan(400);
 const payload={vertices:[...gpu.geometryData.vertices],uvs:[...gpu.geometryData.uvs],indices:[...gpu.geometryData.indices],styles:gpu.batches.map(b=>[b.baseColor,b.alpha,b.topology,b.indexOffset,b.indexSize,b.attributeOffset,b.attributeSize,b.texture===PIXI.Texture.WHITE?'white':'fixture'])};
 const data=sys.getContextRenderData(context) as ResetData;
 expect(data.instructions.instructionSize).toBeGreaterThan(0);expect(data.batcher.attributeSize).toBeGreaterThan(0);
 expect(data.batcher.geometry.buffers[0].data.byteLength).toBeGreaterThan(0);
 return {data,payload};
}
beforeEach(()=>{
 expect(typeof (PIXI.GraphicsContextRenderData.prototype as ResetData).reset).toBe('function');
 vi.spyOn(PIXI.DOMAdapter.get(),'createCanvas').mockReturnValue({getContext:()=>null} as unknown as ReturnType<ReturnType<typeof PIXI.DOMAdapter.get>['createCanvas']>);
});
afterEach(()=>vi.restoreAllMocks());

it('actual standalone Pool.return destroys owned buffers once and checkout rebuilds identical geometry/style',()=>{
 const sys=system(),texture=new PIXI.Texture({source:new PIXI.TextureSource({width:16,height:16})}),context=draw(texture);
 try{
  const first=materialize(sys,context),oldBatcher=first.data.batcher,oldGeometry=oldBatcher.geometry,oldAttributes=oldBatcher.attributeBuffer,oldInstructions=first.data.instructions;
  const batcherDestroy=vi.spyOn(oldBatcher,'destroy'),geometryDestroy=vi.spyOn(oldGeometry,'destroy'),instructionsDestroy=vi.spyOn(oldInstructions,'destroy');
  context.unload();
  expect(first.data.batcher===null&&first.data.instructions===null).toBe(true);
  expect(batcherDestroy).toHaveBeenCalledTimes(1);expect(geometryDestroy).toHaveBeenCalledTimes(1);expect(instructionsDestroy).toHaveBeenCalledTimes(1);
  expect(oldAttributes.rawBinaryData===null&&oldBatcher.indexBuffer===null&&oldBatcher.geometry===null).toBe(true);
  const next=materialize(sys,context);expect(next.data===first.data).toBe(true);expect(next.payload).toEqual(first.payload);
  expect(next.data.batcher!==oldBatcher&&next.data.instructions!==oldInstructions).toBe(true);
  expect(texture.destroyed).toBe(false);
 }finally{cleanup(()=>{if(!context.destroyed)context.destroy();},()=>sys.destroy(),()=>texture.destroy(true));}
});

it('unrelated live render data and shared Graphics borrowers survive another owner retirement and dirty rebuild',()=>{
 const sys=system(),texture=new PIXI.Texture({source:new PIXI.TextureSource({width:16,height:16})}),shared=draw(texture),retired=draw(texture);
 const current=new PIXI.Graphics({context:shared}),borrower=new PIXI.Graphics({context:shared});
 try{
  const live=materialize(sys,shared),old=materialize(sys,retired),liveBatcher=live.data.batcher,liveInstructions=live.data.instructions,liveShader=liveBatcher.shader;
  const liveDestroy=vi.spyOn(liveBatcher,'destroy'),liveSetDestroy=vi.spyOn(liveInstructions,'destroy'),shaderDestroy=vi.spyOn(liveShader,'destroy'),sharedDestroy=vi.spyOn(shared,'destroy');
  retired.destroy();expect(old.data.batcher===null&&old.data.instructions===null).toBe(true);
  expect(liveDestroy).not.toHaveBeenCalled();expect(liveSetDestroy).not.toHaveBeenCalled();expect(shaderDestroy).not.toHaveBeenCalled();
  borrower.destroy();expect(sharedDestroy).not.toHaveBeenCalled();expect(current.context===shared&&!current.destroyed).toBe(true);
  expect(materialize(sys,shared).payload).toEqual(live.payload);
  shared.rect(900,0,3,3).fill({texture,color:0x456789,alpha:.5});
  const rebuilt=materialize(sys,shared);expect(rebuilt.payload.vertices.length).toBeGreaterThan(live.payload.vertices.length);
  expect(shaderDestroy).not.toHaveBeenCalled();expect(texture.destroyed).toBe(false);
 }finally{cleanup(()=>{if(!borrower.destroyed)borrower.destroy();},()=>{if(!current.destroyed)current.destroy();},()=>{if(!retired.destroyed)retired.destroy();},()=>{if(!shared.destroyed)shared.destroy();},()=>sys.destroy(),()=>texture.destroy(true));}
});

it('throwing reset attempts both owned disposers, preserves first error and never publishes the item',()=>{
 const pool=new PIXI.Pool(PIXI.GraphicsContextRenderData),data=pool.get({maxTextures:16}) as ResetData;
 const batcher=data.batcher,instructions=data.instructions,first=Error('batcher failure'),second=Error('instructions failure');
 const batcherSpy=vi.spyOn(batcher,'destroy').mockImplementation(()=>{expect(data.batcher===null&&data.instructions===null).toBe(true);throw first;});
 const instructionsSpy=vi.spyOn(instructions,'destroy').mockImplementation(()=>{expect(data.batcher===null&&data.instructions===null).toBe(true);throw second;});
 try{
  let thrown:unknown;try{pool.return(data);}catch(error){thrown=error;}
  expect(thrown===first).toBe(true);expect(batcherSpy).toHaveBeenCalledTimes(1);expect(instructionsSpy).toHaveBeenCalledTimes(1);
  expect(pool.totalFree).toBe(0);expect(pool.totalUsed).toBe(1);
 }finally{cleanup(()=>batcher.destroy(),()=>instructions.destroy(),()=>data.reset());}
});

it('32 to 16 checkout adapts freshly recreated cached shader while another 32-texture owner stays usable',()=>{
 const sys32=system(32),sys16=system(16),texture=new PIXI.Texture({source:new PIXI.TextureSource({width:16,height:16})});
 const retired=draw(texture),liveContext=draw(texture),nextContext=draw(texture);
 try{
  const old=materialize(sys32,retired),live=materialize(sys32,liveContext),shader32=live.data.batcher.shader;
  expect(shader32.maxTextures).toBe(32);const shaderDestroy=vi.spyOn(shader32,'destroy');
  retired.unload();const next=materialize(sys16,nextContext);
  expect(next.data===old.data).toBe(true);expect(next.payload).toEqual(old.payload);
  expect(next.data.batcher.maxTextures).toBe(16);expect(next.data.batcher.shader.maxTextures).toBe(16);
  expect(live.data.batcher.shader===shader32&&shader32.maxTextures===32).toBe(true);expect(shaderDestroy).not.toHaveBeenCalled();
  expect(materialize(sys32,liveContext).payload).toEqual(live.payload);
 }finally{cleanup(()=>{if(!retired.destroyed)retired.destroy();},()=>{if(!liveContext.destroyed)liveContext.destroy();},()=>{if(!nextContext.destroyed)nextContext.destroy();},()=>sys32.destroy(),()=>sys16.destroy(),()=>texture.destroy(true));}
});
