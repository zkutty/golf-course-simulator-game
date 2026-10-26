/** Original code-native look development. No production renderer imports. */
export const FRAME = Object.freeze({ width: 48, height: 72, feetX: 24, feetY: 69, displayW: 26 });
export const DIRECTIONS = Object.freeze(['s', 'sw', 'w', 'nw', 'n', 'ne', 'e', 'se']);
export const OUTCOMES = Object.freeze(['neutral', 'pleased', 'sigh', 'disappointed', 'exceptional']);
export const PHASES = Object.freeze([
  { id: 'arrive', label: 'Walk to tee', duration: 8, action: 'walk' },
  { id: 'address', label: 'Set up', duration: 4, action: 'address' },
  { id: 'swing', label: 'Full swing', duration: 2, action: 'swing' },
  { id: 'watch', label: 'Watch the flight', duration: 4, action: 'watch' },
  { id: 'react', label: 'A small response', duration: 1.5, action: 'react' },
  { id: 'travel', label: 'Walk down the hole', duration: 13, action: 'walk' },
  { id: 'read', label: 'Set up the putt', duration: 4, action: 'address' },
  { id: 'putt', label: 'Putt', duration: 1.2, action: 'putt' },
  { id: 'roll', label: 'Watch the roll', duration: 2.3, action: 'watch' },
  { id: 'result', label: 'A quiet finish', duration: 1.5, action: 'react' },
  { id: 'leave', label: 'Walk off together', duration: 12.5, action: 'walk' },
]);
export const DURATION = PHASES.reduce((sum, phase) => sum + phase.duration, 0);
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const ease = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
export function phaseAt(time) {
  const t = clamp(Number.isFinite(time) ? time : 0, 0, DURATION);
  let start = 0;
  for (let i = 0; i < PHASES.length; i++) {
    const phase = PHASES[i];
    if (t < start + phase.duration || i === PHASES.length - 1) {
      return { ...phase, index: i, start, progress: clamp((t - start) / phase.duration), elapsed: t - start };
    }
    start += phase.duration;
  }
}
export function phaseStart(id) {
  let start = 0;
  for (const phase of PHASES) { if (phase.id === id) return start; start += phase.duration; }
  throw new RangeError(`Unknown phase: ${id}`);
}
export function createState(overrides = {}) {
  return { time: 0, playing: false, tier: 1, zoom: 100, reducedMotion: false, direction: 'se', outcome: 'pleased', ...overrides };
}
/** Operating tier is intentionally absent from presentation-clock math. */
export function advance(state, realSeconds) {
  if (!state.playing) return state;
  const time = clamp(state.time + Math.max(0, Number.isFinite(realSeconds) ? realSeconds : 0), 0, DURATION);
  return { ...state, time, playing: time < DURATION };
}
export function seek(state, time) { return { ...state, time: clamp(Number.isFinite(time) ? time : 0, 0, DURATION) }; }
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
export function poseFor(action, progress, outcome = 'neutral', reducedMotion = false) {
  const t = clamp(progress), pulse = Math.sin(Math.PI * t);
  const pose = { action, stride: 0, bob: 0, lean: 0, handL: [-7, 0, 24], handR: [7, 0, 24], club: null, headDrop: 0, shoulder: 0, bag: action === 'walk' };
  if (action === 'walk') {
    pose.stride = reducedMotion ? 0 : Math.sin(t * Math.PI * 12);
    pose.bob = reducedMotion ? 0 : Math.abs(Math.sin(t * Math.PI * 12)) * .45;
    pose.handL = [-7, pose.stride * 2.1, 24]; pose.handR = [7, -pose.stride * 2.1, 24];
  }
  if (['address', 'swing', 'putt', 'watch'].includes(action)) {
    pose.lean = 1.8;
    pose.handL = [3.8, 5.6, 22]; pose.handR = [6, 5.5, 20.5];
    let tip = [8, 9, 1.5];
    if (action === 'swing') {
      // Right-handed anatomical arm roles stay fixed in every view.
      const keyframes = [
        [0, [3.8, 6, 22], [6, 5, 20.5], [8, 9, 1.5]],
        [.42, [-5, -1, 38], [-2.8, -2, 36.5], [-15, -7, 53]],
        [.63, [3.8, 6, 22], [6, 5, 20.5], [8, 9, 1.5]],
        [.85, [5, -1, 40], [7.2, -1, 38.5], [15, -5, 48]],
        [1, [5, -1, 40], [7.2, -1, 38.5], [15, -5, 48]],
      ];
      let k = 0; while (k < keyframes.length - 2 && t > keyframes[k + 1][0]) k++;
      const aa = keyframes[k], bb = keyframes[k + 1], u = ease(clamp((t - aa[0]) / (bb[0] - aa[0])));
      const mix = n => aa[n].map((v, i) => lerp(v, bb[n][i], u));
      pose.handL = mix(1); pose.handR = mix(2); tip = mix(3);
      pose.lean = lerp(1.8, .3, ease(clamp((t - .63) / .25)));
    }
    if (action === 'putt') { tip = [8 - Math.sin(t * Math.PI * 2) * 3.2, 9, 1.5]; }
    if (action === 'watch') { pose.lean = 0; pose.handL = [-6, 1, 23]; pose.handR = [6, 2, 25]; tip = [7, 7, 2]; }
    pose.club = tip;
  }
  if (action === 'react') {
    // One finite gesture, resting at either end; no bouncing/jumping.
    const p = reducedMotion ? .35 : pulse;
    if (outcome === 'pleased') pose.handR = [7, 2, 24 + p * 9];
    if (outcome === 'sigh') { pose.headDrop = p * 1.7; pose.shoulder = -p * .8; }
    if (outcome === 'disappointed') { pose.headDrop = p * 2.3; pose.handL = [-6, 2, 24 + p * 3]; }
    if (outcome === 'exceptional') { pose.handR = [8, 0, 24 + p * 20]; pose.handL = [-8, 0, 24 + p * 6]; }
  }
  return pose;
}

