import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

test("ZK-681 profiles real advisory analysis in a browser Worker", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "The benchmark report is pinned to the Chromium/Electron engine.");
  const workerUrls: string[] = [];
  const consoleErrors: string[] = [];
  page.on("worker", (worker) => workerUrls.push(worker.url()));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/?fixture=zk681-analysis-worker");
  await page.waitForFunction(() => window.__coursecraftAnalysisWorkerBenchmark !== undefined);
  const report = await page.evaluate(async () => {
    if (!window.__coursecraftAnalysisWorkerBenchmark) throw new Error("Worker benchmark fixture did not install.");
    return window.__coursecraftAnalysisWorkerBenchmark;
  });

  expect(consoleErrors).toEqual([]);
  expect(workerUrls.some((url) => url.includes("analysis.worker"))).toBe(true);
  expect(report.measurements.map((item) => item.workload)).toEqual([
    "architecture-routing",
    "surface-habitat",
  ]);
  expect(report.measurements.every((item) => item.outputEquivalent)).toBe(true);
  expect(report.measurements.every((item) => item.mainInputDelayMs >= item.mainComputeMs)).toBe(true);
  expect(report.measurements.every((item) => item.workerInputDelayMs >= 0)).toBe(true);
  expect(report.measurements.find((item) => item.workload === "surface-habitat")?.transferBytes).toBeGreaterThan(0);
  expect(report.semantics).toEqual({
    cancellationRejectedCallback: true,
    staleRevisionRejectedCallback: true,
    sessionTeardownTerminatesWorker: true,
  });
  expect(report.decision).toBe("adopt-advisory-worker");

  const artifactDirectory = path.resolve("artifacts/zk-681");
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(
    path.join(artifactDirectory, "worker-benchmark.json"),
    `${JSON.stringify({
      capturedAt: new Date().toISOString(),
      engine: "Playwright Chromium (Electron-compatible Blink/V8 Worker path)",
      scope: "Automated machine evidence; no physical-device or subjective human validation.",
      report,
    }, null, 2)}\n`,
    "utf8",
  );
});
