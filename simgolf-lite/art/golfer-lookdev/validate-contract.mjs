import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Staging-only JSON contract guard. No production imports, clocks, RNG, or writes.
const activities = ['walk', 'settle', 'address', 'backswing', 'contact', 'follow', 'watch', 'reaction', 'walk-on'];
const ownerFields = ['scopeId', 'actorId', 'shotId', 'holeId', 'shotNumber', 'seed', 'club', 'style', 'modelVersion'];
const legacy = {
  walk: [6, 5, null, 'facing', 'distance'], idle: [2, 5, null, 'facing', 'bounded-idle'],
  swing: [8, 5, 5, 'target', 'once'], putt: [4, 5, 2, 'target', 'once'],
  cheer: [4, 1, null, 'south-only', 'once'], mad: [4, 1, null, 'south-only', 'once'],
};
const optional = { settle: [4, 'idle'], address: [2, 'idle'], watch: [2, 'idle'], 'react-positive': [4, 'cheer'], 'react-negative': [4, 'mad'] };
const clipActivities = {
  walk: ['walk', 'walk-on'], idle: ['settle', 'address', 'watch'],
  swing: ['address', 'backswing', 'contact', 'follow', 'watch'], putt: ['address', 'backswing', 'contact', 'follow', 'watch'],
  cheer: ['reaction'], mad: ['reaction'], settle: ['settle'], address: ['address'], watch: ['watch'], 'react-positive': ['reaction'], 'react-negative': ['reaction'],
};
const allowedEdges = ['walk>settle', 'settle>address', 'address>backswing', 'backswing>contact', 'contact>follow', 'follow>watch', 'watch>reaction', 'watch>walk-on', 'reaction>walk-on', 'walk-on>walk'];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b); // Used for ordered scalar arrays only.
const lit = (expected) => (value) => value === expected;
const member = (options) => (value) => options.includes(value);
const num = (min, max, integer = false) => (value) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isSafeInteger(value));
const label = (max = 256) => (value) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/u.test(value);
const nullable = (schema) => ({ nullable: schema });
const list = (schema, min = 0, max = 256) => ({ list: schema, min, max });
const tuple = (...schemas) => ({ tuple: schemas });
const fixedList = (expected) => (value) => eq(value, expected);
const positive = num(1, 100000, true);
const bool = member([true, false]);
const point = { x: num(-1000000, 1000000), y: num(-1000000, 1000000), elevation: num(-1000000, 1000000) };

function jsonErrors(value, path = '$', ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return [];
  if (typeof value === 'number') return Number.isFinite(value) ? [] : [`${path}: non-finite JSON number`];
  if (!value || typeof value !== 'object') return [`${path}: must be plain JSON`];
  if (ancestors.has(value)) return [`${path}: cyclic JSON`];
  const proto = Object.getPrototypeOf(value);
  if (Array.isArray(value) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) return [`${path}: non-plain JSON prototype`];
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) return [`${path}: symbol keys are not JSON`];
  if (Array.isArray(value) && (keys.length !== value.length + 1 || keys.some((key) => key !== 'length' && !/^(0|[1-9][0-9]*)$/u.test(key)))) return [`${path}: sparse/decorated array`];
  const next = new Set(ancestors).add(value);
  return keys.filter((key) => key !== 'length' || !Array.isArray(value)).flatMap((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')
      ? [`${path}.${key}: non-data JSON property`]
      : jsonErrors(descriptor.value, `${path}.${key}`, next);
  });
}

