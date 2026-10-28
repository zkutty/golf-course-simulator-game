import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const pixi = join(appRoot, 'node_modules/pixi.js/lib');
const metadata = JSON.parse(readFileSync(new URL('./pixi-reset-patch.json', import.meta.url)));
const require = createRequire(import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const idPath = 'rendering/renderers/shared/utils/createIdFromString';
const glPath = 'rendering/renderers/gl/shader/GlProgram';
const adapterPath = 'environment/adapter';
// Append-only observers return scalars, not private objects/programs. The legacy
// branch makes the unchanged source fail on actual retired key ownership, not
// merely because new lease variable names are absent. Installed files stay intact.
const idObserver = `
function __readIds() {
  const keys = Object.keys(idHash);
  if (keys.length > 256) throw new Error("test-ID-key-cap");
  let keyBytes = 0;
  for (const key of keys) keyBytes += Buffer.byteLength(key, "utf8");
  return { entries: keys.length, keyBytes };
}
`;
const glObserver = `
function __readProgramState() {
  const leased = typeof programKeyRecords !== "undefined";
  let entries = null, references = null, keyBytes = null;
  if (leased) {
    entries = programKeyRecords.size; references = 0; keyBytes = 0;
    if (entries > 256) throw new Error("test-program-key-cap");
    for (const [key, record] of programKeyRecords) {
      references += record.references; keyBytes += Buffer.byteLength(key, "utf8");
    }
  }
  const rawKeys = Object.keys(programCache);
  if (rawKeys.length > 8) throw new Error("test-raw-key-cap");
  return { leased, entries, references, keyBytes, rawEntries: rawKeys.length,
    rawLive: rawKeys.filter(key => Boolean(programCache[key])).length };
}
`;

async function fixture(format) {
  const ext = format === 'esm' ? 'mjs' : 'js';
  const temporary = mkdtempSync(join(tmpdir(), 'pixi-gl-program-lifetime-'));
  const utilitySourcePath = join(pixi, `${idPath}.${ext}`);
  const programSourcePath = join(pixi, `${glPath}.${ext}`);
  const utilityPath = join(temporary, `ids.${format === 'esm' ? 'mjs' : 'cjs'}`);
  const programPath = join(temporary, `program.${format === 'esm' ? 'mjs' : 'cjs'}`);
  const utility = readFileSync(utilitySourcePath);
  const program = readFileSync(programSourcePath);
  const target = metadata.files.find(item => item.relativePath === `lib/${glPath}.${ext}`);
  assert(target, 'GlProgram must be an exact guarded patch target');
  assert([target.originalSha256, target.patchedSha256].includes(hash(program)), 'known original or admitted patched source');
  const exports = format === 'esm'
    ? ['export { __readIds };\n', 'export { __readProgramState };\n']
    : ['exports.__readIds = __readIds;\n', 'exports.__readProgramState = __readProgramState;\n'];
  const utilitySuffix = idObserver + exports[0];
  writeFileSync(utilityPath, Buffer.concat([utility, Buffer.from(utilitySuffix)]));
  assert(readFileSync(utilityPath).subarray(0, -Buffer.byteLength(utilitySuffix)).equals(utility));
  const rewrites = [];
  let relocated = program.toString('utf8').replace(/(?:from\s+|require\()(['"])(\.\.?\/[^'"]+)\1/g,
    (match, quote, relative) => {
      const origin = resolve(dirname(programSourcePath), relative);
      const destination = origin === utilitySourcePath ? utilityPath : origin;
      const before = `${quote}${relative}${quote}`;
      const after = JSON.stringify(format === 'esm' ? pathToFileURL(destination).href : destination);
      rewrites.push({ before, after });
      return match.replace(before, after);
    });
  const programSuffix = glObserver + exports[1];
  writeFileSync(programPath, relocated + programSuffix);
  let restored = readFileSync(programPath, 'utf8').slice(0, -programSuffix.length);
  for (const rewrite of rewrites.toReversed()) {
    assert.equal(restored.split(rewrite.after).length, 2, 'unique import inverse');
    restored = restored.replace(rewrite.after, rewrite.before);
  }
  assert(Buffer.from(restored).equals(program), 'all original function bodies and installed source restore byte-exact');
  const load = path => format === 'esm' ? import(pathToFileURL(path).href) : Promise.resolve(require(path));
  const utilityModule = await load(utilityPath);
  const programModule = await load(programPath);
  const { DOMAdapter } = await load(join(pixi, `${adapterPath}.${ext}`));
  const previousAdapter = DOMAdapter.get();
  DOMAdapter.set({ createCanvas: () => ({ getContext: () => null }) });
  const programs = new Set();
  const own = value => { programs.add(value); return value; };
  return {
    create: options => own(new programModule.GlProgram(options)),
    from: options => own(programModule.GlProgram.from(options)),
    createId: utilityModule.createIdFromString,
    state: () => {
      const state = programModule.__readProgramState();
      const keys = state.leased ? { entries: state.entries, keyBytes: state.keyBytes } : utilityModule.__readIds();
      return { ...state, ...keys };
    },
    close() {
      try { for (const value of programs) value.destroy(); }
      finally { DOMAdapter.set(previousAdapter); rmSync(temporary, { recursive: true, force: true }); }
    },
  };
}

function options({ predefined = false, precision = true, body = '1.0' } = {}) {
  return {
    name: 'lease lifetime',
    vertex: (precision ? 'precision highp float;\n' : '')
      + (predefined ? '#define SHADER_NAME fixed-vertex\n' : '')
      + 'attribute vec2 aPosition;\nvoid main(void) { gl_Position=vec4(aPosition,0.0,1.0); }\n',
    fragment: (precision ? 'precision mediump float;\n' : '')
      + (predefined ? '#define SHADER_NAME fixed-fragment\n' : '')
      + `void main(void) { gl_FragColor=vec4(${body}); }\n`,
  };
}

for (const format of ['esm', 'cjs']) {
  for (const mode of ['from', 'create']) {
    test(`${format}: ${mode}/destroy releases 64 numbered source keys and owned raw cache keys`, { concurrency: false }, async context => {
      const f = await fixture(format);
      try {
        const ids = new Set(); let processedKeyBytes = 0;
        for (let index = 0; index < 64; index += 1) {
          const value = f[mode](options());
          ids.add(value._key);
          processedKeyBytes += Buffer.byteLength(`${value.vertex}:${value.fragment}`, 'utf8');
          value.destroy();
          assert.equal(value.vertex, null); assert.equal(value.fragment, null);
        }
        const state = f.state();
        context.diagnostic(JSON.stringify({ format, mode, processedKeyBytes, retiredKeys: state.entries,
          retiredKeyLogicalBytes: state.keyBytes, rawEntries: state.rawEntries }));
        assert.equal(ids.size, 64, 'numbered processed sources preserve their distinct identities');
        assert.equal(state.entries, 0, 'retired exact source keys must have no remaining module owner');
        assert.equal(state.keyBytes, 0, 'retired logical key payload must be released');
        assert.equal(state.rawEntries, 0, 'no raw tombstones or direct-new undefined slot');
      } finally { f.close(); }
    });
  }
  for (const retirementOrder of ['first', 'second']) {
    test(`${format}: source-equivalent live peers survive ${retirementOrder}-first and duplicate retirement`, { concurrency: false }, async () => {
      const f = await fixture(format);
      try {
        const source = options({ predefined: true });
        const first = f.create(source), second = f.create(source);
        assert.equal(first === second, false); assert.equal(first._key, second._key);
        const id = first._key;
        const retiring = retirementOrder === 'first' ? first : second;
        const survivor = retirementOrder === 'first' ? second : first;
        retiring.destroy(); retiring.destroy();
        const peer = f.create(source);
        assert.equal(survivor._key, id); assert.equal(peer._key, id);
        assert.equal(typeof survivor.fragment, 'string');
        survivor.destroy(); assert.equal(peer._key, id);
        peer.destroy();
        assert.equal(f.state().entries, 0, 'last owner removes its exact source record');
        const later = f.create(source);
        assert(later._key > id, 'retired IDs are never reused for stale renderer caches');
      } finally { f.close(); }
    });
  }
  test(`${format}: an old cached instance cannot evict a recreated live cache owner`, { concurrency: false }, async () => {
    const f = await fixture(format);
    try {
      const source = options({ predefined: true });
      const old = f.from(source); const oldId = old._key; old.destroy();
      const live = f.from(source); const liveId = live._key;
      old.destroy();
      assert.equal(f.from(source) === live, true, 'duplicate retirement must not evict the new owner');
      assert.equal(live._key, liveId); assert(liveId > oldId, 'new lifetime gets a fresh ID');
      assert.equal(typeof live.vertex, 'string');
    } finally { f.close(); }
  });
  test(`${format}: live from reuse and its existing raw-only option cache semantics remain intact`, { concurrency: false }, async () => {
    const f = await fixture(format);
    try {
      const source = options(); const live = f.from(source); const id = live._key;
      for (let index = 0; index < 64; index += 1) assert.equal(f.from(source) === live, true);
      assert.equal(f.from({ ...source, name: 'other', preferredFragmentPrecision: 'lowp',
        transformFeedbackVaryings: { names: ['vOther'], bufferMode: 'separate' } }) === live, true);
      assert.equal(live._key, id); assert.equal(f.state().entries, 1); assert.equal(f.state().rawLive, 1);
    } finally { f.close(); }
  });
  test(`${format}: actual processed source and effective precision distinctions retain separate live IDs`, { concurrency: false }, async () => {
    const f = await fixture(format);
    try {
      const source = options({ predefined: true, precision: false });
      const medium = f.create({ ...source, preferredFragmentPrecision: 'mediump' });
      const low = f.create({ ...source, preferredFragmentPrecision: 'lowp' });
      const different = f.create(options({ predefined: true, body: '0.5' }));
      assert.match(medium.fragment, /precision mediump float;/); assert.match(low.fragment, /precision lowp float;/);
      assert.notEqual(medium.fragment, low.fragment);
      assert.equal(new Set([medium._key, low._key, different._key]).size, 3);
      low.destroy(); assert.equal(typeof medium.fragment, 'string');
    } finally { f.close(); }
  });
  test(`${format}: transform-feedback payload and existing source-only ID edge are explicitly preserved`, { concurrency: false }, async () => {
    const f = await fixture(format);
    try {
      const source = options({ predefined: true });
      const a = { names: ['vPosition'], bufferMode: 'separate' };
      const b = { names: ['vOther'], bufferMode: 'interleaved' };
      const first = f.create({ ...source, transformFeedbackVaryings: a });
      const second = f.create({ ...source, transformFeedbackVaryings: b });
      assert.equal(first.transformFeedbackVaryings === a, true); assert.equal(second.transformFeedbackVaryings === b, true);
      assert.equal(first.vertex, second.vertex); assert.equal(first.fragment, second.fragment);
      // Existing GlProgram._key does not encode transform-feedback options.
      // This lifetime repair preserves that limitation; it does not broaden it.
      assert.equal(first._key, second._key);
      first.destroy(); assert.equal(second.transformFeedbackVaryings === b, true);
    } finally { f.close(); }
  });
  test(`${format}: generic createIdFromString compatibility is unchanged`, { concurrency: false }, async () => {
    const f = await fixture(format);
    try {
      const first = f.createId('same', 'group-a');
      assert.equal(f.createId('same', 'group-a'), first);
      assert.equal(f.createId('same', 'group-b'), first, 'existing shared value table remains unchanged');
      assert.notEqual(f.createId('different', 'group-a'), first);
    } finally { f.close(); }
  });
}
