import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { activityOwnerKey, activityWindows, contractPath, validateActivityFrame, validateActivityRetention, validateActivityTransition, validateContract } from './validate-contract.mjs';

const contract = JSON.parse(await readFile(contractPath, 'utf8'));
const copy = (value) => structuredClone(value);
const owner = {
  scopeId: 'world:7/week:2/day:3/seed:42/reconcile:0', actorId: 'golfer:17',
  shot: { shotId: 'shot:3', holeId: 'hole:1', shotNumber: 3, seed: 42, club: 'Driver', style: 'straight_run', modelVersion: 'retained-v1' },
};
function packet(elapsedMs = 0, kind = 'swing') {
  const identity = copy(owner);
  if (kind === 'putt') identity.shot.club = 'Putter';
  const plan = activityWindows(contract, kind, 10), p = contract.pacing[kind];
  const motionProgress = Math.max(0, Math.min(1, (elapsedMs - plan.motionStartMs) / (plan.motionEndMs - plan.motionStartMs)));
  const phase = elapsedMs === plan.durationMs ? 'complete' : elapsedMs < p.addressMs ? 'address' : elapsedMs < plan.motionStartMs ? 'contact' : elapsedMs >= plan.motionEndMs ? 'rest' : motionProgress < (kind === 'putt' ? 0 : .6) ? 'flight' : 'roll';
  let activity = plan.windows.find((window) => elapsedMs >= window.startMs && elapsedMs < window.endMs)?.activity ?? 'watch';
  if (elapsedMs === plan.motionStartMs) activity = 'contact';
  const clipId = activity === 'reaction' ? 'cheer' : ['contact', 'follow', 'backswing'].includes(activity) ? kind : 'idle';
  const contactFrame = kind === 'swing' ? 5 : 2;
  const col = activity === 'reaction' ? 3 : activity === 'contact' ? contactFrame - (elapsedMs === plan.motionStartMs ? 0 : 1) : activity === 'follow' ? (kind === 'swing' ? 6 : 3) : 0;
  return {
    input: {
      version: 2, mode: 'foreground', owner: identity, currentOwner: copy(identity),
      authority: { root: { x: 10, y: 12, elevation: 2 }, segment: 'flight', segmentProgress: .5, facingOctant: 2, targetOctant: 2, walk: null, shotKind: kind, equipmentClass: kind === 'putt' ? 'putter' : 'driver', handedness: 'right', reaction: 'positive' },
      clock: { provider: 'shared-shot-pacing-v1', key: activityOwnerKey(identity), kind, distanceYards: 10, elapsedMs, durationMs: plan.durationMs, phase, motionProgress, firstContactT: kind === 'putt' ? 0 : .6, held: false },
      visibility: { hidden: false, paused: false, reducedMotion: false },
    },
    output: { version: 2, ownerKey: activityOwnerKey(identity), activity, clipId, frame: { row: 0, col, mirror: false }, root: { x: 10, y: 12, elevation: 2 }, feetPx: { x: 24, y: 69 }, renderedEquipmentClass: null, renderedHandedness: null, source: 'shared-clock', degraded: true, completionClaim: false },
  };
}
const frameErrors = (value) => validateActivityFrame(contract, value.input, value.output);

test('manifest validates without mutation or an art-approval claim', () => {
  const before = copy(contract);
  assert.deepEqual(validateContract(contract), []);
  assert.deepEqual(contract, before);
  assert.equal(contract.productionArtApproved, false);
  assert.equal(contract.pacing.reactionProposal.active, false);
});

test('strict JSON rejects undefined, infinity, sparse arrays, getters, symbols, prototypes, cycles, and unknown fields', () => {
  const mutations = [
    (c) => { c.review.humanArtAcceptance = undefined; },
    (c) => { c.limits.maxActivityActors = Infinity; },
    (c) => { delete c.clips[3]; },
    (c) => { Object.defineProperty(c.review, 'humanArtAcceptance', { get() { throw Error('getter must not run'); }, enumerable: true }); },
    (c) => { c[Symbol('secret')] = 1; },
    (c) => { Object.setPrototypeOf(c.review, { inherited: true }); },
    (c) => { c.review.loop = c; },
    (c) => { c.policies.extraClock = true; },
  ];
  for (const mutate of mutations) { const c = copy(contract); mutate(c); assert.ok(validateContract(c).length); }
});

