import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FRAME, MODEL, HEAD_PROFILE, INSPECTION, DIRECTIONS, OUTCOMES, PHASES, DURATION, createState, advance, seek, phaseAt, phaseStart, bodyAngle, project, poseFor, skeletonFor, solveArm, footRoll, drawGolfer, measureGolferBounds, storyboardPosition } from './prototype.mjs';

test('one synthetic hole is 54 seconds, with contiguous deterministic phase boundaries', () => {
  assert.equal(DURATION, 54);
  let start = 0;
  for (const phase of PHASES) {
    assert.equal(phaseStart(phase.id), start);
    assert.equal(phaseAt(start).id, phase.id);
    assert.equal(phaseAt(start).progress, 0);
    assert.equal(phaseAt(start + phase.duration - 1e-6).id, phase.id);
    start += phase.duration;
  }
  assert.equal(phaseAt(DURATION).id, 'leave');
  assert.equal(phaseAt(DURATION).progress, 1);
  assert.throws(() => phaseStart('unrecorded-engine-shot'), RangeError);
});

test('pause holds both clock and phase; replay can restart the ended clock', () => {
  const paused = createState({ time: 12.5 });
  assert.equal(advance(paused, 3), paused);
  const end = advance({ ...paused, playing: true }, 100);
  assert.equal(end.time, DURATION);
  assert.equal(end.playing, false);
  assert.equal(advance(end, 10), end);
  const restarted = advance({ ...seek(end, 0), playing: true }, .5);
  assert.equal(restarted.time, .5);
});

test('1x, 2x and 4x operation tiers leave presentation time and pose identical', () => {
  const states = [1, 2, 4].map(tier => advance(createState({ tier, playing: true, time: 11 }), 2.26));
  for (const state of states) {
    assert.equal(state.time, 13.26);
    assert.equal(phaseAt(state.time).id, 'swing');
    assert.equal(phaseAt(state.time).progress.toFixed(2), '0.63');
    assert.deepEqual(poseFor('swing', phaseAt(state.time).progress), poseFor('swing', .63));
  }
});

test('clock and scrub guard negative, nonfinite and beyond-end inputs', () => {
  const state = createState({ time: 1, playing: true });
  for (const delta of [-10, NaN, Infinity]) assert.equal(advance(state, delta).time, 1);
  assert.equal(seek(state, -1).time, 0);
  assert.equal(seek(state, 100).time, 54);
  for (const value of [NaN, null, undefined, Infinity, -Infinity, 'not a number']) assert.equal(seek(state, value).time, 0);
  assert.equal(phaseAt(Infinity).id, 'arrive');
});

test('feet anchor matches legacy source contract and all octants rotate anatomical geometry', () => {
  assert.deepEqual(FRAME, { width: 48, height: 72, feetX: 24, feetY: 69, displayW: 26 });
  const angles = DIRECTIONS.map(direction => bodyAngle(direction, 'walk'));
  assert.equal(new Set(angles).size, 8);
  for (const direction of DIRECTIONS) {
    const facing = bodyAngle(direction, 'walk');
    assert.equal(bodyAngle(direction, 'swing'), (facing + 90) % 360);
    assert.equal(bodyAngle(direction, 'putt'), (facing + 90) % 360);
    const anchor = project({ s: 0, f: 0, h: 0 }, facing);
    assert.equal(anchor.x, 24); assert.equal(anchor.y, 69); assert.ok(Math.abs(anchor.depth) === 0);
  }
  assert.throws(() => bodyAngle('invented', 'walk'), RangeError);
  assert.ok(poseFor('swing', .42).club[0] < 0, 'takeaway is away from +S target');
  assert.ok(poseFor('swing', .85).club[0] > 0, 'follow-through is toward +S target');
  assert.ok(poseFor('swing', .63).handL[2] > poseFor('swing', .63).handR[2], 'left glove stays above right hand at contact');
});