const LOOKS = [
  { skin: '#d39a70', skinLight: '#edb38a', skinShade: '#ad7053', shirt: '#b64e35', light: '#dd7851', shade: '#863d31', pants: '#e3d6b6', pantsShade: '#afa58a', hat: '#efe5cb', hair: '#57382d', shoes: '#f2eedc', bag: '#44695d' },
  { skin: '#a16d4b', skinLight: '#c28a60', skinShade: '#795238', shirt: '#577b84', light: '#7b9b9c', shade: '#3c5d66', pants: '#d5cdb4', pantsShade: '#a09b89', hat: null, hair: '#34352f', shoes: '#e6e4d6', bag: '#9b754e' },
  { skin: '#e3b495', skinLight: '#f3c7a3', skinShade: '#b5846e', shirt: '#ccb462', light: '#e5ce83', shade: '#a38d4f', pants: '#536a5c', pantsShade: '#3d5048', hat: '#e6dfc8', hair: '#81786b', shoes: '#e7dfc9', bag: '#8e6650' },
  { skin: '#9b715b', skinLight: '#ba8d72', skinShade: '#735541', shirt: '#8c7290', light: '#ac91ae', shade: '#6a576f', pants: '#b6b6a4', pantsShade: '#878d80', hat: null, hair: '#473c37', shoes: '#edebdc', bag: '#4d6678' },
];

