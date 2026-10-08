import { writeFileSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

export const TARGET_COMMIT = "66cedcc724308a622045455e8fbfa648afc89b81";
export const DONOR_SHA256 = "329071c2de7c06eeb9739fdb0fa70a87a1953ecf21fdc1f26677b1f504d59de9";
export const LEDGER_BASENAME = "zk682-current-readiness-draw-longtask-66cedcc-diagnostic.json";
export const MAX_ROWS = 12;
export const MAX_BYTES = 8192;
export const OPERATIONS = Object.freeze([
  "fixture-navigation", "fixed-sleep500", "canvas-visible",
  "canvas-nonzero-dimensions", "canvas-bounding-box",
]);

// All observations use the host Node performance clock. Durations include
// transport and scheduling overlap; they do not isolate browser CPU/GPU work.
export function createReadinessHostObserver({ clock = () => performance.now(), enabled = true } = {}) {
  let origin = null;
  let last = 0;
  let index = 0;
  let active = null;
  let firstFailedOperation = null;
  let firstErrorPresent = false;
  let firstErrorKind = null;
  let terminal = false;
  let status = "UNKNOWN";
  let invalid = false;
  let frozen = null;
  let publication = null;
  let observing = false;
  const records = [];
  const protect = (fn) => {
    if (!enabled || frozen) return;
    if (observing) { invalid = true; return; }
    observing = true;
    try { fn(); } catch { invalid = true; } finally { observing = false; }
  };
  const offsetNow = () => {
    const raw = clock();
    if (!Number.isFinite(raw) || origin === null) throw new Error("invalid clock");
    return raw - origin;
  };
  const append = (operation, kind, offsetMs) => {
    if (!Number.isFinite(offsetMs) || offsetMs < 0 || offsetMs < last || records.length >= MAX_ROWS) {
      invalid = true;
      return;
    }
    last = offsetMs;
    records.push(Object.freeze({ operation, kind, offsetMs }));
  };
  const noteFailure = (operation, value) => {
    if (firstErrorPresent) return;
    if (terminal || active !== operation || !OPERATIONS.includes(operation)) { invalid = true; return; }
    // Presence is independent of truthiness; no thrown-object properties are read.
    firstErrorPresent = true;
    firstFailedOperation = operation;
    firstErrorKind = value === null ? "null" : typeof value;
    append(operation, "error", offsetNow());
  };
  const api = {
    start(startedAt) {
      protect(() => {
        if (origin !== null || !Number.isFinite(startedAt) || startedAt < 0) { invalid = true; return; }
        origin = startedAt;
        append("total", "start", 0);
      });
    },
    enter(operation) {
      protect(() => {
        if (terminal || active !== null || operation !== OPERATIONS[index] || firstErrorPresent) { invalid = true; return; }
        active = operation;
        append(operation, "enter", offsetNow());
      });
    },
    returned(operation) {
      protect(() => {
        if (terminal || active !== operation || firstErrorPresent) { invalid = true; return; }
        append(operation, "return", offsetNow());
        active = null;
        index += 1;
      });
    },
    failed(operation, value) {
      protect(() => noteFailure(operation, value));
    },
    finish(fixtureLoadMs) {
      protect(() => {
        if (terminal || active !== null || index !== OPERATIONS.length || firstErrorPresent) { invalid = true; return; }
        terminal = true;
        status = "returned";
        // Reuse the original measured boundary; do not take a new total clock read.
        append("total", "return", fixtureLoadMs);
      });
    },
    rejected(value) {
      protect(() => {
        if (terminal) return;
        if (active !== null && !firstErrorPresent) noteFailure(active, value);
        if (!firstErrorPresent) { invalid = true; return; }
        terminal = true;
        status = "rejected";
        append("total", "error", offsetNow());
      });
    },
    freeze() {
      if (!frozen) {
        if (!terminal) invalid = true;
        frozen = Object.freeze({
          version: 1, targetCommit: TARGET_COMMIT, donorSha256: DONOR_SHA256,
          clockDomain: "host-node-performance", maxRows: MAX_ROWS,
          records: Object.freeze(records.map((row) => Object.freeze({ ...row }))),
          terminal, status, firstFailedOperation, firstErrorPresent, firstErrorKind,
          observerInvalid: invalid || !enabled,
        });
      }
      return frozen;
    },
    publish(path, { serialize = JSON.stringify, write = writeFileSync } = {}) {
      if (publication) return publication;
      // Freeze before any serializer or filesystem call can run or re-enter.
      const snapshot = api.freeze();
      const fail = (reason) => {
        invalid = true;
        publication = Object.freeze({ published: false, observerInvalid: true, reason });
        return publication;
      };
      // Claim this attempt before callbacks. Re-entry cannot create a second file.
      publication = Object.freeze({ published: false, observerInvalid: true, reason: "publication-in-progress" });
      try {
        if (!enabled || !snapshot.terminal) return fail("missing-terminal");
        const filename = path instanceof URL ? fileURLToPath(path) : path;
        if (typeof filename !== "string" || !isAbsolute(filename) || basename(filename) !== LEDGER_BASENAME) return fail("invalid-path");
        const serialized = serialize(snapshot);
        if (typeof serialized !== "string") return fail("invalid-serialization");
        const data = `${serialized}\n`;
        if (Buffer.byteLength(data, "utf8") > MAX_BYTES) return fail("byte-cap");
        // A serializer may not substitute a different payload or fabricate valid facts.
        if (JSON.stringify(JSON.parse(serialized)) !== JSON.stringify(snapshot)) return fail("invalid-serialization");
        write(filename, data, { flag: "wx", mode: 0o600 });
        publication = Object.freeze({ published: true, observerInvalid: snapshot.observerInvalid, reason: snapshot.observerInvalid ? "invalid-observations" : null });
        return publication;
      } catch { return fail("publication-failed"); }
    },
  };
  return Object.freeze(api);
}

import { createHash } from "node:crypto";
import { installBrowserReadinessRenderObserver } from "./zk682-browser-readiness-render-observer.mjs";

export const DONOR_BYTES = 11354;
const START = "/* zk682-readiness-render:begin */";
const END = "/* zk682-readiness-render:end */";
const insert = (source) => `${START}\n${source}\n${END}\n`;
const sha = (source) => createHash("sha256").update(source).digest("hex");
function once(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error("donor anchor is missing or duplicated");
  return source.replace(anchor, replacement);
}
export function inverseReadinessProducer(generated) {
  if (typeof generated !== "string") throw new Error("source must be text");
  const inverse = generated.replace(/\/\* zk682-readiness-render:begin \*\/[\s\S]*?\/\* zk682-readiness-render:end \*\/\n/g, "");
  if (inverse.includes(START) || inverse.includes(END) || Buffer.byteLength(inverse) !== DONOR_BYTES || sha(inverse) !== DONOR_SHA256) throw new Error("startup producer inverse mismatch");
  return inverse;
}
// Validate not just the inverse but the entire admitted diagnostic insertion.
// An extra await/API/reaction inside a marked block must fail this gate.
export function validateReadinessProducer(generated, options) {
  const donor = inverseReadinessProducer(generated);
  if (transformReadinessProducer(donor, options) !== generated) throw new Error("startup producer insertion mismatch");
  return true;
}
export function transformReadinessProducer(donor, { observerModuleUrl, ledgerPath, driverCommit, targetCommit = TARGET_COMMIT, enabled = true } = {}) {
  if (typeof donor !== "string" || Buffer.byteLength(donor) !== DONOR_BYTES || sha(donor) !== DONOR_SHA256) throw new Error("startup donor identity mismatch");
  const moduleUrl = new URL(observerModuleUrl);
  if (moduleUrl.protocol !== "file:" || !isAbsolute(fileURLToPath(moduleUrl))) throw new Error("observer must be an absolute file URL");
  if (typeof ledgerPath !== "string" || !isAbsolute(ledgerPath) || basename(ledgerPath) !== LEDGER_BASENAME) throw new Error("ledger path must have the pinned basename");
  if (typeof enabled !== "boolean") throw new Error("enabled must be boolean");
  if (!/^[0-9a-f]{40}$/.test(driverCommit) || !/^[0-9a-f]{40}$/.test(targetCommit) || driverCommit === targetCommit) throw new Error("actual separate driver/target source roles required");
  let source = donor;
  const initAnchor = '  localStorage.setItem("coursecraft_ambience", "on");\n';
  const browserInstaller = '(' + installBrowserReadinessRenderObserver.toString() + ')(' + JSON.stringify({enabled,driverCommit,targetCommit}) + ');';
  source = once(source, initAnchor, initAnchor + insert(browserInstaller));
  const predicate = '  return target && (target.width || target.clientWidth) > 0 && (target.height || target.clientHeight) > 0;\n';
  const evidenceAnchor = '    userAgent: navigator.userAgent,\n';
  const browserSnapshot = '    readinessRenderDiagnostic: (() => { try { const api = window.__zk682ReadinessRender66; if (api?.kind !== "zk682-readiness-render-owned-v1" || api.targetCommit !== ' + JSON.stringify(targetCommit) + ' || api.driverCommit !== ' + JSON.stringify(driverCommit) + ') return null; return api.snapshot(); } catch { return null; } })(),';
  source = once(source, evidenceAnchor, insert(browserSnapshot) + evidenceAnchor);
  const importAnchor = 'import { spawn } from "node:child_process";\n';
  source = once(source, importAnchor, insert(`import { createReadinessHostObserver as __zk682CreatePhase } from ${JSON.stringify(moduleUrl.href)};`) + importAnchor);
  const start = "const fixtureStartedAt = performance.now();\n";
  source = once(source, start, insert(`const __zk682Phase = __zk682CreatePhase({ clock: () => performance.now(), enabled: ${enabled} });`) + start + insert("__zk682Phase.start(fixtureStartedAt);\ntry {"));
  const pairs = [
    ["fixture-navigation", 'await page.goto(`http://127.0.0.1:${PORT}/?${PERF_FIXTURE}=1&perfTheme=${PERF_THEME}&perfMeasure=1`, { waitUntil: "domcontentloaded", timeout: 30_000 });\n'],
    ["fixed-sleep500", "await sleep(500);\n"],
    ["canvas-visible", '  await canvas.waitFor({ state: "visible", timeout: FIXTURE_READY_TIMEOUT_MS });\n'],
    ["canvas-nonzero-dimensions", 'await page.waitForFunction(() => {\n  const target = document.querySelector(".cc-pixi-stage canvas");\n  return target && (target.width || target.clientWidth) > 0 && (target.height || target.clientHeight) > 0;\n}, null, { timeout: FIXTURE_READY_TIMEOUT_MS });\n'],
    ["canvas-bounding-box", "const box = await canvas.boundingBox();\n"],
  ];
  for (const [operation, anchor] of pairs) {
    source = once(source, anchor, insert(`__zk682Phase.enter(${JSON.stringify(operation)});`) + anchor + insert(`__zk682Phase.returned(${JSON.stringify(operation)});`));
  }
  source = once(source, predicate, insert('  const __zk682OriginalNonzero = () => {') + predicate + insert('  };\n  const __zk682Nonzero = __zk682OriginalNonzero();\n  if (__zk682Nonzero) try { window.__zk682ReadinessRender66?.markNonzero(__zk682Nonzero); } catch {}\n  return __zk682Nonzero;'));
  const visibleCatch = "} catch (error) {\n  const status = await page.evaluate(() => {\n";
  source = once(source, visibleCatch, "} catch (error) {\n" + insert('__zk682Phase.failed("canvas-visible", error);') + "  const status = await page.evaluate(() => {\n");
  const end = "const fixtureLoadMs = performance.now() - fixtureStartedAt;\n";
  source = once(source, end, end + insert(`__zk682Phase.finish(fixtureLoadMs);\n__zk682Phase.publish(${JSON.stringify(ledgerPath)});`));
  source += insert(`} catch (__zk682ProducerError) {\n  __zk682Phase.rejected(__zk682ProducerError);\n  __zk682Phase.publish(${JSON.stringify(ledgerPath)});\n  throw __zk682ProducerError;\n}`);
  if (inverseReadinessProducer(source) !== donor) throw new Error("startup producer inverse is not byte exact");
  return source;
}

// Extract the actual transformed five-await donor segment for bounded synthetic
// controls. No Playwright import/launch, server, browser or producer module runs.
// The original text-evaluate catch and measured boundary remain in the segment.
export function extractReadinessSegment(generated, options) {
  validateReadinessProducer(generated, options);
  const from = generated.indexOf(START + "\nconst __zk682Phase =");
  const boundary = "const fixtureLoadMs = performance.now() - fixtureStartedAt;\n";
  const finish = generated.indexOf(END + "\n", generated.indexOf(boundary, from) + boundary.length) + END.length + 1;
  if (from < 0 || finish < from) throw new Error("phase extraction anchors missing");
  const handler = generated.slice(generated.lastIndexOf(START));
  return generated.slice(from, finish) + "return { box, fixtureLoadMs };\n" + handler;
}

export function validateBrowserSnapshot(value,{expectedTarget=TARGET_COMMIT,expectedDriver}={}) {
  if(value===null||value===undefined)return {valid:false,complete:false,status:'UNKNOWN',reason:'missing-final-browser-snapshot',drawObservation:'UNKNOWN',credit:false};
  const exact=(object,keys)=>object&&typeof object==='object'&&!Array.isArray(object)&&Object.keys(object).length===keys.length&&keys.every(key=>Object.hasOwn(object,key));
  const keys=['version','unit','targetCommit','driverCommit','clockDomain','timeOriginMs','originMs','routeEligible','limits','callbacks','records','longtasks','contexts','foreignDraws','flags','gl2Supported','longtaskSupported','observerIncomplete','observerErrorPresent','observerErrorKind','stopReason','qualification'];
  if(!exact(value,keys)||value.version!==1||value.unit!=='browser-readiness-draw-longtask-v1'||value.targetCommit!==expectedTarget||value.driverCommit!==expectedDriver||value.clockDomain!=='browser-document-performance')throw new Error('browser diagnostic identity/schema');
  const limits={callbacks:512,rows:12,longtasks:256,contexts:8,draws:1000000,snapshotBytes:65536};if(!exact(value.limits,Object.keys(limits))||Object.entries(limits).some(([key,limit])=>value.limits[key]!==limit))throw new Error('browser diagnostic limits');
  const finite=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0,integer=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
  if(!finite(value.timeOriginMs)||!finite(value.originMs)||!integer(value.callbacks,512)||!integer(value.foreignDraws,1000000)||Buffer.byteLength(JSON.stringify(value))>65536)throw new Error('browser diagnostic clocks/cap');
  for(const key of ['routeEligible','gl2Supported','longtaskSupported','observerIncomplete','observerErrorPresent'])if(typeof value[key]!=='boolean')throw new Error('browser diagnostic flag');
  const kinds=['undefined','null','boolean','number','bigint','string','symbol','object','function'];if(value.observerErrorPresent?!kinds.includes(value.observerErrorKind):value.observerErrorKind!==null)throw new Error('browser diagnostic error presence');
  if(!['snapshot','navigation','observer-error','callback-cap','row-cap','draw-cap','context-cap','longtask-cap','unsupported-capability','route-ineligible'].includes(value.stopReason)||typeof value.qualification!=='string'||!value.qualification.includes('UNKNOWN')||!value.qualification.includes('crossclock'))throw new Error('browser diagnostic terminal/qualification');
  const names=['installed','attached','visible','nonzero','nonzero-predicate','draw-invoked','draw-returned','canvas-duplicate','canvas-replaced','canvas-disconnected','first-rAF-after-draw','snapshot'];
  if(!Array.isArray(value.records)||value.records.length>12||!Array.isArray(value.longtasks)||value.longtasks.length>256||!Array.isArray(value.contexts)||value.contexts.length>8)throw new Error('browser diagnostic array cap');
  let last=value.originMs;const seen=new Set();for(const row of value.records){if(!exact(row,['name','timeMs','canvasId','contextId'])||!names.includes(row.name)||seen.has(row.name)||!finite(row.timeMs)||row.timeMs<last||!((row.canvasId===null)||(integer(row.canvasId,Number.MAX_SAFE_INTEGER)&&row.canvasId>0))||!((row.contextId===null)||(integer(row.contextId,8)&&row.contextId>0)))throw new Error('browser diagnostic row');last=row.timeMs;seen.add(row.name);}
  for(const row of value.longtasks)if(!exact(row,['startTimeMs','durationMs'])||!finite(row.startTimeMs)||!finite(row.durationMs))throw new Error('browser diagnostic longtask');
  const methods=['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'],ids=new Set();let positiveReturns=0;
  for(const context of value.contexts){if(!exact(context,['contextId','canvasId','methods'])||!integer(context.contextId,8)||context.contextId===0||ids.has(context.contextId)||!integer(context.canvasId,Number.MAX_SAFE_INTEGER)||context.canvasId===0||!Array.isArray(context.methods)||context.methods.length!==4)throw new Error('browser diagnostic context');ids.add(context.contextId);
    context.methods.forEach((row,i)=>{if(!exact(row,['name','invocations','returns','throws','positiveCountInvocations','positiveCountReturns','opaqueCountInvocations','firstThrownPresent','firstThrownKind'])||row.name!==methods[i]||['invocations','returns','throws','positiveCountInvocations','positiveCountReturns','opaqueCountInvocations'].some(key=>!integer(row[key],1000000))||row.returns+row.throws>row.invocations||row.positiveCountInvocations>row.invocations||row.positiveCountReturns>row.returns||row.positiveCountReturns>row.positiveCountInvocations||row.opaqueCountInvocations>row.invocations||typeof row.firstThrownPresent!=='boolean'||(row.firstThrownPresent?!kinds.includes(row.firstThrownKind):row.firstThrownKind!==null)||row.firstThrownPresent!==(row.throws>0))throw new Error('browser diagnostic draw');positiveReturns+=row.positiveCountReturns;});
  }
  if(!exact(value.flags,['duplicate','replaced','disconnected','unsupportedVisibility','opaqueDrawArguments'])||Object.values(value.flags).some(flag=>typeof flag!=='boolean'))throw new Error('browser diagnostic lifecycle');
  const complete=!value.observerIncomplete&&!value.observerErrorPresent&&value.routeEligible&&value.gl2Supported&&value.longtaskSupported&&value.stopReason==='snapshot'&&['installed','attached','visible','nonzero-predicate','snapshot'].every(name=>seen.has(name))&&!Object.values(value.flags).some(Boolean)&&(positiveReturns===0||seen.has('first-rAF-after-draw'));
  return {valid:true,complete,status:complete?'OBSERVED':'UNKNOWN',reason:complete?null:'incomplete-browser-coverage',drawObservation:positiveReturns>0?'primitive-positive-count-normal-return':'UNKNOWN',positiveCountReturns:positiveReturns,clockDomain:value.clockDomain,credit:false,qualification:value.qualification};
}