test('geometry, contact, direction, enum, fallback, and clip-semantic mutations fail', () => {
  const mutations = [
    (c) => { c.compatibility.feetPx.y = 72; },
    (c) => { c.compatibility.displayWidthAtZoom1 = 48; },
    (c) => { c.compatibility.mirrors[0].source = 'n'; },
    (c) => { c.clips[2].contactFrame = 4; },
    (c) => { c.clips[3].frames = 8; },
    (c) => { c.clips[0].loop = 'wall-clock'; },
    (c) => { c.clips[6].fallback = 'watch'; },
    (c) => { c.clips[6].directionKey = 'target'; },
    (c) => { c.clips[8].assetStatus = 'existing-placeholder'; },
    (c) => { c.clips[2].activities = ['watch']; },
    (c) => { c.clips[10].id = 'walk'; },
  ];
  for (const mutate of mutations) { const c = copy(contract); mutate(c); assert.ok(validateContract(c).length); }
});

test('activity graph rejects disconnects, unknown nodes, duplicate edges, and mandatory reactions', () => {
  for (const change of [
    (c) => { c.activityGraph.edges = c.activityGraph.edges.filter(([to]) => to !== 'walk'); },
    (c) => { c.activityGraph.edges[0][1] = 'teleport'; },
    (c) => { c.activityGraph.edges[1] = copy(c.activityGraph.edges[0]); },
    (c) => { c.activityGraph.edges = c.activityGraph.edges.filter(([from, to]) => !(from === 'watch' && to === 'walk-on')); },
  ]) { const c = copy(contract); change(c); assert.ok(validateContract(c).length); }
});

test('duration windows cover each accepted total exactly with no overlap or extra dwell', () => {
  for (const kind of ['swing', 'putt']) for (const distance of [0, .01, 10, 40, 400, 1000000, Number.MAX_VALUE]) {
    const plan = activityWindows(contract, kind, distance);
    assert.ok(plan);
    assert.equal(plan.windows[0].startMs, 0);
    assert.equal(plan.windows.at(-1).endMs, plan.durationMs);
    let sum = 0;
    for (const [index, window] of plan.windows.entries()) {
      assert.ok(window.endMs > window.startMs);
      if (index) assert.equal(window.startMs, plan.windows[index - 1].endMs);
      sum += window.endMs - window.startMs;
    }
    assert.equal(sum, plan.durationMs);
    assert.ok(plan.durationMs >= contract.pacing[kind].minMs && plan.durationMs <= contract.pacing[kind].maxMs);
  }
  for (const distance of [-1, NaN, Infinity, '10', null]) assert.equal(activityWindows(contract, 'swing', distance), null);
  assert.equal(activityWindows(contract, 'chip', 10), null);
});

test('timing, caps, and inactive proposal cannot silently expand shared authority', () => {
  for (const change of [
    (c) => { c.pacing.swing.restMs = 1600; },
    (c) => { c.pacing.putt.restAllocationMs.reaction += 1; },
    (c) => { c.pacing.swing.settleWithinAddressMs = 600; },
    (c) => { c.pacing.followWithinMovementMs.putt = 2000; },
    (c) => { c.pacing.reactionProposal.active = true; },
    (c) => { c.pacing.additionalPresentationDwellMs = 1600; },
    (c) => { c.limits.maxActivityActors = 129; },
    (c) => { c.limits.maxActivityRetentionMs = 9999; },
    (c) => { c.limits.maxPendingShots = 1; },
    (c) => { c.policies.overviewMaxVisualLagMs = 1; },
  ]) { const c = copy(contract); change(c); assert.ok(validateContract(c).length); }
});

test('valid frame samples span both kinds, contact boundaries, rest, and completion', () => {
  for (const kind of ['swing', 'putt']) {
    const plan = activityWindows(contract, kind, 10);
    for (const time of [0, ...plan.windows.flatMap(({ startMs, endMs }) => [startMs, (startMs + endMs) / 2, endMs]), plan.durationMs]) assert.deepEqual(frameErrors(packet(time, kind)), [], `${kind} at ${time}`);
  }
});

