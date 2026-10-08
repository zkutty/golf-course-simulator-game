import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const PRODUCER_PIN='69cf83d45ab294d018e142b15834353105aaf456875f2320a0bce4d7fdc057f7';
export const GENERATED_SPEC_BASENAME='zk682-current-capture-phase.generated.ts';
export const GENERATED_HELPER_IMPORT='../scripts/zk682-current-capture-phase/generated-helper.mjs';
export const LEDGER_BASENAME='zk682-current-capture-phase-eebb-diagnostic.json';
export const ORIGINAL_CAPTURE='  const captureReceipt = await captureVisibleCanvas(page, finalCapturePath);';
export const ORIGINAL_IMPORT='import { captureVisibleCanvas } from "../scripts/zk682-public-canvas-capture.mjs";';
const hash=source=>createHash('sha256').update(source).digest('hex');
const NAMESPACE='/*P@001*/// Exact eebb diagnostic only; no original endpoint or release credit.\n// Producer '+PRODUCER_PIN+'; generated spec '+GENERATED_SPEC_BASENAME+'.\n/*@P001*/';
const IMPORT='/*P@002*/import { captureVisibleCanvas, finalizeCaptureObservation, emitLedger } from "'+GENERATED_HELPER_IMPORT+'";/*@P002*/';
export const CAPTURE_BLOCK=`  let captureReceipt;
  let captureFailed = false, capturePrimary;
  try { captureReceipt = await captureVisibleCanvas(page, finalCapturePath); }
  catch (error) { captureFailed = true; capturePrimary = error; }
  // Synchronous diagnostic emission begins only after capture and its rollback settled.
  try { emitLedger(resolve(dirname(outputPath), "${LEDGER_BASENAME}"), finalizeCaptureObservation(captureFailed, capturePrimary)); }
  catch { /* Diagnostic invalid/missing is HOLD; preserve the actual capture outcome. */ }
  if (captureFailed) throw capturePrimary;`;
const CAPTURE='/*P@003*/'+CAPTURE_BLOCK+'/*@P003*/';
export function transformProducerSource(source){
  assert.equal(hash(source),PRODUCER_PIN,'exact current canonical producer required');
  for(const anchor of [ORIGINAL_IMPORT,ORIGINAL_CAPTURE])assert.equal(source.split(anchor).length-1,1,'single producer anchor');
  const result=NAMESPACE+source.replace(ORIGINAL_IMPORT,IMPORT).replace(ORIGINAL_CAPTURE,CAPTURE);
  assert.equal(inverseProducerSource(result),source);return result;
}
export function inverseProducerSource(source){
  assert.equal(source.split(NAMESPACE).length-1,1,'single provenance namespace');
  assert.equal(source.split(IMPORT).length-1,1,'single capture import route');
  assert.equal(source.split(CAPTURE).length-1,1,'single capture settlement block');
  const inverse=source.replace(NAMESPACE,'').replace(IMPORT,ORIGINAL_IMPORT).replace(CAPTURE,ORIGINAL_CAPTURE);
  assert.doesNotMatch(inverse,/\/\*[@]?P/);assert.equal(hash(inverse),PRODUCER_PIN,'complete producer inverse required');return inverse;
}
export function producerInventory(source){
  const patterns={await:/\bawait\s+/g,capture:/\bawait captureVisibleCanvas\(page, finalCapturePath\)/g,then:/\.then\(/g,catchReaction:/\.catch\(/g,promiseRace:/Promise\.race\(/g,allSettled:/Promise\.allSettled\(/g};
  return Object.fromEntries(Object.entries(patterns).map(([name,pattern])=>[name,[...source.matchAll(pattern)].length]));
}
export function verifyProducerTransform(source,donor){
  assert.equal(source,transformProducerSource(donor),'bounded diagnostic-only producer template required');
  assert.equal(inverseProducerSource(source),donor);assert.deepEqual(producerInventory(source),producerInventory(donor));
  assert.doesNotMatch(GENERATED_SPEC_BASENAME,/\.e2e\.ts$/);return producerInventory(donor);
}
