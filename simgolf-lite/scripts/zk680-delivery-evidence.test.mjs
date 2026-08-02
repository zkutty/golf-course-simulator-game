import assert from "node:assert/strict";
import test from "node:test";
import { DELIVERY_BUDGETS, evaluateDeliveryBudgets } from "./zk680-delivery-evidence.mjs";

test("delivery report records before/after deltas and accepts values within the pinned budgets", () => {
  const baseline = {
    reference: { commit: "baseline", label: "before" },
    measurements: {
      initialJavaScriptBytes: 100,
      visionPageJavaScriptBytes: 200,
      initialCriticalTransferBytes: 300,
      maxSelectedBiomeBytes: 400,
      distBytes: 500,
      desktopPackageBytes: 600,
      desktopAsarBytes: 700,
    },
  };
  const report = evaluateDeliveryBudgets({
    initialJavaScriptBytes: 100,
    visionPageJavaScriptBytes: 200,
  }, baseline);
  assert.equal(report.ok, true);
  assert.equal(report.checks.initialJavaScriptBytes.deltaBytes, 0);
  assert.equal(report.checks.visionPageJavaScriptBytes.budget, DELIVERY_BUDGETS.visionPageJavaScriptBytes);
});

test("delivery report rejects a web bundle above its agreed budget", () => {
  const baseline = {
    reference: { commit: "baseline", label: "before" },
    measurements: { initialJavaScriptBytes: 1 },
  };
  const report = evaluateDeliveryBudgets({
    initialJavaScriptBytes: DELIVERY_BUDGETS.initialJavaScriptBytes + 1,
  }, baseline);
  assert.equal(report.ok, false);
  assert.match(report.errors[0], /initialJavaScriptBytes/);
});
