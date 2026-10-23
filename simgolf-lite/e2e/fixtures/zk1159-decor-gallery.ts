import * as PIXI from "pixi.js";
import { DEFAULT_STATE } from "../../src/game/gameState";
import { DECORATION_KINDS } from "../../src/game/models/decorations";
import type { Course, LandTheme } from "../../src/game/models/types";
import { seasonalVisualState } from "../../src/game/presentation/seasonalVisualState";
import { createStructuresPropsSceneSystem } from "../../src/ui/renderer/scenes/structuresPropsScene";
import type { RenderSnapshot } from "../../src/ui/renderer/RenderSnapshot";
import { loadAtlases } from "../../src/render/atlas";

const params = new URLSearchParams(location.search);
const resolution = Number(params.get("dpr") ?? 1);
const app = new PIXI.Application();
await app.init({ width: 1000, height: 760, resolution, backgroundAlpha: 0, preference: "webgl", autoStart: false });
document.body.appendChild(app.canvas);
const cells = DECORATION_KINDS.map((kind, index) => {
  const cell = new PIXI.Container();
  cell.position.set(125 + index % 4 * 250, 200 + Math.floor(index / 4) * 250);
  const decals = new PIXI.Container(), objects = new PIXI.Container();
  cell.addChild(decals, objects);app.stage.addChild(cell);
  return { kind, cell, objects, decals, system: createStructuresPropsSceneSystem(objects, decals) };
});
const images = new Map<string, HTMLCanvasElement>();
async function sourceMask(frame: string) {
  if (!images.has(frame)) {
    const image = new Image();image.src = `/src/assets/sprites/${frame}.png`;await image.decode();
    const canvas = document.createElement("canvas");canvas.width = image.width;canvas.height = image.height;
    canvas.getContext("2d")!.drawImage(image, 0, 0);images.set(frame, canvas);
  }
  return images.get(frame)!;
}
let revision = 0;
async function run(theme: LandTheme, quality: "high" | "medium" | "low", seasonIndex: number, rotation: 0 | 90 | 180 | 270, zoom = 1, pixelCheck = false) {
  const courseBase: Course = { ...DEFAULT_STATE.course, theme, buildings: [], obstacles: [], decorations: [] };
  const world = { ...DEFAULT_STATE.world, week: seasonIndex * 8 + 3 };
  const seasonal = seasonalVisualState({ course: courseBase, world, day: 1 });
  const loaded = await loadAtlases(theme, quality, seasonal.climate.calendar.season);
  if (loaded.status !== "activated") throw new Error(`Native atlas activation failed: ${loaded.status}`);
  const records = [];
  for (const {kind, cell, objects, decals, system} of cells) {
    const previous = [...objects.children, ...decals.children];
    const course: Course = { ...courseBase, decorations: [{kind, x: 8, y: 8, rotation: (rotation / 90) as 0 | 1 | 2 | 3, span: 3, origin: "player"}] };
    const snapshot: RenderSnapshot = {
      course, obstacles: [], effectiveTiles: course.tiles, holes: [], draftTee: null, draftGreen: null, rotation, graphicsQuality: quality,
      seasonalVisualState: seasonal, colorVision: "standard", reducedMotion: true, animationsEnabled: false, showObstacles: true,
      atlasRevision: ++revision, surveyMode: false, worldSeed: 42, surfaceHeightAt: () => 0,
      revisions: {atmosphere:0,surfaceCare:0,structuresProps:revision,playerProCollection:0,naturalProps:0,overlaysDiagnostics:0,estateSurvey:0},
    };
    system.update!(snapshot);
    if(objects.children.length !== 1 || decals.children.length !== 1 || !previous.every(p => p.destroyed && p.parent === null)) throw new Error(`${kind}: native scene ownership failure`);
    const sprite = objects.children[0] as PIXI.Sprite;
    const shadow = decals.children[0];
    if(sprite.anchor.x !== 0.5 || sprite.anchor.y !== 1 || shadow.x !== sprite.x + 3 || shadow.y !== sprite.y - 14) throw new Error(`${kind}: native ground anchor or shadow failure`);
    // Gallery parent translation does not alter authoritative object coordinates.
    objects.position.set(-sprite.x, -sprite.y);decals.position.copyFrom(objects.position);
    cell.scale.set(zoom);
    let outsidePixels = 0, opaquePixels = 0;
    if(pixelCheck) {
      const nativeScale = {x:sprite.scale.x,y:sprite.scale.y};
      sprite.scale.set(nativeScale.x * zoom, nativeScale.y * zoom);
      const raster = app.renderer.extract.canvas({target: objects, resolution});
      sprite.scale.set(nativeScale.x, nativeScale.y);
      const mask = document.createElement("canvas");mask.width = raster.width;mask.height = raster.height;
      const context = mask.getContext("2d")!;
      context.imageSmoothingEnabled = sprite.texture.source.style.scaleMode !== "nearest";
      if(sprite.scale.x < 0) {context.translate(mask.width, 0);context.scale(-1, 1);}
      context.drawImage(await sourceMask(`${theme}_${kind}`), 0, 0, mask.width, mask.height);
      const expected = context.getImageData(0,0,mask.width,mask.height).data;
      const actual = (raster as HTMLCanvasElement).getContext("2d")!.getImageData(0,0,mask.width,mask.height).data;
      for(let y=0;y<mask.height;y++)for(let x=0;x<mask.width;x++) {
        if(actual[(y*mask.width+x)*4+3] < 8)continue;
        opaquePixels++;
        let supported=false;
        // Two device pixels account for GPU/Canvas filter and raster rounding.
        for(let dy=-2;dy<=2&&!supported;dy++)for(let dx=-2;dx<=2&&!supported;dx++){
          const xx=x+dx, yy=y+dy;
          supported=xx>=0&&xx<mask.width&&yy>=0&&yy<mask.height&&expected[(yy*mask.width+xx)*4+3]>0;
        }
        if(!supported)outsidePixels++;
      }
      if(outsidePixels || !opaquePixels)throw new Error(`${kind}: ${outsidePixels} GPU pixels outside independently decoded source alpha`);
    }
    records.push({kind,anchor:{x:sprite.x,y:sprite.y},shadow:{x:shadow.x,y:shadow.y},frame:sprite.texture.frame,orig:sprite.texture.orig,trim:sprite.texture.trim,opaquePixels,outsidePixels});
  }
  app.renderer.render(app.stage);
  document.getElementById("status")!.textContent = `${theme} / ${quality} / ${seasonal.climate.calendar.season} / ${rotation}° / ${zoom}× / DPR ${resolution}`;
  return {theme,quality,season:seasonal.climate.calendar.season,rotation,zoom,resolution,records};
}
await run("parkland", "high", 1, 0);
Object.assign(window, { zk1159Gallery: {run} });
