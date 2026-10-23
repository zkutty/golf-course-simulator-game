import * as PIXI from "pixi.js";
import {createHoleMarkersSceneSystem} from "../../src/ui/renderer/scenes/holeMarkersScene";
import {SceneSystemHost} from "../../src/ui/renderer/SceneSystemHost";
import {RenderRevisionTracker,holeMarkersRevisionDependencies,type RenderSnapshot} from "../../src/game/render/renderSnapshot";
import {dailyPinProofPayload} from "../../src/game/testing/zk1142PinFixture";
import {resolveCourseSetup} from "../../src/game/models/courseSetup";
import {tileCenterIso,type IsoRotation} from "../../src/game/render/iso";
import type {PinRotation} from "../../src/game/models/types";
const app=new PIXI.Application();await app.init({width:1200,height:900,background:0x356f46,resolution:devicePixelRatio,autoDensity:true,preference:"webgl"});document.body.appendChild(app.canvas);
const decals=new PIXI.Container(),objects=new PIXI.Container();app.stage.addChild(decals,objects);
const scene=createHoleMarkersSceneSystem(decals,objects),host=new SceneSystemHost([scene]),tracker=new RenderRevisionTracker(),height=()=>0;
const source=dailyPinProofPayload().course;
function render(pin:PinRotation,rotation:IsoRotation,zoom:number,partial=false,showMarkers=true){
 const holes=partial?source.holes.map((h,i)=>({...h,pinPositions:{...h.pinPositions,B:i%2?null:h.pinPositions!.B,C:i%3?null:h.pinPositions!.C}})):source.holes;
 const course={...source,holes,activePinRotation:pin};
 const input={holes,activePinRotation:pin,draftTee:null,draftGreen:null,selectedTeeSet:"member" as const,showMarkers,rotation,surfaceHeightAt:height,flagColor:"#d9534f",animationsEnabled:false,reducedMotion:true};
 const snapshot={...input,course,obstacles:[],effectiveTiles:course.tiles,graphicsQuality:"high",colorVision:"standard",showObstacles:true,atlasRevision:0,surveyMode:false,worldSeed:1142,revisions:tracker.update({holeMarkers:holeMarkersRevisionDependencies(input)})} as RenderSnapshot;
 const rendered=host.sync(snapshot),repeat=host.sync(snapshot);
 const expected=holes.map(h=>{const p=resolveCourseSetup(h,"member",pin).pin!;return tileCenterIso(p.x,p.y,0,rotation)});
 const flags=objects.children.filter(c=>c.label==="hole-pin-flag").map(c=>({x:c.x,y:c.y}));
 const bounds=objects.getLocalBounds();app.stage.scale.set(zoom);app.stage.position.set(600-(bounds.x+bounds.width/2)*zoom,450-(bounds.y+bounds.height/2)*zoom);app.render();
 return {pin,rotation,zoom,partial,showMarkers,rendered,repeat,flags,expected,flagCount:scene.flagCount(),markerCount:scene.markerCount(),rebuilds:scene.rebuildCount(),renderer:app.renderer.type};
}
Object.assign(window,{zk1142Native:{render}});render("A",0,1);