test('all retained identity fields invalidate ownership; tuple separators cannot collide', () => {
  for (const field of ['scopeId', 'actorId', ...Object.keys(owner.shot)]) {
    const sample = packet();
    const target = Object.hasOwn(sample.input.currentOwner, field) ? sample.input.currentOwner : sample.input.currentOwner.shot;
    target[field] = typeof target[field] === 'number' ? target[field] + 1 : `${target[field]}:changed`;
    assert.ok(frameErrors(sample).some((error) => error.includes('owner')), field);
  }
  const a = copy(owner), b = copy(owner);
  a.scopeId = 'a:b'; a.actorId = 'c'; b.scopeId = 'a'; b.actorId = 'b:c';
  assert.notEqual(activityOwnerKey(a), activityOwnerKey(b));
  assert.equal(activityOwnerKey({ ...owner, extra: true }), null);
});

test('frame guard rejects root drift, false handedness/equipment, bad contact, future clocks, and extra outputs', () => {
  const time = activityWindows(contract, 'swing', 10).motionStartMs;
  for (const change of [
    (p) => { p.output.root.x += .001; },
    (p) => { p.output.feetPx.y = 70; },
    (p) => { p.output.renderedHandedness = 'right'; },
    (p) => { p.output.renderedEquipmentClass = 'driver'; },
    (p) => { p.output.frame.col = 4; },
    (p) => { p.output.frame.row = 5; },
    (p) => { p.output.frame.mirror = true; },
    (p) => { p.input.clock.durationMs += 1000; },
    (p) => { p.input.clock.motionProgress = .4; },
    (p) => { p.input.clock.provider = 'private-timer'; },
    (p) => { p.output.ballX = 999; },
    (p) => { p.output.completionClaim = true; },
    (p) => { p.input.authority.equipmentClass = 'putter'; },
  ]) { const p = packet(time); change(p); assert.ok(frameErrors(p).length); }
  const early = packet(time - 1); early.output = { ...early.output, activity: 'contact', clipId: 'swing', frame: { row: 0, col: 5, mirror: false } };
  assert.ok(frameErrors(early).some((error) => error.includes('contact')));
});

test('quiet reaction requires revealed result, correct outcome, and final pose; optional art cannot ship', () => {
  const plan = activityWindows(contract, 'swing', 10), time = plan.windows.find((window) => window.activity === 'reaction').startMs;
  assert.deepEqual(frameErrors(packet(time)), []);
  for (const change of [
    (p) => { p.input.authority.reaction = null; },
    (p) => { p.input.authority.reaction = 'negative'; },
    (p) => { p.output.frame.col = 1; },
    (p) => { p.output.clipId = 'react-positive'; p.output.frame.row = 2; p.output.renderedEquipmentClass = 'driver'; p.output.renderedHandedness = 'right'; p.output.degraded = false; },
  ]) { const p = packet(time); change(p); assert.ok(frameErrors(p).length); }
});

test('target rows differ from facing rows; missing targets require an honest stable fallback', () => {
  const p = packet(1200);
  p.input.authority.targetOctant = 0; p.output.frame = { row: 2, col: 5, mirror: true };
  assert.deepEqual(frameErrors(p), []);
  p.output.frame = { row: 0, col: 5, mirror: false };
  assert.ok(frameErrors(p).length);
  p.input.authority.targetOctant = null;
  assert.ok(frameErrors(p).length);
  p.output.activity = 'watch'; p.output.clipId = 'idle'; p.output.frame.col = 0;
  assert.deepEqual(frameErrors(p), []);
});

test('contact/finish frames cannot escape launch alignment under another activity label', () => {
  for (const col of [5, 6, 7]) {
    const p = packet(250); p.output.clipId = 'swing'; p.output.frame.col = col;
    assert.ok(frameErrors(p).some((error) => error.includes('phase-wide')));
  }
  const afterLaunch = packet(1500); afterLaunch.output.clipId = 'swing'; afterLaunch.output.frame.col = 5;
  assert.ok(frameErrors(afterLaunch).some((error) => error.includes('phase-wide')));
});

