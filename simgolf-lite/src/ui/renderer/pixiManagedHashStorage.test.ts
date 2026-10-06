import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import * as PIXI from 'pixi.js';
type Hash=PIXI.GCManagedHash<PIXI.GraphicsContext>;
let uid=9800;
function cleanup(...actions:(()=>void)[]){vi.restoreAllMocks();let failed=false,first:unknown;for(const action of actions)try{action();}catch(error){if(!failed){failed=true;first=error;}}if(failed)throw first;}
function host(){let captured:Hash|undefined;const renderer={uid:++uid,limits:{maxBatchableTextures:16},gc:{now:0,addResourceHash:(hash:Hash)=>{captured=hash;}}};const sys=new PIXI.GraphicsContextSystem(renderer as unknown as ConstructorParameters<typeof PIXI.GraphicsContextSystem>[0]);if(!captured)throw Error('Actual graphics registry not registered');return{sys,hash:captured,renderer};}
function draw(texture=PIXI.Texture.WHITE){const c=new PIXI.GraphicsContext();for(let i=0;i<200;i++)c.rect(i*3,i%7,2,4).fill({texture,color:0x345678,alpha:.26});return c;}
beforeEach(()=>{vi.spyOn(PIXI.DOMAdapter.get(),'createCanvas').mockReturnValue({getContext:()=>null} as unknown as ReturnType<ReturnType<typeof PIXI.DOMAdapter.get>['createCanvas']>);});
afterEach(()=>vi.restoreAllMocks());
it('64 actual context builds and ordinary destroys leave zero own registry keys while live shared geometry survives',()=>{const h=host(),texture=new PIXI.Texture({source:new PIXI.TextureSource({width:16,height:16})}),live=draw(texture);const contexts:PIXI.GraphicsContext[]=[];try{const liveGpu=h.sys.updateGpuContext(live),vertices=[...liveGpu.geometryData.vertices];for(let i=0;i<64;i++){const c=draw(texture);contexts.push(c);h.sys.updateGpuContext(c);expect(h.hash.items[c.uid]===c).toBe(true);c.destroy();expect(Object.hasOwn(h.hash.items,c.uid)).toBe(false);}expect(Object.keys(h.hash.items)).toEqual([String(live.uid)]);expect(h.sys.getGpuContext(live)===liveGpu).toBe(true);expect(liveGpu.geometryData.vertices).toEqual(vertices);expect(texture.destroyed||texture.source.destroyed).toBe(false);live.destroy();expect(Object.keys(h.hash.items)).toHaveLength(0);}finally{cleanup(...contexts.map(c=>()=>{if(!c.destroyed)c.destroy();}),()=>{if(!live.destroyed)live.destroy();},()=>h.sys.destroy(),()=>texture.destroy(true));}});
it('same UID unload and rebuild readds once with normal single unload listener',()=>{const h=host(),c=draw();try{const first=h.sys.updateGpuContext(c),id=c.uid;expect(c.listenerCount('unload')).toBe(1);c.unload();expect(Object.hasOwn(h.hash.items,id)).toBe(false);expect(c.listenerCount('unload')).toBe(0);const next=h.sys.updateGpuContext(c);expect(c.uid).toBe(id);expect(next===first).toBe(false);expect(c._gpuData[h.renderer.uid]===next).toBe(true);expect(Object.keys(c._gpuData)).toEqual([String(h.renderer.uid)]);expect(h.hash.items[id]===c).toBe(true);expect(h.hash.add(c)).toBe(false);expect(c.listenerCount('unload')).toBe(1);c.unload();expect(Object.keys(h.hash.items)).toHaveLength(0);}finally{cleanup(()=>c.destroy(),()=>h.sys.destroy());}});
it('missing slot and throwing GPU destroy retain key and preserve original operation ordering',()=>{const h=host(),c=draw();try{const gpu=h.sys.updateGpuContext(c),error=Error('gpu destroy failure');const off=vi.spyOn(c,'off'),destroy=vi.spyOn(gpu,'destroy').mockImplementation(()=>{expect(off).toHaveBeenCalled();throw error;});let thrown:unknown;try{h.hash.remove(c);}catch(e){thrown=e;}expect(thrown===error).toBe(true);expect(h.hash.items[c.uid]===c&&c._gpuData[h.renderer.uid]===gpu).toBe(true);destroy.mockRestore();off.mockRestore();h.hash.remove(c);expect(c._gpuData[h.renderer.uid]===undefined).toBe(true);expect(Object.hasOwn(c._gpuData,h.renderer.uid)).toBe(false);expect(Object.hasOwn(h.hash.items,c.uid)).toBe(false);expect(h.hash.add(c)).toBe(true);const offMissing=vi.spyOn(c,'off');h.hash.remove(c);expect(offMissing).not.toHaveBeenCalled();expect(h.hash.items[c.uid]===c).toBe(true);}finally{cleanup(()=>c.destroy(),()=>h.sys.destroy());}});
it('onUnload failure precedes listener removal and GPU destruction and retains slot and key',()=>{const h=host(),c=draw();let secondary:Hash|undefined;try{const gpu=h.sys.updateGpuContext(c),error=Error('onUnload failure');let fail=true;secondary=new PIXI.GCManagedHash({renderer:h.renderer as unknown as ConstructorParameters<typeof PIXI.GraphicsContextSystem>[0],type:'resource',name:'ordering-contract',onUnload:()=>{if(fail)throw error;}});secondary.add(c);const off=vi.spyOn(c,'off'),destroy=vi.spyOn(gpu,'destroy');let thrown:unknown;try{secondary.remove(c);}catch(e){thrown=e;}expect(thrown===error).toBe(true);expect(off).not.toHaveBeenCalled();expect(destroy).not.toHaveBeenCalled();expect(secondary.items[c.uid]===c&&c._gpuData[h.renderer.uid]===gpu).toBe(true);fail=false;secondary.remove(c);expect(Object.hasOwn(secondary.items,c.uid)).toBe(false);expect(c._gpuData[h.renderer.uid]===undefined).toBe(true);expect(Object.hasOwn(c._gpuData,h.renderer.uid)).toBe(false);}finally{cleanup(()=>c.destroy(),()=>secondary?.destroy(),()=>h.sys.destroy());}});

