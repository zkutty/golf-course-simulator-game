import assert from "node:assert/strict";
import test from "node:test";
import { auditParkland4x } from "./parkland-4x-asset-audit.mjs";

test("Parkland 4x contract is machine-verifiable and keeps the shipped fallback", () => {
  const result = auditParkland4x();
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.source.status, "not-generated");
  assert.equal(result.source.files, 0);
});