test('finite responses return to rest without hops; reduced motion freezes secondary gait', () => {
  for (const outcome of OUTCOMES) {
    const start = poseFor('react', 0, outcome), end = poseFor('react', 1, outcome);
    assert.ok(Math.abs(end.headDrop - start.headDrop) < 1e-12);
    assert.ok(Math.abs(end.handR[2] - start.handR[2]) < 1e-12);
    assert.equal(start.bob, 0); assert.equal(end.bob, 0);
    assert.equal(poseFor('react', .5, outcome).bag, false);
  }
  const quiet = poseFor('walk', .37, 'neutral', true);
  assert.equal(quiet.stride, 0); assert.equal(quiet.bob, 0);
  assert.ok(poseFor('walk', .37).stride !== 0);
  assert.equal(poseFor('walk', .37).bag, true);
});

test('sample group path joins at phase boundaries without teleporting', () => {
  for (let i = 0; i < PHASES.length - 1; i++) {
    const before = storyboardPosition({ ...PHASES[i], index: i, progress: 1 });
    const after = storyboardPosition({ ...PHASES[i + 1], index: i + 1, progress: 0 });
    assert.ok(Math.abs(before.x - after.x) < 1e-12, `${PHASES[i].id} x continuity`);
    assert.ok(Math.abs(before.y - after.y) < 1e-12, `${PHASES[i].id} y continuity`);
  }
});

test('all views and actions draw finite geometry without negative mirror scale', () => {
  const numbers = [], scales = [];
  const ctx = new Proxy({}, {
    get(_, key) { return (...args) => { for (const a of args) if (typeof a === 'number') numbers.push(a); if (key === 'scale') scales.push(args); }; },
    set() { return true; },
  });
  for (const direction of DIRECTIONS) for (const action of ['idle', 'walk', 'address', 'swing', 'watch', 'putt', 'react']) for (const progress of [0, .42, .63, 1]) {
    drawGolfer(ctx, { direction, action, progress, width: 26 });
  }
  assert.ok(numbers.length > 10000);
  assert.ok(numbers.every(Number.isFinite));
  assert.ok(scales.every(([x,y]) => x > 0 && y > 0));
});

test('offline HTML contains the current source and no external runtime loads', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const source = readFileSync(new URL('./prototype.mjs', import.meta.url), 'utf8').replace(/^export /gm, '');
  const css = readFileSync(new URL('./prototype.css', import.meta.url), 'utf8');
  assert.ok(html.includes(source), 'Rebuild index.html after editing prototype.mjs');
  assert.ok(html.includes(css), 'Rebuild index.html after editing prototype.css');
  assert.doesNotMatch(html, /<(?:script|link)[^>]+(?:src|href)=/i);
  assert.ok(html.includes('Proposed rhythm · synthetic storyboard · not gameplay integration'));
  assert.ok(html.includes('Study 02 · more natural proportions · human review pending'));
});

test('rendered skull profile and adult skeleton stay within reviewed natural proportion limits', () => {
  // HEAD_PROFILE is the actual surface mesh consumed by drawGolfer, not a label.
  const headHeight = Math.max(...HEAD_PROFILE.map(p=>p[0])) - Math.min(...HEAD_PROFILE.map(p=>p[0]));
  const headWidth = Math.max(...HEAD_PROFILE.map(p=>p[1])) * 2;
  assert.equal(headHeight, MODEL.headHeight);
  assert.ok(headWidth <= MODEL.headWidth);
  assert.ok(MODEL.crownHeight / headHeight >= 6 && MODEL.crownHeight / headHeight <= 6.5);
  const body = skeletonFor(poseFor('idle', 0));
  const leg = body.legs[0];
  assert.ok(leg.hip[2] / headHeight >= 3, 'long adult legs, not prior short toy legs');
  assert.ok((leg.hip[2] - leg.knee[2]) / headHeight >= 1.4, 'articulated thigh length');
  assert.ok((leg.knee[2] - leg.ankle[2]) / headHeight >= 1.3, 'articulated calf length');
  assert.ok((body.shoulders[1][0]-body.shoulders[0][0]) / headWidth >= 1.9, 'head must stay small relative to shoulders');
  assert.ok(MODEL.handRadius < headWidth * .17);
  assert.ok(MODEL.shoeLength < headHeight * .55);
});

