/** Original approved Study02 anatomy, extracted into a versioned offline authoring model.
 * No runtime imports. aa5933d is immutable; this module generates one candidate identity.
 */
export const MODEL_VERSION = 'natural-golfer-v1.0.0-candidate';
export const DIRECTIONS = Object.freeze(['s','sw','w','nw','n','ne','e','se']);
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
const ease=t=>t*t*(3-2*t);
const lerp=(a,b,t)=>a+(b-a)*t;
export function bodyAngle(direction, action) {
  const i = DIRECTIONS.indexOf(direction);
  if (i < 0) throw new RangeError(`Unknown direction: ${direction}`);
  // Facing angles share the existing generator's world→dimetric basis.
  // During a shot direction means TARGET, body faces 90° off target.
  const world = 45 + i * 45;
  return (world + (['swing', 'putt', 'address', 'watch'].includes(action) ? 90 : 0)) % 360;
}
export function project(point, degrees) {
  const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return { x: 24 + point.s * (c + s) + point.f * (c - s), y: 69 - point.h + point.s * (s - c) / 2 + point.f * (c + s) / 2, depth: point.s * (s - c) + point.f * (c + s) };
}
export const MODEL = Object.freeze({
  crownHeight: 64.1, headHeight: 10, headWidth: 6.4, neckHeight: 2, headCenterHeight: 58,
  shoulderHeight: 51, shoulderWidth: 13, waistHeight: 33, hipHeight: 31,
  kneeHeight: 16, ankleHeight: 2.2, shoeLength: 5.1, handRadius: .95,
  upperArmLength: 10.5, forearmLength: 11,
  shaftLength: Math.hypot(3.9, 4, 29.5), gripSpacing: 1.85,
});
export const HEAD_PROFILE = Object.freeze([[-5,1.5,1.5],[-3.8,2.25,2.3],[-.8,3.05,2.65],[2.4,3.2,2.55],[4.4,2.4,2],[5,0,0]].map(Object.freeze));
const add3 = (a,b) => a.map((n,i)=>n+b[i]);
const sub3 = (a,b) => a.map((n,i)=>n-b[i]);
const mul3 = (a,n) => a.map(v=>v*n);
const dot3 = (a,b) => a.reduce((sum,n,i)=>sum+n*b[i],0);
const length3 = a => Math.hypot(...a);
const unit3 = (a,fallback=[0,0,-1]) => length3(a)>1e-10?mul3(a,1/length3(a)):[...fallback];
const cross3 = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

/** One rigid shaft and ordered grip. Both hands derive from the shaft axis. */
export function rigidGripFor(handR, tipReference) {
  const axis = unit3(sub3(handR,tipReference));
  return { handR:[...handR], handL:add3(handR,mul3(axis,MODEL.gripSpacing)), tip:sub3(handR,mul3(axis,MODEL.shaftLength)), axis };
}

/** Analytic two-bone IK in model space, with a stable anterior elbow pole. */
export function solveArm(shoulder, requestedHand, pole=[0,1,0]) {
  const delta=sub3(requestedHand,shoulder), requestedDistance=length3(delta), direction=unit3(delta);
  const a=MODEL.upperArmLength,b=MODEL.forearmLength;
  const distance=clamp(requestedDistance,Math.abs(a-b)+1e-7,a+b-1e-7);
  const hand=add3(shoulder,mul3(direction,distance));
  let bend=sub3(pole,mul3(direction,dot3(pole,direction)));
  // The normal model paths never meet this singularity; standalone callers
  // still get finite exact-length joints for collinear/zero-distance targets.
  if(length3(bend)<1e-8){const fallback=Math.abs(direction[0])<.7?[1,0,0]:[0,0,1];bend=sub3(fallback,mul3(direction,dot3(fallback,direction)));}
  bend=unit3(bend);
  const along=(a*a-b*b+distance*distance)/(2*distance);
  const height=Math.sqrt(Math.max(0,a*a-along*along));
  const elbow=add3(add3(shoulder,mul3(direction,along)),mul3(bend,height));
  return { shoulder:[...shoulder], elbow, hand, requestedHand:[...requestedHand], reached:Math.abs(distance-requestedDistance)<1e-6, bend };
}

