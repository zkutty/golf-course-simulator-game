import assert from "node:assert/strict";

export const ZK682_STABILITY_PRODUCER_VERSION = "zk682-production-retained-heap-v1";
export const ZK682_STABILITY_HEAP_METHOD = "settle-120ms-gc-immediate-runtime-v1";
export const ZK682_STABILITY_BUILD_MODE = "vite-production-e2e";
export const ZK682_STABILITY_FIXTURE = Object.freeze({ id: "render-perf-course-v1", theme: "parkland", width: 110, height: 70, holes: 18 });

// Nothing may execute between the GC reply and heap query: the settle period
// belongs before the collection whose retained heap this producer certifies.
export async function sampleRetainedHeap(page, cdp) {
  await page.waitForTimeout(120);
  await cdp.send("HeapProfiler.collectGarbage");
  return cdp.send("Runtime.getHeapUsage");
}

const sameKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const buildIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function validateStabilityRuntime(runtime, expectedCommit, expectedBuildId) {
  const errors = [];
  if (!sameKeys(runtime, ["dev", "prod", "mode", "commit", "buildId", "privatePerfFixture", "fixture"])) return ["stability runtime attestation keys are invalid"];
  if (runtime.dev !== false || runtime.prod !== true || runtime.mode !== "e2e") errors.push("stability runtime must be a production-bundled e2e build");
  if (!/^[0-9a-f]{40}$/.test(expectedCommit ?? "") || runtime.commit !== expectedCommit) errors.push("stability runtime candidate commit mismatch");
  if (!buildIdPattern.test(expectedBuildId ?? "") || runtime.buildId !== expectedBuildId) errors.push("stability runtime fresh build identity mismatch");
  if (runtime.privatePerfFixture !== true) errors.push("stability runtime private perfFixture permission is required");
  if (!sameKeys(runtime.fixture, Object.keys(ZK682_STABILITY_FIXTURE)) || Object.entries(ZK682_STABILITY_FIXTURE).some(([key, value]) => runtime.fixture?.[key] !== value)) errors.push("stability runtime fixture identity mismatch");
  return errors;
}

export function createStabilityProducer(runtime, expectedCommit, expectedBuildId) {
  const errors = validateStabilityRuntime(runtime, expectedCommit, expectedBuildId);
  assert.deepEqual(errors, [], errors.join("; "));
  return {
    producerVersion: ZK682_STABILITY_PRODUCER_VERSION,
    heapMethod: ZK682_STABILITY_HEAP_METHOD,
    buildMode: ZK682_STABILITY_BUILD_MODE,
    buildId: expectedBuildId,
    runtime: structuredClone(runtime),
  };
}

export function validateStabilityProducer(producer, expectedCommit) {
  if (!sameKeys(producer, ["producerVersion", "heapMethod", "buildMode", "buildId", "runtime"])) return ["stability producer metadata keys are invalid"];
  const errors = [];
  if (producer.producerVersion !== ZK682_STABILITY_PRODUCER_VERSION) errors.push("unknown stability producer version");
  if (producer.heapMethod !== ZK682_STABILITY_HEAP_METHOD) errors.push("wrong stability producer heap method");
  if (producer.buildMode !== ZK682_STABILITY_BUILD_MODE) errors.push("wrong stability producer build mode");
  return [...errors, ...validateStabilityRuntime(producer.runtime, expectedCommit, producer.buildId)];
}

export function stabilityProducerKind(report) {
  return Object.hasOwn(report, "producer") ? report.producer?.producerVersion : "legacy-unattested-producer";
}
