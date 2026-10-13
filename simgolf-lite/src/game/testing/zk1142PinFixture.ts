import type {Course,Terrain} from "../models/types";
import {DEFAULT_WORLD} from "../models/defaults";
/** Real SaveStore/browser fixture: nine booked holes, seeded ordinary live play. */
export function dailyPinProofPayload(){
 const width=60,height=72,tiles:Terrain[]=Array(width*height).fill("fairway");
 const holes=Array.from({length:9},(_,index)=>{const y=8+index*6,tee={x:4,y},green={x:50,y};tiles[y*width+4]="tee";for(let dy=-2;dy<=2;dy++)for(let dx=-3;dx<=3;dx++)tiles[(y+dy)*width+50+dx]="green";return {id:`pin-proof-${index+1}`,name:`Pin Proof ${index+1}`,tee,green,parMode:"AUTO" as const,pinPositions:{A:green,B:{x:49,y},C:{x:51,y}}};});
 const ids=holes.map(h=>h.id);
 const course:Course={name:"Daily Pin Proof Nine",width,height,tiles,elevations:Array(width*height).fill(0),holes,buildings:[],obstacles:[],yardsPerTile:10,condition:.8,baseGreenFee:65,activePinRotation:"A",layouts:[{id:"pin-proof-nine",name:"Pin Proof Nine",draftHoleIds:ids,publishedHoleIds:ids,roundLength:9,state:"open",greenFee:65}]};
 return {course,world:{...DEFAULT_WORLD,runSeed:1142,cash:250000,sandbox:true},history:[]};
}