/** Draw in the 48×72 source coordinate space. Shadow is a separate pass. */
export function drawGolfer(ctx, { x = 0, y = 0, width = 26, direction = 'se', action = 'idle', progress = 0, outcome = 'pleased', reducedMotion = false, identity = 0, shadow = true } = {}) {
  const v = LOOKS[identity % LOOKS.length], pose = poseFor(action, progress, outcome, reducedMotion), angle = bodyAngle(direction, action);
  const P = (s, f, h) => project({ s, f, h }, angle);
  ctx.save(); ctx.translate(x, y); ctx.scale(width / 48, width / 48); ctx.translate(-24, -69);
  if (shadow) { ctx.fillStyle = '#263f302c'; ctx.beginPath(); ctx.ellipse(26, 69.7, 13, 3.5, -.1, 0, Math.PI * 2); ctx.fill(); }
  const parts = [];
  const ellipse = (s, f, h, rx, ry, color, stroke = '#55473d', extra = 0, screenOffset = [0, 0]) => {
    const p = P(s, f, h);
    p.x += screenOffset[0]; p.y += screenOffset[1];
    parts.push({ depth: p.depth + extra, draw() { ctx.fillStyle = color; ctx.strokeStyle = stroke; ctx.lineWidth = .75; ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); if (stroke) ctx.stroke(); } });
  };
  const line = (a, b, thickness, color, shade = color, extra = 0) => {
    const aa = P(...a), bb = P(...b);
    parts.push({ depth: (aa.depth + bb.depth) / 2 + extra, draw() {
      ctx.lineCap = 'round'; ctx.strokeStyle = '#514a3e'; ctx.lineWidth = thickness + 1.2; ctx.beginPath(); ctx.moveTo(aa.x, aa.y); ctx.lineTo(bb.x, bb.y); ctx.stroke();
      ctx.strokeStyle = shade; ctx.lineWidth = thickness; ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = thickness * .42; ctx.beginPath(); ctx.moveTo(aa.x - .5, aa.y - .4); ctx.lineTo(bb.x - .5, bb.y - .4); ctx.stroke();
    } });
  };
  const polygon = (points, color, extra = 0, stroke = '#614d3e') => {
    const pp = points.map(p => P(...p)); parts.push({ depth: pp.reduce((s, p) => s + p.depth, 0) / pp.length + extra, draw() {
      ctx.beginPath(); pp.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.fillStyle = color; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = .8; ctx.stroke(); }
    } });
  };
  // Legs have broad trouser cuffs and flat shoe soles. One foot stays down.
  for (const side of [-1, 1]) {
    const stride = pose.stride * side, f = stride * 3.3, lift = Math.max(0, stride) * 1.2;
    line([side * 3.5, 0, 18 + pose.bob], [side * 3.7, f, 3.4 + lift], 5.2, v.pants, v.pantsShade);
    ellipse(side * 3.7, f + 1.3, 1.8 + lift, 4.1, 2.1, v.shoes);
    line([side * 3.7 - 1.3, f + 2, .5 + lift], [side * 3.7 + 1.3, f + 2, .5 + lift], .7, '#6e6a57', '#6e6a57', .2);
  }
  const b = pose.bob, lean = pose.lean;
  // A shaped polo, side plane, placket and collar: deliberately readable at 26px.
  polygon([[-6.7, 0, 35 + b], [6.7, 0, 35 + b], [6.2, 1, 18.5 + b], [-6.2, 1, 18.5 + b]], v.shirt);
  const leftPlaneLit = P(-6.7, 2, 30).x < P(0, 2, 30).x;
  polygon([[-6.7, 0, 35 + b], [-6.7, 4, 34 + b], [-6.2, 5, 19 + b], [-6.2, 1, 18.5 + b]], leftPlaneLit ? v.light : v.shade, .05);
  polygon([[6.7, 0, 35 + b], [6.7, 4, 34 + b], [6.2, 5, 19 + b], [6.2, 1, 18.5 + b]], leftPlaneLit ? v.shade : v.light, .06);
  polygon([[-6.7, 4, 34 + b], [6.7, 4, 34 + b], [6.2, 5, 19 + b], [-6.2, 5, 19 + b]], v.shirt, .1);
  line([-5.5, 5, 19.7 + b], [5.5, 5, 19.7 + b], 1.1, '#716047', '#716047', .3);
  ellipse(0, 2 + lean, 36.3 + b, 3.6, 3.5, v.skin, '#8f6249', .3);
  polygon([[-4, 4, 35 + b], [-.5, 5.4, 31.5 + b], [0, 4, 35 + b]], '#f4e8ce', .5);
  polygon([[4, 4, 35 + b], [.5, 5.4, 31.5 + b], [0, 4, 35 + b]], '#eadbbd', .5);
  line([0, 5.5, 31 + b], [0, 5.5, 28.8 + b], .65, '#f0cfad', '#f0cfad', .7);
  // Anatomical hands remain L/R at all eight views; no scale(-1,1).
  for (const side of [-1, 1]) {
    const hand = side === -1 ? pose.handL : pose.handR;
    const shoulder = [side * 6.4, 2 + lean, 33 + b + pose.shoulder];
    const elbow = [lerp(shoulder[0], hand[0], .55) + side * 1.3, lerp(shoulder[1], hand[1], .5), lerp(shoulder[2], hand[2], .56)];
    line(shoulder, elbow, 5, v.light, v.shade, side * .12);
    line(elbow, hand, 3.6, v.skinLight, v.skinShade, side * .15);
    ellipse(...hand, 2.15, 2.3, side === -1 && pose.club ? '#eee6d3' : v.skinLight, '#966d50', side * .17);
  }
  // Head: cheek volume, ears, hairline, nose, one tiny face mark per visible side.
  const h = 44.1 + b - pose.headDrop, f = 2 + lean;
  ellipse(0, f, h, 9.1, 10.1, v.skin, '#8f6249', .4);
  ellipse(0, f, h, 6.7, 7.8, v.skinLight, null, .41, [-2, -2]);
  ellipse(-6.4, f, h - .7, 2, 2.7, v.skin, '#a06d51', .5);
  ellipse(6.4, f, h - .7, 2, 2.7, v.skinShade, '#8f6249', .5);
  ellipse(0, f - 2.6, h + 4, 8.8, 6.4, v.hair, '#514032', -.1);
  const front = P(0, f + 6, h), center = P(0, f, h), visibleFace = front.y >= center.y - .25;
  if (visibleFace) {
    ellipse(0, f + 5.8, h - 1, 2.1, 2.1, v.skinLight, null, 3);
    ellipse(-3, f + 5.3, h + 1.4, .65, .85, '#544639', null, 3);
    ellipse(3, f + 5.3, h + 1.4, .65, .85, '#544639', null, 3);
    line([-1.4, f + 5.8, h - 4], [1.3, f + 5.8, h - 4.1], .6, '#8f5d48', '#8f5d48', 3);
  }
  if (v.hat) {
    ellipse(0, f, h + 6.2, 9.6, 5.8, v.hat, '#897c61', 1.1);
    polygon([[-7, f + 2, h + 6], [7, f + 2, h + 6], [7, f + 9, h + 4.8], [-7, f + 9, h + 4.8]], '#e6d6b4', 1.6);
    line([-5, f, h + 9.7], [3, f, h + 10.4], .7, '#fff4da', '#fff4da', 1.7);
  }
  if (pose.bag) {
    // Carry bag sits behind the torso with two visible club grips.
    line([-6, -5, 16], [-6, -5, 36], 7.6, v.bag, '#345044', -5);
    line([-8, -5, 35], [-8, -5, 46], 1.1, '#aab8b1', '#aab8b1', -5);
    line([-4, -5, 35], [-4, -5, 44], 1.1, '#aab8b1', '#aab8b1', -5);
    line([-8, -5, 46], [-5.5, -5, 46], 2.3, '#ced1bf', '#ced1bf', -5);
    line([-5, -3, 33], [5, 4, 24], 1.8, '#d8c697', '#d8c697', 1);
  }
  if (pose.club) {
    line(pose.handR, pose.club, 1, '#c2c9c0', '#83928d', 2);
    line(pose.club, [pose.club[0] + 3.5, pose.club[1], pose.club[2] + .4], 2.4, '#8e9c92', '#56675d', 2);
  }
  parts.sort((a, b) => a.depth - b.depth).forEach(part => part.draw());
  ctx.restore();
}