/** Reach adjustment translates the whole grip+club, never the hands separately. */
function fitRigidGrip(rig, shoulders) {
  let result={...rig,handL:[...rig.handL],handR:[...rig.handR],tip:[...rig.tip]};
  const low=Math.abs(MODEL.upperArmLength-MODEL.forearmLength)+1e-5,high=MODEL.upperArmLength+MODEL.forearmLength-1e-5;
  for(let pass=0;pass<32;pass++){
    let corrected=false;
    for(let i=0;i<2;i++){
      const hand=i?result.handR:result.handL,delta=sub3(hand,shoulders[i]),distance=length3(delta),fit=clamp(distance,low,high);
      if(Math.abs(distance-fit)>1e-8){const shift=mul3(unit3(delta),fit-distance);for(const key of ['handL','handR','tip'])result[key]=add3(result[key],shift);corrected=true;}
    }
    if(!corrected)break;
  }
  return result;
}
export function poseFor(action, progress, outcome = 'neutral', reducedMotion = false) {
  const t = clamp(progress), pulse = Math.sin(Math.PI * t);
  const pose = { action, stride: 0, bob: 0, lean: 0, kneeFlex: 0, handL: [-6.4, .5, 30], handR: [6.4, .5, 30], club: null, headDrop: 0, shoulder: 0, bag: action === 'walk' };
  if (action === 'walk') {
    pose.stride = reducedMotion ? 0 : Math.sin(t * Math.PI * 12);
    pose.bob = reducedMotion ? 0 : Math.abs(pose.stride) * .16;
    pose.handL = [-6.4, pose.stride * 3, 30]; pose.handR = [6.4, -pose.stride * 3, 30];
  }
  if (['address', 'swing', 'putt', 'watch'].includes(action)) {
    pose.lean = 4; pose.kneeFlex = 1.1;
    pose.handL = [2.5, 8, 32]; pose.handR = [3.7, 8, 30.5];
    let tip = [7.6, 12, 1];
    if (action === 'swing') {
      // Anatomical lead glove stays above trailing hand. Contact remains .63.
      const keyframes = [
        [0, [3.7, 8, 30.5], [7.6, 12, 1]],
        [.42, [5.2, 8, 59], [-15, -4, 65]],
        [.63, [3.7, 8, 30.5], [7.6, 12, 1]],
        [.85, [-6.2, 4, 58], [14, -6, 63]],
        [1, [-6.2, 4, 58], [14, -6, 63]],
      ];
      let k = 0; while (k < keyframes.length - 2 && t > keyframes[k + 1][0]) k++;
      const aa = keyframes[k], bb = keyframes[k + 1], u = ease(clamp((t - aa[0]) / (bb[0] - aa[0])));
      const mix = n => aa[n].map((v, i) => lerp(v, bb[n][i], u));
      pose.handR = mix(1); tip = mix(2);
      pose.lean = lerp(4, .6, ease(clamp((t - .63) / .25)));
      pose.kneeFlex = lerp(1.1, .25, ease(clamp((t - .63) / .25)));
    }
    if (action === 'putt') { tip = [7.6 - Math.sin(t * Math.PI * 2) * 2.2, 12, 1]; pose.headDrop = .7; }
    if (action === 'watch') { pose.lean = .2; pose.kneeFlex = 0; pose.handR = [4.5, 3, 32]; tip = [7, 8, 1]; }
    pose.club = tip;
  }
  if (action === 'react') {
    // Adult responses: a small fist lift, nod or shoulder release. No hops.
    const p = reducedMotion ? .35 : pulse;
    if (outcome === 'pleased') pose.handR = [5.8, 3, 30 + p * 7];
    if (outcome === 'sigh') { pose.headDrop = p * .9; pose.shoulder = -p * .45; }
    if (outcome === 'disappointed') { pose.headDrop = p * 1.3; pose.handL = [-6, 1.5, 30 + p * 2]; }
    if (outcome === 'exceptional') { pose.handR = [5.6, 4, 30 + p * 13]; pose.handL = [-6, 1, 30 + p * 2]; }
  }
  if(pose.club){const rig=rigidGripFor(pose.handR,pose.club);pose.handL=rig.handL;pose.club=rig.tip;}
  return pose;
}

