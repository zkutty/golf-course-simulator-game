import * as PIXI from "pixi.js";
import "pixi.js/unsafe-eval";
type BatchView = { textures: unknown; size: number };
type BatcherView = { batches: BatchView[]; batchIndex: number; geometry: { indexBuffer: { destroyed: boolean } } };
type RendererView = { renderPipes: { batch: { _activeBatch: BatcherView } } | null };
const BASELINE_OPTIONS = true;
const LOCAL_CLEANUP_OPTIONS = { removeView: true, releaseGlobalResources: false };
export const runOwnershipControl = async (mode: "baseline" | "candidate", sourceOptions: boolean | { removeView: boolean, releaseGlobalResources: boolean }) => {
  const a = new PIXI.Application(); const b = new PIXI.Application();
  await a.init({ width: 96, height: 96, preference: "webgl", autoStart: false, sharedTicker: false, backgroundColor: 0x000000 });
  await b.init({ width: 96, height: 96, preference: "webgl", autoStart: false, sharedTicker: false, backgroundColor: 0x000000 });
  document.body.append(a.canvas, b.canvas);
  const first = new PIXI.Graphics().rect(2, 2, 28, 28).fill(0xff0000);
  const second = new PIXI.Graphics().rect(36, 2, 28, 28).fill(0x00ff00); second.blendMode = "add";
  a.stage.addChild(first, second);
  const ownedCanvas = document.createElement("canvas"); ownedCanvas.width = 8; ownedCanvas.height = 8;
  ownedCanvas.getContext("2d")!.fillRect(0,0,8,8);
  const ownedTexture = PIXI.Texture.from(ownedCanvas);
  const ownedSource = ownedTexture.source;
  const ownedSprite = new PIXI.Sprite(ownedTexture); b.stage.addChild(ownedSprite);
  b.render();
  a.render();
  const rebuild = () => { const changed = new PIXI.Container(); a.stage.addChild(changed); changed.destroy(); a.render(); };
  rebuild();
  const sample = async () => {
    const { pixels, width } = await a.renderer.extract.pixels({ target: a.stage });
    const at = (x: number,y: number) => Array.from(pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
    return { red: at(10,10), green: at(45,10) };
  };
  const pixelsBefore = await sample(); rebuild();
  const batcher = (a.renderer as unknown as RendererView).renderPipes!.batch._activeBatch;
  const borrowed = batcher.batches.slice(0, batcher.batchIndex);
  const before = borrowed.map((batch: BatchView) => ({ texturesPresent: batch.textures !== null, size: batch.size }));
  const rendererB = b.renderer as unknown as RendererView; const canvasB = b.canvas;
  const bufferB = rendererB.renderPipes!.batch._activeBatch.geometry.indexBuffer;
  const stageB = b.stage; let releases = 0;
  const observer = { clear() { releases++; } }; PIXI.GlobalResourceRegistry.register(observer);
  b.destroy(mode === "baseline" ? BASELINE_OPTIONS : sourceOptions, { children: true, texture: true, textureSource: true });
  const local = { canvasRemoved: !canvasB.isConnected, stageDestroyed: stageB.destroyed, spriteDestroyed: ownedSprite.destroyed, textureDestroyed: ownedTexture.destroyed, sourceDestroyed: ownedSource.destroyed, bufferDestroyed: bufferB.destroyed, rendererPipesReleased: rendererB.renderPipes === null };
  const afterPeer = borrowed.map((batch: BatchView) => ({ texturesPresent: batch.textures !== null }));
  let error: {message:string;stack?:string}|null = null;
  try { rebuild(); } catch (caught: unknown) { if (!(caught instanceof Error)) throw caught; error = { message: caught.message, stack: caught.stack }; }
  const survivor = { canvasConnected: a.canvas.isConnected, instructionCount: (a.renderer as unknown as RendererView).renderPipes!.batch._activeBatch.batchIndex, alive: a.renderer !== null };
  const pixelsAfter = mode === "candidate" && error === null ? await sample() : null;
  const result = { pixelsBefore, pixelsAfter, mode, version: PIXI.VERSION, rendererType: a.renderer.type, before, afterPeer, releases, local, survivor, error };
  PIXI.GlobalResourceRegistry.unregister(observer);
  a.destroy(LOCAL_CLEANUP_OPTIONS, { children: true, texture: false, textureSource: false });
  return result;
};

declare global { interface Window { runOwnershipControl: typeof runOwnershipControl } }
window.runOwnershipControl = runOwnershipControl;
