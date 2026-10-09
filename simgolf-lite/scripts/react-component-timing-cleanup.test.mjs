import assert from "node:assert/strict";
import test from "node:test";
import { clearReactComponentTimings } from "./react-component-timing-cleanup.mjs";

const component = (name) => ({ name, detail: { devtools: { track: "Components ⚛" } } });
function buffer(initial) {
  let entries = [...initial];
  const cleared = [];
  return {
    cleared,
    getEntriesByType(type) { assert.equal(type, "measure"); return [...entries]; },
    clearMeasures(name) { assert.equal(typeof name, "string"); cleared.push(name); entries = entries.filter((entry) => entry.name !== name); },
  };
}
test("clears only exact React component timings and reports bounded counts", () => {
  const api = buffer([component("\u200bHUD"), component("\u200bHUD"), component("Mount")]);
  assert.deepEqual(clearReactComponentTimings(api), {
    measureEntriesBefore: 3, reactComponentEntriesBefore: 3, clearedEntries: 3,
    clearedNames: 2, preservedCollisionNames: 0, measureEntriesAfter: 0,
  });
  assert.deepEqual(api.cleared, ["\u200bHUD", "Mount"]);
});
test("preserves unknown detail, tracks, scheduler timings and lookalike metadata", () => {
  const unknown = [{ name: "game" }, { name: "missing", detail: {} },
    { name: "Update", detail: { devtools: { trackGroup: "Scheduler ⚛", track: "Blocking" } } },
    { name: "lookalike", detail: { devtools: { track: "Components" } } },
    { name: "nested", detail: { track: "Components ⚛" } }];
  const api = buffer(unknown);
  assert.equal(clearReactComponentTimings(api).clearedEntries, 0);
  assert.deepEqual(api.getEntriesByType("measure"), unknown);
  assert.deepEqual(api.cleared, []);
});
test("preserves every entry of mixed names while clearing independent safe names", () => {
  const mixed = [component("Mount"), { name: "Mount", detail: { game: true } }, component("\u200bHUD")];
  const api = buffer(mixed);
  const result = clearReactComponentTimings(api);
  assert.equal(result.preservedCollisionNames, 1);
  assert.equal(result.clearedEntries, 1);
  assert.deepEqual(api.cleared, ["\u200bHUD"]);
  assert.deepEqual(api.getEntriesByType("measure"), mixed.slice(0, 2));
});
test("empty buffers do not clear by wildcard", () => {
  const api = buffer([]);
  assert.equal(clearReactComponentTimings(api).measureEntriesAfter, 0);
  assert.deepEqual(api.cleared, []);
});
