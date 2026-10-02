import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rename, symlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { installStartupCensus, createStartupCensus, validateCensusDirectory, CENSUS_BASELINE } from "./perf-startup-census.mjs";

function browser(maxRecords = 128, maxBytes = 127000) {
  let ticks = 0;
  const context = vm.createContext({ location: { href: "http://fixture/" }, performance: { now: () => ++ticks }, TextEncoder });
  vm.runInContext(`(${installStartupCensus.toString()})(${JSON.stringify({ baseline: CENSUS_BASELINE, commit: "diagnostic", maxRecords, maxBytes })})`, context);
  return context;
}
function cloneIn(context, source) {
  const start = source.indexOf("type StartupCensusObserver =");
  const end = source.indexOf("export function snapshotLiveSimulation", start);
  const js = ts.transpile(source.slice(start, end), { target: ts.ScriptTarget.ES2022 });
  vm.runInContext(js, context);
}

test("off is zero browser and filesystem calls", async () => {
  const forbidden = new Proxy({}, { get() { throw new Error("unexpected access"); } });
  assert.equal(await createStartupCensus({ page: forbidden, io: forbidden }), null);
});
test("identity is weak, primitives exact, first eight callers bounded, timings end", () => {
  const c = browser();
  vm.runInContext(`const owner = {}; for(let i=0;i<10;i++) { const token=__ccStartupCensus.begin('terrain-revision',owner,{ tile:owner, nan:NaN, negativeZero:-0, revision:1 }); __ccStartupCensus.end(token); }`, c);
  const report = JSON.parse(JSON.stringify(c.__ccStartupCensusRead()));
  assert.equal(report.complete, true);
  assert.equal(report.records.filter((r) => r.caller).length, 8);
  assert.equal(report.records[0].owner.objectId, report.records[9].inputs.tile.objectId);
  assert.equal(report.records[0].inputs.nan.value, "NaN");
  assert.equal(report.records[0].inputs.negativeZero.value, "-0");
  assert.ok(report.records.every((r) => r.endedAtMs > r.startedAtMs));
  assert.equal(c.__ccStartupCensus, undefined);
});
test("record and byte overflow fail closed without retaining inputs", () => {
  for (const [records, bytes] of [[2, 127000], [128, 4097]]) {
    const c = browser(records, bytes);
    vm.runInContext(`for(let i=0;i<4;i++) __ccStartupCensus.end(__ccStartupCensus.begin('clone',{},{}));`, c);
    const report = c.__ccStartupCensusRead();
    assert.equal(report.complete, false); assert.equal(report.overflow, true);
    assert.ok(report.records.length <= records);
  }
});
test("actual clone preserves outputs, exceptions and isolation with observer absent or throwing", async () => {
  const source = await readFile(new URL("../src/game/live/persistence.ts", import.meta.url), "utf8");
  for (const observer of [undefined, { begin() { throw new Error("observer"); }, end() { throw new Error("observer"); } }]) {
    const c = vm.createContext({ __ccStartupCensus: observer, performance: { now() { throw new Error("off timer"); } } });
    cloneIn(c, source);
    vm.runInContext(`const input = { golfers: [{id:1}], nested:{x:2} }; const result = cloneSerializableState(input); if(result===input || result.golfers===input.golfers || result.nested.x!==2) throw Error('clone changed'); input.self=input;`, c);
    assert.throws(() => vm.runInContext("cloneSerializableState(input)", c), /circular/i);
  }
});
test("actual terrain lifecycle retains revision skip, phase order and exception when callbacks throw", async () => {
  const source = await readFile(new URL("../src/ui/renderer/scenes/terrainWaterScene.ts", import.meta.url), "utf8");
  const stripped = source.replace(/^import .*;$/gm, "").replace(/export /g, "");
  for (const observer of [undefined, { begin() { throw Error("observer"); }, end() { throw Error("observer"); } }]) {
    const c = vm.createContext({ __ccStartupCensus: observer });
    vm.runInContext(ts.transpile(stripped, { target: ts.ScriptTarget.ES2022 }), c);
    vm.runInContext(`const scene = new TerrainWaterSceneSystem({}); const calls=[]; for(const phase of ['surround','terrain','connected']) scene.setRenderer(phase,()=>{calls.push(phase);}); const snapshot={revisions:{terrainWater:1}}; scene.create(snapshot); scene.update(snapshot); if(calls.join(',')!=='surround,terrain,connected') throw Error('order/skip changed'); scene.setRenderer('terrain',()=>{throw Error('original-renderer-error');});`, c);
    assert.throws(() => vm.runInContext("scene.update({revisions:{terrainWater:2}})", c), /original-renderer-error/);
  }
});
test("directory guard covers actual raw, custom output parent and symlink aliases", async () => {
  const root = await mkdtemp(join(tmpdir(), "census-guard-"));
  try {
    const raw = join(root, "raw");
    const custom = join(root, "custom", "perf.json");
    await assert.rejects(validateCensusDirectory(join(raw, "child"), custom, raw), /outside/);
    await assert.rejects(validateCensusDirectory(join(root, "custom", "child"), custom, raw), /outside/);
    await symlink(root, join(root, "alias"));
    await assert.rejects(validateCensusDirectory(join(root, "alias", "raw"), custom, raw), /outside/);
    assert.equal(await validateCensusDirectory(join(root, "separate"), custom, raw), join(await realpath(root), "separate"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("setup, collection and atomic publish failures stay separate from producer outcome", async () => {
  const root = await mkdtemp(join(tmpdir(), "census-errors-"));
  try {
    for (const failure of ["setup", "read", "write", "rename", "none"]) {
      let writes = 0; let renames = 0; let removals = 0;
      const page = { async addInitScript() { if(failure==='setup') throw Error('setup'); }, async evaluate() { if(failure==='read') throw Error('read'); return { complete:true, records:[] }; } };
      const io = { async mkdir(){}, async writeFile(){ writes++; if(failure==='write') throw Error('write'); }, async rename(){ renames++; if(failure==='rename') throw Error('rename'); }, async rm(){ removals++; } };
      const census = await createStartupCensus({ page, directory:join(root,'separate'), outputPath:join(root,'perf','result.json'), canonicalRaw:join(root,'raw'), io, log() { throw Error('log'); } });
      await census.collect('cold'); await census.collect('fixture'); await census.finish(); await census.finish();
      assert.equal(writes, 1); assert.equal(renames, failure==='write'?0:1);
      assert.equal(removals, ['write','rename'].includes(failure)?2:0);
      // The diagnostic operation resolves regardless; the original producer owns its exit code.
    }
  } finally { await rm(root, { recursive:true, force:true }); }
});


test("atomic publication exposes full bounded schema once, and missing phase stays incomplete", async () => {
  const root = await mkdtemp(join(tmpdir(), "census-publish-"));
  try {
    const c = browser();
    vm.runInContext(`__ccStartupCensus.end(__ccStartupCensus.begin('snapshot-clone',{},{}));`, c);
    const report = JSON.parse(JSON.stringify(c.__ccStartupCensusRead()));
    const directory = join(root, 'separate');
    const census = await createStartupCensus({page:{async addInitScript(){},async evaluate(){return report;}},directory,outputPath:join(root,'perf','receipt.json'),canonicalRaw:join(root,'raw'),commit:'diagnostic',log(){}});
    await census.collect('cold'); await census.finish(); await census.finish();
    const bytes = await readFile(join(directory,'startup-census.json'));
    const result = JSON.parse(bytes);
    assert.equal(result.complete,false); assert.equal(result.instrumented,true);
    assert.equal(result.baseline,CENSUS_BASELINE); assert.equal(result.diagnosticCommit,'diagnostic');
    assert.ok(bytes.length<=256*1024); assert.equal(result.phases[0].report.records.length,1);
    await assert.rejects(readFile(join(directory,'startup-census.json.part')), {code:'ENOENT'});
  } finally { await rm(root,{recursive:true,force:true}); }
});
test("diagnostic failure never overrides original producer exit zero or one", async () => {
  const root = await mkdtemp(join(tmpdir(), 'census-exit-'));
  try {
    const moduleUrl = new URL('./perf-startup-census.mjs',import.meta.url).href;
    for (const exit of [0,1]) {
      const source = `import { createStartupCensus } from ${JSON.stringify(moduleUrl)};
        const census = await createStartupCensus({page:{async addInitScript(){throw Error('setup');},async evaluate(){throw Error('capture');}}, directory:${JSON.stringify(join(root,'separate'))}, outputPath:${JSON.stringify(join(root,'perf','receipt.json'))},canonicalRaw:${JSON.stringify(join(root,'raw'))},commit:'diagnostic',io:{async mkdir(){},async writeFile(){throw Error('persist');},async rename(){},async rm(){}},log(){}});
        await census.collect('cold'); await census.collect('fixture'); await census.finish(); process.exit(${exit});`;
      const result = spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8'});
      assert.equal(result.status,exit,result.stderr);
    }
  } finally { await rm(root,{recursive:true,force:true}); }
});

test("write and rename failures remove stale complete final receipts", async () => {
  const root = await mkdtemp(join(tmpdir(), 'census-stale-'));
  try {
    for (const failure of ['write','rename']) {
      const directory = join(root,failure);
      await mkdir(directory);
      const final = join(directory,'startup-census.json');
      await writeFile(final,JSON.stringify({complete:true,diagnosticCommit:'old'}));
      const io = {mkdir,rm, async writeFile(...args){if(failure==='write')throw Error('write failed');return writeFile(...args);},async rename(...args){if(failure==='rename')throw Error('rename failed');return rename(...args);}};
      const census = await createStartupCensus({page:{async addInitScript(){},async evaluate(){return {complete:true,records:[]};}},directory,outputPath:join(root,'perf','receipt.json'),canonicalRaw:join(root,'raw'),commit:'new',io,log(){}});
      await census.collect('cold');await census.collect('fixture');await census.finish();
      await assert.rejects(readFile(final),{code:'ENOENT'});
    }
  }finally{await rm(root,{recursive:true,force:true});}
});
