import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {transformCaptureSource,inverseCaptureSource} from './capture.mjs';
import {transformProducerSource,inverseProducerSource,GENERATED_SPEC_BASENAME,PRODUCER_PIN} from './producer-transform.mjs';
export const CONFIG_PIN='35d7a3e1c5bf4c00508ff1cfd2510a2bc1306c3243eacac924a9b0940327a948';
export const GENERATED_CONFIG_BASENAME='playwright.current040-capture-phase.generated.config.ts';
const hash=source=>createHash('sha256').update(source).digest('hex');
const edits=[
  ['  testMatch: "**/*.e2e.ts",','/*C@001*/  testMatch: "**/zk682-current-capture-phase.generated.ts",/*@C001*/'],
  ['  fullyParallel: false,','  fullyParallel: false,/*C@003*/\n  workers: 1,/*@C003*/'],
  ['  retries: process.env.CI ? 1 : 0,','/*C@004*/  retries: 0,/*@C004*/'],
];
export function transformConfigSource(source){
  assert.equal(hash(source),CONFIG_PIN,'exact current040 canonical config required');let result=source;
  for(const [before,after] of edits){assert.equal(result.split(before).length-1,1);result=result.replace(before,after);}
  assert.equal(inverseConfigSource(result),source);return result;
}
export function inverseConfigSource(source){
  let inverse=source;
  for(const [before,after] of [...edits].reverse()){assert.equal(inverse.split(after).length-1,1);inverse=inverse.replace(after,before);}
  assert.doesNotMatch(inverse,/\/\*[@]?C/);assert.equal(hash(inverse),CONFIG_PIN);return inverse;
}
export function configuredTimeout(source){
  const slots=[...source.matchAll(/^  timeout: ([0-9][0-9_]*),$/gm)];assert.equal(slots.length,1,'one main test timeout required');return Number(slots[0][1].replaceAll('_',''));
}
export function verifyEffectiveTimeout(source,producer){
  const slowCalls=[...producer.matchAll(/\btest\.slow\(\)/g)].length;assert.equal(slowCalls,1,'one canonical test.slow required');
  assert.equal(hash(producer),PRODUCER_PIN,'exact canonical producer required');
  const timeout=configuredTimeout(source),slowMultiplier=3,effectiveTimeout=timeout*slowMultiplier;
  assert.equal(timeout,600000,'canonical base timeout must remain unchanged');assert.equal(effectiveTimeout,1800000,'effective test.slow timeout must be1800000');
  return {timeout,slowCalls,slowMultiplier,effectiveTimeout};
}
export function verifyConfigTransform(source,donor,producer){assert.equal(source,transformConfigSource(donor));assert.equal(inverseConfigSource(source),donor);return {workers:1,retries:0,...verifyEffectiveTimeout(source,producer),testMatch:'**/'+GENERATED_SPEC_BASENAME};}
// Pure source preparation only. No filesystem, process, workflow, reader or runtime action.
export function prepareDiagnosticSources({helper,producer,config}){
  const prepared={helper:transformCaptureSource(helper),producer:transformProducerSource(producer),config:transformConfigSource(config)};
  assert.equal(inverseCaptureSource(prepared.helper),helper);assert.equal(inverseProducerSource(prepared.producer),producer);assert.equal(inverseConfigSource(prepared.config),config);verifyConfigTransform(prepared.config,config,producer);return Object.freeze(prepared);
}