test('natural gait keeps one foot planted, limits bob, and articulates heel/toe without sinking', () => {
  for (let i=0;i<=120;i++) {
    const pose = poseFor('walk', i/120), { legs } = skeletonFor(pose);
    assert.ok(pose.bob <= .16);
    assert.ok(legs.some(leg=>leg.soleHeight === 0), 'one foot remains on ground');
    for (const leg of legs) {
      assert.ok(leg.hip[2] > leg.knee[2] && leg.knee[2] > leg.ankle[2]);
      const heel = footRoll(leg,-1.75), toe = footRoll(leg,3.35);
      assert.ok(heel>=0 && toe>=0);
      assert.ok(Math.min(heel,toe)===0, 'heel or toe stays at the sole contact plane');
    }
  }
  for (const action of ['address','putt','swing']) {
    const legs=skeletonFor(poseFor(action,.63)).legs;
    assert.ok(legs.every(leg=>leg.soleHeight===0), `${action} feet stay planted`);
  }
});

const distance3 = (a,b) => Math.hypot(...a.map((n,i)=>n-b[i]));
const near = (actual,expected,epsilon=1e-7) => assert.ok(Math.abs(actual-expected)<epsilon, `${actual} differs from ${expected}`);
const motionCases = [['idle','neutral'],['walk','neutral'],['address','neutral'],['swing','neutral'],['putt','neutral'],['watch','neutral'],...OUTCOMES.map(outcome=>['react',outcome])];

test('analytic two-bone solver preserves bone lengths at singular, near-collinear and reach-limit targets', () => {
  for (const target of [[0,0,0],[0,1e-12,0],[0,.5,0],[0,21.49999,0],[0,21.5,0],[0,100,0],[0,-100,0],[1e-9,12,1e-9],[4,8,12]]) {
    const arm=solveArm([0,0,0],target,[0,1,0]);
    assert.ok([...arm.shoulder,...arm.elbow,...arm.hand].every(Number.isFinite));
    near(distance3(arm.shoulder,arm.elbow),10.5);
    near(distance3(arm.elbow,arm.hand),11);
  }
  let previous=null;
  for(let i=0;i<=1000;i++){
    const arm=solveArm([0,0,0],[0,0,-(20+i*.0014999)],[1,1,-.2]);
    if(previous)assert.ok(distance3(arm.elbow,previous.elbow)<.13,'no elbow flip approaching full extension');
    previous=arm;
  }
});

test('actual skeleton bones and rigid ordered grip stay invariant through whole motions in all views', () => {
  for(const [action,outcome] of motionCases) for(const reducedMotion of [false,true]) for(let i=0;i<=400;i++){
    const pose=poseFor(action,i/400,outcome,reducedMotion),body=skeletonFor(pose);
    for(const arm of body.arms){
      assert.ok(arm.reached,`${action}/${i}: target must actually be reachable`);
      near(distance3(arm.shoulder,arm.elbow),10.5);
      near(distance3(arm.elbow,arm.hand),11);
      near(distance3(arm.hand,arm.requestedHand),0);
    }
    if(body.club){
      const club=body.club,shaft=club.handR.map((n,j)=>n-club.tip[j]),grip=club.handL.map((n,j)=>n-club.handR[j]);
      near(distance3(club.handR,club.tip),MODEL.shaftLength);
      near(distance3(club.handL,club.handR),1.85);
      near(distance3(club.tip,club.headEnd),2.2);
      near(distance3(body.arms[0].hand,club.handL),0);
      near(distance3(body.arms[1].hand,club.handR),0);
      near(distance3(pose.club,club.tip),0); // authored paths need no reach correction
      for(let j=0;j<3;j++)near(grip[j]/1.85,shaft[j]/MODEL.shaftLength);
    }
    for(const direction of DIRECTIONS){
      const angle=bodyAngle(direction,action);
      for(const arm of body.arms)for(const [s,f,h]of[arm.shoulder,arm.elbow,arm.hand])assert.ok(Object.values(project({s,f,h},angle)).every(Number.isFinite));
    }
  }
  const contact=skeletonFor(poseFor('swing',.63));
  contact.club.tip.forEach((n,i)=>near(n,[7.6,12,1][i]));
  assert.ok(contact.club.handL[2]>contact.club.handR[2]);
});