export function storyboardPosition(phase) {
  const p = phase.progress;
  if (phase.id === 'arrive') return { x: lerp(.15, .27, p), y: lerp(.78, .67, p) };
  if (phase.id === 'travel') return { x: lerp(.27, .73, p), y: lerp(.67, .40, p) };
  if (phase.id === 'leave') return { x: lerp(.73, .91, p), y: lerp(.40, .54, p) };
  if (phase.index >= 6) return { x: .73, y: .40 };
  return { x: .27, y: .67 };
}

function boot() {
  let state = createState({ reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches });
  const query = new URLSearchParams(location.search);
  if (query.has('t') && Number.isFinite(Number(query.get('t')))) state = seek(state, Number(query.get('t')));
  if (PHASES.some(p => p.id === query.get('phase'))) state = seek(state, phaseStart(query.get('phase')));
  if (DIRECTIONS.includes(query.get('direction'))) state.direction = query.get('direction');
  if (OUTCOMES.includes(query.get('outcome'))) state.outcome = query.get('outcome');
  if ([50, 100, 200].includes(Number(query.get('zoom')))) state.zoom = Number(query.get('zoom'));
  const $ = id => document.getElementById(id), stage = $('course'), ctx = stage.getContext('2d');
  const phaseButtons = $('phase-buttons');
  PHASES.forEach(phase => {
    const button = document.createElement('button'); button.textContent = phase.label;
    button.addEventListener('click', () => { state = seek({ ...state, playing: false }, phaseStart(phase.id)); render(); });
    phaseButtons.append(button);
  });
  const option = (id, key, convert = String) => $(id).addEventListener('change', e => { state = { ...state, [key]: convert(e.target.value) }; render(); });
  option('tier', 'tier', Number); option('zoom', 'zoom', Number); option('direction', 'direction'); option('outcome', 'outcome');
  for (const key of ['tier', 'zoom', 'direction', 'outcome']) $(key).value = state[key];
  $('motion').checked = state.reducedMotion;
  $('motion').addEventListener('change', e => { state = { ...state, reducedMotion: e.target.checked }; render(); });
  $('play').addEventListener('click', () => { if (state.time >= DURATION) state = seek(state, 0); state = { ...state, playing: !state.playing }; render(); });
  $('replay').addEventListener('click', () => { state = { ...state, time: 0, playing: true }; render(); });
  $('scrub').max = DURATION;
  $('scrub').addEventListener('input', e => { state = seek({ ...state, playing: false }, Number(e.target.value)); render(); });
  const sizeCanvas = (canvas, width, height) => { const dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = width * dpr; canvas.height = height * dpr; canvas.style.width = `${width}px`; canvas.style.height = `${height}px`; const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); return c; };
  function course() {
    const w = stage.clientWidth, h = stage.clientHeight, c = sizeCanvas(stage, w, h), phase = phaseAt(state.time);
    c.fillStyle = '#688b56'; c.fillRect(0, 0, w, h);
    function shape(points, fill, stroke = null, lw = 1) { c.beginPath(); points.forEach((p, i) => i ? c.lineTo(p[0] * w, p[1] * h) : c.moveTo(p[0] * w, p[1] * h)); c.closePath(); c.fillStyle = fill; c.fill(); if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); } }
    // Original composed course backdrop: broad fairway, clipped mowing, water and bunkers.
    c.fillStyle = '#75955e'; for (let i = 0; i < 95; i++) { const xx = ((i * 173) % 997) / 997 * w, yy = ((i * 281) % 521) / 521 * h; c.fillRect(xx, yy, 2, 1); }
    c.beginPath(); c.moveTo(-.05 * w, .94 * h); c.bezierCurveTo(.27 * w, .83 * h, .35 * w, .60 * h, .46 * w, .57 * h); c.bezierCurveTo(.70 * w, .49 * h, .79 * w, .65 * h, 1.05 * w, .73 * h); c.strokeStyle = '#b9b19a'; c.lineWidth = 13; c.stroke(); c.strokeStyle = '#ccc3a7'; c.lineWidth = 9; c.stroke();
    c.beginPath(); c.moveTo(.18*w,.69*h); c.bezierCurveTo(.32*w,.44*h,.59*w,.54*h,.69*w,.34*h); c.bezierCurveTo(.89*w,.22*h,.90*w,.47*h,.68*w,.55*h); c.bezierCurveTo(.54*w,.72*h,.37*w,.60*h,.26*w,.80*h); c.closePath(); c.fillStyle='#90ac6c'; c.fill();
    c.save(); c.clip(); for(let i=-5;i<20;i++) shape([[i*.08,0],[i*.08+.045,0],[i*.08+.35,1],[i*.08+.305,1]],'#96b271'); c.restore();
    c.beginPath(); c.ellipse(.735*w,.398*h,.109*w,.089*h,-.14,0,Math.PI*2); c.fillStyle='#a8bd7b';c.fill(); c.strokeStyle='#809e62';c.lineWidth=7;c.stroke();
    c.beginPath();c.ellipse(.609*w,.294*h,.058*w,.036*h,-.25,0,Math.PI*2);c.fillStyle='#5f7851';c.fill();c.beginPath();c.ellipse(.609*w,.287*h,.054*w,.032*h,-.25,0,Math.PI*2);c.fillStyle='#e0cc9b';c.fill();
    c.beginPath();c.ellipse(.84*w,.53*h,.05*w,.028*h,-.3,0,Math.PI*2);c.fillStyle='#e0cc9b';c.fill();
    c.beginPath();c.moveTo(.04*w,.16*h);c.bezierCurveTo(.20*w,.03*h,.35*w,.11*h,.31*w,.29*h);c.bezierCurveTo(.25*w,.40*h,.09*w,.36*h,.04*w,.16*h);c.fillStyle='#456f6f';c.fill();c.strokeStyle='#a5b68a';c.lineWidth=5;c.stroke();
    c.beginPath();c.ellipse(.245*w,.69*h,.036*w,.02*h,-.3,0,Math.PI*2);c.fillStyle='#afba83';c.fill();
    // Separate layered trees; NW-lit caps and restrained SE ground shadows.
    const tree = (x,y,r) => { c.fillStyle='#294c3125';c.beginPath();c.ellipse(x+6,y+5,r*1.1,r*.29,0,0,Math.PI*2);c.fill();c.fillStyle='#796044';c.fillRect(x-3,y-r*.7,6,r*.7);c.fillStyle='#416c44';c.beginPath();c.ellipse(x,y-r*.9,r,r*.8,0,0,Math.PI*2);c.fill();c.fillStyle='#56804c';c.beginPath();c.ellipse(x-r*.14,y-r*1.14,r*.83,r*.66,0,0,Math.PI*2);c.fill();c.fillStyle='#709359';c.beginPath();c.ellipse(x-r*.35,y-r*1.37,r*.51,r*.36,0,0,Math.PI*2);c.fill(); };
    [[.08,.56,24],[.13,.51,27],[.37,.28,23],[.40,.23,20],[.92,.33,25],[.97,.38,21],[.53,.83,25],[.57,.89,28]].forEach(([x,y,r])=>tree(x*w,y*h,r));
    c.strokeStyle='#58664a';c.lineWidth=1.5;c.beginPath();c.moveTo(.77*w,.38*h);c.lineTo(.77*w,.28*h);c.stroke();shape([[.77,.28],[.797,.296],[.77,.312]],'#b85d42');
    c.fillStyle='#4c6544';c.beginPath();c.ellipse(.77*w,.38*h,3,1.6,0,0,Math.PI*2);c.fill();
    const position = storyboardPosition(phase), gw = 26 * state.zoom / 100;
    const group = [3,2,1,0].map((id) => ({ id, x:position.x*w-(id?20+id*15:0), y:position.y*h+(id?8+id*5:0) }));
    group.sort((a,b)=>a.y-b.y).forEach(g=>drawGolfer(c,{x:g.x,y:g.y,width:gw*(g.id?.94:1),identity:g.id,direction:state.direction,action:g.id?(phase.action==='walk'?'walk':'idle'):phase.action,progress:g.id?(phase.progress+g.id*.09)%1:phase.progress,outcome:state.outcome,reducedMotion:state.reducedMotion}));
    // SAMPLE trajectory; scene motion is never a game-result replay.
    const showFlight = phase.id === 'watch' || (phase.id === 'swing' && phase.progress >= .63);
    if(showFlight){ const t=phase.id==='swing'?0:phase.progress;const bx=lerp(.29,.73,t)*w,by=(lerp(.65,.40,t)-Math.sin(t*Math.PI)*.17)*h; c.setLineDash([3,5]);c.lineWidth=1;c.strokeStyle='#f8efd37d';c.beginPath();c.moveTo(.29*w,.65*h);c.quadraticCurveTo(.49*w,.20*h,.73*w,.4*h);c.stroke();c.setLineDash([]);c.fillStyle='#fff7dc';c.beginPath();c.arc(bx,by,2,0,Math.PI*2);c.fill(); }
    if(phase.id==='roll'){c.fillStyle='#fff7dc';c.beginPath();c.arc(lerp(.74,.77,phase.progress)*w,lerp(.40,.38,phase.progress)*h,1.5,0,Math.PI*2);c.fill();}
    c.fillStyle='#ffffffd9';c.font='11px system-ui';c.fillText(`SYNTHETIC GROUP ANIMATIC  ·  ${state.zoom}% gameplay scale  ·  ${state.direction.toUpperCase()} ${['address','swing','putt','watch'].includes(phase.action)?'target':'facing'}`,18,h-18);
  }
  function specimen(canvas, opts, w, h) { const c = sizeCanvas(canvas,w,h); c.clearRect(0,0,w,h); drawGolfer(c,opts); }
  function render() {
    const phase=phaseAt(state.time); $('play').textContent=state.playing?'Pause':'Play';$('play').setAttribute('aria-pressed',String(state.playing));$('scrub').value=state.time;$('time').textContent=`${state.time.toFixed(1)} / ${DURATION.toFixed(1)} s`;$('phase-name').textContent=phase.label;$('phase-note').textContent=`${phase.action==='react'?state.outcome:phase.action} · right-handed · ${state.direction.toUpperCase()} ${['address','swing','putt','watch'].includes(phase.action)?'target':'facing'}`;
    [...phaseButtons.children].forEach((button,i)=>{button.setAttribute('aria-current',i===phase.index?'step':'false');});
    course();
    specimen($('inspection'),{x:135,y:325,width:210,direction:state.direction,action:phase.action,progress:phase.progress,outcome:state.outcome,reducedMotion:state.reducedMotion},270,350);
    document.querySelectorAll('canvas[data-size]').forEach(canvas=>{ const width=Number(canvas.dataset.size);specimen(canvas,{x:48,y:88,width,direction:state.direction,action:phase.action,progress:phase.progress,outcome:state.outcome,reducedMotion:state.reducedMotion},96,105); });
    document.querySelectorAll('canvas[data-pose]').forEach(canvas=>{const [action,t]=canvas.dataset.pose.split(':');specimen(canvas,{x:36,y:73,width:26,direction:state.direction,action,progress:Number(t),outcome:state.outcome,reducedMotion:state.reducedMotion},72,86);});
    document.querySelectorAll('canvas[data-view]').forEach(canvas=>specimen(canvas,{x:39,y:67,width:40,direction:canvas.dataset.view,action:'address',progress:0},78,79));
  }
  // A bounded read/seek hook for deterministic local review captures only.
  globalThis.golferLookdev = Object.freeze({
    snapshot: () => ({ ...state, phase: phaseAt(state.time).id, duration: DURATION, synthetic: true }),
    seek: seconds => { state = seek({ ...state, playing: false }, Number(seconds)); render(); return { ...state }; },
  });
  let last = null;
  function tick(now) { if(last!==null&&state.playing){state=advance(state,(now-last)/1000);render();}last=now;requestAnimationFrame(tick); }
  // Tab suspension pauses rather than skipping unseen actions.
  document.addEventListener('visibilitychange',()=>{last=null;if(document.hidden){state={...state,playing:false};render();}});
  addEventListener('resize',render);render();requestAnimationFrame(tick);
}
if (typeof document !== 'undefined') boot();
