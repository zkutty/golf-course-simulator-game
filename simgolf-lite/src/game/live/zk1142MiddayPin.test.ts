import {describe,it,expect} from "vitest";
import {DEFAULT_WORLD} from "../models/defaults";
import type {Course,Terrain} from "../models/types";
import {createLiveState,stepLive,reconcileGolfers} from "./simulation";
import {advanceGolfer} from "./golfer";
import {restoreLiveSimulation,snapshotLiveSimulation} from "./persistence";
import {recordLivingClubRound,normalizeLivingClub} from "../livingClub/livingClub";
import {canonicalJson} from "../../utils/canonical";
import type {Golfer,LiveState} from "./types";
import type {CompletedRound} from "../retention/types";
import {frozenCompletedPin,requestedPinForHole} from "./pinSetup";

function course():Course {
  const width=60,height=24,tiles:Terrain[]=Array(width*height).fill("fairway");
  const holes=[5,12,19].map((y,index)=>{
    const tee={x:4,y},green={x:50,y};tiles[y*width+4]="tee";
    for(let dy=-2;dy<=2;dy++)for(let dx=-3;dx<=3;dx++)tiles[(y+dy)*width+50+dx]="green";
    return {id:`pin-hole-${index+1}`,name:`Hole ${index+1}`,tee,green,parMode:"AUTO" as const,pinPositions:{A:green,B:{x:49,y},C:{x:51,y}}};
  });
  return {name:"Daily pin reconciliation proof",width,height,tiles,elevations:Array(width*height).fill(0),holes,buildings:[],obstacles:[],yardsPerTile:10,condition:.8,baseGreenFee:65,activePinRotation:"A"};
}
function spawned() {
  const initial=course(),live=createLiveState(initial,{...DEFAULT_WORLD,runSeed:1142},0);
  live.arrivals=[{atMinute:0,archetype:"casual"}];live.nextArrivalIdx=0;live.nextTeeFreeAt=0;
  stepLive(live,initial,1);const golfer=live.golfers[0];expect(golfer).toBeDefined();
  return {initial,live,golfer};
}
function advanceToScored(golfer:Golfer,count:number,condition:number) {
  let guard=0;while(golfer.scoredHoles<count&&!golfer.finished&&guard++<10000)advanceGolfer(golfer,2,condition);
  expect(golfer.scoredHoles).toBe(count);expect(golfer.finished).toBe(false);
}
function scoredBytes(golfer:Golfer) {
  const plans=golfer.holePlans?.slice(0,golfer.scoredHoles)??[],ids=new Set(plans.map(plan=>plan.holeId));
  return canonicalJson({par:golfer.holePar.slice(0,golfer.scoredHoles),strokes:golfer.holeStrokes.slice(0,golfer.scoredHoles),scoreToPar:golfer.scoreToPar,
    plans,reactions:golfer.holeReactions?.slice(0,golfer.scoredHoles),outcomes:golfer.shotOutcomes?.filter(outcome=>ids.has(outcome.holeId))});
}
function snapshot(live:LiveState) {return snapshotLiveSimulation({state:live,pendingCash:0,speed:"paused",selectedGolferId:null});}
describe("ZK1142 midday daily-pin reconciliation",()=>{
  it("preserves exact scored evidence through A→B→save/reload→C and records mixed setup truthfully",()=>{
    const {initial,live,golfer}=spawned();expect(golfer.pinRotation).toBe("A");
    advanceToScored(golfer,1,initial.condition);const first=scoredBytes(golfer);
    const next={...initial,activePinRotation:"B" as const};reconcileGolfers(live,next,"daily-pin");
    expect(scoredBytes(golfer)).toBe(first);expect(golfer.pinRotation).toBe("B");
    expect(golfer.pinRotationsByHole).toEqual({"pin-hole-1":"A","pin-hole-2":"B","pin-hole-3":"B"});
    const restored=restoreLiveSimulation(JSON.parse(JSON.stringify(snapshot(live))))!;expect(restored).not.toBeNull();
    const active=restored.state.golfers[0];expect(scoredBytes(active)).toBe(first);expect(active.pinRotation).toBe("B");expect(active.pinRotationsByHole).toEqual(golfer.pinRotationsByHole);
    advanceToScored(active,2,initial.condition);const second=scoredBytes(active);
    const final={...next,activePinRotation:"C" as const};reconcileGolfers(restored.state,final,"daily-pin");
    expect(scoredBytes(active)).toBe(second);expect(active.pinRotationsByHole).toEqual({"pin-hole-1":"A","pin-hole-2":"B","pin-hole-3":"C"});expect(active.pinRotation).toBe("C");
    const completed:CompletedRound[]=[];let guard=0;while(!active.finished&&guard++<10000)completed.push(...stepLive(restored.state,final,2).completedRounds);
    expect(completed).toHaveLength(1);expect(completed[0].pinRotation).toBeUndefined();expect(completed[0].pinRotationsByHole).toEqual(active.pinRotationsByHole);
    expect(canonicalJson(completed[0].shotOutcomes?.filter(outcome=>outcome.holeId==="pin-hole-1"))).toBe(canonicalJson(golfer.shotOutcomes?.filter(outcome=>outcome.holeId==="pin-hole-1")));
    const world={...DEFAULT_WORLD,runSeed:1142};const worldBytes=canonicalJson(world);
    const recorded=recordLivingClubRound(world,final,completed[0],0);expect(canonicalJson(world)).toBe(worldBytes);
    const evidence=normalizeLivingClub(recorded.livingClub).architecture.evidence;expect(evidence.length).toBeGreaterThan(0);
    for(const shot of evidence)expect(shot.pinRotation).toBe(active.pinRotationsByHole![shot.holeId]);
    const finishedBytes=canonicalJson(active),historyBytes=canonicalJson(completed),recordedBytes=canonicalJson(recorded);
    reconcileGolfers(restored.state,{...final,activePinRotation:"A"},"daily-pin");
    expect(canonicalJson(active)).toBe(finishedBytes);expect(canonicalJson(completed)).toBe(historyBytes);expect(canonicalJson(recorded)).toBe(recordedBytes);
  });
  it("keeps geometry-only behavior and frozen tournament/entrant setups",()=>{
    for(const lock of [undefined,"tournamentId","tournamentEntrantId"] as const){
      const {initial,live,golfer}=spawned();advanceToScored(golfer,1,initial.condition);const before=scoredBytes(golfer),map=canonicalJson(golfer.pinRotationsByHole);
      if(lock)golfer[lock]="locked";
      reconcileGolfers(live,{...initial,activePinRotation:"B"},lock?"daily-pin":"geometry");
      expect(golfer.pinRotation).toBe("A");expect(canonicalJson(golfer.pinRotationsByHole)).toBe(map);expect(scoredBytes(golfer)).toBe(before);
    }
  });
  it("uses the actual tournament arrival override as a frozen requested setup",()=>{
    const initial=course(),live=createLiveState(initial,{...DEFAULT_WORLD,runSeed:1142},0);
    live.arrivals=[{atMinute:0,archetype:"casual",tournament:{eventId:"pin-event",entrantId:"pin-entrant",name:"Frozen entrant",skill:.7,teeSet:"member",pinRotation:"C"}}];live.nextArrivalIdx=0;live.nextTeeFreeAt=0;
    stepLive(live,initial,1);const golfer=live.golfers[0];expect(golfer.pinRotation).toBe("C");expect(golfer.pinRotationsByHole).toEqual({"pin-hole-1":"C","pin-hole-2":"C","pin-hole-3":"C"});
    advanceToScored(golfer,1,initial.condition);const before=scoredBytes(golfer),map=canonicalJson(golfer.pinRotationsByHole);
    reconcileGolfers(live,{...initial,activePinRotation:"B"},"daily-pin");
    expect(golfer.pinRotation).toBe("C");expect(canonicalJson(golfer.pinRotationsByHole)).toBe(map);expect(scoredBytes(golfer)).toBe(before);
    const restored=restoreLiveSimulation(JSON.parse(JSON.stringify(snapshot(live))))!;expect(restored.state.golfers[0].pinRotation).toBe("C");expect(restored.state.golfers[0].pinRotationsByHole).toEqual(golfer.pinRotationsByHole);
  });
  it("initializes absent legacy maps only on the first daily switch",()=>{
    const {initial,live,golfer}=spawned();delete golfer.pinRotationsByHole;
    const legacy=restoreLiveSimulation(JSON.parse(JSON.stringify(snapshot(live))))!;expect(legacy).not.toBeNull();expect(legacy.state.golfers[0].pinRotationsByHole).toBeUndefined();
    reconcileGolfers(legacy.state,initial);expect(legacy.state.golfers[0].pinRotationsByHole).toBeUndefined();
    advanceToScored(legacy.state.golfers[0],1,initial.condition);const before=scoredBytes(legacy.state.golfers[0]);
    reconcileGolfers(legacy.state,{...initial,activePinRotation:"B"},"daily-pin");
    expect(scoredBytes(legacy.state.golfers[0])).toBe(before);expect(legacy.state.golfers[0].pinRotationsByHole).toEqual({"pin-hole-1":"A","pin-hole-2":"B","pin-hole-3":"B"});
  });
  it("rejects a sparse mixed setup rather than relabeling old A shots as a uniform round",()=>{
    const {initial,live,golfer}=spawned();advanceToScored(golfer,1,initial.condition);
    reconcileGolfers(live,{...initial,activePinRotation:"B"},"daily-pin");
    const input=JSON.parse(JSON.stringify(snapshot(live)));input.state.golfers[0].pinRotationsByHole={"pin-hole-1":"A"};
    expect(restoreLiveSimulation(input)).toBeNull();
  });
  it("rejects malformed, extra and prototype keys without changing the original state",()=>{
    const {live}=spawned();const source=snapshot(live),before=canonicalJson(source);
    for(const map of [null,{"pin-hole-1":"A"},{"pin-hole-1":"D"},{"unbooked":"B"},["A"],JSON.parse('{"__proto__":"B"}'),{"constructor":"B"},{"prototype":"C"}]){
      const input=structuredClone(source);input.state.golfers[0].pinRotationsByHole=map as Record<string,"A"|"B"|"C">;
      expect(restoreLiveSimulation(input)).toBeNull();expect(canonicalJson(source)).toBe(before);
    }
    expect(requestedPinForHole(Object.create({"pin-hole-1":"B"}) as Record<string,"B">,"pin-hole-1")).toBeUndefined();
    expect(frozenCompletedPin({"pin-hole-1":"A","pin-hole-2":"A"},"A")).toBe("A");expect(frozenCompletedPin({"pin-hole-1":"A","pin-hole-2":"B"},"B")).toBeUndefined();
  });
});