test('modeled elbows keep a continuous bend choice across swing, putting and quiet responses', () => {
  for(const [action,outcome] of motionCases)for(const reducedMotion of [false,true]){
    let previous=null;
    for(let i=0;i<=2000;i++){
      const body=skeletonFor(poseFor(action,i/2000,outcome,reducedMotion));
      if(previous)for(let arm=0;arm<2;arm++)assert.ok(distance3(body.arms[arm].elbow,previous.arms[arm].elbow)<.12,`${action}/${outcome} elbow discontinuity at ${i/2000}`);
      previous=body;
    }
  }
});

test('renderer uses solved joints and rigid club endpoints at address, top, contact, finish, putt and reaction', () => {
  for(const [action,progress]of[['address',0],['swing',.42],['swing',.63],['swing',.85],['putt',.3],['react',.5]])for(const direction of DIRECTIONS)for(const reducedMotion of[false,true]){
    const lines=[];
    const ctx=new Proxy({}, {get(_,key){return(...args)=>{if(key==='lineTo')lines.push(args);};},set(){return true;}});
    // Identity transform: width48 and ground origin(24,69) make recorded path
    // coordinates directly comparable to the model's projected coordinates.
    drawGolfer(ctx,{x:24,y:69,width:48,action,progress,direction,reducedMotion,outcome:'exceptional'});
    const body=skeletonFor(poseFor(action,progress,'exceptional',reducedMotion)),angle=bodyAngle(direction,action);
    for(const arm of body.arms)for(const joint of[arm.elbow,arm.hand]){
      const [s,f,h]=joint,p=project({s,f,h},angle);
      assert.ok(lines.some(([x,y])=>Math.hypot(x-(p.x-.4),y-(p.y-.25))<1e-7),`${action}/${direction}: renderer skipped solved joint`);
    }
    if(body.club){const [s,f,h]=body.club.tip,p=project({s,f,h},angle);assert.ok(lines.some(([x,y])=>Math.hypot(x-p.x,y-p.y)<1e-7),'renderer skipped rigid shaft tip');}
  }
});

test('one fixed inspection viewport fits actual projected complete rig, head, feet and drawn paths', () => {
  const view=INSPECTION,transform=(x,y)=>({x:view.anchorX+(x-24)*view.scale,y:view.anchorY+(y-69)*view.scale});
  const inside=(x,y,label)=>{const p=transform(x,y);assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));assert.ok(p.x>=view.padding&&p.x<=view.width-view.padding&&p.y>=view.padding&&p.y<=view.height-view.padding,`${label} outside fixed viewport: ${JSON.stringify(p)}`);};
  for(const[action,outcome]of motionCases)for(const direction of DIRECTIONS)for(const reducedMotion of[false,true]){
    const samples=new Set([...Array.from({length:101},(_,i)=>i/100),.42,.63,.85]);
    for(const progress of samples){
      const opts={action,outcome,direction,reducedMotion,progress},bounds=measureGolferBounds(opts);
      inside(bounds.minX,bounds.minY,`${action}/${direction}/${progress} rendered minimum`);
      inside(bounds.maxX,bounds.maxY,`${action}/${direction}/${progress} rendered maximum`);
      const body=skeletonFor(poseFor(action,progress,outcome,reducedMotion)),angle=bodyAngle(direction,action);
      const points=body.arms.flatMap(a=>[a.shoulder,a.elbow,a.hand]);
      if(body.club)points.push(body.club.tip,body.club.headEnd,body.club.handL,body.club.handR);
      for(const[s,f,h]of points){const p=project({s,f,h},angle);inside(p.x,p.y,'actual projected rig endpoint');}
    }
  }
  const nextScale=(view.frameWidth+.1)/48,b=view.sourceBounds;
  assert.ok((b.maxX-b.minX)*nextScale>view.width-view.padding*2||(b.maxY-b.minY)*nextScale>view.height-view.padding*2,'use largest fitting tenth-pixel width');
  assert.equal(FRAME.displayW,26);
});