it('128 ordinary renderer retirements remove their shared-context keys while one live renderer survives', () => {
  const live = host();
  const texture = new PIXI.Texture({source: new PIXI.TextureSource({width: 16, height: 16})});
  const shared = draw(texture);
  const retired: ReturnType<typeof host>[] = [];
  try {
    const dictionary = shared._gpuData;
    const survivor = live.sys.updateGpuContext(shared);
    const vertices = [...survivor.geometryData.vertices];
    const remaining: number[] = [];
    for (let i = 0; i < 128; i++) {
      const next = host();
      retired.push(next);
      const payload = next.sys.updateGpuContext(shared);
      expect(payload === survivor).toBe(false);
      expect(shared.listenerCount('unload')).toBe(2);
      next.sys.destroy();
      remaining.push(Object.keys(dictionary).length);
      expect(shared._gpuData === dictionary).toBe(true);
      expect(live.sys.getGpuContext(shared) === survivor).toBe(true);
      expect(survivor.geometryData.vertices).toEqual(vertices);
      expect(shared.listenerCount('unload')).toBe(1);
      expect(shared.destroyed || texture.destroyed || texture.source.destroyed).toBe(false);
    }
    expect(remaining).toEqual(Array(128).fill(1));
    for (const next of retired) {
      expect(Object.hasOwn(dictionary, next.renderer.uid)).toBe(false);
      expect(dictionary[next.renderer.uid]).toBeUndefined();
    }
    live.sys.destroy();
    expect(Object.keys(dictionary)).toHaveLength(0);
    expect(shared.destroyed || texture.destroyed || texture.source.destroyed).toBe(false);
  } finally {
    cleanup(...retired.map(next => () => next.sys.destroy()), () => shared.destroy(), () => live.sys.destroy(), () => texture.destroy(true));
  }
});

it('removing one TextureSource owner preserves the other slot and cleanup sees the retiring payload', () => {
  const left = host(), right = host();
  const source = new PIXI.TextureSource({width: 16, height: 16});
  const dictionary = source._gpuData;
  const first = new PIXI.GlTexture({} as WebGLTexture);
  const second = new PIXI.GlTexture({} as WebGLTexture);
  const order: string[] = [];
  const firstDestroy = first.destroy.bind(first);
  const destroy = vi.spyOn(first, 'destroy').mockImplementation(() => {
    order.push('destroy');
    expect(dictionary[left.renderer.uid] === first).toBe(true);
    expect(source.listenerCount('unload')).toBe(1);
    firstDestroy();
  });
  const survivorDestroy = vi.spyOn(second, 'destroy');
  const onUnload = vi.fn(() => {
    order.push('unload');
    expect(dictionary[left.renderer.uid] === first).toBe(true);
    expect(source.listenerCount('unload')).toBe(2);
  });
  const rendererType = left.renderer as unknown as ConstructorParameters<typeof PIXI.GraphicsContextSystem>[0];
  const leftHash = new PIXI.GCManagedHash<PIXI.TextureSource>({renderer: rendererType, type: 'resource', name: 'left-texture', onUnload});
  const rightHash = new PIXI.GCManagedHash<PIXI.TextureSource>({renderer: right.renderer as unknown as typeof rendererType, type: 'resource', name: 'right-texture'});
  dictionary[left.renderer.uid] = first;
  dictionary[right.renderer.uid] = second;
  try {
    leftHash.add(source);
    rightHash.add(source);
    leftHash.remove(source);
    expect(order).toEqual(['unload', 'destroy']);
    expect(onUnload).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(Object.hasOwn(dictionary, left.renderer.uid)).toBe(false);
    expect(dictionary[left.renderer.uid]).toBeUndefined();
    expect(source._gpuData === dictionary).toBe(true);
    expect(dictionary[right.renderer.uid] === second).toBe(true);
    expect(rightHash.items[source.uid] === source).toBe(true);
    expect(survivorDestroy).not.toHaveBeenCalled();
    expect(source.destroyed).toBe(false);
    expect(source.listenerCount('unload')).toBe(1);
    rightHash.destroy();
    expect(Object.keys(dictionary)).toHaveLength(0);
    expect(source.destroyed).toBe(false);
  } finally {
    cleanup(() => leftHash.destroy(), () => rightHash.destroy(), () => left.sys.destroy(), () => right.sys.destroy(), () => source.destroy());
  }
});
