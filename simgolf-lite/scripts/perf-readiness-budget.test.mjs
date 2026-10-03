import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readinessBudgetValidation, rendererBudgetValidation, DEFAULT_COLD_STARTUP_BUDGET_MS, DEFAULT_FIXTURE_LOAD_BUDGET_MS } from "./perf-readiness-budget.mjs";

const check = (coldStartupMs, fixtureLoadMs) => readinessBudgetValidation({ coldStartupMs, fixtureLoadMs,
  startupBudgetMs: DEFAULT_COLD_STARTUP_BUDGET_MS, fixtureBudgetMs: DEFAULT_FIXTURE_LOAD_BUDGET_MS });
test("accepts the exact 5000ms cold and 6000ms fixture boundaries", () => {
  assert.deepEqual(check(5000, 6000), { coldStartupWithinBudget: true, fixtureLoadWithinBudget: true, passed: true });
});
test("fails fixture readiness independently of a fast cold startup", () => {
  assert.deepEqual(check(281, 64949), { coldStartupWithinBudget: true, fixtureLoadWithinBudget: false, passed: false });
  assert.equal(check(5000, 6000.01).passed, false);
});
test("fails cold startup independently of a fast fixture", () => {
  assert.deepEqual(check(5000.01, 1), { coldStartupWithinBudget: false, fixtureLoadWithinBudget: true, passed: false });
});
test("rejects absent, nonfinite and negative measurements and invalid budgets", () => {
  for (const invalid of [undefined, NaN, Infinity, -1]) {
    assert.equal(check(invalid, 1).passed, false);
    assert.equal(check(1, invalid).passed, false);
  }
  assert.equal(readinessBudgetValidation({coldStartupMs:1, fixtureLoadMs:1, startupBudgetMs:0, fixtureBudgetMs:6000}).passed, false);
});
test("the perf entrypoint consumes readiness validation in its failing exit and evidence", () => {
  const source = readFileSync(new URL("./perf-smoke.mjs", import.meta.url), "utf8");
  assert.match(source, /const readiness = readinessBudgetValidation\(/);
  assert.match(source, /let failed = !readiness.passed \|\| !rendererValidation.passed/);
  assert.match(source, /fixtureLoadWithinBudget: readiness.fixtureLoadWithinBudget/);
  assert.match(source, /fixtureLoadMilliseconds: FIXTURE_LOAD_BUDGET_MS/);
  assert.match(source, /if \(failed\) process.exit\(1\)/);
});

test("renderer metrics and asserted budgets fail closed; tighter hardware budgets remain valid", () => {
  const valid = { workMs: 8, p95Ms: 33, workBudgetMs: 8, frameBudgetMs: 33, assertFrame: true };
  assert.deepEqual(rendererBudgetValidation(valid), { rendererWorkWithinBudget: true, frameWithinBudget: true, passed: true });
  for (const key of ["workMs", "p95Ms", "workBudgetMs", "frameBudgetMs"]) {
    for (const bad of [undefined, NaN, Infinity, -1]) assert.equal(rendererBudgetValidation({ ...valid, [key]: bad }).passed, false);
  }
  for (const [workBudgetMs, frameBudgetMs] of [[9, 33], [8, 34], [0, 33], [8, 0]]) {
    assert.equal(rendererBudgetValidation({ ...valid, workMs: 1, p95Ms: 1, workBudgetMs, frameBudgetMs }).passed, false);
  }
  assert.equal(rendererBudgetValidation({ ...valid, workMs: 1, p95Ms: 20, frameBudgetMs: 20 }).passed, true);
  assert.equal(rendererBudgetValidation({ ...valid, workMs: 1, p95Ms: 20.01, frameBudgetMs: 20 }).passed, false);
  assert.equal(rendererBudgetValidation({ ...valid, p95Ms: NaN, frameBudgetMs: NaN, assertFrame: false }).passed, true);
});
test("environment overrides may tighten but cannot widen either release readiness budget", () => {
  for (const [startupBudgetMs, fixtureBudgetMs] of [[5001, 6000], [5000, 6001], [Infinity, 6000], [5000, NaN], [-1, 6000]]) {
    assert.equal(readinessBudgetValidation({ coldStartupMs: 1, fixtureLoadMs: 1, startupBudgetMs, fixtureBudgetMs }).passed, false);
  }
  assert.equal(readinessBudgetValidation({ coldStartupMs: 1, fixtureLoadMs: 1, startupBudgetMs: 1000, fixtureBudgetMs: 2000 }).passed, true);
});
