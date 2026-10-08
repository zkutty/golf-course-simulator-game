import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {transformConfigSource,inverseConfigSource,verifyConfigTransform,configuredTimeout,verifyEffectiveTimeout} from './prepare.mjs';
const root=process.env.O_CAPTURE_DONOR_ROOT??fileURLToPath(new URL('../../',import.meta.url));
const config=readFileSync(resolve(root,'playwright.config.ts'),'utf8'),producer=readFileSync(resolve(root,'e2e/zk682-resource-growth.e2e.ts'),'utf8');
test('full canonical config inverse retains base600000 with exclusive generated one-worker zero-retry namespace',()=>{
  const generated=transformConfigSource(config);assert.equal(inverseConfigSource(generated),config);
  assert.equal(configuredTimeout(generated),configuredTimeout(config));assert.equal(configuredTimeout(generated),600000);
  assert.deepEqual(verifyConfigTransform(generated,config,producer),{workers:1,retries:0,timeout:600000,slowCalls:1,slowMultiplier:3,effectiveTimeout:1800000,testMatch:'**/zk682-current-capture-phase.generated.ts'});
  for(const mutation of [generated+'\n',generated.replace('workers: 1','workers: 2'),generated.replace('retries: 0','retries: 1'),generated.replace('testMatch: "**/zk682-current-capture-phase.generated.ts"','testMatch: "**/*.e2e.ts"')])assert.throws(()=>verifyConfigTransform(mutation,config,producer));
  assert.throws(()=>transformConfigSource(config+'\n'));
});
test('one canonical test.slow yields effective1800000 and base1800000 mutation fails meaningfully',()=>{
  const generated=transformConfigSource(config);
  assert.equal((producer.match(/\btest\.slow\(\)/g)??[]).length,1);
  assert.deepEqual(verifyEffectiveTimeout(generated,producer),{timeout:600000,slowCalls:1,slowMultiplier:3,effectiveTimeout:1800000});
  const excessive=generated.replace('  timeout: 600_000,','  timeout: 1_800_000,');assert.notEqual(excessive,generated);
  assert.equal(configuredTimeout(excessive),1800000);assert.equal(configuredTimeout(excessive)*3,5400000);
  assert.throws(()=>verifyEffectiveTimeout(excessive,producer),/canonical base timeout/);
  assert.throws(()=>verifyConfigTransform(excessive,config,producer));assert.throws(()=>inverseConfigSource(excessive));
  assert.throws(()=>verifyEffectiveTimeout(generated,producer.replace('test.slow();','')),/one canonical test.slow/);
  assert.throws(()=>verifyEffectiveTimeout(generated,producer+'\ntest.slow();'),/one canonical test.slow/);
});