function walkPacket(distanceTiles = 0, x = 10) {
  const p = packet();
  p.input.mode = 'overview'; p.input.clock = null; p.input.owner.shot = null; p.input.currentOwner.shot = null;
  p.input.authority = { ...p.input.authority, root: { x, y: 12, elevation: 2 }, segment: 'walk', shotKind: null, targetOctant: null, walk: { segmentId: 'itinerary:2', distanceTiles } };
  p.output = { ...p.output, ownerKey: activityOwnerKey(p.input.owner), root: copy(p.input.authority.root), activity: 'walk', clipId: 'walk', frame: { row: 0, col: Math.floor(distanceTiles * 1.35 * 6) % 6, mirror: false }, source: 'current-authority' };
  return p;
}

test('walk frames use observed displacement, never cycle while stationary, and reset on exact segment change', () => {
  const request = { deltaMs: 100, explicitSkip: false, reducedMotionSkip: false };
  const before = walkPacket(), moving = walkPacket(.2, 10.2);
  assert.deepEqual(validateActivityTransition(contract, before, moving, request), []);
  const stationaryCycle = walkPacket(); stationaryCycle.output.frame.col = 1;
  assert.ok(frameErrors(stationaryCycle).length);
  const fabricatedDistance = walkPacket(.2, 10);
  assert.deepEqual(frameErrors(fabricatedDistance), []);
  assert.ok(validateActivityTransition(contract, before, fabricatedDistance, request).some((error) => error.includes('displacement')));
  const nextSegment = walkPacket(); nextSegment.input.authority.walk.segmentId = 'itinerary:3';
  assert.deepEqual(validateActivityTransition(contract, moving, nextSegment, request), []);
  nextSegment.input.authority.walk.distanceTiles = .2; nextSegment.output.frame.col = 1;
  assert.ok(validateActivityTransition(contract, moving, nextSegment, request).length);
});

test('transition rejects accessor wrappers, held body changes, and reduced-motion cycling', () => {
  const request = { deltaMs: 100, explicitSkip: false, reducedMotionSkip: false };
  const accessor = { get input() { throw Error('must not execute'); }, output: packet().output };
  assert.ok(validateActivityTransition(contract, accessor, packet(), request).length);
  const before = packet(100), paused = packet(100);
  paused.input.visibility.paused = true; paused.input.clock.held = true; paused.output.frame.col = 1;
  assert.deepEqual(frameErrors(paused), []);
  assert.ok(validateActivityTransition(contract, before, paused, request).some((error) => error.includes('held body')));
  const reduced = walkPacket(); reduced.input.visibility.reducedMotion = true;
  assert.ok(frameErrors(reduced).length);
  reduced.output.activity = 'watch'; reduced.output.clipId = 'idle'; reduced.output.frame.col = 0;
  assert.deepEqual(frameErrors(reduced), []);
});

test('overview fallback stays at current authority, has no extra clock, and cannot invent walking', () => {
  const p = packet();
  p.input.mode = 'overview'; p.input.clock = null; p.output.source = 'current-authority'; p.output.activity = 'watch';
  assert.deepEqual(frameErrors(p), []);
  p.output.activity = 'walk'; p.output.clipId = 'walk';
  assert.ok(frameErrors(p).length);
  p.input.authority.segment = 'walk'; p.input.authority.walk = { segmentId: 'itinerary:2', distanceTiles: 0 }; p.input.authority.shotKind = null; p.input.owner.shot = null; p.input.currentOwner.shot = null; p.output.ownerKey = activityOwnerKey(p.input.owner);
  assert.deepEqual(frameErrors(p), []);
  p.input.visibility.hidden = true; p.output.frame.col = 3;
  assert.ok(frameErrors(p).length);
});

test('transition holds hidden/pause, caps delta, allows visible explicit skip, rejects speed resizing', () => {
  const request = { deltaMs: 10000, explicitSkip: false, reducedMotionSkip: false };
  assert.deepEqual(validateActivityTransition(contract, packet(0), packet(100), request), []);
  assert.ok(validateActivityTransition(contract, packet(0), packet(1000), request).length);
  for (const flag of ['hidden', 'paused']) {
    const p = packet(100); p.input.visibility[flag] = true; p.input.clock.held = true;
    assert.deepEqual(validateActivityTransition(contract, packet(100), p, request), []);
    assert.ok(validateActivityTransition(contract, packet(0), p, request).length);
  }
  const complete = packet(activityWindows(contract, 'swing', 10).durationMs);
  complete.input.visibility.paused = true; complete.input.clock.held = true;
  assert.deepEqual(validateActivityTransition(contract, packet(100), complete, { ...request, explicitSkip: true }), []);
  complete.input.visibility.hidden = true;
  assert.ok(validateActivityTransition(contract, packet(100), complete, { ...request, explicitSkip: true }).length);
  const automatic = packet(100); automatic.input.visibility.paused = true; automatic.input.visibility.reducedMotion = true; automatic.input.clock.held = true;
  automatic.output.activity = 'watch'; automatic.output.clipId = 'idle';
  assert.deepEqual(frameErrors(automatic), []);
  const previousAutomatic = copy(automatic);
  assert.deepEqual(validateActivityTransition(contract, previousAutomatic, automatic, { ...request, reducedMotionSkip: true }), []);
  const changed = packet(200); changed.input.clock.distanceYards = 20;
  assert.ok(validateActivityTransition(contract, packet(100), changed, { ...request, deltaMs: 100 }).length);
});