/** Reviewed dimensional skeleton shared by rendering and geometry checks. */
export function skeletonFor(pose) {
  const legs = [-1, 1].map(side => {
    const stride = pose.stride * side, lift = Math.max(0, stride) * 1.8;
    return {
      side, hip: [side * 3.2, 0, MODEL.hipHeight + pose.bob - pose.kneeFlex * .5],
      knee: [side * 3.3, stride * 2.1 + pose.kneeFlex, MODEL.kneeHeight + lift * .3],
      ankle: [side * 3.4, stride * 5.4, MODEL.ankleHeight + lift],
      soleHeight: lift, toePitch: stride * .12,
    };
  });
  const shoulders=[-1,1].map(side=>[side*6.5,pose.lean,MODEL.shoulderHeight+pose.bob+pose.shoulder-pose.kneeFlex*.5]);
  const rig=pose.club?fitRigidGrip(rigidGripFor(pose.handR,pose.club),shoulders):null;
  // Outward/anterior poles keep the modeled paths away from the IK pole
  // singularity and choose the same elbow side continuously through the swing.
  const arms=[solveArm(shoulders[0],rig?rig.handL:pose.handL,[-1,1,-.2]),solveArm(shoulders[1],rig?rig.handR:pose.handR,[1,1,-.2])];
  const club=rig?{...rig,headEnd:add3(rig.tip,mul3(unit3(cross3([0,1,0],rig.axis),[1,0,0]),2.2))}:null;
  return { legs, arms, club, neck: [0, 1 + pose.lean, 53 + pose.bob - pose.headDrop], headCenter: [0, 1 + pose.lean, MODEL.headCenterHeight + pose.bob - pose.headDrop], shoulders };
}
export function footRoll(leg, forwardOffset) {
  const t = clamp((forwardOffset + 1.75) / MODEL.shoeLength);
  return lerp(Math.max(0, -leg.toePitch) * 3, Math.max(0, leg.toePitch) * 3, t);
}
const LOOKS = [
  { skin:'#c1977b',skinLight:'#d8b397',skinShade:'#9a735f',shirt:'#d2d2d2',light:'#eeeeee',shade:'#a1a1a1',pants:'#c6b79a',pantsShade:'#968a74',hat:'#e7dcc0',hair:'#55483e',shoes:'#253d51',bag:'#283e54' },
];
/** Draw an original adult-proportion part model inside the legacy source frame. */
export function drawGolfer(ctx, { x = 0, y = 0, width = 26, direction = 'se', action = 'idle', progress = 0, outcome = 'pleased', reducedMotion = false, identity = 0, shadow = false, renderPass = 'composite', clothingTint = '#397e82' } = {}) {
  const v = LOOKS[identity % LOOKS.length], pose = poseFor(action, progress, outcome, reducedMotion), angle = bodyAngle(direction, action), skeleton = skeletonFor(pose);
  let activeLayer='base';
  const native=ctx;
  const tintColor=color=>{const gray=parseInt(color.slice(1,3),16);return '#'+[1,3,5].map(i=>Math.round(parseInt(clothingTint.slice(i,i+2),16)*gray/255).toString(16).padStart(2,'0')).join('');};
  ctx=new Proxy(native,{get(target,key){const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;},set(target,key,value){if(key==='fillStyle'||key==='strokeStyle'){if(renderPass==='ownership')value=activeLayer==='tint'?'#ffffff':'#000000';else if(renderPass==='base-color'&&activeLayer==='tint')value='#000000';else if(renderPass==='tint-color'&&activeLayer==='base')value='#000000';else if(renderPass==='composite'&&activeLayer==='tint')value=tintColor(value);}return Reflect.set(target,key,value,target);}});
  const P = (s, f, h) => project({ s, f, h }, angle);
  ctx.save(); ctx.translate(x, y); ctx.scale(width / 48, width / 48); ctx.translate(-24, -69);
  if (shadow) { ctx.fillStyle = '#263f3028'; ctx.beginPath(); ctx.ellipse(26, 69.7, 9, 2.7, -.1, 0, Math.PI * 2); ctx.fill(); }
  const parts = [];
  const poly = (points, color, extra = 0, stroke = null, outline = .28, layer = 'base') => {
    const pp = points.map(p => P(...p)); parts.push({ depth: pp.reduce((s,p)=>s+p.depth,0)/pp.length+extra, layer, draw() { ctx.beginPath(); pp.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fillStyle=color;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=outline;ctx.stroke();} } });
  };
  const ellipse = (s,f,h,rx,ry,color,extra=0,offset=[0,0]) => { const p=P(s,f,h);parts.push({depth:p.depth+extra,draw(){ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(p.x+offset[0],p.y+offset[1],rx,ry,0,0,Math.PI*2);ctx.fill();}}); };
  const line = (a,b,thickness,color,extra=0) => {const aa=P(...a),bb=P(...b);parts.push({depth:(aa.depth+bb.depth)/2+extra,draw(){ctx.strokeStyle=color;ctx.lineWidth=thickness;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(aa.x,aa.y);ctx.lineTo(bb.x,bb.y);ctx.stroke();}});};
  // Tapered anatomical segments, with a thin locally colored edge and NW strip.
  const limb = (a,b,r0,r1,color,light,shade,extra=0,layer='base') => {const aa=P(...a),bb=P(...b),dx=bb.x-aa.x,dy=bb.y-aa.y,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;parts.push({depth:(aa.depth+bb.depth)/2+extra,layer,draw(){ctx.beginPath();ctx.moveTo(aa.x+nx*r0,aa.y+ny*r0);ctx.lineTo(bb.x+nx*r1,bb.y+ny*r1);ctx.quadraticCurveTo(bb.x+dx/len*r1*.5,bb.y+dy/len*r1*.5,bb.x-nx*r1,bb.y-ny*r1);ctx.lineTo(aa.x-nx*r0,aa.y-ny*r0);ctx.quadraticCurveTo(aa.x-dx/len*r0*.4,aa.y-dy/len*r0*.4,aa.x+nx*r0,aa.y+ny*r0);ctx.fillStyle=color;ctx.fill();ctx.strokeStyle=shade;ctx.lineWidth=.28;ctx.stroke();ctx.beginPath();ctx.moveTo(aa.x-.45,aa.y-.3);ctx.lineTo(bb.x-.4,bb.y-.25);ctx.strokeStyle=light;ctx.lineWidth=Math.min(r0,r1)*.55;ctx.stroke();}});};
  // A swept oval volume: curved fitted clothing and anatomical head, not boxes.
  const volume = (rings, colors, extra=0, offset=[0,0,0], segments=12, transform=p=>p) => {
    for(let j=0;j<rings.length-1;j++) for(let i=0;i<segments;i++) {
      const a=i/segments*Math.PI*2,b=(i+1)/segments*Math.PI*2;
      const point=(ring,t)=>transform([offset[0]+Math.cos(t)*ring[1],offset[1]+Math.sin(t)*ring[2],offset[2]+ring[0]]);
      const normal=P(Math.cos((a+b)/2),Math.sin((a+b)/2),0),origin=P(0,0,0);
      const lit=-(normal.x-origin.x)*.65-(normal.y-origin.y)*.4;
      const color=lit>.3?colors[0]:lit<-.3?colors[2]:colors[1];
      poly([point(rings[j],a),point(rings[j],b),point(rings[j+1],b),point(rings[j+1],a)],color,extra);
    }
  };
  const b=pose.bob, lean=pose.lean;
  for(const leg of skeleton.legs){
    limb(leg.hip,leg.knee,2.15,1.65,v.pants,v.pants,v.pantsShade);
    limb(leg.knee,leg.ankle,1.65,1.15,v.pants,v.pants,v.pantsShade,.04);
    line([leg.knee[0],leg.knee[1]+.8,leg.knee[2]+1],[leg.ankle[0],leg.ankle[1]+.7,leg.ankle[2]+1],.25,v.pantsShade,.06);
    const [s,f]=leg.ankle,h=leg.soleHeight;
    // Longitudinal foot mesh, heel / toe independent of trouser cuff.
    volume([[h+.4,1.4,MODEL.shoeLength/2],[h+1.2,1.6,MODEL.shoeLength/2],[h+2.5,1.3,1.9],[h+3,0,0]],[v.shoes,v.shoes,'#a3a497'],.3,[s,f+.8,0],10,p=>[p[0],p[1],p[2]+footRoll(leg,p[1]-f)]);
    line([s-1.2,f+2.1,h+.5],[s+1.2,f+2.1,h+.5],.4,'#777e73',.5);
    line([s-.7,f+1.4,h+2.2],[s+.7,f+1.4,h+2.2],.2,'#a6aa9c',.6);
  }
  // Rounded hip volume, a narrower belted waist and naturally sloped shoulders.
  volume([[30+b,4.3,2.4],[33+b,4.1,2.3],[34+b,4.15,2.4]],[v.pants,v.pants,v.pantsShade]);
  volume([[33.4+b,4.2,2.4],[34.2+b,4.2,2.45]],['#6e6452','#756955','#5d584a'],.1);
  poly([[-.65,2.5,33.5+b],[.65,2.5,33.5+b],[.65,2.5,34.2+b],[-.65,2.5,34.2+b]],'#b9b4a0',.4);
  // Lean increases with height, giving an actual hinged address posture.
  const torsoRings=[[34.3+b,4.2,2.4],[39+b,4.5,2.65],[46+b,5.5,3.1],[49.4+b,6.1,2.8],[51+b,5.5,2.2],[52+b,2.0,1.6]];
  for(let j=0;j<torsoRings.length-1;j++){
    const ringA=torsoRings[j],ringB=torsoRings[j+1];
    for(let i=0;i<12;i++){const a=i*Math.PI/6,z=(i+1)*Math.PI/6,point=(r,t)=>[Math.cos(t)*r[1],Math.sin(t)*r[2]+lean*(r[0]-34)/18,r[0]];const n=P(Math.cos((a+z)/2),Math.sin((a+z)/2),0),o=P(0,0,0),l=-(n.x-o.x)*.65-(n.y-o.y)*.4;poly([point(ringA,a),point(ringA,z),point(ringB,z),point(ringB,a)],l>.3?v.light:l<-.3?v.shade:v.shirt,0,null,.28,'tint');}
  }
  line([0,3.2+lean*.9,49.6+b],[0,3.05+lean*.65,45.4+b],.34,'#c6ad91',1);
  ellipse(0,3.2+lean*.85,48.3+b,.22,.22,'#ded2b5',1.1);
  ellipse(0,3.2+lean*.75,46.7+b,.2,.2,'#ded2b5',1.1);
  line([-3,2.6+lean*.25,37+b],[-1.5,3+lean*.3,38+b],.23,v.shade,.2);
  // Narrow neck, two pointed polo collar folds, subtle back collar seam.
  volume([[51.6+b,1.6,1.35],[54+b,1.45,1.25]],[v.skinLight,v.skin,v.skinShade],.1,[0,1+lean,0]);
  poly([[-2.2,1.8+lean,52+b],[-.2,3.7+lean,49.5+b],[0,2.8+lean,52+b]],'#d0c3a6',1);
  poly([[2.2,1.8+lean,52+b],[.2,3.7+lean,49.5+b],[0,2.8+lean,52+b]],'#b9ad93',1);
  // Bent elbows and short fitted sleeves; fine hands keep a two-hand grip.
  for(const side of [-1,1]){
    const {shoulder,elbow,hand}=skeleton.arms[side===-1?0:1];
    const sleeveEnd=shoulder.map((n,i)=>lerp(n,elbow[i],.47));
    limb(shoulder,sleeveEnd,2.25,1.8,v.shirt,v.light,v.shade,side*.1,'tint');
    limb(sleeveEnd,elbow,1.55,1.4,v.skin,v.skinLight,v.skinShade,side*.1);
    limb(elbow,hand,1.35,.8,v.skin,v.skinLight,v.skinShade,side*.12);
    ellipse(...hand,.95,1.25,side===-1&&pose.club?'#d6d4c6':v.skinLight,side*.15);
  }
  const [,hf,hh]=skeleton.headCenter;
  // Adult skull / cheek / jaw volumes; fine profile features are inspection-only.
  volume(HEAD_PROFILE,[v.skinLight,v.skin,v.skinShade],.2,[0,hf,hh]);
  // Hair follows the back hemisphere and temples rather than a large cap-like blob.
  for(let i=0;i<8;i++){const a=Math.PI+i*Math.PI/8,z=a+Math.PI/8;poly([[Math.cos(a)*3.18,hf+Math.sin(a)*2.65,hh-.5],[Math.cos(z)*3.18,hf+Math.sin(z)*2.65,hh-.5],[Math.cos(z)*2.75,hf+Math.sin(z)*2.3,hh+4.1],[Math.cos(a)*2.75,hf+Math.sin(a)*2.3,hh+4.1]],v.hair,.3);}
  ellipse(-3.05,hf,hh-.4,.65,1.15,v.skin,.4);ellipse(3.05,hf,hh-.4,.65,1.15,v.skinShade,.4);
  const front=P(0,hf+3,hh),center=P(0,hf,hh),visibleFace=front.y>=center.y-.1;
  // Nose bridge and wedge produce a recognizable normal profile at eight views.
  if(visibleFace){
    poly([[-.65,hf+2.45,hh+.7],[.65,hf+2.45,hh+.7],[.5,hf+3.7,hh-1.3],[-.5,hf+3.7,hh-1.3]],v.skinLight,2);
    line([-1.65,hf+2.35,hh+1.35],[-.75,hf+2.65,hh+1.35],.26,'#66564b',2);
    line([.75,hf+2.65,hh+1.35],[1.65,hf+2.35,hh+1.35],.26,'#66564b',2);
    line([-.7,hf+2.4,hh-2.6],[.7,hf+2.4,hh-2.6],.23,'#8a6c5d',2);
    poly([[-1.6,hf+2.2,hh-3.2],[1.6,hf+2.2,hh-3.2],[.8,hf+2.1,hh-4],[-.8,hf+2.1,hh-4]],v.skinShade,1.7);
  }
  if(v.hat){
    volume([[hh+2.3,3.35,2.75],[hh+3.9,3.05,2.55],[hh+5.8,1.8,1.7],[hh+6.1,0,0]],['#e1d9c6',v.hat,'#ada795'],.6,[0,hf,0]);
    // Curved crescent visor, sampled in model space; no rectangular bill.
    const visor=[];for(let i=0;i<=10;i++){const a=Math.PI*i/10;visor.push([Math.cos(a)*3.45,hf+1.1+Math.sin(a)*4.1,hh+2.25-Math.sin(a)*.5]);}for(let i=10;i>=0;i--){const a=Math.PI*i/10;visor.push([Math.cos(a)*3.05,hf+.9+Math.sin(a)*1.7,hh+2.3]);}poly(visor,'#c4bba5',1.1,'#aca58f',.23);
    line([-.3,hf-1.7,hh+5.6],[-.3,hf+1.9,hh+4.1],.2,'#f0e8d3',.9);
  } else {volume([[hh+2.8,3.15,2.55],[hh+4.6,2.4,2],[hh+5,0,0]],[v.hair,v.hair,'#373a32'],.5,[0,hf,0]);}
  if(pose.bag){
    volume([[15,2.5,2],[18,2.6,2.1],[38,2.9,2.3],[39,2.6,2.1]],[v.bag,v.bag,'#3e514a'],-4,[-6,-4,0],10);
    poly([[-8,-5.8,19],[-4,-5.8,19],[-4,-5.8,27],[-8,-5.8,27]],'#66796a',-3.8,'#3d5147');
    line([-7.7,-5.9,25.5],[-4.3,-5.9,25.5],.25,'#adb4a2',-3.6);
    for(const [s,h,f] of [[-7.7,48,-3.8],[-5.5,46.7,-4.6],[-4,48.7,-4]]){line([s,f,38],[s,f,h],.42,'#a6b2ad',-4);line([s,f,h],[s+1.8,f+.3,h+.6],1.15,'#a5aca2',-4);}
    line([-5,-3,39],[5.6,3+lean,47],1.15,'#b4ab8c',1.1);line([5.6,3+lean,47],[-3,3,31],1,'#a99e7f',1.1);
  }
  if(skeleton.club){const club=skeleton.club;line(club.handR,club.tip,.48,'#a5b0a9',2);line(club.handR,club.handL,.9,'#4d544d',2);line(club.tip,club.headEnd,1.2,'#718279',2);}
  parts.sort((a,b)=>a.depth-b.depth).forEach(part=>{activeLayer=part.layer??'base';part.draw();});ctx.restore();
}