function schemaErrors(value, schema, path = '$') {
  if (typeof schema === 'function') return schema(value) ? [] : [`${path}: invalid value`];
  if (Object.hasOwn(schema, 'nullable')) return value === null ? [] : schemaErrors(value, schema.nullable, path);
  if (Object.hasOwn(schema, 'list')) {
    if (!Array.isArray(value) || value.length < schema.min || value.length > schema.max) return [`${path}: invalid bounded list`];
    return value.flatMap((item, index) => schemaErrors(item, schema.list, `${path}[${index}]`));
  }
  if (Object.hasOwn(schema, 'tuple')) {
    if (!Array.isArray(value) || value.length !== schema.tuple.length) return [`${path}: invalid tuple`];
    return value.flatMap((item, index) => schemaErrors(item, schema.tuple[index], `${path}[${index}]`));
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${path}: expected object`];
  const keys = Object.keys(value), expected = Object.keys(schema);
  if (keys.length !== expected.length || keys.some((key) => !Object.hasOwn(schema, key))) return [`${path}: exact keys required: ${expected.join(', ')}`];
  return expected.flatMap((key) => schemaErrors(value[key], schema[key], `${path}.${key}`));
}

const durationSchema = {
  minMs: positive, maxMs: positive, distanceCapYards: positive, msPerYard: positive,
  addressMs: positive, settleWithinAddressMs: positive, backswingWithinAddressMs: positive,
  contactMs: positive, restMs: positive, restAllocationMs: { watch: positive, reaction: positive, release: positive },
};
const manifestSchema = {
  version: lit(2), id: lit('relaxed-golfer-activity'), stage: lit('staging-proposal'), productionArtApproved: lit(false),
  compatibility: {
    legacyVersion: lit(1), framePx: { width: lit(48), height: lit(72) }, feetPx: { x: lit(24), y: lit(69) }, displayWidthAtZoom1: lit(26),
    layers: fixedList(['base', 'tint']), tintChannels: fixedList(['shirt', 'hat']), shadow: lit('separate-grounded-child'),
    authoredDirections: fixedList(['s', 'sw', 'w', 'nw', 'n']),
    mirrors: tuple({ target: lit('se'), source: lit('sw') }, { target: lit('e'), source: lit('w') }, { target: lit('ne'), source: lit('nw') }),
    legacyStance: lit('right-authored-mirror-unverified'),
  },
  artVariants: {
    handedness: fixedList(['right', 'left']), equipmentClasses: fixedList(['none', 'driver', 'iron', 'wedge', 'putter']), unknownInput: lit(null),
    optionalDirectionOrder: fixedList(['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne']), optionalMirroring: lit(false), missingVariant: lit('legacy-unverified-fallback'),
  },
  clips: list({
    id: label(64), tier: member(['legacy', 'optional']), assetStatus: member(['existing-placeholder', 'not-authored']), frames: num(1, 32, true), rows: num(1, 8, true),
    contactFrame: nullable(num(0, 31, true)), directionKey: member(['facing', 'target', 'south-only']), loop: member(['distance', 'bounded-idle', 'once']),
    activities: list(member(activities), 1, 9), fallback: nullable(label(64)),
  }, 11, 11),
  activityGraph: { start: lit('walk'), nodes: fixedList(activities), edges: list(tuple(member(activities), member(activities)), 9, 10), interruption: lit('discard-to-current-authority'), scheduling: lit('observed-authority-only') },
  pacing: {
    referenceRevision: lit('c08a5ff'), referencePath: lit('simgolf-lite/docs/readable-shot-pacing.md'), integrationState: lit('reference-only-on-base-5729faf'),
    clock: lit('shared-shot-pacing-v1'), additionalGameplayMs: lit(0), additionalPresentationDwellMs: lit(0), maxFrameDeltaMs: lit(100),
    swing: durationSchema, putt: durationSchema, followWithinMovementMs: { swing: positive, putt: positive },
    contactEvent: lit('retained-launch-at-contact-window-end'), reactionPlayback: lit('static-final-pose-no-compressed-cycle'),
    reactionProposal: {
      minMs: lit(1200), maxMs: lit(2400), active: lit(false), decision: lit('review-required-exceeds-shared-rest'), extraDwellMs: lit(0),
      candidatePolicies: fixedList(['reallocate-within-existing-total', 'optional-outcome-dwell']), candidateMaxPresentationDwellMs: lit(2400),
      candidateGameplayMs: lit(0), candidateCompletionOwner: lit('existing-shared-caller-once'),
    },
  },
  policies: {
    foreground: lit('explicit-follow-or-controlled-round-shared-clock'), overview: lit('current-authority-or-matching-shared-frame'), overviewMaxVisualLagMs: lit(0),
    overviewIndependentClocks: lit(0), overviewMayHoldSimulation: lit(false), overviewFallback: lit('stable-current-authority-pose'), catchUp: lit('discard-no-run-no-route-no-replay'),
    hidden: lit('hold-discard-wall-time'), paused: lit('hold-visible-explicit-skip-only'), reducedMotion: lit('stable-pose-honor-pause'), ownershipLoss: lit('discard-before-publish'),
    rootMotion: lit('authority-only'), walkStride: lit('authoritative-distance-only'), walkStridesPerTile: lit(1.35), simulationWrites: lit(false), rngReads: lit(false), outcomeInference: lit(false), economyDebits: lit(false),
    completionOwner: lit('existing-shared-caller-once'),
  },
  limits: {
    maxActivityActors: num(1, 128, true), maxActivitiesPerActor: lit(1), maxForegroundShots: lit(1), maxPendingShots: lit(0), maxRetainedShotsPerActor: lit(1),
    maxActivityRetentionMs: num(1, 10000, true), holdersPerActor: lit(1), contactShadowsPerHolder: lit(1), newWorldEffectsPerTick: lit(0), overflow: lit('current-authority-legacy-pose-no-activity-record'),
  },
  ownership: {
    keyEncoding: lit('json-tuple'), tupleFields: fixedList(ownerFields), scopeMustInclude: fixedList(['world-or-round', 'participant-or-actor', 'day-or-round-epoch', 'reconcile-epoch']),
    compare: lit('full-owner-before-frame-and-completion'), nonShotIdentity: lit(null),
  },
  io: {
    version: lit(2), input: fixedList(['version', 'mode', 'owner', 'currentOwner', 'authority', 'clock', 'visibility']),
    output: fixedList(['version', 'ownerKey', 'activity', 'clipId', 'frame', 'root', 'feetPx', 'renderedEquipmentClass', 'renderedHandedness', 'source', 'degraded', 'completionClaim']),
    unknownFacts: lit(null), ballOutput: lit('none-use-retained-motion-sampler'), invalidInput: lit('reject-no-publish'), publication: lit('input-and-output-validated-together'),
  },
  review: {
    technicalAcceptance: lit('independent-of-art-approval'), humanArtAcceptance: lit('pending'), prototype: lit('index.html'),
    prototypeMeaning: lit('non-shipping-synthetic-storyboard-no-simulation-claims'), rollback: lit('remove-staging-files-and-art-guide-link'),
  },
};

/** Errors are data. An invalid manifest never authorizes a partial consumer. */
export function validateContract(value) {
  const errors = jsonErrors(value);
  if (errors.length) return errors;
  errors.push(...schemaErrors(value, manifestSchema));
  if (errors.length) return errors;
  const check = (condition, message) => { if (!condition) errors.push(message); };
  const ids = value.clips.map((clip) => clip.id);
  check(new Set(ids).size === ids.length, 'clips: duplicate id');
  for (const clip of value.clips) {
    const spec = legacy[clip.id], addition = optional[clip.id];
    check(Boolean(spec || addition), `clips.${clip.id}: undocumented clip`);
    check(eq(clip.activities, clipActivities[clip.id]), `clips.${clip.id}: activity semantics changed`);
    check(new Set(clip.activities).size === clip.activities.length, `clips.${clip.id}: duplicate activity`);
    check(clip.contactFrame === null || clip.contactFrame < clip.frames, `clips.${clip.id}: contact outside clip`);
    if (spec) check(clip.tier === 'legacy' && clip.assetStatus === 'existing-placeholder' && eq([clip.frames, clip.rows, clip.contactFrame, clip.directionKey, clip.loop], spec) && clip.fallback === null, `clips.${clip.id}: legacy compatibility changed`);
    if (addition) {
      const aimClip = ['address', 'watch'].includes(clip.id);
      check(clip.tier === 'optional' && clip.assetStatus === 'not-authored' && clip.frames === addition[0] && clip.rows === 8 && clip.contactFrame === null && clip.fallback === addition[1] && clip.directionKey === (aimClip ? 'target' : 'facing') && clip.loop === (aimClip ? 'bounded-idle' : 'once'), `clips.${clip.id}: optional contract changed`);
      const fallback = value.clips.find((candidate) => candidate.id === clip.fallback);
      check(fallback?.tier === 'legacy' && clip.activities.every((activity) => fallback.activities.includes(activity)), `clips.${clip.id}: missing/incompatible terminal fallback`);
    }
  }
  for (const id of [...Object.keys(legacy), ...Object.keys(optional)]) check(ids.includes(id), `clips: missing ${id}`);
  for (const activity of activities) check(value.clips.some((clip) => clip.activities.includes(activity)), `activityGraph: uncovered ${activity}`);
  const edges = value.activityGraph.edges.map((edge) => edge.join('>'));
  check(new Set(edges).size === edges.length && edges.every((edge) => allowedEdges.includes(edge)), 'activityGraph: duplicate/unsupported edge');
  check(edges.includes('watch>walk-on'), 'activityGraph: reaction must be optional');
  const reachable = new Set([value.activityGraph.start]);
  for (let pass = 0; pass < activities.length; pass++) for (const [from, to] of value.activityGraph.edges) if (reachable.has(from)) reachable.add(to);
  check(reachable.size === activities.length, 'activityGraph: unreachable activity');
  for (const kind of ['swing', 'putt']) {
    const p = value.pacing[kind], expected = kind === 'swing' ? [6000, 10000, 400, 10, 1000, 200, 900] : [2400, 4200, 40, 45, 500, 150, 650];
    check(eq([p.minMs, p.maxMs, p.distanceCapYards, p.msPerYard, p.addressMs, p.contactMs, p.restMs], expected), `pacing.${kind}: shared envelope changed`);
    check(p.minMs + p.distanceCapYards * p.msPerYard === p.maxMs, `pacing.${kind}: duration sum mismatch`);
    check(p.settleWithinAddressMs + p.backswingWithinAddressMs < p.addressMs, `pacing.${kind}: no address hold remains`);
    check(Object.values(p.restAllocationMs).reduce((sum, ms) => sum + ms, 0) === p.restMs, `pacing.${kind}: rest allocation sum mismatch`);
    check(p.addressMs + p.contactMs + p.restMs + value.pacing.followWithinMovementMs[kind] < p.minMs, `pacing.${kind}: no retained movement/watch budget`);
    check(value.limits.maxActivityRetentionMs >= p.maxMs, `limits: retention cannot cover ${kind}`);
  }
  return errors;
}

/** Pure review calculator; callers still consume the real shared clock in production. */
export function activityWindows(contract, kind, distanceYards) {
  if (validateContract(contract).length || !['swing', 'putt'].includes(kind) || !num(0, Number.MAX_VALUE)(distanceYards)) return null;
  const p = contract.pacing[kind], durationMs = p.minMs + Math.min(p.distanceCapYards, distanceYards) * p.msPerYard;
  const motionStartMs = p.addressMs + p.contactMs, motionEndMs = durationMs - p.restMs;
  const boundaries = [0, p.settleWithinAddressMs, p.addressMs - p.backswingWithinAddressMs, p.addressMs, motionStartMs,
    motionStartMs + contract.pacing.followWithinMovementMs[kind], motionEndMs, motionEndMs + p.restAllocationMs.watch,
    motionEndMs + p.restAllocationMs.watch + p.restAllocationMs.reaction, durationMs];
  return { durationMs, motionStartMs, motionEndMs, windows: ['settle', 'address', 'backswing', 'contact', 'follow', 'watch', 'watch', 'reaction', 'watch'].map((activity, index) => ({ activity, startMs: boundaries[index], endMs: boundaries[index + 1] })) };
}

const identity = { shotId: label(), holeId: label(), shotNumber: num(1, 4096, true), seed: num(0, 0xffffffff, true), club: label(64), style: label(64), modelVersion: label(64) };
const ownerSchema = { scopeId: label(), actorId: label(), shot: nullable(identity) };
export function activityOwnerKey(owner) {
  if (jsonErrors(owner).length || schemaErrors(owner, ownerSchema).length) return null;
  return JSON.stringify(owner.shot ? [owner.scopeId, owner.actorId, ...ownerFields.slice(2).map((field) => owner.shot[field])] : [owner.scopeId, owner.actorId, null]);
}
const inputSchema = {
  version: lit(2), mode: member(['foreground', 'overview']), owner: ownerSchema, currentOwner: ownerSchema,
  authority: {
    root: point, segment: nullable(member(['walk', 'pause', 'flight'])), segmentProgress: num(0, 1), facingOctant: num(0, 7, true), targetOctant: nullable(num(0, 7, true)),
    walk: nullable({ segmentId: label(), distanceTiles: num(0, 1000000) }),
    shotKind: nullable(member(['swing', 'putt'])), equipmentClass: nullable(member(['none', 'driver', 'iron', 'wedge', 'putter'])), handedness: nullable(member(['right', 'left'])), reaction: nullable(member(['positive', 'negative'])),
  },
  clock: nullable({ provider: lit('shared-shot-pacing-v1'), key: label(4096), kind: member(['swing', 'putt']), distanceYards: num(0, Number.MAX_VALUE), elapsedMs: num(0, 10000), durationMs: num(2400, 10000), phase: member(['address', 'contact', 'flight', 'roll', 'rest', 'complete']), motionProgress: num(0, 1), firstContactT: num(0, 1), held: bool }),
  visibility: { hidden: bool, paused: bool, reducedMotion: bool },
};
const outputSchema = {
  version: lit(2), ownerKey: label(4096), activity: member(activities), clipId: label(64), frame: { row: num(0, 7, true), col: num(0, 31, true), mirror: bool },
  root: point, feetPx: { x: lit(24), y: lit(69) }, renderedEquipmentClass: nullable(member(['none', 'driver', 'iron', 'wedge', 'putter'])), renderedHandedness: nullable(member(['right', 'left'])),
  source: member(['shared-clock', 'current-authority']), degraded: bool, completionClaim: lit(false),
};

/** Publication guard for an adapter's input/output pair; does not create poses or authority. */
export function validateActivityFrame(contract, input, output) {
  const errors = validateContract(contract);
  if (errors.length) return errors;
  errors.push(...jsonErrors(input), ...jsonErrors(output));
  if (errors.length) return errors;
  errors.push(...schemaErrors(input, inputSchema, '$input'), ...schemaErrors(output, outputSchema, '$output'));
  if (errors.length) return errors;
  const check = (condition, message) => { if (!condition) errors.push(message); };
  const key = activityOwnerKey(input.owner), currentKey = activityOwnerKey(input.currentOwner), clip = contract.clips.find((candidate) => candidate.id === output.clipId);
  check(key === currentKey && output.ownerKey === key, 'ownership: complete owner mismatch');
  check((input.owner.shot === null) === (input.authority.shotKind === null), 'ownership: shot/authority presence mismatch');
  check(input.authority.walk === null || input.authority.segment === 'walk', 'walk: accumulator outside authoritative walk');
  check(['x', 'y', 'elevation'].every((axis) => input.authority.root[axis] === output.root[axis]), 'root: presentation cannot move the actor');
  check(Boolean(clip), 'clip: unknown');
  if (!clip) return errors;
  check(clip.activities.includes(output.activity), 'clip: activity incompatible');
  check(output.frame.row < clip.rows && output.frame.col < clip.frames, 'frame: outside clip');
  const directionOctant = clip.directionKey === 'target' ? input.authority.targetOctant : input.authority.facingOctant;
  check(directionOctant !== null, 'direction: missing authoritative target; use stable idle fallback');
  if (clip.tier === 'legacy') {
    check(output.renderedHandedness === null && output.renderedEquipmentClass === null && output.degraded, 'legacy: unverified handedness/equipment must remain unknown');
    const oct = directionOctant;
    const expected = clip.rows === 1 ? [0, false] : oct >= 2 && oct <= 6 ? [oct - 2, false] : oct === 1 ? [1, true] : oct === 0 ? [2, true] : [3, true];
    check(eq([output.frame.row, output.frame.mirror], expected), 'legacy: octant row/mirror mismatch');
  } else {
    check(!output.frame.mirror && output.frame.row === directionOctant, 'optional: explicit eight directions required');
    check(input.authority.handedness !== null && output.renderedHandedness === input.authority.handedness && input.authority.equipmentClass !== null && output.renderedEquipmentClass === input.authority.equipmentClass && !output.degraded, 'optional: exact authored equipment and handedness required');
    errors.push('optional: not-authored clip cannot be published by this staging contract');
  }
  if (output.activity === 'reaction') {
    check(input.authority.reaction !== null, 'reaction: no revealed outcome signal');
    check(output.frame.col === clip.frames - 1, 'reaction: quiet final pose only; no compressed cycle');
    check(input.authority.reaction === 'positive' ? ['cheer', 'react-positive'].includes(clip.id) : ['mad', 'react-negative'].includes(clip.id), 'reaction: outcome/clip mismatch');
  }
  const stableIdle = output.activity === 'watch' && clip.id === 'idle' && output.frame.col === 0;
  if (input.visibility.reducedMotion && !input.visibility.paused && !input.visibility.hidden) check(stableIdle, 'reduced motion: stable idle fallback required while advancing');
  if (['walk', 'walk-on'].includes(output.activity)) {
    check(input.authority.segment === 'walk' && input.authority.walk !== null && clip.id === 'walk', 'walk: no exact authoritative segment/distance');
    if (input.authority.walk) check(output.frame.col === Math.floor(input.authority.walk.distanceTiles * contract.policies.walkStridesPerTile * clip.frames) % clip.frames, 'walk: frame must derive from authoritative displacement');
  }
  if (input.clock === null) {
    check(input.mode === 'overview' && output.source === 'current-authority', 'clock: foreground requires shared sample');
    check(['walk', 'watch'].includes(output.activity) && (output.activity !== 'watch' || (clip.id === 'idle' && output.frame.col === 0)), 'overview: stable current-authority fallback only');
  } else {
    const clock = input.clock, windows = activityWindows(contract, clock.kind, clock.distanceYards);
    check(input.owner.shot !== null && clock.key === key && input.authority.shotKind === clock.kind, 'clock: shot owner/kind mismatch');
    if (input.owner.shot) {
      check((input.owner.shot.club === 'Putter' ? 'putt' : 'swing') === clock.kind, 'clock: retained club/kind mismatch');
      check(input.authority.equipmentClass === null || (clock.kind === 'putt' ? input.authority.equipmentClass === 'putter' : input.authority.equipmentClass !== 'putter'), 'clock: equipment/kind mismatch');
    }
    check(clock.durationMs === windows.durationMs && clock.elapsedMs <= clock.durationMs, 'clock: shared duration mismatch');
    check(output.source === 'shared-clock', 'clock: wrong output source');
    check(!(input.visibility.paused || input.visibility.hidden) || clock.held, 'clock: pause/hidden must hold');
    const expectedProgress = Math.max(0, Math.min(1, (clock.elapsedMs - windows.motionStartMs) / (windows.motionEndMs - windows.motionStartMs)));
    check(Math.abs(clock.motionProgress - expectedProgress) <= 1e-12, 'clock: retained movement ratio mismatch');
    const expectedPhase = clock.elapsedMs === clock.durationMs ? 'complete' : clock.elapsedMs < contract.pacing[clock.kind].addressMs ? 'address' : clock.elapsedMs < windows.motionStartMs ? 'contact' : clock.elapsedMs >= windows.motionEndMs ? 'rest' : expectedProgress < clock.firstContactT ? 'flight' : 'roll';
    check(clock.phase === expectedPhase, 'clock: phase outside shared window');
    const window = windows.windows.find((candidate) => clock.elapsedMs >= candidate.startMs && clock.elapsedMs < candidate.endMs);
    const atLaunch = clock.elapsedMs === windows.motionStartMs;
    const stableFallback = stableIdle && (input.visibility.reducedMotion || input.authority.targetOctant === null || ((input.visibility.paused || input.visibility.hidden) && clock.held));
    check(stableFallback || output.activity === window?.activity || (window?.activity === 'reaction' && output.activity === 'watch') || (atLaunch && output.activity === 'contact') || (clock.phase === 'complete' && output.activity === 'watch'), 'activity: outside finite shared budget');
    if (['swing', 'putt'].includes(clip.id)) {
      check(clip.id === clock.kind, 'contact: clip/shot kind mismatch');
      check(clock.elapsedMs < windows.motionStartMs ? output.frame.col < clip.contactFrame : atLaunch ? output.frame.col === clip.contactFrame : output.frame.col > clip.contactFrame, 'contact: phase-wide frame/launch alignment');
    }
    if (output.activity === 'contact') check(clip.id === clock.kind && (!atLaunch || output.frame.col === clip.contactFrame) && (atLaunch || output.frame.col < clip.contactFrame), 'contact: frame/launch alignment');
  }
  return errors;
}

/** Check sequential samples without maintaining a competing presentation clock. */
export function validateActivityTransition(contract, previous, next, request) {
  const requestErrors = jsonErrors(request);
  if (!requestErrors.length) requestErrors.push(...schemaErrors(request, { deltaMs: num(0, Number.MAX_VALUE), explicitSkip: bool, reducedMotionSkip: bool }, '$request'));
  if (requestErrors.length) return requestErrors;
  const packetErrors = [...jsonErrors(previous), ...jsonErrors(next)];
  if (packetErrors.length) return packetErrors;
  if (!previous || !next || Object.keys(previous).sort().join(',') !== 'input,output' || Object.keys(next).sort().join(',') !== 'input,output') return ['transition: exact input/output packets required'];
  const errors = [...validateActivityFrame(contract, previous.input, previous.output), ...validateActivityFrame(contract, next.input, next.output)];
  if (errors.length) return errors;
  const sameOwner = activityOwnerKey(previous.input.owner) === activityOwnerKey(next.input.owner);
  if (!sameOwner) return errors; // Acquisition/cancellation is owned elsewhere.
  const { hidden, paused, reducedMotion } = next.input.visibility;
  const allowedSkip = !hidden && (request.explicitSkip || (request.reducedMotionSkip && reducedMotion && !paused));
  const body = (output) => [output.activity, output.clipId, output.frame.row, output.frame.col, output.frame.mirror, output.root.x, output.root.y, output.root.elevation];
  if ((hidden || (paused && !allowedSkip)) && !eq(body(previous.output), body(next.output))) errors.push('transition: held body pose changed');
  const beforeWalk = previous.input.authority.walk, afterWalk = next.input.authority.walk;
  if (afterWalk) {
    if (beforeWalk?.segmentId === afterWalk.segmentId) {
      const a = previous.input.authority.root, b = next.input.authority.root;
      const displacement = Math.hypot(b.x - a.x, b.y - a.y);
      if (Math.abs(afterWalk.distanceTiles - beforeWalk.distanceTiles - displacement) > 1e-9) errors.push('transition: walk stride distance differs from root displacement');
    } else if (afterWalk.distanceTiles !== 0) errors.push('transition: new walk segment must start at zero observed distance');
  }
  const before = previous.input.clock, after = next.input.clock;
  if (!before || !after) return errors;
  const expected = hidden || (paused && !allowedSkip) ? before.elapsedMs
    : allowedSkip ? after.durationMs : Math.min(after.durationMs, before.elapsedMs + Math.min(contract.pacing.maxFrameDeltaMs, request.deltaMs));
  if (after.elapsedMs !== expected) errors.push('transition: hold/skip/frame-cap violation; discard background time');
  if (before.kind !== after.kind || before.distanceYards !== after.distanceYards || before.durationMs !== after.durationMs || before.firstContactT !== after.firstContactT) errors.push('transition: acquired shared plan changed for same owner');
  return errors;
}

/** One current activity per exact actor; expiry excludes held wall time. */
export function validateActivityRetention(contract, records) {
  const errors = validateContract(contract);
  if (errors.length) return errors;
  errors.push(...jsonErrors(records));
  if (errors.length) return errors;
  errors.push(...schemaErrors(records, list({ owner: ownerSchema, foreground: bool, activeVisibleMs: num(0, contract.limits.maxActivityRetentionMs) }, 0, contract.limits.maxActivityActors), '$records'));
  if (errors.length) return errors;
  const actors = records.map(({ owner }) => JSON.stringify([owner.scopeId, owner.actorId]));
  if (new Set(actors).size !== actors.length) errors.push('retention: duplicate actor/activity');
  if (records.filter(({ foreground }) => foreground).length > contract.limits.maxForegroundShots) errors.push('retention: multiple foreground owners');
  return errors;
}

export const contractPath = fileURLToPath(new URL('./activity-contract.json', import.meta.url));
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const value = JSON.parse(await readFile(process.argv[2] ?? contractPath, 'utf8'));
    const errors = validateContract(value);
    if (errors.length) { process.stderr.write(`${errors.join('\n')}\n`); process.exitCode = 1; }
    else process.stdout.write(`relaxed golfer contract v${value.version}: valid staging proposal (${value.clips.length} clips; art approval pending)\n`);
  } catch (error) { process.stderr.write(`contract: ${error.message}\n`); process.exitCode = 1; }
}