test('retention accepts finite cap, rejects overflow, expired/duplicate actors, and multiple foreground owners', () => {
  const record = { owner: copy(owner), foreground: false, activeVisibleMs: 10000 };
  const records = Array.from({ length: 128 }, (_, index) => ({ ...copy(record), owner: { ...copy(owner), actorId: `golfer:${index}` } }));
  assert.deepEqual(validateActivityRetention(contract, records), []);
  assert.ok(validateActivityRetention(contract, [...records, copy(record)]).length);
  assert.ok(validateActivityRetention(contract, [record, copy(record)]).length);
  const expired = copy(record); expired.activeVisibleMs = 10001;
  assert.ok(validateActivityRetention(contract, [expired]).length);
  const foreground = copy(records.slice(0, 2)); foreground.forEach((r) => { r.foreground = true; });
  assert.ok(validateActivityRetention(contract, foreground).length);
  assert.ok(validateActivityRetention(contract, [{ ...record, pendingShots: [] }]).length);
});

test('paused accessibility toggles preserve the held pose without root or timeline progression', () => {
  const request = { deltaMs: 100, explicitSkip: false, reducedMotionSkip: false };
  for (const alreadyPaused of [false, true]) {
    const before = packet(700);
    before.input.visibility.paused = alreadyPaused; before.input.clock.held = alreadyPaused;
    const enabled = copy(before);
    enabled.input.visibility.paused = true; enabled.input.clock.held = true; enabled.input.visibility.reducedMotion = true;
    assert.deepEqual(validateActivityTransition(contract, before, enabled, request), [], `enable, alreadyPaused=${alreadyPaused}`);
    const disabled = copy(enabled); disabled.input.visibility.reducedMotion = false;
    assert.deepEqual(validateActivityTransition(contract, enabled, disabled, request), [], 'disable, frozen backswing');

    const moved = copy(enabled); moved.input.authority.root.x += .1; moved.output.root.x += .1;
    assert.ok(validateActivityTransition(contract, before, moved, request).some((error) => error.includes('held body')));
    const advanced = packet(800); advanced.input.visibility = copy(enabled.input.visibility); advanced.input.clock.held = true;
    assert.ok(validateActivityTransition(contract, before, advanced, request).some((error) => error.includes('hold/skip')));
    const changedPose = copy(enabled); changedPose.output.activity = 'watch'; changedPose.output.clipId = 'idle'; changedPose.output.frame.col = 0;
    assert.ok(validateActivityTransition(contract, before, changedPose, request).some((error) => error.includes('held body')));
    const wrongOwner = copy(enabled); wrongOwner.input.currentOwner.actorId = 'another-actor';
    assert.ok(validateActivityTransition(contract, before, wrongOwner, request).some((error) => error.includes('owner')));
  }

  const idle = packet(700); idle.input.visibility.reducedMotion = true;
  idle.output.activity = 'watch'; idle.output.clipId = 'idle'; idle.output.frame.col = 0;
  const pausedIdle = copy(idle); pausedIdle.input.visibility.paused = true; pausedIdle.input.clock.held = true;
  assert.deepEqual(validateActivityTransition(contract, idle, pausedIdle, request), []);
  const disabledIdle = copy(pausedIdle); disabledIdle.input.visibility.reducedMotion = false;
  assert.deepEqual(validateActivityTransition(contract, pausedIdle, disabledIdle, request), [], 'disable, frozen idle fallback');
});
