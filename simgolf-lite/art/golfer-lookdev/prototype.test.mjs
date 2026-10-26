import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FRAME, DIRECTIONS, OUTCOMES, PHASES, DURATION, createState, advance, seek, phaseAt, phaseStart, bodyAngle, project, poseFor, drawGolfer, storyboardPosition } from './prototype.mjs';

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
});
