import { createHash } from "node:crypto";
import { isAbsolute, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { DONOR_SHA256, LEDGER_BASENAME } from "./observer.mjs";

export const DONOR_BYTES = 11354;
const START = "/* zk682-startup-phase:begin */";
const END = "/* zk682-startup-phase:end */";
const insert = (source) => `${START}\n${source}\n${END}\n`;
const sha = (source) => createHash("sha256").update(source).digest("hex");
function once(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error("donor anchor is missing or duplicated");
  return source.replace(anchor, replacement);
}
export function inverseStartupProducer(generated) {
  if (typeof generated !== "string") throw new Error("source must be text");
  const inverse = generated.replace(/\/\* zk682-startup-phase:begin \*\/[\s\S]*?\/\* zk682-startup-phase:end \*\/\n/g, "");
  if (inverse.includes(START) || inverse.includes(END) || Buffer.byteLength(inverse) !== DONOR_BYTES || sha(inverse) !== DONOR_SHA256) throw new Error("startup producer inverse mismatch");
  return inverse;
}
// Validate not just the inverse but the entire admitted diagnostic insertion.
// An extra await/API/reaction inside a marked block must fail this gate.
export function validateStartupProducer(generated, options) {
  const donor = inverseStartupProducer(generated);
  if (transformStartupProducer(donor, options) !== generated) throw new Error("startup producer insertion mismatch");
  return true;
}
export function transformStartupProducer(donor, { observerModuleUrl, ledgerPath, enabled = true } = {}) {
  if (typeof donor !== "string" || Buffer.byteLength(donor) !== DONOR_BYTES || sha(donor) !== DONOR_SHA256) throw new Error("startup donor identity mismatch");
  const moduleUrl = new URL(observerModuleUrl);
  if (moduleUrl.protocol !== "file:" || !isAbsolute(fileURLToPath(moduleUrl))) throw new Error("observer must be an absolute file URL");
  if (typeof ledgerPath !== "string" || !isAbsolute(ledgerPath) || basename(ledgerPath) !== LEDGER_BASENAME) throw new Error("ledger path must have the pinned basename");
  if (typeof enabled !== "boolean") throw new Error("enabled must be boolean");
  let source = donor;
  const importAnchor = 'import { spawn } from "node:child_process";\n';
  source = once(source, importAnchor, insert(`import { createStartupPhaseObserver as __zk682CreatePhase } from ${JSON.stringify(moduleUrl.href)};`) + importAnchor);
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
  const visibleCatch = "} catch (error) {\n  const status = await page.evaluate(() => {\n";
  source = once(source, visibleCatch, "} catch (error) {\n" + insert('__zk682Phase.failed("canvas-visible", error);') + "  const status = await page.evaluate(() => {\n");
  const end = "const fixtureLoadMs = performance.now() - fixtureStartedAt;\n";
  source = once(source, end, end + insert(`__zk682Phase.finish(fixtureLoadMs);\n__zk682Phase.publish(${JSON.stringify(ledgerPath)});`));
  source += insert(`} catch (__zk682ProducerError) {\n  __zk682Phase.rejected(__zk682ProducerError);\n  __zk682Phase.publish(${JSON.stringify(ledgerPath)});\n  throw __zk682ProducerError;\n}`);
  if (inverseStartupProducer(source) !== donor) throw new Error("startup producer inverse is not byte exact");
  return source;
}

// Extract the actual transformed five-await donor segment for bounded synthetic
// controls. No Playwright import/launch, server, browser or producer module runs.
// The original text-evaluate catch and measured boundary remain in the segment.
export function extractStartupPhaseSegment(generated, options) {
  validateStartupProducer(generated, options);
  const from = generated.indexOf(START + "\nconst __zk682Phase =");
  const boundary = "const fixtureLoadMs = performance.now() - fixtureStartedAt;\n";
  const finish = generated.indexOf(END + "\n", generated.indexOf(boundary, from) + boundary.length) + END.length + 1;
  if (from < 0 || finish < from) throw new Error("phase extraction anchors missing");
  const handler = generated.slice(generated.lastIndexOf(START));
  return generated.slice(from, finish) + "return { box, fixtureLoadMs };\n" + handler;
}
